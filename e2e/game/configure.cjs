const {gameHosts}=require('./addresses.cjs');
const fs = require('node:fs');
// Verified upstream gap at the pinned game revision: a departed farewell NPC
// remains in the resolved vote after native removal clears its zone_actor.
// Snapshotting that vote must treat the absent actor state as not following.
// Keep this exact guard under review when upgrading tools/sim/pins.json.
const caveRules = '/game/node/logic/cave_of_many_dreams.js';
const caveSource = fs.readFileSync(caveRules, 'utf8');
const upstreamFollow = '!room.npc?.zone_actor.follow &&';
const guardedFollow = '!room.npc?.zone_actor?.follow &&';
if (caveSource.split(upstreamFollow).length === 2 && !caveSource.includes(guardedFollow))
  fs.writeFileSync(caveRules, caveSource.replace(upstreamFollow, guardedFollow));
else if (caveSource.includes(upstreamFollow) || caveSource.split(guardedFollow).length !== 2)
  throw Error('Pinned Cave farewell snapshot compatibility guard no longer matches upstream');
// The pinned mail transaction runs in an isolated context without in_arr.
// Preserve native authorization and persistence using equivalent membership.
const mailApi = '/game/api.js';
const mailSource = fs.readFileSync(mailApi, 'utf8');
const upstreamOwnership = '!mail.owner || !in_arr(A.owner, mail.owner)';
const guardedOwnership = '!mail.owner || !mail.owner.includes(A.owner)';
if (mailSource.split(upstreamOwnership).length === 2 && !mailSource.includes(guardedOwnership))
  fs.writeFileSync(mailApi, mailSource.replace(upstreamOwnership, guardedOwnership));
else if (mailSource.includes(upstreamOwnership) || mailSource.split(guardedOwnership).length !== 2)
  throw Error('Pinned native mail transaction compatibility guard no longer matches upstream');
const root = '/game/secretsandconfig/';
const keys = require(root + 'keys.js');
Object.assign(keys, {
  mongodb_uri: 'mongodb://127.0.0.1:27017/al_e2e?replicaSet=e2e',
  mongodb_name: 'al_e2e',
  ACCESS_MASTER: 'al-e2e-disposable-admin',
  SERVER_MASTER: 'al-e2e-disposable-server',
  BOT_MASTER: 'al-e2e-disposable-bot',
  server_keyword: 'al-e2e-disposable-keyword',
});
fs.writeFileSync(root + 'keys.js', 'module.exports = ' + JSON.stringify(keys, null, 2));
const options = require(root + 'options.js');
const host=process.env.E2E_GAME_HOST||'127.0.0.1';
if(!gameHosts.includes(host))throw Error('Unassigned disposable game host');
Object.assign(options, { base_url: `http://${host}:8083`, ip_limit: 10, character_limit: 10, unsecure_admin: false });
// The published template predates upstream's required parallel msgpack transport.
Object.assign(options.servers.local, { address: `${host}:9003`, msgpack_path: '/socket.io-msgpack/' });
options.servers.local2 = {...options.servers.local, name:'II', local_port:7193, address:`${host}:9004`};
if (process.env.AL_DEBUG_INSTANCE === '1') {
  options.base_url = 'http://127.0.0.1:8090';
  options.servers.local.address = '127.0.0.1:7192';
  delete options.servers.local2;
}
fs.writeFileSync(root + 'options.js', 'module.exports = ' + JSON.stringify(options, null, 2));
