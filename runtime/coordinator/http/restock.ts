import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { RestockPolicy } from '../../restock-policy.ts';

interface Supply {
  item: string;
  min: number;
  max: number;
}
function nonnegative(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
function supply(value: unknown, item: string, min: number, max: number): Supply {
  // Preserve null/false/zero coercion in existing saved-policy requests.
  const object = requestObject(value);
  return {
    item,
    min: nonnegative(Number(value && object.min), min),
    max: nonnegative(Number(value && object.max), max),
  };
}
function validElixirSettings(elixir: Record<string, unknown>): boolean {
  return [elixir.min ?? 1, elixir.max ?? 2].every(value => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 9999) &&
    (elixir.autoConsume === undefined || typeof elixir.autoConsume === 'boolean') &&
    (elixir.autoAcquire === undefined || typeof elixir.autoAcquire === 'boolean');
}
export function createRestockRoute(
  state: { restockPolicies: Record<string, RestockPolicy>; merchantCatalog?: {allItems?: {id:string;meta?:{definition?:{type?:string}}|null}[]} | null },
  ports: { owned(name: unknown): unknown; persist(): void },
) {
  function validElixir(item: unknown): item is string {
    return typeof item === 'string' && !!state.merchantCatalog?.allItems?.some(entry => entry.id === item && entry.meta?.definition?.type === 'elixir');
  }
  return function restock(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = body.character;
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const policy: RestockPolicy = { hp: supply(body.hp, "hpot1", 5, 20), mp: supply(body.mp, "mpot1", 0, 0) };
    const elixir = requestObject(body.elixir);
    if (elixir.item) {
      if (!validElixir(elixir.item)) return res.status(400).json({error:'Select a valid elixir'});
      if (!validElixirSettings(elixir))
        return res.status(400).json({error:'Invalid elixir restock settings'});
      policy.elixir = {...supply(elixir, elixir.item, 1, 2), autoConsume:elixir.autoConsume !== false, autoAcquire:elixir.autoAcquire === true};
      if (policy.elixir.min > policy.elixir.max) return res.status(400).json({error:'minimum cannot exceed maximum'});
    }
    if (policy.hp.min > policy.hp.max || policy.mp.min > policy.mp.max)
      return res.status(400).json({ error: "minimum cannot exceed maximum" });
    state.restockPolicies[requestText(name)] = policy;
    ports.persist();
    return res.json({ ok: true, policy });
  };
}
