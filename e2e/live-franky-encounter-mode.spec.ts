import { test, expect } from './live-fixtures';

const W = 'E2EWarrior';

// Issue #36 gave under-geared parties an off-tank/support Franky routine that
// leaves the room whenever Franky targets this character. That is the right
// call for a party that cannot survive tanking him, but a party that CAN
// tank him needs the opposite: engage directly and hold at weapon range,
// like normal combat. This demonstrates selecting between the two live,
// on the same character, against the same living boss.
test('Franky encounter mode switches between off-tank fleeing and tank engaging live', async ({ live }, info) => {
  test.setTimeout(240_000);
  await live.post('/formation', { leader: W });
  const world = () => live.admin(`output=(()=>{const p=get_player('${W}');const boss=get_monster('franky');
    return {live:!!E.franky?.live,boss:!!boss,bossId:boss?.id,bossHp:boss?.hp,bossTarget:boss?.target,bossAggro:boss?.aggro,
      bossRange:boss?.range,bossSpeed:boss?.speed,bossX:boss?.x,bossY:boss?.y,
      map:p.map,x:p.x,y:p.y,pTarget:p.target,pMoving:p.moving}})()`);
  const seed = await live.admin(`output=(()=>{
    if(events.franky || get_monster('franky')) throw Error('Franky needs a clean baseline');
    // Keep his native attack range so his AI still picks a target: zeroing it
    // (as the disable-combat party fixture does) leaves boss.target permanently
    // null, since he never considers anyone "in range" to aggro onto.
    const initial={attack:1,spawns:[],charge:0,speed:0};
    globalThis.__e2eFrankyDefinition=Object.fromEntries(Object.keys(initial).map(key=>[key,G.monsters.franky[key]]));
    Object.assign(G.monsters.franky,initial);
    globalThis.__e2eFrankyBoundary=G.maps.level2w.monsters[0].boundary.slice();
    // Matches the known-good spot from live-franky-party.spec.ts: close enough to
    // the room's entrance/exit door that simple step-toward-target movement (no
    // real pathfinder) can reach both Franky and the flee door reliably.
    G.maps.level2w.monsters[0].boundary=[-529,-185,-527,-183];
    events.franky=true;delete timers.franky;
    return {original:globalThis.__e2eFrankyDefinition,initial,scope:'tank vs off-tank encounter-mode selection'};
  })()`);
  await info.attach('franky-encounter-mode-seed', { body: JSON.stringify(seed), contentType: 'application/json' });
  await expect.poll(async () => (await world()).boss, { timeout: 30_000, message: 'A weakened Franky must spawn for a controlled encounter' }).toBe(true);

  // Tank routine: engage Franky directly and hold, even once he targets this lone character.
  await live.post('/encounter-mode', { character: W, encounter: 'franky', mode: 'tank' });
  await live.post('/formation', { character: W, eventSelections: ['franky'] });
  await expect.poll(async () => (await world()).map, { timeout: 60_000, message: 'The warrior must enter the live Franky instance' }).toBe('level2w');
  const tankBaseline = await world();
  await info.attach('franky-arrived', { body: JSON.stringify(tankBaseline), contentType: 'application/json' });
  // Real combat must actually be happening (not fabricated) before forcing aggro:
  // confirm the boss is taking genuine damage from the tank routine's engagement.
  await expect.poll(async () => (await world()).bossHp, { timeout: 60_000, message: 'Tank routine must actually be fighting Franky before we force his aggro' })
    .toBeLessThan(tankBaseline.bossHp);
  // Force Franky's aggro onto the lone warrior directly, rather than waiting on
  // his (weakened, largely disabled) native AI to decide a target on its own --
  // what's under test is how the encounter routine reacts to being targeted, not
  // Adventure Land's own aggro heuristics.
  await live.admin(`output=(()=>{const boss=get_monster('franky');boss.target='${W}';return {target:boss.target}})()`);
  await expect.poll(async () => (await world()).bossTarget, { timeout: 15_000, message: 'The forced target must stick on the live boss' }).toBe(W);
  const targetedBaseline = await world();
  await info.attach('franky-tank-targeted', { body: JSON.stringify(targetedBaseline), contentType: 'application/json' });
  await expect.poll(async () => {
    const w = await world();
    return w.map === 'level2w' && w.bossHp < targetedBaseline.bossHp;
  }, { timeout: 60_000, message: 'Tank routine must keep fighting Franky at weapon range instead of leaving the map once targeted' }).toBe(true);
  const tankResult = await world();
  expect(tankResult.map).toBe('level2w');
  await info.attach('franky-tank-holding', { body: JSON.stringify(tankResult), contentType: 'application/json' });

  // Flip the same live character to the off-tank routine while Franky still targets it.
  // The full physical exit-door walk (a separate, pre-existing issue #36 code path
  // this test doesn't otherwise exercise) needs real pathfinding this simple
  // step-toward-target movement doesn't have from every position, so a stuck-in-place
  // character can keep landing basic attacks while trying to leave (attack targeting
  // stays exclusive to Franky by design, even mid-flee) -- that's not a regression,
  // so this doesn't assert combat fully stops. What's asserted is the actual
  // behavioral contract: off-tank abandons holding/engaging Franky and commits to a
  // flee attempt once targeted, instead of continuing to hold like tank mode did,
  // and it doesn't revert back to a holding/approaching engagement afterward.
  const clientMode = async () => JSON.parse(await live.clients[W].run('JSON.stringify(window.partyCombatPosition || null)') as string)?.reason || '';
  await live.post('/encounter-mode', { character: W, encounter: 'franky', mode: 'offtank' });
  await expect.poll(clientMode, { timeout: 60_000,
    message: 'Off-tank routine must abandon holding Franky and attempt to leave the room once he targets a fragile solo character' })
    .toMatch(/door|Leaving the room|last known position|safe corner/);
  const disengagedAt = await world();
  await info.attach('franky-offtank-disengaged', { body: JSON.stringify({ disengagedAt, reason: await clientMode() }), contentType: 'application/json' });
  await new Promise(resolve => setTimeout(resolve, 10_000));
  const stillFleeing = await clientMode();
  expect(stillFleeing).toMatch(/door|Leaving the room|last known position|safe corner|Waiting/);
  await info.attach('franky-offtank-stayed-disengaged', { body: JSON.stringify({ world: await world(), reason: stillFleeing }), contentType: 'application/json' });
});
