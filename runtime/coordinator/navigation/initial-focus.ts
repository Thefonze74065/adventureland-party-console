import type { FarmingSelections, SavedFarmingSelections } from "./selection-contracts.ts";

function focus(settings: SavedFarmingSelections, selections: SavedFarmingSelections): string[] {
  if (Array.isArray(selections.monsterFocus)) return selections.monsterFocus;
  if (Array.isArray(settings.monsterFocus)) return settings.monsterFocus;
  return typeof settings.monsterFocus === "string" ? [settings.monsterFocus] : ["goo"];
}
function pick<T>(selected: T | null | undefined, saved: T | null | undefined, fallback: T): T {
  return selected || saved || fallback;
}
function farmingPolicyOf(settings: SavedFarmingSelections): string {
  return ["auto", "default", "scatter", "hunt"].includes(settings.farmingPolicy!) ? settings.farmingPolicy! : "auto";
}

/** Explicit empty focus arrays remain authoritative across the legacy settings migration. */
export function initialFarmingSelections(
  settings: SavedFarmingSelections,
  selections: SavedFarmingSelections,
): FarmingSelections {
  return {
    monsterFocus: focus(settings, selections),
    monsterFocusByCharacter: pick(selections.monsterFocusByCharacter, settings.monsterFocusByCharacter, {}),
    monsterPrioritiesByCharacter: pick(selections.monsterPrioritiesByCharacter, settings.monsterPrioritiesByCharacter, {}),
    monsterSearchRadiusByCharacter: pick(selections.monsterSearchRadiusByCharacter, settings.monsterSearchRadiusByCharacter, {}),
    farmingPolicy: farmingPolicyOf(settings),
    encounterRoutines: pick(selections.encounterRoutines, settings.encounterRoutines, {}),
    encounterAutoDeathLimits: pick(selections.encounterAutoDeathLimits, settings.encounterAutoDeathLimits, {}),
    encounterAutoDeaths: pick(selections.encounterAutoDeaths, settings.encounterAutoDeaths, {}),
  };
}
