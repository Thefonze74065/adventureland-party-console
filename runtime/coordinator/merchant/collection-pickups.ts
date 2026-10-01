import type { InventoryEntry, Item, ItemMark } from '../contracts/item.ts';
import { requestObject } from '../http/contracts.ts';
import { itemRuleConflicts, ruleOwner, sharedMember, type ConflictState } from '../inventory/shared-rules.ts';
import { markedItem, sameMarkedItem } from '../inventory/item-identity.ts';
import { availableCraftStock, craftProtection, type CraftReservationState } from './craft-reservations.ts';

export interface PickupState extends ConflictState, CraftReservationState {
  statuses?: Record<string, {items?: (InventoryEntry | null)[]} | undefined>;
  merchantAutomations?: Record<string, boolean | undefined>;
  marked?: Record<string, unknown[] | undefined>;
  merchantMarked?: Record<string, unknown[] | undefined>;
  upgrades?: Record<string, unknown[] | undefined>;
  compounds?: Record<string, unknown[] | undefined>;
  statScrolls?: Record<string, unknown[] | undefined>;
  npcSaleMarks?: {id: string; auto?: boolean; source?: string; character?: string; state?: string}[];
}
function mark(value: unknown): ItemMark {
  const record = requestObject(value);
  const item = requestObject(record.item || record) as Item;
  return {...record, ...(record.item ? {item} : {}), slot: typeof record.slot === 'number' ? record.slot : undefined};
}
function enabled(state: PickupState, routine: string) { return state.merchantAutomations?.[routine] !== false; }
function automaticSale(state: PickupState, value: ItemMark): boolean {
  if (!value.npcSaleId) return true;
  return enabled(state, 'auto npc sales') && !itemRuleConflicts(state, markedItem(value) || {}).length && !!state.npcSaleMarks?.some(sale => sale.id === value.npcSaleId && sale.auto && sale.source === 'character' && sale.state !== 'blocked');
}
function manuallyReserved(state: PickupState, name: string, entry: InventoryEntry): boolean {
  const marks = [...(state.upgrades?.[name] || []).filter(value => !requestObject(value).auto), ...(state.statScrolls?.[name] || [])];
  for (const group of state.compounds?.[name] || []) {
    const items = requestObject(group).items;
    if (Array.isArray(items)) marks.push(...items);
  }
  return marks.some(value => { const wanted = mark(value); return wanted.slot === entry.slot || sameMarkedItem(wanted.item, entry.item); });
}
function upgradeMarks(state: PickupState, name: string): ItemMark[] {
  if (!enabled(state, 'auto upgrade')) return [];
  return (state.upgrades?.[name] || []).filter(value => {
    const m = requestObject(value); return m.auto && !m.equipped && typeof m.slot === 'number';
  }).map(mark);
}
function protectedEntry(state: PickupState, name: string, entry: InventoryEntry | null): boolean {
  return !entry?.item || personalTracker(entry.item) || !!entry.item.l || !!entry.item.b || manuallyReserved(state, name, entry) || itemRuleConflicts(state, entry.item).length > 0;
}
function personalTracker(item: Item | null | undefined): boolean { return item?.name === 'tracker' || item?.name === 'supercomputer'; }
function collectable(value: ItemMark): boolean { return !personalTracker(markedItem(value)); }
function processing(state: PickupState, name: string): ItemMark[] {
  if (name === state.merchantCharacter || !sharedMember(state, name)) return [];
  const rules = enabled(state, 'auto compound') ? state.autoCompounds?.[ruleOwner(state, name)] || [] : [];
  const upgrades = upgradeMarks(state, name);
  const stock = availableCraftStock((state.statuses?.[name]?.items || []).map((entry, index) => entry && {...entry, slot: entry.slot ?? index, craftLocation: 'inventory:' + name}), craftProtection(state));
  return stock.flatMap(entry => {
    if (protectedEntry(state, name, entry)) return [];
    const item = entry!.item!, slot = entry!.slot;
    const upgrade = upgrades.some(m => m.slot === slot && sameMarkedItem(m.item, item));
    const compound = rules.some(rule => rule.name === item.name && Number(rule.quantity) !== 0 && Number(item.level || 0) < Number(rule.targetTier || 1));
    return upgrade || compound ? [{slot, item, quantity: Number(item.q) || 1, automaticPickup: true}] : [];
  });
}
function manualSalePickups(state: PickupState, name: string) {
  const ids = new Set((state.npcSaleMarks || []).filter(sale => !sale.auto && sale.source === 'character' && sale.character === name && sale.state !== 'blocked').map(sale => sale.id));
  return {bank: [], keep: (state.merchantMarked?.[name] || []).map(mark).filter(value => collectable(value) && ids.has(String(value.npcSaleId)))};
}
/** Same selection drives counts, admission and the kept-item handoff. No processing payloads. */
export function collectionPickups(state: PickupState, name: string, reason = 'marked items') {
  if (reason === 'npc sale pickup') return manualSalePickups(state, name);
  const bank = (state.marked?.[name] || []).map(mark).filter(collectable);
  const keep = (state.merchantMarked?.[name] || []).map(mark).filter(value => collectable(value) && automaticSale(state, value));
  const occupied = bank.concat(keep);
  for (const pickup of processing(state, name)) {
    if (!occupied.some(value => value.slot === pickup.slot && sameMarkedItem(markedItem(value), pickup.item))) keep.push(pickup);
  }
  return {bank, keep};
}
