const fs = require('node:fs');
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
Object.assign(options, { base_url: 'http://127.0.0.1:8083', ip_limit: 10, character_limit: 10, unsecure_admin: false });
// The published template predates upstream's required parallel msgpack transport.
Object.assign(options.servers.local, { address: '127.0.0.1:9003', msgpack_path: '/socket.io-msgpack/' });
options.servers.local2 = {...options.servers.local, name:'II', local_port:7193, address:'127.0.0.1:9004'};
if (process.env.AL_DEBUG_INSTANCE === '1') {
  options.base_url = 'http://127.0.0.1:8090';
  options.servers.local.address = '127.0.0.1:7192';
  delete options.servers.local2;
}
fs.writeFileSync(root + 'options.js', 'module.exports = ' + JSON.stringify(options, null, 2));
