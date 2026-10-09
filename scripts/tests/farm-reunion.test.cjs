const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
function runtime() {
  let now = 100000;
  const calls = [];
  const r = vm.createContext({ root: {}, dungeonOwned: () => false, escapeOwns: () => false, reunion: null, reunionWorking: false, reunionMageOffer: null,
    previousReunionCm: null, previousMagiport: null, Date: { now: () => now }, coordinatorClockOffset: 0,
    character: { name: 'R', ctype: 'warrior', map: 'main', x: 0, y: 0, mp: 2000, max_mp: 3000, c: {} },
    parent: { server_region: 'US', server_identifier: 'II' },
    G: { maps: { main: {}, winterland: {}, bank: {}, arena: { event: 'test' } }, skills: { blink: { mp: 1600 }, magiport: { mp: 900 } } },
    partyLocation: { map: 'winterland', x: 20, y: -1109 }, desiredPartyMembers: ['R', 'M'], leader: 'M',
    farmingTravelToken: null, farmingMode:'default', farmingEntryPoint: location=>location,
    partyPositions: [{ name: 'M', ctype: 'mage', map: 'winterland', x: 20, y: -1109,
      server: 'USII', seenAt: now, hp: 100 }], navigationIntent: { revision: 1 },
    runtimeCurrent: () => true, activeCombatEvent: () => null, engagedMonster: () => null, combatRecoveryActive: () => false,
    is_transporting: () => false, is_on_cooldown: () => false, can_use: () => true, can_move_to: () => true,
    banking: false, bankQueued: false, stocking: false, upgrading: false, forceTraveling: false,
    townTraveling: false, partyTownActive: false, partyConvoyActive: false, convoyTraveling: null,
    anniversaryBusy: false, anniversaryStaging: false, eventTraveling: false,
    kiteState: {}, eventRecoveryState: {}, stop: async () => calls.push('stop'), game_log() {},
    send_cm: async (name, data) => calls.push({ name, data }),
    use_skill: async (skill, target) => calls.push({ skill, target }),
    accept_magiport: async name => calls.push({ accepted: name }),
    sleep: async ms => { now += ms; }, anniversaryWithTimeout: async promise => promise,
    smart_move: async destination => { calls.push({ destination }); r.character.map = destination.map; },
    sharedPartyWalk: async destination => { calls.push({ destination, shared:true }); r.character.map = destination.map; },
    request: async () => {},
  });
  vm.runInContext(source.slice(source.indexOf('  function reunionRealm()'), source.indexOf('  async function rejoinActiveEventAfterRespawn()')), r);
  return { r, calls, advance: ms => { now += ms; } };
}
test('Magiport permits 10% remaining; Blink requires 30%', () => {
  const { r } = runtime();
  r.character.mp = 1200;
  assert.equal(r.reunionManaAllowed('magiport', .1), true);
  r.character.mp--;
  assert.equal(r.reunionManaAllowed('magiport', .1), false);
  r.character.mp = 2500;
  assert.equal(r.reunionManaAllowed('blink', .3), true);
  r.character.mp--;
  assert.equal(r.reunionManaAllowed('blink', .3), false);
});

test('late convoy member hands off within waypoint hunt radius without walking to waypoint', async () => {
  const { r, calls } = runtime();
  const target = { id: 'm' };
  r.farmingTravelTarget = () => target;
  r.character.map = 'winterland'; r.character.x = 300;
  r.beginFarmReunion({ id: 5, convoyHandoff: 'c', location: r.partyLocation });
  r.reunion.moving = true; r.reunionWorking = true;
  await r.farmReunionTick();
  assert.equal(r.reunion, null); assert.equal(r.combatTargetId, 'm');
  assert.equal(calls.some(call => call.destination), false);
});
test('one fresh survivor qualifies, wrong realms and stale status do not', () => {
  const { r, advance } = runtime();
  assert.equal(r.reunionMembers().length, 1);
  r.partyPositions[0].server = 'USIII';
  assert.equal(r.reunionMembers().length, 0);
  r.partyPositions[0].server = 'USII'; advance(10001);
  assert.equal(r.reunionMembers().length, 0);
});
test('recipient arms before accepting only its authorized mage', async () => {
  const { r, calls } = runtime();
  r.beginFarmReunion(); await r.farmReunionTick();
  assert.equal(r.reunion.phase, 'requesting-magiport');
  r.root.on_magiport('M'); await Promise.resolve();
  assert.equal(calls.some(call => call.accepted), false);
  await r.reunionCm('M', { type: 'farm-reunion', action: 'offer', id: r.reunion.id, realm: 'USII' });
  assert.equal(r.reunion.phase, 'accepting-magiport');
  r.root.on_magiport('stranger'); r.root.on_magiport('M');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.accepted).length, 1);
});
test('expired Magiport falls back to cross-map travel, without requesting again', async () => {
  const { r, calls, advance } = runtime();
  r.beginFarmReunion(); await r.farmReunionTick(); advance(10001);
  r.partyPositions[0].seenAt += 10001;
  await r.farmReunionTick();
  assert.equal(calls.filter(call => call.data?.action === 'request').length, 1);
  assert.equal(calls.some(call => call.destination?.map === 'winterland'), true);
});
test('manual navigation change cancels pending recovery and rejects late invitations', async () => {
  const { r, calls } = runtime();
  r.beginFarmReunion(); await r.farmReunionTick(); r.navigationIntent.revision++;
  await r.farmReunionTick(); r.root.on_magiport('M');
  assert.equal(r.reunion, null);
  assert.equal(calls.some(call => call.accepted), false);
});
test('convoy or anniversary ownership prevents reunion travel', async () => {
  const { r, calls } = runtime();
  r.beginFarmReunion(); r.partyConvoyActive = true; await r.farmReunionTick();
  assert.equal(calls.some(call => call.destination || call.data), false);
  assert.equal(r.reunion.phase, 'waiting-for-movement-owner');
});
test('mage never Blinks across maps and walks when mana is insufficient', async () => {
  const { r, calls } = runtime();
  r.character.ctype = 'mage'; r.character.mp = 0; r.partyPositions[0].ctype = 'warrior';
  r.beginFarmReunion(); await r.farmReunionTick(); await r.farmReunionTick();
  assert.equal(calls.some(call => call.skill === 'blink'), false);
  assert.equal(calls.filter(call => call.destination).length, 2);
});

test('mage casts once only after ready and rechecks its own navigation revision', async () => {
  const { r, calls } = runtime();
  Object.assign(r.character, { ctype: 'mage', map: 'winterland', x: 20, y: -1109 });
  Object.assign(r.partyPositions[0], { ctype: 'warrior', map: 'main', x: 0, y: 0 });
  const message = { type: 'farm-reunion', action: 'request', id: 'recovery', realm: 'USII', revision: 1 };
  await r.reunionCm('M', message);
  assert.equal(calls.some(call => call.skill), false);
  await r.reunionCm('M', { ...message, action: 'ready' });
  await r.reunionCm('M', { ...message, action: 'ready' });
  assert.equal(calls.filter(call => call.skill === 'magiport').length, 1);
  r.reunionMageOffer.cast = false; r.navigationIntent.revision++;
  await r.reunionCm('M', { ...message, action: 'ready' });
  assert.equal(calls.filter(call => call.skill === 'magiport').length, 1);
});

test('failed travel is cancelled and has a ten-second retry delay', async () => {
  const { r, calls } = runtime();
  r.partyPositions[0].ctype = 'warrior';
  r.smart_move = async () => { throw Error('route failed'); };
  r.beginFarmReunion(); await r.farmReunionTick();
  assert.equal(r.reunion.retryAt, 110000);
  assert.equal(r.reunion.lastError, 'route failed');
  assert.equal(calls.at(-1), 'stop');
});


test('a nearby party member around a corner still requires navigation', async () => {
  const { r, calls } = runtime();
  r.character.map = 'winterland'; r.character.x = 20; r.character.y = -1100;
  r.can_move_to = () => false;
  r.beginFarmReunion();
  await r.farmReunionTick();
  assert.ok(r.reunion);
  assert.ok(calls.some(call => call.destination));
});

for (const outcome of ['success', 'failure', 'manual move', 'cleared focus', 'new command', 'convoy continuation']) {
  test('handoff recovery: ' + outcome, async () => {
    const { r } = runtime();
    r.lastCommand = 10;
    r.afterCombat = async action => action();
    vm.runInContext(source.slice(source.indexOf('  async function withMerchantHandoffRecovery('), source.indexOf('  async function merchantHandoff(')), r);
    const command = { id: 10, convoyContinuation: outcome === 'convoy continuation' ? {convoyId:'return'} : null };
    const action = async () => {
      // These retained recovery scenarios model a handoff that approached the merchant.
      command.__handoffApproached = true;
      if (outcome === 'manual move') r.navigationIntent.revision++;
      if (outcome === 'cleared focus') r.partyLocation = null;
      if (outcome === 'new command') r.lastCommand++;
      if (outcome === 'failure') throw Error('GoldMajesty did not become reachable');
    };
    const promise = r.withMerchantHandoffRecovery(command, action);
    if (outcome === 'failure') await assert.rejects(promise, /reachable/); else await promise;
    assert.equal(!!r.reunion, outcome === 'success' || outcome === 'failure');
  });
}

test('mage Blinks toward direct underground entrance before crossing maps', async () => {
 const {r,calls}=runtime();r.partyPositions[0].ctype='warrior';r.character.ctype='mage';r.character.mp=3000;r.character.max_mp=3000;
 r.G.maps.main.doors=[[1000,0,40,40,'winterland',0,0]];
 r.can_move=()=>true;r.beginFarmReunion();await r.farmReunionTick();
 const blink=calls.find(c=>c.skill==='blink'),travel=calls.find(c=>c.destination);
 assert.ok(blink);assert.ok(Math.abs(blink.target[0]-1000)<=40);assert.equal(travel.destination.map,'winterland');
});
test('same-map Blink checks the landing tile rather than requiring a straight walking path', async () => {
 const {r,calls}=runtime();r.partyPositions[0].ctype='warrior';r.character.ctype='mage';r.character.map='winterland';r.character.mp=3000;r.character.max_mp=3000;
 r.can_move_to=()=>false;r.can_move=()=>true;r.beginFarmReunion();await r.farmReunionTick();
 assert.ok(calls.some(c=>c.skill==='blink'));
});


test('full-party wipe uses saved waypoint when there is no survivor near farm',async()=>{
 const {r,calls}=runtime();r.partyPositions=[];r.beginFarmReunion();await r.farmReunionTick();
 assert.ok(calls.some(c=>c.destination?.map==='winterland'));assert.notEqual(r.reunion.phase,'waiting-for-party-near-farm');
});
test('already-respawned runtime automatically recovers authorized displacement',async()=>{
 const {r,calls}=runtime();r.partyPositions=[];assert.equal(r.reunion,null);await r.farmReunionTick();
 assert.ok(r.reunion);assert.ok(calls.some(c=>c.destination?.map==='winterland'));
});
for(const owner of ['cancelled','town','event','convoy'])test(owner+' prevents automatic respawn travel',async()=>{
 const {r,calls}=runtime();r.partyPositions=[];
 if(owner==='cancelled')r.navigationIntent.cancelled=true;if(owner==='town')r.partyTownActive=true;
 if(owner==='event')r.eventTraveling=true;if(owner==='convoy')r.partyConvoyActive=true;
 await r.farmReunionTick();assert.equal(r.reunion,null);assert.equal(calls.length,0);
});


test('attacked reunion yields travel ownership so defensive combat and healing can run',async()=>{
 const {r,calls}=runtime();r.beginFarmReunion();r.reunion.moving=true;
 r.parent.entities={boar:{id:'boar',type:'monster',visible:true,target:'R'}};
 await r.farmReunionTick();assert.equal(r.reunionBlocked(),true);
 assert.equal(r.reunion.phase,'waiting-for-movement-owner');assert.equal(r.reunion.moving,false);
 assert.ok(calls.includes('stop'));r.parent.entities={};assert.equal(r.reunionBlocked(),false);
 await r.farmReunionTick();assert.notEqual(r.reunion.phase,'waiting-for-movement-owner');
});

test('reaching the live teammate releases reunion before an old smart route finishes',async()=>{
 const {r,calls}=runtime();r.beginFarmReunion();r.character.map='winterland';r.character.x=20;r.character.y=-1100;
 r.reunion.moving=true;r.reunionWorking=true;r.reunion.destination={map:'winterland',x:1000,y:1000};
 await r.farmReunionTick();assert.equal(r.reunion,null);assert.ok(calls.includes('stop'));assert.equal(calls.some(c=>c.destination),false);
});
test('arrival can complete during retry delay instead of suppressing combat for ten seconds',async()=>{
 const {r,calls}=runtime();r.beginFarmReunion();r.character.map='winterland';r.character.x=20;r.character.y=-1100;
 r.reunion.retryAt=999999;r.reunion.phase='retry-wait';await r.farmReunionTick();assert.equal(r.reunion,null);assert.equal(calls.some(c=>c.destination),false);
});

test('early Hunt handoff rejoins the current leader without returning to the obsolete encounter point',async()=>{
 const {r,calls}=runtime();r.character.map='winterland';r.character.x=20;r.character.y=-1100;
 r.farmingTravelTarget=()=>null;let acknowledged=0;r.request=async()=>{acknowledged++;};
 r.beginFarmReunion({id:12,convoyHandoff:'old',location:{map:'winterland',x:900,y:900}});
 r.reunion.moving=true;r.reunionWorking=true;
 await r.farmReunionTick();assert.equal(r.reunion,null);assert.equal(acknowledged,1);assert.equal(calls.some(c=>c.destination),false);
});


test('ended Goobrawl exit owns movement despite a restored remote farming waypoint',async()=>{
 const {r,calls}=runtime();r.character.map='goobrawl';r.eventReturnPending=true;
 r.beginFarmReunion();await r.farmReunionTick();
 assert.equal(r.reunion,null);assert.equal(r.reunionBlocked(),true);assert.equal(calls.length,0);
 // A stale in-flight farming continuation cannot stop the transporter approach.
 const old={revision:1,moving:true,phase:'walking'};r.reunion=old;
 r.root.__partySharedWalking={activity:'event-return',key:'return-cycle'};
 await r.farmReunionTick();assert.equal(old.cancelled,true);assert.equal(r.reunion,null);assert.equal(calls.length,0);
 assert.equal(r.root.__partySharedWalking.activity,'event-return');
 // The shared exit retains ownership even between command retries.
 r.eventReturnPending=false;r.beginFarmReunion();await r.farmReunionTick();assert.equal(calls.length,0);
 // Verified exit and released event walk permit the existing checkpoint recovery.
 r.root.__partySharedWalking=null;r.character.map='main';
 r.beginFarmReunion();assert.ok(r.reunion);assert.equal(r.reunionBlocked(),false);
});
