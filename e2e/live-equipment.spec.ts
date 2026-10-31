import { test, expect } from './live-fixtures';

// Failure modes: capacity still admits travel/tool swaps/casts; blocked work
// advances a cooldown; one mode bypasses the reserve; freeing space never resumes.
const gatheringTest=test.extend({initialGatheringReady:true});
gatheringTest('merchant gathering waits at capacity without resetting cooldowns',async({live,page},info)=>{
  const name='E2EMerchant';
  for(const mode of ['fishing','mining'])await live.post('/merchant/gather',{mode,enabled:false});
  async function standReady(gatheringEnabled=false){
    const observations:any[]=[];
    try{await expect.poll(async()=>{
    const [state,response,native]=await Promise.all([live.state(),fetch(live.url+'/party-api/state?section=fast',{signal:AbortSignal.timeout(15_000)}),
      live.clients[name].frame.evaluate(()=>{
        const root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
        return {stand:!!root.character.stand,inventoryCommands:Number(root.__partyInventoryCommands)||0,
          tidy:!!root.__merchantInventoryTidy,mode:root.__merchantGatheringSession?.mode,
          blocked:root.__merchantGatheringBlockedReason,attempt:!!root.__merchantGatheringAttempt};
      })]);
    expect(response.ok).toBe(true);
    const fast=await response.json();expect(fast.pendingCommands).toEqual(expect.any(Object));
    observations.push({at:Date.now(),seenAt:state.characters[name]?.seenAt,stand:state.characters[name]?.standOpen,
      command:fast.pendingCommands[name],native});
    if(observations.length>100)observations.shift();
    // Queue removal and opening the native stand precede completion of the
    // client's reconciliation. Wait for its inventory owner to release too.
    return state.characters[name]?.standOpen && fast.pendingCommands[name]?.type!=='merchant-idle'&&
      native.stand&&native.inventoryCommands===0&&!native.tidy&&!native.attempt&&
      native.blocked!=='stand operation'&&(!gatheringEnabled||native.mode==='fishing');
    },{timeout:90_000,message:'Native stand return and reconciliation must finish before the capacity-only fixture'}).toBe(true);
    }finally{await info.attach('native-stand-readiness',{body:JSON.stringify({gatheringEnabled,observations}),contentType:'application/json'});}
  }
  const standTool=await live.admin(`output=(()=>{const p=get_player('${name}');
    if(!G.items.stand0.stand)throw new Error('Native stand0 definition missing');
    p.items[12]={name:'stand0'};cache_player_items(p);resend(p,'reopen+cid');return p.items[12];})()`);
  expect(standTool).toEqual({name:'stand0'});
  await info.attach('declared-native-stand-tool',{body:JSON.stringify(standTool),contentType:'application/json'});
  await expect.poll(async()=>(await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='stand0')).toBe(true);
  await live.post('/merchant/force-stand',{enabled:true});
  await standReady();
  const seed=await live.admin(`output=(()=>{const p=get_player('${name}');
    const stand=p.items.find(item=>item?.name==='stand0');if(!stand)throw new Error('Native merchant stand tool missing before capacity seed');
    // Keep the initial potion supply: removing it admits native self-restock
    // while this case is measuring the independent gathering capacity guard.
    const potions=['hpot1','mpot1'].map(name=>p.items.find(item=>item?.name===name));
    if(potions.some(item=>!item))throw new Error('Capacity fixture requires the initial native potion supply');
    for(let i=0;i<42;i++)p.items[i]=i<39?{name:'helmet',level:0}:null;
    p.items[0]=potions[0];p.items[1]=potions[1];p.items[12]=stand;
    p.items[10]={name:'rod',level:0};p.items[11]={name:'pickaxe',level:0};
    cache_player_items(p);resend(p,'reopen+cid');return {items:p.items,last:{fishing:p.last.fishing,mining:p.last.mining}};})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.filter(Boolean).length).toBe(39);
  // Native timestamps were declared before login. Observe the genuine client
  // and coordinator agreement; never clear cooldowns while exercising capacity.
  let availability:any;
  await expect.poll(async()=>{
    const [state,client,server]=await Promise.all([live.state(),live.clients[name].frame.evaluate(()=>{
      const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      return {now:Date.now(),next:Object.fromEntries(['fishing','mining'].map(mode=>[mode,Number(new Date(game.next_skill[mode]||0))])),
        recorded:{...root.__merchantGatheringCooldowns},session:!!root.__merchantGatheringSession,attempt:!!root.__merchantGatheringAttempt};
    }),live.admin(`output=(()=>{const p=get_player('${name}');return {fishing:p.last.fishing,mining:p.last.mining};})()`)]);
    availability={coordinator:state.gatheringCooldowns,client,server};
    return !client.session&&!client.attempt&&['fishing','mining'].every(mode=>
      Number(new Date(server[mode]))===0&&Number(client.next[mode])<=client.now&&
      Number(client.recorded[mode]||0)===0&&Number(state.gatheringCooldowns[mode]||0)===0);
  },{timeout:15000,message:'Declared available native gathering skills must agree before capacity testing'}).toBe(true);
  await info.attach('native-gathering-initial-availability',{body:JSON.stringify(availability),contentType:'application/json'});
  const before=(await live.state()).gatheringCooldowns;
  await live.post('/merchant/force-stand',{enabled:false});
  for(const mode of ['fishing','mining'])await live.post('/merchant/gather',{mode,enabled:true});
  await page.goto(live.url);await page.getByText(/Merchant logistics ·/).click();
  await expect(page.locator('details').filter({has:page.locator('summary').getByText(/Merchant logistics/)}).getByText('BLOCKED',{exact:true})).toHaveCount(2);
  // Enabling gathering can admit another stand reconciliation. Its completion
  // is separate from the dashboard's capacity decision. Observe that real
  // operation before starting the capacity-only observation window.
  await standReady(true);
  await expect.poll(async()=>{
    const state=await live.state(),merchant=state.characters[name];
    expect(state.gatheringCooldowns).toEqual(before);
    expect(merchant?.gatheringActive).toBe(false);
    expect(merchant?.gatheringAttemptId??null).toBe(null);
    return merchant?.standOpen&&merchant.gatheringBlockedReason==='inventory capacity';
  },{timeout:15_000,message:'Settled native stand must publish the capacity block without a gathering attempt'}).toBe(true);
  const after=await live.state();expect(after.gatheringCooldowns).toEqual(before);
  const native=await live.admin(`output=(()=>{const p=get_player('${name}');return {items:p.items,last:{fishing:p.last.fishing,mining:p.last.mining}};})()`);
  expect(Object.values(native.last).map(value=>new Date(value as string).getTime())).toEqual([0,0]);
  await info.attach('native-gathering-capacity',{body:JSON.stringify({seed,before,after,native}),contentType:'application/json'});
  await info.attach('native-gathering-blocked',{body:await page.screenshot(),contentType:'image/png'});
  // Native potion restocking can occupy one reserve cell after the initial
  // seed. Free two helmets so that real capacity crosses below 39 occupied.
  await live.admin(`output=(()=>{const p=get_player('${name}');p.items[37]=p.items[38]=null;cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
  await expect(page.getByText('BLOCKED',{exact:true})).toHaveCount(0);
});

// Failure modes: an old weapon preference overrides manual Equip; gathering
// retains obsolete displaced gear; restart forgets the new preference; any
// swap loses the weapon or tool. Observe native tool equip and native restore.
async function gatheringCommandSnapshot(live:import('./live-fixtures').LiveGame,name:string){
  return live.clients[name].frame.evaluate(()=>{
    const root=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
    const attempt=root?.__merchantGatheringAttempt;
    return {at:Date.now(),runtime:root?.__partyRuntimeGeneration,lastCommand:root?.__partyLastCommand,
      inventoryCommands:root?.__partyInventoryCommands,generation:root?.__merchantGatheringGeneration,
      blocked:root?.__merchantGatheringBlockedReason,holdUntil:root?.__merchantLogisticsHoldUntil,
      attempt:attempt&&{id:attempt.id,mode:attempt.mode,phase:attempt.phase,cancelled:attempt.cancelled,waitingCommand:attempt.waitingCommand},
      session:root?.__merchantGatheringSession,status:root?.__partyStatusDiagnostics?.slice(-6)};
  });
}

for(const delayedStop of [false,true]){
gatheringTest('manual merchant weapon remains selected through gathering and restart'+(delayedStop?' across delayed native stop completion':''),async({live,page},info)=>{
  test.setTimeout(300_000);
  const name='E2EMerchant';
  for (const mode of ['fishing','mining'])
    await live.post('/merchant/gather',{mode,enabled:false});
  await expect.poll(async()=> (await live.state()).gatheringModes,{timeout:30_000}).toEqual([]);
  await expect.poll(()=>live.clients[name].frame.evaluate(()=>{
    const root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    return !root.__merchantGatheringSession && !root.__merchantGatheringAttempt;
  }),{timeout:30_000}).toBe(true);
  // Declare availability before native login. Clearing a live cooldown races
  // status replies already in the browser, which correctly preserve known
  // cooldowns. Observe agreement without rewriting live skill state.
  let availability:any;
  await expect.poll(async()=>{
    const [state,client,server]=await Promise.all([live.state(),live.clients[name].frame.evaluate(()=>{
      const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      return {now:Date.now(),next:Object.fromEntries(['fishing','mining'].map(mode=>[mode,Number(new Date(game.next_skill[mode]||0))])),
        recorded:{...root.__merchantGatheringCooldowns},session:!!root.__merchantGatheringSession,attempt:!!root.__merchantGatheringAttempt};
    }),live.admin(`output=(()=>{const p=get_player('${name}');return {fishing:p.last.fishing,mining:p.last.mining};})()`)]);
    availability={coordinator:state.gatheringCooldowns,client,server};
    return !client.session&&!client.attempt&&['fishing','mining'].every(mode=>
      Number(new Date(server[mode]))===0&&Number(client.next[mode])<=client.now&&
      Number(client.recorded[mode]||0)===0&&Number(state.gatheringCooldowns[mode]||0)===0);
  },{timeout:15000,message:'Native gathering availability must agree before the first cast'}).toBe(true);
  await info.attach('native-gathering-initial-availability',{body:JSON.stringify(availability),contentType:'application/json'});

  const seed=await live.admin(`output=(()=>{const p=get_player('${name}');
    if(p.items[10]||p.items[11]||p.items[13])throw Error('Weapon fixture requires empty cells');
    p.items[10]={name:'broom',level:6};p.items[11]={name:'rod',level:0};p.items[13]={name:'pickaxe',level:0};
    p.slots.mainhand={name:'staff',level:0};p.slots.offhand=null;
    cache_player_items(p);p.cslots.mainhand=cache_item(p.slots.mainhand);resend(p,'reopen+cid');
    return {items:p.items,slots:p.slots};})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='broom'),{timeout:30_000}).toBe(true);
  // Seed the existing explicit normal-weapon preference through its public action.
  const old=await live.admin(`output=(()=>{const p=get_player('${name}');p.items[12]=p.slots.mainhand;p.slots.mainhand=null;cache_player_items(p);p.cslots.mainhand=null;resend(p,'reopen+cid');return p.items[12];})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.slot===12&&entry.item.name==='staff'),{timeout:30_000}).toBe(true);
  await live.post('/command',{type:'merchant-weapon',character:name,slot:12,item:old});
  // Failure inventory: the periodic gathering tick and the status wake both
  // land inside asynchronous command preflight, so an available skill never
  // resumes after Equip. Deliver only due gathering intervals at that boundary;
  // native movement, status traffic, inventory packets and other timers stay live.
  await live.clients[name].frame.evaluate(delayedStop=>{
    const root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    const game=window as any,native=root.__partyNativeMovement;
    const fault:any=root.__e2eGatheringPhase={armed:false,due:[] as Array<()=>void>,deliveries:[],original:root.setInterval,
      originalAjax:root.$.ajax,originalStop:native.stop,statuses:[] as any[],equipment:[] as any[],handoff:null as any};
    fault.observeEquip=(event:string,data:any)=>{if(event==='equip')fault.equipment.push({at:Date.now(),commandId:root.__partyLastCommand,
      data:{...data},item:JSON.parse(JSON.stringify(root.character.items[data.num]||null))});};
    game.socket.onAnyOutgoing(fault.observeEquip);
    if(delayedStop){
      root.$.ajax=function(options:any){const request=fault.originalAjax.apply(this,arguments);
        if(String(options.url).endsWith('/status'))request.done((state:any)=>fault.statuses.push({at:Date.now(),
          command:state.command&&{id:state.command.id,type:state.command.type},lastCommand:root.__partyLastCommand}));
        return request;};
      native.stop=async function(...args:any[]){
        const attempt=root.__merchantGatheringAttempt;
        if(fault.handoff||args[0]||attempt?.cancelled!=='command equip')return fault.originalStop.apply(this,args);
        const handoff:any=fault.handoff={at:Date.now(),attempt:attempt.id,command:fault.statuses.at(-1)?.command};
        const result=await fault.originalStop.apply(this,args);
        await attempt.done;
        handoff.channelReleasedAt=Date.now();
        const deadline=Date.now()+8000;
        while(Date.now()<deadline){
          const successor=fault.statuses.find((entry:any)=>entry.at>handoff.channelReleasedAt&&entry.command);
          if(successor&&(successor.command.type==='equip'||root.__partyLastCommand>=successor.command.id)){
            handoff.successor=successor;handoff.completedAt=Date.now();return result;
          }
          await new Promise(resolve=>game.setTimeout(resolve,50));
        }
        throw Error('No genuine command arrived at the owned native stop boundary');
      };
    }
    root.setInterval=function(callback:any,delay:number,...args:any[]){
      const id=fault.original.call(root,()=>{
        if(fault.armed&&id===root.__merchantGatheringTimer)fault.due.push(()=>callback(...args));
        else callback(...args);
      },delay);
      return id;
    };
  },delayedStop);
  let timing:Array<{at:number;owners:number}>=[],faultEvidence:any;
  const preflight=async(route:import('@playwright/test').Route)=>{
    const body=route.request().postDataJSON();
    if(body.character!==name||body.action!=='pending'){await route.continue();return;}
    const response=await route.fetch();
    await live.clients[name].frame.evaluate(()=>{
      const root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      const fault=root.__e2eGatheringPhase;
      if(!fault?.armed)return;
      for(const callback of fault.due.splice(0)){
        fault.deliveries.push({at:Date.now(),owners:root.__partyInventoryCommands});callback();
      }
    });
    await route.fulfill({response});
  };
  await live.clients[name].page.route('**/party-api/merchant/production',preflight);
  let after:any,ownedAttempt:any;
  try {
  // Dashboard setup must not consume the native cast we intend to interrupt.
  await page.goto(live.url);
  const merchant=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  const inventory=merchant.getByRole('button',{name:/^Inventory/});
  if(await inventory.getAttribute('aria-expanded')!=='true')await inventory.click();
  await merchant.getByLabel('Broom',{exact:true}).click({button:'right'});
  await live.post('/merchant/gather',{mode:'fishing',enabled:true});
  await live.post('/merchant/gather',{mode:'mining',enabled:true});
  await expect.poll(async()=> (await live.state()).gatheringModes,{timeout:10_000}).toEqual(expect.arrayContaining(['fishing','mining']));
  await expect.poll(()=>live.admin(`output=['rod','pickaxe'].includes(get_player('${name}')?.slots.mainhand?.name)`),{timeout:90_000}).toBe(true);
  if(delayedStop){
    await expect.poll(async()=>{
      ownedAttempt=await live.clients[name].frame.evaluate(()=>{
        const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
        const attempt=root.__merchantGatheringAttempt;
        return attempt&&{id:attempt.id,phase:attempt.phase,cancelled:attempt.cancelled,mode:attempt.mode,
          at:Date.now(),channel:game.character.c?.[attempt.mode]};
      });
      return !!ownedAttempt&&ownedAttempt.phase==='casting'&&!ownedAttempt.cancelled&&!!ownedAttempt.channel;
    },{timeout:90_000,intervals:[25,50],message:'Equip must interrupt an owned real native gathering cast'}).toBe(true);
    await info.attach('owned-native-gathering-cast',{body:JSON.stringify(ownedAttempt),contentType:'application/json'});
  }
  await live.clients[name].frame.evaluate(()=>{
    const root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    root.__e2eGatheringPhase.armed=true;
  });
  const priorWeaponSequence=Math.max(0,...(await live.clients[name].events()).map(event=>event.sequence||0));
  const requestedAt=await live.clients[name].run('Date.now()');
  await page.getByRole('menuitem',{name:'Equip',exact:true}).click();
  let weaponReceipts:any[]=[];const commandObservations:any[]=[];
  try{
    await expect.poll(async()=>{commandObservations.push(await gatheringCommandSnapshot(live,name));weaponReceipts=(await live.clients[name].events()).filter((event:any)=>event.event==='player'&&event.at>=requestedAt&&event.sequence>priorWeaponSequence&&event.data?.slots?.mainhand).map((event:any)=>({sequence:event.sequence,at:event.at,mainhand:event.data.slots.mainhand}));return weaponReceipts.some(receipt=>receipt.mainhand.name==='broom'&&receipt.mainhand.level===6);},{timeout:30_000,message:'Native item packet must confirm the requested Broom equip'}).toBe(true);
  }finally{await info.attach('native-manual-weapon-equip-receipts',{body:JSON.stringify({requestedAt,priorWeaponSequence,receipts:weaponReceipts.slice(-32),commandObservations}),contentType:'application/json'});}
  await expect.poll(async()=> (await live.state()).merchantWeapon?.item,{timeout:10_000}).toMatchObject({name:'broom',level:6});
  const broomSequence=weaponReceipts.find(receipt=>receipt.mainhand.name==='broom'&&receipt.mainhand.level===6).sequence;
  const resumedObservations:any[]=[];
  try {
    await expect.poll(async()=>{resumedObservations.push(await gatheringCommandSnapshot(live,name));return (await live.clients[name].events()).some((event:any)=>event.event==='player'&&event.sequence>broomSequence&&['rod','pickaxe'].includes(event.data?.slots?.mainhand?.name));},{timeout:90_000,message:'Native gathering tool equip must follow the actual Broom receipt'}).toBe(true);
  } finally {await info.attach('gathering-after-manual-equip',{body:JSON.stringify(resumedObservations),contentType:'application/json'});}
  await live.post('/merchant/gather',{mode:'fishing',enabled:false});
  await live.post('/merchant/gather',{mode:'mining',enabled:false});
  await expect.poll(()=>live.admin(`output=get_player('${name}')?.slots.mainhand`),{timeout:30_000}).toMatchObject({name:'broom',level:6});
  after=await live.state();expect(after.merchantWeapon.item).toMatchObject({name:'broom',level:6});
  } finally {
    // This page owns only this interception. Drain its active responses before
    // removing it; unroute() can continue a request its handler will fulfill.
    await live.clients[name].page.unrouteAll({behavior:'wait'});
    faultEvidence=await live.clients[name].frame.evaluate(()=>{
      const root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      const fault=root.__e2eGatheringPhase;fault.armed=false;root.setInterval=fault.original;
      for(const callback of fault.due.splice(0))callback();
      const game=window as any;game.socket.offAnyOutgoing(fault.observeEquip);
      root.$.ajax=fault.originalAjax;root.__partyNativeMovement.stop=fault.originalStop;
      delete root.__e2eGatheringPhase;return {deliveries:fault.deliveries,handoff:fault.handoff,equipment:fault.equipment};
    });
    timing=faultEvidence.deliveries;
    await info.attach('manual-equipment-handoff',{body:JSON.stringify(faultEvidence),contentType:'application/json'});
    await info.attach('gathering-timer-preflight-collision',{body:JSON.stringify(timing),contentType:'application/json'});
  }
  expect(timing.length,'The fault must deliver due gathering timers during real command preflight').toBeGreaterThan(0);
  expect(timing.every(entry=>entry.owners===1),'Every injected timer must belong to the single active inventory command').toBe(true);
  expect(faultEvidence.equipment.filter((entry:any)=>entry.item?.name==='broom'&&entry.item.level===6&&entry.data.slot===undefined),'Manual Equip must issue exactly one native Broom request').toHaveLength(1);
  if(delayedStop){
    expect(faultEvidence.handoff?.attempt).toBe(ownedAttempt.id);
    expect(faultEvidence.handoff?.command?.type).toBe('equip');
    expect(faultEvidence.handoff?.successor?.command).toEqual(faultEvidence.handoff.command);
  }
  // The fault owns the equip/gathering collision only. Restart exercises genuine
  // browser transport recovery after all interception handlers have drained.
  await live.restartCoordinator();
  await expect.poll(async()=> (await live.state()).merchantWeapon?.item,{timeout:30_000}).toMatchObject({name:'broom',level:6});
  const cargo=await live.admin(`output=(()=>{const p=get_player('${name}');return {items:p.items,slots:p.slots}})()`);
  for(const item of ['staff','broom','rod','pickaxe'])expect([...cargo.items,...Object.values(cargo.slots)].filter((entry:any)=>entry?.name===item)).toHaveLength(1);
  expect(cargo.slots.mainhand).toMatchObject({name:'broom',level:6});
  await info.attach('manual-merchant-weapon-cycle',{body:JSON.stringify({seed,after,cargo,events:await live.clients[name].events()}),contentType:'application/json'});
  await info.attach('manual-merchant-weapon-inventory',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});
}

// Failure modes: orb eligibility hides Equip; menu/command changes the item;
// native equip chooses another slot or silently ignores it; replacement destroys
// the old orb; restarting the coordinator replays or loses the equipped result.
test('Loaded Die equips through the priest inventory menu into the native orb slot',async({live,page},info)=>{
  test.setTimeout(240_000);
  const name='E2EPriest';
  const seed=await live.admin(`output=(()=>{const p=get_player('${name}');
    if(!p||p.items[10])throw Error('Loaded Die fixture requires empty inventory cell 10');
    if(G.items.cave_loaded_die.type!=='orb')throw Error('Native Loaded Die must be orb equipment');
    p.items[10]={name:'cave_loaded_die',level:0};
    p.slots.orb={name:'orbofint',level:0};
    cache_player_items(p);p.cslots.orb=cache_item(p.slots.orb);resend(p,'reopen+cid');
    return {definition:G.items.cave_loaded_die,items:p.items,orb:p.slots.orb};})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='cave_loaded_die'),{timeout:30_000}).toBe(true);
  await page.goto(live.url);
  const priest=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  const inventory=priest.getByRole('button',{name:/^Inventory/});
  if(await inventory.getAttribute('aria-expanded')!=='true')await inventory.click();
  const die=priest.getByLabel('Loaded Die',{exact:true});
  await expect(die).toBeVisible();await die.click({button:'right'});
  await expect(page.getByRole('menuitem',{name:'Equip',exact:true})).toBeVisible();
  await page.getByRole('menuitem',{name:'Equip',exact:true}).click();
  await expect.poll(()=>live.admin(`output=get_player('${name}').slots.orb`),{timeout:30_000}).toMatchObject({name:'cave_loaded_die',level:0});
  const cargo=()=>live.admin(`output=(()=>{const p=get_player('${name}');return {items:p.items,slots:p.slots}})()`);
  const after=await cargo();
  expect(after.items.filter((item:any)=>item?.name==='orbofint')).toHaveLength(1);
  expect([...after.items,...Object.values(after.slots)].filter((item:any)=>item?.name==='cave_loaded_die')).toHaveLength(1);
  await live.restartCoordinator();
  const restarted=await cargo();expect(restarted.slots.orb).toMatchObject({name:'cave_loaded_die',level:0});
  expect(restarted.items.filter((item:any)=>item?.name==='orbofint')).toHaveLength(1);
  await info.attach('loaded-die-native-equipment',{body:JSON.stringify({seed,after,restarted,events:await live.clients[name].events()}),contentType:'application/json'});
  await info.attach('loaded-die-priest-inventory',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

// Failure inventory: missing tools spend gold without consent; independent toggles
// overwrite each other; restart loses consent; an existing tool gets duplicated.
test('gathering tool crafting settings are opt in and persist independently', async ({live},info)=>{
  const initial=(await live.state()).merchantAutomations;
  expect(initial['craft fishing tools']).toBe(false);expect(initial['craft mining tools']).toBe(false);
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'craft fishing tools':true}});
  await live.restartCoordinator();
  await expect.poll(async()=>{const a=(await live.state()).merchantAutomations;return [a['craft fishing tools'],a['craft mining tools']];}).toEqual([true,false]);
  await info.attach('gathering-craft-settings',{body:JSON.stringify((await live.state()).merchantAutomations),contentType:'application/json'});
});

for(const mode of ['fishing','mining'] as const) gatheringTest(`missing ${mode} tool crafts once only after opt in and available materials`,async({live},info)=>{
 test.setTimeout(420_000);
 const merchant='E2EMerchant',tool=mode==='fishing'?'rod':'pickaxe',responses:any[]=[],pending:Promise<void>[]=[];
 const native=()=>live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;return {gold:p.gold+(Number(u.gold)||0),tools:p.items.filter(i=>i&&i.name==='${tool}').length+(p.slots.mainhand?.name==='${tool}'?1:0),bank:Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v).filter(i=>i&&i.name==='${tool}').length};})()`);
 const observe=(response:any)=>{if(!new URL(response.url()).pathname.endsWith('/merchant/order'))return;pending.push((async()=>{responses.push({at:Date.now(),status:response.status(),body:await response.json()});})().catch(()=>{}));};
 live.clients[merchant].page.on('response',observe);
 try {
  await expect.poll(async()=>(await live.state(true)).merchantCatalog?.craftable?.some((choice:any)=>choice.id===tool),{timeout:120_000}).toBe(true);
  const catalog=(await live.state(true)).merchantCatalog,recipe=catalog.craftable.find((choice:any)=>choice.id===tool).materials;
  expect(recipe.length).toBeGreaterThan(0);
  expect(recipe.some((material:any)=>!catalog.buyable.some((choice:any)=>choice.id===material.id))).toBe(true);
  for(const skill of ['fishing','mining'])await live.post('/merchant/gather',{mode:skill,enabled:false});
  // Declared initial inventory removes only these recipe inputs and tools. No
  // native action, craft receipt, result or cooldown is substituted by the fixture.
  const seed=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner}),b=p.user||u.info,names=${JSON.stringify(recipe.map((m:any)=>m.id).concat([tool]))};
    for(const q of Object.values(players).filter(q=>q.owner===p.owner)){q.items=q.items.map(i=>i&&names.includes(i.name)?null:i);cache_player_items(q);resend(q,'reopen+cid');}
    for(const [key,items]of Object.entries(b))if(/^items[0-9]+$/.test(key)&&Array.isArray(items))b[key]=items.map(i=>i&&names.includes(i.name)?null:i);
    if(p.slots.mainhand?.name==='${tool}'){p.slots.mainhand=null;p.cslots.mainhand=null;resend(p,'reopen+cid');}
    if(!p.user)await db.collection('user').replaceOne({_id:u._id},u);return {recipe:${JSON.stringify(recipe)},bankMounted:!!p.user};})()`);
  await expect.poll(async()=>{const n=await native();return n.tools+n.bank;},{timeout:30_000}).toBe(0);
  const before=await native();
  // Default-off missing-tool behavior neither creates an order nor spends gold.
  await live.post('/merchant/gather',{mode,enabled:true});
  await expect.poll(async()=>(await live.state()).gatheringNoTool?.[mode],{timeout:90_000}).toBe(true);
  expect(responses).toHaveLength(0);expect((await native()).gold).toBe(before.gold);
  // An actual no-tool report can already be in flight when the user opts in.
  // Delay only that request; status, movement and every other report stay live.
  let heldNoTool:import('@playwright/test').Route|undefined;
  const holdNoTool=async(route:import('@playwright/test').Route)=>{
    const body=route.request().postDataJSON();
    if(!heldNoTool&&body.noTool===true&&body.mode===mode){heldNoTool=route;return;}
    await route.continue();
  };
  await live.clients[merchant].page.route('**/party-api/merchant/gather-status',holdNoTool);
  try {
    await live.post('/merchant/gather',{mode,enabled:true});
    await expect.poll(()=>!!heldNoTool,{timeout:90_000,message:'Hold the current native no-tool report before opting in'}).toBe(true);
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{['craft '+mode+' tools']:true}});
    const request=heldNoTool!.request();
    await heldNoTool!.continue();
    await expect.poll(async()=>{const response=await request.response();return response&&await response.json();},{timeout:15_000}).toMatchObject({ok:true,noTool:false});
    const state=await live.state();
    expect(state.gatheringModes).toContain(mode);
    expect(state.gatheringNoTool?.[mode]).not.toBe(true);
    await info.attach('late-native-no-tool-report',{body:JSON.stringify({mode,request:request.postDataJSON(),state:{gatheringModes:state.gatheringModes,gatheringNoTool:state.gatheringNoTool}}),contentType:'application/json'});
  } finally {
    await live.clients[merchant].page.unroute('**/party-api/merchant/gather-status',holdNoTool);
    if(heldNoTool)await heldNoTool.continue().catch(()=>{});
  }
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{['craft '+mode+' tools']:true}});
  await live.post('/merchant/gather',{mode,enabled:true});
  await expect.poll(()=>responses.some(response=>response.status===409&&response.body.error==='crafting materials are no longer available'),{timeout:90_000}).toBe(true);
  expect((await native()).gold).toBe(before.gold);
  expect(responses.some(response=>response.status===200)).toBe(false);
  // Provide exactly one native recipe; successful crafting must own and consume it.
  await live.admin(`output=(()=>{const p=get_player('${merchant}');for(const material of ${JSON.stringify(recipe)}){const slot=p.items.findIndex(i=>!i);if(slot<0)throw Error('No material seed slot');p.items[slot]={name:material.id,...(material.level?{level:material.level}:{}),...(material.quantity>1?{q:material.quantity}:{})};}cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>(await native()).tools,{timeout:240_000,message:'Native crafting must produce its missing tool'}).toBe(1);
  await live.post('/merchant/gather',{mode,enabled:false});
  await expect.poll(async()=>{const state=await live.state();return [state.merchantCurrent,...state.merchantQueue].some(job=>job?.order?.crafts?.some((line:any)=>line.id===tool));},{timeout:30_000}).toBe(false);
  await Promise.all(pending);
  const accepted=responses.filter(response=>response.status===200);
  expect(accepted.length).toBeGreaterThan(0);
  expect(new Set(accepted.map(response=>response.body.jobId)).size).toBe(1);
  expect((await native()).tools).toBe(1);
  await info.attach('native-replacement-tool-craft',{body:JSON.stringify({mode,tool,seed,before,after:await native(),responses,events:await live.clients[merchant].events(),state:await live.state()}),contentType:'application/json'});
 } finally {
  live.clients[merchant].page.off('response',observe);await Promise.all(pending);
  await info.attach('gathering-tool-command-observations',{body:JSON.stringify({mode,responses,command:await gatheringCommandSnapshot(live,merchant),state:await live.state()}),contentType:'application/json'});
  await live.post('/merchant/gather',{mode,enabled:false}).catch(()=>{});
 }
});
