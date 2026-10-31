import { routineFor } from './routines.ts';
import { bankStagingReserved } from '../inventory/reserved-cargo.ts';
import { hasMarkedWithdrawals } from './marked-withdrawals.ts';
import { merchantJobPriority } from "./priority.ts";
import type { PrioritizedJob } from "./priority.ts";

interface BankCapacity {
  bankbois?: Record<string, unknown> | null;
  merchantCharacter: string | null;
  bankSnapshot?: { packs?: Record<string, Record<number, unknown> | undefined> } | null;
}
interface PriorityState<Bid extends { priorityOverride?: number }> extends BankCapacity {
  merchantRoutinePriorities: Record<string, number>;
  merchantAutomations?: Record<string, boolean | undefined>;
  standBids?: Record<string, Bid> | null;
  withdrawals: Record<string, { pack?: string; slot?: number; improvement?: string; autoNpcRuleKey?: string }[] | undefined>;
}
interface InventoryCapacity extends BankCapacity {
  statuses: Record<string, { items?: unknown } | undefined>;
}

function completesStorageHandoff<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  job: PrioritizedJob,
): boolean {
  if (!bankStagingReserved(state)) return false;
  if (job.target !== state.merchantCharacter || !["withdrawals", "bank collection", "manual bank exchange", "upgrades and compounds", "manual upgrades", "auto upgrade", "manual compounds", "auto compound"].includes(job.reason)) return false;
  return (state.withdrawals?.[String(state.merchantCharacter)] || []).some(
    (request) =>
      (routineFor(job) === routineFor({reason: request.improvement || "manual bank exchange"}) ||
        ['withdrawals','bank collection'].includes(job.reason) && hasMarkedWithdrawals([request])) &&
      request.pack === "items1" &&
      Number(request.slot) >= 35 &&
      state.bankSnapshot?.packs?.items1?.[Number(request.slot)],
  );
}

/** Outbound staging retrieval outranks optional jobs only while its reserved slot is occupied. */
export function coordinatorMerchantPriority<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  job: PrioritizedJob,
): number {
  const policy = {
    routines: state.merchantRoutinePriorities,
    bids: state.standBids || {},
    completesStorageHandoff: (candidate: PrioritizedJob) => completesStorageHandoff(state, candidate),
  };
  const priority = merchantJobPriority(job, policy);
  // Retrieval is a dependency of the sale. Keep the withdrawal/threshold
  // enable gates intact, but do not let unrelated party work invert priority.
  if (job.target !== state.merchantCharacter || !['withdrawals', 'bank collection'].includes(job.reason) ||
      state.merchantAutomations?.['auto npc sales'] === false ||
      !(state.withdrawals[String(state.merchantCharacter)] || []).some(mark => mark.autoNpcRuleKey && hasMarkedWithdrawals([mark]))) return priority;
  return Math.max(priority, merchantJobPriority({reason: 'auto npc sales'}, policy));
}

export function coordinatorPrioritizedBids<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  reason: string,
): [string, Bid][] {
  return Object.entries(state.standBids || {}).sort(
    ([first], [second]) =>
      coordinatorMerchantPriority(state, { reason, bidItemId: second }) -
      coordinatorMerchantPriority(state, { reason, bidItemId: first }),
  );
}

export function coordinatorMerchantTransferBlocked(
  state: InventoryCapacity,
  job: PrioritizedJob | null | undefined,
): boolean {
  if (
    !job ||
    job.target === state.merchantCharacter ||
    !["marked items", "inventory cleanout", "exchange pickup"].includes(job.reason)
  )
    return false;
  const items = state.statuses[String(state.merchantCharacter)]?.items;
  return Array.isArray(items) && items.filter((entry) => !entry).length <= 3;
}

/** Movement, gold and heartbeat timestamps must not retry a job whose storage capacity is unchanged. */
export function coordinatorMerchantCapacitySignature(
  state: InventoryCapacity,
  name: string | null,
): string {
  return JSON.stringify([
    state.statuses[String(state.merchantCharacter)]?.items || [],
    state.statuses[String(name)]?.items || [],
    state.bankSnapshot?.packs || {},
  ]);
}
