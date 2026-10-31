const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {plan}=require('../merchant-inventory-stacks.cjs');
const entry=(slot,name,q,extra={})=>({slot,item:{name,q,...extra},meta:{definition:{s:9999}}});
const status=()=>({name:'M',items:[entry(10,'slice_nightberry',2),entry(15,'slice_nightberry',432),entry(18,'gem1',43),entry(28,'gem1',1)]});
test('plans Nightberry 434 followed by Tiny Ruby 44 without moving unrelated slots',()=>{
 const s=status(),p={merchantCharacter:'M'};let m=plan(p,s);assert.deepEqual([m.to,m.from],[10,15]);
 s.items=s.items.filter(e=>e.slot!==15);s.items[0].item.q=434;m=plan(p,s);assert.deepEqual([m.to,m.from],[18,28]);
});
for(const field of ['marked','merchantMarked','upgrades','compounds','withdrawals','statScrolls'])test(field+' reservations preserve separately marked stacks',()=>{
 const s=status(),p={merchantCharacter:'M',[field]:{M:[{slot:15,item:s.items[1].item}]}};
 assert.equal(plan(p,s).source.name,'gem1');
});
for(const field of ['standListings','npcSaleMarks','merchantDeliveries','merchantCargo','merchantQueue'])test(field+' prevents consolidation of promised items',()=>{
 const s=status(),p={merchantCharacter:'M',[field]:[{item:s.items[1].item}]};assert.equal(plan(p,s).source.name,'gem1');
});
test('stack limits, locks and different properties do not merge',()=>{
 for(const extra of [{l:'l'},{p:'shiny'},{level:1},{stat_type:'int'},{data:{key:1}}]) {
 const s={name:'M',items:[entry(0,'gem1',43),entry(1,'gem1',1,extra)]};assert.equal(plan({merchantCharacter:'M'},s),null);
 }
 // Partial fills now belong to the native five-pile compression E2E; an
 // over-limit whole pair is no longer expected to block consolidation.
});
test('active operations and failed-merge backoff defer consolidation',()=>{
 for(const flag of ['banking','gatheringActive','rip'])assert.equal(plan({merchantCharacter:'M'},{...status(),[flag]:true}),null);
 assert.equal(plan({merchantCharacter:'M',merchantCurrent:{}},status()),null);
 assert.equal(plan({merchantCharacter:'M'},{...status(),inventoryStackRetryAt:Date.now()+10000}),null);
});
test('PvP Nightberry singleton stays separate until the server removes its marker',()=>{
 const s={name:'M',items:[entry(10,'slice_nightberry',1,{v:'2026-09-11T21:23:09.427Z'}),entry(29,'slice_nightberry',257)]};
 const p={merchantCharacter:'M'};
 assert.equal(plan(p,s),null);
 delete s.items[0].item.v;
 const merge=plan(p,s);assert.deepEqual([merge.to,merge.from],[10,29]);
});
test('two PvP stacks can merge despite different acquisition timestamps',()=>{
 const s={name:'M',items:[entry(10,'slice_nightberry',1,{v:'2026-09-11T21:23:09.427Z'}),entry(29,'slice_nightberry',257,{v:'2026-09-11T21:00:00.000Z'})]};
 assert.ok(plan({merchantCharacter:'M'},s));
});
const source=fs.readFileSync('characters/shared.js','utf8');
function runtime(){
 const s=status(),merge=plan({merchantCharacter:'M'},s),items=Array(42).fill(null);s.items.forEach(e=>items[e.slot]=e.item);
 let calls=0;const c=vm.createContext({character:{ctype:'merchant',items},root:{},anniversaryBusy:false,banking:false,gatheringActive:false,
 request:async()=>({allowed:true}),merchantAnniversaryWorkReserved:()=>false,runtimeCurrent:()=>true,G:{items:{slice_nightberry:{s:9999}}},sleep:async()=>{},
 anniversaryWithTimeout:async promise=>promise,swap:async(to,from)=>{calls++;items[to].q+=items[from].q;items[from]=null;}});
 vm.runInContext(source.slice(source.indexOf('  function bankStackIdentity('),source.indexOf('  async function bankStoreFully('))+source.slice(source.indexOf('  async function consolidateMerchantInventory('),source.indexOf('  async function merchantIdle(')),c);
 return {c,merge:JSON.parse(JSON.stringify(merge)),calls:()=>calls};
}
test('runtime performs one merge, confirms quantity, and skips stale replay',async()=>{
 const t=runtime();await t.c.consolidateMerchantInventory({inventoryMerge:t.merge});assert.equal(t.c.character.items[10].q,434);assert.equal(t.c.character.items[15],null);
 await t.c.consolidateMerchantInventory({inventoryMerge:t.merge});assert.equal(t.calls(),1);
});
test('runtime refuses changed quantities and locks before sending any move',async()=>{
 for(const change of [item=>item.q++,item=>{item.l='l';}]){const t=runtime();change(t.c.character.items[15]);await t.c.consolidateMerchantInventory({inventoryMerge:t.merge});assert.equal(t.calls(),0);}
});
test('runtime never swaps newly incompatible PvP stacks or SDK-rejected stacks',async()=>{
 const pvp=runtime();pvp.c.character.items[15].v='2026-09-11T21:23:09.427Z';
 await pvp.c.consolidateMerchantInventory({inventoryMerge:pvp.merge});assert.equal(pvp.calls(),0);
 const sdk=runtime();sdk.c.can_stack=()=>false;
 await sdk.c.consolidateMerchantInventory({inventoryMerge:sdk.merge});assert.equal(sdk.calls(),0);
});
test('inventory fingerprints preserve the server PvP marker for planning',()=>{
 const c=vm.createContext({});
 vm.runInContext(source.slice(source.indexOf('  function fingerprint('),source.indexOf('  function sameItem(')),c);
 const item={name:'slice_nightberry',q:1,v:'2026-09-11T21:23:09.427Z'};
 assert.deepEqual(JSON.parse(JSON.stringify(c.fingerprint(item))),item);
});
test('failed move backs off without changing inventory or throwing out stand recovery',async()=>{
 const t=runtime();t.c.swap=async()=>{throw Error('failed');};await t.c.consolidateMerchantInventory({inventoryMerge:t.merge});
 assert.equal(t.c.character.items[15].q,432);assert.ok(t.c.root.__merchantStackRetryAt>Date.now());
 assert.equal(t.c.root.__merchantStackError,'failed');
});

test('a reservation added after idle dispatch vetoes the move',async()=>{
 const t=runtime();t.c.request=async()=>({allowed:false});await t.c.consolidateMerchantInventory({inventoryMerge:t.merge});assert.equal(t.calls(),0);
});
test('permission endpoint checks current reservations rather than the old dispatched plan',()=>{
 const s=status();s.seenAt=Date.now();const party={merchantCharacter:'M',statuses:{M:s}},merge=plan(party,s);
 const {createStackMergeRoute}=require('../../runtime/coordinator/http/stack-merge.ts');
 const handler=createStackMergeRoute(party,{now:()=>Date.now(),anniversary:()=>({}),bankboiBusy:()=>false,
   plan:()=>plan(party,s),identity:require('../bank-stack-routing.cjs').identity});
 let allowed;const check=()=>handler({body:{character:'M',merge}},{json:body=>{allowed=body.allowed;}});
 check();assert.equal(allowed,true);
 party.marked={M:[{slot:15,item:s.items[1].item}]};check();assert.equal(allowed,false);
});

// Failure inventory: a per-copy report carries no definition, so the stack
// limit falls to 1 and the merchant never merges partial stacks.
test('per-copy reports read the stack limit from the catalog',()=>{
 const slim=(slot,name,q)=>({slot,item:{name,q},meta:{properties:{}}});
 const s={name:'M',items:[slim(10,'gem1',43),slim(28,'gem1',1)]};
 assert.equal(plan({merchantCharacter:'M'},s),null);
 const merchantCatalog={allItems:[{id:'gem1',meta:{definition:{s:9999}}}]};
 assert.deepEqual([plan({merchantCharacter:'M',merchantCatalog},s).to,plan({merchantCharacter:'M',merchantCatalog},s).from],[10,28]);
});
