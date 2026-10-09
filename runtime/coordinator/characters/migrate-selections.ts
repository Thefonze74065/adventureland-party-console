interface SelectionState {
  merchantCharacter: string | null;
  eventSelectionsByCharacter: Record<string, unknown>;
  eventsByCharacter: Record<string, unknown>;
  headlessSlots: (string | null)[];
  bankbois: Record<string, unknown>;
  activeRealm: string;
}

/** Explicit event selections, including empty arrays, override legacy enable flags. */
export function migrateCharacterSelections(
  state: SelectionState,
  workers: Record<string, { realm?: string } | undefined>,
  supportedEvents: readonly string[],
): void {
  for (const name of new Set(
    [...Object.keys(workers), state.merchantCharacter].filter((name): name is string => !!name),
  )) {
    if (Object.prototype.hasOwnProperty.call(state.eventSelectionsByCharacter, name)) continue;
    const otherEvents =
      state.eventsByCharacter[name] && name !== state.merchantCharacter
        // The legacy boolean was saved before these opt-in fights existed.
        ? supportedEvents.filter((id) => id !== "anniversary" && !["slenderman", "mrgreen", "mrpumpkin"].includes(id))
        : [];
    state.eventSelectionsByCharacter[name] = ["anniversary", ...otherEvents];
  }
  for (const name of state.headlessSlots) {
    if (!name || state.bankbois[name]) continue;
    const worker = workers[name];
    if (worker) worker.realm = state.activeRealm;
  }
}
