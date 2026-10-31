const test = require('node:test'), assert = require('node:assert/strict');
const {startCoordinatorMail} = require('../../runtime/coordinator/commerce/mail-startup.ts');

function fixture() {
  const calls = [], state = {merchantCurrent: {id: 'active'}, merchantQueue: [null, {id: 'queued'}]};
  const account = {response: {characters: [{name: 'A'}]}};
  let current, options, poll, error=null;
  const inbox = {refresh: async () => {calls.push('refresh'); error='offline';throw Error(error);},
    snapshot: () => ({messages:[{id:'mail-original',to:'A',subject:'original'}],count:1,updatedAt:100,error}), collect: async () => {}, remove: async () => {}, complete() {}};
  const ports = {persist:()=>calls.push('persist'),session: 'test-session', loadFetch: async () => assert.fail('injected inbox does not need transport'),
    timeout: () => assert.fail('no request'), createInbox: value => {options = value; calls.push('create'); return inbox;},
    enqueue: () => {}, retain: value => {current = value; calls.push('retain');}, current: () => current,
    every: (callback, milliseconds) => {poll = callback; calls.push(['every', milliseconds]); return {unref: () => calls.push('unref')};}};
  return {calls, state, account, inbox, ports, start: () => startCoordinatorMail(state, account, ports),
    get options() {return options;}, poll: () => poll()};
}

test('mail startup preserves refresh order, current-state reads and route binding', async () => {
  const t = fixture(), routes = t.start(); await Promise.resolve();
  assert.deepEqual(t.calls, ['create', 'retain', 'refresh', ['every', 30000], 'unref']);
  assert.equal(t.options.enqueue, t.ports.enqueue);
  assert.deepEqual(t.options.names(), ['A']);
  assert.deepEqual(t.options.jobs(), [t.state.merchantCurrent, t.state.merchantQueue[1]]);
  t.account.response = {characters: [{name: 'B'}]}; t.state.merchantCurrent = null;
  t.state.merchantQueue = [{id: 'replacement'}];
  assert.deepEqual(t.options.names(), ['B']); assert.equal(t.options.jobs()[0], t.state.merchantQueue[0]);
  t.ports.retain({...t.inbox, refresh: async () => t.calls.push('replacement refresh')});
  t.poll(); await Promise.resolve(); assert.equal(t.calls.at(-1), 'replacement refresh');
  let response; routes.snapshot({}, {json: value => {response = value;}});
  assert.deepEqual(response, {messages:[{id:'mail-original',to:'A',subject:'original'}],count:1,updatedAt:100,error:'offline',automationError:null,automationErrors:[],settings:{autoCollect:false,autoDelete:false},outbox:[],newCount:1});
});

test('mail transport loads fetch lazily and preserves authentication, serialization and timeout', async () => {
  const t = fixture(), requests = [], events = [], signal = new AbortController().signal;
  t.ports.loadFetch = async () => {
    events.push('load'); return async (...args) => {requests.push(args); return {ok: true, json: async () => [{type: 'mail', mail: []}]};};
  };
  t.ports.timeout = milliseconds => {events.push(['timeout', milliseconds]); return signal;};
  t.start(); assert.deepEqual(events, []);
  assert.deepEqual(await t.options.api('pull_mail', {cursor: 'next'}), [{type: 'mail', mail: []}]);
  assert.deepEqual(events, ['load', ['timeout', 20000]]);
  assert.deepEqual(requests, [['https://adventure.land/api/pull_mail', {
    method: 'POST', headers: {Cookie: 'auth=test-session', 'Content-Type': 'application/json; charset=utf-8'},
    body: '{"cursor":"next"}', signal,
  }]]);
});

test('synchronous inbox failure is visible without disabling coordinator polling', async () => {
  const t = fixture(), failure = Error('startup failure');
  const snapshot=t.inbox.snapshot;t.inbox.snapshot=()=>({...snapshot(),error:failure.message});
  t.inbox.refresh = () => {throw failure;};
  const routes=t.start();await new Promise(resolve=>setImmediate(resolve));
  let response;routes.snapshot({}, {json:value=>{response=value;}});
  assert.equal(response.error,'startup failure');
  assert.deepEqual(response.messages,[{id:'mail-original',to:'A',subject:'original'}]);
  assert.deepEqual(t.calls, ['create', 'retain', ['every',30000], 'unref']);
});
