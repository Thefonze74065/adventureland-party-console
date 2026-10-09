import { createSwitcher } from "./switcher.ts";
import type { Handoff } from "../roster/handoff.ts";
import { serverAddress, steamBootstrap, previousSteamBootstrap, steamBridgeVersion } from "./connection.ts";
import { createRealmChoice } from "./realm-choice.ts";
import { createSteamRecovery, deliberatelyStopped, type GameWindow } from "./recovery.ts";
import { steamObservations } from './observations.ts';

/** Native api_call rejects plain objects; never serialize account/session fields. */
function nativeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const fields = error as Record<string, unknown>;
    const messages = [fields.reason, fields.error, fields.message]
      .filter((value): value is string => typeof value === "string" && !!value.trim())
      .map(value => value.slice(0, 500));
    if (messages.length) return [...new Set(messages)].join(": ");
  }
  return "Native Steam operation failed without an error reason";
}

const slotKey = "party-console-bootstrap-slot-v1";
const operationKey = "party-console-steam-operation-v1";
const releaseKey = "party-console-steam-release-v1";
type Release = { operationId: string; from: string | null; released: true };
function restoreRelease(storage: Storage): Release | null {
  try {
    const value = JSON.parse(storage.getItem(releaseKey) || "null") as Partial<Release> | null;
    if (
      value?.released === true &&
      typeof value.operationId === "string" &&
      (value.from === null || typeof value.from === "string")
    )
      return value as Release;
  } catch {
    /* A malformed local record cannot acknowledge a release. */
  }
  return null;
}
export interface Member {
  name: string;
  ctype: string;
  group: string;
  online: boolean;
  hosting?: "steam" | "headless" | "offline";
}
export interface BridgeReply {
  operation: Handoff | null;
  realm: string;
  members: Member[];
  steam?: string[];
  primary?: string | null;
}
interface NativeHost extends Pick<
  Window,
  | "document"
  | "localStorage"
  | "sessionStorage"
  | "location"
  | "fetch"
  | "setTimeout"
  | "clearTimeout"
> {
  server_region?: string;
  server_identifier?: string;
  character?: { name: string };
  socket?: { connected: boolean; disconnect(): void };
  caracAL?: unknown;
  no_html?: boolean;
  is_bot?: boolean;
  code_active?: boolean;
  // Native game.js schedules reconnects through these window-local fields.
  auto_reload?: string | boolean;
  character_to_load?: string | null;
  reload_state?: string | boolean;
  __partySteamSessionId?: string;
  get_active_characters?(): Record<string, string>;
  start_character_runner?(name: string, slot: string): Promise<unknown>;
  stop_character_runner?(name: string): void;
  // Native X.codes is the account CODE-slot inventory (17665 code_list).
  X?: { characters: { name: string; id: string }[]; codes?: Record<string, unknown> };
  api_call(
    method: string,
    body: object,
  ): Promise<{ success?: boolean; failed?: boolean; reason?: string }>;
  storage_get(key: string): string | null;
  storage_set(key: string, value: string): void;
  stop_runner(): void;
  add_log?(message: string, color?: string): void;
  __partySteamBridge?: { realmProtocol: number; version?: number; server?: string; dispose(): void };
}

/** Runs in the game window, so stopping/replacing CODE does not retire the bridge. */
export function installSteamBridge(host: NativeHost): void {
  const server = serverAddress(host as NativeHost & { __partyServer?: string });
  const API = server + "/party-api";
  const bootstrap = steamBootstrap(server);
  if (host.caracAL || host.no_html || host.is_bot) return;
  host.__partySteamBridge?.dispose();
  const lifecycle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let released = restoreRelease(host.sessionStorage);
  let releasing: string | null = released?.operationId || null;
  let navigating: string | null = null;
  let failure: { operationId: string; error: string } | null = null;
  const clientId = host.sessionStorage.getItem("party-steam-client") || crypto.randomUUID();
  host.sessionStorage.setItem("party-steam-client", clientId);
  // Window-local: survives CODE/bridge replacement, changes on a fresh game page.
  const sessionId = host.__partySteamSessionId ||= crypto.randomUUID();
  const switcher = createSwitcher(host, (character, action = "primary") => post("/steam/action", { character, action }));
  const realmChoice = createRealmChoice(host.document, (operationId, choice) => post("/steam/realm-choice", { operationId, choice }));
  const starting = new Set<string>();
  const startErrors = new Map<string, string>();
  let missingSince = 0;
  const recovery = createSteamRecovery(host as NativeHost & GameWindow, bootstrap, ensureBootstrap,
    message => { console.warn("[Steam recovery] " + message); host.add_log?.(message, "#ffcc77"); });
  let bootstrapSaved = false;

  async function post(path: string, body: object): Promise<BridgeReply> {
    const response = await host.fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(10000)]),
    });
    const payload = (await response.json()) as BridgeReply & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Steam bridge request failed");
    return payload;
  }

  async function ensureBootstrap(target: string): Promise<string> {
    const connectionSlotKey = slotKey + ":" + server;
    let slot = host.localStorage.getItem(connectionSlotKey);
    const excluded = new Set<string>();
    if (!slot || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(slot)) slot = null;
    if (slot && !bootstrapSaved) {
      const response = await host.fetch("/code.js?name=" + encodeURIComponent(slot), { cache: "no-store",
        signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(6000)]) });
      if (!response.ok) throw new Error("Cannot verify managed bootstrap slot");
      const code = (await response.text()).trim();
      const legacy = `globalThis.__partyServer=${JSON.stringify(server)};parent.__partyServer=globalThis.__partyServer;$.getScript(${JSON.stringify(server + "/CODE/adventure_land/universal-loader.js")});`;
      if (code !== bootstrap && code !== legacy && code !== previousSteamBootstrap(server)) { excluded.add(slot); slot = null; }
    }
    if (!slot) {
      // Native CODE permits numbered slots 1..100, not arbitrary UUID names.
      // Missing inventory is unknown, never permission to overwrite user CODE.
      const codes = host.X?.codes;
      if (!codes || typeof codes !== "object" || Array.isArray(codes))
        throw new Error("Cannot inspect saved CODE slots. Refresh the Adventure Land account selection and retry.");
      for (let candidate = 100; candidate >= 1; candidate--) {
        const key = String(candidate);
        if (!Object.hasOwn(codes, key) && !excluded.has(key)) { slot = key; break; }
      }
      if (!slot) throw new Error("No free Adventure Land CODE slot (1–100). Free a saved slot and retry; existing CODE has not been overwritten.");
    }
    if (!bootstrapSaved) {
      const saved = await host.api_call("save_code", {
        slot,
        name: "PartyConsole",
        code: bootstrap,
        electron: true,
        auto: true,
      });
      if (saved.failed || saved.success !== true)
        throw new Error(saved.reason || "Could not save the generic CODE bootstrap");
      host.localStorage.setItem(connectionSlotKey, slot);
      bootstrapSaved = true;
    }
    const character = host.X?.characters.find((entry) => entry.name === target);
    if (!character) throw new Error("Steam account roster does not contain " + target);
    const raw = host.storage_get("code_cache") || "{}";
    if (!host.localStorage.getItem(connectionSlotKey + ":original-cache"))
      host.localStorage.setItem(connectionSlotKey + ":original-cache", raw);
    const cache = JSON.parse(raw) as Record<string, string>;
    cache["slot_" + character.id] = slot;
    cache["run_" + character.id] = "1";
    cache["code_" + character.id] = bootstrap;
    host.storage_set("code_cache", JSON.stringify(cache));
    return slot;
  }

  function persistRelease(operation: Handoff) {
    releasing = operation.id;
    released = { operationId: operation.id, from: operation.from, released: true };
    host.sessionStorage.setItem(releaseKey, JSON.stringify(released));
  }
  function disconnectPrimary() {
    // game.js otherwise automatically reloads even after stop_runner(), logging
    // the character back into Steam before headless can claim ownership.
    host.auto_reload = "off";
    host.character_to_load = null;
    host.reload_state = false;
    host.stop_runner();
    host.socket?.disconnect();
  }
  async function releaseNative(operation: Handoff): Promise<void> {
      releasing = operation.id;
      // Prepare persistence before disconnecting, so a save error leaves the
      // current native game usable and the coordinator can retain ownership.
      if (operation.target) await ensureBootstrap(operation.target);
      if (lifecycle.signal.aborted) return;
      host.localStorage.setItem(operationKey, operation.id);
      persistRelease(operation);
      disconnectPrimary();
  }
  function navigate(id: string, target: string, destinationRealm: string): void {
      navigating = id;
      const realm = destinationRealm.replace(/^SR_/, "").match(/^(US|EU|ASIA)(I|II|III|IV|V|PVP)$/);
      if (!realm) throw new Error("Invalid Steam destination realm");
      host.location.href =
        "/character/" +
        encodeURIComponent(target) +
        "/in/" +
        realm[1] +
        "/" +
        realm[2] +
        "/";
  }
  function mayStartCompanion(operation: Handoff, name: string): boolean {
    const group = operation.multi!;
    if (!operation.destinationRealm || !group.before || group.before.includes(name)) return true;
    return group.before.filter(member => group.desired.includes(member))
      .every(member => (group.arrived || []).includes(member));
  }
  async function act(reply: BridgeReply): Promise<void> {
    const operation = reply.operation;
    realmChoice.show(operation);
    await recovery.tick(reply);
    if (lifecycle.signal.aborted) return;
    if (operation?.phase === "awaiting-realm-choice") return;
    if ((!operation || operation.phase === "complete") && reply.primary === host.character?.name && host.socket?.connected) {
      for (const name of reply.steam || []) await ensureBootstrap(name);
      const active = host.get_active_characters?.() || {};
      const missing = (reply.steam || []).some(name => name !== reply.primary && !active[name] && !deliberatelyStopped(host.localStorage, name));
      if (!missing) missingSince = 0;
      else if (!missingSince) missingSince = Date.now();
      else if (Date.now()-missingSince >= 8000) {
        missingSince = Date.now(); await post("/steam/restore", {}); return;
      }
    }
    if (operation?.multi) {
      const group = operation.multi;
      // A previous bridge may have disconnected with native auto-reload still
      // enabled. Finish that interrupted headless release when CODE reconnects.
      const retryRelease = operation.phase === "failed" && group.action === "headless" &&
        group.releaseIssued && !operation.releasedAt && host.socket?.connected &&
        group.release.includes(host.character?.name || "") && [
          "Steam operation timed out; assignments remain reserved until recovery",
          "Coordinator restarted during handoff; confirm offline ownership before recovery",
        ].includes(operation.error || "");
      if (operation.phase === "failed" && !retryRelease) { releasing = null; failure = null; return; }
      if (operation.phase === "complete") return;
      if ((operation.phase === "release" && releasing !== operation.id) || retryRelease) {
        // Save every bootstrap before touching a running character.
        for (const name of group.desired) await ensureBootstrap(name);
        if (lifecycle.signal.aborted) return;
        host.localStorage.setItem(operationKey, operation.id);
        persistRelease(operation);
        for (const name of group.release) {
          if (name === host.character?.name) disconnectPrimary();
          else host.stop_character_runner?.(name);
        }
      }
      if (operation.phase === "navigate" && group.primary) {
        const destination = operation.destinationRealm || reply.realm;
        const wrongRealm = operation.destinationRealm && "SR_" + host.server_region + host.server_identifier !== destination;
        if (host.character?.name !== group.primary || !host.socket?.connected || wrongRealm) {
          if (navigating !== operation.id) navigate(operation.id, group.primary, destination);
          return;
        }
        const active = host.get_active_characters?.() || {};
        for (const name of group.desired) {
          if (name === group.primary || active[name] || starting.has(name)) continue;
          if (!mayStartCompanion(operation, name)) continue;
          if (!host.start_character_runner) throw new Error("This Steam client cannot start background characters");
          const slot = await ensureBootstrap(name);
          starting.add(name);
          // The game launch promise can outlive several bridge polls. Keep
          // heartbeats flowing and retry stale account-roster rejections.
          void Promise.resolve(host.start_character_runner(name, slot)).catch(error => {
            startErrors.set(name, nativeErrorMessage(error));
            console.warn("[Steam bridge] Starting " + name + ": " + nativeErrorMessage(error));
          }).finally(() => host.setTimeout(() => starting.delete(name), 3000));
        }
      }
      return;
    }
    if (!operation || operation.phase === "failed" || operation.phase === "complete") return;
    if (operation.phase === "release" && releasing !== operation.id) {
      await releaseNative(operation);
    }
    if (operation.phase === "navigate" && operation.target && navigating !== operation.id) {
      navigate(operation.id, operation.target, reply.realm);
    }
  }

  function clearCompleted(reply: BridgeReply): void {
      if (!reply.operation || reply.operation.phase === "complete") {
        released = null;
        failure = null;
        releasing = null;
        navigating = null;
        host.localStorage.removeItem(operationKey);
        host.sessionStorage.removeItem(releaseKey);
      }
  }
  async function poll(): Promise<void> {
    if (lifecycle.signal.aborted) return;
    let reply: BridgeReply | undefined;
    try {
      reply = await post("/steam/bridge", {
        version: 2,
        clientId,
        sessionId,
        character: host.socket?.connected ? host.character?.name : null,
        realm: host.socket?.connected ? "SR_" + host.server_region + host.server_identifier : null,
        observations: steamObservations(host, name => deliberatelyStopped(host.localStorage, name), starting, startErrors),
        running: [ ...(host.socket?.connected && host.character && host.code_active ? [host.character.name] : []),
          ...Object.entries(host.get_active_characters?.() || {}).filter(([, state]) => state === "code").map(([name]) => name) ],
        operationId: host.localStorage.getItem(operationKey),
        ...released,
        ...failure,
      });
      if (lifecycle.signal.aborted) return;
      clearCompleted(reply);
      switcher.render(reply);
      await act(reply);
    } catch (error) {
      const message = nativeErrorMessage(error);
      console.warn("[Steam bridge] " + message);
      if (reply?.operation) failure = { operationId: reply.operation.id, error: message };
    } finally {
      if (!lifecycle.signal.aborted)
        timer = host.setTimeout(() => void poll(), 1000) as unknown as ReturnType<
          typeof setTimeout
        >;
    }
  }
  host.__partySteamBridge = {
    realmProtocol: 2,
    version: steamBridgeVersion,
    server,
    dispose() {
      lifecycle.abort();
      host.clearTimeout(timer as unknown as number);
      switcher.dispose();
      realmChoice.dispose();
      recovery.dispose();
    },
  };
  void poll();
}
