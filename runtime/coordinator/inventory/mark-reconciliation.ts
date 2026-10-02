import { availableCraftStock, craftProtection, type CraftReservationState } from "../merchant/craft-reservations.ts";
import { ruleOwner, itemRuleConflicts, processingPending, type ConflictState } from "./shared-rules.ts";
import { reconcileCollectionMarks } from "./collection-marks.ts";
import { reconcileUpgradeMarks, clearResolvedUpgradeMarks } from "./upgrade-marks.ts";
import type { InventoryEntry, ItemMark } from "../contracts/item.ts";
import type { UpgradeMark } from "./upgrade-marks.ts";

interface CollectionState extends ConflictState {
  marked: Record<string, ItemMark[] | undefined>;
  merchantMarked: Record<string, ItemMark[] | undefined>;
  autoItemMarks: Record<string, Parameters<typeof reconcileCollectionMarks>[2] | undefined>;
}
interface UpgradeState extends ConflictState, CraftReservationState {
  upgrades: Record<string, UpgradeMark[] | undefined>;
  autoUpgradeMarks: Record<string, Parameters<typeof reconcileUpgradeMarks>[1] | undefined>;
}
interface InventoryStatus {
  upgradeInventoryBusy?: boolean;
  items?: unknown;
  slots?: Record<string, {item: import("../contracts/item.ts").Item} | null | undefined>;
}

function inventory(status: InventoryStatus | null | undefined): readonly (InventoryEntry | null)[] {
  return Array.isArray(status?.items) ? status.items : [];
}

/** Write both collection destinations back together, preserving the reconciler's manual-mark identities. */
export function reconcileCoordinatorCollectionMarks(
  state: CollectionState,
  name: string,
  status?: InventoryStatus | null,
): boolean {
  const result = reconcileCollectionMarks(
    state.marked[name] || [],
    state.merchantMarked[name] || [],
    state.autoItemMarks[ruleOwner(state, name)] || {},
    inventory(status),
  );
  if (state.merchantRules) {
    const allowed = (mark: ItemMark) => !mark.auto || !mark.item || !itemRuleConflicts(state, mark.item).length;
    // Processing needs stock at the merchant, including copies not yet claimed
    // by a finite rule. Only banking competes with that destination.
    const bank = result.bank.filter(mark => allowed(mark) && (!mark.auto || !mark.item || !processingPending(state, mark.item)));
    const merchant = result.merchant.filter(allowed);
    result.changed ||= bank.length !== result.bank.length || merchant.length !== result.merchant.length;
    result.bank = bank; result.merchant = merchant;
  }
  state.marked[name] = result.bank;
  state.merchantMarked[name] = result.merchant;
  return result.changed;
}

export function reconcileCoordinatorUpgradeMarks(
  state: UpgradeState,
  name: string,
  status?: InventoryStatus | null,
): boolean {
  // Lucky-slot swaps and recovery temporarily hide the item at its source slot.
  // This is not evidence that the item broke or its target was cancelled.
  if (!Array.isArray(status?.items) || status.upgradeInventoryBusy) return false;
  const result = reconcileUpgradeMarks(
    state.upgrades[name] || [],
    state.autoUpgradeMarks[ruleOwner(state, name)] || {},
    availableCraftStock(inventory(status).map(entry => entry && {...entry,craftLocation:"inventory:"+name}), craftProtection(state)).map(entry => entry?.item && itemRuleConflicts(state, entry.item).length ? null : entry),
    status?.slots,
  );
  state.upgrades[name] = result.marks;
  return result.changed;
}

/** Remove only the resolved pass; retain newer or unrelated upgrade requests. */
export function clearCoordinatorResolvedUpgrades(
  state: Pick<UpgradeState, "upgrades">,
  name: string,
  resolved: readonly UpgradeMark[],
): void {
  state.upgrades[name] = clearResolvedUpgradeMarks(state.upgrades[name] || [], resolved);
}
