const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const handler = source.slice(source.indexOf('    if (command.type === "event-return-town")'),
  source.indexOf('    if (command.type === "character-travel"'));
const routeHelper = source.slice(source.indexOf('  async function exitEventMapForRecovery('),
  source.indexOf('  function anniversaryWithTimeout('));

test('dedicated instance exit rejects unchanged-map success and persists a bounded retry budget', async () => {
  const t=runtime('ship0',{leave:async()=>{},transport:async()=>{}});
  for(let i=0;i<3;i++) await assert.rejects(t.run('pirateship'),/no observed map change/);
  const attempts=t.calls.filter(c=>c[0]==='leave').length;
  t.r.root.__partyEventReturnTravel=null; // replacement runtime retains coordinator progress
  await assert.rejects(t.run('pirateship'),/after three attempts/);
  assert.equal(t.calls.filter(c=>c[0]==='leave').length,attempts);
  assert.equal(t.calls.filter(c=>c[0]==='request' && c[1]==='/event-return-complete').length,0);
});

test('superseded instance exit cannot transport or acknowledge the old command', async()=>{
  const t=runtime('abtesting',{leave:async r=>{r.navigationIntent.revision++;}});
  await t.run('abtesting');
  assert.equal(t.calls.filter(c=>c[0]==='transport').length,0);
  assert.equal(t.calls.filter(c=>c[0]==='request' && c[1]==='/event-return-complete').length,0);
  assert.equal(t.r.eventReturnPending,false);
});

test('unknown dedicated event maps report a blocker without speculative transport',async()=>{
  const t=runtime('future');t.r.G.maps.future={event:'future'};
  await assert.rejects(t.run('future'),/No verified event exit mechanism/);
  assert.equal(t.calls.filter(c=>['leave','transport'].includes(c[0])).length,0);
});

function runtime(map, options = {}) {
  let now = 0, pendingRoute = null;
  const calls = [];
  const character = { name: 'Fighter', map, x: 800, y: 400, rip: false };
  const r = vm.createContext({
    escapeOwns: () => false, huntTurnInPriority: false, runtimeCurrent:()=>true, parent:{},
    character, root: {}, Date: { now: () => now },
    navigationIntent: { revision: 0, cancelled: false },
    G: { npcs: { transporter: { places: { main: 9 } } }, maps: { main: {}, level2w: {}, level2: {}, winterland: {},
      goobrawl: { event: 'goobrawl', npcs: [{ id: 'transporter', position: [-347,-483] }] }, abtesting: { event: 'abtesting' }, ship0: { event: 'pirateship' } } },
    eventRecoveryRetryAt: 0,
    afterCombat: async action => { calls.push(['afterCombat']); await action(); },
    sleep: async ms => { now += ms; options.onSleep?.(r, ms, calls); },
    anniversaryWithTimeout: async promise => promise,
    stop: async kind => {
      calls.push(['stop', kind]);
      if (kind === 'smart' && pendingRoute) {
        const reject = pendingRoute;
        pendingRoute = null;
        reject(new Error('route stopped'));
      }
    },
    smart_move: destination => {
      calls.push(['route', character.map, now]);
      if (options.route) return options.route(r, destination);
      if (destination.map === 'goobrawl') { Object.assign(character, destination); return Promise.resolve(); }
      return new Promise((resolve, reject) => { pendingRoute = reject; });
    },
    // Walking is a separate convoy service now. These workflow tests retain a
    // controllable route completion port; shared-convoy tests exercise the runner.
    sharedPartyWalk: async (destination,activity,key,parentCommand,current) => {
      calls.push(['shared-walk',activity,key]);
      if(destination.map==='goobrawl')return r.smart_move(destination);
      return r.eventReturnRouteToMain(destination,now+25000,current);
    },
    town: async () => {
      calls.push(['town', character.map]);
      if (options.town) return options.town(r, calls);
      if (character.map === 'main') Object.assign(character, { x: 0, y: 0 });
    },
    leave: async () => {
      calls.push(['leave', character.map]);
      if (options.leave) return options.leave(r);
      Object.assign(character, { map: 'main', x: 0, y: 0 });
    },
    transport: async (map, spawn) => {
      calls.push(['transport', map, spawn]);
      if (options.transport) return options.transport(r, map);
      Object.assign(character, { map, x: 0, y: 0 });
    },
    is_on_cooldown: () => options.cooldown?.(r) || false,
    respawn: async () => { calls.push(['respawn']); character.rip = false; },
    request: async (url, payload) => calls.push(['request', url, payload.body]),
    game_log() {},
  });
  const progressHelper=source.slice(source.indexOf('  function returnPhaseRecord('),source.indexOf('  async function enforcePartyTownOverride('));
  const eventKindHelper=source.slice(source.indexOf('  function halloweenEvent('),source.indexOf('  function halloweenFeedCurrent('));
  const eventCombatHelper=source.slice(source.indexOf('  async function afterEventCombat('),source.indexOf('  function inFarmArea('));
  vm.runInContext(progressHelper + routeHelper + eventKindHelper + eventCombatHelper + '\nasync function run(command) {\n' + handler + '\n}', r);
  return { r, calls, character, pending: () => pendingRoute,
    run: (event = 'franky', cycleId = 'cycle-1') => r.run({ type: 'event-return-town', event, cycleId }) };
}

test('Crab uses Town directly, after combat, without leave or a walking route', async () => {
  const t = runtime('main');
  await t.run('crabxx');
  assert.equal(t.calls[0][0], 'afterCombat');
  assert.deepEqual(t.calls.filter(c => ['town', 'leave', 'route'].includes(c[0])), [['town', 'main']]);
  assert.equal(t.r.eventRecoveryState.phase, 'town-ready');
  assert.equal(t.calls.filter(c => c[0] === 'request' && c[1] === '/event-return-complete').length, 1);
});

for (const [event, map] of [['franky', 'level2w'], ['icegolem', 'winterland']]) {
  test(`${event} stops its pending route on entering Main and then casts Town`, async () => {
    const t = runtime(map, { onSleep(r, ms) {
      if (ms === 100) Object.assign(r.character, { map: 'main', x: 1937, y: -12 });
    } });
    await t.run(event);
    const travel = t.calls.filter(c => ['town', 'route', 'stop', 'leave'].includes(c[0]));
    assert.deepEqual(travel.map(c => c.slice(0, 2)), [
      ['stop', 'smart'], ['stop', 'move'], ['town', map], ['route', map],
      ['stop', 'smart'], ['stop', 'move'], ['town', 'main'],
    ]);
    assert.equal(t.pending(), null);
    assert.equal(t.character.x, 0);
  });
}

for (const event of ['abtesting', 'ship0']) {
  test(`${event} leaves its instance without unnecessary Town or walking`, async () => {
    const t = runtime(event);
    await t.run(event);
    assert.deepEqual(t.calls.filter(c => ['town', 'route', 'leave'].includes(c[0])), [['leave', event]]);
  });

  test(`${event} falls back to direct Main transport if leave fails`, async () => {
    const t = runtime(event, { leave: async () => { throw new Error('instance ended'); } });
    await t.run(event);
    assert.deepEqual(t.calls.find(c => c[0] === 'transport'), ['transport', 'main', 0]);
    assert.equal(t.r.eventRecoveryState.phase, 'town-ready');
  });
}

test('instance exit away from the square uses Town', async () => {
  const t = runtime('abtesting', { leave: async r => { r.character.map = 'main'; } });
  await t.run('goobrawl');
  assert.deepEqual(t.calls.filter(c => c[0] === 'town'), [['town', 'main']]);
});

test('Goobrawl walks to the Transporter before requesting Main and never calls leave', async () => {
  const t=runtime('goobrawl',{transport:async r=>{
    assert.ok(Math.hypot(r.character.x+347,r.character.y+483)<70);
    Object.assign(r.character,{map:'main',x:0,y:0});
  }});
  await t.run('goobrawl');
  assert.deepEqual(t.calls.filter(c=>['route','transport','leave'].includes(c[0])).map(c=>c[0]),['route','transport']);
  assert.deepEqual(t.calls.find(c=>c[0]==='transport'),['transport','main',9]);
  assert.equal(t.r.eventRecoveryState.phase,'town-ready');
});

test('Goobrawl waits for the actual map transition after an early transport acknowledgement', async () => {
  let waits=0;
  const t=runtime('goobrawl',{transport:async()=>({in_progress:true}),onSleep(r){
    if(++waits===5)Object.assign(r.character,{map:'main',x:0,y:0});
  }});
  await t.run('goobrawl');
  assert.equal(waits,5);assert.equal(t.calls.filter(c=>c[0]==='transport').length,1);
  assert.equal(t.calls.filter(c=>c[0]==='request' && c[1]==='/event-return-complete').length,1);
});

test('Goobrawl does not acknowledge recovery if approach or transport never reaches the destination', async () => {
  const far=runtime('goobrawl',{route:async()=>{}});
  await assert.rejects(far.run('goobrawl'),/not in range/);
  assert.equal(far.calls.some(c=>c[0]==='transport'),false);
  const stuck=runtime('goobrawl',{transport:async()=>{throw {reason:'transport_in_progress'};}});
  await assert.rejects(stuck.run('goobrawl'),/did not reach Main/);
  assert.equal(stuck.calls.filter(c=>c[0]==='transport').length,1);
  assert.equal(stuck.calls.some(c=>c[0]==='request'),false);
});

test('Town retries interruptions and waits for cooldown before acknowledging arrival', async () => {
  let attempts = 0, cooldownChecks = 0;
  const t = runtime('main', {
    cooldown: () => ++cooldownChecks === 1,
    town: async r => {
      if (++attempts === 1) throw new Error('damage interrupted Town');
      Object.assign(r.character, { x: 0, y: 0 });
    },
  });
  await t.run('crabxx');
  assert.equal(attempts, 2);
  assert.equal(cooldownChecks, 3);
  assert.equal(t.calls.at(-1)[2].x, 0);
});

test('already near the square acknowledges without Town or routing', async () => {
  const t = runtime('main');
  Object.assign(t.character, { x: 50, y: 20 });
  await t.run('crabxx');
  assert.equal(t.calls.filter(c => ['town', 'route', 'leave'].includes(c[0])).length, 0);
});

test('route timeouts and command retries retain progress and attempt remote Town once per cycle', async () => {
  const t = runtime('level2w');
  await assert.rejects(t.run(), /deadline/);
  assert.equal(t.pending(), null);
  assert.equal(t.r.eventReturnPending, false);
  assert.equal(t.calls.filter(c => c[0] === 'request' && c[1] === '/event-return-complete').length, 0);
  t.character.map = 'level2';
  await assert.rejects(t.run(), /deadline/);
  assert.equal(t.calls.filter(c => c[0] === 'town').length, 1);
  assert.equal(t.pending(), null);
  await assert.rejects(t.run('franky', 'cycle-2'), /deadline/);
  assert.equal(t.calls.filter(c => c[0] === 'town').length, 2);
});

test('route rejection cleans up and retries without repeating remote Town', async () => {
  let routes = 0;
  const t = runtime('winterland', { route: async r => {
    if (++routes === 1) throw new Error('path failed');
    Object.assign(r.character, { map: 'main', x: 0, y: 0 });
  } });
  await t.run('icegolem');
  assert.equal(routes, 2);
  assert.deepEqual(t.calls.filter(c => c[0] === 'town'), [['town', 'winterland']]);
  assert.equal(t.calls.filter(c => c[0] === 'stop' && c[1] === 'move').length, 3);
});

test('Ice Golem recovery deadline retains the underlying shared walking failure', async () => {
  const t=runtime('winterland');
  t.r.sharedPartyWalk=async()=>{throw new Error('Convoy unavailable');};
  await assert.rejects(t.run('icegolem'),/deadline: Convoy unavailable/);
  assert.equal(t.calls.filter(c=>c[0]==='town').length,1);
  assert.equal(t.calls.some(c=>c[0]==='request' && c[1]==='/event-return-complete'),false);
});

test('death during the route stops movement and respawns before continuing', async () => {
  let died = false;
  const t = runtime('level2w', { onSleep(r, ms) {
    if (ms !== 100) return;
    if (!died) { r.character.rip = true; died = true; }
    else r.character.map = 'main';
  } });
  await t.run();
  assert.equal(t.calls.filter(c => c[0] === 'respawn').length, 1);
  assert.equal(t.pending(), null);
});


test('Goobrawl NPC approach does not depend on a collision-blocked convoy rally',async()=>{
 const t=runtime('goobrawl');t.r.sharedPartyWalk=()=>assert.fail('exit must not request shared rendezvous');
 await t.run('goobrawl');assert.equal(t.r.character.map,'main');
});


test('unreachable Goobrawl position uses Town once then walks to the transporter',async()=>{
 const t=runtime('goobrawl');let walks=0,towns=0;
 t.r.smart_move=async destination=>{if(++walks===1)throw Error('Native planner found no route');Object.assign(t.r.character,destination);};
 t.r.town=async()=>{towns++;t.r.character.x=0;t.r.character.y=0;};
 await t.run('goobrawl');assert.equal(t.r.character.map,'main');assert.equal(walks,2);assert.equal(towns,1);
 assert.equal(t.r.root.__partyEventReturnTravel.goobrawlTownAttempted,true);
});

test('Goobrawl cancellation never casts recovery Town',async()=>{
 const t=runtime('goobrawl');let towns=0;t.r.town=async()=>{towns++;};
 t.r.smart_move=async()=>{throw Error('Movement cancelled');};
 await assert.rejects(t.run('goobrawl'),/Movement cancelled/);assert.equal(towns,0);
});
