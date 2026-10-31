import { requestObject, requestText } from '../http/contracts.ts';
import {sameMarkedItem} from './item-identity.ts';
import {protectedMerchantStorageStock} from './merchant-storage-stock.ts';
import { offeringStock } from './offering-stock.ts';
import { chanceGuard, type UpgradeChanceGuard } from '../../upgrade-chance-guard.ts';
import { isUpgradeOffering, offeringRule, resolveUpgradeOffering, type UpgradeOfferingRule, validOfferingRule } from '../../upgrade-offerings.ts';

export function offeringSignature(value: unknown): string {
  const state = requestObject(value);
  return JSON.stringify([state.upgradeOfferingRules || [], offeringStock(state), Object.values(requestObject(state.bankbois)).map(raw => {const worker=requestObject(raw);return [worker.name,worker.state,worker.error,worker.items];}), state.activeSlots, requestObject(state.bankSnapshot).packs, Object.values(requestObject(state.statuses)).map(raw=>requestObject(raw).items)]);
}
/** A chance-held mark is retried after this long, or sooner when the guards change. */
export const chanceHoldMs = 10 * 60 * 1000;
function chanceGuardSignature(value: unknown): string {
  return JSON.stringify(requestObject(value).upgradeChanceGuards || []);
}
function chanceHeld(state: unknown, mark: Record<string, unknown>, now: number): boolean {
  const held = requestObject(mark.heldChance);
  return !!held.signature && held.signature === chanceGuardSignature(state) && Number(held.until) > now;
}
export function upgradeOfferingReady(state: unknown, raw: unknown, now = Date.now()): boolean {
  const mark = requestObject(raw), waiting = requestObject(mark.waitingOffering);
  if (mark.storage || chanceHeld(state, mark, now)) return false;
  return !waiting.signature || waiting.signature !== offeringSignature(state);
}
interface State {
  merchantCharacter?: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  upgradeOfferingRules?: UpgradeOfferingRule[];
  upgradeChanceGuards?: UpgradeChanceGuard[];
}
/** The merchant held this mark below a chance guard: keep it queued but do not retry it every cycle. */
export function recordChanceHold(state: State, body: Record<string, unknown>, now = Date.now()): void {
  const owner = String(body.owner), mark = requestObject(body.mark), item = requestObject(mark.item);
  if (typeof item.name !== 'string' || !Number.isInteger(body.level)) throw Error('Invalid chance hold');
  const guard = chanceGuard(state.upgradeChanceGuards || [], item.name, Number(body.level));
  if (!guard) return;
  const list = (state.upgrades ||= {})[owner] ||= [];
  const existing = list.find(raw => sameRequest(mark, requestObject(raw)));
  const entry = waitingMark(existing, mark);
  relocateWait(state, owner, entry, body.liveSlot);
  entry.heldChance = heldChance(state, guard, body, now);
  if (!existing) list.push(entry);
}
function heldChance(state: State, guard: UpgradeChanceGuard, body: Record<string, unknown>, now: number) {
  return {level: Number(body.level), chance: Number(body.chance) || 0, minChance: guard.minChance,
    reason: body.reason || null, signature: chanceGuardSignature(state), until: now + chanceHoldMs};
}
export function recordOfferingWait(state: State, body: Record<string, unknown>): void {
  const owner = String(body.owner), mark = requestObject(body.mark), item = requestObject(mark.item);
  validateWait(body, item);
  const list = (state.upgrades ||= {})[owner] ||= [];
  const existing = list.find(raw => {
    const entry = requestObject(raw);
    return sameRequest(mark, entry);
  });
  // Bank-sourced automatic work does not have a saved mark until it must wait.
  const entry = waitingMark(existing,mark);
  const rule = offeringRule(state.upgradeOfferingRules || [], requestText(item.name), Number(body.level));
  if (mark.auto && rule?.offering !== body.offering) return;
  relocateWait(state, owner, entry, body.liveSlot);
  entry.waitingOffering = {offering:body.offering, level:Number(body.level), reason:body.reason || 'No usable offering stock', signature:offeringSignature(state)};
  if (!existing) list.push(entry);
}

function waitingMark(existing:unknown,mark:Record<string,unknown>):Record<string,unknown> {
  if(existing) return requestObject(existing);
  if(!mark.auto) throw Error('Manual upgrade request no longer exists');
  return {...mark};
}
function sameRequest(mark: Record<string, unknown>, entry: Record<string, unknown>): boolean {
  return mark.requestId ? entry.requestId === mark.requestId : entry.slot === mark.slot && !!entry.equipped === !!mark.equipped;
}
function validateWait(body: Record<string, unknown>, item: Record<string, unknown>): void {
  if (typeof item.name !== 'string' || !isUpgradeOffering(body.offering) || !Number.isInteger(body.level)) throw Error('Invalid offering wait');
}

function relocateWait(state: State, owner: string, entry: Record<string, unknown>, slot: unknown): void {
  if (owner === state.merchantCharacter && !entry.equipped && Number.isInteger(slot) && Number(slot) >= 0) {
    entry.slot = slot;
    entry.liveSlot = slot;
  }
}

/** A deposited stack still belongs to collection until its withdrawal receipt. */
export function offeringSupplyReady(value: unknown, raw: unknown): boolean {
  const state=requestObject(value),job=requestObject(raw),supply=requestObject(job.offeringSupply);
  if(!supply.offering) return true;
  if(supply.rulesSignature!==JSON.stringify(state.upgradeOfferingRules || [])) return true;
  if(Array.isArray(supply.intents)) {
    supply.outstanding=remainingSupplyDemand(state,job,supply);
    if(!supply.outstanding) {supply.state='delivered';supply.blockingReason=null;return true;}
  }
  const requests=requestObject(state.withdrawals)[String(state.merchantCharacter)];
  const pending=Array.isArray(requests) ? requests.map(requestObject).filter(raw=>requestObject(raw.item).name===supply.offering) : [];
  if(!pending.length) return true;
  supply.blockingReason=supplyReason(state,pending);
  job.pauseReason=supply.blockingReason;
  return false;
}
function supplyReason(state:Record<string,unknown>,pending:Record<string,unknown>[]):string {
  const remote=pending.find(raw=>String(raw.pack).startsWith('bankboi:'));
  if(!remote) return 'Waiting for confirmed merchant collection';
  const workers=Array.isArray(state.bankbois) ? state.bankbois : Object.values(requestObject(state.bankbois));
  const worker=workers.map(requestObject).find(worker=>worker.name===String(remote.pack).slice(8));
  if(worker?.error) return typeof worker.error==='string' ? worker.error : JSON.stringify(worker.error);
  return 'Waiting for BankBoi service and native deposit';
}

function remainingSupplyDemand(state:Record<string,unknown>,job:Record<string,unknown>,supply:Record<string,unknown>):number {
  const owner=String(job.target || state.merchantCharacter),saved=requestObject(state.upgrades)[owner];
  const marks=Array.isArray(saved)?saved.map(requestObject):[];
  const report=requestObject(requestObject(state.statuses)[String(state.merchantCharacter)]);
  const items=Array.isArray(report.items)?report.items.map(raw=>requestObject(requestObject(raw).item)):[],used=new Set<number>();
  const intents=Array.isArray(supply.intents)?supply.intents.map(requestObject):[];
  const demand=intents.filter(intent=>marks.some(mark=>sameSupplyIntent(intent,mark)))
    .reduce((sum,mark)=>sum+remainingOfferingSteps(state,mark,items,used,supply.offering),0);
  const carried=protectedMerchantStorageStock(state).filter(entry=>entry.craftLocation==='inventory:'+state.merchantCharacter && entry.item && entry.item.name===supply.offering && !entry.item.l && !entry.item.b)
    .reduce((sum,entry)=>sum+(Number(entry.item?.q)||1),0);
  return Math.max(0,demand-carried);
}
function sameSupplyIntent(intent:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  if(intent.requestId) return intent.requestId===mark.requestId;
  if(intent.passId) return intent.passId===mark.passId;
  return intent.slot===mark.slot && Number(intent.tiers)===Number(mark.tiers) && sameMarkedItem(requestObject(mark.item),requestObject(intent.item));
}
function remainingOfferingSteps(state:Record<string,unknown>,mark:Record<string,unknown>,items:Record<string,unknown>[],used:Set<number>,offering:unknown):number {
  const start=requestObject(mark.item),origin=Number(start.level)||0,target=origin+Number(mark.tiers||1);
  const index=items.findIndex((item,index)=>!used.has(index) && withinSupplyTarget(item,start,target));
  if(index<0) return 0;
  used.add(index);let demand=0;
  const rules=supplyRules(state);
  for(let level=Number(items[index].level)||0;level<target;level++){
    if(resolveUpgradeOffering(rules,String(start.name),level,isUpgradeOffering(mark.offering)?mark.offering:undefined)?.offering===offering) demand++;
    if(mark.offering) break;
  }
  return demand;
}
function withinSupplyTarget(item:Record<string,unknown>,start:Record<string,unknown>,target:number):boolean {
  const origin=Number(start.level)||0,level=Number(item.level)||0;
  return level>=origin && level<target && sameMarkedItem({...item,level:origin},{...start,level:origin});
}

function supplyRules(state:Record<string,unknown>):UpgradeOfferingRule[] {
  return Array.isArray(state.upgradeOfferingRules)?state.upgradeOfferingRules.filter(validOfferingRule):[];
}

/** Storage collection keeps the established three-slot inventory reserve. */
export function pendingOfferingCollection(value:unknown,raw:unknown):boolean {
  const state=requestObject(value),job=requestObject(raw);
  if(job.target!==state.merchantCharacter || !['manual bank exchange','withdrawals','bank collection'].includes(String(job.reason))) return false;
  const jobs=Array.isArray(state.merchantQueue)?state.merchantQueue.map(requestObject):[];
  const requests=requestObject(state.withdrawals)[String(state.merchantCharacter)];
  if(!Array.isArray(requests)) return false;
  return jobs.some(job=>{
    const supply=requestObject(job.offeringSupply);
    return !!supply.offering && requests.map(requestObject).some(request=>!String(request.pack).startsWith('bankboi:') && requestObject(request.item).name===supply.offering);
  });
}
export function offeringCollectionReady(value:unknown,raw:unknown):boolean {
  if(!pendingOfferingCollection(value,raw)) return true;
  const state=requestObject(value),job=requestObject(raw),report=requestObject(requestObject(state.statuses)[String(state.merchantCharacter)]);
  if(!Array.isArray(report.items) || report.items.filter(entry=>!entry).length>3) return true;
  job.pauseReason='Offering collection needs more than three free merchant inventory slots';
  return false;
}
