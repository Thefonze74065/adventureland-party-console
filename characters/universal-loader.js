// Generated from TypeScript; run npm run build:runtime -- --publish. Do not edit.
"use strict";
(() => {
  // runtime/characters/loader-artifact.ts
  async function classArtifact(read, name) {
    const manifest = JSON.parse(await read("manifest.json"));
    const entry = manifest.classes?.[name];
    if (manifest.schema !== 1 || !entry || !/^generated\/[a-f0-9]{64}\/[a-z]+\.js$/.test(entry.file))
      throw new Error("Invalid compiled class manifest");
    return entry;
  }
  async function compileArtifact(read, entry, baseUrl2) {
    const bundle = await read(entry.file);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bundle)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== entry.sha256) throw new Error("Compiled class checksum mismatch");
    const compiled = new Function(bundle + "\n//# sourceURL=" + baseUrl2 + entry.file);
    return () => {
      compiled();
    };
  }

  // runtime/steam/connection.ts
  var steamBridgeVersion = 12;
  function needsSteamBridge(bridge, server2) {
    return !bridge || bridge.version !== steamBridgeVersion || bridge.server !== server2;
  }
  function initializeConnection(host = globalThis) {
    const script = host.document?.currentScript;
    const src = script && "src" in script ? script.src : void 0;
    let server2 = serverAddress(host);
    if (src) {
      const url = new URL(src);
      const suffix = "/CODE/adventure_land/universal-loader.js";
      if (!["http:", "https:"].includes(url.protocol) || !url.pathname.endsWith(suffix))
        throw new Error("Invalid Party Console loader URL");
      server2 = url.origin + url.pathname.slice(0, -suffix.length);
    }
    host.__partyServer = server2;
    if (host.parent) host.parent.__partyServer = server2;
    return server2;
  }
  function serverAddress(host = globalThis) {
    return (host.__partyServer || host.parent?.__partyServer || "http://127.0.0.1:924").replace(
      /\/$/,
      ""
    );
  }
  function steamBootstrap(base) {
    return `$.getScript(${JSON.stringify(base.replace(/\/$/, "") + "/CODE/adventure_land/universal-loader.js")});`;
  }

  // runtime/characters/universal-loader.ts
  var server = initializeConnection();
  var baseUrl = server + "/CODE/adventure_land/";
  var root = globalThis;
  var gameHost = root.parent;
  root.__partyCodeLoader?.dispose();
  var generation = (root.__partyLoaderGeneration || 0) + 1;
  root.__partyLoaderGeneration = generation;
  var abort = new AbortController();
  var lastSource = null;
  var loading = false;
  var bridgeLoading = false;
  var timer;
  async function source(file) {
    const response = await fetch(baseUrl + file + "?t=" + Date.now(), {
      cache: "no-store",
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6e3)])
    });
    if (!response.ok) throw new Error(`CODE ${file}: HTTP ${response.status}`);
    return response.text();
  }
  function current() {
    return !abort.signal.aborted && root.__partyLoaderGeneration === generation && root.parent === gameHost;
  }
  function occupied() {
    return root.sharedRoutine?.canReload ? !root.sharedRoutine.canReload() : !!root.sharedRoutine?.isOccupied?.();
  }
  function needsNewFrame() {
    return lastSource !== null && !root.parent.caracAL;
  }
  function replaceFrame() {
    dispose();
    const bootstrap = steamBootstrap(server);
    gameHost.setTimeout(() => gameHost.start_runner("maincode", bootstrap), 0);
  }
  function install(signature, compiled) {
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
  function report(error) {
    if (current()) root.game_log("Party loader failed: " + String(error), "red");
  }
  async function refresh(force = false) {
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
    } finally {
      loading = false;
    }
  }
  var disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    clearInterval(timer);
    root.removeEventListener?.("pagehide", dispose);
    root.__partyRuntimeGeneration = (root.__partyRuntimeGeneration || 0) + 1;
    root.partyRoleRunner?.stop();
    if (root.parent === gameHost) root.sharedRoutine?.stop();
  }
  root.__partyCodeLoader = { dispose };
  root.addEventListener?.("pagehide", dispose);
  async function refreshBridge() {
    if (bridgeLoading || !current() || !needsSteamBridge(gameHost.__partySteamBridge, server)) return;
    bridgeLoading = true;
    try {
      const text = await source("steam-bridge.js");
      if (current() && needsSteamBridge(gameHost.__partySteamBridge, server)) gameHost.eval(text);
    } catch (error) {
      if (current()) root.game_log("Steam bridge unavailable; retrying: " + String(error), "red");
    } finally {
      bridgeLoading = false;
    }
  }
  if (!gameHost.caracAL) {
    void refreshBridge();
    timer = setInterval(() => {
      void refreshBridge();
      if (!deliberatelyStopped()) void refresh();
    }, 2e3);
  }
  function deliberatelyStopped() {
    return gameHost.localStorage?.getItem("party-code-stopped:" + gameHost.character?.name) === "1";
  }
  if (!deliberatelyStopped()) void refresh();
})();
