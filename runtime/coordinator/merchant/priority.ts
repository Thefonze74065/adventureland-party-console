import { migrateRoutinePriorities, routineFor } from './routines.ts';
export interface PrioritizedJob {
  autoExchangeKeys?: string[];
  realmBlockedReason?: string;
  reason: string;
  manual?: boolean;
  routine?: string;

  target?: string | null;
  bidItemId?: string;
  priorityOverride?: number;
  queuedAt?: number;
  retryAt?: number;
  blockedOnBankboi?: boolean;
}

export interface PriorityPolicy {
  routines: Readonly<Record<string, number>>;
  bids: Readonly<Record<string, { priorityOverride?: number }>>;
  /** True only for a merchant retrieval from occupied outbound staging. */
  completesStorageHandoff(job: PrioritizedJob): boolean;
}

const reasonAliases: Readonly<Record<string, string>> = {
  "Ponty purchases": "stand bid purchases",
  "marked items": "party collection",
};

export function merchantRoutinePriority(
  priorities: Readonly<Record<string, number>>,
  reason: string,
): number {
  const value = Number(priorities[reasonAliases[reason] || reason]);
  return Number.isInteger(value) ? Math.max(0, Math.min(100, value)) : 50;
}

function validOverride(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

export function merchantJobPriority(job: PrioritizedJob, policy: PriorityPolicy): number {
  // An outbound handoff must release staging before optional merchant work.
  if (policy.completesStorageHandoff(job)) return 101;
  if (validOverride(job.priorityOverride)) return job.priorityOverride;
  const override = job.manual !== true && job.bidItemId ? policy.bids[job.bidItemId]?.priorityOverride : undefined;
  return validOverride(override) ? override : merchantRoutinePriority(migrateRoutinePriorities(policy.routines), routineFor(job));
}

export function stampMerchantJob<T extends PrioritizedJob>(
  job: T,
  priority: (job: PrioritizedJob) => number,
  now: number,
) {
  const normalized =
    job.reason === "merchant luck exchange"
      ? { ...job, reason: "merchant luck", expandLuckCluster: false, castMerchantLuck: true }
      : job;
  return {
    ...normalized,
    queuedAt: Number(normalized.queuedAt) || now,
    priority: priority(normalized),
  };
}

export interface QueueSelection {
  now: number;
  priority(job: PrioritizedJob): number;
  capacityBlocked(job: PrioritizedJob): boolean;
  collectionReady(job: PrioritizedJob): boolean;
}

export function merchantJobReady(job: PrioritizedJob, policy: QueueSelection): boolean {
  return (
    !job.realmBlockedReason &&
    Number(job.retryAt || 0) <= policy.now &&
    !job.blockedOnBankboi &&
    !policy.capacityBlocked(job) &&
    policy.collectionReady(job)
  );
}

function precedes(
  candidate: PrioritizedJob,
  selected: PrioritizedJob,
  policy: QueueSelection,
): boolean {
  const difference = policy.priority(candidate) - policy.priority(selected);
  return (
    difference > 0 || (difference === 0 && Number(candidate.queuedAt) < Number(selected.queuedAt))
  );
}

/** Returns an index, leaving dequeueing and persistence to the queue owner. */
export function selectMerchantJob(
  queue: readonly PrioritizedJob[],
  policy: QueueSelection,
): number | null {
  let selected: number | null = null;
  queue.forEach((job, index) => {
    if (!merchantJobReady(job, policy)) return;
    if (selected === null || precedes(job, queue[selected], policy)) selected = index;
  });
  return selected;
}

