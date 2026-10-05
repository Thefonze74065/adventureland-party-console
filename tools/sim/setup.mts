// Prepares the pinned ChronAL simulator (https://github.com/MtlSnkAI/chronal) under .build/sim/chronal:
// its checkout at `revision`, our compatibility patch, its npm dependencies, and the game repositories
// it runs, each at a pinned commit. Re-running is safe; it only repairs what does not match the pins.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const target = path.join(root, ".build/sim/chronal");
export const revision = "00e11720c6f3a1b4839403c5004cf61f4305e579";
/** The game ChronAL installs into runtime/app, pinned so a game update can't silently change a simulation. */
export const game = {
  adventureland_mongodb: ["https://github.com/kaansoral/adventureland_mongodb", "987831288c40928b959bc06a626a4d67cd0c98ca"],
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
    run("git", ["checkout", "--quiet", "--detach", commit], directory);
  }
}

pin(target, "https://github.com/MtlSnkAI/chronal.git", revision);
// The patch fixes ChronAL against the pinned game (MtlSnkAI/chronal#1) and exports its window builder.
const patch = path.join(root, "tools/sim/patches/chronal.patch");
if (spawnSync("git", ["apply", "--check", patch], { cwd: target }).status === 0) run("git", ["apply", patch], target);
else if (spawnSync("git", ["apply", "--reverse", "--check", patch], { cwd: target }).status !== 0)
  throw new Error("tools/sim/patches/chronal.patch neither applies nor is applied to the pinned ChronAL checkout");
if (!existsSync(path.join(target, "node_modules"))) run("npm", ["ci", "--no-audit", "--no-fund"], target);
for (const [name, [url, commit]] of Object.entries(game)) pin(path.join(target, "upstream", name), url, commit);
run("node", ["chronal.js", "install"], target);
console.log("ChronAL ready:", target);
