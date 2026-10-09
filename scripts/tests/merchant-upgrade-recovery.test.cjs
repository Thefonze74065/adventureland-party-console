const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shared = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();

test('upgrade reselects a scroll moved during its asynchronous protection checkpoint', async () => {
  const {namedFunction} = require('./helpers/named-function.cjs');
  const items = [{name:'wcap',level:1},{name:'scroll0',q:4},null];
  let selected;
  const context = vm.createContext({character:{ctype:'merchant',items}, luckyUpgradeSlot:7,
    verifyMerchantItemMarks:async()=>{items[2]=items[1];items[1]=null;},
    findInventoryItemByName:name=>items.findIndex(item=>item?.name===name),
    merchantLuckyUpgrade:()=>({run:async(item,scroll)=>{selected=scroll;return {success:true};}}),
  });
  require('./helpers/client-dependencies.cjs').productionJournalContext(context);
  vm.runInContext(namedFunction(shared,'observedUpgradeConfirmed'),context);
  await context.observedUpgradeConfirmed(0,1,'wcap',1);
  assert.equal(selected,2);
});
for(const [verified,candidate,expected] of [[null,0,0],[null,null,2],[7,0,7]])test('upgrade executes selected slot and restores inventory: '+JSON.stringify({verified,candidate}),async()=>{
 const {createLuckyUpgrade}=require('../../runtime/characters/lucky-upgrade.ts');
 const {namedFunction}=require('./helpers/named-function.cjs');
 const items=Array(42).fill(null);items[2]={name:'wcap',level:0};items[4]={name:'scroll0',q:2};items[0]={name:'tracker'};
 let journal=null,clock=0,begins=0;const calls=[];
 const service=createLuckyUpgrade({item:slot=>items[slot],busy:()=>false,swap:async(a,b)=>{[items[a],items[b]]=[items[b],items[a]];},
  read:()=>journal,write:value=>journal=value,now:()=>clock,sleep:async ms=>clock+=ms,current:()=>true,log:()=>{}});
 const context=vm.createContext({character:{ctype:'merchant',items},luckyUpgradeSlot:verified,
  luckySlotTracking:()=>({select:()=>candidate,begin:()=>begins++}),verifyMerchantItemMarks:async()=>{},
  findInventoryItemByName:name=>items.findIndex(item=>item?.name===name),merchantLuckyUpgrade:()=>service,
  upgradeAtSlotConfirmed:async(slot,scroll)=>{calls.push([slot,scroll]);items[slot].level++;items[scroll].q--;return {success:true};}});
 require('./helpers/client-dependencies.cjs').productionJournalContext(context);
 vm.runInContext(namedFunction(shared,'observedUpgradeConfirmed'),context);await context.observedUpgradeConfirmed(2,4,'wcap',1);
 assert.deepEqual(calls,[[expected,4]]);assert.equal(begins,1);assert.equal(items[2].level,1);assert.equal(items[0].name,'tracker');assert.equal(journal,null);
});

test('bank-sourced pass persists before production and resumes at its original target after relocation', () => {
  const {beginProduction, finishProduction} = require('../../runtime/coordinator/inventory/production.ts');
  const {reconcileCoordinatorUpgradeMarks} = require('../../runtime/coordinator/inventory/mark-reconciliation.ts');
  const {processingPending} = require('../../runtime/coordinator/inventory/shared-rules.ts');
  const {party, r, status} = marksRuntime();
  Object.assign(party, {merchantCharacter:'M', production:{attempts:{}}, autoCompounds:{}});
  const mark = {passId:'pass',slot:19,item:{name:'wcap',level:0},tiers:8,auto:true};
  beginProduction(party,{id:'first',kind:'upgrade',item:mark.item,automatic:{family:'upgrade',key:'wcap@+0',mark}});
  assert.deepEqual(party.upgrades.M,[mark]);
  finishProduction(party,'first',true);
  const busy = {items:[],upgradeInventoryBusy:true};
  assert.equal(reconcileCoordinatorUpgradeMarks(party,'M',busy),false);
  assert.deepEqual(party.upgrades.M,[mark]);
  party.upgrades=JSON.parse(JSON.stringify(party.upgrades));
  const snapshot=status(4);snapshot.items[0].slot=7;
  r.reconcileAutoUpgradeMarks('M',snapshot);
  assert.deepEqual(party.upgrades.M,[{...mark,slot:7}]);
  assert.equal(processingPending(party,{name:'wcap',level:4}),true);
  assert.equal(processingPending(party,{name:'wcap',level:8}),false);
  r.clearResolvedUpgradeMarks('M',[mark]);
  assert.deepEqual(party.upgrades.M,[]);
});

test('relocating a pass does not steal a survivor already owned by another pass', () => {
  const {party,r,status}=marksRuntime();r.reconcileAutoUpgradeMarks('M',status(0));
  const existing={...party.upgrades.M[0],slot:7,passId:'other'};
  party.upgrades.M.push(existing);
  const snapshot=status(4);snapshot.items[0].slot=7;
  r.reconcileAutoUpgradeMarks('M',snapshot);
  assert.deepEqual(party.upgrades.M,[existing]);
});

function marksRuntime() {
  const party = { autoUpgradeMarks: { M: { 'wcap@+0': { tiers: 8, quantity: -1 } } }, upgrades: { M: [] } };
  const policies = require('../../runtime/coordinator/inventory/upgrade-marks.ts');
  const r = {
    reconcileAutoUpgradeMarks(name, status) {
      const result = policies.reconcileUpgradeMarks(party.upgrades[name] || [], party.autoUpgradeMarks[name] || {}, status.items);
      party.upgrades[name] = result.marks;
      return result.changed;
    },
    clearResolvedUpgradeMarks(name, resolved) {
      party.upgrades[name] = policies.clearResolvedUpgradeMarks(party.upgrades[name] || [], resolved);
    },
  };
  return { party, r, status: level => ({ items: [
    { slot: 19, item: { name: 'wcap', level }, meta: { upgradeable: true } },
  ] }) };
}

test('automatic +0 to +8 intent survives intermediate +1 and +4 statuses and reconnects', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  for (const level of [1, 4, 8]) {
    party.upgrades = JSON.parse(JSON.stringify(party.upgrades));
    r.reconcileAutoUpgradeMarks('M', status(level));
    assert.equal(party.upgrades.M.length, 1);
    assert.equal(party.upgrades.M[0].item.level, 0);
    assert.equal(party.upgrades.M[0].tiers, 8);
  }
});

test('a rule at the intermediate level cannot replace the unfinished original target', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  party.autoUpgradeMarks.M['wcap@+4'] = { tiers: 5, quantity: -1 };
  r.reconcileAutoUpgradeMarks('M', status(4));
  assert.equal(party.upgrades.M[0].item.level, 0);
  assert.equal(party.upgrades.M[0].tiers, 8);
});

test('destroyed items and removed rules retire automatic marks', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  r.reconcileAutoUpgradeMarks('M', { items: [] });
  assert.equal(party.upgrades.M.length, 0);
  r.reconcileAutoUpgradeMarks('M', status(0));
  party.autoUpgradeMarks.M = {};
  r.reconcileAutoUpgradeMarks('M', status(4));
  assert.equal(party.upgrades.M.length, 0);
});

test('finishing one batch preserves upgrade marks queued during that batch', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  const dispatched = JSON.parse(JSON.stringify(party.upgrades.M));
  const snapshot = status(4);
  snapshot.items.push({ slot: 25, item: { name: 'wcap', level: 0 }, meta: { upgradeable: true } });
  r.reconcileAutoUpgradeMarks('M', snapshot);
  r.clearResolvedUpgradeMarks('M', dispatched);
  assert.equal(party.upgrades.M.length, 1);
  assert.equal(party.upgrades.M[0].slot, 25);
});

test('the Town watchdog cannot interrupt merchant work even with a stale global hold', async () => {
  let guard;
  const stops = [];
  const r = vm.createContext({ escapeOwns: () => false, character: { ctype: 'merchant', map: 'main', x: -207, y: -220 },
    root: {}, partyTownActive: true, townTraveling: false, townOverrideInFlight: false,
    smart: { moving: true }, stop: kind => stops.push(kind), is_moving: () => true,
    setInterval: callback => { guard = callback; return 1; }, clearInterval() {},
  });
  vm.runInContext(shared.slice(shared.indexOf('  async function enforcePartyTownOverride('),
    shared.indexOf('  async function tick()')), r);
  await r.enforcePartyTownOverride();
  r.maintainTownOverrideGuard();
  guard();
  assert.deepEqual(stops, []);
  assert.equal(r.root.__partyTownGuardTimer, null);
});
