import type { InventoryEntry, Item } from "../contracts/item.ts";
import { autoItemRuleKey, sameMarkedItem } from "./item-identity.ts";

export interface UpgradeMark {
  passId?: string;
  slot?: number | string;
  item: Item;
  tiers: number;
  auto?: boolean;
  offering?: import("../../upgrade-offerings.ts").UpgradeOffering;
  requestId?: string;
  waitingOffering?: { offering: string; level: number; signature: string };
  equipped?: boolean;
  storage?: { pack: string; slot: number };
  storageReceived?: boolean;
}

type UpgradeRule = number | string | { tiers: number; quantity?: number };
type Rules = Readonly<Record<string, UpgradeRule | undefined>>;
type Inventory = readonly (InventoryEntry | null)[];
interface Reconciliation {
  marks: UpgradeMark[];
  changed: boolean;
}

function ruleTiers(rule: UpgradeRule | undefined): number {
  return Number(rule && typeof rule === "object" ? rule.tiers : rule);
}

function ruleQuantity(rule: UpgradeRule | undefined): number {
  return rule && typeof rule === "object" && Number.isSafeInteger(Number(rule.quantity))
    ? Number(rule.quantity)
    : -1;
}

function validUpgrade(mark: UpgradeMark, items: Inventory, rules: Rules, equipped: Equipment): boolean {
  if (!mark.auto) return true;

  const live = markedEntry(mark,items,equipped);
  if (!live?.item) return false;
  const start = Number(mark.item.level) || 0,
    level = Number(live.item.level) || 0;
  if (level < start || level > start + Number(mark.tiers)) return false;
  return (
    sameMarkedItem({ ...live.item, level: mark.item.level }, mark.item) &&
    activeRule(rules[autoItemRuleKey(mark.item)], mark.tiers)
  );
}

function quantitySatisfied(
  item: Item,
  tiers: number,
  quantity: number,
  _items: Inventory,
  marks: UpgradeMark[],
): boolean {
  if (quantity === -1) return false;
  void tiers;
  const marked = marks.filter(
    (mark) => mark.auto && autoItemRuleKey(mark.item) === autoItemRuleKey(item),
  ).length;
  return marked >= quantity;
}

function addUpgrade(
  entry: InventoryEntry & { item: Item },
  tiers: number,
  state: Reconciliation,
): void {
  const existing = state.marks.findIndex((mark) => !mark.equipped && mark.slot === entry.slot);
  const next: UpgradeMark = { slot: entry.slot, item: entry.item, tiers, auto: true };
  if (existing < 0) {
    state.marks.push(next);
    state.changed = true;
    return;
  }
  const old = state.marks[existing];
  if (
    old.auto &&
    sameMarkedItem(old.item, entry.item) &&
    old.tiers !== next.tiers
  ) {
    state.marks[existing] = next;
    state.changed = true;
  }
}

function considerUpgrade(
  entry: InventoryEntry | null,
  rules: Rules,
  items: Inventory,
  state: Reconciliation,
): void {
  if (!entry?.item || !Number.isSafeInteger(entry.slot)) return;
  const rule = rules[autoItemRuleKey(entry.item)],
    tiers = ruleTiers(rule);
  if (!Number.isSafeInteger(tiers) || tiers < 1 || !upgradeable(entry)) return;
  if (!quantitySatisfied(entry.item, tiers, ruleQuantity(rule), items, state.marks))
    addUpgrade({ ...entry, item: entry.item }, tiers, state);
}

/** Preserve the original starting item until its configured upgrade pass is resolved. */
export function reconcileUpgradeMarks(
  marks: UpgradeMark[],
  rules: Rules,
  items: Inventory,
  equipped: Equipment = {},
): Reconciliation {
  const before = JSON.stringify(marks);
  const claimed = new Set(marks.filter(mark => !mark.storage).map(mark => mark.slot));
  marks = marks.map(mark => {
    if (!mark.storage || !mark.storageReceived) return mark;
    const entry = items.find(entry => entry?.item && !claimed.has(entry.slot) && sameMarkedItem(entry.item, mark.item) && sameMarkedItem(mark.item, entry.item));
    if (!entry) return mark;
    claimed.add(entry.slot);
    const { storage: _storage, storageReceived: _received, ...ready } = mark;
    return { ...ready, slot: entry.slot };
  });
  const relocated = relocateUpgradeMarks(marks, items, rules, equipped);
  const retained = relocated.filter((mark) => validUpgrade(mark, items, rules, equipped));
  const state = { marks: retained, changed: JSON.stringify(retained) !== before };
  for (const entry of items) considerUpgrade(entry, rules, items, state);
  return state;
}

export function clearResolvedUpgradeMarks(
  marks: UpgradeMark[],
  resolved: readonly UpgradeMark[],
): UpgradeMark[] {
  const completed = new Set(resolved.map((mark) => mark.passId || JSON.stringify(mark)));
  const legacy = new Set(resolved.map(({passId: _id, ...mark}) => JSON.stringify(mark)));
  return marks.filter((mark) => !completed.has(mark.passId || JSON.stringify(mark)) &&
    (mark.passId || !legacy.has(JSON.stringify(mark))));
}

/** Keep matches already in place before assigning any displaced pass to a slot. */
function relocateUpgradeMarks(marks: UpgradeMark[], items: Inventory, rules: Rules, equipped: Equipment): UpgradeMark[] {
  const claimed = new Set(marks.filter(mark => !mark.equipped && validUpgrade(mark, items, rules, equipped)).map(mark => mark.slot));
  return marks.map(mark => {
    if (!mark.auto || mark.equipped || validUpgrade(mark, items, rules, equipped)) return mark;
    const candidates = items.filter(entry => entry && !claimed.has(entry.slot) &&
      validUpgrade({...mark, slot:entry.slot}, items, rules, equipped));
    if (candidates.length !== 1) return mark;
    const slot = candidates[0]!.slot;
    claimed.add(slot);
    return {...mark, slot};
  });
}

function activeRule(rule: UpgradeRule | undefined, tiers: number) { return ruleQuantity(rule) !== 0 && ruleTiers(rule) === Number(tiers); }
function upgradeable(entry: InventoryEntry) { return entry.meta?.upgradeable && !entry.item?.l && !entry.item?.b; }

type Equipment = Record<string, {item: Item} | null | undefined>;
function markedEntry(mark: UpgradeMark, items: Inventory, equipped: Equipment) {
  return mark.equipped ? equipped[String(mark.slot)] : items.find(entry => entry?.slot === mark.slot);
}
