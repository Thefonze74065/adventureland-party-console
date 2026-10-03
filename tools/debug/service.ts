import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../hosting/http.ts';
import { docker } from './process.ts';

type Phase = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
interface State { phase: Phase; project?: string; token?: string; port?: number; message: string; error?: string }
const label = 'party-console.debug';
export class DebugInstances {
  private state: State = { phase: 'stopped', message: 'No debug instance running.' };
  private operation?: Promise<void>;
  private abort?: AbortController;
  private stopping = false;
  private readonly file: string;
  private readonly root: string;
  private readonly directory: string;
  private saving = Promise.resolve();
  constructor(root: string, directory: string) {
    this.root = root; this.directory = directory; this.file = path.join(directory, 'instance.json');
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const stored: State = JSON.parse(await readFile(this.file, 'utf8'));
      if (!/^party-debug-[a-f0-9]{16}$/.test(stored.project || '')) throw Error('Invalid debug instance ownership record');
      this.state = stored;
      if (stored.phase !== 'running') Object.assign(this.state, { phase: 'error', error: 'Startup was interrupted. Stop running to remove the incomplete instance.' });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return this;
  }
  private save() {
    const snapshot = JSON.stringify(this.state);
    this.saving = this.saving.catch(() => {}).then(async () => {
      await writeFile(this.file + '.tmp', snapshot, { mode: 0o600 }); await rename(this.file + '.tmp', this.file);
    });
    return this.saving;
  }
  private async checkpoint(message: string) { this.state.message = message; await this.save(); }
  async status() {
    if (this.state.phase === 'running') {
      const current = this.state;
      try {
        const health = await docker(['inspect', '--format', '{{.State.Health.Status}}', this.state.project + '-console']);
        if (health !== 'healthy' && current.phase === 'running') Object.assign(current, { phase: 'error', error: 'Debug console stopped responding. Stop running to clean up, then start again.' });
      } catch (error) { if (current.phase === 'running') Object.assign(current, { phase: 'error', error: String(error) }); }
    }
    return { ...this.state, insideDebug: process.env.AL_DEBUG_INSTANCE === '1' };
  }
  async start() {
    if (process.env.AL_DEBUG_INSTANCE === '1') throw Error('Start debug instances from your main console.');
    if (this.operation || this.state.project) return;
    this.state = { phase: 'starting', project: 'party-debug-' + randomBytes(8).toString('hex'),
      token: randomBytes(32).toString('hex'), message: 'Checking Docker…' };
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.operation = (async () => { await this.save(); signal.throwIfAborted(); await this.launch(signal); })().catch(async error => {
      if (this.stopping) return;
      const cause = String(error);
      try { await this.destroy(); this.state = { phase: 'error', message: 'Startup failed; disposable resources removed.', error: cause }; }
      catch (cleanup) { Object.assign(this.state, { phase: 'error', message: 'Cleanup required. Use Stop running to retry.', error: cause + '\n' + cleanup }); }
    }).finally(() => { if (!this.stopping) this.operation = undefined; });
  }
  private async launch(signal: AbortSignal) {
    const project = this.state.project!;
    const run = (args: string[]) => docker(args, { signal });
    // `docker info`'s own field is OSType; Podman's docker-CLI emulation lacks that field
    // entirely (its `info` JSON nests `host.os` instead) and errors on the Go-template lookup
    // Docker's own format string uses. JSON survives either CLI, so inspect it leniently instead:
    // only block a genuine non-Linux Docker Desktop container mode, Podman's own schema included.
    const info = JSON.parse(await run(['info', '--format', '{{json .}}']));
    const osType = info.OSType || info.host?.os;
    if (osType && osType !== 'linux') throw Error('Select Linux containers in Docker Desktop to run the debug server.');
    await this.checkpoint('Building debug console (first start can take several minutes)…');
    await run(['build', '--target', 'debug', '-t', project + '-console:local', this.root]);
    await this.checkpoint('Building local Adventure Land server…');
    await run(['build', '-t', project + '-game:local', path.join(this.root, 'e2e/game')]);
    await this.checkpoint('Starting isolated database and game…');
    await run(['volume', 'create', '--label', `${label}=${project}`, project + '-database']);
    await run(['volume', 'create', '--label', `${label}=${project}`, project + '-console-data']);
    await run(['network', 'create', '--label', `${label}=${project}`, project]);
    const container = (name: string) => ['run', '-d', '--label', `${label}=${project}`, '--name', project + '-' + name];
    let inContainer = false;
    try { await access('/.dockerenv'); inContainer = true; } catch { /* Native installation. */ }
    const bind = process.env.AL_DEBUG_BIND || (inContainer ? '0.0.0.0' : '127.0.0.1');
    if (!['0.0.0.0', '127.0.0.1'].includes(bind)) throw Error('AL_DEBUG_BIND must be 127.0.0.1 or 0.0.0.0');
    await run([...container('database'), '--network', project, '-p', `${bind}::3010`, '-v', project + '-database:/data/db',
      'mongo:7.0.16', 'mongod', '--replSet', 'e2e', '--bind_ip', '127.0.0.1']);
    await this.until(async () => {
      await run(['exec', project + '-database', 'mongosh', '--quiet', '--eval',
        "try { rs.status() } catch(e) { rs.initiate({_id:'e2e',members:[{_id:0,host:'127.0.0.1:27017'}]}) }; if (!db.hello().isWritablePrimary) quit(1)"]); return true;
    }, signal);
    await run([...container('game'), '--network', 'container:' + project + '-database', '-e', 'AL_DEBUG_INSTANCE=1', project + '-game:local']);
    await this.checkpoint('Starting console and connecting the god party…');
    await run([...container('console'), '--network', 'container:' + project + '-database', '--shm-size=1g',
      '-v', project + '-console-data:/data', '-e', 'AL_DEBUG_INSTANCE=1', '-e', 'AL_DEBUG_TOKEN=' + this.state.token,
      project + '-console:local']);
    await this.until(async () => {
      const state = JSON.parse(await run(['inspect', '--format', '{{json .State}}', project + '-console']));
      if (!state.Running) throw Error('Debug console exited during startup: ' + await docker(['logs', '--tail', '30', project + '-console'], { signal, combined: true }));
      return state.Health?.Status === 'healthy';
    }, signal, 300000, false);
    const bindings = JSON.parse(await run(['inspect', '--format', '{{json .NetworkSettings.Ports}}', project + '-database']));
    const port = Number(bindings['3010/tcp']?.[0]?.HostPort);
    if (!port || port === 3010) throw Error('Debug console needs a separate published port');
    Object.assign(this.state, { phase: 'running', port, message: 'God party ready. Cave visits are unlimited.' });
    await this.save();
  }
  private async until(check: () => Promise<boolean>, signal: AbortSignal, timeout = 120000, retryErrors = true) {
    const deadline = Date.now() + timeout; let last = '';
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      try { if (await check()) return; } catch (error) { if (!retryErrors) throw error; last = String(error); }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw Error('Debug startup timed out. ' + last);
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.state.phase = 'stopping'; this.state.message = 'Stopping and deleting disposable data…';
    this.abort?.abort();
    const pending = this.operation;
    this.operation = (async () => {
      await pending;
      try {
        await this.destroy(); this.state = { phase: 'stopped', message: 'Debug instance and its data were destroyed.' };
      } catch (error) { Object.assign(this.state, { phase: 'error', message: 'Cleanup failed. Stop running to retry.', error: String(error) }); }
      finally { this.stopping = false; this.operation = undefined; }
    })();
  }
  private async destroy() {
    const project = this.state.project;
    if (!project) return;
    for (const kind of ['container', 'volume', 'network']) {
      const ids = (await docker([kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '-q', '--filter', `label=${label}=${project}`])).split(/\s+/).filter(Boolean);
      if (ids.length) await docker([kind, 'rm', ...(kind === 'container' ? ['-f', '-v'] : []), ...ids]);
    }
    for (const name of ['console', 'game']) {
      const tag = project + '-' + name + ':local';
      if (await docker(['image', 'ls', '-q', tag])) await docker(['image', 'rm', tag]);
    }
    await this.saving.catch(() => {});
    await rm(this.file, { force: true });
    await rm(this.file + '.tmp', { force: true });
  }
  async route(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (pathname === '/console-debug' && req.method === 'GET') { json(res, 200, await this.status()); return; }
    if (req.method !== 'POST') { json(res, 405, { error: 'POST required' }); return; }
    if (pathname === '/console-debug/start') await this.start();
    else if (pathname === '/console-debug/stop') await this.stop();
    else { json(res, 404, { error: 'Unknown debug action' }); return; }
    json(res, 202, await this.status());
  }
}
