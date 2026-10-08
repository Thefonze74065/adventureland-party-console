const test = require('node:test');
const assert = require('node:assert/strict');
const {createJsonStore} = require('../../runtime/coordinator/persistence/json-store.ts');

test('shared storage retains JSON.parse coercion and falsey snapshot defaults', () => {
  const values = new Map(), errors = [];
  const store = createJsonStore(values, {invalid: (key, error) => errors.push([key, error])});
  const state = {key: 'snapshot', decode: value => value, empty: () => 'invalid'};
  for (const value of [undefined, null, false, 0, '', NaN]) {
    values.set(state.key, value);
    assert.deepEqual(store.read(state), {});
  }
  for (const value of [42, true, 7n]) {
    values.set(state.key, value);
    assert.equal(store.read(state), JSON.parse(value));
  }
  let conversions = 0;
  values.set(state.key, {toString() {conversions++; return '{"saved":true}';}});
  assert.deepEqual(store.read(state), {saved: true});
  assert.equal(conversions, 1);
  assert.deepEqual(errors, []);
});

test('invalid shared values keep the original exception and per-document fallback', () => {
  const failure = Error('conversion failed'), errors = [];
  const values = new Map();
  const store = createJsonStore(values, {invalid: (key, error) => errors.push([key, error])});
  const state = {key: 'snapshot', decode: value => value, empty: () => 'invalid'};
  values.set(state.key, {toString() {throw failure;}});
  assert.equal(store.read(state), 'invalid');
  assert.deepEqual(errors[0], ['snapshot', failure]);
  values.set(state.key, Symbol('snapshot'));
  assert.equal(store.read(state), 'invalid');
  assert.ok(errors[1][1] instanceof TypeError);
  values.set(state.key, '{"recovered":true}');
  assert.deepEqual(store.read(state), {recovered: true});
});

test('native object snapshots coexist with legacy JSON strings',()=>{
 const values=new Map([['snapshot',{saved:true}]]),store=createJsonStore(values,{invalid(){throw Error('invalid');}});
 const state={key:'snapshot',decode:value=>value,empty:()=>null};assert.deepEqual(store.read(state),{saved:true});
 values.set('snapshot','{"saved":true}');assert.deepEqual(store.read(state),{saved:true});
});
