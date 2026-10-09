import { test, expect, type LiveGame } from './live-fixtures';
import type { TestInfo } from '@playwright/test';
import type { Item } from '../runtime/coordinator/contracts/item';
import { spawnGoo } from './hunt-interruption-helpers';
import { location } from './game/hunt-lifecycle';

const merchant = 'E2EMerchant';

test('unavailable upgrade estimate enforces its gold cap across native purchases and restart',async({live},info)=>{
  // Failure inventory: fabricated attempt allowance; base/scroll spending skips
  // cap; restart resets accrued spend; retry purchases beyond the same cap.
  // Native buys/upgrades remain real. Only checkpoint transport is held after
  // the coordinator has persisted the first paid purchase, to place restart.
  test.setTimeout(300_000);
  await catalog(live,'helmet');
  // Keep the ordinary 1M bank balance: enough for the 10K cap, but below the
  // complete +12 scroll chain. Preflight must respect the cap before purchases,
  // without requiring tens of millions or fabricating a native receipt.
  const funding=await live.admin(`output=(async()=>{const p=get_player('${merchant}');
    const before=await db.collection('user').findOne({_id:p.owner});
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.gold':1000000}});
    for(const member of Object.values(players))if(member.owner===p.owner&&member.user)member.user.gold=1000000;
    return {beforeBankGold:before.info.gold,bankGold:1000000,merchantGold:p.gold};})()`);
  expect(funding.bankGold).toBe(1000000);
  expect(funding.bankGold+funding.merchantGold).toBeLessThan(64000000);
  await info.attach('declared-capped-commerce-funding',{body:JSON.stringify(funding),contentType:'application/json'});
  const checkpoints:any[]=[];
  let held=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  try {
  await live.clients[merchant].page.route('**/party-api/merchant/checkpoint',async route=>{
    const body=route.request().postDataJSON(),response=await route.fetch();
    checkpoints.push(body.state);
    if(!held&&Number(body.state.spent)>0&&!body.state.pendingPurchase){held=true;await gate;}
    await route.fulfill({response});
  });
  const order=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:1,level:12,acknowledgeUnavailable:true,goldCap:10000}],crafts:[]});
  await expect.poll(()=>held,{timeout:120_000}).toBe(true);
  const before=await live.state();
  const job=[before.merchantCurrent,...before.merchantQueue].find((entry:any)=>entry?.id===order.jobId);
  expect(job.order.buys[0]).toMatchObject({goldCap:10000,budget:10000,estimateUnavailable:true});
  expect(job.order.buys[0].attempts).toBeUndefined();
  expect(job.resumeState.spent).toBeGreaterThan(0);
  await live.restartCoordinator();release();
  await expect.poll(async()=>{
    const state=await live.state();
    return [state.merchantCurrent,...state.merchantQueue].some((entry:any)=>entry?.id===order.jobId&&/budget exhausted|gold cap/i.test(entry.lastError||entry.error||entry.blockedReason||''))||state.merchantActivity.some((entry:any)=>/budget exhausted|gold cap/i.test(JSON.stringify(entry)));
  },{timeout:120_000}).toBe(true);
  expect(Math.max(...checkpoints.map(state=>Number(state.spent)||0))).toBeLessThanOrEqual(10000);
  expect(checkpoints.some(state=>state.spent>0&&/^scroll/.test(state.pendingPurchase?.name||''))).toBe(true);
  await info.attach('capped-native-upgrade-restart',{body:JSON.stringify({order,before,after:await live.state(),checkpoints,events:await live.clients[merchant].events()}),contentType:'application/json'});
  } finally {
    // A failed assertion must not leave a real checkpoint response held while
    // the fixture disposes its browser/request context. Suppress route errors
    // only during teardown, after ordinary assertions and response handling.
    release();
    if(!live.clients[merchant].page.isClosed())
      await live.clients[merchant].page.unrouteAll({behavior:'ignoreErrors'});
  }
});

test('merchant stand location is valid at first setup and stays saved through restart', async ({ live, page }, info) => {
  test.setTimeout(240_000);
  // Failure modes: a shared constant survives first setup; a wall point is saved;
  // restart rerolls coordinates; settings never reach native stand movement.
  const first = (await live.state()).merchantStandLocation;
  expect(first.map).toBe('main');
  expect(first.x).toBeGreaterThanOrEqual(-100); expect(first.x).toBeLessThanOrEqual(100);
  expect(first.y).toBeGreaterThanOrEqual(-100); expect(first.y).toBeLessThanOrEqual(100);
  expect(await live.clients[merchant].run(`can_move({map:'main',x:${first.x},y:${first.y},going_x:${first.x},going_y:${first.y},base:character.base})`)).toBe(true);
  await live.restartCoordinator();
  expect((await live.state()).merchantStandLocation).toEqual(first);
  const blocked = await live.clients[merchant].run(`(()=>{const l=G.geometry.main.x_lines[0];return {map:'main',x:l[0],y:(l[1]+l[2])/2}})()`);
  await expect(live.post('/merchant/stand-location', blocked)).rejects.toThrow(/clear|geometry|blocked|valid/i);
  expect((await live.state()).merchantStandLocation).toEqual(first);
  await page.goto(live.url);
  await page.getByText(/Merchant logistics ·/).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Stand X', { exact: true }).fill('80');
  await page.getByLabel('Stand Y', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Save stand location', exact: true }).click();
  await expect.poll(async () => (await live.state()).merchantStandLocation).toEqual({ map: 'main', x: 80, y: 80 });
  await info.attach('merchant-stand-location-settings', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await seed(live,{10:{name:'stand0'}});
  await live.post('/merchant/force-stand', { enabled: true });
  await expect.poll(async () => {
    const c = await live.clients[merchant].snapshot();
    return c.map === 'main' && Math.hypot(c.x-80,c.y-80) <= 35 && await live.clients[merchant].run('!!character.stand');
  }, { timeout: 90_000 }).toBe(true);
  await live.restartCoordinator();
  expect((await live.state()).merchantStandLocation).toEqual({ map: 'main', x: 80, y: 80 });
  await info.attach('merchant-stand-location-native', { body: JSON.stringify({ first, blocked, client: await live.clients[merchant].snapshot(), state: await live.state(), events: await live.clients[merchant].events() }), contentType: 'application/json' });
  await page.close();
});
const names = ['E2EWarrior', 'E2EPriest', merchant];
type Items = (Item | null)[];

test('merchant finishes native upgrades despite delayed lucky journal storage echoes', async ({ live }, info) => {
  // Two native orders plus reconnect and lucky-slot swaps share this budget.
  test.setTimeout(480_000);
  // Failure modes: IPC echoes resurrect a cleared lucky journal, move the next
  // owned item during recovery, and strand the durable order in receipt review.
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  const before = await economy(live);
  await live.clients[merchant].run(`(()=>{const key='party-lucky-upgrade:'+character.name;
    const remove=Storage.prototype.removeItem, set=Storage.prototype.setItem, get=Storage.prototype.getItem;
    globalThis.__e2eStorageEchoes=0;
    Storage.prototype.removeItem=function(k){const old=get.call(this,k);remove.call(this,k);
      if(k===key&&old){set.call(this,k,old);globalThis.__e2eStorageEchoes++;}}
    return true})()`);
  const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 3 }], crafts: [] });
  await jobFinished(live, order.jobId);
  const after = await economy(live);
  expect(after.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 3)).toHaveLength(1);
  const echoes = await live.clients[merchant].run('globalThis.__e2eStorageEchoes');
  expect(echoes).toBeGreaterThan(0);
  // A reconnect discards the runtime cache while persistence can still contain
  // a running journal from a completed receipt. Move the finished gear natively
  // so recovery cannot rely on its old source cell or old intermediate level.
  await live.clients[merchant].run(`(()=>{const key='party-lucky-upgrade:'+character.name;
    const j=JSON.parse(localStorage.getItem(key));if(!j)throw Error('Missing echoed journal');
    j.phase='running';delete j.result;j.item.level=0;
    const target=character.items.findIndex((i,n)=>n!==j.from&&n!==j.to&&!i);
    swap(j.from,target);localStorage.setItem(key,JSON.stringify(j));return true})()`);
  await live.reconnectClient(merchant);
  await expect.poll(async () => (await live.state()).characters[merchant]?.upgradeInventoryBusy,
    { timeout: 30_000, message: 'Idle recovery must clear the inventory gate before another job is dispatched' }).toBe(false);
  const followup = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
  await jobFinished(live, followup.jobId);
  const recovered = await economy(live);
  expect(recovered.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 3)).toHaveLength(1);
  expect(recovered.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1)).toHaveLength(1);
  await record(live, info, 'lucky-journal-storage-echo', before, { order, echoes, after, followup, recovered });
});

test('lucky upgrade preserves party deliveries across preparation and interrupted restoration', async ({ live }, info) => {
  test.setTimeout(300_000);
  // Failure modes: a preparing checkpoint leaves an empty-slot assumption stale;
  // stack quantity changes after restoration is persisted permanently fence
  // recovery; restarting replays the upgrade or loses the received cargo.
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 4 } }));
  await catalog(live, 'helmet');
  await live.admin(`output=(()=>{const p=get_player('E2EPriest');if(p.items[10])throw Error('Fixture slot occupied');p.items[10]={name:'seashell',q:4};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async () => (await live.clients.E2EPriest.snapshot()).items[10]?.q).toBe(4);
  await live.clients[merchant].run(`(()=>{const native=swap;globalThis.__e2eDeliveryRestoreFault=false;
    swap=function(a,b){const j=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
      if(j?.phase==='restoring'&&!globalThis.__e2eDeliveryRestoreFault){globalThis.__e2eDeliveryRestoreFault=true;throw Error('Injected interruption before return swap');}
      return native(a,b)};return true})()`);
  const before = await economy(live), context = live.clients[merchant].page.context();
  let preparingDelivery = false, restoringDelivery = false, holdRecovery = true;
  const checkpoints: unknown[] = [];
  await context.route('**/merchant/production', async route => {
    const body = route.request().postDataJSON(), j = body.journal?.lucky;
    if (body.action === 'checkpoint' && j?.phase === 'preparing' && !preparingDelivery) {
      preparingDelivery = true;
      expect((await live.clients[merchant].snapshot()).items[j.to]).toBeNull();
      await live.clients.E2EPriest.run(`send_item('${merchant}',10,3).then(()=>true)`);
      await expect.poll(async () => (await live.clients[merchant].snapshot()).items[j.to]?.q).toBe(3);
      checkpoints.push({ phase: 'preparing', journal: j, inventory: await economy(live) });
    }
    if (body.action === 'checkpoint' && j?.phase === 'restoring' && !restoringDelivery) {
      restoringDelivery = true;
      await live.clients.E2EPriest.run(`send_item('${merchant}',10,1).then(()=>true)`);
      await expect.poll(async () => (await live.clients[merchant].snapshot()).items[j.from]?.q).toBe(4);
      checkpoints.push({ phase: 'restoring', journal: j, inventory: await economy(live) });
    }
    if (holdRecovery && ['pending', 'inspect'].includes(body.action) &&
        await live.clients[merchant].run('!!globalThis.__e2eDeliveryRestoreFault')) await route.abort('failed');
    else await route.continue();
  });
  try {
    const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
    await expect.poll(() => live.clients[merchant].run('!!globalThis.__e2eDeliveryRestoreFault'), { timeout: 150_000 }).toBe(true);
    await expect.poll(async () => (await live.state()).merchantQueue.some((job: any) => job.commerceOrderId === order.jobId)).toBe(true);
    await live.restartCoordinator();
    holdRecovery = false;
    const queued = (await live.state()).merchantQueue.find((job: any) => job.commerceOrderId === order.jobId);
    if (queued) await live.post('/merchant/job/retry', { id: queued.id });
    await expect.poll(async () => ![(await live.state()).merchantCurrent, ...(await live.state()).merchantQueue]
      .some((job: any) => job?.commerceOrderId === order.jobId), { timeout: 90_000 }).toBe(true);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'seashell') - quantity(before.characters[merchant].items, 'seashell')).toBe(4);
    expect(after.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1)).toHaveLength(1);
    expect(await live.clients[merchant].run(`localStorage.getItem('party-lucky-upgrade:'+character.name)`)).toBeNull();
    await restartAndObserve(live);
    expect(quantity((await economy(live)).characters[merchant].items, 'seashell')).toBe(4);
    await record(live, info, 'lucky-party-delivery-restart', before, { order, checkpoints, after });
  } finally { holdRecovery = false; await context.unroute('**/merchant/production'); }
});

test('merchant mass skills use both tiers and passive recovery restores critical HP and MP during work', async ({ live }, info) => {
  // Native CI observed four completed bank/NPC jobs taking 324 seconds and
  // companion reconnection taking 128 seconds. Budget the final job separately;
  // keep the 20-second recovery assertion and ordinary job deadlines intact.
  test.setTimeout(900_000);
  // Failure modes: commerce omits production buffs; ++ crosses the MP reserve;
  // exchange waits forever on a legacy skill promise; busy work fences recovery;
  // missing potions prevent free recovery or overlapping pulses consume twice.
  await catalog(live, 'helmet');
  await seed(live, { 10: { name: 'armorbox', q: 2 } });
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  await live.clients[merchant].run(`(()=>{
    globalThis.__e2eMerchantSkills=[];const native=use_skill;
    use_skill=function(skill,...args){globalThis.__e2eMerchantSkills.push({skill,mp:character.mp,maxMp:character.max_mp,hp:character.hp});return native(skill,...args)};
    return true;
  })()`);
  const before = await economy(live);
  const high = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
  await jobFinished(live, high.jobId);
  await jobFinished(live, (await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] })).jobId);
  const highSkills = await live.clients[merchant].run('globalThis.__e2eMerchantSkills');
  expect(highSkills.some((entry: any) => entry.skill === 'massproductionpp')).toBe(true);
  expect(highSkills.some((entry: any) => entry.skill === 'massexchangepp')).toBe(true);

  // Hold only the independent recovery pulse to exercise native low-MP input.
  // Reconnecting below reinstalls the actual production timer.
  await live.clients[merchant].run('clearInterval(globalThis.__partyPassiveRegenTimer);globalThis.partyRoleRunner.stop();true');
  async function lowMana() {
    const pool = await live.admin(`output=(()=>{const p=get_player('${merchant}');p.mp=Math.max(40,Math.floor(p.max_mp*.2)-150);resend(p,'reopen+cid');return p.mp})()`);
    await expect.poll(async () => (await live.clients[merchant].snapshot()).mp).toBeLessThanOrEqual(pool + 50);
  }
  await lowMana();
  const low = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
  await jobFinished(live, low.jobId);
  await lowMana();
  await jobFinished(live, (await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] })).jobId);
  const skills = await live.clients[merchant].run('globalThis.__e2eMerchantSkills');
  expect(skills.some((entry: any) => entry.skill === 'massproduction')).toBe(true);
  expect(skills.some((entry: any) => entry.skill === 'massexchange')).toBe(true);
  for (const entry of skills.filter((entry: any) => ['massproductionpp', 'massexchangepp'].includes(entry.skill)))
    expect(entry.mp - 200).toBeGreaterThanOrEqual(entry.maxMp * .2);

  await live.reconnectClient(merchant);
  const context = live.clients[merchant].page.context();
  let hold = true;
  await context.route('**/merchant/checkpoint', async route => {
    if (hold && route.request().postDataJSON().state?.pendingUpgrade) await new Promise(resolve => setTimeout(resolve, 2000));
    await route.continue();
  });
  const recovery = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 2, level: 1 }], crafts: [] });
  await expect.poll(async () => (await live.state()).merchantCurrent?.id).toBe(recovery.jobId);
  const depleted = await live.admin(`output=(()=>{const p=get_player('${merchant}');p.hp=Math.floor(p.max_hp*.2)-100;p.mp=Math.floor(p.max_mp*.1);cache_player_items(p);resend(p,'reopen+cid');return {hp:p.hp,mp:p.mp,potions:p.items.filter(i=>i&&['hpot1','mpot1'].includes(i.name))}})()`);
  await expect.poll(async () => {
    const p = await live.clients[merchant].snapshot();
    return p.hp > depleted.hp && p.mp > depleted.mp && depleted.potions.every((item: any) =>
      (p.items.find((liveItem: any) => liveItem?.name === item.name)?.q || 0) < item.q);
  }, { timeout: 20_000, message: 'Production must not block native HP/MP potion recovery' }).toBe(true);
  hold = false;
  await context.unroute('**/merchant/checkpoint');
  // CI failure inventory: this batch's second native upgrade succeeded at
  // 183.9 seconds, after the previous 180-second poll; final evidence confirms
  // completed inventory and an empty queue. Budget actual bank/NPC procurement
  // separately without relaxing the 20-second HP/MP recovery assertion above.
  await jobFinished(live, recovery.jobId, 240_000);
  await record(live, info, 'merchant-mass-skills-and-recovery', before, { highSkills, skills, depleted });
});

test('upgrade purchase batch excludes an existing target-level coat', async ({ live }, info) => {
  test.setTimeout(240_000);
  // Failure modes: existing results reduce a new order, command dispatch drops
  // the batch setting, or purchase sizing includes nonzero-level inventory.
  await catalog(live, 'coat');
  await seed(live, { 30: { name: 'coat', level: 5 } });
  await live.post('/config', { buyUpgradeBatchSize: 10 });
  const before = await economy(live);
  const context = live.clients[merchant].page.context();
  let purchased: Economy | undefined;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route('**/merchant/checkpoint', async route => {
    const body = route.request().postDataJSON();
    if (!purchased && body.state?.pendingUpgrade) {
      purchased = await economy(live);
      await gate;
    }
    await route.continue();
  });
  try {
    const order = await live.post('/merchant/order', { buys: [{ id: 'coat', quantity: 4, level: 5 }], crafts: [] });
    await expect.poll(() => purchased, { timeout: 120_000 }).toBeDefined();
    const coats = purchased!.characters[merchant].items.filter(item => item?.name === 'coat');
    expect(coats.filter(item => (item!.level || 0) === 0)).toHaveLength(10);
    expect(coats.filter(item => item!.level === 5)).toHaveLength(1);
    await record(live, info, 'upgrade-batch-existing-target-coat', before, { order, purchased });
  } finally {
    release!();
    await context.unroute('**/merchant/checkpoint');
  }
});

test('buy with upgrade target survives lucky restoration failure and missing client journals across restart', async ({ live }, info) => {
  test.setTimeout(480_000);
  // Failure inventory: restore errors drop the order; a lost local receipt
  // holds all work; replay duplicates purchases/results or resets spend/attempts.
  // A completed older local journal must not fence a newer mirrored receipt.
  let completedJournal: Record<string, unknown> | undefined;
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  const context = live.clients[merchant].page.context();
  let holdRecovery = true;
  await context.route('**/merchant/production', async route => {
    const body = route.request().postDataJSON();
    if (holdRecovery && body.action === 'pending') await route.abort('failed');
    else await route.continue();
  });
  await live.clients[merchant].run(`(()=>{
    const nativeSwap=swap;globalThis.__e2eLuckyRestoreFault=false;globalThis.__e2eLuckyRestores=0;
    swap=function(a,b){const j=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
      if(j?.phase==='restoring'&&!globalThis.__e2eLuckyRestoreFault&&++globalThis.__e2eLuckyRestores===2){globalThis.__e2eLuckyRestoreFault=true;throw Error('Injected lost lucky restoration swap');}
      return nativeSwap(a,b);};return true;
  })()`);
  // Pending inspection is also used before the first operation: admit the
  // first healthy probe, then hold only once the real swap failure has occurred.
  await context.unroute('**/merchant/production');
  await context.route('**/merchant/production', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'checkpoint' && body.journal?.phase === 'complete') completedJournal = body.journal;
    const fault = await live.clients[merchant].run('!!globalThis.__e2eLuckyRestoreFault');
    if (holdRecovery && fault && ['pending', 'inspect'].includes(body.action)) await route.abort('failed');
    else await route.continue();
  });
  const before = await economy(live);
  const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 2, level: 1 }], crafts: [] });
  await expect.poll(() => live.clients[merchant].run('!!globalThis.__e2eLuckyRestoreFault'), { timeout: 180_000 }).toBe(true);
  await expect.poll(async () => (await live.state()).merchantQueue.some((job: any) => job.commerceOrderId === order.jobId),
    { timeout: 15_000, message: 'Lucky restoration failure must retain the unfinished order' }).toBe(true);
  const held = (await live.state()).merchantQueue.find((job: any) => job.commerceOrderId === order.jobId);
  expect(held.resumeState.attempts).toBeGreaterThan(0);
  expect(held.resumeState.spent).toBeGreaterThan(0);
  expect(completedJournal).toBeDefined();
  await live.clients[merchant].run(`(()=>{localStorage.setItem('party-production:'+character.name,${JSON.stringify(JSON.stringify({...completedJournal, phase: 'running'}))});localStorage.removeItem('party-lucky-upgrade:'+character.name);localStorage.removeItem('party-commerce:${order.jobId}');return true})()`);
  await live.restartCoordinator();
  holdRecovery = false;
  await expect.poll(async () => {
    const state = await live.state();
    return ![state.merchantCurrent, ...state.merchantQueue].some((job: any) => job?.commerceOrderId === order.jobId);
  }, { timeout: 180_000, message: 'Mirrored receipt recovery must restore inventory and finish the original order' }).toBe(true);
  const after = await economy(live);
  const results = (value: Economy) => value.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1).length;
  expect(results(after) - results(before)).toBe(2);
  await expect.poll(() => live.clients[merchant].run(`localStorage.getItem('party-production:'+character.name)`)).toBeNull();
  await context.unroute('**/merchant/production');
  await restartAndObserve(live);
  expect(results(await economy(live))).toBe(results(after));
  await record(live, info, 'buy-upgrade-lucky-journal-recovery', before, { order, held, after });
});
type Economy = {
  characters: Record<string, { map: string; gold: number; isize: number; items: Items; upgrading: boolean }>;
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
      const p=get_player(name);return [name,{map:p.map,gold:p.gold,isize:p.isize,items:p.items,upgrading:!!p.q.upgrade}];
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

async function jobFinished(live: LiveGame, id?: string, timeout = 150_000) {
  await expect.poll(async () => {
    const state = await live.state();
    const jobs = [state.merchantCurrent, ...(state.merchantQueue || [])].filter(Boolean);
    return id ? !jobs.some(job => job.id === id) : jobs.length === 0;
  }, { timeout, message: 'Requested merchant work must leave both active and queued state' }).toBe(true);
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
    test.setTimeout(720_000);
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
    }, { timeout: 420_000, message: 'Native marked stock and exchange rewards must finish their selected actions' }).toBe(true);
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
    // Withdrawal marks must recall the merchant without a separate bank command,
    // consume only confirmed stock, and never replay after restart.
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
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { withdrawals: false } });
    await live.post('/command', { character: merchant, type: 'withdraw', pack, slot, item: contents[slot] });
    await live.restartCoordinator();
    const disabledAt = Date.now();
    await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt,
      {timeout:30_000,message:'Observe repeated native scheduling while withdrawals are disabled'}).toBeGreaterThan(disabledAt + 5000);
    const deferred = await live.state();
    expect(deferred.merchantAutomations.withdrawals).toBe(false);
    expect(deferred.withdrawals[merchant]).toHaveLength(1);
    expect([deferred.merchantCurrent, ...deferred.merchantQueue].filter(Boolean).some(job => job.reason === 'withdrawals')).toBe(false);
    expect(bankQuantity(await economy(live), 'leather')).toBe(total);
    await record(live, info, 'marked-withdrawal-disabled', before, {pack,slot});
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { withdrawals: true } });
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


test('native WTB withdraws bank funding and reconciles replaced offers after reopening', async ({live},info) => {
  test.setTimeout(420_000);
  // Failure modes: bank wealth is ignored; repeated reports enqueue duplicate
  // funding; a changed native identity permanently blocks the order; replacement
  // is counted as a purchase; reopening causes duplicate advertisements.
  await catalog(live,'hpot0');
  await expect.poll(async ()=>(await live.state(true)).merchantCatalog?.allItems?.some((entry:{id:string})=>entry.id==='leather'),{timeout:120_000}).toBe(true);
  await seed(live,{10:{name:'stand0'}});
  await live.post('/command',{character:merchant,type:'bank'});
  await jobFinished(live);
  await expect.poll(async ()=>(await live.state()).bank?.gold,{timeout:30_000}).toBeGreaterThan(1000000);
  const before=await economy(live);
  const price=before.characters[merchant].gold+10000;
  expect(before.bankGold).toBeGreaterThan(10000);
  await live.post('/merchant/bid',{itemId:'leather',price,quantity:3,minimumQuality:0,useStandSlot:true});
  await expect.poll(async ()=>{
    const current=await live.clients[merchant].snapshot();
    return Object.values(current.slots).some((item:any)=>item?.b && item.name==='leather' && item.price===price);
  },{timeout:180_000,message:'Merchant must withdraw native stand funding and advertise the order'}).toBe(true);
  await jobFinished(live);
  const funded=await economy(live);
  expect(funded.characters[merchant].gold).toBeGreaterThanOrEqual(price);
  expect(totalGold(funded)).toBe(totalGold(before));
  const ledger=(await live.state()).nativeStand;
  const offer=Object.values(ledger.offers).find((entry:any)=>entry.itemId==='leather') as {slot:string;rid:string;token:string};
  expect(offer).toBeTruthy();
  // Real game mutations, no synthesized acknowledgements or heartbeat state.
  await live.clients[merchant].run(`(async()=>{await unequip(${JSON.stringify(offer.slot)});await wishlist(${JSON.stringify(offer.slot)},'leather',${price},0,3);await close_stand();await open_stand();})()`);
  await expect.poll(async ()=>{
    const state=await live.state(), offers=Object.values(state.nativeStand.offers) as any[];
    return offers.some(entry=>entry.itemId==='leather' && entry.phase==='live' && entry.rid!==offer.rid && !entry.problem);
  },{timeout:45_000,message:'Reopened native identity must reconcile without an inferred purchase'}).toBe(true);
  const after=await live.state();
  expect(after.standBids.leather.quantity).toBe(3);
  expect(Object.values((await live.clients[merchant].snapshot()).slots).filter((item:any)=>item?.b && item.name==='leather')).toHaveLength(1);
  await record(live,info,'native-wtb-funding-and-reconciliation',before,{funded,originalOffer:offer,after});
  await info.attach('native-wtb-reopened-stand',{body:await live.clients[merchant].page.screenshot(),contentType:'image/png'});
});


test('native WTB retries an empty never-confirmed reservation after restart without counting a fill', async ({live},info) => {
  test.setTimeout(240_000);
  // Historical boundary: an empty stand slot and a persisted reservation with no
  // native identity. Failure modes: restart retains a permanent block; retry
  // decrements bid quantity; a retry places duplicate offers or spends gold.
  await catalog(live,'hpot0');
  await seed(live,{10:{name:'stand0'}});
  const before=await economy(live);
  await live.restoreHistoricalSettings(()=>({
    standBids:{leather:{price:1000,quantity:3,minimumQuality:0,useStandSlot:true,revision:1}},
    nativeStand:{sequence:1,offers:{'native-1':{token:'native-1',itemId:'leather',auto:false,slot:'trade1',revision:1,level:0,price:1000,quantity:3,acknowledged:0,phase:'blocked',problem:'Offer disappeared without a confirmed fill/removal; reconciliation required'}},problems:{}},
  }));
  await expect.poll(async ()=>Object.values((await live.state()).nativeStand.offers).some((offer:any)=>offer.itemId==='leather' && offer.phase==='live' && offer.rid && !offer.problem),{timeout:90_000}).toBe(true);
  const state=await live.state(), current=await live.clients[merchant].snapshot();
  expect(state.standBids.leather.quantity).toBe(3);
  expect(Object.values(current.slots).filter((item:any)=>item?.b && item.name==='leather')).toHaveLength(1);
  expect(totalGold(await economy(live))).toBe(totalGold(before));
  await record(live,info,'native-unconfirmed-wtb-recovered',before,{state,slots:current.slots});
  await info.attach('native-unconfirmed-wtb-recovered-stand',{body:await live.clients[merchant].page.screenshot(),contentType:'image/png'});
});


test('native Tracktrix stays in the final inventory slot through full-bag cleanout and merchant tidying', async ({ live, page }, info) => {
  test.setTimeout(240_000);
  // Failure modes: display name mistaken for native tracker ID; unmarked tracker
  // collected in a full bag; occupied final slot loses cargo; merchant tidy
  // repacks the tracker; restart loses protection or item conservation.
  await live.post('/merchant/force-stand', { enabled: true });
  const initial = await economy(live);
  const seeded = await live.admin(`output=(()=>{
    const w=get_player('E2EWarrior'),m=get_player('E2EMerchant');
    if(w.items[10]||m.items[10]||m.items[11])throw Error('Tracker seed slots occupied');
    w.items[42]={name:'tracker'};m.items[43]={name:'tracker'};m.items[11]={name:'stand0'};
    for(let i=0;i<w.isize;i++)if(!w.items[i])w.items[i]={name:'feather0',q:1};
    for(const p of [w,m]){cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');}
    return {warrior:w.items,merchant:m.items};
  })()`);
  await expect.poll(async () => {
    const current=await economy(live);
    return ['E2EWarrior',merchant].every(name=>current.characters[name].items[current.characters[name].isize-1]?.name==='tracker');
  }, {timeout:30_000}).toBe(true);
  const before=await economy(live);
  expect(quantity(before.characters.E2EWarrior.items,'tracker')).toBe(1);
  expect(before.characters.E2EWarrior.items.filter(Boolean)).toHaveLength(43);
  expect(quantity(before.characters.E2EWarrior.items,'feather0')).toBe(quantity(seeded.warrior,'feather0'));
  await live.post('/merchant/force-stand', { enabled: false });
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'inventory cleanout': true } });
  await live.post('/merchant/cleanout', { character:'E2EWarrior' });
  await expect.poll(async () => quantity((await economy(live)).characters.E2EWarrior.items,'feather0'),
    {timeout:150_000}).toBeLessThan(quantity(before.characters.E2EWarrior.items,'feather0'));
  await jobFinished(live);
  await restartAndObserve(live);
  const after=await economy(live);
  for(const name of ['E2EWarrior',merchant]) {
    expect(after.characters[name].items[after.characters[name].isize-1]?.name).toBe('tracker');
    expect(quantity(after.characters[name].items,'tracker')).toBe(1);
  }
  const totalFeathers=(value:Economy)=>bankQuantity(value,'feather0')+Object.values(value.characters).reduce((sum,c)=>sum+quantity(c.items,'feather0'),0);
  expect(totalFeathers(after)).toBe(totalFeathers(before));
  await record(live,info,'tracktrix-full-bag-cleanout-retained',before,{initial,seeded});
  await info.attach('tracktrix-final-native-inventory',{body:await live.clients.E2EWarrior.page.screenshot(),contentType:'image/png'});
  await page.goto(live.url);
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:'E2EWarrior',exact:true})});
  const inventory=card.getByRole('button',{name:/^Inventory/});
  await expect(inventory).toBeVisible();
  if(await inventory.getAttribute('aria-expanded')==='false') await inventory.click();
  const tracker=card.getByLabel(/^(Tracktrix|tracker)$/);
  await expect(tracker).toBeVisible();
  await tracker.scrollIntoViewIfNeeded();
  await info.attach('tracktrix-final-console-inventory',{body:await page.screenshot(),contentType:'image/png'});
});

for (const kind of ['upgrade', 'compound']) test(`auto merchant collects twelve native copies alongside a finite ${kind} rule`, async ({live},info) => {
  test.setTimeout(300_000);
  // Declared initial rules reproduce coexisting persisted preferences. Native
  // clients must transfer all copies even though only one result is requested.
  const name=kind==='upgrade'?'helmet':'ringsj', owner='E2EWarrior';
  await catalog(live,'helmet'); // Catalog readiness; ringsj is loot-only stock.
  await live.post('/config',{itemCollectionThreshold:10});
  await live.admin(`output=(()=>{const p=get_player('${owner}');for(let i=0;i<12;i++)p.items[20+i]={name:'${name}',level:0};cache_player_items(p);resend(p,'reopen+cid');return p.items.slice(20,32)})()`);
  await expect.poll(async()=>(await live.clients[owner].snapshot()).items.filter((i:Item|null)=>i?.name===name).length).toBe(12);
  await live.restoreHistoricalSettings(()=>({autoItemMarks:{[merchant]:{[name+'@+0']:'merchant'}},
    autoUpgradeMarks:kind==='upgrade'?{[merchant]:{[name+'@+0']:{tiers:1,quantity:1}}}:{},
    autoCompounds:kind==='compound'?{[merchant]:[{name,targetTier:1,quantity:1}]}:{}}));
  await expect.poll(async()=>(await live.state()).autoItemMarks?.[merchant]?.[name+'@+0']).toBe('merchant');
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':true,['auto '+kind]:true}});
  await expect.poll(async()=>(await live.clients[owner].snapshot()).items.filter((i:Item|null)=>i?.name===name).length,
    {timeout:180_000,message:'Every copy must reach the merchant through native collection'}).toBe(0);
  const count=async()=>{const all=(await economy(live)).characters;return Object.values(all).flatMap(c=>c.items).filter(i=>i?.name===name)};
  await expect.poll(async()=> (await count()).filter(i=>i?.level===1).length,{timeout:90_000}).toBe(1);
  expect((await count()).length).toBe(kind==='upgrade'?12:10);
  await live.restartCoordinator();
  await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.some((e:any)=>e.item?.name===name&&e.item.level===1)).toBe(true);
  expect((await count()).length).toBe(kind==='upgrade'?12:10);
  await info.attach('auto-merchant-finite-processing-native',{body:JSON.stringify({kind,state:await live.state(),inventory:await economy(live),events:await live.clients[owner].events()}),contentType:'application/json'});
});

test('full-bag cleanout transfers cargo while the fighter keeps fighting a durable native target', async ({ live }, info) => {
  test.setTimeout(480_000);
  // Failure modes: e2e/live-economy-failure-modes.md, "Combat-interleaved merchant handoff".
  const fighter='E2EWarrior', timeline:any[]=[];
  let goo:any=null;
  const gooHp=async()=>goo?live.admin(`output=(()=>{const m=Object.values(instances[${JSON.stringify(goo?.map)}].monsters).find(m=>m.id===${JSON.stringify(goo?.id)});return m&&!m.dead?m.hp:0})()`):null;
  const sample=async()=>{
    const [hp,client,state]=await Promise.all([gooHp(),live.clients[fighter].snapshot(),live.state()]);
    const status=state.characters[fighter]||{};
    const entry={at:Date.now(),gooHp:hp,feathers:quantity(client.items,'feather0'),connected:client.connected,
      navigation:status.navigationState||null,target:status.target?{id:status.target.id,mtype:status.target.mtype}:null,
      activeCombatTarget:status.activeCombatTarget||null,farming:status.farmingNavigationDebug||null,
      job:state.merchantCurrent&&{reason:state.merchantCurrent.reason,status:state.merchantCurrent.status,target:state.merchantCurrent.target},
      queue:(state.merchantQueue||[]).map((job:any)=>job.reason),
      convoy:state.activeConvoy&&{purpose:state.activeConvoy.purpose,phase:state.activeConvoy.phase,participants:state.activeConvoy.participants,
        pause:state.activeConvoy.merchantInterruption?.phase||null},
      command:state.commands?.[fighter]&&{type:state.commands[fighter].type,purpose:state.commands[fighter].purpose},
      fighterAt:[status.map,status.x,status.y],
      merchantAt:[state.characters[merchant]?.map,state.characters[merchant]?.x,state.characters[merchant]?.y]};
    timeline.push(entry);return entry;
  };
  try {
    await live.post('/formation', { leader: fighter });
    await live.post('/farming-mode', { character: fighter, mode: 'default' });
    await live.post('/focus', { character: fighter, monsterFocus: ['goo'] });
    await live.post('/travel', await location(live));
    // A convoy defending against a monster refuses merchant pauses by design; this
    // journey covers ordinary farming combat once the travel convoy has ended.
    await expect.poll(async()=>{const entry=await sample();return !entry.convoy&&entry.target?.mtype==='goo';},
      {timeout:240_000,intervals:[1000],message:'The fighter must be farming goos with no convoy'}).toBe(true);
    // One introduced goo whose HP outlasts the whole journey; damage and death stay native.
    goo=await spawnGoo(live,fighter,300);
    // Farming target selection skips a goo this durable; it fights the fighter instead,
    // through native targeting, so the fighter is under attack while the merchant collects.
    await live.admin(`output=(()=>{const m=Object.values(instances[${JSON.stringify(goo.map)}].monsters).find(m=>m.id===${JSON.stringify(goo.id)});
      target_player(m,get_player(${JSON.stringify(fighter)}));return m.target})()`);
    await expect.poll(async()=>(await sample()).gooHp,{timeout:60_000,intervals:[1000],message:'The fighter must engage the durable goo'}).toBeLessThan(goo.hp);
    const seeded=await live.admin(`output=(()=>{const w=get_player(${JSON.stringify(fighter)});
      for(let i=0;i<w.isize-2;i++)if(!w.items[i])w.items[i]={name:'feather0',q:1};
      cache_player_items(w);resend(w,'reopen+cid');return w.items;})()`);
    await expect.poll(async()=>quantity((await live.clients[fighter].snapshot()).items,'feather0')).toBe(quantity(seeded,'feather0'));
    const before=await economy(live);
    const total=(value:Economy)=>bankQuantity(value,'feather0')+Object.values(value.characters).reduce((sum,c)=>sum+quantity(c.items,'feather0'),0);
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'inventory cleanout': true } });
    await live.post('/merchant/cleanout', { character: fighter });
    const requestedAt=timeline.length;
    let first:any;
    await expect.poll(async()=>{first=await sample();return first.feathers<quantity(seeded,'feather0');},
      {timeout:240_000,intervals:[500],message:'Cargo must reach the merchant while the durable goo is still alive'}).toBe(true);
    expect(first.gooHp).toBeGreaterThan(0);
    await expect.poll(async()=>(await sample()).gooHp,{timeout:30_000,intervals:[500],
      message:'Combat must continue after the first transfer'}).toBeLessThan(first.gooHp);
    await jobFinished(live);
    await sample();
    const window=timeline.slice(requestedAt);
    expect(window.every(entry=>entry.connected),'Interleaved sends must not trip the native call-cost disconnect').toBe(true);
    expect(window.some(entry=>entry.navigation==='departing'),'The fighter must not pause combat for the handoff').toBe(false);
    expect(total(await economy(live))).toBe(total(before));
    await record(live,info,'combat-interleaved-cleanout',before,{goo,first,seeded});
  } finally {
    // The durable goo would keep attacking the fighter and hold later journeys in combat.
    if(goo)await live.admin(`output=(()=>{const m=Object.values(instances[${JSON.stringify(goo.map)}].monsters).find(m=>m.id===${JSON.stringify(goo.id)});
      if(m)remove_monster(m);return true})()`).catch(()=>undefined);
    const events=async(name:string)=>(await live.clients[name].events()).slice(-80);
    await info.attach('combat-interleaved-cleanout-timeline',{body:JSON.stringify({goo,timeline,
      fighterEvents:await events(fighter),merchantEvents:await events(merchant)},null,2),contentType:'application/json'});
  }
});
