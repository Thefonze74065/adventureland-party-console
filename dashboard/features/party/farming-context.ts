import type { PartyState } from "./party-state";

export function farmingContext(state: PartyState, name: string) {
  const followingLeader = state.leader && state.leader !== name && state.followers?.[name]
    ? state.leader : undefined;
  const owner = followingLeader || name;
  const personal = state.farmingProfiles?.[name];
  const effective = state.farmingProfiles?.[owner];
  const legacy = owner === state.leader;
  return {
    farmArea: effective?.farmAreaState || (legacy ? state.farmAreaState : undefined),
    owner,
    followingLeader,
    savedMode: personal?.farmingPolicy || (name === state.leader ? state.farmingPolicy : undefined) || "auto",
    effectiveMode: effective?.farmingPolicy || (legacy ? state.farmingPolicy : undefined) || "auto",
    frankyRoutine: effective?.encounterRoutines?.franky || (legacy ? state.encounterRoutines?.franky : undefined) || "auto",
    frankyAutoDeathLimit: effective?.encounterAutoDeathLimits?.franky ?? (legacy ? state.encounterAutoDeathLimits?.franky : undefined) ?? 3,
    frankyAutoDeaths: effective?.encounterAutoDeaths?.franky ?? (legacy ? state.encounterAutoDeaths?.franky : undefined) ?? 0,
    halloweenRoutine: effective?.encounterRoutines?.halloween || "auto",
    halloweenAutoDeathLimit: effective?.encounterAutoDeathLimits?.halloween ?? 3,
    halloweenAutoDeaths: effective?.encounterAutoDeaths?.halloween ?? 0,
    blacklist: effective?.huntBlacklist || (legacy ? state.huntBlacklist : undefined) || {},
    settings: effective?.huntSettings || (legacy ? state.huntSettings : undefined),
    hunt: effective?.monsterHunt ?? (legacy ? state.monsterHunt : null),
  };
}
