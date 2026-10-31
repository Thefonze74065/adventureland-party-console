import {isolateNativeMapAmbient,restoreNativeMapAmbient} from './native-map-ambient-isolation';
import {observeNativeStatus} from './native-status-observer';
import { killNativeCharacter } from "./hunt-interruption-helpers";
import {test,expect} from './live-fixtures';
import type {Route,Response} from '@playwright/test';
import {nativeEventSpawn} from './game/event-spawn';

const W='E2EWarrior',P='E2EPriest',fighters=[W,P];
test.use({initialPosition:{map:'halloween',x:-550,y:-290}});

test.describe('empty event sighting recovery',()=>{
 test.use({initialPosition:{map:'spookytown',x:255,y:-1425}});
 test('native Mr Green leaves an empty last-seen waypoint and reacquires its catalog spawn',async({live},info)=>{
  // Failure modes: repeatedly completing the empty hint; bouncing back after
  // catalog arrival; trusting stale coordinates over a real boss; lost ownership.
  test.setTimeout(360_000);const hint={map:'spookytown',x:255,y:-1425},spawn=await nativeEventSpawn(live.admin,'mrgreen');
  let seed:any;const observations:any[]=[];
  try{
   // Native login can already have pulled the surrounding pack. This case
   // exercises an empty advertised waypoint, not unrelated ambient combat or
   // death recovery. Remove those actors reversibly, then reach the declared
   // start through ordinary native navigation before timing reacquisition.
   const ambient=await isolateNativeMapAmbient(live,'spookytown');
   await info.attach('empty-hint-native-ambient-input',{body:JSON.stringify(ambient),contentType:'application/json'});
   for(const character of fighters)await live.post('/command',{character,type:'character-travel',location:hint,label:'Empty-hint journey starting waypoint'});
   await expect.poll(async()=>live.admin(`output=${JSON.stringify(fighters)}.every(name=>{const p=get_player(name);return p&&!p.rip&&p.map===${JSON.stringify(hint.map)}&&Math.hypot(p.x-(${hint.x}),p.y-(${hint.y}))<30;})`),
     {timeout:90_000,message:'Both native fighters must reach the empty hint before catalog reacquisition starts'}).toBe(true);
   seed=await seedRecoveryGreen(live,spawn,hint);
   await expect.poll(()=>live.clients[W].run('parent.S.mrgreen && ({map:parent.S.mrgreen.map,x:parent.S.mrgreen.x,y:parent.S.mrgreen.y})'),{timeout:15_000}).toEqual(hint);
   await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
   await live.post('/formation',{character:W,eventSelections:['mrgreen']});
   await expect.poll(async()=>{const s=await live.state();observations.push({at:Date.now(),convoy:s.activeConvoy&&{id:s.activeConvoy.id,location:s.activeConvoy.location},characters:Object.fromEntries(fighters.map(n=>[n,{map:s.characters[n]?.map,x:s.characters[n]?.x,y:s.characters[n]?.y,event:s.characters[n]?.joinedEvent}]))});if(observations.length>100)observations.shift();
    const events=await live.clients[W].events();return fighters.every(n=>events.some((e:any)=>e.event==='hit'&&e.data?.hid===n&&String(e.data?.id)===seed.id&&e.data?.damage>0));
   },{timeout:150_000,message:'Both fighters must leave the empty advertised waypoint and hit the actual native boss at its catalog spawn'}).toBe(true);
   const final=await live.state();expect(final.characters[W].map).toBe(spawn.map);
   expect(await live.clients[W].run('({map:parent.S.mrgreen.map,x:parent.S.mrgreen.x,y:parent.S.mrgreen.y})')).toEqual(hint);
   expect(Math.hypot(final.characters[W].x-hint.x,final.characters[W].y-hint.y)).toBeGreaterThan(500);
  }finally{
   try{
    await info.attach('native-empty-last-seen-spawn-recovery',{body:JSON.stringify({hint,spawn,seed,observations,state:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
   }finally{
    try{await live.post('/formation',{character:W,eventSelections:[]}).catch(()=>{});await clearRecoveryGreen(live,seed);}
    finally{await info.attach('empty-hint-native-ambient-restored',{body:JSON.stringify(await restoreNativeMapAmbient(live,true)),contentType:'application/json'});}
   }
  }
 });
});

test('native respawned event follower starts catchup while the survivor convoy is still moving',async({live},info)=>{
 // Failure modes: pre-death poll steals reentry; eventTraveling survives death;
 // a late rejoin waits for the survivor's arrival or cancels its current convoy.
 test.setTimeout(240_000);const spawn=await nativeEventSpawn(live.admin,'mrgreen');
  let seed:any,death:any,before:any,started:any,hold=false;const held:any[]=[],samples:any[]=[],grants:any[]=[],setup:any[]=[];
 const observe=async(response:Response)=>{if(!response.url().endsWith('/party-api/shared-travel'))return;try{const body=response.request().postDataJSON();if(body?.character===W&&body.reentryDeathAt){const result=await response.json();grants.push({at:Date.now(),body,result});}}catch{/* Retain actual successful authorization responses only. */}};
 live.clients[W].page.on('response',observe);
 const gate=async(route:Route)=>{const body=route.request().postDataJSON();if(hold&&body?.character===W&&body.event==='mrgreen'){held.push({at:Date.now(),body});await route.fulfill({status:200,json:{allowed:false,reason:'Declared current-operation event reentry hold'}});return;}await route.fallback();};
 await live.clients[W].page.context().route('**/party-api/hunt-event-permission',gate);
  // An ordinary entry can replace its walking token before native death. Hold
  // that logical pre-death operation, then admit the exact native reentry.
  const initialWalk=async(route:Route)=>{const body=route.request().postDataJSON();if(body?.character===W&&body.activity==='event'&&body.key==='mrgreen'&&!body.cancel&&!body.reentryDeathAt){await route.fulfill({status:200,json:{ok:true,phase:'waiting'}});return;}await route.fallback();};
 await live.clients[W].page.context().route('**/party-api/shared-travel',initialWalk);
 try{
  seed=await seedRecoveryGreen(live,spawn,spawn);
  await live.post('/formation',{leader:P});await live.post('/formation',{character:W,follow:true});
  await live.post('/formation',{character:P,eventSelections:['mrgreen']});
   await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy;setup.push({at:Date.now(),convoy:c,characters:Object.fromEntries(fighters.map(n=>{const r=s.characters[n];return [n,{map:r.map,x:r.x,y:r.y,moving:r.moving,joinedEvent:r.joinedEvent,lastDeath:r.lastDeath}];}))});if(setup.length>160)setup.shift();return c?.walkingEvent==='mrgreen'&&c.phase==='travel'&&c.participants.length===1&&c.participants[0]===P&&s.characters[P].moving&&s.characters[W].joinedEvent==='mrgreen';},{timeout:90_000}).toBe(true);
  hold=true;
  death=await killNativeCharacter(live,W);
  await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy,w=s.characters[W],p=s.characters[P];if(c?.walkingEvent==='mrgreen'&&c.phase==='travel'&&c.participants.length===1&&c.participants[0]===P&&p.moving&&!w.rip&&w.map==='main'){before={at:Date.now(),convoyId:c.id,w,p};return true;}return false;},{timeout:90_000}).toBe(true);
  hold=false;
  await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy,w=s.characters[W],p=s.characters[P];samples.push({at:Date.now(),convoyId:c?.id,w:{map:w.map,x:w.x,y:w.y,moving:w.moving,recovery:w.recovery},p:{map:p.map,x:p.x,y:p.y,moving:p.moving}});
   if(grants.some(g=>g.result.phase==='independent'&&g.result.reentryDeathAt===before.w.lastDeath.at)&&c?.id===before.convoyId&&p.moving&&w.moving&&!w.rip&&Math.hypot(w.x-before.w.x,w.y-before.w.y)>10){started={at:Date.now(),convoy:c,w,p};return true;}return false;
  },{timeout:15_000,message:'The revived follower must physically move before the existing survivor convoy stops or completes'}).toBe(true);
  expect(started.convoy.participants).toEqual([P]);
  await expect.poll(async()=>{const events=await live.clients[W].events();return fighters.every(n=>events.some((e:any)=>e.event==='hit'&&e.data?.hid===n&&String(e.data?.id)===seed.id&&e.data?.damage>0));},{timeout:150_000}).toBe(true);
 }finally{
  hold=false;await live.clients[W].page.context().unroute('**/party-api/hunt-event-permission',gate);
  await live.clients[W].page.context().unroute('**/party-api/shared-travel',initialWalk);
  live.clients[W].page.off('response',observe);
  await info.attach('native-respawn-moving-event-catchup',{body:JSON.stringify({spawn,seed,death,before,started,setup,held,samples,grants,state:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
  await live.post('/formation',{character:P,eventSelections:[]}).catch(()=>{});await clearRecoveryGreen(live,seed);
 }
});

test('native event death during convoy admission returns after respawn',async({live},info)=>{
 // Failure modes: death before route identities exist; dead pending requests
 // admitted later; a failed setup poisons every subsequent reentry token;
 // recovery renews an exhausted route or steals a newer navigation command.
 test.setTimeout(240_000);
 const spawn=await nativeEventSpawn(live.admin,'mrgreen');
 let seed:any,death:any,admitted:any,releasePeer=false,waiting=false,cancelled=false;const samples:any[]=[];
 const gate=async(route:Route)=>{
  const body=route.request().postDataJSON();
  if(body?.activity!=='event'||body.key!=='mrgreen'){await route.fallback();return;}
  if(body.character===P&&!releasePeer){await route.fulfill({status:200,json:{ok:true,phase:'waiting'}});return;}
  const response=await route.fetch();
  if(body.character===W){if(body.cancel)cancelled=true;else waiting=true;}
  await route.fulfill({response});
 };
 for(const n of fighters)await live.clients[n].page.context().route('**/party-api/shared-travel',gate);
 try{
  // Delay only this character's native respawn emission until the pending
  // walk has been admitted. Status, movement and unrelated actions stay live.
  await live.clients[W].run(`(()=>{const socket=parent.socket,emit=socket.emit;globalThis.__e2eAdmissionRespawn={socket,emit,held:[]};socket.emit=function(event,...args){if(event==='respawn'){__e2eAdmissionRespawn.held.push([event,...args]);return socket;}return emit.apply(socket,[event,...args]);};return true;})()`);
  seed=await seedRecoveryGreen(live,spawn,spawn);
  await live.post('/formation',{leader:P});await live.post('/formation',{character:W,follow:true});
  await live.post('/formation',{character:P,eventSelections:['mrgreen']});
  await expect.poll(()=>waiting,{timeout:60_000,message:'The first attendee must have a real pending walk before the peer requests admission'}).toBe(true);
  death=await killNativeCharacter(live,W);
  await expect.poll(async()=>cancelled&&(await live.state()).characters[W]?.rip===true,{timeout:15_000,message:'Observe native death and cancellation of the pre-death walking token'}).toBe(true);
  releasePeer=true;
  await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy;if(c?.walkingEvent!=='mrgreen')return false;if(c.participants.includes(W)&&c.phase!=='failed')return false;admitted={at:Date.now(),convoy:c};return true;},{timeout:45_000,message:'The peer must start; an admitted dead member exposes the failed setup'}).toBe(true);
  await live.clients[W].run(`(()=>{const h=__e2eAdmissionRespawn;h.socket.emit=h.emit;for(const args of h.held)h.emit.apply(h.socket,args);delete globalThis.__e2eAdmissionRespawn;return true;})()`);
  await expect.poll(async()=>{
   const s=await live.state();samples.push({at:Date.now(),convoy:s.activeConvoy&&{id:s.activeConvoy.id,phase:s.activeConvoy.phase,failure:s.activeConvoy.failure},characters:Object.fromEntries(fighters.map(n=>[n,{map:s.characters[n]?.map,rip:s.characters[n]?.rip,lastDeath:s.characters[n]?.lastDeath,recovery:s.characters[n]?.recovery}]))});if(samples.length>160)samples.shift();
   const events=await live.clients[W].events();
   return s.characters[W]?.recovery?.status==='recovery-complete'&&fighters.every(n=>!s.characters[n]?.rip&&s.characters[n]?.joinedEvent==='mrgreen'&&s.characters[n]?.map===spawn.map&&events.some((e:any)=>e.at>=death.at&&e.event==='hit'&&e.data?.hid===n&&String(e.data?.id)===seed.id&&e.data?.damage>0));
  },{timeout:150_000,message:'Both real fighters must return and damage the native event boss after the setup death'}).toBe(true);
  const s=await live.state();expect(s.characters[W].lastDeath.eventTrip.event).toBe('mrgreen');
  expect(death.skill).toBe('rimeshatter');
  expect(s.characters[W].recovery.status).toBe('recovery-complete');
 }finally{
  await live.clients[W].run(`(()=>{const h=globalThis.__e2eAdmissionRespawn;if(h){h.socket.emit=h.emit;for(const args of h.held)h.emit.apply(h.socket,args);delete globalThis.__e2eAdmissionRespawn;}return true;})()`).catch(()=>{});
  for(const n of fighters)await live.clients[n].page.context().unroute('**/party-api/shared-travel',gate);
  await info.attach('native-event-admission-death-recovery',{body:JSON.stringify({spawn,seed,death,admitted,samples,state:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
  await live.post('/formation',{character:P,eventSelections:[]}).catch(()=>{});await clearRecoveryGreen(live,seed);
 }
});

async function seedRecoveryGreen(live:import('./live-fixtures').LiveGame,spawn:{map:string;x:number;y:number},hint:{map:string;x:number;y:number}){
 return live.admin(`output=(()=>{const original=G.monsters.mrgreen;if(Object.values(instances).some(i=>Object.values(i.monsters||{}).some(m=>m.type==='mrgreen')))throw Error('Requires a clean native Mr Green encounter');try{G.monsters.mrgreen={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,rage:0,peaceful:true,spawns:[]};const p=${JSON.stringify(spawn)},m=new_monster(p.map,{__e2eAmbientExempt:true,type:'mrgreen',count:1,boundary:[p.x,p.y,p.x,p.y]},{temp:1});m.e2eRecoveryGreen=true;E.mrgreen={live:true,...${JSON.stringify(hint)},hp:m.hp,max_hp:m.max_hp};
  // Declared stale server_info coordinates only. Native entity visibility,
  // movement, attacks and death continue to report the real encounter.
  globalThis.__e2eRecoveryGreenNativeBroadcast=broadcast_e;
  const native=broadcast_e,hint=${JSON.stringify(hint)};
  broadcast_e=function(dontSend){if(dontSend)return native(dontSend);broadcast('server_info',{...E,mrgreen:{...E.mrgreen,live:true,...hint}});};
  globalThis.__e2eRecoveryGreenTimer=setInterval(()=>broadcast_e(),500);broadcast_e();return {id:String(m.id),map:m.map,x:m.x,y:m.y,hint};}finally{G.monsters.mrgreen=original;}})()`);
}
async function clearRecoveryGreen(live:import('./live-fixtures').LiveGame,seed:any){
 if(!seed)return;await live.admin(`output=(()=>{clearInterval(globalThis.__e2eRecoveryGreenTimer);if(globalThis.__e2eRecoveryGreenNativeBroadcast){broadcast_e=globalThis.__e2eRecoveryGreenNativeBroadcast;delete globalThis.__e2eRecoveryGreenNativeBroadcast;}for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(String(m.id)===${JSON.stringify(seed.id)})remove_monster(m,{silent:true});delete E.mrgreen;broadcast_e();return true;})()`).catch(()=>{});
}

const statusObservers=new Map<string,Awaited<ReturnType<typeof observeNativeStatus>>>();
test.beforeEach(async({live},info)=>{
  if(info.title.includes('fixed-end event timer')||info.title.includes('old deferred return is superseded')||info.title.includes('event limits exhaust')){
    try{statusObservers.set(info.testId,await observeNativeStatus(live.clients,fighters));}
    catch(error){await info.attach('native-status-observer-install-error',{body:String(error),contentType:'text/plain'});throw error;}
  }
});
test.afterEach(async({},info)=>{
  const observer=statusObservers.get(info.testId);if(!observer)return;
  try{await info.attach('native-event-status-metadata',{body:JSON.stringify(await observer.finish()),contentType:'application/json'});}
  finally{statusObservers.delete(info.testId);}
});

test('native fixed-end event timer survives clock resync and a limit added during attendance',async({live},info)=>{
  test.setTimeout(300000);
  // Failure inventory: docs/testing-event-timer-identity.md. Fixed end epochs
  // exercise Crab's identity fallback with genuine native boss combat.
  const checkpoint={map:'halloween',x:-550,y:-290};
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.clients[W].run('parent.__e2eObserveMoves=true;parent.__e2eObservedMoveCount=0');
  await live.post('/travel',checkpoint);
  await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&fighters.every(name=>
    s.characters[name]?.map===checkpoint.map&&Math.hypot(s.characters[name].x-checkpoint.x,s.characters[name].y-checkpoint.y)<100);},{timeout:90000}).toBe(true);
  const seed=await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;try{
    G.monsters.mrpumpkin={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-495,685,-495,685]},{temp:1});
    const end=Date.now()+3600000;E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,end,hp:m.hp,max_hp:m.max_hp};
    // The native event loop reconstructs Pumpkin's status without an end.
    // Keep this case's declared fixed-end feed through every native publish;
    // native boss presence, damage and position remain authoritative.
    const originalBroadcast=broadcast_e;globalThis.__e2eFixedEnd={originalBroadcast};
    broadcast_e=function(dontSend){const boss=get_monster('mrpumpkin');
      if(boss&&String(boss.id)===String(m.id)&&E.mrpumpkin)E.mrpumpkin.end=end;
      return originalBroadcast(dontSend);};
    broadcast_e();return {id:String(m.id),end,original};
  }catch(error){G.monsters.mrpumpkin=original;throw error;}})()`);
  const samples:any[]=[];
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await live.state();samples.push(s.eventAttendance);
      return s.eventAttendance?.[W]?.mrpumpkin?.elapsedMs>12000&&fighters.every(name=>s.characters[name]?.joinedEvent==='mrpumpkin');},{timeout:120000}).toBe(true);
    const before=await live.state(),runtime=before.characters[W].dashboardRuntime;
    expect(before.eventAttendance[W].mrpumpkin.id).toBe(String(seed.end));
    await live.clients[W].frame.evaluate(()=>{const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);});
    await expect.poll(async()=>{const s=await live.state();return s.characters[W]?.dashboardRuntime!==runtime&&s.characters[W]?.eventClockStale===false;},{timeout:45000}).toBe(true);
    await statusObservers.get(info.testId)?.refresh(W);
    const resumed=await live.state();
    expect(resumed.eventAttendance[W].mrpumpkin.id).toBe(String(seed.end));
    expect(resumed.eventAttendance[W].mrpumpkin.elapsedMs).toBeGreaterThanOrEqual(before.eventAttendance[W].mrpumpkin.elapsedMs);
    await live.post('/formation',{character:W,eventLimits:{event:'mrpumpkin',limits:{deathLimit:null,timeLimitMinutes:0.1}}});
    await expect.poll(async()=>{const s=await live.state();samples.push(s.eventAttendance);return s.eventAttendance?.[W]?.mrpumpkin?.ignored==='time limit';},{timeout:15000}).toBe(true);
    await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&fighters.every(name=>
      !s.characters[name]?.joinedEvent&&s.characters[name]?.map===checkpoint.map&&Math.hypot(s.characters[name].x-checkpoint.x,s.characters[name].y-checkpoint.y)<100);},{timeout:150000}).toBe(true);
    expect((await live.clients[W].events()).some(packet=>packet.event==='hit'&&String(packet.data?.id)===seed.id&&packet.data?.hid===W&&packet.data?.damage>0)).toBe(true);
  }finally{
    try{await info.attach('fixed-end-event-timer',{body:JSON.stringify({seed,samples,state:await live.state(),events:await Promise.all(fighters.map(name=>live.clients[name].events()))}),contentType:'application/json'});
    }finally{try{await live.clients[W].run('parent.__e2eObserveMoves=false');}finally{
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{broadcast_e=globalThis.__e2eFixedEnd.originalBroadcast;delete globalThis.__e2eFixedEnd;for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(String(m.id)===${JSON.stringify(seed.id)})remove_monster(m,{silent:true});G.monsters.mrpumpkin=${JSON.stringify(seed.original)};delete E.mrpumpkin;broadcast_e();return true;})()`);
    }}
  }
});

test.describe('retired event exit ownership',()=>{
  test.use({initialPosition:{map:'uhills',x:-550,y:-160}});
  // Failure inventory: docs/testing-round2-recovery.md. Restoring a snapshot
  // without the old recovery must retire its still-running CODE continuation;
  // no successful Town receipt or native combat outcome is manufactured.
  for (const variant of ['plain','deferred','stale-peer'] as const) test(`native event entry resumes after its old ${variant==='plain'?'return cycle disappears':variant==='deferred'?'deferred return is superseded':'deferred return admits a temporarily stale peer'}`,async({live},info)=>{
    const deferred=variant!=='plain';
    test.setTimeout(300_000);
    await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
    const oldCycle='historical-retired-pumpkin-exit';
    let started:any,retiredAt=0,seed:any;
    const exitOwnerSamples:any[]=[];
    const communicationFaults:any[]=[];
    const context=live.clients[P].page.context();
    let holdingPriest=false;
    let priestSeenAtBeforeHold=0;
    const intercept=async(route:Route)=>{
      if(holdingPriest&&route.request().method()==='POST'&&route.request().postDataJSON()?.name===P){
        if(communicationFaults.length<128)communicationFaults.push({at:Date.now(),action:'dropped-priest-status'});
        await route.abort('failed');return;
      }
      await route.fallback();
    };
    try {
      await live.restoreHistoricalSettings(settings=>{
        const profile=settings.farmingProfiles[W];
        const waypoints=Object.fromEntries(fighters.map(name=>[name,{revision:settings.navigationIntents?.[name]?.revision||0,location:{map:'uhills',x:-550,y:-160}}]));
        const recovery={cycleId:oldCycle,event:'mrpumpkin',participants:fighters,pending:fighters,startedAt:Date.now(),phase:'evacuating',checkpoint:{map:'uhills',x:-550,y:-160},waypoints,deferred:[]};
        return {farmingProfiles:{...settings.farmingProfiles,[W]:{...profile,eventReturn:recovery}},eventReturn:recovery};
      });
      await expect.poll(async()=>{const s=await live.state();
        if(fighters.every(name=>s.characters[name]?.eventRecovery?.cycleId===oldCycle && ['leaving-event','returning-to-main'].includes(s.characters[name].eventRecovery.phase))){started=s;return true;}return false;
      },{timeout:45_000}).toBe(true);
      seed=await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;try{
        G.monsters.mrpumpkin={...original,hp:10000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        // This case verifies retired exit ownership, not the separate long
        // Halloween terrain leg. Use the native Mainland door arrival spawn and
        // collision-validate the initial encounter before creating it.
        const doorway=G.maps.main.doors.find(door=>door[4]==='halloween');
        const portal=doorway&&G.maps.halloween.spawns[doorway[5]];
        if(!portal)throw Error('Native Mainland-to-Halloween arrival spawn is unavailable');
        const point=[[60,0],[-60,0],[0,60],[0,-60]].map(([dx,dy])=>({x:portal[0]+dx,y:portal[1]+dy})).find(point=>
          ${JSON.stringify(fighters)}.every(name=>can_move({map:'halloween',x:portal[0],y:portal[1],going_x:point.x,going_y:point.y,base:get_player(name).base})));
        if(!point)throw Error('No collision-safe native portal encounter seed');
        const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[point.x,point.y,point.x,point.y]},{temp:1});
        E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y,portal,scope:'retired exit ownership; native door spawn with collision-safe initial encounter'};
      }finally{G.monsters.mrpumpkin=original;}})()`);
      if(variant==='stale-peer'){
        await expect.poll(async()=>{
          const state=await live.state();
          return fighters.every(name=>state.characters[name]?.dashboardRuntime===started.characters[name].dashboardRuntime&&
            Date.now()-Number(state.characters[name]?.seenAt||0)<3000);
        },{timeout:15_000,message:'Original browser runtimes must publish before status loss'}).toBe(true);
        priestSeenAtBeforeHold=Number((await live.state()).characters[P]?.seenAt);
        expect(priestSeenAtBeforeHold).toBeGreaterThan(0);
        holdingPriest=true;
        await context.route('**/party-api/status',intercept);
        await expect.poll(async()=>{
          const seenAt=Number((await live.state()).characters[P]?.seenAt||priestSeenAtBeforeHold),age=Date.now()-seenAt;
          // Pre-fault requests may already be in flight; capture the accepted
          // timestamp only once the exact stale observation is established.
          if(age>3500)priestSeenAtBeforeHold=seenAt;return age;
        },{timeout:8_000}).toBeGreaterThan(3500);
      }
      retiredAt=Date.now();
      await live.restoreHistoricalSettings(settings=>{
        const deferredEventReturns=deferred?Object.fromEntries(fighters.map(name=>[name,{event:'mrpumpkin',cycleId:oldCycle,
          checkpoint:{map:'uhills',x:-550,y:-160},navigationRevision:settings.navigationIntents?.[name]?.revision||0,
          deferredAt:Date.now(),phase:'returning-to-checkpoint'}])):{};
        return {eventReturn:null,activeConvoy:null,deferredEventReturns,
          farmingProfiles:{...settings.farmingProfiles,[W]:{...settings.farmingProfiles[W],eventReturn:null,activeConvoy:null,eventSessions:{}}},
          eventSelectionsByCharacter:{...settings.eventSelectionsByCharacter,[W]:['mrpumpkin']}};
      });
      if(variant==='stale-peer'){
        await expect.poll(async()=>{
          const s=await live.state(),warrior=s.characters[W];
          return warrior?.dashboardRuntime===started.characters[W].dashboardRuntime&&warrior.seenAt>=retiredAt&&
            Date.now()-warrior.seenAt<3000&&warrior.serverLiveEvents?.some((event:{name:string})=>event.name==='mrpumpkin');
        },{timeout:30_000,message:'The restarted coordinator must receive the original Warrior runtime and LIVE feed before timing admission'}).toBe(true);
        let admission:any;
        await expect.poll(async()=>{const s=await live.state();
          if(s.deferredEventReturns[W]||!s.farmingProfiles[W].eventSessions[W])return false;
          admission=s;
          // End the status-loss fault at admission, before separate native
          // observations. Leaving it active through those reads can cross the
          // bridge's legitimate stale-CODE recovery deadline on a busy host.
          holdingPriest=false;
          return true;
        },{timeout:12_000}).toBe(true);
        const priestSeenAt=Number(admission.characters[P]?.seenAt||priestSeenAtBeforeHold);
        expect(priestSeenAt).toBe(priestSeenAtBeforeHold);
        const priestNative=await live.clients[P].snapshot();
        expect(priestNative.name).toBe(P);
        expect(priestNative.connected).toBe(true);
        expect(Date.now()-priestSeenAt).toBeGreaterThan(3000);
        expect(admission.deferredEventReturns[P]?.cycleId).toBe(oldCycle);
        communicationFaults.push({at:Date.now(),action:'released-after-warrior-admission',priestSeenAt,priestSeenAtBeforeHold,
          priestNative:{name:priestNative.name,connected:priestNative.connected,runtimeGeneration:priestNative.runtimeGeneration},
          warriorSession:admission.farmingProfiles[W].eventSessions[W],priestDeferred:admission.deferredEventReturns[P]});
        holdingPriest=false;
      }
      await expect.poll(async()=>{
        const observationStartedAt=Date.now();
        const native=Object.fromEntries(await Promise.all(fighters.map(async name=>[name,
          await live.clients[name].frame.evaluate(expectedName=>{
            const runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as
              (Window & {character?:Pick<import('typed-adventureland').CharacterEntity,'name'>;__partyEventExitOwner?:{cycleId?:string;cancelled?:boolean;commandId?:number};
                __partyEventRecoveryCycleId?:string|null;__partyRuntimeGeneration?:number})|null;
            if(!runner||runner.character?.name!==expectedName)return null;
            const owner=runner.__partyEventExitOwner;
            return {name:runner.character.name,runtimeGeneration:runner.__partyRuntimeGeneration,
              owner:owner?{cycleId:owner.cycleId,cancelled:!!owner.cancelled,commandId:owner.commandId}:null,
              selectionPublished:Object.prototype.hasOwnProperty.call(runner,'__partyEventRecoveryCycleId'),
              selectedCycle:runner.__partyEventRecoveryCycleId===undefined?null:runner.__partyEventRecoveryCycleId};
          },name)])));
        const nativeObservedAt=Date.now(),s=await live.state(),stateObservedAt=Date.now();
        const checks=Object.fromEntries(fighters.map(name=>{
          const session=s.farmingProfiles[W].eventSessions[name];
          return [name,{nativeReady:!!native[name],runtimeUnchanged:s.characters[name]?.dashboardRuntime===started.characters[name].dashboardRuntime,
            selectionPublished:!!native[name]?.selectionPublished,selectionRetired:!!native[name]&&native[name].selectedCycle!==oldCycle,
            ownerRetired:!!native[name]&&(!native[name].owner||native[name].owner.cancelled||native[name].owner.cycleId!==oldCycle),
            admissionResumed:!deferred||!s.deferredEventReturns[name]&&!!session?.participants?.includes(name)}];
        }));
        if(exitOwnerSamples.length===64)exitOwnerSamples.shift();
        exitOwnerSamples.push({at:stateObservedAt,observationStartedAt,nativeObservedAt,stateObservedAt,native,checks,
          diagnostics:Object.fromEntries(fighters.map(name=>[name,{eventRecovery:s.characters[name]?.eventRecovery,
            expectedRuntime:started.characters[name].dashboardRuntime,actualRuntime:s.characters[name]?.dashboardRuntime,
            deferred:s.deferredEventReturns[name]||null,session:s.farmingProfiles[W].eventSessions[name]&&{
              event:s.farmingProfiles[W].eventSessions[name].event,participants:s.farmingProfiles[W].eventSessions[name].participants,
              waypoint:s.farmingProfiles[W].eventSessions[name].waypoints?.[name]}}]))});
        return fighters.every(name=>Object.values(checks[name]).every(Boolean));
      },{timeout:15_000}).toBe(true);
      if(deferred){const resumed=await live.state();for(const name of fighters){
        expect(resumed.deferredEventReturns[name]).toBeUndefined();
        expect(resumed.farmingProfiles[W].eventSessions[name].waypoints[name].location).toEqual({map:'uhills',x:-550,y:-160});
      }}
      await expect.poll(async()=>{const events=await live.clients[W].events();return fighters.every(name=>events.some((e:any)=>
        e.event==='hit'&&String(e.data?.id)===String(seed.id)&&e.data?.hid===name&&e.at>retiredAt));
      },{timeout:180_000}).toBe(true);
    }finally{
      holdingPriest=false;
      await context.unroute('**/party-api/status',intercept);
      await info.attach('native-retired-event-exit',{body:JSON.stringify({oldCycle,deferred,variant,communicationFaults,started,retiredAt,seed,exitOwnerSamples,final:await live.state().catch(error=>({error:String(error)})),events:await live.clients[W].events()}),contentType:'application/json'});
      await live.post('/formation',{character:W,eventSelections:[]});
      if(seed)await live.admin(`output=(()=>{const m=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).find(m=>String(m.id)===${JSON.stringify(String(seed.id))}&&m.type==='mrpumpkin');if(m)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
    }
  });
});

test('native event walking recovers owned CODE turnover after coordinator restart',async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  const seed=await live.admin(`output=(()=>{
    const type='mrpumpkin',original=G.monsters[type],dps=${JSON.stringify(fighters)}.reduce((n,name)=>{const p=get_player(name);return n+p.attack*p.frequency;},0);
    try{G.monsters[type]={...original,hp:Math.ceil(dps*600),attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
      const m=new_monster('halloween',{type,count:1,boundary:[-495,685,-495,685]},{temp:1});m.e2eRuntimeRecovery=true;
      E[type]={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y};
    }finally{G.monsters[type]=original;}})()`);
  let before:any,failed:any,recovered:any,turnoverAt=0;
  const ownerObservations:any[]=[];
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy;
      if(c?.walkingActivity==='event'&&c.walkingEvent==='mrpumpkin'&&c.phase==='travel'){before=s;return true;}return false;
    },{timeout:90_000}).toBe(true);
    // Actual upstream CODE iframe replacement, with the same maintained loader.
    turnoverAt=Date.now();
    await live.clients[P].frame.evaluate(()=>{
      const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);
    });
    // Native replacement may recover through the communication barrier before
    // becoming terminal. Restart while turnover is in flight, preserving both
    // supported paths rather than requiring a transient failed heartbeat.
    failed=await live.state();
    await live.restartCoordinator();
    await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy;
      const fresh=fighters.every(name=>{const m=s.characters[name];return m?.hp>0&&!m.rip&&
        Date.now()-m.seenAt<3000&&m.joinedEvent==='mrpumpkin';});
      const identities=s.characters[P]?.dashboardRuntime!==before.activeConvoy.runtimes[P]&&
        s.characters[W]?.dashboardRuntime===before.activeConvoy.runtimes[W];
      if(c?.walkingEvent==='mrpumpkin'){
        ownerObservations.push({convoy:c,characters:Object.fromEntries(fighters.map(name=>[name,s.characters[name]]))});
        expect(c.recoveryAttempts||0).toBeGreaterThanOrEqual(before.activeConvoy.recoveryAttempts||0);
        expect(c.walkingFailures||0).toBeGreaterThanOrEqual(before.activeConvoy.walkingFailures||0);
        for(const name of c.participants){expect(fighters).toContain(name);
          expect(c.walkingParents[name].revision).toBe(before.activeConvoy.walkingParents[name].revision);}
        const owned=c.participants.every((name:string)=>{const report=s.characters[name]?.convoyNavigation,expected=c.expected?.[name];
          return report?.id===c.id&&report.runtimeId===c.runtimes?.[name]&&
            report.commandId===expected?.commandId&&report.navigationRevision===expected?.revision;});
        if(fresh&&identities&&owned&&c.phase!=='failed'){recovered=s;return true;}
      }
      // Completed navigation intentionally retires reports and commands. Native
      // attack receipts plus the original owner identities prove its handoff.
      if(!c&&fresh&&identities){const events=await live.clients[W].events();
        if(fighters.every(name=>events.some((e:any)=>e.event==='hit'&&String(e.data?.id)===String(seed.id)&&
          e.data?.hid===name&&e.at>turnoverAt))){recovered=s;return true;}}
      return false;
    },{timeout:60_000}).toBe(true);
    await expect.poll(async()=>{const events=await live.clients[W].events();return fighters.every(name=>events.some((e:any)=>e.event==='hit'&&String(e.data?.id)===String(seed.id)&&e.data?.hid===name&&e.at>turnoverAt));},{timeout:120_000}).toBe(true);
  }finally{
    await info.attach('native-event-runtime-turnover',{body:JSON.stringify({seed,before,turnoverAt,failed,recovered,ownerObservations,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(m?.e2eRuntimeRecovery)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
});

test('native event selection replaces a failed old entry without waiting on another boss',async({live},info)=>{
  test.setTimeout(360000);
  // Failure inventory: CODE turnover plus a different genuine event selection
  // must not leave the old failed rendezvous holding both live event workflows.
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  const seeds=await live.admin(`output=(()=>{const result={},owned={};
    if(globalThis.__e2eDifferentEventCatalog)throw Error('Different-event fixture catalog already owned');
    globalThis.__e2eDifferentEventCatalog=owned;
    for(const [type,x,y] of [['mrpumpkin',-495,685],['mrgreen',-495,650]]){
      const original=G.monsters[type],configured={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
      owned[type]={original,configured};G.monsters[type]=configured;
      {
        const m=new_monster('halloween',{type,count:1,boundary:[x,y,x,y]},{temp:1});
        result[type]={id:m.id,map:m.map,x:m.x,y:m.y};
        if(type==='mrpumpkin')E[type]={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};
      }}
    broadcast_e();return result;})()`);
  const samples:unknown[]=[];
  let before:any;
  try {
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await live.state();if(s.activeConvoy?.walkingEvent==='mrpumpkin'&&s.activeConvoy.phase==='travel'){before=s;return true;}return false;},{timeout:90000}).toBe(true);
    // A higher-priority live boss must preempt retained attendance for both
    // leader and follower, including after CODE turnover and persistence replay.
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin','mrgreen'],eventPriorities:['mrgreen','mrpumpkin','anniversary','abtesting','goobrawl','crabxx','franky','icegolem','snowman','slenderman']});
    await live.admin(`output=(()=>{const seed=${JSON.stringify(seeds.mrgreen)};E.mrgreen={live:true,...seed,hp:100000000,max_hp:100000000,end:Date.now()+600000};broadcast_e();return true;})()`);
    await live.clients[P].frame.evaluate(()=>{const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);});
    await live.restartCoordinator();
    await expect.poll(async()=>{const state=await live.state();
      const hits=await Promise.all([[W,'mrgreen'],[P,'mrgreen']].map(async([name,type])=>({name,type,hit:(await live.clients[name].events()).find((event:any)=>event.event==='hit'&&String(event.data?.id)===String(seeds[type].id)&&event.data?.hid===name&&event.data?.damage>0)})));
      samples.push({at:Date.now(),convoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase,event:state.activeConvoy.walkingEvent},characters:Object.fromEntries(fighters.map(name=>[name,{map:state.characters[name]?.map,event:state.characters[name]?.joinedEvent,runtime:state.characters[name]?.dashboardRuntime}])),hits});
      if(samples.length>64)samples.shift();
      return hits.every(value=>!!value.hit);
    },{timeout:180000,intervals:[500,1000],message:'Each genuinely selected boss must receive native fighter damage after CODE replacement and restart'}).toBe(true);
    const recalculated=await live.admin(`output=Object.entries(globalThis.__e2eDifferentEventCatalog).map(([type,owned])=>{
      if(G.monsters[type]!==owned.configured)throw Error('Different-event catalog ownership changed');
      const seed=${JSON.stringify(seeds)}[type],m=instances[seed.map].monsters[seed.id];
      if(!m||m.type!==type)throw Error('Declared native boss missing');
      calculate_monster_stats(m);
      return {type,id:String(m.id),speed:m.speed,attack:m.attack,charge:G.monsters[type].charge};
    })`);
    await info.attach('native-different-event-recalculated-stats',{body:JSON.stringify(recalculated),contentType:'application/json'});
    for(const monster of recalculated)expect(monster).toMatchObject({speed:1,attack:1,charge:0});
  } finally {
    try{await info.attach('native-different-event-turnover',{body:JSON.stringify({seeds,before,samples}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    }finally{await live.admin(`output=(()=>{for(const [type,seed]of Object.entries(${JSON.stringify(seeds)})){
      const m=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).find(m=>String(m.id)===String(seed.id)&&m.type===type);if(m)remove_monster(m,{silent:true});delete E[type];}
      for(const [type,owned]of Object.entries(globalThis.__e2eDifferentEventCatalog||{}))G.monsters[type]=owned.original;
      delete globalThis.__e2eDifferentEventCatalog;broadcast_e();return true;})()`);}
  }
});

test.describe('visible event boss separated by native terrain',()=>{
  test.use({initialPosition:{map:'halloween',x:-200,y:460}});
  test('native event route retains ownership until the visible boss is attack reachable',async({live},info)=>{
    test.setTimeout(240_000);
    await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
    await live.post('/travel',{map:'halloween',x:-200,y:460});
    await expect.poll(async()=>{
      const s=await live.state();if(s.activeConvoy)return false;
      return live.admin(`output=${JSON.stringify(fighters)}.every(name=>{const p=get_player(name);return p.map==='halloween'&&!p.moving&&Math.hypot(p.x+200,p.y-460)<65;})`);
    },{timeout:90_000}).toBe(true);
    const seed=await live.admin(`output=(()=>{
      const original=G.monsters.mrpumpkin;
      try{G.monsters.mrpumpkin={...original,hp:10000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-534,763,-534,763]},{temp:1});m.e2eTerrainApproach=true;
        E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y};
      }finally{G.monsters.mrpumpkin=original;}})()`);
    let baseline:any,walk:any,endpoint:any;
    try{
      await expect.poll(async()=>live.clients[W].frame.evaluate((id)=>!!(window as any).entities[id],String(seed.id)),{timeout:20_000}).toBe(true);
      baseline=await live.clients[W].frame.evaluate((id)=>{
        const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any,m=game.entities[id];
        return {visible:!!m,position:{map:game.character.map,x:game.character.x,y:game.character.y},boss:{x:m.x,y:m.y},direct:runner.can_move_to(m.x,m.y),inRange:runner.is_in_range(m)};
      },String(seed.id));
      expect(baseline.visible).toBe(true);expect(baseline.direct).toBe(false);expect(baseline.inRange).toBe(false);
      await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
      await expect.poll(async()=>{const s=await live.state();if(s.activeConvoy?.walkingEvent==='mrpumpkin')walk=s;
        const events=await live.clients[W].events();return events.some((e:any)=>e.event==='hit'&&String(e.data?.id)===String(seed.id)&&fighters.includes(e.data?.hid));},{timeout:150_000}).toBe(true);
      endpoint=await live.admin(`output=(()=>{const p=get_player('${W}');return {map:p.map,x:p.x,y:p.y};})()`);
      expect(endpoint.map).toBe('halloween');
      expect(Math.hypot(endpoint.x-baseline.position.x,endpoint.y-baseline.position.y)).toBeGreaterThan(100);
    }finally{
      await info.attach('native-visible-boss-terrain-approach',{body:JSON.stringify({seed,baseline,walk,endpoint,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
      await live.post('/formation',{character:W,eventSelections:[]});
      await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(m?.e2eTerrainApproach)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
    }
  });
});


test('native event limits exhaust only the current instance and survive restart', async ({live}, info) => {
  test.setTimeout(600000);
  // Failure modes: time is counted before entry or while another event owns
  // attendance; duplicate death reports exhaust too early; exhausted events
  // rejoin after reload/restart; new IDs remain incorrectly blacklisted;
  // blank limits become zero; exit loses the saved pre-event farming task.
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const checkpoint = {map:'halloween',x:-550,y:-290};
  await live.post('/travel',checkpoint);
  await expect.poll(async()=>{
    const state=await live.state();
    return fighters.every(name=>state.characters[name]?.map===checkpoint.map&&Math.hypot(state.characters[name].x-checkpoint.x,state.characters[name].y-checkpoint.y)<100)&&!state.activeConvoy;
  },{timeout:90000,message:'Both fighters must establish an explicit saved pre-event destination'}).toBe(true);
  const seeds = await live.admin(`output=(()=>{const result={};
    for(const [type,x,y] of [['mrpumpkin',-495,685],['mrgreen',-495,650]]){
      const original=G.monsters[type];try{G.monsters[type]={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        const m=new_monster('halloween',{type,count:1,boundary:[x,y,x,y]},{temp:1});
        result[type]={id:String(m.id),map:m.map,x:m.x,y:m.y};
        E[type]={live:true,...result[type],hp:m.hp,max_hp:m.max_hp};
      }finally{G.monsters[type]=original;}}
    broadcast_e();return result;})()`);
  const samples:unknown[]=[];
  let death:unknown;
  try {
    await live.post('/formation',{character:W,eventLimits:{event:'mrpumpkin',limits:{deathLimit:null,timeLimitMinutes:0.5}}});
    await live.post('/formation',{character:W,eventLimits:{event:'mrgreen',limits:{deathLimit:0,timeLimitMinutes:null}}});
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin','mrgreen'],eventPriorities:['mrpumpkin','mrgreen','anniversary','abtesting','goobrawl','crabxx','franky','icegolem','snowman','slenderman']});
    await expect.poll(async()=>Promise.all(fighters.map(async name=>(await live.clients[name].events()).some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===seeds.mrpumpkin.id&&packet.data?.hid===name&&packet.data?.damage>0))).then(hits=>hits.every(Boolean)),{timeout:150000,message:'Both fighters must actually reach and fight Pumpkin before its attendance timer expires'}).toBe(true);
    await expect.poll(async()=>{
      const state=await live.state();
      const hits=await Promise.all(fighters.map(async name => (await live.clients[name].events()).some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===seeds.mrgreen.id&&packet.data?.hid===name&&packet.data?.damage>0)));
      samples.push({at:Date.now(),attendance:state.eventAttendance,convoy:state.activeConvoy?.phase,hits});
      return state.eventAttendance?.[W]?.mrpumpkin?.ignored==='time limit'&&hits.every(Boolean);
    },{timeout:180000,intervals:[500,1000],message:'The timed-out Pumpkin instance must hand attendance to native Green combat'}).toBe(true);
    death=await killNativeCharacter(live,W);
    await expect.poll(async()=>{
      const state=await live.state();
      samples.push({at:Date.now(),attendance:state.eventAttendance,eventReturn:state.eventReturn,characters:Object.fromEntries(fighters.map(name=>[name,{map:state.characters[name]?.map,event:state.characters[name]?.joinedEvent,rip:state.characters[name]?.rip}]))});
      return state.eventAttendance?.[W]?.mrgreen?.ignored==='death limit'&&fighters.every(name=>!state.characters[name]?.rip&&!state.characters[name]?.joinedEvent&&state.characters[name]?.map===checkpoint.map&&Math.hypot(state.characters[name].x-checkpoint.x,state.characters[name].y-checkpoint.y)<100)&&!state.eventReturn;
    },{timeout:180000,intervals:[500,1000],message:'The first actual death must exit Green and restore both fighters rather than rejoining'}).toBe(true);
    const exhaustedRuntime=(await live.state()).characters[W].dashboardRuntime;
    await live.clients[W].frame.evaluate(()=>{const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);});
    const restartAt=Date.now();
    await live.restartCoordinator();
    const restarted=await live.state();
    expect(restarted.eventAttendance[W].mrgreen.deaths).toBe(1);
    expect(restarted.eventAttendance[W].mrgreen.ignored).toBe('death limit');
    await expect.poll(async()=>{
      const state=await live.state();
      return state.characters[W]?.seenAt>restartAt&&state.characters[W]?.dashboardRuntime!==exhaustedRuntime&&
        state.eventAttendance[W].mrgreen.deaths===1&&state.eventAttendance[W].mrgreen.ignored==='death limit'&&
        fighters.every(name=>!state.characters[name]?.joinedEvent);
    },{timeout:45000,message:'Fresh replacement CODE must keep the same live instance exhausted after backend restart'}).toBe(true);
    expect(restarted.eventSelectionsByCharacter[W]).toEqual(['mrpumpkin','mrgreen']);
    const replacement=await live.admin(`output=(()=>{const old=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).find(m=>String(m.id)===${JSON.stringify(seeds.mrgreen.id)});if(old)remove_monster(old,{silent:true});
      const original=G.monsters.mrgreen;try{G.monsters.mrgreen={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        const m=new_monster('halloween',{type:'mrgreen',count:1,boundary:[-495,650,-495,650]},{temp:1});
        E.mrgreen={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {...E.mrgreen};
      }finally{G.monsters.mrgreen=original;}})()`);
    await expect.poll(async()=>Promise.all(fighters.map(async name=>(await live.clients[name].events()).some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===replacement.id&&packet.data?.hid===name&&packet.data?.damage>0))).then(hits=>hits.every(Boolean)),{timeout:150000,message:'A new native Green instance must receive native damage despite the prior exhausted instance'}).toBe(true);
    await info.attach('event-limit-new-instance',{body:JSON.stringify({replacement,state:await live.state()}),contentType:'application/json'});
  } finally {
    await info.attach('native-event-limit-ledger',{body:JSON.stringify({seeds,death,samples:samples.slice(-128),state:await live.state()}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{for(const type of ['mrgreen','mrpumpkin']){for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.type===type&&m.hp>1000000)remove_monster(m,{silent:true});delete E[type];}broadcast_e();return true;})()`);
  }
});

for(const event of ['mrgreen','mrpumpkin'])test(`native ${event} walk yields to a newly visible boss before the advertised spawn`,async({live},info)=>{
 test.setTimeout(240_000);
 const advertised={map:'halloween',x:-495,y:685},samples:any[]=[];
 let initialBoss:any,baseline:any,seed:any,firstHit:any;
 try{
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  initialBoss=await live.admin(`output=(()=>{if(Object.values(instances.halloween.monsters).some(m=>m.type==='${event}'))throw Error('Existing event boss cannot be replaced');
   const original=G.monsters['${event}'];try{G.monsters['${event}']={...original,hp:10000000,attack:1,speed:0,charge:0,range:1,aggro:0,rage:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'${event}',count:1,boundary:[${advertised.x},${advertised.y},${advertised.x},${advertised.y}]},{temp:1});m.e2eMovingEventSighting=true;
    E['${event}']={live:true,...${JSON.stringify(advertised)},hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:String(m.id),map:m.map,x:m.x,y:m.y};
   }finally{G.monsters['${event}']=original;}})()`);
  await live.post('/formation',{character:W,eventSelections:[event]});
  await expect.poll(async()=>{
   const state=await live.state(),native=await live.admin(`output=(()=>{const p=get_player('${W}');return {map:p.map,x:p.x,y:p.y,moving:!!p.moving};})()`),c=state.activeConvoy;
   samples.push({at:Date.now(),stage:'before-native-displacement',native,convoy:c&&{id:c.id,phase:c.phase,event:c.walkingEvent},attendance:state.eventAttendance?.[W]?.[event]});if(samples.length>96)samples.shift();
   if(c?.walkingEvent===event&&c.phase==='travel'&&native.map==='halloween'&&native.moving&&Math.hypot(native.x-advertised.x,native.y-advertised.y)>400){baseline={at:Date.now(),native,convoy:c};return true;}return false;
  },{timeout:90_000,message:'The real event route must be walking toward the advertised spawn before introducing the boss'}).toBe(true);
  // Keep the event genuinely live, then displace that same owned native boss
  // only after real walking. All visibility packets and attacks remain native.
  seed=await live.admin(`output=(()=>{const p=get_player('${W}'),m=instances.halloween.monsters[${JSON.stringify(initialBoss.id)}];
   if(!m||!m.e2eMovingEventSighting)throw Error('Owned live boss missing before displacement');
   const before={x:m.x,y:m.y};m.x=p.x;m.y=p.y;m.going_x=m.x;m.going_y=m.y;m.moving=false;m.abs=true;m.u=true;m.cid++;m.last_jump=new Date();
   E['${event}']={live:true,...${JSON.stringify(advertised)},hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:String(m.id),map:m.map,x:m.x,y:m.y,before,at:Date.now()};})()`);
  await expect.poll(async()=>{
   const state=await live.state(),events=await live.clients[W].events(),native=await live.admin(`output=Object.fromEntries(${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,moving:!!p.moving}]}))`);
   const hits=events.filter((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===seed.id&&packet.data?.damage>0);
   samples.push({at:Date.now(),convoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase},native,hits});
   if(hits.length&&!firstHit)firstHit={at:Date.now(),native,hits};
   return fighters.every(name=>hits.some((packet:any)=>packet.data.hid===name));
  },{timeout:30_000,message:'Both native fighters must attack the encountered boss before finishing the obsolete advertised route'}).toBe(true);
  expect(firstHit).toBeTruthy();expect(firstHit.native[W].map).toBe('halloween');
  expect(Math.hypot(firstHit.native[W].x-advertised.x,firstHit.native[W].y-advertised.y)).toBeGreaterThan(250);
 }finally{
  await info.attach('native-event-en-route-sighting',{body:JSON.stringify({event,advertised,initialBoss,baseline,seed,firstHit,samples,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
  await live.post('/formation',{character:W,eventSelections:[]}).catch(()=>{});
  await live.admin(`output=(()=>{for(const m of Object.values(instances.halloween.monsters))if(m.type==='${event}'&&m.e2eMovingEventSighting)remove_monster(m,{silent:true});delete E['${event}'];broadcast_e();return true;})()`).catch(()=>{});
 }
});

test.describe('farming focus changed during native event attendance',()=>{
 test.use({initialPosition:{map:'main',x:0,y:0}});
 test('new farming focus resumes after natural Halloween completion',async({live},info)=>{
  test.setTimeout(480_000);
  let seed:any,handoffSeed:any,changedAt=0,endedAt=0,focusOwnership:any,heldHandoff:any;
  const samples:any[]=[],handoffAttempts:any[]=[];
  let releaseHandoff=false;
  const context=live.clients[W].page.context();
  const refuseHandoff=async(route:Route)=>{
   const body=route.request().postDataJSON();
   if(!fighters.includes(body?.character)||!Number.isSafeInteger(body?.commandId)){await route.continue();return;}
   if(!heldHandoff)heldHandoff={character:body.character,commandId:body.commandId,navigationRevision:body.navigationRevision};
   if(!releaseHandoff&&body.character===heldHandoff.character&&body.commandId===heldHandoff.commandId){
    handoffAttempts.push({at:Date.now(),body});
    await route.fulfill({status:409,json:{error:'Declared retry of the current farming handoff completion'}});return;
   }
   await route.continue();
  };
  await context.route('**/party-api/event-resume-complete',refuseHandoff);
  try{
   await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
   handoffSeed=await live.admin(`output=(()=>{const m=new_monster('main',{type:'goo',count:1,boundary:[-32,800,-32,800]},{temp:1});m.e2eFarmEventHandoff=true;return {id:String(m.id)};})()`);
   const catalog=(await live.state(true)).monsterChoices,oldFarm=catalog.find((choice:any)=>choice.id==='goo').locations.find((point:any)=>point.map==='main');
   const selected=await live.post('/navigate-to-monster',{monsterId:'goo',location:oldFarm});
   await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&fighters.every(name=>s.characters[name]?.map==='main'&&Math.hypot(s.characters[name].x-selected.location.x,s.characters[name].y-selected.location.y)<250);},{timeout:90_000}).toBe(true);
   await expect.poll(()=>!!heldHandoff&&handoffAttempts.length>0,{timeout:90_000,message:'A real farming combat handoff must have an unfinished native completion before event selection'}).toBe(true);
   seed=await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;try{G.monsters.mrpumpkin={...original,hp:10000000,attack:1,speed:0,charge:0,range:1,aggro:0,rage:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-495,685,-495,685]},{temp:1});m.e2eChangedFarmEvent=true;E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:String(m.id),original};
   }catch(error){G.monsters.mrpumpkin=original;throw error;}})()`);
   await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
   await expect.poll(async()=>{const s=await live.state(),events=await live.clients[W].events();return fighters.every(name=>s.characters[name]?.joinedEvent==='mrpumpkin'&&events.some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===seed.id&&packet.data?.hid===name&&packet.data?.damage>0));},{timeout:150_000}).toBe(true);
   releaseHandoff=true;
   const staleCompletion=await live.post('/event-resume-complete',heldHandoff);
   expect(staleCompletion.stale,'The superseded farming completion cannot acknowledge the new event owner').toBe(true);
   changedAt=Date.now();
   const beforeFocus=await Promise.all(fighters.map(name=>live.clients[name].run('globalThis.__partyNavigationIntent && globalThis.__partyNavigationIntent.revision')));
   // Same public action as MonsterFocusPicker, without an explicit travel override.
   await live.post('/focus',{character:W,monsterFocus:['bee']});
   await expect.poll(async()=>{const s=await live.state();return s.monsterFocus?.length===1&&s.monsterFocus[0]==='bee'&&fighters.every(name=>s.characters[name]?.joinedEvent==='mrpumpkin');},{timeout:30_000}).toBe(true);
   const afterFocus=await Promise.all(fighters.map(name=>live.clients[name].run('globalThis.__partyNavigationIntent && globalThis.__partyNavigationIntent.revision')));
   expect(afterFocus,'Changing the future farm must preserve the active event navigation ownership').toEqual(beforeFocus);
   focusOwnership={beforeFocus,afterFocus};
   const bees=await live.admin(`output=Object.values(instances.main.monsters).filter(m=>m.type==='bee').map(m=>String(m.id))`);
   expect(bees.length).toBeGreaterThan(0);
   // Declare the remaining boss HP; its real next native attack must end the encounter.
   await live.admin(`output=(()=>{const m=instances.halloween.monsters[${JSON.stringify(seed.id)}];if(!m||!m.e2eChangedFarmEvent)throw Error('Owned boss missing');m.hp=1;return true;})()`);
   await expect.poll(async()=>(await live.clients[W].events()).some((packet:any)=>packet.event==='death'&&String(packet.data?.id)===seed.id&&packet.at>=changedAt),{timeout:30_000,message:'The native boss must actually die before ending the declared announcement'}).toBe(true);
   endedAt=Date.now();await live.admin(`output=(()=>{delete E.mrpumpkin;broadcast_e();return true;})()`);
   await expect.poll(async()=>{
    const s=await live.state(),events=await live.clients[W].events();samples.push({at:Date.now(),return:s.eventReturn,convoy:s.activeConvoy&&{id:s.activeConvoy.id,phase:s.activeConvoy.phase},focus:s.monsterFocus,characters:Object.fromEntries(fighters.map(name=>[name,{map:s.characters[name]?.map,x:s.characters[name]?.x,y:s.characters[name]?.y,event:s.characters[name]?.joinedEvent}]))});
    if(samples.length>96)samples.shift();
    return !s.eventReturn&&fighters.every(name=>s.characters[name]?.map==='main'&&!s.characters[name]?.joinedEvent&&events.some((packet:any)=>packet.at>=endedAt&&packet.event==='hit'&&bees.includes(String(packet.data?.id))&&packet.data?.hid===name&&packet.data?.damage>0));
   },{timeout:240_000,message:'After the event, both native fighters must resume the newly selected bee focus instead of parking in town'}).toBe(true);
  }finally{
   releaseHandoff=true;await context.unroute('**/party-api/event-resume-complete',refuseHandoff);
   const native=await Promise.all(fighters.map(async name=>({name,observation:await live.clients[name].run(`(()=>{const r=window,s=r.sharedRoutine;return {at:Date.now(),target:r.__partyGroupedCombat,encounter:r.__partyFarmingEngagement,trace:s.combatTraceSnapshot(),approach:s.independentApproachPorts().context(),occupied:s.isOccupied(),entities:Object.values(parent.entities).filter(e=>e.mtype==='bee').map(e=>({id:e.id,x:e.x,y:e.y,hp:e.hp,visible:e.visible,target:e.target}))};})()`).catch(String)})));
   await info.attach('native-event-farming-focus-change',{body:JSON.stringify({seed,handoffSeed,heldHandoff,handoffAttempts,changedAt,endedAt,focusOwnership,samples,native,state:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
   await live.post('/formation',{character:W,eventSelections:[]}).catch(()=>{});
   if(seed)await live.admin(`output=(()=>{const m=instances.halloween.monsters[${JSON.stringify(seed.id)}];if(m?.e2eChangedFarmEvent)remove_monster(m,{silent:true});G.monsters.mrpumpkin=${JSON.stringify(seed.original)};delete E.mrpumpkin;broadcast_e();return true;})()`).catch(()=>{});
   if(handoffSeed)await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(handoffSeed.id)}];if(m?.e2eFarmEventHandoff)remove_monster(m,{silent:true});return true;})()`).catch(()=>{});
  }
 });
});
