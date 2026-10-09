const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = require('node:fs').readFileSync('characters/shared.js', 'utf8');

test('event release clears exactly its held movement and wakes acquisition', async () => {
  const start = source.indexOf('  async function handleCommand(command)');
  const end = source.indexOf("    if(command.type==='party-monster-travel' && command.phase==='defending')", start);
  for (const kind of ['matching', 'different', 'cancelled', 'revision']) {
    let wakes = 0, released = 0, stops = 0;
    const c = vm.createContext({ lastCommand: 1, navigationIntent: { revision: kind === 'revision' ? 3 : 2, cancelled: kind === 'cancelled' },
      convoyTraveling: { id: kind === 'different' ? 'new' : 'failed', epoch: 4, release() { released++; } },
      releaseConvoyCruise() {}, stop: async () => stops++, partyRoleRunner: { wake() { wakes++; } }, Date });
    c.root = c;
    vm.runInContext(source.slice(start, end) + '\n}', c);
    await c.handleCommand({ id: 2, type: 'party-monster-travel', phase: 'event-walk-release', convoyId: 'failed', epoch: 4, navigationRevision: 2, reason: 'runtime-lost' });
    if (kind === 'matching') {
      assert.equal(c.convoyTraveling, null); assert.equal(released, 1); assert.equal(stops, 1); assert.equal(wakes, 1);
      assert.equal(c.__partyEventWalkFailure.reason, 'runtime-lost');
    } else { assert.ok(c.convoyTraveling); assert.equal(released, 0); assert.equal(stops, 0); assert.equal(wakes, 0); }
  }
});

function reentry(overrides = {}) {
  const c = vm.createContext({ escapeOwns: () => false, navigationIntent: { revision: 2, cancelled: false },
    eventsEnabled: true, character: { ctype: 'priest', map: 'main' }, activeCombatEvent: () => ({ name: 'franky', types: ['franky'], state: {} }),
    eventSelectionRevision: 1, runtimeCurrent: () => true, eventSelected: () => true, eventTravelAllowed: async () => true,
    eventTraveling: false, eventTargetTypes: [], eventMissingSince: 0, travellingEventName: null, joinedEvent: 'franky',
    __partyEventRejoinRequired: 'franky', stop: async () => {}, eventDestination: () => ({ map: 'level2w', x: 0, y: 0 }),
    eventRequiresJoin: () => true, join: async () => { c.character.map = 'level2w'; }, nearestEventTarget: () => ({ id: 'boss' }),
    is_in_range: () => true, sharedPartyWalk: async () => {}, game_log() {}, ...overrides });
  c.root = c;
  vm.runInContext(source.slice(source.indexOf('  function eventCombatReachable('), source.indexOf('  function eventCombatSighting(')), c);
  vm.runInContext(source.slice(source.indexOf('  async function joinCombatEvent('), source.indexOf('  async function pollEvents(')), c);
  const start = source.indexOf('  async function rejoinActiveEventAfterRespawn()');
  vm.runInContext(source.slice(start, source.indexOf('  async function regenerateHpOrMp()', start)), c);
  return c;
}
test('join failure retries, while successful teleport needs neither boss visibility nor convoy', async () => {
  const joinFailure = reentry({ join: async () => { throw { reason: 'openning' }; } });
  const failed = await joinFailure.rejoinActiveEventAfterRespawn();
  assert.equal(failed.status, 'retryable'); assert.equal(failed.phase, 'event-reentry'); assert.equal(failed.reason, 'openning');
  assert.equal(joinFailure.eventTraveling, false);
  const c = reentry({ nearestEventTarget: () => null, sharedPartyWalk: async () => assert.fail('no event convoy') });
  let joins = 0; c.join = async () => { joins++; c.character.map = 'level2w'; };
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'recovered');
  assert.equal(c.__partyEventRejoinRequired, null);
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'recovered'); assert.equal(joins, 1);
});

test('stale joined marker without a death flag still rejoins from Main', async () => {
  const c = reentry({ __partyEventRejoinRequired: null, nearestEventTarget: () => null,
    sharedPartyWalk: async () => assert.fail('Convoy unavailable') });
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'recovered');
  assert.equal(c.character.map, 'level2w');
});

test('delayed map arrival holds reentry and excludes concurrent joins', async () => {
  const c = reentry(); let release, joins = 0;
  c.join = async () => { joins++; };
  c.sleep = () => new Promise(resolve => { release = resolve; });
  const pending = c.rejoinActiveEventAfterRespawn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.__partyEventRejoinRequired, 'franky');
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'retryable');
  c.character.map = 'level2w'; release();
  assert.equal((await pending).status, 'recovered'); assert.equal(joins, 1);
});

test('unchanged map cannot complete reentry and retries teleport without convoy', async () => {
  const c = reentry(); let now = 0, joins = 0;
  c.Date = { now: () => now }; c.sleep = async ms => { now += ms; };
  c.join = async () => { joins++; };
  const failed = await c.rejoinActiveEventAfterRespawn();
  assert.equal(failed.status, 'retryable'); assert.match(failed.reason, /no observed arrival/);
  assert.equal(c.__partyEventRejoinRequired, 'franky');
  c.join = async () => { joins++; c.character.map = 'level2w'; };
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'recovered'); assert.equal(joins, 2);
});

for (const change of ['ended', 'deselected', 'dead', 'revision']) test('pending join cancels on ' + change, async () => {
  const c = reentry();
  c.join = async () => {};
  c.sleep = async () => {
    if (change === 'ended') c.activeCombatEvent = () => null;
    if (change === 'deselected') c.eventSelected = () => false;
    if (change === 'dead') c.character.rip = true;
    if (change === 'revision') c.navigationIntent.revision++;
  };
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'cancelled');
  assert.equal(c.__partyEventRejoinRequired, 'franky'); assert.equal(c.eventTraveling, false);
});

test('non-joinable event recovery still walks', async () => {
  let walks = 0;
  const c = reentry({ eventRequiresJoin: () => false, nearestEventTarget: () => null,
    join: async () => assert.fail('no join'), sharedPartyWalk: async () => { walks++; } });
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'recovered'); assert.equal(walks, 1);
});

test('cancellation during join releases event ownership without continuing its walk', async () => {
  const c = reentry({ sharedPartyWalk: async () => assert.fail('cancelled walk') });
  c.join = async () => { c.navigationIntent.revision++; };
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'cancelled');
  assert.equal(c.eventTraveling, false); assert.equal(c.travellingEventName, null);
});


test('restart preserves the original failed event-walk diagnosis',()=>{
 const {initialCommandState}=require('../../runtime/coordinator/navigation/initial-commands.ts');
 const state=initialCommandState({activeConvoy:{id:'failed',purpose:'shared-walk',label:'event walking leg',phase:'failed',
 failure:'Convoy runtime-lost',failureCode:'runtime-lost',failedAt:123,expected:{A:{revision:2}}}},()=>999);
 assert.equal(state.activeConvoy.failure,'Convoy runtime-lost');assert.equal(state.activeConvoy.failedAt,123);
 assert.equal(state.activeConvoy.restartRevisions.A,2);
});

test('released failed event convoy no longer owns combat, including after restart', () => {
 const {travelCombatFor}=require('../../runtime/coordinator/navigation/travel-defense.ts');
 const state={activeConvoy:{id:'failed',phase:'failed',purpose:'shared-walk',participants:['QwenTina']},
  commands:{QwenTina:{type:'party-monster-travel',phase:'event-walk-release',convoyId:'failed',navigationRevision:7}},
  navigationIntents:{QwenTina:{revision:7}},statuses:{QwenTina:{joinedEvent:'franky'}}};
 assert.equal(travelCombatFor(state,'QwenTina'),null);
 assert.equal(travelCombatFor(JSON.parse(JSON.stringify(state)),'QwenTina'),null);
 for(const change of [{phase:'hold'},{convoyId:'other'},{navigationRevision:6}]) {
  const newer=JSON.parse(JSON.stringify(state));Object.assign(newer.commands.QwenTina,change);
  assert.equal(travelCombatFor(newer,'QwenTina').id,'failed');
 }
});
