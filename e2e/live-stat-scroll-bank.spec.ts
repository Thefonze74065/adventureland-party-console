import { test, expect } from './live-fixtures';

// Failure inventory: e2e/stat-scroll-bank-failures.md. The declared inputs are the
// merchant's seeded item and one STR scroll in its native bank; the withdrawal,
// any NPC purchase and the stat application are native.
const merchant = 'E2EMerchant';
const native = (live: { admin(code: string): Promise<any> }, scroll='strscroll') => live.admin(`output=(async()=>{const p=get_player('${merchant}');
  const u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
  const scrolls=list=>(list||[]).filter(i=>i&&i.name===${JSON.stringify(scroll)}).reduce((n,i)=>n+(i.q||1),0);
  const goldByCharacter=Object.fromEntries(['E2EWarrior','E2EPriest','${merchant}'].map(name=>[name,get_player(name).gold]));
  const bankGold=Number(u.gold)||0;
  return {helmet:p.items[20],gold:Object.values(goldByCharacter).reduce((sum,gold)=>sum+gold,bankGold),goldByCharacter,bankGold,carried:scrolls(p.items),
    bank:Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+scrolls(v),0)};})()`);

for (const {deliver,stat} of [{deliver:false,stat:'str'},{deliver:true,stat:'str'},{deliver:false,stat:'luck'}]) test(`a merchant ${stat} stat scroll comes from the bank${deliver ? ' before higher priority delivery' : ' instead of being bought again'}`, async ({ live }, info) => {
  test.setTimeout(300_000);
  const observations: any[] = [];
  const scroll=stat+'scroll',completions:any[]=[];
  const observe=(request:any)=>{if(new URL(request.url()).pathname.endsWith('/merchant/complete'))completions.push(request.postDataJSON());};
  live.clients[merchant].page.on('request',observe);
  try {
    await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
    const seeded = await live.admin(`output=(async()=>{const p=get_player('${merchant}');
      if(p.items[20]) throw Error('Fixture requires empty inventory cell 20');
      if(p.items.some(i=>i&&i.name===${JSON.stringify(scroll)})) throw Error('Fixture requires no carried STR scrolls');
      p.items[20]={name:'helmet',level:0,stat_type:'dex'};
      const seed=info=>{const pack=info.items0||(info.items0=[]);const slot=pack.findIndex(i=>!i);
        if(slot<0&&pack.length>=42) throw Error('Fixture requires a free items0 slot');pack[slot<0?pack.length:slot]={name:${JSON.stringify(scroll)},q:1};};
      if(p.user) seed(p.user); else {const u=await db.collection('user').findOne({_id:p.owner});
        if(Object.values(u.info).some(v=>Array.isArray(v)&&v.some(i=>i&&i.name===${JSON.stringify(scroll)}))) throw Error('Fixture requires no banked STR scrolls');
        seed(u.info);await db.collection('user').replaceOne({_id:u._id},u);}
      cache_player_items(p);resend(p,'reopen+cid');return {item:p.items[20],inBank:!!p.user};})()`);
    await info.attach('declared-inputs', { body: JSON.stringify(seeded), contentType: 'application/json' });
    await expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 20)?.item, { timeout: 30_000 })
      .toEqual({ name: 'helmet', level: 0, stat_type: 'dex' });
    if(stat==='luck') {
      await live.post('/command',{character:merchant,type:'bank'});
      await expect.poll(async()=>Object.values((await live.state()).bank?.packs||{}).flat().some((entry:any)=>entry?.item?.name===scroll),{timeout:90_000}).toBe(true);
    }
    const before = await native(live,scroll);
    expect(before).toMatchObject({ carried: 0, bank: 1 });

    await live.post('/merchant/force-stand', {enabled:true});
    await live.post('/command', { character: merchant, type: 'stat-scroll-mark', slot: 20, item: { name: 'helmet', level: 0, stat_type: 'dex' }, statType: stat });
    if(deliver){
      await live.post('/merchant/routine-priorities',{priorities:{deliveries:100,'manual upgrades':1},enabled:{deliveries:true}});
      await live.post('/command',{character:merchant,type:'give',slot:20,item:seeded.item,target:'E2EWarrior'});
      expect((await live.state()).statScrolls[merchant]).toHaveLength(1);
      await expect.poll(async()=>{const state=await live.state();return state.merchantAutomations.deliveries===true && state.merchantDeliveries.E2EWarrior?.length===1 && state.statScrolls[merchant]?.length===1 && state.merchantRoutinePriorities.deliveries>state.merchantRoutinePriorities['manual upgrades'];},{timeout:30_000,message:'Both enabled intents and the delivery priority must persist before release'}).toBe(true);
    }
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async () => { const n = await native(live,scroll); observations.push({ at: Date.now(), n }); return deliver ? await live.admin(`output=get_player('E2EWarrior').items.find(i=>i&&i.name==='helmet'&&i.stat_type==='str')?.stat_type`) : n.helmet?.stat_type; },
      { timeout: 240_000, intervals: [500, 1000] }).toBe(stat);
    await expect.poll(()=>completions.flatMap(body=>body.statScrollsApplied||[]).filter((receipt:any)=>receipt.mark.statType===stat).length,{timeout:30_000}).toBe(1);
    expect(completions.flatMap(body=>body.statScrollsApplied||[])[0].item.stat_type).toBe(stat);
    const after = await native(live,scroll);
    // 1: the banked scroll was used; nothing was bought. A bank visit may deposit
    // carried gold, and delivery may collect the recipient's gold. Compare all
    // three native party balances plus the bank, preserving exact conservation.
    expect(after).toMatchObject({ carried: 0, bank: 0 });
    expect(after.gold).toBe(before.gold);
  } finally {
    await info.attach('native-stat-scroll-bank', { body: JSON.stringify({ observations, completions, native: await native(live,scroll).catch(String),
      activity: (await live.state()).merchantActivity.slice(-20) }), contentType: 'application/json' });
  }
});

test('a stale stat mark cannot fabricate a completed delivery stat',async({live},info)=>{
 test.setTimeout(180_000);
 const item={name:'helmet',level:0,stat_type:'dex'},completions:any[]=[];
 const observe=(request:any)=>{if(new URL(request.url()).pathname.endsWith('/merchant/complete'))completions.push(request.postDataJSON());};
 live.clients[merchant].page.on('request',observe);
 try{
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(()=>{const p=get_player('${merchant}');if(p.items[20]||p.items[21])throw Error('Stat fixture slots occupied');p.items[20]=${JSON.stringify(item)};p.items[21]={name:'strscroll',q:1};cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.find((entry:any)=>entry?.slot===20)?.item,{timeout:30_000}).toEqual(item);
  await live.post('/command',{character:merchant,type:'stat-scroll-mark',slot:20,item,statType:'str'});
  await live.post('/command',{character:merchant,type:'give',slot:20,item,target:'E2EWarrior'});
  const before=await native(live);
  await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[20].stat_type='int';cache_player_items(p);resend(p,'reopen+cid');return p.items[20];})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[20]?.stat_type,{timeout:30_000}).toBe('int');
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{const state=await live.state();return state.statScrolls[merchant]?.length===0&&state.merchantDeliveries.E2EWarrior?.length===1&&state.merchantDeliveries.E2EWarrior[0].blocked==='Reserved delivery item missing';},{timeout:90_000}).toBe(true);
  const state=await live.state(),after=await native(live),delivery=state.merchantDeliveries.E2EWarrior[0];
  expect(delivery.item).toEqual(item);expect(after.helmet.stat_type).toBe('int');expect(after.carried).toBe(1);expect(after.gold).toBe(before.gold);
  expect(completions.some(body=>body.statScrollsResolved?.some((mark:any)=>mark.statType==='str')&&!(body.statScrollsApplied||[]).length)).toBe(true);
  await info.attach('stale-stat-delivery-evidence',{body:JSON.stringify({before,after,delivery,completions,state}),contentType:'application/json'});
 }finally{live.clients[merchant].page.off('request',observe);}
});
