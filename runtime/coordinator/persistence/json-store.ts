export interface KeyValueStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface StoredState<T> {
  key: string;
  decode(value: unknown): T;
  empty(): T;
}

export interface PersistenceLog {
  invalid(key: string, error: unknown): void;
}

/** Serialization is explicit so runtime handles can never accidentally be saved. */
export function createJsonStore(storage: KeyValueStorage, log: PersistenceLog) {
  return {
    read<T>(state: StoredState<T>): T {
      try {
        // New snapshots are plain objects. Preserve legacy JSON.parse coercion
        // for strings, primitives and old storage wrappers with an own toString.
        const value = storage.get(state.key) || "{}";
        return state.decode(value && typeof value === "object" && !Object.hasOwn(value, 'toString')
          ? structuredClone(value) : JSON.parse(value as string));
      } catch (error) {
        log.invalid(state.key, error);
        return state.empty();
      }
    },
    write<T>(state: Pick<StoredState<T>, "key">, snapshot: T): void {
      storage.set(state.key, structuredClone(snapshot));
    },
  };
}
