import {recordHuntFailure} from "./settings.ts";
import { legacyCompletionFailure } from '../navigation/communication-recovery.ts';
import * as policy from "../../hunt/policy.ts";
import type { HuntConvoy, HuntCycle, HuntTickPorts, HuntTickState } from "./contracts.ts";

function returnLeg(convoy: HuntConvoy): string {
  return convoy.returnLegs
    ? "leg " +
        (convoy.legIndex + 1) +
        "/" +
        convoy.returnLegs.length +
        " (" +
        convoy.returnLegs[convoy.legIndex]!.type +
        "), "
    : "";
}

export function createHuntRecovery(state: HuntTickState, ports: HuntTickPorts) {
  function preparationMessage(convoy: HuntConvoy): string {
    if(convoy.returnTown?.walking)return '; walking out of '+convoy.returnTown.map+'; Town available again on the next map';
    const count=convoy.returnTown?.interruptions;
    const town=count ? '; Town interrupted '+count+'/3 times on '+convoy.returnTown!.map : '';
    return town+(convoy.phase === 'shared-prepare' && convoy.preparationBlocker ? '; ' + convoy.preparationBlocker : '');
  }
  function cancelled(hunt: HuntCycle): boolean {
    return hunt.participants.some((name) => ports.intent(name).cancelled);
  }

  function failedReturn(hunt: HuntCycle): void {
    if (cancelled(hunt)) {
      hunt.stage = "ended";
      hunt.exitMode = null;
      hunt.message = "Hunt ended; return cancelled by manual navigation";
      ports.persist();
    } else ports.finishFailed(hunt);
  }

  function reconcile(hunt: HuntCycle): boolean {
    if (!policy.needsReconcile(hunt, state.leader!)) return false;
    ports.cancelHuntConvoy();
    hunt.convoyId = null;
    hunt.owner = state.leader!;
    hunt.policyVersion = 3;
    hunt.missions = [];
    hunt.currentIndex = -1;
    hunt.target = null;
    hunt.stage = "checking-quests";
    hunt.waitForExpiry = false;
    hunt.pickupPending = false;
    ports.prepare(hunt);
    ports.persist();
    return true;
  }

  function retryBlocked(hunt: HuntCycle): boolean {
    const convoy = state.activeConvoy!;
    if (state.escape && state.escape.stage !== "released") return true;
    return hunt.participants.some((name) => {
      const command = state.commands[name];
      return (
        (command && command.convoyId !== convoy.id) ||
        (convoy.expected?.[name] && convoy.expected[name].revision !== ports.intent(name).revision)
      );
    });
  }

  function retry(hunt: HuntCycle): boolean {
    if (communicationBlocksRetry()) return false;
    if (
      !policy.retryReturn(hunt, state.activeConvoy, ports.now()) ||
      !ports.fresh(hunt) ||
      cancelled(hunt)
    )
      return false;
    if (retryBlocked(hunt)) return true;
    if(state.activeConvoy!.returnTown)hunt.returnTown=state.activeConvoy!.returnTown;
    hunt.returnNativeFallback ||= !!state.activeConvoy!.nativeFallback;
    hunt.returnRetries = (hunt.returnRetries || 0) + 1;
    hunt.returnRetryAt = ports.now();
    ports.cancelHuntConvoy();
    hunt.convoyId = null;
    ports.start(hunt, state.monsterHunterLocation, "Resuming Monster Hunt turn-in", "returning");
    ports.persist();
    return true;
  }

  function returnMessage(hunt: HuntCycle): void {
    const convoy = state.activeConvoy;
    if (hunt.stage !== "returning" || !convoy) return;
    if (convoy.communicationHold) {
      hunt.message = convoy.failure || convoy.communicationHold.reason;
      return;
    }
    describeReturn(hunt,convoy);
  }
  function communicationBlocksRetry(): boolean {
    const c = state.activeConvoy;
    return !!c && (!!c.communicationHold || legacyCompletionFailure(c));
  }
  function describeReturn(hunt: HuntCycle, convoy: HuntConvoy): void {
    if (convoy.geometryRepair?.phase === 'waiting') {
      hunt.message='Returning to Daisy: repairing shared-route geometry; waiting for one runtime reload';
      return;
    }
    if (convoy.phase === "failed") {
      hunt.message =
        "Daisy return held" +
        ((hunt.returnRetries || 0) >= 3 ? " after three retries" : "; awaiting recovery") +
        ": " +
        convoy.failure;
    } else if (convoy.returnRouting) {
      const blockers =
        convoy.blockerSummary && Object.keys(convoy.blockers || {}).length
          ? "; " + convoy.blockerSummary
          : "";
      hunt.message = "Returning to Daisy: " + returnLeg(convoy) + convoy.phase +
        preparationMessage(convoy) + blockers;
    }
  }

  function blacklist(hunt: HuntCycle, deaths: string[]): boolean {
    if (!hunt.target) return false;
    if (!recordHuntFailure(state, hunt.target, 'deaths', deaths.length, ports.now())) return false;
    const entry = state.huntBlacklist![hunt.target]!;
    entry.characters = deaths;
    entry.lastDeathAt = ports.now();
    const mission = hunt.missions[hunt.currentIndex];
    if (mission) mission.skipped = true;
    hunt.skipAfterDeath = true;
    return true;
  }

  function deaths(hunt: HuntCycle): void {
    hunt.eventTrips = state.huntEventTrips;
    const names = ports.recordDeaths(hunt);
    if (!names.length) return;
    if (state.farmAreaState) {
      state.farmAreaState.pending = null;
      state.farmAreaState.paused = false;
    }
    const blacklisted = blacklist(hunt, names);
    ports.cancelHuntConvoy();
    hunt.convoyId = null;
    if (!blacklisted) {
      hunt.recovering = true;
      if (hunt.target) hunt.stage = "farming";
      hunt.message = "Recovering after a party death; continuing the current Hunt";
      ports.persist();
      return;
    }
    if (hunt.target) {
      hunt.stage = "blacklist-retreat";
      hunt.recovering = false;
    }
    hunt.message =
      "Blacklisted " +
      hunt.target +
      " after a party death; waiting for respawn before selecting the next quest";
    ports.persist();
  }

  function releaseFallback(hunt: HuntCycle): void {
    // Selecting Hunt supersedes its normal-farming fallback. The fallback may
    // have been held by combat while the new Hunt was created; it is not an event.
    const convoy = state.activeConvoy;
    if (
      state.farmingPolicy === "hunt" &&
      !hunt.exitMode &&
      !cancelled(hunt) &&
      (convoy?.purpose === "hunt-fallback" ||
        (!convoy?.purpose && convoy?.label === "the leader's configured farming focus"))
    ) {
      ports.cancelConvoy();
      hunt.convoyId = null;
    }
  }
  function eventPauseMessage(): string {
    const convoy=state.activeConvoy;
    if (convoy?.geometryRepair?.phase === 'waiting') return 'Repairing shared-route geometry; waiting for one runtime reload';
    if (convoy?.phase === 'failed') return 'Travel held: ' + convoy.failure;
    return eventReturnMessage();
  }
  function eventReturnMessage(): string {
    const recovery = state.eventReturn as { event?: string; pending?: string[] } | null;
    if (!recovery)
      return "Waiting for " + (state.activeConvoy?.purpose || "anniversary") + " travel to finish";
    const pending = recovery.pending?.length
      ? recovery.pending.join(", ") + " leaving event"
      : "waiting for farming-area arrival";
    return "Returning from " + recovery.event + ": " + pending;
  }
  function pause(hunt: HuntCycle): boolean {
    releaseFallback(hunt);
    if (policy.eventOwnsTravel(hunt, state)) {
      if (hunt.stage !== "paused-event") hunt.resumeStage = hunt.stage;
      hunt.stage = "paused-event";
      hunt.message = eventPauseMessage();
      ports.cancelHuntConvoy();
      hunt.convoyId = null;
      return true;
    }
    if (state.farmAreaState?.paused || state.farmAreaState?.pending) {
      hunt.message=state.farmAreaState.message || 'Hunt waiting for farming travel recovery';
      return true;
    }
    if (!cancelled(hunt)) return false;
    ports.cancelHuntConvoy();
    delete hunt.arrivalHandoff;
    hunt.convoyId = null;
    hunt.message = "Hunt movement is paused; select Hunt again to resume";
    return true;
  }

  function retreatBlocked(hunt: HuntCycle): boolean {
    return (
      !!state.eventReturn ||
      hunt.participants.some((name) => {
        const status = state.statuses[name];
        return (
          !status || ports.now() - status.seenAt > 10000 || status.activeEvent || status.joinedEvent
        );
      })
    );
  }

  function retreat(hunt: HuntCycle): boolean {
    if (hunt.stage !== "blacklist-retreat" && !(hunt.target && state.huntBlacklist?.[hunt.target]))
      return false;
    if (!retreatBlocked(hunt)) {
      ports.buildMissions(hunt);
      ports.advance(hunt);
    }
    return true;
  }
  return { failedReturn, reconcile, retry, returnMessage, deaths, pause, retreat };
}
