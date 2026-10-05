"use strict";
// Single-thread simulations: the process the coordinator forks per character (caracAL's src/CharacterThread.js),
// as an in-process stand-in speaking the same IPC. The character itself is character.cjs.
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { bootCharacter } = require("./character.cjs");

/**
 * @param {object} o
 * @param {object} o.sim         ChronAL Sim (single-thread)
 * @param {object} o.chronal     ChronAL client_host
 * @param {object} o.lifecycle   the runner host bundle on the sim's clock
 * @param {object} o.transport   transport.cjs
 * @param {(cid:string)=>{user_id:string, auth:string}} o.login
 * @param {(level:string, message:string)=>void} o.log
 */
function workerFactory(o) {
  const sim = o.sim, clock = o.sim.clock;
  let forks = 0;
  return function fork() {
    const worker = new EventEmitter();
    worker.stdout = new PassThrough();
    worker.stderr = new PassThrough();
    worker.connected = true;
    worker.pid = 5000 + forks++;
    worker.exitCode = null;
    const send = (message) => clock.at(clock.now, () => worker.emit("message", message), "worker->coordinator");
    const exit = (code) => {
      if (!worker.connected) return;
      worker.connected = false; worker.exitCode = code;
      clock.at(clock.now, () => { worker.emit("disconnect"); worker.emit("exit", code, null); }, "worker exit");
    };
    let character = null;
    worker.kill = () => { exit(null); return true; };
    worker.disconnect = () => exit(0);
    worker.send = (message) => {
      clock.at(clock.now, () => {
        if (message.type !== "process_args") return void (character && character.receive(message));
        try {
          const args = message.arguments;
          character = bootCharacter({ env: sim.env, info: o.chronal.clientInfo(sim.server), chronal: o.chronal, lifecycle: o.lifecycle,
            transport: o.transport, args, credentials: o.login(String(args.cid)), send, exit, log: o.log, fps: o.fps, onFatal: (msg) => sim.fail(msg) });
          const state = character.state;
          sim.clients.push({ name: args.cname, state, game: state.game, query: async (expr) => state.query(expr), get errors() { return state.errors; } });
        } catch (error) {
          o.log("error", `[sim worker] bootstrap failed: ${error && error.stack || error}`);
          send({ type: "bootstrap_failed", error: String(error && (error.stack || error.message) || error) });
          exit(1);
        }
      }, "coordinator->worker");
      return true;
    };
    clock.at(clock.now, () => send({ type: "process_ready" }), "worker ready");
    return worker;
  };
}

module.exports = { workerFactory };
