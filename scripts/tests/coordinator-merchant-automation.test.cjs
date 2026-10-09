const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorMerchantAutomation} = require('../../runtime/coordinator/merchant/automation-composition.ts');

function fixture() {
  const state = {merchantCharacter: 'M', nextCommandId: 40, activeRealm: 'SR_USII', merchantAutomations: {},
    merchantQueue: [], merchantCurrent: null, statuses: {}, commands: {}, autoCompounds: {}, autoExchanges: {},
    autoNpcSales: {}, autoStandMarks: {}, npcSaleMarks: [], standListings: []};
  const calls = [], timers = [], block = {realm: 'SR_EUI'};
  let now = 100000;
  const service = createCoordinatorMerchantAutomation(state, {
    now: () => now, stamp: job => ({...job, priority: 50}), log: () => calls.push('log'),
    persist: () => calls.push('persist'), queue: () => calls.push('queue'), publish: () => calls.push('publish'),
    syncStand: () => false, idle: () => calls.push('idle'), dispatch: () => calls.push('dispatch'),
    names: () => Object.keys(state.statuses), strong: () => false, remaining: () => 0, lead: () => 30000,
    block: () => block, realmLabel: realm => realm, stop: async value => calls.push(value),
    later: (callback, delay) => timers.push({callback, delay}),
  });
  return {state, calls, timers, block, service, setNow: value => { now = value; }};
}

test('automatic schedulers share the current command counter and replacement collections', () => {
  const t = fixture(); assert.deepEqual(t.calls, []);
  const report = {server: 'USII', nearbyGiveaways: [{seller: 'Seller', slot: 'trade1', rid: 'offer', map: 'main', x: 1, y: 2}]};
  t.service.giveaways.schedule(report); t.service.giveaways.schedule(report);
  assert.equal(t.state.merchantQueue.length, 1);
  assert.equal(t.state.merchantQueue[0].id, 'merchant-100000-40');
  assert.equal(t.state.merchantQueue[0].priority, 50);
  t.state.merchantQueue = [];
  t.state.nextCommandId = 80;
  t.state.statuses = {M: {name: 'M', seenAt: 100000, level: 50, server: 'USII'}};
  t.service.luck.schedule(); t.service.luck.schedule();
  assert.equal(t.state.merchantQueue.length, 1);
  assert.equal(t.state.merchantQueue[0].id, 'merchant-100000-80');
  assert.equal(t.state.nextCommandId, 81);
  assert.deepEqual(t.calls.slice(-3), ['log', 'persist', 'dispatch']);
});

test('home recovery persists realm reassignment before a deferred restart and waits for arrival', async () => {
  const t = fixture(); t.state.statuses.M = {server: 'EUI'}; t.state.commands.M = {id: 1};
  assert.equal(t.service.home.ensureHome('exchange'), false);
  assert.equal(t.block.realm, 'SR_USII'); assert.equal(t.state.commands.M, undefined);
  assert.deepEqual(t.calls, ['log', 'persist']); assert.equal(t.timers[0].delay, 150);
  assert.equal(t.service.home.ensureHome('exchange'), false); assert.equal(t.timers.length, 1);
  await t.timers[0].callback(); assert.equal(t.calls.at(-1), t.block);
  t.setNow(100001);
  t.state.statuses = {M: {server: 'USII', seenAt:100001}};
  assert.equal(t.service.home.ensureHome('exchange'), true); assert.equal(t.state.merchantHomeReturnAt, 0);
});
