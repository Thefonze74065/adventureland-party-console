// Production coordinator, with account/client-file transport pointed at the disposable upstream server.
// Character status and every game action come from actual browser CODE runtimes.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.env.E2E_DATA_DIR || '');
const relative = path.relative(path.join(root, '.build/e2e'), directory);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Dedicated E2E_DATA_DIR required');
const webUrl = process.env.E2E_GAME_WEB_URL;
if (!webUrl || !['localhost', '127.0.0.1'].includes(new URL(webUrl).hostname)) throw Error('Local upstream web URL required');
const auth = process.env.E2E_GAME_AUTH;
if (!auth) throw Error('Disposable account auth required');
const port = Number(process.env.E2E_COORDINATOR_PORT);
const nativeFetch = globalThis.fetch;
async function localFetch(input, init) {
  let url = new URL(String(input));
  if (url.hostname === 'adventure.land') url = new URL(url.pathname + url.search, webUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw Error('Unexpected nonlocal request: ' + url.origin);
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
const fixtureExpress = Object.assign((...args) => nativeExpress(...args), nativeExpress);
fixtureExpress.json = (...args) => {
  const parse = nativeExpress.json(...args);
  return (req, res, next) => parse(req, res, error => {
    if (error) return next(error);
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/status' &&
        req.body?.name === 'E2EMerchant' && fs.existsSync(path.join(directory, 'hold-merchant-status')))
      return res.status(503).json({error:'Declared E2E merchant status transport hold'});
    next();
  });
};
let version;
const platformDirectory = path.join(root, '.build/standalones');
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
  const dataSource = await assetText('/data.js');
  const gameContext = {};
  require('node:vm').runInNewContext(dataSource, gameContext, { timeout: 10000 });
  version = Number(gameContext.G?.version);
  if (!Number.isSafeInteger(version) || version < 1) throw Error('Upstream G.version missing');
  gameDirectory = path.join(directory, 'game_files', String(version));
  fs.mkdirSync(gameDirectory, { recursive: true });
  await account.updateInfo();
  for (const [name, route] of [['data.js', '/data.js'], ['old_common_functions.js', '/js/old_common_functions.js']]) {
    const source = await assetText(route);
    fs.writeFileSync(path.join(gameDirectory, name), source);
  }
  if (process.env.E2E_ALLOW_HEADLESS === 'true') {
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
    process.env.AL_INTERNAL_API_PORT = String(port);
  }
  // Production paths resolve relative to the launcher and cwd. All writable paths stay disposable.
  fs.mkdirSync(platformDirectory, { recursive: true });
  fs.mkdirSync(path.join(root, '.build/game_files', String(version)), { recursive: true });
  fs.cpSync(gameDirectory, path.join(root, '.build/game_files', String(version)), { recursive: true });
  for (const destination of [path.join(root, '.build/CODE/adventure_land'), path.join(directory, 'CODE/adventure_land')]) {
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(path.join(root, '.build/game'), destination, { recursive: true });
    for (const file of ['universal-loader.js', 'steam-bridge.js'])
      fs.copyFileSync(path.join(root, '.build/runtime', file), path.join(destination, file));
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
      return require('node:child_process').fork(path.join(root, '.caracal/src/CharacterThread.js'), args, {...options, cwd:directory});
    } },
    'bot-web-interface': function() { throw Error('Legacy monitor is disabled'); },
    '../monitoring_util': {},
    express: fixtureExpress,
  };
  const { startCoordinatorApplication } = require(path.join(root, '.build/runtime/coordinator-application.cjs'));
  await startCoordinatorApplication({ require: name => Object.hasOwn(adapters, name) ? adapters[name] : resolve(name),
    directory: platformDirectory, loadFetch: async () => localFetch });
  if (startupError) throw startupError;
  const response = await localFetch('http://127.0.0.1:' + port + '/party-api/state?section=core');
  if (!response.ok) throw Error('Coordinator readiness: ' + response.status);
  if (process.send) process.send({ type: 'ready', port });
}
main().catch(error => { console.error(error); process.exit(1); });
