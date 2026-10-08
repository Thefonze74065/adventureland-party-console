const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installRosterRoutes } = require('../../runtime/roster/routes.ts');
const {createCoordinatorOwnershipPorts}=require('../../runtime/coordinator/characters/ownership.ts');

for(const [scenario,expected] of [['unrelated merchant',200],['added character busy',502],['bankboi transaction',502]])
test('spawn admission during '+scenario,async()=>{
 const ownership={steamMembers:[],headlessSlots:['Merchant',null,null,null],nativeOwner:null,steamSwitch:null,
  statuses:{Merchant:{seenAt:100,runtime:'headless'}},bankbois:{},bankboiTransaction:scenario==='bankboi transaction'?{}:null,
  merchantCharacter:'Merchant',merchantCurrent:{id:'running-job'},leader:null,lifecycle:{}};
 if(scenario==='added character busy')ownership.statuses.Ranger={seenAt:100,upgrading:true};
 const realPorts=createCoordinatorOwnershipPorts(ownership,{}, {now:()=>100,id:()=>'',save(){},owned:()=>({}),configuredRealm:'SR_USII',roster:()=>[]});
 const f=fixture({validateParticipants:realPorts.validateParticipants});f.state.native=null;f.state.steam=[];f.state.slots=['Merchant',null,null,null];
 try{
  const response=await f.request('/slots/:slot/spawn',{character:'Ranger'},'2');assert.equal(response.code,expected);
  assert.equal(f.state.slots[1],expected===200?'Ranger':null);assert.equal(f.online.has('Ranger'),expected===200);
 }finally{f.installed.dispose();}
});

function fixture(overrides = {}) {
  const state = { native: 'Priest', slots: ['Mage', 'Warrior', 'Merchant', null], handoff: null };
  const online = new Set(['Priest', 'Mage', 'Warrior', 'Merchant']), routes = new Map();
  let now = 100;
  const ports = {
    now: () => now, id: () => 'op', save() {}, bridgeReady: () => false,
    owned: name => ['Priest', 'Mage', 'Warrior', 'Merchant', 'Ranger'].includes(name),
    validateParticipants(names) { if (new Set(names).size > 4) throw new Error('capacity'); },
    async stopHeadless(name) { online.delete(name); },
    startHeadless(name) { assert.ok(!online.has(name)); online.add(name); },
    async confirmOffline(name) { return !online.has(name); },
    nativeBusy: () => false, bridgeChanged() {}, realm: () => 'SR_USII', members: () => [],
    ...overrides,
  };
  const installed = installRosterRoutes({ get: (route, handler) => routes.set(route, handler), post: (route, handler) => routes.set(route, handler) }, state, ports);
  const request = async (path, body = {}, slot = '') => {
    const response = { code: 200, body: undefined, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await routes.get('/party-api' + path)({ body, params: { slot } }, response);
    return response;
  };
  const bridge = (body = {}) => request('/steam/bridge', { version: 1, clientId: 'window', character: 'Priest', ...body });
  return { state, ports, online, installed, request, bridge, advance: value => { now += value; } };
}
test('startup preserves explicit failed handoff errors',()=>{
 const state={native:'Priest',steam:['Priest'],slots:[null,null,null,null],handoff:{phase:'failed',error:'stop_runner failed'}};
 const installed=installRosterRoutes({get(){},post(){}},state,{save(){},now:()=>100});
 try { assert.equal(state.handoff.error,'stop_runner failed'); }
 finally { installed.dispose(); }
});
test('selection-screen bridge readiness permits a headless transfer without claiming a connected character',async()=>{
 const f=fixture();f.state.native=null;
 try {
  assert.deepEqual((await f.request('/steam/connection')).body,{connected:false,ready:false});
  await f.bridge({version:2,character:null,running:[]});
  assert.deepEqual((await f.request('/steam/connection')).body,{connected:false,ready:true});
  const response=await f.request('/steam/action',{action:'primary',character:'Mage'});
  assert.equal(response.code,200);assert.equal(f.online.has('Mage'),false);
  assert.equal(f.state.handoff.phase,'release');
  f.advance(8000);assert.equal((await f.request('/steam/connection')).body.ready,false);
 }finally{f.installed.dispose();}
});

test('bridge realm recovers an unknown-realm operation without a CODE heartbeat',async()=>{
 const f=fixture();f.ports.realmContext=()=>({current:null,home:'SR_USII'});
 try {
  await f.bridge({version:2});
  await f.request('/steam/action',{action:'primary',character:'Mage'});
  assert.equal(f.state.handoff.phase,'awaiting-realm-choice');
  for(const body of [{realm:'invalid'},{realm:'SR_USII',character:null},{realm:'SR_USII',character:'Warrior'}]) {
   await f.bridge({version:2,...body});
   assert.equal(f.state.handoff.phase,'awaiting-realm-choice');
  }
  await f.bridge({version:2,realm:'SR_USII'});
  assert.equal(f.state.handoff.phase,'release');
  assert.equal(f.state.handoff.destinationRealm,'SR_USII');
  assert.equal(f.online.has('Mage'),false);
 }finally{f.installed.dispose();}
});

test('fresh bridge realm overrides telemetry and expires with the accepted session',async()=>{
 const f=fixture();f.ports.realmContext=()=>({current:'SR_USII',home:'SR_USII'});
 try {
  await f.bridge({version:2,realm:'SR_USIV'});
  await f.request('/steam/action',{action:'primary',character:'Mage'});
  assert.equal(f.state.handoff.realmChoice.current,'SR_USIV');
  assert.equal((await f.bridge({version:2,clientId:'other',realm:'SR_USII'})).code,409);
  assert.equal(f.state.handoff.realmChoice.current,'SR_USIV');
  f.advance(8001);
  await f.request('/steam/realm-choice',{operationId:'op',choice:'stay'});
  assert.equal(f.state.handoff.realmChoice.current,'SR_USII');
  assert.equal(f.state.handoff.phase,'awaiting-realm-choice');
 }finally{f.installed.dispose();}
});

test('connection status requires a live bridge, its current character, and a fresh code heartbeat',async()=>{
 const f=fixture();let fresh=false;f.ports.codeRunning=()=>fresh;
 try {
  const connected=async()=>(await f.request('/steam/connection')).body.connected;
  assert.equal(await connected(),false);
  await f.bridge();assert.equal(await connected(),false);
  fresh=true;assert.equal(await connected(),true);
  fresh=false;assert.equal(await connected(),false);
  fresh=true;f.advance(9000);assert.equal(await connected(),false);
  await f.bridge({character:null});assert.equal(await connected(),false);
 }finally{f.installed.dispose();}
});

test('roster endpoints reject primitive and empty request bodies without changing ownership',async()=>{
  const f=fixture(),before=JSON.stringify(f.state);
  try {
    for(const body of [null,false,0,'Mage',[],{}]) {
      const result=await f.request('/steam/switch',body);
      assert.equal(result.code,409);assert.match(result.body.error,/Choose a character/);
    }
    assert.equal(JSON.stringify(f.state),before);
  } finally {f.installed.dispose();}
});

test('explicit Steam login releases a BankBoi reservation before capacity and inventory checks',async()=>{
 const f=fixture();let storageBusy=true,calls=0;f.state.slots[2]='BankBoi';f.online.delete('Merchant');
 f.ports.characterBusy=()=>storageBusy;
 f.ports.prepareSteam=async name=>{assert.equal(name,'Merchant');calls++;storageBusy=false;f.state.slots[2]=null;};
 try {
  assert.equal((await f.request('/steam/action',{action:'login',character:'Merchant'})).code,409);
  assert.equal(calls,0,'an unavailable bridge must not interrupt storage');
  await f.bridge({version:2,running:['Priest']});
  const result=await f.request('/steam/action',{action:'login',character:'Merchant'});
  assert.equal(result.code,200);assert.equal(calls,1);assert.ok(f.state.handoff.multi.desired.includes('Merchant'));
  assert.equal(f.state.slots[2],null);
 } finally {f.installed.dispose();}
});
test('headless logout action retains its slot until offline confirmation succeeds',async()=>{
  const f=fixture(),calls=[];
  try {
    f.ports.stopHeadless=async name=>calls.push(['stop',name]);
    f.ports.confirmOffline=async name=>{calls.push(['confirm',name]);return false;};
    f.ports.save=()=>calls.push(['save']);
    const failed=await f.request('/steam/action',{action:'logout',character:'Mage'});
    assert.equal(failed.code,409);assert.equal(f.state.slots[0],'Mage');
    assert.deepEqual(calls,[['stop','Mage'],['confirm','Mage']]);
    calls.length=0;
    f.ports.confirmOffline=async name=>{calls.push(['confirm',name]);return true;};
    assert.equal((await f.request('/steam/action',{action:'logout',character:'Mage'})).code,200);
    assert.equal(f.state.slots[0],null);
    assert.deepEqual(calls,[['stop','Mage'],['confirm','Mage'],['save']]);
  } finally {f.installed.dispose();}
});
test('bridge ownership survives stale heartbeats and rejects a second active window', async () => {
  const f = fixture();
  try {
    assert.equal((await f.bridge()).code, 200);
    assert.equal((await f.bridge({ clientId: 'other' })).code, 409);
    f.advance(9000);
    assert.equal((await f.request('/steam/headless')).code, 409);
    assert.equal(f.state.native, 'Priest');
    await f.bridge({ character: null });
    assert.equal(f.state.native, 'Priest');
  } finally { f.installed.dispose(); }
});
test('slot is retained until logout is confirmed and becomes reusable for an offline character', async () => {
  const f = fixture();
  try {
    f.ports.stopHeadless = async () => {};
    assert.equal((await f.request('/slots/:slot/logout', {}, '1')).code, 409);
    assert.equal(f.state.slots[0], 'Mage');
    f.online.delete('Mage');
    assert.equal((await f.request('/slots/:slot/logout', {}, '1')).code, 200);
    assert.equal(f.state.slots[0], null);
    assert.equal((await f.request('/slots/:slot/spawn', { character: 'Ranger' }, '1')).code, 200);
    assert.equal(f.state.slots[0], 'Ranger');
    assert.ok(f.online.has('Ranger'));
  } finally { f.installed.dispose(); }
});
test('a pending spawn reserves its slot and serializes competing roster mutations', async () => {
  const f = fixture();
  try {
    f.state.native = null;
    f.state.steam = [];
    let release;
    f.ports.confirmOffline = () => new Promise(resolve => { release = resolve; });
    const spawning = f.request('/slots/:slot/spawn', { character: 'Ranger' }, '4');
    assert.equal(f.state.slots[3], 'Ranger');
    assert.equal((await f.request('/slots/:slot/logout', {}, '1')).code, 409);
    release(false);
    assert.equal((await spawning).code, 409);
    assert.equal(f.state.slots[3], null);
  } finally { f.installed.dispose(); }
});

test('arrival without navigation storage recovers a timed-out legacy handoff', async () => {
  const f = fixture();
  try {
    await f.bridge();
    await f.request('/steam/switch', { character: 'Mage' });
    f.online.delete('Priest');
    await f.bridge({ character: null, operationId: 'op', released: true, from: 'Priest' });
    assert.equal(f.state.handoff.phase, 'navigate');
    delete f.state.handoff.releasedAt;
    f.advance(100000);
    await f.bridge({ character: null });
    assert.equal(f.state.handoff.phase, 'failed');
    await f.bridge({ character: 'Mage' });
    assert.equal(f.state.handoff.phase, 'complete');
    assert.equal(f.state.native, 'Mage');
    assert.deepEqual(f.state.slots, ['Priest', 'Warrior', 'Merchant', null]);
  } finally { f.installed.dispose(); }
});

test('a fresh Steam Engage supersedes a pending logout without replaying release or navigation', async () => {
  for (const phase of ['release', 'confirm-release', 'navigate', 'failed']) {
    for (const character of ['Priest', 'Ranger']) {
      const f = fixture();
      try {
        await f.bridge({ version: 2, sessionId: 'old-game', running: ['Priest'] });
        await f.request('/steam/action', { action: 'logout', character: 'Priest' });
        const op = f.state.handoff;
        assert.equal(op.steamSessionId, 'old-game');
        op.phase = phase;
        const result = await f.bridge({ version: 2, sessionId: 'new-game', character, running: [character] });
        assert.equal(result.code, 200);
        assert.equal(result.body.operation, null);
        assert.equal(f.state.native, character);
        assert.deepEqual(f.state.steam, [character]);
        assert.deepEqual(f.state.slots, ['Mage', 'Warrior', 'Merchant', null]);
        assert.equal(op.phase, 'complete', 'in-flight release checks must be retired');
      } finally { f.installed.dispose(); }
    }
  }
});

test('ordinary polls and bridge reloads still execute a newly requested logout', async () => {
  const f = fixture();
  try {
    await f.bridge({ version: 2, sessionId: 'game', running: ['Priest'] });
    await f.request('/steam/action', { action: 'logout', character: 'Priest' });
    await f.bridge({ version: 2, sessionId: 'game', running: ['Priest'] });
    assert.equal(f.state.handoff.phase, 'release');
    await f.bridge({ version: 2, sessionId: 'new-game', running: [] });
    assert.equal(f.state.handoff.phase, 'release', 'no CODE is not a new Engage');
    f.online.delete('Priest');
    await f.bridge({ version: 2, sessionId: 'game', character: null, running: [], operationId: 'op', released: true });
    assert.equal(f.state.handoff.phase, 'complete');
    assert.equal(f.state.native, null);
    assert.deepEqual(f.state.steam, []);
    await f.bridge({ version: 2, sessionId: 'new-game', running: ['Priest'] });
    assert.equal(f.state.native, 'Priest');
  } finally { f.installed.dispose(); }
});

test('legacy release receipts and failed logouts can recover a connected Engage', async () => {
  for (const version of [1, 2]) {
    for (const failed of [false, true]) {
      const f = fixture();
      try {
        await f.bridge({ version });
        if (version === 1) await f.request('/slots/:slot/logout', {}, '0');
        else await f.request('/steam/action', { action: 'logout', character: 'Priest' });
        if (failed) f.state.handoff.phase = 'failed';
        await f.bridge({ version, running: ['Priest'], ...(failed ? {} : { operationId: 'op', released: true, from: 'Priest' }) });
        assert.equal(f.state.handoff, null);
        assert.equal(f.state.native, 'Priest');
        assert.deepEqual(f.state.steam, ['Priest']);
      } finally { f.installed.dispose(); }
    }
  }
});

test('new Steam sessions cannot cancel transfers or take a headless assignment', async () => {
  for (const action of ['primary', 'headless', 'logout']) {
    const f = fixture();
    try {
      await f.bridge({ version: 2, sessionId: 'old-game', running: ['Priest'] });
      await f.request('/steam/action', { action, character: action === 'primary' ? 'Mage' : 'Priest' });
      const op = f.state.handoff;
      await f.bridge({ version: 2, sessionId: 'new-game', character: action === 'logout' ? 'Warrior' : 'Priest', running: ['Priest', 'Warrior'] });
      assert.equal(f.state.handoff, op);
      assert.equal(op.phase, 'release');
      assert.deepEqual(f.state.slots, ['Mage', 'Warrior', 'Merchant', null]);
    } finally { f.installed.dispose(); }
  }
});

test('a disconnected bridge yields to a new connected CODE window and rejects its old poll', async () => {
  const f = fixture();
  try {
    await f.bridge({ version: 2, sessionId: 'old-game' });
    await f.request('/steam/action', { action: 'logout', character: 'Priest' });
    await f.bridge({ version: 2, character: null });
    const result = await f.bridge({ version: 2, clientId: 'new-window', sessionId: 'new-game', running: ['Priest'] });
    assert.equal(result.code, 200);
    assert.equal(f.state.handoff, null);
    assert.equal((await f.bridge({ version: 2, character: null })).code, 409);
    assert.equal(f.state.native, 'Priest');
  } finally { f.installed.dispose(); }
});

test('logout recovery retires an account lookup already in flight', async () => {
  let finish;
  const f = fixture({ confirmOffline: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await f.bridge({ version: 2, sessionId: 'old-game' });
    await f.request('/steam/action', { action: 'logout', character: 'Priest' });
    const releasing = f.bridge({ version: 2, character: null, operationId: 'op', released: true });
    assert.equal(f.state.handoff.phase, 'confirm-release');
    await f.bridge({ version: 2, sessionId: 'new-game', running: ['Priest'] });
    finish(true);
    await releasing;
    assert.equal(f.state.handoff, null);
    assert.equal(f.state.native, 'Priest');
    assert.deepEqual(f.state.steam, ['Priest']);
  } finally { f.installed.dispose(); }
});

test('re-engaging the logged-out primary cancels stale navigation and retains its Steam companions', async () => {
  const f = fixture();
  try {
    f.state.slots[0] = null;
    f.state.steam = ['Priest', 'Mage'];
    await f.bridge({ version: 2, sessionId: 'old-game', running: ['Priest', 'Mage'] });
    await f.request('/steam/action', { action: 'logout', character: 'Priest' });
    f.online.delete('Priest'); f.online.delete('Mage');
    await f.bridge({ version: 2, character: null, operationId: 'op', released: true });
    assert.equal(f.state.handoff.phase, 'navigate');
    assert.equal(f.state.handoff.multi.primary, 'Mage');
    const result = await f.bridge({ version: 2, sessionId: 'new-game', running: ['Priest'] });
    assert.equal(result.body.operation, null);
    assert.equal(f.state.native, 'Priest');
    assert.deepEqual(f.state.steam, ['Mage', 'Priest']);
    assert.deepEqual(f.state.slots, [null, 'Warrior', 'Merchant', null]);
  } finally { f.installed.dispose(); }
});
