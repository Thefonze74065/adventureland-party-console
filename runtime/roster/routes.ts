import { BridgeSession } from "./bridge-session.ts";
import { SteamGroup, type SteamAction } from "./steam-group.ts";
import {
  SteamHandoff,
  RosterConflict,
  type RosterOwnership,
  type HandoffPorts,
} from "./handoff.ts";

interface Request {
  body?: unknown;
  params: Record<string, string>;
}
interface Response {
  status(code: number): Response;
  json(body: unknown): void;
}
/** Keep raw property access and primitive boxing; handlers validate the fields they consume. */
function payload(request:Request):Record<string,unknown>|null|undefined {
  return request.body as Record<string,unknown>|null|undefined;
}
type Handler = (request: Request, response: Response) => void | Promise<void>;
interface Router {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
}
interface Member {
  name: string;
  ctype?: string;
  group: string;
  online: boolean;
}
export interface RosterRoutesPorts extends HandoffPorts {
  observationsChanged?(entries: import('./connection-status.ts').SteamObservation[]): void;
  members(): Member[];
  realm(): string;
  nativeBusy(): boolean;
  bridgeChanged(character: string | null): void;
  codeRunning?(name: string): boolean;
  characterBusy?(name: string): boolean;
  prepareSteam?(name: string): Promise<void>;
}
/** HTTP adaptation is kept separate from the ownership state machine. */
export function installRosterRoutes(
  router: Router,
  state: RosterOwnership,
  ports: RosterRoutesPorts,
) {
  let rosterBusy = false;
  const realmContext = () => {
    const context = ports.realmContext?.();
    return context ? { ...context, current: bridge.currentRealm() || context.current } : undefined;
  };
  const service: SteamHandoff = new SteamHandoff(state, {
    ...ports,
    bridgeReady: () => bridge.ready(),
    steamSessionId: () => bridge.sessionId(),
  });
  const group: SteamGroup = new SteamGroup(state, { ...ports, realmContext, steamSessionId: () => bridge.sessionId(), bridgeReady: (): boolean => bridge.ready(2), prepareSteam: name => ports.prepareSteam?.(name) || Promise.resolve() });
  const bridge: BridgeSession = new BridgeSession(state, service, ports, group);
  router.get("/party-api/steam/connection", (_request, response) => {
    response.json({ connected: bridge.connected(), ready: bridge.ready(2) });
  });
  if (state.handoff && !["complete", "failed", "awaiting-realm-choice"].includes(state.handoff.phase)) {
    state.handoff.phase = "failed";
    state.handoff.error =
      "Coordinator restarted during handoff; confirm offline ownership before recovery";
    ports.save();
  }
  const route = (path: string, handler: (request: Request) => Promise<unknown>) =>
    router.post(path, async (request, response) => {
      const exclusive = !path.endsWith("/bridge");
      if (exclusive && rosterBusy) {
        response.status(409).json({ error: "Another roster operation is in progress" });
        return;
      }
      if (exclusive) rosterBusy = true;
      try {
        response.json(await handler(request));
      } catch (error) {
        response.status(error instanceof RosterConflict ? 409 : 502).json({ error: String(error) });
      } finally {
        if (exclusive) rosterBusy = false;
      }
    });
  const requestSwitch = async (target: string | null, returnToHeadless: boolean) => {
    if ((state.steam?.length || 0) > 1 || state.handoff?.multi)
      throw new RosterConflict("Reload the dashboard to use per-character Steam controls");
    if (ports.nativeBusy())
      throw new RosterConflict("Wait for the active character operation to finish");
    return { ok: true, operation: await service.begin(target, returnToHeadless) };
  };
  function assertActionIdle(action:unknown,name:string):void {
    const affected = action === "primary" || state.native === name ? [...(state.steam || []), name] : [name];
    if (affected.some(n => ports.characterBusy?.(n))) throw new RosterConflict("Wait for the character's active inventory operation to finish");
  }
  function isHeadlessLogout(action:unknown,name:string):boolean {
    return action === "logout" && state.slots.includes(name) && !state.steam?.includes(name);
  }
  async function logoutHeadless(name:string):Promise<{ok:true}> {
    if (state.handoff && state.handoff.phase !== "complete") throw new RosterConflict("Resolve the pending Steam operation first");
    await ports.stopHeadless(name);
    if (!await ports.confirmOffline(name)) throw new RosterConflict("Character is still stopping; assignment retained");
    state.slots[state.slots.indexOf(name)] = null; ports.save(); return { ok: true };
  }
  async function prepareSteam(action: unknown, name: string): Promise<void> {
    if (!(action === "login" || action === "primary") || !ports.prepareSteam) return;
    if (!ports.owned(name) || !bridge.ready(2)) throw new RosterConflict("Run the Steam bridge and choose an owned character");
    if (state.handoff && state.handoff.phase !== "complete") throw new RosterConflict("Resolve the pending Steam operation first");
    if (!needsRealmChoice(action, name)) await ports.prepareSteam(name);
  }
  function needsRealmChoice(action: unknown, name: string): boolean {
    if (!["login", "primary"].includes(String(action)) || !state.native) return false;
    if (name === state.native && (state.steam?.length || 0) <= 1) return false;
    const context = realmContext();
    return !!context && (!context.current || !context.home || context.current !== context.home);
  }
  route("/party-api/steam/action", async request => {
    const action = payload(request)?.action, name = payload(request)?.character;
    if (action === "headless-all") {
      if (state.steam?.some(n => ports.characterBusy?.(n))) throw new RosterConflict("Wait for active inventory operations to finish");
      return { ok: true, operation: await group.allHeadless() };
    }
    if (typeof name !== "string" || !["primary", "login", "headless", "logout"].includes(String(action)))
      throw new RosterConflict("Choose a character and session action");
    await prepareSteam(action, name);
    if (!needsRealmChoice(action, name)) assertActionIdle(action,name);
    if (isHeadlessLogout(action,name)) return logoutHeadless(name);
    return { ok: true, operation: await group.begin(action as SteamAction, name) };
  });
  route("/party-api/steam/restore", async () => {
    if (!state.native || !state.steam?.includes(state.native)) throw new RosterConflict("No Steam primary to restore");
    return { ok: true, operation: await group.begin("primary", state.native) };
  });
  route("/party-api/steam/realm-choice", async request => ({
    ok: true,
    operation: await group.chooseRealm(String(payload(request)?.operationId), String(payload(request)?.choice)),
  }));
  route("/party-api/steam/switch", (request) => {
    const target = payload(request)?.character;
    if (typeof target !== "string") throw new RosterConflict("Choose a character");
    return requestSwitch(target, true);
  });
  route("/party-api/steam/headless", () => requestSwitch(null, true));
  route("/party-api/steam/recover", async () => {
    if (state.handoff?.multi) await group.recover(); else await service.cancel();
    return { ok: true };
  });

  route("/party-api/steam/bridge", async (request) => {
    await bridge.receive(payload(request) || {});
    return { ok: true, operation: state.handoff, realm: ports.realm(),
      primary: state.native, steam: state.steam || [],
      members: ports.members().map(member => ({ ...member,
        hosting: state.steam?.includes(member.name) ? "steam" : state.slots.includes(member.name) ? "headless" : "offline" })) };
  });

  route("/party-api/slots/:slot/logout", async (request) => {
    const slot = Number(request.params.slot);
    if (slot === 0) return requestSwitch(null, false);
    if (!Number.isInteger(slot) || slot < 1 || slot > state.slots.length)
      throw new RosterConflict("Invalid slot");
    if (state.handoff && state.handoff.phase !== "complete")
      throw new RosterConflict("Resolve the pending handoff first");
    const name = state.slots[slot - 1];
    if (!name) throw new RosterConflict("Slot is empty");
    await ports.stopHeadless(name);
    if (!(await ports.confirmOffline(name)))
      throw new RosterConflict("Character is still stopping; slot remains reserved");
    state.slots[slot - 1] = null;
    ports.save();
    return { ok: true, character: name };
  });

  function spawnDestination(request: Request): { slot: number; name: string } {
    const slot = Number(request.params.slot),
      name = payload(request)?.character;
    if (!Number.isInteger(slot) || slot < 1 || slot > state.slots.length)
      throw new RosterConflict("Invalid slot");
    if (typeof name !== "string" || !ports.owned(name))
      throw new RosterConflict("Unknown character");
    return { slot, name };
  }
  function assertSpawnAvailable(slot:number,name:string):void {
    if (state.handoff && state.handoff.phase !== "complete")
      throw new RosterConflict("Resolve the pending handoff first");
    if (state.slots[slot - 1] || state.slots.includes(name) || state.steam?.includes(name) || state.native === name)
      throw new RosterConflict("Slot or character is already assigned");
    // Existing characters retain their sessions; only the added character is
    // changing ownership. The validator still enforces the global BankBoi lock.
    ports.validateParticipants([name]);
  }
  route("/party-api/slots/:slot/spawn", async (request) => {
    const { slot, name } = spawnDestination(request);
    assertSpawnAvailable(slot,name);
    // Reserve before awaiting account I/O, to serialize competing spawn requests.
    state.slots[slot - 1] = name;
    ports.save();
    try {
      if (!(await ports.confirmOffline(name)))
        throw new RosterConflict("Character is already online outside this slot");
      ports.startHeadless(name, slot - 1);
    } catch (error) {
      state.slots[slot - 1] = null;
      ports.save();
      throw error;
    }
    return { ok: true, character: name, slot };
  });
  const expiration = setInterval(() => { if (state.handoff?.multi) group.expire(); else service.expire(); }, 1000);
  expiration.unref();
  return { service, dispose: () => clearInterval(expiration) };
}
