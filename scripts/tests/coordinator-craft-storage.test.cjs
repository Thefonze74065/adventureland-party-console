const test = require('node:test');
const assert = require('node:assert/strict');
const { createMerchantOrderRoute } = require('../../runtime/coordinator/http/merchant-order.ts');
const { createStorageReferenceUpdates } = require('../../runtime/coordinator/inventory/bankboi-completion.ts');
const { coordinatorStorageIdentity } = require('../../runtime/coordinator/inventory/storage-service.ts');
function fixture() {
 const entry = (name, slot, q = 1, level = 0) => ({slot, item:{name,q,level}});
 const state = {merchantCharacter:'M', merchantCatalog:{buyable:[{id:'vitscroll',cost:1}],craftable:[{id:'tristone',materials:['intring','strring','dexring','vitscroll'].map(id=>({id,quantity:1,level:0}))}]},
 statuses:{M:{items:[entry('strring',0,2)]},P:{items:[entry('intring',0),entry('dexring',1,2)]},B:{items:[entry('intring',0,99)]}},
 bankSnapshot:{packs:{items0:[entry('strring',2,2),entry('dexring',3,2)]}},
 bankbois:{B:{items:[entry('intring',0),entry('intring',1),entry('intring',2),entry('intring',3,20,1)]},C:{items:[entry('vitscroll',4,20)]}},
 withdrawals:{},merchantQueue:[],merchantCurrent:null,standListings:[],npcSaleMarks:[]};
 const effects=[];let sequence=0;
 const route=createMerchantOrderRoute(state,{now:()=>100,nextCommand:()=>++sequence,activeNames:()=>['M','P','B'],log(){},persist(){},persistBank(){effects.push('bank')},dispatch(){effects.push('dispatch')},bankboi:async()=>effects.push('storage')});
 const post=async(quantity=4)=>{const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};await route.handle({body:{crafts:[{id:'tristone',quantity}]}},res);return res};
 return {state,effects,post};
}
test('four Tri-Stones allocate merchant, normal bank, offline BankBois, then party exactly once',async()=>{
 const f=fixture();assert.equal((await f.post()).code,200);const job=f.state.merchantQueue[0],o=job.order;
 assert.equal(job.blockedOnBankboi,true);assert.equal(o.storage.length,4);assert.equal(o.sources.P[0].item.name,'intring');
 assert.equal(o.sources.B,undefined);assert.ok(o.bank.every(a=>a.pack.startsWith('items')));assert.equal(o.materialBuys.length,0);
 assert.equal(f.state.withdrawals.M.length,4);assert.equal(f.state.withdrawals.M[3].item.q,20);assert.equal(o.storage[3].quantity,4);
 assert.equal((await f.post()).body.duplicate,true);assert.equal(f.state.withdrawals.M.length,4);
});
test('exact levels and total cart shortages survive structured 409; NPC deficits remain buyable',async()=>{
 const f=fixture();const res=await f.post(5);assert.equal(res.code,409);
 assert.deepEqual(res.body.missing.find(m=>m.id==='intring'),{id:'intring',level:0,quantity:1,required:5,available:4});
 assert.equal(f.state.merchantQueue.length,0);delete f.state.bankbois.C;
 assert.equal((await f.post()).code,200);assert.deepEqual(f.state.merchantQueue[0].order.materialBuys,[{id:'vitscroll',level:0,quantity:4}]);
});
test('partial multi-worker receipts, relocated slots, repeated receipts and cancellation are safe',async()=>{
 const f=fixture();await f.post();const job=f.state.merchantQueue[0];const update=createStorageReferenceUpdates(f.state,coordinatorStorageIdentity);
 const requests=[...f.state.withdrawals.M];const deposit=(r,i)=>({request:r,pack:'items2',slot:20+i,item:r.item});
 update.deposited([deposit(requests[0],0)]);assert.equal(job.blockedOnBankboi,true);const count=job.order.bank.length;
 update.deposited([deposit(requests[0],0)]);assert.equal(job.order.bank.length,count);
 update.deposited(requests.slice(1).map((r,i)=>deposit(r,i+1)));assert.equal(job.blockedOnBankboi,false);assert.equal(f.state.withdrawals.M.length,0);
 assert.equal(job.order.bank.at(-1).quantity,4);assert.equal(job.order.bank.at(-1).slot,23);
 const cancelled=fixture();await cancelled.post();const request=cancelled.state.withdrawals.M[0];cancelled.state.merchantQueue=[];
 createStorageReferenceUpdates(cancelled.state,coordinatorStorageIdentity).deposited([deposit(request,0)]);
 assert.equal(cancelled.state.merchantQueue.length,0);assert.equal(cancelled.state.withdrawals.M.length,3);
});
test('unconfirmed wrong-level and undersized deposits cannot release crafting',async()=>{
 const f=fixture();await f.post();const job=f.state.merchantQueue[0],request=f.state.withdrawals.M.at(-1);
 const update=createStorageReferenceUpdates(f.state,coordinatorStorageIdentity);
 for(const item of [{name:'vitscroll',level:1,q:20},{name:'vitscroll',level:0,q:2}]) update.deposited([{request,pack:'items1',slot:35,item}]);
 assert.equal(job.blockedOnBankboi,true);assert.equal(f.state.withdrawals.M.length,4);
});

test('craft deposits keep staging cargo reserved until its job leaves the queue',async()=>{
 const {createReservedBankboiCargo}=require('../../runtime/coordinator/inventory/reserved-cargo.ts');
 const f=fixture();await f.post();const request=f.state.withdrawals.M[0];
 createStorageReferenceUpdates(f.state,coordinatorStorageIdentity).deposited([{request,pack:'items1',slot:35,item:request.item}]);
 f.state.bankSnapshot.packs.items1=Array(42).fill(null);f.state.bankSnapshot.packs.items1[35]={slot:35,item:request.item};
 f.state.bankboiQueue=[];f.state.bankboiReservedMigrated=true;
 const cargo=createReservedBankboiCargo(f.state,{identity:coordinatorStorageIdentity,now:()=>100,persist(){}});
 cargo.reconcile();assert.equal(f.state.bankboiQueue.length,0);
 f.state.merchantQueue=[];cargo.reconcile();assert.equal(f.state.bankboiQueue.length,1);
});
