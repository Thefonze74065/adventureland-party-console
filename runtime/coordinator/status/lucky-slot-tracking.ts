import { normalizeSlotTracking, mergeSlotStream, type LuckySlotHistory } from '../../lucky-slot-tracking.ts';
export interface LuckySlotState {
  luckySlotTracking?: LuckySlotHistory;
  luckyUpgradeSlots?: Record<string, number | null>;
}
export function receiveLuckySlotTracking(state: LuckySlotState, name: string, raw: unknown): boolean {
  const incoming = normalizeSlotTracking(raw);
  if (!incoming.streamId || !Object.keys(incoming.slots).length) return false;
  const history = state.luckySlotTracking ??= {};
  const streams = history[name] ??= {};
  const previous = streams[incoming.streamId] ??= {version: 1, streamId: incoming.streamId, slots: {}};
  return mergeSlotStream(previous, incoming);
}
/** A deleted-and-recreated character (even reusing its name) rolls a new server-side
 * lucky slot (#52); stale discovery evidence and any verified slot must not carry over. */
export function resetLuckySlotTracking(state: LuckySlotState, name: string): boolean {
  const hadTracking = !!state.luckySlotTracking?.[name];
  const hadVerified = state.luckyUpgradeSlots?.[name] !== undefined;
  if (!hadTracking && !hadVerified) return false;
  delete state.luckySlotTracking?.[name];
  delete state.luckyUpgradeSlots?.[name];
  return true;
}
