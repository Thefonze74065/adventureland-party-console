const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
function fixture(items, capacity = 42, extra = {}) {
  const sent = []; let receipt;
  const character = {items, isize: 42, slots: {}, gold: 0, name: 'F', map:'main', in:'main', x:0, y:0, cc:0, rip:false};
  const context = vm.createContext({character, G: {items: {
    weapon: {type: 'weapon'}, armor: {type: 'chest'}, ring: {type: 'ring'}, ingredient: {type: 'material'}
  }}, waitForPlayer: async()=>({}), assertMerchantContinuation(){},
  navigationIntent:{revision:1},lastCommand:1,runtimeCurrent:()=>true,reunionRealm:()=> 'USI',
  get_player:()=>({map:'main',in:'main',x:1,y:0,rip:false}),engagedMonster:()=>null,sleep:async()=>{},
  fingerprint: item=>({...item}), itemQuantity: item=>item?.q || 1,
  sameItem:(a,b)=>!!a && a.name===b.name, findItem: item=>items.findIndex(i=>i?.name===item.name),
  freeInventorySlots:()=>42-items.filter(Boolean).length,
  send_item:async(_,slot,q)=>{sent.push(items[slot].name); if(q >= (items[slot].q || 1)) items[slot]=null; else items[slot].q-=q;},
  request:async(_,options)=>{receipt=options.body;}, game_log(){}
  });
 require('./helpers/client-dependencies.cjs').merchantGuards(context,{stock:true});
  vm.runInContext(source.slice(source.indexOf('  function cleanoutProtected('),source.indexOf('  async function withMerchantHandoffRecovery(')),context);
  vm.runInContext(source.slice(source.indexOf('  async function waitForHandoffSendWindow('),source.indexOf('  async function merchantOrderHandoff(')),context);
  return {sent, run:async()=>{await context.merchantHandoff({id:1,cleanout:true,capacity,merchant:'M',...extra});return receipt;}};
}
const bag=(front, size=42)=>[...front,...Array.from({length:size-front.length},()=>({name:'locked',l:true}))];
test('emergency cleanout protects supplies and tracktrix and orders remaining categories',async()=>{
  const f=fixture(bag(['weapon','armor','ring','ingredient','tracker','hpot0','mpot0','hpot1','mpot1'].map(name=>({name}))));
  const receipt=await f.run();
  assert.deepEqual(f.sent,['ingredient','ring','armor','weapon']);
  assert.equal(receipt.cleanoutRemaining,false);
});
test('manual and automatic marks precede extras; spare capacity cleans beyond emergency relief',async()=>{
  const f=fixture(bag(['weapon','ingredient','ring','armor','ingredient'].map(name=>({name}))),42,{
    marked:[{slot:0,item:{name:'weapon'}}],autoItemMarks:{armor:'merchant'}
  });
  const receipt=await f.run();
  assert.deepEqual(f.sent,['weapon','armor','ingredient','ingredient','ring']);
  assert.equal(receipt.cleanoutRemaining,false);
});
test('a capacity-limited pickup does not request another visit once emergency clears',async()=>{
  const f=fixture(bag(['ingredient','ring','armor','weapon'].map(name=>({name})),40),2);
  const receipt=await f.run();
  assert.deepEqual(f.sent,['ingredient','ring']);
  assert.equal(receipt.cleanoutRemaining,false);
});
test('remaining emergency may retry, but a stale cleanout leaves unmarked items alone',async()=>{
  const f=fixture(bag(['ingredient','ring','armor','weapon'].map(name=>({name}))),2);
  assert.equal((await f.run()).cleanoutRemaining,true);
  const safe=fixture(bag([{name:'ingredient'},{name:'weapon'}],38));
  assert.equal((await safe.run()).cleanoutRemaining,false);
  assert.deepEqual(safe.sent,[]);
});
test('all marked pickups run before emergency extras, even after enough slots are free',async()=>{
  const names=['weapon','armor','ring','ingredient','ingredient'];
  const f=fixture(bag(names.map(name=>({name})),39),42,{
    marked:names.map((name,slot)=>({slot,item:{name}}))
  });
  assert.equal((await f.run()).cleanoutRemaining,false);
  assert.deepEqual(f.sent,names);
});
test('cleanout protects explicitly marked supplies and live locked items too',async()=>{
  const f=fixture(bag([{name:'tracker'},{name:'hpot0'},{name:'mpot0'},{name:'weapon',l:true},{name:'ingredient'}]),42,{
    marked:['tracker','hpot0','mpot0','weapon'].map((name,slot)=>({slot,item:{name}}))
  });
  await f.run();
  assert.deepEqual(f.sent,['ingredient']);
});
