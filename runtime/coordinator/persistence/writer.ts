import type { KeyValueStorage } from "./json-store.ts";
import {
  stateKeys,
  rosterFields,
  bankFields,
  selectionFields,
  selectSnapshot,
  settingsSnapshot,
  historySnapshot,
  authSnapshot,
} from "./snapshots.ts";

type PersistedCoordinator = Parameters<typeof settingsSnapshot>[0] &
  Record<
    (typeof rosterFields)[number] | (typeof bankFields)[number] | (typeof selectionFields)[number],
    unknown
  > & {
    merchantActivity: unknown[];
    combatLogs: Record<string, unknown[]>;
    aldata: Parameters<typeof settingsSnapshot>[0]["aldata"] & Parameters<typeof authSnapshot>[0];
  };

/** Use explicit snapshots so process handles and credentials stay in their intended documents. */
export function createCoordinatorPersistence(
  state: PersistedCoordinator,
  storage: KeyValueStorage,
) {
  let settingsTimer: ReturnType<typeof setTimeout> | undefined;
  function write(key: string, value: unknown): void {
    storage.set(key, structuredClone(value));
  }
  function roster(): void {
    write(stateKeys.roster, selectSnapshot(state, rosterFields));
  }
  function bank(): void {
    write(stateKeys.bank, selectSnapshot(state, bankFields));
  }
  function settings(): void {
    clearTimeout(settingsTimer);
    settingsTimer = undefined;
    write(stateKeys.selections, selectSnapshot(state, selectionFields));
    write(stateKeys.settings, settingsSnapshot(state));
  }
  function history(): void {
    write(stateKeys.history, historySnapshot(state.merchantActivity, state.combatLogs));
  }
  function aldata(): void {
    write(stateKeys.aldata, authSnapshot(state.aldata));
  }
  function scheduleSettings(): void {
    if (settingsTimer) return;
    settingsTimer = setTimeout(settings, 1000);
    settingsTimer.unref();
  }
  function flush(): void {
    if (settingsTimer) settings();
  }
  return { roster, bank, settings, scheduleSettings, flush, history, aldata };
}
