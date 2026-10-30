import { randomUUID } from 'node:crypto';
import { chanceGuardOverlap, validMinChance, validScrollGrade, type UpgradeChanceGuard } from '../../upgrade-chance-guard.ts';
import { requestObject } from '../http/contracts.ts';
import type { CommandOutcome } from '../navigation/manual-commands.ts';
import { offeringMaximum } from './upgrade-offerings.ts';

export interface ChanceGuardsState {
  upgradeChanceGuards?: UpgradeChanceGuard[];
  merchantCatalog?: { allItems?: { id: string; upgradeable?: boolean; meta?: { upgradeable?: boolean; maxLevel?: number } | null }[] } | null;
}
export function createChanceGuardCommands(state: ChanceGuardsState, persist: () => void) {
  return (body: Record<string, unknown>): CommandOutcome => {
    if (body.type !== 'upgrade-chance-guard') return undefined;
    const guards = state.upgradeChanceGuards ||= [];
    const input = requestObject(body.rule), id = typeof input.id === 'string' ? input.id : '';
    const index = guards.findIndex(rule => rule.id === id);
    if (id && index < 0) return {status:404, body:{error:'Chance guard no longer exists'}};
    if (body.remove === true) return removeGuard(guards, index, persist);
    const error = validate(state, input);
    if (error) return {status:400, body:{error}};
    const next = guardFrom(id, input);
    const overlap = chanceGuardOverlap(guards, next);
    if (overlap) return {status:409, body:{error:`There is already a guard that covers +${overlap.floor} to +${overlap.ceiling}.`}};
    if (index < 0) guards.push(next); else guards[index] = next;
    persist(); return null;
  };
}
function guardFrom(id: string, input: Record<string, unknown>): UpgradeChanceGuard {
  return {id:id || randomUUID(), name:String(input.name), floor:Number(input.floor), ceiling:Number(input.ceiling),
    ...(input.minChance === undefined ? {} : {minChance:Number(input.minChance)}),
    ...(input.scrollGrade === undefined ? {} : {scrollGrade:Number(input.scrollGrade)})};
}
function removeGuard(guards: UpgradeChanceGuard[], index: number, persist: () => void): CommandOutcome {
  if (index < 0) return {status:400, body:{error:'Select a guard to remove'}};
  guards.splice(index, 1); persist(); return null;
}
function policyError(rule: Record<string, unknown>): string | null {
  if (rule.minChance === undefined && rule.scrollGrade === undefined) return 'Choose a minimum chance, a scroll grade, or both';
  if (rule.minChance !== undefined && !validMinChance(rule.minChance)) return 'Choose a minimum chance above 0% and up to 100%';
  if (rule.scrollGrade !== undefined && !validScrollGrade(rule.scrollGrade)) return 'Choose a scroll grade from 1 to 4';
  return null;
}
function validate(state: ChanceGuardsState, rule: Record<string, unknown>): string | null {
  const policy = policyError(rule);
  if (policy) return policy;
  const max = offeringMaximum(state, String(rule.name));
  if (!max || !Number.isSafeInteger(rule.floor) || !Number.isSafeInteger(rule.ceiling)) return 'Choose valid upgrade levels';
  if (Number(rule.floor) < 0 || Number(rule.floor) >= Number(rule.ceiling) || Number(rule.ceiling) > max) return 'Choose valid upgrade levels';
  return null;
}
