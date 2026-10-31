import {test,expect} from './live-fixtures';

// Failure inventory: clock skew moves the displayed minute; departure starts
// only at LIVE or at one minute; early attendance retires; staging attacks;
// cancelled occurrences keep ownership; restart loses the native deadline.
for(const event of ['horseman','graveyard'])test.describe(`published ${event}`,()=>{
  const destination=event==='horseman'?{map:'halloween',x:-405,y:-1640}:{map:'spookytown',x:255,y:-1425};
  // Keep Graveyard's origin in the open cemetery, clear of the southern wall.
  test.use({initialPeacefulAmbientMaps:['spookytown','halloween'],initialPosition:{...destination,y:destination.y+(event==='horseman'?500:275)}});
  test(`Event pretravel ${event} leaves two minutes early and ${event==='horseman'?'fights only after LIVE':'returns when cancelled'}`,async({live},info)=>{
    test.setTimeout(480_000);
    const fighters=['E2EWarrior','E2EPriest'];
    await live.post('/formation',{leader:fighters[0]});
    await live.post('/formation',{character:fighters[1],follow:true});
    const checkpoint=await live.post('/checkpoint',{});
    // Declare one native server_info schedule, preserving native movement,
    // permissions, damage, event sessions, persistence and return handling.
    const seed=await live.admin(`output=(()=>{
      const event=${JSON.stringify(event)},at=Date.now()+150000;
      // Ambient isolation is declared before login: doing this here lets
      // startup combat kill the leader before the schedule even exists.
      const attackers=${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return {name,count:p.targets,
        actual:Object.values(instances[p.in].monsters).filter(m=>m.target===name).length};});
      const occurrence={event,at,status:'scheduled',id:'e2e-pretravel-'+event};
      const original=broadcast_e;
      globalThis.__e2ePretravel={occurrence,original};
      broadcast_e=function(dontSend){if(dontSend)return;const snapshot={...E,schedule:{...E.schedule,events:[occurrence],repeats:[]}};
        // A cancelled declared occurrence must not reveal an unrelated ambient live round.
        if(occurrence.status!=='live')delete snapshot[event];broadcast('server_info',snapshot);};
      broadcast_e();return {at,declaredAt:Date.now(),event,attackers};
    })()`);
    expect(seed.attackers.map((p:any)=>({count:p.count,actual:p.actual}))).toEqual(fighters.map(()=>({count:0,actual:0})));
    const observations:any[]=[];
    try{
      await live.post('/formation',{character:fighters[0],eventSelections:[event]});
      const before=await live.state();
      const nativeNow=await live.admin('output=Date.now()');
      expect(seed.at-nativeNow).toBeGreaterThan(120000);
      expect(fighters.every(name=>before.characters[name]?.joinedEvent!==event)).toBe(true);
      await expect.poll(async()=>{
        const s=await live.state(),at=await live.admin('output=Date.now()');
        const ready=fighters.every(name=>s.characters[name]?.joinedEvent===event&&s.characters[name]?.serverStagingEvents?.some((entry:any)=>entry.name===event&&entry.spawnId===seed.at));
        if(ready)observations.push({phase:'departed',at,state:s});return ready;
      },{timeout:60_000}).toBe(true);
      expect(seed.at-observations[0].at).toBeGreaterThan(60000);
      expect(seed.at-observations[0].at).toBeLessThanOrEqual(120000);
      expect(observations[0].state.eventSchedules.find((entry:any)=>entry.id===event)?.next).toBe(seed.at);
      // Preparation and native walking share the published pretravel window.
      // A fixed one-minute wait can expire while travel still has time before LIVE.
      const arrivalWindow=seed.at-await live.admin('output=Date.now()');
      expect(arrivalWindow).toBeGreaterThan(0);
      await expect.poll(async()=>{
        const native=await live.admin(`output=({at:Date.now(),players:${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return {name,map:p.map,x:p.x,y:p.y}})})`);
        const ready=native.players.every((p:any)=>p.map===destination.map&&Math.hypot(p.x-destination.x,p.y-destination.y)<100);
        if(ready)observations.push({phase:'arrived-before-start',native});return ready;
      },{timeout:arrivalWindow}).toBe(true);
      expect(observations.at(-1).native.at).toBeLessThan(seed.at);
      expect((await live.state()).eventReturn).toBeFalsy();
      // Native 'hit' also carries priest healing. Check outgoing damage during
      // this actual pretravel leg, excluding ordinary farming before departure.
      expect((await live.clients[fighters[0]].events()).some((entry:any)=>entry.event==='hit'&&
        entry.at>=observations[0].at&&entry.at<=observations.at(-1).native.at&&
        fighters.includes(entry.data?.hid)&&entry.data?.damage>0)).toBe(false);
      await live.restartCoordinator();
      await expect.poll(async()=>{const s=await live.state();return fighters.every(name=>s.characters[name]?.joinedEvent===event)&&!s.eventReturn;},{timeout:30_000}).toBe(true);
      if(event==='horseman'){
        await expect.poll(()=>live.admin('output=Date.now()'),{timeout:150_000}).toBeGreaterThanOrEqual(seed.at);
        const monster=await live.admin(`output=(()=>{
          globalThis.__e2ePretravel.occurrence.status='live';
          G.monsters.horseman={...G.monsters.horseman,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true,spawns:[]};
          const m=new_monster('halloween',{type:'horseman',count:1,boundary:[-405,-1640,-405,-1640]},{temp:1});
          E.horseman={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:String(m.id),at:Date.now()};
        })()`);
        await expect.poll(async()=>{const hits=await live.clients[fighters[0]].events();return fighters.every(name=>hits.some((e:any)=>e.event==='hit'&&String(e.data?.id)===monster.id&&e.data?.hid===name&&e.data?.damage>0));},{timeout:60_000}).toBe(true);
        observations.push({phase:'native-combat',monster,events:await live.clients[fighters[0]].events()});
      }else{
        // Retain the actual native arrival before ordinary farming can move
        // away between dashboard polls. A Main evacuation must precede it.
        // Graveyard uses the established 180-unit checkpoint return radius.
        await live.admin(`output=(()=>{const owner=globalThis.__e2ePretravel,point=${JSON.stringify(checkpoint.partyLocation)};
          owner.returnTrace={exitedAt:null,arrival:null};owner.returnTimer=setInterval(()=>{
            const p=get_player('${fighters[0]}'),trace=owner.returnTrace;if(!p)return;
            if(p.map==='main'&&!trace.exitedAt)trace.exitedAt=Date.now();
            if(trace.exitedAt&&!trace.arrival&&p.map===point.map&&Math.hypot(p.x-point.x,p.y-point.y)<180)
              trace.arrival={at:Date.now(),map:p.map,x:p.x,y:p.y};
          },50);return true;})()`);
        await live.admin("output=(()=>{globalThis.__e2ePretravel.occurrence.status='cancelled';broadcast_e();return true;})()");
        await expect.poll(async()=>{const s=await live.state();return s.eventReturn?.event===event&&fighters.every(name=>!s.characters[name]?.serverStagingEvents?.some((entry:any)=>entry.name===event));},{timeout:20_000}).toBe(true);
        // Native evacuation walks from Spooky Town through the forest to Main.
        // Evidence from the 120s combined poll still showed forward movement in
        // the forest. Observe evacuation and checkpoint travel separately.
        await expect.poll(async()=>{const s=await live.state();return !!s.eventReturn?.returnDispatchedAt||!s.eventReturn;},{timeout:180_000}).toBe(true);
        observations.push({phase:'cancelled-exit-acknowledged',state:await live.state()});
        // Observe arrival while return still owns movement. Once the return
        // retires, normal farming may already have moved away from this point.
        await expect.poll(async()=>{const p=await live.admin('output=globalThis.__e2ePretravel.returnTrace.arrival');return !!p&&p.map===checkpoint.partyLocation.map&&Math.hypot(p.x-checkpoint.partyLocation.x,p.y-checkpoint.partyLocation.y)<180;},{timeout:180_000}).toBe(true);
        observations.push({phase:'native-checkpoint-arrival',trace:await live.admin('output=globalThis.__e2ePretravel.returnTrace')});
        await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&!s.eventSessions?.[fighters[0]]&&fighters.every(name=>!s.characters[name]?.joinedEvent);},{timeout:30_000}).toBe(true);
        observations.push({phase:'cancelled-return',state:await live.state()});
      }
    }finally{
      await info.attach('event-pretravel-native-evidence',{body:JSON.stringify({seed,checkpoint,observations,returnTrace:await live.admin('output=globalThis.__e2ePretravel.returnTrace||null'),state:await live.state()}),contentType:'application/json'});
      await live.admin(`output=(()=>{const owner=globalThis.__e2ePretravel;clearInterval(owner.returnTimer);
        broadcast_e=owner.original;delete globalThis.__e2ePretravel;broadcast_e();return true;})()`);
    }
  });
});
