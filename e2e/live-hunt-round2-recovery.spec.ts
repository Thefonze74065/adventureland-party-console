import {test,expect} from './live-fixtures';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {W,P,M,world,beginAnniversary,endAnniversary} from './game/hunt-events';

test.describe('native arrival connector recovery',()=>{
  test.use({initialPosition:{map:'main',x:200,y:-120}});
  for(const dropped of ['first','all'] as const)test(`native Town connector ${dropped} submission loss preserves arrival and deadline`,async({live},info)=>{
    test.setTimeout(120_000);
    // Failure inventory: lost connector never resent; repeated sends extend
    // transition timeout; retry collides or issues after cancellation.
    await live.clients[W].run(`(()=>{
      const socket=parent.socket,nativeMove=globalThis.move;
      const fault=globalThis.__e2eConnector={submissions:[],landedAt:null,landing:null,startedAt:Date.now(),done:null};
      const arrival=()=>{fault.landedAt=Date.now();fault.landing={map:character.map,x:character.real_x,y:character.real_y};};socket.on('new_map',arrival);
      // Drop before native move's optimistic prediction; server/client positions
      // and native packet handlers remain untouched throughout the fault.
      globalThis.move=function(x,y){
        if(fault.landedAt&&Math.hypot(x-character.real_x,y-character.real_y)>1){
          const drop=${JSON.stringify(dropped)}==='all'||fault.submissions.length===0;
          fault.submissions.push({at:Date.now(),drop,from:{map:character.map,x:character.real_x,y:character.real_y},target:{x,y}});
          if(drop)return new Promise(()=>{});
        }return nativeMove.call(globalThis,x,y);
      };
      fault.restore=()=>{globalThis.move=nativeMove;socket.off('new_map',arrival);};
      __partyMovement.move({map:'main',x:0,y:0},undefined,{relocation:'town',arrivalTolerance:1})
        .then(()=>{fault.done={ok:true,at:Date.now()};},error=>{fault.done={ok:false,error:String(error.reason||error.message||error),at:Date.now()};});
      return true;})()`);
    const nativeSamples:any[]=[];
    const nativePosition=()=>live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return {map:p.map,x:p.x,y:p.y,moving:!!p.moving};})()`);
    try {
      await expect.poll(async()=>{nativeSamples.push({at:Date.now(),position:await nativePosition()});return live.clients[W].run('globalThis.__e2eConnector.done');},{timeout:35_000,intervals:[250]}).toBeTruthy();
      const proof=await live.clients[W].run(`({done:__e2eConnector.done,submissions:__e2eConnector.submissions,landing:__e2eConnector.landing,landedAt:__e2eConnector.landedAt,startedAt:__e2eConnector.startedAt,last:__partyMovement.last(),position:{map:character.map,x:character.real_x,y:character.real_y}})`);
      expect(proof.submissions.length).toBeGreaterThanOrEqual(2);
      expect(proof.submissions[0].drop).toBe(true);
      expect(proof.submissions[1].at-proof.submissions[0].at).toBeGreaterThanOrEqual(950);
      if(dropped==='first'){
        expect(proof.done.ok).toBe(true);expect(Math.hypot(proof.position.x,proof.position.y)).toBeLessThanOrEqual(1);
        await expect.poll(()=>live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return Math.hypot(p.x,p.y);})()`),{timeout:5000}).toBeLessThanOrEqual(1);
      }else{
        expect(proof.done.ok).toBe(false);expect(proof.done.error).toContain('town warp');
        expect(proof.done.at-proof.startedAt).toBeLessThan(18_000);
      }
    }finally{
      const proof=await live.clients[W].run(`({done:__e2eConnector.done,submissions:__e2eConnector.submissions,landing:__e2eConnector.landing,landedAt:__e2eConnector.landedAt,startedAt:__e2eConnector.startedAt,last:__partyMovement.last(),position:{map:character.map,x:character.real_x,y:character.real_y}})`);
      await info.attach('native-connector-submission-loss-ledger',{body:JSON.stringify({dropped,proof,nativeSamples,nativePosition:await nativePosition(),events:await live.clients[W].events()}),contentType:'application/json'});
      await live.clients[W].run('__e2eConnector.restore()');
    }
  });
});

test('native escape revival is throttled while native respawn is unavailable',async({live},info)=>{
  test.setTimeout(120_000);
  // Declare an already-owned recovering escape at the status read boundary:
  // native death, respawn cooldown, outgoing calls and revival remain real.
  let recovery=true;
  const context=live.clients[W].page.context();
  await context.route('**/party-api/status',async route=>{
    const response=await route.fetch(),state=await response.json();
    if(route.request().postDataJSON()?.name===W&&recovery)state.escape={id:'declared-escape-recovery',stage:'recovering'};
    await route.fulfill({response,json:state});
  });
  await live.clients[W].run(`(()=>{
    const socket=parent.socket,emit=socket.emit;globalThis.__e2eRespawnCalls=[];
    socket.emit=function(event,...args){if(event==='respawn')__e2eRespawnCalls.push(Date.now());return emit.apply(socket,[event,...args]);};
    globalThis.__e2eRespawnRestore=()=>{socket.emit=emit;};return true;})()`);
  try{
    await expect.poll(()=>live.clients[W].run('sharedRoutine.isOccupied()'),{timeout:15_000}).toBe(true);
    const death=await killNativeCharacter(live,W);
    await expect.poll(()=>live.clients[W].run('character.rip'),{timeout:60_000}).toBe(false);
    const calls:number[]=await live.clients[W].run('__e2eRespawnCalls');
    expect(calls.length).toBeGreaterThan(1);
    for(let index=1;index<calls.length;index++)expect(calls[index]-calls[index-1]).toBeGreaterThanOrEqual(950);
    await info.attach('native-escape-respawn-ledger',{body:JSON.stringify({death,calls,events:await live.clients[W].events(),final:await world(live)}),contentType:'application/json'});
  }finally{recovery=false;await context.unrouteAll({behavior:'ignoreErrors'});await live.clients[W].run('__e2eRespawnRestore()');}
});

test.describe('native Anniversary staging recovery',()=>{
test.use({initialPosition:{map:'main',x:200,y:-120}});
test('native Anniversary staging survives an old-round slice without repeated Town warps',async({live},info)=>{
  test.setTimeout(240_000);
  // Historical stock/schedule read-boundary fixtures only; real Town calls,
  // walking, native live-round kiss and reward are observed unchanged.
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  await live.admin(`output=(()=>{const p=get_player('${W}');p.items[20]={name:'slice_strawberry',q:1};resend(p,'u+cid');return true;})()`);
  await live.post('/command',{character:M,type:'bank'});
  await expect.poll(async()=>(await world(live)).players[M].map,{timeout:60_000}).toBe('bank');
  let scheduled=true;const next=Date.now()+50_000;
  await live.admin(`output=(()=>{
    const original=broadcast_e;globalThis.__e2eStagingBroadcast=original;
    broadcast_e=function(dontSend){if(dontSend)return;broadcast('server_info',{...E,anniversary:{live:false,next:${next},target:'${P}',available:true}});};
    globalThis.__e2eStagingTimer=setInterval(()=>broadcast_e(),500);broadcast_e();return true;})()`);
  const context=live.clients[W].page.context();
  await context.route('**/party-api/status',async route=>{
    const response=await route.fetch(),state=await response.json();
    if(scheduled)state.anniversary={...state.anniversary,merchant:M,handoffTargets:[{name:W,round:'historical-earlier-round',slice:'slice_strawberry'}]};
    await route.fulfill({response,json:state});
  });
  await live.post('/formation',{character:W,eventSelections:['anniversary']});
  const samples:any[]=[];
  try{
    await expect.poll(async()=>{const p=(await world(live)).players[W];return p.map==='main'&&Math.hypot(p.x,p.y)<=100;},{timeout:60_000}).toBe(true);
    const started=Date.now();
    await expect.poll(async()=>{const native=await world(live);samples.push({at:Date.now(),players:native.players});
      expect(Math.hypot(native.players[W].x,native.players[W].y)).toBeLessThanOrEqual(110);
      return Date.now()-started>=30_000;},{timeout:40_000,intervals:[1000]}).toBe(true);
    const casts=(await live.clients[W].events()).filter((e:any)=>e.at>=started&&e.event==='player'&&e.data?.c?.town);
    expect(casts.length).toBe(0);
    scheduled=false;
    await live.admin('clearInterval(globalThis.__e2eStagingTimer);broadcast_e=globalThis.__e2eStagingBroadcast;delete globalThis.__e2eStagingBroadcast;output=true');
    const seed=await beginAnniversary(live,P);
    await expect.poll(async()=>(await world(live)).players[W].conditions.anniversary_kiss,{timeout:90_000}).toBeTruthy();
    await info.attach('native-anniversary-staging-history',{body:JSON.stringify({next,samples,casts,seed,final:await world(live),state:await live.state()}),contentType:'application/json'});
  }finally{scheduled=false;await context.unrouteAll({behavior:'ignoreErrors'});
    await live.admin('clearInterval(globalThis.__e2eStagingTimer);if(globalThis.__e2eStagingBroadcast){broadcast_e=globalThis.__e2eStagingBroadcast;delete globalThis.__e2eStagingBroadcast;}output=true');
    await live.post('/formation',{character:W,eventSelections:[]});await endAnniversary(live);}
});
});
