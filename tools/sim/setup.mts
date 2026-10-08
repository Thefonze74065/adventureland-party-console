// Prepares the pinned ChronAL simulator (https://github.com/MtlSnkAI/chronal) under .build/sim/chronal:
// its checkout at `revision`, its npm dependencies, and the game repositories it runs, each at a pinned
// commit. Re-running is safe; it only repairs what does not match the pins.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const target = path.join(root, ".build/sim/chronal");
/** ChronAL 0.10.0. Releases from 0.9.0 include the host-thread and socket.io fixes this tool once patched in. */
export const revision = "e858d3f4cc941cc5ab87b94d2e471c0fb9dfd785";
/** The game ChronAL installs into runtime/app: the commits 0.10.0 is tested with (its upstream.json). */
export const game = {
  adventureland_mongodb: ["https://github.com/kaansoral/adventureland_mongodb", "2148cf25d01060f54bcab01dfa7c2cf5b7baf374"],
  common_engine: ["https://github.com/kaansoral/common_engine", "fa74fabf5d3782503712621e037bfb934ecb8439"],
  adventureland_secretsandconfig: ["https://github.com/kaansoral/adventureland_secretsandconfig", "6b3493be30abe367cfaf879a2d5ad370742e0866"],
} as const;

function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}
function output(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, { cwd, encoding: "utf8" }).stdout.trim();
}
function pin(directory: string, url: string, commit: string) {
  if (!existsSync(path.join(directory, ".git"))) run("git", ["clone", "--quiet", url, directory]);
  if (output("git", ["rev-parse", "HEAD"], directory) !== commit) {
    run("git", ["fetch", "--quiet", "origin"], directory);
    // --force: these checkouts are tool-managed; it discards local edits (such as the patch older pins applied).
    run("git", ["checkout", "--quiet", "--force", "--detach", commit], directory);
  }
}

pin(target, "https://github.com/MtlSnkAI/chronal.git", revision);
// Dependencies follow the pinned revision: reinstall when it moves.
const installed = path.join(target, "node_modules/.party-console-revision");
if (!existsSync(installed) || readFileSync(installed, "utf8") !== revision) {
  run("npm", ["ci", "--no-audit", "--no-fund"], target);
  writeFileSync(installed, revision);
}
for (const [name, [url, commit]] of Object.entries(game)) pin(path.join(target, "upstream", name), url, commit);
run("node", ["chronal.js", "install"], target);
console.log("ChronAL ready:", target);
