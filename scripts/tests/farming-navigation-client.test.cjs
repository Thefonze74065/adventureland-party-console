const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');

function fixture() {
  const stops = [], handled = [];
  const r = vm.createContext({ travelCombatActive:()=>false, escapeOwns: () => false, root: { __anniversaryReturnLocation: { map: 'cave' } },
    navigationIntent: { revision: 0, cancelled: false }, farmingTravelToken: null, reunion: null,
    wakeGatheringAfterStatus: () => {},
    anniversaryReturnLocation: { map: 'cave' }, anniversaryStagingReported: 'old', anniversaryReturnReported: 'old',
    convoyTraveling: null, followingLeader: false, forceTraveling: false,
    character: { name: 'F', ctype: 'priest' }, lastCommand: 0,
    stop: async kind => stops.push(kind),
    handleCommand: async command => { handled.push(command.id); },
  });
  vm.runInContext(source.slice(source.indexOf('  async function applyNavigationIntent('),
    source.indexOf('  async function handleCommand(')), r);
  return { r, stops, handled };
}

test('new cancellation stops owned farming movement and clears the cached anniversary origin', async () => {
  const t = fixture();
  const token = t.r.farmingTravelToken = { revision: 0, cancelled: false };
  await t.r.applyNavigationIntent({ revision: 1, cancelled: true });
  assert.equal(token.cancelled, true);
  assert.deepEqual(t.stops, ['smart', 'move']);
  assert.equal(t.r.root.__anniversaryReturnLocation, null);
  assert.equal(t.r.anniversaryStagingReported, null);
});

test('cancellation leaves non-farming event exits and merchant movement alone', async () => {
  const t = fixture();
  await t.r.applyNavigationIntent({ revision: 1, cancelled: true });
  assert.deepEqual(t.stops, []);
  await t.r.handle({ id: 1, type: 'event-return-town' });
  t.r.character.ctype = 'merchant';
  await t.r.handle({ id: 2, type: 'merchant-self-improve' });
  assert.deepEqual(t.handled, [1, 2]);
});

test('stale commands cannot execute after cancellation or a new explicit waypoint', async () => {
  const t = fixture();
  const old = { id: 1, type: 'event-resume-travel', navigationRevision: 0 };
  await t.r.applyNavigationIntent({ revision: 1, cancelled: true });
  await t.r.handle(old);
  await t.r.applyNavigationIntent({ revision: 2, cancelled: false });
  await t.r.handle(old);
  await t.r.handle({ id: 2, type: 'party-monster-travel', navigationRevision: 2 });
  assert.deepEqual(t.handled, [2]);
});

test('manual individual Town may move despite cancelling its farming waypoint', async () => {
  const t = fixture();
  await t.r.applyNavigationIntent({ revision: 1, cancelled: true });
  await t.r.handle({ id: 1, type: 'character-travel', navigationRevision: 1, navigationExempt: true });
  assert.deepEqual(t.handled, [1]);
});

test('cancellation while finishing combat cannot start a delayed farming route', async () => {
  const t = fixture();
  let routes = 0;
  t.r.game_log = () => {};
  t.r.engagedMonster = () => ({ id: 'bat' });
  t.r.setTimeout = callback => {
    t.r.farmingTravelToken.cancelled = true;
    t.r.engagedMonster = () => null;
    callback();
  };
  t.r.farmingTravelToken = { revision: 0, cancelled: false };
  vm.runInContext(source.slice(source.indexOf('  async function afterCombat('),
    source.indexOf('  function visibleFocusedMonsterWithinRadius(')), t.r);
  await t.r.afterCombat(async () => { routes++; }, 'farming');
  assert.equal(routes, 0);
});

test('a cancelled follower does not immediately resume ordinary leader-following', () => {
  const t = fixture();
  const start = source.indexOf('    shouldFollowLeader: function () {');
  const end = source.indexOf('    isLeader:', start);
  const method = source.slice(start, end).trim().replace(/^shouldFollowLeader: /, 'var shouldFollow = ').replace(/,$/, ';');
  Object.assign(t.r, { followLeader: true, leader: 'L', activeCombatEvent: () => null, isLiveAbtesting: () => false });
  vm.runInContext(method, t.r);
  t.r.navigationIntent.cancelled = true;
  assert.equal(t.r.shouldFollow(), false);
  t.r.navigationIntent.cancelled = false;
  assert.equal(t.r.shouldFollow(), true);
});
