import { test, expect, type LiveGame } from './live-fixtures';
import type { TestInfo } from '@playwright/test';
import { location as farmingArea } from './game/hunt-lifecycle';

const W = 'E2EWarrior', P = 'E2EPriest';
type Point = { map: string; x: number; y: number; hp: number };
type Entry = { at: number; warrior: Point; priest: Point; bat: { hp: number; target: string | null } | null;
  navigation?: string; detail?: string; command: string | null; eventReturn: string | null };

// Failure modes: e2e/event-return-departure-failures.md.
// The warrior farms cave bats, as the live party was: a stream of slow,
// aggressive attackers. One harmless bat that outlasts each journey keeps it
// engaged, as a dense spawn does, while staying slower than the warrior.
async function caughtFarmingBats(live: LiveGame, info: TestInfo) {
  const timeline: Entry[] = [];
  await live.post('/formation', { leader: W });
  await live.post('/farming-mode', { character: W, mode: 'default' });
  await live.post('/focus', { character: W, monsterFocus: ['bat'] });
  const area = await farmingArea(live, 'bat');
  expect(area.map).toBe('cave');
  await live.post('/travel', area);
  await expect.poll(async () => { const s = await live.state(); return !s.activeConvoy && s.characters[W]?.map === 'cave' && s.characters[W]?.target?.mtype === 'bat'; },
    { timeout: 240_000, intervals: [1000], message: 'The warrior must be farming cave bats with no convoy' }).toBe(true);
  const spawned = await live.admin(`output=(()=>{
    const w=get_player('${W}'),original=G.monsters.bat;
    try {
      G.monsters.bat={...original,attack:1,hp:10000000};
      const m=new_monster(w.in,{type:'bat',count:1,boundary:[w.x+30,w.y,w.x+31,w.y+1]},{temp:1});
      m.e2eDeparture=true;target_player(m,w);
      return {id:m.id,map:w.map,target:m.target,speed:m.speed,warriorSpeed:w.speed};
    } finally {G.monsters.bat=original;}
  })()`);
  await info.attach('departure-durable-bat', { body: JSON.stringify(spawned), contentType: 'application/json' });
  expect(spawned.target).toBe(W);
  expect(spawned.warriorSpeed, 'The warrior must be able to outrun the bat for this rule to apply').toBeGreaterThan(spawned.speed);
  const world = () => live.admin(`output=(()=>{const w=get_player('${W}'),p=get_player('${P}'),at=c=>({map:c.map,x:Math.round(c.x),y:Math.round(c.y),hp:c.hp});
    const m=Object.values(instances.cave?.monsters||{}).find(m=>m.id===${JSON.stringify(spawned.id)});
    return {at:Date.now(),warrior:at(w),priest:at(p),bat:m&&!m.dead?{hp:m.hp,target:m.target}:null}})()`);
  await expect.poll(async () => (await world()).bat?.target, { timeout: 30_000, message: 'The durable bat must stay on the warrior' }).toBe(W);
  const sample = async () => {
    // Pending commands are only in the fast projection.
    const fast = async () => (await fetch(live.url + '/party-api/state?section=fast', { signal: AbortSignal.timeout(15_000) })).json();
    const [state, quick, current] = await Promise.all([live.state(), fast(), world()]);
    const entry: Entry = { ...current, navigation: state.characters[W]?.navigationState, detail: state.characters[W]?.navigationDetail,
      command: quick.pendingCommands?.[W]?.type ?? null, eventReturn: state.eventReturn ? state.eventReturn.phase : null };
    timeline.push(entry); return entry;
  };
  async function finish(name: string) {
    await info.attach(name, { body: JSON.stringify(timeline), contentType: 'application/json' });
    await live.admin(`output=(()=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.e2eDeparture)remove_monster(m);return true})()`).catch(() => null);
  }
  /** Reached `where` with the bat still alive: it was left behind, not killed. */
  async function walkedOut(where: (e: Entry) => boolean, message: string) {
    await expect.poll(async () => where(await sample()), { timeout: 150_000, intervals: [1000], message }).toBe(true);
    expect(timeline.at(-1)?.bat, 'The warrior left the bat behind rather than killing it').not.toBeNull();
    expect(timeline.every(e => e.warrior.hp > 0)).toBe(true);
  }
  return { area, sample, walkedOut, finish, timeline };
}
// Town is the barrier: within 90 units of Main (0,0).
const atTown = (e: Entry) => e.warrior.map === 'main' && Math.hypot(e.warrior.x, e.warrior.y) <= 90;

test('restored event return walks out of a bat attack it can outrun and completes at Main town', async ({ live }, info) => {
  test.setTimeout(480_000);
  const run = await caughtFarmingBats(live, info);
  // A return restored at startup re-issues event-return-town, as after the live restart.
  await live.restoreHistoricalSettings(settings => {
    const now = Date.now(), intent = settings.navigationIntents[W];
    if (!intent || !Number.isFinite(intent.revision)) throw Error('Native travel must persist a navigation revision');
    const location = { ...run.area, label: 'the cave bat farm' };
    const eventReturn = { phase: 'evacuating', cycleId: 'restored-icegolem-' + now, event: 'icegolem', participants: [W], pending: [W],
      startedAt: now - 30_000, checkpoint: location, waypoints: { [W]: { revision: intent.revision, location } }, deferred: [] };
    // The leader's farming profile carries the party's recovery state across restarts.
    return {
      activeConvoy: null, deferredEventReturns: {}, eventReturn,
      farmingProfiles: { ...settings.farmingProfiles, [W]: { ...settings.farmingProfiles?.[W], eventReturn, activeConvoy: null } },
    };
  });
  try {
    await expect.poll(async () => (await run.sample()).command, { timeout: 30_000, message: 'The restored return must command the warrior' })
      .toBe('event-return-town');
    await run.walkedOut(atTown, 'The warrior must walk out of the cave to Main town');
    await expect.poll(async () => { const s = await run.sample(); return !s.eventReturn && s.command !== 'event-return-town'; },
      { timeout: 120_000, intervals: [1000], message: 'The return must be acknowledged at Main town and cleared' }).toBe(true);
  } finally { await run.finish('event-return-departure-timeline'); }
});

test('character travel walks out of a bat attack it can outrun', async ({ live }, info) => {
  test.setTimeout(480_000);
  const run = await caughtFarmingBats(live, info);
  try {
    await live.post('/command', { character: W, type: 'character-travel', location: { map: 'main', x: 0, y: 0 }, label: 'Main town' });
    await run.walkedOut(atTown, 'Character travel must walk the warrior out of the cave to Main town');
  } finally { await run.finish('character-travel-departure-timeline'); }
});

test('party travel assembles and leaves a bat attack the warrior can outrun', async ({ live }, info) => {
  test.setTimeout(480_000);
  const run = await caughtFarmingBats(live, info);
  try {
    const goos = await farmingArea(live, 'goo');
    expect(goos.map).toBe('main');
    await live.post('/focus', { character: W, monsterFocus: ['goo'] });
    await live.post('/travel', goos);
    await run.walkedOut(e => e.warrior.map === 'main', 'Party travel must take the warrior out of the cave to the goo farm');
  } finally { await run.finish('party-travel-departure-timeline'); }
});

test('return to leader walks out of a bat attack it can outrun to the leader on another map', async ({ live }, info) => {
  test.setTimeout(480_000);
  const run = await caughtFarmingBats(live, info);
  try {
    // The priest leads from Main town; the warrior stays caught in the cave.
    await live.post('/formation', { leader: P });
    await live.post('/command', { character: P, type: 'character-travel', location: { map: 'main', x: 0, y: 0 }, label: 'Main town' });
    await expect.poll(async () => { const s = await run.sample(); return s.priest.map === 'main' && Math.hypot(s.priest.x, s.priest.y) <= 90; },
      { timeout: 180_000, intervals: [1000], message: 'The priest must lead from Main town' }).toBe(true);
    expect(run.timeline.at(-1)?.warrior.map, 'The warrior must still be in the cave before it is told to return').toBe('cave');
    await live.post('/command', { character: W, type: 'return-leader' });
    await run.walkedOut(e => e.warrior.map === 'main' && Math.hypot(e.warrior.x - e.priest.x, e.warrior.y - e.priest.y) <= 120,
      'Return to leader must walk the warrior out of the cave to the priest');
  } finally { await run.finish('return-leader-departure-timeline'); }
});
