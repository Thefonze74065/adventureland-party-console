const {isLoopback}=require('./game/addresses.cjs');
// Production coordinator, with account/client-file transport pointed at the disposable upstream server.
require('../tools/sim/network-clock.cjs').install();
// Character status and every game action come from actual browser CODE runtimes.
const fs = require('node:fs');
const path = require('node:path');
const {createHash}=require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.env.E2E_DATA_DIR || '');
const relative = path.relative(path.join(root, '.build/e2e'), directory);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Dedicated E2E_DATA_DIR required');
const webUrl = process.env.E2E_GAME_WEB_URL;
if (!webUrl || !isLoopback(new URL(webUrl).hostname)) throw Error('Local upstream web URL required');
const auth = process.env.E2E_GAME_AUTH;
if (!auth) throw Error('Disposable account auth required');
let port = Number(process.env.E2E_COORDINATOR_PORT);
const nativeFetch = globalThis.fetch;
async function localFetch(input, init) {
  let url = new URL(String(input));
  if (url.hostname === 'adventure.land') url = new URL(url.pathname + url.search, webUrl);
  if (!isLoopback(url.hostname)) throw Error('Unexpected nonlocal request: ' + url.origin);
  return nativeFetch(url, init);
}
globalThis.fetch = localFetch;
async function api(method, body = {}) {
  const response = await localFetch(webUrl + '/api/' + method, { method: 'POST',
    headers: { Cookie: 'auth=' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw Error('Upstream API ' + method + ': ' + response.status);
  return response.json();
}
const account = {
  response: null, listeners: [],
  async updateInfo() {
    const raw = await api('servers_and_characters');
    const info = Array.isArray(raw) ? raw[0] : raw.servers ? raw : raw.infs?.find(value => value.type === 'servers_and_characters');
    if (!Array.isArray(info?.characters) || !Array.isArray(info?.servers)) throw Error('Local account API returned no roster');
    this.response = info;
    for (const listener of this.listeners) listener(info);
    return info;
  },
  resolve_char(name) { return this.response.characters.find(character => character.name === name); },
  resolve_realm(realm) {
    const server = this.response.servers.find(server => server.key === realm || server.region + server.name === realm);
    const port = server?.region==='US' && server?.name==='II' ? '9004' : '9003';
    return server && { ...server, address: new URL(webUrl).origin.replace(':8083', ':'+port).replace(':8090', ':7192') };
  },
  add_listener(listener) { this.listeners.push(listener); },
};
const resolve = createRequire(path.join(root, '.caracal/standalones/CharacterCoordinator.js'));
const nativeExpress = require('express');
let listener;
const fixtureExpress = Object.assign((...args) => {
  const app=nativeExpress(...args),listen=app.listen;
  app.listen=function(...parameters){
    listener=listen.apply(this,parameters);
    listener.once('listening',()=>{
      port=listener.address().port;
      process.env.AL_INTERNAL_API_PORT=String(port);
    });
    return listener;
  };
  return app;
}, nativeExpress);
const homeVisitorStatusFile = path.join(directory, 'home-visitor-status.jsonl');
let homeVisitorStatusLines = fs.existsSync(homeVisitorStatusFile)
  ? fs.readFileSync(homeVisitorStatusFile, 'utf8').trim().split('\n').filter(Boolean).length : 0;
fixtureExpress.json = (...args) => {
  const parse = nativeExpress.json(...args);
  return (req, res, next) => parse(req, res, error => {
    if (error) return next(error);
    if (req.method === 'GET' && req.originalUrl.split('?')[0] === '/party-api/console-deployment' &&
        fs.existsSync(path.join(directory,'observe-console-maintenance'))) {
      const sendJson=res.json;
      res.json=function(value){
        try{fs.appendFileSync(path.join(directory,'console-maintenance-observations.jsonl'),JSON.stringify({at:Date.now(),value})+'\n');}
        catch(error){console.error('Maintenance observation failed:',error);}
        return sendJson.call(this,value);
      };
    }
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/status' && req.body?.name === 'E2EBankBoi') {
      const sendJson = res.json;
      res.json = function(value) {
        try {
          if(homeVisitorStatusLines < 128) {
            fs.appendFileSync(homeVisitorStatusFile, JSON.stringify({at:Date.now(),
              request:{lastCommandId:req.body.lastCommandId,merchantCommand:req.body.merchantCommand,
                runtime:req.body.runtime,home:req.body.home,map:req.body.map},
              response:{command:value?.command ? {id:value.command.id,type:value.command.type,operationId:value.command.operationId} : null,
                bankboiStorage:value?.bankboiStorage,escapeStage:value?.escape?.stage,
                dungeonOwned:value?.dailyDungeon?.owned,navigationIntent:value?.navigationIntent,
                consoleMaintenance:!!value?.consoleMaintenance,partyConvoyActive:value?.partyConvoyActive}
            })+'\n');
            homeVisitorStatusLines++;
          }
        } catch (_) { /* Observation cannot alter a real response. */ }
        return sendJson.call(this,value);
      };
    }
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/status' &&
        req.body?.name === 'E2EMerchant' && (fs.existsSync(path.join(directory, 'hold-merchant-status')) ||
          Array.isArray(req.body.items) && fs.existsSync(path.join(directory, 'hold-merchant-inventory'))))
      return res.status(503).json({error:'Declared E2E merchant status transport hold'});
    next();
  });
};
let version;
const platformDirectory = path.join(directory, 'standalones');
let gameDirectory;
async function assetText(route) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await localFetch(webUrl + route, {
        headers: { Cookie: 'auth=' + auth }, signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw Error('Upstream asset ' + route + ': ' + response.status);
      return await response.text();
    } catch (error) {
      if (attempt === 2) throw new Error('Could not download native asset ' + route, {cause:error});
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
async function main() {
  const assetStarted=process.hrtime.bigint();
  const cacheFile=path.join(directory,'native-assets.json');
  const headless=process.env.E2E_ALLOW_HEADLESS==='true';
  const cached=fs.existsSync(cacheFile)?JSON.parse(fs.readFileSync(cacheFile,'utf8')):null;
  const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(cached){
    if(cached.schema!==1||cached.webUrl!==webUrl||cached.headless!==headless||!Number.isSafeInteger(cached.version)||cached.version<1)
      throw Error('Native asset cache belongs to another scenario configuration');
    for(const [name,hash] of Object.entries(cached.files)){
      if(name!==path.posix.basename(name)||!/^[-a-zA-Z0-9_.]+$/.test(name))throw Error('Invalid native asset cache filename');
      const file=name==='html_vars.js'?path.join(directory,name):path.join(directory,'game_files',String(cached.version),name);
      if(digest(file)!==hash)throw Error('Native asset cache checksum mismatch: '+name);
    }
    if(!cached.files['data.js']||!cached.files['old_common_functions.js']||headless&&(!cached.files['client_scripts.json']||!cached.files['html_vars.js']))
      throw Error('Native asset cache is incomplete');
  }
  const dataSource = cached?fs.readFileSync(path.join(directory,'game_files',String(cached.version),'data.js'),'utf8'):await assetText('/data.js');
  const gameContext = {};
  require('node:vm').runInNewContext(dataSource, gameContext, { timeout: 10000 });
  version = Number(gameContext.G?.version);
  if (!Number.isSafeInteger(version) || version < 1) throw Error('Upstream G.version missing');
  if(cached&&version!==cached.version)throw Error('Native asset cache version mismatch');
  gameDirectory = path.join(directory, 'game_files', String(version));
  fs.mkdirSync(gameDirectory, { recursive: true });
  await account.updateInfo();
  if(!cached){
  fs.writeFileSync(path.join(gameDirectory,'data.js'),dataSource);
  fs.writeFileSync(path.join(gameDirectory,'old_common_functions.js'),await assetText('/js/old_common_functions.js'));
  if (headless) {
    const assets = require('../scripts/client-files.cjs');
    const character = encodeURIComponent(account.response.characters[0].name);
    const manifest = {
      game: assets.scripts(await assetText('/character/' + character + '/in/US/I/')),
      runner: assets.scripts(await assetText('/runner'), true),
    };
    const routes = [...new Set([...manifest.game, ...manifest.runner])];
    if (new Set(routes.map(route => path.posix.basename(route))).size !== routes.length)
      throw Error('Native client asset filenames collide');
    for (const route of routes) {
      fs.writeFileSync(path.join(gameDirectory, path.posix.basename(route)), await assetText(route));
    }
    fs.writeFileSync(path.join(gameDirectory, 'client_scripts.json'), JSON.stringify(manifest));
    fs.copyFileSync(path.join(root, '.caracal/html_vars.js'), path.join(directory, 'html_vars.js'));
  }
  const files=Object.fromEntries(fs.readdirSync(gameDirectory).filter(name=>fs.statSync(path.join(gameDirectory,name)).isFile()).map(name=>[name,digest(path.join(gameDirectory,name))]));
  if(headless)files['html_vars.js']=digest(path.join(directory,'html_vars.js'));
  fs.writeFileSync(cacheFile+'.tmp',JSON.stringify({schema:1,webUrl,headless,version,files}));
  fs.renameSync(cacheFile+'.tmp',cacheFile);
  }
  if(headless)process.env.AL_INTERNAL_API_PORT = String(port);
  fs.appendFileSync(path.join(directory,'native-assets-receipts.jsonl'),JSON.stringify({reused:!!cached,version,headless,wallMs:Number(process.hrtime.bigint()-assetStarted)/1e6,files:JSON.parse(fs.readFileSync(cacheFile,'utf8')).files})+'\n');
  // Production paths resolve relative to the launcher and cwd. All writable paths stay disposable.
  fs.mkdirSync(platformDirectory, { recursive: true });
  for (const destination of [path.join(directory, 'CODE/adventure_land')]) {
    fs.mkdirSync(destination, { recursive: true });
    const initialized=path.join(directory,'code-initialized.json');
    if(!fs.existsSync(initialized)){
      fs.cpSync(path.join(root, '.build/game'), destination, { recursive: true });
      for (const file of ['universal-loader.js', 'steam-bridge.js'])
        fs.copyFileSync(path.join(root, '.build/runtime', file), path.join(destination, file));
      fs.writeFileSync(initialized,JSON.stringify({version,manifestSha256:digest(path.join(destination,'manifest.json'))}));
    }
    if(!fs.existsSync(path.join(destination,'manifest.json')))throw Error('Initialized scenario CODE manifest missing');
  }
  process.chdir(directory);
  process.env.AL_SESSION = auth;
  process.env.AL_DATA_DIR = directory;
  let startupError;
  const logger = { log: console.log, info: console.log, warn: console.warn,
    error: (...args) => { startupError = Error(args.map(String).join(' ')); console.error(...args); } };
  const realm = account.response.servers.find(server => server.region === 'US' && server.name === 'I');
  if (!realm) throw Error('Disposable US I realm was not registered');
  const configuredCharacters = Object.fromEntries(account.response.characters.map(character =>
    [character.name, { enabled: false, realm: process.env.E2E_STALE_WORKER_REALM || realm.key, version }]));
  const adapters = {
    // Use this test build's catalog without publishing assets into the live
    // installation. Native gameplay and coordinator selection remain real.
    '../../dashboard/lib/event-policy.cjs': require(path.join(root, '.build/shared/event-policy.cjs')),
    '../config': { characters: configuredCharacters, merchant: JSON.parse(process.env.E2E_MERCHANT_DEFAULT || '"E2EMerchant"'), watch_CODE: false, enable_TYPECODE: false,
      web_app: { party_dashboard: true, expose_CODE: true, port } },
    '../account_info': async () => account,
    '../game_files': { ensure_latest: async () => version, cull_versions: async () => {},
      available_versions: async () => [version], get_revision: async () => 'local-upstream',
      locate_game_file: resource => path.join(gameDirectory, resource) },
    '../api': api,
    '../src/CONSTANTS': { LOCALSTORAGE_PATH: path.join(directory, 'state.jsonl'),
      LOCALSTORAGE_ROTA_PATH: path.join(directory, 'rotation.jsonl'), STAT_BEAT_INTERVAL: 1000 },
    '../src/LogUtils': { log: logger, console: logger, ctype_to_clid: {} },
    // Browsers own the three actual clients. Fail if a scenario accidentally requests a headless worker.
    'node:child_process': { fork(_file, args, options) {
      if (process.env.E2E_ALLOW_HEADLESS !== 'true') throw Error('Live E2E uses real browser clients; headless launch requested');
      // Exercise the same prepared native runner that the completed candidate deploys.
      const artifact = process.env.E2E_NATIVE_ARTIFACT;
      if (!artifact) throw Error('Verified native candidate required for headless E2E');
      return require('node:child_process').fork(path.join(artifact, '.caracal/src/CharacterThread.js'), args,
        {...options, cwd:directory, env:{...process.env,...options.env,AL_CONSOLE_ARTIFACT:artifact}});
    } },
    'bot-web-interface': function() { throw Error('Legacy monitor is disabled'); },
    '../monitoring_util': {},
    express: fixtureExpress,
  };
  const { startCoordinatorApplication } = require(path.join(root, '.build/runtime/coordinator-application.cjs'));
  await startCoordinatorApplication({ require: name => Object.hasOwn(adapters, name) ? adapters[name] : resolve(name),
    directory: platformDirectory, plannerWorkerFile: path.join(root, '.build/runtime/movement-planner.cjs'), loadFetch: async () => localFetch });
  if (startupError) throw startupError;
  if(!listener)throw Error('Coordinator did not create its native HTTP listener');
  if(!listener.listening)await new Promise((resolve,reject)=>{listener.once('listening',resolve);listener.once('error',reject);});
  const response = await localFetch('http://127.0.0.1:' + port + '/party-api/state?section=core');
  if (!response.ok) throw Error('Coordinator readiness: ' + response.status);
  if (process.send) process.send({ type: 'ready', port,clock:globalThis.__e2eChronalClock });
}
main().catch(error => { console.error(error); process.exit(1); });
