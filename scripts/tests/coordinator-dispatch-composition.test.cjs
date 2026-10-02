const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorMerchantDispatcher } = require('../../runtime/coordinator/merchant/dispatch-composition.ts');
function fixture() {
  const state = { merchantQueue: [{ id: 'job', target: 'M', reason: 'restock' }], merchantCurrent: null,
    nextCommandId: 7, merchantCharacter: 'M', bankbois: {}, bankboiTransaction: null, commands: {}, gatheringModes: [], gatheringCooldowns: {},
    statuses: { M: { seenAt: 100, server: 'USII' } }, activeRealm: 'SR_USII', aldata: { key: 'fixture' }, threshold: 100,
    merchantCargo: {}, npcSaleMarks: [], standListings: [], marked: {}, upgrades: {}, purchases: {}, compounds: {}, autoCompounds: {},
    withdrawals: {}, statScrolls: {}, merchantDeliveries: {}, goldTargets: {} };
  const calls = [], restock = { hp: { max: 20 } };
  const ports = { now: () => 100, ensureHome: () => true, routineNeedsHome: () => false,
    storageBusy: () => false, storagePlan: () => null, startStorage: async () => calls.push('storage'),
    anniversary: () => ({}), routinePriority: () => 0, priority: () => 1, capacityBlocked: () => false, collectionReady: () => true,
    pick: () => state.merchantQueue.shift(), stamp: job => job, planPonty: () => null,
    restock: () => restock, idle: () => calls.push('idle'), persist: () => calls.push('persist'), log() {} };
  return { state, calls, ports, restock, service: createCoordinatorMerchantDispatcher(Object.assign(state,{production:state.production||{attempts:{}}}), ports) };
}

test('party collection carries the recipient delivery and equip instruction across dispatch', () => {
  const f = fixture(), delivery = {slot:24,item:{name:'wattire',level:8,stat_type:'int'},equipOnDelivery:true};
  f.state.merchantDeliveries.QwenTina = [delivery];
  f.state.statuses.QwenTina = {seenAt:100,server:'USII',map:'winterland',x:500,y:500,items:[]};
  f.state.merchantQueue = [{id:'delivery',target:'QwenTina',reason:'party collection'}];
  f.service.dispatch();
  assert.equal(f.state.commands.M.target,'QwenTina');
  assert.deepEqual(f.state.commands.M.merchantDeliveries,[delivery]);
  assert.equal(f.state.commands.M.merchantDeliveries[0].equipOnDelivery,true);
});

test('delivery-only visit dispatches without any other work and retains only ready marks',()=>{
 const f=fixture(),delivery={id:'d',slot:2,item:{name:'sword'},equipOnDelivery:true};
 f.state.merchantDeliveries.P=[delivery,{item:{name:'ring'},blocked:'uncertain'},{item:{name:'coat'},awaitingEquip:true},{}];
 f.state.statuses.P={seenAt:100,server:'USII',map:'main',x:500,y:500,items:[]};
 f.state.merchantQueue=[{id:'d',target:'P',reason:'deliveries'}];f.service.dispatch();
 assert.equal(f.state.commands.M.type,'merchant-service');assert.equal(f.state.commands.M.target,'P');
 assert.deepEqual(f.state.commands.M.merchantDeliveries,[delivery]);
 assert.deepEqual(f.state.commands.M.upgrades,[]);assert.deepEqual(f.state.commands.M.purchases,[]);
});

test('completed or blocked deliveries leave no empty trip, while disabled scheduling preserves other visits',()=>{
 for(const marks of [[],[{item:{name:'ring'},blocked:'uncertain'}],[{item:{name:'coat'},awaitingEquip:true}]]) {
  const f=fixture();f.state.merchantDeliveries.P=marks;
  f.state.merchantQueue=[{id:'d',target:'P',reason:'deliveries'}];f.service.dispatch();
  assert.equal(f.state.merchantCurrent,null);assert.deepEqual(f.state.merchantQueue,[]);
 }
 for(const reason of ['manual visit','party collection','restock']) {
  const f=fixture(),delivery={id:'d',item:{name:'sword'}};
  f.state.merchantAutomations={deliveries:false,'party collection':false};
  f.state.merchantDeliveries.P=[delivery];f.state.statuses.P={seenAt:100,server:'USII',items:[]};
  f.state.merchantQueue=[{id:'d',target:'P',reason:'deliveries'},{id:'visit',target:'P',reason,manual:true}];
  f.service.dispatch();assert.equal(f.state.merchantCurrent.id,'visit');
  assert.deepEqual(f.state.commands.M.merchantDeliveries,[delivery]);
 }
});
