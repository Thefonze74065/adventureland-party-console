import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SteamPreferenceStore, assertLocalSteam } from './preferences.ts';
import { findExecutable, gameRunning, launchGame } from './platform.ts';
import { Inspector, targets, type InspectorTarget } from './inspector.ts';
import { steamBridgeVersion } from '../../runtime/steam/connection.ts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export interface DesktopPorts {
  platform: NodeJS.Platform;
  targets(): Promise<InspectorTarget[]>;
  executable(): Promise<string>;
  running(executable: string): Promise<boolean>;
  launch(executable: string): Promise<void>;
  connect(target: InspectorTarget): Promise<Pick<Inspector, 'evaluate' | 'close'>>;
  bridgeReady(): Promise<boolean>;
  server(): Promise<string>;
  source(): Promise<string>;
  now(): number;
  sleep(ms: number): Promise<unknown>;
}
/** Only bootstraps the browser bridge. The coordinator still owns every release and login. */
export class LocalSteam {
  readonly preferences: SteamPreferenceStore;
  private ports: DesktopPorts;
  private pending?: Promise<void>;
  private maintenance?: ReturnType<typeof setTimeout>;
  private stopped = false;
  constructor(preferences: SteamPreferenceStore, ports: DesktopPorts) { this.preferences = preferences; this.ports = ports; }
  ensure(character: string): Promise<void> {
    if (this.pending) throw Error('Another Steam client connection is in progress.');
    this.pending = this.prepare(character).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async available() { try { return await this.ports.targets(); } catch { return []; } }
  private async refreshLocalBridge(character: string) {
    // A ready remote/manual bridge needs no local desktop. Only the explicitly
    // configured local Steam client may be refreshed after a hosting restart.
    try { assertLocalSteam(await this.preferences.read(), this.ports.platform); }
    catch { return; }
    const pages = await this.available();
    if (pages.length !== 1) return;
    const server = await this.ports.server(), source = await this.ports.source();
    if (await this.attach(pages[0], server, source, character)) this.maintain(server, source);
  }
  private async prepare(character: string) {
    if (await this.ports.bridgeReady()) { await this.refreshLocalBridge(character); return; }
    assertLocalSteam(await this.preferences.read(), this.ports.platform);
    let pages = await this.available();
    if (!pages.length) {
      const executable = await this.ports.executable();
      if (await this.ports.running(executable))
        throw Error('Adventure Land is already running without its automation connection. Close it once, then retry Make Steam primary so Party Console can launch it with automation enabled. Your headless characters have not been stopped.');
      await this.ports.launch(executable);
    }
    const server = await this.ports.server(), source = await this.ports.source();
    const deadline = this.ports.now() + 45000;
    while (this.ports.now() < deadline && !this.stopped) {
      pages = await this.available();
      if (pages.length > 1) throw Error('Multiple Adventure Land windows are open. Keep the intended Steam window open and close the others before retrying.');
      if (pages[0] && await this.attach(pages[0], server, source, character).catch(() => false)) {
        this.maintain(server, source);
        if (await this.ports.bridgeReady()) return;
      }
      await this.ports.sleep(500);
    }
    throw Error('Steam client did not connect to Party Console. Sign in to your Adventure Land account in the game, complete setup if requested, then retry. Headless ownership is unchanged.');
  }
  private async attach(target: InspectorTarget, server: string, source: string, character?: string) {
    const connection = await this.ports.connect(target);
    try {
      // No credentials or account data leave the game page. Selection must expose
      // the owned roster and bootstrap APIs before the coordinator can stop CODE.
      const expression = `(() => {
        if (window !== window.top || !window.__TAURI_INTERNALS__ || window.no_html || window.is_bot) return false;
        if (!Array.isArray(window.X?.characters) || typeof window.api_call !== 'function' ||
            typeof window.storage_get !== 'function' || typeof window.storage_set !== 'function') return false;
        if (${JSON.stringify(character || '')} && !window.X.characters.some(c => c.name === ${JSON.stringify(character || '')})) return false;
        if (!window.__partySteamBridge || window.__partySteamBridge.version !== ${steamBridgeVersion}) {
          window.__partyServer = ${JSON.stringify(server)};
          (0, eval)(${JSON.stringify(source)});
        }
        return !!window.__partySteamBridge;
      })()`;
      return await connection.evaluate(expression) === true;
    } finally { connection.close(); }
  }
  private maintain(server: string, source: string) {
    if (this.maintenance || this.stopped) return;
    const tick = async () => {
      try {
        const pages = await this.available();
        if (pages.length === 1) await this.attach(pages[0], server, source);
      } catch { /* Navigating destroys the old context; attach to its replacement next pass. */ }
      if (!this.stopped) this.maintenance = setTimeout(() => { this.maintenance = undefined; void tick(); }, 2000);
      this.maintenance?.unref();
    };
    this.maintenance = setTimeout(() => { this.maintenance = undefined; void tick(); }, 2000);
    this.maintenance.unref();
  }
  stop() { this.stopped = true; clearTimeout(this.maintenance); }
}
export function createLocalSteam(root: string, data: string, apiPort: number, server: () => Promise<string>) {
  return new LocalSteam(new SteamPreferenceStore(data), {
    platform: process.platform, targets, executable: findExecutable, running: gameRunning, launch: launchGame,
    connect: target => Inspector.connect(target), server,
    source: () => readFile(path.join(root, 'characters/steam-bridge.js'), 'utf8'), now: Date.now, sleep: delay,
    bridgeReady: async () => {
      const response = await fetch(`http://127.0.0.1:${apiPort}/party-api/steam/connection`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw Error('Party coordinator is unavailable.');
      return (await response.json() as { ready?: boolean }).ready === true;
    },
  });
}
