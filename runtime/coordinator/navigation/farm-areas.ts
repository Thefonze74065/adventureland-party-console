import { ownsHuntRoute } from '../hunt/route-recovery.ts';
import {competitionHold} from "./farm-competition.ts";
import type { HuntCycle } from "../hunt/contracts.ts";
import type {
  FarmingArea,
  FarmAreaState,
  FarmNavigationPorts,
  FarmNavigationState,
  FarmReport,
} from "./farm-area-types.ts";
import { createFarmAreaRecovery, relocation } from "./farm-area-recovery.ts";
import { classifyTravelDefense } from "./travel-defense.ts";

export function createFarmAreaNavigation(party: FarmNavigationState, ports: FarmNavigationPorts) {
  let lastTick = 0;
  const recovery = createFarmAreaRecovery(ports);
  function searchRadius(): number {
    return Number(party.monsterSearchRadiusByCharacter?.[String(party.leader)]) || 400;
  }
  function targetIds(hunt: HuntCycle | null): string[] {
    return hunt?.target ? [hunt.target] : party.monsterFocus || [];
  }

  function migrate(state: FarmAreaState): void {
    if (state.recoveryVersion === 2) return;
    state.recoveryVersion = 2;
    state.paused = false;
    state.failures = {};
    state.pending = null;
    state.message = null;
    ports.persist();
  }

  function promoteShape(active: FarmingArea, hunt: HuntCycle | null): void {
    if (!active.shapes || party.location!.shapes) return;
    party.location = active;
    const mission = hunt?.missions?.[hunt.currentIndex];
    if (mission) mission.destination = active;
    ports.persist();
  }

  function memberBlocked(name: string, now: number): boolean {
    const status = party.statuses[name];
    return (
      !status ||
      now - status.seenAt > 10000 ||
      !!status.rip ||
      !!ports.intent(name).cancelled ||
      !!status.activeEvent ||
      !!status.joinedEvent
    );
  }

  function clearArrivedFailure(
    state: FarmAreaState,
    names: string[],
    reports: FarmReport[],
    active: FarmingArea,
  ): void {
    if (
      party.activeConvoy ||
      state.pending ||
      state.paused ||
      !state.lastFailure ||
      reports.length !== names.length
    )
      return;
    const radius = searchRadius();
    if (
      !reports.every(
        (report) => report.map === active.map && ports.contains(active, report, 150, radius),
      )
    )
      return;
    state.lastFailure = null;
    if (state.message?.startsWith("Travel failed:")) state.message = null;
    ports.persist();
  }

  function startPending(
    state: FarmAreaState,
    names: string[],
    hunt: HuntCycle | null,
    now: number,
  ): void {
    const next = state.pending!;
    state.pending = null;
    if (next.focusChange) state.preferredLocation = next.destination;
    if (hunt?.target) {
      hunt.travelCause = next.cause;
      const mission = hunt.missions[hunt.currentIndex];
      if (mission) mission.destination = next.destination;
      ports.startHunt(hunt, next.destination, "Monster Hunt: " + hunt.target, "mission-travel");
    } else {
      ports.authorize(names, next.destination, true);
      ports.startConvoy(
        next.destination,
        "Moving to another farming zone",
        names,
        "farm-relocation",
        next.cause,
      );
    }
    state.lastMoveAt = now;
    state.message = next.reason;
    ports.persist();
  }

  function cancelConflict(state: FarmAreaState, names: string[], hunt: HuntCycle | null, now: number): boolean {
    const next = state.pending!;
    if (next.cause !== 'farming-conflict' || !next.source) return false;
    const busy = state.activity?.[next.source.id!];
    const hold = !busy || busy.until <= now ? 'Competing activity expired' : competitionHold(party, ports, names, next.source, targetIds(hunt), next.actor || busy.actor, now);
    if (!hold) return false;
    state.pending = null; state.message = hold; ports.persist(); return true;
  }
  function busyActor(state: FarmAreaState, active: FarmingArea, now: number): string | null {
    const busy = state.activity?.[active.id!];
    return busy && busy.until > now && (!state.lastMoveAt || now - state.lastMoveAt >= 120000) ? busy.actor : null;
  }
  function processPending(
    state: FarmAreaState,
    names: string[],
    reports: FarmReport[],
    hunt: HuntCycle | null,
    now: number,
  ): void {
    const next = state.pending!;
    if (
      next.revisions &&
      names.some((name) => next.revisions![name] !== ports.intent(name).revision)
    ) {
      state.pending = null;
      ports.persist();
      return;
    }
    if (cancelConflict(state, names, hunt, now)) return;
    if (now < next.at) return;
    const defense = classifyTravelDefense(party, names, now);
    if (defense.state !== "clear") { state.message = defense.message; return; }
    startPending(state, names, hunt, now);
  }

  function relocateBusy(
    state: FarmAreaState,
    active: FarmingArea,
    areas: FarmingArea[],
    names: string[],
    now: number,
  ): void {
    if (!active.shapes && !active.allOf) return;
    const actor = busyActor(state, active, now);
    if (!actor) return;
    const hold = competitionHold(party, ports, names, active, targetIds(party.farmingPolicy === "hunt" ? party.monsterHunt : null), actor, now);
    if (hold) {state.message = hold; return;}
    const next = ports.alternatives(state, areas, active, now)[0];
    if (!next) {
      state.message = "Sharing this zone; no uncontested alternative observed";
      return;
    }
    state.pending = relocation(
      ports,
      names,
      next,
      now,
      "Relocating after " + actor + " fought monsters in this zone",
    );
    Object.assign(state.pending, {cause: "farming-conflict", source: active, actor});
    state.message = state.pending.reason + "; finishing current fights";
    ports.persist();
  }

  function movement(
    state: FarmAreaState,
    hunt: HuntCycle | null,
    ids: string[],
    names: string[],
    reports: FarmReport[],
    areas: FarmingArea[],
    active: FarmingArea,
    now: number,
  ): void {
    const convoy = party.activeConvoy;
    if (workflowOwns(hunt)) return;
    if (recoverFailed(state, hunt, ids, names, areas, now)) return;
    if ([convoy, state.paused].some(Boolean)) return;
    if (state.pending) {
      processPending(state, names, reports, hunt, now);
      return;
    }
    if (hunt && hunt.stage !== "farming") return;
    relocateBusy(state, active, areas, names, now);
    if (state.pending) processPending(state, names, reports, hunt, now);
  }

  function workflowOwns(hunt: HuntCycle | null): boolean {
    return !!hunt && (ports.huntOwns(hunt) || ports.eventOwns(hunt));
  }

  function recoverFailed(
    state: FarmAreaState,
    hunt: HuntCycle | null,
    ids: string[],
    names: string[],
    areas: FarmingArea[],
    now: number,
  ): boolean {
    const convoy = party.activeConvoy;
    if (
      convoy?.phase !== "failed" ||
      ![null, undefined, "monster-hunt", "farm-relocation", "empty-spawn-recovery"].includes(convoy.purpose)
    )
      return false;
    recovery.failed(state, convoy, hunt, ids, names, areas, now);
    return true;
  }

  function observe(
    state: FarmAreaState,
    hunt: HuntCycle | null,
    names: string[],
    ids: string[],
    areas: FarmingArea[],
    active: FarmingArea,
    now: number,
  ): void {
    promoteShape(active, hunt);
    state.active = {
      id: active.id || ports.areaId(active),
      map: active.map,
      x: active.x,
      y: active.y,
      monsterIds: ids,
    };
    const reports = names
      .map((name) => party.statuses[name])
      .filter((status): status is FarmReport => !!status);
    ports.record(state, reports, areas, now);
    if (repairFallback(state, hunt, ids, names, areas, now)) return;
    if (
      names.some((name) => memberBlocked(name, now)) ||
      party.eventReturn ||
      (party.escape && party.escape.stage !== "released")
    )
      return;
    clearArrivedFailure(state, names, reports, active);
    movement(state, hunt, ids, names, reports, areas, active, now);
  }

  function repairFallback(state: FarmAreaState, hunt: HuntCycle | null, ids: string[], names: string[], areas: FarmingArea[], now: number): boolean {
    return party.activeConvoy?.purpose === "empty-spawn-recovery" && recoverFailed(state, hunt, ids, names, areas, now);
  }

  function huntTravelOwns(hunt: HuntCycle | null): boolean {
    return hunt?.stage==='mission-travel' || !!(hunt && party.activeConvoy && ownsHuntRoute(hunt,party.activeConvoy));
  }
  function tick(): void {
    if (ports.rareOwns()) return;
    const now = ports.now();
    if (now - lastTick < 1000) return;
    lastTick = now;
    const state = (party.farmAreaState ||= {}),
      names = ports.members();
    migrate(state);
    const hunt = party.farmingPolicy === "hunt" ? party.monsterHunt : null;
    if (huntTravelOwns(hunt)) return;
    const ids = targetIds(hunt);
    const areas = ports.areas(ids),
      active = ports.resolve(ids, party.location);
    if (!active || !areas.length || !names.length) return;
    observe(state, hunt, names, ids, areas, active, now);
  }
  function focusCompatible(previous: FarmNavigationState['location'], ids: string[]): boolean {
    return !previous?.monsterIds?.length || !ids.length || ids.includes('all') || previous.monsterIds.some(id => ids.includes(id));
  }
  function focusMembersReady(names: string[]): boolean {
    return !!names.length && !names.some(name => ports.intent(name).cancelled);
  }
  function focusChanged(): void {
    if (party.farmingPolicy === 'hunt') return;
    const state = party.farmAreaState ||= {};
    if (state.pending?.focusChange) { state.pending = null; ports.persist(); }
    const previous = party.location, ids = party.monsterFocus || [], names = ports.members();
    // A custom waypoint has no catalog ownership. Compatible focus additions
    // keep their chosen area; only a replaced farming species retires its pin.
    if (!previous || focusCompatible(previous, ids) || !focusMembersReady(names)) return;
    migrate(state);
    const now = ports.now(), areas = ports.areas(ids);
    const destination = ports.alternatives(state, areas, previous, now)[0];
    if (!destination) return;
    // Do not authorize movement here: event attendance and its return still own
    // the same revisions. Ordinary pending relocation waits for those owners,
    // combat and any later manual override before dispatching the new area.
    state.pending = {...relocation(ports, names, destination, now, 'Moving to newly selected farming monsters'), focusChange: true};
    state.message = 'Farming focus changed; waiting for current activity';
    ports.persist();
  }
  return { tick, focusChanged };
}
