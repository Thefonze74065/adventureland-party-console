import { hasMarkedWithdrawals } from './marked-withdrawals.ts';
import { requestObject } from '../http/contracts.ts';

export interface BankCollectionState {
  merchantCharacter: string | null;
  withdrawals?: Record<string, readonly unknown[] | undefined>;
  merchantAutomations?: Record<string, boolean | undefined>;
  itemCollectionThreshold?: number;
}

/** Count bank cells, not stack quantities or duplicate requests. Specialized
 * production/storage withdrawals retain their existing independent routines. */
export function markedBankSlots(state: BankCollectionState): number {
  const slots = new Set<string>();
  for (const value of state.withdrawals?.[String(state.merchantCharacter)] || []) {
    const request = requestObject(value);
    if (!hasMarkedWithdrawals([value])) continue;
    if (request.autoNpcRuleKey && state.merchantAutomations?.['auto npc sales'] === false) continue;
    slots.add(`${String(request.pack)}:${String(request.slot)}`);
  }
  return slots.size;
}

function automaticNpcRetrieval(state: BankCollectionState): boolean {
  return state.merchantAutomations?.['auto npc sales'] !== false &&
    (state.withdrawals?.[String(state.merchantCharacter)] || []).some(value =>
      requestObject(value).autoNpcRuleKey && hasMarkedWithdrawals([value]));
}

export function bankCollectionReason(state: BankCollectionState): 'withdrawals' | 'bank collection' | 'auto npc withdrawals' | null {
  const count = markedBankSlots(state);
  if (!count) return null;
  if (state.merchantAutomations?.withdrawals !== false) return 'withdrawals';
  // Auto NPC owns its bank prerequisite, even when ordinary retrieval is off.
  if (automaticNpcRetrieval(state)) return 'auto npc withdrawals';
  return state.merchantAutomations?.['party collection'] !== false && count >= (state.itemCollectionThreshold ?? 10)
    ? 'bank collection' : null;
}
