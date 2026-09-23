// Shared singletons for "nothing here yet" fallbacks. Using `data || []`/`data || {}`
// inline allocates a brand-new array/object every render, which defeats React.memo
// and useMemo dependency checks on every consumer even when nothing changed.
const emptyArraySingleton: readonly unknown[] = Object.freeze([]);
const emptyRecordSingleton: Readonly<Record<string, unknown>> = Object.freeze({});

export function emptyArray<T>(): T[] {
  return emptyArraySingleton as T[];
}
export function emptyRecord<T>(): Record<string, T> {
  return emptyRecordSingleton as Record<string, T>;
}
