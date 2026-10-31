import type { PrioritizedJob } from './priority.ts';

const automaticPickups = new Set(['auto upgrade', 'auto compound', 'auto npc sale pickup']);
/** Manual party visits and queued automatic pickups share the same item handoff. */
export function collectsPartyItems(reason: string): boolean {
  return ['party collection', 'marked items', 'inventory cleanout', 'exchange pickup'].includes(reason);
}
export function pickupReason(reason: string, target: string | null | undefined, merchant: string | null | undefined): string {
  return target && target !== merchant && (automaticPickups.has(reason) || reason === 'deconstruction pickup') ? 'marked items' : reason;
}
/** Never apply to a running command: this migration is for pending work only. */
export function normalizePickupJob<T extends PrioritizedJob>(job: T, merchant: string | null | undefined): T {
  const reason = pickupReason(job.reason, job.target, merchant);
  if (reason === job.reason && reason !== 'marked items') return job;
  const normalized = {...job, reason, routine: 'party collection', operationStage: undefined};
  delete normalized.priorityOverride;
  return normalized;
}
function mergeTiming(previous: PrioritizedJob, job: PrioritizedJob): void {
  const age = Math.min(previous.queuedAt ?? Infinity, job.queuedAt ?? Infinity);
  if (Number.isFinite(age)) previous.queuedAt = age;
  previous.retryAt = Math.max(previous.retryAt || 0, job.retryAt || 0);
  mergeRetryBudget(previous, job);
  if (job.realmBlockedReason) previous.realmBlockedReason = job.realmBlockedReason;
}
function mergeRetryBudget(previous: PrioritizedJob, job: PrioritizedJob): void {
  for (const field of ['retryCount', 'rendezvousRetryCount', 'recoveryAttempts'] as const)
    if (job[field] !== undefined) previous[field] = Math.max(previous[field] || 0, job[field] || 0);
}
export function mergePickupJobs<T extends PrioritizedJob>(jobs: T[], merchant: string | null | undefined, current?: PrioritizedJob | null): T[] {
  const collections = new Map<string, T>();
  const result: T[] = [];
  for (const original of jobs) {
    const job = normalizePickupJob(original, merchant);
    if (!['marked items', 'inventory cleanout'].includes(job.reason) || !job.target) { result.push(job); continue; }
    // Cleanouts express current inventory demand, not separate orders. A
    // running cleanout already owns this demand; never rewrite its command.
    if (job.reason === 'inventory cleanout' && current?.reason === job.reason && current.target === job.target) continue;
    const key = job.target + '\n' + job.reason;
    const previous = collections.get(key);
    if (!previous) { collections.set(key, job); result.push(job); continue; }
    mergeTiming(previous, job);
  }
  return result;
}
