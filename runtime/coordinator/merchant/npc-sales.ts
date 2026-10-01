import { sameMarkedItem } from "../inventory/item-identity.ts";
import type { Item } from "../contracts/item.ts";

export interface NpcSale {
  id: string;
  source: string;
  character?: string;
  receivedAt?: number;
  slot: number;
  item: Item;
  quantity: number;
  state?: string;
  error?: string | null;
  retryAt?: number;
  retryCount?: number;
  blockedInventory?: string;
  blockedAt?: number;
  auto?: boolean;
  autoRuleKey?: string;
  queuedAt?: number;
}
type Inventory = readonly ({ slot: number; item: Item } | null)[];
const identity = (a: Item, b: Item) =>
  sameMarkedItem({ ...a, l: undefined }, { ...b, l: undefined });
export const readyNpcSales = (marks: NpcSale[], now: number) =>
  marks.filter((mark) => mark.source !== "character" && mark.state !== "blocked" && (mark.retryAt || 0) <= now);

function clearBlocked(mark: NpcSale): void {
  if (mark.state !== "blocked") return;
  mark.retryAt = 0;
  mark.error = null;
  delete mark.blockedInventory;
  delete mark.blockedAt;
}

function blockInventory(mark: NpcSale, locked: boolean, signature: string, now: number): void {
  if (locked) delete mark.blockedAt;
  else mark.blockedAt ??= now;
  mark.state = 'blocked';
  mark.error = locked ? 'Item is locked' : 'Marked item is not in merchant inventory';
  mark.blockedInventory = signature;
}

function retainBlocked(mark: NpcSale, now: number): NpcSale | null {
  if (mark.error !== 'Marked item is not in merchant inventory') {
    delete mark.blockedAt;
    return mark;
  }
  mark.blockedAt ??= now;
  return mark.auto && now - mark.blockedAt > 300_000 ? null : mark;
}

function reconcileInventory(
  mark: NpcSale,
  inventory: Inventory,
  used: Map<number, number>,
  signature: string,
  now: number,
): "duplicate" | "blocked" | "ready" {
  const matches = inventory.filter(
    (entry): entry is NonNullable<Inventory[number]> => !!entry && identity(entry.item, mark.item),
  );
  const available = (entry: NonNullable<Inventory[number]>) => !used.has(entry.slot) ||
    (!!mark.character && (used.get(entry.slot) || 0) < (Number(entry.item.q) || 1));
  const entry =
    matches.find((entry) => entry.slot === mark.slot && available(entry)) || matches.find(available);
  if (!entry && matches.length && !mark.character) return "duplicate";
  if (!entry || entry.item.l) {
    blockInventory(mark, !!entry, signature, now);
    return "blocked";
  }
  used.set(entry.slot, (used.get(entry.slot) || 0) + mark.quantity);
  mark.slot = entry.slot;
  clearBlocked(mark);
  return "ready";
}

function reconcileMark(
  original: NpcSale,
  inventory: Inventory,
  used: Map<number, number>,
  signature: string,
  running: boolean,
  now: number,
): NpcSale | null {
  const mark = { ...original };
  if (mark.source === "character") return mark;
  if (running) {
    mark.state = "running";
    return mark;
  }
  if (mark.state === "blocked" && mark.blockedInventory === signature) return retainBlocked(mark, now);
  if (mark.source === "merchant") {
    const result = reconcileInventory(mark, inventory, used, signature, now);
    if (result === "duplicate") return null;
    if (result === "blocked") return retainBlocked(mark, now);
  } else clearBlocked(mark);
  mark.state = (mark.retryAt || 0) > now ? "retrying" : "queued";
  return mark;
}

/** Rebuild runnable work from durable intent; a missing job must not strand a mark. */
export function reconcileNpcSales(
  marks: NpcSale[],
  inventory: Inventory,
  running: boolean,
  now: number,
) {
  const signature = JSON.stringify(inventory.map((entry) => entry && [entry.slot, entry.item]));
  const used = new Map<number, number>(),
    retained: NpcSale[] = [];
  for (const original of marks) {
    const mark = reconcileMark(original, inventory, used, signature, running, now);
    if (mark) retained.push(mark);
  }
  return {
    marks: retained,
    changed: JSON.stringify(marks) !== JSON.stringify(retained),
    runnable: readyNpcSales(retained, now).length > 0,
  };
}

export function failNpcSales(marks: NpcSale[], ids: readonly string[], error: string, now: number) {
  return marks.map((mark) => {
    if (!ids.includes(mark.id)) return mark;
    const retryCount = (mark.retryCount || 0) + 1;
    return {
      ...mark,
      state: "retrying",
      error,
      retryCount,
      retryAt: now + [5000, 15000, 30000, 60000][Math.min(3, retryCount - 1)]!,
    };
  });
}
