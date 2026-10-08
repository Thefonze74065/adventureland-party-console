"use strict";
// Threaded simulations: one character (game client + CODE) on its own thread, in lockstep with the main thread
// (the game server and the coordinator). The control protocol is ChronAL's sim/client_worker.js, unchanged. The
// difference is what runs here: instead of starting a client at once, the thread waits for the coordinator's
// process_args over a lockstep socket (the caracAL IPC) and then boots the character as caracAL would
// (character.cjs). CODE's HTTP to the coordinator travels over a second lockstep socket.
const { workerData: w, receiveMessageOnPort } = require("node:worker_threads");
const fs = require("node:fs"), path = require("node:path"), { format } = require("node:util");
const chronalSim = (file) => require(path.join(w.chronalDir, "sim", file));
const { VirtualClock } = chronalSim("vclock");
const { RemoteHub, Gate, spinWhile } = chronalSim("fake_io");
const chronal = chronalSim("client_host");
const { bootCharacter } = require("./character.cjs");
const { clientTransport } = require("./transport.cjs");
const { clockedLifecycle } = require("./clocked-require.cjs");

process.on("unhandledRejection", () => {}); // browsers only log these
for (const [k, fd] of [["log", 1], ["info", 1], ["debug", 1], ["warn", 2], ["error", 2]]) console[k] = (...a) => void fs.writeSync(fd, format(...a) + "\n");
const [lo, hi] = w.latencyRange;
const clock = new VirtualClock({ start: w.start, seed: w.seed });
const hub = new RemoteHub(clock, { latency: (rng) => lo + rng() * (hi - lo) });
const env = { clock, hub, root: w.root, localStorage: chronal.putStorage(chronal.makeStorage(), w.storage) };
const ctrl = new Int32Array(w.ctrl), f64 = new Float64Array(w.ctrl), any = new Int32Array(w.any);
const port = w.port, data = w.data;
const gate = new Gate({
  shared: w.shared, self: w.slot, peers: [0], L: w.W, spin: w.spin,
  flush: () => hub.out.length && data.postMessage(hub.take()),
  receive: () => { for (let m; (m = receiveMessageOnPort(data)); ) hub.receive(m.message); },
});

let replies = 0;
const reply = (msg) => {
  port.postMessage({ ...msg, n: ++replies });
  Atomics.add(ctrl, 1, 1);
  Atomics.add(any, 0, 1);
  Atomics.notify(any, 0);
};

// The caracAL IPC and CODE's HTTP, each a lockstep socket to a server on the main thread.
const io = hub.clientIo(JSON);
const ipc = io("http://127.0.0.1", { path: w.sim.ipcPath, query: { name: w.fixture.name } });
const http = io("http://127.0.0.1", { path: w.sim.httpPath });
const log = (level, message) => ipc.emit("log", { level, message });
const pending = new Map();
let nextRequest = 1;
http.on("res", ({ id, result, error }) => {
  const done = pending.get(id);
  if (!done) return;
  pending.delete(id);
  done(error ? new Error(error) : result);
});
const transport = clientTransport((request, done) => {
  const id = nextRequest++;
  pending.set(id, done);
  http.emit("req", { id, ...request });
});

let character = null, fatal = null, lifecycle = null;
ipc.on("ipc", (message) => {
  if (message.type !== "process_args") return void (character && character.receive(message));
  try {
    lifecycle ||= clockedLifecycle({ clock, root: w.repoRoot, onError: (e) => log("error", "[sim runner host] timer error: " + (e && e.stack || e)) });
    character = bootCharacter({
      env, info: w.info, chronal, lifecycle, transport, args: message.arguments,
      credentials: { user_id: w.fixture.user_id, auth: w.fixture.auth }, fps: w.fps,
      send: (m) => ipc.emit("ipc", m), exit: (code) => ipc.emit("exit", code), log, onFatal: (msg) => (fatal ||= msg),
    });
  } catch (error) {
    log("error", `[sim worker] bootstrap failed: ${error && error.stack || error}`);
    ipc.emit("ipc", { type: "bootstrap_failed", error: String(error && (error.stack || error.message) || error) });
    ipc.emit("exit", 1);
  }
});
reply({ ready: true });

// The main thread's commands, as client_worker.js serves them.
let seen = 0;
function serve() {
  if (w.spin) spinWhile(ctrl, 0, seen, w.spin);
  Atomics.wait(ctrl, 0, seen);
  seen = Atomics.load(ctrl, 0);
  const kind = Atomics.load(ctrl, 2);
  try {
    if (kind === 0) {
      const end = f64[2];
      let b0 = performance.now(), waited = gate.waited;
      const busy = () => {
        const now = performance.now();
        f64[3] += now - b0 - (gate.waited - waited);
        b0 = now;
        waited = gate.waited;
      };
      for (let until = Math.min(clock.now + w.W, end); ; until = Math.min(until + w.W, end)) {
        clock.mark(clock.now);
        for (const r of hub.out) r[4] ??= until;
        hub.window = until;
        clock.runSync({ before: until, gate });
        busy();
        if (until >= end) break;
      }
      gate.publish(end);
      hub.window = null;
      busy();
      reply(fatal ? { fatal } : {});
    } else {
      const m = receiveMessageOnPort(port);
      if (!m) throw new Error("[sim] command missing");
      if (m.message.t === "q") reply({ value: character ? character.state.query(m.message.expr) : undefined });
      // A recorded run asks a reloaded page's thread to resume its recording; this host records nothing.
      else if (m.message.t === "rec_open") reply({});
      else if (m.message.t === "stop") return reply({}), process.exit(0);
      else reply({ err: "unsupported command " + m.message.t });
    }
  } catch (e) {
    reply({ err: String((e && e.stack) || e) });
  }
  setImmediate(serve);
}
setImmediate(serve);
