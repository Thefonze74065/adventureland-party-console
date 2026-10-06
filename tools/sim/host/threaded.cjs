"use strict";
// Threaded simulations, main-thread side: one client thread per character (client-thread.cjs), started before the
// run, and two lockstep socket servers on the main thread's hub: the caracAL IPC between the coordinator and each
// character, and CODE's HTTP into the coordinator's captured Express app (dispatched as transport.cjs does).
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { dispatch } = require("./transport.cjs");

const IPC_PATH = "/sim-caracal-ipc/", HTTP_PATH = "/sim-party-api/";

/**
 * @param {object} o
 * @param {object} o.sim        ChronAL ThreadedSim
 * @param {Map<number, object>} o.apps   the coordinator's Express app per port
 * @param {object} o.stats      transport stats to add the characters' requests to
 * @param {(level:string, message:string)=>void} o.log
 */
function threadedHost(o) {
  const { sim } = o, clock = sim.clock;
  const { Server } = sim.hub.socketIoModule(JSON);
  const http = Server(null, { path: HTTP_PATH });
  http.on("connection", (socket) => socket.on("req", (m) => {
    const parsed = new URL(m.url, "http://127.0.0.1:924");
    const kind = m.body && /"combatWait":true/.test(m.body) ? " [combatWait]" : m.body && /"combatOnly":true/.test(m.body) ? " [combatOnly]" : "";
    o.stats.requests++;
    o.stats.byPath.set(parsed.pathname + kind, (o.stats.byPath.get(parsed.pathname + kind) || 0) + 1);
    if (m.body && m.body.length > o.stats.largestBody) o.stats.largestBody = m.body.length;
    if (o.stats.observe) o.stats.observe(parsed.pathname, m.body);
    const local = /^(127\.0\.0\.1|localhost)$/.test(parsed.hostname), app = local && o.apps.get(Number(parsed.port || 80));
    if (!app) {
      o.stats.errors++;
      return void socket.emit("res", { id: m.id, error: local ? "nothing listens on " + parsed.host : "network disabled: " + parsed.host });
    }
    dispatch(app, { method: m.method || "GET", path: parsed.pathname + parsed.search, headers: m.headers, body: m.body }, (result) => {
      const tag = parsed.pathname + " " + result.statusCode;
      o.stats.byStatus.set(tag, (o.stats.byStatus.get(tag) || 0) + 1);
      if (result.statusCode >= 400 && !o.stats.firstFailure.has(tag)) o.stats.firstFailure.set(tag, result.body.slice(0, 300));
      if (o.stats.observeResponse) o.stats.observeResponse(parsed.pathname, m.body, result.body);
      socket.emit("res", { id: m.id, result: { ...result, headers: Object.fromEntries(Object.entries(result.headers || {}).map(([k, v]) => [k, String(v)])) } });
    });
  }));

  const sockets = new Map(), workers = new Map(), queued = new Map();
  const ipc = Server(null, { path: IPC_PATH });
  ipc.on("connection", (socket) => {
    const name = String(socket.handshake.query.name);
    sockets.set(name, socket);
    for (const message of queued.get(name) || []) socket.emit("ipc", message);
    queued.delete(name);
    socket.on("ipc", (message) => { const worker = workers.get(name); if (worker) worker.emit("message", message); });
    socket.on("log", ({ level, message }) => o.log(level, message));
    socket.on("exit", (code) => { const worker = workers.get(name); if (worker) worker.exit(code); });
  });
  const toThread = (name, message) => {
    const socket = sockets.get(name);
    if (socket) socket.emit("ipc", message);
    else queued.set(name, [...(queued.get(name) || []), message]);
  };

  /** The coordinator's fork(): bound to a character's thread once process_args names it. */
  let forks = 0;
  function fork() {
    const worker = new EventEmitter();
    worker.stdout = new PassThrough();
    worker.stderr = new PassThrough();
    worker.connected = true;
    worker.pid = 6000 + forks++;
    worker.exitCode = null;
    let name = null;
    worker.exit = (code) => {
      if (!worker.connected) return;
      worker.connected = false; worker.exitCode = code;
      clock.at(clock.now, () => { worker.emit("disconnect"); worker.emit("exit", code, null); }, "worker exit");
    };
    worker.kill = () => { worker.exit(null); return true; };
    worker.disconnect = () => worker.exit(0);
    worker.send = (message) => {
      if (message.type === "process_args") {
        name = message.arguments.cname;
        workers.set(name, worker);
      }
      if (name) toThread(name, message);
      return true;
    };
    clock.at(clock.now, () => worker.emit("message", { type: "process_ready" }), "worker ready");
    return worker;
  }

  /** Log every character's thread in before the run: it waits for the coordinator's process_args. */
  function start(characters, { chronalDir, repoRoot, fps }) {
    for (const c of characters)
      sim.login({ user_id: c.user_id, auth: c.auth, character: c.id, name: c.name }, {
        name: c.name, type: c.type, account: "party", code: "", fps: fps || 20,
        worker: path.join(__dirname, "client-thread.cjs"),
        extra: { chronalDir, repoRoot, sim: { ipcPath: IPC_PATH, httpPath: HTTP_PATH } },
      });
  }

  return { fork, start };
}

module.exports = { threadedHost };
