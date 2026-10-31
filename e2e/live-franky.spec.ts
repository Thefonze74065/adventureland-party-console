import { test, expect, type LiveGame } from './live-fixtures';
import history from './game/franky-recovery-history.json' with { type: 'json' };

const W = 'E2EWarrior';
function cleaveLanded(events: any[], ids: string[]): boolean {
  return events.some(e => e.event === 'game_response' && e.data?.place === 'cleave' &&
    e.data.success === true && e.data.attacker === W && ids.every(id => e.data.targets?.includes(id))) &&
    ids.every(id => events.some(e => e.event === 'hit' && e.data?.source === 'cleave' &&
      e.data.hid === W && String(e.data.id) === id && e.data.damage > 0));
}
async function removeOwnedMummies(live: Pick<LiveGame, 'admin'>, ids: string[]) {
  if (!ids.length) return;
  await live.admin(`output=(()=>{for(const id of ${JSON.stringify(ids)}){
    const matches=Object.values(instances).map(i=>i.monsters[id]).filter(Boolean);
    if(matches.length>1||matches.some(m=>m.type!=='mummy'))throw Error('Owned mummy identity mismatch');
    for(const m of matches)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
}
const tokens = (player: any) => player.items.reduce((sum: number, item: any) => sum + (item?.name === 'monstertoken' ? item.q || 1 : 0), 0);

test.describe('Franky personal defense and Cleave', () => {
  test.use({ loadout: 'combat-range' });
  test('Franky members kill personal mummies then resume boss and warrior cleaves nearby enemies', async ({ live }, info) => {
    test.setTimeout(360_000);
    // Failure inventory: group assist steals personal defense; sticky boss hides
    // attackers; a dead mummy remains selected; Franky still blocks Cleave.
    // Native fixture declares durable stationary enemies; targeting, skills,
    // damage, CODE, coordinator publication and browser transport remain real.
    const names = [W, 'E2EPriest'];
    const owned: string[] = [];
    try {
    await live.post('/formation', { leader: W });
    await live.post('/formation', { character: names[1], follow: true });
    await live.admin(`output=(()=>{Object.assign(G.monsters.franky,{attack:1,spawns:[],aggro:0});
      G.maps.level2w.monsters[0].boundary=[-529,-185,-527,-183];events.franky=true;delete timers.franky;return true;})()`);
    await live.post('/formation', { character: W, eventSelections: ['franky'] });
    await expect.poll(async () => {
      const s=await live.state();return names.every(n=>s.characters[n]?.joinedEvent==='franky'&&s.characters[n]?.map==='level2w');
    }, { timeout: 120_000 }).toBe(true);
    const seeded = await live.admin(`output=(()=>{const boss=get_monster('franky');boss.hp=boss.max_hp=100000000;
      const mummies=${JSON.stringify(names)}.map(name=>{const p=get_player(name);
        const m=new_monster(p.in,{type:'mummy',position:[p.x+12,p.y],radius:0,count:1},{temp:1});
        m.hp=m.max_hp=100000;m.attack=1;m.s.stunned={ms:600000};target_player(m,p);
        return {name,id:String(m.id),hp:m.hp,in:m.in};});return {boss:String(boss.id),mummies};})()`);
    owned.push(...seeded.mummies.map((m:any)=>m.id));
    await expect.poll(async () => {
      const state=await live.state();return seeded.mummies.every((m:any)=>String(state.characters[m.name]?.target?.id)===m.id);
    }, { timeout: 30_000, message: 'Each member must select its own mummy rather than assist another member' }).toBe(true);
    await expect.poll(async () => live.admin(`output=${JSON.stringify(seeded.mummies)}.every(e=>instances[e.in].monsters[e.id]?.hp<e.hp)`),
      { timeout: 30_000, message: 'Both selected mummies receive real native damage' }).toBe(true);
    await info.attach('personal-mummy-defense', { body: JSON.stringify({seeded,state:await live.state()}), contentType:'application/json' });
    await live.admin(`output=${JSON.stringify(seeded.mummies)}.map(e=>{const m=instances[e.in].monsters[e.id];if(m){m.hp=1;m.s={};}return true;})`);
    await expect.poll(async () => live.admin(`output=${JSON.stringify(seeded.mummies)}.every(e=>!instances[e.in].monsters[e.id]||instances[e.in].monsters[e.id].dead)`),
      { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => {
      const s=await live.state();return names.every(n=>String(s.characters[n]?.target?.id)===seeded.boss);
    }, { timeout: 30_000 }).toBe(true);
    const cleaveSeed = await live.admin(`output=(()=>{const p=get_player('${W}');p.slots.mainhand={name:'waxe',level:0};p.slots.offhand=null;p.cslots.mainhand=cache_item(p.slots.mainhand);p.cslots.offhand=null;calculate_player_stats(p);p.mp=p.max_mp;
      const ids=[];for(const dx of [-15,15]){const m=new_monster(p.in,{type:'mummy',position:[p.x+dx,p.y],radius:0,count:1},{temp:1});
        m.hp=m.max_hp=100000;m.attack=1;m.s.stunned={ms:600000};target_player(m,p);ids.push(String(m.id));}
      resend(p,'u+cid+reopen');return {ids,mp:p.mp};})()`);
    owned.push(...cleaveSeed.ids);
    try { await expect.poll(async () => cleaveLanded(await live.clients[W].events(), cleaveSeed.ids),
      { timeout: 30_000, message:'Native Cleave must hit both declared nearby enemies' }).toBe(true); }
    finally { await info.attach('cleave-runtime-observation',{body:JSON.stringify(await live.clients[W].run(`(()=>{const s=sharedRoutine,c=s.combatContext();return {actor:{level:character.level,mp:character.mp,x:character.x,y:character.y,slots:character.slots},skill:G.skills.cleave,weapon:G.items[character.slots.mainhand.name]?.wtype,context:{mode:c.mode,event:c.event},franky:s.frankyCombatActive(),monsters:c.monsters.map(t=>({id:t.id,distance:distance(character,t),allowed:s.skillTargetAllowed(t,'cleave'),rare:s.rareAttackAllowed(t,'cleave')})),cooldown:is_on_cooldown('cleave')};})()`)),contentType:'application/json'}); }
    await info.attach('franky-native-cleave', { body:JSON.stringify({cleaveSeed,events:await live.clients[W].events(),state:await live.state()}),contentType:'application/json' });
    } finally { await removeOwnedMummies(live, owned); }
  });
});

test.describe('ordinary warrior Cleave', () => {
  // Town keeps the positive case outside the spider/phoenix spawn. Nearby
  // unrelated monsters correctly veto Cleave through its collateral guard.
  test.use({ loadout: 'combat-range', initialPosition: { map:'main', x:0, y:0 } });
  for (const mode of ['default','scatter']) test(`warrior Cleave hits two native attackers in ${mode} mode and skips one`, async ({ live }, info) => {
    test.setTimeout(240_000);
    // Failure inventory: the role never calls skill offense outside Franky;
    // target locking blocks an additional attacker; a single target wastes MP.
    // Stationary durable attackers and an axe are declared native test inputs.
    const owned: string[] = [];
    try {
    await live.post('/formation', { leader:W });
    await live.post('/formation', { character:'E2EPriest', follow:true });
    await live.post('/checkpoint', {});
    await live.post('/farming-mode', { character:W, mode });
    await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&[W,'E2EPriest'].every(n=>s.characters[n]?.map==='main'&&!s.characters[n]?.moving);}, {timeout:90000}).toBe(true);
    await expect.poll(()=>live.clients[W].run('sharedRoutine.combatContext().mode')).toBe(mode==='scatter'?'scatter':'grouped');
    const first=await live.admin(`output=(()=>{const p=get_player('${W}');p.slots.mainhand={name:'waxe',level:0};p.slots.offhand=null;p.cslots.mainhand=cache_item(p.slots.mainhand);p.cslots.offhand=null;
      // Ample declared mana lets scatter exercise its budgeted positive case.
      p.slots.amulet={name:'intamulet',level:20};p.cslots.amulet=cache_item(p.slots.amulet);calculate_player_stats(p);p.mp=p.max_mp;
      const m=new_monster(p.in,{type:'mummy',position:[p.x+12,p.y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=1000000;m.attack=1;m.s.stunned={ms:600000};target_player(m,p);resend(p,'u+cid+reopen');return String(m.id);})()`);
    owned.push(first);
    await expect.poll(async()=>(await live.clients[W].events()).filter((e:any)=>e.event==='hit'&&e.data?.hid===W&&String(e.data?.id)===first&&e.data?.damage>0).length,
      {timeout:30000,message:'The warrior must actually attack its single target'}).toBeGreaterThanOrEqual(3);
    expect((await live.clients[W].events()).some((e:any)=>e.event==='hit'&&e.data?.source==='cleave'&&e.data.hid===W&&String(e.data.id)===first)).toBe(false);
    const second=await live.admin(`output=(()=>{const p=get_player('${W}');const m=new_monster(p.in,{type:'mummy',position:[p.x-12,p.y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=1000000;m.attack=1;m.s.stunned={ms:600000};target_player(m,p);return String(m.id);})()`);
    owned.push(second);
    try { await expect.poll(async()=>cleaveLanded(await live.clients[W].events(), [first,second]),
      {timeout:30000,message:'Both nearby native attackers must receive Cleave'}).toBe(true); }
    finally { await info.attach('ordinary-cleave-eligibility-'+mode,{body:JSON.stringify(await live.clients[W].run(`(()=>{const s=sharedRoutine,c=s.combatContext();return {mp:character.mp,weapon:character.slots.mainhand,mode:c.mode,event:c.event,allies:c.allies.map(a=>a.name),monsters:c.monsters.map(t=>({id:t.id,type:t.mtype,target:t.target,distance:distance(character,t),allowed:s.skillTargetAllowed(t,'cleave')})),skill:partyCombatState.skill};})()`)),contentType:'application/json'}); }
    await info.attach('ordinary-native-cleave-'+mode,{body:JSON.stringify({first,second,events:await live.clients[W].events(),state:await live.state()}),contentType:'application/json'});
    } finally { await removeOwnedMummies(live, owned); }
  });
});

test('restored acknowledged Franky exit resumes completed gscorpion Hunt from desertland while the boss remains alive', async ({ live }, info) => {
  test.setTimeout(360_000);
  await live.post('/formation', { leader: W });
  await live.post('/command', { character: W, type: 'character-travel', location: { map: 'desertland', x: 0, y: 0 }, label: 'Historical recovery starting position' });
  await expect.poll(async () => { const c=(await live.state()).characters[W];return c?.map==='desertland' && !c.moving; }, { timeout: 120_000 }).toBe(true);
  await live.admin(`output=(()=>{const p=get_player('${W}');p.s.monsterhunt={sn:region+' '+server_name,id:'gscorpion',c:0,ms:1800000};resend(p,'u+cid+reopen');events.franky=true;delete timers.franky;return p.s.monsterhunt})()`);
  const observed = () => live.admin(`output=(()=>{const p=get_player('${W}');return {franky:!!E.franky?.live,boss:!!get_monster('franky'),map:p.map,quest:p.s.monsterhunt||null,items:p.items}})()`);
  await expect.poll(async () => {const world=await observed();return world.franky&&world.boss;}, { timeout: 30_000 }).toBe(true);
  const initial = await observed(), beforeTokens=tokens(initial);
  expect(initial.map).toBe('desertland');
  await live.restoreHistoricalSettings(settings => {
    const now=Date.now(), intent=settings.navigationIntents[W];
    if (!intent || !Number.isFinite(intent.revision)) throw Error('Native travel must persist a navigation revision');
    const location=structuredClone(history.location);
    const monsterHunt={...structuredClone(history.monsterHunt),cycleId:'historical-hunt-'+now,startedAt:now-120_000,
      message:'Restored captured completed quest after acknowledged Franky exit',eventTrips:{[W]:[{event:'franky',startedAt:now-90_000}]}};
    const eventReturn={...structuredClone(history.eventReturn),cycleId:'historical-franky-'+now,startedAt:now-60_000,
      waypoints:{[W]:{revision:intent.revision,location}},exitConvoyId:'historical-completed-exit'};
    return {
      characterLocations:{...settings.characterLocations,[W]:location},location,farmingPolicy:'hunt',
      farmingProfiles:{...settings.farmingProfiles,[W]:{...settings.farmingProfiles?.[W],farmingPolicy:'hunt',monsterHunt,eventReturn,location,monsterFocus:['gscorpion'],activeConvoy:null}},
      eventSelectionsByCharacter:{...settings.eventSelectionsByCharacter,[W]:[]},activeConvoy:null,deferredEventReturns:{},
      eventReturn,
      monsterHunt
    };
  });
  await info.attach('historical-recovery-provenance', { body: JSON.stringify({provenance:history.provenance,initial}), contentType:'application/json' });
  await expect.poll(async () => { const state=await live.state();return !state.eventReturn && state.monsterHunt?.stage!=='paused-event' && Date.now()-state.characters[W]?.seenAt<3000; }, { timeout:30_000, intervals:[100], message:'An acknowledged historical exit must resume Hunt without another Main arrival' }).toBe(true);
  const handoff=await observed();
  await info.attach('franky-handoff-position', { body:JSON.stringify({observedAt:Date.now(),handoff,state:await live.state()}),contentType:'application/json' });
  expect(handoff.map).toBe('desertland');
  await expect.poll(async () => tokens(await observed()), { timeout:180_000, message:'Native Hunt must claim the actual completed gscorpion reward at Daisy' }).toBe(beforeTokens+1);
  const final=await observed();
  expect(final.map).toBe('main');
  expect(final.franky&&final.boss).toBe(true);
  expect((await live.state()).eventSelectionsByCharacter[W]).not.toContain('franky');
  await info.attach('franky-restored-hunt-reward', { body:JSON.stringify({final,state:await live.state()}),contentType:'application/json' });
});
