import type { InventoryEntry } from "../contracts/item.ts";

export interface CompoundRule {
  name: string;
  targetTier?: number;
  quantity?: number;
}
export interface ExchangeRule {
  name: string;
  level?: number;
}
export interface ExchangeChoice {
  id: string;
  level?: number;
  reward?: unknown;
  required?: number;
}
export interface ExchangeLine {
  id: string;
  level: number;
  quantity: number;
}
type Entries = readonly (InventoryEntry | null | undefined)[];

function itemLevel(entry: InventoryEntry): number {
  return Number(entry.item?.level) || 0;
}

function hasCompoundTriplet(entries: readonly InventoryEntry[], target: number): boolean {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    const level = itemLevel(entry);
    if (entry.item?.l || level >= target) continue;
    counts.set(level, (counts.get(level) || 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

/** Counts completed items, rather than stack quantity, as the existing compound contract requires. */
export function evaluateAutoCompounds(rules: readonly CompoundRule[], entries: Entries) {
  const completed: { rule: CompoundRule; target: number; quantity: number }[] = [];
  let runnable = false;
  const remaining = rules.filter((rule) => {
    const target = Math.max(1, Number(rule.targetTier) || 1);
    const quantity = Number.isSafeInteger(Number(rule.quantity)) ? Number(rule.quantity) : -1;
    const matching = entries.filter(
      (entry): entry is InventoryEntry => !!entry?.item && entry.item.name === rule.name,
    );
    if (quantity === 0) return true;
    if (hasCompoundTriplet(matching, target)) runnable = true;
    return true;
  });
  return { remaining, completed, runnable };
}

function exchangeQuantity(entries: Entries, rule: ExchangeRule, level: number): number {
  return entries.reduce((sum, entry) => {
    if (entry?.item?.name !== rule.name || itemLevel(entry) !== level || entry.item.l) return sum;
    return sum + (Number(entry.item.q) || 1);
  }, 0);
}

/** Plans only available complete exchanges; queue ownership stays with the scheduler. */
export function planAutoExchanges(
  rules: Readonly<Record<string, ExchangeRule>>,
  catalog: readonly ExchangeChoice[],
  entries: Entries,
) {
  const lines: ExchangeLine[] = [],
    keys: string[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    const level = Number(rule.level) || 0;
    const choice = catalog.find(
      (entry) => !entry.reward && entry.id === rule.name && (Number(entry.level) || 0) === level,
    );
    if (!choice) continue;
    const quantity = Math.floor(
      exchangeQuantity(entries, rule, level) / Math.max(1, Number(choice.required) || 1),
    );
    if (quantity <= 0) continue;
    lines.push({ id: rule.name, level, quantity });
    keys.push(key);
  }
  return { lines, keys };
}
