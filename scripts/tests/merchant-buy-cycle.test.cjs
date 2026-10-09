const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {namedFunction} = require('./helpers/named-function.cjs');
const source = fs.readFileSync('characters/shared.js', 'utf8');
const lineSource = namedFunction(source, 'merchantBuyUpgradeLine');
const {createMerchantProgressRoutes} = require('../../runtime/coordinator/http/merchant-progress.ts');
const {createCompletionRetries} = require('../../runtime/coordinator/merchant/completion-retries.ts');
const {currentMerchantReport} = require('../../runtime/coordinator/merchant/commerce-progress.ts');
const {craftProtection, availableCraftStock} = require('../../runtime/coordinator/merchant/craft-reservations.ts');

function worker(poofs = 0) {
  let failures = poofs, buys = 0, upgrades = 0, checkpointHook = () => {}, upgradeHook = () => {};
  const items = Array(42).fill(null), calls = [], command = {_commerceState: {}};
  const purchase = {id: 'coat', level: 3, quantity: 1, attempts: 1000, budget: 100000};
  const copy = value => JSON.parse(JSON.stringify(value));
  const context = vm.createContext({character: {items}, G: {items: {coat: {g: 10, upgrade: true}, scroll0: {g: 1, s: 9999}}},
    fingerprint: item => item ? {...item} : null,
    sameItem: (item, ref) => !!item && item.name === ref.name && (item.level || 0) === (ref.level || 0),
    findItem: ref => items.findIndex(item => item && item.name === ref.name && (item.level || 0) === (ref.level || 0)),
    item_grade: () => 0, itemSeller: name => name === 'coat' ? 'armors' : 'scrolls',
    findInventoryItemByName: name => items.findIndex(item => item?.name === name),
    buyConfirmed: async (name, quantity) => { buys++; calls.push(['buy', name, quantity]);
      if (name === 'coat') items[items.indexOf(null)] = {name, level: 0};
      else {const existing = items.find(item => item?.name === name); if (existing) existing.q += quantity;
        else items[items.indexOf(null)] = {name, q: quantity};}
    },
    upgradeConfirmed: async (slot, scroll) => {upgrades++; items[scroll].q--; if (!items[scroll].q) items[scroll] = null;
      if (failures-- > 0) {items[slot] = null; throw {reason: 'upgrade_destroyed', confirmedDestroyed:true};}
      items[slot].level++; upgradeHook(items[slot]);
    },
  });
  vm.runInContext(['sameItemState', 'remapCommerceOwnedItems', 'verifyCommerceResults'].map(name => namedFunction(source, name)).join('\n') + '\n' + lineSource, context);
  const services = {fund: async () => {}, move: async name => calls.push(['move',name]), activity: async () => {},
    checkpoint: async (progress, boundary) => {command._commerceState = copy(progress); checkpointHook(command._commerceState, boundary);}};
  return {context,items, calls, command, purchase, services, run: () => context.merchantBuyUpgradeLine(command,purchase,0,services),
    checkpoint: fn => checkpointHook = fn, upgrade: fn => upgradeHook = fn, counts: () => ({buys,upgrades})};
}

test('300 poofs yield between item cycles and resume with cumulative spending and attempts', async () => {
  const w = worker(300); let yields = 0;
  w.checkpoint((p,boundary) => {
    if (!boundary || p.buyIndex || p.cycleActive || !p.attempts || p.attempts <= yields) return;
    yields = p.attempts; throw Error('merchant_yield');
  });
  for (;;) {try {await w.run(); break;} catch (e) {assert.equal(e.message,'merchant_yield');}}
  assert.equal(yields,301); assert.equal(w.items.filter(item=>item?.name==='coat' && item.level===3).length,1);
  assert.equal(w.calls.filter(call=>call[0]==='buy' && call[1]==='coat').length,301);
  assert.equal(w.command._commerceState.buyIndex,1);
});

test('confirmed survivor resumes after reload without a new item or another cycle allowance', async () => {
  const w = worker(); let interrupted = false;
  w.checkpoint((p,boundary) => {if (!interrupted && p.activeItem?.level===1 && !p.pendingUpgrade) {
    assert.equal(boundary,false); interrupted=true; throw Error('reload');}});
  await assert.rejects(w.run(),/reload/);
  assert.equal(w.command._commerceState.attempts,1);
  w.checkpoint(()=>{}); await w.run();
  assert.equal(w.calls.filter(c=>c[0]==='buy' && c[1]==='coat').length,1);
  assert.equal(w.counts().upgrades,3);
});

test('lost final-upgrade response is reconciled once and cannot duplicate a result', async () => {
  const w=worker(); w.upgrade(item=>{if(item.level===3) throw Error('connection lost');});
  await assert.rejects(w.run(),/connection lost/);
  assert.equal(w.command._commerceState.pendingUpgrade.level,3);
  w.upgrade(()=>{}); await w.run(); assert.equal(w.counts().upgrades,3);
  assert.equal(w.command._commerceState.results.length,1);
});

test('purchase checkpoint response loss does not buy or charge a second base item', async () => {
  const w=worker(); let lost=false, spent;
  w.checkpoint(p=>{if(!lost && p.activeItem?.level===0 && !p.pendingPurchase) {lost=true;spent=p.spent;throw Error('response lost');}});
  await assert.rejects(w.run(),/response lost/); w.checkpoint(()=>{}); await w.run();
  assert.equal(spent,13);assert.equal(w.calls.filter(c=>c[0]==='buy' && c[1]==='coat').length,1);
});

test('attempt and gold allowances cannot reset across repeated yields', async () => {
  for(const kind of ['attempt','budget']) {
    const w=worker(50);if(kind==='attempt')w.purchase.attempts=2;else w.purchase.budget=24;
    let last=0;w.checkpoint((p,b)=>{if(b&&!p.cycleActive&&p.attempts>last){last=p.attempts;throw Error('merchant_yield');}});
    let failure;for(let n=0;n<10;n++){try{await w.run();}catch(e){if(e.message!=='merchant_yield'){failure=e;break;}}}
    assert.match(failure.message,kind==='attempt'?/attempt allowance exhausted/:/budget exhausted/);
    assert.ok(w.command._commerceState.spent<=w.purchase.budget);
    assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,2);
  }
});

function progressFixture() {
  let event=false; const state={merchantCharacter:'M',merchantCurrent:{id:'j',commandId:7,commerceProgressVersion:2,
    reason:'merchant commerce',target:'M',priority:50},merchantQueue:[],statuses:{},gatheringModes:[],gatheringCooldowns:{},commands:{M:{id:7}}};
  const routes=createMerchantProgressRoutes(state,{now:()=>1000,priority:j=>j.priority||0,routinePriority:()=>0,
    stamp:j=>j,persist(){},log(){},dispatch(){},anniversaryReserved:()=>event,capacityBlocked:j=>j.full===true,collectionReady:()=>true});
  function invoke(body,handler=routes.checkpoint){let code=200,value;const res={status:c=>{code=c;return res;},json:v=>value=v};handler({body},res);return{code,value};}
  return{state,invoke,routes,event:()=>event=true};
}
test('anniversary and runnable priorities yield only at cycle boundaries; stale dispatches are rejected',()=>{
  const f=progressFixture();f.event();
  assert.equal(f.invoke({jobId:'j',commandId:7,state:{spent:12},cycleBoundary:false}).value.yield,false);
  assert.equal(f.invoke({jobId:'j',commandId:7,state:{spent:13},cycleBoundary:true}).value.yield,true);
  assert.equal(f.state.merchantQueue[0].resumeState.spent,13);
  f.state.merchantCurrent={...f.state.merchantQueue.pop(),commandId:8};
  for(const handler of [f.routes.checkpoint,f.routes.heartbeat])assert.equal(f.invoke({jobId:'j',commandId:7},handler).code,409);
  assert.equal(currentMerchantReport(f.state.merchantCurrent,{jobId:'j',commandId:7}),false);
});
test('blocked and equal priority work cannot cause a yield loop',()=>{
  const f=progressFixture();f.state.merchantQueue=[{reason:'x',priority:99,retryAt:2000},{reason:'x',priority:99,full:true},{reason:'x',priority:50}];
  assert.equal(f.invoke({jobId:'j',commandId:7,state:{},cycleBoundary:true}).value.yield,false);
  f.state.merchantQueue.push({reason:'x',priority:51});
  assert.equal(f.invoke({jobId:'j',commandId:7,state:{},cycleBoundary:true}).value.yield,true);
});
test('movement retries retain allowances, grow backoff, and leave invalid orders terminal',()=>{
  const state={merchantQueue:[],merchantJobBlocks:{},statuses:{M:{}},merchantCharacter:'M',npcSaleMarks:[],commands:{}};
  const retries=createCompletionRetries(state,{now:()=>1000,nextCommand:()=>1,stamp:j=>j,log(){}});
  let job={id:'j',target:'M',reason:'merchant commerce',order:{buys:[{level:8}]},resumeState:{spent:42,attempts:9}};
  for(const delay of [10000,30000,60000,300000,300000]){
    retries.enqueue(job,retries.decide(job,{success:false,error:'ALClient found no route',failureKind:'commerce_movement'}));
    job=state.merchantQueue.shift();assert.equal(job.retryAt,1000+delay);assert.deepEqual(job.resumeState,{spent:42,attempts:9});
  }
  assert.equal(retries.decide(job,{success:false,error:'90% estimated budget exhausted'}).retry,true);
  assert.equal(retries.decide({...job,order:{buys:[{level:0}]}},{success:false,error:'Invalid order'}).retry,false);
});
test('queued order reservations protect survivors and completed results but release on cancellation',()=>{
  const state={merchantCharacter:'M',merchantQueue:[{id:'j',resumeState:{activeSlot:0,activeItem:{name:'coat',level:2},results:[{slot:1,item:{name:'coat',level:8}}]}}]};
  const items=[{slot:0,item:{name:'coat',level:2},craftLocation:'inventory:M'},{slot:1,item:{name:'coat',level:8},craftLocation:'inventory:M'},
    {slot:2,item:{name:'coat',level:8},craftLocation:'inventory:M'}];
  assert.deepEqual(availableCraftStock(items,craftProtection(state)),[null,null,items[2]]);
  state.merchantQueue=[];assert.deepEqual(availableCraftStock(items,craftProtection(state)),items);
});

test('buy command releases an idle stand operation and closes the stand before starting',async()=>{
  const calls=[],root={localStorage:{getItem:()=>null}},command={id:8,jobId:'buy',type:'merchant-commerce',commerceProgressVersion:2};
  const c=vm.createContext({root,merchantRuntimeId:'runtime',character:{ctype:'merchant',stand:true},
    merchantIdleActive:true,gatheringActive:false,gatheringMode:'fishing',gatheringGeneration:1,
    gatheringTimer:null,merchantIdlePending:{id:7},luckyUpgradeSlot:null,luckyUpgradeService:null,
    request:async(path,{body})=>{calls.push([path,body]);},setInterval:()=>1,clearInterval(){},
    stop:async()=>{calls.push('stop');c.merchantIdleActive=false;},
    close_stand:async()=>{calls.push('close');c.character.stand=false;},recoverProductionJournal:async()=>calls.push('recover'),
    freeInventorySlots:()=>42,merchantLuckyUpgrade:()=>({tidy:()=>assert.fail('must not relocate a pending upgrade outcome')}),
    setGathering:mode=>calls.push(mode),game_log(){},setTimeout:fn=>fn()});
  vm.runInContext(namedFunction(source,'runMerchantJob'),c);
  await c.runMerchantJob(command,'buy',async()=>{assert.equal(c.character.stand,false);assert.equal(c.merchantIdleActive,false);calls.push('action');});
  assert.ok(calls.indexOf('stop')<calls.indexOf('close'));assert.ok(calls.indexOf('close')<calls.indexOf('action'));
  assert.equal(calls[0][1].commandId,8);assert.equal(root.__merchantActiveJob,null);
});

test('movement checkpoint resets only the movement failure streak and preserves financial counters',()=>{
  const f=progressFixture();f.state.merchantCurrent.movementRetryCount=4;
  f.invoke({jobId:'j',commandId:7,state:{spent:90,attempts:7},cycleBoundary:false,movementSucceeded:true});
  assert.equal(f.state.merchantCurrent.movementRetryCount,0);
  assert.deepEqual(f.state.merchantCurrent.resumeState,{spent:90,attempts:7});
});

test('results remain owned across lines and unrelated target-level items do not complete an order',async()=>{
 const w=worker();w.items[8]={name:'coat',level:3};await w.run();
 assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,1);
 assert.equal(w.command._commerceState.results.length,1);
 assert.notEqual(w.command._commerceState.results[0].slot,8);
 const first=w.command._commerceState.results[0];w.command._commerceState.buyIndex=1;
 // The helper is asked for line zero again: it must create a new line without losing the first receipt.
 await w.run();assert.equal(w.command._commerceState.results.length,2);
 assert.equal(w.command._commerceState.results[0].slot,first.slot);
});

test('commerce executor uses named NPC routes and reports a resumable movement failure with saved allowances',async()=>{
 const w=worker(),storage=new Map(),reports=[],moves=[];
 Object.assign(w.context.character,{name:'M',map:'main',x:1000,y:1000,gold:100000});
 Object.assign(w.context,{
   root:{__merchantActiveJob:{jobId:'j',commandId:7},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
   merchantCatalog:()=>({buyable:[{id:'coat',cost:10},{id:'scroll0',cost:1}],craftable:[]}),
   find_npc:()=>({map:'main',x:0,y:0}),
   smart_move:async destination=>{moves.push(destination);if(destination==='newupgrade')throw Object.assign(Error('ALClient found no route'),{partyRequest:{path:'/movement-plan',status:503}});},
   request:async(path,{body})=>{reports.push([path,JSON.parse(JSON.stringify(body))]);return {yield:false};},
 });
 vm.runInContext(namedFunction(source,'merchantCommerce'),w.context);
 await assert.rejects(w.context.merchantCommerce({id:7,jobId:'j',commerceOrderId:'order',commerceProgressVersion:2,
   order:{buys:[w.purchase]},resumeState:{phase:'leveling',buyIndex:0,attempts:0,spent:0}}),/no route/);
 assert.ok(moves.every(destination=>typeof destination==='string'));assert.ok(moves.includes('armors'));
 const completion=reports.findLast(([path])=>path==='/merchant/complete')[1];
 assert.equal(completion.failureKind,'commerce_movement');assert.equal(completion.commandId,7);
 const saved=JSON.parse(storage.get('party-commerce:order'));
 assert.equal(saved.attempts,1);assert.equal(saved.spent,13);assert.equal(saved.activeItem.name,'coat');
 assert.equal(completion.activity.at(-1).message,'Merchant order paused; progress preserved');
});

test('production receipt survives a lost completion response and records poof before another routine reuses the slot',async()=>{
 const storage=new Map([['commerce',JSON.stringify({sequence:4,pendingUpgrade:{level:3},spent:19,attempts:2})]]);
 const c=vm.createContext({root:{localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}}});
 vm.runInContext(namedFunction(source,'rememberCommerceProduction'),c);
 c.rememberCommerceProduction({commerce:{key:'commerce',sequence:4},outcomeItem:null,destroyed:true});
 const saved=JSON.parse(storage.get('commerce'));
 assert.deepEqual(saved,{sequence:5,pendingUpgrade:{level:3,outcome:{item:null,destroyed:true}},spent:19,attempts:2});
 c.rememberCommerceProduction({commerce:{key:'commerce',sequence:4},outcomeItem:{name:'coat',level:3}});
 assert.equal(JSON.parse(storage.get('commerce')).pendingUpgrade.outcome.item,null,'late replay cannot replace the receipt');
});

test('an uncertain scroll purchase protects its quantity baseline while queued',()=>{
 const state={merchantCharacter:'M',merchantQueue:[{resumeState:{pendingPurchase:{name:'scroll0',before:4,quantity:3}}}]};
 const items=[{slot:0,item:{name:'scroll0',q:7},craftLocation:'inventory:M'}];
 assert.deepEqual(availableCraftStock(items,craftProtection(state)),[null]);
});

test('live regression: survivor moves after checkpoint and completes without another purchase',async()=>{
 const w=worker();let moved=false;
 w.checkpoint(p=>{
  if(!moved&&p.activeItem?.level===2&&p.pendingUpgrade?.level===3){
   moved=true;w.items[15]=w.items[p.activeSlot];w.items[p.activeSlot]=null;
  }
 });
 await w.run();
 assert.equal(moved,true);assert.equal(w.counts().upgrades,3);
 assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,1);
 assert.equal(w.items[15].level,3);
});

test('empty original slot and arbitrary upgrade error cannot report poof or buy again',async()=>{
 const w=worker();let poofs=0;
 w.services.activity=async e=>{if(/poof/.test(e.message))poofs++;};
 w.context.upgradeConfirmed=async slot=>{
  w.items[15]=w.items[slot];w.items[slot]=null;
  throw Object.assign(Error('item or scroll unavailable'),{code:'lucky_slot_unavailable'});
 };
 await assert.rejects(w.run(),/unavailable/);
 assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,1);
 assert.equal(w.items[15].level,0);assert.equal(poofs,0);
 assert.ok(w.command._commerceState.activeItem);
 assert.ok(w.command._commerceState.pendingUpgrade);
});

test('legacy inferred destruction is not a confirmed destruction receipt',async()=>{
 const w=worker();let poofs=0;
 w.services.activity=async e=>{if(/poof/.test(e.message))poofs++;};
 w.context.upgradeConfirmed=async slot=>{w.items[slot]=null;throw {reason:'upgrade_destroyed'};};
 await assert.rejects(w.run(),e=>e.reason==='upgrade_destroyed');
 assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,1);assert.equal(poofs,0);
});

test('ambiguous relocated survivors block rather than choosing an unrelated item',async()=>{
 const w=worker();
 w.checkpoint(p=>{
  if(p.activeItem?.level===2&&p.pendingUpgrade?.level===3){
   w.items[15]=w.items[p.activeSlot];w.items[16]={...w.items[15]};w.items[p.activeSlot]=null;
  }
 });
 await assert.rejects(w.run(),/ambiguous/);
 assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,1);
});

test('legacy empty outcome after restart requires review and cannot purchase another base',async()=>{
 const w=worker();w.command._commerceState={phase:'leveling',buyIndex:0,attempts:1,spent:13,
  activeItem:{name:'coat',level:2},activeSlot:5,cycleActive:true,results:[],
  pendingUpgrade:{level:3,outcome:{item:null}}};
 await assert.rejects(w.run(),/uncertain/);
 assert.equal(w.counts().buys,0);
});


test('batch buys starting-tier scrolls together and finishes all items after early success', async () => {
  const w = worker(); w.command.buyUpgradeBatchSize = 10;
  w.context.item_grade = item => (item.level || 0) >= 2 ? 1 : 0;
  w.context.G.items.scroll1 = {g: 5, s: 9999};
  await w.run();
  assert.equal(w.items.filter(i => i?.name === 'coat' && i.level === 3).length, 10);
  assert.deepEqual(w.calls.filter(c => c[0] === 'buy' && c[1] === 'scroll0'), [['buy','scroll0',20]]);
  const higher = w.calls.filter(c => c[0] === 'buy' && c[1] === 'scroll1');
  assert.equal(higher.length, 10); assert.ok(higher.every(c => c[2] === 1));
  assert.equal(w.calls.filter(c => c[0] === 'buy' && c[1] === 'coat').length, 10);
});

test('interrupted batch purchase resumes without duplicate purchases or attempts', async () => {
  const w = worker(); w.command.buyUpgradeBatchSize = 4; let stopped = false;
  w.checkpoint(p => { if (!stopped && p.batchItems?.length === 2 && !p.pendingPurchase) {
    stopped = true; throw Error('reload');
  }});
  await assert.rejects(w.run(), /reload/);
  assert.equal(w.command._commerceState.attempts, 2);
  await w.run();
  assert.equal(w.calls.filter(c => c[0] === 'buy' && c[1] === 'coat').length, 4);
  assert.equal(w.items.filter(i => i?.name === 'coat' && i.level === 3).length, 4);
});

test('uncertain batch upgrade cannot steal another purchased base or buy replacements', async () => {
  const w = worker(); w.command.buyUpgradeBatchSize = 3;
  w.context.upgradeConfirmed = async slot => { w.items[slot] = null; throw Error('connection lost'); };
  await assert.rejects(w.run(), /connection lost/);
  await assert.rejects(w.run(), /missing without confirmed destruction/);
  assert.equal(w.calls.filter(c => c[0] === 'buy' && c[1] === 'coat').length, 3);
  assert.equal(w.command._commerceState.batchItems.length, 2);
});

test('batch respects free space, remaining attempts, and budget', async () => {
  for (const kind of ['space','attempts','budget']) {
    const w = worker(); w.command.buyUpgradeBatchSize = 10;
    if (kind === 'space') for (let i=0;i<36;i++) w.items[i]={name:'unrelated'};
    if (kind === 'attempts') w.purchase.attempts=2;
    if (kind === 'budget') w.purchase.budget=26;
    await w.run();
    assert.equal(w.calls.filter(c => c[0] === 'buy' && c[1] === 'coat').length, 2, kind);
  }
});

test('queued batches reserve every purchased base during a yield', () => {
  const protection = craftProtection({merchantCharacter:'M',merchantQueue:[{resumeState:{
    batchItems:[{slot:4,item:{name:'coat',level:0}},{slot:5,item:{name:'coat',level:0}}]
  }}]});
  assert.equal(protection.deliveries.length,2);
  assert.deepEqual(protection.deliveries.map(i=>i.slot),[4,5]);
});
