import {test,expect} from './live-fixtures';
import type {Route} from '@playwright/test';
import {observeNativePlanner} from './native-planner-observation';

const W='E2EWarrior', P='E2EPriest', names=[W,P];
test.use({initialPosition:{map:'halloween',x:-550,y:-290}});

for(const fault of ['Town unavailable once','entry unavailable until exhausted'] as const){
test(`native event entry recovers ${fault}`,async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const seed=await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;
    globalThis.__entryRecoveryOriginalPumpkin=original;
    G.monsters.mrpumpkin={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-495,685,-495,685]},{temp:1});
    E.mrpumpkin={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
    return {id:String(m.id),map:m.map,x:m.x,y:m.y};
  })()`);
  const context=live.clients[W].page.context(), requests:any[]=[], samples:any[]=[], unmatched:any[]=[], validationErrors:any[]=[];
  const observer=observeNativePlanner(context);
  const restoreObservation=await observer.install(live.clients[W]);
  // The native binding observes current ownership before ajax sends. Read the
  // coordinator once in parallel; no CDP round trip or cached prior epoch.
  let refusals=0;
  const rejectEntry=async(route:Route)=>{
    const req=route.request(),body=req.method()==='POST'?req.postDataJSON():null;
    if(body?.character!==W||body.to?.map!==seed.map||body.to?.x!==seed.x||body.to?.y!==seed.y)return route.fallback();
    const started=Date.now(),state=live.state('fast');
    // Start the fresh coordinator observation before refusing the request, but
    // never hold its native two-second deadline waiting for a diagnostic GET.
    const observed=await observer.sample(body);
    const sample={movement:observed?.body.movement,navigation:observed?.body.convoyNavigation};
    const owner=sample.navigation;
    if(sample.movement?.id!==body.id||sample.movement.done||!owner||owner.communication||owner.phase==='communication-hold'||
      !String(body.id).startsWith(W+':'+owner.runtimeId+':')||Date.now()-started>=1500){
      await state;unmatched.push({at:Date.now(),body,owner,elapsedMs:Date.now()-started});return route.fallback();
    }
    const rejected=fault==='entry unavailable until exhausted'||refusals===0;
    if(rejected){
      refusals++;
      await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:
        fault==='Town unavailable once'?'Town warp currently unavailable':'Declared entry service unavailable'})});
    }else await route.fallback();
    const s=await state;
    const c=s.activeConvoy;
    const expected=c?.expected?.[W];
    if(c?.walkingActivity!=='event'||c.walkingEvent!=='mrpumpkin'||owner.id!==c.id||owner.epoch!==c.epoch||
      owner.commandId!==expected?.commandId||owner.navigationRevision!==expected?.revision||owner.runtimeId!==expected?.runtimeId||
      body.to?.map!==c.location?.map||body.to.x!==c.location.x||body.to.y!==c.location.y)
      validationErrors.push({at:Date.now(),body,owner,expected,convoy:c?.id,epoch:c?.epoch});
    requests.push({at:Date.now(),body,convoy:c.id,revision:c.walkingParents?.[W]?.revision,
      recoveryAttempts:c.recoveryAttempts,disableTown:c.disableTown,rejected,owner,elapsedMs:Date.now()-started});
  };
  await context.route('**/party-api/movement-plan',rejectEntry);
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    if(fault==='Town unavailable once'){
      await expect.poll(async()=>{
        const hits=await live.clients[W].events();
        return names.every(name=>hits.some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.id&&e.data?.hid===name&&e.data?.damage>0));
      },{timeout:180_000,message:'Walking fallback must reach the actual boss and both fighters must deal native damage'}).toBe(true);
      expect(refusals).toBe(1);
      expect(requests.some(r=>!r.rejected&&r.disableTown&&r.body.town===false)).toBe(true);
    }else{
      await expect.poll(async()=>{
        const s=await live.state();samples.push({at:Date.now(),convoy:s.activeConvoy,eventReturn:s.eventReturn,
          attendance:s.eventAttendance,characters:Object.fromEntries(names.map(n=>[n,{map:s.characters[n]?.map,x:s.characters[n]?.x,y:s.characters[n]?.y,eventRecovery:s.characters[n]?.eventRecovery}]))});
        if(samples.length>80)samples.splice(1,1);
        return names.every(n=>s.eventAttendance[n]?.mrpumpkin?.ignored==='travel failure');
      },{timeout:90_000,message:'Exhausted entry must skip this occurrence and begin owned recovery'}).toBe(true);
      expect(refusals).toBe(3);
      await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&!s.activeConvoy&&names.every(n=>
        s.characters[n]?.map==='main'&&!s.characters[n]?.rip&&Math.hypot(s.characters[n].x,s.characters[n].y)<150);
      },{timeout:150_000,message:'Both real native characters must recover to Main after exhausted entry'}).toBe(true);
      const before=refusals;await live.restartCoordinator();
      await expect.poll(async()=>{const s=await live.state();return names.every(n=>s.characters[n]?.map==='main'&&
        Date.now()-s.characters[n].seenAt<3000&&s.eventAttendance[n]?.mrpumpkin?.ignored==='travel failure');
      },{timeout:30_000}).toBe(true);
      expect(refusals).toBe(before);
    }
    expect(validationErrors,'Every refusal must retain exact fresh coordinator ownership').toEqual([]);
    const rejectedIds=new Set(requests.filter(request=>request.rejected).map(request=>request.body.id));
    expect(observer.failures.filter(failure=>rejectedIds.has(failure.id)),
      'Every declared refusal must arrive without aborting its exact native operation').toEqual([]);
  }finally{
    await context.unroute('**/party-api/movement-plan',rejectEntry);
    observer.dispose();
    await restoreObservation();
    await info.attach('native-event-entry-recovery',{body:JSON.stringify({fault,seed,requests,unmatched,validationErrors,requestFailures:observer.failures,samples,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(String(m?.id)===${JSON.stringify(seed.id)})remove_monster(m,{silent:true});G.monsters.mrpumpkin=globalThis.__entryRecoveryOriginalPumpkin;delete globalThis.__entryRecoveryOriginalPumpkin;delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
});
}

test('ended A/B arena reconnects once and completes native Main recovery',async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:W,eventSelections:['abtesting']});
  await live.admin(`events.abtesting=true;delete timers.abtesting;output=true`);
  const observations:any[]=[];
  try{
    await expect.poll(async()=>{const s=await live.state('fast');return s.characters[W]?.map;},{timeout:90_000}).toBe('abtesting');
    // Declare the stranded native instance left by prize settlement failure.
    // Keep actual server exit validation, login restoration and all transport native.
    const stranded=await live.admin(`events.abtesting=false;timers.abtesting=false;delete E.abtesting;broadcast_e();output={instance:!!instances.abtesting,map:get_player('${W}').map}`);
    expect(stranded).toEqual({instance:true,map:'abtesting'});
    await expect.poll(async()=>{
      const s=await live.state();const c=s.characters[W];
      observations.push({at:Date.now(),map:c?.map,recovery:c?.eventRecovery,progress:s.returnProgress?.[W],eventReturn:s.eventReturn});
      if(observations.length>150)observations.splice(1,1);
      return c?.map==='main'&&Date.now()-c.seenAt<3000&&!s.eventReturn;
    },{timeout:240_000,message:'Ended native A/B must recover through one same-realm reconnect and clear the return barrier'}).toBe(true);
    const native=await live.admin(`output=(()=>{const p=get_player('${W}');return {map:p.map,x:p.x,y:p.y}})()`);
    expect(native.map).toBe('main');
    expect(Math.hypot(native.x,native.y)).toBeLessThan(150);
    await info.attach('native-abtesting-ended-recovery',{body:JSON.stringify({stranded,observations,native,final:await live.state()}),contentType:'application/json'});
  }finally{
    await live.post('/formation',{character:W,eventSelections:[]});
  }
});
