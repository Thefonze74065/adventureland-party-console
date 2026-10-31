// Runs only in the development image. Initialize isolated volumes before dropping privileges.
import { cp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { grantDockerSocket } from '../debug/docker-access.ts';

const seed = '/opt/party-seed';
const root = '/app';
const uid = process.env.AL_DEV_UID || '1000';
const gid = process.env.AL_DEV_GID || '1000';
if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid)) throw new Error('Invalid development UID/GID');
await grantDockerSocket(uid);
const identity = `${(await readFile(path.join(seed, 'seed-id'), 'utf8')).trim()}:${uid}:${gid}`;
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
async function populate(relative: string) {
  const destination = path.join(root, relative);
  const marker = path.join(destination, '.party-seed');
  if (await readFile(marker, 'utf8').catch(() => '') === identity) return;
  // These paths are dedicated named volumes, never the source tree or saved data.
  const { readdir } = await import('node:fs/promises');
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(destination)) await rm(path.join(destination, name), { recursive: true, force: true });
  await cp(path.join(seed, relative), destination, { recursive: true, verbatimSymlinks: true });
  await writeFile(marker, identity);
  run('chown', ['-R', `${uid}:${gid}`, destination]);
}
await populate('node_modules');
await populate('dashboard/node_modules');
await populate('.caracal');
await mkdir('/app/.build', { recursive: true });
await cp(path.join(seed, '.build/caddy'), '/app/.build/caddy', { recursive: true });
for (const name of ['localStorage', 'game_files', 'logs']) {
  await mkdir('/data/' + name, { recursive: true });
  await rm('/app/.caracal/' + name, { recursive: true, force: true });
  await symlink('/data/' + name, '/app/.caracal/' + name);
}
await rm('/app/.caracal/CODE/adventure_land', { force: true });
await symlink('/app/characters', '/app/.caracal/CODE/adventure_land');
for (const directory of ['/app/.build', '/app/dashboard/.build', '/data']) {
  await mkdir(directory, { recursive: true });
  run('chown', ['-R', `${uid}:${gid}`, directory]);
}
process.env.AL_CONSOLE_MANAGED = '1';
console.log('Starting development with the newest completed candidate. Later source builds stay staged until loaded or the next startup.');
// Replace this bootstrap so Tini forwards shutdown to the regular host.
process.execve!('/usr/sbin/gosu', ['gosu', `${uid}:${gid}`, 'node', 'tools/hosting/start.mts'], process.env as Record<string, string>);
