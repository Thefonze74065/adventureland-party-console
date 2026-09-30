import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, fighters, world, tokens, profile, party, quests, start, artifact } from './game/hunt-lifecycle';

test('native Hunt fallback arrival releases farming instead of repeatedly restarting travel',async({live},info)=>{
  test.setTimeout(240_000);
  await party(live);
  await quests(live,info,{[W]:{count:100},[P]:{count:100}});
  await start(live);
  await expect.poll(async()=> (await live.state()).activeConvoy?.phase==='travel' &&
    await live.clients[W].run('!!character.moving && !character.c?.town'),
    {timeout:90_000,intervals:[50,100],message:'Interrupt a genuine native Hunt walking route'}).toBe(true);
  const interrupted=await live.clients[W].run('(()=>{const before={at:Date.now(),map:character.map,x:character.x,y:character.y,smartMoving:smart.moving};stop("smart");return before})()');
  await info.attach('native-route-stop',{body:JSON.stringify(interrupted),contentType:'application/json'});
  await expect.poll(async()=>Object.values(profile(await live.state()).monsterHunt?.routeRecovery||{}).some((entry:any)=>entry.phase==='native'),
    {timeout:30_000,message:'The real route interruption must activate the bounded native fallback'}).toBe(true);
  const recovering=profile(await live.state()).monsterHunt;
  await expect.poll(async()=>(await world(live))[W].quest?.c,
    {timeout:120_000,message:'Successful fallback arrival must release actual Hunt combat'}).toBeLessThan(100);
  const firstKills=await world(live);
  await expect.poll(async()=>(await world(live))[W].quest?.c,
    {timeout:30_000,message:'Farming must continue after the first kills without restarting the completed route'}).toBeLessThan(firstKills[W].quest.c);
  const finalState=await live.state(), finalHunt=profile(finalState).monsterHunt;
  expect(finalHunt.cycleId).toBe(recovering.cycleId);
  expect(finalHunt.routeRecovery,'Successful arrival must retain the spent retry budget').toEqual(recovering.routeRecovery);
  await artifact(live,info,'native-fallback-arrival-and-continuing-kills',{interrupted,recovering,firstKills});
});

// Faults exercise the actual browser transport; no status, route or acknowledgement is fabricated.
for (const fault of ['completion-request', 'completion-response', 'follower-reconnect'] as const) {
  test(`native Hunt survives ${fault} loss and both owners receive exactly one Daisy reward`, async ({ live }, info) => {
    test.setTimeout(300_000);
    await party(live);
    const questCount = fault === 'follower-reconnect' ? 12 : 3;
    // Disconnected characters do not receive native party kill credit. Keep the
    // follower's initial quest complete in the reconnect scenario so it tests
    // ownership recovery and both turn-ins, not credit for kills while offline.
    await quests(live, info, { [W]: { count: questCount }, [P]: { count: fault==='follower-reconnect'?0:questCount } });
    const before = await world(live);
    const faults: unknown[] = [];
    let intercepted = false;
    const context = live.clients[W].page.context();
    const rendezvousReports: unknown[] = [];
    const inspectStatus = (request: import('@playwright/test').Request) => {
      if (fault !== 'follower-reconnect' || request.method() !== 'POST' || !request.url().endsWith('/party-api/status')) return;
      const body = request.postDataJSON();
      if (body.name === P && body.convoyNavigation?.phase === 'rendezvous') rendezvousReports.push({ at: Date.now(), report: body.convoyNavigation });
    };
    context.on('request', inspectStatus);
    if (fault !== 'follower-reconnect') {
      await context.route('**/party-api/convoy-complete', async route => {
        const packet = route.request().postDataJSON();
        if (intercepted || packet.character !== P) return route.fallback();
        intercepted = true;
        if (fault === 'completion-response') {
          const response = await route.fetch();
          faults.push({ fault, packet, acceptedResponse: await response.json() });
        } else faults.push({ fault, packet });
        await route.abort('connectionreset');
      });
    }
    await start(live);
    await expect.poll(async () => profile(await live.state()).monsterHunt?.cycleId).toBeTruthy();
    const cycle = profile(await live.state()).monsterHunt.cycleId;
    if (fault === 'follower-reconnect') {
      await expect.poll(async () => (await world(live))[W].quest?.c, { timeout: 120_000 }).toBeLessThan(questCount);
      const beforeReconnect = await world(live);
      const previousRuntime = (await live.state()).characters[P]?.combatSelection?.runtimeId;
      expect(previousRuntime).toBeTruthy();
      expect(beforeReconnect[W].quest?.c, 'Disconnect must interrupt an unfinished native Hunt').toBeGreaterThan(0);
      faults.push({ fault, beforeReconnect });
      await live.reconnectClient(P);
      expect((await live.clients[P].snapshot()).name).toBe(P);
      await expect.poll(async () => {
        const runtime = (await live.state()).characters[P]?.combatSelection?.runtimeId;
        return !!runtime && runtime !== previousRuntime;
      }, {timeout:30_000,message:'The coordinator must observe the reconnected follower runtime'}).toBe(true);
    } else await expect.poll(() => intercepted, { timeout: 120_000 }).toBe(true);
    await expect.poll(async () => {
      const current = await world(live);
      return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1);
    }, { timeout: 180_000 }).toBe(true);
    if (fault === 'follower-reconnect') {
      // A follower still at the group can recover directly without a rendezvous
      // leg. When it does need that leg, its actual reports must identify it.
      expect(rendezvousReports.every((entry: any) => entry.report.routeVersion > 0), 'Rendezvous must publish its issued route version before awaiting native travel').toBe(true);
    }
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.restartCoordinator();
    const after = await world(live);
    for (const name of fighters) expect(tokens(after[name])).toBe(tokens(before[name]) + 1);
    context.off('request', inspectStatus);
    await artifact(live, info, 'hunt-native-communication-recovery', { cycle, before, faults, rendezvousReports });
  });
}
