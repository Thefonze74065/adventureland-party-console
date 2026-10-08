import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { RealmOperation } from "../characters/realm-switch.ts";

interface RealmRouteState {
  steamMembers: string[];
  realmSwitch: RealmOperation | null;
  bankboiTransaction: unknown;
  statuses: Record<string, { seenAt: number; server?: string; home?: string } | undefined>;
  commands: Record<string, unknown>;
}
interface RealmRoutePorts {
  now(): number;
  resolve(realm: string): unknown;
  bankBusy(): boolean;
  participants(): string[];
  native(): string | null;
  current(): string | null;
  home(): string | null;
  characterHome(name: string): string | null;
  accountCharacters(): string[];
  sleep(ms: number): Promise<void>;
  persist(): void;
  run(operation: RealmOperation): unknown;
  refresh(): Promise<unknown>;
  label(realm: string): string;
  dispatch(): void;
}

function isCurrentHome(
  operation: RealmOperation | null,
  body: Record<string, unknown>,
): operation is RealmOperation {
  return (
    !!operation &&
    operation.id === body.operationId &&
    operation.phase === "setting-home" &&
    typeof body.character === "string" &&
    !!operation.homeExecutors?.includes(body.character)
  );
}

export function createRealmRoutes(state: RealmRouteState, ports: RealmRoutePorts) {
  function start(
    realm: string,
    setHome: boolean,
    participants: string[],
    res: HttpResponse,
  ): unknown {
    const operation: RealmOperation = {
      id: "realm-" + ports.now(),
      phase: "switching",
      realm,
      setHome,
      fromRealm: ports.current(),
      homeRealm: ports.home(),
      participants,
      homeTargets: setHome ? ports.accountCharacters() : undefined,
      characters: participants.map((name) => ({
        name,
        realm: "SR_" + state.statuses[name]!.server,
        arrived: "SR_" + state.statuses[name]!.server === realm,
      })),
      startedAt: ports.now(),
      completedAt: null,
      error: null,
    };
    state.realmSwitch = operation;
    ports.persist();
    ports.run(operation);
    return res.status(202).json({ ok: true, operation });
  }
  function checkParticipants(realm: string, setHome: boolean, res: HttpResponse): unknown {
    const participants = ports.participants();
    if (!participants.length)
      return res.status(409).json({ error: "no active characters are assigned" });
    const stale = participants.filter(
      (name) => !state.statuses[name] || state.statuses[name]!.seenAt < ports.now() - 10000,
    );
    if (stale.length)
      return res
        .status(409)
        .json({
          error: "every active character must be connected before switching",
          characters: stale,
        });
    if (participants.some((name) => state.steamMembers.includes(name)) && !ports.native())
      return res
        .status(409)
        .json({ error: "the Steam character must be connected before switching" });
    return start(realm, setHome, participants, res);
  }
  function switchConflict(): string | null {
    if (state.realmSwitch && ["switching", "setting-home"].includes(state.realmSwitch.phase))
      return "a realm switch is already in progress";
    if (state.bankboiTransaction || ports.bankBusy())
      return "wait for the current bankboi transaction to finish";
    return null;
  }
  async function switchRealm(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const body = requestObject(req.body),
      realm = typeof body.realm === "string" ? body.realm : "";
    if (!ports.resolve(realm))
      return res.status(400).json({ error: "unknown Adventure Land realm" });
    if (realm.endsWith("PVP"))
      return res
        .status(409)
        .json({ error: "PVP realm switching is displayed but intentionally disabled" });
    const conflict = switchConflict();
    if (conflict) return res.status(409).json({ error: conflict });
    if (body.setHome) {
      try { await ports.refresh(); }
      catch (error) {
        return res.status(502).json({ error: "Could not refresh account home realms: " + requestText(requestObject(error).message || error) });
      }
      // Account I/O yields: another transition may have reserved ownership.
      const refreshedConflict = switchConflict();
      if (refreshedConflict) return res.status(409).json({ error: refreshedConflict });
    }
    return checkParticipants(realm, !!body.setHome, res);
  }
  function fail(operation: RealmOperation, error: string): void {
    operation.phase = "failed";
    operation.error = error;
    operation.completedAt = ports.now();
    ports.persist();
  }
  function observedHome(operation: RealmOperation, name: string): string | null {
    // Native set_home acknowledges the live player before its periodic DB save.
    // Accept only a fresh observation from this operation's destination realm.
    const status = state.statuses[name];
    const fresh = status && status.seenAt >= Math.max(operation.startedAt, ports.now() - 5000) &&
      "SR_" + String(status.server || "").replace(/^SR_/, "") === operation.realm;
    return fresh && status.home ? status.home : ports.characterHome(name);
  }
  async function confirmHome(operation: RealmOperation, name: string, res: HttpResponse): Promise<unknown> {
    try {
      const deadline = ports.now() + 30_000;
      let confirmed = false;
      do {
        await ports.refresh();
        const home = observedHome(operation, name);
        confirmed = !!home && "SR_" + home.replace(/^SR_/, "") === operation.realm;
        if (confirmed) break;
        await ports.sleep(500);
      } while (ports.now() < deadline && operation.phase === "setting-home");
      if (!confirmed) throw new Error("Adventure Land did not confirm the new home realm for " + name);
      const entry = operation.characters.find((character) => character.name === name);
      if (!entry) throw new Error("Character is not part of this home change");
      entry.homeConfirmed = true;
      ports.persist();
      return res.json({ ok: true, character: name, homeRealm: operation.realm });
    } catch (error) {
      fail(operation, requestText(requestObject(error).message || error));
      return res.status(502).json({ error: operation.error });
    }
  }
  async function homeComplete(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const body = requestObject(req.body),
      operation = state.realmSwitch;
    if (!isCurrentHome(operation, body))
      return res.status(409).json({ error: "home realm operation is no longer current" });
    if (operation.characters.some((entry) => entry.name === body.character && entry.homeConfirmed))
      return res.json({ ok: true, character: body.character, homeRealm: operation.realm });
    delete state.commands[requestText(body.character)];
    if (!body.success) {
      fail(operation, requestText(body.character) + ": " + requestText(body.error || "Adventure Land rejected the home realm change"));
      return res.json({ ok: false });
    }
    return confirmHome(operation, requestText(body.character), res);
  }
  return { switchRealm, homeComplete };
}
