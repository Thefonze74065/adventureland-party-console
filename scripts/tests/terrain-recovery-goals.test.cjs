// Retained isolated exception (failure inventory: e2e/terrain-goals-hitbox-failures.md).
// The live harness cannot hold a Phoenix away from the party with an outside player,
// so the real terrain recovery goal search runs here against the game's own distance().
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {namedFunction} = require('./helpers/named-function.cjs');
const {installGameGeometry} = require('./helpers/game-geometry.cjs');

const shared = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const functions = ['terrainRecoveryGoals', 'terrainRecoverySafe', 'formationMonsterSafety', 'formationBody', 'formationDistance'];

function nativeDistance(context) {
  if (installGameGeometry(context)) return;
  // The pinned game files are not installed: use the native functions from the ChronAL install.
  const common = path.join(__dirname, '../../.build/sim/chronal/runtime/app/js/old_common_functions.js');
  assert.ok(fs.existsSync(common), 'Needs pinned game files (scripts/ci/restore-game-fixtures.cjs) or the ChronAL setup');
  const text = fs.readFileSync(common, 'utf8');
  Object.assign(context, {min: Math.min, max: Math.max, EPS: 1e-8, REPS: Number.EPSILON, Place: 'client', m_line_x: false, m_line_y: false});
  const named = name => { const start = text.indexOf('function ' + name + '('); return text.slice(start, text.indexOf('\n}', start) + 2); };
  for (const name of ['get_x', 'get_y', 'get_width', 'get_height', 'get_monster_dimensions', 'get_combat_dimensions', 'distance'])
    if (text.includes('function ' + name + '(')) vm.runInContext(named(name), context);
}

function scene({warrior, monster, others = []}) {
  const entities = Object.fromEntries([monster, ...others].map(entity => [entity.id, entity]));
  const context = vm.createContext({
    Math, Object, character: warrior, parent: {entities}, G: {monsters: {phoenix: {range: 120}, goo: {range: 10}, bee: {range: 30}}, dimensions: {phoenix: [61, 55], goo: [12, 12], bee: [20, 20]}, geometry: {}},
    formationState: {targetId: monster.id}, groupedCombat: {target: {id: monster.id}},
    can_move: () => true,
  });
  nativeDistance(context);
  vm.runInContext(functions.map(name => namedFunction(shared, name)).join('\n'), context);
  return context;
}
const warrior = {name: 'W', ctype: 'warrior', map: 'main', in: 'main', x: 349, y: 1532, range: 36, width: 26, height: 36};
const phoenix = {id: 'p', type: 'monster', mtype: 'phoenix', map: 'main', in: 'main', visible: true, hp: 100, x: 738, y: 1702, width: 61, height: 55, target: 'Outsider'};

test('a melee fighter gets reachable goals around a large target (live: goals [] against Phoenix)', () => {
  const context = scene({warrior, monster: phoenix});
  const goals = context.terrainRecoveryGoals(phoenix, 34);
  assert.ok(goals.length >= 8, `expected goals around the Phoenix, got ${goals.length}`);
  for (const goal of goals) {
    const clearance = context.formationDistance(context.formationBody(warrior, goal), context.formationBody(phoenix));
    assert.ok(clearance > context.formationMonsterSafety(phoenix), 'every goal clears the target');
    assert.ok(clearance <= 34 + 1, 'every goal sits at the reach, so formation can finish the approach');
  }
});

test('goals still avoid other monsters and keep their safety radius', () => {
  const bee = {id: 'b', type: 'monster', mtype: 'bee', map: 'main', in: 'main', visible: true, hp: 10, x: 738 - 75, y: 1702, width: 20, height: 20};
  const context = scene({warrior, monster: phoenix, others: [bee]});
  const goals = context.terrainRecoveryGoals(phoenix, 34);
  assert.ok(goals.length > 0);
  for (const goal of goals) {
    const clearance = context.formationDistance(context.formationBody(warrior, goal), context.formationBody(bee));
    assert.ok(clearance > context.formationMonsterSafety(bee), 'no goal inside the bee\'s safety radius');
  }
});

test('small targets keep goals close to their old radius', () => {
  const goo = {id: 'g', type: 'monster', mtype: 'goo', map: 'main', in: 'main', visible: true, hp: 10, x: 0, y: 0, width: 12, height: 12};
  const mover = {...warrior, x: -200, y: 0};
  const context = scene({warrior: mover, monster: goo});
  const goals = context.terrainRecoveryGoals(goo, 34);
  assert.ok(goals.length >= 8);
  for (const goal of goals) {
    const clearance = context.formationDistance(context.formationBody(mover, goal), context.formationBody(goo));
    assert.ok(clearance > context.formationMonsterSafety(goo) && clearance <= 34 + 1, 'edge distance stays at the reach');
  }
});

test('a ranged mover keeps goals within its attack range of a large target', () => {
  const mage = {...warrior, name: 'M', ctype: 'mage', range: 201};
  const context = scene({warrior: mage, monster: phoenix});
  const goals = context.terrainRecoveryGoals(phoenix, 191);
  assert.ok(goals.length >= 8);
  for (const goal of goals)
    assert.ok(context.formationDistance(context.formationBody(mage, goal), context.formationBody(phoenix)) <= 201, 'goal within attack range');
});
