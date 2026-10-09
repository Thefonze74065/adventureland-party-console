const { spawn, spawnSync } = require('node:child_process');
const { MongoClient } = require('mongodb');
const net = require('node:net');
async function forwardPublishedPort(published, native) {
  const server = net.createServer(socket => {
    const upstream = net.connect(native, '127.0.0.1');
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(published, '127.0.0.1', resolve);
  });
  return server;
}
async function main() {
  if (process.env.AL_DEBUG_INSTANCE === '1') require('./configure.cjs');
  const client = new MongoClient(require('../secretsandconfig/keys.js').mongodb_uri);
  await client.connect();
  const db = client.db('al_e2e');
  const collections = await db.listCollections().toArray();
  if (collections.length) {
    // This container exclusively owns this hardcoded disposable database. Docker
    // may have killed its predecessor before upstream saved offline leases.
    // Clear them before either upstream process starts; leave map/account data.
    await db.collection('server').deleteMany({ _id: {$in:['SR_USI','SR_USII']} });
    await db.collection('character').updateMany({}, { $set: { online: false, server: '' } });
    await db.collection('user').updateMany({}, { $set: { server: '', mounted_to: '' } });
  }
  await client.close();
  if (!collections.length) {
    const seed = spawnSync(process.execPath, ['scripts/seed_mongodb.js', '--confirm', 'al_e2e'], { stdio: 'inherit' });
    if (seed.status !== 0) throw new Error('Map seed failed');
  }
  // Native server-to-server authentication uses the same advertised address as
  // browsers. Docker's host mappings are not reachable via container loopback;
  // transparently forward those addresses to their unchanged native listeners.
  const forwards = process.env.AL_DEBUG_INSTANCE === '1' ? [] :
    [await forwardPublishedPort(9003, 7192), await forwardPublishedPort(9004, 7193)];
  const children = [spawn(process.execPath, ['main.js'], { stdio: 'inherit' }), spawn(process.execPath, ['server.js', 'local'], { cwd: '/game/node', stdio: 'inherit' })];
  if (require('../secretsandconfig/options.js').servers.local2)
    children.push(spawn(process.execPath, ['server.js', 'local2'], {cwd:'/game/node',stdio:'inherit'}));
  let stopping = false;
  const stop = (code) => { if (stopping) return; stopping = true; forwards.forEach(server => server.close()); children.forEach(child => child.kill('SIGTERM')); setTimeout(() => process.exit(code), 2000); };
  children.forEach(child => child.on('exit', code => stop(code || 1)));
  process.on('SIGTERM', () => stop(0));
  process.on('SIGINT', () => stop(0));
}
main().catch(error => { console.error(error); process.exit(1); });
