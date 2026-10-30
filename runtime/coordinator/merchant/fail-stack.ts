import { randomUUID } from 'node:crypto';
import { requestObject, requestText, type HttpRequest, type HttpResponse, type HttpRouter } from '../http/contracts.ts';
import { failStackOffering, sacrificeSlots, validFailStackAttempts, validFailStackChance, type FailStackRequest } from '../../fail-stack.ts';
import { protectedMerchantStorageStock } from '../inventory/merchant-storage-stock.ts';
import { entryMeta } from '../inventory/catalog-meta.ts';
import type { InventoryEntry, Item } from '../contracts/item.ts';
import type { MerchantWork } from './work.ts';

interface Entry extends InventoryEntry { meta?: (InventoryEntry['meta'] & { definition?: unknown }) | null }
interface State {
  merchantCharacter?: string | null;
  merchantCatalog?: unknown;
  statuses: Record<string, { items?: (Entry | null)[] } | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
interface Ports { persist(): void; dispatch(): void; stamp(job: MerchantWork): MerchantWork }
type Outcome = { status: number; error: string } | { request: FailStackRequest };

/** Fail-stack jobs destroy spare copies in the merchant's inventory to raise a kept copy's odds. */
export function createFailStacks(state: State, ports: Ports, now = Date.now) {
  function supply(name: string): number {
    return protectedMerchantStorageStock(state).filter(entry => !entry.craftLocation.startsWith('bankboi:') &&
      entry.item?.name === name && !entry.item.l).reduce((total, entry) => total + (Number(entry.item?.q) || 1), 0);
  }
  function liveTarget(body: Record<string, unknown>, executor: string): Entry | null {
    const item = requestObject(body.item);
    const entry = state.statuses[executor]?.items?.find(value => value?.slot === body.slot);
    const live = entry?.item;
    return live && typeof item.name === 'string' &&
      Object.entries(item).every(([key, value]) => JSON.stringify(live[key]) === JSON.stringify(value))
      ? { ...entry, meta: entryMeta(state.merchantCatalog, entry) } as Entry : null;
  }
  function shapeError(body: Record<string, unknown>, executor: string): string | null {
    const sacrifice = requestObject(body.sacrifice);
    if (!executor || requestText(body.character) !== executor || !Number.isSafeInteger(body.slot)) return 'Item must be in merchant inventory';
    if (!validFailStackAttempts(body.attempts)) return 'Choose between 1 and 50 attempts';
    if (body.stopChance !== undefined && !validFailStackChance(body.stopChance)) return 'Choose a stop chance above 0% and up to 100%';
    if (typeof sacrifice.name !== 'string' || !Number.isSafeInteger(sacrifice.level) || Number(sacrifice.level) < 0) return 'Choose the copies to burn';
    return null;
  }
  function sparesError(body: Record<string, unknown>, executor: string): string | null {
    const sacrifice = requestObject(body.sacrifice) as { name: string; level: number };
    const items = (state.statuses[executor]?.items || []).reduce<(Item | null)[]>((list, value) => {
      if (value && Number.isSafeInteger(value.slot)) list[Number(value.slot)] = value.item || null;
      return list;
    }, []);
    if (!sacrificeSlots(items, { sacrifice }, Number(body.slot)).length) return 'No spare copy of that item and level is in merchant inventory';
    return body.offering === true && !supply(failStackOffering) ? 'No Primling in merchant inventory or bank' : null;
  }
  function validate(body: Record<string, unknown>): Outcome {
    const executor = state.merchantCharacter || '';
    const invalid = shapeError(body, executor);
    if (invalid) return { status: 400, error: invalid };
    const entry = liveTarget(body, executor);
    if (!entry?.item) return { status: 409, error: 'Item changed; reopen the menu' };
    if (!entry.meta?.upgradeable) return { status: 400, error: 'Only upgradeable items can be stacked for' };
    const spares = sparesError(body, executor);
    if (spares) return { status: 409, error: spares };
    const sacrifice = requestObject(body.sacrifice) as { name: string; level: number };
    return { request: { slot: Number(body.slot), item: entry.item, sacrifice: { name: sacrifice.name, level: sacrifice.level },
      attempts: Number(body.attempts), ...(body.stopChance === undefined ? {} : { stopChance: Number(body.stopChance) }),
      offering: body.offering === true, previewOffering: body.previewOffering === true } };
  }
  function queue(req: HttpRequest, res: HttpResponse) {
    const outcome = validate(requestObject(req.body));
    if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
    const executor = state.merchantCharacter!;
    const existing = [state.merchantCurrent, ...state.merchantQueue].find(job => job?.reason === 'fail stack');
    if (existing) return res.status(409).json({ error: 'A fail stack is already queued' });
    const job = ports.stamp({ id: 'fail-' + randomUUID(), target: executor, reason: 'fail stack', manual: true,
      queuedAt: now(), failStack: outcome.request });
    state.merchantQueue.push(job); ports.persist(); ports.dispatch();
    return res.json({ ok: true, jobId: job.id });
  }
  return { install(router: HttpRouter) { router.post('/party-api/fail-stack', queue); } };
}
