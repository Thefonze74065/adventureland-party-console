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
    // A genuine conflict (e.g. processing plus an NPC/stand sale rule) pauses both destinations until resolved.
    const conflicted = (mark: ItemMark) => !!mark.auto && !!mark.item && itemRuleConflicts(state, mark.item).length > 0;
    // Banking would move the item away from where processing needs it; the merchant destination already satisfies processing, so it only waits out real conflicts.
    const bankAllowed = (mark: ItemMark) => !conflicted(mark) && (!mark.auto || !mark.item || !processingPending(state, mark.item));
    const merchantAllowed = (mark: ItemMark) => !conflicted(mark);
    const bank = result.bank.filter(bankAllowed), merchant = result.merchant.filter(merchantAllowed);
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
