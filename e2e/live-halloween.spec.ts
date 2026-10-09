import { test, expect, type LiveGame } from './live-fixtures';
import { killNativeCharacter } from './hunt-interruption-helpers';

const W = 'E2EWarrior', P = 'E2EPriest', fighters = [W, P];

test.beforeEach(async ({live}) => {
  // Reset only declarations from previous Halloween cases, before this case
  // creates any encounter. Never manufacture a kill or absence during a fight.
  await live.admin(`output=(()=>{
    for(const instance of Object.values(instances))for(const monster of Object.values(instance.monsters||{}))
      if(monster.e2eHalloween)remove_monster(monster,{silent:true});
    for(const entry of Object.values(globalThis.__e2eHalloweenAnnouncements||{}))clearInterval(entry.timer);
    globalThis.__e2eHalloweenAnnouncements={};
    for(const type of ['mrgreen','mrpumpkin','slenderman'])delete E[type];
    broadcast_e();return true;})()`);
});

// Failure inventory, written before runtime implementation: unsupported native
// bosses, legacy surprise opt-in, staging treated as live combat, early session
// retirement, timer changes extending ownership forever, absent-spawn retries,
// stale Slender sightings, map-only native announcements, obsolete warp routes,
// reflected magic, death losing attendance, and return losing saved ownership.
// These fixtures declare initial encounters/announcements, never damage, deaths,
// successful moves, loot receipts or event completion.
async function prepare(live: LiveGame, event: string) {
  await live.post('/formation', { leader: W });
  await live.post('/formation', { character: P, follow: true });
  const checkpoint = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return {map:p.map,x:p.x,y:p.y}})()`);
  await live.post('/travel', checkpoint);
  await expect.poll(async () => {
    const state = await live.state();
    return !state.activeConvoy || state.activeConvoy.phase === 'complete';
  }, { timeout: 30_000 }).toBe(true);
  await live.post('/formation', { character: W, eventSelections: [event] });
}

async function world(live: LiveGame, event: string) {
  return live.admin(`output=(()=>{const m=get_monster(${JSON.stringify(event)});return {
    event:E[${JSON.stringify(event)}]||null,boss:m?{id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp}:null,
    players:Object.fromEntries(${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))}})()`);
}

async function announceSpawn(live: LiveGame, event: string, leadMs: number) {
  return live.admin(`output=(()=>{
    const type=${JSON.stringify(event)},spawn=new Date(Date.now()+${leadMs}),announcement={live:false,spawn};
    globalThis.__e2eHalloweenAnnouncements ||= {};
    clearInterval(globalThis.__e2eHalloweenAnnouncements[type]?.timer);
    // The pinned backend deletes non-live E entries in event_loop even before
    // their timer. Declare this schedule at the native server_info read boundary;
    // actual boss creation/damage/death/movement stay entirely native.
    if(!globalThis.__e2eHalloweenNativeBroadcast){
      globalThis.__e2eHalloweenNativeBroadcast=broadcast_e;
      broadcast_e=function(dontSend){
        if(dontSend)return;
        const snapshot={...E};
        for(const [name,entry] of Object.entries(globalThis.__e2eHalloweenAnnouncements)){
          if(get_monster(name))entry.liveSeen=true;
          if(!entry.liveSeen&&Date.now()<=entry.expiresAt)snapshot[name]=entry.announcement;
        }
        broadcast('server_info',snapshot);
      };
    }
    const entry={announcement,expiresAt:spawn.getTime()+125000,liveSeen:false,timer:null};
    globalThis.__e2eHalloweenAnnouncements[type]=entry;
    const publish=()=>{
      if(get_monster(type))entry.liveSeen=true;
      if(entry.liveSeen||Date.now()>entry.expiresAt){clearInterval(entry.timer);return;}
      broadcast_e();
    };
    entry.timer=setInterval(publish,500);publish();
    return {...announcement,fixture:'immutable native server_info schedule boundary',expiresAt:spawn.getTime()+125000};
  })()`);
}

async function spawn(live: LiveGame, event: string, map: string, x: number, y: number, nativeAdds = false) {
  return live.admin(`output=(()=>{
    const type=${JSON.stringify(event)}, original=G.monsters[type];
    if(get_monster(type))throw Error('Expected clean native encounter');
    const eligible=${JSON.stringify(fighters)}.map(name=>get_player(name)).filter(p=>{
      const damage=p.damage_type||G.items[p.slots?.mainhand?.name]?.damage_type||G.classes[p.ctype]?.damage_type;
      return type!=='slenderman'||['physical','pure'].includes(damage);
    });
    const dps=eligible.reduce((n,p)=>n+p.attack*p.frequency,0);
    if(!dps)throw Error('No native fighter eligible for declared encounter');
    try {
      G.monsters[type]={...original,hp:Math.ceil(dps*90),attack:1,speed:0,charge:0,range:1,aggro:0,phresistance:0,spawns:${nativeAdds ? 'original.spawns' : '[]'}};
      const m=new_monster(${JSON.stringify(map)},{type,count:1,boundary:[${x},${y},${x},${y}]},{temp:1});
      m.e2eHalloween=true;
      E[type]={live:true,map:m.map,hp:m.hp,max_hp:m.max_hp,target:m.target};
      // Native Slender status deliberately omits coordinates.
      if(type!=='slenderman'){E[type].x=m.x;E[type].y=m.y;}
      broadcast_e();return {id:m.id,type,map:m.map,x:m.x,y:m.y,hp:m.hp,eligibleFighters:eligible.map(p=>p.name),difficultyDps:dps,initialDefinition:G.monsters[type],nativeStatus:E[type]};
    } finally {G.monsters[type]=original;}
  })()`);
}

for (const encounter of [{id:'mrgreen',add:'greenjr',drop:'ashleaf',map:'spookytown',x:636,y:995},
  {id:'mrpumpkin',add:'jr',drop:'pstem',map:'halloween',x:-495,y:685}]) {
  test.describe(`${encounter.id} native adds`,()=>{
    test.use({initialPosition:{map:encounter.map,x:encounter.x+160,y:encounter.y}});
    test(`Halloween ${encounter.id} prioritizes native threshold adds, loots and resumes boss`,async({live},info)=>{
      test.setTimeout(600_000);
      // Failure inventory: bosses always outrank adds; followers split targets;
      // reflected Green Jr magic; selected add replaces boss reentry coordinates;
      // fabricated spawn/death/loot; add policy survives event deselection.
      const before=await live.admin(`output=${JSON.stringify(fighters)}.map(name=>({name,items:get_player(name).items}))`);
      await live.admin(`output=(()=>{
        globalThis.__e2eThresholdAdds=[];
        const original=new_monster;globalThis.__e2eAddSpawner=original;
        new_monster=function(...args){const m=original.apply(this,args);
          if(m&&m.type===${JSON.stringify(encounter.add)}&&m.master){
            const boss=get_monster(m.master);globalThis.__e2eThresholdAdds.push({id:String(m.id),master:String(m.master),type:m.type,at:Date.now(),bossHp:boss?.hp,bossMaxHp:boss?.max_hp});
          }return m;};return true;})()`);
      try {
        await prepare(live,encounter.id);
        const seed=await spawn(live,encounter.id,encounter.map,encounter.x,encounter.y,true);
        await info.attach('native-threshold-spawn-definition',{body:JSON.stringify(seed),contentType:'application/json'});
        const ledgers:any[]=[];
        await expect.poll(async()=>{
          const sample=await live.admin(`output={adds:globalThis.__e2eThresholdAdds,boss:get_monster(${JSON.stringify(seed.id)})?{hp:get_monster(${JSON.stringify(seed.id)}).hp}:null}`);
          ledgers.push({at:Date.now(),...sample});
          const events=await live.clients[W].events();
          return [0.75,0.5,0.25].every(threshold=>sample.adds.some((add:any)=>
            add.master===String(seed.id)&&add.bossHp/add.bossMaxHp<=threshold&&add.bossHp/add.bossMaxHp>threshold-0.2&&
            events.some((event:any)=>event.event==='hit'&&String(event.data?.id)===add.id&&event.data?.hid===W&&event.data?.damage>0)));
        },{timeout:300_000,intervals:[250,500],message:'Native boss damage must spawn and the warrior must attack adds at each threshold'}).toBe(true);
        await expect.poll(async()=>!(await world(live,encounter.id)).boss,{timeout:180_000}).toBe(true);
        await expect.poll(async()=>{
          const items=await live.admin(`output=${JSON.stringify(fighters)}.flatMap(name=>get_player(name).items)`);
          return items.reduce((n:number,item:any)=>n+(item?.name===encounter.drop?(item.q||1):0),0)>
            before.flatMap((p:any)=>p.items).reduce((n:number,item:any)=>n+(item?.name===encounter.drop?(item.q||1):0),0);
        },{timeout:30_000,message:'Real native add loot must reach party inventory'}).toBe(true);
        await info.attach('native-threshold-add-combat-and-loot',{body:JSON.stringify({seed,before,ledgers,
          events:await live.clients[W].events(),after:await live.admin(`output=${JSON.stringify(fighters)}.map(name=>({name,items:get_player(name).items}))`),state:await live.state()}),contentType:'application/json'});
      } finally {
        await live.admin(`if(globalThis.__e2eAddSpawner){new_monster=globalThis.__e2eAddSpawner;delete globalThis.__e2eAddSpawner;}output=true`);
        await live.post('/formation',{character:W,eventSelections:[]});
      }
    });
  });
}

for (const encounter of [{ id: 'mrgreen', map: 'spookytown', x: 636, y: 995 }, { id: 'mrpumpkin', map: 'halloween', x: -495, y: 685 }]) {
  test.describe(encounter.id, () => {
    test.use({ initialPosition: { map: encounter.map, x: encounter.x + 160, y: encounter.y } });
    test(`Halloween ${encounter.id} stages from native timer, fights, recovers death and returns after deselection`, async ({ live }, info) => {
      test.setTimeout(600_000);
      const timer = await announceSpawn(live, encounter.id, 55000);
      await info.attach('declared-native-spawn-announcement', { body: JSON.stringify(timer), contentType: 'application/json' });
      await prepare(live, encounter.id);
      await expect.poll(async () => {
        const state = await live.state();
        return fighters.every(name => state.characters[name]?.joinedEvent === encounter.id &&
          state.characters[name]?.serverStagingEvents?.some((event: any) => event.name === encounter.id));
      }, { timeout: 35_000, message: 'Both real clients must attend the announced boss before it is live' }).toBe(true);
      await expect.poll(async () => {
        const native = await world(live, encounter.id);
        return !native.boss && fighters.every(name => Math.hypot(native.players[name].x - encounter.x, native.players[name].y - encounter.y) < 80);
      }, { timeout: 35_000, message: 'Staging must actually walk to the fixed native spawn region' }).toBe(true);
      await live.restartCoordinator();
      await expect.poll(async () => (await live.state()).characters[W]?.joinedEvent, { timeout: 20_000 }).toBe(encounter.id);
      await expect.poll(() => Date.now() >= Date.parse(timer.spawn), { timeout: 60_000 }).toBe(true);
      expect((await live.state()).eventReturn, 'Ten seconds of non-live staging must not retire attendance').toBeFalsy();
      const seeded = await spawn(live, encounter.id, encounter.map, encounter.x, encounter.y);
      await info.attach('native-halloween-encounter-seed', { body: JSON.stringify(seeded), contentType: 'application/json' });
      await expect.poll(async () => (await world(live, encounter.id)).boss?.hp, { timeout: 60_000 }).toBeLessThan(seeded.hp);
      const death = await killNativeCharacter(live, W);
      await expect.poll(async () => {
        const native = await world(live, encounter.id), state = await live.state();
        const packets = await live.clients[W].events();
        const dead = packets.find((entry: any) => entry.at >= death.at && entry.event === 'player' && entry.data?.rip && entry.data?.hp === 0);
        const respawn = dead && packets.find((entry: any) => entry.at > dead.at && entry.event === 'player' && !entry.data?.rip && entry.data?.hp > 0);
        const reentryHit = respawn && packets.some((entry: any) => entry.at > respawn.at && entry.event === 'hit' &&
          String(entry.data?.id) === String(seeded.id) && entry.data?.hid === W && entry.data?.damage > 0);
        return !native.players[W].rip && native.players[W].map === encounter.map && state.characters[W]?.joinedEvent === encounter.id && reentryHit;
      }, { timeout: 180_000, message: 'Native death must preserve event reentry instead of losing the saved activity' }).toBe(true);
      await info.attach('native-halloween-death-and-reentry', { body: JSON.stringify({ death, native: await world(live, encounter.id), coordinator: await live.state() }), contentType: 'application/json' });
      await live.post('/formation', { character: W, eventSelections: [] });
      await expect.poll(async () => {
        const native = await world(live, encounter.id);
        return fighters.every(name => native.players[name].map === encounter.map && Math.hypot(native.players[name].x - (encounter.x + 160), native.players[name].y - encounter.y) < 100);
      }, { timeout: 180_000, message: 'Deselection must return both actual clients to their saved pre-event checkpoint' }).toBe(true);
      await info.attach('halloween-saved-checkpoint-return', { body: JSON.stringify({ native: await world(live, encounter.id), coordinator: await live.state() }), contentType: 'application/json' });
    });
  });
}

test.describe('Slenderman', () => {
  test.use({ initialPosition: { map: 'halloween', x: 0, y: 0 } });
  test('Halloween Slenderman follows native map-only sightings, reacquires a warp and returns after native death', async ({ live }, info) => {
    test.setTimeout(480_000);
    const seeded = await spawn(live, 'slenderman', 'halloween', 120, 0);
    await prepare(live, 'slenderman');
    await expect.poll(async () => (await world(live, 'slenderman')).boss?.hp, { timeout: 60_000 }).toBeLessThan(seeded.hp);
    const warp = await live.admin(`output=(()=>{const m=get_monster('slenderman');if(!m)throw Error('Missing living native Slender');
      xy_emit(m,'disappear',{id:m.id});delete instances[m.in].monsters[m.id];m.oin=m.in=m.map='spookytown';instances[m.in].monsters[m.id]=m;
      const point=G.maps.spookytown.spawns[0];m.x=point[0]+120;m.y=point[1];m.moving=false;m.abs=true;m.u=true;m.cid++;m.last_jump=new Date();
      m.map_def.i=m.map;m.map_def.boundary=[m.x,m.y,m.x,m.y];
      // Upstream Slender warps do not refresh E.slenderman.map. Preserve that
      // exact native limitation; actual discovery must outlive its initial hint.
      broadcast_e();
      return {id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp,nativeStatus:E.slenderman,scope:'native relocation only; no damage or arrival seeded'};})()`);
    await info.attach('native-slenderman-map-only-warp', { body: JSON.stringify(warp), contentType: 'application/json' });
    await expect.poll(async () => {
      const native = await world(live, 'slenderman');
      return fighters.every(name => native.players[name].map === 'spookytown') && native.boss?.hp < warp.hp;
    }, { timeout: 180_000, message: 'Bounded native-map discovery must reacquire Slender despite the unchanged initial server map hint' }).toBe(true);
    await expect.poll(async () => !(await world(live, 'slenderman')).boss, { timeout: 180_000, message: 'Actual native combat must kill Slender' }).toBe(true);
    await live.admin('delete E.slenderman;broadcast_e();output=true');
    await expect.poll(async () => {
      const native = await world(live, 'slenderman');
      const state = await live.state();
      const recoveryFinished = !state.eventReturn && (!state.activeConvoy || state.activeConvoy.phase === 'complete');
      return recoveryFinished && fighters.every(name => !state.characters[name]?.joinedEvent &&
        native.players[name].map === 'halloween' && Math.hypot(native.players[name].x, native.players[name].y) < 100);
    }, { timeout: 180_000, message: 'Actual saved-point arrival must coincide with retired recovery, rather than an intermediate evacuation crossing' }).toBe(true);
    await info.attach('slenderman-native-completion-and-return', { body: JSON.stringify({ native: await world(live, 'slenderman'), coordinator: await live.state(), packets: await live.clients[W].events() }), contentType: 'application/json' });
  });
});

test.describe('Absent Halloween spawn', () => {
  test.use({ initialPosition: { map: 'halloween', x: -335, y: 685 } });
  test('Halloween staging abandons an absent native spawn after its fixed deadline and returns without reopening', async ({ live }, info) => {
    test.setTimeout(300_000);
    const announcement = await announceSpawn(live, 'mrpumpkin', 15000);
    await prepare(live, 'mrpumpkin');
    await expect.poll(async () => (await live.state()).characters[W]?.joinedEvent, { timeout: 30_000 }).toBe('mrpumpkin');
    await expect.poll(async () => {
      const state = await live.state();
      return state.eventReturn?.event === 'mrpumpkin' || fighters.every(name => !state.characters[name]?.joinedEvent);
    }, { timeout: 155_000, message: 'No native boss may hold saved activity beyond spawn plus 120 seconds' }).toBe(true);
    await expect.poll(async () => {
      const native = await world(live, 'mrpumpkin'), state = await live.state();
      return fighters.every(name => native.players[name].map === 'halloween' && Math.hypot(native.players[name].x + 335, native.players[name].y - 685) < 100 && !state.characters[name]?.joinedEvent);
    }, { timeout: 120_000 }).toBe(true);
    await live.admin('broadcast_e();output=true');
    await live.clients[W].page.waitForTimeout(11000);
    expect((await live.state()).characters[W]?.joinedEvent, 'Another native feed must not reopen the expired timer').toBeFalsy();
    await info.attach('absent-native-spawn-bounded-return', { body: JSON.stringify({ announcement, native: await world(live, 'mrpumpkin'), coordinator: await live.state() }), contentType: 'application/json' });
  });
});
