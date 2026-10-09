import type { StorageReference } from "../inventory/bankboi-completion.ts";
import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";
import type {
  MaterialEntry,
  MaterialOrder,
  OrderChoice,
  OrderLine,
} from "../merchant/order-types.ts";
import { allocateOrderMaterials } from "../merchant/order-materials.ts";
import { normalizeOrderLines } from "../merchant/order-validation.ts";
import { estimateUpgradeBatch } from "../merchant/upgrade-estimate.ts";
import { craftProtection, availableCraftStock } from "../merchant/craft-reservations.ts";

interface CommerceJob extends MerchantWork {
  order?: MaterialOrder;
}
interface MerchantOrderState {
  merchantCharacter: string | null;
  merchantCatalog: { buyable: OrderChoice[]; craftable: OrderChoice[] } | null;
  statuses: Record<string, { items?: (MaterialEntry | null)[] } | undefined>;
  bankSnapshot: { packs?: Record<string, (MaterialEntry | null)[] | undefined> } | null;
  bankbois?: Record<string, { items?: (MaterialEntry | null)[] } | undefined>;
  withdrawals?: Record<string, StorageReference[] | undefined>;
  merchantCurrent: CommerceJob | null;
  merchantQueue: CommerceJob[];
}
interface MerchantOrderPorts {
  now(): number;
  nextCommand(): number;
  activeNames(): string[];
  log(message: string, level: string, details: unknown): void;
  persist(): void;
  dispatch(): void;
  persistBank?(): void;
  bankboi?(): Promise<unknown>;
}

export function createMerchantOrderRoute(state: MerchantOrderState, ports: MerchantOrderPorts) {
  function catalog() {
    return state.merchantCatalog || { buyable: [], craftable: [] };
  }
  function changed(merchant: string | null, snapshot: string) {
    return state.merchantCharacter !== merchant || JSON.stringify(catalog()) !== snapshot;
  }
  async function estimate(buys: OrderLine[], choices: OrderChoice[]): Promise<string | null> {
    const results = await estimateUpgradeBatch(
      buys.map((line) => ({
        choice: choices.find((entry) => entry.id === line.id)!,
        quantity: line.quantity,
        target: line.level || 0,
      })),
    );
    for (const [index, line] of buys.entries()) {
      const result = results[index]!;
      if (result.status === "unavailable") {
        if (!line.acknowledgeUnavailable || !line.goldCap)
          return "unavailable estimate requires explicit confirmation and a positive gold cap";
        line.estimateUnavailable = true;
        line.budget = line.goldCap;
      } else if (line.level) {
        line.attempts = result.attempts;
        line.budget = result.gold;
        line.scrolls = result.scrolls;
        delete line.goldCap;
      }
      delete line.acknowledgeUnavailable;
    }
    return null;
  }

  function materialSources() {
    const merchant = state.merchantCharacter;
    const sources: {
      entries: (MaterialEntry | null)[];
      owner: string | null;
      pack: string | null;
    }[] = [];
    sources.push({
      entries: state.statuses[String(merchant)]?.items || [],
      owner: merchant,
      pack: null,
    });
    for (const [pack, entries] of Object.entries(state.bankSnapshot?.packs || {}))
      sources.push({ entries: entries || [], owner: null, pack });
    sources.push(...workerSources());
    for (const name of ports
      .activeNames()
      .filter((member) => member !== merchant && !Object.hasOwn(state.bankbois || {}, member)))
      sources.push({ entries: state.statuses[name]?.items || [], owner: name, pack: null });
    return sources;
  }
  function workerSources() {
    return Object.entries(state.bankbois || {}).map(([name, worker]) => ({
      entries: worker?.items || [],
      owner: null,
      pack: "bankboi:" + name,
    }));
  }
  function materials(crafts: OrderLine[], choices: OrderChoice[]) {
    const allocation = allocateOrderMaterials(crafts, choices, state.merchantCharacter);
    const sources = materialSources();
    const available = availableCraftStock(
      sources.flatMap((source) =>
        source.entries.map(
          (entry) =>
            entry && {
              ...entry,
              item: entry.item || entry,
              craftLocation: source.pack || "inventory:" + source.owner,
            },
        ),
      ),
      craftProtection(state),
    );
    let offset = 0;
    for (const source of sources) {
      allocation.take(
        available.slice(offset, offset + source.entries.length) as (MaterialEntry | null)[],
        source.owner,
        source.pack,
      );
      offset += source.entries.length;
    }
    return allocation;
  }

  function duplicate(order: MaterialOrder): CommerceJob | undefined {
    if (order.buys.length && order.crafts.length) {
      const direct = duplicate({ ...order, crafts: [] });
      const crafting = duplicate({ ...order, buys: [] });
      if (direct && crafting) return crafting;
    }
    const signature = JSON.stringify({ buys: order.buys, crafts: order.crafts });
    return [state.merchantCurrent, ...state.merchantQueue].find(
      (candidate): candidate is CommerceJob =>
        !!candidate &&
        candidate.reason === "merchant commerce" &&
        !!candidate.order &&
        JSON.stringify({
          buys: candidate.order.buys || [],
          crafts: candidate.order.crafts || [],
        }) === signature,
    );
  }

  function splitDirectBuys(job: CommerceJob, order: MaterialOrder) {
    if (order.buys.length && order.crafts.length) {
      const directOrder = {
        ...order,
        crafts: [],
        sources: {},
        bank: [],
        storage: [],
        requirements: [],
        materialBuys: [],
      };
      const direct = duplicate(directOrder);
      if (!direct)
        state.merchantQueue.push({
          ...job,
          id: job.id + "-buy",
          routine: "manual buying",
          order: directOrder,
          blockedOnBankboi: false,
        });
      job.order = { ...order, buys: [] };
    }
  }
  function enqueue(order: MaterialOrder, res: HttpResponse): unknown {
    const previous = duplicate(order);
    if (previous) return res.json({ ok: true, jobId: previous.id, duplicate: true });
    const job = {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason: "merchant commerce",
      queuedAt: ports.now(),
      order,
      blockedOnBankboi: !!order.storage?.length,
    };
    splitDirectBuys(job, order);
    state.merchantQueue.push(job);
    ports.log("Merchant commerce queued", "info", { buys: order.buys, crafts: order.crafts });
    ports.persist();
    if (job.blockedOnBankboi) {
      const requests = ((state.withdrawals ||= {})[String(state.merchantCharacter)] ||= []);
      for (const allocation of order.storage || [])
        requests.push({
          pack: allocation.pack,
          slot: allocation.slot,
          item: allocation.item,
          craftJobId: job.id,
          allocationId: allocation.allocationId,
        });
      ports.persistBank?.();
      void ports
        .bankboi?.()
        .catch((error: unknown) =>
          ports.log("Could not stage crafting materials", "error", String(error)),
        );
    }
    ports.dispatch();
    return res.json({ ok: true, jobId: job.id });
  }

  function orderLines(body: Record<string, unknown>, choices: ReturnType<typeof catalog>) {
    return {
      buys: normalizeOrderLines(body.buys || [], choices.buyable, true),
      crafts: normalizeOrderLines(body.crafts || [], choices.craftable, false),
    };
  }

  async function handle(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const body = requestObject(req.body),
      choices = catalog();
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "configure a merchant first" });
    const { buys, crafts } = orderLines(body, choices);
    if (!buys || !crafts || (!buys.length && !crafts.length))
      return res.status(400).json({ error: "invalid empty order" });
    const merchant = state.merchantCharacter,
      catalogSnapshot = JSON.stringify(choices);
    const estimateError = await estimate(buys, choices.buyable);
    if (changed(merchant, catalogSnapshot))
      return res.status(409).json({
        error: "merchant or catalog changed while estimating; review and retry the order",
      });
    if (estimateError) return res.status(400).json({ error: estimateError });
    return finalize(buys, crafts, choices, res);
  }
  function finalize(
    buys: OrderLine[],
    crafts: OrderLine[],
    choices: ReturnType<typeof catalog>,
    res: HttpResponse,
  ): unknown {
    const existing = duplicate({
      buys,
      crafts,
      sources: {},
      bank: [],
      requirements: [],
      materialBuys: [],
    });
    if (existing) return res.json({ ok: true, jobId: existing.id, duplicate: true });
    const protection = craftProtection(state);
    if (protection.error) return res.status(409).json({ error: protection.error });
    const allocation = materials(crafts, choices.craftable),
      missing = allocation.missing();
    const buyable = new Set((choices.buyable || []).map((entry) => entry.id));
    const unavailable = missing.filter((entry) => entry.level !== 0 || !buyable.has(entry.id));
    if (unavailable.length)
      return res.status(409).json({
        error: "crafting materials are no longer available",
        missing: unavailable.map((entry) => {
          const required = allocation.totals.find(
            (total) => total.id === entry.id && total.level === entry.level,
          )!.quantity;
          return { ...entry, required, available: required - entry.quantity };
        }),
      });
    return enqueue(
      {
        buys,
        crafts,
        sources: allocation.sources,
        craftMaterials: crafts.map(
          (line) => choices.craftable.find((choice) => choice.id === line.id)!.materials || [],
        ),
        inventory: allocation.inventory,
        bank: allocation.bank,
        storage: allocation.storage,
        requirements: allocation.totals,
        materialBuys: missing.map((entry) => ({
          id: entry.id,
          level: 0,
          quantity: entry.quantity,
        })),
      },
      res,
    );
  }
  return { handle };
}
