import { classArtifact, compileArtifact } from "./loader-artifact.ts";
import { initializeConnection, needsSteamBridge, steamBootstrap } from "../steam/connection.ts";
const server = initializeConnection();
const baseUrl = server + "/CODE/adventure_land/";
interface LoaderRoot {
  character: { ctype: string };
  parent: {
    caracAL?: unknown;
    character?: { name: string };
    localStorage?: Storage;
    __partySteamBridge?: { realmProtocol: number; version?: number; server?: string };
    eval(source: string): unknown;
    start_runner(id: string, source: string): void;
    setTimeout(fn: () => void, delay: number): unknown;
  };
  __partyCodeLoader?: { dispose(): void };
  __partyLoaderGeneration?: number;
  __partyRuntimeGeneration?: number;
  __partyStatusSuccessAt?: number;
  __partyLoaderRuntimeStartedAt?: number;
  sharedRoutine?: { stop(): void; canReload?(): boolean; isOccupied?(): boolean };
  partyRoleRunner?: { start(): void; stop(): void };
  game_log(message: string, color: string): void;
  addEventListener?(event: string, callback: () => void): void;
  removeEventListener?(event: string, callback: () => void): void;
}
const root = globalThis as unknown as LoaderRoot;
const gameHost = root.parent;
root.__partyCodeLoader?.dispose();
const generation = (root.__partyLoaderGeneration || 0) + 1;
root.__partyLoaderGeneration = generation;
const abort = new AbortController();
let lastSource: string | null = null;
let loading = false;
let bridgeLoading = false;
let timer: ReturnType<typeof setInterval> | undefined;

async function source(file: string): Promise<string> {
  const response = await fetch(baseUrl + file + "?t=" + Date.now(), {
    cache: "no-store",
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6000)]),
  });
  if (!response.ok) throw new Error(`CODE ${file}: HTTP ${response.status}`);
  return response.text();
}
function current(): boolean {
  return !abort.signal.aborted && root.__partyLoaderGeneration === generation && root.parent === gameHost;
}
function occupied(): boolean {
  return root.sharedRoutine?.canReload ? !root.sharedRoutine.canReload() : !!root.sharedRoutine?.isOccupied?.();
}
function needsNewFrame(): boolean { return lastSource !== null && !root.parent.caracAL; }
function replaceFrame(): void {
  dispose();
  const bootstrap = steamBootstrap(server);
  // Capture the game window before native start_runner detaches this CODE frame.
  gameHost.setTimeout(() => gameHost.start_runner("maincode", bootstrap), 0);
}
function install(signature: string, compiled: () => void): void {
  root.__partyRuntimeGeneration = (root.__partyRuntimeGeneration || 0) + 1;
  root.partyRoleRunner?.stop();
  root.sharedRoutine?.stop();
  if (!current()) return;
  compiled();
  if (!current()) return;
  lastSource = signature;
  root.__partyLoaderRuntimeStartedAt = Date.now();
  root.partyRoleRunner?.start();
  root.game_log("Loaded party CODE generation " + generation, "#51D2E1");
}
function report(error: unknown): void {
  if (current()) root.game_log("Party loader failed: " + String(error), "red");
}
async function refresh(force = false): Promise<void> {
  if (loading || !current()) return;
  loading = true;
  try {
    const entry = await classArtifact(source, root.character.ctype);
    if (entry.sha256 === lastSource && !force) return;
    const compiled = await compileArtifact(source, entry, baseUrl);
    if (!current()) return;
    if (needsNewFrame()) {
      if (!occupied()) replaceFrame();
      return;
    }
    install(entry.sha256, compiled);
  } catch (error) {
    report(error);
  } finally { loading = false; }
}
let disposed = false;
function dispose(): void {
  if (disposed) return;
  disposed = true;
  abort.abort();
  clearInterval(timer);
  root.removeEventListener?.("pagehide", dispose);
  // Invalidating ownership also fences already pending status/native promises.
  root.__partyRuntimeGeneration = (root.__partyRuntimeGeneration || 0) + 1;
  root.partyRoleRunner?.stop();
  if (root.parent === gameHost) root.sharedRoutine?.stop();
}
root.__partyCodeLoader = { dispose };
root.addEventListener?.("pagehide", dispose);
async function refreshBridge(): Promise<void> {
  if (bridgeLoading || !current() || !needsSteamBridge(gameHost.__partySteamBridge, server)) return;
  bridgeLoading = true;
  try {
    const text = await source("steam-bridge.js");
    // Evaluate in the game window: the bridge survives a CODE iframe replacement.
    if (current() && needsSteamBridge(gameHost.__partySteamBridge, server)) gameHost.eval(text);
  } catch (error) {
    if (current()) root.game_log("Steam bridge unavailable; retrying: " + String(error), "red");
  } finally { bridgeLoading = false; }
}
if (!gameHost.caracAL) {
  void refreshBridge();
  timer = setInterval(() => {
    void refreshBridge();
    if (!deliberatelyStopped()) void refresh();
  }, 2000);
}
function deliberatelyStopped(): boolean {
  return gameHost.localStorage?.getItem("party-code-stopped:" + gameHost.character?.name) === "1";
}
if (!deliberatelyStopped()) void refresh();
