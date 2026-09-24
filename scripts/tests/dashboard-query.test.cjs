const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/dashboard-query-module.cjs');
const { QueryObserver } = require('../../dashboard/node_modules/@tanstack/react-query');
const { createDashboardClient, domainOptions, key, transientRetry, ReadError } = load('query-cache.tsx');
const { affectedDomains, performAction } = load('query-actions.ts');
test('cache deduplicates concurrent reference reads and garbage collects unused entries', async () => {
  const client = createDashboardClient(); let calls = 0;
  const options = { queryKey: ['party', 'reference', 'r1', 'map', 'main'], staleTime: Infinity, gcTime: 20,
    queryFn: async () => { calls++; return { map: 'main' }; } };
  const [first, second] = await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
  assert.equal(first, second); assert.equal(calls, 1); await client.fetchQuery(options); assert.equal(calls, 1);
  await new Promise(done => setTimeout(done, 40)); assert.equal(client.getQueryData(options.queryKey), undefined); client.clear();
});
test('recurring reads do not retry, failed mutations preserve cache and never replay', async () => {
  const client = createDashboardClient(); client.setQueryData(key('inventory'), { confirmed: true });
  assert.equal(client.getDefaultOptions().queries.retry, false); assert.equal(client.getDefaultOptions().mutations.retry, false);
  const original = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 500, json: async () => ({ error: 'failed' }) }; };
  try { await assert.rejects(performAction(client, '/merchant/send-mail', {}), /failed/);
    assert.equal(calls, 1); assert.deepEqual(client.getQueryData(key('inventory')), { confirmed: true });
  } finally { global.fetch = original; client.clear(); }
  assert.equal(transientRetry(0, new ReadError(401, 'auth')), false);
  assert.equal(transientRetry(0, new ReadError(400, 'validation')), false);
  assert.equal(transientRetry(0, new ReadError(503, 'outage')), true);
  assert.equal(transientRetry(1, new ReadError(503, 'outage')), false);
});
test('action domains are precise and inactive bank and market queries become stale without fetching', async () => {
  assert.deepEqual(affectedDomains('/formation'), ['core', 'config']);
  assert.deepEqual(affectedDomains('/combat-log/A/clear'), ['logs']);
  assert.throws(() => affectedDomains('/unmapped-action'), /Missing action/);
  const client = createDashboardClient(); let reads = 0;
  client.setQueryDefaults(key('market'), { queryFn: async () => { reads++; return {}; } }); client.setQueryData(key('market'), {});
  const original = global.fetch; global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ queued: true }) });
  try { await performAction(client, '/merchant/aldata-order', {});
    assert.equal(reads, 0); assert.equal(client.getQueryState(key('market')).isInvalidated, true);
  } finally { global.fetch = original; client.clear(); }
});
test('late fallback responses cannot overwrite a fresh stream snapshot', async () => {
  const client = createDashboardClient(); let finish;
  client.setQueryData(['party', 'connection'], { healthy: false, version: 1 });
  const original = global.fetch; global.fetch = () => new Promise(resolve => { finish = resolve; });
  try {
    const pending = client.fetchQuery(domainOptions(client, 'fast'));
    client.setQueryData(['party', 'connection'], { healthy: true, version: 2 });
    client.setQueryData(['party', 'character', 'A', 'vitals'], { hp: 50 });
    finish({ ok: true, status: 200, json: async () => ({ characters: { A: { hp: 100 } } }) }); await pending;
    assert.deepEqual(client.getQueryData(['party', 'character', 'A', 'vitals']), { hp: 50 });
  } finally { global.fetch = original; client.clear(); }
});
test('structural sharing sends no content notifications for unchanged telemetry', () => {
  const client = createDashboardClient(), queryKey = ['party', 'character', 'A', 'inventory'];
  const value = { items: [{ item: { name: 'coat' } }], slots: {} }; client.setQueryData(queryKey, value);
  const observer = new QueryObserver(client, { queryKey, enabled: false, notifyOnChangeProps: ['data'] });
  let renders = 0; const unsubscribe = observer.subscribe(() => renders++);
  client.setQueryData(queryKey, JSON.parse(JSON.stringify(value))); assert.equal(renders, 0);
  client.setQueryData(['party', 'character', 'A', 'vitals'], { hp: 50 }); assert.equal(renders, 0);
  unsubscribe(); client.clear();
});

test('legacy catalog responses cannot overwrite account state or character snapshots', async () => {
 const client=createDashboardClient(), original=global.fetch;
 global.fetch=async()=>({ok:true,status:200,json:async()=>({threshold:1,characters:{A:{hp:1}},merchantCatalog:{allItems:[]}})});
 try {
  const result=await client.fetchQuery(domainOptions(client,'catalog'));
  assert.deepEqual(result,{merchantCatalog:{allItems:[]}});
 } finally {global.fetch=original;client.clear();}
});
test('authentication loss clears all account-scoped caches', async () => {
 const client=createDashboardClient(), original=global.fetch;
 client.setQueryData(['party','character','A','inventory'],{items:[{name:'coat'}]});
 global.fetch=async()=>({ok:false,status:401});
 try {
  await assert.rejects(client.fetchQuery(domainOptions(client,'core')));
  assert.equal(client.getQueryData(['party','character','A','inventory']),undefined);
 } finally {global.fetch=original;client.clear();}
});

test('material conflict preserves structured shortages, invalidates commerce and never resubmits', async () => {
 const client=createDashboardClient(), original=global.fetch;let posts=0;
 const missing=[{id:'intring',level:0,required:4,available:3,quantity:1}];
 for(const domain of ['core','inventory','fast','bank','market']) client.setQueryData(key(domain),{});
 global.fetch=async()=>{posts++;return {ok:false,status:409,json:async()=>({error:'crafting materials are no longer available',missing})}};
 try {
  await assert.rejects(performAction(client,'/merchant/order',{}),error=>error.status===409 && error.details.missing===missing);
  assert.equal(posts,1);
  for(const domain of ['inventory','bank']) assert.equal(client.getQueryState(key(domain)).isInvalidated,true);
 } finally {global.fetch=original;client.clear()}
});
