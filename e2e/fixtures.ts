import { test as base, expect } from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gateway } from '../tools/hosting/gateway';
import { Access } from '../tools/hosting/access';
import { DebugInstances } from '../tools/debug/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
export function environment(extra: Record<string, string>) {
  // Do not inherit live console credentials, launch configuration, or gateway tokens.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AL_|E2E_)/.test(name)));
  return { ...env, ...extra };
}
export function child(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, log: string) {
  const process = fork(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  process.stdout!.on('data', bytes => appendFileSync(log, bytes));
  process.stderr!.on('data', bytes => appendFileSync(log, bytes));
  return process;
}
export async function stop(process: ChildProcess, graceful = false) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  if (graceful && process.connected) process.send({ type: 'coordinator_shutdown' });
  else process.kill('SIGTERM');
  const deadline = Date.now() + 10_000;
  while (process.exitCode === null && process.signalCode === null && Date.now() < deadline) await delay(50);
  if (process.exitCode === null && process.signalCode === null) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned E2E child did not terminate')), 5000);
      process.once('exit', () => { clearTimeout(timer); resolve(); });
      process.kill('SIGKILL');
    });
  }
}
async function ready(process: ChildProcess, url: string, log: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null || process.signalCode !== null) break;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* The owned server is still starting. */ }
    await delay(200);
  }
  throw new Error(`E2E service failed readiness at ${url}\n${existsSync(log) ? readFileSync(log, 'utf8').slice(-12000) : 'No output'}`);
}
type App = { url: string; restartCoordinator(): Promise<void>; state(): Promise<any> };

export const test = base.extend<{ app: App; merchantDialogs: boolean; merchantConnected: boolean }, { dashboard: { port: number; log: string } }>({
  merchantDialogs: [false, {option:true}],
  merchantConnected: [true, {option:true}],
  dashboard: [async ({}, use) => {
    const directory = path.join(root, '.build/e2e', `dashboard-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const port = await unusedPort(), log = path.join(directory, 'dashboard.log');
    const process = child(path.join(root, 'dashboard/node_modules/vinext/dist/cli.js'),
      ['dev', '--hostname', '127.0.0.1', '--port', String(port)], path.join(root, 'dashboard'),
      // vinext's dev-server lock is keyed by directory, not port: it would otherwise
      // refuse to start here whenever a real `vinext dev` is already running from the
      // same dashboard/ checkout. VINEXT_NO_DEV_LOCK is vinext's own documented escape
      // hatch for exactly this (ephemeral/test) case, not a workaround for our harness.
      environment({ AL_DASHBOARD_PORT: String(port), AL_WATCH_POLL: '1', VINEXT_NO_DEV_LOCK: '1' }), log);
    try {
      await ready(process, `http://127.0.0.1:${port}`, log);
      await use({ port, log });
    } finally { await stop(process); }
  }, { scope: 'worker', timeout: 120_000 }],
  app: async ({ dashboard, merchantDialogs, merchantConnected }, use, testInfo) => {
    const directory = path.join(root, '.build/e2e', `scenario-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const port = await unusedPort(), log = path.join(directory, 'coordinator.log');
    let coordinator: ChildProcess | undefined;
    async function start() {
      coordinator = child(path.join(root, 'e2e/coordinator.cjs'), [], root,
        environment({ E2E_COORDINATOR_PORT: String(port), E2E_DATA_DIR: directory, E2E_MERCHANT_DIALOGS: String(merchantDialogs), E2E_MERCHANT_CONNECTED: String(merchantConnected) }), log);
      const started = coordinator;
      await new Promise<void>((resolve, reject) => {
        const output = () => existsSync(log) ? readFileSync(log, 'utf8') : 'No coordinator output';
        const cleanup = () => {
          clearTimeout(timeout);
          started.removeListener('exit', exited); started.removeListener('error', failed); started.removeListener('message', message);
        };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const exited = (code: number | null) => failed(new Error(`Coordinator exited (${code})\n${output()}`));
        const message = (message: any) => {
          if (message?.type !== 'ready') return;
          cleanup(); resolve();
        };
        const timeout = setTimeout(() => failed(new Error(`Coordinator startup timed out\n${output()}`)), 30_000);
        started.once('exit', exited); started.once('error', failed); started.on('message', message);
      });
    }
    const access = new Access(path.join(directory, 'access.json'));
    await access.load();
    const debug = await new DebugInstances(root, path.join(directory, 'debug')).load();
    const server = gateway({ access, debug, configured: () => true, dashboardPort: dashboard.port, apiPort: port });
    let app: App | undefined;
    try {
      await start();
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      app = {
        url,
        async restartCoordinator() { await stop(coordinator!, true); await start(); },
        async state() {
          const response = await fetch(`${url}/party-api/state`, { signal: AbortSignal.timeout(10_000) });
          if (!response.ok) throw new Error(`State request failed: ${response.status}`);
          return response.json();
        },
      };
      await use(app);
    } finally {
      try {
        if ((await debug.status()).project) {
          await debug.stop();
          await expect.poll(async () => (await debug.status()).phase, { timeout: 120_000 }).toBe('stopped');
        }
        if (app) {
          try { await testInfo.attach('final-state', { body: JSON.stringify(await app.state(), null, 2), contentType: 'application/json' }); }
          catch (error) { await testInfo.attach('state-error', { body: String(error), contentType: 'text/plain' }); }
        }
      } finally {
        try {
          server.closeAllConnections();
          if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
        } finally { if (coordinator) await stop(coordinator, true); }
      }
      for (const file of [log, dashboard.log, path.join(directory, 'state.jsonl')]) {
        if (existsSync(file)) await testInfo.attach(path.basename(file), { path: file, contentType: 'text/plain' });
      }
    }
  },
  baseURL: async ({ app }, use) => { await use(app.url); },
  context: async ({ context }, use) => {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)
        ? route.continue() : route.abort('blockedbyclient');
    });
    await use(context);
  },
});
export { expect };
