const fs = require('node:fs/promises');
const path = require('node:path');
const webUrl = process.env.AL_DEBUG_INSTANCE === '1' ? 'http://127.0.0.1:8090' : 'http://127.0.0.1:8083';
const gameUrl = process.env.AL_DEBUG_INSTANCE === '1' ? 'http://127.0.0.1:7192' : 'http://127.0.0.1:9003';
const roster = [
  { name: 'E2EWarrior', type: 'warrior' },
  { name: 'E2EPriest', type: 'priest' },
  { name: 'E2EMerchant', type: 'merchant' },
];
async function admin(code, data = {}, realm = 'USI') {
  if (!['USI','USII'].includes(realm)) throw Error('Unknown disposable native realm: '+realm);
  if (realm==='USII' && process.env.AL_DEBUG_INSTANCE==='1') throw Error('Debug instance has no second native realm');
  const endpoint = realm==='USII' ? gameUrl.replace(':9003',':9004') : gameUrl;
  const response = await fetch(endpoint + '/server.api/eval', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    // Upstream logs eval errors but can serialize a rejected output Promise as
    // {}. Preserve an explicit success/error envelope so setup cannot silently
    // continue after a missing fixture or failed database mutation.
    body: new URLSearchParams({ spass: 'al-e2e-disposable-admin', code: `try {
      ${code}
      ;output=Promise.resolve(output).then(value=>({e2eAdminOk:true,value}),error=>({e2eAdminOk:false,error:String(error),stack:error.stack}));
    } catch(error) { output={e2eAdminOk:false,error:String(error),stack:error.stack}; }`, data: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Upstream admin failed: ' + response.status);
  const result = await response.json();
  if (result?.e2eAdminOk !== true) throw new Error('Upstream eval failed: ' + JSON.stringify(result));
  if (result.value === '') throw new Error('Upstream eval did not set output: ' + code.slice(0, 160));
  return result.value;
}
async function api(method, args, auth) {
  const response = await fetch(webUrl + '/api', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(auth ? { cookie: 'auth=' + auth } : {}) },
    body: new URLSearchParams({ method, arguments: JSON.stringify(args) }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.failed) throw new Error(method + ': ' + JSON.stringify(result));
  return { result, cookie: response.headers.getSetCookie().find(value => value.startsWith('auth='))?.split(';')[0].slice(5) };
}
async function bootstrap() {
  let account = await admin("output=db.collection('user').findOne({'info.email':'e2e@example.test'})");
  if (!account) {
    await api('signup_or_login', { email: 'e2e@example.test', password: 'DisposableE2EAccount42', only_signup: true });
    account = await admin("output=db.collection('user').findOne({'info.email':'e2e@example.test'})");
  }
  if (!account) throw new Error('Disposable account registration did not persist');
  // Explicit local account entitlement: the upstream web admission and reward
  // handlers expect verified ownership even when no Steam service is configured.
  // This marker exists only in the disposable local database, never on Steam.
  await admin("output=db.collection('user').updateOne({_id:data.owner},{$set:{'info.verified':1,'info.legacy_override':true,pid:'e2e-local-entitlement'}})", { owner: account._id });
  const auth = account._id + '-' + account.info.auths.at(-1);
  for (const character of roster) {
    if (!account.info.characters.some(existing => existing.name === character.name)) {
      await api('create_character', { name: character.name, char: character.type, look: 0 }, auth);
    }
  }
  account = await admin("output=db.collection('user').findOne({'info.email':'e2e@example.test'})");
  await admin(`output=(async()=>{
    if (!globalThis.__e2eBaseline) {
      var characters=await db.collection('character').find({owner:data.owner}).toArray();
      for (var c of characters) {
        c.level=80; c.xp=0; c.online=false; c.server='';
        Object.assign(c.info,{gold:10000000,map:'main',in:'main',x:0,y:0,hp:10000,mp:10000,rip:false});
        c.info.items=[{name:'hpot1',q:1000},{name:'mpot1',q:1000}];
        c.info.slots=JSON.parse(JSON.stringify(G.classes[c.type].base_slots||{}));
        c.info.slots.helmet={name:'helmet',level:0}; c.info.slots.shoes={name:'shoes',level:0};
        c.info.s={}; c.info.p={home:'USI'};
        await db.collection('character').replaceOne({_id:c._id},c);
      }
      globalThis.__e2eBaseline=characters;
    }
    return true;
  })()`, { owner: account._id });
  const manifest = {
    webUrl, gameUrl, auth, region: 'US', server: 'I',
    revisions: { game: '90052162eb3ebda36c893e1eb4af643913c8f984', common: 'fa74fabf5d3782503712621e037bfb934ecb8439', config: '6b3493be30abe367cfaf879a2d5ad370742e0866' },
    initialState: { level: 80, gold: 10000000, map: 'main', x: 0, y: 0, home: 'USI', accountVerified: true, localEntitlement: 'e2e-local-entitlement', legacyWebAccess: true },
    characters: account.info.characters.map(({ id, name, type }) => ({ id, name, type })),
  };
  const output = path.resolve('.build/e2e-live/account.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(manifest, null, 2));
  return manifest;
}
async function reset() {
  const manifest = await bootstrap();
  const realms = process.env.AL_DEBUG_INSTANCE==='1' ? ['USI'] : ['USI','USII'];
  for (const realm of realms) await admin("Object.values(players).forEach(p=>p.socket.disconnect(true)); output=true",{},realm);
  // Native disconnect persists character/account state and waits for in-flight
  // bank transactions. CI recorded a successful merchant logout 15 seconds
  // after the fighters; the former 10-second ceiling failed the next scenario.
  const disconnectDeadline = Date.now() + 45000;
  for (;;) {
    const remainingCounts = await Promise.all(realms.map(realm=>admin('output=Object.keys(players).length+Object.keys(dc_players).length',{},realm)));
    if (remainingCounts.every(count=>count===0)) break;
    if (Date.now() >= disconnectDeadline) {
      const remaining = await Promise.all(realms.map(realm=>admin('output=[...Object.values(players),...Object.values(dc_players)].map(p=>({name:p.name,map:p.map,stopping:!!p.stop_call,syncing:!!p.sync_call,mounting:!!p.mount_call,unmounting:!!p.unmount_call}))',{},realm)));
      throw new Error('Previous game clients did not finish native disconnect: ' + JSON.stringify(remaining));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Wait for upstream disconnection persistence before restoring initial records.
  await new Promise(resolve => setTimeout(resolve, 1000));
  await admin(`output=(async()=>{
    // Disconnected Cave runs retain a resumable visit. Retire only this
    // disposable account's runs through native teardown before restoring it.
    for (var run of Object.values(generated_runs))
      if (run.members.every(member=>member.owner===data.owner)) destroy_generated_run(run.key,'e2e-reset');
    events.goobrawl=false; events.anniversary=false; delete timers.goobrawl; delete E.goobrawl;
    anniversary_tick(); anniversary_controller=null; broadcast_e();
    // Recover isolated encounter setup even if a scenario timed out before finally.
    for (var instance of Object.values(instances))
      for (var monster of Object.values(instance.monsters || {}))
        if (monster.e2eHunt || monster.type==='fieldgen0' && monster.owner==='E2EWarrior') remove_monster(monster,{silent:true});
    for (var [type,definition] of Object.entries(globalThis.__e2eHuntRareOriginal || {})) {
      for (var key of Object.keys(G.monsters[type]))
        if (!Object.hasOwn(definition,key)) delete G.monsters[type][key];
      Object.assign(G.monsters[type],definition);
    }
    delete globalThis.__e2eHuntRareOriginal;
    // Unclaimed drops belong to the previous disconnected scenario, never the
    // next scenario's conservation or loot assertions.
    for (var chestId of Object.keys(chests)) delete chests[chestId];
    events.franky=false; delete timers.franky; delete E.franky;
    for (var monster of Object.values(instances.level2w?.monsters || {}))
      if (['franky','nerfedmummy'].includes(monster.type)) remove_monster(monster,{silent:true});
    if (globalThis.__e2eFrankyDefinition) {
      Object.assign(G.monsters.franky,globalThis.__e2eFrankyDefinition);
      delete globalThis.__e2eFrankyDefinition;
    }
    if (globalThis.__e2eFrankyBoundary) {
      G.maps.level2w.monsters[0].boundary=globalThis.__e2eFrankyBoundary;
      delete globalThis.__e2eFrankyBoundary;
    }
    broadcast_e();
    // The native event timer deliberately leaves surviving goos. Clear only
    // between scenarios, after disconnection/persistence has completed above.
    for (var monster of Object.values(instances.goobrawl?.monsters || {})) remove_monster(monster,{silent:true});
    if (globalThis.__e2eGoobrawlDefinitions) {
      for (var type of ['bgoo','rgoo']) G.monsters[type].hp=globalThis.__e2eGoobrawlDefinitions[type];
      delete globalThis.__e2eGoobrawlDefinitions;
    }
    for (var baseline of globalThis.__e2eBaseline) {
      var c=structuredClone(baseline); c.online=false; c.server='';
      c.info.p.home='USI';
      await db.collection('character').replaceOne({_id:c._id},c);
    }
    await db.collection('user').updateOne({_id:data.owner},{$set:{server:'','info.gold':1000000,'info.items0':[],'info.items1':[]}});
    return true;
  })()`, { owner: manifest.auth.split('-')[0] });
  return manifest;
}
module.exports = { bootstrap, reset, admin, webUrl, gameUrl };
if (require.main === module) bootstrap().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
