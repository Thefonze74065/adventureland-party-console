import { normalizeSlotTracking, mergeSlotStream, aggregateSlotTracking, type LuckySlotHistory } from '../../lucky-slot-tracking.ts';
export interface LuckySlotState {
  luckySlotCharacterIds?: Record<string, string>;
  luckySlotTracking?: LuckySlotHistory;
  luckyUpgradeSlots?: Record<string, number | null>;
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, {slot: number; rolls: number}>;
}
function move<T>(map: Record<string, T> | undefined, name: string, previous: string): void {
  if (!map) return;
  if (map[previous] !== undefined) map[name] = map[previous];
  delete map[previous];
}
/** Bind legacy evidence once; subsequent account-ID changes retire all positions. */
function bindIdentity(state: LuckySlotState, name: string, id: string): boolean {
  const identities = state.luckySlotCharacterIds ??= {};
  if (identities[name] === id) return false;
  if (identities[name]) {
    delete state.luckySlotTracking?.[name];
    delete state.luckyUpgradeSlots?.[name];
    delete state.luckySlotLocks?.[name];
    delete state.luckySlotResume?.[name];
  }
  const previous = Object.keys(identities).find(key => key !== name && identities[key] === id);
  if (previous) {
    move(state.luckySlotTracking, name, previous);
    move(state.luckyUpgradeSlots, name, previous);
    move(state.luckySlotLocks, name, previous);
    move(state.luckySlotResume, name, previous);
    delete identities[previous];
  }
  identities[name] = id;
  return true;
}
function mergeTracking(state: LuckySlotState, name: string, raw: unknown): boolean {
  const incoming = normalizeSlotTracking(raw);
  if (!incoming.streamId || !Object.keys(incoming.slots).length) return false;
  const history = state.luckySlotTracking ??= {};
  const streams = history[name] ??= {};
  const previous = streams[incoming.streamId] ??= {version: 1, streamId: incoming.streamId, slots: {}};
  const changed = mergeSlotStream(previous, incoming);
  return releaseResume(state, name, streams) || changed;
}
function releaseResume(state: LuckySlotState, name: string, streams: LuckySlotHistory[string]): boolean {
  const resume = state.luckySlotResume?.[name];
  if (resume && (aggregateSlotTracking(streams).slots[resume.slot]?.totalRolls ?? 0) > resume.rolls) {
    delete state.luckySlotResume![name];
    return true;
  }
  return false;
}
export function receiveLuckySlotTracking(state: LuckySlotState, name: string, raw: unknown, characterId?: string, reportedId?: unknown): boolean {
  const identityChanged = characterId ? bindIdentity(state, name, characterId) : false;
  if (characterId && reportedId !== characterId) return identityChanged;
  return mergeTracking(state, name, raw) || identityChanged;
}
