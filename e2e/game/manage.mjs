import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import bootstrapModule from './bootstrap.cjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = ['compose', '--project-name', 'al-e2e-pr21', '-f', 'e2e/game/compose.yml'];
let gameRunStartedAt;
function docker(command) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...args, ...command], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Docker exited ' + code)));
  });
}
export async function up() {
  gameRunStartedAt = new Date().toISOString();
  await docker(['up', '--build', '--detach', '--wait', '--wait-timeout', '300']);
  return bootstrapModule.bootstrap();
}
export async function logs({ since = gameRunStartedAt } = {}) {
  const destination = resolve(root, '.build/e2e-live/server.log');
  await mkdir(dirname(destination), { recursive: true });
  const command = ['logs', '--no-color', '--timestamps', ...(since ? ['--since', since] : [])];
  const child = spawn('docker', [...args, ...command], {
    cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() :
      reject(new Error('Docker logs exited ' + code + (signal ? ' (' + signal + ')' : ''))));
  });
  try {
    // Backpressure bounds memory independently of the amount of retained output.
    await Promise.all([pipeline(child.stdout, createWriteStream(destination)), completed]);
  } catch (error) {
    child.kill();
    await completed.catch(() => {});
    throw error;
  }
  console.log(destination);
}
export async function down() { await docker(['down', '--volumes', '--remove-orphans']); }
const command = process.argv[2];
if (command === 'up') await up();
else if (command === 'down') await down();
else if (command === 'logs') await logs();
else if (command === 'reset') await bootstrapModule.reset();
else if (process.argv[1] === fileURLToPath(import.meta.url)) throw new Error('Usage: node e2e/game/manage.mjs up|down|logs|reset');
