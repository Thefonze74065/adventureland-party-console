import type { Item, ItemMark } from '../contracts/item.ts';
import { autoItemRuleKey, automaticCommerceRuleKey } from './item-identity.ts';
import { ruleOwner, type SharedScope } from './shared-rules.ts';

export type AutomaticAction = 'bank' | 'merchant' | 'upgrade' | 'compound' | 'npc' | 'stand' | 'exchange' | 'deconstruction';
export interface AutomaticActionState extends SharedScope {
  autoItemMarks?: Record<string, Record<string, unknown> | undefined>;
  autoUpgradeMarks?: Record<string, Record<string, unknown> | undefined>;
  autoCompounds?: Record<string, { name: string; quantity?: number; targetTier?: number }[] | undefined>;
  autoNpcSales?: Record<string, { item: Item; character?: string }>;
  autoStandMarks?: Record<string, { item: Item }>;
  autoExchanges?: Record<string, unknown>;
  autoDeconstruction?: Record<string, Record<string, { item: Item }>>;
  marked?: Record<string, ItemMark[] | undefined>;
  merchantMarked?: Record<string, ItemMark[] | undefined>;
  upgrades?: Record<string, { auto?: boolean; item: Item }[] | undefined>;
  npcSaleMarks?: { id?: string; auto?: boolean; autoRuleKey?: string }[];
  standListings?: { id?: string; auto?: boolean; autoRuleKey?: string }[];
  deconstructionMarks?: { id?: string; auto?: boolean; item?: Item; owner?: string }[];
  withdrawals?: Record<string, { item?: Item | null; standListingId?: string }[] | undefined>;
  merchantQueue?: { reason: string; autoExchangeKeys?: string[]; exchanges?: { id: string; level?: number }[] }[];
  merchantCurrent?: { reason: string; itemMarksCleared?: boolean } | null;
}

interface Selection {
  state: AutomaticActionState;
  owner: string;
  members: string[];
  item: Item;
  key: string;
  commerce: string;
  removed: Set<string>;
  changed: boolean;
}
function drop(selected: Selection, record: Record<string, unknown> | undefined, key: string): void {
  if (!record || !Object.hasOwn(record, key)) return;
  delete record[key];
  selected.changed = true;
}
function clearCollection(selected: Selection): void {
  const { state, owner, key, item } = selected;
  drop(selected, state.autoItemMarks?.[owner], key);
  if (!Number(item.level)) drop(selected, state.autoItemMarks?.[owner], String(item.name));
  for (const member of selected.members) for (const field of [state.marked, state.merchantMarked]) {
    if (!field?.[member]) continue;
    field[member] = field[member]!.filter(mark => !(mark.auto && autoItemRuleKey(mark.item) === key));
  }
}
function clearUpgrades(selected: Selection): void {
  const { state, owner, key } = selected;
  drop(selected, state.autoUpgradeMarks?.[owner], key);
  for (const member of selected.members) if (state.upgrades?.[member])
    state.upgrades[member] = state.upgrades[member]!.filter(mark => !(mark.auto && autoItemRuleKey(mark.item) === key));
}
function clearCompounds(selected: Selection): void {
  const { state, owner, item } = selected;
  const rules = state.autoCompounds?.[owner];
  if (!rules || !state.autoCompounds) return;
  state.autoCompounds[owner] = rules.filter(rule => rule.name !== item.name);
  selected.changed ||= rules.length !== state.autoCompounds[owner]!.length;
}
function rememberRemoved(selected: Selection, mark: { id?: string }): void {
  if (mark.id) selected.removed.add(mark.id);
}
function clearNpc(selected: Selection): void {
  const { state, owner, commerce } = selected;
  for (const [id, rule] of Object.entries(state.autoNpcSales || {})) {
    if ((rule.character || state.merchantCharacter) !== owner || automaticCommerceRuleKey(rule.item) !== commerce) continue;
    drop(selected, state.autoNpcSales, id);
    selected.removed.add(id);
  }
  state.npcSaleMarks = state.npcSaleMarks?.filter(mark => {
    if (!(mark.auto && selected.removed.has(mark.autoRuleKey || ''))) return true;
    rememberRemoved(selected, mark);
    return false;
  });
}
function clearStand(selected: Selection): void {
  const { state, owner, commerce } = selected;
  if (owner !== state.merchantCharacter) return;
  drop(selected, state.autoStandMarks, commerce);
  state.standListings = state.standListings?.filter(mark => {
    if (!(mark.auto && mark.autoRuleKey === commerce)) return true;
    rememberRemoved(selected, mark);
    return false;
  });
}
function clearDeconstruction(selected: Selection): void {
  const { state, owner, commerce } = selected;
  drop(selected, state.autoDeconstruction?.[owner], commerce);
  state.deconstructionMarks = state.deconstructionMarks?.filter(mark => {
    if (!(mark.auto && selected.members.includes(mark.owner || '') && automaticCommerceRuleKey(mark.item) === commerce)) return true;
    rememberRemoved(selected, mark);
    return false;
  });
}
function clearExchange(selected: Selection): void {
  const { state, owner, item } = selected;
  if (owner !== state.merchantCharacter) return;
  const key = `${item.name}@${Number(item.level) || 0}`;
  drop(selected, state.autoExchanges, key);
  state.merchantQueue = state.merchantQueue?.filter(job => {
    if (job.reason !== 'exchange' || !job.autoExchangeKeys?.includes(key)) return true;
    job.autoExchangeKeys = job.autoExchangeKeys.filter(id => id !== key);
    job.exchanges = job.exchanges?.filter(line => `${line.id}@${Number(line.level) || 0}` !== key);
    return job.autoExchangeKeys.length > 0;
  });
}
function clearReservations(selected: Selection): void {
  const { state, removed } = selected;
  for (const [member, marks] of Object.entries(state.merchantMarked || {}))
    state.merchantMarked![member] = marks?.filter(mark => !removedReservation(mark, removed));
  for (const [member, entries] of Object.entries(state.withdrawals || {}))
    state.withdrawals![member] = entries?.filter(entry => !removed.has(entry.standListingId || ''));
}
function removedReservation(mark: ItemMark, removed: Set<string>): boolean {
  return [mark.npcSaleId, mark.deconstructionId].some(id => typeof id === 'string' && removed.has(id));
}
/** Select one automatic action, retiring old reservations as well as their rules. */
export function replaceAutomaticAction(state: AutomaticActionState, name: string, item: Item, keep: AutomaticAction): void {
  const selected: Selection = { state, owner: ruleOwner(state, name), members: state.merchantRules?.members || [name],
    item, key: autoItemRuleKey(item), commerce: automaticCommerceRuleKey(item), removed: new Set(), changed: false };
  const removers = { bank: clearCollection, upgrade: clearUpgrades, compound: clearCompounds,
    npc: clearNpc, stand: clearStand, exchange: clearExchange, deconstruction: clearDeconstruction };
  for (const [action, remove] of Object.entries(removers)) {
    if (action === keep || action === 'bank' && keep === 'merchant') continue;
    remove(selected);
  }
  clearReservations(selected);
  if (selected.changed && state.merchantCurrent) state.merchantCurrent.itemMarksCleared = true;
}
function upgradePending(state: AutomaticActionState, owner: string, item: Item): boolean {
  const rule = state.autoUpgradeMarks?.[owner]?.[autoItemRuleKey(item)];
  if (!rule) return false;
  return typeof rule !== 'object' || Number((rule as { quantity?: number }).quantity) !== 0;
}
function compoundPending(state: AutomaticActionState, owner: string, item: Item): boolean {
  return !!state.autoCompounds?.[owner]?.some(rule => rule.name === item.name && Number(rule.quantity) !== 0 &&
    Number(item.level || 0) < Number(rule.targetTier || 1));
}
/** Unmarked exchange rewards go to storage; explicit processing/sale rules stay carried. */
export function exchangeRewardAction(state: AutomaticActionState, item: Item): AutomaticAction {
  const owner = String(state.merchantCharacter), commerce = automaticCommerceRuleKey(item);
  const choices: [AutomaticAction, boolean][] = [
    ['exchange', !!state.autoExchanges?.[`${item.name}@${Number(item.level) || 0}`]],
    ['npc', !!state.autoNpcSales?.[commerce]],
    ['stand', !!state.autoStandMarks?.[commerce]],
    ['upgrade', upgradePending(state, owner, item)],
    ['compound', compoundPending(state, owner, item)],
    ['deconstruction', !!state.autoDeconstruction?.[owner]?.[commerce]],
  ];
  return choices.find(([, active]) => active)?.[0] || 'bank';
}
