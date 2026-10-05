// Failure inventory: e2e/passing-index-failures.md. isPassingEncounter is evaluated alone
// (as other harnesses do) against a plain statement of its rule.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { namedFunction } = require('./helpers/named-function.cjs');
const source = fs.readFileSync('characters/shared.js', 'utf8');
const functions = ['passingKey', 'isPassingEncounter'].map((name) => namedFunction(source, name)).join('\n');

function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32); }

function fixture() {
  let now = 1_000_000;
  const c = vm.createContext({
    Date: { now: () => now }, Math, Object, String, Number, JSON, Array, Map, WeakMap, Infinity, NaN, isFinite,
    character: { name: 'W', map: 'main', in: 'main' }, coordinatorClockOffset: 0, realm: 'USII',
    passiveHunting: { rules: {} }, committedHuntEncounter: () => false,
    passingEncounters: {}, peerPassingEncounters: [], fightDeaths: [], groupedCombat: null,
  });
  c.reunionRealm = () => c.realm;
  vm.runInContext(functions, c);
  return { c, set now(v) { now = v; }, get now() { return now; } };
}

/** The rule, written plainly: identities default to the character's realm, map and instance. */
function expected(c, target, now) {
  if (!target || target.dead || target.hp === 0) return false;
  const id = (e) => JSON.stringify([e.server || c.realm, e.map || c.character.map,
    String(e.in == null ? c.character.in || c.character.map : e.in), String(e.id)]);
  const key = id(target), recent = (list) => (list || []).some((e) => id(e) === key && now - e.at < 60000);
  if (recent(c.fightDeaths) || recent(c.groupedCombat && c.groupedCombat.deaths)) return false;
  return recent(c.peerPassingEncounters) || !!(c.passingEncounters[key] && now - c.passingEncounters[key].at < 60000) ||
    recent(c.groupedCombat && c.groupedCombat.passingEncounters);
}

test('matches the rule for random lists, partial identities, duplicates and bad timestamps', () => {
  const f = fixture(), r = rng(7), pick = (a) => a[Math.floor(r() * a.length)];
  const identities = [{ id: 'a' }, { id: 'a', map: 'main' }, { id: 'b', server: 'USII', map: 'main', in: 'main' }, { id: 'b', map: 'cave' },
    { id: 'c', in: 'inst1' }, { id: 7 }, { id: '7', server: 'EUI' }];
  const at = () => pick([f.now, f.now - 10, f.now - 59999, f.now - 60000, f.now - 90000, NaN, undefined, f.now + 5]);
  const list = () => Array.from({ length: Math.floor(r() * 6) }, () => ({ ...pick(identities), at: at() }));
  for (let round = 0; round < 3000; round++) {
    const c = f.c;
    c.character.map = pick(['main', 'cave']); c.character.in = pick(['main', 'cave', 'inst1', undefined]);
    c.realm = pick(['USII', 'EUI']);
    c.fightDeaths = list(); c.peerPassingEncounters = list();
    c.groupedCombat = r() < 0.2 ? null : { deaths: list(), passingEncounters: list() };
    c.passingEncounters = {};
    for (const e of list()) c.passingEncounters[c.passingKey(e)] = e;
    const target = { ...pick(identities), type: 'monster', mtype: 'goo', hp: pick([100, 0]), dead: r() < 0.1 };
    assert.equal(c.isPassingEncounter(target), expected(c, target, f.now), `round ${round}`);
  }
});

test('a list appended in place, a replaced coordinator response and a map change are seen at once', () => {
  const f = fixture(), c = f.c, target = { id: 'g1', type: 'monster', mtype: 'goo', hp: 100 };
  c.peerPassingEncounters = [{ id: 'g1', at: f.now }];
  c.groupedCombat = { deaths: [], passingEncounters: [] };
  assert.equal(c.isPassingEncounter(target), true);
  c.fightDeaths.push({ id: 'g1', at: f.now }); // a fresh death, same array
  assert.equal(c.isPassingEncounter(target), false, 'appended death');
  c.fightDeaths = [];
  assert.equal(c.isPassingEncounter(target), true);
  c.groupedCombat = { deaths: [{ id: 'g1', map: 'main', at: f.now }], passingEncounters: [] }; // next response
  assert.equal(c.isPassingEncounter(target), false, 'replaced coordinator deaths');
  // A death without a map takes the character's map; a target naming Mainland only matches it there.
  const onMain = { id: 'g1', map: 'main', in: 'main', type: 'monster', mtype: 'goo', hp: 100 };
  c.peerPassingEncounters = [{ id: 'g1', map: 'main', in: 'main', at: f.now }];
  c.groupedCombat = { deaths: [{ id: 'g1', at: f.now }], passingEncounters: [] };
  assert.equal(c.isPassingEncounter(onMain), false, 'the death defaults to Mainland');
  c.character.map = 'cave'; c.character.in = 'cave';
  assert.equal(c.isPassingEncounter(onMain), true, 'after moving, the same death defaults to the cave');
  f.now += 60000;
  assert.equal(c.isPassingEncounter(onMain), false, 'a 60 s old peer encounter has expired');
});

test('lookups stop scanning the lists once they are indexed', () => {
  const f = fixture(), c = f.c;
  c.groupedCombat = { deaths: Array.from({ length: 512 }, (_, i) => ({ id: 'd' + i, at: f.now })),
    passingEncounters: Array.from({ length: 128 }, (_, i) => ({ id: 'e' + i, at: f.now })) };
  c.peerPassingEncounters = Array.from({ length: 128 }, (_, i) => ({ id: 'p' + i, at: f.now }));
  c.fightDeaths = Array.from({ length: 64 }, (_, i) => ({ id: 'f' + i, at: f.now }));
  let calls = 0;
  const key = c.passingKey;
  c.passingKey = (t) => { calls++; return key(t); };
  const target = { id: 'e5', type: 'monster', mtype: 'goo', hp: 100 };
  assert.equal(c.isPassingEncounter(target), true);
  calls = 0;
  for (let i = 0; i < 1000; i++) c.isPassingEncounter(target);
  assert.ok(calls <= 1000, `1000 lookups made ${calls} identity builds over 832 indexed entries`);
});
