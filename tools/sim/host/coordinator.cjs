"use strict";
// Runs the maintained coordinator bundle (.build/runtime/coordinator-application.cjs) inside a vm context on
// ChronAL's virtual clock, the way ChronAL hosts the game's server.js. The repo's own modules are evaluated in
// that context (their Date and timers are virtual); Node built-ins and node_modules load normally. caracAL's
// modules resolve to the stand-ins in caracal.cjs, so nothing reads or writes the user's .caracal install.
const path = require("node:path");
const { EventEmitter } = require("node:events");
const caracal = require("./caracal.cjs");
const { clockedContext, clockedRequire } = require("./clocked-require.cjs");

/** The process object the coordinator sees: its own env and working directory, virtual uptime and hrtime. */
function coordinatorProcess({ clock, cwd, env }) {
  const start = clock.now;
  const hrtime = (previous) => {
    const ns = Math.round((clock.now - start) * 1e6), s = Math.floor(ns / 1e9), rest = ns - s * 1e9;
    if (!previous) return [s, rest];
    let ds = s - previous[0], dn = rest - previous[1];
    if (dn < 0) { ds--; dn += 1e9; }
    return [ds, dn];
  };
  hrtime.bigint = () => BigInt(Math.round((clock.now - start) * 1e6));
  return Object.assign(new EventEmitter(), {
    env, argv: [process.execPath, "CharacterCoordinator.js"], execArgv: [], execPath: process.execPath, title: "sim-coordinator",
    pid: 4242, ppid: 1, arch: process.arch, platform: process.platform, version: process.version, versions: process.versions,
    release: process.release, config: process.config, features: process.features,
    cwd: () => cwd, chdir: () => { throw new Error("[sim] the coordinator may not change directory"); },
    nextTick: process.nextTick, hrtime, uptime: () => (clock.now - start) / 1000,
    memoryUsage: process.memoryUsage.bind(process), cpuUsage: process.cpuUsage.bind(process), resourceUsage: process.resourceUsage.bind(process),
    emitWarning: (warning) => console.warn("[sim coordinator] warning:", warning && warning.message || warning),
    exit: (code) => { throw new Error(`[sim] the coordinator called process.exit(${code})`); },
    kill: () => true, stdout: process.stdout, stderr: process.stderr, stdin: null, connected: false,
    umask: () => 0o022, getuid: process.getuid, getgid: process.getgid,
  });
}

/**
 * @param {object} o
 * @param {import('./types').Clock} o.clock   ChronAL's VirtualClock
 * @param {string} o.root     the repository
 * @param {string} o.runDir   this simulation's caracAL-shaped directory (process.cwd() of the host)
 * @param {object} o.account  caracal.account(...)
 * @param {object} o.game     caracal.gameFiles(...)
 * @param {object} o.config   caracal.config(...)
 * @param {(level:string, message:string, details?:unknown)=>void} o.log
 * @param {() => EventEmitter} o.fork   a character worker stand-in (character-worker.cjs)
 * @param {Map<number, object>} o.apps   receives the Express app per port at listen()
 * @param {Record<string,string>} o.env
 */
/** A Worker for the movement planner bundle that runs on the main thread, on the virtual clock. */
function plannerWorker(clock) {
  return class PlannerWorker extends EventEmitter {
    constructor(file, { workerData } = {}) {
      super();
      const port = new EventEmitter();
      port.postMessage = (message) => clock.at(clock.now, () => this.emit("message", structuredClone(message)), "planner->coordinator");
      this.port = port;
      this.terminated = false;
      const threads = { ...require("node:worker_threads"), parentPort: port, workerData: structuredClone(workerData), isMainThread: false };
      clock.at(clock.now, () => {
        if (this.terminated) return;
        try {
          const real = require("node:module").createRequire(file);
          const wrapped = new Function("exports", "require", "module", "__filename", "__dirname", require("node:fs").readFileSync(file, "utf8"));
          const module = { exports: {} };
          wrapped(module.exports, (name) => (/^(node:)?worker_threads$/.test(name) ? threads : real(name)), module, file, path.dirname(file));
        } catch (error) {
          this.emit("error", error);
        }
      }, "planner start");
    }
    postMessage(message) {
      if (!this.terminated) clock.at(clock.now, () => this.port.emit("message", structuredClone(message)), "coordinator->planner");
    }
    terminate() {
      this.terminated = true;
      this.port.removeAllListeners();
      return Promise.resolve(0);
    }
    unref() {}
    ref() {}
  };
}

function startCoordinator(o) {
  const { clock, root } = o;
  const logging = caracal.logging(o.log);
  const ctx = clockedContext({
    clock,
    globals: { console: logging.console, process: coordinatorProcess({ clock, cwd: o.runDir, env: o.env }) },
    onError: (e) => o.log("error", "[sim coordinator] timer error: " + (e && e.stack || e)),
  });
  const caracalDir = path.join(root, ".caracal"); // virtual: only used to resolve the bundle's relative requires
  const express = require(require.resolve("express", { paths: [root] }));
  const capturedExpress = Object.assign(function simExpress(...args) {
    const app = express(...args);
    app.listen = (port) => { o.apps.set(Number(port), app); return Object.assign(new EventEmitter(), { close() {}, address: () => ({ port }) }); };
    return app;
  }, express);
  // The route planner's worker runs in-process: its bundle gets a fake worker_threads, and messages cross in both
  // directions at the current virtual instant (cloned, as between threads). Planning is synchronous CPU work, so it
  // takes no virtual time, and the run stays deterministic.
  const workerThreads = { ...require("node:worker_threads"), Worker: plannerWorker(clock), isMainThread: true };
  const childProcess = { ...require("node:child_process"), fork: () => o.fork() };
  const make = clockedRequire({
    ctx, root,
    byName: {
      "bot-web-interface": caracal.BotWebInterface,
      express: capturedExpress,
      child_process: childProcess, "node:child_process": childProcess,
      worker_threads: workerThreads, "node:worker_threads": workerThreads,
    },
    byPath: {
      [path.join(caracalDir, "config")]: o.config,
      [path.join(caracalDir, "account_info")]: async () => o.account,
      [path.join(caracalDir, "game_files")]: o.game,
      [path.join(caracalDir, "monitoring_util")]: { create_monitor_ui: () => null, register_stat_beat: () => {} },
      [path.join(caracalDir, "src/CONSTANTS")]: {
        LOCALSTORAGE_PATH: path.join(o.runDir, "localStorage/caraGarage.jsonl"),
        LOCALSTORAGE_ROTA_PATH: path.join(o.runDir, "localStorage/caraGarage.other.jsonl"),
        STAT_BEAT_INTERVAL: 500, COORDINATOR_MODULE_PATH: "./standalones/CharacterCoordinator.js",
      },
      [path.join(caracalDir, "src/LogUtils")]: logging,
    },
  });
  ctx.require = make(path.join(caracalDir, "standalones/CharacterCoordinator.js"));
  const application = ctx.require(path.join(root, ".build/runtime/coordinator-application.cjs"));
  const started = application.startCoordinatorApplication({
    require: ctx.require,
    directory: path.join(caracalDir, "standalones"),
    loadFetch: async () => ctx.fetch,
  });
  return { ctx, started, require: ctx.require };
}

module.exports = { startCoordinator };
