import { preparationChanged } from '../navigation/shared-departure.ts';
import type { HuntCycle, HuntConvoy, HuntTickState, HuntTickPorts } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import type { Relocation } from "../../characters/movement-relocation.ts";
import { requestObject } from "../http/contracts.ts";
import { zones } from "../../../dashboard/lib/farming-zones.ts";
import { coordinatorHuntDestination } from "./controls.ts";
import * as policy from "../../hunt/policy.ts";

export interface RouteRecoveryCommand {
  key: string;
  stage: "native" | "relocation" | "post-relocation";
  relocation?: Relocation["method"];
}
export interface HuntRouteRecovery {
  destination: ReturnLocation;
  geometry: string;
  phase: "native" | "relocation" | "post-relocation" | "held" | "excluded";
  relocation?: Relocation;
  firstFailure: string;
  message: string;
  attempts: { id: string; at: number; reason: string; details?: unknown }[];
}
export function routeDestinationKey(p: ReturnLocation): string {
  return JSON.stringify([p.map, p.in ?? p.map, p.x, p.y]);
}
/** A child convoy must not reset a failed Hunt destination's budget. */
export function ownsHuntRoute(
  hunt: HuntCycle | null | undefined,
  c: Pick<HuntConvoy, "routeRecovery" | "purpose" | "walkingActivity" | "location">,
): boolean {
  if (!hunt) return false;
  const destination = hunt.missions?.[hunt.currentIndex]?.destination;
  if (!destination || !["mission-travel", "farming", "paused-event"].includes(hunt.stage))
    return false;
  if (c.routeRecovery) return !!hunt.routeRecovery?.[c.routeRecovery.key];
  if (!missionConvoy(c)) return false;
  return !!c.location && routeDestinationKey(c.location) === routeDestinationKey(destination);
}
function missionConvoy(c: Pick<HuntConvoy, "purpose" | "walkingActivity">): boolean {
  return (
    c.purpose === "monster-hunt" ||
    (c.purpose === "shared-walk" && c.walkingActivity === "farm-recovery")
  );
}
function geometry(state: HuntTickState): string {
  const g = state.statuses[String(state.leader)]?.movementGeometry;
  return g ? g.version + ":" + g.fingerprint : "unknown";
}
function entryFor(
  hunt: HuntCycle,
  state: HuntTickState,
  destination: ReturnLocation,
): HuntRouteRecovery | undefined {
  const entry = hunt.routeRecovery?.[routeDestinationKey(destination)];
  return entry?.geometry === geometry(state) ? entry : undefined;
}
function recordFailure(
  hunt: HuntCycle,
  state: HuntTickState,
  destination: ReturnLocation,
  c: HuntConvoy,
  now: number,
): HuntRouteRecovery {
  const key = routeDestinationKey(destination),
    previous = entryFor(hunt, state, destination);
  const entry =
    previous ||
    ((hunt.routeRecovery ||= {})[key] = {
      destination,
      geometry: geometry(state),
      phase: "native",
      firstFailure: c.failure || "Route failed without a reason",
      message: "",
      attempts: [],
    });
  const id = c.id + ":" + (c.epoch ?? 0);
  if (entry.attempts.some((a) => a.id === id)) return entry;
  entry.attempts.push({
    id,
    at: now,
    reason: c.failure || "Route failed without a reason",
    details: c.failureDetails,
  });
  classifyFailure(entry, previous, c);
  return entry;
}
function classifyFailure(
  entry: HuntRouteRecovery,
  previous: HuntRouteRecovery | undefined,
  c: HuntConvoy,
): void {
  if (previous?.phase === "post-relocation") {
    entry.phase = "excluded";
    return;
  }
  if (!previous && requestObject(requestObject(c.failureDetails).movement).engine !== "native") {
    entry.phase = "native";
    return;
  }
  entry.phase = "excluded";
  entry.message = 'Route exhausted; trying another spawn';
}
function paused(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  if (
    state.farmAreaState?.paused ||
    state.eventReturn ||
    (state.escape && state.escape.stage !== "released") ||
    hunt.encounter
  )
    return true;
  if (newerOwner(hunt, state, ports)) return true;
  return (
    !ports.fresh(hunt) ||
    hunt.participants.some(
      (n) =>
        ports.intent(n).cancelled ||
        state.statuses[n]?.activeEvent ||
        state.statuses[n]?.joinedEvent,
    )
  );
}
function newerOwner(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  const c = state.activeConvoy;
  return hunt.participants.some((n) => {
    const command = state.commands[n],
      revision = c?.expected?.[n]?.revision;
    if (revision !== undefined && revision !== ports.intent(n).revision) return true;
    return !!command && command.convoyId !== c?.id && command.purpose !== "monster-hunt";
  });
}
function configure(hunt: HuntCycle, state: HuntTickState, entry: HuntRouteRecovery): void {
  const c = state.activeConvoy;
  if (!c || c.id !== hunt.convoyId) return;
  const command: RouteRecoveryCommand = {
    key: routeDestinationKey(entry.destination),
    stage: "native",
  };
  state.location = entry.destination;
  c.routeRecovery = command;
  c.nativeFallback = entry.phase === "native";
  for (const n of hunt.participants)
    if (state.commands[n]?.convoyId === c.id) {
      state.commands[n]!.routeRecovery = command;
      state.commands[n]!.nativeFallback = c.nativeFallback;
    }
}
function alternate(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
  entry: HuntRouteRecovery,
): boolean {
  const mission = hunt.missions[hunt.currentIndex];
  const next = coordinatorHuntDestination(state, mission.target, (choices, focus) =>
    zones(choices, focus).filter(
      (d) => !["excluded", "held"].includes(entryFor(hunt, state, d)?.phase || ""),
    ),
  );
  if (!next) {
    entry.message =
      "No reachable " +
      mission.target +
      " spawn remains in this Hunt cycle. First failure: " +
      entry.firstFailure;
    hunt.message = entry.message;
    return true;
  }
  ports.cancelConvoy();
  hunt.convoyId = null;
  delete hunt.originArrivedAt;
  mission.destination = next;
  mission.destinationVersion = 1;
  delete mission.destinationRevisions;
  if (state.farmAreaState) {
    state.farmAreaState.pending = null;
    state.farmAreaState.message = null;
  }
  hunt.stage = "mission-travel";
  hunt.message = "Trying alternate " + mission.target + " spawn: " + next.map;
  ports.start(hunt, next, hunt.message, "mission-travel");
  ports.persist();
  return true;
}
function dispatch(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
  entry: HuntRouteRecovery,
): boolean {
  if (state.activeConvoy) return true;
  const destination = entry.destination;
  hunt.message = "Recovering Hunt route with native planner (one attempt)";
  if (ports.start(hunt, destination, hunt.message, "mission-travel")) {
    configure(hunt, state, entry);
    ports.persist();
  }
  return true;
}
/** Runs ahead of farming reunion, but never ahead of quest turn-in or another activity's ownership. */
export function recoverHuntRoute(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
): boolean {
  const destination = hunt.missions[hunt.currentIndex]?.destination;
  if (!destination || !["mission-travel", "farming", "paused-event"].includes(hunt.stage))
    return false;
  if (policy.shouldReturn(hunt, state.leader!, state.statuses) || paused(hunt, state, ports))
    return false;
  if (restoreRecoveryDestination(hunt,state,ports)) return true;
  // The ledger retains the destination's spent retry budget after success.
  // It is not a request to start another convoy once arrival released farming.
  if (recoveryReleased(hunt, state)) return false;
  const entry = observeFailure(hunt, state, ports, destination);
  return entry ? advanceRecovery(hunt, state, ports, entry) : false;
}
function recoveryReleased(hunt: HuntCycle, state: HuntTickState): boolean {
  const convoy = state.activeConvoy;
  if (convoy) return !ownsHuntRoute(hunt, convoy);
  return hunt.stage === "farming" && !!hunt.originArrivedAt;
}
function observeFailure(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
  destination: ReturnLocation,
): HuntRouteRecovery | undefined {
  const c = state.activeConvoy;
  if (resetChangedGeometry(hunt,state,ports,destination)) return;
  if (c?.phase !== "failed" || c.failureCode !== "route-failed")
    return entryFor(hunt, state, destination);
  const alreadyRecorded = entryFor(hunt, state, destination)?.attempts.some(
    (a) => a.id === c.id + ":" + (c.epoch ?? 0),
  );
  const entry = recordFailure(hunt, state, destination, c, ports.now());
  if (["native", "relocation"].includes(entry.phase)) {
    ports.cancelConvoy();
    hunt.convoyId = null;
    delete hunt.originArrivedAt;
  }
  if (!alreadyRecorded) ports.persist();
  return entry;
}
function resetChangedGeometry(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts, destination: ReturnLocation): boolean {
  const prior=hunt.routeRecovery?.[routeDestinationKey(destination)];
  if (!prior || prior.geometry===geometry(state) && !preparationChanged(prior.firstFailure)) return false;
  delete hunt.routeRecovery![routeDestinationKey(destination)];
  if (state.activeConvoy) { ports.cancelConvoy(); hunt.convoyId=null; }
  ports.persist(); return true;
}
function advanceRecovery(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
  entry: HuntRouteRecovery,
): boolean {
  // Retire persisted relocation attempts from older versions, including bank detours.
  if (entry.relocation || entry.phase === 'relocation' || entry.phase === 'post-relocation') {
    delete entry.relocation;
    entry.phase = 'excluded';
    ports.cancelConvoy();
    hunt.convoyId = null;
    ports.persist();
  }
  if (entry.phase === "held") {
    hunt.message = entry.message;
    return true;
  }
  if (entry.phase === "excluded") return alternate(hunt, state, ports, entry);
  return dispatch(hunt, state, ports, entry);
}
/** Applied before route preparation, including child walks restored after a restart. */
export function inheritedHuntRoute(
  hunt: HuntCycle | null | undefined,
  c: Pick<HuntConvoy, "routeRecovery" | "purpose" | "walkingActivity" | "location">,
  fingerprint: string,
): HuntRouteRecovery | undefined {
  if (!ownsHuntRoute(hunt, c) || !c.location) return;
  const entry = hunt?.routeRecovery?.[routeDestinationKey(c.location)];
  return entry?.geometry === fingerprint ? entry : undefined;
}

/** Repair a recovery waypoint adopted as a spawn by the former farming retry owner. */
function restoreRecoveryDestination(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  const mission=hunt.missions[hunt.currentIndex];
  if (!hunt.routeRecovery || !mission?.destination) return false;
  const catalog=zones(state.monsterChoices || [],[mission.target]);
  const valid=(p:ReturnLocation)=>catalog.some(d=>routeDestinationKey(d)===routeDestinationKey(p));
  if (!catalog.length || valid(mission.destination)) return false;
  const original=Object.values(hunt.routeRecovery).find(entry=>valid(entry.destination));
  if (!original || !canRestoreDestination(hunt,state)) return false;
  mission.destination=original.destination; mission.destinationVersion=1;
  state.location=original.destination;
  ports.cancelConvoy(); hunt.convoyId=null; delete hunt.originArrivedAt;
  if (state.farmAreaState) { state.farmAreaState.pending=null; state.farmAreaState.message=null; }
  hunt.stage='mission-travel'; hunt.message='Restored Hunt spawn after temporary route recovery';
  ports.persist(); return true;
}
function canRestoreDestination(hunt: HuntCycle, state: HuntTickState): boolean {
  const c=state.activeConvoy;
  return !c || c.purpose==='monster-hunt' && c.id===hunt.convoyId;
}
