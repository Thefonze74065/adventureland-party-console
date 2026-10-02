const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const shared = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const {availableCraftStock}=require('../../runtime/craft-reservations.ts');
const reservationPorts={partyAvailableCraftStock:availableCraftStock,request:async()=>({craftProtection:{requirements:[]}})};

test('bank ingredients schedule merchant auto-compound without an inventory triple', () => {
  const queued = [];
  const party = { merchantCharacter: 'M', merchantAutomations: {}, autoCompounds: {
    M: [{ name: 'hpamulet', targetTier: 4, quantity: -1 }],
  }, bankSnapshot: { packs: { items0: Array.from({ length: 23 }, () => ({ item: { name: 'hpamulet', level: 0 } })) } } };
  const {createImprovementScheduler}=require('../../runtime/coordinator/merchant/improvement-scheduler.ts');
  const scheduler=createImprovementScheduler(Object.assign(party,{production:party.production||{attempts:{}}}),{now:()=>100,nextCommand:()=>1,stamp:job=>job,
    log(){},persist(){},queue:names=>queued.push(names)});
  assert.equal(scheduler.compound('M', { items: [] }), true);
  assert.equal(queued.length, 1);
});

function batchRuntime(space, hasScroll = false) {
  const calls = [];
  const r = vm.createContext({ ...reservationPorts, character: { name:'M', items:[], esize: space, bank: { items0: [
    { name: 'hpamulet', level: 0 }, { name: 'hpamulet', level: 1 },
    { name: 'hpamulet', level: 0 }, { name: 'hpamulet', level: 0 },
    { name: 'hpamulet', level: 0, l: 'l' },
  ] } }, item_grade: () => 0, findInventoryItemByName: () => hasScroll ? 5 : -1,
  bank_retrieve: async (pack, slot) => calls.push([pack, slot]) });
  vm.runInContext(shared.slice(shared.indexOf('  async function retrieveAutoCompoundBatch('),
    shared.indexOf('  function manualImprovementScrollNeeds(')), r);
  return { r, calls };
}

test('withdraw only a matching triple and reserve the scroll slot', async () => {
  const { r, calls } = batchRuntime(4);
  const command = {};
  await r.retrieveAutoCompoundBatch('hpamulet', 0, 0, command);
  assert.deepEqual(calls, [['items0', 0], ['items0', 2], ['items0', 3]]);
  assert.equal(command._autoCompoundBankItems.filter(item=>!item.l && item.level===0).length, 0);
});

test('insufficient workspace fails before partial withdrawal; existing scroll needs no extra slot', async () => {
  const blocked = batchRuntime(2);
  await assert.rejects(blocked.r.retrieveAutoCompoundBatch('hpamulet', 0, 0, {}), /inventory_full/);
  assert.equal(blocked.calls.length, 0);
  const ready = batchRuntime(2, true);
  ready.r.character.items=[{name:'hpamulet',level:0}];
  await ready.r.retrieveAutoCompoundBatch('hpamulet', 0, 1, {});
  assert.equal(ready.calls.length, 2);
});

test('bank-backed improvement builds successive tiers without bulk withdrawals', async () => {
  const character = { level: 1, items: Array(8).fill(null), bank: { items0:
    Array.from({ length: 9 }, () => ({ name: 'hpamulet', level: 0 })) } };
  Object.defineProperty(character, 'esize', { get: () => character.items.filter(item => !item).length });
  let compounds = 0, withdrawals = 0;
  const r = vm.createContext({ ...reservationPorts, character, G: {},
    merchantVisitBank: async () => {}, merchantOperationStage: async () => {}, item_grade: () => 0,
    findInventoryItemByName: name => character.items.findIndex(item => item && item.name === name),
    bank_retrieve: async (pack, slot) => {
      character.items[character.items.indexOf(null)] = character.bank[pack][slot];
      character.bank[pack][slot] = null;
      withdrawals++;
    },
    ensureOwnedItemQuantity: async name => { character.items[character.items.indexOf(null)] = { name, q: 99 }; },
    smart_move: async () => {}, find_npc: name => name,
    compoundConfirmed: async (a, b, c) => {
      character.items[a].level++;
      character.items[b] = character.items[c] = null;
      compounds++;
    }, fingerprint: item => item,
  });
  vm.runInContext(shared.slice(shared.indexOf('  async function merchantImprove('),
    shared.indexOf('  function manualImprovementScrollNeeds(')), r);
  await r.merchantImprove({ type: 'merchant-self-improve', autoCompounds: [
    { name: 'hpamulet', targetTier: 2, quantity: 1 },
  ] }, []);
  assert.equal(withdrawals, 9);
  assert.equal(compounds, 4);
  assert.equal(character.items.filter(item => item && item.name === 'hpamulet' && item.level === 2).length, 1);
});

function eventRuntime() {
  const names = ['Q', 'D', 'H'];
  const cycle = { target: 'Q', endsAt: 2000, combatEvent: 'crabxx', combatHandoffAt: 1 };
  const destination = { map: 'cave', x: -194, y: -461 };
  const party = { leader: 'Q', farmingPolicy: 'default', anniversary: { eventCycle: cycle },
    statuses: Object.fromEntries(names.map(name => [name, { map: 'main', x: 0, y: 0 }])),
    commands: {}, eventSessions: {}, deferredEventReturns: {}, eventReturn: { event: 'crabxx', pending: [], participants: names, checkpoint: destination } };
  let now = 1000, starts = 0;
  Object.assign(party, { nextCommandId: 1, merchantCharacter: 'M', followers: { D: true, H: true },
    location: destination, characterLocations: {}, navigationIntents: {} });
  Object.values(party.statuses).forEach(status => { status.seenAt = 1000; });
  const r = vm.createContext({ party, Date: { now: () => now }, activeNames: () => names,
    eventsEnabledFor: () => true, eventCheckpoint: () => destination,
    anniversaryCombatParticipants: () => names, selectedMonsterDestination: () => null,
    persistSettings() {}, startPartyMonsterConvoy: () => { starts++; party.activeConvoy = { id: 'convoy' }; return true; },
    beginEventReturn: () => { throw new Error('unexpected orphan recovery'); } });
  r.farmingNavigation = require('../farming-navigation.cjs')(party, { names: () => names, activeNames: () => names,
    now: () => now, persist() {}, log() {}, cancelConvoy: () => { party.activeConvoy = null; },
    startConvoy: (...args) => r.startPartyMonsterConvoy(...args) });
  Object.assign(r, require('./helpers/coordinator-events.cjs').eventService(r));
  return { party, r, setTime: value => now = value, starts: () => starts };
}

test('combat handoff skips featured waiting, retains ownership until arrival, then clears it', () => {
  const t = eventRuntime();
  assert.equal(t.r.finishEventReturnIfReady(), true);
  assert.ok(t.party.eventReturn);
  t.setTime(2001);
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 1);
  assert.ok(t.party.eventReturn.convoyId);
  t.party.activeConvoy = null;
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 1, 'allow a short status synchronization window before retrying');
  t.setTime(4002);
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 2, 'the party still in town retries together, without waiting for someone at the farm');
  assert.equal(t.party.activeConvoy.id,t.party.eventReturn.convoyId);
  t.party.activeConvoy = null;
  Object.values(t.party.statuses).forEach(status => Object.assign(status, { map: 'cave', x: -194, y: -461 }));
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.eventReturn, null);
  assert.equal(t.party.anniversary.eventCycle.returnCompletedAt, 4002);
});

test('reload restores missing town commands without overwriting another command', () => {
  const t = eventRuntime();
  t.party.nextCommandId = 1;
  t.party.eventReturn.pending = ['Q', 'D'];
  t.party.eventReturn.cycleId = 'return';
  t.party.commands.D = { type: 'existing-work' };
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.commands.Q.type, 'event-return-town');
  assert.equal(t.party.commands.Q.cycleId, 'return');
  assert.equal(t.party.commands.D.type, 'existing-work');
});

test('old orphaned anniversary handoff reconstructs the combat return', () => {
  const t = eventRuntime();
  t.setTime(2001);
  t.party.eventReturn = null;
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.eventReturn.event, 'crabxx');
  assert.equal(t.party.eventReturn.pending.length, 3);
  t.party.eventReturn = null;
  t.party.statuses.D.serverLiveEvents = [{ name: 'crabxx' }];
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.eventReturn, null, 'a still-live combat event retains control');
});

test('a new featured round regroups every participant and resumes only after expiry', () => {
  const t = eventRuntime();
  t.party.nextCommandId = 1;
  t.party.eventReturn.startedAt = 10;
  t.party.eventReturn.cycleId = 'return';
  t.party.eventReturn.convoyId = 'old';
  t.party.activeConvoy = { id: 'old' };
  Object.assign(t.party.anniversary.eventCycle, { id: 'new-round', stagedAt: 20 });
  delete t.party.anniversary.eventCycle.combatHandoffAt;
  delete t.party.anniversary.eventCycle.combatEvent;
  t.r.cancelActiveConvoy = () => { t.party.activeConvoy = null; };
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.eventReturn.pending.length, 3);
  assert.equal(Object.values(t.party.commands).filter(command => command.type === 'event-return-town').length, 3);
  t.party.eventReturn.pending = [];
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 0);
  t.setTime(2001);
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 1);
});
