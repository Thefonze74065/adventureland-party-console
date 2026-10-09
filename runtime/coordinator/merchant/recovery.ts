import type { MerchantWork } from "./work.ts";
import { buyUpgradeOrder } from './commerce-progress.ts';
import type { InventoryEntry } from "../contracts/item.ts";

export interface MerchantCommandReport {
  commandId: number;
  jobId: string;
  state: "accepted" | "deferred";
  reason?: string | null;
  at: number;
}

export interface RecoverableWork extends MerchantWork {
  phase?: string;
  startedAt?: number;
  checkpointAt?: number;
  heartbeatAt?: number;
  progressAt?: number;
  resumedFrom?: string;
  commandId?: number;
  commandReport?: MerchantCommandReport;
  recoveryAttempts?: number;
  firstDeferredAt?: number;
  lastDeferredReason?: string;
}

interface RecoveryState {
  current: RecoverableWork | null;
  queue: RecoverableWork[];
}
interface RecoveryPorts {
  now(): number;
  nextCommand(): number;
  clearCommand(name: string, jobId: string): void;
  restockSatisfied(name: string, items: (InventoryEntry | null)[] | undefined): boolean;
  stamp(job: RecoverableWork): RecoverableWork;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  dispatch(): void;
  recoverSale(): void;
}

function checkpointExpired(job: RecoverableWork, now: number): boolean {
  return (
    job.phase === "checkpointed" && now - Number(job.checkpointAt || job.startedAt || 0) > 10000
  );
}

function workerExpired(job: RecoverableWork, now: number): boolean {
  if (!["assigned", "processing"].includes(job.phase || "")) return false;
  return (
    now - Number(job.heartbeatAt || job.startedAt || 0) > 20000 ||
    (job.reason === "merchant commerce" &&
      now - Number(job.progressAt || job.startedAt || 0) > 90000)
  );
}

function reportChanged(
  previous: MerchantCommandReport | undefined,
  report: MerchantCommandReport,
): boolean {
  return previous?.state !== report.state || previous?.reason !== report.reason;
}

/** Only merchant heartbeats recover jobs; completed restocks can dispatch the next job immediately. */
export function createMerchantRecovery(state: RecoveryState, ports: RecoveryPorts) {
  function completeRestock(name: string, items: (InventoryEntry | null)[] | undefined): void {
    const job = state.current;
    if (!job || job.reason !== "restock" || job.target !== name || !ports.restockSatisfied(name, items)) return;
    ports.clearCommand(name, job.id);
    state.current = null;
    ports.log("Merchant potion restock completed", "success", { character: name, jobId: job.id });
    ports.persist();
    ports.dispatch();
  }

  function requeue(name: string, removedFields: (keyof RecoverableWork)[], message: string): void {
    const current = state.current;
    if (!current) return;
    if (Number(current.recoveryAttempts || 0) >= 3 && current.phase !== 'checkpointed' && !buyUpgradeOrder(current)) {
      ports.clearCommand(name, current.id);
      state.current = null;
      ports.log('Stopped unresponsive merchant work after three retries', 'error', { jobId: current.id, reason: current.reason });
      ports.persist();
      return;
    }
    const recovered: RecoverableWork = {
      ...current,
      resumedFrom: current.id,
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
    };
    for (const key of removedFields) delete recovered[key];
    if (current.phase !== "checkpointed") {
      recovered.recoveryAttempts = Number(current.recoveryAttempts || 0) + 1;
      recovered.retryAt =
        ports.now() + Math.min(300000, 20000 * 2 ** Math.min(4, recovered.recoveryAttempts - 1));
    }
    delete recovered.commandReport;
    delete recovered.commandId;
    state.queue.push(ports.stamp(recovered));
    ports.clearCommand(name, current.id);
    state.current = null;
    ports.log(message + recovered.reason, "info");
    ports.persist();
  }

  function currentReport(job: RecoverableWork, report: MerchantCommandReport): boolean {
    return (
      report.jobId === job.id &&
      report.commandId === job.commandId &&
      report.at >= Number(job.startedAt || 0) &&
      report.at <= ports.now() + 5000 &&
      ports.now() - report.at < 10000
    );
  }

  function releaseAnniversary(job: RecoverableWork, nameForMerchant: string): void {
          const queued = {...job, phase: undefined, startedAt: undefined, commandId: undefined,
            commandReport: undefined, firstDeferredAt: undefined};
          if (!state.queue.some(entry => entry.id === job.id)) state.queue.push(queued);
          ports.clearCommand(nameForMerchant, job.id);
          state.current = null;
          ports.log('Merchant job released while anniversary owns movement', 'info', {jobId: job.id});
          ports.persist();
  }

  function acceptReport(
    job: RecoverableWork | null,
    report: MerchantCommandReport | undefined,
    nameForMerchant: string,
  ): boolean {
    if (job && report && currentReport(job, report)) {
      if (reportChanged(job.commandReport, report))
        ports.log(
          "Merchant command " + report.state + (report.reason ? ": " + report.reason : ""),
          "info",
          report,
        );
      job.commandReport = report;
      if (report.state === "deferred" && !job.heartbeatAt) {
        job.lastDeferredReason = deferralReason(report);
        job.firstDeferredAt ??= ports.now();
        if (eventDeferral(report.reason)) {
          releaseAnniversary(job, nameForMerchant);
          return true;
        }
        ports.persist();
        return false;
      }
    }
    return false;
  }

  function observe(
    name: string,
    items: (InventoryEntry | null)[] | undefined,
    report?: MerchantCommandReport,
  ): void {
    ports.recoverSale();
    completeRestock(name, items);
    if (acceptReport(state.current, report, name)) return;
    if (state.current && checkpointExpired(state.current, ports.now()))
      requeue(
        name,
        ["phase", "startedAt", "checkpointAt", "handoff"],
        "Requeued stranded checkpoint for ",
      );
    if (state.current && workerExpired(state.current, ports.now()))
      requeue(
        name,
        ["phase", "startedAt", "heartbeatAt", "progressAt", "handoff"],
        recoveryMessage(state.current),
      );
  }
  function expire(name: string): void {
    const job = state.current;
    // A timer can recover offline workers. Marketplace sales retain their
    // existing no-replay recovery because completion may be ambiguous.
    if (!job || job.reason === 'ALData marketplace sales' || job.phase === 'switching party realm') return;
    if (ports.now() - Number(job.heartbeatAt || job.startedAt || 0) <= 180_000) return;
    requeue(name, ['phase', 'startedAt', 'checkpointAt', 'heartbeatAt', 'progressAt', 'handoff'],
      'Merchant stopped reporting; retry scheduled for ');
  }
  return { observe, expire };
}

function recoveryMessage(job: RecoverableWork): string {
  if (job.commandReport?.state === 'deferred')
    return 'Command deferred (' + (job.commandReport.reason || 'unspecified') + '); retry scheduled for ';
  return job.heartbeatAt ? 'Worker stalled; retry scheduled for ' : 'Command not acknowledged; retry scheduled for ';
}

function deferralReason(report: MerchantCommandReport): string {
  return report.reason || 'unspecified';
}

function eventDeferral(reason: string | null | undefined): boolean {
  return reason === 'anniversary' || reason === 'event';
}
