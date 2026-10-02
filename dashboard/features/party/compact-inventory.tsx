"use client";
import { InventoryEntry } from "./inventory-entry";

export const compactInventory = (items: (InventoryEntry | null)[], size = items.length) => {
  const occupied = items.filter((entry): entry is InventoryEntry => entry !== null);
  const pinned = occupied.find(entry => entry.slot === size - 1 &&
    ['tracker', 'supercomputer'].includes(entry.item.name));
  if (pinned) {
    const normal = occupied.filter(entry => entry !== pinned && entry.slot < size);
    const overflow = occupied.filter(entry => entry.slot >= size);
    return [...normal, ...Array<null>(Math.max(0, size - 1 - normal.length)).fill(null), pinned, ...overflow];
  }
  return [...occupied, ...Array<null>(Math.max(0, items.length - occupied.length)).fill(null)];
};
