import { releaseMerchantInterruption } from "../navigation/merchant-interruption.ts";
import { upgradeOfferingReady } from '../inventory/offering-waits.ts';
import { requestObject, requestText } from "../http/contracts.ts";
import { createCompletionResults } from "./completion-results.ts";
import { createCompletionRetries } from "./completion-retries.ts";
import type {
  CompletionState,
  CompletionPorts,
  CompletionJob,
  CompletionReport,
} from "./completion-types.ts";

/** Commits receipts before deciding which unfinished work must survive a runtime handoff. */
export function createMerchantCompletion(state: CompletionState, ports: CompletionPorts) {
  const results = createCompletionResults(state, ports),
    retries = createCompletionRetries(state, ports);
  async function confirmAuth(): Promise<void> {
    try {
      const result = requestObject(
        await ports.fetchAuth(state.merchantCharacter, state.aldata.key),
      );
      state.aldata.auth = result.auth || "YES";
      state.aldata.authCheckedAt = ports.now();
      ports.persistALData();
      if (state.aldata.auth === "CORRECT") ports.publishALData();
    } catch (error) {
      state.aldata.error = requestText(requestObject(error).message || error);
    }
  }
  function authenticate(job: CompletionJob, body: CompletionReport): void {
    if (!body.success || job.reason !== "ALData authentication") return;
    state.aldata.auth = "YES";
    state.aldata.authCheckedAt = ports.now();
    ports.persistALData();
    ports.schedule(() => {
      void confirmAuth();
    }, 65000);
  }
  function upgradeRoutines(name: string): string[] {
    const upgrades = (state.upgrades[name] || []).filter(mark => upgradeOfferingReady(state, mark)), reasons = [];
    if (upgrades.some(mark => !(mark as {auto?: boolean}).auto) || state.statScrolls[name]?.length)
      reasons.push("manual upgrades");
    if (upgrades.some(mark => (mark as {auto?: boolean}).auto)) reasons.push("auto upgrade");
    return reasons;
  }
  function deferredAutoCompound(job: CompletionJob): boolean {
    return job.reason === "auto compound" || !!state.autoCompounds[String(job.target)]?.length;
  }
  function deferredImprovements(job: CompletionJob): void {
    const name = job.target;
    if (!name) return;
    const reasons = new Set(upgradeRoutines(name));
    if (state.compounds[name]?.length) reasons.add("manual compounds");
    if (state.purchases[name]?.length) reasons.add("manual buying");
    if (deferredAutoCompound(job)) reasons.add("auto compound");
    for (const reason of reasons) ports.queue([name], reason);
    if (reasons.size) ports.log("Queued deferred merchant work", "info", {
      character: name, routines: [...reasons],
    });
  }
  function finish(job: CompletionJob): void {
    if (job.reason === "ALData marketplace sales") ports.ensureHome("WTB completion");
    if (job.reason === "join giveaway") ports.ensureHome("giveaway completion");
    ports.persistBank();
    ports.persist();
    ports.dispatch();
    if (
      ["stand bid purchases", "ALData marketplace purchases", "Ponty purchases"].includes(
        job.reason,
      )
    )
      ports.schedule(() => {
        if (!ports.pontyMatches()) ports.aldataMatches();
      }, 1000);
  }
  function complete(job: CompletionJob, body: CompletionReport): void {
    const name = job.target;
    results.resolve(job, body);
    const decision = retries.decide(job, body);
    const repeatCleanout = job.reason === "inventory cleanout" && job.handoff?.cleanoutRemaining;
    const deferred = body.success && body.deferredWork;
    releaseMerchantInterruption(state, job.id);
    delete state.commands[String(state.merchantCharacter)];
    releaseFailedRecipient(name, job, body);
    state.merchantCurrent = null;
    authenticate(job, body);
    retries.enqueue(job, decision);
    if (deferred) deferredImprovements(job);
    if (repeatCleanout) repeatCleanoutAfterWindow(job);
    finish(job);
  }
  function repeatCleanoutAfterWindow(job: CompletionJob): void {
    if (!job.handoff?.partial) { ports.queue([job.target], "inventory cleanout"); return; }
    if (state.merchantAutomations?.['inventory cleanout'] === false) return;
    // Queue before dispatch with a durable eligibility time. Automatic pulses
    // merge into this pickup and retain retryAt instead of revisiting instantly.
    const now = ports.now();
    const existing = state.merchantQueue.find(queued => queued.target === job.target && queued.reason === "inventory cleanout");
    if (existing) existing.retryAt = Math.max(Number(existing.retryAt) || 0, now + 10000);
    else state.merchantQueue.push(ports.stamp({id: job.id + '-cleanout-' + now, target: job.target,
      reason: "inventory cleanout", queuedAt: now, retryAt: now + 10000}));
  }
  function releaseFailedRecipient(name: CompletionJob['target'], job: CompletionJob, body: CompletionReport): void {
    const recipient = state.commands[String(name)];
    if (!body.success && recipient?.type === "merchant-handoff" &&
        (recipient.jobId === undefined || recipient.jobId === job.id)) delete state.commands[String(name)];
  }
  return { complete };
}
