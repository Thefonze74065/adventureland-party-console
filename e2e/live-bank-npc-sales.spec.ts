import { test, expect, type LiveGame } from './live-fixtures';
import { automaticCommerceRuleKey } from '../runtime/coordinator/inventory/item-identity';

test('full merchant defers external compounds until native NPC sales free capacity', async ({live},info) => {
  test.setTimeout(420_000);
  const merchant='E2EMerchant';
  try {
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':false,'auto npc sales':false}});
    // One native triple suffices to prove capacity admission and a real
    // compound attempt; extra triples add unrelated bank sorting work.
    await live.admin(`output=(async()=>{const p=get_player('${merchant}');const patch=Object.fromEntries(Array.from({length:3},(_,i)=>['info.items0.'+i,{name:'ringsj',level:0}]));await db.collection('user').updateOne({_id:p.owner},{$set:patch});return true})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.[2]?.item?.name,{timeout:90_000}).toBe('ringsj');
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
    // Initial inventory declaration only fills empty native slots; no existing
    // items are removed and subsequent capacity changes require real sales.
    // Eight sellable fillers provide sufficient withdrawal/scroll capacity;
    // remaining fillers are natively locked, avoiding an unrelated forty-sale
    // workload before the serialized compound job can run on slower clients.
    await live.admin(`output=(()=>{const p=get_player('${merchant}');let fillers=0;for(let i=0;i<p.items.length;i++)if(!p.items[i])p.items[i]={name:'helmet',level:0,...(fillers++<8?{}:{l:'l'})};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.filter((i:any)=>!i).length).toBe(0);
    await live.clients[merchant].run(`(()=>{globalThis.__capacityCompoundReceipts=[];parent.socket.on('game_response',data=>{const response=typeof data==='string'?data:data?.response;if(response==='compound_success'||response==='compound_fail')globalThis.__capacityCompoundReceipts.push({at:Date.now(),response,data})});return true})()`);
    await live.restoreHistoricalSettings(()=>({autoCompounds:{[merchant]:[{name:'ringsj',targetTier:1,quantity:1}]}}));
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':true,'auto npc sales':false}});
    const blockedAt=Date.now();
    await expect.poll(async()=>(await live.clients[merchant].snapshot()).statusAt,{timeout:30_000}).toBeGreaterThan(blockedAt+15_000);
    const blocked=await live.state();
    expect(blocked.merchantCurrent?.reason).not.toBe('auto compound');
    expect(blocked.merchantQueue.some((job:any)=>job.reason==='auto compound')).toBe(false);
    expect(blocked.withdrawals?.[merchant]?.length||0).toBe(0);
    await info.attach('full-bag-compound-admission',{body:JSON.stringify(blocked),contentType:'application/json'});
    await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0}});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':true,'auto npc sales':true}});
    await expect.poll(async()=>{
      const sales=await helmetSaleReceipts(live,merchant),client=await live.clients[merchant].snapshot();
      return sales.length===8&&sales.every(entry=>Number(entry.data.gold)>0)&&client.items.filter((item:any)=>!item).length>3;
    },{timeout:150_000,message:'Eight genuine NPC sales must free native withdrawal capacity'}).toBe(true);
    await info.attach('compound-capacity-native-cleanout',{body:JSON.stringify({sales:await helmetSaleReceipts(live,merchant),client:await live.clients[merchant].snapshot(),state:await live.state()}),contentType:'application/json'});
    await expect.poll(async()=>{
      const receipts=await live.clients[merchant].run('globalThis.__capacityCompoundReceipts');
      return (await helmetSaleReceipts(live,merchant)).length>3&&receipts.length>0;
    },{timeout:150_000,message:'Freed capacity must permit actual native compound processing'}).toBe(true);
  } finally {
    await info.attach('compound-capacity-native-evidence',{body:JSON.stringify({state:await live.state(),client:await live.clients[merchant].snapshot(),events:await live.clients[merchant].events(),compoundReceipts:await live.clients[merchant].run('globalThis.__capacityCompoundReceipts||[]')}),contentType:'application/json'});
  }
});

async function totalGold(live:LiveGame, merchant:string):Promise<number> {
  return live.admin(`output=(async()=>{const p=get_player('${merchant}'),user=await db.collection('user').findOne({_id:p.owner});return p.gold+((p.user||user.info).gold||0)})()`);
}

function bankItems(state:any):any[] {
  return Object.values(state.bank?.packs||{}).flatMap((pack:any)=>pack.map((entry:any)=>entry?.item).filter(Boolean));
}
function unlockedHelmets(state:any):any[] {
  return bankItems(state).filter(item=>item.name==='helmet'&&!item.l);
}
async function helmetSaleReceipts(live:LiveGame,merchant:string) {
  return (await live.clients[merchant].events()).filter(entry=>entry.event==='game_response'&&
    entry.data?.place==='sell'&&entry.data.success===true&&entry.data.item?.name==='helmet');
}

test('bank sale scheduling collapses cleanout retries and sells only excess reserved stock', async ({live},info) => {
  test.setTimeout(420_000);
  const merchant='E2EMerchant', target='E2EWarrior', samples:any[]=[];
  try {
    await live.admin(`output=(async()=>{const p=get_player('${merchant}');const items=[...Array.from({length:5},()=>({name:'helmet',level:0})),{name:'smoke',q:100},{name:'smoke',q:100}];await db.collection('user').updateOne({_id:p.owner},{$set:Object.fromEntries(items.map((item,i)=>['info.items0.'+i,item]))});return true})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.[6]?.item?.q,{timeout:90_000}).toBe(100);
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
    await live.post('/merchant/force-stand',{enabled:true});
    await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:2});
    await live.post('/merchant/auto-npc-sale',{item:{name:'smoke'},keep:150});
    // Persist the enabled routine before restoring its historical jobs. A
    // restart heartbeat correctly removes jobs whose automation is disabled.
    await live.post('/merchant/routine-priorities',{priorities:{'auto npc sales':98,'inventory cleanout':95,withdrawals:10},enabled:{'inventory cleanout':true,withdrawals:true,'auto npc sales':false}});
    // Historical input reproduces the accumulated queue, never native outcomes.
    await live.restoreHistoricalSettings(()=>({merchantQueue:Array.from({length:20},(_,i)=>({
      id:'historical-cleanout-'+i,target,reason:'inventory cleanout',queuedAt:Date.now()-20_000+i,
      rendezvousRetryCount:i%3,retryAt:Date.now()+60_000,
    }))}));
    await expect.poll(async()=>(await live.state()).merchantQueue.filter((job:any)=>job.reason==='inventory cleanout'&&job.target===target).length).toBe(1);
    const collapsed=await live.state();
    expect(collapsed.merchantQueue.find((job:any)=>job.reason==='inventory cleanout').rendezvousRetryCount).toBe(2);
    await info.attach('collapsed-historical-cleanouts',{body:JSON.stringify(collapsed),contentType:'application/json'});
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>(await live.state()).merchantCurrent?.reason,{timeout:120_000}).toBe('inventory cleanout');
    // Enable while a real party visit owns the merchant. Its bank-sale
    // prerequisite must become visible before that visit finishes.
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
    await expect.poll(async()=>{
      const state=await live.state();
      samples.push({at:Date.now(),current:state.merchantCurrent,queue:state.merchantQueue,withdrawals:state.withdrawals[merchant]});
      return state.merchantQueue.some((job:any)=>job.reason==='withdrawals'&&job.target===merchant&&job.priority===98)&&
        state.withdrawals[merchant].filter((mark:any)=>mark.autoNpcRuleKey).length===4;
    },{timeout:15_000}).toBe(true);
    const native=()=>live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;const items=[...p.items,...Object.entries(u).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v)].filter(Boolean);return {helmets:items.filter(i=>i.name==='helmet').length,smoke:items.filter(i=>i.name==='smoke').reduce((n,i)=>n+(i.q||1),0)}})()`);
    await expect.poll(native,{timeout:240_000}).toEqual({helmets:2,smoke:150});
    await expect.poll(async()=>{
      const receipts=(await live.clients[merchant].events()).filter(entry=>entry.event==='game_response'&&entry.data?.place==='sell'&&entry.data.success===true);
      return {helmets:receipts.filter(entry=>entry.data.item?.name==='helmet').length,smoke:receipts.filter(entry=>entry.data.item?.name==='smoke').reduce((n,entry)=>n+Number(entry.data.item.q||1),0)};
    },{timeout:30_000}).toEqual({helmets:3,smoke:50});
    await live.restartCoordinator();
    expect(await native()).toEqual({helmets:2,smoke:150});
    await expect.poll(async()=>{
      const state=await live.state();
      return Object.values(state.autoNpcSales).map((rule:any)=>({name:rule.item.name,keep:rule.keep})).sort((a:any,b:any)=>a.name.localeCompare(b.name));
    }).toEqual([{name:'helmet',keep:2},{name:'smoke',keep:150}]);
  } finally {
    await info.attach('bank-sale-scheduling-native-evidence',{body:JSON.stringify({samples,state:await live.state(),events:await live.clients[merchant].events()}),contentType:'application/json'});
  }
});

test('bank NPC sale rule withdraws native stock and respects disabled sales across restart', async ({ live }, info) => {
  test.setTimeout(240_000);
  const merchant = 'E2EMerchant';
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': false, withdrawals: false, 'party collection': false } });
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0.0':{name:'helmet',level:0},'info.items0.1':{name:'helmet',level:0,l:'l'}}});return true})()`);
  await live.post('/command', { character: merchant, type: 'bank' });
  await expect.poll(async () => (await live.state()).bank?.packs?.items0?.[0]?.item?.name, {timeout:90_000}).toBe('helmet');
  await live.post('/merchant/auto-npc-sale', { item: {name:'helmet',level:0} });
  await live.restartCoordinator();
  const before = await live.state();
  const goldBefore = await totalGold(live,merchant);
  const observedAt = Date.now();
  await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt).toBeGreaterThan(observedAt + 2000);
  expect(unlockedHelmets(await live.state())).toHaveLength(1);
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': true } });
  await expect.poll(async () => unlockedHelmets(await live.state()).length, {timeout:150_000}).toBe(0);
  await expect.poll(async () => (await live.clients[merchant].snapshot()).items.some((item:any) => item?.name==='helmet' && !item.l), {timeout:90_000}).toBe(false);
  const after = await live.state();
  expect(bankItems(after).filter(item=>item.name==='helmet'&&item.l==='l')).toHaveLength(1);
  expect(await helmetSaleReceipts(live,merchant)).toHaveLength(1);
  expect(await totalGold(live,merchant)).toBeGreaterThan(goldBefore);
  await info.attach('bank-npc-native-evidence', {body:JSON.stringify({before,after,client:await live.clients[merchant].snapshot(),events:await live.clients[merchant].events()}),contentType:'application/json'});
});

test('bank NPC selection caps ten stacks and excludes persisted NPC stand conflicts', async ({live},info) => {
  test.setTimeout(360_000);
  const merchant='E2EMerchant';
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':false,withdrawals:true}});
  const seeded=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),items=Array.from({length:12},()=>({name:'helmet',level:0}));items.push({name:'helmet',level:0,l:'l'},{name:'shoes',level:0});const patch=Object.fromEntries(items.map((item,i)=>['info.items0.'+i,item]));await db.collection('user').updateOne({_id:p.owner},{$set:patch});return items})()`);
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).bank?.packs.items0?.[13]?.item.name,{timeout:90_000}).toBe('shoes');
  await expect.poll(async () => (await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await live.post('/merchant/force-stand',{enabled:true});
  // Historical rule conflict is input, not fabricated sale success. The normal
  // editor correctly retires competing rules, so restore a legacy mixed store.
  await live.restoreHistoricalSettings(() => ({
    autoNpcSales:{[automaticCommerceRuleKey({name:'helmet',level:0})]:{item:{name:'helmet',level:0},createdAt:Date.now()},[automaticCommerceRuleKey({name:'shoes',level:0})]:{item:{name:'shoes',level:0},createdAt:Date.now()}},
    autoStandMarks:{[automaticCommerceRuleKey({name:'shoes',level:0})]:{price:1000}},
  }));
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
  await expect.poll(async () => (await live.state()).withdrawals[merchant]?.length).toBe(10);
  const first=await live.state();
  expect(first.withdrawals[merchant].every((entry:any)=>entry.item.name==='helmet' && !entry.item.l && !entry.standListingId)).toBe(true);
  const goldBefore=await totalGold(live,merchant);
  await info.attach('bank-first-ten-selected',{body:JSON.stringify({seeded,first}),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async () => {
    const state=await live.state();
    return unlockedHelmets(state).length===0 &&
      !state.characters[merchant].items.some((entry:any)=>entry?.item?.name==='helmet'&&!entry.item.l) &&
      (await helmetSaleReceipts(live,merchant)).length===12;
  },{timeout:240_000}).toBe(true);
  const after=await live.state();
  expect(bankItems(after).filter(item=>item.name==='helmet'&&item.l==='l')).toHaveLength(1);
  expect(bankItems(after).filter(item=>item.name==='shoes')).toHaveLength(1);
  expect(await helmetSaleReceipts(live,merchant)).toHaveLength(12);
  expect(await totalGold(live,merchant)).toBeGreaterThan(goldBefore);
  await live.restartCoordinator();
  const restored=await live.state();
  expect(bankItems(restored).filter(item=>item.name==='shoes')).toHaveLength(1);
  await info.attach('bank-ten-stack-conflict-native-result',{body:JSON.stringify({after,restored,events:await live.clients[merchant].events()}),contentType:'application/json'});
});
