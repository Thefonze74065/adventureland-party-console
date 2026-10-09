export interface SlotRollStatistics {
  totalRolls: number;
  sumRolls: number;
  rollsAbove96_3: number;
  perfectRolls: number;
}
/** Observations are evidence for comparison, never a verified private server slot. */
export interface LuckySlotTracking {
  version: 1;
  streamId?: string;
  slots: Record<string, SlotRollStatistics>;
}
export type LuckySlotStreams = Record<string, LuckySlotTracking>;
export type LuckySlotHistory = Record<string, LuckySlotStreams>;
export function mergeSlotStream(previous: LuckySlotTracking, incoming: LuckySlotTracking): boolean {
  let changed = false;
  for (const [slot, stats] of Object.entries(incoming.slots)) {
    const old = previous.slots[slot];
    if (old && (stats.totalRolls <= old.totalRolls ||
      !(['sumRolls', 'rollsAbove96_3', 'perfectRolls'] as const).every(key => stats[key] >= old[key]))) continue;
    previous.slots[slot] = {...stats};
    changed = true;
  }
  return changed;
}
export const emptyRolls = (): SlotRollStatistics => ({totalRolls: 0, sumRolls: 0, rollsAbove96_3: 0, perfectRolls: 0});
export function validSlotStatistics(value: unknown): value is SlotRollStatistics {
  if (!value || typeof value !== 'object') return false;
  const stats = value as SlotRollStatistics;
  return Number.isSafeInteger(stats.totalRolls) && stats.totalRolls > 0 &&
    Number.isFinite(stats.sumRolls) && stats.sumRolls >= 0 && stats.sumRolls < stats.totalRolls &&
    [stats.rollsAbove96_3, stats.perfectRolls].every(n => Number.isSafeInteger(n) && n >= 0 && n <= stats.totalRolls) &&
    stats.rollsAbove96_3 + stats.perfectRolls <= stats.totalRolls;
}
export function normalizeSlotTracking(raw: unknown): LuckySlotTracking {
  const result: LuckySlotTracking = {version: 1, slots: {}};
  if (!raw || typeof raw !== 'object' || !('slots' in raw) || !raw.slots || typeof raw.slots !== 'object') return result;
  result.streamId = readStreamId(raw);
  for (const [slot, stats] of Object.entries(raw.slots)) {
    if (/^(?:[0-9]|[1-3][0-9]|4[01])$/.test(slot) && validSlotStatistics(stats)) result.slots[slot] = {...stats};
  }
  return result;
}
function readStreamId(raw: object): string | undefined {
  return 'streamId' in raw && typeof raw.streamId === 'string' && /^[a-z0-9]{1,30}-[a-z0-9-]{1,60}$/.test(raw.streamId) ? raw.streamId : undefined;
}
/** Independent durable client streams prevent replays and native/headless moves
 * from either double-counting old rolls or dropping another client's evidence. */
export function aggregateSlotTracking(streams: LuckySlotStreams = {}, local?: LuckySlotTracking): LuckySlotTracking {
  const combined = {...streams};
  if (local?.streamId) {
    const merged = normalizeSlotTracking(combined[local.streamId]);
    mergeSlotStream(merged, local);
    combined[local.streamId] = merged;
  }
  const slots: LuckySlotTracking['slots'] = {};
  for (const stream of Object.values(combined)) for (const [slot, stats] of Object.entries(stream.slots)) {
    const total = slots[slot] ??= emptyRolls();
    for (const key of ['totalRolls', 'sumRolls', 'rollsAbove96_3', 'perfectRolls'] as const) total[key] += stats[key];
  }
  return {version: 1, slots};
}
// Source: kaansoral/adventureland_mongodb node/server.js, upgrade handler.
// 60%: max(U/10000, 0.975*R - 0.012), otherwise uniform R.
// q_data exposes floor(R*10000), so the >0.963 bucket starts at 0.9631.
const normal = [0.0001, 0.0369, 0.963];
const luckyZero = 0.4 * 0.0001 + 0.6 * (0.0121 / 0.975);
const luckyHigh = 0.4 * 0.0369;
const lucky = [luckyZero, luckyHigh, 1 - luckyZero - luckyHigh];
export function slotLogEvidence(stats?: SlotRollStatistics): number {
  if (!stats) return 0;
  const counts = [stats.perfectRolls, stats.rollsAbove96_3, stats.totalRolls - stats.perfectRolls - stats.rollsAbove96_3];
  return counts.reduce((sum, count, index) => sum + count * Math.log(lucky[index]! / normal[index]!), 0);
}
function slotPosterior(tracking: LuckySlotTracking) {
  const ranked = Array.from({length: 42}, (_, slot) => ({slot, score: slotLogEvidence(tracking.slots[slot]), samples: tracking.slots[slot]?.totalRolls || 0}))
    .sort((a, b) => b.score - a.score || a.samples - b.samples || a.slot - b.slot);
  const best = ranked[0]!;
  const denominator = ranked.reduce((sum, entry) => sum + Math.exp(entry.score - best.score), 0);
  return ranked.map(entry => {
    const probability = Math.exp(entry.score - best.score) / denominator;
    const eliminationConfidence = 1 - probability;
    return {...entry, probability, eliminationConfidence,
      ruledOut: entry.samples >= 100 && eliminationConfidence >= 0.999};
  });
}
/** Probability this position is ordinary under the same 42-way joint model.
 * The per-position threshold is not a confidence bound for the eliminated set. */
export function slotEliminationConfidence(tracking: LuckySlotTracking, slot: number): number {
  return slotPosterior(tracking).find(entry => entry.slot === slot)?.eliminationConfidence ?? 0;
}
export function luckySlotSearch(tracking: LuckySlotTracking) {
  const ranked = slotPosterior(tracking);
  const best = ranked[0]!;
  const confidence = best.probability;
  const total = ranked.reduce((sum, entry) => sum + entry.samples, 0);
  const inferred = confidence >= 0.999 && best.samples >= 100;
  const remaining = ranked.filter(entry => !entry.ruledOut);
  const candidates = remaining.length ? remaining : ranked;
  const nextSlot = inferred ? best.slot : [...candidates].sort((a, b) => a.samples - b.samples || a.slot - b.slot)[0]!.slot;
  return {slot: total ? best.slot : null, confidence, samples: best.samples, total,
    inferred, nextSlot, slots: Object.fromEntries(ranked.map(entry => [entry.slot, entry])),
    ruledOutCount: ranked.filter(entry => entry.ruledOut).length};
}
