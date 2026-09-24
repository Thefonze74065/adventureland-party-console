import { coordinatorHuntParticipants } from "./controls.ts";
import type { HuntCycle, HuntTickState } from "./contracts.ts";

export function currentHuntParty(state: HuntTickState, now: number): string[] {
  return coordinatorHuntParticipants(state, () => now, () =>
    Object.keys(state.statuses).filter(name => now - (state.statuses[name]?.seenAt || 0) <= 10000));
}

function clearDepartedCommands(hunt: HuntCycle, state: HuntTickState, current: string[]): void {
  for (const name of hunt.participants) {
    const command = state.commands[name];
    if (!current.includes(name) && command?.purpose === "monster-hunt" && command.cycleId === hunt.cycleId)
      delete state.commands[name];
  }
}

function clearDepartedOwner(hunt: HuntCycle): void {
  delete hunt.owner;
  delete hunt.turnIn;
  delete hunt.encounter;
  delete hunt.arrivalHandoff;
  hunt.target = null;
  hunt.missions = [];
  hunt.currentIndex = -1;
}

function resumeCurrentParty(hunt: HuntCycle, ownerLeft: boolean): void {
  if (ownerLeft) clearDepartedOwner(hunt);
  if (!hunt.exitMode && !hunt.turnIn && hunt.stage !== "ended") hunt.stage = "checking-quests";
}

/** Repair saved rosters before stale members can own selection, recovery or travel. */
export function reconcileCurrentHuntParty(
  hunt: HuntCycle, state: HuntTickState, now: number, cancelConvoy: () => void,
): boolean {
  // A requested reload temporarily removes heartbeats. Do not turn that gap into
  // a smaller party and discard the repair convoy (or its terminal failure).
  if (geometryOwnsRoster(state) || communicationOwnsRoster(hunt, state, now)) return false;
  const current = currentHuntParty(state, now);
  // A missing leader report is not evidence that the whole party departed.
  if (!current.includes(state.leader!)) return false;
  const retained = hunt.participants.filter(name => current.includes(name));
  const ownerLeft = [hunt.owner, hunt.turnIn?.owner].some(name => !!name && !current.includes(name));
  if (retained.length === hunt.participants.length && !ownerLeft) return false;
  cancelConvoy();
  hunt.convoyId = null;
  clearDepartedCommands(hunt, state, current);
  hunt.participants = retained;
  if (!retained.includes(state.leader!)) retained.unshift(state.leader!);
  for (const mission of hunt.missions || []) mission.owners = mission.owners.filter(name => current.includes(name));
  resumeCurrentParty(hunt, ownerLeft);
  return true;
}
function geometryOwnsRoster(state: HuntTickState): boolean {
  const convoy=state.activeConvoy;
  return convoy?.geometryRepair?.phase === 'waiting' || convoy?.failureCode === 'geometry-mismatch';
}
function communicationOwnsRoster(hunt: HuntCycle, state: HuntTickState, now: number): boolean {
  const c = state.activeConvoy;
  if (!c || c.id !== hunt.convoyId || c.purpose !== 'monster-hunt') return false;
  if (!hunt.participants.every(n => n === state.leader || state.followers[n])) return false;
  return !!c.communicationHold || hunt.participants.some(n => !state.statuses[n] || now - state.statuses[n]!.seenAt > 3000);
}
