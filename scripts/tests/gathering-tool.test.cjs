const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../characters/shared.js'), 'utf8');
const helper = source.slice(source.indexOf('  async function ensureGatheringTool('), source.indexOf('  async function equipGatheringTool('));
function setup({ carried = false, bank = false, cancel = false } = {}) {
  const calls = [], character = { name: 'GoldMajesty', items: carried ? [{ name: 'rod' }] : [], slots: {} };
  const context = vm.createContext({ gatheringAutoCraft:false,character, root: { __merchantGatheringGeneration: 1 }, gatheringModes: ['fishing','mining'],
    gatheringStatus() {}, close_stand: async () => {},
    smart_move: async () => { calls.push('bank'); character.bank = {}; if (cancel) context.root.__merchantGatheringGeneration = 2; },
    retrieveFromBankUntil: async name => { if (bank) character.items.push({ name }); },
    gatheringBaseline: () => ['baseline'], selectGatheringMode: () => calls.push('select'),
    request: async (_url, args) => calls.push(args.body),
  });
  vm.runInContext(helper, context);
  return { context, calls, session: { tool: 'rod', mode: 'fishing' } };
}
test('carried tool requires no bank visit', async () => {
  const r = setup({ carried: true });
  assert.equal(await r.context.ensureGatheringTool(r.session, 1), true);
  assert.deepEqual(r.calls, []);
});
test('missing tool is retrieved from bank and included in gathering baseline', async () => {
  const r = setup({ bank: true });
  assert.equal(await r.context.ensureGatheringTool(r.session, 1), true);
  assert.deepEqual(r.session.baseline, ['baseline']);
  assert.deepEqual(r.calls, ['bank']);
});
test('absent tool disables only the affected mode and reports no tool; re-enabling checks again', async () => {
  const r = setup();
  assert.equal(await r.context.ensureGatheringTool(r.session, 1), false);
  assert.deepEqual(Array.from(r.context.gatheringModes), ['mining']);
  assert.equal(r.calls[1].noTool, true);
  r.context.gatheringModes.push('fishing');
  assert.equal(await r.context.ensureGatheringTool(r.session, 1), false);
  assert.deepEqual(Array.from(r.context.gatheringModes), ['mining']);
});
test('cancelled check does not disable a newer gathering session', async () => {
  const r = setup({ cancel: true });
  assert.equal(await r.context.ensureGatheringTool(r.session, 1), false);
  assert.deepEqual(r.calls, ['bank']);
});
