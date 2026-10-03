import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  createManualOrders,
  type ManualOrderState,
  type ManualOrderPorts,
  type OrderListing,
} from "../commerce/manual-orders.ts";

function positive(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1;
}
function matches(entry: OrderListing, line: Record<string, unknown>): boolean {
  return (
    entry.seller === line.seller &&
    entry.slot === line.slot &&
    entry.rid === line.rid &&
    entry.item.name === line.itemName &&
    entry.price === Number(line.price)
  );
}
export function createManualMarketOrderRoutes(state: ManualOrderState, ports: ManualOrderPorts) {
  const orders = createManualOrders(state, ports);
  function stand(req: HttpRequest, res: HttpResponse): unknown {
    const requested = requestObject(req.body).listings;
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "configure a merchant first" });
    if (!Array.isArray(requested) || !requested.length || requested.length > 40)
      return res.status(400).json({ error: "select at least one valid stand listing" });
    const listings = normalizeStand(requested);
    if (!listings)
      return res
        .status(409)
        .json({ error: "a selected listing is stale or has an invalid quantity" });
    return res.json({ ok: true, jobId: orders.stand(listings).id });
  }
  function normalizeStand(requested: unknown[]): OrderListing[] | null {
    const available = (
        state.statuses[String(state.merchantCharacter)]?.nearbyStandListings || []
      ).concat(state.standListingCache || []),
      normalized: OrderListing[] = [];
    for (const raw of requested) {
      const line = requestObject(raw),
        buyQuantity = Number(line.buyQuantity),
        listing = available.find((entry) => matches(entry, line));
      if (!listing || !positive(buyQuantity) || buyQuantity > listing.quantity) return null;
      normalized.push({ ...listing, buyQuantity });
    }
    return normalized;
  }
  function freshness(listing: OrderListing, sale: boolean, allowStale: boolean): string | null {
    if (listing.serverIdentifier === "PVP") return "automatic PVP realm travel is disabled";
    if (!allowStale && listing.seenAt < ports.now() - 120000)
      return sale
        ? "buy order is stale; refresh the market first"
        : "listing is stale; refresh the market first";
    return null;
  }
  function aldata(sale: boolean) {
    return function submit(req: HttpRequest, res: HttpResponse): unknown {
      const body = requestObject(req.body),
        requested = requestObject(sale ? body.order : body.listing),
        quantity = Number(sale ? body.sellQuantity : body.buyQuantity),
        // "Check" sends the merchant to verify a stale listing (WTB or WTS) in person rather
        // than trusting the cached snapshot's age; the live trade still fails safely if it's
        // actually gone (#34).
        check = body.check === true;
      if (!state.merchantCharacter || typeof requested.key !== "string" || !positive(quantity))
        return res
          .status(400)
          .json({
            error: sale
              ? "select a valid ALData buy order and quantity"
              : "select a valid ALData listing and quantity",
          });
      return submitALData(requested.key, quantity, sale, check, res);
    };
  }
  function submitALData(key: string, quantity: number, sale: boolean, allowStale: boolean, res: HttpResponse): unknown {
    const listing = (sale ? state.aldata.marketBuyOrders : state.aldata.marketListings).find(
      (entry) => entry.key === key,
    );
    if (!listing)
      return res
        .status(409)
        .json({
          error: sale
            ? "ALData buy order is no longer in the market snapshot"
            : "ALData listing is no longer in the market snapshot",
        });
    const error = freshness(listing, sale, allowStale);
    if (error) return res.status(409).json({ error });
    return res.json({ ok: true, jobId: orders.aldata(listing, quantity, sale).id });
  }
  function ponty(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      keys = new Set(Array.isArray(body.keys) ? body.keys : []);
    if (!state.merchantCharacter || !keys.size)
      return res.status(400).json({ error: "select a valid Ponty listing" });
    const candidates = orders.candidates(keys, Number(body.unitPrice));
    if (!candidates.length || new Set(candidates.map((entry) => entry.groupKey)).size !== 1)
      return res
        .status(409)
        .json({ error: "Ponty listings changed or are stale; refresh your selection" });
    const selected = ports.plan(
      candidates,
      Number(body.quantity),
      state.statuses[String(state.merchantCharacter)]?.server,
    );
    if (!selected)
      return res
        .status(409)
        .json({
          error: "That quantity is unavailable as whole Ponty stacks; choose a different quantity",
        });
    const jobs = orders.ponty(selected, Number(body.quantity));
    return res.json({ ok: true, jobId: jobs[0]!.id, jobIds: jobs.map((job) => job.id) });
  }
  return { stand, purchase: aldata(false), sale: aldata(true), ponty };
}
