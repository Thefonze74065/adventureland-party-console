const test = require('node:test'), assert = require('node:assert/strict');
const {reconcileCoordinatorCollectionMarks: collect, reconcileCoordinatorUpgradeMarks: upgrade,
  clearCoordinatorResolvedUpgrades: clear} = require('../../runtime/coordinator/inventory/mark-reconciliation.ts');

test('collection reconciliation writes both destinations and retains relocated manual intent', () => {
  const manual = {slot: 0, item: {name: 'ring', level: 1}}, automatic = {slot: 1, item: {name: 'leather'}, auto: true};
  const state = {marked: {M: [manual, automatic]}, merchantMarked: {}, autoItemMarks: {M: {leather: 'merchant'}}};
  const status = {items: [{slot: 4, item: {name: 'ring', level: 1}}, {slot: 1, item: {name: 'leather', q: 10}}]};
  assert.equal(collect(state, 'M', status), true);
  assert.deepEqual(state.marked.M, [manual]); assert.equal(state.marked.M[0], manual); assert.equal(manual.slot, 4);
  assert.deepEqual(state.merchantMarked.M, [{slot: 1, item: status.items[1].item, auto: true}]);
  assert.equal(collect(state, 'M', status), false);
});

for (const destination of ['bank', 'merchant']) {
  test(`manual ${destination} survives an opposing automatic rule across repeated inventory reports`, () => {
    const field = destination === 'bank' ? 'marked' : 'merchantMarked';
    const other = destination === 'bank' ? 'merchantMarked' : 'marked';
    const mode = destination === 'bank' ? 'merchant' : 'bank';
    const manual = {slot: 8, item: {name: 'slice_nightberry', q: 16}};
    const rules = {'slice_nightberry@+0': mode};
    const state = {marked: {}, merchantMarked: {}, autoItemMarks: {M: rules}};
    state[field].M = [manual];
    const status = {items: [{slot: 8, item: {...manual.item}},
      {slot: 10, item: {name: 'slice_nightberry', q: 2845}}]};
    assert.equal(collect(state, 'M', status), true);
    assert.deepEqual(state[field].M, [manual]);
    assert.deepEqual(state[other].M, [{slot: 10, item: status.items[1].item, auto: true}]);
    assert.equal(collect(state, 'M', status), false);
    status.items[0] = {slot: 12, item: {name: 'slice_nightberry', q: 17}};
    assert.equal(collect(state, 'M', status), true);
    assert.equal(manual.slot, 12);
    assert.deepEqual(state[field].M, [manual]);
    assert.deepEqual(state[other].M.map(mark => mark.slot), [10]);
    assert.deepEqual(rules, {'slice_nightberry@+0': mode});
    state[field].M = [];
    assert.equal(collect(state, 'M', status), true);
    assert.deepEqual(state[other].M.map(mark => mark.slot).sort(), [10, 12]);
  });
}

test('legacy item-wide manual collection intent also overrides automatic destinations', () => {
  const manual = {name: 'slice_nightberry', q: 16};
  const state = {marked: {M: [manual]}, merchantMarked: {},
    autoItemMarks: {M: {'slice_nightberry@+0': 'merchant'}}};
  assert.equal(collect(state, 'M', {items: [{slot: 8, item: {...manual, q: 17}}]}), false);
  assert.deepEqual(state.marked.M, [manual]);
  assert.deepEqual(state.merchantMarked.M, []);
});

test('upgrade reconciliation retains the original pass while resolution preserves newer requests', () => {
  const original = {slot: 2, item: {name: 'helmet', level: 0}, tiers: 8, auto: true};
  const state = {upgrades: {M: [original]}, autoUpgradeMarks: {M: {'helmet@+0': 8}}};
  assert.equal(upgrade(state, 'M', {items: [{slot: 2, item: {name: 'helmet', level: 4}, meta: {upgradeable: true}}]}), false);
  assert.equal(state.upgrades.M[0], original);
  const newer = {...original, tiers: 9}; state.upgrades = {M: [original, newer]};
  clear(state, 'M', [JSON.parse(JSON.stringify(original))]);
  assert.deepEqual(state.upgrades.M, [newer]); assert.equal(state.upgrades.M[0], newer);
});

test('missing or invalid inventory cannot erase unfinished upgrades', () => {
  for (const status of [undefined, null, {items: {}}, {items: 'invalid'}]) {
    const automatic = {slot: 1, item: {name: 'helmet'}, tiers: 8, auto: true};
    const manual = {slot: 2, item: {name: 'ring'}, tiers: 2};
    const state = {marked: {}, merchantMarked: {}, autoItemMarks: {},
      upgrades: {M: [automatic, manual]}, autoUpgradeMarks: {}};
    assert.equal(collect(state, 'M', status), false);
    assert.deepEqual(state.marked.M, []); assert.deepEqual(state.merchantMarked.M, []);
    assert.equal(upgrade(state, 'M', status), false); assert.deepEqual(state.upgrades.M, [automatic, manual]);
    clear(state, 'New', []); assert.deepEqual(state.upgrades.New, []);
  }
});
test('equipped upgrade marks survive bag reconciliation and resolve only the completed pass', () => {
  const equipped = {slot: 'mainhand', item: {name: 'sword', level: 5}, tiers: 3, equipped: true};
  const newer = {...equipped, tiers: 4};
  const state = {upgrades: {W: [equipped, newer]}, autoUpgradeMarks: {}};
  assert.equal(upgrade(state, 'W', {items: []}), false);
  assert.equal(state.upgrades.W[0], equipped);
  clear(state, 'W', [JSON.parse(JSON.stringify(equipped))]);
  assert.deepEqual(state.upgrades.W, [newer]);
  assert.equal(state.upgrades.W[0], newer);
});

for (const family of ['upgrade', 'compound']) test(`automatic merchant collects all copies alongside a finite ${family} rule`, () => {
  const items = Array.from({length:12}, (_,slot)=>({slot,item:{name:'helmet',level:0}}));
  const state = {merchantCharacter:'M',merchantRules:{version:1,owner:'M',members:['W','M'],conflicts:[]},marked:{},merchantMarked:{},
    autoItemMarks:{M:{'helmet@+0':'merchant'}},autoUpgradeMarks:{M:{}},autoCompounds:{M:[]}};
  if(family==='upgrade')state.autoUpgradeMarks.M['helmet@+0']={tiers:9,quantity:1};
  else state.autoCompounds.M=[{name:'helmet',targetTier:1,quantity:1}];
  collect(state,'W',{items});
  assert.equal(state.merchantMarked.W.length,12);
  assert.deepEqual(state.marked.W,[]);
  state.autoItemMarks.M['helmet@+0']='bank';collect(state,'W',{items});
  assert.deepEqual(state.marked.W,[]);assert.deepEqual(state.merchantMarked.W,[]);
  state.autoItemMarks.M['helmet@+0']='merchant';state.autoNpcSales={'{"name":"helmet","level":0,"p":null,"stat_type":null}':true};
  collect(state,'W',{items});assert.deepEqual(state.merchantMarked.W,[]);
});
