/** User-facing priorities are independent of the executor transport. */
export interface RoutineJob { reason: string; manual?: boolean; bidItemId?: string; routine?: string; order?: unknown; autoExchangeKeys?: string[] }
const purchases = new Set(['stand purchases', 'stand bid purchases', 'ALData marketplace purchases', 'Ponty purchases']);
const aliases: Record<string, string> = {'stand search': 'manual marketplace purchases', 'marked items': 'party collection', 'npc sale pickup': 'npc sales', 'auto npc sale pickup': 'auto npc sales', 'upgrades and compounds': 'manual upgrades'};
function purchaseRoutine(job: RoutineJob): string {
  return job.manual === true || (!job.bidItemId && job.reason !== 'stand bid purchases') ? 'manual marketplace purchases' : 'stand bid purchases';
}
function exchangeRoutine(job: RoutineJob): string {
  return job.autoExchangeKeys?.length ? 'automatic exchange' : 'manual exchange';
}
export function routineFor(job: RoutineJob): string {
  if (job.reason === 'exchange') return exchangeRoutine(job);
  if (job.routine) return job.routine;
  if (purchases.has(job.reason)) return purchaseRoutine(job);
  if (job.reason === 'merchant commerce') return (job.order as {crafts?: unknown[]})?.crafts?.length ? 'manual crafting' : 'manual buying';
  return aliases[job.reason] || job.reason;
}
export function routineEnabled(job: RoutineJob, enabled: Record<string, boolean | undefined>): boolean {
  if (routineFor(job) === 'manual exchange') return true;
  if (job.reason === 'party collection' && job.manual === true) return true;
  return enabled[routineFor(job)] !== false;
}
export function autoUpgradePriority(saved: Record<string, number>): number {
  return saved['manual upgrades'] ?? saved['upgrades and compounds'] ?? 70;
}
export function autoUpgradeEnabled(saved: Record<string, boolean> = {}): boolean {
  return saved['manual upgrades'] ?? saved['upgrades and compounds'] ?? true;
}
export function migrateRoutinePriorities(saved: Record<string, number> = {}): Record<string, number> {
  const { exchange, ...current } = saved;
  return {
    ...exchangePriorities(exchange),
    'manual marketplace purchases': Math.max(saved['stand purchases'] ?? 75, saved['ALData marketplace purchases'] ?? 76),
    'manual upgrades': saved['upgrades and compounds'] ?? 70,
    'auto upgrade': autoUpgradePriority(saved),
    'manual compounds': saved['upgrades and compounds'] ?? 70,
    'manual buying': saved['merchant commerce'] ?? 65,
    'manual crafting': saved['merchant commerce'] ?? 65,
    'auto npc sales': saved['npc sales'] ?? 80,
    ...current,
  };
}
function exchangePriorities(priority: number | undefined): Record<string, number> {
  return { 'manual exchange': priority ?? 67, 'automatic exchange': priority ?? 67 };
}

export function migrateExchangeAutomations(saved: Record<string, boolean> = {}): Record<string, boolean> {
  const { exchange, 'manual exchange': _manual, ...current } = saved;
  return { 'automatic exchange': exchange ?? true, ...current };
}

export function splitLegacyWork<T extends RoutineJob & {id: string}>(job: T): T[] {
  if (job.reason === 'upgrades and compounds') return [{...job, reason: 'manual upgrades'}, {...job, id: job.id + '-compounds', reason: 'manual compounds'}];
  const order = job.order as {buys?: unknown[]; crafts?: unknown[]} | undefined;
  if (job.reason !== 'merchant commerce' || !order?.buys?.length || !order.crafts?.length) return [job];
  return [{...job, order: {...order, buys: []}, routine: 'manual crafting'},
    {...job, id: job.id + '-buy', routine: 'manual buying', blockedOnBankboi: false, order: {...order, crafts: [], sources: {}, bank: [], storage: [], requirements: [], materialBuys: []}}];
}
