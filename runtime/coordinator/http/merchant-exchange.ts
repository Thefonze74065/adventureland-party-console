import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";
import type { queueExchangeStorage } from "../inventory/exchange-storage.ts";
import { exchangeRewardAction, type AutomaticActionState } from '../inventory/automatic-action.ts';

interface ExchangeChoice {
  id: string;
  level?: number;
  reward?: string;
}
interface ExchangeLine {
  id: string;
  level: number;
  quantity: number;
  reward?: string;
}
interface ExchangeState extends AutomaticActionState {
  merchantCharacter: string | null;
  merchantCatalog: { exchangeable?: ExchangeChoice[] } | null;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
interface ExchangePorts {
  now(): number;
  nextCommand(): number;
  stamp(job: MerchantWork): MerchantWork;
  log(message: string, level: string, details: unknown): void;
  persist(): void;
  dispatch(): void;
  queueStorage(job: MerchantWork, shortages: Parameters<typeof queueExchangeStorage>[1]): boolean;
}

function normalizeExchange(raw: unknown, choices: ExchangeChoice[]): ExchangeLine | null {
  const line = requestObject(raw),
    level = Number(line.level) || 0;
  const choice = choices.find(
    (entry) =>
      entry.id === line.id && entry.reward === line.reward && (Number(entry.level) || 0) === level,
  );
  const quantity = Number(line.quantity);
  if (!choice || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999) return null;
  return {
    id: choice.id,
    level: Number(choice.level) || 0,
    quantity,
    ...(choice.reward ? { reward: choice.reward } : {}),
  };
}

export function createMerchantExchangeRoutes(state: ExchangeState, ports: ExchangePorts) {
  function current(body: Record<string, unknown>): MerchantWork | null {
    const job = state.merchantCurrent;
    return job && job.id === body.jobId && job.reason === "exchange" ? job : null;
  }

  function progress(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = current(body);
    if (!job) return res.status(409).json({ error: "exchange job is no longer current" });
    if (!Array.isArray(body.remaining) || !Array.isArray(body.rewards))
      return res.status(400).json({ error: "invalid exchange checkpoint" });
    job.exchanges = body.remaining;
    job.exchangeRewards = body.rewards;
    job.exchangeResume = true;
    ports.persist();
    return res.json({ ok: true, rewardActions: body.rewards.map(raw => {
      const item = requestObject(raw);
      return { item, action: exchangeRewardAction(state, item) };
    }) });
  }

  function supply(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = current(body);
    if (!job) return res.status(409).json({ error: "exchange job is no longer current" });
    // Slot ownership transfers only after the merchant yields its current job.
    return res.json({
      pending: ports.queueStorage(job, Array.isArray(body.shortages) ? body.shortages : []),
    });
  }

  function enqueue(exchanges: ExchangeLine[], res: HttpResponse): unknown {
    const job = ports.stamp({
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason: "exchange",
      routine: 'manual exchange',
      exchanges,
      queuedAt: ports.now(),
    });
    state.merchantQueue.push(job);
    ports.log("Merchant exchange queued", "info", { exchanges });
    ports.persist();
    ports.dispatch();
    return res.json({ ok: true, jobId: job.id });
  }

  function order(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      choices = state.merchantCatalog?.exchangeable || [];
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "configure a merchant first" });
    if (!Array.isArray(body.exchanges) || !body.exchanges.length || body.exchanges.length > 100)
      return res.status(400).json({ error: "select at least one exchange" });
    const exchanges: ExchangeLine[] = [];
    for (const raw of body.exchanges) {
      const line = normalizeExchange(raw, choices);
      if (!line) return res.status(400).json({ error: "invalid exchange quantity" });
      exchanges.push(line);
    }
    return enqueue(exchanges, res);
  }
  return { progress, supply, order };
}
