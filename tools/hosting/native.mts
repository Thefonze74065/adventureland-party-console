import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Native source installations use the managed candidate workflow in both modes.
process.env.AL_CONSOLE_MANAGED = '1';
// Port 924 is privileged on ordinary Linux hosts; containers allow it explicitly.
process.env.AL_INTERNAL_API_PORT ||= '1924';
function run(command: string, args: string[], cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status}); startup stopped.`);
}
// Check before installing or publishing anything, including an older launcher
// which does not participate in the checkout lock.
for (const port of [Number(process.env.AL_PORT || 3010), Number(process.env.AL_INTERNAL_DASHBOARD_PORT || 3030), Number(process.env.AL_INTERNAL_API_PORT)]) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => reject(new Error(`Cannot use port ${port}: ${error.message}. Stop any existing console using that port and check permissions.`)));
    probe.listen(port, '0.0.0.0', () => probe.close(error => error ? reject(error) : resolve()));
  });
}
async function dependencies(directory: string) {
  const lock = await readFile(path.join(directory, 'package-lock.json'));
  const manifest = await readFile(path.join(directory, 'package.json'));
  const fingerprint = createHash('sha256').update(lock).update(manifest)
    .update(`${process.platform}:${process.arch}:${process.versions.modules}`).digest('hex');
  const marker = path.join(directory, 'node_modules/.party-native-dependencies');
  if (await readFile(marker, 'utf8').catch(() => '') === fingerprint) return;
  run('npm', ['ci', '--include=dev'], directory);
  await writeFile(marker, fingerprint);
}
try {
  await access(path.join(root, '.caracal/.caracal-supervisor.lock'));
  const pid = Number((await readFile(path.join(root, '.caracal/.caracal-supervisor.lock'), 'utf8')).trim());
  if (Number.isInteger(pid) && pid > 0) {
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
    if (alive) throw new Error('A caracAL supervisor is already running. Stop it before starting Party Console.');
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
await dependencies(root);
await dependencies(path.join(root, 'dashboard'));
try { await access(path.join(root, '.caracal/main.js')); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  run(process.execPath, ['tools/caracal/setup.mts']);
}
await dependencies(path.join(root, '.caracal'));
run(process.execPath, ['tools/hosting/install-caddy.mts']);
console.log('Starting Party Console with the newest completed candidate. Builds completed while running stay staged until loaded or the next startup.');
console.log('Open a Dashboard address printed below to connect your account. Leave this terminal open; Ctrl+C stops the console.');
await import('./start.mts');
