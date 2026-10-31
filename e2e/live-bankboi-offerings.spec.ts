import {test,expect} from './live-fixtures';

const merchant='E2EMerchant',storage='E2EBankBoi';
test.use({liveHeadless:true});

test('manual BankBoi Lantern triplet survives delivery and restart before one native compound',async({live},info)=>{
  test.setTimeout(300_000);
  // Failure inventory: virtual packs are rejected; the wrong copy is selected;
  // locked/reserved copies join the triplet; storage delivery loses group source
  // slots; generic withdrawals steal inputs; restart replays or loses the group.
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>!(await live.state()).activeSlots.some((s:any)=>s.character===merchant),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>{const op=(await live.state()).steamSwitch;return !op||op.phase==='complete';},{timeout:90_000}).toBe(true);
  await live.post('/slots/1/spawn',{character:merchant});
  await expect.poll(async()=>(await live.state()).characters[merchant]?.runtime,{timeout:90_000}).toBe('headless');
  await live.post('/merchant/force-stand',{enabled:true});
  const items=[...Array.from({length:3},()=>({name:'lantern',level:2})),{name:'lantern',level:2,l:'l'}];
  const bank=await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});c.info.items=${JSON.stringify(items)};await db.collection('character').replaceOne({_id:c._id},c);
    const items0=Array.from({length:42},()=>({name:'coat',level:0})),items1=Array.from({length:42},(_,i)=>i<35?{name:'coat',level:0}:null);
    await db.collection('user').updateOne({_id:c.owner},{$set:{'info.items0':items0,'info.items1':items1}});
    return {gold:0,packs:{items0:items0.map((item,slot)=>({slot,item})),items1:items1.map((item,slot)=>item?{slot,item}:null)}};})()`);
  await live.post('/bankboi/checkpoint',{character:merchant,bank});
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:items.map((item,slot)=>({slot,item}))}}}));
  await expect.poll(async()=>(await live.state(true)).merchantCatalog?.allItems?.some((e:any)=>e.id==='lantern'&&e.compoundable),{timeout:30_000}).toBe(true);
  const samples:any[]=[];
  const native=()=>live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),u=await db.collection('user').findOne({_id:c.owner}),p=get_player('${merchant}');return [...c.info.items,...Object.entries(u.info).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v),...(p?.items||[])].filter(i=>i?.name==='lantern');})()`);
  try{
    await live.post('/command',{character:merchant,type:'compound-mark',pack:'bankboi:'+storage,slot:1,item:{name:'lantern',level:2}});
    await expect.poll(async()=>{
      const s=await live.state(),groups=s.compounds[merchant]||[];
      samples.push({at:Date.now(),groups,transaction:s.bankboiTransaction,withdrawals:s.withdrawals[merchant]});
      return groups.length===1&&groups[0].items.length===3&&groups[0].items.every((m:any)=>/^items\d+$/.test(m.storage?.pack))&&!s.bankboiTransaction;
    },{timeout:120_000}).toBe(true);
    const delivered=(await live.state()).compounds[merchant];
    expect(new Set(delivered[0].items.map((m:any)=>m.storage.pack+':'+m.storage.slot)).size).toBe(3);
    expect(delivered[0].items.every((m:any)=>!m.item.l&&m.item.level===2)).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>(await live.state()).compounds[merchant]).toEqual(delivered);
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      return (s.compounds[merchant]||[]).length===0&&
        s.merchantActivity.filter((a:any)=>a.message==='Group 1 compounded'||a.message==='Group 1 compound failed').length===1&&
        n.filter((i:any)=>i.level===2&&!i.l).length===0&&n.filter((i:any)=>i.l==='l').length===1&&
        n.filter((i:any)=>i.level===3).length<=1;
    },{timeout:120_000}).toBe(true);
  }finally{
    await info.attach('native-bankboi-manual-lantern-compound',{body:JSON.stringify({samples,native:await native(),state:await live.state()}),contentType:'application/json'});
  }
});

test('safe maintenance waits for the active BankBoi instead of the stopped merchant',async({live},info)=>{
  test.setTimeout(240_000);
  // Failure inventory: recent merchant telemetry survives its native logout;
  // maintenance waits forever for that old owner, misses the replacement, or
  // admits another slot swap during the hold. Native worker lifecycle and
  // client acknowledgements must prove the roster, rather than seeded receipts.
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>!(await live.state()).activeSlots.some((s:any)=>s.character===merchant),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>{const op=(await live.state()).steamSwitch;return !op||op.phase==='complete';},{timeout:90_000}).toBe(true);
  await live.post('/slots/1/spawn',{character:merchant});
  await expect.poll(async()=>(await live.state()).characters[merchant]?.runtime,{timeout:90_000}).toBe('headless');
  // Keep remote storage away from the bank so the maintenance request can
  // observe its real slot occupancy before the visit completes.
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});Object.assign(c.info,{map:'winterland',in:'winterland',x:0,y:0,items:[{name:'offeringp',q:1}]});await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:[{slot:0,item:{name:'offeringp',q:1}}]}}}));
  await live.post('/command',{character:merchant,type:'withdraw',pack:'bankboi:'+storage,slot:0,item:{name:'offeringp',q:1}});
  const samples:any[]=[];
  try{
    await expect.poll(async()=>(await live.state()).activeSlots.some((s:any)=>s.character===storage),{timeout:90_000}).toBe(true);
    live.consoleDrainLease('bankboi-safe-handoff');
    await expect.poll(async()=>{
      const state=await live.state();
      const maintenance=await fetch(live.deploymentPaths.apiUrl+'/party-api/console-maintenance').then(r=>r.json());
      samples.push({at:Date.now(),maintenance,slots:state.activeSlots,transaction:state.bankboiTransaction,
        merchant:state.characters[merchant]?.consoleMaintenance,storage:state.characters[storage]?.consoleMaintenance});
      return maintenance.id==='bankboi-safe-handoff'&&maintenance.ready&&
        state.activeSlots.some((s:any)=>s.character===storage)&&
        state.characters[storage]?.consoleMaintenance?.ready===true;
    },{timeout:30_000}).toBe(true);
  }finally{
    await info.attach('native-bankboi-safe-handoff',{body:JSON.stringify({samples,state:await live.state()}),contentType:'application/json'});
    live.consoleDrainLease(null);
  }
});

test('automatic NPC sales retrieve BankBoi stock and preserve kept and locked copies',async({live},info)=>{
  test.setTimeout(300_000);
  // Failure inventory: remote stock is never discovered; duplicate requests sell
  // twice; keep/locked copies are retrieved; delivery is mistaken for sale; a
  // restart recreates completed demand. Native storage, sales and persistence
  // remain authoritative after the declared offline inventory input.
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>!(await live.state()).activeSlots.some((s:any)=>s.character===merchant),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>{const op=(await live.state()).steamSwitch;return !op||op.phase==='complete';},{timeout:90_000}).toBe(true);
  await live.post('/slots/1/spawn',{character:merchant});
  await expect.poll(async()=>(await live.state()).characters[merchant]?.runtime,{timeout:90_000}).toBe('headless');
  const items=[...Array.from({length:5},()=>({name:'throwingstars',level:0})),{name:'helmet',level:0,l:'l'}];
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});c.info.items=${JSON.stringify(items)};await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{withdrawals:false,'auto npc sales':false}});
  await live.post('/merchant/auto-npc-sale',{item:{name:'throwingstars',level:0},keep:2});
  await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:0});
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:items.map((item,slot)=>({slot,item}))}}}));
  const observations:any[]=[];
  const native=()=>live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),u=await db.collection('user').findOne({_id:c.owner}),p=get_player('${merchant}');return {storage:c.info.items,bank:Object.entries(u.info).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v),merchant:p?.items||[]};})()`);
  try{
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      observations.push({at:Date.now(),withdrawals:s.withdrawals[merchant],transaction:s.bankboiTransaction,current:s.merchantCurrent,native:n});
      if(observations.length>128)observations.shift();
      const all=[...n.storage,...n.bank,...n.merchant].filter(Boolean);
      return all.filter((i:any)=>i.name==='throwingstars').length===2 &&
        all.some((i:any)=>i.name==='helmet'&&i.l==='l') &&
        !s.bankboiTransaction && !(s.withdrawals[merchant]||[]).length &&
        s.merchantActivity.filter((a:any)=>a.message.includes('Sold')&&a.message.includes('throwingstars')).length===3;
    },{timeout:180_000,intervals:[250,500]}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      return [...n.storage,...n.bank,...n.merchant].filter((i:any)=>i?.name==='throwingstars').length===2 &&
        !s.bankboiTransaction && !(s.withdrawals[merchant]||[]).length;
    }).toBe(true);
  }finally{
    await info.attach('automatic-bankboi-npc-sales',{body:JSON.stringify({observations,native:await native(),state:await live.state()}),contentType:'application/json'});
  }
});
test('BankBoi compound inputs admit merchant work only after native bank delivery',async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>!(await live.state()).activeSlots.some((slot:any)=>slot.character===merchant),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>{const op=(await live.state()).steamSwitch;return !op||op.phase==='complete';},{timeout:90_000}).toBe(true);
  await live.post('/slots/1/spawn',{character:merchant});
  await expect.poll(async()=>{const c=(await live.state()).characters[merchant];return c?.runtime==='headless'&&Date.now()-c.seenAt<3000;},{timeout:90_000}).toBe(true);
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});
    c.info.items=[{name:'stramulet',level:0},{name:'stramulet',level:0},{name:'stramulet',level:0}];
    await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
  const observations:any[]=[];
  let sawRemote=false,native:any;
  try{
    await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:[0,1,2].map(slot=>({slot,item:{name:'stramulet',level:0}}))}},
      autoCompounds:{[merchant]:[{name:'stramulet',targetTier:1,quantity:1}]}}));
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':true}});
    await expect.poll(async()=>{
      const state=await live.state();
      native=await live.admin(`output=(async()=>{const p=get_player('${merchant}');if(!p)return null;const u=await db.collection('user').findOne({_id:p.owner});return {bank:Object.entries(u.info).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v).filter(i=>i&&i.name==='stramulet'),items:p.items.filter(i=>i&&i.name==='stramulet')};})()`);
      const remote=(state.withdrawals[merchant]||[]).some((r:any)=>String(r.pack).startsWith('bankboi:'));
      if(remote)sawRemote=true;
      const job=state.merchantCurrent;
      if(observations.length===128)observations.shift();
      observations.push({at:Date.now(),remote,job,transaction:state.bankboiTransaction,native});
      // With no carried/native-bank triple, unresolved remote inputs alone
      // must not start an improvement visit. Other merchant work stays allowed.
      if(remote&&!native?.bank.length&&!native?.items.length)
        expect(job?.reason).not.toBe('auto compound');
      return native&&[...native.bank,...native.items].filter((i:any)=>(i.level||0)===0).length===0&&
        state.merchantActivity.some((a:any)=>a.message==='Auto compounded stramulet to +1'||a.message==='Auto compound failed for stramulet');
    },{timeout:270_000,intervals:[250,500]}).toBe(true);
    expect(sawRemote).toBe(true);
    expect([...native.bank,...native.items].filter((i:any)=>i.level===1).length).toBeLessThanOrEqual(1);
    expect((await live.post('/merchant/production',{character:merchant,action:'pending'})).pending).toEqual([]);
  }finally{
    await info.attach('native-bankboi-compound-admission',{body:JSON.stringify({sawRemote,native,observations,state:await live.state()}),contentType:'application/json'});
  }
});
for(const automatic of [false,true]) for(const interruption of (automatic?['none','handoff','delivery']:['none','handoff','delivery','remote input'])) test(`BankBoi-only offering supplies ${automatic?'required automatic':'manual'} native upgrade (${interruption})`,async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=> (await live.state()).activeSlots.some((slot:any)=>slot.character===merchant),{timeout:90_000}).toBe(false);
  await expect.poll(async()=>{const operation=(await live.state()).steamSwitch;return !operation||operation.phase==='complete';},{timeout:90_000}).toBe(true);
  await expect.poll(()=>live.admin(`output=!!get_player('${merchant}')`),{timeout:30_000}).toBe(false);
  await live.post('/slots/1/spawn',{character:merchant});
  await expect.poll(async()=>{
    const report=(await live.state()).characters[merchant];
    return report?.runtime==='headless' && Date.now()-report.seenAt<=3000;
  },{timeout:90_000}).toBe(true);
  // The offline storage inventory is a declared account input. All subsequent
  // slot handoffs, bank deposits/withdrawals and upgrade responses stay native.
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});
    c.info.items=[{name:'offeringp',q:1},{name:'offeringp',q:1},{name:'offeringp',q:1}${interruption==='remote input'?",{name:'helmet',level:0}":''}];await db.collection('character').replaceOne({_id:c._id},c);
    const p=get_player('${merchant}');p.items[20]={name:'wand',level:8};p.items[21]={name:'wand',level:8};cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=> (await live.state()).characters[merchant]?.items[20]?.item?.name).toBe('wand');
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:interruption==='remote input'?'error':'ready',...(interruption==='remote input'?{error:'POST /merchant/bank-sort/checkpoint · network',retryAt:0}:{}),items:[...[0,1,2].map(slot=>({slot,item:{name:'offeringp',q:1}})),...(interruption==='remote input'?[{slot:3,item:{name:'helmet',level:0}}]:[])]}},...(interruption==='remote input'?{autoUpgradeMarks:{[merchant]:{'helmet@+0':{tiers:1,quantity:-1}}}}:{})}));
  await expect.poll(async()=> (await live.state()).upgradeOfferingStock.offeringp).toBe(3);
  {
    await expect.poll(async()=> (await live.state(true)).merchantCatalog?.allItems?.some((entry:any)=>
      entry.id==='wand' && (entry.upgradeable || entry.meta?.upgradeable)),
    {timeout:120_000,message:'Native upgrade catalog must authorize the offering rule'}).toBe(true);
    await live.post('/command',{character:merchant,type:'upgrade-offering-rule',rule:{name:'wand',floor:8,ceiling:9,offering:'offeringp',required:true}});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto upgrade':true}});
  }
  await live.post('/command',{character:merchant,type:automatic?'auto-upgrade-mark':'upgrade-mark',slot:20,item:{name:'wand',level:8},tiers:1});
  if(!automatic) await live.post('/command',{character:merchant,type:'upgrade-mark',slot:21,item:{name:'wand',level:8},tiers:1});
  const observations:any[]=[];
  let native:any,restarted=false,sawSupplyDependency=false;
  const checkedUpgradeAdmissions=new Set<string>();
  try {
  await expect.poll(async()=>{
    const state=await live.state();
    sawSupplyDependency ||= !!state.merchantCurrent?.offeringSupply || state.merchantQueue.some((job:any)=>job.offeringSupply);
    if(interruption==='remote input'&&state.merchantCurrent?.reason==='auto upgrade'&&!checkedUpgradeAdmissions.has(state.merchantCurrent.id)) {
      checkedUpgradeAdmissions.add(state.merchantCurrent.id);
      const available=[...(state.characters[merchant]?.items||[]),...Object.values(state.bank?.packs||{}).flat()];
      expect(available.some((entry:any)=>entry?.item?.name==='helmet'&&(entry.item.level||0)===0),'Remote-only upgrade work must await native input delivery').toBe(true);
    }
    if(observations.length>=256) observations.shift();
    observations.push({at:Date.now(),transaction:state.bankboiTransaction,withdrawals:state.withdrawals[merchant],current:state.merchantCurrent,queue:state.merchantQueue,upgrades:state.upgrades[merchant],activity:state.merchantActivity.slice(-5)});
    native=await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),p=get_player('${merchant}');if(!p)return null;
      const worker=get_player('${storage}'),u=await db.collection('user').findOne({_id:p.owner});
      const all=[...(worker?worker.items:c.info.items||[]),...p.items,...Object.entries(p.user||u.info).filter(([key,value])=>/^items\\d+$/.test(key)&&Array.isArray(value)).flatMap(([,value])=>value)];
      return {remaining:all.filter(i=>i&&i.name==='offeringp').reduce((n,i)=>n+(i.q||1),0),helmets:all.filter(i=>i&&i.name==='wand'),merchantItems:p.items,storageItems:worker?worker.items:c.info.items};})()`);
    const delivered=(state.characters[merchant]?.items || []).some((entry:any)=>entry?.item?.name==='offeringp');
    if(!restarted && ((interruption==='handoff' && state.bankboiTransaction) || (interruption==='delivery' && delivered))){
      const targets=(state.upgrades[merchant] || []).map((mark:any)=>({item:mark.item,tiers:mark.tiers,requestId:mark.requestId}));
      await live.restartCoordinator();restarted=true;
      const recovered=(await live.state()).upgrades[merchant] || [];
      for(const target of targets) expect(recovered.some((mark:any)=>mark.item.name===target.item.name && mark.item.level===target.item.level && mark.tiers===target.tiers && mark.requestId===target.requestId)).toBe(true);
    }
    return native?.remaining===1 && native.helmets.length<=2 && !native.helmets.some((item:any)=>(item.level||0)===8);
  },{timeout:270_000}).toBe(true);
  expect(native.helmets.length).toBeLessThanOrEqual(2);
  if(native.helmets.length) expect(native.helmets[0].level).toBe(9);
  await expect.poll(async()=> (await live.post('/merchant/production',{character:merchant,action:'pending'})).pending).toEqual([]);
  if(['handoff','delivery'].includes(interruption)) expect(restarted).toBe(true);
  expect(sawSupplyDependency).toBe(true);
  } finally {
  await info.attach('native-bankboi-offering-upgrade',{body:JSON.stringify({automatic,interruption,restarted,sawSupplyDependency,native,observations,state:await live.state()}),contentType:'application/json'});
  }
});


for(const source of ['carried','native bank','optional absent','required absent','protected']) test(`ordinary manual offering stock boundary: ${source}`,async({live},info)=>{
  test.setTimeout(240_000);
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>!(await live.state()).activeSlots.some((slot:any)=>slot.character===merchant),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>{const op=(await live.state()).steamSwitch;return !op||op.phase==='complete';},{timeout:90_000}).toBe(true);
  await live.post('/slots/1/spawn',{character:merchant});
  await expect.poll(async()=>{const c=(await live.state()).characters[merchant];return c?.runtime==='headless'&&Date.now()-c.seenAt<3000;},{timeout:90_000}).toBe(true);
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');p.items[20]={name:'helmet',level:0};p.items[22]={name:'scroll0',q:10};
    ${source==='carried'?"p.items[24]={name:'offeringp',q:2};":source==='protected'?"p.items[24]={name:'offeringp',q:2,l:'l'};":source==='native bank'?"const bank=await db.collection('user').findOne({_id:p.owner});bank.info.items0[0]={name:'offeringp',q:2};await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':bank.info.items0}});if(p.user)p.user.items0=bank.info.items0;":''}
    cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>(await live.state()).characters[merchant]?.items[20]?.item?.name).toBe('helmet');
  if(source==='native bank') {
    const bank=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner});return {gold:0,packs:{items0:u.info.items0.map((item,slot)=>item?{slot,item}:null)}};})()`);
    await live.post('/bankboi/checkpoint',{character:merchant,bank});
  }
  const required=source!=='optional absent'&&source!=='protected';
  await live.post('/command',{character:merchant,type:'upgrade-offering-rule',rule:{name:'helmet',floor:0,ceiling:1,offering:'offeringp',required}});
  await live.post('/command',{character:merchant,type:'upgrade-mark',slot:20,item:{name:'helmet',level:0},tiers:1});
  const observations:any[]=[];let native:any;
  try {
    if(source==='required absent') {
      await expect.poll(async()=>{const state=await live.state();observations.push(state.upgrades[merchant]);return state.upgrades[merchant]?.some((mark:any)=>mark.waitingOffering);},{timeout:90_000}).toBe(true);
      const before=await live.admin(`output=get_player('${merchant}').items[20]`);
      expect(before).toMatchObject({name:'helmet',level:0});
      await live.restartCoordinator();
      await expect.poll(async()=>(await live.state(true)).merchantCatalog?.allItems?.some((item:any)=>item.id==='helmet'&&(item.upgradeable||item.meta?.upgradeable)),{timeout:90_000}).toBe(true);
      const state=await live.state(),rule=state.upgradeOfferingRules.find((rule:any)=>rule.name==='helmet');
      expect(state.upgrades[merchant]).toHaveLength(1);
      await live.post('/command',{character:merchant,type:'upgrade-offering-rule',rule:{...rule,required:false}});
    }
    await expect.poll(async()=>{
      const state=await live.state();if(observations.length>=128)observations.shift();observations.push({upgrades:state.upgrades[merchant],job:state.merchantCurrent,withdrawals:state.withdrawals[merchant]});
      native=await live.admin(`output=(async()=>{const p=get_player('${merchant}');if(!p)return null;const u=await db.collection('user').findOne({_id:p.owner});const all=[...p.items,...Object.entries(p.user||u.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v)];return {helmets:all.filter(i=>i&&i.name==='helmet'),offerings:all.filter(i=>i&&i.name==='offeringp').reduce((sum,i)=>sum+(i.q||1),0)};})()`);
      return native && !native.helmets.some((item:any)=>(item.level||0)===0) && !(state.upgrades[merchant] || []).length;
    },{timeout:120_000}).toBe(true);
    expect(native.offerings).toBe(source==='carried'||source==='native bank'?1:source==='protected'?2:0);
    for(const item of native.helmets) expect(item.level).toBe(1);
  } finally {
    await info.attach('native-offering-stock-boundary',{body:JSON.stringify({source,native,observations,state:await live.state()}),contentType:'application/json'});
  }
});




test('BankBoi drains all seven reserve cells after a persisted movement timeout', async ({live}, info) => {
  test.setTimeout(300_000);
  // Failure inventory: an expired transport error permanently excludes the worker;
  // retry ignores its cooldown; cargo is lost/duplicated; native completion arrives
  // before queue cleanup or merchant restoration; restart replays completed cargo.
  const merchant='E2EMerchant', storage='E2EBankBoi';
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>!(await live.state()).activeSlots.some((s:any)=>s.character===merchant),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>{const op=(await live.state()).steamSwitch;return !op||op.phase==='complete';},{timeout:90_000}).toBe(true);
  await live.post('/slots/1/spawn',{character:merchant});
  await expect.poll(async()=> (await live.state()).characters[merchant]?.runtime,{timeout:90_000}).toBe('headless');
  const bank=await live.admin(`output=(async()=>{
    const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner});
    u.info.items0=Array.from({length:42},()=>({name:'coat',level:0}));
    u.info.items1=Array.from({length:42},(_,i)=>({name:i<35?'coat':'helmet',level:0}));
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':u.info.items0,'info.items1':u.info.items1}});
    const c=await db.collection('character').findOne({'info.name':'${storage}'});c.info.items=Array(42).fill(null);
    await db.collection('character').replaceOne({_id:c._id},c);
    return {gold:0,packs:Object.fromEntries(['items0','items1'].map(pack=>[pack,u.info[pack].map((item,slot)=>({slot,item}))]))};
  })()`);
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'error',error:'POST /movement-plan · timeout',retryAt:0,items:[]}}}));
  await live.post('/bankboi/checkpoint',{character:merchant,bank});
  const observations:any[]=[];
  const native=()=>live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),u=await db.collection('user').findOne({_id:c.owner});return {items:c.info.items,bank:u?.info.items1};})()`);
  try {
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      observations.push({at:Date.now(),queue:s.bankboiQueue,transaction:s.bankboiTransaction,workers:s.bankbois,native:n});
      if(observations.length>128)observations.shift();
      const worker=s.bankbois.find((w:any)=>w.name===storage);
      return n.items.filter((i:any)=>i?.name==='helmet').length===7 &&
        n.bank.slice(35,42).every((i:any)=>!i) && s.bankboiQueue.length===0 &&
        !s.bankboiTransaction && worker?.state==='ready' &&
        s.activeSlots.some((slot:any)=>slot.character===merchant);
    },{timeout:180_000,intervals:[250,500]}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      return s.bankboiQueue.length===0 && !s.bankboiTransaction && n.items.filter((i:any)=>i?.name==='helmet').length===7;
    }).toBe(true);
  } finally {
    await info.attach('bankboi-reserve-timeout-recovery',{body:JSON.stringify({observations,native:await native(),state:await live.state()}),contentType:'application/json'});
  }
});

