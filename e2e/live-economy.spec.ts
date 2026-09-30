import { test, expect, type LiveGame } from './live-fixtures';
import type { TestInfo } from '@playwright/test';
import type { Item } from '../runtime/coordinator/contracts/item';

const merchant = 'E2EMerchant';
const names = ['E2EWarrior', 'E2EPriest', merchant];
type Items = (Item | null)[];
type Economy = {
  characters: Record<string, { map: string; gold: number; items: Items; upgrading: boolean }>;
  bank: Record<string, Items>;
  savedBank: Record<string, Items>;
  bankGold: number;
};
const quantity = (items: Items, id: string) => items.reduce((total, item) => total + (item?.name === id ? Number(item.q) || 1 : 0), 0);
const bankQuantity = (state: Economy, id: string) => Object.values(state.bank).reduce((total, items) => total + quantity(items, id), 0);
const totalGold = (state: Economy) => state.bankGold + Object.values(state.characters).reduce((total, character) => total + character.gold, 0);

async function economy(live: LiveGame): Promise<Economy> {
  // A mounted bank is authoritative in server memory until native unmount saves it.
  // Reading only MongoDB during a bank visit would mistake normal persistence lag for loss.
  return live.admin(`output=(async()=>{
    const m=get_player(${JSON.stringify(merchant)});
    const user=await db.collection('user').findOne({_id:m.owner});
    const mounted=Object.values(players).find(p=>p.owner===m.owner&&p.user);
    const bank=mounted?mounted.user:user.info;
    const packs=value=>Object.fromEntries(Object.entries(value).filter(([key,items])=>/^items[0-9]+$/.test(key)&&Array.isArray(items)));
    return {characters:Object.fromEntries(${JSON.stringify(names)}.map(name=>{
      const p=get_player(name);return [name,{map:p.map,gold:p.gold,items:p.items,upgrading:!!p.q.upgrade}];
    })),bank:packs(bank),savedBank:packs(user.info),bankGold:Number(bank.gold)||0};
  })()`);
}

async function record(live: LiveGame, info: TestInfo, name: string, before: Economy, details: unknown = {}) {
  await info.attach(name, { body: JSON.stringify({ before, after: await economy(live), details, coordinator: await live.state() }, null, 2), contentType: 'application/json' });
}

async function seed(live: LiveGame, items: Record<number, Item>) {
  await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(merchant)}),items=${JSON.stringify(items)};
    for(const slot of Object.keys(items)){if(p.items[slot])throw Error('Seed would overwrite occupied slot '+slot);p.items[slot]=items[slot];}
    cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');return p.items;
  })()`);
  await expect.poll(async () => {
    const current = await live.clients[merchant].snapshot();
    const state = await live.state();
    return Object.entries(items).every(([slot, item]) => current.items[Number(slot)]?.name === item.name &&
      state.characters[merchant]?.items?.some((entry: { slot: number; item: Item } | null) => entry?.slot === Number(slot) && entry.item?.name === item.name));
  }, { timeout: 30_000, message: 'Native client and coordinator must observe initial inventory before commands' }).toBe(true);
}

async function catalog(live: LiveGame, id: string) {
  await expect.poll(async () => (await live.state(true)).merchantCatalog?.buyable?.some((item: { id: string }) => item.id === id),
    { timeout: 120_000, message: `Native merchant must publish the ${id} NPC catalog entry` }).toBe(true);
}

async function jobFinished(live: LiveGame, id?: string) {
  await expect.poll(async () => {
    const state = await live.state();
    const jobs = [state.merchantCurrent, ...(state.merchantQueue || [])].filter(Boolean);
    return id ? !jobs.some(job => job.id === id) : jobs.length === 0;
  }, { timeout: 150_000, message: 'Requested merchant work must leave both active and queued state' }).toBe(true);
}

async function restartAndObserve(live: LiveGame) {
  const startedAt = Date.now();
  await live.restartCoordinator();
  await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt,
    { timeout: 30_000, message: 'Replay assertions require a native heartbeat accepted after restart' }).toBeGreaterThan(startedAt);
  await jobFinished(live);
}

async function leaveBank(live: LiveGame) {
  await live.post('/command', { character: merchant, type: 'character-travel', location: { map: 'main', x: 0, y: 0 } });
  await expect.poll(async () => (await economy(live)).characters[merchant].map,
    { timeout: 90_000, message: 'Native exit must unmount and save the shared bank' }).toBe('main');
}

test.describe('real merchant economy and durable work', () => {
  test.setTimeout(420_000);

  test('native exchanges bank default rewards, chain marked boxes and sell rewards across restart', async ({ live }, info) => {
    // Failure modes: rewards bypass merchant rules; nested boxes are banked;
    // marks expire after one batch; later stock is not exchanged after restart;
    // locked stock is counted; no-rule rewards are stranded in inventory.
    await expect.poll(async () => (await live.state(true)).merchantCatalog?.exchangeable?.some((entry: { id: string }) => entry.id === 'armorbox'),
      { timeout: 120_000 }).toBe(true);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'automatic exchange': false, 'auto npc sales': true } });
    await seed(live, { 10: { name: 'armorbox', q: 1 } });
    const before = await economy(live);
    const choices = (await live.state(true)).merchantCatalog.exchangeable;
    const rewardIds = [...new Set<string>(choices.filter((entry: { id: string }) => ['armorbox', 'weaponbox', 'gem0'].includes(entry.id))
      .flatMap((entry: { results: { id: string; kind: string }[] }) => entry.results.filter(result => result.id === result.kind && !['gold', 'shells', 'empty'].includes(result.kind)).map(result => result.id)))];
    const checkpoints: unknown[] = [];
    live.clients[merchant].page.on('response', async response => {
      if (!new URL(response.url()).pathname.endsWith('/exchange-progress')) return;
      try { checkpoints.push({ request: response.request().postDataJSON(), status: response.status(), response: await response.json() }); } catch { /* Closing client. */ }
    });
    const fallback = await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] });
    await live.post('/merchant/force-stand', { enabled: false });
    await jobFinished(live, fallback.jobId);
    const defaultBanked = await economy(live);
    expect(rewardIds.reduce((sum, id) => sum + bankQuantity(defaultBanked, id) - bankQuantity(before, id), 0)).toBe(1);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'automatic exchange': true } });
    for (const id of rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)))
      await live.post('/merchant/auto-npc-sale', { item: { name: id, level: 0 } });
    for (const id of ['gem0', 'armorbox', 'weaponbox'])
      await live.post('/command', { character: merchant, type: 'auto-exchange', slot: -1, item: { name: id, level: 0 } });
    await seed(live, { 10: { name: 'gem0', q: 15 }, 11: { name: 'armorbox', q: 2 }, 12: { name: 'weaponbox', q: 2 }, 13: { name: 'armorbox', q: 1, l: 'l' } });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => {
      const observed = await economy(live);
      return quantity(observed.characters[merchant].items, 'gem0') === 0 &&
        quantity(observed.characters[merchant].items, 'armorbox') === 1 && quantity(observed.characters[merchant].items, 'weaponbox') === 0 &&
        rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)).every(id => quantity(observed.characters[merchant].items, id) === 0);
    }, { timeout: 180_000, message: 'Native marked stock and exchange rewards must finish their selected actions' }).toBe(true);
    const firstBatch = await economy(live);
    expect(firstBatch.characters[merchant].items.find(item => item?.name === 'armorbox')).toMatchObject({ l: 'l', q: 1 });
    expect(bankQuantity(firstBatch, 'armorbox')).toBe(0);
    expect(bankQuantity(firstBatch, 'weaponbox')).toBe(0);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.restartCoordinator();
    await expect.poll(async () => Object.keys((await live.state()).autoExchanges || {}).sort()).toEqual(['armorbox@0', 'gem0@0', 'weaponbox@0']);
    await seed(live, { 10: { name: 'armorbox', q: 1 } });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => {
      const observed = await economy(live);
      return quantity(observed.characters[merchant].items, 'armorbox') === 1 &&
        rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)).every(id => quantity(observed.characters[merchant].items, id) === 0);
    }, { timeout: 150_000 }).toBe(true);
    await record(live, info, 'native-exchange-actions-and-restart', before, { defaultBanked, firstBatch, rewardIds, checkpoints });
    await info.attach('native-exchange-reward-events', { body: JSON.stringify(await live.clients[merchant].events()), contentType: 'application/json' });
  });

  for (const retained of [false, true]) {
    test(`failed delivery equip reconciles ${retained ? 'retained merchant stock' : 'missing stock'} across restart`, async ({ live }, info) => {
      // Failure modes: an orphan loops forever; retained stock is discarded; stale
      // inventory removes intent; recovery replays after restart or duplicates cargo.
      const recipient = 'E2EWarrior';
      const item = { name: 'helmet', level: 0 };
      const id = 'interrupted-delivery-equip';
      let holdInventory = false, withheldReports = 0;
      const context = live.clients[recipient].page.context();
      await context.route('**/party-api/status', async route => {
        const body = route.request().postDataJSON();
        if (holdInventory && body.name === merchant && Array.isArray(body.items)) {
          withheldReports++;
          return route.abort('connectionfailed');
        }
        return route.fallback();
      });
      const receipts: { character: string; results: { deliveryId?: string; success: boolean; error?: string }[] }[] = [];
      live.clients[recipient].page.on('request', request => {
        if (new URL(request.url()).pathname.endsWith('/equip-delivery-complete')) {
          const receipt = request.postDataJSON();
          receipts.push(receipt);
          if (receipt.results.some((result: { success: boolean }) => !result.success)) holdInventory = true;
        }
      });
      await live.post('/merchant/force-stand', { enabled: true });
      if (retained) await seed(live, { 10: item });
      const before = await economy(live);
      const cargo = () => live.admin(`output=${JSON.stringify(names)}.map(name=>{
        const p=get_player(name);return {name,items:p.items,slots:p.slots};
      })`);
      const countCargo = (players: { items: Items; slots: Record<string, Item | null> }[]) => players.reduce((sum, p) =>
        sum + [...p.items, ...Object.values(p.slots)].filter(value => value?.name === item.name && value.level === item.level).length, 0);
      expect(countCargo(await cargo())).toBe(retained ? 1 : 0);
      // Declare the interrupted historical intent only. Native clients perform the
      // actual failed equip, subsequent transfer and equip; no receipts are fabricated.
      await live.restoreHistoricalSettings(() => ({ merchantDeliveries: {
        [recipient]: [{ id, item, slot: 10, equipOnDelivery: true, awaitingEquip: true }],
      } }));
      await expect.poll(() => receipts.some(receipt => receipt.character === recipient &&
        receipt.results.some(result => result.deliveryId === id && !result.success)),
      { timeout: 45_000, message: 'Native recipient must fail to equip the absent delivery' }).toBe(true);
      await expect.poll(async () => (await live.state()).merchantDeliveries?.[recipient]?.[0]?.equipFailedAt).toBeGreaterThan(0);
      await live.clients[recipient].page.waitForTimeout(12_000);
      expect(withheldReports).toBeGreaterThan(0);
      expect((await live.state()).merchantDeliveries[recipient]).toMatchObject([{ id, awaitingEquip: true }]);
      await live.restartCoordinator();
      expect((await live.state()).merchantDeliveries[recipient]).toMatchObject([{ id, awaitingEquip: true }]);
      holdInventory = false;
      await expect.poll(async () => {
        const marks = (await live.state()).merchantDeliveries?.[recipient] || [];
        return retained ? marks.length === 1 && !marks[0].awaitingEquip && marks[0].id !== id : marks.length === 0;
      }, { timeout: 20_000, message: 'Failed equip must reconcile against merchant stock' }).toBe(true);
      await record(live, info, 'failed-equip-reconciled', before, { retained, receipts, cargo: await cargo() });
      await live.restartCoordinator();
      if (retained) {
        await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { deliveries: true } });
        await live.post('/merchant/force-stand', { enabled: false });
        await expect.poll(async () => (await cargo()).find((p: { name: string }) => p.name === recipient)?.slots.helmet,
          { timeout: 150_000, message: 'Retained cargo must be delivered and equipped by native clients' }).toMatchObject(item);
        await expect.poll(async () => (await live.state()).merchantDeliveries?.[recipient] || [], { timeout: 30_000 }).toEqual([]);
      }
      await restartAndObserve(live);
      const failures = receipts.filter(receipt => receipt.results.some(result => !result.success)).length;
      await live.clients[recipient].page.waitForTimeout(35_000);
      expect(receipts.filter(receipt => receipt.results.some(result => !result.success)).length).toBe(failures);
      expect((await live.state()).merchantDeliveries?.[recipient] || []).toEqual([]);
      expect(countCargo(await cargo())).toBe(retained ? 1 : 0);
      await info.attach('failed-equip-native-screen', { body: await live.clients[recipient].page.screenshot(), contentType: 'image/png' });
      await record(live, info, 'failed-equip-no-replay', before, { retained, withheldReports, receipts, cargo: await cargo() });
    });
  }

  test('duplicate queued NPC buys execute once and remain complete after coordinator restart', async ({ live }, info) => {
    await catalog(live, 'helmet');
    await live.post('/merchant/force-stand', { enabled: true });
    const before = await economy(live);
    const price = await live.admin("output=G.items.helmet.g");
    const order = { buys: [{ id: 'helmet', quantity: 3 }], crafts: [] };
    const accepted = await live.post('/merchant/order', order);
    const duplicate = await live.post('/merchant/order', order);
    expect(duplicate).toMatchObject({ duplicate: true, jobId: accepted.jobId });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'helmet'),
      { timeout: 150_000 }).toBe(quantity(before.characters[merchant].items, 'helmet') + 3);
    await jobFinished(live, accepted.jobId);
    expect(totalGold(await economy(live))).toBe(totalGold(before) - 3 * price);
    await restartAndObserve(live);
    expect(quantity((await economy(live)).characters[merchant].items, 'helmet')).toBe(quantity(before.characters[merchant].items, 'helmet') + 3);
    expect(totalGold(await economy(live))).toBe(totalGold(before) - 3 * price);
    await record(live, info, 'npc-buy-once', before, { price, accepted, duplicate });
  });

  test('NPC partial sale credits actual gold and preserves the unsold stack after restart', async ({ live }, info) => {
    await seed(live, { 10: { name: 'leather', q: 10 } });
    const before = await economy(live);
    const value = await live.admin("output=calculate_item_value({name:'leather',q:10})");
    const accepted = await live.post('/merchant/npc-sale', { source: 'merchant', slot: 10, item: { name: 'leather' }, quantity: 7 });
    await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'leather'),
      { timeout: 150_000 }).toBe(3);
    await jobFinished(live);
    expect(totalGold(await economy(live))).toBe(totalGold(before) + 7 * value);
    await expect.poll(async () => (await live.state()).npcSaleMarks?.some((mark: { id: string }) => mark.id === accepted.mark.id)).toBe(false);
    await restartAndObserve(live);
    expect(quantity((await economy(live)).characters[merchant].items, 'leather')).toBe(3);
    expect(totalGold(await economy(live))).toBe(totalGold(before) + 7 * value);
    await record(live, info, 'partial-npc-sale', before, { unitValue: value, accepted });
  });

  test('marked bank deposit and requested withdrawal conserve a real stack across restart', async ({ live }, info) => {
    await seed(live, { 10: { name: 'leather', q: 13 } });
    const before = await economy(live);
    const total = quantity(before.characters[merchant].items, 'leather') + bankQuantity(before, 'leather');
    await live.post('/command', { character: merchant, type: 'mark', slot: 10, item: { name: 'leather', q: 13 } });
    await live.post('/command', { character: merchant, type: 'bank' });
    await expect.poll(async () => {
      const state = await economy(live);
      return quantity(state.characters[merchant].items, 'leather') === 0 && bankQuantity(state, 'leather') === total;
    }, { timeout: 150_000 }).toBe(true);
    await jobFinished(live);
    await leaveBank(live);
    await expect.poll(async () => Object.values((await economy(live)).savedBank).reduce((sum, items) => sum + quantity(items, 'leather'), 0),
      { timeout: 60_000, message: 'The actual bank unmount must persist the deposited stack' }).toBe(total);
    await record(live, info, 'bank-deposit-persisted', before);
    await restartAndObserve(live);
    const bank = await economy(live);
    const [pack, contents] = Object.entries(bank.bank).find(([, items]) => quantity(items, 'leather') > 0)!;
    const slot = contents.findIndex(item => item?.name === 'leather');
    expect(slot).toBeGreaterThanOrEqual(0);
    await live.post('/command', { character: merchant, type: 'withdraw', pack, slot, item: contents[slot] });
    await live.post('/command', { character: merchant, type: 'bank' });
    await expect.poll(async () => {
      const state = await economy(live);
      return quantity(state.characters[merchant].items, 'leather') === total && bankQuantity(state, 'leather') === 0;
    }, { timeout: 150_000 }).toBe(true);
    await jobFinished(live);
    await leaveBank(live);
    await restartAndObserve(live);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'leather') + bankQuantity(after, 'leather')).toBe(total);
    expect(quantity(after.characters[merchant].items, 'leather')).toBe(total);
    expect(totalGold(after)).toBe(totalGold(before));
    await record(live, info, 'bank-round-trip', before, { pack, slot, total });
  });

  test('a cancelled queued purchase stays cancelled while a later real purchase completes', async ({ live }, info) => {
    await catalog(live, 'scroll0');
    await catalog(live, 'helmet');
    await live.post('/merchant/force-stand', { enabled: true });
    const before = await economy(live);
    const cancelled = await live.post('/merchant/order', { buys: [{ id: 'scroll0', quantity: 2 }], crafts: [] });
    await live.post('/merchant/job/cancel', { id: cancelled.jobId });
    await restartAndObserve(live);
    expect((await live.state()).merchantForceStand).toBe(true);
    await live.post('/merchant/force-stand', { enabled: false });
    await catalog(live, 'helmet');
    const later = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1 }], crafts: [] });
    await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'helmet'),
      { timeout: 150_000 }).toBe(quantity(before.characters[merchant].items, 'helmet') + 1);
    await jobFinished(live, later.jobId);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'scroll0')).toBe(quantity(before.characters[merchant].items, 'scroll0'));
    expect(totalGold(after)).toBe(totalGold(before) - await live.admin('output=G.items.helmet.g'));
    await record(live, info, 'cancelled-buy-not-replayed', before, { cancelled, later });
  });

  test('a manual upgrade consumes one real scroll and does not replay after restart', async ({ live }, info) => {
    await seed(live, { 10: { name: 'helmet', level: 0 }, 11: { name: 'scroll0', q: 10 } });
    const before = await economy(live);
    const requestedAt = Date.now();
    const observedUpgrade = async () => {
      const events = (await live.clients[merchant].events()).filter((event: any) => event.at >= requestedAt);
      const responses = events.flatMap((event: any) => event.event === 'game_response' ? [event.data] :
        event.event === 'player' ? (event.data?.hitchhikers || []).filter(([kind]: [string]) => kind === 'game_response').map(([, data]: [string, any]) => data) : []);
      // Maintained lucky-slot handling can move the marked item before upgrading.
      const pending = events.filter((event: any) => event.event === 'player').flatMap((event: any) =>
        (event.data?.items || []).map((item: any, slot: number) => ({ item, slot })))
        .find(({ item }: any) => item?.name === 'placeholder' && item.p?.name === 'helmet' && item.p?.scroll === 'scroll0');
      const final = responses.find((response: any) => pending && response?.num === pending.slot && response.level === 1 &&
        ['upgrade_success', 'upgrade_fail'].includes(response.response));
      return { final, chance: pending?.item.p.chance, slot: pending?.slot };
    };
    await live.post('/command', { character: merchant, type: 'upgrade-mark', slot: 10, item: { name: 'helmet', level: 0 }, tiers: 1 });
    await expect.poll(async () => {
      const state = await economy(live), character = state.characters[merchant];
      const helmet = character.items.find(item => item?.name === 'helmet');
      const observed = await observedUpgrade();
      return !character.upgrading && quantity(character.items, 'scroll0') === 9 &&
        (observed.final?.response === 'upgrade_success' ? helmet?.level === 1 :
          observed.final?.response === 'upgrade_fail' && Number.isFinite(observed.chance) && observed.chance < 1 && !helmet);
    }, { timeout: 150_000, message: 'A native final upgrade response must agree with authoritative inventory and one consumed scroll' }).toBe(true);
    await jobFinished(live);
    const completed = await economy(live);
    const observed = await observedUpgrade();
    expect(observed.final).toMatchObject({ num: observed.slot, level: 1 });
    expect(totalGold(completed)).toBe(totalGold(before));
    const outcome = completed.characters[merchant].items.filter(item => item?.name === 'helmet');
    await restartAndObserve(live);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'scroll0')).toBe(9);
    expect(after.characters[merchant].items.filter(item => item?.name === 'helmet')).toEqual(outcome);
    expect(totalGold(after)).toBe(totalGold(before));
    await record(live, info, 'single-native-upgrade', before, { completed, outcome, observed });
  });
});
