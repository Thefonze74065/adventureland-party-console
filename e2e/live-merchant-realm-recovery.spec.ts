import { test, expect } from './live-fixtures';

async function logoutMerchant(live:import('./live-fixtures').LiveGame, merchant:string) {
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>{
    const state=await live.state();
    return !state.activeSlots.some((slot:any)=>slot.character===merchant) &&
      (!state.steamSwitch || state.steamSwitch.phase==='complete');
  },{timeout:90_000}).toBe(true);
  await expect.poll(async()=>await live.admin(`output=!!get_player('${merchant}')`),{timeout:30_000}).toBe(false);
}

async function prepareCrossRealmCollection(live:import('./live-fixtures').LiveGame) {
  const merchant='E2EMerchant',fighter='E2EWarrior';
  await logoutMerchant(live,merchant);
  await live.post('/realm/switch',{realm:'SR_USII',setHome:false});
  await expect.poll(async()=>{
    const state=await live.state();
    if(state.steamSwitch?.phase==='awaiting-realm-choice')
      await live.post('/steam/realm-choice',{operationId:state.steamSwitch.id,choice:'stay'});
    return state.realmControl.operation.phase;
  },{timeout:120_000,intervals:[250]}).toBe('complete');
  await expect.poll(async()=>await live.adminRealm('USII',`output=!!get_player('${fighter}')`),{timeout:30_000}).toBe(true);
  await live.adminRealm('USII',`output=(()=>{const p=get_player('${fighter}');p.items[10]={name:'leather',q:7};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.state()).characters[fighter].items.some((entry:any)=>entry?.item?.name==='leather')).toBe(true);
  await live.post('/command',{character:fighter,type:'merchant-mark',slot:10,item:{name:'leather',q:7}});
  await live.post('/bank-party',{group:fighter});
  await live.post('/slots/1/spawn',{character:merchant});
}

async function nativeLeather(live:import('./live-fixtures').LiveGame) {
  const inventories=[];
  for(const realm of ['USI','USII'] as const)
    inventories.push(await live.adminRealm(realm,`output=(()=>{const count=items=>items.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0);return ['E2EWarrior','E2EPriest','E2EMerchant'].reduce((n,name)=>n+count(get_player(name)?.items||[]),0)})()`));
  const bank=await live.admin(`output=(async()=>{const user=await db.collection('user').findOne({'info.email':'e2e@example.test'});return Object.entries(user.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+v.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0),0)})()`);
  return {inventories,bank,total:inventories.reduce((n,value)=>n+value,0)+bank};
}

test.describe('merchant destination ownership', () => {
  test.use({liveHeadless:true});
  test('party realm transition keeps its own sixty second timeout during missing arrival reports',async({live},info)=>{
    test.setTimeout(300_000);
    await prepareCrossRealmCollection(live);
    let admitted:any;
    await expect.poll(async()=>{
      const current=(await live.state()).merchantCurrent;
      if(current?.phase==='switching party realm') admitted=current;
      return !!admitted;
    },{timeout:90_000,intervals:[100]}).toBe(true);
    const started=admitted.realmStartedAt;
    live.holdMerchantStatus(true);
    try {
      await expect.poll(async()=>await live.adminRealm('USII',"output=!!get_player('E2EMerchant')"),{timeout:50_000}).toBe(true);
      await expect.poll(async()=>Date.now()-started,{timeout:15_000}).toBeGreaterThan(5000);
      const waiting=await live.state();
      expect(waiting.merchantCurrent).toMatchObject({id:admitted.id,phase:'switching party realm',realmStartedAt:started});
      await expect.poll(async()=>(await live.state()).merchantActivity.some((entry:any)=>entry.message==='Merchant realm switch timed out'),{timeout:65_000}).toBe(true);
      const expired=await live.state(), elapsed=Date.now()-started;
      expect(expired.merchantQueue.find((job:any)=>job.id===admitted.id)).toMatchObject({realmAttempts:1,realmStartedAt:started});
      expect(elapsed).toBeGreaterThanOrEqual(60_000);
      expect(elapsed).toBeLessThan(70_000);
      expect(expired.merchantActivity.some((entry:any)=>entry.message?.startsWith('Merchant stopped reporting'))).toBe(false);
      expect((await nativeLeather(live)).total).toBe(7);
      await info.attach('party-realm-owned-timeout',{body:JSON.stringify({admitted,waiting,expired,elapsed,nativeArrivalRealm:'USII',nativeArrival:await live.adminRealm('USII',"output=(()=>{const p=get_player('E2EMerchant');return {name:p.name,items:p.items}})()")}),contentType:'application/json'});
    } finally {live.holdMerchantStatus(false);}
  });
  test('persisted third realm return exhausts after restart and explicit retry retains bank work',async({live},info)=>{
    test.setTimeout(180_000);
    const merchant='E2EMerchant',id='third-home-return';
    await logoutMerchant(live,merchant);
    // Declared interrupted-restart input: three requests already issued with
    // the last arrival deadline elapsed. No successful login is fabricated.
    await live.restoreHistoricalSettings(()=>({
      merchantRealmRequests:{[merchant]:{realm:'SR_USI',owner:'home',requestedAt:Date.now()-61_000,attempts:3}},
      merchantQueue:[{id,target:merchant,reason:'manual bank exchange',queuedAt:Date.now()}],
    }));
    await expect.poll(async()=>(await live.state()).merchantActivity.some((entry:any)=>entry.message?.startsWith('Merchant realm return failed after 3 attempts')),{timeout:20_000}).toBe(true);
    const exhausted=await live.state();
    expect(exhausted.merchantQueue.some((job:any)=>job.id===id)).toBe(true);
    await live.restartCoordinator();
    const afterRestart=await live.state();
    expect(afterRestart.merchantQueue.some((job:any)=>job.id===id)).toBe(true);
    await live.post('/merchant/job/retry',{id});
    await live.post('/slots/1/spawn',{character:merchant});
    await expect.poll(async()=>{
      const state=await live.state();
      return state.characters[merchant]?.map==='bank' && ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===id);
    },{timeout:120_000}).toBe(true);
    await info.attach('persisted-home-exhaustion-and-native-retry',{body:JSON.stringify({exhausted,afterRestart,after:await live.state()}),contentType:'application/json'});
  });
  test('cross realm merchant collection reconnects before transferring real cargo',async({live},info)=>{
    test.setTimeout(300_000);
    const merchant='E2EMerchant',fighter='E2EWarrior';
    await prepareCrossRealmCollection(live);
    const observations:any[]=[];
    let admitted:any;
    await expect.poll(async()=>{
      const state=await live.state();
      observations.push({at:Date.now(),merchant:state.characters[merchant]?.server,current:state.merchantCurrent,queue:state.merchantQueue});
      if(state.merchantCurrent?.phase==='switching party realm') admitted=state.merchantCurrent;
      return !!admitted;
    },{timeout:90_000,intervals:[100],message:'A real US I to US II transition must be admitted before collection'}).toBe(true);
    expect(admitted.destinationRealm).toBe('SR_USII');
    await expect.poll(async()=>{
      const state=await live.state();
      observations.push({at:Date.now(),merchant:state.characters[merchant]?.server,current:state.merchantCurrent,queue:state.merchantQueue});
      return !state.characters[fighter].items.some((entry:any)=>entry?.item?.name==='leather');
    },{timeout:180_000,intervals:[250,500,1000]}).toBe(true);
    const after=await live.state();
    expect(after.merchantActivity.some((entry:any)=>entry.message?.startsWith('Merchant stopped reporting'))).toBe(false);
    await expect.poll(async()=>(await nativeLeather(live)).total,{timeout:30_000}).toBe(7);
    const total=await nativeLeather(live);
    await info.attach('cross-realm-native-collection',{body:JSON.stringify({admitted,observations,after,total,events:await live.clients[fighter].events()}),contentType:'application/json'});
  });
  test('merchant reconnect completes bank work off its native home', async ({ live }, info) => {
    test.setTimeout(240_000);
    const name = 'E2EMerchant';
    await live.admin(`output=(async()=>{for(const name of ['E2EWarrior','E2EPriest','E2EMerchant']){const p=get_player(name);p.p.home='USII';await db.collection('character').updateOne({'info.name':name},{$set:{'info.p.home':'USII'}});}return true})()`);
    await live.post('/realm/switch', {realm:'SR_USI',setHome:false});
    await expect.poll(async () => (await live.state()).realmControl.operation.phase, {timeout:120_000}).toBe('complete');
    await logoutMerchant(live,name);
    await live.restartCoordinator();
    await live.post('/slots/1/spawn', {character:name});
    await expect.poll(async () => (await live.state()).characters[name]?.server, {timeout:90_000}).toBe('USII');
    await live.post('/command', {character:name,type:'bank'});
    await expect.poll(async () => {
      const s=await live.state();
      return s.characters[name]?.server==='USI' && s.characters[name]?.map==='bank';
    }, {timeout:120_000}).toBe(true);
    const after=await live.state();
    expect(await live.admin(`output=get_player('${name}').p.home`)).toBe('USII');
    expect(after.merchantActivity.filter((entry:any)=>entry.message?.startsWith('Returning '+name)).length).toBeLessThanOrEqual(3);
    await info.attach('merchant-nonhome-reconnect-bank', {body:JSON.stringify({after,native:await live.admin(`output=(()=>{const p=get_player('${name}');return {home:p.p.home,map:p.map,items:p.items,gold:p.gold}})()`)}),contentType:'application/json'});
  });
});
