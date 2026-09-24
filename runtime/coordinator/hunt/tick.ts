import {observeHuntExpiry} from "./expiry.ts";
import * as policy from "../../hunt/policy.ts";
import type { HuntCycle, HuntTickPorts, HuntTickState } from "./contracts.ts";
import { createHuntRecovery } from "./recovery.ts";
import { createHuntParticipants } from "./participants.ts";
import { createHuntTravel } from "./travel.ts";
import { huntLootPending } from "./loot.ts";
import { stepHuntBackup } from "./backup.ts";
import { recoverHuntFarmWalk } from "./farm-walk.ts";
import { reconcileCurrentHuntParty } from "./current-party.ts";

/** Keeps turn-in ownership ahead of optional event, farming, and participant changes. */
export function createHuntTick(state: HuntTickState, ports: HuntTickPorts) {
  const recovery = createHuntRecovery(state, ports);
  const participants = createHuntParticipants(state, ports);
  const travel = createHuntTravel(state, ports);
  function reconcileOwnership(hunt: HuntCycle): boolean {
    if (ports.ownsTravel(hunt) && !hunt.turnIn) policy.beginTurnIn(hunt, state.leader!);
    if (!ports.ownsTravel(hunt) && policy.eventsPending(hunt, state.statuses, ports.now()))
      return true;
    return recovery.reconcile(hunt) || recovery.retry(hunt);
  }
  function advance(hunt: HuntCycle): void {
    if (stepHuntBackup(hunt, state, ports)) return;
    // Install the barrier before shouldReturn/convoy ownership can win the race.
    if (canCollectLoot() && huntLootPending(hunt, state, ports)) return;
    if (hunt.stage === "batch-loot") {
      prepareAfterBatchLoot(hunt);
      return;
    }
    if (reconcileOwnership(hunt)) return;
    recovery.returnMessage(hunt);
    recovery.deaths(hunt);
    advanceAfterDeaths(hunt);
  }
  function canCollectLoot(): boolean {
    return (
      (!state.combatRecovery || ["complete", "cancelled"].includes(state.combatRecovery.phase)) &&
      (!state.escape || state.escape.stage === "released")
    );
  }
  function memberBlocksBatch(hunt: HuntCycle): boolean {
    return hunt.participants.some(
      (n) =>
        ports.intent(n).cancelled ||
        state.statuses[n]?.activeEvent ||
        state.statuses[n]?.joinedEvent,
    );
  }
  function prepareAfterBatchLoot(hunt: HuntCycle): void {
    if (hunt.loot?.complete && ports.fresh(hunt) && !state.eventReturn && !memberBlocksBatch(hunt))
      ports.prepare(hunt);
  }
  function advanceAfterDeaths(hunt: HuntCycle): void {
    if (state.combatRecovery && !["complete", "cancelled"].includes(state.combatRecovery.phase)) {
      hunt.message = state.combatRecovery.reason || "Recovering after party death";
      return;
    }
    if (recoverHuntFarmWalk(hunt, state, ports)) return;
    if (recovery.pause(hunt) || hunt.participants.some((name) => state.statuses[name]?.rip)) return;
    if (hunt.stage === "checking-quests") {
      ports.prepare(hunt);
      return;
    }
    if (recovery.retreat(hunt) || !participants.reconcile(hunt)) return;
    travel.step(hunt);
  }
  function tick(): void {
    if (ports.rareEncounter()) return;
    if (!enabled()) return;
    const hunt = state.monsterHunt;
    if (!hunt) {
      if (!state.activeConvoy) ports.begin();
      return;
    }
    if (reconcileCurrentHuntParty(hunt, state, ports.now(), () => ports.cancelHuntConvoy())) ports.persist();
    if (communicationPaused(hunt)) return;
    if (hunt.stage === "failed-return") {
      recovery.failedReturn(hunt);
      return;
    }
    if (observeHuntExpiry(state, hunt, ports.now())) ports.persist();
    advance(hunt);
  }
  function communicationPaused(hunt: HuntCycle): boolean {
    if (!state.activeConvoy?.communicationHold || state.activeConvoy.id !== hunt.convoyId) return false;
    recovery.deaths(hunt);
    hunt.message = state.activeConvoy?.failure || 'Waiting for coordinator communication';
    return true;
  }
  function enabled(): boolean {
    return state.farmingPolicy === 'hunt' || !!state.monsterHunt?.exitMode;
  }
  return { tick };
}
