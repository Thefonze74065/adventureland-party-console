import { test, expect } from './live-fixtures';
import type { Route } from '@playwright/test';
import { W, P, M, world, quantity, spawnRare, cleanupEvents } from './game/hunt-events';
import { prepareHunt, beginHunt, hunt, reward, killedByParty } from './hunt-interruption-helpers';

// Failure modes: a lost preparation response leaves no local convoy handle;
// the next genuine defending command is rejected, so combat/loot/Hunt all stall.
// Dropping transport responses must not fabricate a command or acknowledge it.
test('a lost native Hunt preparation response recovers cold defense, loot and the original quest', async ({ live }, info) => {
  test.setTimeout(420_000);
  const setup = await prepareHunt(live, 'armadillo', 1);
  await live.post('/rare-hunting', { rules: { goo: { enabled: true, keepMoving: false, priority: 999 } }, useFieldGenerators: false });
  const before = await world(live);
  const context = live.clients[W].page.context();
  const exchanges: unknown[] = [];
  let convoyId: string | undefined;
  let encounter: Awaited<ReturnType<typeof spawnRare>>;
  let spawning: Promise<void> | undefined;
  let deliveredDefense: any;
  let lastFullRequest: any;
  let dropped = 0;
  let armedFullRequest: any;
  const intercept = async (route: Route) => {
    const request = route.request();
    if (deliveredDefense || request.method() !== 'POST' || request.postDataJSON()?.name !== W) return route.fallback();
    const nativeRequest = request.postDataJSON();
    if (Object.prototype.hasOwnProperty.call(nativeRequest, 'convoyNavigation')) lastFullRequest = nativeRequest;
    const response = await route.fetch();
    const body = await response.json();
    const command = body.command;
    if (command?.type === 'party-monster-travel' && command.purpose === 'monster-hunt' &&
      command.phase !== 'defending' && !deliveredDefense && (!convoyId || convoyId === command.convoyId)) {
      convoyId = command.convoyId;
      dropped++;
      exchanges.push({ at: Date.now(), action: 'aborted-genuine-response', nativeRequest, command, convoySignal: body.convoySignal });
      // The server has already produced its real preparation response. Introduce
      // a visible native encounter now, before any preparation reaches Warrior.
      if (command.phase === 'shared-prepare') {
        spawning ||= spawnRare(live, 'goo').then(value => { encounter = value; });
        await spawning;
      }
      await route.abort('failed');
      return;
    }
    if (convoyId && command?.convoyId === convoyId && command.phase === 'defending' && !deliveredDefense) {
      const delivered = { at: Date.now(), command, priorNativeRequest: nativeRequest, lastFullRequest, convoySignal: body.convoySignal, travelCombat: body.travelCombat };
      await route.fulfill({ response });
      deliveredDefense = delivered;
      exchanges.push({ action: 'forwarded-genuine-defense', ...delivered });
      return;
    }
    await route.fulfill({ response });
    if (!convoyId && Object.prototype.hasOwnProperty.call(nativeRequest, 'convoyNavigation')) armedFullRequest = nativeRequest;
  };
  await context.route('**/party-api/status', intercept);
  try {
    // A full heartbeat already in flight when route() is installed bypasses
    // the interceptor. Let that serialized request finish before starting
    // Hunt, then prove a fresh no-convoy heartbeat crossed the fault boundary.
    await expect.poll(() => armedFullRequest?.convoyNavigation === null,
      {timeout:30_000,message:'The cold-defense fault must own the next full heartbeat before Hunt starts'}).toBe(true);
    await beginHunt(live, setup);
    await expect.poll(() => dropped, { timeout: 45_000, message: 'A real Warrior preparation response must be dropped' }).toBeGreaterThan(0);
    await expect.poll(() => !!deliveredDefense, { timeout: 45_000, message: 'The same convoy must issue a genuine cold defending command' }).toBe(true);
    expect(deliveredDefense.command.convoyId).toBe(convoyId);
    expect(deliveredDefense.lastFullRequest, 'The latest full native request must prove no installed local convoy before defense').toHaveProperty('convoyNavigation', null);
    expect(encounter, 'The fault must have reached real shared preparation and introduced the native encounter').toBeTruthy();
    // The genuine defense response completes this fault. Drain its callbacks now;
    // the rest of the Hunt must use normal client transport, not a fixture proxy.
    await context.unrouteAll({behavior:'wait'});
    exchanges.push({at:Date.now(),action:'fault-retired-after-genuine-defense'});
    const cycle = hunt(await live.state()).cycleId;
    await expect.poll(async () => live.admin(`output=(()=>{const m=instances[${JSON.stringify(encounter.map)}]?.monsters[${JSON.stringify(encounter.id)}];return !!m&&m.hp<${encounter.initialHp}})()`),
      { timeout: 30_000, intervals: [100], message: 'Native combat must damage the cold-defense encounter' }).toBe(true);
    const kill = await killedByParty(live, String(encounter.id), 90_000);
    const gems = (snapshot: any) => [W, P, M].reduce((sum, name) => sum + quantity(snapshot.players[name].items, 'gem0'), 0);
    await expect.poll(async () => gems(await world(live)), { timeout: 45_000 }).toBeGreaterThan(gems(before));
    let loot: any[] = [];
    await expect.poll(async () => {
      loot = (await Promise.all([W, P, M].map(name => live.clients[name].events()))).flat()
        .filter((event: any) => event.event === 'chest_opened' && event.data?.items?.some((item: any) => item.name === 'gem0'));
      return loot.length;
    }, {timeout:15_000,message:'Native chest receipt must reach the client after the authoritative inventory update'}).toBeGreaterThan(0);
    // The injected encounter is finished. Keep attacking passing Goos without
    // repeatedly stopping the outbound Hunt for the world's natural respawns.
    const passingPolicy = await live.post('/rare-hunting', {
      rules: { goo: { enabled: true, keepMoving: true, priority: 999 } }, useFieldGenerators: false,
    });
    expect(hunt(await live.state()).cycleId).toBe(cycle);
    await reward(live, setup.before);
    await info.attach('cold-defense-native-combat-loot-and-hunt-reward', {
      body: JSON.stringify({ encounter, exchanges, kill, loot, passingPolicy, cycle, before, final: await world(live), state: await live.state() }), contentType: 'application/json',
    });
  } finally {
    // This fresh native context has only this fault route. Drain its genuine
    // response callbacks before fixture teardown retires their browser requests.
    await context.unrouteAll({behavior:'wait'});
    await info.attach('cold-defense-real-response-fault-ledger', { body: JSON.stringify({ dropped, convoyId, exchanges }), contentType: 'application/json' });
    await cleanupEvents(live);
  }
});
