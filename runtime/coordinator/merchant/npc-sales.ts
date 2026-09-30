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

// An upgrade, stat re-roll, or other identity-changing edit leaves the old auto
// mark's stored item permanently unable to match anything live (sameMarkedItem
// compares every non-transient field), while a fresh, correctly-identified mark
// for the item's new form gets created and sells normally on the next scan.
// Give a real, still-recoverable block (e.g. a transient missing-inventory
// report) time to resolve before treating a stuck auto mark as an orphan.
const autoOrphanGraceMs = 5 * 60 * 1000;

function clearBlocked(mark: NpcSale): void {
  if (mark.state !== "blocked") return;
  mark.retryAt = 0;
  mark.error = null;
  delete mark.blockedInventory;
  delete mark.blockedAt;
}

function reconcileInventory(
  mark: NpcSale,
  inventory: Inventory,
  used: Map<number, number>,
  signature: string,
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
    mark.state = "blocked";
    mark.error = entry ? "Item is locked" : "Marked item is not in merchant inventory";
    mark.blockedInventory = signature;
    return "blocked";
  }
  used.set(entry.slot, (used.get(entry.slot) || 0) + mark.quantity);
  mark.slot = entry.slot;
  clearBlocked(mark);
  return "ready";
}

function orphanedAutoMark(mark: NpcSale, now: number): boolean {
  return !!mark.auto && mark.error === "Marked item is not in merchant inventory" &&
    now - (mark.blockedAt || now) > autoOrphanGraceMs;
}

function reconcileMerchantMark(
  mark: NpcSale,
  inventory: Inventory,
  used: Map<number, number>,
  signature: string,
  now: number,
): NpcSale | null {
  const result = reconcileInventory(mark, inventory, used, signature);
  if (result === "duplicate") return null;
  if (result === "blocked") {
    mark.blockedAt ??= now;
    return orphanedAutoMark(mark, now) ? null : mark;
  }
  mark.state = (mark.retryAt || 0) > now ? "retrying" : "queued";
  return mark;
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
  if (mark.state === "blocked" && mark.blockedInventory === signature)
    return orphanedAutoMark(mark, now) ? null : mark;
  if (mark.source === "merchant") return reconcileMerchantMark(mark, inventory, used, signature, now);
  clearBlocked(mark);
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
