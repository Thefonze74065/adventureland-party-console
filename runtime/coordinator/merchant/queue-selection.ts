import {offeringSupplyReady,offeringCollectionReady,pendingOfferingCollection} from '../inventory/offering-waits.ts';
import { merchantMovementBlocked, type MerchantMovementState } from "./movement-block.ts";
import {
  collectionSlotCount,
  freshCollectionStatus,
  isItemCollection,
  merchantCollectionNearby,
  markedCollectionReady,
} from "./collection.ts";
import { coordinatorMerchantPriority, coordinatorMerchantTransferBlocked } from "./job-policy.ts";
import { selectMerchantJob, stampMerchantJob } from "./priority.ts";
import type { PrioritizedJob } from "./priority.ts";
import type { InventoryEntry, ItemMark } from "../contracts/item.ts";
import type { ObservedPosition } from "../contracts/position.ts";
import { collectionPickups, type PickupState } from './collection-pickups.ts';
import { pickupReason } from './pickup-jobs.ts';
import { bankCollectionReason, type BankCollectionState } from './bank-collection.ts';

interface CollectionState extends PickupState, MerchantMovementState, BankCollectionState {
  merchantCharacter: string | null;
  statuses: Record<string, (ObservedPosition & { items?: (InventoryEntry | null)[] }) | undefined>;
  marked?: Record<string, ItemMark[] | undefined>;
  merchantMarked?: Record<string, ItemMark[] | undefined>;
  itemCollectionThreshold: number;
  upgrades?: Record<string, { slot?: number | string; item?: import('../contracts/item.ts').Item; auto?: boolean; equipped?: boolean }[] | undefined>;
  autoCompounds?: Record<string, {name:string;targetTier?:number;quantity?:number}[] | undefined>;
}
type PriorityState = Parameters<typeof coordinatorMerchantPriority>[0];
interface QueueState<Job extends PrioritizedJob> extends Omit<CollectionState, 'withdrawals'>, PriorityState {
  merchantQueue: Job[];
}

export function coordinatorCollectionSlots(
  state: CollectionState,
  name: string | null | undefined,
  reason = 'marked items',
): number {
  const {bank, keep} = collectionPickups(state, String(name), reason);
  return collectionSlotCount(state.statuses[String(name)]?.items || [], bank.concat(keep));
}

export function coordinatorCollectionNearby(
  state: CollectionState,
  name: string | null | undefined,
  now: () => number,
): boolean {
  return merchantCollectionNearby(
    state.statuses[String(state.merchantCharacter)],
    state.statuses[String(name)],
    now(),
  );
}

function exchangeCollectionReady(state: CollectionState, job: PrioritizedJob, reason: string, now: number): boolean {
  const target = state.statuses[String(job.target)];
  const picks = collectionPickups(state, String(job.target), reason).keep.filter(mark => mark.exchangeJobId === job.exchangeDeliveryId);
  return freshCollectionStatus(target, now) && collectionSlotCount(target?.items || [], picks) > 0;
}

/** A small collection may proceed only when current nearby status makes another trip unnecessary. */
export function coordinatorCollectionReady(
  state: CollectionState,
  job: PrioritizedJob,
  now: () => number,
): boolean {
  if (job.exchangePickupId) return false; // Released only by the matching confirmed handoff.
  if (!offeringCollectionReady(state, job)) return false;
  if (!offeringSupplyReady(state, job)) return false;
  if (merchantMovementBlocked(state, job)) return false;
  if (['bank collection', 'withdrawals', 'auto npc withdrawals'].includes(job.reason)) return bankCollectionReason(state) === job.reason;
  const reason = pickupReason(job.reason, job.target, state.merchantCharacter);
  if (!isItemCollection(reason)) return true;
  if (job.exchangeDeliveryId) return exchangeCollectionReady(state, job, reason, now());
  return markedCollectionReady(
    reason,
    state.statuses[job.target!],
    coordinatorCollectionSlots(state, job.target, reason),
    state.itemCollectionThreshold,
    coordinatorCollectionNearby(state, job.target!, now),
    now(),
  );
}

/** Item marks retain collection intent; an ineligible pickup is not a queued job. */
export function pruneIneligibleCollections<Job extends PrioritizedJob>(
  state: QueueState<Job> & {transferSignatures?: Record<string,string>}, now: () => number,
): boolean {
  const retained = state.merchantQueue.filter(job => {
    if (job.exchangePickupId || job.exchangeDeliveryId || job.offeringSupply || pendingOfferingCollection(state,job)) return true; // A supply wait is durable work, not an ineligible pickup.
    if (merchantMovementBlocked(state,job) || coordinatorCollectionReady(state,job,now)) return true;
    if (state.transferSignatures && job.target) delete state.transferSignatures[job.target];
    return false;
  });
  if (retained.length === state.merchantQueue.length) return false;
  state.merchantQueue = retained;
  return true;
}

/** Remove and stamp only the selected eligible job; retain other blocked work. */
export function takeCoordinatorMerchantJob<Job extends PrioritizedJob>(
  state: QueueState<Job>,
  now: () => number,
) {
  const priority = (job: PrioritizedJob) => coordinatorMerchantPriority(state, job);
  const index = selectMerchantJob(state.merchantQueue, {
    now: now(),
    priority,
    capacityBlocked: (job) => coordinatorMerchantTransferBlocked(state, job),
    collectionReady: (job) => coordinatorCollectionReady(state, job, now),
  });
  return index === null
    ? null
    : stampMerchantJob(state.merchantQueue.splice(index, 1)[0]!, priority, now());
}
