import {waitForGameplay,nativeWallNow} from './network-clock';
import {gateNativeAjaxInput} from './native-ajax-input';
import { test, expect, type LiveGame } from './live-fixtures';
import type { TestInfo } from '@playwright/test';
import type { Item } from '../runtime/coordinator/contracts/item';
import { spawnGoo } from './hunt-interruption-helpers';
import { location } from './game/hunt-lifecycle';

const merchant = 'E2EMerchant';

test('merchant buys one Liquid Luck from the customer side of the Winter Inn bar', async ({live}, info) => {
  test.setTimeout(240_000);
  // Failure modes: the destination is behind the counter; arrival never buys;
  // a duplicated purchase changes quantity/spending; queue removal precedes telemetry.
  await catalog(live, 'elixirluck');
  const before = await economy(live);
  const count = (state: Economy) => Object.values(state.characters).reduce((n, c) => n + quantity(c.items, 'elixirluck'), 0) + bankQuantity(state, 'elixirluck');
  const order = await live.post('/merchant/order', {buys: [{id: 'elixirluck', quantity: 1, level: 0}], crafts: []});
  try {
    await expect.poll(async () => count(await economy(live)), {timeout: 180_000}).toBe(count(before) + 1);
    await jobFinished(live, order.jobId);
    const after = await economy(live);
    expect(count(after)).toBe(count(before) + 1);
    expect(totalGold(before) - totalGold(after)).toBe(240_000);
    await expect.poll(async () => {
      const state = await live.state();
      return state.characters[merchant]?.items?.some((entry: any) => entry?.item?.name === 'elixirluck');
    }, {timeout: 30_000}).toBe(true);
  } finally {
    await record(live, info, 'native-liquid-luck-purchase', before, {jobId: order.jobId});
  }
});

test('unlinked upgrade adopts compatible native intermediate without claiming existing results',async({live},info)=>{
  // The retained paid batch needs ten native upgrades; CI timers are ~20s each.
  test.setTimeout(450_000);
  await catalog(live,'helmet');
  await seed(live,{5:{name:'scroll0',q:20},10:{name:'helmet',level:2},11:{name:'helmet',level:3},12:{name:'helmet',level:3},23:{name:'helmet',level:0},24:{name:'helmet',level:0},25:{name:'helmet',level:0}});
  const id='unlinked-intermediate-commerce',before=await economy(live),checkpoints:any[]=[],observations:any[]=[];
  const progress={phase:'leveling',buyIndex:0,attempts:4,spent:4200,completedResults:1,results:[{slot:8,item:{name:'helmet',level:3},buyIndex:0}],activeItem:{name:'helmet',level:1},activeSlot:26,cycleActive:true,batchItems:[20,21,22].map(slot=>({slot,item:{name:'helmet',level:0}})),batchRemaining:0,sequence:2,pendingUpgrade:{level:2}};
  let held=false,codeReplaced=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await live.clients[merchant].page.route('**/party-api/merchant/checkpoint',async route=>{
    const body=route.request().postDataJSON();
    const observe=()=>{if(body.state&&typeof body.state==='object'){checkpoints.push(body.state);observations.push({at:Date.now(),state:body.state});}};
    // Only the declared adoption response needs a proxy and interruption. Later
    // checkpoints must use the browser's ordinary transport and error handling.
    if(held||!body.state?.inventoryAdoption||body.state.pendingUpgrade){observe();await route.continue();return;}
    held=true;
    const response=await route.fetch();
    expect(response.status()).toBe(200);
    observe(); // Publish the adoption to the test only after authoritative persistence.
    observations.push({at:Date.now(),action:'adoption-persisted',status:response.status()});
    await gate;
    observations.push({at:Date.now(),action:'adoption-response-released'});
    await route.fulfill({response}).catch(error=>{if(!codeReplaced)throw error;});
  });
  try{
    await live.restoreHistoricalSettings(()=>({production:{attempts:{'historical-unlinked-receipt':{name:'helmet',level:2,kind:'upgrade',rules:[],completed:true,completedAt:Date.now(),success:true}}},
      merchantQueue:[{id,target:merchant,reason:'merchant commerce',queuedAt:Date.now(),commerceOrderId:id,commerceProgressVersion:2,
        order:{buys:[{id:'helmet',quantity:2,level:3,attempts:100,budget:500000}],crafts:[]},resumeState:progress}]}));
    await expect.poll(()=>checkpoints.some(s=>s.activeItem?.level===2&&!s.pendingUpgrade),{timeout:90_000}).toBe(true);
    const adoption=checkpoints.find(s=>s.activeItem?.level===2&&!s.pendingUpgrade);
    expect(adoption).toMatchObject({spent:4200,attempts:4,completedResults:1,activeSlot:10});
    expect(adoption.batchItems.map((entry:any)=>entry.slot).sort()).toEqual([23,24,25]);
    const oldRuntime=(await live.state()).characters[merchant].dashboardRuntime;
    await live.clients[merchant].frame.evaluate(()=>{const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);});
    codeReplaced=true;release();
    await expect.poll(async()=>(await live.state()).characters[merchant]?.dashboardRuntime,{timeout:60_000}).not.toBe(oldRuntime);
    await jobFinished(live,id,300_000);
    const after=await economy(live);
    const finished=(v:Economy)=>v.characters[merchant].items.filter(i=>i?.name==='helmet'&&i.level===3).length;
    const newResults=Math.max(...checkpoints.map(s=>Number(s.completedResults)||0))-1;
    expect(newResults).toBeGreaterThanOrEqual(1);
    expect(finished(after)-finished(before)).toBe(newResults);
    expect((await live.state()).merchantActivity.some((a:any)=>String(a.message).includes('Inventory adoption assumption'))).toBe(true);
    await record(live,info,'native-unlinked-intermediate-adoption',before,{id,adoption,checkpoints,after});
  }finally{
    release();await live.clients[merchant].page.unrouteAll({behavior:'ignoreErrors'});
    await info.attach('unlinked-commerce-adoption-progress',{body:JSON.stringify({id,progress,checkpoints,observations,state:await live.state()}),contentType:'application/json'});
  }
});

test('completed native upgrade receipt restores commerce after a lost completion response',async({live},info)=>{
  test.setTimeout(300_000);
  await catalog(live,'helmet');
  const before=await economy(live),context=live.clients[merchant].page.context();
  let journal:any,receipt:any,relocation:any,progress:any,held=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const faults:any[]=[];
  const checkpoints:any[]=[];
  await context.route('**/party-api/merchant/checkpoint',async route=>{
    const body=route.request().postDataJSON();
    if(body.state&&typeof body.state==='object'){progress=body.state;checkpoints.push(body.state);}
    await route.continue();
  });
  await context.route('**/party-api/merchant/production',async route=>{
    const body=route.request().postDataJSON();
    if(body.action==='checkpoint'&&body.journal?.phase==='complete'&&body.journal.success===true&&body.journal.commerce)journal=body.journal;
    const response=await route.fetch();
    if(body.action==='complete'&&journal?.id===body.id&&!held){
      receipt=await response.json();faults.push({at:Date.now(),action:'held-real-completed-receipt',id:body.id});
      held=true; // Publish only after the authoritative receipt has been parsed.
      await gate;
      await route.abort('failed').catch(()=>{});return;
    }
    await route.fulfill({response});
  });
  try{
    const order=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:1,level:1}],crafts:[]});
    await expect.poll(()=>held,{timeout:120_000}).toBe(true);
    expect(receipt.attempt.completed).toBe(true);expect(receipt.attempt.success).toBe(true);
    relocation=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(merchant)}),item=${JSON.stringify(journal.outcomeItem)};
      const matches=p.items.map((v,i)=>v&&v.name===item.name&&(v.level||0)===(item.level||0)?i:-1).filter(i=>i>=0);
      if(matches.length!==1)throw Error('Native completed survivor is not unique');
      const from=matches[0],to=p.items.findIndex((v,i)=>!v&&i!==from);if(to<0)throw Error('No empty relocation slot');
      p.items[to]=p.items[from];p.items[from]=null;cache_player_items(p);resend(p,'reopen+cid');return {from,to,item:p.items[to]};})()`);
    // Declared persistence fault: the completion response was lost and the
    // replacement CODE has no local production journal. Paid commerce state
    // remains intact; only authoritative receipt evidence can restore it.
    await live.clients[merchant].run(`localStorage.removeItem('party-production:'+character.name)`);
    faults.push({at:Date.now(),action:'lost-local-production-journal-before-code-replacement'});
    const oldRuntime=(await live.state()).characters[merchant].dashboardRuntime;
    const replacedAt=Date.now();
    await live.clients[merchant].frame.evaluate(()=>{
      const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);
    });
    faults.push({at:replacedAt,action:'abrupt-native-code-replacement',oldRuntime});
    release();
    await expect.poll(async()=>{const c=(await live.state()).characters[merchant];return c?.dashboardRuntime&&c.dashboardRuntime!==oldRuntime&&c.seenAt>=replacedAt;},{timeout:60_000}).toBeTruthy();
    expect((await live.clients[merchant].snapshot()).connected).toBe(true);
    await expect.poll(async()=>{const s=await live.state();return ![s.merchantCurrent,...s.merchantQueue].some((j:any)=>j?.commerceOrderId===order.jobId);},{timeout:120_000}).toBe(true);
    const after=await economy(live);
    const count=(v:Economy)=>v.characters[merchant].items.filter(i=>i?.name==='helmet'&&i.level===1).length;
    expect(count(after)-count(before)).toBe(1);
    expect(Math.max(...checkpoints.map(state=>Number(state.spent)||0))).toBe(journal.commerce.state.spent);
    expect(Math.max(...checkpoints.map(state=>Number(state.attempts)||0))).toBe(journal.commerce.state.attempts);
    expect(progress.pendingUpgrade).toBeUndefined();
    await record(live,info,'completed-commerce-receipt-recovery',before,{order,journal,receipt,relocation,faults,checkpoints,progress,after});
  }finally{
    release();await context.unrouteAll({behavior:'ignoreErrors'});
    await info.attach('completed-commerce-receipt-faults',{body:JSON.stringify({journal,receipt,relocation,faults,final:await live.state()}),contentType:'application/json'});
  }
});

for (const surplus of [false,true]) test(`restarted upgrade batch ${surplus ? 'holds surplus identical cargo' : 'remaps compacted owned items'}`,async({live},info)=>{
  test.setTimeout(240_000);
  await catalog(live,'helmet');
  const id='compacted-owned-upgrade-batch',item={name:'helmet',level:0};
  const inventory:Record<number,Item>={17:item,18:item,19:item};
  if(surplus) inventory[20]=item;
  await seed(live,inventory);
  const before=await economy(live);
  const progress={phase:'leveling',buyIndex:0,attempts:3,spent:9600,completedResults:0,results:[],
    activeItem:item,activeSlot:22,cycleActive:true,batchItems:[{slot:24,item},{slot:25,item}],batchRemaining:0,sequence:2};
  await live.restoreHistoricalSettings(()=>({merchantQueue:[{id,target:merchant,reason:'merchant commerce',queuedAt:Date.now(),commerceOrderId:id,
    commerceProgressVersion:2,order:{buys:[{id:'helmet',quantity:3,level:1,attempts:3,budget:100000}],crafts:[]},resumeState:progress}]}));
  if(surplus){
    await expect.poll(async()=> (await live.state()).merchantQueue.some((job:any)=>job.commerceOrderId===id&&/ambiguous/.test(job.lastError||'')),{timeout:90_000}).toBe(true);
    expect((await economy(live)).characters[merchant].items).toEqual(before.characters[merchant].items);
  }else{
    await expect.poll(async()=>{const s=await live.state();return ![s.merchantCurrent,...s.merchantQueue].some((job:any)=>job?.commerceOrderId===id);},{timeout:180_000}).toBe(true);
    const after=await economy(live);
    expect(after.characters[merchant].items.filter(item=>item?.name==='helmet'&&item.level===1)).toHaveLength(3);
    expect((await live.clients[merchant].events()).filter((event:any)=>event.event==='game_response'&&event.data?.response==='upgrade_success')).toHaveLength(3);
    await live.restartCoordinator();
    expect((await economy(live)).characters[merchant].items.filter(item=>item?.name==='helmet'&&item.level===1)).toHaveLength(3);
  }
  await record(live,info,'compacted-upgrade-batch-ownership',before,{progress,surplus,state:await live.state()});
});

test('running upgrade batch remaps items moved after its first result',async({live},info)=>{
  test.setTimeout(240_000);
  await catalog(live,'helmet');
  const id='running-relocated-upgrade-batch',item={name:'helmet',level:0};
  await seed(live,{5:{name:'scroll0',q:6},17:item,18:item,19:item});
  const before=await economy(live),observations:any[]=[];
  let relocation:any,moved=false;
  await live.clients[merchant].page.route('**/party-api/merchant/checkpoint',async route=>{
    const body=route.request().postDataJSON();
    if(body.jobId!==id||moved||body.state?.completedResults!==1||body.state.activeItem||body.state.batchItems?.length!==2){await route.continue();return;}
    moved=true;
    const response=await route.fetch();
    expect(response.status()).toBe(200);
    observations.push({at:Date.now(),action:'first-result-persisted',state:body.state});
    relocation=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(merchant)}),moves=${JSON.stringify(body.state.batchItems.map((entry:any,index:number)=>({from:entry.slot,to:26+index})))};
      for(const m of moves){if(p.items[m.to]||p.items[m.from]?.name!=='helmet'||(p.items[m.from].level||0)!==0)throw Error('Declared remaining batch relocation changed');}
      for(const m of moves){p.items[m.to]=p.items[m.from];p.items[m.from]=null;}
      cache_player_items(p);resend(p,'reopen+cid');return moves;})()`);
    await expect.poll(async()=>{const c=await live.clients[merchant].snapshot();return relocation.every((m:any)=>!c.items[m.from]&&c.items[m.to]?.name==='helmet'&&(c.items[m.to].level||0)===0);},{timeout:15_000}).toBe(true);
    observations.push({at:Date.now(),action:'native-batch-relocation-observed',relocation});
    await route.fulfill({response});
  });
  try{
    const progress={phase:'leveling',buyIndex:0,attempts:3,spent:9600,completedResults:0,results:[],activeItem:item,activeSlot:17,
      cycleActive:true,batchItems:[{slot:18,item},{slot:19,item}],batchRemaining:0,sequence:2};
    await live.restoreHistoricalSettings(()=>({merchantQueue:[{id,target:merchant,reason:'merchant commerce',queuedAt:Date.now(),commerceOrderId:id,
      commerceProgressVersion:2,order:{buys:[{id:'helmet',quantity:3,level:1,attempts:3,budget:100000}],crafts:[]},resumeState:progress}]}));
    await expect.poll(()=>moved,{timeout:90_000}).toBe(true);
    let outcome='running';
    await expect.poll(async()=>{const s=await live.state(),job=[s.merchantCurrent,...s.merchantQueue].find((j:any)=>j?.commerceOrderId===id);
      outcome=job?.lastError?String(job.lastError):job?'running':'completed';return outcome;},{timeout:90_000}).not.toBe('running');
    expect(outcome).toBe('completed');
    const after=await economy(live);
    expect(after.characters[merchant].items.filter(i=>i?.name==='helmet'&&i.level===1)).toHaveLength(3);
    expect(quantity(after.characters[merchant].items,'scroll0')).toBe(quantity(before.characters[merchant].items,'scroll0')-3);
    expect((await live.clients[merchant].events()).filter((e:any)=>e.event==='game_response'&&e.data?.response==='upgrade_success')).toHaveLength(3);
    for(const [slot,entry] of before.characters[merchant].items.entries())if(entry&&entry.name!=='helmet'&&entry.name!=='scroll0')expect(after.characters[merchant].items[slot]).toEqual(entry);
    await record(live,info,'running-batch-relocation',before,{relocation,observations,after});
  }finally{
    await live.clients[merchant].page.unrouteAll({behavior:'ignoreErrors'});
    await info.attach('running-batch-relocation-progress',{body:JSON.stringify({relocation,observations,state:await live.state()}),contentType:'application/json'});
  }
});

test('unavailable upgrade estimate enforces its gold cap across native purchases and restart',async({live},info)=>{
  // Failure inventory: fabricated attempt allowance; base/scroll spending skips
  // cap; restart resets accrued spend; retry purchases beyond the same cap.
  // Native buys/upgrades remain real. Only checkpoint transport is held after
  // the coordinator has persisted the first paid purchase, to place restart.
  // Protection-only checkpoint probes have no progress state; forward them
  // normally and retain only actual durable commerce progress for assertions.
  // The native level2 seller route alone took 110s in retained CI evidence.
  test.setTimeout(600_000);
  const item='softstepgloves';
  await catalog(live,item);
  const nativeCosts=await live.clients[merchant].run(`({base:G.items.softstepgloves.g,scroll:G.items.scroll1.g,
    nextScroll:G.items.scroll2.g,initialGrade:item_grade({name:'softstepgloves',level:0}),nextGrade:item_grade({name:'softstepgloves',level:5})})`);
  expect(nativeCosts).toMatchObject({base:420000,scroll:40000,nextScroll:1600000,initialGrade:1,nextGrade:2});
  const cap=nativeCosts.base+nativeCosts.scroll;
  await seed(live,{10:{name:'scroll1',q:4}});
  expect((await live.clients[merchant].snapshot()).items[10]?.q).toBe(4);
  // Four preexisting scrolls leave exactly one paid native scroll and base.
  // A failed upgrade cannot afford another base; five successes need scroll2.
  // This retains genuine cap exhaustion without an unrelated seven-step chain.
  const funding=await live.admin(`output=(async()=>{const p=get_player('${merchant}');
    const before=await db.collection('user').findOne({_id:p.owner});
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.gold':1000000}});
    for(const member of Object.values(players))if(member.owner===p.owner&&member.user)member.user.gold=1000000;
    return {beforeBankGold:before.info.gold,bankGold:1000000,merchantGold:p.gold};})()`);
  expect(funding.bankGold).toBe(1000000);
  expect(funding.bankGold+funding.merchantGold).toBeLessThan(64000000);
  await info.attach('declared-capped-commerce-funding',{body:JSON.stringify(funding),contentType:'application/json'});
  const checkpoints:any[]=[];
  let held=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  try {
  await live.clients[merchant].page.route('**/party-api/merchant/checkpoint',async route=>{
    const body=route.request().postDataJSON();
    // Protection probes are not the fault target. Let the browser observe a
    // real disconnect during restart instead of throwing from route.fetch.
    if(!body.state||typeof body.state!=='object')return route.continue();
    if(held){
      await gate;
      checkpoints.push(body.state);
      // Once the paid checkpoint is durable, retire the proxy on release.
      // Browser transport owns disconnect/reconnect against the restarted host.
      return route.continue();
    }
    const response=await route.fetch();
    if(body.state&&typeof body.state==='object') {
      checkpoints.push(body.state);
      if(response.ok()&&!held&&Number(body.state.spent)>0&&!body.state.pendingPurchase){
        held=true;await gate;
        // The coordinator persisted this exact purchase before restart. Lose
        // only its acknowledgement; never replay the completed checkpoint.
        return route.abort('failed');
      }
    }
    await route.fulfill({response});
  });
  const order=await live.post('/merchant/order',{buys:[{id:item,quantity:1,level:12,acknowledgeUnavailable:true,goldCap:cap}],crafts:[]});
  await expect.poll(()=>held,{timeout:120_000}).toBe(true);
  const before=await live.state();
  const jobs=[before.merchantCurrent,...before.merchantQueue].filter((entry:any)=>entry?.id===order.jobId||entry?.commerceOrderId===order.jobId);
  expect(jobs,'Exactly one durable commerce owner must survive a native movement retry').toHaveLength(1);
  const job=jobs[0];
  expect(job.order.buys[0]).toMatchObject({goldCap:cap,budget:cap,estimateUnavailable:true});
  expect(job.order.buys[0].attempts).toBeUndefined();
  expect(job.resumeState.spent).toBeGreaterThan(0);
  await live.restartCoordinator();release();
  await expect.poll(async()=>{
    const state=await live.state();
    return [state.merchantCurrent,...state.merchantQueue].some((entry:any)=>(entry?.id===order.jobId||entry?.commerceOrderId===order.jobId)&&/budget exhausted|gold cap/i.test(entry.lastError||entry.error||entry.blockedReason||''))||state.merchantActivity.some((entry:any)=>/budget exhausted|gold cap/i.test(JSON.stringify(entry)));
  },{timeout:300_000}).toBe(true);
  expect(Math.max(...checkpoints.map(state=>Number(state.spent)||0))).toBeLessThanOrEqual(cap);
  expect(checkpoints.some(state=>state.pendingPurchase?.name==='scroll1'&&state.pendingPurchase.quantity===1&&state.pendingPurchase.cost===nativeCosts.scroll)).toBe(true);
  expect(checkpoints.some(state=>state.pendingPurchase?.name===item&&state.pendingPurchase.quantity===1&&state.pendingPurchase.cost===nativeCosts.base)).toBe(true);
  expect(checkpoints.some(state=>Number(state.spent)===cap)).toBe(true);
  await info.attach('capped-native-upgrade-restart',{body:JSON.stringify({nativeCosts,cap,declaredScrollStock:4,order,before,after:await live.state(),checkpoints,events:await live.clients[merchant].events()}),contentType:'application/json'});
  } finally {
    // A failed assertion must not leave a real checkpoint response held while
    // the fixture disposes its browser/request context. Suppress route errors
    // only during teardown, after ordinary assertions and response handling.
    release();
    if(!live.clients[merchant].page.isClosed())
      await live.clients[merchant].page.unrouteAll({behavior:'ignoreErrors'});
    await info.attach('native-cap-budget-ledger',{body:JSON.stringify({nativeCosts,cap,declaredScrollStock:4,
      checkpoints,final:await live.state(),events:await live.clients[merchant].events()}),contentType:'application/json'});
  }
});

test('production journal storage echoes retain the current native attempt ownership',async({live},info)=>{
  test.setTimeout(480_000);
  await live.restoreHistoricalSettings(()=>({luckyUpgradeSlots:{[merchant]:30}}));
  await catalog(live,'helmet');
  const before=await economy(live);
  await live.post('/merchant/force-stand',{enabled:true});
  const cycleCost=await live.clients[merchant].run('Number(G.items.helmet.g)+3*Number(G.items.scroll0.g)');
  expect(cycleCost).toBeGreaterThan(0);
  await live.clients[merchant].run(`(()=>{
    const key='party-production:'+character.name,set=Storage.prototype.setItem;
    let older=null;globalThis.__e2eProductionEchoes=0;
    Storage.prototype.setItem=function(k,value){
      set.call(this,k,value);
      if(k!==key)return;
      const current=JSON.parse(value);
      if(!older&&current.phase==='complete')older=JSON.stringify({...current,phase:'running'});
      else if(older&&current.id!==JSON.parse(older).id){
        set.call(this,k,older);globalThis.__e2eProductionEchoes++;
      }
    };return true;
  })()`);
  const order=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:2,level:3}],crafts:[]});
  let initialAllowance:any;
  await live.restoreHistoricalSettings(settings=>{
    if(settings.merchantCurrent?.id===order.jobId)throw Error('Storage echo allowance must precede native order admission');
    const queued=settings.merchantQueue.find((job:any)=>job.id===order.jobId);
    if(!queued||queued.resumeState||queued.order?.buys?.length!==1)throw Error('Exact initial storage echo order unavailable');
    const line=queued.order.buys[0];
    if(line.id!=='helmet'||line.quantity!==2||line.level!==3)throw Error('Storage echo initial order identity changed');
    initialAllowance={jobId:queued.id,original:{...line},declaredCycles:10,cycleCost,budget:cycleCost*10};
    return {merchantQueue:settings.merchantQueue.map((job:any)=>job.id===order.jobId?{...job,order:{...job.order,buys:[{...line,attempts:10,budget:cycleCost*10}]}}:job)};
  });
  await info.attach('declared-storage-echo-initial-order-allowance',{body:JSON.stringify(initialAllowance),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===order.jobId||job?.commerceOrderId===order.jobId);
  },{timeout:300_000}).toBe(true);
  expect(await live.clients[merchant].run('globalThis.__e2eProductionEchoes')).toBeGreaterThan(0);
  const after=await economy(live);
  const results=(value:Economy)=>value.characters[merchant].items.filter(item=>item?.name==='helmet'&&item.level===3).length;
  expect(results(after)-results(before)).toBe(2);
  const nativeSuccesses=(await live.clients[merchant].events()).filter(event=>event.event==='game_response'&&event.data?.response==='upgrade_success');
  expect(nativeSuccesses.filter(event=>[1,2,3].includes(Number(event.data.level))).length).toBeGreaterThanOrEqual(6);
  const pending=await live.post('/merchant/production',{character:merchant,action:'pending'});
  expect(pending.pending).toEqual([]);
  await restartAndObserve(live);
  expect(results(await economy(live))).toBe(results(after));
  await record(live,info,'production-storage-echo-ownership',before,{order,after,pending,echoes:await live.clients[merchant].run('globalThis.__e2eProductionEchoes')});
});

test('operator unknown receipt review resumes a missing commerce cycle without resetting spend',async({live},info)=>{
  test.setTimeout(240_000);
  await catalog(live,'helmet');
  const id='reviewed-missing-commerce-cycle',receipt='reviewed-missing-production';
  const progress={phase:'leveling',buyIndex:0,attempts:1,spent:4200,completedResults:0,results:[],activeItem:{name:'helmet',level:0},activeSlot:10,cycleActive:true,batchItems:[],batchRemaining:0,sequence:2,pendingUpgrade:{level:1}};
  // Declared interrupted-state input: an admitted attempt's item has no native
  // inventory survivor. No successful/destroyed receipt is fabricated.
  await live.restoreHistoricalSettings(()=>({production:{attempts:{[receipt]:{name:'helmet',level:1,kind:'upgrade',rules:[],journal:{id:receipt,item:{name:'helmet',level:0},slots:[10],phase:'running',request:{character:merchant,id:receipt,kind:'upgrade',item:{name:'helmet',level:0}},commerce:{key:'party-commerce:'+id,sequence:2,state:progress}}}}},merchantQueue:[{id,target:merchant,reason:'merchant commerce',queuedAt:Date.now(),commerceOrderId:id,commerceProgressVersion:2,order:{buys:[{id:'helmet',quantity:1,level:1,attempts:20,budget:100000}],crafts:[]},resumeState:progress}]}));
  await live.clients[merchant].run(`localStorage.setItem(${JSON.stringify('party-commerce:'+id)},${JSON.stringify(JSON.stringify({...progress,sequence:1,activeItem:{name:'helmet',level:2}}))})`);
  await live.post('/merchant/production',{character:merchant,action:'resolve-unknown',resumeMissing:true,id:receipt,kind:'upgrade',item:{name:'helmet',level:0},reason:'E2E operator reviewed native inventory; interrupted item missing; preserve spending and resume remaining allowance'});
  await expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.commerceOrderId===id);
  },{timeout:180_000}).toBe(true);
  expect((await live.clients[merchant].snapshot()).items.some((item:any)=>item?.name==='helmet'&&item.level===1)).toBe(true);
  const inspection=await live.post('/merchant/production',{character:merchant,action:'inspect',id:receipt,kind:'upgrade',item:{name:'helmet',level:0}});
  expect(inspection.attempt.resolution.outcome).toBe('unknown');
  expect(inspection.attempt.success).toBeUndefined();
  await info.attach('reviewed-unknown-native-continuation',{body:JSON.stringify({progress,inspection,state:await live.state(),events:await live.clients[merchant].events()}),contentType:'application/json'});
});

test('merchant stand location is valid at first setup and stays saved through restart', async ({ live, page }, info) => {
  test.setTimeout(240_000);
  // Failure modes: a shared constant survives first setup; a wall point is saved;
  // restart rerolls coordinates; settings never reach native stand movement.
  const first = (await live.state()).merchantStandLocation;
  expect(first.map).toBe('main');
  expect(first.x).toBeGreaterThanOrEqual(-100); expect(first.x).toBeLessThanOrEqual(100);
  expect(first.y).toBeGreaterThanOrEqual(-100); expect(first.y).toBeLessThanOrEqual(100);
  expect(await live.clients[merchant].run(`can_move({map:'main',x:${first.x},y:${first.y},going_x:${first.x},going_y:${first.y},base:character.base})`)).toBe(true);
  await live.restartCoordinator();
  expect((await live.state()).merchantStandLocation).toEqual(first);
  const blocked = await live.clients[merchant].run(`(()=>{const l=G.geometry.main.x_lines[0];return {map:'main',x:l[0],y:(l[1]+l[2])/2}})()`);
  await expect(live.post('/merchant/stand-location', blocked)).rejects.toThrow(/clear|geometry|blocked|valid/i);
  expect((await live.state()).merchantStandLocation).toEqual(first);
  await page.goto(live.url);
  await page.getByText(/Merchant logistics ·/).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Stand X', { exact: true }).fill('80');
  await page.getByLabel('Stand Y', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Save stand location', exact: true }).click();
  await expect.poll(async () => (await live.state()).merchantStandLocation).toEqual({ map: 'main', x: 80, y: 80 });
  await info.attach('merchant-stand-location-settings', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await seed(live,{10:{name:'stand0'}});
  await live.post('/merchant/force-stand', { enabled: true });
  await expect.poll(async () => {
    const c = await live.clients[merchant].snapshot();
    return c.map === 'main' && Math.hypot(c.x-80,c.y-80) <= 35 && await live.clients[merchant].run('!!character.stand');
  }, { timeout: 90_000 }).toBe(true);
  await live.restartCoordinator();
  expect((await live.state()).merchantStandLocation).toEqual({ map: 'main', x: 80, y: 80 });
  await info.attach('merchant-stand-location-native', { body: JSON.stringify({ first, blocked, client: await live.clients[merchant].snapshot(), state: await live.state(), events: await live.clients[merchant].events() }), contentType: 'application/json' });
  await page.close();
});
const names = ['E2EWarrior', 'E2EPriest', merchant];
type Items = (Item | null)[];

for(const locked of [false,true]) test(`best-effort lucky restoration preserves changed native cargo and ${locked?'locked':'sequential'} rolls across CODE restart`,async({live},info)=>{
  test.setTimeout(480_000);
  const slot=4,movedSlot=27,checkpoints:any[]=[];
  let changed=false;
  await live.clients[merchant].frame.evaluate(()=>{
    const game=window as any;
    game.__e2eLuckyRollPackets=[];
    game.__e2eLuckyRollObserver=(data:unknown)=>{
      game.__e2eLuckyRollPackets.push({at:Date.now(),data:JSON.parse(JSON.stringify(data))});
      if(game.__e2eLuckyRollPackets.length>256)game.__e2eLuckyRollPackets.shift();
    };
    game.socket.on('q_data',game.__e2eLuckyRollObserver);
  });
  const rolls=(state:any,index:number)=>Object.values(state.luckySlotTracking?.[merchant]||{}).reduce((total:number,stream:any)=>total+Number(stream.slots?.[index]?.totalRolls||0),0);
  const finish=async(jobId:string)=>expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===jobId||job?.commerceOrderId===jobId);
  },{timeout:150_000,message:'Changed lucky layout must not fence completed or unrelated merchant work'}).toBe(true);
  try {
    await live.restoreHistoricalSettings(()=>({luckyUpgradeSlots:{},luckySlotResume:{[merchant]:{slot,rolls:0}},luckySlotLocks:locked?{[merchant]:slot}:{}}));
    await catalog(live,'helmet');
    await seed(live,{[slot]:{name:'seashell',q:3}});
    const rollSetup=await live.admin(`output=(()=>{
      const p=get_player('${merchant}'),skills=['massproduction','massproductionpp'].map(name=>({name,level:Number(G.skills[name].level)}));
      const requirement=Math.min(...skills.map(skill=>skill.level));
      if(!Number.isFinite(requirement)||requirement<=1)throw Error('Native mass-production level requirements unavailable');
      if(p.s.massproduction||p.s.massproductionpp)throw Error('Roll fixture unexpectedly has an active native mass buff');
      p.level=requirement-1;resend(p,'reopen+cid');return {level:p.level,skills};
    })()`);
    await expect.poll(async()=>live.clients[merchant].run('character.level')).toBe(rollSetup.level);
    checkpoints.push({rollSetup});
    await live.admin(`output=(()=>{const p=get_player('E2EPriest');if(p.items[10])throw Error('Fixture slot occupied');p.items[10]={name:'seashell',q:1};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    await expect.poll(async()=>(await live.clients.E2EPriest.snapshot()).items[10]?.q).toBe(1);
    await live.clients[merchant].run(`(()=>{const native=swap;globalThis.__e2eChangedLuckyLayout=false;globalThis.__e2eForbiddenRestoreSwaps=[];
      swap=function(a,b){const journal=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
        if(globalThis.__e2eChangedLuckyLayout&&journal?.phase==='restoring'&&
          (a===journal.from&&b===journal.to||a===journal.to&&b===journal.from))
          globalThis.__e2eForbiddenRestoreSwaps.push({a,b,journal,items:character.items.map(i=>i&&({...i}))});
        return native(a,b)};return true})()`);
    const before=await economy(live),initial=await live.state();
    await live.clients[merchant].run(`(()=>{
      const generation=globalThis.__partyRuntimeGeneration;
      const owns=()=>globalThis.__partyRuntimeGeneration===generation&&parent.document.getElementById('maincode')?.contentWindow===globalThis;
      const waitFor=async(check,description)=>{const deadline=Date.now()+30000;while(!check()){
        if(!owns())throw Error('Native lucky input CODE ownership changed');
        if(Date.now()>=deadline)throw Error('Native lucky input timed out: '+description);
        await new Promise(resolve=>setTimeout(resolve,100));
      }};
      globalThis.__e2eLuckyInput=null;globalThis.__e2eLuckyInputError=null;
      globalThis.__e2eRestoreCheckpointAjax=(${gateNativeAjaxInput.toString()})(globalThis,options=>{
        if(!String(options?.url).endsWith('/merchant/production'))return false;
        const body=typeof options.data==='string'?JSON.parse(options.data):null,journal=body?.journal?.lucky;
        const matches=body?.character===character.name&&body.action==='checkpoint'&&typeof body.id==='string'&&body.id===body.journal.id&&journal?.phase==='restoring';
        if(matches)globalThis.__e2eLuckyInputCheckpoint=body;return matches;
      },async()=>{
        try{
          const body=globalThis.__e2eLuckyInputCheckpoint,journal=body.journal.lucky;
          const local=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
          if(local?.from!==journal.from||local.to!==journal.to||local.phase!==journal.phase)throw Error('Native lucky checkpoint ownership mismatch');
          if(journal?.to!==${slot}||journal.phase!=='restoring')throw Error('Actual restoring lucky checkpoint changed');
          const original={items:character.items.map(item=>item&&({...item}))};
          if(original.items[${slot}]?.name!=='helmet'||original.items[${slot}]?.level!==1||original.items[journal.from]?.name!=='seashell')throw Error('Native lucky checkpoint input inventory mismatch');
          const priestGame=parent.parent.document.getElementById('ichare2epriest')?.contentWindow;
          const priest=priestGame?.document.getElementById('maincode')?.contentWindow;
          if(priest?.character?.name!=='E2EPriest'||typeof priest.send_item!=='function')throw Error('Missing actual Priest CODE for native lucky input');
          await priest.send_item(character.name,10,1);
          await waitFor(()=>character.items[journal.from]?.q===4,'native delivery merge');
          if(character.items[${movedSlot}])throw Error('Native lucky input destination occupied');
          await swap(${slot},${movedSlot});
          await waitFor(()=>character.items[${movedSlot}]?.name==='helmet'&&character.items[${movedSlot}]?.level===1,'native cargo swap');
          globalThis.__e2eChangedLuckyLayout=true;
          globalThis.__e2eLuckyInput={journal,original,changed:{items:character.items.map(item=>item&&({...item}))}};
        }catch(error){globalThis.__e2eLuckyInputError=String(error);throw error;}
      },owns);return true;
    })()`);
    const first=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:1,level:1}],crafts:[]});
    await expect.poll(async()=>{
      const input=await live.clients[merchant].run('({result:globalThis.__e2eLuckyInput,error:globalThis.__e2eLuckyInputError})');
      if(input.error)throw Error(input.error);
      if(input.result){changed=true;checkpoints.push(input.result);return true;}return false;
    },{timeout:150_000}).toBe(true);
    await finish(first.jobId);
    await live.clients[merchant].run('globalThis.__e2eRestoreCheckpointAjax()');
    const after=await economy(live);
    expect(quantity(after.characters[merchant].items,'seashell')-quantity(before.characters[merchant].items,'seashell')).toBe(1);
    expect(after.characters[merchant].items.filter(item=>item?.name==='helmet'&&item.level===1)).toHaveLength(1);
    await expect.poll(async()=>rolls(await live.state(),slot)-rolls(initial,slot)).toBe(1);
    expect(await live.clients[merchant].run(`localStorage.getItem('party-lucky-upgrade:'+character.name)`)).toBeNull();
    const restorationSwaps=await live.clients[merchant].run('globalThis.__e2eForbiddenRestoreSwaps');
    expect(restorationSwaps).toEqual([]);
    checkpoints.push({restorationSwaps,retiredInventory:await live.clients[merchant].snapshot()});
    const runtime=(await live.state()).characters[merchant].dashboardRuntime;
    await live.clients[merchant].frame.evaluate(()=>{
      const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);
    });
    // Creating an iframe does not mean its loader has finished fetching from
    // the coordinator that the next operation deliberately stops.
    await expect.poll(async()=>{
      const current=(await live.state()).characters[merchant]?.dashboardRuntime;
      return !!current&&current!==runtime;
    },{timeout:60_000,message:'Replacement native CODE must publish before its host restarts'}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>{
      const current=(await live.state()).characters[merchant]?.dashboardRuntime;
      return !!current&&current!==runtime;
    },{timeout:60_000}).toBe(true);
    await catalog(live,'shoes');
    const shoesBefore=quantity((await economy(live)).characters[merchant].items,'shoes');
    const purchase=await live.post('/merchant/order',{buys:[{id:'shoes',quantity:1,level:0}],crafts:[]});
    await finish(purchase.jobId);
    expect(quantity((await economy(live)).characters[merchant].items,'shoes')-shoesBefore).toBe(1);
    await catalog(live,'helmet');
    const second=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:1,level:1}],crafts:[]});
    await finish(second.jobId);
    // Queue completion and lucky-roll status publication are separate requests.
    // Require both exact counts in one fresh snapshot, including the locked case.
    const rollPublication:any[]=[];
    try{
      await expect.poll(async()=>{
        const state=await live.state();
        const counts=[rolls(state,slot)-rolls(initial,slot),rolls(state,slot+1)-rolls(initial,slot+1)];
        rollPublication.push({at:Date.now(),counts});
        if(rollPublication.length>32)rollPublication.splice(1,1);
        return counts;
      },{timeout:15_000,message:'Completed native upgrades must publish exact lucky-slot roll totals'}).toEqual(locked?[2,0]:[1,1]);
    }finally{checkpoints.push({rollPublication});}
    const final=await live.state(),inventory=await economy(live);
    expect(rolls(final,slot)-rolls(initial,slot)).toBe(locked?2:1);
    expect(rolls(final,slot+1)-rolls(initial,slot+1)).toBe(locked?0:1);
    if(locked) expect(final.luckySlotLocks[merchant]).toBe(slot);
    expect(inventory.characters[merchant].items.filter(item=>item?.name==='helmet'&&item.level===1)).toHaveLength(2);
    expect(quantity(inventory.characters[merchant].items,'seashell')).toBe(4);
  } finally {
    const cleanup=await live.clients[merchant].frame.evaluate(()=>{const runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;runner?.__e2eRestoreCheckpointAjax?.();return {restored:true};})
      .catch(error=>({captureError:String(error)}));
    await info.attach('lucky-best-effort-native-evidence',{body:JSON.stringify({locked,changed,checkpoints,cleanup,
      tracking:await live.clients[merchant].frame.evaluate(()=>{
        const game=window as any,stored:Record<string,unknown>={};
        for(let i=0;i<localStorage.length;i++){
          const key=localStorage.key(i)!;
          if(key.startsWith('party-lucky-slot-tracking:'))stored[key]=JSON.parse(localStorage.getItem(key)||'null');
        }
        game.socket.off('q_data',game.__e2eLuckyRollObserver);
        return {packets:game.__e2eLuckyRollPackets,stored};
      }).catch(error=>({captureError:String(error)})),
      state:await live.state().catch(error=>({captureError:String(error)})),
      inventory:await economy(live).catch(error=>({captureError:String(error)})),
      events:await live.clients[merchant].events().catch(error=>({captureError:String(error)}))}),contentType:'application/json'});
  }
});

test('merchant finishes native upgrades despite delayed lucky journal storage echoes', async ({ live }, info) => {
  // Two native orders plus reconnect and lucky-slot swaps share this budget.
  test.setTimeout(480_000);
  // Failure modes: IPC echoes resurrect a cleared lucky journal, move the next
  // owned item during recovery, and strand the durable order in receipt review.
  // Reconnect can also reject a missing companion as already_running when the
  // native account roster still says online; its AFK refresh takes about 90s.
  // Observe authoritative native roster refreshes without changing online flags.
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  // Purchase orders use their native retry allowance, independently of manual
  // upgrade offering rules. Declare enough initial cycles for this journal case.
  const cycleCost=await live.clients[merchant].run('Number(G.items.helmet.g)+3*Number(G.items.scroll0.g)');
  expect(cycleCost).toBeGreaterThan(0);
  await live.post('/merchant/force-stand',{enabled:true});
  const before = await economy(live);
  await live.clients[merchant].run(`(()=>{const key='party-lucky-upgrade:'+character.name;
    const remove=Storage.prototype.removeItem, set=Storage.prototype.setItem, get=Storage.prototype.getItem;
    globalThis.__e2eStorageEchoes=0;
    Storage.prototype.removeItem=function(k){const old=get.call(this,k);remove.call(this,k);
      if(k===key&&old){set.call(this,k,old);globalThis.__e2eStorageEchoes++;}}
    return true})()`);
  const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 3 }], crafts: [] });
  let initialAllowance:any;
  await live.restoreHistoricalSettings(settings=>{
    if(settings.merchantCurrent?.id===order.jobId)throw Error('Storage echo allowance must precede native order admission');
    const queued=settings.merchantQueue.find((job:any)=>job.id===order.jobId);
    if(!queued?.order||queued.order.buys.length!==1)throw Error('Exact initial storage echo order unavailable');
    const line=queued.order.buys[0];
    if(line.id!=='helmet'||line.quantity!==1||line.level!==3)throw Error('Storage echo initial order identity changed');
    initialAllowance={jobId:queued.id,original:{...line},declaredCycles:10,cycleCost,budget:cycleCost*10};
    return {merchantQueue:settings.merchantQueue.map((job:any)=>job.id===order.jobId?{...job,order:{...job.order,buys:[{...line,attempts:10,budget:cycleCost*10}]}}:job)};
  });
  await info.attach('declared-lucky-echo-initial-order-allowance',{body:JSON.stringify(initialAllowance),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:false});
  await jobFinished(live, order.jobId);
  const after = await economy(live);
  expect(after.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 3)).toHaveLength(1);
  const echoes = await live.clients[merchant].run('globalThis.__e2eStorageEchoes');
  expect(echoes).toBeGreaterThan(0);
  // A reconnect discards the runtime cache while persistence can still contain
  // a running journal from a completed receipt. Move the finished gear natively
  // so recovery cannot rely on its old source cell or old intermediate level.
  await live.clients[merchant].run(`(()=>{const key='party-lucky-upgrade:'+character.name;
    const j=JSON.parse(localStorage.getItem(key));if(!j)throw Error('Missing echoed journal');
    j.phase='running';delete j.result;j.item.level=0;
    const target=character.items.findIndex((i,n)=>n!==j.from&&n!==j.to&&!i);
    swap(j.from,target);localStorage.setItem(key,JSON.stringify(j));return true})()`);
  const nativeReconnectRoster = () => live.clients.E2EWarrior.frame.evaluate(() => {
    const game = window as any;
    return { at: Date.now(), active: game.get_active_characters(),
      roster: game.X.characters.map((entry: any) => ({ name: entry.name,
        online: entry.online, server: entry.server })),
      frames: Array.from(document.querySelectorAll('iframe')).map(frame => frame.id) };
  });
  const reconnectBefore = await nativeReconnectRoster(), rosterRefreshes: number[] = [];
  const observeRosterRefresh = (request: import('@playwright/test').Request) => {
    if (request.postData()?.includes('servers_and_characters')) rosterRefreshes.push(Date.now());
  };
  live.clients.E2EWarrior.page.on('request', observeRosterRefresh);
  try { await live.reconnectClient(merchant); }
  finally {
    live.clients.E2EWarrior.page.off('request', observeRosterRefresh);
    await info.attach('native-companion-reconnect-roster', { body: JSON.stringify({
      before: reconnectBefore, after: await nativeReconnectRoster(), rosterRefreshes,
      coordinator: (await live.state()).characterConnections,
    }), contentType: 'application/json' });
  }
  await expect.poll(async () => (await live.state()).characters[merchant]?.upgradeInventoryBusy,
    { timeout: 30_000, message: 'Idle recovery must clear the inventory gate before another job is dispatched' }).toBe(false);
  const followup = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
  await jobFinished(live, followup.jobId);
  const recovered = await economy(live);
  expect(recovered.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 3)).toHaveLength(1);
  expect(recovered.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1)).toHaveLength(1);
  await record(live, info, 'lucky-journal-storage-echo', before, { order, echoes, after, followup, recovered });
});

test('lucky upgrade preserves party deliveries across preparation and best-effort restoration', async ({ live }, info) => {
  test.setTimeout(300_000);
  // Failure modes: a preparing checkpoint leaves an empty-slot assumption stale;
  // stack quantity changes after restoration is persisted permanently fence
  // recovery; restarting replays the upgrade or loses the received cargo.
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 4 } }));
  await catalog(live, 'helmet');
  await live.admin(`output=(()=>{const p=get_player('E2EPriest');if(p.items[10])throw Error('Fixture slot occupied');p.items[10]={name:'seashell',q:4};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async () => (await live.clients.E2EPriest.snapshot()).items[10]?.q).toBe(4);
  await live.clients[merchant].run(`(()=>{const native=swap;globalThis.__e2eDeliveryRestoreFault=false;
    swap=function(a,b){const j=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
      if(j?.phase==='restoring'&&!globalThis.__e2eDeliveryRestoreFault){globalThis.__e2eDeliveryRestoreFault=true;throw Error('Injected interruption before return swap');}
      return native(a,b)};return true})()`);
  const before = await economy(live), context = live.clients[merchant].page.context();
  let preparingDelivery = false, restoringDelivery = false;
  const checkpoints: unknown[] = [];
  await context.route('**/merchant/production', async route => {
    const body = route.request().postDataJSON(), j = body.journal?.lucky;
    if (body.action === 'checkpoint' && j?.phase === 'preparing' && !preparingDelivery) {
      preparingDelivery = true;
      expect((await live.clients[merchant].snapshot()).items[j.to]).toBeNull();
      await live.clients.E2EPriest.run(`send_item('${merchant}',10,3).then(()=>true)`);
      await expect.poll(async () => (await live.clients[merchant].snapshot()).items[j.to]?.q).toBe(3);
      checkpoints.push({ phase: 'preparing', journal: j, inventory: await economy(live) });
    }
    if (body.action === 'checkpoint' && j?.phase === 'restoring' && !restoringDelivery) {
      restoringDelivery = true;
      await live.clients.E2EPriest.run(`send_item('${merchant}',10,1).then(()=>true)`);
      await expect.poll(async () => (await live.clients[merchant].snapshot()).items[j.from]?.q).toBe(4);
      checkpoints.push({ phase: 'restoring', journal: j, inventory: await economy(live) });
    }
    await route.continue();
  });
  try {
    const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
    await expect.poll(() => restoringDelivery, { timeout: 150_000 }).toBe(true);
    await expect.poll(async () => ![(await live.state()).merchantCurrent, ...(await live.state()).merchantQueue]
      .some((job:any)=>job?.id===order.jobId||job?.commerceOrderId===order.jobId),{timeout:90_000}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async () => ![(await live.state()).merchantCurrent, ...(await live.state()).merchantQueue]
      .some((job: any) => job?.commerceOrderId === order.jobId), { timeout: 90_000 }).toBe(true);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'seashell') - quantity(before.characters[merchant].items, 'seashell')).toBe(4);
    expect(after.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1)).toHaveLength(1);
    expect(await live.clients[merchant].run(`localStorage.getItem('party-lucky-upgrade:'+character.name)`)).toBeNull();
    await restartAndObserve(live);
    expect(quantity((await economy(live)).characters[merchant].items, 'seashell')).toBe(4);
    await record(live, info, 'lucky-party-delivery-restart', before, { order, checkpoints, after });
  } finally { await context.unroute('**/merchant/production'); }
});

test('merchant mass skills use both tiers and passive recovery restores critical HP and MP during work', async ({ live }, info) => {
  // Native CI observed four completed bank/NPC jobs taking 324 seconds and
  // companion reconnection taking 128 seconds. Budget the final job separately;
  // keep the 20-second recovery assertion and ordinary job deadlines intact.
  test.setTimeout(900_000);
  // Failure modes: commerce omits production buffs; ++ crosses the MP reserve;
  // exchange waits forever on a legacy skill promise; busy work fences recovery;
  // missing potions prevent free recovery or overlapping pulses consume twice.
  await catalog(live, 'helmet');
  await seed(live, { 10: { name: 'armorbox', q: 2 } });
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  await live.clients[merchant].run(`(()=>{
    globalThis.__e2eMerchantSkills=[];const native=use_skill;
    use_skill=function(skill,...args){globalThis.__e2eMerchantSkills.push({skill,mp:character.mp,maxMp:character.max_mp,hp:character.hp});return native(skill,...args)};
    return true;
  })()`);
  const before = await economy(live);
  const high = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
  await jobFinished(live, high.jobId);
  await jobFinished(live, (await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] })).jobId);
  const highSkills = await live.clients[merchant].run('globalThis.__e2eMerchantSkills');
  expect(highSkills.some((entry: any) => entry.skill === 'massproductionpp')).toBe(true);
  expect(highSkills.some((entry: any) => entry.skill === 'massexchangepp')).toBe(true);

  // Hold only the independent recovery pulse to exercise native low-MP input.
  // Reconnecting below reinstalls the actual production timer.
  await live.clients[merchant].run('clearInterval(globalThis.__partyPassiveRegenTimer);globalThis.partyRoleRunner.stop();true');
  async function lowMana() {
    const pool = await live.admin(`output=(()=>{const p=get_player('${merchant}');p.mp=Math.max(40,Math.floor(p.max_mp*.2)-150);resend(p,'reopen+cid');return p.mp})()`);
    await expect.poll(async () => (await live.clients[merchant].snapshot()).mp).toBeLessThanOrEqual(pool + 50);
  }
  await lowMana();
  const low = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
  await jobFinished(live, low.jobId);
  await lowMana();
  await jobFinished(live, (await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] })).jobId);
  const skills = await live.clients[merchant].run('globalThis.__e2eMerchantSkills');
  expect(skills.some((entry: any) => entry.skill === 'massproduction')).toBe(true);
  expect(skills.some((entry: any) => entry.skill === 'massexchange')).toBe(true);
  for (const entry of skills.filter((entry: any) => ['massproductionpp', 'massexchangepp'].includes(entry.skill)))
    expect(entry.mp - 200).toBeGreaterThanOrEqual(entry.maxMp * .2);

  await live.reconnectClient(merchant);
  const context = live.clients[merchant].page.context();
  let hold = true;
  await context.route('**/merchant/checkpoint', async route => {
    if (hold && route.request().postDataJSON().state?.pendingUpgrade) await waitForGameplay(2000);
    await route.continue();
  });
  const recovery = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 2, level: 1 }], crafts: [] });
  await expect.poll(async () => (await live.state()).merchantCurrent?.id).toBe(recovery.jobId);
  const depleted = await live.admin(`output=(()=>{const p=get_player('${merchant}');p.hp=Math.floor(p.max_hp*.2)-100;p.mp=Math.floor(p.max_mp*.1);cache_player_items(p);resend(p,'reopen+cid');return {hp:p.hp,mp:p.mp,potions:p.items.filter(i=>i&&['hpot1','mpot1'].includes(i.name))}})()`);
  await expect.poll(async () => {
    const p = await live.clients[merchant].snapshot();
    return p.hp > depleted.hp && p.mp > depleted.mp && depleted.potions.every((item: any) =>
      (p.items.find((liveItem: any) => liveItem?.name === item.name)?.q || 0) < item.q);
  }, { timeout: 20_000, message: 'Production must not block native HP/MP potion recovery' }).toBe(true);
  hold = false;
  await context.unroute('**/merchant/checkpoint');
  // CI failure inventory: this batch's second native upgrade succeeded at
  // 183.9 seconds, after the previous 180-second poll; final evidence confirms
  // completed inventory and an empty queue. Budget actual bank/NPC procurement
  // separately without relaxing the 20-second HP/MP recovery assertion above.
  await jobFinished(live, recovery.jobId, 240_000);
  await record(live, info, 'merchant-mass-skills-and-recovery', before, { highSkills, skills, depleted });
});

test('upgrade purchase batch excludes an existing target-level coat', async ({ live }, info) => {
  test.setTimeout(360_000);
  // Failure modes: existing results reduce a new order, command dispatch drops
  // the batch setting, or purchase sizing includes nonzero-level inventory.
  await catalog(live, 'coat');
  await seed(live, { 30: { name: 'coat', level: 5 } });
  await live.post('/config', { buyUpgradeBatchSize: 10 });
  const before = await economy(live);
  const nativePage = live.clients[merchant].page;
  const checkpoints: any[] = [];
  let purchased: Economy | undefined;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await nativePage.route('**/party-api/merchant/checkpoint', async route => {
    const body = route.request().postDataJSON();
    if (checkpoints.length < 64) checkpoints.push({at:Date.now(),commandId:body.commandId,
      sequence:body.state?.sequence,pendingUpgrade:body.state?.pendingUpgrade,
      spent:body.state?.spent,frame:route.request().frame().url()});
    if (!purchased && body.state?.pendingUpgrade) {
      purchased = await economy(live);
      if (checkpoints.length < 64) checkpoints.push({at:Date.now(),snapshotCaptured:true});
      await gate;
    }
    await route.continue();
  });
  try {
    const order = await live.post('/merchant/order', { buys: [{ id: 'coat', quantity: 4, level: 5 }], crafts: [] });
    await expect.poll(() => purchased, { timeout: 240_000 }).toBeDefined();
    const coats = purchased!.characters[merchant].items.filter(item => item?.name === 'coat');
    expect(coats.filter(item => (item!.level || 0) === 0)).toHaveLength(10);
    expect(coats.filter(item => item!.level === 5)).toHaveLength(1);
    await record(live, info, 'upgrade-batch-existing-target-coat', before, { order, purchased });
  } finally {
    release!();
    await nativePage.unrouteAll({behavior:'wait'});
    await info.attach('native-coat-checkpoint-capture',{body:JSON.stringify({checkpoints,purchased,state:await live.state()}),contentType:'application/json'});
  }
});

test('buy with upgrade target survives lucky restoration failure and missing client journals across restart', async ({ live }, info) => {
  test.setTimeout(720_000);
  // Failure inventory: restore errors drop the order; a lost local receipt
  // holds all work; replay duplicates purchases/results or resets spend/attempts.
  // A completed older local journal must not fence a newer mirrored receipt.
  let completedJournal: Record<string, unknown> | undefined;
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  const context = live.clients[merchant].page.context();
  await live.clients[merchant].run(`(()=>{
    const nativeSwap=swap;globalThis.__e2eLuckyRestoreFault=false;globalThis.__e2eLuckyRestores=0;
    swap=function(a,b){const j=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
      if(j?.phase==='restoring'&&!globalThis.__e2eLuckyRestoreFault&&++globalThis.__e2eLuckyRestores===2){globalThis.__e2eLuckyRestoreFault=true;throw Error('Injected lost lucky restoration swap');}
      return nativeSwap(a,b);};return true;
  })()`);
  // Best-effort swapback does not hold production recovery. Observe only the
  // actual checkpoint packet; never delay its route while reading a CODE frame.
  const checkpointObserved=async(route:import('@playwright/test').Route)=>{
    const body=route.request().postDataJSON();
    if(body.character===merchant&&body.action==='checkpoint'&&body.id===body.journal?.id&&body.journal?.phase==='complete')completedJournal=body.journal;
    await route.continue();
  };
  await context.route('**/merchant/production',checkpointObserved);
  const before = await economy(live);
  const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 2, level: 1 }], crafts: [] });
  await expect.poll(() => live.clients[merchant].run('!!globalThis.__e2eLuckyRestoreFault'), { timeout: 300_000 }).toBe(true);
  await expect.poll(async () => {
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===order.jobId||job?.commerceOrderId===order.jobId);
  },{timeout:180_000,message:'Best-effort swapback must preserve real results without failing completed commerce'}).toBe(true);
  const held = await live.state();
  expect(completedJournal).toBeDefined();
  await live.clients[merchant].run(`(()=>{localStorage.setItem('party-production:'+character.name,${JSON.stringify(JSON.stringify({...completedJournal, phase: 'running'}))});localStorage.removeItem('party-lucky-upgrade:'+character.name);localStorage.removeItem('party-commerce:${order.jobId}');return true})()`);
  await live.restartCoordinator();
  await expect.poll(async () => {
    const state = await live.state();
    return ![state.merchantCurrent, ...state.merchantQueue].some((job: any) => job?.commerceOrderId === order.jobId);
  }, { timeout: 180_000, message: 'Mirrored receipt recovery must restore inventory and finish the original order' }).toBe(true);
  const after = await economy(live);
  const results = (value: Economy) => value.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1).length;
  expect(results(after) - results(before)).toBe(2);
  // Reconciliation runs before subsequent production; idle has no production
  // mutation to execute merely because this old local receipt was restored.
  await catalog(live,'shoes');
  const upgradedShoes=(value:Economy)=>value.characters[merchant].items.filter(item=>item?.name==='shoes'&&item.level===1).length;
  const shoesBefore=upgradedShoes(await economy(live));
  const followup=await live.post('/merchant/order',{buys:[{id:'shoes',quantity:1,level:1}],crafts:[]});
  await expect.poll(async()=>{
    const state=await live.state();return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===followup.jobId||job?.commerceOrderId===followup.jobId);
  },{timeout:180_000}).toBe(true);
  expect(upgradedShoes(await economy(live))-shoesBefore).toBe(1);
  await expect.poll(() => live.clients[merchant].run(`localStorage.getItem('party-production:'+character.name)`)).toBeNull();
  await context.unroute('**/merchant/production',checkpointObserved);
  await restartAndObserve(live);
  expect(results(await economy(live))).toBe(results(after));
  await record(live, info, 'buy-upgrade-lucky-journal-recovery', before, { order, held, after, followup });
});
type Economy = {
  characters: Record<string, { map: string; gold: number; isize: number; items: Items; upgrading: boolean }>;
  bank: Record<string, Items>;
  savedBank: Record<string, Items>;
  bankGold: number;
};
const quantity = (items: Items, id: string) => items.reduce((total, item) => total + (item?.name === id ? Number(item.q) || 1 : 0), 0);
const bankQuantity = (state: Economy, id: string) => Object.values(state.bank).reduce((total, items) => total + quantity(items, id), 0);
const totalGold = (state: Economy) => state.bankGold + Object.values(state.characters).reduce((total, character) => total + character.gold, 0);

async function economy(live: LiveGame): Promise<Economy> {
  // A mounted bank is authoritative in server memory until native unmount saves it.
  // Reading only MongoDB during a bank visit would mistake normal persistence lag for loss.
  let observed:Economy|null=null;
  await expect.poll(async()=>{
    observed=await live.admin(`output=(async()=>{
    const m=get_player(${JSON.stringify(merchant)});
    if(!m || ${JSON.stringify(names)}.some(name=>!get_player(name)))return null;
    const user=await db.collection('user').findOne({_id:m.owner});
    const mounted=Object.values(players).find(p=>p.owner===m.owner&&p.user);
    const bank=mounted?mounted.user:user.info;
    const packs=value=>Object.fromEntries(Object.entries(value).filter(([key,items])=>/^items[0-9]+$/.test(key)&&Array.isArray(items)));
    return {characters:Object.fromEntries(${JSON.stringify(names)}.map(name=>{
      const p=get_player(name);return [name,{map:p.map,gold:p.gold,isize:p.isize,items:p.items,upgrading:!!p.q.upgrade}];
    })),bank:packs(bank),savedBank:packs(user.info),bankGold:Number(bank.gold)||0};
  })()`);
    return !!observed;
  },{timeout:30_000,message:'All native account characters must be present for an authoritative economy sample'}).toBe(true);
  return observed!;
}

async function record(live: LiveGame, info: TestInfo, name: string, before: Economy, details: unknown = {}) {
  await info.attach(name, { body: JSON.stringify({ before, after: await economy(live), details, coordinator: await live.state() }, null, 2), contentType: 'application/json' });
}

async function seed(live: LiveGame, items: Record<number, Item>) {
  await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(merchant)}),items=${JSON.stringify(items)};
    for(const slot of Object.keys(items)){if(p.items[slot])throw Error('Seed would overwrite occupied slot '+slot);p.items[slot]=items[slot];}
    cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');return p.items;
  })()`);
  await expect.poll(async () => {
    const current = await live.clients[merchant].snapshot();
    const state = await live.state();
    return Object.entries(items).every(([slot, item]) => current.items[Number(slot)]?.name === item.name &&
      state.characters[merchant]?.items?.some((entry: { slot: number; item: Item } | null) => entry?.slot === Number(slot) && entry.item?.name === item.name));
  }, { timeout: 30_000, message: 'Native client and coordinator must observe initial inventory before commands' }).toBe(true);
}

async function catalog(live: LiveGame, id: string) {
  await expect.poll(async () => (await live.state(true)).merchantCatalog?.buyable?.some((item: { id: string }) => item.id === id),
    { timeout: 120_000, message: `Native merchant must publish the ${id} NPC catalog entry` }).toBe(true);
}

async function jobFinished(live: LiveGame, id?: string, timeout = 150_000) {
  await expect.poll(async () => {
    const state = await live.state();
    const jobs = [state.merchantCurrent, ...(state.merchantQueue || [])].filter(Boolean);
    return id ? !jobs.some(job => job.id === id || job.commerceOrderId === id) : jobs.length === 0;
  }, { timeout, message: 'Requested merchant work must leave both active and queued state' }).toBe(true);
}

async function restartAndObserve(live: LiveGame) {
  const startedAt = Date.now();
  await live.restartCoordinator();
  await expect.poll(async () => (await live.state()).characters[merchant]?.seenAt,
    { timeout: 30_000, message: 'Replay assertions require a native heartbeat accepted after restart' }).toBeGreaterThan(startedAt);
  await jobFinished(live);
}

async function leaveBank(live: LiveGame) {
  await live.post('/command', { character: merchant, type: 'character-travel', location: { map: 'main', x: 0, y: 0 } });
  await expect.poll(async () => (await economy(live)).characters[merchant].map,
    { timeout: 90_000, message: 'Native exit must unmount and save the shared bank' }).toBe('main');
}

test.describe('real merchant economy and durable work', () => {
  test.setTimeout(420_000);

  test('native exchanges bank default rewards, chain marked boxes and sell rewards across restart', async ({ live }, info) => {
    test.setTimeout(720_000);
    // Failure modes: rewards bypass merchant rules; nested boxes are banked;
    // marks expire after one batch; later stock is not exchanged after restart;
    // locked stock is counted; no-rule rewards are stranded in inventory.
    await expect.poll(async () => (await live.state(true)).merchantCatalog?.exchangeable?.some((entry: { id: string }) => entry.id === 'armorbox'),
      { timeout: 120_000 }).toBe(true);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'automatic exchange': false, 'auto npc sales': true } });
    await seed(live, { 10: { name: 'armorbox', q: 1 } });
    const before = await economy(live);
    const choices = (await live.state(true)).merchantCatalog.exchangeable;
    const rewardIds = [...new Set<string>(choices.filter((entry: { id: string }) => ['armorbox', 'weaponbox', 'gem0'].includes(entry.id))
      .flatMap((entry: { results: { id: string; kind: string }[] }) => entry.results.filter(result => result.id === result.kind && !['gold', 'shells', 'empty'].includes(result.kind)).map(result => result.id)))];
    const checkpoints: unknown[] = [];
    live.clients[merchant].page.on('response', async response => {
      if (!new URL(response.url()).pathname.endsWith('/exchange-progress')) return;
      try { checkpoints.push({ request: response.request().postDataJSON(), status: response.status(), response: await response.json() }); } catch { /* Closing client. */ }
    });
    const fallback = await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] });
    await live.post('/merchant/force-stand', { enabled: false });
    await jobFinished(live, fallback.jobId);
    const defaultBanked = await economy(live);
    expect(rewardIds.reduce((sum, id) => sum + bankQuantity(defaultBanked, id) - bankQuantity(before, id), 0)).toBe(1);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'automatic exchange': true } });
    for (const id of rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)))
      await live.post('/merchant/auto-npc-sale', { item: { name: id, level: 0 } });
    for (const id of ['gem0', 'armorbox', 'weaponbox'])
      await live.post('/command', { character: merchant, type: 'auto-exchange', slot: -1, item: { name: id, level: 0 } });
    await seed(live, { 10: { name: 'gem0', q: 15 }, 11: { name: 'armorbox', q: 2 }, 12: { name: 'weaponbox', q: 2 }, 13: { name: 'armorbox', q: 1, l: 'l' } });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => {
      const observed = await economy(live);
      return quantity(observed.characters[merchant].items, 'gem0') === 0 &&
        quantity(observed.characters[merchant].items, 'armorbox') === 1 && quantity(observed.characters[merchant].items, 'weaponbox') === 0 &&
        rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)).every(id => quantity(observed.characters[merchant].items, id) === 0);
    }, { timeout: 420_000, message: 'Native marked stock and exchange rewards must finish their selected actions' }).toBe(true);
    const firstBatch = await economy(live);
    expect(firstBatch.characters[merchant].items.find(item => item?.name === 'armorbox')).toMatchObject({ l: 'l', q: 1 });
    expect(bankQuantity(firstBatch, 'armorbox')).toBe(0);
    expect(bankQuantity(firstBatch, 'weaponbox')).toBe(0);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.restartCoordinator();
    await expect.poll(async () => Object.keys((await live.state()).autoExchanges || {}).sort()).toEqual(['armorbox@0', 'gem0@0', 'weaponbox@0']);
    await seed(live, { 10: { name: 'armorbox', q: 1 } });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => {
      const observed = await economy(live);
      return quantity(observed.characters[merchant].items, 'armorbox') === 1 &&
        rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)).every(id => quantity(observed.characters[merchant].items, id) === 0);
    }, { timeout: 150_000 }).toBe(true);
    await record(live, info, 'native-exchange-actions-and-restart', before, { defaultBanked, firstBatch, rewardIds, checkpoints });
    await info.attach('native-exchange-reward-events', { body: JSON.stringify(await live.clients[merchant].events()), contentType: 'application/json' });
  });

  for (const retained of [false, true]) {
    test(`failed delivery equip reconciles ${retained ? 'retained merchant stock' : 'missing stock'} across restart`, async ({ live }, info) => {
      // Failure modes: an orphan loops forever; retained stock is discarded; stale
      // inventory removes intent; recovery replays after restart or duplicates cargo.
      const recipient = 'E2EWarrior';
      const item = { name: 'helmet', level: 0 };
      const id = 'interrupted-delivery-equip';
      let holdInventory = false, withheldReports = 0;
      const context = live.clients[recipient].page.context();
      await context.route('**/party-api/status', async route => {
        const body = route.request().postDataJSON();
        if (holdInventory && body.name === merchant && Array.isArray(body.items)) {
          withheldReports++;
          return route.abort('connectionfailed');
        }
        return route.fallback();
      });
      const receipts: { character: string; results: { deliveryId?: string; success: boolean; error?: string }[] }[] = [];
      live.clients[recipient].page.on('request', request => {
        if (new URL(request.url()).pathname.endsWith('/equip-delivery-complete')) {
          const receipt = request.postDataJSON();
          receipts.push(receipt);
          if (receipt.results.some((result: { success: boolean }) => !result.success)) holdInventory = true;
        }
      });
      await live.post('/merchant/force-stand', { enabled: true });
      if (retained) await seed(live, { 10: item });
      const before = await economy(live);
      const cargo = () => live.admin(`output=${JSON.stringify(names)}.map(name=>{
        const p=get_player(name);return {name,items:p.items,slots:p.slots};
      })`);
      const countCargo = (players: { items: Items; slots: Record<string, Item | null> }[]) => players.reduce((sum, p) =>
        sum + [...p.items, ...Object.values(p.slots)].filter(value => value?.name === item.name && value.level === item.level).length, 0);
      expect(countCargo(await cargo())).toBe(retained ? 1 : 0);
      // Declare the interrupted historical intent only. Native clients perform the
      // actual failed equip, subsequent transfer and equip; no receipts are fabricated.
      // Arm ingress before replacing the coordinator: an already-dispatched
      // browser report must not cross the intended missing-inventory boundary.
      holdInventory = true;
      live.holdMerchantStatus(true, {inventoryOnly:true});
      await live.restoreHistoricalSettings(() => ({ merchantDeliveries: {
        [recipient]: [{ id, item, slot: 10, equipOnDelivery: true, awaitingEquip: true }],
      } }));
      await expect.poll(() => receipts.some(receipt => receipt.character === recipient &&
        receipt.results.some(result => result.deliveryId === id && !result.success)),
      { timeout: 45_000, message: 'Native recipient must fail to equip the absent delivery' }).toBe(true);
      await expect.poll(async () => (await live.state()).merchantDeliveries?.[recipient]?.[0]?.equipFailedAt).toBeGreaterThan(0);
      await waitForGameplay(12_000);
      expect(withheldReports).toBeGreaterThan(0);
      expect((await live.state()).merchantDeliveries[recipient]).toMatchObject([{ id, awaitingEquip: true }]);
      await live.restartCoordinator();
      expect((await live.state()).merchantDeliveries[recipient]).toMatchObject([{ id, awaitingEquip: true }]);
      live.holdMerchantStatus(false, {inventoryOnly:true});
      holdInventory = false;
      await expect.poll(async () => {
        const marks = (await live.state()).merchantDeliveries?.[recipient] || [];
        return retained ? marks.length === 1 && !marks[0].awaitingEquip && marks[0].id !== id : marks.length === 0;
      }, { timeout: 20_000, message: 'Failed equip must reconcile against merchant stock' }).toBe(true);
      await record(live, info, 'failed-equip-reconciled', before, { retained, receipts, cargo: await cargo() });
      await live.restartCoordinator();
      if (retained) {
        await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { deliveries: true } });
        await live.post('/merchant/force-stand', { enabled: false });
        await expect.poll(async () => (await cargo()).find((p: { name: string }) => p.name === recipient)?.slots.helmet,
          { timeout: 150_000, message: 'Retained cargo must be delivered and equipped by native clients' }).toMatchObject(item);
        await expect.poll(async () => (await live.state()).merchantDeliveries?.[recipient] || [], { timeout: 30_000 }).toEqual([]);
      }
      await restartAndObserve(live);
      const failures = receipts.filter(receipt => receipt.results.some(result => !result.success)).length;
      await waitForGameplay(35_000);
      expect(receipts.filter(receipt => receipt.results.some(result => !result.success)).length).toBe(failures);
      expect((await live.state()).merchantDeliveries?.[recipient] || []).toEqual([]);
      expect(countCargo(await cargo())).toBe(retained ? 1 : 0);
      await info.attach('failed-equip-native-screen', { body: await live.clients[recipient].page.screenshot(), contentType: 'image/png' });
      await record(live, info, 'failed-equip-no-replay', before, { retained, withheldReports, receipts, cargo: await cargo() });
    });
  }

  test('duplicate queued NPC buys execute once and remain complete after coordinator restart', async ({ live }, info) => {
    await catalog(live, 'helmet');
    await live.post('/merchant/force-stand', { enabled: true });
    const before = await economy(live);
    const price = await live.admin("output=G.items.helmet.g");
    const order = { buys: [{ id: 'helmet', quantity: 3 }], crafts: [] };
    const accepted = await live.post('/merchant/order', order);
    const duplicate = await live.post('/merchant/order', order);
    expect(duplicate).toMatchObject({ duplicate: true, jobId: accepted.jobId });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'helmet'),
      { timeout: 150_000 }).toBe(quantity(before.characters[merchant].items, 'helmet') + 3);
    await jobFinished(live, accepted.jobId);
    expect(totalGold(await economy(live))).toBe(totalGold(before) - 3 * price);
    await restartAndObserve(live);
    expect(quantity((await economy(live)).characters[merchant].items, 'helmet')).toBe(quantity(before.characters[merchant].items, 'helmet') + 3);
    expect(totalGold(await economy(live))).toBe(totalGold(before) - 3 * price);
    await record(live, info, 'npc-buy-once', before, { price, accepted, duplicate });
  });

  test('NPC partial sale credits actual gold and preserves the unsold stack after restart', async ({ live }, info) => {
    await seed(live, { 10: { name: 'leather', q: 10 } });
    const before = await economy(live);
    const value = await live.admin("output=calculate_item_value({name:'leather',q:10})");
    const accepted = await live.post('/merchant/npc-sale', { source: 'merchant', slot: 10, item: { name: 'leather' }, quantity: 7 });
    await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'leather'),
      { timeout: 150_000 }).toBe(3);
    await jobFinished(live);
    expect(totalGold(await economy(live))).toBe(totalGold(before) + 7 * value);
    await expect.poll(async () => (await live.state()).npcSaleMarks?.some((mark: { id: string }) => mark.id === accepted.mark.id)).toBe(false);
    await restartAndObserve(live);
    expect(quantity((await economy(live)).characters[merchant].items, 'leather')).toBe(3);
    expect(totalGold(await economy(live))).toBe(totalGold(before) + 7 * value);
    await record(live, info, 'partial-npc-sale', before, { unitValue: value, accepted });
  });

  test('marked bank deposit and requested withdrawal conserve a real stack across restart', async ({ live }, info) => {
    // Withdrawal marks must recall the merchant without a separate bank command,
    // consume only confirmed stock, and never replay after restart.
    await seed(live, { 10: { name: 'leather', q: 13 } });
    const before = await economy(live);
    const total = quantity(before.characters[merchant].items, 'leather') + bankQuantity(before, 'leather');
    await live.post('/command', { character: merchant, type: 'mark', slot: 10, item: { name: 'leather', q: 13 } });
    await live.post('/command', { character: merchant, type: 'bank' });
    await expect.poll(async () => {
      const state = await economy(live);
      return quantity(state.characters[merchant].items, 'leather') === 0 && bankQuantity(state, 'leather') === total;
    }, { timeout: 150_000 }).toBe(true);
    await jobFinished(live);
    await leaveBank(live);
    await expect.poll(async () => Object.values((await economy(live)).savedBank).reduce((sum, items) => sum + quantity(items, 'leather'), 0),
      { timeout: 60_000, message: 'The actual bank unmount must persist the deposited stack' }).toBe(total);
    await record(live, info, 'bank-deposit-persisted', before);
    await restartAndObserve(live);
    const bank = await economy(live);
    const [pack, contents] = Object.entries(bank.bank).find(([, items]) => quantity(items, 'leather') > 0)!;
    const slot = contents.findIndex(item => item?.name === 'leather');
    expect(slot).toBeGreaterThanOrEqual(0);
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { withdrawals: false } });
    await live.post('/command', { character: merchant, type: 'withdraw', pack, slot, item: contents[slot] });
    await live.restartCoordinator();
    const disabledAt = Date.now();
    await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt,
      {timeout:30_000,message:'Observe repeated native scheduling while withdrawals are disabled'}).toBeGreaterThan(disabledAt + 5000);
    const deferred = await live.state();
    expect(deferred.merchantAutomations.withdrawals).toBe(false);
    expect(deferred.withdrawals[merchant]).toHaveLength(1);
    expect([deferred.merchantCurrent, ...deferred.merchantQueue].filter(Boolean).some(job => job.reason === 'withdrawals')).toBe(false);
    expect(bankQuantity(await economy(live), 'leather')).toBe(total);
    await record(live, info, 'marked-withdrawal-disabled', before, {pack,slot});
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { withdrawals: true } });
    await expect.poll(async () => {
      const state = await economy(live);
      return quantity(state.characters[merchant].items, 'leather') === total && bankQuantity(state, 'leather') === 0;
    }, { timeout: 150_000 }).toBe(true);
    await jobFinished(live);
    await leaveBank(live);
    await restartAndObserve(live);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'leather') + bankQuantity(after, 'leather')).toBe(total);
    expect(quantity(after.characters[merchant].items, 'leather')).toBe(total);
    expect(totalGold(after)).toBe(totalGold(before));
    await record(live, info, 'bank-round-trip', before, { pack, slot, total });
  });

  test('a cancelled queued purchase stays cancelled while a later real purchase completes', async ({ live }, info) => {
    await catalog(live, 'scroll0');
    await catalog(live, 'helmet');
    await live.post('/merchant/force-stand', { enabled: true });
    const before = await economy(live);
    const cancelled = await live.post('/merchant/order', { buys: [{ id: 'scroll0', quantity: 2 }], crafts: [] });
    await live.post('/merchant/job/cancel', { id: cancelled.jobId });
    await restartAndObserve(live);
    expect((await live.state()).merchantForceStand).toBe(true);
    await live.post('/merchant/force-stand', { enabled: false });
    await catalog(live, 'helmet');
    const later = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1 }], crafts: [] });
    await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'helmet'),
      { timeout: 150_000 }).toBe(quantity(before.characters[merchant].items, 'helmet') + 1);
    await jobFinished(live, later.jobId);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'scroll0')).toBe(quantity(before.characters[merchant].items, 'scroll0'));
    expect(totalGold(after)).toBe(totalGold(before) - await live.admin('output=G.items.helmet.g'));
    await record(live, info, 'cancelled-buy-not-replayed', before, { cancelled, later });
  });

  test('a manual upgrade consumes one real scroll and does not replay after restart', async ({ live }, info) => {
    await seed(live, { 10: { name: 'helmet', level: 0 }, 11: { name: 'scroll0', q: 10 } });
    const before = await economy(live);
    const requestedAt = Date.now();
    const observedUpgrade = async () => {
      const events = (await live.clients[merchant].events()).filter((event: any) => event.at >= requestedAt);
      const responses = events.flatMap((event: any) => event.event === 'game_response' ? [event.data] :
        event.event === 'player' ? (event.data?.hitchhikers || []).filter(([kind]: [string]) => kind === 'game_response').map(([, data]: [string, any]) => data) : []);
      // Maintained lucky-slot handling can move the marked item before upgrading.
      const pending = events.filter((event: any) => event.event === 'player').flatMap((event: any) =>
        (event.data?.items || []).map((item: any, slot: number) => ({ item, slot })))
        .find(({ item }: any) => item?.name === 'placeholder' && item.p?.name === 'helmet' && item.p?.scroll === 'scroll0');
      const final = responses.find((response: any) => pending && response?.num === pending.slot && response.level === 1 &&
        ['upgrade_success', 'upgrade_fail'].includes(response.response));
      return { final, chance: pending?.item.p.chance, slot: pending?.slot };
    };
    await live.post('/command', { character: merchant, type: 'upgrade-mark', slot: 10, item: { name: 'helmet', level: 0 }, tiers: 1 });
    await expect.poll(async () => {
      const state = await economy(live), character = state.characters[merchant];
      const helmet = character.items.find(item => item?.name === 'helmet');
      const observed = await observedUpgrade();
      return !character.upgrading && quantity(character.items, 'scroll0') === 9 &&
        (observed.final?.response === 'upgrade_success' ? helmet?.level === 1 :
          observed.final?.response === 'upgrade_fail' && Number.isFinite(observed.chance) && observed.chance < 1 && !helmet);
    }, { timeout: 150_000, message: 'A native final upgrade response must agree with authoritative inventory and one consumed scroll' }).toBe(true);
    await jobFinished(live);
    const completed = await economy(live);
    const observed = await observedUpgrade();
    expect(observed.final).toMatchObject({ num: observed.slot, level: 1 });
    expect(totalGold(completed)).toBe(totalGold(before));
    const outcome = completed.characters[merchant].items.filter(item => item?.name === 'helmet');
    await restartAndObserve(live);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'scroll0')).toBe(9);
    expect(after.characters[merchant].items.filter(item => item?.name === 'helmet')).toEqual(outcome);
    expect(totalGold(after)).toBe(totalGold(before));
    await record(live, info, 'single-native-upgrade', before, { completed, outcome, observed });
  });
});


test('native WTB withdraws bank funding and reconciles replaced offers after reopening', async ({live},info) => {
  test.setTimeout(420_000);
  // Failure modes: bank wealth is ignored; repeated reports enqueue duplicate
  // funding; a changed native identity permanently blocks the order; replacement
  // is counted as a purchase; reopening causes duplicate advertisements.
  await catalog(live,'hpot0');
  await expect.poll(async ()=>(await live.state(true)).merchantCatalog?.allItems?.some((entry:{id:string})=>entry.id==='leather'),{timeout:120_000}).toBe(true);
  await seed(live,{10:{name:'stand0'}});
  await live.post('/command',{character:merchant,type:'bank'});
  await jobFinished(live);
  await expect.poll(async ()=>(await live.state()).bank?.gold,{timeout:30_000}).toBeGreaterThan(1000000);
  const before=await economy(live);
  const price=before.characters[merchant].gold+10000;
  expect(before.bankGold).toBeGreaterThan(10000);
  await live.post('/merchant/bid',{itemId:'leather',price,quantity:3,minimumQuality:0,useStandSlot:true});
  await expect.poll(async ()=>{
    const current=await live.clients[merchant].snapshot();
    return Object.values(current.slots).some((item:any)=>item?.b && item.name==='leather' && item.price===price);
  },{timeout:180_000,message:'Merchant must withdraw native stand funding and advertise the order'}).toBe(true);
  await jobFinished(live);
  const funded=await economy(live);
  expect(funded.characters[merchant].gold).toBeGreaterThanOrEqual(price);
  expect(totalGold(funded)).toBe(totalGold(before));
  const ledger=(await live.state()).nativeStand;
  const offer=Object.values(ledger.offers).find((entry:any)=>entry.itemId==='leather') as {slot:string;rid:string;token:string};
  expect(offer).toBeTruthy();
  // Real game mutations, no synthesized acknowledgements or heartbeat state.
  await live.clients[merchant].run(`(async()=>{await unequip(${JSON.stringify(offer.slot)});await wishlist(${JSON.stringify(offer.slot)},'leather',${price},0,3);await close_stand();await open_stand();})()`);
  await expect.poll(async ()=>{
    const state=await live.state(), offers=Object.values(state.nativeStand.offers) as any[];
    return offers.some(entry=>entry.itemId==='leather' && entry.phase==='live' && entry.rid!==offer.rid && !entry.problem);
  },{timeout:45_000,message:'Reopened native identity must reconcile without an inferred purchase'}).toBe(true);
  const after=await live.state();
  expect(after.standBids.leather.quantity).toBe(3);
  expect(Object.values((await live.clients[merchant].snapshot()).slots).filter((item:any)=>item?.b && item.name==='leather')).toHaveLength(1);
  await record(live,info,'native-wtb-funding-and-reconciliation',before,{funded,originalOffer:offer,after});
  await info.attach('native-wtb-reopened-stand',{body:await live.clients[merchant].page.screenshot(),contentType:'image/png'});
});


test('native WTB retries an empty never-confirmed reservation after restart without counting a fill', async ({live},info) => {
  test.setTimeout(240_000);
  // Historical boundary: an empty stand slot and a persisted reservation with no
  // native identity. Failure modes: restart retains a permanent block; retry
  // decrements bid quantity; a retry places duplicate offers or spends gold.
  await catalog(live,'hpot0');
  await seed(live,{10:{name:'stand0'}});
  const before=await economy(live);
  await live.restoreHistoricalSettings(()=>({
    standBids:{leather:{price:1000,quantity:3,minimumQuality:0,useStandSlot:true,revision:1}},
    nativeStand:{sequence:1,offers:{'native-1':{token:'native-1',itemId:'leather',auto:false,slot:'trade1',revision:1,level:0,price:1000,quantity:3,acknowledged:0,phase:'blocked',problem:'Offer disappeared without a confirmed fill/removal; reconciliation required'}},problems:{}},
  }));
  await expect.poll(async ()=>Object.values((await live.state()).nativeStand.offers).some((offer:any)=>offer.itemId==='leather' && offer.phase==='live' && offer.rid && !offer.problem),{timeout:90_000}).toBe(true);
  const state=await live.state(), current=await live.clients[merchant].snapshot();
  expect(state.standBids.leather.quantity).toBe(3);
  expect(Object.values(current.slots).filter((item:any)=>item?.b && item.name==='leather')).toHaveLength(1);
  expect(totalGold(await economy(live))).toBe(totalGold(before));
  await record(live,info,'native-unconfirmed-wtb-recovered',before,{state,slots:current.slots});
  await info.attach('native-unconfirmed-wtb-recovered-stand',{body:await live.clients[merchant].page.screenshot(),contentType:'image/png'});
});


test('native Tracktrix stays in the final inventory slot through full-bag cleanout and merchant tidying', async ({ live, page }, info) => {
  test.setTimeout(240_000);
  // Failure modes: display name mistaken for native tracker ID; unmarked tracker
  // collected in a full bag; occupied final slot loses cargo; merchant tidy
  // repacks the tracker; restart loses protection or item conservation.
  await live.post('/merchant/force-stand', { enabled: true });
  const initial = await economy(live);
  const seeded = await live.admin(`output=(()=>{
    const w=get_player('E2EWarrior'),m=get_player('E2EMerchant');
    if(w.items[10]||m.items[10]||m.items[11])throw Error('Tracker seed slots occupied');
    w.items[42]={name:'tracker'};m.items[43]={name:'tracker'};m.items[11]={name:'stand0'};
    for(let i=0;i<w.isize;i++)if(!w.items[i])w.items[i]={name:'feather0',q:1};
    for(const p of [w,m]){cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');}
    return {warrior:w.items,merchant:m.items};
  })()`);
  await expect.poll(async () => {
    const current=await economy(live);
    return ['E2EWarrior',merchant].every(name=>current.characters[name].items[current.characters[name].isize-1]?.name==='tracker');
  }, {timeout:30_000}).toBe(true);
  const before=await economy(live);
  expect(quantity(before.characters.E2EWarrior.items,'tracker')).toBe(1);
  expect(before.characters.E2EWarrior.items.filter(Boolean)).toHaveLength(43);
  expect(quantity(before.characters.E2EWarrior.items,'feather0')).toBe(quantity(seeded.warrior,'feather0'));
  await live.post('/merchant/force-stand', { enabled: false });
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'inventory cleanout': true } });
  await live.post('/merchant/cleanout', { character:'E2EWarrior' });
  await expect.poll(async () => quantity((await economy(live)).characters.E2EWarrior.items,'feather0'),
    {timeout:150_000}).toBeLessThan(quantity(before.characters.E2EWarrior.items,'feather0'));
  await jobFinished(live);
  await restartAndObserve(live);
  const after=await economy(live);
  for(const name of ['E2EWarrior',merchant]) {
    expect(after.characters[name].items[after.characters[name].isize-1]?.name).toBe('tracker');
    expect(quantity(after.characters[name].items,'tracker')).toBe(1);
  }
  const totalFeathers=(value:Economy)=>bankQuantity(value,'feather0')+Object.values(value.characters).reduce((sum,c)=>sum+quantity(c.items,'feather0'),0);
  expect(totalFeathers(after)).toBe(totalFeathers(before));
  await record(live,info,'tracktrix-full-bag-cleanout-retained',before,{initial,seeded});
  await info.attach('tracktrix-final-native-inventory',{body:await live.clients.E2EWarrior.page.screenshot(),contentType:'image/png'});
  const navigationStartedAt=Date.now(),navigation:any[]=[];
  const observe=(kind:string,value:any)=>{
    const request=kind==='response'?value.request():value,url=new URL(request.url());
    if(!['http:','https:'].includes(url.protocol))return;
    navigation.push({at:Date.now(),kind,path:url.pathname.slice(0,256),section:url.searchParams.get('section'),resource:request.resourceType(),
      ...(kind==='response'?{status:value.status()}:{})});
    if(navigation.length>32)navigation.splice(8,1);
  };
  const requested=(request:any)=>observe('request',request),responded=(response:any)=>observe('response',response),finished=(request:any)=>observe('finished',request);
  page.on('request',requested);page.on('response',responded);page.on('requestfinished',finished);
  let headingReadyAt:number|undefined,inventoryReadyAt:number|undefined;
  try{
    await page.goto(live.url);
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'E2EWarrior',exact:true})});
    await expect(card.getByRole('heading',{name:'E2EWarrior',exact:true})).toBeVisible();
    headingReadyAt=Date.now();
    const inventory=card.getByRole('button',{name:/^Inventory/});
    await expect(inventory).toBeVisible();
    inventoryReadyAt=Date.now();
    if(await inventory.getAttribute('aria-expanded')==='false') await inventory.click();
    const tracker=card.getByLabel(/^(Tracktrix|tracker)$/);
    await expect(tracker).toBeVisible();
    await tracker.scrollIntoViewIfNeeded();
    await info.attach('tracktrix-final-console-inventory',{body:await page.screenshot(),contentType:'image/png'});
  }finally{
    page.off('request',requested);page.off('response',responded);page.off('requestfinished',finished);
    await info.attach('tracktrix-console-first-document-readiness',{body:JSON.stringify({navigationStartedAt,headingReadyAt,inventoryReadyAt,navigation}),contentType:'application/json'});
    await info.attach('tracktrix-console-readiness-final',{body:await page.screenshot(),contentType:'image/png'});
  }
});

for (const kind of ['upgrade', 'compound']) test(`auto merchant collects twelve native copies alongside a finite ${kind} rule`, async ({live},info) => {
  test.setTimeout(kind==='upgrade'?450_000:300_000);
  // Declared initial rules reproduce coexisting persisted preferences. Native
  // clients must transfer all copies even though only one result is requested.
  const name=kind==='upgrade'?'helmet':'ringsj', owner='E2EWarrior';
  const admission:any[]=[],handoffs:any[]=[],handoffResponses:Promise<void>[]=[];
  const observeHandoff=(request:any)=>{
    const route=new URL(request.url()).pathname;
    if(!['/party-api/merchant/handoff','/party-api/merchant/handoff-complete'].includes(route))return;
    handoffs.push({at:Date.now(),wallAt:nativeWallNow(),route,body:request.postDataJSON()});
    if(handoffs.length>32)handoffs.splice(1,1);
  };
  const observeHandoffResponse=(response:any)=>{
    const route=new URL(response.url()).pathname;
    if(!['/party-api/merchant/handoff','/party-api/merchant/handoff-complete'].includes(route))return;
    handoffResponses.push((async()=>{
      const body=await response.json().catch((error:unknown)=>({captureError:String(error)}));
      handoffs.push({at:Date.now(),wallAt:nativeWallNow(),route,status:response.status(),response:body});
      if(handoffs.length>32)handoffs.splice(1,1);
    })());
  };
  live.clients[merchant].page.on('request',observeHandoff);
  live.clients[merchant].page.on('response',observeHandoffResponse);
  await catalog(live,'helmet'); // Catalog readiness; ringsj is loot-only stock.
  if(kind==='compound') await live.clients[merchant].run(`(()=>{
    globalThis.__e2eCompoundOutcomes=[];
    // Failure inventory: the native promise resolves before its final player
    // inventory arrives; a placeholder is journaled as failure and the finite
    // quota is never consumed. Delay only this operation's terminal inventory,
    // preserving the real response, items and order of subsequent player frames.
    const socket=parent.socket,onevent=socket.onevent,pending=[];
    const fault=globalThis.__e2eCompoundPublication={heldAt:null,releasedAt:null,frames:0};
    let timer;
    fault.release=()=>{if(fault.releasedAt!==null)return;clearTimeout(timer);fault.releasedAt=Date.now();for(const packet of pending.splice(0))onevent.call(socket,packet);};
    socket.onevent=function(packet){
      const [event,data]=packet.data||[];
      if(event==='player'&&fault.releasedAt===null){
        if(fault.heldAt===null&&Array.isArray(data?.items)&&!data.q?.compound&&data.items.some(item=>item?.name==='ringsj'&&item.level===1)){
          fault.heldAt=Date.now();timer=setTimeout(fault.release,750);
        }
        if(fault.heldAt!==null){pending.push(packet);fault.frames++;return;}
      }
      return onevent.call(socket,packet);
    };
    fault.restore=()=>{fault.release();socket.onevent=onevent;};
    parent.socket.on('game_response',data=>{
      const response=typeof data==='string'?data:data&&data.response;
      if(response==='compound_success'||response==='compound_fail')
        globalThis.__e2eCompoundOutcomes.push({at:Date.now(),response,data});
    });return true;
  })()`);
  try {
  await live.post('/config',{itemCollectionThreshold:10});
  await live.admin(`output=(()=>{const p=get_player('${owner}');for(let i=0;i<12;i++)p.items[20+i]={name:'${name}',level:0};cache_player_items(p);resend(p,'reopen+cid');return p.items.slice(20,32)})()`);
  await expect.poll(async()=>(await live.clients[owner].snapshot()).items.filter((i:Item|null)=>i?.name===name).length).toBe(12);
  await live.restoreHistoricalSettings(()=>({autoItemMarks:{[merchant]:{[name+'@+0']:'merchant'}},
    autoUpgradeMarks:kind==='upgrade'?{[merchant]:{[name+'@+0']:{tiers:1,quantity:1}}}:{},
    autoCompounds:kind==='compound'?{[merchant]:[{name,targetTier:1,quantity:1}]}:{}}));
  await expect.poll(async()=>(await live.state()).autoItemMarks?.[merchant]?.[name+'@+0']).toBe('merchant');
  await expect.poll(async()=>{
    const state=await live.state();
    const slots=(state.characters[owner]?.items||[]).filter((entry:any)=>entry?.item?.name===name&&entry.item.level===0).map((entry:any)=>entry.slot).sort((a:number,b:number)=>a-b);
    const marks=(state.merchantMarked[owner]||[]).filter((mark:any)=>mark?.item?.name===name&&mark.item.level===0).map((mark:any)=>mark.slot).sort((a:number,b:number)=>a-b);
    admission.push({at:Date.now(),inventorySeenAt:state.characters[owner]?.inventorySeenAt,slots,marks});
    if(admission.length>32)admission.splice(1,1);
    return {slots,marks};
  },{timeout:30_000,message:'Native ingredient inventory and all collection marks must publish before dispatch'}).toEqual({slots:Array.from({length:12},(_,i)=>20+i),marks:Array.from({length:12},(_,i)=>20+i)});
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':true,['auto '+kind]:true}});
  await expect.poll(async()=>(await live.clients[owner].snapshot()).items.filter((i:Item|null)=>i?.name===name).length,
    {timeout:180_000,message:'Every copy must reach the merchant through native collection'}).toBe(0);
  const count=async()=>{const all=(await economy(live)).characters;return Object.values(all).flatMap(c=>c.items).filter(i=>i?.name===name)};
  await expect.poll(async()=> {
    if((await count()).filter(i=>i?.level===1).length!==1)return false;
    if(kind!=='compound')return true;
    const outcomes=await live.clients[merchant].run('globalThis.__e2eCompoundOutcomes');
    return outcomes.some((event:any)=>event.response==='compound_success');
  },{timeout:kind==='upgrade'?180_000:90_000,message:kind==='compound'
    ?'Native inventory and the actual compound response must both confirm the result'
    :'Native inventory must confirm exactly one finite upgrade result after collection and return travel'}).toBe(true);
  const completed=await count();
  if(kind==='compound') {
    const publication=await live.clients[merchant].run('({heldAt:__e2eCompoundPublication.heldAt,releasedAt:__e2eCompoundPublication.releasedAt,frames:__e2eCompoundPublication.frames})');
    expect(publication.heldAt).not.toBeNull();
    expect(publication.releasedAt-publication.heldAt).toBeGreaterThanOrEqual(750);
    expect(publication.frames).toBeGreaterThan(0);
    const outcomes=await live.clients[merchant].run('globalThis.__e2eCompoundOutcomes');
    const successes=outcomes.filter((event:any)=>event.response==='compound_success').length;
    const failures=outcomes.filter((event:any)=>event.response==='compound_fail').length;
    expect(successes).toBe(1);
    expect(completed.length).toBe(12-2*successes-3*failures);
    expect(completed.every(item=>item?.level===0||item?.level===1)).toBe(true);
    await expect.poll(async()=>(await live.state()).autoCompounds?.[merchant]?.find((rule:any)=>rule.name===name)?.quantity).toBe(0);
  } else expect(completed.length).toBe(12);
  await live.restartCoordinator();
  await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.some((e:any)=>e?.item?.name===name&&e.item.level===1)).toBe(true);
  const afterRestart=await count();
  expect(afterRestart.length).toBe(completed.length);
  expect(afterRestart.filter(item=>item?.level===1).length).toBe(1);
  } finally {
    const compoundPublication=kind==='compound'?await live.clients[merchant].run('(()=>{const f=globalThis.__e2eCompoundPublication;f.restore();return {heldAt:f.heldAt,releasedAt:f.releasedAt,frames:f.frames};})()'):undefined;
    live.clients[merchant].page.off('request',observeHandoff);
    live.clients[merchant].page.off('response',observeHandoffResponse);
    await Promise.all(handoffResponses);
    await info.attach('auto-merchant-finite-processing-native',{body:JSON.stringify({kind,compoundPublication,declaredNativeIngredients:12,admission,handoffs,state:await live.state(),inventory:await economy(live),
      compoundOutcomes:kind==='compound'?await live.clients[merchant].run('globalThis.__e2eCompoundOutcomes'):undefined,
      events:await live.clients[merchant].events(),ownerEvents:await live.clients[owner].events()}),contentType:'application/json'});
  }
});

test('full-bag cleanout transfers cargo while the fighter keeps fighting a durable native target', async ({ live }, info) => {
  test.setTimeout(480_000);
  // Failure modes: e2e/live-economy-failure-modes.md, "Combat-interleaved merchant handoff".
  const fighter='E2EWarrior', timeline:any[]=[];
  let goo:any=null;
  const gooHp=async()=>goo?live.admin(`output=(()=>{const m=Object.values(instances[${JSON.stringify(goo?.map)}].monsters).find(m=>m.id===${JSON.stringify(goo?.id)});return m&&!m.dead?m.hp:0})()`):null;
  const sample=async()=>{
    const [hp,client,state]=await Promise.all([gooHp(),live.clients[fighter].snapshot(),live.state()]);
    const status=state.characters[fighter]||{};
    const entry={at:Date.now(),gooHp:hp,feathers:quantity(client.items,'feather0'),connected:client.connected,
      navigation:status.navigationState||null,target:status.target?{id:status.target.id,mtype:status.target.mtype}:null,
      activeCombatTarget:status.activeCombatTarget||null,farming:status.farmingNavigationDebug||null,
      job:state.merchantCurrent&&{reason:state.merchantCurrent.reason,status:state.merchantCurrent.status,target:state.merchantCurrent.target},
      queue:(state.merchantQueue||[]).map((job:any)=>job.reason),
      convoy:state.activeConvoy&&{purpose:state.activeConvoy.purpose,phase:state.activeConvoy.phase,participants:state.activeConvoy.participants,
        pause:state.activeConvoy.merchantInterruption?.phase||null},
      command:state.commands?.[fighter]&&{type:state.commands[fighter].type,purpose:state.commands[fighter].purpose},
      fighterAt:[status.map,status.x,status.y],
      merchantAt:[state.characters[merchant]?.map,state.characters[merchant]?.x,state.characters[merchant]?.y]};
    timeline.push(entry);return entry;
  };
  try {
    await live.post('/formation', { leader: fighter });
    await live.post('/farming-mode', { character: fighter, mode: 'default' });
    await live.post('/focus', { character: fighter, monsterFocus: ['goo'] });
    await live.post('/travel', await location(live));
    // A convoy defending against a monster refuses merchant pauses by design; this
    // journey covers ordinary farming combat once the travel convoy has ended.
    await expect.poll(async()=>{const entry=await sample();return !entry.convoy&&entry.target?.mtype==='goo';},
      {timeout:240_000,intervals:[1000],message:'The fighter must be farming goos with no convoy'}).toBe(true);
    // One introduced goo whose HP outlasts the whole journey; damage and death stay native.
    goo=await spawnGoo(live,fighter,300);
    // Farming target selection skips a goo this durable; it fights the fighter instead,
    // through native targeting, so the fighter is under attack while the merchant collects.
    await live.admin(`output=(()=>{const m=Object.values(instances[${JSON.stringify(goo.map)}].monsters).find(m=>m.id===${JSON.stringify(goo.id)});
      target_player(m,get_player(${JSON.stringify(fighter)}));return m.target})()`);
    await expect.poll(async()=>(await sample()).gooHp,{timeout:60_000,intervals:[1000],message:'The fighter must engage the durable goo'}).toBeLessThan(goo.hp);
    const seeded=await live.admin(`output=(()=>{const w=get_player(${JSON.stringify(fighter)});
      for(let i=0;i<w.isize-2;i++)if(!w.items[i])w.items[i]={name:'feather0',q:1};
      cache_player_items(w);resend(w,'reopen+cid');return w.items;})()`);
    await expect.poll(async()=>quantity((await live.clients[fighter].snapshot()).items,'feather0')).toBe(quantity(seeded,'feather0'));
    const before=await economy(live);
    const total=(value:Economy)=>bankQuantity(value,'feather0')+Object.values(value.characters).reduce((sum,c)=>sum+quantity(c.items,'feather0'),0);
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'inventory cleanout': true } });
    await live.post('/merchant/cleanout', { character: fighter });
    const requestedAt=timeline.length;
    let first:any;
    await expect.poll(async()=>{first=await sample();return first.feathers<quantity(seeded,'feather0');},
      {timeout:240_000,intervals:[500],message:'Cargo must reach the merchant while the durable goo is still alive'}).toBe(true);
    expect(first.gooHp).toBeGreaterThan(0);
    await expect.poll(async()=>(await sample()).gooHp,{timeout:30_000,intervals:[500],
      message:'Combat must continue after the first transfer'}).toBeLessThan(first.gooHp);
    await jobFinished(live);
    await sample();
    const window=timeline.slice(requestedAt);
    expect(window.every(entry=>entry.connected),'Interleaved sends must not trip the native call-cost disconnect').toBe(true);
    expect(window.some(entry=>entry.navigation==='departing'),'The fighter must not pause combat for the handoff').toBe(false);
    expect(total(await economy(live))).toBe(total(before));
    await record(live,info,'combat-interleaved-cleanout',before,{goo,first,seeded});
  } finally {
    // The durable goo would keep attacking the fighter and hold later journeys in combat.
    if(goo)await live.admin(`output=(()=>{const m=Object.values(instances[${JSON.stringify(goo.map)}].monsters).find(m=>m.id===${JSON.stringify(goo.id)});
      if(m)remove_monster(m);return true})()`).catch(()=>undefined);
    const events=async(name:string)=>(await live.clients[name].events()).slice(-80);
    await info.attach('combat-interleaved-cleanout-timeline',{body:JSON.stringify({goo,timeline,
      fighterEvents:await events(fighter),merchantEvents:await events(merchant)},null,2),contentType:'application/json'});
  }
});

for(const automatic of [false,true]) test(`${automatic?'automatic':'manual'} compound from native bank withdraws exactly its reserved triplet`,async({live},info)=>{
 test.setTimeout(300_000);
 // Failure modes: withdrawals alone masquerade as compounding; unrelated or locked
 // stock is consumed; public bank snapshots lag; duplicate native results appear.
 // Declare only this operation's success probability, scoped to its native socket
 // handler. Travel, source withdrawal, scroll, operation and item result remain native.
 const observations:any[]=[];
 const account=(state:Economy,level:number)=>Object.values(state.characters).reduce((sum,character)=>sum+character.items.filter(item=>item?.name==='strring'&&(item.level||0)===level).length,0)+Object.values(state.bank).reduce((sum,items)=>sum+items.filter(item=>item?.name==='strring'&&(item.level||0)===level).length,0);
 let before:Economy|undefined;
 try{
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner}),b=p.user||u.info;
   b.items0=b.items0||[];for(const slot of [30,31,32,33,34])if(b.items0[slot])throw Error('Bank fixture occupied');
   for(const slot of [30,31,32])b.items0[slot]={name:'strring',level:0};b.items0[33]={name:'strring',level:0,l:'l'};b.items0[34]={name:'beewings',q:3};
   if(!p.user)await db.collection('user').replaceOne({_id:u._id},u);return true;})()`);
  await live.post('/command',{character:merchant,type:'bank'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{
   const state=await live.state();
   return {rings:state.bank?.packs?.items0?.filter((entry:any)=>entry?.item?.name==='strring').length,
     bankJobPending:[state.merchantCurrent,...state.merchantQueue].some(job=>job?.reason==='manual bank exchange')};
  },{timeout:90_000,message:'The native bank visit must finish publishing its final slot layout before selecting the reserved triplet'}).toEqual({rings:4,bankJobPending:false});
  await live.post('/merchant/force-stand',{enabled:true});
  const selectionState=await live.state(),selected=selectionState.bank.packs.items0.find((entry:any)=>entry?.item?.name==='strring'&&!entry.item.l);
  observations.push({at:Date.now(),phase:'bank-selection',selected:{slot:selected.slot,item:selected.item},bank:selectionState.bank.packs.items0.map((entry:any)=>entry&&({slot:entry.slot,item:entry.item}))});
  await live.clients[merchant].run(`(()=>{globalThis.__manualBankCompoundReceipts=[];parent.socket.on('game_response',data=>{const response=typeof data==='string'?data:data&&data.response;if(response==='compound_success'||response==='compound_fail')globalThis.__manualBankCompoundReceipts.push({at:Date.now(),response,data});});return true;})()`);
  await live.admin(`output=(()=>{const p=get_player('${merchant}'),socket=p.socket,handlers=socket.listeners('compound');
   if(handlers.length!==1)throw Error('Expected one native compound handler');
   const original=handlers[0],log=[];
   function wrapped(data){const selected=data&&!data.calculate&&Array.isArray(data.items)&&data.items.length===3&&data.items.every(slot=>p.items[slot]?.name==='strring'&&(p.items[slot].level||0)===0);
    if(!selected)return original.apply(this,arguments);
    const grade=G.items.strring.igrade,previous=D.compounds[grade][1];D.compounds[grade][1]=1;
    try{log.push({at:Date.now(),items:data.items.slice(),declaredProbability:1});return original.apply(this,arguments);}finally{D.compounds[grade][1]=previous;}}
   socket.removeListener('compound',original);socket.on('compound',wrapped);globalThis.__manualBankCompoundHook={socket,original,wrapped,log};return true;})()`);
  if(automatic) await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':true}});
  await live.post('/command',{character:merchant,type:automatic?'auto-compound-mark':'compound-mark',pack:'items0',slot:selected.slot,item:selected.item,...(automatic?{targetTier:1,quantity:1}:{})});
  before=await economy(live);
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{
   const state=await live.state(),native=await economy(live),receipts=await live.clients[merchant].run('globalThis.__manualBankCompoundReceipts');
   observations.push({at:Date.now(),groups:state.compounds?.[merchant],native,receipts});
   return (automatic ? (state.autoCompounds?.[merchant]||[]).some((rule:any)=>rule.name==='strring'&&rule.quantity===0) : !(state.compounds?.[merchant]||[]).length)&&receipts.length===1&&receipts[0].response==='compound_success'&&account(native,0)===account(before!,0)-3&&account(native,1)===account(before!,1)+1;
  },{timeout:240_000}).toBe(true);
  const after=await economy(live),bankItems=Object.values(after.bank).flat();
  expect(bankItems.filter(item=>item?.name==='strring'&&item.l)).toEqual([{name:'strring',level:0,l:'l'}]);
  expect(bankItems.filter(item=>item?.name==='beewings').reduce((sum,item)=>sum+(item?.q||1),0)).toBe(3);
  if(!automatic) expect(bankQuantity(after,'strring')).toBe(bankQuantity(before,'strring')-3);
  await record(live,info,'native-bank-compound',before,{automatic,after,observations,declaredRolls:await live.admin('output=globalThis.__manualBankCompoundHook.log')});
 }finally{
  await info.attach('native-manual-bank-compound-observations',{body:JSON.stringify({before,observations,state:await live.state()}),contentType:'application/json'});
  await live.admin(`output=(()=>{const hook=globalThis.__manualBankCompoundHook;if(hook){hook.socket.removeListener('compound',hook.wrapped);hook.socket.on('compound',hook.original);delete globalThis.__manualBankCompoundHook;}return true;})()`).catch(()=>{});
 }
});
