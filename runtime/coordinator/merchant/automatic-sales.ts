import { itemRuleConflicts } from "../inventory/shared-rules.ts";
import type { DeconstructionMark } from "./deconstruction.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { BankboiInventory } from '../inventory/bankboi-completion.ts';
import { availableCraftStock, craftProtection, type CraftReservationState } from "./craft-reservations.ts";
import { automaticCommerceRuleKey, sameMarkedItem } from "../inventory/item-identity.ts";
import { reconcileNpcSales, type NpcSale } from "./npc-sales.ts";
import type { StandMark } from "./stand-marks.ts";
import { reconcilePlayerSales, type PlayerSaleState } from "./player-npc-sales.ts";
import { bankCollectionReason } from './bank-collection.ts';
import { protectedMerchantStorageStock } from '../inventory/merchant-storage-stock.ts';
import { keptNpcSaleCopies, keptNpcSaleRule, npcSaleSpare } from './npc-sale-keep.ts';

interface AutomaticStandMark extends StandMark {
  auto?: boolean;
  autoRuleKey?: string;
}
interface SaleEntry {
  slot: number;
  item: Item;
}
interface SalesState extends PlayerSaleState, CraftReservationState {
  bankbois?: Record<string, Pick<BankboiInventory, 'name' | 'items'>>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  withdrawals?: Record<string, { pack?: string; slot?: number; item?: Item | null; standListingId?: string; autoNpcRuleKey?: string }[] | undefined>;
  itemCollectionThreshold?: number;
  standBids?: Record<string, { useStandSlot?: boolean } | undefined>;
  deconstructionMarks?: DeconstructionMark[];
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  autoStandMarks: Record<string, { price: unknown } | undefined>;
  npcSaleMarks: NpcSale[];
  standListings: AutomaticStandMark[];
  merchantCurrent?: NonNullable<CraftReservationState["merchantCurrent"]> & { reason?: string; target?: string | null } | null;
  merchantQueue: (NonNullable<CraftReservationState["merchantQueue"]>[number] & { reason?: string; target?: string | null })[];
}
interface SalesPorts {
  now(): number;
  nextCommand(): number;
  queue(names: (string | null)[], reason: string): void;
  publish(): void;
  syncStand(): boolean;
  idle(): void;
  persist(): void;
}

/** Materialize automatic sale intent, then recover runnable work from durable marks. */
export function createAutomaticMerchantSales(state: SalesState, ports: SalesPorts) {
  /** #116: a rule with `keep` sells only its spare stock. One allowance serves a whole marking pass. */
  function saleAllowance(): (key: string, quantity: number) => number {
    const kept = Object.keys(state.autoNpcSales).flatMap(key => { const rule = keptNpcSaleRule(state, key); return rule ? [[key, rule.keep] as const] : []; });
    if (!kept.length) return (_key, quantity) => quantity;
    const stock = protectedMerchantStorageStock(state);
    const spare = new Map(kept.map(([key, keep]) => [key, npcSaleSpare(state, key, keep, stock)] as const));
    return (key, quantity) => {
      const available = spare.get(key);
      if (available === undefined) return quantity;
      const allowed = Math.max(0, Math.min(quantity, available));
      spare.set(key, available - allowed);
      return allowed;
    };
  }
  function npcSalePending(entry: SaleEntry): boolean {
    return state.npcSaleMarks.some(
      (mark) =>
        mark.source === "merchant" &&
        mark.slot === entry.slot &&
        sameMarkedItem(entry.item, mark.item),
    );
  }
  function markNpcSale(entry: SaleEntry, key: string, quantity = Math.max(1, Number(entry.item.q) || 1)): boolean {
    if (npcSalePending(entry)) return false;
    state.npcSaleMarks.push({
      id: "auto-npc-sale-" + ports.now() + "-" + ports.nextCommand(),
      source: "merchant",
      slot: entry.slot,
      item: entry.item,
      quantity,
      state: "queued",
      auto: true,
      autoRuleKey: key,
      queuedAt: ports.now(),
    });
    return true;
  }

  function standReserved(item: Item): boolean {
    if (state.standListings.some(listing => listing.state === "paused" && sameMarkedItem(item, listing.item))) return true;
    const sales = state.standListings.filter(listing => listing.state !== "paused").length;
    return sales + Object.values(state.standBids || {}).filter(bid => bid?.useStandSlot).length >= 16;
  }
  function markStandSale(entry: SaleEntry, key: string, pack?: string): boolean {
    const rule = state.autoStandMarks[key];
    if (!rule || !Number.isSafeInteger(Number(rule.price)) || Number(rule.price) < 1) return false;
    const existing = state.standListings.find(
      (listing) =>
        listing.state !== "live" &&
        !listing.tradeSlot &&
        (pack ? listing.bankPack === pack && listing.bankSlot === entry.slot
          : !!listing.bankPack || listing.slot === entry.slot) &&
        sameMarkedItem(entry.item, listing.item),
    );
    if (existing || standReserved(entry.item)) return false;
    state.standListings.push({
      id: "auto-stand-" + ports.now() + "-" + ports.nextCommand(),
      slot: entry.slot,
      item: entry.item,
      price: Number(rule.price),
      quantity: Math.max(1, Number(entry.item.q) || 1),
      state: "configured",
      queuedAt: ports.now(),
      auto: true,
      autoRuleKey: key,
      ...(pack ? { bankPack: pack, bankSlot: entry.slot } : {}),
    });
    return true;
  }

  type BankEntry = InventoryEntry & SaleEntry & {craftLocation:string};
  function bankEntry(entry: (InventoryEntry & {craftLocation:string}) | null): entry is BankEntry {
    return !!entry?.item && !entry.item.l && Number.isSafeInteger(entry.slot);
  }
  function bankNpcEligible(entry: BankEntry, key: string): boolean {
    return !!state.autoNpcSales[key] && !state.autoStandMarks[key] && !saleConflict(entry.item) &&
      state.merchantAutomations?.['auto npc sales'] !== false;
  }
  function markBankNpc(entry: BankEntry, allow: ReturnType<typeof saleAllowance>): boolean {
    const key = automaticCommerceRuleKey(entry.item);
    if (!bankNpcEligible(entry, key)) return false;
    const pending = ((state.withdrawals ||= {})[state.merchantCharacter!] ||= []);
    if (pending.some(mark => mark.pack === entry.craftLocation && mark.slot === entry.slot && sameMarkedItem(mark.item, entry.item))) return false;
    // Withdrawals move whole stacks; the carried sale then sells only the spare part of one.
    if (!allow(key, Math.max(1, Number(entry.item.q) || 1))) return false;
    pending.push({pack: entry.craftLocation, slot: entry.slot, item: entry.item, autoNpcRuleKey:key});
    return true;
  }
  function bankNpcStacks():number {
    return (state.withdrawals?.[String(state.merchantCharacter)] || []).filter(mark=>mark.autoNpcRuleKey).length;
  }
  function bankNpcLimit():number {return Math.max(10,state.itemCollectionThreshold ?? 10);}
  function bankStandPending():boolean {
    return !!state.withdrawals?.[String(state.merchantCharacter)]?.some(mark=>mark.standListingId);
  }
  function markBankStock(): boolean {
    if (!bankStockReady()) return false;
    let changed = false, npcStacks = bankNpcStacks();
    const allow = saleAllowance();
    for (const entry of availableBankStock()) {
      if (!bankEntry(entry)) continue;
      if (npcStacks < bankNpcLimit() && markBankNpc(entry, allow)) {
        npcStacks++; changed = true;
        continue;
      }
      if (!bankStandEntry(entry)) continue;
      const key = automaticCommerceRuleKey(entry.item);
      if (!markStandSale(entry, key, entry.craftLocation)) continue;
      const listing = state.standListings[state.standListings.length - 1];
      const pending = ((state.withdrawals ||= {})[state.merchantCharacter!] ||= []);
      pending.push({ pack: listing.bankPack, slot: listing.bankSlot, item: listing.item, standListingId: listing.id });
      changed = true;
    }
    return changed;
  }
  function bankStockReady(): boolean {
    // A bank report can arrive during the merchant's own visit. Reserve its
    // sale stock now; the next job consumes these durable withdrawals.
    return !!state.merchantCharacter;
  }
  function availableBankStock() {
    const pending = state.withdrawals?.[String(state.merchantCharacter)] || [];
    const packs = [...Object.entries(state.bankSnapshot?.packs || {}),
      ...Object.values(state.bankbois || {}).map(worker => ['bankboi:' + worker.name, worker.items] as const)];
    const stock = packs.flatMap(([pack, entries]) =>
      (entries || []).map(entry => entry && !pending.some(mark => mark.pack === pack && mark.slot === entry.slot && sameMarkedItem(mark.item,entry.item)) ? { ...entry, craftLocation: pack } : null));
    // Withdrawals move whole stacks; leave partially reserved stacks untouched.
    return availableCraftStock(stock, craftProtection(state)).map((entry, index) =>
      entry?.item?.q === stock[index]?.item?.q ? entry : null);
  }
  function bankStandEntry(entry: (InventoryEntry & { craftLocation: string }) | null): entry is InventoryEntry & SaleEntry & { craftLocation: string } {
    if (state.merchantCurrent) return false;
    if (entry?.craftLocation.startsWith('bankboi:')) return false;
    if (!entry?.item || entry.item.l || !Number.isSafeInteger(entry.slot)) return false;
    return !state.autoNpcSales[automaticCommerceRuleKey(entry.item)] && !saleConflict(entry.item);
  }

  function deconstructionReserved(item: Item) {
    return state.deconstructionMarks?.some(mark => mark.owner === state.merchantCharacter &&
      mark.state !== "complete" && sameMarkedItem(item, mark.item));
  }
  function resumeDisplacedSales(items: readonly (SaleEntry | null)[]): boolean {
    const explicitBuys = Object.values(state.standBids || {}).filter(bid => bid?.useStandSlot).length;
    let available = 16 - explicitBuys - state.standListings.filter(listing => listing.state !== "paused").length;
    const claimed = new Set(state.standListings.filter(listing => listing.state !== "paused" && listing.state !== "live" && !listing.bankPack).map(listing => listing.slot));
    let changed = false;
    for (const listing of state.standListings.filter(entry => entry.state === "paused")) {
      if (available <= 0) break;
      const entry = items.find(candidate => resumableSale(candidate, listing, claimed));
      if (!entry) continue;
      listing.state = "configured";
      listing.slot = entry.slot;
      delete listing.tradeSlot;
      delete listing.bankPack;
      delete listing.bankSlot;
      claimed.add(entry.slot);
      available--;
      changed = true;
    }
    return changed;
  }
  function resumableSale(entry: SaleEntry | null, listing: AutomaticStandMark, claimed: Set<number | undefined>): entry is SaleEntry {
    return !!entry?.item && !entry.item.l && !claimed.has(entry.slot) &&
      sameMarkedItem(entry.item, listing.item) && !saleConflict(entry.item);
  }
  function markAutomaticNpc(entry: SaleEntry, key: string, allow: ReturnType<typeof saleAllowance>) {
    if (state.merchantAutomations?.['auto npc sales'] === false || npcSalePending(entry)) return false;
    const quantity = allow(key, Math.max(1, Number(entry.item.q) || 1));
    return quantity > 0 && markNpcSale(entry, key, quantity);
  }
  function saleConflict(item: Item) { return deconstructionReserved(item) || itemRuleConflicts(state,item).length > 0; }
  function markInventory(items: readonly (SaleEntry | null)[]) {
    // Resume displaced sales before admitting new automatic listings.
    let changed = resumeDisplacedSales(items),
      standChanged = changed;
    const allow = saleAllowance();
    for (const entry of items) {
      if (!entry?.item || !Number.isSafeInteger(entry.slot) || entry.item.l) continue;
      if (saleConflict(entry.item)) continue;
      const key = automaticCommerceRuleKey(entry.item);
      if (state.autoNpcSales[key]) {
        if (markAutomaticNpc(entry, key, allow)) changed = true;
      } else if (markStandSale(entry, key)) standChanged = changed = true;
    }
    return { changed, standChanged };
  }

  function queueSales(marks: NpcSale[], running: boolean) {
    for (const auto of [false, true]) {
      const reason = auto ? 'auto npc sales' : 'npc sales';
      if (auto && state.merchantAutomations?.[reason] === false) continue;
      const queued = state.merchantQueue.some(job => job.reason === reason && job.target === state.merchantCharacter);
      const runnable = marks.some(mark => Boolean(mark.auto) === auto && mark.source !== 'character' && mark.state !== 'blocked' && Number(mark.retryAt || 0) <= ports.now());
      if (runnable && !running && !queued) ports.queue([state.merchantCharacter], reason);
    }
  }
  function reconcileSales(items: readonly (SaleEntry | null)[]): boolean {
    const running = ["npc sales", "auto npc sales"].includes(state.merchantCurrent?.reason || '');
    const sales = reconcileNpcSales(state.npcSaleMarks, items, running, ports.now());
    for (const mark of sales.marks) if (mark.auto && itemRuleConflicts(state,mark.item).length) {
      mark.state = "blocked"; mark.error = "Conflicting automatic rules; choose an action in merchant settings"; sales.changed = true;
    }
    if (sales.changed) state.npcSaleMarks = sales.marks;
    queueSales(sales.marks, running);
    return sales.changed;
  }

  // #116: carried kept copies hold bank marks; a bank trip deposits them. Retry a full bank slowly.
  let keptBankAt = -Infinity;
  function keptCopiesCarried(items: readonly (SaleEntry | null)[]): boolean {
    if (state.merchantCurrent || state.merchantQueue.some(job => job.target === state.merchantCharacter) ||
        ports.now() - keptBankAt < 600000) return false;
    const kept = keptNpcSaleCopies(state);
    if (!items.some(entry => entry?.item && Number.isSafeInteger(entry.slot) && kept(entry))) return false;
    keptBankAt = ports.now();
    return true;
  }
  function queueBankTrip(items: readonly (SaleEntry | null)[]): void {
    const collection = bankCollectionReason(state);
    if (collection) ports.queue([state.merchantCharacter], collection);
    else if (keptCopiesCarried(items)) ports.queue([state.merchantCharacter], "manual bank exchange");
  }
  function resizeKeptSales(): boolean {
    // Shared party rules can deliver a whole stack with an existing sale mark.
    // Clamp that intent too; new-mark allowances alone cannot protect the reserve.
    let resized = false;
    if (Object.keys(state.autoNpcSales).some(key => keptNpcSaleRule(state, key)) &&
        !["npc sales", "auto npc sales"].includes(state.merchantCurrent?.reason || '')) {
      const stock = protectedMerchantStorageStock(state), remaining = new Map<string, number>();
      state.npcSaleMarks = state.npcSaleMarks.filter(mark => {
        if (!mark.auto || mark.source !== 'merchant') return true;
        const key = automaticCommerceRuleKey(mark.item), rule = keptNpcSaleRule(state, key);
        if (!rule) return true;
        if (!remaining.has(key)) {
          const held = stock.filter(entry => entry.item && automaticCommerceRuleKey(entry.item) === key)
            .reduce((sum, entry) => sum + (Number(entry.item?.q) || 1), 0);
          const manual = state.npcSaleMarks.filter(other => !other.auto && other.source === 'merchant' &&
            automaticCommerceRuleKey(other.item) === key).reduce((sum, other) => sum + other.quantity, 0);
          remaining.set(key, Math.max(0, held - rule.keep - manual));
        }
        const quantity = Math.min(mark.quantity, remaining.get(key)!);
        remaining.set(key, remaining.get(key)! - quantity);
        resized ||= quantity !== mark.quantity;
        mark.quantity = quantity;
        return quantity > 0;
      });
    }
    return resized;
  }
  function reconcileMerchant(items: readonly (SaleEntry | null)[]): boolean {
    const resized = resizeKeptSales();
    // Banked sales also reserve capacity against opportunistic buys.
    const marks = markInventory(items), bankChanged = markBankStock();
    const changed = reconcileSales(items) || marks.changed || bankChanged || resized;
    queueBankTrip(items);
    if (bankChanged && bankStandPending())
      ports.queue([state.merchantCharacter], "manual bank exchange");
    if (marks.standChanged || bankChanged) {
      ports.publish();
      if (!ports.syncStand()) ports.idle();
    }
    if (changed) ports.persist();
    return changed;
  }

  function reconcile(
    status: { name?: string; items?: (SaleEntry | null)[] } | null | undefined,
  ): boolean {
    if (!status?.name || !Array.isArray(status.items))
      return false;
    if (status.name !== state.merchantCharacter) {
      const changed = reconcilePlayerSales(state, { name: status.name, items: status.items }, ports);
      if (changed) ports.persist();
      return changed;
    }
    // Sales displaced by explicit buy orders wait for capacity, not forever.
    // Automatic buys are opportunistic and do not reserve capacity against sales.
    return reconcileMerchant(status.items);
  }
  return { reconcile };
}
