import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = path.resolve(process.argv[2] || path.join(root, ".caracal"));
const file = path.join(target, "src/CharacterThread.js");
let source = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
// JSDOM's default window storage is ephemeral and distinct in each CODE window.
// Expose the IPC stores through the browser names used by game and journal code.
if (!source.includes('localStorage: { value: result._localStorage, configurable: true }')) {
  const anchor = '  vm.createContext(result);';
  if (!source.includes(anchor)) throw new Error('Unrecognized storage context initialization');
  source = source.replace(anchor, `  Object.defineProperties(result, {
    localStorage: { value: result._localStorage, configurable: true },
    sessionStorage: { value: result._sessionStorage, configurable: true },
  });
${anchor}`);
}
source = source
  .replaceAll(".get_game_files()", ".get_game_files(proc_args.version)")
  .replaceAll(".get_runner_files()", ".get_runner_files(proc_args.version)");
// New official helpers read storage while scripts are evaluated, before html_vars.js.
if (!source.includes('game_context.is_electron = false;')) {
  if (!source.includes('  game_context.bowser = {};')) throw new Error('Unrecognized game context initialization');
  source = source.replace('  game_context.bowser = {};',
    '  game_context.bowser = {};\n  game_context.is_electron = false;');
}
// Observe official socket events even before the CODE runner starts.
if (!source.includes('client_update')) {
  source = source.replace('  vm.runInContext("the_game()", game_context);', `  game_context.__partyClientVersion = proc_args.version;
  game_context.__partyClientInstance = proc_args.clientInstance;
  const originalInitSocket = game_context.init_socket;
  const clientUpdateSockets = new WeakSet();
  game_context.init_socket = function (...args) {
    const result = originalInitSocket.apply(this, args);
    if (clientUpdateSockets.has(game_context.socket)) return result;
    clientUpdateSockets.add(game_context.socket);
    for (const event of ["welcome", "reloaded"]) game_context.socket.on(event, () => {
      if (process.connected) process.send({type: "client_update", event});
    });
    return result;
  };
  vm.runInContext("the_game()", game_context);`);
}
if (!source.includes('bootstrap_failed')) {
  source = source.replace('    await make_game(msg.arguments);', `    try {
      await make_game(msg.arguments);
    } catch (error) {
      console.error("game bootstrap failed", error);
      if (process.connected) process.send({type: "bootstrap_failed", error: String(error.message || error)});
      setTimeout(() => process.exit(1), 25);
    }`);
}
// Install in the long-lived game context before its first draw. A CODE-scoped
// callback would become invalid when that runner is disposed.
if (!source.includes('installGameRendering(game_context)')) {
  const anchor = '  vm.runInContext("the_game()", game_context);';
  if (!source.includes(anchor)) throw new Error('Unrecognized native game startup');
  source = source.replace(anchor,
    '  require("../../.build/runtime/lifecycle.cjs").installGameRendering(game_context);\n' + anchor);
}
if (source.includes("createRunnerHost")) {
  await writeFile(file, source);
  process.exit(0);
}

function replace(before: string, after: string): void {
  if (!source.includes(before))
    throw new Error(`Unrecognized caracAL runner: ${before.slice(0, 60)}`);
  source = source.replace(before, after);
}
const start = source.indexOf("async function make_runner(");
const end = source.indexOf("async function make_game(", start);
if (start < 0 || end < 0) throw new Error("Unrecognized caracAL runner layout");
source = source.slice(0, start) + source.slice(end);
source = 'const { createRunnerHost } = require("../../.build/runtime/lifecycle.cjs");\n' + source;
replace(
  "  const old_ng_logic = game_context.new_game_logic;",
  `  let runnerHost;
  const old_ng_logic = game_context.new_game_logic;`,
);
const oldStart = source.indexOf("    (async function () {");
const oldEnd = source.indexOf("    })();", oldStart);
if (oldStart < 0 || oldEnd < 0) throw new Error("Unrecognized runner startup");
source =
  source.slice(0, oldStart) +
  `    if (runnerHost) return;
    if (is_typescript) throw new Error("Use the repository TypeScript build and compiled CODE entrypoints");
    runnerHost = createRunnerHost({
      upper: game_context, createContext: make_context, evaluateFiles: ev_files,
      runnerFiles: game_files.get_runner_files(proc_args.version).map(f => game_files.locate_game_file(f, proc_args.version)),
      codeFile: target_script, send: message => process.send(message),
      codeDependencies: ["farming-zones.js", "shared.js", "profiles.js", "roles.js"].map(file => "./CODE/adventure_land/" + file),
      connected: () => new Promise(resolve => {
        const listener = message => {
          if (message.type !== "siblings_and_acc") return;
          process.off("message", listener);
          resolve();
        };
        process.on("message", listener);
        process.send({ type: "connected" });
      }),
    });
    monitoring_util.register_stat_beat(game_context);
    runnerHost.start().catch(error => {
      console.error("CODE startup failed", error);
      extensions.deploy();
    });` +
  source.slice(oldEnd + "    })();".length);
replace(
  '  process.on("message", (m) => {\n    switch (m.type) {',
  `  process.on("message", (m) => {
    switch (m.type) {
      case "reload_code":
        if (runnerHost) void runnerHost.reload({ id: m.id, generation: m.generation, script: m.script });
        break;
      case "closing_client":
        Promise.resolve(runnerHost?.dispose()).finally(() => process.exit());
        break;`,
);
replace(
  '  vm.runInContext("the_game()", game_context);',
  `  ["SIGINT", "SIGTERM", "SIGQUIT"].forEach(signal => process.on(signal, () => {
    process.send({ type: "shutdown" });
  }));
  vm.runInContext("the_game()", game_context);`,
);
await writeFile(file, source);
