import {waitForGameplay} from './network-clock';
import {test,expect} from './live-fixtures';
import {W,P,M,evidence} from './hunt-interruption-helpers';
import {readFileSync} from 'node:fs';
import path from 'node:path';

test.use({loadout:'combat-range',initialPosition:{map:'main',x:1260,y:-70}});
test.describe('native combat drain',()=>{
// Hunt cancellation returns to the configured native Goo farm. Seed the fight
// in that farm so the successor remains observable after the mode turnover.
test.use({initialPosition:{map:'main',x:0,y:787}});
for(const turnover of [false,true]) test('safe console reload finishes the native fight without acquiring the next target'+(turnover?' after Hunt and unjoined event selection turnover':''),async({live},info)=>{
  test.setTimeout(180000);
  // Failure inventory: docs/testing-safe-console-reload.md.
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{goo:999},monsterSearchRadius:300});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  const seeded=await live.admin(`output=(()=>{
    const p=get_player('${W}'),saved=[];
    for(const m of Object.values(instances.main.monsters))if(Math.hypot(m.x-p.x,m.y-p.y)<800){saved.push(m.id);remove_monster(m,{method:'disappear',nospawn:true});}
    const a=new_monster('main',{type:'goo',position:[p.x+30,p.y],radius:0,count:1},{temp:1});
    a.hp=a.max_hp=15000;
    return {first:String(a.id),next:null,map:p.map,x:p.x,y:p.y,removed:saved};
  })()`);
  const hit=(events:any[],id:string)=>events.filter(e=>e.event==='hit'&&String(e.data?.id)===id&&e.data?.hid===W&&e.data?.source==='attack');
  const samples:any[]=[];
  let holdFull=true,delayedFull=0;
  const releases:Array<()=>void>=[];
  await live.clients[W].run(`(()=>{
    globalThis.__safeDrainControls=[];
    $(document).on('ajaxComplete.safeDrainObservation',function(_event,xhr,settings){
      if(!String(settings.url).endsWith('/status'))return;
      const value=xhr.responseJSON;
      globalThis.__safeDrainControls.push({at:Date.now(),status:xhr.status,serverNow:value?.serverNow,
        maintenance:value?.consoleMaintenance,kind:typeof settings.data==='string'&&settings.data.includes('"combatWait":true')?'wait':
          typeof settings.data==='string'&&settings.data.includes('"combatOnly":true')?'report':'full'});
      if(globalThis.__safeDrainControls.length>32)globalThis.__safeDrainControls.shift();
    });
    return true;
  })()`);
  const observerElement=await live.clients[W].frame.$('#maincode');
  const observerFrame=await observerElement?.contentFrame();
  await observerElement?.dispose();
  const delayedStatus=async(route:any)=>{
    const body=route.request().postDataJSON();
    if(!holdFull || body?.combatOnly || body?.combatWait)return route.continue();
    const response=await route.fetch();delayedFull++;
    if(holdFull)await new Promise<void>(resolve=>releases.push(resolve));
    // Native AJAX can abort a deliberately delayed full report at its deadline.
    // Preserve that transport failure without masking the behavior assertion.
    try{await route.fulfill({response});}catch(error){
      if(!route.request().failure())throw error;
      samples.push({at:Date.now(),delayedFullAborted:route.request().failure()});
    }
  };
  try{
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.first).length,{timeout:45000}).toBeGreaterThan(0);
    const before=hit(await live.clients[W].events(),seeded.first).length;
    seeded.next=await live.admin(`output=(()=>{const m=new_monster('main',{type:'goo',position:[${seeded.x+85},${seeded.y}],radius:0,count:1},{temp:1});m.hp=m.max_hp=15000;return String(m.id);})()`);
    await expect.poll(()=>live.clients[W].run(`sharedRoutine.queueMarkers().some(m=>m.id===${JSON.stringify(seeded.next)}&&m.role==='next')`),{timeout:15000}).toBe(true);
    await live.clients[W].page.route('**/status',delayedStatus);
    await expect.poll(()=>delayedFull,{timeout:15000}).toBeGreaterThan(0);
    live.consoleDrainLease('native-safe-reload');
    samples.push({phase:'lease-written',at:Date.now(),lease:JSON.parse(readFileSync(path.join(live.deploymentPaths.directory,'updates/pause.json'),'utf8'))});
    await expect.poll(async()=>{
      const native=await live.clients[W].run(`({maintenance:globalThis.__partyConsoleMaintenance,at:globalThis.__partyConsoleMaintenanceAt,
        parentMaintenance:parent.__partyConsoleMaintenance,parentAt:parent.__partyConsoleMaintenanceAt,
        generation:globalThis.__partyRuntimeGeneration,transport:globalThis.__partyTravelTransport,controls:globalThis.__safeDrainControls})`);
      samples.push({phase:'acknowledgement',at:Date.now(),native});
      return native.maintenance?.id;
    },{timeout:5000,
      message:'Fast combat responses must apply the hold while full status is delayed'}).toBe('native-safe-reload');
    holdFull=false;releases.splice(0).forEach(release=>release());
    await waitForGameplay(500);
    expect(await live.clients[W].run('globalThis.__partyConsoleMaintenance?.id')).toBe('native-safe-reload');
    await expect.poll(async()=>{const state=await live.state();return [W,P,M].every(name=>state.characters[name]?.consoleMaintenance?.id==='native-safe-reload');},{timeout:15000}).toBe(true);
    if(turnover){
      await live.admin(`output=(()=>{globalThis.__safeDrainPreviousHalloween={enabled:events.halloween,published:E.halloween};events.halloween=true;E.halloween=true;for(const name of ['${W}','${P}']){const p=get_player(name);p.p.trickortreat=null;p.trickortreat=trick_or_treat_status(p);resend(p,'u+reopen+cid');}broadcast_e();return true;})()`);
      await live.post('/formation',{character:W,eventSelections:['trickortreat']});
      await live.post('/farming-mode',{character:W,mode:'hunt'});
      await expect.poll(async()=>{const s=await live.state();return {event:s.characters[W]?.activeEvent,joined:s.characters[W]?.joinedEvent||null};},{timeout:15000}).toEqual({event:'trickortreat',joined:null});
      await expect.poll(async()=>(await live.state()).monsterHunt?.message,{timeout:15000}).toContain('console load');
    }
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.first).length,{timeout:15000,
      message:'Native attacks must continue after the acquisition hold'}).toBeGreaterThan(before);
    await expect.poll(async()=>{
      const state=await live.state();
      const report=state.characters[W];
      samples.push({at:Date.now(),maintenance:report?.consoleMaintenance,target:report?.combatSelection?.id,position:report?.activeCombatTarget});
      return (await live.clients[W].events()).some((event:any)=>event.event==='death'&&String(event.data?.id)===seeded.first);
    },{timeout:90000,intervals:[250,500]}).toBe(true);
    await expect.poll(async()=>{const state=await live.state();return [W,P,M].every(name=>state.characters[name]?.consoleMaintenance?.ready===true);},
      {timeout:15000,message:'Fresh participants must report the finished fight as safe'}).toBe(true);
    await waitForGameplay(1500);
    expect(hit(await live.clients[W].events(),seeded.next),'The pending reload must not acquire the next monster').toHaveLength(0);
    expect(await live.clients[W].run('sharedRoutine.queueMarkers().filter(m=>m.role==="current"&&m.visible).length')).toBe(0);
    if(!turnover)expect(await live.clients[W].run(`sharedRoutine.queueMarkers().some(m=>m.id===${JSON.stringify(seeded.next)}&&m.role==='next'&&m.visible)`)).toBe(true);
    await evidence(live,info,'safe-reload-native-combat-drain',{seeded,samples,firstHits:hit(await live.clients[W].events(),seeded.first),nextHits:hit(await live.clients[W].events(),seeded.next)});
    await info.attach('safe-reload-no-red-circle',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
    if(turnover){
      await live.post('/formation',{character:W,eventSelections:[]});
      await live.post('/farming-mode',{character:W,mode:'default'});
    }
    live.consoleDrainLease('native-safe-reload',Date.now()-1);
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.next).length,{timeout:30000,
      message:'An expired host hold must restore normal acquisition'}).toBeGreaterThan(0);
  }finally{holdFull=false;releases.splice(0).forEach(release=>release());await live.clients[W].page.unrouteAll({behavior:'wait'});await evidence(live,info,'safe-reload-final-state',{seeded,samples});if(observerFrame&&!observerFrame.isDetached())await observerFrame.evaluate(()=>{const host=window as any;host.$(document).off('.safeDrainObservation');});live.consoleDrainLease(null);await live.admin(`output=(()=>{const previous=globalThis.__safeDrainPreviousHalloween;if(previous){events.halloween=previous.enabled;E.halloween=previous.published;delete globalThis.__safeDrainPreviousHalloween;broadcast_e();}for(const id of ${JSON.stringify([seeded.first,seeded.next])}){const m=instances.main.monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);}
});
});

for(const mode of ['safe','now'] as const)test(`console reload resumes native farming and roaming defense in ${mode} mode`,async({live},info)=>{
  test.setTimeout(240000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:false,eventSelections:[]});
  await live.post('/formation',{character:W,eventSelections:[]});
  await live.post('/focus',{monsterFocus:[],monsterPriorities:{},monsterSearchRadius:300});
  await live.post('/checkpoint',{});
  await live.admin(`output=(()=>{const p=get_player('${W}');for(const m of Object.values(instances.main.monsters))if(Math.hypot(m.x-p.x,m.y-p.y)<800)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
  const samples:any[]=[];
  const destination=await live.clients[W].run(`(()=>{
    const p=character,delta=[[260,0],[-260,0],[0,260],[0,-260]].find(([x,y])=>can_move_to(p.x+x,p.y+y));
    if(!delta)throw Error('No collision-safe walking probe');
    const goal={map:p.map,x:p.x+delta[0],y:p.y+delta[1]};
    return goal;
  })()`);
  await live.post('/travel',destination);
  const seeded:string[]=[];
  try{
    if(mode==='safe'){
      let admission:any;
      await expect.poll(async()=>{
        admission=await live.clients[W].frame.evaluate(goal=>{
          const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
          const service=runner?.__partyMovement,report=service?.report(),state=service?.state,character=game.character;
          return {id:report?.id,owner:report?.owner,name:character?.name,map:character?.map,moving:!!character?.moving,
            goalMatch:state?.map===goal.map&&state?.x===goal.x&&state?.y===goal.y};
        },destination);
        return !!admission.id&&admission.name===W&&admission.map===destination.map&&admission.moving&&admission.goalMatch;
      },{timeout:30000,intervals:[50,100],message:'The native character and active owned journey must be walking toward the requested probe together'}).toBe(true);
      const journey=admission.id;
      live.consoleDrainLease('reload-walk');
      await expect.poll(()=>live.clients[W].run('globalThis.__partyConsoleMaintenance?.id'),{timeout:10000}).toBe('reload-walk');
      await expect.poll(()=>live.admin(`output=!!get_player('${W}').moving`),{timeout:10000}).toBe(false);
      await waitForGameplay(3500);
      expect(await live.clients[W].run('globalThis.__partyMovement.report()?.id')).toBe(journey);
      expect(await live.clients[W].run('sharedRoutine.canReload()')).toBe(true);
      samples.push({phase:'parked',journey,admission,position:await live.clients[W].snapshot()});
      live.consoleDrainLease(null);
    }else await expect.poll(()=>live.admin(`output=!!get_player('${W}').moving`),{timeout:30000}).toBe(true);
    await expect.poll(async()=>{const p=await live.clients[W].snapshot();return Math.hypot(p.x-destination.x,p.y-destination.y)<10;},{timeout:30000}).toBe(true);
    const arrived=await live.clients[W].snapshot();
    expect(Math.hypot(arrived.x-destination.x,arrived.y-destination.y)).toBeLessThan(10);
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{goo:999},monsterSearchRadius:300});
    await live.post('/checkpoint',{});
    if(mode==='safe'){
      live.consoleDrainLease('reload-combat');
      await expect.poll(async()=>{const s=await live.state();return s.characters[W]?.consoleMaintenance?.ready;},{timeout:15000}).toBe(true);
      await waitForGameplay(3200);
      expect(await live.clients[W].run('sharedRoutine.canReload()')).toBe(true);
    }
    const runtime=(await live.state()).characters[W].dashboardRuntime;
    await live.clients[W].frame.evaluate(()=>{
      const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);
    });
    await expect.poll(async()=>{const s=await live.state();return s.characters[W]?.dashboardRuntime!==runtime&&s.characters[W]?.seenAt>Date.now()-5000;},{timeout:30000}).toBe(true);
    live.consoleDrainLease(null);
    samples.push({phase:'final',diagnostics:await live.clients[W].run('({movement:globalThis.__partyMovement.report(),last:globalThis.__partyMovement.last(),combat:globalThis.partyCombatState,maintenance:globalThis.__partyConsoleMaintenance})')});
    expect((await live.state()).monsterFocus).toEqual(['goo']);
    const farm=await live.admin(`output=(()=>{const p=get_player('${W}'),m=new_monster(p.in,{type:'goo',position:[p.x+30,p.y],radius:0,count:1},{temp:1});m.hp=m.max_hp=15000;return String(m.id);})()`);
    seeded.push(farm);
    const attacked=async(id:string)=>(await live.clients[W].events()).some(e=>e.event==='hit'&&String(e.data?.id)===id&&e.data?.hid===W);
    await expect.poll(()=>attacked(farm),{timeout:30000,message:'Configured farming resumes after actual CODE replacement'}).toBe(true);
    await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(farm)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
    const threat=await live.admin(`output=(()=>{const p=get_player('${W}'),m=new_monster(p.in,{type:'bee',position:[p.x+20,p.y],radius:0,count:1},{temp:1});m.hp=m.max_hp=15000;target_player(m,p);return String(m.id);})()`);
    seeded.push(threat);
    await expect.poll(()=>attacked(threat),{timeout:30000,message:'A non-focus native roaming attacker receives a defensive response'}).toBe(true);
    samples.push({phase:'resumed',mode,focus:(await live.state()).monsterFocus,position:await live.clients[W].snapshot()});
  }finally{
    live.consoleDrainLease(null);
    samples.push({phase:'before-target-cleanup',at:Date.now(),native:await live.clients[W].run(`(()=>{
      const ids=${JSON.stringify(seeded)},clock=globalThis.__e2eChronalClock;
      return {at:Date.now(),runtime:globalThis.__partyRuntimeGeneration,clock:clock&&{now:clock.now(),join:clock.join,state:clock.state},
        combat:globalThis.partyCombatState,trace:sharedRoutine.combatTraceSnapshot?.(),
        targets:ids.map(id=>{const target=get_entity(id);return {id,target:target&&{id:target.id,map:target.map,x:target.x,y:target.y,hp:target.hp,visible:target.visible,target:target.target},canAttack:!!target&&can_attack(target)};})};
    })()`).catch(String)});
    await evidence(live,info,'reload-activity-resumption-'+mode,{destination,samples,seeded});
    await live.admin(`output=(()=>{for(const id of ${JSON.stringify(seeded)}){const m=instances.main.monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
  }
});
