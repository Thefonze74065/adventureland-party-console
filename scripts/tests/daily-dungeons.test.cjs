const test = require('node:test');
const assert = require('node:assert/strict');
const { createDungeons } = require('../../runtime/coordinator/dungeons/service.ts');
const { installDungeonRuntime } = require('../../runtime/characters/dungeons.ts');
const { createDungeonJournal } = require('../../runtime/characters/dungeon-journal.ts');
const { createDeathRecovery } = require('../../runtime/characters/roles/death-recovery.ts');

const cave = () => ({ run: 'run-1', floor: 0, expires: 200000, server_time: 100000, remaining_ms: 100000,
  paused: false, gold: 100, amber: 2, points: [], choice: { id: 'choice-1', title: 'Shop', text: '',
    deadline: 200000, resolved: true, votes: {}, options: [], shop: { room: 'shop-1', name: 'Potion', price: 20, sold: false, nearby: true } } });
function fixture() {
  let now = 100000;
  const party = { leader: 'W', followers: { P: true, M: true }, merchantCharacter: 'Bank', statuses: {} };
  for (const name of ['W', 'P', 'M']) party.statuses[name] = { seenAt: now, server: 'II', rip: false, map: 'main', x: 816, y: 1200,
    dungeon: { protocol: 1, at: now, supported: true, alive: true, ready: true, members: ['W', 'P', 'M'], leader: 'W', cave: null,
      visit: { available: true, checkedAt: now, resets: now + 86400000, home: 'II' }, keeper: { map: 'main', x: 816, y: 1200 } } };
  const service = createDungeons(party, { now: () => now, persist() {}, cancel() {} });
  const action = (body) => service.action({ operationId: 'op-' + Math.random(), ...body });
  function active() {
    action({ action: 'enter' });
    for (const name of ['W', 'P', 'M']) party.statuses[name].dungeon.action = { id: party.dailyDungeons.commands[name].id, status: 'complete' };
    service.reconcile();
    for (const name of ['W', 'P', 'M']) party.statuses[name].dungeon.cave = cave();
    service.reconcile();
  }
  return { party, service, action, active, advance: ms => { now += ms; } };
}
test('persisted Cave travel without leader observations returns no route', () => {
 const f=fixture();
 f.party.dailyDungeons={protectFromEvents:true,participants:[],phase:'idle',commands:{},operations:[],travel:{stage:'travelling'}};
 assert.equal(f.service.control('W').route,undefined);
});
test('manual entry excludes merchant, validates eligibility again at Dorr, and enters only through leader', () => {
  const f = fixture(); f.party.followers.Bank = true;
  f.action({ action: 'enter' });
  assert.deepEqual(f.party.dailyDungeons.participants, ['W', 'P', 'M']);
  for (const name of ['W', 'P', 'M']) f.party.statuses[name].dungeon.action = { id: f.party.dailyDungeons.commands[name].id, status: 'complete' };
  f.party.statuses.P.dungeon.visit.available = false; f.service.reconcile();
  assert.equal(f.party.dailyDungeons.phase, 'gathering');
  f.party.statuses.P.dungeon.visit.available = true; f.service.reconcile();
  assert.equal(f.party.dailyDungeons.commands.W.action, 'enter');
  assert.equal(f.party.dailyDungeons.commands.P.action, 'gather');
});
test('default protection blocks events; disabling waits for all members to exit', () => {
  const f = fixture(); f.active();
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), false);
  assert.equal(f.party.dailyDungeons.phase, 'active');
  f.action({ action: 'settings', protectFromEvents: false });
  assert.equal(f.service.eventAllowed('W', 'anniversary', false), false);
  assert.equal(f.party.dailyDungeons.phase, 'active');
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), false);
  f.party.statuses.W.dungeon.cave = null; f.service.reconcile();
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), false);
  for (const name of ['P', 'M']) f.party.statuses[name].dungeon.cave = null;
  f.service.reconcile();
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), true);
});
test('reenabling protection cancels only exits not yet delivered', () => {
  const f = fixture(); f.active();
  f.action({ action: 'settings', protectFromEvents: false });
  f.service.eventAllowed('W', 'franky', true);
  f.action({ action: 'settings', protectFromEvents: true });
  assert.equal(f.party.dailyDungeons.phase, 'active');
  f.action({ action: 'settings', protectFromEvents: false });
  f.service.eventAllowed('W', 'franky', true); f.service.control('P');
  f.action({ action: 'settings', protectFromEvents: true });
  assert.equal(f.party.dailyDungeons.phase, 'exiting');
});
test('purchase cannot overwrite an outstanding purchase; exit remains available', () => {
  const f = fixture(); f.active();
  f.action({ action: 'buy', run: 'run-1', choice: 'choice-1', cost: 20, confirmed: true });
  assert.throws(() => f.action({ action: 'buy', run: 'run-1', choice: 'choice-1', cost: 20, confirmed: true }), /reconciliation/);
  f.action({ action: 'exit' });
  assert.equal(f.party.dailyDungeons.phase, 'exiting');
});
test('uncertain receipt survives later actions and journal reload', () => {
  let saved;
  const write = value => { saved = structuredClone(value); };
  const first = createDungeonJournal(() => null, write);
  first.save({ id: 'buy', action: 'buy', run: 'run-1', choice: 'choice-1', room: 'shop-1' }, 'uncertain');
  first.save({ id: 'exit', action: 'exit' }, 'complete');
  const next = createDungeonJournal(() => saved, write);
  assert.equal(next.blocked(), true);
  const observed = cave(); observed.choice.shop.sold = true;
  next.reconcile(observed, 'W');
  assert.equal(next.get('buy').status, 'complete');
});
test('lost entry reply is never retried after reload, but exit is dispatched', async () => {
  let saved = null, raw = null; const calls = [];
  const ports = { name: 'W', members: () => ['W'], leader: () => 'W', ready: () => true, now: () => 100000, alive: () => true, current: () => true, cave: () => raw,
    supported: () => true, info: async () => ({ available: true, resets: 200000, server_time: 100000, home: 'II' }),
    request: async action => { calls.push(action); throw { reason: 'timeout' }; }, keeper: () => undefined,
    text: String, move: async () => {}, stop: async () => {},
    read: () => saved, write: value => { saved = structuredClone(value); } };
  const first = installDungeonRuntime(ports);
  first.receive({ owned: true, command: { id: 'enter', action: 'enter' } });
  await new Promise(setImmediate);
  const second = installDungeonRuntime(ports);
  second.receive({ owned: true, command: { id: 'enter', action: 'enter' } });
  await new Promise(setImmediate); assert.deepEqual(calls, ['enter']);
  raw = cave(); second.receive({ owned: true, command: { id: 'exit', action: 'exit' } });
  await new Promise(setImmediate); assert.deepEqual(calls, ['enter', 'exit']);
});
test('storage failure prevents irreversible dispatch', async () => {
  const calls = [];
  const runtime = installDungeonRuntime({ name: 'W', members: () => ['W'], leader: () => 'W', ready: () => true, now: () => 1, alive: () => true, current: () => true,
    cave: () => null, supported: () => true, info: async () => ({}), request: async () => calls.push('request'),
    keeper: () => undefined, text: String, move: async () => {}, stop: async () => {},
    read: () => null, write: () => { throw Error('storage unavailable'); } });
  runtime.receive({ owned: true, command: { id: 'entry', action: 'enter' } });
  await new Promise(setImmediate); assert.deepEqual(calls, []);
});
test('normal death recovery remains paused under dungeon ownership', async () => {
  const calls = [];
  const recover = createDeathRecovery({ isDead: () => true, blocked: () => true, respawn: async () => calls.push('respawn'),
    releaseCombat() {}, publish() {}, rejoinEvent: async () => { calls.push('event'); return { status: 'not-applicable' }; },
    rejoinFarm() { calls.push('farm'); }, log() {}, setTimeout, clearTimeout });
  await recover(); assert.deepEqual(calls, []);
});

test('stale or excessive participants cannot spend the daily entry', () => {
  const f = fixture(); f.party.followers.Extra = true;
  f.party.statuses.Extra = { seenAt: 100000 };
  assert.throws(() => f.action({ action: 'enter' }), /at most two/);
  delete f.party.followers.Extra; f.advance(4000);
  assert.throws(() => f.action({ action: 'enter' }), /fresh/);
});
test('paid votes reject missing confirmation or changed currency quotes', () => {
  const f = fixture(); f.active();
  for (const name of ['W', 'P', 'M']) {
    const choice = f.party.statuses[name].dungeon.cave.choice;
    choice.resolved = false; choice.options = [{ id: 'here', label: 'Revive here', amber: 2 }];
  }
  const vote = { action: 'vote', run: 'run-1', choice: 'choice-1', option: 'here' };
  assert.throws(() => f.action(vote), /Confirm/);
  assert.throws(() => f.action({ ...vote, confirmed: true, amber: 1 }), /cost changed/);
  f.action({ ...vote, confirmed: true, amber: 2 });
  assert.equal(Object.values(f.party.dailyDungeons.commands).filter(c => c.action === 'vote').length, 3);
});
test('disconnect preserves ownership and manual exit can retry a lost exit reply', () => {
  const f = fixture(); f.active(); f.advance(4000);
  f.service.reconcile(); assert.equal(f.party.dailyDungeons.phase, 'active');
  f.action({ action: 'exit' });
  const first = f.party.dailyDungeons.commands.W.id;
  f.action({ action: 'exit' });
  assert.notEqual(f.party.dailyDungeons.commands.W.id, first);
  assert.equal(f.party.dailyDungeons.phase, 'exiting');
});
test('natural expiry holds outside and a returning late entry is exited again', () => {
  const f = fixture(); f.active();
  for (const name of ['W', 'P', 'M']) f.party.statuses[name].dungeon.cave = null;
  f.service.reconcile(); assert.equal(f.party.dailyDungeons.phase, 'held');
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), false);
  f.party.statuses.W.dungeon.cave = cave();
  f.service.reconcile(); assert.equal(f.party.dailyDungeons.phase, 'exiting');
});
test('coordinator restart preserves entry identity instead of creating another entry', () => {
  const f = fixture(); f.action({ action: 'enter' });
  for (const name of ['W', 'P', 'M']) f.party.statuses[name].dungeon.action = { id: f.party.dailyDungeons.commands[name].id, status: 'complete' };
  f.service.reconcile();
  const restored = structuredClone(f.party), id = restored.dailyDungeons.commands.W.id;
  const next = createDungeons(restored, { now: () => 100000, persist() {}, cancel() {} });
  next.reconcile(); assert.equal(next.control('W').command.id, id);
  assert.equal(restored.dailyDungeons.phase, 'entering');
});

test('entering invalidates cached availability until fresh server eligibility arrives', async () => {
  let raw = null;
  const runtime = installDungeonRuntime({ name: 'W', members: () => ['W'], leader: () => 'W', ready: () => true,
    now: () => 100000, alive: () => true, current: () => true, cave: () => raw, supported: () => true,
    info: async () => ({ available: !raw, resets: 200000, server_time: 100000, home: 'II' }),
    request: async () => {}, keeper: () => undefined, text: String, move: async () => {}, stop: async () => {},
    read: () => null, write() {} });
  runtime.report(); await new Promise(setImmediate);
  assert.equal(runtime.report().visit.available, true);
  raw = cave(); assert.equal(runtime.report().visit, undefined);
  await new Promise(setImmediate); assert.equal(runtime.report().visit.available, false);
});

test('observed Nera choice releases a pending respawn so fallen participants can vote', async () => {
  const raw = cave(); delete raw.choice;
  let rejectRevival; const calls = [];
  const runtime = installDungeonRuntime({ name: 'W', members: () => ['W'], leader: () => 'W', ready: () => false,
    now: () => 100000, alive: () => false, current: () => true, cave: () => raw, supported: () => true,
    info: async () => ({}), request(action) { calls.push(action); return action === 'revival' ? new Promise((_, reject) => { rejectRevival = reject; }) : Promise.resolve(); },
    keeper: () => undefined, text: String, move: async () => {}, stop: async () => {},
    read: () => null, write() {} });
  runtime.receive({ owned: true, command: { id: 'revival', action: 'revival', run: 'run-1' } });
  await new Promise(setImmediate);
  raw.choice = { id: 'nera', title: 'Nera', text: '', deadline: 160000, resolved: false, votes: {}, options: [{ id: 'door', label: 'Doorway' }] };
  runtime.receive({ owned: true, command: { id: 'vote', action: 'vote', run: 'run-1', choice: 'nera', option: 'door', cost: 0, amber: 0 } });
  await new Promise(setImmediate); assert.deepEqual(calls, ['revival', 'vote']);
  rejectRevival({ reason: 'timeout' }); await new Promise(setImmediate);
  assert.equal(runtime.report().action.status, 'complete');
});

test('cave route pauses immediately for local combat and resumes only with fresh party readiness',()=>{
  let now=100000, ready=true;const raw=cave();
  const runtime=installDungeonRuntime({name:'W',members:()=>['W'],leader:()=> 'W',ready:()=>ready,
    now:()=>now,alive:()=>true,current:()=>true,cave:()=>raw,supported:()=>true,
    info:async()=>({}),request:async()=>{},keeper:()=>undefined,text:String,
    move:async()=>{},stop:async()=>{},read:()=>null,write:()=>{}});
  runtime.receive({owned:true,movementReady:true});assert.equal(runtime.canMove(),true);
  ready=false;assert.equal(runtime.canMove(),false,'local aggro blocks travel before next heartbeat');
  ready=true;assert.equal(runtime.canMove(),true);
  raw.paused=true;assert.equal(runtime.canMove(),false);
  raw.paused=false;now+=3001;assert.equal(runtime.canMove(),false,'stale control must hold route');
  runtime.receive({owned:true,movementReady:true});assert.equal(runtime.canMove(),true);
});


test('entry ignores missing and offline saved followers but includes online followers', () => {
  const f = fixture();
  f.party.followers.Missing = true;
  f.party.followers.Offline = true;
  f.party.statuses.Offline = { seenAt: 90000 };
  assert.deepEqual(f.service.snapshot().members.map(m => m.name), ['W', 'P', 'M']);
  f.action({ action: 'enter' });
  assert.deepEqual(f.party.dailyDungeons.participants, ['W', 'P', 'M']);
  assert.deepEqual(Object.keys(f.party.dailyDungeons.commands), ['W', 'P', 'M']);
});

test('an online follower with a delayed heartbeat blocks entry instead of being omitted', () => {
  const f = fixture();
  f.party.statuses.P.seenAt = 96000;
  assert.deepEqual(f.service.snapshot().members.map(m => m.name), ['W', 'P', 'M']);
  assert.throws(() => f.action({ action: 'enter' }), /P: fresh/);
});

test('offline leader is retained and blocks entry', () => {
  const f = fixture();
  f.party.statuses.W.seenAt = 0;
  assert.deepEqual(f.service.snapshot().members.map(m => m.name), ['W', 'P', 'M']);
  assert.throws(() => f.action({ action: 'enter' }), /fresh/);
});

test('captured dungeon participants survive disconnect and coordinator restart', () => {
  const f = fixture(); f.active();
  f.party.statuses.P.seenAt = 0;
  f.party.followers.P = false;
  const next = createDungeons(structuredClone(f.party), { now: () => 100000, persist() {}, cancel() {} });
  assert.deepEqual(next.snapshot().members.map(m => m.name), ['W', 'P', 'M']);
  assert.equal(next.control('P').owned, true);
});

function eligibilityRuntime(info) {
  let now = 100000;
  const runtime = installDungeonRuntime({ name: 'W', members: () => ['W'], leader: () => 'W', ready: () => true,
    now: () => now, alive: () => true, current: () => true, cave: () => null, supported: () => true,
    info, request: async () => {}, keeper: () => undefined, text: String, move: async () => {}, stop: async () => {},
    read: () => null, write() {} });
  return { runtime, advance: ms => now += ms };
}
test('eligibility retries a hung read and ignores its late response', async () => {
  let firstResolve, calls = 0;
  const f = eligibilityRuntime(() => ++calls === 1 ? new Promise(resolve => firstResolve = resolve) : Promise.resolve({available: true, resets: 300000, server_time: 117000, home: 'II'}));
  f.runtime.report();
  f.advance(12000);
  assert.match(f.runtime.report().visitError, /timed out/);
  f.advance(5000); f.runtime.report(); await new Promise(setImmediate);
  assert.equal(f.runtime.report().visit.available, true);
  firstResolve({available: false, resets: 300000, server_time: 100000, home: 'II'});
  await new Promise(setImmediate);
  assert.equal(f.runtime.report().visit.available, true);
  assert.equal(f.runtime.report().visitError, undefined);
  assert.equal(calls, 2);
});
test('eligibility exposes Steam request failures and clears them after recovery', async () => {
  let calls = 0;
  const f = eligibilityRuntime(async () => {
    if (++calls === 1) throw { reason: 'timeout' };
    return { available: true, resets: 300000, server_time: 105000, home: 'II' };
  });
  f.runtime.report(); await new Promise(setImmediate);
  assert.equal(f.runtime.report().visitError, 'timeout');
  assert.equal(f.runtime.report().visit, undefined);
  f.advance(5000); f.runtime.report(); await new Promise(setImmediate);
  assert.equal(f.runtime.report().visitError, undefined);
  assert.equal(f.runtime.report().visit.available, true);
});

for (const native of [false, true]) test('cave choice text remains readable with ' + (native ? 'native translations' : 'headless translation fallback'), () => {
  const raw = cave();
  raw.choice.title = 'The Shop with One Item'; raw.choice.title_message = {phrase: 'shop.title'};
  raw.choice.text = 'Have a look.'; raw.choice.text_message = {phrase: 'shop.text'};
  raw.choice.options = [
    {id: 'open', label: 'Open the shop', label_message: {phrase: 'shop.open'}},
    {id: 'leave', label: "We don't need it", label_message: {phrase: 'shop.leave'}, unavailable: 'Not nearby', unavailable_message: {phrase: 'shop.far'}}
  ];
  raw.objectives = [{floor: 0, x: 1, y: 2, name: 'Meda', name_message: {phrase: 'shop.npc'}}];
  const translate = value => native && value?.phrase ? 'Translated ' + value.phrase : String(value || '');
  const runtime = installDungeonRuntime({name:'W', members:()=>['W'], leader:()=> 'W', ready:()=>true, now:()=>100000,
    alive:()=>true, current:()=>true, cave:()=>raw, supported:()=>false, info:async()=>({}), request:async()=>{},
    keeper:()=>undefined, text:translate, move:async()=>{}, stop:async()=>{}, read:()=>null, write(){} });
  const observed = runtime.report().cave;
  assert.equal(observed.choice.title, native ? 'Translated shop.title' : 'The Shop with One Item');
  assert.equal(observed.choice.text, native ? 'Translated shop.text' : 'Have a look.');
  assert.deepEqual(observed.choice.options.map(o=>o.label), native ? ['Translated shop.open','Translated shop.leave'] : ['Open the shop', "We don't need it"]);
  assert.equal(observed.choice.options[1].unavailable, native ? 'Translated shop.far' : 'Not nearby');
  assert.equal(observed.points[0].label, native ? 'Translated shop.npc' : 'Meda');
});
