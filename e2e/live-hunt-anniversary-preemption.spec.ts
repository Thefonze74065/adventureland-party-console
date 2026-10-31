import {test,expect} from './live-fixtures';
import {W,P,M,world,quantity,prepareHunt,beginAnniversary,endAnniversary,cleanupEvents} from './game/hunt-events';
import {killedByParty} from './hunt-interruption-helpers';
import {isolateNativeMapAmbient,restoreNativeMapAmbient} from './native-map-ambient-isolation';

test('an old Anniversary preemption response cannot stop the resumed native Hunt',async({live},info)=>{
  // Failure inventory: a delayed permission can outlive its cancelled convoy;
  // stopping its replacement consumes Hunt recovery budget and can strand it.
  // Keep native movement/rewards/kill receipts, exact owner evidence and zero retries.
  test.setTimeout(420_000);
  await live.clients[P].run(`(()=>{
    const native=globalThis.__partyNativeMovement;
    const fault=globalThis.__e2eAnniversaryPreemption={native,original:native.stop,ajax:$.ajax,stopped:null,handoff:null,cancelled:false};
    native.stop=function(...args){
      if(args[0]==='smart'&&String(new Error().stack).includes('preemptConvoyForAnniversary'))
        fault.stopped={at:Date.now(),owner:sharedRoutine.convoyNavigationReport(),command:globalThis.__partyLastCommand,revision:globalThis.__partyNavigationIntent?.revision};
      return fault.original.apply(this,args);
    };
    $.ajax=function(options){
      const stack=String(new Error().stack),response=fault.ajax.apply(this,arguments);
      if(fault.handoff||!fault.stopped||!String(options.url).endsWith('/hunt-event-permission')||!stack.includes('preemptConvoyForAnniversary'))return response;
      const stopped=fault.stopped,done=response.done;
      response.done=function(callback){return done.call(this,function(...args){
        if(fault.handoff||args[0]?.allowed!==true)return callback.apply(this,args);
        const receiver=this,handoff=fault.handoff={...stopped,permissionAt:Date.now(),permission:args[0]};
        // The real request has completed and its transport timeout is cleared.
        // Delay only this owned continuation; all other callbacks remain live.
        void (async()=>{
          const deadline=Date.now()+90000;
          while(!fault.cancelled&&Date.now()<deadline){
            const current=sharedRoutine.convoyNavigationReport(),movement=globalThis.__partyMovement.report();
            if(current&&current.commandId!==handoff.command&&movement&&!movement.done&&movement.owner?.convoyId===current.id){
              handoff.replacement={at:Date.now(),current,movement};break;
            }
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          handoff.releasedAt=Date.now();callback.apply(receiver,args);
        })();
      });};
      return response;
    };
  })()`);
  try {
    const ambient=await isolateNativeMapAmbient(live,'main');
    await info.attach('anniversary-native-ambient-input',{body:JSON.stringify(ambient),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:['anniversary']});
    await live.post('/formation',{character:M,eventSelections:['anniversary']});
    const hunt=await prepareHunt(live);
    await expect.poll(async()=>live.clients[P].run(`(()=>{const c=sharedRoutine.convoyNavigationReport(),m=globalThis.__partyMovement.report();return !!(c&&m&&!m.done&&m.owner?.convoyId===c.id);})()`),{timeout:30000,intervals:[25,50],message:'Own real priest Hunt movement before Anniversary'}).toBe(true);
    const before=await world(live),seed=await beginAnniversary(live,P);
    await info.attach('anniversary-native-initial-schedule',{body:JSON.stringify(seed),contentType:'application/json'});
    await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
    await expect.poll(async()=>(await live.state()).anniversary?.eventCycle?.id,{timeout:45_000}).toBeTruthy();
    await expect.poll(async()=>quantity((await world(live)).players[M].items,'anniversarygift'),{timeout:120_000,message:'The actual upstream kiss must deliver a gift'}).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    const afterGift=await world(live);
    await expect.poll(()=>live.clients[P].run('!!globalThis.__e2eAnniversaryPreemption.handoff?.permissionAt'),{timeout:30000,message:'Own the completed permission after the actual Anniversary stop'}).toBe(true);
    // Explicit user deselection is the completion trigger. The initial native
    // scheduling clock does not claim coverage of natural wall-clock expiry.
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/formation',{character:M,eventSelections:[]});
    await endAnniversary(live);
    await expect.poll(()=>live.clients[P].run('!!globalThis.__e2eAnniversaryPreemption.handoff?.releasedAt'),{timeout:90000,message:'Real resumed Hunt movement must release the older permission continuation'}).toBe(true);
    const handoff=await live.clients[P].run('globalThis.__e2eAnniversaryPreemption.handoff');
    expect(handoff.replacement,'Real Hunt replacement must cross the old permission continuation').toBeTruthy();
    expect(handoff.replacement.current.commandId).not.toBe(handoff.command);
    await expect.poll(async()=>{const h=(await live.state()).monsterHunt;return h?.cycleId===hunt.cycleId&&!['paused-event','paused'].includes(h.stage);},{timeout:90_000}).toBe(true);
    const count=afterGift.players[W].quest.c;
    // The retained mission must be physically reached before declaring its
    // next native encounter; ambient spawn availability is not recovery proof.
    await expect.poll(async()=>{
      const current=await world(live),state=await live.state(),mission=state.monsterHunt?.missions?.[state.monsterHunt.currentIndex];
      const bounds=mission?.destination?.boundary;
      return state.monsterHunt?.cycleId===hunt.cycleId&&state.monsterHunt.stage==='farming'&&Array.isArray(bounds)&&
        [W,P].every(name=>{const p=current.players[name];return p.map===mission.destination.map&&
          p.x>=bounds[0]&&p.x<=bounds[2]&&p.y>=bounds[1]&&p.y<=bounds[3];});
    },{timeout:90_000,message:'Both actual fighters must reach the retained Hunt mission before its next encounter'}).toBe(true);
    const state=await live.state(),destination=state.monsterHunt.missions[state.monsterHunt.currentIndex].destination;
    await info.attach('anniversary-preempt-route-ledger',{body:JSON.stringify(state.monsterHunt.routeRecovery||{}),contentType:'application/json'});
    expect(Object.values(state.monsterHunt.routeRecovery||{}).flatMap((r:any)=>r.attempts||[]),'Old Anniversary preemption must not fail newer Hunt travel').toHaveLength(0);
    const encounter=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),destination=${JSON.stringify(destination)},bounds=destination.boundary;
      for(const [dx,dy] of [[35,0],[-35,0],[0,35],[0,-35]]){const x=p.x+dx,y=p.y+dy;
        if(x<bounds[0]||x>bounds[2]||y<bounds[1]||y>bounds[3]||!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
        const m=new_monster(p.in,{__e2eAmbientExempt:true,type:'goo',position:[x,y],radius:0,count:1},{temp:1});m.e2eHunt=true;
        return {id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,destination};}
      throw Error('No reachable native encounter inside retained Goo mission');})()`);
    await info.attach('anniversary-resumed-native-encounter',{body:JSON.stringify({encounter}),contentType:'application/json'});
    const kill=await killedByParty(live,encounter.id);
    await info.attach('anniversary-resumed-native-kill',{body:JSON.stringify(kill),contentType:'application/json'});
    await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:120_000}).toBeLessThan(count);
    expect(quantity((await world(live)).players[M].items,'anniversarygift')).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    await info.attach('anniversary-native-hunt-result',{body:JSON.stringify({hunt,before,afterGift,final:await world(live),state:await live.state()}),contentType:'application/json'});
  } finally {
    const handoff=await live.clients[P].run(`(()=>{const f=globalThis.__e2eAnniversaryPreemption;f.cancelled=true;f.native.stop=f.original;$.ajax=f.ajax;return f.handoff;})()`);
    await info.attach('anniversary-preempt-ownership',{body:JSON.stringify(handoff),contentType:'application/json'});

    try {await cleanupEvents(live);} finally {
      const restored=await restoreNativeMapAmbient(live,true);
      await info.attach('anniversary-native-ambient-restored',{body:JSON.stringify(restored),contentType:'application/json'});
    }
  }
});
