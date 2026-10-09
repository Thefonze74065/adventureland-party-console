import { test, expect } from './live-fixtures';

test('bank NPC sale rule withdraws native stock and respects disabled sales across restart', async ({ live }, info) => {
  test.setTimeout(240_000);
  const merchant = 'E2EMerchant';
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': false } });
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');p.user.items0[0]={name:'helmet',level:0};p.user.items0[1]={name:'helmet',level:0,l:'l'};await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':p.user.items0}});return true})()`);
  await live.post('/command', { character: merchant, type: 'bank' });
  await expect.poll(async () => (await live.state()).bankSnapshot?.packs?.items0?.[0]?.item?.name, {timeout:90_000}).toBe('helmet');
  await live.post('/merchant/auto-npc-sale', { item: {name:'helmet',level:0} });
  await live.restartCoordinator();
  const before = await live.state();
  const goldBefore = await live.admin(`output=(()=>{const p=get_player('${merchant}');return p.gold+(p.user.gold||0)})()`);
  const observedAt = Date.now();
  await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt).toBeGreaterThan(observedAt + 2000);
  expect((await live.state()).bankSnapshot.packs.items0[0].item.name).toBe('helmet');
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': true } });
  await expect.poll(async () => (await live.state()).bankSnapshot.packs.items0[0]?.item, {timeout:150_000}).toBeFalsy();
  await expect.poll(async () => (await live.clients[merchant].snapshot()).items.some((item:any) => item?.name==='helmet' && !item.l), {timeout:90_000}).toBe(false);
  const after = await live.state();
  expect(after.bankSnapshot.packs.items0[1].item.l).toBe('l');
  expect(await live.admin(`output=(()=>{const p=get_player('${merchant}');return p.gold+(p.user.gold||0)})()`)).toBeGreaterThan(goldBefore);
  await info.attach('bank-npc-native-evidence', {body:JSON.stringify({before,after,client:await live.clients[merchant].snapshot(),events:await live.clients[merchant].events()}),contentType:'application/json'});
});

test('bank NPC selection caps ten stacks and excludes persisted NPC stand conflicts', async ({live},info) => {
  test.setTimeout(360_000);
  const merchant='E2EMerchant';
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':false}});
  const seeded=await live.admin(`output=(async()=>{const p=get_player('${merchant}');for(let i=0;i<12;i++)p.user.items0[i]={name:'helmet',level:0};p.user.items0[12]={name:'helmet',level:0,l:'l'};p.user.items0[13]={name:'shoes',level:0};await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':p.user.items0}});return p.user.items0})()`);
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).bankSnapshot?.packs.items0?.[13]?.item.name,{timeout:90_000}).toBe('shoes');
  await expect.poll(async () => (await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await live.post('/merchant/force-stand',{enabled:true});
  // Historical rule conflict is input, not fabricated sale success. The normal
  // editor correctly retires competing rules, so restore a legacy mixed store.
  await live.restoreHistoricalSettings(() => ({
    autoNpcSales:{'helmet@0':{item:{name:'helmet',level:0},createdAt:Date.now()},'shoes@0':{item:{name:'shoes',level:0},createdAt:Date.now()}},
    autoStandMarks:{'shoes@0':{price:1000}},
  }));
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
  await expect.poll(async () => (await live.state()).withdrawals[merchant]?.length).toBe(10);
  const first=await live.state();
  expect(first.withdrawals[merchant].every((entry:any)=>entry.item.name==='helmet' && !entry.item.l && !entry.standListingId)).toBe(true);
  const goldBefore=await live.admin(`output=(()=>{const p=get_player('${merchant}');return p.gold+(p.user.gold||0)})()`);
  await info.attach('bank-first-ten-selected',{body:JSON.stringify({seeded,first}),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async () => {
    const state=await live.state();
    return state.bankSnapshot.packs.items0.slice(0,12).every((entry:any)=>!entry?.item) &&
      !state.characters[merchant].items.some((entry:any)=>entry?.item?.name==='helmet'&&!entry.item.l);
  },{timeout:240_000}).toBe(true);
  const after=await live.state();
  expect(after.bankSnapshot.packs.items0[12].item.l).toBe('l');
  expect(after.bankSnapshot.packs.items0[13].item.name).toBe('shoes');
  expect(await live.admin(`output=(()=>{const p=get_player('${merchant}');return p.gold+(p.user.gold||0)})()`)).toBeGreaterThan(goldBefore);
  await live.restartCoordinator();
  const restored=await live.state();
  expect(restored.bankSnapshot.packs.items0[13].item.name).toBe('shoes');
  await info.attach('bank-ten-stack-conflict-native-result',{body:JSON.stringify({after,restored,events:await live.clients[merchant].events()}),contentType:'application/json'});
});
