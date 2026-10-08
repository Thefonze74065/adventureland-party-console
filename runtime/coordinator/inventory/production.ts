import { recordOfferingWait } from './offering-waits.ts';
import { rememberUpgradeContinuation } from './upgrade-continuation.ts';
import { offeringRule, isUpgradeOffering, type UpgradeOfferingRule } from '../../upgrade-offerings.ts';
import { itemRuleConflicts, type ConflictState } from "./shared-rules.ts";
import { requestObject, requestText, type HttpRouter } from '../http/contracts.ts';
interface UpgradeRule { tiers: number; quantity?: number }
interface CompoundRule { name: string; targetTier?: number; quantity?: number }
interface ReceiptRule { family: 'upgrade' | 'compound'; key: string; signature: string }
// Recovery is a client journal protocol, not a complete game item or operation.
export interface ProductionJournal { id: string; item: {name: string; level?: number}; slots: number[]; phase: 'prepared' | 'running' | 'complete'; [key: string]: unknown }
export interface ProductionAttempt { name: string; level: number; kind: 'upgrade' | 'compound'; rules: ReceiptRule[]; journal?: ProductionJournal; automaticCompoundTarget?: number; completed?: boolean; completedAt?: number; success?: boolean; requestId?: string; offering?: string; resolution?: { outcome: 'unknown'; reason: string; at: number } }
export interface ProductionState { attempts: Record<string, ProductionAttempt> }
export function pendingProduction(production: ProductionState, includeJournal = false) {
  return Object.entries(production.attempts).filter(([, attempt]) => !attempt.completed)
    .map(([id, attempt]) => ({id, name:attempt.name, level:attempt.level, kind:attempt.kind, ...(includeJournal && attempt.journal ? {journal:attempt.journal} : {})}));
}
interface State extends ConflictState {
  upgrades?: Record<string, {requestId?: string}[] | undefined>;
  upgradeOfferingRules?: UpgradeOfferingRule[];
  merchantCharacter: string | null;
  production: ProductionState;
  autoUpgradeMarks: Record<string, Record<string, number | string | UpgradeRule | undefined> | undefined>;
  autoCompounds: Record<string, CompoundRule[] | undefined>;
}
function rule(state: State, family: string, key: string) {
  const owner = String(state.merchantCharacter);
  return family === 'upgrade' ? state.autoUpgradeMarks[owner]?.[key] : state.autoCompounds[owner]?.find(value => value.name === key);
}
function quantity(value: unknown): number {
  return value && typeof value === 'object' ? Number((value as {quantity?:number}).quantity ?? -1) : -1;
}
function upgradeTargets(state: State, name: string, level: number): ReceiptRule[] {
  const result: ReceiptRule[] = [];
  for (const [key, value] of Object.entries(state.autoUpgradeMarks[String(state.merchantCharacter)] || {})) {
    const match = /^(.*)@\+(\d+)$/.exec(key);
    const tiers = Number(value && typeof value === 'object' ? value.tiers : value);
    if (match?.[1] === name && Number(match[2]) + tiers === level && quantity(value) > 0)
      result.push({family:'upgrade',key,signature:JSON.stringify(value)});
  }
  return result;
}
function targets(state: State, name: string, level: number, kind: string): ReceiptRule[] {
  if (kind === 'upgrade') return upgradeTargets(state,name,level);
  return (state.autoCompounds[String(state.merchantCharacter)] || [])
    .filter(value => value.name === name && Number(value.targetTier || 1) === level && quantity(value) > 0)
    .map(value => ({family:'compound',key:name,signature:JSON.stringify(value)}));
}
function automaticGuard(state: State, automatic: Record<string,unknown>): void {
  if (!automatic.key) return;
  const value = rule(state,requestText(automatic.family),requestText(automatic.key));
  if (!value) throw Error('Automatic production rule removed');
  if (quantity(value) === 0) throw Error('Production quota completed');
}
function attemptInput(body: Record<string,unknown>) {
  const id = requestText(body.id), item = requestObject(body.item), level = Number(item.level ?? 0) + 1;
  if (!id || id.length > 200 || typeof item.name !== 'string' || !Number.isSafeInteger(level) || level < 1 || level > 13)
    throw Error('Invalid production attempt');
  const kind = requestText(body.kind);
  if (kind !== 'upgrade' && kind !== 'compound') throw Error('Invalid production kind');
  return {id,name:item.name,level,kind:kind as ProductionAttempt["kind"]};
}
/** Retain a bounded retry window; unfinished recovery journals are never retired. */
export function pruneProductionReceipts(production: ProductionState): void {
  const completed = Object.entries(production.attempts).filter(([, attempt]) => attempt.completed)
    .sort((a, b) => (b[1].completedAt ?? 0) - (a[1].completedAt ?? 0));
  for (const [index, [id]] of completed.entries()) {
    if (index >= 2048)
      delete production.attempts[id];
  }
}
export function beginProduction(state: State, body: Record<string, unknown>) {
  pruneProductionReceipts(state.production);
  const input = attemptInput(body), {id,name,level,kind} = input;
  const previous = state.production.attempts[id];
  if (previous) {
    validateReceipt(previous, input);
    checkpointProduction(state, body);
    return previous;
  }
  if (Object.values(state.production.attempts).some(attempt => !attempt.completed)) throw Error('Production recovery pending');
  automaticGuard(state,requestObject(body.automatic));
  offeringGuard(state, body, name, level - 1);
  if (body.automatic && itemRuleConflicts(state,requestObject(body.item)).length) throw Error("Conflicting automatic rules");
  rememberUpgradeContinuation(state, body);
  const attempt: ProductionAttempt = {name,level,kind,rules:targets(state,name,level,kind)};
  if (typeof body.requestId === "string") attempt.requestId = body.requestId;
  if (isUpgradeOffering(body.offering)) attempt.offering = body.offering;
  attempt.automaticCompoundTarget = compoundTarget(state, body, name, kind);
  state.production.attempts[id] = attempt;
  try { checkpointProduction(state, body); }
  catch (error) { delete state.production.attempts[id]; throw error; }
  return attempt;
}

export function checkpointProduction(state: State, body: Record<string, unknown>): void {
  if (body.journal === undefined) return;
  const id = requestText(body.id), attempt = state.production.attempts[id], journal = requestObject(body.journal);
  if (!attempt || !validJournal(journal, id, attempt))
    throw Error('Invalid production recovery journal');
  if (attempt.completed) return;
  const phases = ['prepared', 'running', 'complete'];
  if (attempt.journal && phases.indexOf(requestText(journal.phase)) < phases.indexOf(attempt.journal.phase)) return;
  attempt.journal = structuredClone(journal) as ProductionJournal;
}
function validJournal(journal: Record<string, unknown>, id: string, attempt: ProductionAttempt): boolean {
  const item = requestObject(journal.item);
  return journal.id === id && item.name === attempt.name && Number(item.level || 0) + 1 === attempt.level &&
    ['prepared', 'running', 'complete'].includes(requestText(journal.phase)) && validJournalSlots(journal.slots);
}
function validJournalSlots(slots: unknown): boolean {
  return Array.isArray(slots) && slots.length > 0 && slots.every(slot => Number.isInteger(slot) && Number(slot) >= 0 && Number(slot) < 42);
}
type ProductionLog = (message: string, level: 'success', details: {name: string; level: number; attemptId: string}) => void;
export function finishProduction(state: State, id: string, success: boolean, log?: ProductionLog): void {
  const attempt = state.production.attempts[id];
  if (!attempt) throw Error('Unknown production attempt');
  if (attempt.completed) return;
  if (success) consumeQuotas(state, attempt);
  attempt.completed = true; attempt.completedAt = Date.now(); attempt.success = success;
  delete attempt.journal;
  finishManualOffering(state, attempt);
  if (success && attempt.kind === 'compound' && attempt.level === attempt.automaticCompoundTarget)
    log?.('merchant completed auto compound', 'success', {name:attempt.name,level:attempt.level,attemptId:id});
  pruneProductionReceipts(state.production);
}
export function installProductionRoutes(router: HttpRouter, state: State, persist: () => void, log?: ProductionLog) {
  router.post('/party-api/merchant/production', (req,res) => {
    const body = requestObject(req.body);
    if (body.character !== state.merchantCharacter) return res.status(400).json({error:'Only the merchant performs production'});
    try {
      if (body.action === 'pending') return res.json({ok:true,pending:pendingProduction(state.production, true)});
      if (body.action === 'inspect') return res.json({ok:true,...inspectProduction(state, body)});
      if (body.action === 'resolve-unknown') {
        resolveUnknownProduction(state, body);
        persist();
        return res.json({ok:true,attempt:state.production.attempts[String(body.id)]});
      }
      if (body.action === 'wait-offering') { recordOfferingWait(state, body); persist(); return res.json({ok:true}); }
      if (body.action === 'abort-manual') { abortManualProduction(state, requestText(body.id)); persist(); return res.json({ok:true}); }
      if (body.action === 'checkpoint') checkpointProduction(state, body);
      else if (body.action === 'complete') finishProduction(state,String(body.id),body.success === true,log);
      else beginProduction(state,body);
      persist();
      return res.json({ok:true,attempt:state.production.attempts[String(body.id)]});
    } catch(error) { return res.status(409).json({error:String(error)}); }
  });
}

/** Read-only reconciliation must never admit a prepared journal during recovery. */
export function inspectProduction(state: State, body: Record<string, unknown>) {
  const input = attemptInput(body), attempt = state.production.attempts[input.id];
  if (attempt) validateReceipt(attempt, input);
  const pending = pendingProduction(state.production);
  return {attempt:attempt || null, pending};
}

/** Explicit operator resolution only; automatic recovery never guesses an orphan's outcome. */
export function resolveUnknownProduction(state: State, body: Record<string, unknown>, now = Date.now()): void {
  const input = attemptInput(body), attempt = state.production.attempts[input.id];
  if (!attempt) throw Error('Unknown production attempt');
  validateReceipt(attempt, input);
  if (attempt.completed) return;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 1000) throw Error('Production resolution requires a review reason');
  attempt.resolution = {outcome:'unknown', reason, at:now};
  attempt.completed = true;
  attempt.completedAt = now;
  pruneProductionReceipts(state.production);
  delete attempt.success;
  // Retire one-shot manual ownership without inventing a success or spending quotas.
  finishManualOffering(state, attempt);
}

function validateReceipt(previous: ProductionAttempt, input: ReturnType<typeof attemptInput>): void {
  if (previous.name !== input.name || previous.level !== input.level || previous.kind !== input.kind)
    throw Error('Production receipt identity changed');
}
function compoundTarget(state: State, body: Record<string, unknown>, name: string, kind: string): number | undefined {
  const automatic = requestObject(body.automatic);
  if (kind !== 'compound' || automatic.family !== 'compound' || automatic.key !== name) return;
  const compound = state.autoCompounds[String(state.merchantCharacter)]?.find(value => value.name === name);
  return compound ? Number(compound.targetTier || 1) : undefined;
}
function consumeQuotas(state: State, attempt: ProductionAttempt): void {
  for (const target of attempt.rules) {
    const current = rule(state,target.family,target.key);
    if (JSON.stringify(current) !== target.signature || !current || typeof current !== 'object') continue;
    current.quantity = Math.max(0, quantity(current) - 1);
  }
}

function finishManualOffering(state: State, attempt: ProductionAttempt): void {
  if (!attempt.requestId) return;
  for (const [owner, marks] of Object.entries(state.upgrades || {}))
    state.upgrades![owner] = marks?.filter(mark => mark.requestId !== attempt.requestId);
}
function manualOfferingGuard(state: State, body: Record<string, unknown>, name: string, level: number): void {
  if (!body.requestId) return;
  const mark = Object.values(state.upgrades || {}).flatMap(marks => marks || []).find(mark => mark.requestId === body.requestId);
  const request = requestObject(mark), item = requestObject(request.item);
  if (!mark || request.offering !== body.offering || item.name !== name || Number(item.level || 0) !== level)
    throw Error('Manual upgrade request no longer exists or item changed');
}
function automaticOfferingGuard(state: State, body: Record<string, unknown>, name: string, level: number): void {
  if (requestObject(body.automatic).family !== 'upgrade') return;
  const selected = offeringRule(state.upgradeOfferingRules || [], name, level);
  if (selected?.required && body.offering !== selected.offering) throw Error('Required upgrade offering missing');
  if (body.offering && selected?.offering !== body.offering) throw Error('Upgrade offering rule changed');
}
function offeringGuard(state: State, body: Record<string, unknown>, name: string, level: number): void {
  if (body.kind !== 'upgrade') return;
  if (body.offering !== undefined && !isUpgradeOffering(body.offering)) throw Error('Invalid upgrade offering');
  manualOfferingGuard(state, body, name, level);
  automaticOfferingGuard(state, body, name, level);
}

/** The client journals whether the game call was issued before invoking it. */
export function abortManualProduction(state: State, id: string): void {
  const attempt = state.production.attempts[id];
  if (!attempt || attempt.completed) return;
  if (!attempt.requestId) throw Error('Only an unissued manual offering attempt may be abandoned');
  delete state.production.attempts[id];
}
