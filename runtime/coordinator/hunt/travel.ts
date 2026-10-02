import * as policy from "../../hunt/policy.ts";
import type { HuntCycle, HuntStatus, HuntTickPorts, HuntTickState } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import { createHuntEncounter, reconcileHuntDestination } from "./encounter.ts";

export function createHuntTravel(state: HuntTickState, ports: HuntTickPorts) {
  const encounter = createHuntEncounter(state, ports);
  function returnIfDue(hunt: HuntCycle): boolean {
    if (!policy.shouldReturn(hunt, state.leader!, state.statuses)) return false;
    hunt.waitForExpiry = !!policy.quest(hunt, state.leader!, state.statuses)?.count;
    ports.returnToDaisy(hunt);
    return true;
  }

  function combatEvent(hunt: HuntCycle): boolean {
    const active = hunt.participants.some((name) => {
      const status = state.statuses[name];
      return status && (status.activeEvent || status.joinedEvent);
    });
    if (!active || ports.ownsTravel(hunt)) return false;
    const changed = hunt.stage !== "paused-event";
    if (changed) hunt.resumeStage = hunt.stage;
    hunt.stage = "paused-event";
    hunt.message = "Paused for combat event";
    ports.cancelHuntConvoy();
    if (changed) ports.persist();
    return true;
  }

  function resumeEvent(hunt: HuntCycle): void {
    if (hunt.encounter) {
      hunt.stage = "farming";
      encounter.step(hunt);
      ports.persist();
      return;
    }
    if (!ports.fresh(hunt) || returnIfDue(hunt)) return;
    const destination = hunt.target ? ports.destination(hunt) : null;
    if (
      destination &&
      originReached(hunt)
    ) {
      hunt.convoyId = null;
      hunt.stage = "farming";
      hunt.originArrivedAt = ports.now();
      delete hunt.travelCause;
      hunt.message = "Monster Hunt: " + hunt.target;
      ports.persist();
    } else if (destination)
      ports.start(hunt, destination, "Monster Hunt: " + hunt.target, "mission-travel");
    else ports.returnToDaisy(hunt);
  }

  function daisy(hunt: HuntCycle): boolean {
    if (["daisy-sync-travel", "returning"].includes(hunt.stage) && !state.activeConvoy) {
      const arrived = atDaisy(hunt);
      if (!arrived) {
        hunt.convoyId = null;
        ports.start(
          hunt,
          state.monsterHunterLocation,
          hunt.stage === "returning" ? "Monster Hunt turn-in" : "Monster Hunt synchronization",
          hunt.stage,
        );
      } else {
        hunt.convoyId = null;
        hunt.stage = "at-daisy";
        if(hunt.travelCheckpoint)hunt.travelCheckpoint.completedAt=ports.now();
        ports.processDaisy(hunt);
      }
      return true;
    }
    if (!["at-daisy", "assigning", "waiting-expiry"].includes(hunt.stage)) return false;
    ports.processDaisy(hunt);
    return true;
  }

  function atDaisy(hunt: HuntCycle): boolean {
    const destination = state.monsterHunterLocation;
    if (!destination) return false;
    return hunt.participants.every(name => {
      const s = state.statuses[name];
      return !!s && !s.rip && ports.now()-s.seenAt<=3000 && s.map===destination.map &&
        Math.hypot(s.x-destination.x,s.y-destination.y)<=100;
    });
  }

  function mission(hunt: HuntCycle): boolean {
    if (hunt.stage !== "mission-travel") return false;
    if (state.activeConvoy) {
      retainMissionRoute(hunt);
      return false;
    }
    if (!hunt.originArrivedAt && !originReached(hunt)) {
      const destination = ports.destination(hunt);
      if (destination)
        ports.start(hunt, destination, "Monster Hunt: " + hunt.target, "mission-travel");
      return true;
    }
    hunt.convoyId = null;
    hunt.originArrivedAt = ports.now();
    hunt.stage = "farming";
    delete hunt.travelCause;
    return false;
  }

  function retainMissionRoute(hunt: HuntCycle): void {
    const c = state.activeConvoy;
    if (!c || c.id !== hunt.convoyId || c.purpose !== "monster-hunt" || !hunt.target) return;
    hunt.message=c.defenseReason || (c.phase==='failed' ? 'Hunt travel held: '+c.failure : 'Monster Hunt: '+hunt.target);
    c.combatHandoffAllowed = false;
    c.huntTarget = hunt.target;
    for (const name of hunt.participants) {
      const command = state.commands[name];
      if (command?.convoyId !== c.id) continue;
      command.combatHandoffAllowed = c.combatHandoffAllowed;
      command.huntTarget = hunt.target;
    }
  }

  function memberRecovering(
    status: HuntStatus | undefined,
    destination: ReturnLocation | null | undefined,
  ): boolean {
    return (
      !status ||
      status.rip === true ||
      ports.now() - status.seenAt > 10000 ||
      !!status.farmReunion ||
      !destination ||
      status.map !== destination.map ||
      Math.hypot(status.x - destination.x, status.y - destination.y) > 800
    );
  }

  function recoveryPending(
    hunt: HuntCycle,
    destination: ReturnLocation | null | undefined,
  ): boolean {
    if (!hunt.recovering) return false;
    if (hunt.participants.some((name) => memberRecovering(state.statuses[name], destination)))
      return true;
    hunt.recovering = false;
    hunt.message = "Monster Hunt: " + hunt.target;
    return false;
  }

  function recoverArrival(hunt: HuntCycle, destination: ReturnLocation, leader: HuntStatus): void {
    if (state.combatLogs) {
      (state.combatLogs[String(state.leader)] ||= []).push({
        at: ports.now(),
        type: "navigation",
        message: "Hunt arrival recovery: fresh leader status remains outside the destination",
        details: {
          cycleId: hunt.cycleId,
          missionIndex: hunt.currentIndex,
          map: leader.map,
          positionAgeMs: ports.now() - leader.seenAt,
        },
      });
    }
    hunt.convoyId = null;
    ports.start(hunt, destination, "Monster Hunt: " + hunt.target, "mission-travel");
  }

  function advanceIfFinished(hunt: HuntCycle): void {
    const remaining = policy.quest(hunt, state.leader!, state.statuses)?.remainingMs || 0;
    if (remaining <= 0) {
      hunt.waitForExpiry = false;
      ports.returnToDaisy(hunt);
      return;
    }
    const mission = hunt.missions[hunt.currentIndex];
    const unfinished = mission?.owners.some((name) => {
      const quest = state.statuses[name]?.monsterHunt;
      return quest && quest.id === mission.target && quest.count > 0;
    });
    if (!unfinished) ports.advance(hunt);
  }

  function atTarget(
    destination: ReturnLocation | null | undefined,
    leader: HuntStatus | undefined,
  ): boolean {
    return (
      !!destination &&
      !!leader &&
      leader.map === destination.map &&
      ports.contains(
        destination,
        leader,
        150,
        Number(state.monsterSearchRadiusByCharacter[String(state.leader)]) || 400,
      )
    );
  }

  function confirmArrival(
    hunt: HuntCycle,
    leader: HuntStatus,
    protectedArrival: boolean,
    arrived: boolean,
  ): void {
    if (
      protectedArrival &&
      arrived &&
      hunt.arrivalHandoff &&
      leader.seenAt > hunt.arrivalHandoff.at
    )
      hunt.arrivalHandoff.confirmedAt ||= leader.seenAt;
  }

  function farm(hunt: HuntCycle): void {
    if (hunt.stage !== "farming" || !ports.fresh(hunt)) return;
    if (repairPrematureFarming(hunt)) return;
    hunt.message = "Monster Hunt: " + hunt.target;
    const destination = ports.destination(hunt),
      leader = state.statuses[String(state.leader)]!;
    const arrived = atTarget(destination, leader);
    const handoff = state.commands[String(state.leader)]?.convoyHandoff;
    const protectedArrival = ports.arrivalProtected(hunt, leader, destination);
    confirmArrival(hunt, leader, protectedArrival, arrived);
    if (farmPending(hunt, destination))
      return;
    if (destination && !arrived && !handoff && !protectedArrival) {
      recoverArrival(hunt, destination, leader);
      return;
    }
    advanceIfFinished(hunt);
  }

  function repairPrematureFarming(hunt: HuntCycle): boolean {
    if (hunt.originArrivedAt) return false;
    if (originReached(hunt)) { hunt.originArrivedAt = ports.now(); return false; }
    const destination = ports.destination(hunt);
    if (destination) ports.start(hunt, destination, "Monster Hunt: " + hunt.target, "mission-travel");
    return true;
  }

  function farmPending(hunt: HuntCycle, destination: ReturnLocation | null | undefined): boolean {
    return recoveryPending(hunt, destination) || returnIfDue(hunt) || ports.partyFighting(hunt);
  }

  function originReached(hunt: HuntCycle): boolean {
    const destination = ports.destination(hunt);
    return !!destination && hunt.participants.every(name => {
      const s = state.statuses[name];
      return !!s && !s.rip && s.hp !== 0 && ports.now() - s.seenAt <= 3000 &&
        s.seenAt <= ports.now() + 500 && s.map === destination.map &&
        String(s.in ?? s.map) === String(destination.in ?? destination.map) &&
        memberInside(destination, s, name);
    });
  }

  function memberInside(destination: ReturnLocation, s: HuntStatus, name: string): boolean {
    return s.server === state.statuses[String(state.leader)]?.server &&
      ports.contains(destination, s, 0, Number(state.monsterSearchRadiusByCharacter[name]) || 400);
  }

  function step(hunt: HuntCycle): void {
    if (temporaryStop(hunt)) return;
    if (combatEvent(hunt) || state.eventReturn) return;
    if (returnFromMission(hunt)) return;
    if (hunt.stage === "paused-event") { resumeEvent(hunt); return; }
    if (reconcileDestination(hunt)) return;
    if (daisy(hunt) || mission(hunt)) return;
    farm(hunt);
  }
  function returnFromMission(hunt: HuntCycle): boolean {
    return ["mission-travel", "farming"].includes(hunt.stage) && ports.fresh(hunt) && returnIfDue(hunt);
  }
  function reconcileDestination(hunt: HuntCycle): boolean {
    return ["mission-travel", "farming"].includes(hunt.stage) && reconcileHuntDestination(hunt, state, ports);
  }
  function temporaryStop(hunt: HuntCycle): boolean {
    if (!hunt.encounter) return false;
    if (combatEvent(hunt) || state.eventReturn) { encounter.pause(); return true; }
    if (hunt.stage === "paused-event") { resumeEvent(hunt); return true; }
    return encounter.step(hunt);
  }
  function arrivalOwned(hunt:HuntCycle):boolean {
    const c=state.activeConvoy;
    if(!c)return true;
    if(c.routeRecovery?.stage==='relocation')return false;
    if(c.id!==hunt.convoyId || c.purpose!=='monster-hunt')return false;
    return hunt.participants.every(n=> {
      const expected=c.expected?.[n]?.revision;
      return expected===undefined || expected===ports.intent(n).revision;
    });
  }
  function reconcileArrival(hunt: HuntCycle): void {
    if(hunt.stage!=='mission-travel' || state.activeConvoy || state.eventReturn || !hunt.target || !originReached(hunt))return;
    if(!arrivalOwned(hunt))return;
    if(hunt.participants.some(n=>ports.intent(n).cancelled || state.statuses[n]?.activeEvent || state.statuses[n]?.joinedEvent))return;
    hunt.originArrivedAt ||= ports.now();
    hunt.stage='farming';
    delete hunt.travelCause;
    hunt.message='Monster Hunt: '+hunt.target;
    ports.persist();
  }
  return { step, reconcileArrival, combatEvent };
}
