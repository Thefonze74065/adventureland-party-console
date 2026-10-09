import { buyUpgradeOrder } from './commerce-progress.ts';
import { hasMarkedWithdrawals } from './marked-withdrawals.ts';
import { merchantJobReady } from './priority.ts';
import { splitLegacyWork } from './routines.ts';
import { mergePickupJobs } from './pickup-jobs.ts';
import { batchMarketplaceVisits } from "./marketplace-batch.ts";
import { createPartyRealmCheck, normalizedRealm } from "./party-realm.ts";
import { ownCommandDescription } from "./command-kind.ts";
import { gatheringCastActive } from "./gathering.ts";
import { luckMerchantCommand, ownMerchantCommand, partyMerchantCommand } from "./commands.ts";
import type {
  CommandInputs,
  MarketListing,
  MerchantCommand,
  MerchantWork,
  ServiceStatus,
} from "./work.ts";

interface DispatchState {
  queue: MerchantWork[];
  current: MerchantWork | null;
}
interface AnniversaryControl {
  featured: boolean;
  reserved: boolean;
  kissDue: boolean;
  busy: boolean;
}
export interface DispatchPorts {
  homeBlocked?(): boolean;
  productionPending?(): {id: string; name: string; level: number; kind: string}[];
  eventReserved?(): boolean;
  enabled?(job: MerchantWork): boolean;
  travel?(realm: string): Promise<unknown>;
  headless?(): boolean;
  now(): number;
  nextCommand(): number;
  merchant(): string | null;
  returningHome(): boolean;
  ensureHome(reason: string): boolean;
  routineNeedsHome(reason: string): boolean;
  bankboi(name: string | null): boolean;
  storagePending(): boolean;
  startStorage(): Promise<void>;
  anniversary(): AnniversaryControl;
  forcedStand(): boolean;
  manualEquipmentPending(): boolean;
  gatheringModes(): string[];
  gatheringCooldown(mode: string): number | undefined;
  routinePriority(reason: string): number;
  priority(job: MerchantWork): number;
  capacityBlocked(job: MerchantWork): boolean;
  collectionReady(job: MerchantWork): boolean;
  pick(): MerchantWork | null;
  stamp(job: MerchantWork): MerchantWork;
  status(name: string | null): ServiceStatus | undefined;
  planPonty(
    listings: MarketListing[],
    quantity: number,
    server: string | undefined,
    automatic: boolean,
  ): MarketListing[] | null;
  inputs(): CommandInputs;
  command(name: string | null, command: MerchantCommand): void;
  idle(): void;
  persist(): void;
  log(message: string, level: "info" | "error", details?: unknown): void;
}

/** Assigns one job while preserving storage, event, gathering, and realm ownership. */
export function createMerchantDispatcher(state: DispatchState, ports: DispatchPorts) {
  const realmCheck = createPartyRealmCheck(state, ports);
  let capacityBankAt = -Infinity;
  let productionHold = '';
  let productionProbeAt = -Infinity;
  function clearCollectionCapacity(): boolean {
    if (!state.queue.some(job => ports.capacityBlocked(job))) return false;
    const merchant = ports.merchant()!, work = ports.inputs().work(merchant);
    if (!work.marked.length || ports.now() - capacityBankAt < 60000) return false;
    const existing = state.queue.find(job => job.target === merchant && job.reason === "manual bank exchange");
    if (existing && !ready(existing)) return false;
    capacityBankAt = ports.now();
    if (existing) state.queue = state.queue.filter(job => job !== existing);
    const job = existing || ports.stamp({ id: "capacity-" + ports.nextCommand(), target: merchant, reason: "manual bank exchange", capacityRecovery: true });
    ports.log("Freeing merchant inventory for queued party cleanouts", "info");
    dispatchJob(job);
    return true;
  }
  function reserved(): boolean {
    if (ports.storagePending()) {
      void ports
        .startStorage()
        .catch((error) =>
          ports.log(
            "Bankboi scheduler failed",
            "error",
            error instanceof Error ? error.message : String(error),
          ),
        );
      return true;
    }
    const anniversary = ports.anniversary();
    if (anniversary.featured) {
      ports.idle();
      return true;
    }
    if (anniversary.reserved || anniversary.kissDue || anniversary.busy) return true;
    if (ports.forcedStand()) {
      ports.idle();
      return true;
    }
    return false;
  }

  function ready(job: MerchantWork): boolean {
    const homeError = 'Merchant realm return failed after 3 attempts; manual retry required';
    if (ports.homeBlocked?.() && job.target === ports.merchant() && ports.routineNeedsHome(job.reason)) {
      if (job.realmBlockedReason !== homeError) { job.realmBlockedReason = homeError; ports.persist(); }
      return false;
    }
    if (job.realmBlockedReason === homeError) { delete job.realmBlockedReason; ports.persist(); }
    if (ports.enabled?.(job) === false) return false;
    return merchantJobReady(job, {now: ports.now(), priority: candidate => ports.priority(candidate as MerchantWork),
      capacityBlocked: candidate => ports.capacityBlocked(candidate as MerchantWork), collectionReady: candidate => ports.collectionReady(candidate as MerchantWork)});
  }

  function gatherBefore(readyJobs: readonly MerchantWork[]): boolean {
    const modes = ports
      .gatheringModes()
      .filter((mode) => Number(ports.gatheringCooldown(mode) || 0) <= ports.now())
      .sort((a, b) => ports.routinePriority(b) - ports.routinePriority(a));
    const best = readyJobs.length ? Math.max(...readyJobs.map((job) => ports.priority(job))) : -1;
    if (!modes.length || ports.routinePriority(modes[0]) <= best) return false;
    if (ports.ensureHome("gathering"))
      ports.command(ports.merchant(), {
        id: ports.nextCommand(),
        type: "merchant-gather",
        modes: ports.gatheringModes().slice(),
      });
    return true;
  }

  function batch(job: MerchantWork): void {
    const result = batchMarketplaceVisits(job, state.queue);
    if (!result) return;
    state.queue = result.queue;
    if (!result.batchedOrders) return;
    ports.log(
      "Combined " +
        result.batchedOrders +
        " additional marketplace order" +
        (result.batchedOrders === 1 ? "" : "s") +
        " for the same merchant visit",
      "info",
      {
        sellers: result.sellers,
        listings: result.listingCount,
      },
    );
  }

  function targetStatus(job: MerchantWork): ServiceStatus | null {
    const target = ports.status(job.target),
      merchant = ports.status(ports.merchant());
    if (
      !target ||
      target.seenAt < ports.now() - 10_000 ||
      !merchant ||
      merchant.seenAt < ports.now() - 10_000 ||
      (!ports.travel && normalizedRealm(merchant.server) !== normalizedRealm(target.server))
    ) {
      state.queue.push(ports.stamp(job));
      ports.persist();
      return null;
    }
    return target;
  }

  function planPonty(job: MerchantWork): void {
    if (job.reason !== "Ponty purchases" || job.pontyPlanned) return;
    const quantity =
      job.pontyQuantity ||
      (job.listings || []).reduce((sum, entry) => sum + Number(entry.quantity), 0);
    job.listings =
      ports.planPonty(
        job.pontyCandidates || job.listings || [],
        quantity,
        ports.status(ports.merchant())?.server,
        !job.manual,
      ) || job.listings;
    job.pontyPlanned = true;
  }

  function assign(job: MerchantWork, status: ServiceStatus): void {
    planPonty(job);
    const commandId = ports.nextCommand();
    if (buyUpgradeOrder(job)) {
      job.commerceProgressVersion = 2;
      job.commerceOrderId ||= job.id;
    }
    delete job.pauseReason;
    state.current = {
      ...job,
      commandId,
      phase: "assigned",
      startedAt: ports.now(),
      heartbeatAt: null,
      handoff: null,
    };
    const merchant = ports.merchant(),
      inputs = ports.inputs();
    if (job.reason === "merchant luck" && job.target === merchant) {
      ports.command(merchant, luckMerchantCommand(commandId, job, status, inputs.npcSales));
      ports.log("Merchant dispatched to refresh Merchant's Luck on " + job.target, "info", {
        target: job.target,
      });
    } else if (job.target === merchant) {
      planPonty(job);
      ports.command(merchant, ownMerchantCommand(commandId, job, status, inputs));
      ports.log(ownCommandDescription(job), "info");
    } else {
      ports.command(merchant, partyMerchantCommand(commandId, job, status, inputs));
      ports.log("Merchant dispatched to " + job.target, "info", { reason: job.reason });
    }
    ports.persist();
  }

  function hasQueuedWork(job: MerchantWork): boolean {
    if (job.reason === 'withdrawals') return hasMarkedWithdrawals(ports.inputs().work(job.target).withdrawals);
    if (job.reason === "deliveries") return ports.inputs().work(job.target).deliveries.length > 0;
    if (job.reason !== "manual compounds") return true;
    if (ports.inputs().work(job.target).compounds.length) return true;
    ports.log("Discarded empty manual compound job", "info", {jobId: job.id, target: job.target});
    return false;
  }

  function available(): boolean {
    // Realm reconnect recovery must continue its bounded deadline even while
    // the departing worker no longer supplies fresh inventory/status reports.
    if (ports.returningHome() && !ports.ensureHome("resuming merchant work")) return false;
    // Preserve queued work until a fresh living merchant can execute it.
    if (!merchantAlive()) return false;
    state.queue = mergePickupJobs(state.queue, ports.merchant()).map(job => ports.stamp(job));
    state.queue = state.queue.flatMap(job => splitLegacyWork(job)).filter(hasQueuedWork).filter((job) => !ports.bankboi(job.target) && (buyUpgradeOrder(job) || ports.enabled?.(job) !== false) && !(job.reason === "join giveaway" && Number(job.expiresAt) < ports.now()));
    return !state.current && !!ports.merchant() && !ports.manualEquipmentPending() && !reserved();
  }

  function merchantAlive(): boolean {
    const merchant = ports.status(ports.merchant());
    return !!merchant && !merchant.rip && merchant.seenAt >= ports.now() - 10000;
  }
  function productionHeld(): boolean {
    const pending = ports.productionPending?.() || [];
    if (pending.length) {
      if (state.current) return true; // An admitted in-flight operation is ordinary work, not a recovery alarm.
      const identity = JSON.stringify(pending);
      if (productionHold !== identity) {
        productionHold = identity;
        ports.log('Production recovery pending; merchant work held for receipt reconciliation', 'error', {pending});
      }
      // Keep active work intact. An idle merchant can reconcile its journal
      // without travelling, moving inventory, or admitting another operation.
      if (!state.current && merchantAlive() && ports.now() - productionProbeAt >= 5000) {
        productionProbeAt = ports.now();
        ports.command(ports.merchant(), {id:ports.nextCommand(), type:'merchant-production-recover'});
      }
      return true;
    }
    productionHold = '';
    productionProbeAt = -Infinity;
    return false;
  }
  function dispatch(): void {
    if (ports.eventReserved?.()) return;
    if (productionHeld()) return;
    // A receipt can already be settled while its lucky layout or inventory
    // tidy is still restoring. Hold before realm/home/storage/gathering paths
    // so none can steal that inventory ownership between native steps.
    if (ports.status(ports.merchant())?.upgradeInventoryBusy) return;
    dispatchReady();
  }
  function dispatchReady(): void {
    if (gatheringCastActive(ports.status(ports.merchant()), ports.now())) return;
    if (realmCheck.advance()) return;
    state.queue.forEach(realmCheck.eligibility);
    if (!available()) return;
    if (clearCollectionCapacity()) return;
    const jobs = state.queue.filter(ready);
    if (gatherBefore(jobs)) return;
    if (!jobs.length) {
      ports.idle();
      return;
    }
    const job = ports.pick();
    if (!job) return;
    dispatchJob(job);
  }
  function dispatchJob(job: MerchantWork): void {
    if (job.target === ports.merchant() && ports.routineNeedsHome(job.reason) && !ports.ensureHome(job.reason)) {
      state.queue.push(job);
      return;
    }
    batch(job);
    const status = targetStatus(job);
    if (status && !realmCheck.begin(job, status)) assign(job, status);
  }

  return { dispatch };
}
