import type { StandBid } from "./bids.ts";
import type { Item } from "../contracts/item.ts";

export interface NativeOffer {
  token: string;
  itemId: string;
  slot: string;
  revision: number;
  level: number;
  price: number;
  quantity: number;
  acknowledged: number;
  rid?: string;
  auto: boolean;
  phase: "placing" | "live" | "removing" | "blocked";
  problem?: string;
  retryAt?: number;
}
export interface NativeStandLedger {
  sequence: number;
  purchases?: Record<string, { item: Item; quantity: number; jobId: string }>;
  offers: Record<string, NativeOffer>;
  problems: Record<string, string>;
}
export interface NativeStandState {
  standBids: Record<string, StandBid | undefined>;
  standListings?: { id: string; state?: string; item?: Item | null; price?: number; quantity?: number }[];
  nativeStand?: NativeStandLedger;
  autoStandBuys?: boolean;
  bankSnapshot?: { gold?: number } | null;
  merchantRoutinePriorities?: Record<string, number>;
  merchantCatalog?: { allItems?: { id: string; upgradeable?: boolean; compoundable?: boolean }[] } | null;
}
export function nativeLedger(state: NativeStandState): NativeStandLedger {
  return state.nativeStand ||= { sequence: 0, offers: {}, problems: {} };
}
export function nativeAllocation(state: NativeStandState): { itemId: string; auto: boolean }[] {
  const entries = Object.entries(state.standBids).filter((entry): entry is [string, StandBid] => !!entry[1] && entry[1].quantity > 0);
  const priority = (bid: StandBid) => bid.priorityOverride ?? state.merchantRoutinePriorities?.["stand bid purchases"] ?? 75;
  entries.sort(([a, first], [b, second]) => priority(second) - priority(first) || a.localeCompare(b));
  const explicit = entries.filter(([, bid]) => bid.useStandSlot).map(([itemId]) => ({ itemId, auto: false }));
  const sales = (state.standListings || []).filter(sale => sale.state !== "paused").length;
  const spare = Math.max(0, 16 - sales - explicit.length);
  const automatic = state.autoStandBuys ? entries.filter(([, bid]) => !bid.useStandSlot && !bid.standSuppressed)
    .slice(0, spare).map(([itemId]) => ({ itemId, auto: true })) : [];
  return explicit.concat(automatic).slice(0, 16);
}
export function nativeOccupants(state: NativeStandState, except: string) {
  return [
    ...(state.standListings || []).filter(sale => sale.state !== "paused").map(sale => ({ id: "sale:" + sale.id, itemId: sale.item?.name, kind: "sale", price: sale.price, quantity: sale.quantity })),
    ...Object.entries(state.standBids).filter(([id, bid]) => id !== except && bid?.useStandSlot)
      .map(([id, bid]) => ({ id: "buy:" + id, itemId: id, kind: "buy", price: bid!.price, quantity: bid!.quantity })),
  ];
}
export function displaceNativeOccupant(state: NativeStandState, id: string): void {
  if (id.startsWith("sale:")) {
    const sale = state.standListings?.find(entry => entry.id === id.slice(5));
    if (sale) sale.state = "paused";
  } else {
    const bid = state.standBids[id.slice(4)];
    if (bid) { bid.useStandSlot = false; bid.standSuppressed = true; }
  }
}
export interface NativeObservation {
  slots: Record<string, Item | null | undefined>;
  open: boolean;
  receipts?: Record<string, number>;
  removed?: string;
  failed?: string;
  gold?: number;
  space?: boolean;
}
function matches(offer: NativeOffer, item: Item | null | undefined): boolean {
  return !!item?.b && item.name === offer.itemId && Number(item.level || 0) === offer.level && Number(item.price) === offer.price;
}
function block(offer: NativeOffer, problem: string): void {
  if (!offer.rid && offer.phase !== "blocked") offer.retryAt = Date.now() + 10000;
  offer.phase = "blocked"; offer.problem = problem;
}
function fillEvidence(offer: NativeOffer, observation: NativeObservation): number {
  const item = observation.slots[offer.slot];
  const receipt = Number(observation.receipts?.[offer.token]) || 0;
  const slotFill = matches(offer, item) && String(item!.rid) === offer.rid ? offer.quantity - Number(item!.q || 1) : 0;
  return Math.max(offer.acknowledged, Math.min(offer.quantity, receipt), slotFill);
}
/** Each offer owns a bounded batch. Only matching offer quantities or trade receipts are fill evidence. */
export function createNativeStand(state: NativeStandState, fulfill: (item: Item, quantity: number) => unknown) {
  function acknowledge(offer: NativeOffer, observation: NativeObservation): number {
    const filled = fillEvidence(offer, observation), delta = filled - offer.acknowledged;
    if (delta <= 0) return filled;
    offer.acknowledged = filled;
    const bid = state.standBids[offer.itemId];
    if (bid && Number(bid.revision || 0) === offer.revision) fulfill({ name: offer.itemId, level: offer.level }, delta);
    return filled;
  }
  function adopt(offer: NativeOffer, item: Item | null | undefined): void {
    if (offer.rid || !matches(offer, item) || Number(item!.q || 1) > offer.quantity) return;
    offer.rid = String(item!.rid); offer.phase = "live";
  }
  function removed(offer: NativeOffer, observation: NativeObservation): boolean {
    return observation.removed === offer.token && offer.phase === "removing" && !observation.slots[offer.slot];
  }
  function recoverConfirmed(offer: NativeOffer, item: Item | null | undefined): void {
    if (!matches(offer, item) || String(item!.rid) !== offer.rid || offer.phase !== "blocked") return;
    offer.phase = "live"; delete offer.problem;
  }
  function reconcileIdentity(offer: NativeOffer, observation: NativeObservation): boolean {
    // Reopening can move trade slots. Follow the native identity before comparing slots.
    const relocated = Object.entries(observation.slots).find(([, item]) => matches(offer, item) && (offer.rid ? String(item!.rid) === offer.rid : Number(item!.q || 1) <= offer.quantity));
    if (relocated) offer.slot = relocated[0];
    const item = observation.slots[offer.slot];
    adopt(offer, item);
    recoverConfirmed(offer, item);
    if (item && (!matches(offer, item) || String(item.rid) !== offer.rid)) {
      // Receipts remain valid evidence; a different native identity is not a fill.
      acknowledge(offer, observation);
      if (matches(offer, item)) {
        offer.rid = String(item.rid);
        offer.quantity = offer.acknowledged + Number(item.q || 1);
        offer.phase = "live"; delete offer.problem;
      } else delete nativeLedger(state).offers[offer.token];
      return true;
    }
    return false;
  }
  function retryUnconfirmed(offer: NativeOffer, observation: NativeObservation): boolean {
    if (observation.slots[offer.slot] || offer.rid || offer.phase !== "blocked" || observation.failed === offer.token || Date.now() < Number(offer.retryAt || 0)) return false;
    // A reservation without a native identity is not an established advertisement.
    // Apply any receipts first, then release the empty reservation without inferring a fill.
    acknowledge(offer, observation);
    delete nativeLedger(state).offers[offer.token];
    return true;
  }
  function observeOffer(offer: NativeOffer, observation: NativeObservation): void {
    if (!observation.open) { acknowledge(offer, observation); return; }
    if (reconcileIdentity(offer, observation)) return;
    const item = observation.slots[offer.slot];
    if (retryUnconfirmed(offer, observation)) return;
    const filled = acknowledge(offer, observation);
    if (filled === offer.quantity || removed(offer, observation)) {
      delete nativeLedger(state).offers[offer.token]; return;
    }
    if (observation.failed === offer.token) block(offer, "Native offer operation was not confirmed");
    if (observation.open && !item) block(offer, offer.rid ? "Offer disappeared without a confirmed fill/removal; reconciliation required" : "WTB placement not confirmed; retrying");
  }
  function observe(observation: NativeObservation): void {
    for (const offer of Object.values(nativeLedger(state).offers)) observeOffer(offer, observation);
  }
  function wanted(offer: NativeOffer, allocation: ReturnType<typeof nativeAllocation>): boolean {
    const bid = state.standBids[offer.itemId];
    return !!bid && allocation.some(entry => entry.itemId === offer.itemId) &&
      Number(bid.revision || 0) === offer.revision && bid.price === offer.price &&
      Number(bid.minimumQuality || 0) === offer.level && bid.quantity >= offer.quantity - offer.acknowledged;
  }
  function reserve(entry: { itemId: string; auto: boolean }, slot: string): NativeOffer {
    const ledger = nativeLedger(state), bid = state.standBids[entry.itemId]!;
    const definition = state.merchantCatalog?.allItems?.find(item => item.id === entry.itemId);
    const quantity = Math.min(bid.quantity, definition?.upgradeable || definition?.compoundable ? 99 : 9999);
    const token = "native-" + ++ledger.sequence;
    return ledger.offers[token] = { token, ...entry, slot, revision: Number(bid.revision || 0), level: Number(bid.minimumQuality || 0),
      price: bid.price, quantity, acknowledged: 0, phase: "placing" };
  }
  function placementProblem(itemId: string, observation: NativeObservation): string | null {
    const bid = state.standBids[itemId]!;
    if (Number(bid.minimumQuality || 0) > 12 || bid.price > 99999999999) return "Native stand terms exceed the game's level or price limit";
    if (observation.space === false) return "Insufficient inventory space";
    if (Number(observation.gold) < bid.price) return Number(observation.gold) + Number(state.bankSnapshot?.gold || 0) >= bid.price
      ? "Waiting for merchant to withdraw bank gold" : "Insufficient merchant and bank gold";
    return null;
  }
  function freeSlot(observation: NativeObservation): string | undefined {
    return Array.from({ length: 16 }, (_, i) => "trade" + (i + 1)).find(key => !observation.slots[key] && !Object.values(nativeLedger(state).offers).some(offer => offer.slot === key));
  }
  function creation(allocation: ReturnType<typeof nativeAllocation>, observation: NativeObservation): NativeOffer[] {
    const ledger = nativeLedger(state);
    for (const entry of allocation) {
      const problem = placementProblem(entry.itemId, observation);
      if (problem) ledger.problems[entry.itemId] = problem;
      if (Object.values(ledger.offers).some(offer => offer.itemId === entry.itemId)) continue;
      const slot = freeSlot(observation);
      if (problem || !slot) { ledger.problems[entry.itemId] = problem || "Waiting for a stand slot"; continue; }
      return [reserve(entry, slot)];
    }
    return [];
  }
  function plan(observation: NativeObservation, suspended: boolean) {
    const ledger = nativeLedger(state), pending = Object.values(ledger.purchases || {});
    const allocation = suspended ? [] : nativeAllocation(state).filter(entry => !pending.some(purchase => purchase.item.name === entry.itemId));
    const remove: NativeOffer[] = [];
    for (const offer of Object.values(ledger.offers)) {
      if (offer.phase === "blocked" || wanted(offer, allocation)) continue;
      offer.phase = "removing"; remove.push(offer);
    }
    ledger.problems = Object.fromEntries(pending.map(purchase => [String(purchase.item.name), "Purchase outcome unconfirmed; reconciliation required"]));
    const create = !observation.open || remove.length ? [] : creation(allocation, observation);
    return { remove, create };
  }
  return { observe, plan };
}
