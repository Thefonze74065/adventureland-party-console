export interface FocusState {
  farmingPolicy?: string;
  monsterHunt?: { participants: string[]; exitMode?: string | null } | null;
  leader: string | null;
  followers: Record<string, boolean>;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[] | undefined>;
  monsterPrioritiesByCharacter: Record<string, Record<string, number> | undefined>;
  monsterSearchRadiusByCharacter: Record<string, number | undefined>;
  scatterMonsterTypes: string[];
  scatterEpoch: number;
  partyFarmingMode: string;
  partyFarmingMonsterType: string | null;
  scatterBreakTarget: unknown;
}
interface FocusPorts {
  focusChanged?(): void;
  members(): string[];
  invalidate(names: string[], reason: string, shared: boolean): void;
}

function searchRadius(focus: string[], requested: unknown, previous: number | undefined): number {
  if (requested !== undefined) return Math.round(Number(requested));
  if (!focus.length) return 400;
  return Number(previous) || 400;
}

/** Focus changes reset scatter selection; clearing focus also invalidates every affected return checkpoint. */
export function createFocusSelection(state: FocusState, ports: FocusPorts) {
  function resetScatter(): void {
    state.scatterMonsterTypes = [];
    state.scatterEpoch++;
    state.partyFarmingMode = "default";
    state.partyFarmingMonsterType = null;
    state.scatterBreakTarget = null;
  }
  function characterFocus(
    name: string,
    focus: string[],
    priorities: Record<string, number> | undefined,
    radius: unknown,
  ): boolean {
    const changed =
      JSON.stringify(state.monsterFocusByCharacter[name] || state.monsterFocus || []) !==
      JSON.stringify(focus);
    state.monsterFocusByCharacter[name] = focus;
    if (name === state.leader) {
      state.monsterFocus = focus.slice();
      for (const follower of Object.keys(state.followers))
        if (state.followers[follower]) delete state.monsterFocusByCharacter[follower];
      delete state.monsterFocusByCharacter[name];
    }
    if (priorities !== undefined) state.monsterPrioritiesByCharacter[name] = priorities;
    state.monsterSearchRadiusByCharacter[name] = searchRadius(
      focus,
      radius,
      state.monsterSearchRadiusByCharacter[name],
    );
    if (changed) resetScatter();
    return changed;
  }
  function huntOwnsFocus(name: string | null): boolean {
    return !!(
      state.farmingPolicy === "hunt" &&
      state.monsterHunt &&
      !state.monsterHunt.exitMode &&
      (!name || state.monsterHunt.participants.includes(name))
    );
  }
  function invalidateClearedFocus(name: string | null): void {
    const shared = !name || name === state.leader;
    ports.invalidate(shared ? ports.members() : [name!], "monster focus cleared", shared);
  }
  function select(
    name: string | null,
    focus: string[],
    priorities: Record<string, number> | undefined,
    radius: unknown,
  ): void {
    let changed: boolean;
    if (name) changed = characterFocus(name, focus, priorities, radius);
    else {
      changed = JSON.stringify(state.monsterFocus || []) !== JSON.stringify(focus);
      state.monsterFocus = focus;
      if (changed) resetScatter();
    }
    if (changed && !huntOwnsFocus(name)) ports.focusChanged?.();
    if (!focus.length && !huntOwnsFocus(name)) {
      invalidateClearedFocus(name);
    }
  }
  return { select };
}
