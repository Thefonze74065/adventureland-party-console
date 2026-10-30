import type { Item } from './coordinator/contracts/item.ts';

/**
 * Fail stacking (#152): deliberately burn spare copies of an item to build ugrace for a copy worth keeping.
 * A failed attempt adds ugrace at the attempted level and below, and +0.6 ograce when it used an offering.
 * A success resets that level's ugrace, so the spare copies must sit at the level being stacked.
 */
export const failStackMaxAttempts = 50;
export const failStackOffering = 'offeringp';
export interface FailStackRequest {
  /** The item being stacked for. It is measured, never consumed. */
  slot: number;
  item: Item;
  /** Exact name and level of the spare copies that may be destroyed. */
  sacrifice: { name: string; level: number };
  attempts: number;
  /** Stop once the target's preview chance reaches this fraction. */
  stopChance?: number;
  /** Spend a Primling on each sacrificial attempt (+0.6 ograce on failure). */
  offering: boolean;
  /** Measure the target's chance as if its own attempt used a Primling. */
  previewOffering: boolean;
}
export function validFailStackAttempts(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= failStackMaxAttempts;
}
export function validFailStackChance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}
/** Locked, bound or special (shiny, glitched, ...) copies, and the stacked item itself, are never eligible. */
export function sacrificeSlots(items: readonly (Item | null | undefined)[], request: Pick<FailStackRequest, 'sacrifice'>, targetSlot: number): number[] {
  const slots: number[] = [];
  items.forEach((item, slot) => {
    if (slot !== targetSlot && item && item.name === request.sacrifice.name && (Number(item.level) || 0) === request.sacrifice.level &&
      !item.l && !item.b && !item.p && !item.q) slots.push(slot);
  });
  return slots;
}
/** Null measures nothing, so only the attempt limit stops the run. */
export function reachedStopChance(request: Pick<FailStackRequest, 'stopChance'>, chance: number) {
  return request.stopChance !== undefined && chance >= request.stopChance;
}
