const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../characters/shared.js'), 'utf8');
const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();

function runtime(bank) {
  const calls = [];
  const character = { bank, items: Array(42).fill(null), level: 1 };
  const r = vm.createContext({ character, G: { items: { leather: { e: 40, name: 'Leather' } } },
    merchantMassBuff:async()=>{},itemQuantity: item => item && (item.q || 1),
    merchantVisitBank: async () => calls.push('bank'),
    bank_retrieve: async (pack, slot) => {
      calls.push(['retrieve', pack, slot]);
      character.items[0] = character.bank[pack][slot];
      character.bank[pack][slot] = null;
    },
    find_npc: id => id, smart_move: async npc => calls.push(npc),
    exchange: async slot => { calls.push(['exchange', character.items[slot].q]); character.items[slot] = null; },
    request: async (url, options) => calls.push({ url, body: options.body }),
  });
 require('./helpers/client-dependencies.cjs').merchantGuards(r,{});
  vm.runInContext(source.slice(source.indexOf('  function findExchangeBankItem('),
    source.indexOf('  async function runMerchantJob(')), r);
  return { r, calls };
}

test('token catalog includes every currency, bundles, and cosmetic reward identifiers', () => {
  const r = vm.createContext({});
  vm.runInContext(require('./helpers/downloaded-game.cjs').downloadedGameSource('data.js'), r);
  r.root={partyExchangeRewards:require('../../runtime/characters/exchange-rewards.ts').exchangeRewards};
  r.spriteDefinition = id => ({ id });
  const start = source.indexOf('    var exchangeable =');
  const end = source.indexOf('    return { version: merchantCatalogVersion', start);
  vm.runInContext(source.slice(start, end), r);
  const tokens = r.exchangeable.filter(item => item.reward);
  assert.deepEqual([...new Set(tokens.map(item => item.id))].sort(), Object.keys(r.G.tokens).sort());
  const confetti = tokens.find(item => item.reward === 'confetti');
  assert.equal(confetti.required, 1); assert.equal(confetti.rewardQuantity, 100);
  assert.ok(tokens.some(item => item.reward === 'cxjar-xgravestone2'));
  assert.equal(tokens.find(item => item.id === 'monstertoken').npc, 'monsterhunter');
});

function tokenRuntime(quantity) {
  const setup = runtime({ items1: [{name:'funtoken', q:quantity}] });
  const {r, calls} = setup;
  r.G.items.funtoken = {name:'Fun Token', npc:'funtokens'};
  r.G.tokens = {funtoken:{partyhat:2, confetti:0.01}};
  let resolve;
  r.parent = {push_deferred: () => new Promise(done => {resolve=done;}), socket:{emit: (event, data) => {
    calls.push({event, data});
    const item = r.character.items[data.num];
    assert.equal(data.q, item.q);
    item.q -= Math.max(1, r.G.tokens.funtoken[data.name]);
    if (!item.q) r.character.items[data.num] = null;
    resolve({});
  }}};
  return setup;
}

test('different rewards share a currency budget before travel', async () => {
  const {r, calls} = tokenRuntime(2);
  await assert.rejects(r.merchantExchange({exchanges:[
    {id:'funtoken',reward:'partyhat',quantity:1}, {id:'funtoken',reward:'confetti',quantity:1}
  ]}), /Not enough Fun Token/);
  assert.equal(calls.some(call => call.event === 'exchange_buy'), false);
});

test('token purchases preserve selected rewards through checkpoints and charge bundle cost', async () => {
  const {r, calls} = tokenRuntime(3);
  await r.merchantExchange({exchanges:[
    {id:'funtoken',reward:'confetti',quantity:1}, {id:'funtoken',reward:'partyhat',quantity:1}
  ]});
  assert.deepEqual(calls.filter(call => call.event).map(call => [call.data.name, call.data.q]),
    [['confetti',3],['partyhat',2]]);
  const progress = calls.filter(call => call.url === '/merchant/exchange-progress');
  assert.equal(progress[0].body.remaining[0].reward, 'partyhat');
  assert.equal(progress[1].body.remaining.length, 0);
  assert.equal(calls.at(-1).body.success, true);
});

test('unknown token reward is rejected without spending currency', async () => {
  const {r, calls} = tokenRuntime(3);
  await assert.rejects(r.merchantExchange({exchanges:[{id:'funtoken',reward:'invalid',quantity:1}]}), /no longer available/);
  assert.equal(calls.some(call => call.event), false);
});

test('40 level-less leather is withdrawn and delivered for one exchange', async () => {
  const { r, calls } = runtime({ items1: [null, { name: 'leather', q: 40 }] });
  await r.merchantExchange({ jobId: 'test', exchanges: [{ id: 'leather', level: 0, quantity: 1 }] });
  assert.deepEqual(calls.slice(0, 4), ['bank', ['retrieve', 'items1', 1], 'exchange', ['exchange', 40]]);
  assert.equal(calls.at(-1).body.success, true);
});

test('exchange lookup preserves requested levels', () => {
  const { r } = runtime({ items0: [{ name: 'leather', level: 1, q: 40 }, { name: 'leather', q: 40 }] });
  assert.equal(r.findExchangeBankItem('leather', 0).slot, 1);
  assert.equal(r.findExchangeBankItem('leather', 1).slot, 0);
  assert.equal(r.findExchangeBankItem('leather', 2), null);
});

test('insufficient leather reports failure without visiting exchange NPC', async () => {
  const { r, calls } = runtime({ items1: [] });
  await assert.rejects(r.merchantExchange({ exchanges: [{ id: 'leather', quantity: 1 }] }), /Not enough Leather/);
  assert.equal(calls.includes('exchange'), false);
  assert.equal(calls.at(-1).body.success, false);
});

test('bankbois cannot be queued for merchant services; normal characters still can', () => {
  const party = { bankbois: { bankboi0: {} }, merchantCharacter: 'M', merchantQueue: [], merchantJobBlocks: {} };
  const r = vm.createContext({ party, stampMerchantJob: job => job, persistSettings() {}, dispatchMerchant() {} });
  require('./helpers/coordinator-merchant.cjs').merchantQueueRuntime(r);
  r.queueMerchant(['bankboi0', 'Warrior'], 'restock');
  assert.equal(party.merchantQueue.length, 1);
  assert.equal(party.merchantQueue[0].target, 'Warrior');
});

test('dispatch removes persisted bankboi jobs even while merchant is busy', () => {
  const party = { bankbois: { bankboi0: {} }, merchantCurrent: {},
    merchantQueue: [{ target: 'bankboi0', reason: 'restock' }, { target: 'Warrior', reason: 'restock' }] };
  const r = require('./helpers/coordinator-dispatch.cjs').dispatchRuntime(party);
  r.dispatchMerchant();
  assert.equal(r.party.merchantQueue.length, 1);
  assert.equal(r.party.merchantQueue[0].target, 'Warrior');
});

test('BankBoi shortage yields the exchange before NPC travel', async () => {
  const { r, calls } = runtime({ items1: [] });
  r.request = async (url, options) => { calls.push({ url, body: options.body }); return url.endsWith('exchange-supply') ? { pending: true } : {}; };
  await assert.rejects(r.merchantExchange({ jobId: 'test', exchanges: [{ id: 'leather', quantity: 1 }] }), /bankboi_pending/);
  assert.equal(calls.includes('exchange'), false);
  assert.equal(calls.at(-1).body.error, 'bankboi_pending');
});

test('duplicate lines require their combined quantity before NPC travel', async () => {
  const { r, calls } = runtime({ items1: [{ name: 'leather', q: 40 }] });
  await assert.rejects(r.merchantExchange({ exchanges: [{ id: 'leather', quantity: 1 }, { id: 'leather', quantity: 1 }] }), /Not enough Leather/);
  assert.equal(calls.includes('exchange'), false);
});

test('storage queues matching worker inventory once and honors item level', () => {
  const party = { merchantCharacter: 'M', withdrawals: {}, bankbois: { B: { name: 'B', items: [
    { slot: 2, item: { name: 'leather', level: 1, q: 99 } }, { slot: 3, item: { name: 'leather', q: 74 } }
  ] } } };
  const { queueExchangeStorage } = require('../../runtime/coordinator/inventory/exchange-storage.ts');
  party.withdrawals.M = [];
  const job = { exchanges: [{ id: 'leather', level: 0, quantity: 1 }] };
  assert.equal(queueExchangeStorage(job.exchanges, [{ id: 'leather', level: 0, quantity: 40 }], Object.values(party.bankbois), party.withdrawals.M), true);
  queueExchangeStorage(job.exchanges, [{ id: 'leather', level: 0, quantity: 40 }], Object.values(party.bankbois), party.withdrawals.M);
  assert.equal(party.withdrawals.M.length, 1);
  assert.equal(party.withdrawals.M[0].slot, 3);
  assert.equal(party.withdrawals.M[0].pack, 'bankboi:B');
});

test('confirmed exchanges checkpoint remaining work before returning to bank', async () => {
  const { r, calls } = runtime({ items1: [{ name: 'leather', q: 40 }] });
  await r.merchantExchange({ jobId: 'test', exchanges: [{ id: 'leather', quantity: 1 }] });
  const checkpoint = calls.findIndex(call => call.url === '/merchant/exchange-progress');
  assert.ok(checkpoint > 0);
  assert.equal(calls[checkpoint].body.remaining.length, 0);
  assert.equal(calls[checkpoint + 1], 'bank');
});

test('completed exchange resumes reward banking without repeating NPC exchange', async () => {
  const { r, calls } = runtime({ items1: [] });
  await r.merchantExchange({ jobId: 'retry', exchanges: [], exchangeResume: true });
  assert.equal(calls.includes('exchange'), false);
  assert.equal(calls.at(-1).body.success, true);
});

test('auto-bank errands cannot redeposit materials reserved for this exchange', async () => {
  const { r } = runtime({ items1: [] });
  r.character.items[0] = { name: 'leather', q: 40 };
  r.merchantVisitBank = async command => {
    assert.equal(command.merchantBankMarked.some(mark => mark.item.name === 'leather'), false);
    assert.equal(command.merchantBankMarked.length, 1);
  };
  await r.merchantExchange({ exchanges: [{ id: 'leather', quantity: 1 }], merchantBankMarked: [
    { slot: 0, item: { name: 'leather', q: 40 } }, { slot: 1, item: { name: 'drapes', q: 20 } }
  ] });
});
