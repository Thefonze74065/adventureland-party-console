import {test,expect} from './live-fixtures';
import {W,P,M,world,quantity} from './game/hunt-events';
import {zones} from '../dashboard/lib/farming-zones';

// Failure inventory: e2e/phoenix-search-failures.md. This journey covers the
// split search, holding fire while converging, the cross-map converge, the kill,
// spreading out before the respawn, and finding the native respawn again.
const SEEDED_HP=12000, GATHER_RANGE=300;
const inside=(b:number[],p:{x:number;y:number})=>p.x>=b[0]&&p.x<=b[2]&&p.y>=b[1]&&p.y<=b[3];

test('Phoenix patrol splits the fighters, holds fire until they gather, then spreads out for the respawn',async({live},info)=>{
  test.setTimeout(1_500_000);
  const timeline:any[]=[];
  let sampling=true;
  const sample=async()=>{
    while(sampling) {
      try {
        const [state,positions]=await Promise.all([live.state(),world(live)]);
        timeline.push({at:Date.now(),rare:state.rareHuntState,positions:Object.fromEntries([W,P].map(n=>[n,{map:positions.players[n].map,x:Math.round(positions.players[n].x),y:Math.round(positions.players[n].y),hp:positions.players[n].hp}]))});
      } catch(error) { timeline.push({at:Date.now(),error:String(error)}); }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  };
  let sampler:Promise<void>|undefined;
  try {
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
    const catalog=(await live.state(true)).monsterChoices;
    const regions=zones(catalog,['phoenix']);
    const order=regions.map(a=>a.id!);
    const region=(p:{map:string;x:number;y:number})=>regions.find(a=>a.map===p.map&&inside(a.boundary!,p))?.id||null;

    // Declared fixture: replace the server's Phoenix with one from its own
    // randomrespawn definition, pinned to Spooky Forest and with bounded HP so
    // the fight ends. Its death uses the unmodified definition, so the respawn
    // is native: random region, full HP.
    const seeded=await live.admin(`output=(()=>{
      const found=[];for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{}))if(m.type==='phoenix'&&!m.dead)found.push(m);
      if(found.length!==1)throw Error('Expected one native Phoenix, found '+found.length);
      const native=found[0],definition=native.map_def,boundaries=definition.boundaries,original=G.monsters.phoenix;
      remove_monster(native,{nospawn:true,silent:true});
      try {
        definition.boundaries=boundaries.filter(b=>b[0]==='halloween');
        G.monsters.phoenix={...original,hp:${SEEDED_HP},attack:1};
        const m=new_monster('halloween',definition,{});
        m.drops=[[1000000,'gem0',1]];
        return {id:m.id,map:m.map,in:m.in,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp,speed:m.speed,removed:{id:native.id,map:native.map,x:native.x,y:native.y}};
      } finally {definition.boundaries=boundaries;G.monsters.phoenix=original;}
    })()`);
    await info.attach('phoenix-seeded-encounter',{body:JSON.stringify(seeded),contentType:'application/json'});
    expect(seeded.map).toBe('halloween');
    expect(seeded.hp).toBe(SEEDED_HP);

    const before=await world(live);
    await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
    sampler=sample();

    // 1. The fighters split up instead of travelling together.
    await expect.poll(async()=>{
      const searchers=(await live.state()).rareHuntState?.patrol?.searchers||{};
      return !!searchers[W]&&!!searchers[P]&&searchers[W].regionId!==searchers[P].regionId;
    },{timeout:120_000,message:'Both fighters must receive different spawn regions'}).toBe(true);
    await expect.poll(async()=>{
      const s=await world(live),a=region(s.players[W]),b=region(s.players[P]);
      return (!!a&&!!b&&a!==b)||(await live.state()).rareHuntState?.encounter?.targetId===seeded.id;
    },{timeout:600_000,intervals:[1000],message:'The fighters must stand in different spawn regions while searching'}).toBe(true);

    // 2. Somebody spots it; nobody attacks until everyone is in range.
    await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.targetId,{timeout:900_000,intervals:[1000],
      message:'A searcher must find the seeded Phoenix in Spooky Forest'}).toBe(seeded.id);
    await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.gatheredAt||0,{timeout:600_000,intervals:[500],
      message:'Both fighters must converge on the Phoenix'}).toBeGreaterThan(0);
    const gathered=(await live.state()).rareHuntState.encounter;
    expect(gathered.gatheredWithout,'Every fighter must gather before the deadline').toEqual([]);
    const hits=async()=>(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat()
      .filter((event:any)=>event.event==='hit'&&String(event.data?.id)===String(seeded.id)&&[W,P].includes(event.data?.hid)&&event.data?.damage>0);
    await expect.poll(async()=>(await hits()).length,{timeout:120_000,message:'The gathered party must attack the Phoenix'}).toBeGreaterThan(0);
    const firstHit=Math.min(...(await hits()).map((event:any)=>event.at));
    expect(firstHit,'No party hit may land before every fighter is in range').toBeGreaterThanOrEqual(gathered.gatheredAt);
    const atGather=timeline.filter(s=>s.positions&&Math.abs(s.at-gathered.gatheredAt)<=2000);
    await info.attach('phoenix-hold-fire-until-gathered',{body:JSON.stringify({gathered,firstHit,atGather},null,2),contentType:'application/json'});

    // 3. Real combat kills it and the guaranteed drop is looted.
    await expect.poll(async()=>live.admin(`output=!!Object.values(instances).some(i=>i.monsters[${JSON.stringify(seeded.id)}])`),
      {timeout:180_000,message:'Real combat must kill the seeded Phoenix'}).toBe(false);
    const gems=(snapshot:any)=>[W,P,M].reduce((sum,name)=>sum+quantity(snapshot.players[name].items,'gem0'),0);
    await expect.poll(async()=>gems(await world(live)),{timeout:60_000,message:'The guaranteed drop must reach party inventory'}).toBeGreaterThan(gems(before));

    // 4. After the kill the fighters spread out before the respawn.
    await expect.poll(async()=>{
      const patrol=(await live.state()).rareHuntState?.patrol;
      return patrol?.stage==='respawn'&&!!patrol.searchers?.[P];
    },{timeout:60_000,message:'The non-leader must leave to pre-position while the respawn timer runs'}).toBe(true);
    const respawn=(await live.state()).rareHuntState.patrol;
    expect(respawn.readyAt).toBeGreaterThan(Date.now()-5000);
    await expect.poll(async()=>{
      const searchers=(await live.state()).rareHuntState?.patrol?.searchers||{};
      return !!searchers[W]&&!!searchers[P]&&searchers[W].regionId!==searchers[P].regionId;
    },{timeout:60_000,message:'Both fighters must head to different regions for the respawn'}).toBe(true);
    await info.attach('phoenix-respawn-spread',{body:JSON.stringify((await live.state()).rareHuntState,null,2),contentType:'application/json'});

    // 5. The native respawn (random region, full HP) is found again.
    await expect.poll(async()=>{
      const id=(await live.state()).rareHuntState?.encounter?.targetId;
      return !!id&&id!==seeded.id;
    },{timeout:900_000,intervals:[1000],message:'The search must find the native respawn'}).toBe(true);
    const second=(await live.state()).rareHuntState.encounter;
    const respawned=await live.admin(`output=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).filter(m=>m.type==='phoenix'&&!m.dead).map(m=>({id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp}))`);
    await info.attach('phoenix-native-respawn-found',{body:JSON.stringify({second,respawned},null,2),contentType:'application/json'});
    expect(respawned.map((m:any)=>String(m.id))).toContain(String(second.targetId));
  } finally {
    sampling=false;
    await sampler;
    const summary={
      gatherRange:GATHER_RANGE,
      encounters:[...new Set(timeline.map(s=>s.rare?.encounter?.targetId).filter(Boolean))],
      stages:timeline.map(s=>({at:s.at,patrol:s.rare?.patrol?.stage,encounter:s.rare?.encounter?.stage,message:s.rare?.message})),
    };
    await info.attach('phoenix-search-timeline',{body:JSON.stringify({summary,timeline},null,2),contentType:'application/json'});
  }
});

// Failure 15a: the Phoenix already fights one fighter before the party gathers.
// The spotter engages at once; the other fighter must keep converging and join.
test('Phoenix already fighting the spotter: the other fighter keeps converging and joins the fight',async({live},info)=>{
  test.setTimeout(1_200_000);
  const timeline:any[]=[];
  let sampling=true;
  const sample=async()=>{
    while(sampling) {
      try {
        const [state,positions]=await Promise.all([live.state(),world(live)]);
        timeline.push({at:Date.now(),encounter:state.rareHuntState?.encounter,
          positions:Object.fromEntries([W,P].map(n=>[n,{map:positions.players[n].map,x:Math.round(positions.players[n].x),y:Math.round(positions.players[n].y)}]))});
      } catch(error) { timeline.push({at:Date.now(),error:String(error)}); }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  };
  let sampler:Promise<void>|undefined;
  try {
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
    const order=zones((await live.state(true)).monsterChoices,['phoenix']).map(a=>a.id!);
    // Declared fixture: as in the first journey, but with enough HP that the spotter
    // cannot finish it alone before the other fighter arrives.
    const seeded=await live.admin(`output=(()=>{
      const found=[];for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{}))if(m.type==='phoenix'&&!m.dead)found.push(m);
      if(found.length!==1)throw Error('Expected one native Phoenix, found '+found.length);
      const native=found[0],definition=native.map_def,boundaries=definition.boundaries,original=G.monsters.phoenix;
      remove_monster(native,{nospawn:true,silent:true});
      try {
        definition.boundaries=boundaries.filter(b=>b[0]==='halloween');
        G.monsters.phoenix={...original,hp:2000000,attack:1};
        const m=new_monster('halloween',definition,{});
        return {id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp};
      } finally {definition.boundaries=boundaries;G.monsters.phoenix=original;}
    })()`);
    await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
    sampler=sample();
    await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.targetId,{timeout:900_000,intervals:[500],
      message:'A searcher must find the seeded Phoenix'}).toBe(seeded.id);

    // The Phoenix aggroes the fighter nearest to it, before the other one gathers.
    const aggro=await live.admin(`output=(()=>{
      const m=Object.values(instances.halloween.monsters).find(m=>m.id===${JSON.stringify(seeded.id)});
      const near=Object.values(players).filter(p=>p.map==='halloween'&&[${JSON.stringify(W)},${JSON.stringify(P)}].includes(p.name))
        .sort((a,b)=>Math.hypot(a.x-m.x,a.y-m.y)-Math.hypot(b.x-m.x,b.y-m.y))[0];
      if(!near)throw Error('No fighter on the Phoenix map');
      target_player(m,near);
      const others=Object.values(players).filter(p=>[${JSON.stringify(W)},${JSON.stringify(P)}].includes(p.name)&&p.name!==near.name)
        .map(p=>({name:p.name,map:p.map,x:p.x,y:p.y,distance:p.map===m.map?Math.hypot(p.x-m.x,p.y-m.y):null}));
      return {spotter:near.name,target:m.target,phoenix:{x:m.x,y:m.y},others,at:Date.now()};
    })()`);
    await info.attach('phoenix-aggro-before-gather',{body:JSON.stringify(aggro,null,2),contentType:'application/json'});
    const walker=aggro.others[0];
    expect(walker.distance===null||walker.distance>300,'The other fighter must still be converging when the fight starts').toBe(true);

    const hitsBy=async(name:string)=>(await live.clients[name].events())
      .filter((event:any)=>event.event==='hit'&&String(event.data?.id)===String(seeded.id)&&event.data?.hid===name&&event.data?.damage>0);
    await expect.poll(async()=>(await hitsBy(aggro.spotter)).length,{timeout:60_000,message:'The spotter must fight the Phoenix that targets it'}).toBeGreaterThan(0);
    const spotterFirstHit=Math.min(...(await hitsBy(aggro.spotter)).map((event:any)=>event.at));

    // The other fighter keeps walking in while the spotter fights, then joins.
    const distance=async()=>live.admin(`output=(()=>{
      const m=Object.values(instances.halloween.monsters).find(m=>m.id===${JSON.stringify(seeded.id)});
      const p=Object.values(players).find(p=>p.name===${JSON.stringify(walker.name)});
      return m&&p&&p.map===m.map?Math.hypot(p.x-m.x,p.y-m.y):null;
    })()`);
    await expect.poll(async()=>{const d=await distance();return d!==null&&d<=300;},{timeout:600_000,intervals:[1000],
      message:'The other fighter must keep converging after the spotter starts fighting'}).toBe(true);
    const arrivedAt=Date.now();
    await expect.poll(async()=>(await hitsBy(walker.name)).length,{timeout:120_000,message:'The arriving fighter must join the fight'}).toBeGreaterThan(0);
    const walkerFirstHit=Math.min(...(await hitsBy(walker.name)).map((event:any)=>event.at));
    const walkerSamples=timeline.filter(s=>s.positions&&s.at>=aggro.at).map(s=>({at:s.at,...s.positions[walker.name]}));
    await info.attach('phoenix-converge-during-fight',{body:JSON.stringify({aggro,spotterFirstHit,arrivedAt,walkerFirstHit,walkerSamples},null,2),contentType:'application/json'});
    expect(walkerFirstHit,'The arriving fighter attacks only after reaching range').toBeGreaterThanOrEqual(arrivedAt-5000);
  } finally {
    sampling=false;
    await sampler;
    await info.attach('phoenix-converge-timeline',{body:JSON.stringify(timeline,null,2),contentType:'application/json'});
  }
});

// Failure 8a: a lone searcher attacked by aggressive monsters must defend itself
// and keep searching. Live, FonzeWarrior shuffled in place at this bee spawn.
test.describe('searcher under attack',()=>{
  const beeSpawn={map:'main',x:150,y:1490};
  test.use({initialPosition:beeSpawn});
  test('Phoenix searchers starting on an aggressive spawn defend themselves and cover a region',async({live},info)=>{
    test.setTimeout(600_000);
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
    const order=zones((await live.state(true)).monsterChoices,['phoenix']).map(a=>a.id!);
    // Declared fixture: no Phoenix on the server, so only searching is observed.
    const removed=await live.admin(`output=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).filter(m=>m.type==='phoenix'&&!m.dead).map(m=>{remove_monster(m,{nospawn:true,silent:true});return {id:m.id,map:m.map}})`);
    const bees=await live.admin(`output=Object.values(instances.main.monsters).filter(m=>(m.type==='bee'||m.type==='poisio')&&Math.hypot(m.x-${beeSpawn.x},m.y-${beeSpawn.y})<400).map(m=>({id:m.id,type:m.type,x:m.x,y:m.y}))`);
    await info.attach('aggressive-spawn-fixture',{body:JSON.stringify({beeSpawn,removed,bees},null,2),contentType:'application/json'});
    expect(bees.length,'The starting point must be next to aggressive monsters').toBeGreaterThan(0);
    await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
    const samples:any[]=[];
    await expect.poll(async()=>{
      const [state,positions]=await Promise.all([live.state(),world(live)]);
      const patrol=state.rareHuntState?.patrol;
      samples.push({at:Date.now(),covered:patrol?.covered?.length||0,retryReason:patrol?.retryReason||null,
        positions:Object.fromEntries([W,P].map(n=>[n,{map:positions.players[n].map,x:Math.round(positions.players[n].x),y:Math.round(positions.players[n].y),hp:positions.players[n].hp}]))});
      return patrol?.covered?.length||0;
    },{timeout:300_000,intervals:[2000],message:'Searchers must leave the aggressive spawn and finish checking a region'}).toBeGreaterThan(0);
    const hits=(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat()
      .filter((event:any)=>event.event==='hit'&&[W,P].includes(event.data?.hid)&&bees.some((b:any)=>String(b.id)===String(event.data?.id)));
    await info.attach('searcher-defense-timeline',{body:JSON.stringify({hitsOnSpawnMonsters:hits.length,samples},null,2),contentType:'application/json'});
    expect(samples.every(s=>!/no movement progress/.test(s.retryReason||'')),'Defending must not stall the search into the watchdog').toBe(true);
  });
});
