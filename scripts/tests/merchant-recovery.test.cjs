const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const {createMerchantHomeRecovery,merchantRoutineNeedsHome}=require('../../runtime/coordinator/merchant/home-recovery.ts');

function runtime() {
  const party = { merchantCharacter: 'M', activeRealm: 'SR_USII', statuses: { M: { server: 'USIII' } }, commands: {} };
  const block = { realm: 'SR_USIII' }, logs = [], restarts = [];
  let now = Date.now();
  const r = vm.createContext({ party, ensureCharacterBlock: () => block, merchantLog: message => logs.push(message),
    realmLabel: value => value, persistSettings() {}, setTimeout: fn => restarts.push(fn), softkill_block() {} });
  const recovery=createMerchantHomeRecovery(party,{now:()=>now,block:r.ensureCharacterBlock,
    realmLabel:r.realmLabel,log:r.merchantLog,persist:r.persistSettings,restart:(block,delay)=>r.setTimeout(()=>r.softkill_block(block),delay)});
  Object.assign(r,{ensureMerchantHome:recovery.ensureHome,recoverStalledMerchantSale:recovery.recoverStalledSale,merchantRoutineNeedsHome});
  return { r, party, block, logs, restarts, setNow:value=>{now=value;} };
}

test('local work waits for actual home arrival and restarts only once', () => {
  const { r, party, block, restarts, setNow } = runtime();
  assert.equal(r.ensureMerchantHome('compounding'), false);
  assert.equal(block.realm, 'SR_USII');
  assert.equal(r.ensureMerchantHome('compounding'), false);
  assert.equal(restarts.length, 1);
  party.statuses.M.server = 'USII';
  party.statuses.M.seenAt = party.merchantRealmRequests.M.requestedAt + 1;
  setNow(party.statuses.M.seenAt);
  assert.equal(r.ensureMerchantHome('compounding'), true);
  assert.equal(party.merchantHomeReturnAt, 0);
  assert.equal(r.merchantRoutineNeedsHome('upgrades and compounds'), true);
  assert.equal(r.merchantRoutineNeedsHome('ALData marketplace sales'), false);
});

test('stalled WTB is stopped even with fresh heartbeats and is never requeued', () => {
  const { r, party, block, logs } = runtime();
  party.merchantCurrent = { id: 'sale', reason: 'ALData marketplace sales', startedAt: Date.now() - 181000,
    heartbeatAt: Date.now(), buyOrder: { buyer: 'Buyer', item: { name: 'leather' } } };
  party.commands.M = {};
  assert.equal(r.recoverStalledMerchantSale(), true);
  assert.equal(party.merchantCurrent, null);
  assert.equal(party.commands.M, undefined);
  assert.equal(block.realm, 'SR_USII');
  assert.match(logs[0], /Buyer/);
});

test('fresh WTB and long compounding jobs are not stopped by WTB deadline', () => {
  const { r, party } = runtime();
  party.merchantCurrent = { reason: 'ALData marketplace sales', startedAt: Date.now() };
  assert.equal(r.recoverStalledMerchantSale(), false);
  party.merchantCurrent = { reason: 'upgrades and compounds', startedAt: Date.now() - 999999 };
  assert.equal(r.recoverStalledMerchantSale(), false);
});

test('home restart preserves sixty second arrival window and requires fresh matching worker realm',()=>{
  let now=20000;const delays=[],block={realm:'SR_USIII'};
  const state={merchantCharacter:'M',activeRealm:'SR_USII',statuses:{M:{server:'SR_USII'}},commands:{M:{}}};
  const service=createMerchantHomeRecovery(state,{now:()=>now,block:()=>block,realmLabel:x=>x,
    log(){},persist(){},restart:(_block,delay)=>delays.push(delay)});
  assert.equal(service.ensureHome('bank'),false);assert.deepEqual(delays,[150]);assert.equal(state.commands.M,undefined);
  state.statuses.M.server='USIII';now=35000;service.ensureHome('bank');assert.deepEqual(delays,[150]);
  now=79999;service.ensureHome('bank');assert.deepEqual(delays,[150]);
  now++;service.ensureHome('bank');assert.deepEqual(delays,[150,150]);
  state.statuses.M.server='SR_USII';state.statuses.M.seenAt=++now;
  assert.equal(service.ensureHome('bank'),true);assert.equal(state.merchantHomeReturnAt,0);
});

test('WTB recovery honors the exact deadline and the original missing-start fallback',()=>{
  const delays=[],block={},state={merchantCharacter:'M',activeRealm:'SR_USII',statuses:{},commands:{},merchantCurrent:{reason:'ALData marketplace sales'}};
  const service=createMerchantHomeRecovery(state,{now:()=>200000,block:()=>block,realmLabel:x=>x,
    log(){},persist(){},restart:(_block,delay)=>delays.push(delay)});
  assert.equal(service.recoverStalledSale(),false);
  state.merchantCurrent.startedAt=20001;assert.equal(service.recoverStalledSale(),false);
  state.merchantCurrent.startedAt=20000;assert.equal(service.recoverStalledSale(),true);
  assert.deepEqual(delays,[100]);assert.equal(state.merchantCurrent,null);
});

test('location refresh follows a matching moved seller once, rejecting cancelled jobs', async () => {
  const { r, party } = runtime();
  const listing = { key: 'listing', seller: 'Seller', serverRegion: 'US', serverIdentifier: 'III',
    map: 'main', x: 0, y: 0, item: { name: 'gloves', level: 0 }, price: 100 };
  party.merchantCurrent = { id: 'job', reason: 'ALData marketplace purchases', listings: [listing] };
  let fetched = 0;
  r.aldataFetch = async () => { fetched++; return [{ id: 'Seller', serverRegion: 'US', serverIdentifier: 'III', map: 'main', x: 100, y: 0 }]; };
  r.normalizeALDataMerchants = records => records.map(record => ({ ...listing, ...record }));
  const {createMarketplaceLocationRoute}=require('../../runtime/coordinator/http/marketplace-location.ts');
  const handler=createMarketplaceLocationRoute(party,{
    fetch:r.aldataFetch,normalize:r.normalizeALDataMerchants,persist:r.persistSettings,log:r.merchantLog,
  });
  let result, status = 200;
  const res = { json: value => { result = value; }, status: value => { status = value; return res; } };
  await handler({ body: { jobId: 'job', listingKey: 'listing' } }, res);
  assert.equal(result.location.x, 100);
  await handler({ body: { jobId: 'job', listingKey: 'listing' } }, res);
  assert.equal(result.location, null);
  assert.equal(fetched, 1);
  party.merchantCurrent = null;
  await handler({ body: { jobId: 'job', listingKey: 'listing' } }, res);
  assert.equal(status, 409);
});

test('activity log keeps the visible entry anchored when newer entries arrive', () => {
  const ts = require('../../dashboard/node_modules/typescript');
  const code = ts.transpileModule(fs.readFileSync('dashboard/components/merchant-activity.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const r = vm.createContext({ exports: {}, require: name => require(require.resolve(name, { paths: [require('node:path').resolve('dashboard')] })) });
  vm.runInContext(code, r);
  const component = new r.exports.MerchantActivityLog({ entries: [] });
  let position = 90;
  const child = { getAttribute: () => 'entry', getBoundingClientRect: () => ({ top: position, bottom: position + 30 }) };
  const box = { scrollTop: 100, children: [child], getBoundingClientRect: () => ({ top: 100 }) };
  component.container.current = box;
  const snapshot = component.getSnapshotBeforeUpdate();
  position += 40;
  component.componentDidUpdate({}, {}, snapshot);
  assert.equal(box.scrollTop, 140);
  box.scrollTop = 0;
  assert.equal(component.getSnapshotBeforeUpdate(), null);
});
