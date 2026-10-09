import { test, expect } from './live-fixtures';
import { zones, contains } from '../dashboard/lib/farming-zones';
import type { PlanRequest, PlanResult } from '../runtime/navigation/contracts';
import { warrior as W, priest as P, fighters, world, tokens, profile, party, quests, location, start, artifact } from './game/hunt-lifecycle';

// Ordinary movement speed matters: this walking route first detours away from
// Town, and faster god equipment can hide the former 30-second progress timeout.
// The shared native-loadout/initial-stats artifacts record the actual game stats.
test.use({ loadout: 'fragile' });

// Failure modes recorded before the adapter fix:
// - One real Town cast is interrupted after another member reaches Main town.
// - The replacement walking request incorrectly receives another Town step.
// - Rejected planning strands the remaining member while its peer waits forever.
// - Coordinator restart loses the forward rally or restores the forbidden warp.
for (const {restart, lateTransport} of [{restart:false,lateTransport:false},{restart:true,lateTransport:false},{restart:false,lateTransport:true}]) {
  test(`partial native Town failure reunites the Hunt party and claims both rewards${restart ? ' across coordinator restart' : lateTransport ? ' after a delayed transport interrupts walking' : ''}`, async ({ live }, info) => {
    test.setTimeout(420_000);
    await location(live, 'bee');
    const equipmentSeed = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)});if(p.items[10])throw Error('Occupied equipment seed slot');p.items[10]={name:'iceskates',level:0};cache_player_items(p);resend(p,'reopen+cid');return {slot:10,item:p.items[10],previousShoes:p.slots.shoes,speed:p.speed}})()`);
    await expect.poll(() => live.clients[P].run('character.items[10]?.name')).toBe('iceskates');
    const equipReceipt = await live.clients[P].run('(async()=>({result:await equip(10),shoes:character.slots.shoes,speed:character.speed}))()');
    await expect.poll(() => live.admin(`output=get_player(${JSON.stringify(P)}).slots.shoes?.name`)).toBe('iceskates');
    const equipmentStats = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)}),warcry=p.s.warcry||null,definition=G.conditions.warcry;
      const active=!!warcry&&Number(warcry.ms)>0;
      if(active&&(!Number.isFinite(definition?.speed)||definition.speed<0))throw Error('Unknown native War Cry speed definition');
      return {shoes:p.slots.shoes,speed:p.speed,hp:p.hp,max_hp:p.max_hp,warcry,warcryDefinition:definition,
        baselineSpeed:p.speed-(active?definition.speed:0)}})()`);
    expect(equipmentStats.baselineSpeed).toBeLessThanOrEqual(40);
    expect(equipmentStats.baselineSpeed).toBeGreaterThan(0);
    await info.attach('town-native-iceskates-equipment', { body: JSON.stringify({ equipmentSeed, equipReceipt, equipmentStats,
      rationale: 'Native Ice Skates have baseline speed <=40; subtract only an active native War Cry speed bonus for this equipment assertion. Retain actual speed and buff definition: maintained War Cry can temporarily accelerate the real walk. The pinned2561-unit full walk at40speed takes about64s, under120s absolute bound.' }), contentType: 'application/json' });
    const candidates = zones((await live.state(true)).monsterChoices, ['bee']).filter(area => area.map === 'main');
    // Native 15555 Bee boundary [448,694,592,812] contains the incident's
    // Main(520,710) origin. Returning on foot must detour southeast first.
    const destination = candidates.find(area => contains(area, { map: 'main', x: 520, y: 710 }, 0));
    expect(destination).toBeTruthy();
    if (!destination) throw new Error('Pinned native Bee incident area is unavailable');
    // This scenario injects one follower cast interruption. Ambient Bee attacks
    // must not independently interrupt the leader's prerequisite successful cast.
    // CI failure inventory: the first fighter genuinely arrives, then Bee aggro
    // causes native kiting outside the region before the slower fighter arrives.
    // Declare peaceful initial Bees before travel, rather than after a rendezvous
    // that incidental combat can prevent. Keep actual walking/arrival assertions.
    const peacefulBees = await live.admin(`output=(()=>{
      const original=globalThis.__e2eHuntRareOriginal||={};
      original.bee||=JSON.parse(JSON.stringify(G.monsters.bee));
      const monsters=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).filter(m=>m.type==='bee');
      const before=monsters.map(m=>({id:m.id,aggro:m.aggro,aa:m.aa,rage:m.rage,target:m.target}));
      Object.assign(G.monsters.bee,{aggro:0,aa:0,rage:0});
      for(const m of monsters)Object.assign(m,{aggro:0,aa:0,rage:0,target:null});
      return {original:original.bee,monsters:before};
    })()`);
    await info.attach('town-initial-peaceful-bees', {body:JSON.stringify(peacefulBees),contentType:'application/json'});
    // Reach this region with real native navigation before assigning the
    // initially completed quests. This scenario covers return recovery, not kills.
    for (const character of fighters) await live.post('/command', {
      character, type: 'character-travel', location: { map: 'main', x: 520, y: 710 }, label: 'Native Town recovery incident origin',
    });
    await expect.poll(async () => {
      const current = await world(live);
      return fighters.every(name => !current[name].quest && contains(destination, current[name], 0));
    }, { timeout: 150_000, message: 'Both native fighters must reach the incident Bee region before quest setup' }).toBe(true);
    await party(live);
    await live.post('/hunt-settings', { character: W, preferredSpawns: { bee: JSON.stringify([destination.map, destination.x, destination.y]) } });
    await quests(live, info, { [W]: { id: 'bee', count: 0 }, [P]: { id: 'bee', count: 0 } });
    const before = await world(live);
    await info.attach('town-recovery-native-movement-stats', {
      body: JSON.stringify(await live.admin(`output=Object.fromEntries(['${W}','${P}'].map(name=>{const p=Object.values(players).find(p=>p.name===name);return [name,{speed:p.speed,map:p.map,x:p.x,y:p.y,hp:p.hp,max_hp:p.max_hp}]}))`)),
      contentType: 'application/json',
    });
    // Withhold genuine Town requests (including native retries) until the leader
    // actually arrives. Preserve every packet and bound this transport fault.
    await live.clients[P].run(`(() => {
      const socket = parent.socket, emit = socket.emit;
      const fault = globalThis.__e2eTownFault = { delayed: false, released: false, events: [] };
      const pending = [];
      let timer;
      fault.release = reason => {
        if (fault.released) return;
        fault.armed = reason === 'authoritative-leader-town-arrival';
        fault.released = true; clearTimeout(timer);
        for (const packet of pending.splice(0)) {
          fault.events.push({ event: 'town-request-forwarded', reason, at: Date.now() });
          emit.apply(socket, packet);
        }
      };
      socket.emit = function(event, ...args) {
        if (event === 'town' && !fault.released) {
          pending.push([event, ...args]);
          fault.events.push({ event: 'town-request-delayed', at: Date.now(), queued: pending.length });
          if (!fault.delayed) timer = setTimeout(() => fault.release('bounded-gate-expired'), 30000);
          fault.delayed = true;
          return socket;
        }
        if (event === 'town') fault.events.push({ event: 'native-town-request', at: Date.now() });
        return emit.apply(socket, [event, ...args]);
      };
      // Observe the real server cast in the client: an external round trip can
      // miss the entire window if normal healing interrupts it first.
      const onPlayer = data => {
        if (!fault.armed || fault.interruption || !data.c?.town) return;
        fault.interruption = {map:data.map || character.map,x:data.x,y:data.y,casting:true,nativeTown:data.c.town,at:Date.now()};
        stop('town');
        fault.events.push({event:'native-stop-town',...fault.interruption});
      };
      socket.on('player', onPlayer);
      fault.restore = () => { fault.release('fixture-cleanup'); socket.off('player', onPlayer); socket.emit = emit; };
      return true;
    })()`);
    const plans: unknown[] = [];
    const planResponses: { url: string; request?: PlanRequest & { character?: string }; status?: number; body?: Partial<PlanResult>; error?: string }[] = [];
    const pendingResponses: Promise<void>[] = [];
    const context = live.clients[W].page.context();
    const observePlan = (request: import('@playwright/test').Request) => {
      if (request.method() === 'POST' && /movement.*plan|pathfind|\/plan(?:\?|$)/.test(new URL(request.url()).pathname)) {
        try { plans.push({ url: request.url(), body: request.postDataJSON() }); } catch { /* non-JSON native request */ }
      }
    };
    const observeResponse = (response: import('@playwright/test').Response) => {
      if (new URL(response.url()).pathname !== '/party-api/movement-plan') return;
      pendingResponses.push((async () => {
        try { planResponses.push({ url: response.url(), request: response.request().postDataJSON(), status: response.status(), body: await response.json() }); }
        catch (error) { planResponses.push({ url: response.url(), error: String(error) }); }
      })());
    };
    context.on('request', observePlan);
    context.on('response', observeResponse);
    let split: Awaited<ReturnType<typeof world>>;
    let interruption: {at:number;map:string;x:number;y:number;casting:boolean};
    const recoveryPositions: { at: number; map: string; x: number; y: number; distanceFromTown: number; ownedWalking: boolean }[] = [];
    let ownedWalking = false;
    const recoveryStates: { at: number; id?: string; phase?: string; attempts: number; failure?: string; code?: string; message?: string }[] = [];
    const recordRecoveryState = async () => {
      const state = await live.state(), convoy = state.activeConvoy;
      const status = state.characters[P], report = status?.convoyNavigation, expected = convoy?.expected?.[P];
      ownedWalking = !!convoy?.returnTownRally && !!convoy?.disableTown && convoy.phase !== 'communication-hold' &&
        report?.id === convoy.id && report?.epoch === convoy.epoch && !!expected &&
        report.commandId === expected.commandId && report.navigationRevision === expected.revision &&
        report.runtimeId === expected.runtimeId && status.seenAt >= Date.now() - 3000;
      recoveryStates.push({ at: Date.now(), id: convoy?.id, phase: convoy?.phase, attempts: convoy?.recoveryAttempts || 0,
        failure: convoy?.failure, code: convoy?.failureCode, message: profile(state).monsterHunt?.message });
    };
    const recordRecovery = (current: Awaited<ReturnType<typeof world>>) => {
      const follower = current[P];
      recoveryPositions.push({ at: Date.now(), map: follower.map, x: follower.x, y: follower.y, distanceFromTown: Math.hypot(follower.x, follower.y), ownedWalking });
    };
    try {
      if (lateTransport) await live.clients[W].run(`(()=>{
        const fault=globalThis.__e2eLeaderTownFault={};
        const onPlayer=data=>{if(!fault.interruption&&data.c?.town){
          fault.interruption={at:Date.now(),x:character.x,y:character.y};stop('town');
        }};
        parent.socket.on('player',onPlayer);
        fault.restore=()=>parent.socket.off('player',onPlayer);
      })()`);
      await start(live, W, 'bee');
      if (lateTransport) {
        // Both initially remain outside Town. Release the original follower
        // packet only once interrupted-cast recovery has genuinely begun walking.
        await expect.poll(async()=>{
          const current=await world(live), s=await live.state();
          return !!s.activeConvoy?.returnTown?.walking &&
            Math.hypot(current[P].x-before[P].x,current[P].y-before[P].y)>80 &&
            await live.clients[W].run('!!globalThis.__e2eLeaderTownFault.interruption') &&
            await live.clients[P].run('!!character.moving && globalThis.__e2eTownFault.delayed && !globalThis.__e2eTownFault.released');
        },{timeout:60_000,intervals:[100,250],message:'The delayed packet must outlive the interrupted Town round and overlap actual recovery walking'}).toBe(true);
        const walking=await world(live), recovery= (await live.state()).activeConvoy, releaseAt=Date.now();
        await live.clients[P].run("globalThis.__e2eTownFault.release('late-walking-transport')");
        await expect.poll(async()=>{
          const current=await world(live);
          return Math.hypot(current[P].x,current[P].y)<90 && Math.hypot(current[W].x,current[W].y)>250;
        },{timeout:15_000,message:'The genuine delayed cast must transport only the follower during walking recovery'}).toBe(true);
        const transported=await world(live);
        await expect.poll(async()=>{
          const current=await world(live);
          return fighters.every(name=>tokens(current[name])===tokens(before[name])+1);
        },{timeout:180_000,message:'A late native transport must still reunite the party and yield both real Daisy rewards'}).toBe(true);
        const finalState=await live.state();
        const staleOrigins=(finalState.combatLogs?.[W]||[]).filter((entry:any)=>
          entry.at>=releaseAt && /Leader moved from planning origin/.test(entry.details?.reason||entry.message));
        expect(staleOrigins,'Recovery must not repeatedly prepare from an unreached Town rally').toEqual([]);
        await artifact(live,info,'late-native-town-walking-recovery',{before,walking,recovery,transported,plans,planResponses});
        return;
      }
      await expect.poll(async () => {
        const current = await world(live);
        if (!fighters.every(name => current[name].quest?.id === 'bee' && current[name].quest.c === 0) ||
          current[W].map !== 'main' || Math.hypot(current[W].x, current[W].y) >= 90 ||
          current[P].map !== 'main' || Math.hypot(current[P].x, current[P].y) <= 250) return false;
        split = current;
        return live.clients[P].run(`(() => {
          const fault = globalThis.__e2eTownFault;
          if (!fault.delayed || fault.released) return false;
          fault.release('authoritative-leader-town-arrival'); return true;
        })()`);
      }, { timeout: 180_000, intervals: [50, 100], message: 'Release the genuine follower Town request only after actual leader Town arrival' }).toBe(true);
      await expect.poll(() => live.clients[P].run('!!globalThis.__e2eTownFault.interruption'),
        {timeout:8_000,message:'The client must observe and stop the actual native Town cast'}).toBe(true);
      interruption = await live.clients[P].run('globalThis.__e2eTownFault.interruption');
      recordRecovery(await world(live));
      await info.attach('partial-town-native-fault', { body: JSON.stringify({ split, interruption, restart }), contentType: 'application/json' });
      // Native melee/follow positioning can finish just outside the spawn edge.
      // Initial arrival is strictly inside; the measured outward detour below
      // independently proves this return still crosses the incident's obstacle.
      expect(contains(destination, split![P], 100), 'The interrupted follower must remain near the actual incident Bee region').toBe(true);
      await expect.poll(async () => {
        await recordRecoveryState();
        recordRecovery(await world(live));
        const convoy = (await live.state()).activeConvoy;
        return !!convoy?.disableTown && !!convoy?.returnTownRally && !!convoy?.returnTown?.walking;
      }, { timeout: 20_000, intervals: [100, 250], message: 'Real interrupted cast must select a walking Town rally' }).toBe(true);
      const recovery = (await live.state()).activeConvoy;
      const huntCycle = profile(await live.state()).monsterHunt.cycleId;
      expect(recovery.returnTownRally).toMatchObject({ map: 'main', x: 0, y: 0 });
      await recordRecoveryState();
      await expect.poll(async () => {
        await recordRecoveryState();
        const currentWorld = await world(live);
        recordRecovery(currentWorld);
        const current = currentWorld[P];
        return current.map === 'main' && Math.hypot(current.x, current.y) > Math.hypot(split![P].x, split![P].y) + 100;
      }, { timeout: 45_000, intervals: [500, 1000], message: 'The stranded native follower must actually walk outward around the obstacle' }).toBe(true);
      const restartAt = restart ? Date.now() : null;
      if (restart) {
        await live.restartCoordinator();
        const restored = await live.state();
        expect(restored.activeConvoy?.id).toBe(recovery.id);
        expect(profile(restored).monsterHunt.cycleId).toBe(huntCycle);
      }
      await expect.poll(async () => {
        await recordRecoveryState();
        const current = await world(live);
        recordRecovery(current);
        return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1);
      }, { timeout: 150_000, intervals: [500, 1000], message: 'Both completed native quests must reach Daisy and receive one reward' }).toBe(true);
      const final = await world(live);
      const finalState = await live.state();
      const recoveryHistory = (finalState.combatLogs?.[W] || []).filter((entry: any) =>
        entry.details?.convoyId === recovery.id && entry.at >= recoveryPositions[0].at);
      expect(recoveryHistory.filter((entry: any) => /rendezvous.*(no progress|timed out)/i.test(entry.details?.reason || '')),
        'Valid walking detours must not consume recovery attempts through false rendezvous failures').toEqual([]);
      expect(recoveryStates.filter(sample => sample.id === recovery.id).every(sample => sample.attempts <= (recovery.recoveryAttempts || 0)),
        'The initial interrupted Town may recover, but subsequent real walking must not exhaust generic retry budget').toBe(true);
      expect(Math.max(...recoveryPositions.map(position => position.distanceFromTown)),
        'The actual native walking route must first take the follower farther from Town').toBeGreaterThan(Math.hypot(split![P].x, split![P].y) + 100);
      let closest = Infinity, movingWithoutCloser = 0, longestWithoutCloser = 0;
      for (let index = 0; index < recoveryPositions.length; index++) {
        const position = recoveryPositions[index], previous = recoveryPositions[index - 1];
        if (!position.ownedWalking) { closest = Infinity; movingWithoutCloser = 0; continue; }
        if (position.distanceFromTown < closest - 5) { closest = position.distanceFromTown; movingWithoutCloser = 0; }
        else if (previous?.ownedWalking && Math.hypot(position.x - previous.x, position.y - previous.y) >= 5) {
          movingWithoutCloser += position.at - previous.at;
          longestWithoutCloser = Math.max(longestWithoutCloser, movingWithoutCloser);
        }
      }
      if (!restart) expect(longestWithoutCloser, 'Real movement must survive the former 30-second Euclidean progress timeout').toBeGreaterThanOrEqual(30_000);
      const nativeTownRequests = await live.clients[P].run('globalThis.__e2eTownFault.events.filter(event => event.event === "native-town-request")');
      const townEligibility = recoveryHistory.filter((entry: any) => entry.message === 'Convoy Aggro clear; Town eligible');
      if (nativeTownRequests.length) {
        expect(townEligibility.some((entry: any) => entry.at >= interruption.at && entry.at <= nativeTownRequests[0].at),
          'A later native Town request requires an explicit coordinator eligibility transition after the interruption').toBe(true);
      }
      // Upstream sets last.town only when the real cast finishes and transports.
      const nativeTownCompletedAt = await live.admin(`output=Number(get_player(${JSON.stringify(P)}).last.town)||null`);
      const completedRecoveryTown = nativeTownCompletedAt >= interruption.at;
      if (completedRecoveryTown) expect(nativeTownRequests.length, 'A completed native Town must have its genuine socket request in the ledger').toBeGreaterThan(0);
      const recoveryMethod = completedRecoveryTown ? 'walking followed by explicitly eligible native Town' : 'walking';
      await Promise.all(pendingResponses);
      const walkingRallies = planResponses.filter(result => result.request?.character === P &&
        result.request.town === false && result.request.to.map === 'main' &&
        Math.hypot(result.request.to.x, result.request.to.y) < 1);
      expect(walkingRallies.length, 'Recovery must request a real walking-only Town rally route').toBeGreaterThan(0);
      expect(walkingRallies.some(result => result.status === 200 && !!result.body?.plot?.length),
        'The native client must receive a successful walking rally plan').toBe(true);
      for (const result of walkingRallies.filter(result => result.status === 200))
        expect(result.body!.plot!.every(step => !step.town && step.method !== 'town'),
          'A walking fallback must never receive another Town warp').toBe(true);
      expect(fighters.every(name => final[name].map === 'main')).toBe(true);
      expect(profile(await live.state()).monsterHunt?.message || '').not.toContain('Waiting for fresh Main town arrival');
      await artifact(live, info, 'partial-town-native-reunion-and-rewards', { before, destination, split, interruption, recovery, restart, restartAt, huntCycle, plans, planResponses, recoveryPositions, recoveryStates, recoveryHistory, longestWithoutCloser, recoveryMethod, nativeTownRequests, nativeTownCompletedAt, townEligibility });
    } finally {
      if(lateTransport) await live.clients[W].run('globalThis.__e2eLeaderTownFault?.restore()');
      context.off('request', observePlan);
      context.off('response', observeResponse);
      await Promise.all(pendingResponses);
      const faults = await live.clients[P].run(`(() => { const fault = globalThis.__e2eTownFault; if (!fault) return null; fault.restore(); return fault.events; })()`).catch(error => ({ error: String(error) }));
      await info.attach('town-fault-and-planner-requests', { body: JSON.stringify({ faults, plans, planResponses, recoveryPositions, recoveryStates }), contentType: 'application/json' });
      await live.admin(`output=(()=>{
        const original=globalThis.__e2eHuntRareOriginal?.bee;
        if(!original)return false;
        Object.assign(G.monsters.bee,original);
        for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))
          if(m.type==='bee')Object.assign(m,{aggro:original.aggro,aa:original.aa,rage:original.rage});
        delete globalThis.__e2eHuntRareOriginal.bee;return true;
      })()`);
    }
  });
}
