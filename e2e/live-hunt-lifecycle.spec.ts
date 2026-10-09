import { test, expect } from './live-fixtures';
import { killNativeCharacter } from './hunt-interruption-helpers';
import { warrior as W, priest as P, fighters, world, tokens, profile, location, party, quests, start, artifact, rejected } from './game/hunt-lifecycle';
import { zones, contains } from '../dashboard/lib/farming-zones';

test.describe('native Hunt lifecycle', () => {
  test.setTimeout(300_000);

  test('a native Boo Boo Hunt crosses real map doors, kills its target and returns to Daisy', async ({ live }, info) => {
    test.setTimeout(600_000);
    await party(live);
    await quests(live, info, { [W]: { id: 'booboo', count: 1 }, [P]: { id: 'booboo', count: 1 } });
    const before = await world(live);
    const destination = await start(live, W, 'booboo');
    await expect.poll(async () => (await world(live))[W].map, { timeout: 240_000 }).toBe(destination.map);
    // Native combat, the return journey and stable Daisy arrival precede claiming the reward.
    await expect.poll(async () => tokens((await world(live))[W]), { timeout: 300_000 }).toBe(tokens(before[W]) + 1);
    const events = await live.clients[W].events();
    expect(events.some((entry: any) => entry.event === 'hit' && entry.data?.kill)).toBe(true);
    expect((await world(live))[W].map).toBe('main');
    await artifact(live, info, 'booboo-native-door-combat-reward', { before, destination, loadout: 'god' });
  });

  test.describe('native Boo Boo walking-return cache',()=>{
  test.use({initialMonsterSpawn:'booboo'});
  test('native Boo Boo walking return reuses its validated route after a communication hold', async ({ live }, info) => {
    test.setTimeout(900_000);
    const initialClearance=await live.admin(`output=${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return {name,map:p.map,x:p.x,y:p.y,base:p.base,
      selfClear:can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:p.base})};})`);
    expect(initialClearance.every((p:any)=>p.selfClear)).toBe(true);
    await info.attach('native-booboo-initial-clearance',{body:JSON.stringify(initialClearance),contentType:'application/json'});
    await party(live);
    await quests(live,info,{[W]:{id:'booboo',count:1},[P]:{id:'booboo',count:1}});
    const before=await world(live),destination=await start(live,W,'booboo');
    const preparation:any[]=[];
    const observe=(s:any)=>{
      if(preparation.length>=64)preparation.shift();
      preparation.push({at:Date.now(),stage:profile(s).monsterHunt?.stage,message:profile(s).monsterHunt?.message,
        convoy:s.activeConvoy&&{id:s.activeConvoy.id,phase:s.activeConvoy.phase,returnRouting:s.activeConvoy.returnRouting},
        participants:Object.fromEntries(fighters.map(name=>{const c=s.characters[name];return [name,{map:c?.map,x:c?.x,y:c?.y,
          count:c?.monsterHunt?.count,lastAttackAt:c?.combat?.lastAttackAt,lastAttackTarget:c?.combat?.lastAttackTarget}];}))});
    };
    try{
      await expect.poll(async()=>{
        const current=await world(live),s=await live.state();observe(s);
        return fighters.every(name=>current[name].quest?.c===0)&&profile(s).monsterHunt?.stage==='returning'&&
          s.activeConvoy?.returnRouting&&s.characters[W].map===destination.map;
      },{timeout:300_000,intervals:[100],message:'Real Boo Boo kills must establish the existing return checkpoint'}).toBe(true);
    }finally{
      await info.attach('native-booboo-return-preparation',{body:JSON.stringify({before,destination,preparation,native:await world(live)}),contentType:'application/json'});
    }
    const cycle=profile(await live.state()).monsterHunt.cycleId;
    await live.restoreHistoricalSettings(settings=>{
      const owner=settings.farmingProfiles[W],hunt=owner.monsterHunt,convoy=owner.activeConvoy||settings.activeConvoy;
      expect(hunt.cycleId).toBe(cycle);expect(convoy.returnRouting).toBe(true);
      expect(convoy.location.map).toBe('main');
      const policy={map:destination.map,interruptions:0,walking:true};
      hunt.returnDisableTown=true;hunt.returnTown=policy;
      convoy.disableTown=true;convoy.returnTown=policy;convoy.nativeFallback=false;
      return {farmingProfiles:{...settings.farmingProfiles,[W]:owner},monsterHunt:hunt,activeConvoy:convoy};
    });
    let original:any,held:any,resumed:any,blocking=false;
    const faults:any[]=[],context=live.clients[W].page.context();
    const intercept=async(route:import('@playwright/test').Route)=>{
      const request=route.request(),body=request.method()==='POST'?request.postDataJSON():null;
      if(blocking&&fighters.includes(body?.name)&&body.combatWait!==true){
        faults.push({at:Date.now(),name:body.name,fast:!!body.combatOnly,sequence:body.travelSample?.sequence});
        await route.abort('failed');return;
      }
      await route.continue();
    };
    const native=()=>Promise.all(fighters.map(name=>live.clients[name].frame.evaluate(()=>{
      const w=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      return {name:w.character.name,map:w.character.map,in:w.character.in,x:w.character.real_x,y:w.character.real_y,
        moving:!!w.character.moving,navigation:w.convoyNavigationReport?.(),cache:w.__partySharedRouteRemainder};
    })));
    await context.route('**/party-api/status',intercept);
    try{
      await expect.poll(async()=>{
        const s=await live.state(),c=s.activeConvoy;
        if(c?.returnRouting&&c.disableTown&&c.phase==='travel'&&fighters.some(name=>s.characters[name]?.moving)){
          original={convoy:c,native:await native()};return true;
        }
        return false;
      },{timeout:180_000,intervals:[100],message:'Declared walking return must install and actually move before the communication fault'}).toBe(true);
      blocking=true;
      await expect.poll(async()=>{
        const s=await live.state(),positions=await native();
        if(s.activeConvoy?.phase==='communication-hold'&&positions.every(p=>!p.moving)){
          held={convoy:s.activeConvoy,native:positions};return true;
        }
        return false;
      },{timeout:20_000,message:'Dropping both real report channels must hold and stop native travel'}).toBe(true);
      blocking=false;
      await expect.poll(async()=>{
        const s=await live.state(),c=s.activeConvoy;
        if(c?.id!==original.convoy.id||c.phase!=='travel')return false;
        const leader=s.characters[c.leader]?.convoyNavigation;
        if(leader?.reusedRoutes!==1||leader.routeSource!=='remainder')return false;
        resumed={convoy:c,native:await native()};return true;
      },{timeout:120_000,message:'Fresh owned recovery must reuse the validated walking remainder'}).toBe(true);
      const cache=resumed.native.find((p:any)=>p.name===W).cache;
      expect(cache.plot.some((step:any)=>step.town),'Reused walking checkpoint must not contain a Town action').toBe(false);
      expect(profile(await live.state()).monsterHunt.cycleId).toBe(cycle);
      await expect.poll(async()=>tokens((await world(live))[W]),{timeout:300_000}).toBe(tokens(before[W])+1);
      expect((await live.clients[W].events()).some((e:any)=>e.event==='hit'&&e.data?.kill)).toBe(true);
      expect((await world(live))[W].map).toBe('main');
      await artifact(live,info,'native-walking-return-cache-reward',{before,destination,cycle,original,held,resumed,faults});
    }finally{
      blocking=false;await context.unroute('**/party-api/status',intercept);
      await info.attach('native-walking-return-cache-fault-ledger',{body:JSON.stringify({cycle,original,held,resumed,faults}),contentType:'application/json'});
    }
  });

  });

  test('native quest expiration records one failure, survives restart and obtains a fresh Daisy quest', async ({ live }, info) => {
    await party(live);
    await location(live);
    await quests(live, info, { [W]: { count: 10000, ms: 20000 }, [P]: { count: 10000, ms: 20000 } });
    const before = await world(live);
    await start(live);
    await expect.poll(async () => profile(await live.state()).huntFailures?.goo?.expirations || 0, { timeout: 90_000 }).toBe(1);
    expect(profile(await live.state()).huntBlacklist.goo).toBeTruthy();
    await live.restartCoordinator();
    await expect.poll(async () => (await world(live))[W].quest?.ms || 0, { timeout: 150_000 }).toBeGreaterThan(120000);
    expect(profile(await live.state()).huntFailures.goo.expirations).toBe(1);
    expect(tokens((await world(live))[W])).toBe(tokens(before[W]));
    await live.post('/hunt-blacklist', { character: W, action: 'clear' });
    expect(profile(await live.state()).huntBlacklist).toEqual({});
    expect(profile(await live.state()).huntFailures).toEqual({});
    await artifact(live, info, 'native-expiration-reacquisition', { before });
  });

  test('both independently completed party quests claim exactly one native reward each', async ({ live }, info) => {
    await party(live);
    await quests(live, info, { [W]: { count: 0 }, [P]: { count: 0 } });
    const before = await world(live);
    await start(live);
    await expect.poll(async () => { const current = await world(live); return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1); }, { timeout: 180_000 }).toBe(true);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.restartCoordinator();
    const after = await world(live);
    for (const name of fighters) expect(tokens(after[name])).toBe(tokens(before[name]) + 1);
    await artifact(live, info, 'independent-party-rewards', { before });
  });

  test('a follower completed quest waits for leader real kills then both owners receive Daisy rewards', async ({ live }, info) => {
    await party(live);
    await quests(live, info, { [W]: { count: 2 }, [P]: { count: 0 } });
    const before = await world(live);
    await start(live);
    await expect.poll(async () => { const current = await world(live); return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1); }, { timeout: 210_000 }).toBe(true);
    expect((await live.clients[W].events()).some((entry: any) => entry.event === 'hit' && entry.data?.kill)).toBe(true);
    await artifact(live, info, 'follower-quest-owner-return', { before });
  });

  test('a real leader final kill leaves an unfinished follower quest usable without a loot hold stall', async ({ live }, info) => {
    test.setTimeout(420_000);
    await party(live);
    await quests(live, info, { [W]: { count: 1 }, [P]: { count: 8 } });
    const before = await world(live);
    await start(live);
    let intermediate: Awaited<ReturnType<typeof world>>;
    await expect.poll(async () => {
      const current = await world(live);
      if (current[W].quest?.id === 'goo' && current[W].quest.c === 0 &&
        current[P].quest?.id === 'goo' && current[P].quest.c > 0 && current[P].quest.c < 8) {
        intermediate = current;
        return true;
      }
      return false;
    }, { timeout: 120_000, intervals: [50, 100, 200], message: 'A native kill must complete only the leader quest' }).toBe(true);
    await info.attach('unequal-native-quest-progress', { body: JSON.stringify(intermediate!), contentType: 'application/json' });
    await expect.poll(async () => tokens((await world(live))[W]), { timeout: 150_000 }).toBe(tokens(before[W]) + 1);
    const afterLeaderReward = await world(live);
    const scopeChange = tokens(afterLeaderReward[P]) === tokens(before[P]);
    if (scopeChange) {
      expect(afterLeaderReward[P].quest?.id).toBe('goo');
      expect(afterLeaderReward[P].quest.c).toBeLessThanOrEqual(intermediate![P].quest.c);
      // A leader-owned Hunt need not finish the follower's different remaining
      // count. Explicitly give the follower its own controller to claim that quest.
      await live.post('/formation', { character: P, follow: false });
      await start(live, P);
    }
    await expect.poll(async () => tokens((await world(live))[P]), { timeout: 150_000 }).toBe(tokens(before[P]) + 1);
    await artifact(live, info, 'unequal-owners-native-kill-and-claims', {
      before, intermediate, afterLeaderReward, followerCompletion: scopeChange ? 'explicit Follow-off and solo Hunt' : 'original party Hunt',
    });
  });

  test('an unfollowed priest completes a native solo Hunt without activating the warrior controller', async ({ live }, info) => {
    await live.post('/formation', { leader: W });
    // CI reached the spawn without a travel kill and then had no authorized
    // target. Native setup walking makes that boundary repeatable locally.
    await live.clients[P].run("smart_move({map:'main',x:-32,y:719})");
    await quests(live, info, { [P]: { count: 1 } });
    const before = await world(live);
    await start(live, P);
    await expect.poll(async () => (await live.clients[P].run('globalThis.__partyGroupedCombat'))?.members,
      { timeout: 25_000, message: 'The independent priest must receive its own singleton combat group' }).toEqual([P]);
    const settings = await live.post('/hunt-settings', { character: P, deathThreshold: 4 });
    expect(settings).toMatchObject({ farmingOwner: P, savedFarmingPolicy: 'hunt', effectiveFarmingPolicy: 'hunt' });
    await live.post('/hunt-settings', { deathThreshold: 2 });
    expect(profile(await live.state(), P).huntSettings.deathThreshold).toBe(4);
    expect(profile(await live.state(), W).huntSettings.deathThreshold).toBe(2);
    await expect.poll(async () => tokens((await world(live))[P]), { timeout: 210_000 }).toBe(tokens(before[P]) + 1);
    expect((await live.clients[P].events()).some(event => event.event === 'hit' && event.data?.kill)).toBe(true);
    expect(profile(await live.state(), W).monsterHunt).toBeFalsy();
    expect((await world(live))[W].quest).toBeNull();
    expect(tokens((await world(live))[W])).toBe(tokens(before[W]));
    await artifact(live, info, 'independent-solo-controller', { before, settings });
  });

  test('Hunt off then on starts a new cycle using the remaining native quest after restart', async ({ live }, info) => {
    await party(live);
    await quests(live, info, { [W]: { count: 1000 }, [P]: { count: 1000 } });
    await start(live);
    await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 120_000 }).toBeLessThan(1000);
    const firstCycle = profile(await live.state()).monsterHunt.cycleId;
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.restartCoordinator();
    expect(profile(await live.state()).monsterHunt).toBeFalsy();
    const remaining = (await world(live))[W].quest.c;
    await start(live);
    await expect.poll(async () => { const cycle = profile(await live.state()).monsterHunt?.cycleId; return !!cycle && cycle !== firstCycle; }).toBe(true);
    await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 90_000 }).toBeLessThan(remaining);
    expect((await world(live))[W].quest.id).toBe('goo');
    await artifact(live, info, 'off-on-native-quest-continuity', { firstCycle, remaining });
  });

  test('a preferred spawn survives restart and produces real Hunt kills at the selected area', async ({ live }, info) => {
    await party(live);
    await location(live, 'bee');
    const initial = (await world(live))[W];
    const choices = zones((await live.state(true)).monsterChoices, ['bee']).filter(area => area.map === initial.map)
      .sort((a, b) => Math.hypot(a.x-initial.x, a.y-initial.y)-Math.hypot(b.x-initial.x, b.y-initial.y));
    expect(choices.length, 'Preference must override the default nearest spawn').toBeGreaterThan(1);
    const destination = choices[choices.length-1], key = JSON.stringify([destination.map, destination.x, destination.y]);
    await live.post('/hunt-settings', { character: W, preferredSpawns: { bee: key } });
    await live.restartCoordinator();
    expect(profile(await live.state()).huntSettings.preferredSpawns.bee).toBe(key);
    await quests(live, info, { [W]: { id: 'bee', count: 1000 }, [P]: { id: 'bee', count: 1000 } });
    await start(live, W, 'bee');
    await expect.poll(async () => profile(await live.state()).monsterHunt?.stage, { timeout: 120_000 }).toBe('farming');
    const countAtArrival = (await world(live))[W].quest.c;
    await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 90_000 }).toBeLessThan(countAtArrival);
    const mission = profile(await live.state()).monsterHunt.missions[0].destination;
    expect(JSON.stringify([mission.map, mission.x, mission.y])).toBe(key);
    const actual = (await world(live))[W];
    expect(actual.map).toBe(destination.map);
    expect(contains(destination, actual, 120)).toBe(true);
    await artifact(live, info, 'preferred-spawn-native-combat', { destination, key });
  });

  test('invalid backup and spawn preference mutations leave an active native Hunt intact', async ({ live }, info) => {
    await party(live);
    await quests(live, info, { [W]: { count: 30 }, [P]: { count: 30 } });
    const before = await world(live);
    await start(live);
    await expect.poll(async () => profile(await live.state()).monsterHunt?.cycleId).toBeTruthy();
    const cycle = profile(await live.state()).monsterHunt.cycleId;
    const catalog = (await live.state(true)).monsterChoices;
    const spawnKey = (monster: string) => { const area = zones(catalog, [monster])[0]; expect(area).toBeTruthy(); return JSON.stringify([area.map, area.x, area.y]); };
    const beeKey = spawnKey('bee'), gooKey = spawnKey('goo');
    await live.post('/hunt-settings', { character: W, preferredSpawns: { bee: beeKey } });
    await live.post('/hunt-settings', { character: W, preferredSpawns: { goo: gooKey } });
    expect(profile(await live.state()).huntSettings.preferredSpawns).toMatchObject({ bee: beeKey, goo: gooKey });
    await live.post('/hunt-settings', { character: W, preferredSpawns: { goo: '' } });
    expect(profile(await live.state()).huntSettings.preferredSpawns).toMatchObject({ bee: beeKey, goo: '' });
    for (const monsterId of ['bee', 'spider']) await live.post('/hunt-blacklist', { character: W, action: 'add', monsterId });
    await live.post('/hunt-blacklist', { character: W, action: 'remove', monsterId: 'bee' });
    expect(profile(await live.state()).huntBlacklist.bee).toBeFalsy();
    expect(profile(await live.state()).huntBlacklist.spider).toMatchObject({ monsterId: 'spider', deaths: 0, reason: 'Manually blacklisted' });
    const unchanged = (state: any) => { const current = profile(state); return { settings: current.huntSettings, blacklist: current.huntBlacklist,
      policy: current.farmingPolicy, focus: current.monsterFocus, location: current.location, cycle: current.monsterHunt?.cycleId }; };
    const expected = unchanged(await live.state());
    const invalid: { route: string; body: Record<string, unknown>; status: number }[] = [
      { route: '/farming-mode', body: { character: W, mode: 'hunt', backup: { monsterFocus: ['goo'], location: { map: 'not-a-map', x: 0, y: 0 } } }, status: 400 },
      ...[{ deathThreshold: 0 }, { expirationThreshold: 1.5 }, { blacklistDeaths: 'true' }, { unknown: true },
        { relocateIfCompeting: false, deathThreshold: 0 },
        ...[[], null, { goo: 7 }, { goo: 'not-a-spawn' }, { missing: gooKey }].map(preferredSpawns => ({ preferredSpawns }))
      ].map(body => ({ route: '/hunt-settings', body: { character: W, ...body }, status: 400 })),
      { route: '/hunt-settings', body: { character: P, deathThreshold: 4 }, status: 409 },
      { route: '/hunt-settings', body: { character: 'E2EMerchant', deathThreshold: 4 }, status: 409 },
      { route: '/hunt-settings', body: { character: 'not-owned', deathThreshold: 4 }, status: 400 },
      { route: '/hunt-blacklist', body: { character: W, action: 'invalid' }, status: 400 },
      { route: '/hunt-blacklist', body: { character: W, action: 'add', monsterId: 'not-a-monster' }, status: 400 },
    ];
    const responses = [];
    for (const request of invalid) {
      const response = await rejected(live, request.route, request.body);
      responses.push({ ...request, response });
      expect(response.status, JSON.stringify(request)).toBe(request.status);
      expect(unchanged(await live.state()), 'Rejected mutation must be atomic').toEqual(expected);
    }
    await live.post('/hunt-blacklist', { character: W, action: 'clear' });
    expect(profile(await live.state()).huntBlacklist).toEqual({});
    expect(profile(await live.state()).huntFailures).toEqual({});
    await expect.poll(async () => tokens((await world(live))[W]), { timeout: 180_000 }).toBe(tokens(before[W]) + 1);
    await artifact(live, info, 'rejected-hunt-mutations-real-completion', { responses, expected, cycle });
  });

  for (const deathThreshold of [1, 2]) {
    test(`an active Hunt survives native death and restart with death threshold ${deathThreshold}`, async ({ live }, info) => {
      if (deathThreshold === 2) test.setTimeout(450_000);
      await party(live);
      await live.post('/hunt-settings', { character: W, deathThreshold });
      await quests(live, info, { [W]: { count: 10000 }, [P]: { count: 10000 } });
      await start(live);
      await expect.poll(async () => profile(await live.state()).monsterHunt?.stage, { timeout: 120_000 }).toBe('farming');
      await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 60_000 }).toBeLessThan(10000);
      const cycle = profile(await live.state()).monsterHunt.cycleId;
      // Inject the failure, never the recovery: the real server death function emits
      // its normal events; maintained character code must respawn and resume combat.
      const death = await killNativeCharacter(live, W);
      await info.attach('native-death-fault', { body: JSON.stringify({ deathThreshold, death }), contentType: 'application/json' });
      expect(death.rip).toBeTruthy();
      await expect.poll(async () => profile(await live.state()).huntFailures?.goo?.deaths || 0, { timeout: 30_000 }).toBe(1);
      const deadState = await live.state();
      expect((await world(live))[W].rip, 'Verify the movement guard while the native character is still dead').toBe(true);
      expect(profile(deadState).monsterHunt.deathCount).toBe(1);
      expect(deadState.activeConvoy, 'No travel may be dispatched while a Hunt participant is dead').toBeFalsy();
      const recordedDeath = { hunt: profile(deadState).monsterHunt, failures: profile(deadState).huntFailures, blacklist: profile(deadState).huntBlacklist };
      await live.restartCoordinator();
      await expect.poll(async () => !(await world(live))[W].rip, { timeout: 120_000 }).toBe(true);
      const restored = profile(await live.state());
      expect(restored.huntFailures.goo.deaths).toBe(1);
      expect(!!restored.huntBlacklist?.goo).toBe(deathThreshold === 1);
      if (deathThreshold === 1) {
        await live.post('/hunt-blacklist', { character: W, action: 'remove', monsterId: 'goo' });
        expect(profile(await live.state()).huntBlacklist?.goo).toBeFalsy();
      } else {
        expect(restored.monsterHunt.cycleId).toBe(cycle);
      }
      const remaining = (await world(live))[W].quest.c;
      await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 120_000 }).toBeLessThan(remaining);
      expect((await world(live))[W].quest.id).toBe('goo');
      let thresholdCrossing: unknown;
      if (deathThreshold === 2) {
        expect(profile(await live.state()).huntFailures.goo.deaths).toBe(1);
        const secondDeath = await killNativeCharacter(live, W);
        expect(secondDeath.rip).toBeTruthy();
        await expect.poll(async () => profile(await live.state()).huntFailures?.goo?.deaths || 0, { timeout: 30_000 }).toBe(2);
        const context=live.clients[W].page.context();
        let droppedCatalogs=0;
        const dropCatalog=async(route:import('@playwright/test').Route)=>{
          if(route.request().postDataJSON()?.monsterChoices){droppedCatalogs++;await route.abort('connectionreset');}
          else await route.fallback();
        };
        await context.route('**/party-api/status',dropCatalog);
        await live.restartCoordinator();
        await expect.poll(async () => !(await world(live))[W].rip, { timeout: 120_000 }).toBe(true);
        const crossed = profile(await live.state());
        expect(crossed.huntFailures.goo.deaths).toBe(2);
        expect(crossed.huntBlacklist.goo.deaths).toBe(2);
        thresholdCrossing = { secondDeath, failures: crossed.huntFailures, blacklist: crossed.huntBlacklist };
        await expect.poll(()=>droppedCatalogs,{timeout:15_000}).toBeGreaterThan(0);
        expect((await live.state(true)).monsterChoices||[]).toHaveLength(0);
        await live.post('/hunt-blacklist', { character: W, action: 'remove', monsterId: 'goo' });
        await context.unroute('**/party-api/status',dropCatalog);
        const afterSecondRespawn = (await world(live))[W].quest.c;
        await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 120_000 }).toBeLessThan(afterSecondRespawn);
      }
      await artifact(live, info, 'native-hunt-death-recovery', { deathThreshold, cycle, death, recordedDeath, restored, remaining, thresholdCrossing });
    });
  }
});
