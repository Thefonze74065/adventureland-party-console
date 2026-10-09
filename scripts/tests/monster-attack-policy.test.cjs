const test = require('node:test');
const assert = require('node:assert/strict');
const { monsterAttackBlock: block, effectiveAttackDamageType } = require('../../runtime/characters/roles/monster-attack-policy.ts');

// Before implementation: actual native Slender RED proved the serialized
// physical warrior lacks damage_type. Resolve current equipment accurately,
// preserve native overrides, and keep unknown/reflected magic fail-closed.
const damageData = { items: { blade: {damage_type:'physical'}, staff: {damage_type:'magical'}, pure: {damage_type:'pure'} },
  classes: { warrior: {damage_type:'physical'}, priest: {damage_type:'magical'} } };
test('missing native attack type resolves the currently equipped weapon before its class', () => {
  assert.equal(effectiveAttackDamageType({ctype:'warrior',slots:{mainhand:{name:'blade'}}},damageData),'physical');
  assert.equal(effectiveAttackDamageType({ctype:'warrior',slots:{mainhand:{name:'staff'}}},damageData),'magical');
  assert.equal(effectiveAttackDamageType({ctype:'priest',slots:{mainhand:{name:'blade'}}},damageData),'physical');
});
test('known native attack overrides remain authoritative over weapon and class defaults', () => {
  for(const type of ['physical','magical','pure'])
    assert.equal(effectiveAttackDamageType({ctype:'warrior',damage_type:type,slots:{mainhand:{name:'staff'}}},damageData),type);
});
test('class defaults handle unarmed clients while unresolved reflection remains blocked', () => {
  assert.equal(effectiveAttackDamageType({ctype:'warrior',slots:{}},damageData),'physical');
  assert.equal(effectiveAttackDamageType({ctype:'priest',slots:{}},damageData),'magical');
  const unknown=effectiveAttackDamageType({ctype:'unknown',slots:{}},damageData);
  assert.equal(unknown,undefined);
  assert.ok(block('slenderman',unknown,200));
  assert.ok(block('slenderman',effectiveAttackDamageType({ctype:'warrior',slots:{mainhand:{name:'staff'}}},damageData),200));
});

test('Porcupine physical attacks require a finite range stat of at least 75', () => {
  for (const range of [0, 30, 74.99, NaN, Infinity]) assert.ok(block('porcupine', 'physical', range));
  for (const range of [75, 120, 300]) assert.equal(block('porcupine', 'physical', range), null);
  assert.equal(block('porcupine', 'magical', 30), null);
  assert.equal(block('porcupine', 'pure', 30), null);
});

test('high reflection monsters block magic regardless of range, allowing physical and pure damage', () => {
  for (const monster of ['slenderman', 'tiger', 'goblin']) {
    for (const range of [30, 75, 300]) {
      assert.ok(block(monster, 'magical', range));
      assert.equal(block(monster, 'physical', range), null);
      assert.equal(block(monster, 'pure', range), null);
    }
  }
});

test('unknown attack stats fail closed only for requested dangerous monsters', () => {
  assert.ok(block('porcupine', undefined, NaN));
  assert.ok(block('tiger', undefined, 120));
  for (const monster of ['goo', 'crab', 'armadillo', 'greenjr', undefined])
    assert.equal(block(monster, undefined, NaN), null);
});
