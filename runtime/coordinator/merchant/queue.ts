import type { PrioritizedJob } from "./priority.ts";
import { mergePickupJobs, pickupReason } from './pickup-jobs.ts';
import { isItemCollection } from './collection.ts';

export interface MerchantJob extends PrioritizedJob {
  id: string;
  target: string | null;
  inPlaceStandSync?: boolean;
  priority?: number;
}

export interface ResourceBlock {
  upgradeRecoverySignature?: string;
  capacitySignature?: string;
  bankGold?: number;
  merchantGold?: number;
  error?: string;
}

interface QueueState {
  queue: MerchantJob[];
  current: MerchantJob | null;
  blocks: Record<string, ResourceBlock>;
}

interface QueuePorts {
  upgradeRecoverySignature?(name: string): string;
  collectionReady?(job: PrioritizedJob): boolean;
  enabled?(reason: string): boolean;
  merchant(): string | null;
  bankboi(name: string): boolean;
  capacitySignature(name: string): string;
  gold(): { bank: number; merchant: number };
  nextId(): string;
  now(): number;
  routinePriority(reason: string): number;
  priority(job: PrioritizedJob): number;
  stamp(job: MerchantJob): MerchantJob;
  hasPendingStandInventory(): boolean;
  standInventorySignature?(): string;
  persist(): void;
  dispatch(): void;
  log(message: string, level: "info", details?: unknown): void;
}

/** Owns deduplication, resource-block recovery, and priority promotion. */
export function createMerchantQueue(state: QueueState, ports: QueuePorts) {
  const migrated = mergePickupJobs(state.queue, ports.merchant(), state.current).map(job => ports.stamp(job));
  state.queue.splice(0, state.queue.length, ...migrated);
  let lastStandAttempt: string | undefined;
  let changed = false;
  function resourcesUnchanged(name: string, block: ResourceBlock): boolean {
    if (block.upgradeRecoverySignature !== undefined)
      return !ports.upgradeRecoverySignature || ports.upgradeRecoverySignature(name) === block.upgradeRecoverySignature;
    if (block.capacitySignature !== undefined)
      return ports.capacitySignature(name) === block.capacitySignature;
    const gold = ports.gold();
    return gold.bank === block.bankGold && gold.merchant === block.merchantGold;
  }

  function blocked(name: string, reason: string): boolean {
    const legacy = ["manual upgrades", "auto upgrade", "manual compounds"].includes(reason) ? name + "\nupgrades and compounds" : "";
    const key = state.blocks[name + "\n" + reason] ? name + "\n" + reason : legacy || name + "\n" + reason,
      block = state.blocks[key];
    if (!block) return false;
    if (resourcesUnchanged(name, block)) return true;
    delete state.blocks[key];
    changed = true;
    ports.log("Resources changed; retrying blocked merchant work", "info", {
      target: name,
      reason,
      previousError: block.error,
    });
    return false;
  }

  const separateRoutines = new Set(['exchange pickup', 'deliveries', 'manual upgrades', 'auto upgrade', 'manual compounds', 'auto compound', 'manual buying', 'npc sale pickup', 'auto npc sale pickup', 'npc sales', 'auto npc sales']);
  function sameWork(job: MerchantJob | null, name: string, reason: string): boolean {
    if (!job || job.target !== name) return false;
    if (name === ports.merchant() && ['withdrawals','bank collection','auto npc withdrawals'].includes(reason) && ['withdrawals','bank collection','auto npc withdrawals'].includes(job.reason)) return true;
    if (name === ports.merchant() || separateRoutines.has(reason) || separateRoutines.has(job.reason)) return job.reason === reason;
    return true;
  }

  function promote(index: number, reason: string): void {
    const previous = state.queue[index];
    const higherPriority = ports.routinePriority(reason) > ports.priority(previous);
    const replacesCollection = previous.reason === "marked items" && reason !== "marked items";
    if (!higherPriority && !replacesCollection) return;
    state.queue[index] = ports.stamp({ ...previous, reason, routine: undefined });
    changed = true;
    ports.log("Raised queued merchant work for " + previous.target, "info", {
      from: previous.reason,
      to: reason,
      priority: ports.priority(state.queue[index]),
    });
  }

  function canEnqueue(name:string,reason:string):boolean {
    if (isItemCollection(reason) && ports.collectionReady?.({target:name,reason}) === false) return false;
    if (ports.enabled?.(reason) === false) return false;
    return !blocked(name,reason) && !sameWork(state.current,name,reason);
  }
  function enqueue(name: string, reason: string): void {
    reason = pickupReason(reason, name, ports.merchant());
    if (!canEnqueue(name,reason)) return;
    const index = state.queue.findIndex((job) => sameWork(job, name, reason));
    if (index < 0) {
      state.queue.push(
        ports.stamp({ id: ports.nextId(), target: name, reason, queuedAt: ports.now() }),
      );
      changed = true;
    } else if (name === ports.merchant() && ['withdrawals','bank collection','auto npc withdrawals'].includes(reason) && state.queue[index].reason !== reason) {
      state.queue[index] = ports.stamp({...state.queue[index],reason,routine:undefined});
      changed = true;
    } else if (name !== ports.merchant()) promote(index, reason);
  }

  function queue(names: readonly (string | null | undefined)[], reason = "service"): void {
    if (reason === "upgrades and compounds") { queue(names, "manual upgrades"); queue(names, "manual compounds"); return; }
    if (ports.enabled?.(reason) === false) return;
    changed = false;
    for (const name of new Set(names)) {
      if (name && !ports.bankboi(name)) enqueue(name, reason);
    }
    if (changed) ports.persist();
    ports.dispatch();
  }

  function localStandSync(): boolean {
    const merchant = ports.merchant();
    if (!merchant || !ports.hasPendingStandInventory()) { lastStandAttempt = undefined; return false; }
    const signature = ports.standInventorySignature?.();
    if (signature !== undefined && signature === lastStandAttempt) return false;
    const duplicate = [state.current, ...state.queue].some(
      (job) =>
        job?.target === merchant && job.reason === "stand maintenance" && job.inPlaceStandSync,
    );
    if (duplicate) return false;
    lastStandAttempt = signature;
    state.queue.push(
      ports.stamp({
        id: ports.nextId(),
        target: merchant,
        reason: "stand maintenance",
        inPlaceStandSync: true,
        priorityOverride: 99,
        queuedAt: ports.now(),
      }),
    );
    ports.persist();
    ports.dispatch();
    return true;
  }

  return { queue, localStandSync };
}
