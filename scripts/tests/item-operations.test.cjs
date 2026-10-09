const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
test('upgrade and compound placeholders expose real server chance, smoke and level transition', () => {
  const r = vm.createContext({ activeUpgrade: { slot: 0, item: { name: 'wshoes', level: 6, stat_type: 'int' } },
    fingerprint: item => item && { ...item }, itemDefinition: item => ({ sprite: { name: item.name } }) });
  vm.runInContext(extract('  function inventoryOperationEntry(', '  async function compoundConfirmed('), r);
  for (const [scroll, type] of [['scroll0', 'upgrade'], ['cscroll0', 'compound']]) {
    const entry = r.inventoryOperationEntry({ name: 'placeholder', p: { name: 'wshoes', level: 6, chance: 0.4215, scroll } }, 0);
    assert.equal(entry.item.name, 'wshoes'); assert.equal(entry.item.stat_type, 'int');
    assert.equal(entry.operation.type, type); assert.equal(entry.operation.chance, 0.4215);
    assert.equal(entry.operation.fromLevel, 6); assert.equal(entry.operation.toLevel, 7);
    assert.equal(entry.operation.sprite.name, 'placeholder');
  }
  assert.equal(r.inventoryOperationEntry({ name: 'wshoes', level: 7 }, 0).operation, undefined);
});
test('placeholder remains pending even when queue proxy disappears before the result', async () => {
  let now = 0;
  const character = { items: [{ name: 'wshoes', level: 3 }], q: {} };
  const r = vm.createContext({ character, activeUpgrade: null, fingerprint: item => item && { ...item },
    Date: { now: () => now }, setTimeout: (cb, ms) => { now += ms; if (now >= 2500) character.items[0] = { name: 'wshoes', level: 4 }; cb(); },
    upgrade: () => { character.items[0] = { name: 'placeholder', p: { name: 'wshoes', level: 3 } }; return Promise.resolve({ success: true, num: 0 }); } });
  require('./helpers/client-dependencies.cjs').merchantGuards(r,{journal:true});
  vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source,'observedUpgradeConfirmed'),r);
  vm.runInContext(extract('  async function upgradeConfirmed(', '  async function waitForPlayer('), r);
  const result = await r.upgradeConfirmed(0, 1);
  assert.equal(result.toLevel, 4); assert.equal(r.activeUpgrade, null);
});
function loopRuntime(operation) {
  const character = { items: [{ name: 'wshoes', level: 0 }, { name: 'wshoes', level: 0 }] };
  const calls = [];
  const r = vm.createContext({ character, G: { items: { wshoes: {} } }, maximumItemLevel: () => 13, merchantOperationStage: async () => {},
    sameItem: (a, b) => a && a.name === b.name && a.level === b.level, fingerprint: item => item && { ...item },
    item_grade: () => 0, findInventoryItemByName: () => 9, find_npc: () => 'upgrade', smart_move: async () => {},
    upgradeConfirmed: async slot => { calls.push(slot); return operation(character, slot, calls.length); } });
  vm.runInContext(extract('  function findUpgradeMarkSlot(', '  async function retrieveAutoCompoundBatch('), r);
  return { r, calls, command: { upgrades: [1, 0].map(slot => ({ slot, item: { name: 'wshoes', level: 0 }, tiers: 3 })) } };
}
test('finish exact marked slot before another identical copy, retrying a confirmed surviving failure', async () => {
  const { r, calls, command } = loopRuntime((character, slot, attempt) => {
    if (attempt === 2) return { success: false };
    character.items[slot].level++;
  });
  await r.merchantImprove(command, []);
  assert.deepEqual(calls, [1, 1, 1, 1, 0, 0, 0]);
});
test('uncertain confirmation stops work instead of silently switching copies', async () => {
  const { r, calls, command } = loopRuntime(() => { throw new Error('confirmation uncertain'); });
  await assert.rejects(r.merchantImprove(command, []), /confirmation uncertain/);
  assert.deepEqual(calls, [1]);
});
test('confirmed destruction allows the next copy', async () => {
  const { r, calls, command } = loopRuntime((character, slot) => {
    if (slot === 1) { character.items[slot] = null; throw Object.assign(new Error('poof'), { reason: 'upgrade_destroyed' }); }
    character.items[slot].level++;
  });
  await r.merchantImprove(command, []);
  assert.deepEqual(calls, [1, 0, 0, 0]);
});

test('retry resumes the same partially upgraded slot and preserves the original final level', async () => {
  const { r, calls, command } = loopRuntime((character, slot, attempt) => {
    if (attempt === 2) throw Object.assign(new Error('interrupted'), { reason: 'interrupted' });
    character.items[slot].level++;
  });
  await assert.rejects(r.merchantImprove(command, []), /interrupted/);
  assert.equal(r.character.items[1].level, 1);
  await r.merchantImprove(command, []);
  assert.deepEqual(calls, [1, 1, 1, 1, 0, 0, 0]);
  assert.equal(r.character.items[1].level, 3, 'retry must not raise the original target to +4');
});

test('partial progress does not match an unrelated item in the marked slot', () => {
  const { r, command } = loopRuntime(() => {});
  r.character.items[1] = { name: 'different', level: 1 };
  r.character.items[0] = null;
  assert.equal(r.findUpgradeMarkSlot(command.upgrades[0], {}), -1);
});

for(const response of [{failed:true,success:false,num:0},undefined,{failed:true,success:false,num:1}])
test('destruction needs a matching server failure: '+JSON.stringify(response),async()=>{
 let now=0;const character={items:[{name:'coat',level:2}],q:{}};
 const c=vm.createContext({character,activeUpgrade:null,fingerprint:i=>i&&({...i}),merchantMassBuff:async()=>false,
  Date:{now:()=>now},setTimeout:(cb,ms)=>{now+=ms;cb();},
  upgrade:()=>{character.items[0]=null;return Promise.resolve(response);}});
 vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source,'upgradeAtSlotConfirmed'),c);
 await assert.rejects(c.upgradeAtSlotConfirmed(0,1,'coat',3),e=>{
  if(response?.num===0){assert.equal(e.reason,'upgrade_destroyed');assert.equal(e.confirmedDestroyed,true);}
  else {assert.match(e.message,/uncertain/);assert.notEqual(e.confirmedDestroyed,true);}
  return true;
 });
});

test('upgrade preparation follows an item relocated during the protection checkpoint',async()=>{
 const items=[{name:'coat',level:2},null,{name:'scroll0',q:2}],calls=[];
 const c=vm.createContext({character:{ctype:'merchant',items},luckyUpgradeSlot:0,
  verifyMerchantItemMarks:async()=>{items[5]=items[0];items[0]=null;},
  findInventoryItemByName:name=>items.findIndex(i=>i?.name===name),
  luckySlotTracking:()=>({begin(){}}),
  merchantLuckyUpgrade:()=>({run:async(from,scroll,_selected,action)=>action(from,scroll)}),
  upgradeAtSlotConfirmed:async(slot,scroll)=>{calls.push([slot,scroll]);return {slot,item:{name:'coat',level:3}};}});
 require('./helpers/client-dependencies.cjs').productionJournalContext(c);
 vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source,'observedUpgradeConfirmed'),c);
 const result=await c.observedUpgradeConfirmed(0,2,'coat',3);
 assert.deepEqual(calls,[[5,2]]);assert.equal(result.slot,5);
});
