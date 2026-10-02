import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { RealmOperation } from "../characters/realm-switch.ts";

interface RealmRouteState {
  steamMembers: string[];
  realmSwitch: RealmOperation | null;
  bankboiTransaction: unknown;
  statuses: Record<string, { seenAt: number; server?: string } | undefined>;
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
  /** One character's home realm (SR_ key) from the refreshed account roster. */
  characterHome(name: string): string | null;
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
    (operation.homePending ?? [operation.homeExecutor]).includes(String(body.character))
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
  function switchRealm(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      realm = typeof body.realm === "string" ? body.realm : "";
    if (!ports.resolve(realm))
      return res.status(400).json({ error: "unknown Adventure Land realm" });
    if (realm.endsWith("PVP"))
      return res
        .status(409)
        .json({ error: "PVP realm switching is displayed but intentionally disabled" });
    if (state.realmSwitch && ["switching", "setting-home"].includes(state.realmSwitch.phase))
      return res.status(409).json({ error: "a realm switch is already in progress" });
    if (state.bankboiTransaction || ports.bankBusy())
      return res.status(409).json({ error: "wait for the current bankboi transaction to finish" });
    return checkParticipants(realm, !!body.setHome, res);
  }
  function fail(operation: RealmOperation, error: string): void {
    operation.phase = "failed";
    operation.error = error;
    operation.completedAt = ports.now();
    ports.persist();
  }
  async function confirmHome(operation: RealmOperation, res: HttpResponse): Promise<unknown> {
    try {
      await ports.refresh();
      const targets = operation.homeTargets || [operation.homeExecutor || ""];
      const failed = Object.entries(operation.homeFailures || {}).map(([name, error]) => name + " (" + error + ")");
      const unconfirmed = targets.filter((name) => !operation.homeFailures?.[name] && ports.characterHome(name) !== operation.realm);
      if (failed.length || unconfirmed.length)
        throw new Error("Home realm not set for " + [...failed, ...unconfirmed.map((name) => name + " (not confirmed by Adventure Land)")].join(", "));
      operation.phase = "complete";
      operation.homeRealm = operation.realm;
      operation.completedAt = ports.now();
      operation.message = "Home realm changed to " + ports.label(operation.realm);
      ports.persist();
      ports.dispatch();
      return res.json({ ok: true, homeRealm: operation.realm });
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
    const name = requestText(body.character);
    delete state.commands[name];
    if (operation.homePending) operation.homePending = operation.homePending.filter((pending) => pending !== name);
    if (!body.success)
      (operation.homeFailures ||= {})[name] = requestText(body.error || "Adventure Land rejected the home realm change");
    ports.persist();
    // Wait for every character's Bean visit before checking the account roster.
    if (operation.homePending?.length) return res.json({ ok: true, pending: operation.homePending });
    return confirmHome(operation, res);
  }
  return { switchRealm, homeComplete };
}
