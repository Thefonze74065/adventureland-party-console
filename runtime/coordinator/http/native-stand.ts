import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { createNativeStand, nativeAllocation, nativeLedger, type NativeStandState, type NativeObservation } from "../commerce/native-stand.ts";
import { bidAcceptsLevel } from "../commerce/bid-matching.ts";
import type { Item } from "../contracts/item.ts";
import type { MerchantWork } from "../merchant/work.ts";

interface State extends NativeStandState { merchantCharacter: string | null; merchantCurrent: MerchantWork | null; merchantQueue: MerchantWork[]; nextCommandId: number }
interface Ports { fulfill(item: Item, quantity: number): unknown; persist(): void; dispatch(): void; stamp(job: MerchantWork): MerchantWork }
export function createNativeStandRoute(state: State, ports: Ports) {
  const service = createNativeStand(state, (item, quantity) => ports.fulfill(item, quantity));
  function purchased(jobId: string, key: string, res: HttpResponse): unknown {
    const pending = nativeLedger(state).purchases ||= {}, id = jobId + ":" + key;
    const reservation = pending[id];
    if (!reservation) return res.json({ ok: true, alreadyCompleted: true });
    ports.fulfill(reservation.item, reservation.quantity);
    delete pending[id];
    const job = state.merchantCurrent;
    if (job?.id === jobId) job.acknowledgedPurchaseKeys = [...new Set([...(job.acknowledgedPurchaseKeys || []), key])];
    ports.persist(); return res.json({ ok: true });
  }
  function prepare(job: MerchantWork, key: string, body: Record<string, unknown>, res: HttpResponse): unknown {
    const pending = nativeLedger(state).purchases ||= {}, item = requestObject(body.item) as Item;
    const requested = Number(body.quantity), price = Number(body.price);
    if (!validTerms(item, requested, price)) return res.status(400).json({ error: "invalid purchase terms" });
    if (Object.values(pending).some(entry => entry.item.name === item.name))
      return res.status(409).json({ error: "A previous purchase outcome is unconfirmed; reconciliation required" });
    const automatic = !!job.bidItemId || body.automatic === true;
    let quantity = automatic || state.standBids[String(item.name)] ? nativePurchaseLimit(state, item, price, requested) : requested;
    if (body.wholeStack === true && quantity < requested) quantity = 0;
    if (quantity) pending[job.id + ":" + key] = { item, quantity, jobId: job.id };
    ports.persist(); return res.json({ ok: true, quantity });
  }
  function alreadyPurchased(job: MerchantWork, key: string): boolean {
    return !!(job.completedListingKeys?.includes(key) || job.acknowledgedPurchaseKeys?.includes(key));
  }
  function purchase(body: Record<string, unknown>, res: HttpResponse): unknown {
    const job = state.merchantCurrent, key = String(body.key);
    if (!job || job.id !== body.jobId) return res.status(409).json({ error: "purchase is no longer current" });

    if (alreadyPurchased(job, key)) return res.json({ ok: true, quantity: 0 });
    return prepare(job, key, body, res);
  }
  function suspend(body: Record<string, unknown>): boolean {
    return ["stand bid purchases", "stand purchases", "ALData marketplace purchases", "Ponty purchases"].includes(state.merchantCurrent?.reason || "") || body.suspend === true;
  }
  function configure(body: Record<string, unknown>, res: HttpResponse): unknown {
    if (typeof body.enabled !== "boolean") return res.status(400).json({ error: "invalid automatic fill setting" });
    state.autoStandBuys = body.enabled; ports.persist(); return res.json({ ok: true });
  }
  function fundStand(observation: NativeObservation, suspended: boolean): void {
    if (suspended || !observation.open || observation.space === false) return;
    const carried = Number(observation.gold) || 0;
    const available = carried + Number(state.bankSnapshot?.gold || 0);
    const target = fundingTarget(state, available);
    if (target <= carried) return;
    if ([state.merchantCurrent, ...state.merchantQueue].some(job => job?.reason === "native stand funding")) return;
    state.merchantQueue.push(ports.stamp({ id: "native-funding-" + state.nextCommandId++, target: state.merchantCharacter,
      reason: "native stand funding", goldTarget: target, queuedAt: Date.now() }));
    ports.persist(); ports.dispatch();
  }
  return (req: HttpRequest, res: HttpResponse): unknown => {
    const body = requestObject(req.body);
    if (body.action === "configure") return configure(body, res);
    if (body.character !== state.merchantCharacter) return res.status(409).json({ error: "merchant is no longer configured" });
    if (body.action === "purchased") return purchased(String(body.jobId), String(body.key), res);
    if (body.jobId && body.jobId !== state.merchantCurrent?.id) return res.status(409).json({ error: "purchase is no longer current" });
    if (body.action === "purchase" || body.action === "purchased") return purchase(body, res);
    const observation = nativeObservation(body);
    service.observe(observation);
    const actions = service.plan(observation, suspend(body));
    fundStand(observation, suspend(body));
    ports.persist();
    const ledger = nativeLedger(state);
    return res.json({ ok: true, ...actions, offers: ledger.offers, bids: state.standBids });
  };
}

/** Revalidate the shared remainder immediately before the game purchase API. */
export function nativePurchaseLimit(state: NativeStandState, item: Item, price: number, requested: number): number {
  const bid = state.standBids[String(item.name)];
  if (!bid || !bidAcceptsLevel(bid, item) || price > bid.price) return 0;
  if (Object.values(nativeLedger(state).offers).some(offer => offer.itemId === item.name)) return 0;
  return Math.max(0, Math.min(requested, bid.quantity));
}

function validTerms(item: Item, quantity: number, price: number): boolean {
  return !!item.name && Number.isSafeInteger(quantity) && quantity > 0 && Number.isFinite(price) && price > 0;
}
function nativeObservation(body: Record<string, unknown>): NativeObservation {
  return { slots: requestObject(body.slots) as NativeObservation["slots"], open: body.open === true,
    receipts: requestObject(body.receipts) as Record<string, number>, removed: typeof body.removed === "string" ? body.removed : undefined,
    failed: typeof body.failed === "string" ? body.failed : undefined, gold: Number(body.gold), space: body.space !== false };
}

function fundingTarget(state: NativeStandState, available: number): number {
  return Math.max(0, ...nativeAllocation(state).map(entry => state.standBids[entry.itemId]!)
    .filter(bid => bid.price <= available && bid.price <= 99999999999 && Number(bid.minimumQuality || 0) <= 12).map(bid => bid.price));
}
