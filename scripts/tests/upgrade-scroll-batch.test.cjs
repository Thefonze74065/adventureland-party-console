const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');

function runtime(levels = [0, 0, 0, 0, 0], scrolls = {}) {
  const purchases = [];
  const r = vm.createContext({
    // No offering rule applies in these scroll-budget scenarios. Keep the real
    // resolver and checkpoint path rather than bypassing offering preparation.
    partyResolveUpgradeOffering: require('../../runtime/upgrade-offerings.ts').resolveUpgradeOffering,
    partyChanceGuard: require('../../runtime/upgrade-chance-guard.ts').chanceGuard,
    partyChanceHold: require('../../runtime/upgrade-chance-guard.ts').chanceHold,
    partyScrollGrade: require('../../runtime/upgrade-chance-guard.ts').scrollGradeFor,
    request: async (route, {body}) => {
      assert.equal(route, '/merchant/checkpoint'); assert.equal(body.protectionOnly, true);
      return {craftProtection: {requirements: []}, upgradeOfferingRules: [], upgradeOfferingStock: {}};
    },
    character: { items: levels.map(level => ({ name: 'wshoes', level })), gold: 1e9 },
    G: { items: { wshoes: {}, scroll0: { g: 1000 }, scroll1: { g: 40000 } } },
    maximumItemLevel: () => 13,
    item_grade: item => item.level >= 9 ? 2 : item.level >= 7 ? 1 : 0,
    sameItem: (a, b) => a && a.name === b.name && a.level === b.level,
    itemAvailability: name => ({ onPlayer: scrolls[name] || 0, inBank: 0 }),
    merchantVisitBank: async () => {}, merchantOperationStage: async () => {}, retrieveFromBankUntil: async () => {},
    smart_move: async () => {}, find_npc: name => name,
    buyConfirmed: async (name, quantity) => { purchases.push([name, quantity]); scrolls[name] = (scrolls[name] || 0) + quantity; },
  });
  vm.runInContext(source.slice(source.indexOf('  function findUpgradeMarkSlot('),
    source.indexOf('  async function merchantImprove(')), r);
  vm.runInContext(source.slice(source.indexOf('  function manualImprovementScrollNeeds('),
    source.indexOf('  async function ensureOwnedItemQuantity(')), r);
  vm.runInContext(source.slice(source.indexOf('  async function prepareManualImprovementScrolls('),
    source.indexOf('\n  }', source.indexOf('  async function prepareManualImprovementScrolls(')) + 4), r);
  return { r, purchases, command: { upgrades: levels.slice(0, 3).map(level => ({ item: { name: 'wshoes', level }, tiers: 8 - level })) } };
}

test('three requested +8 shoes stock 21 normal and one high, not all five inventory shoes', async () => {
  const { r, purchases, command } = runtime(undefined, { scroll0: 3 });
  await r.prepareManualImprovementScrolls(command, []);
  assert.deepEqual(purchases, [['scroll0', 18], ['scroll1', 1]]);
  await r.prepareManualImprovementScrolls(command, []);
  assert.equal(purchases.length, 2, 'existing stock prevents duplicate purchases');
});

test('existing high scroll is reused and never multiplied across future items', async () => {
  const { r, purchases, command } = runtime(undefined, { scroll1: 1 });
  await r.prepareManualImprovementScrolls(command, []);
  assert.deepEqual(purchases, [['scroll0', 21]]);
});

test('refill plans unfinished live levels, retaining batched normals and a single crossing scroll', () => {
  const { r, command } = runtime([7, 0, 0]);
  const plan = r.manualImprovementScrollNeeds(command);
  assert.equal(plan.scroll0, 14);
  assert.equal(plan.scroll1, 1);
  r.character.items[0] = null;
  const remaining = r.manualImprovementScrollNeeds({ upgrades: command.upgrades.slice(1) });
  assert.equal(remaining.scroll0, 14);
  assert.equal(remaining.scroll1, 1);
});

test('same starting grade is batched even when it is a high grade', () => {
  const { r, command } = runtime([7, 7, 7]);
  const plan = r.manualImprovementScrollNeeds(command);
  assert.equal(plan.scroll0, undefined);
  assert.equal(plan.scroll1, 3);
});

test('a partially upgraded marked item only budgets its remaining steps to the original target', () => {
  const { r } = runtime([4]);
  const plan = r.manualImprovementScrollNeeds({ upgrades: [
    { slot: 0, item: { name: 'wshoes', level: 0 }, tiers: 8 },
  ] });
  assert.equal(plan.scroll0, 3);
  assert.equal(plan.scroll1, 1);
});

test('destroyed or missing queued ingredients do not inflate the budget', () => {
  const { r, command } = runtime([0, 0, 0]);
  r.character.items[1] = null;
  r.character.items[2] = null;
  const plan = r.manualImprovementScrollNeeds(command);
  assert.equal(plan.scroll0, 7);
  assert.equal(plan.scroll1, 1);
});

test('upgrade loop refills a normal batch and buys high scrolls individually at the boundary', async () => {
  const { r, command } = runtime([0, 0, 0]);
  const stock = {}, refills = [];
  r.findInventoryItemByName = name => stock[name] > 0 ? name : -1;
  r.fingerprint = item => item && { ...item };
  r.ensureOwnedItemQuantity = async (name, quantity) => {
    refills.push([name, quantity]);
    stock[name] = quantity;
  };
  r.upgradeConfirmed = async (slot, scroll) => {
    stock[scroll]--;
    r.character.items[slot].level++;
  };
  vm.runInContext(source.slice(source.indexOf('  async function merchantImprove('),
    source.indexOf('  async function retrieveAutoCompoundBatch(')), r);
  await r.merchantImprove(command, []);
  assert.deepEqual(refills, [['scroll0', 21], ['scroll1', 1], ['scroll1', 1], ['scroll1', 1]]);
  assert.equal(stock.scroll0, 0, 'no excess normals after an all-successful run');
  assert.ok(r.character.items.every(item => item.level === 8));
});
