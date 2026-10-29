import { releaseMerchantInterruption } from "../navigation/merchant-interruption.ts";
import { currentMerchantReport } from '../merchant/commerce-progress.ts';
import { merchantJobReady } from '../merchant/priority.ts';
import { routineEnabled } from '../merchant/routines.ts';
import { offeringStock } from '../inventory/offering-stock.ts';
import { merchantEventReserved, type MerchantEventState } from '../merchant/event-control.ts';
import type { OfferingRulesState } from '../inventory/upgrade-offerings.ts';
import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";
import { craftProtection, type CraftReservationState } from "../merchant/craft-reservations.ts";
import { sharedCompoundRules, type BankImprovementState } from "../merchant/banked-improvements.ts";
import { itemRuleConflicts } from "../inventory/shared-rules.ts";
import { operationStage } from '../merchant/activity.ts';
import { collectionPickups, type PickupState } from '../merchant/collection-pickups.ts';
import { collectsPartyItems } from '../merchant/pickup-jobs.ts';

interface ProgressState extends CraftReservationState, PickupState, OfferingRulesState, MerchantEventState {
  upgradeChanceGuards?: import('../../upgrade-chance-guard.ts').UpgradeChanceGuard[];
  autoCompounds?: BankImprovementState['autoCompounds'];
  merchantRules?: BankImprovementState['merchantRules'];
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  statuses: NonNullable<PickupState['statuses']> & MerchantEventState['statuses'];
  gatheringModes: string[];
  gatheringCooldowns: Record<string, number | undefined>;
  commands: Record<string, unknown>;
}
interface ProgressPorts {
  now(): number;
  anniversaryReserved?(): boolean;
  capacityBlocked?(job: MerchantWork): boolean;
  collectionReady?(job: MerchantWork): boolean;
  priority(job: MerchantWork): number;
  routinePriority(mode: string): number;
  persist(): void;
  stamp(job: MerchantWork): MerchantWork;
  log(message: string, level: string, details: unknown): void;
  dispatch(): void;
}

export function createMerchantProgressRoutes(state: ProgressState, ports: ProgressPorts) {
  function nextTarget(job: MerchantWork): string | null {
    const next = job.batchId
      ? state.merchantQueue.find((candidate) => candidate.batchId === job.batchId) || null
      : state.merchantQueue[0] || null;
    return next && (job.batchId ? next.batchId === job.batchId : next.reason === job.reason)
      ? next.target
      : null;
  }
  function job(req: HttpRequest, res: HttpResponse): unknown {
    const current = state.merchantCurrent;
    if (!current || req.params.id !== current.id)
      return res.status(404).json({ error: "merchant job not found" });
    const target = typeof req.query?.target === "string" ? req.query.target : current.target;
    return res.json({
      ...current,
      targetStatus: state.statuses[String(target)] || null,
      nextCollectionTarget: nextTarget(current),
      craftProtection: craftProtection(state),
      ...(collectsPartyItems(current.reason) ? {collectionPickups: collectionPickups(state, String(target), current.reason)} : {}),
    });
  }
  function heartbeat(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (!currentMerchantReport(current, body))
      return res.status(409).json({ error: "merchant job is no longer current" });
    current.heartbeatAt = ports.now();
    const stage = operationStage(body.operationStage);
    if (stage && current.target === state.merchantCharacter) current.operationStage = stage;
    if (Number.isFinite(Number(body.progressAt)))
      current.progressAt = Math.min(ports.now(), Number(body.progressAt));
    if (current.phase === "assigned") current.phase = "processing";
    return res.json({ ok: true });
  }
  function priorities(current: MerchantWork) {
    const currentPriority = ports.priority(current),
      queuedPriority = state.merchantQueue.filter(job => routineEnabled(job, state.merchantAutomations || {}) &&
        merchantJobReady(job, {now: ports.now(), priority: candidate => ports.priority(candidate as MerchantWork),
          capacityBlocked: candidate => ports.capacityBlocked?.(candidate as MerchantWork) || false,
          collectionReady: candidate => ports.collectionReady?.(candidate as MerchantWork) !== false})).reduce(
        (highest, job) => Math.max(highest, ports.priority(job)),
        -1,
      );
    const gathering = state.gatheringModes.filter(
      (mode) => Number(state.gatheringCooldowns[mode] || 0) <= ports.now(),
    );
    const gatheringPriority = gathering.reduce(
      (highest, mode) => Math.max(highest, ports.routinePriority(mode)),
      -1,
    );
    return {
      currentPriority,
      waitingPriority: Math.max(queuedPriority, gatheringPriority),
      waitingType: gatheringPriority > queuedPriority ? "gathering" : "queue",
    };
  }
  function pause(current: MerchantWork, currentPriority: number, waitingPriority: number): void {
    const paused: MerchantWork = { ...current, queuedAt: Number(current.queuedAt) || ports.now() };
    delete paused.phase;
    delete paused.operationStage;
    delete paused.startedAt;
    delete paused.checkpointAt;
    delete paused.handoff;
    delete paused.commandId;
    delete paused.commandReport;
    delete paused.heartbeatAt;
    delete paused.progressAt;
    paused.pauseReason = 'Waiting for higher-priority work or event';
    releaseMerchantInterruption(state, current.id);
    state.merchantQueue.push(ports.stamp(paused));
    delete state.commands[String(state.merchantCharacter)];
    state.merchantCurrent = null;
    ports.log("Paused " + paused.reason + " for a higher-priority routine", "info", {
      priority: currentPriority,
      waitingPriority,
    });
    ports.persist();
    ports.dispatch();
  }
  function checkpoint(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (!currentMerchantReport(current, body))
      return res.status(409).json({ error: "merchant job is no longer current" });
    if (body.protectionOnly === true) {
      if (current.itemMarksCleared) return res.status(409).json({ error: "Item marks cleared; refresh merchant work" });
      if (body.commerceAdoptionProtection === true &&
          (current.reason !== 'merchant commerce' || current.commerceProgressVersion !== 2 || body.commandId !== current.commandId))
        return res.status(409).json({error:'Commerce adoption requires the current paid command'});
      return res.json(protectionReply(state, body.commerceAdoptionProtection === true ? current.id : undefined));
    }
    return checkpointWork(current, body, res);
  }
  function reserved(): boolean {
    return merchantEventReserved(state, ports.now()) || ports.anniversaryReserved?.() === true;
  }
  function saveProgress(current: MerchantWork, body: Record<string, unknown>): void {
    if (body.eventOnly !== true)
      current.resumeState = body.state && typeof body.state === "object" ? body.state : {};
    if (body.movementSucceeded === true) current.movementRetryCount = 0;
  }
  function checkpointWork(current: MerchantWork, body: Record<string, unknown>, res: HttpResponse): unknown {
    const eventReserved = reserved();
    if (body.eventOnly === true && !eventReserved) return res.json({ yield: false });
    const adoption = adoptionTransition(current, body);
    saveProgress(current, body);
    current.phase = "checkpointed";
    current.checkpointAt = ports.now();
    current.progressAt = ports.now();
    const { currentPriority, waitingPriority, waitingType } = priorities(current);
    if (body.cycleBoundary === false || (!eventReserved && waitingPriority <= currentPriority)) {
      current.phase = "processing";
      delete current.checkpointAt;
      ports.persist();
      auditAdoption(current, adoption);
      return res.json({ yield: false, currentPriority, waitingPriority, waitingType });
    }
    pause(current, currentPriority, waitingPriority);
    auditAdoption(current, adoption);
    return res.json({ yield: true, currentPriority, waitingPriority });
  }
  function auditAdoption(current: MerchantWork, adoption: Record<string, unknown> | undefined): void {
    if (!adoption) return;
    const input = requestObject(adoption.input), previous = requestObject(adoption.previousInput);
    ports.log('Inventory adoption assumption: continuing ' + String(input.name) + ' +' + Number(input.level || 0) +
      ' from inventory slot ' + Number(adoption.slot) + '; old upgrade +' + Number(previous.level || 0) +
      ' to +' + Number(adoption.pendingLevel) + ' at slot ' + Number(adoption.previousSlot) +
      ' remains unconfirmed; paid spending and attempts retained', 'info',
      {jobId:current.id,commerceOrderId:current.commerceOrderId,commandId:current.commandId,adoption});
  }
  return { job, heartbeat, checkpoint };
}

function adoptionTransition(current: MerchantWork, body: Record<string, unknown>) {
  if (body.eventOnly === true || current.reason !== 'merchant commerce' || current.commerceProgressVersion !== 2) return;
  const previous = requestObject(requestObject(current.resumeState).inventoryAdoption);
  const adoption = requestObject(requestObject(body.state).inventoryAdoption);
  if (!Number.isFinite(adoption.at) || Number(adoption.at) <= Number(previous.at || 0)) return;
  return adoption;
}

function protectionReply(state: ProgressState, commerceAdoptionJob?: string) {
  const compoundState = {...state, autoCompounds: state.autoCompounds || {}};
  const compoundRules = state.merchantAutomations?.['auto compound'] === false ? [] : sharedCompoundRules(compoundState)
    .filter(rule => Number(rule.quantity) !== 0);
  const compoundBlocked = compoundRules.flatMap(rule => Array.from({length: rule.targetTier || 1}, (_, level) => ({name:rule.name,level})))
    .filter(item => itemRuleConflicts(compoundState,item).length);
  return {craftProtection: craftProtection(state), compoundRules, compoundBlocked,
    ...(commerceAdoptionJob ? {commerceAdoptionProtection:craftProtection(state, undefined, commerceAdoptionJob)} : {}),
    upgradeOfferingRules: state.upgradeOfferingRules || [], upgradeChanceGuards: state.upgradeChanceGuards || [], upgradeOfferingStock: offeringStock(state)};
}
