// Real coordinator application; only the external caracAL account/game boundary is simulated.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const express = require('express');
const { createGameFixture, version } = require('./game-fixture.cjs');

const root = path.resolve(__dirname, '..');
const storageRoot = path.join(root, '.build', 'e2e');
const directory = path.resolve(process.env.E2E_DATA_DIR || path.join(storageRoot, 'coordinator'));
const relative = path.relative(storageRoot, directory);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('E2E_DATA_DIR must be a dedicated subdirectory of .build/e2e');
}
const port = Number(process.env.E2E_COORDINATOR_PORT || 18080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid E2E_COORDINATOR_PORT');
fs.mkdirSync(directory, { recursive: true });
// Managed character admission reads the real compiled class manifest, even
// when this console fixture simulates the external account transport.
fs.cpSync(path.join(root, '.build/game'), path.join(directory, 'CODE/adventure_land'), { recursive: true });
const game = createGameFixture(directory);
// Legacy migration and game-cache reads are relative to cwd. Keep them away from live caracAL data.
process.chdir(directory);
process.env.AL_SESSION = 'e2e-simulated-account';
process.env.AL_DATA_DIR = directory;
const launcherDirectory = path.join(root, '.caracal', 'standalones');
const resolve = createRequire(path.join(launcherDirectory, 'CharacterCoordinator.js'));
const characters = [
  { name: 'W', type: 'warrior', level: 80, id: 'fixture-warrior', home: 'USII' },
  { name: 'P', type: 'priest', level: 80, id: 'fixture-priest', home: 'USII' },
  { name: 'M', type: 'merchant', level: 80, id: 'fixture-merchant', home: 'USII' },
];
const servers = [{ key: 'SR_USII', region: 'US', name: 'II', players: 3 }];
const account = {
  response: { characters, servers },
  resolve_char(name) { return characters.find(character => character.name === name); },
  resolve_realm(realm) { return servers.find(server => server.key === realm); },
  async updateInfo() { return this.response; },
  add_listener() {},
};
function forbidden(operation) { throw new Error('Unsupported E2E external boundary: ' + operation); }
const deletedFixtureMail=new Set();
let inspectionReads=0;
async function gameFetch(url,options) {
  if(String(url)==='https://adventure.land/api/mainframe_get_character'){
    const form=new URLSearchParams(options.body);if(options.headers['Content-Type']!=='application/x-www-form-urlencoded' || options.headers.Cookie!=='auth=e2e-simulated-account' || [...form.keys()].join(',')!=='character')return forbidden('saved profile request contract');const body={character:form.get('character')};if(body.character!=='M')return forbidden('foreign character profile');
    inspectionReads++;return{ok:true,json:async()=>({success:true,character:'M',character_id:'fixture-merchant',shells:999,session:'must-not-expose',profile:{source:'last_account_snapshot',synchronized_at:'2026-10-18T00:00:00Z',name:'M',class:'merchant',level:42,xp:25,map:'main',x:0,y:0,rip:false,hp:321,mp:234,gold:123+inspectionReads,inventory:[{name:'coat',level:2}],equipment:{chest:{name:'coat',level:0}}}})};
  }
  if(process.env.E2E_MAILBOX==='true'&&String(url)==='https://adventure.land/api/delete_mail'){
    const args=JSON.parse(options.body),faultFile=path.join(directory,'mail-delete-fault.json'),fault=fs.existsSync(faultFile)?JSON.parse(fs.readFileSync(faultFile,'utf8')):null;
    if(!['mail-collected','mail-collected-second'].includes(args.mid))return forbidden('deletion before native attachment collection');
    const failed=!!fault?.blocked?.includes(args.mid);
    if(fault)fs.appendFileSync(path.join(directory,'mail-delete-ledger.jsonl'),JSON.stringify({at:Date.now(),id:args.mid,failed})+'\n');
    if(failed)return{ok:true,json:async()=>({failed:true,reason:'exception'})};
    deletedFixtureMail.add(args.mid);return{ok:true,json:async()=>({success:true})};
  }
  if (String(url) === 'https://adventure.land/api/pull_mail') {
    if(process.env.E2E_MAILBOX==='true'){
      const faultFile=path.join(directory,'mail-delete-fault.json');
      const extra=fs.existsSync(faultFile)?[{id:'mail-collected-second',subject:'Second collected attachment fixture',item:{name:'hpot1',q:2},taken:true}]:[];
      const mail=[{id:'mail-collected',subject:'Collected attachment fixture',item:{name:'hpot1',q:2},taken:true},...extra,
        {id:'mail-unclaimed',subject:'Unclaimed attachment fixture',item:{name:'hpot1',q:2},taken:false},
        {id:'mail-pending',subject:'Pending attachment fixture',item:{name:'hpot1',q:2},taken:'pending'},
        {id:'mail-text',subject:'Text message fixture',taken:false}].filter(m=>!deletedFixtureMail.has(m.id)).map(m=>({...m,fro:'Sender',to:'M',message:'Declared native account observation',sent:'2026-10-18T12:00:00Z'}));
      return{ok:true,json:async()=>({success:true,infs:[{type:'mail',mail,more:false}]} )};
    }
    return { ok: true, json: async () => [], text: async () => '[]' };
  }
  return forbidden('fetch ' + String(url));
}
globalThis.fetch = gameFetch;
// Fail closed for accidental direct network clients as well as fetch. Loopback HTTP is real.
for (const protocol of [http, require('node:https')]) {
  for (const method of ['request', 'get']) {
    const original = protocol[method];
    protocol[method] = function(input, ...args) {
      const target = typeof input === 'string' || input instanceof URL ? new URL(input) : input;
      const host = target.hostname || target.host || 'localhost';
      if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) return forbidden('HTTP ' + host);
      return original.call(this, input, ...args);
    };
  }
}
let startupError;
const logger = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  info: (...args) => console.log(...args),
  error: (...args) => { startupError = new Error(args.map(String).join(' ')); console.error(...args); },
};
const adapters = {
  // Test the freshly built maintained policy rather than a previous live
  // deployment's published catalog; E2E builds must not activate live assets.
  '../../dashboard/lib/event-policy.cjs': require(path.join(root, '.build/shared/event-policy.cjs')),
  // Map references resolve against the launcher directory. Read the same pinned
  // catalog from this scenario, without modifying the installed game cache.
  'node:fs': { ...fs, readFileSync(file, ...args) {
    // Activation belongs to this scenario's CODE, never the user's live launcher.
    // Otherwise a locally activated console changes the missing-record contract.
    if (typeof file === 'string' && path.resolve(file) === path.resolve(launcherDirectory, '../CODE/adventure_land/activation.json'))
      return fs.readFileSync(path.join(directory, 'CODE/adventure_land/activation.json'), ...args);
    const installedCache=path.resolve(launcherDirectory,'../game_files',String(version));
    // This console fixture declares catalog-only offline profiles. Never let an
    // installed stats cache silently change the fallback case's input boundary.
    if(typeof file==='string'&&path.dirname(path.resolve(file))===installedCache&&path.basename(file)!=='data.js')
      throw Error('Native derived-stat sources intentionally unavailable in this console fixture');
    const installedCatalog = path.resolve(launcherDirectory, '../game_files', String(version), 'data.js');
    const scenarioFile = typeof file === 'string' && path.resolve(file) === installedCatalog
      ? path.join(directory, 'game_files', String(version), 'data.js') : file;
    return fs.readFileSync(scenarioFile, ...args);
  } },
  '../config': { characters: process.env.E2E_MANAGED_MERCHANT === 'true' ? {M:{enabled:false,realm:'SR_USII'}} : {}, merchant: process.env.E2E_MERCHANT_CONNECTED === 'false' ? null : 'M', watch_CODE: false, enable_TYPECODE: false,
    web_app: { party_dashboard: true, port } },
  '../account_info': async () => account,
  '../game_files': { ensure_latest: async () => version, cull_versions: async () => {},
    available_versions: async () => [version], get_revision: async () => 'e2e-fixture',
    locate_game_file: () => forbidden('game file download') },
  '../api': () => forbidden('account mutation'),
  '../src/CONSTANTS': { LOCALSTORAGE_PATH: path.join(directory, 'state.jsonl'),
    LOCALSTORAGE_ROTA_PATH: path.join(directory, 'rotation.jsonl'), STAT_BEAT_INTERVAL: 1000 },
  '../src/LogUtils': { log: logger, console: logger, ctype_to_clid: {} },
  'node:child_process': { fork: () => forbidden('character worker launch') },
  'bot-web-interface': function() { return forbidden('legacy monitor'); },
  '../monitoring_util': {},
  express: Object.assign((...args) => express(...args), express, {
    static(file, ...args) {
      const isolated = path.resolve(file) === path.resolve(launcherDirectory, '../CODE')
        ? path.join(directory, 'CODE') : file;
      return express.static(isolated, ...args);
    },
  }),
};
async function main() {
  const { startCoordinatorApplication } = require(path.join(root, '.build/runtime/coordinator-application.cjs'));
  await startCoordinatorApplication({
    require: name => Object.hasOwn(adapters, name) ? adapters[name] : resolve(name),
    directory: launcherDirectory,
    loadFetch: async () => gameFetch,
  });
  if (startupError) throw startupError;
  await new Promise((resolveReady, reject) => {
    const request = http.get('http://127.0.0.1:' + port + '/party-api/state?section=core', response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('Coordinator state returned ' + response.statusCode);
          JSON.parse(body);
          resolveReady();
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('Coordinator readiness timed out')));
  });
  // Like characters/shared.js attachStatusInventory: items, slots and bank go
  // out on a change, on a refusal and at least every 10 s.
  const inventories = {};
  function inventoryDelta(report) {
    const fields = ['items', 'slots', 'bank'].filter(field => Object.hasOwn(report, field));
    const key = JSON.stringify(fields.map(field => report[field]));
    const held = inventories[report.name] ||= { count: 0, fullAt: 0 };
    if (held.key !== key) { held.key = key; held.revision = 'e2e-' + report.name + '.' + (++held.count); }
    const delta = { ...report, inventoryRevision: held.revision };
    if (held.acknowledged === held.revision && Date.now() - held.fullAt < 10000) for (const field of fields) delete delta[field];
    return { full: { ...report, inventoryRevision: held.revision }, delta, held };
  }
  function post(report) {
    return new Promise((resolveReport, reject) => {
      const body = JSON.stringify(report);
      const request = http.request({ hostname: '127.0.0.1', port, path: '/party-api/status', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
        let result = '';
        response.on('data', chunk => { result += chunk; });
        response.on('end', () => resolveReport({ status: response.statusCode, result }));
      });
      request.on('error', reject);
      request.setTimeout(10000, () => request.destroy(new Error('Game fixture heartbeat timed out')));
      request.end(body);
    });
  }
  async function heartbeat(catalogs = false) {
    for (const report of game.reports(catalogs)) {
      const { full, delta, held } = inventoryDelta(report);
      let sent = delta, reply = await post(delta);
      if (reply.status === 409 && !Object.hasOwn(delta, 'items')) reply = await post(sent = full);
      if (reply.status !== 200) throw new Error('Game fixture heartbeat failed: ' + reply.status + ' ' + reply.result);
      held.acknowledged = JSON.parse(reply.result).inventoryRevision;
      if (Object.hasOwn(sent, 'items')) held.fullAt = Date.now();
    }
  }
  await heartbeat(true);
  // Serial recurring reports avoid overlapping samples while retaining real coordinator timers.
  async function refresh() {
    try { await heartbeat(); setTimeout(refresh, 1000).unref(); }
    catch (error) { console.error(error); process.exit(1); }
  }
  setTimeout(refresh, 1000).unref();
  console.log(JSON.stringify({ event: 'e2e-coordinator-ready', port, directory, simulated: ['account', 'game'] }));
  if (process.send) process.send({ type: 'ready', port });
}
main().catch(error => { console.error(error); process.exit(1); });
