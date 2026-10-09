import { test, expect } from './live-fixtures';

test('party realm transition keeps its own sixty second timeout during missing arrival reports', async ({live},info) => {
  test.setTimeout(120_000);
  // Declared historical boundary: an interrupted real transition with no fresh
  // merchant arrival observations. Native clients stay connected; only their
  // status transport is held, not invented realm-success receipts.
  const context=live.clients.E2EMerchant.page.context();
  let hold=true;
  await context.route('**/status', async route => {
    if (hold && route.request().postDataJSON()?.name==='E2EMerchant') await route.abort('failed');
    else await route.continue();
  });
  const started=Date.now();
  await live.restoreHistoricalSettings(() => ({merchantCurrent:{id:'interrupted-party-realm',target:'E2EWarrior',reason:'marked items',phase:'switching party realm',destinationRealm:'SR_USI',realmStartedAt:started}}));
  await expect.poll(async () => (await live.state()).merchantCurrent?.id).toBe('interrupted-party-realm');
  await expect.poll(async () => (await live.clients.E2EWarrior.snapshot()).statusAt, {timeout:20_000}).toBeGreaterThan(started+5000);
  expect((await live.state()).merchantCurrent?.phase).toBe('switching party realm');
  await expect.poll(async () => (await live.state()).merchantActivity.some((entry:any)=>entry.message==='Merchant realm switch timed out'), {timeout:75_000}).toBe(true);
  const expired=await live.state();
  const job=expired.merchantQueue.find((job:any)=>job.id==='interrupted-party-realm');
  expect(job.realmAttempts).toBe(1);
  expect(expired.merchantActivity.some((entry:any)=>entry.message?.startsWith('Merchant stopped reporting'))).toBe(false);
  hold=false;
  await context.unroute('**/status');
  await info.attach('party-realm-owned-timeout', {body:JSON.stringify({started,expired,events:await live.clients.E2EMerchant.events()}),contentType:'application/json'});
});

test.describe('merchant destination ownership', () => {
  test.use({liveHeadless:true});
  test('persisted third realm return exhausts after restart and explicit retry retains bank work',async({live},info)=>{
    test.setTimeout(180_000);
    const merchant='E2EMerchant',id='third-home-return';
    await live.post('/steam/action',{character:merchant,action:'logout'});
    await expect.poll(async()=>await live.admin(`output=!!get_player('${merchant}')`),{timeout:30_000}).toBe(false);
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
    await live.post('/steam/action',{character:merchant,action:'logout'});
    await expect.poll(async()=>await live.admin(`output=!!get_player('${merchant}')`),{timeout:30_000}).toBe(false);
    await live.post('/realm/switch',{realm:'SR_USII',setHome:false});
    await expect.poll(async()=>(await live.state()).realmControl.operation.phase,{timeout:120_000}).toBe('complete');
    await live.admin(`output=(()=>{const p=get_player('${fighter}');p.items[10]={name:'leather',q:7};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    await expect.poll(async()=>(await live.state()).characters[fighter].items.some((entry:any)=>entry?.item?.name==='leather')).toBe(true);
    await live.post('/command',{character:fighter,type:'merchant-mark',slot:10,item:{name:'leather',q:7}});
    await live.post('/bank-party',{});
    await live.post('/slots/1/spawn',{character:merchant});
    const observations:any[]=[];
    await expect.poll(async()=>{
      const state=await live.state();
      observations.push({at:Date.now(),merchant:state.characters[merchant]?.server,current:state.merchantCurrent,queue:state.merchantQueue});
      return !state.characters[fighter].items.some((entry:any)=>entry?.item?.name==='leather');
    },{timeout:180_000,intervals:[250,500,1000]}).toBe(true);
    const after=await live.state();
    expect(after.merchantActivity.some((entry:any)=>entry.message?.startsWith('Merchant stopped reporting'))).toBe(false);
    const total=await live.admin(`output=(async()=>{const p=get_player('${fighter}'),m=get_player('${merchant}'),user=await db.collection('user').findOne({_id:p.owner});const count=items=>items.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0);return count(p.items)+count(m.items)+Object.entries(m.user||user.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+count(v),0)})()`);
    expect(total).toBe(7);
    await info.attach('cross-realm-native-collection',{body:JSON.stringify({observations,after,total,events:await live.clients[fighter].events()}),contentType:'application/json'});
  });
  test('merchant reconnect completes bank work off its native home', async ({ live }, info) => {
    test.setTimeout(240_000);
    const name = 'E2EMerchant';
    await live.admin(`output=(async()=>{for(const name of ['E2EWarrior','E2EPriest','E2EMerchant']){const p=get_player(name);p.p.home='USII';await db.collection('character').updateOne({'info.name':name},{$set:{'info.p.home':'USII'}});}return true})()`);
    await live.post('/realm/switch', {realm:'SR_USI',setHome:false});
    await expect.poll(async () => (await live.state()).realmControl.operation.phase, {timeout:120_000}).toBe('complete');
    await live.post('/steam/action', {character:name,action:'logout'});
    await expect.poll(async () => await live.admin(`output=!!get_player('${name}')`), {timeout:30_000}).toBe(false);
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
