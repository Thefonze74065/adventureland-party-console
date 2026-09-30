import type { Response } from '@playwright/test';
import { test, expect } from './live-fixtures';

// Failure modes, written before the coordinator fix:
// - A stale expected version requests an already accepted catalog forever.
// - The response acknowledges acceptance but native clients keep retransmitting.
// - One character stops sending while companion runtimes continue flooding status.
// Observe actual native HTTP exchanges, retaining a compact replayable ledger.
test('accepted native catalogs stop retransmitting on every character heartbeat', async ({ live }, info) => {
  test.setTimeout(240_000);
  const context = live.clients.E2EWarrior.page.context();
  const names = ['E2EWarrior', 'E2EPriest', 'E2EMerchant'];
  const catalogFields = ['travelPlaces', 'monsterChoices', 'monsterHunterLocation',
    'bestiaryCatalog', 'skillCatalog', 'appearanceChoices', 'merchantCatalog'];
  type Exchange = { name: string; started: number; finished: number; bytes: number;
    catalogFields: string[]; version?: string; needsCatalog: boolean };
  const exchanges: Exchange[] = [];
  const errors: string[] = [];
  const pending = new Set<Promise<void>>();
  const observe = (response: Response) => {
    if (!new URL(response.url()).pathname.endsWith('/status')) return;
    const request = response.request();
    if (request.method() !== 'POST') return;
    const work = (async () => {
      const body = request.postDataJSON();
      if (!names.includes(body?.name) || body.combatOnly || body.combatWait || !Array.isArray(body.items)) return;
      const reply = await response.json();
      if (typeof reply.needsCatalog !== 'boolean') return;
      exchanges.push({ name: body.name, started: request.timing().startTime, finished: Date.now(),
        bytes: Buffer.byteLength(request.postData() || ''),
        catalogFields: catalogFields.filter(field => Object.hasOwn(body, field)),
        version: body.merchantCatalogVersion, needsCatalog: reply.needsCatalog });
    })().catch(error => { errors.push(String(error)); });
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  context.on('response', observe);
  try {
    await expect.poll(async () => {
      const catalog = (await live.state(true)).merchantCatalog;
      return catalog?.version === 'exchange-rewards-v4' && Array.isArray(catalog.allItems) && catalog.allItems.length > 0;
    }, { timeout: 120_000, message: 'Native discovery must publish a usable catalog before testing its acknowledgement' }).toBe(true);
    await expect.poll(() => names.every(name => exchanges.some(exchange => exchange.name === name && !exchange.needsCatalog)),
      { timeout: 45_000, message: 'Every real character must receive catalog acceptance' }).toBe(true);
    const accepted = Object.fromEntries(names.map(name => [name, exchanges.find(exchange => exchange.name === name && !exchange.needsCatalog)!.finished]));
    await expect.poll(() => names.every(name => exchanges.filter(exchange => exchange.name === name && exchange.started > accepted[name]!).length >= 3),
      { timeout: 45_000, message: 'Observe three subsequent full status reports per native character' }).toBe(true);
    for (const name of names) {
      const settled = exchanges.filter(exchange => exchange.name === name && exchange.started > accepted[name]!);
      expect(settled.every(exchange => !exchange.needsCatalog), `${name} acknowledgement stays accepted`).toBe(true);
      expect(settled.flatMap(exchange => exchange.catalogFields), `${name} no longer resends large catalogs`).toEqual([]);
    }
    expect(errors).toEqual([]);
  } finally {
    context.off('response', observe);
    await Promise.all(pending);
    await info.attach('native-catalog-handshake', { body: JSON.stringify({ exchanges, errors }, null, 2), contentType: 'application/json' });
  }
});
