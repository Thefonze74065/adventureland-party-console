const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
const helpers = source.slice(source.indexOf('  function diagnosticText('), source.indexOf('  function rareSightings('));
const tick = source.slice(source.indexOf('  var merchantVisibilityUntil'), source.indexOf('  function eventStatus()'));
function fixture() {
  let now = 1000, response = {}, failure = null;
  const requests = [], logs = [];
  const r = vm.createContext({ observeBankSortVisit() {}, recoverBankSortBeforeWork:async()=>{}, root: {}, Date: { now: () => now }, api: 'http://localhost/party-api',
    character: { name: 'Warrior', ctype: 'warrior' }, convoySignal: { id: 'convoy', epoch: 4, phase: 'scheduled' }, convoyTraveling: null,
    game_log: message => logs.push(message),
    $: { ajax(options) { requests.push(options); return {
      done(fn) { if (!failure) fn(response); return this; },
      fail(fn) { if (failure) fn(...failure); return this; },
    }; } },
  });
  vm.runInContext(helpers, r);
  return { r, requests, logs, time: n => now = n, fail: f => failure = f, response: value => response = value };
}
for (const status of [400,409,500]) test('HTTP '+status+' retains endpoint and server explanation without payloads', async()=>{
  const f=fixture();f.fail([{status,responseJSON:{error:'stale convoy',private:'do not retain'}},'error','']);
  await assert.rejects(f.r.request('/status?token=secret',{method:'POST',body:{password:'private'}}),e=>{
    assert.equal(e.partyRequest.status,status);assert.equal(e.partyRequest.path,'/status');
    assert.match(e.message,/stale convoy/);assert.doesNotMatch(JSON.stringify(e),/secret|private/);return true;
  });
});
test('status timing records actual response receipt and failure without extra requests',async()=>{
 const f=fixture();let now=100;f.r.performance={now:()=>now};
 f.r.$.ajax=()=>({done(fn){now=450;fn({ok:true});return this;},fail(){return this;}});
 assert.equal((await f.r.request('/status')).ok,true);assert.equal(f.r.root.__partyConvoyHttp.responseAt,450);
 f.r.$.ajax=()=>({done(){return this;},fail(fn){now=900;fn({status:0},'error','');return this;}});
 await assert.rejects(f.r.request('/status'),/network/);
 assert.equal(f.r.root.__partyConvoyHttp.failure.durationMs,450);assert.equal(f.r.root.__partyConvoyHttp.failure.kind,'network');
 assert.equal(f.r.root.__partyConvoyHttp.responseAt,450);
 await assert.rejects(f.r.request('/merchant/native-stand'),/network/);
 assert.equal(f.r.root.__partyConvoyHttp.failure.durationMs,450,'other endpoints cannot replace status evidence');
 assert.equal(f.requests.length,0,'instrumentation never sends a request');
});
test('broken diagnostic state cannot reject an otherwise successful status response',async()=>{
 const f=fixture();Object.defineProperty(f.r.root,'__partyConvoyHttp',{get(){throw Error('diagnostic state unavailable');}});
 f.response({ok:true});assert.equal((await f.r.request('/status')).ok,true);
});
for(const [status,http,kind]of [['error',0,'network'],['timeout',0,'timeout'],['parsererror',200,'invalid-json'],['abort',0,'aborted']])
  test('classifies '+kind,async()=>{
    const f=fixture();f.fail([{status:http,responseText:'full response must not leak'},status,'']);
    await assert.rejects(f.r.request('/status'),e=>e.partyRequest.kind===kind&&!JSON.stringify(e).includes('full response'));
  });
test('diagnostics survive reload, deduplicate repeats, stay bounded and retry only after success',async()=>{
  const f=fixture();f.r.recordStatusFailure(new Error('broken'),'apply navigation');
  f.r.recordStatusFailure(new Error('broken'),'apply navigation');
  assert.equal(f.logs.length,1);assert.equal(f.requests.length,0);
  assert.equal(f.r.root.__partyStatusDiagnostics[0].details.repeats,2);
  assert.equal(f.r.root.__partyStatusDiagnostics[0].details.convoy.epoch,4);
  f.fail([{status:0},'error','']);await f.r.flushStatusDiagnostics();
  assert.equal(f.requests.length,1);assert.equal(f.logs.length,1);
  assert.equal(f.r.root.__partyStatusDiagnostics[0].delivered,false);
  vm.runInContext(helpers,f.r);f.fail(null);await f.r.flushStatusDiagnostics();
  assert.equal(f.r.root.__partyStatusDiagnostics[0].delivered,true);
  await f.r.flushStatusDiagnostics();assert.equal(f.requests.length,2);
  for(let i=0;i<25;i++)f.r.recordStatusFailure(new Error('failure '+i),'request status');
  assert.equal(f.r.root.__partyStatusDiagnostics.length,20);
});
test('diagnostic strings redact credentials and URL queries',()=>{
 const f=fixture();const text=f.r.diagnosticText('token=abc password="def ghi" Bearer xyz https://host/path?session=123');
 assert.doesNotMatch(text,/abc|def ghi|xyz|123/);
});
function statusFixture() {
 const f=fixture(),r=f.r;
 Object.assign(r,{
  busy:false,snapshot:()=>({}),runtimeCurrent:()=>true,dashboardSampler:null,reloadConvoyGeometry(){},
  prepareCatalog:async()=>{},applyMerchantVisibility:async()=>{},
  luckySlotTracking:()=>({sync:()=>{}}),
  wakeGatheringAfterStatus:()=>{r.gatheringWakes=(r.gatheringWakes||0)+1;},
  applyEscape:async()=>{},applyNavigationIntent:async()=>{},acceptCombatControl(){},
  rareControlState:null,cancelRarePath(){},followLeader:false,followingLeader:false,
  huntTurnInPriority:false,enabledEventSelections:null,pendingEventDisables:[],
  desiredPartyMembers:[],acceptQueue(){},huntEventTrip:null,anniversaryPlan:null,
  applyAnniversaryAbort:async()=>{},gatheringStandListings:[],gatheringSession:null,
  monsterFocus:['goo'],scatterEpoch:0,lastApiError:null,
  handle:async()=>{r.handled=(r.handled||0)+1;},escapeOwns:()=>false,
  banking:false,stocking:false,upgrading:false,departurePending:false,quantity:()=>1,
 });
 vm.runInContext(tick,r);return f;
}
test('status request failure releases busy and the next successful update dispatches normally',async()=>{
 const f=statusFixture();f.fail([{status:500,responseJSON:{error:'coordinator exception'}},'error','']);
 await f.r.tick();assert.equal(f.r.busy,false);
 assert.equal(f.r.root.__partyStatusDiagnostics[0].details.phase,'request status');
 f.fail(null);await f.r.tick();assert.equal(f.r.busy,false);assert.equal(f.r.handled,1);
 assert.equal(f.r.gatheringWakes,2);
 assert.equal(f.r.root.__partyStatusDiagnostics[0].delivered,true);
});

test('blocked bank recovery still reports a heartbeat without dispatching new work',async()=>{
 const f=statusFixture();f.r.recoverBankSortBeforeWork=async()=>{throw new Error('Bank stack buffer changed');};
 await f.r.tick();assert.equal(f.r.busy,false);assert.equal(f.r.handled,undefined);
 assert.ok(f.requests.some(r=>r.url.endsWith('/status')));
 assert.equal(f.r.root.__partyStatusDiagnostics[0].details.phase,'bank sort recovery');
 f.r.recoverBankSortBeforeWork=async()=>{};await f.r.tick();assert.equal(f.r.handled,1);
});
test('snapshot and post-response navigation exceptions identify their actual stage',async()=>{
 const f=statusFixture();f.r.snapshot=()=>{throw new Error('snapshot broke');};
 await f.r.tick();assert.equal(f.r.busy,false);
 assert.equal(f.r.root.__partyStatusDiagnostics[0].details.phase,'snapshot');
 f.r.snapshot=()=>({});f.r.applyNavigationIntent=async()=>{throw new Error('navigation broke');};
 await f.r.tick();assert.equal(f.r.busy,false);
 assert.equal(f.r.root.__partyStatusDiagnostics[1].details.phase,'apply navigation');
 f.r.applyNavigationIntent=async()=>{};await f.r.tick();assert.equal(f.r.handled,1);
});
