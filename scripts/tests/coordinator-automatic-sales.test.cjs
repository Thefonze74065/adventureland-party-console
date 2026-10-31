const test = require('node:test');
const assert = require('node:assert/strict');
const {createAutomaticMerchantSales} = require('../../runtime/coordinator/merchant/automatic-sales.ts');
const {automaticCommerceRuleKey} = require('../../runtime/coordinator/inventory/item-identity.ts');

function fixture() {
  const state = {merchantCharacter:'M', autoNpcSales:{}, autoStandMarks:{}, npcSaleMarks:[],
    standListings:[], merchantCurrent:null, merchantQueue:[]};
  const calls = []; let id = 0;
  const service = createAutomaticMerchantSales(state, {
    now:()=>100, nextCommand:()=>++id,
    queue:(names,reason)=>{calls.push('queue');state.merchantQueue.push({target:names[0],reason});},
    publish:()=>calls.push('publish'), syncStand:()=>{calls.push('sync');return false;},
    idle:()=>calls.push('idle'), persist:()=>calls.push('persist'),
  });
  return {state,calls,service};
}
const item = {name:'leather',q:20};
const key = automaticCommerceRuleKey(item);
const status = {name:'M',items:[{slot:3,item}]};

// Failure inventory: e2e/automatic-bank-routing-failures.md.
test('Auto NPC discovers bank stock during an owned bank visit and owns retrieval independently',()=>{
 const f=fixture();f.state.autoNpcSales[key]={item};
 f.state.merchantAutomations={'auto npc sales':true,withdrawals:false,'party collection':false};
 f.state.merchantCurrent={id:'bank',target:'M',reason:'manual bank exchange'};
 f.state.bankSnapshot={packs:{items0:[{slot:0,item}]}};
 f.service.reconcile({name:'M',items:[]});
 assert.equal(f.state.withdrawals.M.length,1);
 assert.ok(f.state.merchantQueue.some(job=>job.reason==='auto npc withdrawals'));
 f.service.reconcile({name:'M',items:[]});
 assert.equal(f.state.withdrawals.M.length,1);
});

test('a displaced sale reclaims an automatic buy slot while two explicit orders remain',()=>{
 const {nativeAllocation,createNativeStand}=require('../../runtime/coordinator/commerce/native-stand.ts');
 const f=fixture();f.state.autoStandBuys=true;
 f.state.standBids={a:{useStandSlot:true,quantity:1,price:10},b:{useStandSlot:true,quantity:1,price:10},c:{quantity:1,price:10,priorityOverride:90},d:{quantity:1,price:10,priorityOverride:80}};
 f.state.standListings=Array.from({length:12},(_,i)=>({id:String(i),item:{name:'sale'+i},state:'live',tradeSlot:'trade'+(i+1)}));
 const paused={id:'pants',state:'paused',slot:28,tradeSlot:'trade12',item:{name:'frankypants',level:0},price:936000,quantity:1};
 f.state.standListings.push(paused);
 const slots={};const offers={};
 for(const [i,id] of ['a','b','c','d'].entries()) {const slot='trade'+(13+i);offers[id]={token:id,itemId:id,slot,revision:0,level:0,price:10,quantity:1,acknowledged:0,rid:id,auto:i>=2,phase:'live'};slots[slot]={name:id,b:true,level:0,price:10,q:1,rid:id};}
 f.state.nativeStand={sequence:4,offers,problems:{}};
 assert.equal(f.service.reconcile({name:'M',items:[{slot:16,item:paused.item}]}),true);
 assert.equal(paused.state,'configured');assert.equal(paused.slot,16);assert.equal(paused.tradeSlot,undefined);assert.equal(paused.price,936000);
 assert.deepEqual(nativeAllocation(f.state).map(e=>e.itemId),['a','b','c']);
 const native=createNativeStand(f.state,()=>assert.fail('eviction is not a purchase'));
 const actions=native.plan({slots,open:true,gold:10000,space:true},false);
 assert.deepEqual(actions.remove.map(o=>o.itemId),['d']);assert.equal(actions.create.length,0);
 assert.ok(f.calls.includes('sync'));
 f.calls.length=0;assert.equal(f.service.reconcile({name:'M',items:[{slot:16,item:paused.item}]}),false);assert.deepEqual(f.calls,[]);
});

test('displaced sales wait for physical stock and never displace explicit buy reservations',()=>{
 const f=fixture();f.state.standBids={a:{useStandSlot:true},b:{useStandSlot:true}};
 f.state.standListings=Array.from({length:14},(_,i)=>({id:String(i),state:'live'}));
 const paused={id:'pending',state:'paused',item,slot:9,price:99};f.state.standListings.push(paused);
 f.service.reconcile(status);assert.equal(paused.state,'paused');
 f.state.standListings.shift();f.service.reconcile({name:'M',items:[]});assert.equal(paused.state,'paused');
 f.service.reconcile({name:'M',items:[{slot:3,item:{...item,l:'l'}}]});assert.equal(paused.state,'paused');
 f.service.reconcile(status);assert.equal(paused.state,'configured');
});

test('banked auto-stand pants reserve four soft buy slots and queue one bounded withdrawal batch',()=>{
 const {nativeAllocation,createNativeStand}=require('../../runtime/coordinator/commerce/native-stand.ts');
 const f=fixture(), pants={name:'frankypants',level:0};
 f.state.autoStandBuys=true;f.state.autoStandMarks[automaticCommerceRuleKey(pants)]={price:936000};
 f.state.standBids=Object.fromEntries(['a','b','c','d','e','f'].map((id,i)=>[id,{price:10,quantity:2,useStandSlot:i<2}]));
 f.state.standListings=Array.from({length:10},(_,i)=>({id:'sale'+i,item:{name:'coat'},state:'live',tradeSlot:'trade'+(i+1)}));
 f.state.bankSnapshot={packs:{items0:Array.from({length:12},(_,slot)=>({slot,item:pants}))}};
 const offers={},slots={};
 for(const [i,id] of ['a','b','c','d','e','f'].entries()) {
   const slot='trade'+(11+i);offers[id]={token:id,itemId:id,slot,revision:0,level:0,price:10,quantity:2,acknowledged:0,rid:id,auto:i>=2,phase:'live'};
   slots[slot]={name:id,b:true,level:0,price:10,q:2,rid:id};
 }
 f.state.nativeStand={sequence:6,offers,problems:{}};
 assert.equal(f.service.reconcile({name:'M',items:[]}),true);
 assert.equal(f.state.standListings.length,14);
 assert.equal(f.state.withdrawals.M.length,4);
 assert.deepEqual(f.state.withdrawals.M.map(w=>w.slot),[0,1,2,3]);
 assert.ok(f.state.withdrawals.M.every(w=>w.standListingId && w.pack==='items0'));
 assert.equal(f.state.merchantQueue[0].reason,'manual bank exchange');
 assert.deepEqual(nativeAllocation(f.state).map(e=>e.itemId),['a','b']);
 const native=createNativeStand(f.state,()=>assert.fail('eviction must not consume an order'));
 assert.deepEqual(native.plan({slots,open:true,gold:10000,space:true},false).remove.map(o=>o.itemId),['c','d','e','f']);
 f.calls.length=0;assert.equal(f.service.reconcile({name:'M',items:[]}),false);assert.deepEqual(f.calls,[]);
 // Arriving stock must use the bank listings, even after bag slots change.
 assert.equal(f.service.reconcile({name:'M',items:Array.from({length:4},(_,i)=>({slot:20+i,item:pants}))}),false);
 assert.equal(f.state.standListings.length,14);
});

test('bank auto-stand protects locked, conflicting, and crafting stock and waits for active withdrawals',()=>{
 const f=fixture(), pants={name:'frankypants',level:0},key=automaticCommerceRuleKey(pants);
 f.state.autoStandMarks[key]={price:936000};
 f.state.bankSnapshot={packs:{items0:[{slot:0,item:{...pants,l:'l'}},{slot:1,item:pants}]}};
 f.state.withdrawals={M:[{pack:'items0',slot:1,item:pants}]};
 assert.equal(f.service.reconcile({name:'M',items:[]}),false);
 f.state.withdrawals.M=[];f.state.merchantCurrent={reason:'manual bank exchange'};
 assert.equal(f.service.reconcile({name:'M',items:[]}),false);
 f.state.merchantCurrent=null;
 f.state.merchantQueue=[{id:'craft',order:{crafts:[{id:'x',quantity:1}],requirements:[{id:'frankypants',level:0,quantity:2}]}}];
 assert.equal(f.service.reconcile({name:'M',items:[]}),false);
 f.state.merchantQueue=[];f.state.autoNpcSales[key]=true;
 assert.equal(f.service.reconcile({name:'M',items:[]}),false);
 delete f.state.autoNpcSales[key];
 assert.equal(f.service.reconcile({name:'M',items:[]}),true);
 assert.deepEqual(f.state.withdrawals.M.map(w=>w.slot),[1]);
});

test('NPC rules take precedence over stand rules and repeated status does not duplicate work',()=>{
  const f=fixture();f.state.autoNpcSales[key]=true;f.state.autoStandMarks[key]={price:99};
  assert.equal(f.service.reconcile(status),true);
  assert.equal(f.state.npcSaleMarks[0].quantity,20);assert.equal(f.state.npcSaleMarks[0].queuedAt,100);
  assert.equal(f.state.standListings.length,0);assert.deepEqual(f.calls,['queue','persist']);
  f.calls.length=0;assert.equal(f.service.reconcile(status),false);assert.deepEqual(f.calls,[]);
  f.state.merchantQueue=[];f.service.reconcile(status);assert.deepEqual(f.calls,['queue']);
});

test('stand marks publish and synchronize once, preserving the 16 listing limit',()=>{
  const f=fixture();f.state.autoStandMarks[key]={price:'99'};
  assert.equal(f.service.reconcile(status),true);assert.equal(f.state.standListings[0].price,99);
  assert.deepEqual(f.calls,['publish','sync','idle','persist']);
  f.calls.length=0;f.service.reconcile(status);assert.deepEqual(f.calls,[]);
  f.state.standListings=Array.from({length:16},(_,slot)=>({slot,state:'live'}));
  assert.equal(f.service.reconcile(status),false);assert.equal(f.state.standListings.length,16);
});

test('automatic sales ignore other characters, locked items, and invalid prices',()=>{
  const f=fixture();f.state.autoStandMarks[key]={price:1.5};
  assert.equal(f.service.reconcile(status),false);
  f.state.autoNpcSales[key]=true;
  assert.equal(f.service.reconcile({...status,name:'F'}),false);
  assert.equal(f.service.reconcile({name:'M',items:[{slot:3,item:{...item,l:'l'}}]}),false);
  assert.equal(f.service.reconcile(null),false);assert.deepEqual(f.calls,[]);
});

test('inventory sorting relocates existing sale intent without duplicating a queued trip',()=>{
  const f=fixture();f.state.autoNpcSales[key]=true;f.service.reconcile(status);f.calls.length=0;
  f.service.reconcile({name:'M',items:[{slot:7,item}]});
  assert.equal(f.state.npcSaleMarks.length,1);assert.equal(f.state.npcSaleMarks[0].slot,7);
  assert.deepEqual(f.calls,['persist']);
  f.state.merchantCurrent={reason:'npc sales'};f.state.merchantQueue=[];f.calls.length=0;
  f.service.reconcile({name:'M',items:[{slot:7,item}]});assert.deepEqual(f.calls,['persist']);
  assert.equal(f.state.npcSaleMarks[0].state,'running');
});
