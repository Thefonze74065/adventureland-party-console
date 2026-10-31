import type { ReturnLocation } from "../events/return-types.ts";

export interface NavigationIntent {
  revision: number;
  cancelled: boolean;
  reason?: string;
}

/** Supported persisted selection schema; legacy readers preserve values without rewriting them. */
export interface SavedPartySelection {
  characterLocations?: Record<string, ReturnLocation | undefined> | null;
  navigationIntents?: Record<string, NavigationIntent | undefined> | null;
  location?: ReturnLocation | null;
  leader?: string | null;
  designatedTank?: string | null;
  offTank?: string | null;
  pullMode?: boolean;
  gearSets?: import("../characters/gear-sets.ts").GearSets;
  followers?: Record<string, boolean> | null;
  eventsByCharacter?: Record<string, boolean> | null;
  eventLimitsByCharacter?: Record<string, Record<string, import("../../../dashboard/lib/event-policy.ts").EventLimits>>;
  eventPrioritiesByCharacter?: Record<string, string[]> | null;
  eventSelectionsByCharacter?: Record<string, string[]> | null;
}

export interface FarmingSelections {
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[]>;
  monsterPrioritiesByCharacter: Record<string, Record<string, number>>;
  monsterSearchRadiusByCharacter: Record<string, number>;
  farmingPolicy: string;
  encounterRoutines: Record<string, string>;
  encounterAutoDeathLimits: Record<string, number>;
  encounterAutoDeaths: Record<string, number>;
}

export interface SavedFarmingSelections {
  monsterFocus?: string[] | string | null;
  monsterFocusByCharacter?: FarmingSelections["monsterFocusByCharacter"] | null;
  monsterPrioritiesByCharacter?: FarmingSelections["monsterPrioritiesByCharacter"] | null;
  monsterSearchRadiusByCharacter?: FarmingSelections["monsterSearchRadiusByCharacter"] | null;
  farmingPolicy?: string;
  encounterRoutines?: Record<string, string> | null;
  encounterAutoDeathLimits?: Record<string, number> | null;
  encounterAutoDeaths?: Record<string, number> | null;
}
