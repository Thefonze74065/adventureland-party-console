import type {HuntFailureState} from "../hunt/settings.ts";
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { HuntCycle, HuntCommand, HuntStatus } from "../hunt/contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import { beginHuntEventTrip, endHuntEventTrip, type HuntEventTrips } from "../events/hunt-trip.ts";

interface HuntControlState extends HuntEventTrips {
  eventReturn?: { participants: string[] } | null;
  anniversary?: { eventCycle?: { returnCompletedAt?: number; supersededAt?: number } | null };
  monsterHunt: HuntCycle | null;
  activeConvoy: { id: string; purpose?: string | null; phase: string; nativeFallback?: boolean } | null;
  statuses: Record<string, HuntStatus | undefined>;
  commands: Record<string, HuntCommand | undefined>;
  escape?: { stage: string } | null;
  monsterHunterLocation: ReturnLocation | null;
}
interface HuntControlPorts {
  owned(name: string): unknown;
  ownsTravel(hunt: HuntCycle | null): boolean;
  fresh(hunt: HuntCycle): boolean;
  cancelled(name: string): boolean;
  cancelConvoy(): void;
  start(hunt: HuntCycle, location: ReturnLocation | null, label: string, stage: string): unknown;
  persist(): void;
  eventDeparture?(
    name: string,
    event: string,
    operation?: { id: string; phase: string },
  ): { allowed: boolean; reason?: string };
}

export function createHuntControlRoutes(state: HuntControlState, ports: HuntControlPorts) {
  function anniversaryReturnFinished(name: string): boolean {
    const cycle = state.anniversary?.eventCycle;
    return (
      !!(cycle?.returnCompletedAt || cycle?.supersededAt) && !state.statuses[name]?.huntEventPending
    );
  }

  function reconcilePreviousTrip(name: string, event: string): void {
    const previousTrip = state.huntEventTrips?.[name]?.at(-1);
    if (!previousTrip || previousTrip.endedAt) return;
    const obsolete =
      ["null", "undefined"].includes(previousTrip.event) ||
      (!event && previousTrip.event === "anniversary" && anniversaryReturnFinished(name));
    if (!obsolete) return;
    endHuntEventTrip(state, name, previousTrip.event, Date.now());
    ports.persist();
  }

  function permission(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const allowed = travelAllowed(name);
    const event = typeof body.event === "string" ? body.event : "";
    // Ordinary permission polling is not participation. Reconcile a completed
    // anniversary return even when its final acknowledgement preceded this runtime.
    reconcilePreviousTrip(name, event);
    const operation = body.kissOperation as { id: string; phase: string } | undefined;
    if (event === "anniversary" && operation?.phase === "end") {
      ports.eventDeparture?.(name, event, operation);
      return res.json({ allowed });
    }
    if (!allowed || !event || ports.cancelled(name)) return res.json({ allowed });
    return depart(name, event, operation, res);
  }
  function travelAllowed(name: string): boolean {
    return !state.eventReturn?.participants.includes(name) &&
      !ports.ownsTravel(state.monsterHunt) && !ports.cancelled(name);
  }
  function depart(
    name: string,
    event: string,
    operation: { id: string; phase: string } | undefined,
    res: HttpResponse,
  ): unknown {
    const departure = ports.eventDeparture?.(name, event, operation);
    if (departure && !departure.allowed) return res.json(departure);
    const trip = beginHuntEventTrip(state, name, event, Date.now());
    ports.persist();
    return res.json({ allowed: true, eventTrip: trip });
  }
  function failedReturn(hunt: HuntCycle | null): hunt is HuntCycle {
    const convoy = state.activeConvoy;
    return (
      !!hunt &&
      hunt.stage === "returning" &&
      ports.ownsTravel(hunt) &&
      (!convoy || (convoy.purpose === "monster-hunt" && convoy.phase === "failed"))
    );
  }
  function blocked(name: string): boolean {
    const status = state.statuses[name],
      command = state.commands[name];
    return (
      status?.convoyProtocol !== 4 ||
      ports.cancelled(name) ||
      !!status?.rip ||
      (!!command && command.convoyId !== state.activeConvoy?.id)
    );
  }
  function retryReturn(_req: HttpRequest, res: HttpResponse): unknown {
    const hunt = state.monsterHunt;
    if (!failedReturn(hunt))
      return res.status(409).json({ error: "No failed hunt turn-in to resume" });
    if (
      !ports.fresh(hunt) ||
      hunt.participants.some(blocked) ||
      (state.escape && state.escape.stage !== "released")
    )
      return res
        .status(409)
        .json({ error: "Waiting for the current party runtimes and navigation ownership" });
    hunt.returnNativeFallback ||= !!state.activeConvoy?.nativeFallback;
    ports.cancelConvoy();
    hunt.convoyId = null;
    ports.start(hunt, state.monsterHunterLocation, "Resuming Monster Hunt turn-in", "returning");
    ports.persist();
    return res.json({ ok: true, convoyId: hunt.convoyId });
  }
  function currentInteraction(
    command: HuntCommand | undefined,
    body: Record<string, unknown>,
  ): command is HuntCommand {
    return (
      !!command &&
      command.type === "monster-hunt-interact" &&
      command.id === Number(body.commandId) &&
      command.cycleId === body.cycleId
    );
  }
  function interactionComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const command = state.commands[name];
    if (!currentInteraction(command, body))
      return res.status(409).json({ error: "monster hunt command is no longer current" });
    if (!body.success) {
      delete state.commands[name];
      if (state.monsterHunt)
        state.monsterHunt.message =
          "Retrying " +
          command.action +
          " for " +
          name +
          (body.error ? ": " + requestText(body.error) : "");
    }
    ports.persist();
    return res.json({ ok: true });
  }
  return { permission, retryReturn, interactionComplete };
}

interface BlacklistState extends HuntFailureState {
  monsterChoices?: { id: string }[] | null;
}
function initializeBlacklist(state: BlacklistState): void {
  state.huntBlacklist ||= {};
  state.huntFailures ||= {};
}
function knownBlacklistMonster(state:BlacklistState,id:unknown,action:unknown):boolean {
  if(typeof id!=='string')return false;
  if((state.monsterChoices || []).some(monster=>monster.id===id))return true;
  // Saved entries remain removable while catalogs repopulate after restart.
  return action==='remove' && (Object.hasOwn(state.huntBlacklist || {},id) || Object.hasOwn(state.huntFailures || {},id));
}
export function createHuntBlacklistRoute(
  state: BlacklistState,
  ports: { now(): number; persist(): void },
) {
  return function blacklist(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (!["add", "remove", "clear"].includes(requestText(body.action)))
      return res.status(400).json({ error: "invalid blacklist action" });
    if (
      body.action !== "clear" &&
      !knownBlacklistMonster(state,body.monsterId,body.action)
    )
      return res.status(400).json({ error: "unknown monster" });
    initializeBlacklist(state);
    const id = requestText(body.monsterId);
    if (body.action === "clear") { state.huntBlacklist = {}; state.huntFailures = {}; }
    else if (body.action === "remove") { delete state.huntBlacklist![id]; delete state.huntFailures![id]; }
    else
      state.huntBlacklist![id] ||= {
        monsterId: id,
        at: ports.now(),
        deaths: 0,
        reason: "Manually blacklisted",
      };
    ports.persist();
    return res.json({ ok: true, blacklist: state.huntBlacklist });
  };
}
