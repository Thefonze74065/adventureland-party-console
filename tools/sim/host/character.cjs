"use strict";
// One character, as caracAL's src/CharacterThread.js runs it once the coordinator sends process_args: a game client
// (here a ChronAL client) with the caracAL extensions, IPC-backed storage, and the CODE run by the repository's own
// runner host (runtime/lifecycle/runner-host.ts), unmodified. Shared by single-thread and threaded simulations.

/** Web Storage whose writes are reported to the coordinator, as caracAL's ipcStorage does. */
function ipcStorage(ident, send) {
  const items = new Map();
  const storage = {
    setItem(key, value) { key = String(key); value = String(value); items.set(key, value); send({ type: "stor", op: "set", ident, data: { [key]: value } }); },
    getItem(key) { return items.has(String(key)) ? items.get(String(key)) : null; },
    removeItem(key) { key = String(key); items.delete(key); send({ type: "stor", op: "del", ident, data: [key] }); },
    clear() { items.clear(); send({ type: "stor", op: "clear", ident }); },
    key(n) { return Array.from(items.keys())[n] ?? null; },
    get length() { return items.size; },
  };
  const receive = (m) => {
    if (m.op === "set") for (const k in m.data) items.set(k, m.data[k]);
    else if (m.op === "del") for (const k of m.data) items.delete(k);
    else if (m.op === "clear") items.clear();
  };
  return { storage, receive };
}

/**
 * @param {object} o
 * @param {object} o.env          ChronAL environment of the thread that runs the client
 * @param {object} o.info         ChronAL clientInfo(server)
 * @param {object} o.chronal      { startClient, makeWindow, run, RUNNER_FILES }
 * @param {object} o.lifecycle    the repository's lifecycle bundle on this clock (clocked-require.cjs)
 * @param {object} o.transport    { xhrClass(), fetchFunction() }
 * @param {object} o.args         caracAL process_args
 * @param {{user_id:string, auth:string}} o.credentials   ChronAL login of args.cid
 * @param {(message:object)=>void} o.send   to the coordinator
 * @param {(code:number)=>void} o.exit
 * @param {(level:string, message:string)=>void} o.log
 * @returns {{ state: object, receive(message: object): void }}
 */
function bootCharacter(o) {
  const { env, chronal, args, send, log } = o;
  const ls = ipcStorage("ls", send), ss = ipcStorage("ss", send);
  const state = chronal.startClient(env, o.info, {
    user_id: o.credentials.user_id, auth: o.credentials.auth, character: String(args.cid), name: args.cname,
    code: "", fps: o.fps || 20, onFatal: o.onFatal,
  });
  const game = state.game;
  state.runner = { placeholder: true }; // ChronAL must not start its own CODE runner: the runner host does
  for (const [name, store] of [["localStorage", ls.storage], ["sessionStorage", ss.storage]])
    Object.defineProperty(game, name, { value: store, writable: true, configurable: true });
  game._localStorage = ls.storage; game._sessionStorage = ss.storage;

  const extensions = {
    log: { info: (d, m) => log("info", `[${args.cname}] ${m ?? d}`), warn: (d, m) => log("warn", `[${args.cname}] ${m ?? d}`), error: (d, m) => log("error", `[${args.cname}] ${m ?? d}`) },
    deploy: (character, realm, script, version) => send({ type: "deploy", ...(character && { character }), ...(realm && { realm }), ...(script && { script }), ...(version && { version }) }),
    shutdown: (character) => send({ type: "shutdown", character }),
    map_enabled: () => !!args.enable_map,
  };
  game.caracAL = extensions;
  game.__partyClientVersion = args.version;
  game.__partyClientInstance = args.clientInstance;
  game.get_code_function = (name) => (extensions.runner && extensions.runner[name]) || function () {};
  const api = game.api_call;
  game.api_call = (method, a, r) => (method === "servers_and_characters" ? undefined : api(method, a, r));

  const handlers = [];
  let runnerHost = null;
  const runnerFiles = chronal.RUNNER_FILES.filter((file) => !/jquery/.test(file));
  const jquery = chronal.RUNNER_FILES.find((file) => /jquery/.test(file));
  const ngl = game.new_game_logic;
  game.new_game_logic = function () {
    ngl.apply(this, arguments);
    if (runnerHost) return;
    runnerHost = o.lifecycle.createRunnerHost({
      upper: game,
      createContext(parent) {
        const runner = chronal.makeWindow(env, {
          upper: parent, label: args.cname + " CODE", scripts: true,
          onError: (e) => { state.errors++; log("error", `[${args.cname} CODE] ${e && (e.stack || e.message) || e}`); },
        });
        runner.XMLHttpRequest = o.transport.xhrClass();
        runner.fetch = o.transport.fetchFunction();
        runner.console = { log() {}, info() {}, debug() {}, warn: (...a) => log("warn", `[${args.cname} CODE] ${a.join(" ")}`), error: (...a) => log("error", `[${args.cname} CODE] ${a.join(" ")}`) };
        for (const [name, store] of [["localStorage", ls.storage], ["sessionStorage", ss.storage]])
          Object.defineProperty(runner, name, { value: store, writable: true, configurable: true });
        chronal.run(runner, env.root, jquery); // caracAL gives every runner jQuery before the runner files
        runner.close = runner.close || (() => {});
        return runner;
      },
      evaluateFiles: async (files, runner) => { for (const file of files) chronal.run(runner, env.root, file); },
      runnerFiles,
      codeFile: "./CODE/" + (args.script_file || "adventure_land/party-member.js"),
      codeDependencies: ["farming-zones.js", "shared.js", "profiles.js", "roles.js"].map((file) => "./CODE/adventure_land/" + file),
      connected: () => new Promise((resolve) => {
        const listener = (message) => {
          if (message.type !== "siblings_and_acc") return;
          handlers.splice(handlers.indexOf(listener), 1);
          resolve();
        };
        handlers.push(listener);
        send({ type: "connected" });
      }),
      send,
    });
    runnerHost.start().catch((error) => { log("error", `[${args.cname}] CODE startup failed: ${error && error.stack || error}`); extensions.deploy(); });
  };
  handlers.push((m) => {
    if (m.type === "stor") (m.ident === "ss" ? ss : ls).receive(m);
    else if (m.type === "siblings_and_acc") { extensions.siblings = m.siblings; if (game.handle_information) game.handle_information([m.account]); }
    else if (m.type === "receive_cm") game.call_code_function("trigger_character_event", "cm", { name: m.name, message: m.data, caracAL: true });
    else if (m.type === "send_cm") game.send_code_message(m.to, m.data);
    else if (m.type === "reload_code" && runnerHost) void runnerHost.reload({ id: m.id, generation: m.generation, script: m.script });
    else if (m.type === "closing_client") void Promise.resolve(runnerHost && runnerHost.dispose()).finally(() => o.exit(0));
  });
  send({ type: "initialized" });
  return { state, receive: (message) => { for (const handler of handlers.slice()) handler(message); } };
}

module.exports = { bootCharacter, ipcStorage };
