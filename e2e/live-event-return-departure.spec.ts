import { test, expect } from './live-fixtures';
import { location as farmingArea } from './game/hunt-lifecycle';

const W = 'E2EWarrior';
type Entry = { at: number; warrior: { map: string; x: number; y: number; hp: number }; bat: { hp: number; target: string | null } | null;
  navigation?: string; detail?: string; command: string | null; eventReturn: string | null };

// Failure modes: e2e/event-return-departure-failures.md.
test('restored event return walks out of a bat attack it can outrun and completes at Main town', async ({ live }, info) => {
  test.setTimeout(480_000);
  const timeline: Entry[] = [];
  const bat = await live.admin(`output=({speed:G.monsters.bat.speed})`);
  // Farming bats in the cave, as the live party was: a stream of slow, aggressive attackers.
  await live.post('/formation', { leader: W });
  await live.post('/farming-mode', { character: W, mode: 'default' });
  await live.post('/focus', { character: W, monsterFocus: ['bat'] });
  const area = await farmingArea(live, 'bat');
  expect(area.map).toBe('cave');
  await live.post('/travel', area);
  await expect.poll(async () => { const s = await live.state(); return !s.activeConvoy && s.characters[W]?.map === 'cave' && s.characters[W]?.target?.mtype === 'bat'; },
    { timeout: 240_000, intervals: [1000], message: 'The warrior must be farming cave bats with no convoy' }).toBe(true);

  // One harmless bat that outlasts the journey keeps the warrior engaged, as a
  // dense aggressive spawn does, while staying slower than the warrior.
  const spawned = await live.admin(`output=(()=>{
    const w=get_player('${W}'),original=G.monsters.bat;
    try {
      G.monsters.bat={...original,attack:1,hp:10000000};
      const m=new_monster(w.in,{type:'bat',count:1,boundary:[w.x+30,w.y,w.x+31,w.y+1]},{temp:1});
      m.e2eDeparture=true;target_player(m,w);
      return {id:m.id,map:w.map,target:m.target,speed:m.speed,warriorSpeed:w.speed};
    } finally {G.monsters.bat=original;}
  })()`);
  await info.attach('event-return-durable-bat', { body: JSON.stringify(spawned), contentType: 'application/json' });
  expect(spawned.target).toBe(W);
  expect(spawned.warriorSpeed, 'The warrior must be able to outrun the bat for this rule to apply').toBeGreaterThan(spawned.speed);
  const world = () => live.admin(`output=(()=>{const w=get_player('${W}');
    const m=Object.values(instances.cave?.monsters||{}).find(m=>m.id===${JSON.stringify(spawned.id)});
    return {at:Date.now(),warrior:{map:w.map,x:Math.round(w.x),y:Math.round(w.y),hp:w.hp},bat:m&&!m.dead?{hp:m.hp,target:m.target}:null}})()`);
  await expect.poll(async () => (await world()).bat?.target, { timeout: 30_000, message: 'The durable bat must stay on the warrior' }).toBe(W);

  // A return restored at startup re-issues event-return-town, as after the live restart.
  await live.restoreHistoricalSettings(settings => {
    const now = Date.now(), intent = settings.navigationIntents[W];
    if (!intent || !Number.isFinite(intent.revision)) throw Error('Native travel must persist a navigation revision');
    const location = { ...area, label: 'the cave bat farm' };
    const eventReturn = { phase: 'evacuating', cycleId: 'restored-icegolem-' + now, event: 'icegolem', participants: [W], pending: [W],
      startedAt: now - 30_000, checkpoint: location, waypoints: { [W]: { revision: intent.revision, location } }, deferred: [] };
    // The leader's farming profile carries the party's recovery state across restarts.
    return {
      activeConvoy: null, deferredEventReturns: {}, eventReturn,
      farmingProfiles: { ...settings.farmingProfiles, [W]: { ...settings.farmingProfiles?.[W], eventReturn, activeConvoy: null } },
    };
  });
  const sample = async () => {
    // Pending commands are only in the fast projection.
    const fast = async () => (await fetch(live.url + '/party-api/state?section=fast', { signal: AbortSignal.timeout(15_000) })).json();
    const [state, quick, current] = await Promise.all([live.state(), fast(), world()]);
    const entry: Entry = { ...current, navigation: state.characters[W]?.navigationState, detail: state.characters[W]?.navigationDetail,
      command: quick.pendingCommands?.[W]?.type ?? null, eventReturn: state.eventReturn ? state.eventReturn.phase : null };
    timeline.push(entry); return entry;
  };
  // Town is the barrier: within 90 units of Main (0,0).
  const atTown = (e: Entry) => e.warrior.map === 'main' && Math.hypot(e.warrior.x, e.warrior.y) <= 90;
  try {
    await expect.poll(async () => (await sample()).command, { timeout: 30_000, message: 'The restored return must command the warrior' })
      .toBe('event-return-town');
    await expect.poll(async () => atTown(await sample()),
      { timeout: 150_000, intervals: [1000], message: 'The warrior must walk out of the cave to Main town' }).toBe(true);
    expect(timeline.at(-1)?.bat, 'The warrior left the bat behind rather than killing it').not.toBeNull();
    await expect.poll(async () => { const s = await sample(); return !s.eventReturn && s.command !== 'event-return-town'; },
      { timeout: 120_000, intervals: [1000], message: 'The return must be acknowledged at Main town and cleared' }).toBe(true);
    expect(timeline.every(e => e.warrior.hp > 0)).toBe(true);
  } finally {
    await info.attach('event-return-departure-timeline', { body: JSON.stringify(timeline), contentType: 'application/json' });
    await live.admin(`output=(()=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.e2eDeparture)remove_monster(m);return true})()`).catch(() => null);
  }
});
