import { requestObject, requestText } from '../http/contracts.ts';
import { offeringStock } from './offering-stock.ts';
import { isUpgradeOffering, offeringRule, type UpgradeOfferingRule } from '../../upgrade-offerings.ts';

export function offeringSignature(value: unknown): string {
  const state = requestObject(value);
  return JSON.stringify([state.upgradeOfferingRules || [], offeringStock(state)]);
}
export function upgradeOfferingReady(state: unknown, raw: unknown): boolean {
  const mark = requestObject(raw), waiting = requestObject(mark.waitingOffering);
  if (mark.storage) return false;
  return !waiting.signature || waiting.signature !== offeringSignature(state);
}
interface State {
  merchantCharacter?: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  upgradeOfferingRules?: UpgradeOfferingRule[];
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
  const entry = existing ? requestObject(existing) : {...mark};
  if (!existing && !mark.auto) throw Error('Manual upgrade request no longer exists');
  const rule = offeringRule(state.upgradeOfferingRules || [], requestText(item.name), Number(body.level));
  if (mark.auto && !matchesRequired(rule, body.offering)) return;
  relocateWait(state, owner, entry, body.liveSlot);
  entry.waitingOffering = {offering:body.offering, level:Number(body.level), signature:offeringSignature(state)};
  if (!existing) list.push(entry);
}

function sameRequest(mark: Record<string, unknown>, entry: Record<string, unknown>): boolean {
  return mark.requestId ? entry.requestId === mark.requestId : entry.slot === mark.slot && !!entry.equipped === !!mark.equipped;
}
function validateWait(body: Record<string, unknown>, item: Record<string, unknown>): void {
  if (typeof item.name !== 'string' || !isUpgradeOffering(body.offering) || !Number.isInteger(body.level)) throw Error('Invalid offering wait');
}
function matchesRequired(rule: UpgradeOfferingRule | undefined, offering: unknown): boolean { return !!rule?.required && rule.offering === offering; }

function relocateWait(state: State, owner: string, entry: Record<string, unknown>, slot: unknown): void {
  if (owner === state.merchantCharacter && !entry.equipped && Number.isInteger(slot) && Number(slot) >= 0) entry.slot = slot;
}
