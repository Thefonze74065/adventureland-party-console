const test=require('node:test');
const assert=require('node:assert/strict');
const {estimateUpgrade}=require('../../runtime/coordinator/merchant/upgrade-estimate.ts');
const {createMerchantOrderRoute}=require('../../runtime/coordinator/http/merchant-order.ts');
// Numeric references use the native server grace expressions and native design/upgrades tables, independently of the shared estimator.
const fixtures=require('./fixtures/upgrade-estimates.json');
for(const example of fixtures)test(`upgrade estimate preserves deterministic budget for ${example.quantity} items to +${example.target}`,async()=>{
 const result=await estimateUpgrade(example.choice,example.quantity,example.target);
 assert.equal(result.status,"available");
 assert.deepEqual({attempts:result.attempts,budget:result.gold,scrolls:result.scrolls},example.result);
});
function fixture(){
 const state={merchantCharacter:'M',merchantCatalog:{buyable:[{id:'leather',cost:1},{id:'wcap',cost:100,upgradeable:true}],craftable:[{id:'coat',cost:0,materials:[{id:'leather',quantity:6}]}]},
  statuses:{M:{items:[{slot:0,item:{name:'leather',q:1}}]},P:{items:[{slot:2,item:{name:'leather',q:1}}]}},bankSnapshot:{packs:{items1:[{slot:3,item:{name:'leather',q:2}}]}},merchantCurrent:null,merchantQueue:[]};
 const effects=[],route=createMerchantOrderRoute(state,{now:()=>100,nextCommand:()=>1,activeNames:()=>['M','P'],log:()=>effects.push('log'),persist:()=>effects.push('persist'),dispatch:()=>effects.push('dispatch')});
 async function post(body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await route.handle({body},res);return res;}
 return {state,effects,post};
}
test('commerce allocates inventory before purchasing missing base materials and deduplicates the same order',async()=>{
 const f=fixture(),body={crafts:[{id:'coat',quantity:1}]};assert.equal((await f.post(body)).code,200);
 const order=f.state.merchantQueue[0].order;assert.deepEqual(order.requirements,[{id:'leather',level:0,quantity:6}]);
 assert.equal(order.bank[0].quantity,2);assert.equal(order.sources.P[0].quantity,1);assert.deepEqual(order.materialBuys,[{id:'leather',level:0,quantity:2}]);
 assert.equal((await f.post(body)).body.duplicate,true);assert.equal(f.state.merchantQueue.length,1);assert.deepEqual(f.effects,['log','persist','dispatch']);
});
test('invalid quantities and unavailable higher-level ingredients reject before queueing',async()=>{
 const f=fixture();assert.equal((await f.post({buys:[{id:'wcap',quantity:0}]})).code,400);assert.equal((await f.post({buys:[{id:'wcap',quantity:1,level:14}]})).code,400);
 f.state.merchantCatalog.craftable[0].materials[0].level=1;
 assert.equal((await f.post({crafts:[{id:'coat',quantity:1}]})).code,409);assert.equal(f.state.merchantQueue.length,0);
});
test('mixed direct buys and crafting become independently prioritized jobs and remain idempotent',async()=>{
 const f=fixture(),body={buys:[{id:'wcap',quantity:1}],crafts:[{id:'coat',quantity:1}]};
 assert.equal((await f.post(body)).code,200);assert.equal(f.state.merchantQueue.length,2);
 const direct=f.state.merchantQueue.find(j=>j.routine==='manual buying'),craft=f.state.merchantQueue.find(j=>j.order.crafts.length);
 assert.deepEqual(direct.order.crafts,[]);assert.deepEqual(direct.order.bank,[]);assert.deepEqual(craft.order.buys,[]);assert.equal(craft.order.materialBuys[0].quantity,2);
 assert.equal((await f.post(body)).body.duplicate,true);assert.equal(f.state.merchantQueue.length,2);
});

test('craft allocations record held ingredients and later orders cannot claim the same stock',async()=>{
 const f=fixture();f.state.merchantCatalog.buyable=[];
 f.state.merchantCatalog.craftable=[{id:'first',materials:[{id:'ring',quantity:3,level:0}]},{id:'second',materials:[{id:'ring',quantity:3,level:0}]}];
 f.state.statuses.M.items=[{slot:8,item:{name:'ring',level:0}}];
 f.state.bankSnapshot.packs.items1=[{slot:1,item:{name:'ring',level:0}},{slot:2,item:{name:'ring',level:0}}];
 assert.equal((await f.post({crafts:[{id:'first',quantity:1}]})).code,200);
 const order=f.state.merchantQueue[0].order;
 assert.equal(order.inventory[0].slot,8);assert.equal(order.craftMaterials[0][0].id,'ring');
 assert.equal((await f.post({crafts:[{id:'second',quantity:1}]})).code,409);
 f.state.bankSnapshot.packs.items1.push(...[3,4,5].map(slot=>({slot,item:{name:'ring',level:0}})));
 assert.equal((await f.post({crafts:[{id:'second',quantity:1}]})).code,200);
 assert.deepEqual(f.state.merchantQueue[1].order.bank.map(mark=>mark.slot),[3,4,5]);
});
