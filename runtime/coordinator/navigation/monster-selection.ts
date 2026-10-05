import type { ReturnLocation } from "../events/return-types.ts";
export interface MonsterSelectionState {
  leader: string | null;
  followers: Record<string, boolean>;
  monsterChoices?: { id: string }[] | null;
  statuses: Record<string, { seenAt: number } | undefined>;
  farmAreaState: unknown;
  farmingPolicy: string;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[] | undefined>;
  scatterMonsterTypes: string[];
  scatterEpoch: number;
  partyFarmingMode: string;
  partyFarmingMonsterType: string | null;
  scatterBreakTarget: unknown;
  eventReturn: unknown;
  deferredEventReturns: Record<string, unknown>;
  eventSessions: Record<string, unknown>;
  commands: Record<string, { type: string; manualMonsterOverride?: boolean } | undefined>;
  passiveHunting?: import("./passive-settings.ts").PassiveSettings;
  passiveRareHunts: unknown;
}
export interface MonsterSelectionPorts {
  now(): number;
  validPhoenixOrder(order: unknown): boolean;
  validLocation(id: string, location: unknown): ReturnLocation | null;
  destination(id: string): ReturnLocation | null | undefined;
  release(): void;
  clearHunt(): void;
  members(): string[];
  authorize(names: string[], location: ReturnLocation, shared: boolean): void;
  start(location: ReturnLocation, label: string, names: string[], purpose: string): boolean;
  startPhoenix(order: unknown): void;
  stopPhoenix(reason: string): void;
  persist(): void;
  validPassive(settings: Record<string, unknown>): boolean;
  setPassive(settings: Record<string, unknown>): void;
  invalidate(names: string[], reason: string, shared: boolean): void;
}

export function createMonsterSelection(state: MonsterSelectionState, ports: MonsterSelectionPorts) {
  function reset(id: string, location: ReturnLocation): void {
    ports.release();
    state.farmAreaState = { preferredLocation: location };
    ports.clearHunt();
    state.farmingPolicy = "auto";
    state.monsterFocus = [id];
    delete state.monsterFocusByCharacter[String(state.leader)];
    for (const name of Object.keys(state.followers))
      if (state.followers[name]) delete state.monsterFocusByCharacter[name];
    state.scatterMonsterTypes = [];
    state.scatterEpoch++;
    state.partyFarmingMode = "default";
    state.partyFarmingMonsterType = null;
    state.scatterBreakTarget = null;
    state.eventReturn = null;
    state.deferredEventReturns = {};
    state.eventSessions = {};
  }
  function select(id: string, location: ReturnLocation, phoenixOrder: unknown): string[] | null {
    reset(id, location);
    const names = ports.members();
    ports.authorize(names, location, true);
    // Phoenix fighters split up from wherever they stand; a party convoy would
    // first walk everyone to one spawn together.
    if (id !== "phoenix" && !ports.start(location, "the " + id + " spawn", names, "manual-monster-override"))
      return null;
    for (const name of names) {
      const command = state.commands[name];
      if (command?.type === "party-monster-travel") command.manualMonsterOverride = true;
    }
    if (id === "phoenix") ports.startPhoenix(phoenixOrder);
    else ports.stopPhoenix("New farming selection");
    ports.persist();
    return names;
  }
  return { select };
}
