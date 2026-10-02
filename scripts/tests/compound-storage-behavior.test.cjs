const {test}=require('node:test'),assert=require('node:assert/strict');
const {compoundStorageLeftovers}=require('../../runtime/compound-storage.ts');
const {storeCompoundLeftovers}=require('../../runtime/characters/compound-storage.ts');
const {createImprovementScheduler}=require('../../runtime/coordinator/merchant/improvement-scheduler.ts');
const {beginProduction,finishProduction}=require('../../runtime/coordinator/inventory/production.ts');
const {availableCraftStock}=require('../../runtime/craft-reservations.ts');
const item=(slot,level=0,extra={})=>({slot,item:{name:'intearring',level,...extra}});
const rules=[{name:'intearring',targetTier:2,quantity:-1}];

test('incomplete groups bank; complete same-tier groups and target outputs stay available',()=>{
 const inventory=[item(0),item(1)], bank=[item(4)];
 assert.deepEqual(compoundStorageLeftovers(rules,inventory,inventory),inventory);
 assert.deepEqual(compoundStorageLeftovers(rules,inventory,[...inventory,...bank]),[]);
 const four=[item(0),item(1),item(2),item(3)];
 assert.deepEqual(compoundStorageLeftovers(rules,four,four),[four[3]]);
 const mixed=[item(0),item(1,1),item(2,2),item(3,0,{l:'locked'})];
 assert.deepEqual(compoundStorageLeftovers(rules,mixed,mixed),mixed.slice(0,2));
 assert.deepEqual(compoundStorageLeftovers([{...rules[0],quantity:0}],inventory,inventory),[]);
});

test('scheduler queues automatic storage without changing Auto bank and waits for a complete bank group',()=>{
 const state={merchantCharacter:'M',autoCompounds:{M:rules},autoItemMarks:{M:{'intearring@+1':'bank'}},
  merchantAutomations:{},merchantQueue:[],statuses:{},bankSnapshot:{packs:{items0:[]}},bankbois:{},withdrawals:{}};
 const queued=[],before=JSON.stringify(state.autoItemMarks);
 const scheduler=createImprovementScheduler(Object.assign(state,{production:state.production||{attempts:{}}}),{now:()=>1,nextCommand:()=>1,stamp:x=>x,persist(){},log(){},queue:(names,reason)=>queued.push(reason)});
 assert.equal(scheduler.compound('M',{items:[item(0),item(1)]}),true);
 assert.deepEqual(queued,['auto compound']);
 state.bankSnapshot.packs.items0=[item(0),item(1)];queued.length=0;
 assert.equal(scheduler.compound('M',{items:[]}),false);assert.deepEqual(queued,[]);
 assert.equal(scheduler.compound('M',{items:[item(0)]}),true);
 assert.equal(JSON.stringify(state.autoItemMarks),before);
 state.merchantAutomations['auto compound']=false;queued.length=0;
 assert.equal(scheduler.compound('M',{items:[item(0)]}),false);assert.deepEqual(queued,[]);
});

function storageFixture(){
 const inventory=[item(0),item(1)],bank=[],logs=[];let active=rules,visits=0;
 const ports={refresh:async()=>{},rules:()=>active,stock:()=>inventory.concat(bank),inventorySize:()=>inventory.length,
  visitBank:async()=>{visits++;},deposit:async slot=>{bank.push(inventory[slot]);inventory[slot]=null;},log:message=>logs.push(message)};
 return {inventory,bank,logs,ports,setRules:value=>active=value,get visits(){return visits;}};
}
test('confirmed storage rechecks each transfer and does not withdraw incomplete groups',async()=>{
 const f=storageFixture();await storeCompoundLeftovers(f.ports);
 assert.equal(f.visits,1);assert.deepEqual(f.inventory,[null,null]);assert.equal(f.bank.length,2);assert.equal(f.logs.length,2);
 await storeCompoundLeftovers(f.ports);assert.equal(f.visits,1);
});
test('bank full propagates for the existing capacity block without acknowledging a deposit',async()=>{
 const f=storageFixture();f.ports.deposit=async()=>{throw Error('bank_full');};
 await assert.rejects(storeCompoundLeftovers(f.ports),/bank_full/);assert.equal(f.logs.length,0);assert.equal(f.inventory.filter(Boolean).length,2);
});
test('rule removal or a newly complete bank group cancels stale deposits after travel',async()=>{
 for(const remove of [true,false]){
  const f=storageFixture();f.ports.visitBank=async()=>{if(remove)f.setRules([]);else f.bank.push(item(4));};
  await storeCompoundLeftovers(f.ports);assert.equal(f.logs.length,0);
 }
});
test('craft allocations protect items from automatic compound storage',()=>{
 const stock=[item(0),item(1)];
 const available=availableCraftStock(stock,{requirements:[{id:'intearring',level:0,quantity:1}]});
 assert.equal(compoundStorageLeftovers(rules,available,available).length,1);
});

test('compound checkpoint reports live rules and excludes bank preferences from conflicts',()=>{
 const {createMerchantProgressRoutes}=require('../../runtime/coordinator/http/merchant-progress.ts');
 const state={merchantCharacter:'M',merchantRules:{members:['M']},merchantCurrent:{id:'job',reason:'auto compound'},merchantQueue:[],
  autoCompounds:{M:rules},autoItemMarks:{M:{'intearring@+1':'bank'}},statuses:{},gatheringModes:[],gatheringCooldowns:{},commands:{}};
 const routes=createMerchantProgressRoutes(state,{});let response;
 const res={json:value=>response=value,status(){return this;}};
 routes.checkpoint({body:{jobId:'job',protectionOnly:true}},res);
 assert.equal(response.compoundRules.length,1);assert.deepEqual(response.compoundBlocked,[]);
 state.merchantAutomations={'auto compound':false};
 routes.checkpoint({body:{jobId:'job',protectionOnly:true}},res);assert.deepEqual(response.compoundRules,[]);
});
test('target completion logs once, including unlimited rules, without logging failures or intermediate levels',()=>{
 for(const quantity of [-1,2]){
  const state={merchantCharacter:'M',production:{attempts:{}},autoUpgradeMarks:{},autoCompounds:{M:[{...rules[0],quantity}]}},logs=[];
  const log=(...args)=>logs.push(args);
  const begin=(id,level)=>beginProduction(state,{id,kind:'compound',item:{name:'intearring',level},automatic:{family:'compound',key:'intearring'}});
  begin('intermediate',0);finishProduction(state,'intermediate',true,log);assert.equal(logs.length,0);
  begin('failed',1);finishProduction(state,'failed',false,log);assert.equal(logs.length,0);
  begin('finished',1);finishProduction(state,'finished',true,log);finishProduction(state,'finished',true,log);
  assert.equal(logs.length,1);assert.equal(logs[0][0],'merchant completed auto compound');assert.equal(logs[0][2].level,2);
  assert.equal(state.autoCompounds.M[0].quantity,quantity===-1?-1:1);
 }
});
