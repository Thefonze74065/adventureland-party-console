import type { ServerToClient_q_data } from 'typed-adventureland';
import { aggregateSlotTracking, emptyRolls, luckySlotSearch, mergeSlotStream, normalizeSlotTracking, type LuckySlotStreams, type LuckySlotTracking } from '../lucky-slot-tracking.ts';

interface Ports { read(): unknown; write(value: unknown): void; now(): number; isUpgradeScroll(name: string): boolean }
// The server reveals decimal digits progressively and can repeat the completed
// roll when success/failure appears. Older game versions also send digit strings.
type RollPacket = Pick<ServerToClient_q_data, 'num' | 'q'> & {
  p: Omit<ServerToClient_q_data['p'], 'nums'> & { nums: (number | string)[] };
};
interface Receipt { slot: number; roll: number; remaining: number; at: number }
function validQueue(value: RollPacket): boolean {
  const queue = value.q?.upgrade;
  return !!queue && !value.q.compound && Number(queue.num) === value.num &&
    Number.isFinite(queue.ms) && Number.isFinite(queue.len);
}
function packet(raw: unknown): RollPacket | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as RollPacket;
  if (!Number.isInteger(value.num) || value.num < 0 || value.num >= 42 ||
      !validQueue(value) || !Array.isArray(value.p?.nums)) return null;
  return value;
}
function duplicate(last: Receipt | null, next: Receipt): boolean {
  return !!last && last.slot === next.slot && last.roll === next.roll && next.remaining <= last.remaining;
}
export function createLuckySlotTracker(ports: Ports) {
  let stored: unknown;
  try { stored = ports.read(); } catch { /* Storage failure must not block upgrades. */ }
  const state = normalizeSlotTracking(stored);
  state.streamId ??= ports.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let streams: LuckySlotStreams = {};
  let last: Receipt | null = null;
  if (stored && typeof stored === 'object' && 'last' in stored) {
    const saved = stored.last as Receipt | null;
    if (saved && [saved.slot, saved.roll, saved.remaining, saved.at].every(Number.isFinite)) last = saved;
  }
  function save() { try { ports.write({ ...state, last }); } catch { /* Keep collecting in memory. */ } }
  save();
  function observe(raw: unknown): boolean {
    const event = packet(raw);
    if (!event || !ports.isUpgradeScroll(event.p.scroll)) return false;
    const digits = event.p.nums;
    if (digits.length < 4) { last = null; save(); return false; }
    if (digits.length !== 4 || !digits.every(n => /^[0-9]$/.test(String(n)))) return false;
    const roll = Number('0.' + [...digits].reverse().join(''));
    const remaining = event.q.upgrade!.ms, at = ports.now();
    const next = { slot: event.num, roll, remaining, at };
    if (duplicate(last, next)) return false;
    last = next;
    const stats = state.slots[event.num] ??= emptyRolls();
    stats.totalRolls++;
    stats.sumRolls += roll;
    if (roll > 0.963) stats.rollsAbove96_3++;
    if (roll === 0) stats.perfectRolls++;
    save();
    return true;
  }
  return { observe, begin: () => { last = null; save(); }, report: (): LuckySlotTracking => JSON.parse(JSON.stringify(state)),
    sync: (history: LuckySlotStreams = {}) => {
      streams = history;
      const own = history[state.streamId!];
      if (own && mergeSlotStream(state, own)) save();
    },
    select: () => {
      try { return luckySlotSearch(aggregateSlotTracking(streams, state)).nextSlot; }
      catch { return null; } // Missing/corrupt discovery data must not block ordinary upgrades.
    } };
}
(globalThis as unknown as { createPartyLuckySlotTracker: typeof createLuckySlotTracker }).createPartyLuckySlotTracker = createLuckySlotTracker;
