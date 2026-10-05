import {test,expect} from './live-fixtures';
import {W,P,M,world,quantity,prepareHunt,beginAnniversary,endAnniversary,spawnRare,cleanupEvents} from './game/hunt-events';

for(const mode of ['resume','restart','hunt-off'] as const) test(`native anniversary visit ${mode} delivers real kiss rewards and event deselection returns to current Hunt policy`,async({live},info)=>{
  test.setTimeout(420_000);
  try {
    const hunt=await prepareHunt(live);
    await live.post('/formation',{character:W,eventSelections:['anniversary']});
    await live.post('/formation',{character:M,eventSelections:['anniversary']});
    const before=await world(live),seed=await beginAnniversary(live,P);
    await info.attach('anniversary-native-initial-schedule',{body:JSON.stringify(seed),contentType:'application/json'});
    await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
    await expect.poll(async()=>(await live.state()).anniversary?.eventCycle?.id,{timeout:45_000}).toBeTruthy();
    await expect.poll(async()=>quantity((await world(live)).players[M].items,'anniversarygift'),{timeout:120_000,message:'The actual upstream kiss must deliver a gift'}).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    const afterGift=await world(live);
    if(mode==='restart')await live.restartCoordinator();
    if(mode==='hunt-off')await live.post('/farming-mode',{character:W,mode:'default'});
    // Explicit user deselection is the completion trigger. The initial native
    // scheduling clock does not claim coverage of natural wall-clock expiry.
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/formation',{character:M,eventSelections:[]});
    await endAnniversary(live);
    if(mode==='hunt-off') {
      await expect.poll(async()=>(await live.state()).monsterHunt,{timeout:45_000}).toBeFalsy();
      await expect.poll(async()=>(await live.state()).anniversary?.eventCycle?.returnCompletedAt||!(await live.state()).anniversary?.eventCycle,{timeout:90_000}).toBeTruthy();
      expect((await live.state()).monsterHunt).toBeFalsy();
    } else {
      await expect.poll(async()=>{const h=(await live.state()).monsterHunt;return h?.cycleId===hunt.cycleId&&!['paused-event','paused'].includes(h.stage);},{timeout:90_000}).toBe(true);
      const count=afterGift.players[W].quest.c;
      await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:120_000}).toBeLessThan(count);
    }
    expect(quantity((await world(live)).players[M].items,'anniversarygift')).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    await info.attach('anniversary-native-hunt-result',{body:JSON.stringify({mode,hunt,before,afterGift,final:await world(live),state:await live.state()}),contentType:'application/json'});
  } finally {await cleanupEvents(live);}
});

test('disabled anniversary selection leaves native Hunt fighting and creates no visit reward',async({live},info)=>{
  test.setTimeout(300_000);
  try {
    const hunt=await prepareHunt(live),before=await world(live);
    const seed=await beginAnniversary(live,M);
    await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
    await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:120_000}).toBeLessThan(before.players[W].quest.c);
    const state=await live.state(),after=await world(live);
    expect(state.monsterHunt.cycleId).toBe(hunt.cycleId);
    expect(state.monsterHunt.stage).not.toBe('paused-event');
    expect(quantity(after.players[W].items,'anniversarygift')).toBe(quantity(before.players[W].items,'anniversarygift'));
    expect(after.players[W].conditions.anniversary_kiss).toBeFalsy();
    await info.attach('anniversary-disabled-native-evidence',{body:JSON.stringify({seed,before,after,state}),contentType:'application/json'});
  } finally {await cleanupEvents(live);}
});

// Failure inventory: e2e/merchant-anniversary-wait-failures.md. A round whose featured
// player is unavailable must not hold the merchant: queued work runs inside the round.
test('merchant works through an anniversary round whose featured player is unavailable',async({live},info)=>{
  test.setTimeout(300_000);
  try {
    await live.post('/formation',{character:M,eventSelections:['anniversary']});
    await live.post('/merchant/force-stand',{enabled:false});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'inventory cleanout':true}});
    const seeded=await live.admin(`output=(()=>{const w=get_player(${JSON.stringify(W)});
      for(let i=0;i<w.isize-2;i++)if(!w.items[i])w.items[i]={name:'feather0',q:1};
      cache_player_items(w);resend(w,'reopen+cid');return w.items;})()`);
    await expect.poll(async()=>quantity((await live.clients[W].snapshot()).items,'feather0')).toBe(quantity(seeded,'feather0'));
    const seed=await beginAnniversary(live,P);
    await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
    // Native ineligibility: an invisible featured player is no longer a valid target.
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)});p.s.invis={ms:600000};resend(p,'u+cid');
      // Availability is recomputed by the event tick; publish it now, as beginAnniversary does.
      anniversary_tick();return E.anniversary})()`);
    await expect.poll(async()=>(await world(live)).anniversary?.available,{timeout:30_000}).toBe(false);
    const round=(await world(live)).anniversary;
    expect(round.target).toBe(P);
    await live.post('/merchant/cleanout',{character:W});
    await expect.poll(async()=>quantity((await world(live)).players[W].items,'feather0'),
      {timeout:150_000,message:'The merchant must collect during the live round, not after it'}).toBeLessThan(quantity(seeded,'feather0'));
    const during=await world(live),state=await live.state();
    expect(during.anniversary?.live,'The first transfer happened while the unavailable round was still live').toBe(true);
    expect(during.anniversary?.round).toBe(round.round);
    expect((state.merchantActivity||[]).some((entry:any)=>/deferred: anniversary/.test(entry.message)),
      'The merchant must not defer the job for the anniversary').toBe(false);
    await info.attach('anniversary-unavailable-merchant-work',{body:JSON.stringify({seed,round,during,activity:state.merchantActivity}),contentType:'application/json'});
  } finally {
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)});if(p){delete p.s.invis;resend(p,'u+cid')}if(events.anniversary)anniversary_tick();return true})()`).catch(()=>{});
    await cleanupEvents(live);
  }
});

for(const type of ['phoenix','goldenbat','cutebee','hen','rooster','tinyp']) test(`native ${type} interruption kills and loots before resuming the same Hunt`,async({live},info)=>{
  test.setTimeout(420_000);
  try {
    const hunt=await prepareHunt(live);
    await expect.poll(async()=>(await live.state()).monsterHunt?.stage,{timeout:120_000}).toBe('farming');
    if(type==='phoenix') {
      // Failure inventory: a follower's personal reset can be newer than its
      // destination group; stale queues must stay rejected without stalling it.
      const previous=(await live.state()).farmingProfiles[W].groupedCombatResetAt;
      await live.post('/formation',{character:P,follow:false});
      await expect.poll(async()=>(await live.state()).characters[P]?.groupedCombat?.epoch,{timeout:20_000}).toBeGreaterThan(previous);
      await live.post('/formation',{character:P,follow:true});
      await expect.poll(async()=>{
        const state=await live.state(),epoch=state.farmingProfiles[W].groupedCombatResetAt;
        // Scatter publishes no group snapshot. The existing leader receives the
        // new group epoch when rare combat restores grouped mode below.
        return epoch>previous&&state.characters[P]?.groupedCombat?.epoch===epoch&&
          state.characters[W]?.groupedCombat?.epoch<=epoch;
      },{timeout:20_000,message:'The destination group must admit the rejoining native follower reset epoch'}).toBe(true);
      const state=await live.state();
      expect(state.monsterHunt.cycleId).toBe(hunt.cycleId);
      await info.attach('phoenix-native-follow-reset-boundary',{body:JSON.stringify({previous,groupEpoch:state.farmingProfiles[W].groupedCombatResetAt,members:[W,P].map(name=>({name,epoch:state.characters[name].groupedCombat.epoch}))}),contentType:'application/json'});
    }
    if(type==='tinyp') {
      await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});add_item(p,{name:'fieldgen0'});resend(p,'reopen');return p.items.filter(i=>i?.name==='fieldgen0')})()`);
      await expect.poll(async()=>quantity((await live.state()).characters[W].items.map((entry:any)=>entry?.item),'fieldgen0')).toBe(1);
    }
    await live.post('/rare-hunting',{rules:{[type]:{enabled:true,keepMoving:false,priority:999}},useFieldGenerators:type==='tinyp'});
    const before=await world(live),spawnedAt=Date.now(),spawn=await spawnRare(live,type);
    await info.attach('native-rare-initial-encounter',{body:JSON.stringify(spawn),contentType:'application/json'});
    if(type==='tinyp') {
      const fields=()=>live.admin(`output=Object.values(instances[${JSON.stringify(spawn.map)}].monsters).filter(m=>m.type==='fieldgen0'&&m.owner===${JSON.stringify(W)}).map(m=>({id:m.id,owner:m.owner,map:m.map,x:m.x,y:m.y,hp:m.hp}))`);
      await expect.poll(async()=>(await fields()).length,{timeout:45_000,message:'The native runtime must consume and deploy its field generator'}).toBeGreaterThan(0);
      expect(quantity((await world(live)).players[W].items,'fieldgen0')).toBe(0);
      await info.attach('native-field-generator-deployment',{body:JSON.stringify(await fields()),contentType:'application/json'});
    }
    await expect.poll(async()=>(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat()
      .some((event:any)=>event.event==='hit'&&String(event.data?.id)===String(spawn.id)&&[W,P].includes(event.data?.hid)&&event.data?.damage>0),
    {timeout:45_000,message:'A native party hit receipt must prove damage to the spawned rare, including a killing blow'}).toBe(true);
    if(type==='phoenix')await expect.poll(async()=>{
      const state=await live.state(),epoch=state.farmingProfiles[W].groupedCombatResetAt;
      return [W,P].every(name=>state.characters[name]?.groupedCombat?.epoch===epoch);
    },{timeout:20_000,message:'Native members must acknowledge the shared reset when rare combat publishes grouped snapshots'}).toBe(true);
    await expect.poll(async()=>live.admin(`output=!!instances[${JSON.stringify(spawn.map)}]?.monsters[${JSON.stringify(spawn.id)}]`),{timeout:120_000,message:'Real combat must kill the seeded rare'}).toBe(false);
    await expect.poll(async()=>{const s=await live.state();return s.monsterHunt?.cycleId===hunt.cycleId&&s.monsterHunt.stage==='farming'&&!s.rareHuntState?.encounter&&!s.farmingProfiles?.[W]?.rareHuntReturn;},{timeout:90_000}).toBe(true);
    const gemTotal=(snapshot:any)=>[W,P,M].reduce((sum,name)=>sum+quantity(snapshot.players[name].items,'gem0'),0);
    await expect.poll(async()=>gemTotal(await world(live)),{timeout:45_000,message:'The rare\'s guaranteed native drop must reach party inventory'}).toBeGreaterThan(gemTotal(before));
    const lootReceipts=async()=>(await Promise.all([W,P,M].map(name=>live.clients[name].events()))).flat().filter((event:any)=>event.at>=spawnedAt&&event.event==='chest_opened'&&event.data?.items?.some((item:any)=>item.name==='gem0'));
    await expect.poll(async()=>(await lootReceipts()).length,
      {timeout:15_000,message:'The native chest receipt must reach the client after inventory updates on the server'}).toBeGreaterThan(0);
    const loot=await lootReceipts();
    expect(loot.length,'Native chest_opened must confirm the seeded rare drop was looted').toBeGreaterThan(0);
    await info.attach('native-rare-chest-opened',{body:JSON.stringify({spawn,loot}),contentType:'application/json'});
    const afterRare=await world(live);
    expect(afterRare.players[W].xp).toBeGreaterThan(before.players[W].xp);
    await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:90_000}).toBeLessThan(afterRare.players[W].quest.c);
    await info.attach('native-rare-hunt-resumed',{body:JSON.stringify({hunt,spawn,before,afterRare,final:await world(live),state:await live.state()}),contentType:'application/json'});
  } finally {await cleanupEvents(live);}
});

test('disabled rare stays alive while native Hunt progresses and rejected settings preserve preferences',async({live},info)=>{
  test.setTimeout(300_000);
  try {
    const hunt=await prepareHunt(live);
    await expect.poll(async()=>(await live.state()).monsterHunt?.stage,{timeout:120_000}).toBe('farming');
    await live.post('/rare-hunting',{rules:{goldenbat:{enabled:false}},useFieldGenerators:false});
    const saved=(await live.state()).passiveHunting;
    for(const body of [{goldenbat:'true'},{rules:{fieldgen0:{enabled:true}}},{rules:{unknown_native_monster:{enabled:true}}}]) {
      const r=await fetch(live.url+'/party-api/rare-hunting',{method:'POST',headers:{'Content-Type':'application/json',Origin:live.url},body:JSON.stringify(body)});
      expect(r.status).toBe(400);
    }
    expect((await live.state()).passiveHunting).toEqual(saved);
    const spawn=await spawnRare(live,'goldenbat'),before=await world(live);
    await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:90_000}).toBeLessThan(before.players[W].quest.c);
    expect(await live.admin(`output=!!instances[${JSON.stringify(spawn.map)}]?.monsters[${JSON.stringify(spawn.id)}]`)).toBe(true);
    expect((await live.state()).monsterHunt.cycleId).toBe(hunt.cycleId);
    await info.attach('native-disabled-rare',{body:JSON.stringify({spawn,before,final:await world(live),state:await live.state()}),contentType:'application/json'});
  } finally {await cleanupEvents(live);}
});
