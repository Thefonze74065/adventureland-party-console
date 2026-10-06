"use strict";
// Runs a party-console simulation: the pinned ChronAL game server and clients (tools/sim/setup.mts), the
// repository's coordinator on the same virtual clock, and every character's real CODE through the runner host.
// Usage: node tools/sim/run.cjs <scenario.json>   (scenarios: tools/sim/scenarios/)
// Output: .build/sim-results/<scenario>-<timestamp>/{report.json,timeline.jsonl,coordinator.log}
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const root = path.resolve(__dirname, "../..");
const chronalDir = path.join(root, ".build/sim/chronal");
const appRoot = path.join(chronalDir, "runtime/app");
if (!fs.existsSync(path.join(appRoot, "node/server.js"))) throw new Error("ChronAL is not set up: run node tools/sim/setup.mts");
if (!fs.existsSync(path.join(root, ".build/runtime/coordinator-application.cjs"))) throw new Error("The coordinator is not built: run npm run build:runtime");

const { createSim } = require(path.join(chronalDir, "sim/sim.js"));
const chronal = require(path.join(chronalDir, "sim/client_host.js"));
const caracal = require("./host/caracal.cjs");
const { startCoordinator } = require("./host/coordinator.cjs");
const { createTransport } = require("./host/transport.cjs");
const { workerFactory } = require("./host/character-worker.cjs");
const { clockedLifecycle } = require("./host/clocked-require.cjs");
const { threadedHost } = require("./host/threaded.cjs");

async function main() {
  const scenarioFile = path.resolve(process.argv[2] || path.join(__dirname, "scenarios/boot.json"));
  const scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
  const id = `${path.basename(scenarioFile, ".json")}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const out = path.join(root, ".build/sim-results", id);
  const runDir = path.join(root, ".build/sim-runs", id);
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(runDir, "CODE"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "localStorage"), { recursive: true });
  codeDirectory(path.join(runDir, "CODE/adventure_land"));
  const gameCache = (version, G) => {
    // caracAL's flat game cache (./game_files/<version>/<file>), read directly by the coordinator's catalogs.
    const dir = path.join(runDir, "game_files", String(version));
    fs.mkdirSync(dir, { recursive: true });
    for (const sub of ["js", "common/js"])
      for (const file of fs.readdirSync(path.join(appRoot, sub)).filter((f) => f.endsWith(".js")))
        if (!fs.existsSync(path.join(dir, file))) fs.symlinkSync(path.join(appRoot, sub, file), path.join(dir, file));
    fs.writeFileSync(path.join(dir, "data.js"), "var G=" + JSON.stringify(G) + ";\n"); // what /data.js serves
  };
  process.chdir(runDir); // the coordinator and runner host resolve ./CODE and ./localStorage from here

  const logFile = fs.openSync(path.join(out, "coordinator.log"), "a");
  const counts = { error: 0, warn: 0 };
  let sim = null; // set below; the log stamps virtual time once it exists
  const log = (level, message, details) => {
    if (level in counts) counts[level]++;
    const at = sim ? new Date(sim.clock.nowMs()).toISOString() : "boot";
    fs.writeSync(logFile, `${at} ${level.toUpperCase()} ${message}${details ? " " + JSON.stringify(details) : ""}\n`);
  };

  sim = await createSim({ root: appRoot, seed: scenario.seed ?? 1, ping: scenario.ping ?? 18, quiet: true, threads: !!scenario.threads, seasons: scenario.seasons || [] });
  const clock = sim.clock;
  const apps = new Map();
  const [lo, hi] = sim.latencyRange;
  const transport = createTransport({ clock, apps, latency: () => lo + clock.rng() * (hi - lo) });
  // Progress on stderr every few real seconds: a stalled or runaway simulation shows here first.
  let lastEvents = 0;
  const progress = setInterval(() => {
    const heap = Math.round(process.memoryUsage().heapUsed / 1048576);
    process.stderr.write(`[sim] t=${((clock.now - clock.start) / 60000).toFixed(2)} vmin events=${clock.events} (+${clock.events - lastEvents}) heap=${heap}MB http=${transport.stats.requests} open=${transport.open}\n`);
    lastEvents = clock.events;
  }, Number(process.env.SIM_PROGRESS_MS) || 5000);
  progress.unref();
  gameCache(sim.server.G.version, JSON.parse(chronal.clientInfo(sim.server).gJson));
  const realm = scenario.realm || "SR_USI";
  const characters = scenario.characters.map((c) => {
    const fx = sim.createCharacter({ name: c.name, type: c.type, account: "party", over: c.over || { level: c.level || 50 } });
    return { ...c, id: fx.character, user_id: fx.user_id, auth: fx.auth, level: c.level || 50, version: sim.server.G.version };
  });
  const credentials = new Map(characters.map((c) => [c.id, c]));

  // Threaded: one thread per character (its client and CODE), in lockstep with the server and coordinator.
  const threaded = scenario.threads ? threadedHost({ sim, apps, stats: transport.stats, log }) : null;
  if (threaded) threaded.start(characters, { chronalDir, repoRoot: root, fps: scenario.fps });
  const fork = threaded ? threaded.fork : workerFactory({
    sim, chronal, transport, log, fps: scenario.fps,
    lifecycle: clockedLifecycle({ clock, root, onError: (e) => log("error", "[sim runner host] timer error: " + (e && e.stack || e)) }),
    login: (cid) => {
      const c = credentials.get(cid);
      if (!c) throw new Error("[sim] the coordinator asked for an unknown character " + cid);
      return c;
    },
  });
  const port = 924;
  const coordinator = startCoordinator({
    clock, root, runDir, log, fork, apps,
    account: caracal.account({ realm, characters }),
    game: caracal.gameFiles({ appRoot, version: sim.server.G.version, revision: "sim" }),
    config: caracal.config({ characters, merchant: scenario.merchant, realm, port }),
    env: { AL_DATA_DIR: runDir, PARTY_MOVEMENT_MODE: scenario.movement || "alclient", AL_INTERNAL_API_PORT: String(port), NODE_ENV: "production" },
  });
  coordinator.started.catch((error) => log("error", "coordinator boot failed: " + (error && error.stack || error)));

  /** The coordinator's own API, called in-process at the current virtual time. */
  const api = (method, route, body) => new Promise((resolve, reject) => transport.request({
    method, url: `http://127.0.0.1:${port}/party-api${route}`, headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, (result) => (result instanceof Error ? reject(result) : resolve({ status: result.statusCode, body: safeJson(result.body) }))));

  // Boot reads the game cache from disk (real I/O): give it real time until the API listens.
  const bootDeadline = performance.now() + 120000;
  while (!apps.has(port) && performance.now() < bootDeadline && !sim.halted) {
    await sim.run(50);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!apps.has(port)) throw new Error("[sim] the coordinator did not start its API (see coordinator.log)");
  log("info", `[sim] coordinator API listening after ${((clock.now - clock.start) / 1000).toFixed(1)} virtual s`);

  // Baselines for the report, and deaths counted on the server (a rip that clears between samples still counts).
  const baseline = new Map(); // each character from when it is first on the server
  const deaths = new Map();
  const ripped = new Set();
  const deathLog = [];
  const tracked = { types: scenario.track || [], alive: new Map(), kills: [] };
  let startedAt = clock.now; // reset when the scenario starts
  clock.timer(() => {
    for (const p of Object.values(sim.server.players || {})) {
      if (!baseline.has(p.name)) baseline.set(p.name, { xp: p.xp, gold: p.gold, level: p.level });
      if (p.rip && !ripped.has(p.name)) {
        ripped.add(p.name); deaths.set(p.name, (deaths.get(p.name) || 0) + 1);
        // Who was on this character when it died, from the game server.
        const attackers = Object.values((sim.server.instances[p.in] || {}).monsters || {}).filter((m) => m.target === p.name)
          .map((m) => ({ id: m.id, type: m.type, hp: m.hp, max_hp: m.max_hp, x: Math.round(m.x), y: Math.round(m.y) }));
        deathLog.push({ name: p.name, minute: +((clock.now - startedAt) / 60000).toFixed(2), map: p.map, x: Math.round(p.x), y: Math.round(p.y), attackers });
      }
      if (!p.rip) ripped.delete(p.name);
    }
    // scenario.track: spawn and death of each listed monster type (a death is the monster gone or dead).
    if (!tracked.types.length) return;
    const seen = new Set();
    for (const instance of Object.values(sim.server.instances || {}))
      for (const m of Object.values(instance.monsters || {})) {
        if (!tracked.types.includes(m.type) || m.dead) continue;
        seen.add(m.id);
        if (!tracked.alive.has(m.id)) tracked.alive.set(m.id, { type: m.type, map: m.map, spawnedAt: clock.now });
      }
    for (const [id, m] of tracked.alive)
      if (!seen.has(id)) {
        tracked.alive.delete(id);
        tracked.kills.push({ ...m, id, minute: +((clock.now - startedAt) / 60000).toFixed(2), cycleMinutes: +((clock.now - m.spawnedAt) / 60000).toFixed(2) });
        delete tracked.kills.at(-1).spawnedAt;
      }
  }, 1000, [], true, "node", (e) => log("error", String(e)));

  // SIM_TRACE=<from>-<to> (virtual minutes): request bodies and the game server's view of each character (at most
  // every 250 ms) to trace.jsonl. It only reads, from requests the run makes anyway: a timer of its own would change
  // the clock's event order, and the traced replay would no longer be the run it investigates.
  const windows = (process.env.SIM_TRACE || "").split(",").map((w) => /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(w.trim())).filter(Boolean)
    .map((w) => [clock.now + w[1] * 60000, clock.now + w[2] * 60000]);
  if (windows.length) {
    const traceFile = fs.openSync(path.join(out, "trace.jsonl"), "a");
    const write = (entry) => fs.writeSync(traceFile, JSON.stringify({ at: new Date(clock.now).toISOString(), ...entry }) + "\n");
    let snapshotAt = 0;
    transport.stats.observe = (route, body) => {
      if (!windows.some(([from, to]) => clock.now >= from && clock.now <= to)) return;
      if (body) write({ route, body: safeJson(body) });
      if (clock.now - snapshotAt < 250) return;
      snapshotAt = clock.now;
      for (const p of Object.values(sim.server.players || {})) write({ server: p.name, map: p.map, x: Math.round(p.x), y: Math.round(p.y), moving: p.moving, c: p.c, s: Object.keys(p.s || {}), rip: p.rip, hp: p.hp });
    };
    // SIM_TRACE_RESPONSES=1 also records the coordinator's reply to each request in the window (large).
    if (process.env.SIM_TRACE_RESPONSES) transport.stats.observeResponse = (route, body, response) => {
      if (!windows.some(([from, to]) => clock.now >= from && clock.now <= to)) return;
      const request = safeJson(body);
      write({ route, response: true, character: request && (request.name || request.character) || null, body: safeJson(response) });
    };
  }

  const timeline = fs.openSync(path.join(out, "timeline.jsonl"), "a");
  startedAt = clock.now;
  const real0 = performance.now();
  const end = startedAt + scenario.minutes * 60000;
  const sampleEvery = (scenario.sampleSeconds ?? 60) * 1000;
  const steps = (scenario.steps || []).map((s) => ({ ...s, at: startedAt + s.atSeconds * 1000, done: false }));
  let nextSample = startedAt;
  while (clock.now < end && !sim.halted) {
    const due = Math.min(end, nextSample, ...steps.filter((s) => !s.done).map((s) => s.at));
    while (clock.now < due && !sim.halted) {
      await sim.run(due - clock.now);
    }
    for (const step of steps.filter((s) => !s.done && s.at <= clock.now)) {
      step.done = true;
      if (step.action === "farm") await farm(step);
      else if (step.action === "hunt") await hunt(step);
      else await call(step.method || "POST", step.route, step.body);
    }
    if (clock.now >= nextSample) {
      nextSample += sampleEvery;
      const state = await waitFor(api("GET", "/state?catalog=0")).catch((error) => ({ body: { error: String(error) } }));
      fs.writeSync(timeline, JSON.stringify(sample(clock.now - startedAt, state.body, sim)) + "\n");
    }
  }
  const realMs = performance.now() - real0, virtualMs = clock.now - startedAt;
  const finalState = await waitFor(api("GET", "/state"));
  // The whole coordinator state at the end (combat logs, rare-hunt state, queues), for after-the-fact diagnosis.
  fs.writeFileSync(path.join(out, "final-state.json"), JSON.stringify(finalState.body));
  const report = {
    scenario: path.basename(scenarioFile), seed: scenario.seed ?? 1, game: sim.server.G.version,
    virtualMinutes: +(virtualMs / 60000).toFixed(1), realSeconds: +(realMs / 1000).toFixed(1), speed: +(virtualMs / realMs).toFixed(1),
    log: counts, http: { requests: transport.stats.requests, errors: transport.stats.errors,
      byStatus: Object.fromEntries(transport.stats.byStatus), firstFailure: Object.fromEntries(transport.stats.firstFailure), byPath: Object.fromEntries([...transport.stats.byPath].sort((a, b) => b[1] - a[1]).slice(0, 15)) },
    final: sample(virtualMs, finalState.body, sim), halted: sim.halted, failed: sim.failed,
    threads: scenario.threads ? Object.fromEntries(Object.entries(sim.busy()).map(([k, v]) => [k, +(v / 1000).toFixed(1)])) : undefined,
    characters: Object.fromEntries(characters.map((c) => {
      const p = Object.values(sim.server.players || {}).find((x) => x.name === c.name), b = baseline.get(c.name) || {};
      return [c.name, p ? { level: p.level, xpGained: p.xp - (b.xp || 0) + levelXp(b.level, p.level, sim), goldGained: p.gold - (b.gold || 0), deaths: deaths.get(c.name) || 0 } : { offline: true }];
    })),
    kills: tracked.types.length ? tracked.kills : undefined,
    deaths: deathLog,
  };
  report.expect = scenario.expect ? check(scenario.expect, report) : undefined;
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("results:", out);
  await sim.close(); // client threads (threaded runs) keep the process alive otherwise
  if (report.expect && !report.expect.pass) {
    console.error("[sim] expectations failed:\n  " + report.expect.failures.join("\n  "));
    process.exitCode = 1;
  }

  async function call(method, route, body) {
    const result = await waitFor(api(method, route, body));
    log(result.status < 400 ? "info" : "warn", `[scenario] ${method} ${route} -> ${result.status}`, result.body && result.body.error ? { error: result.body.error } : undefined);
    return result;
  }
  /** What the dashboard does to farm: formation, focus, then travel to the monster's farming area (Mainland first). */
  async function farm(step) {
    await call("POST", "/formation", { leader: step.leader });
    for (const name of step.followers || []) await call("POST", "/formation", { character: name, follow: true });
    await call("POST", "/farming-mode", { character: step.leader, mode: "default" });
    await call("POST", "/focus", { character: step.leader, monsterFocus: [step.monster] });
    const { farmingAreas } = require(path.join(root, "dashboard/lib/farming-areas.cjs"));
    let areas = [];
    for (let attempt = 0; attempt < 60 && !areas.length; attempt++) {
      const state = await waitFor(api("GET", "/state"));
      if (state.body && state.body.monsterChoices) areas = farmingAreas(state.body.monsterChoices, [step.monster]);
      if (!areas.length) await waitFor(new Promise((resolve) => clock.at(clock.now + 5000, resolve)));
    }
    if (!areas.length) {
      const state = await waitFor(api("GET", "/state"));
      const keys = state.body && typeof state.body === "object" ? Object.keys(state.body) : [];
      fs.writeFileSync(path.join(out, "monster-choices.json"), JSON.stringify(state.body && state.body.monsterChoices, null, 1));
      log("error", `[sim] no farming area for ${step.monster}`, { status: state.status, keys: keys.filter((k) => /catalog|monster|choice/i.test(k)), monsterChoices: state.body && state.body.monsterChoices == null ? null : typeof state.body.monsterChoices });
      throw new Error(`[sim] no farming area for ${step.monster} (see coordinator.log)`);
    }
    await call("POST", "/travel", areas.find((a) => a.map === "main") || areas[0]);
  }

  /** What the dashboard does to hunt a rare monster (Phoenix): formation, then search its spawn regions in catalog order. */
  async function hunt(step) {
    await call("POST", "/formation", { leader: step.leader });
    for (const name of step.followers || []) await call("POST", "/formation", { character: name, follow: true });
    const { zones } = require(path.join(root, "characters/farming-zones.cjs"));
    let regions = [];
    for (let attempt = 0; attempt < 60 && !regions.length; attempt++) {
      const state = await waitFor(api("GET", "/state"));
      if (state.body && state.body.monsterChoices) regions = zones(state.body.monsterChoices, [step.monster]);
      if (!regions.length) await waitFor(new Promise((resolve) => clock.at(clock.now + 5000, resolve)));
    }
    if (!regions.length) throw new Error(`[sim] no spawn regions for ${step.monster} (see coordinator.log)`);
    await call("POST", "/navigate-to-monster", { monsterId: step.monster, ...(step.monster === "phoenix" && { phoenixRouteOrder: regions.map((r) => r.id) }) });
  }

  /** Advance the clock until a request issued through the transport has answered. */
  async function waitFor(promise) {
    let settled = false, value, error;
    promise.then((v) => ((settled = true), (value = v)), (e) => ((settled = true), (error = e)));
    while (!settled) {
      if (sim.halted) throw new Error(`[sim] the simulation halted (${sim.halted}${sim.failed ? ": " + sim.failed : ""})`);
      await sim.run(5, { stop: () => settled });
    }
    if (error) throw error;
    return value;
  }
}

/**
 * The run's CODE: the working tree's character files, with class artifacts compiled from the working tree into a
 * staged generation (tools/game/build.mts without --publish). The coordinator runs classes from the manifest, so
 * linking characters/ would run whatever was last published there instead of the code under test, and publishing
 * would also reload any live characters watching characters/manifest.json.
 */
function codeDirectory(dir) {
  require("node:child_process").execFileSync(process.execPath, [path.join(root, "tools/game/build.mts")], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  const staged = path.join(root, ".build/game"), characters = path.join(root, "characters");
  const manifest = JSON.parse(fs.readFileSync(path.join(staged, "manifest.json"), "utf8"));
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(characters))
    if (!["generated", "manifest.json", "build-history.json"].includes(name)) fs.symlinkSync(path.join(characters, name), path.join(dir, name));
  // Copies, not links: a later build may clean old generations out of .build/game while this run uses them.
  for (const { file } of Object.values(manifest.classes)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(staged, file), path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * scenario.expect: { minKills: { <type>: n }, maxCycleMinutes: n, maxDeaths: n, maxErrors: n }. A scenario with
 * expectations is a test: the run exits 1 and report.expect lists what failed.
 */
function check(expect, report) {
  const failures = [];
  const deaths = Object.values(report.characters).reduce((n, c) => n + (c.deaths || 0), 0);
  for (const [type, min] of Object.entries(expect.minKills || {})) {
    const n = (report.kills || []).filter((k) => k.type === type).length;
    if (n < min) failures.push(`${type} kills ${n} < ${min}`);
  }
  for (const k of report.kills || [])
    if (expect.maxCycleMinutes != null && k.cycleMinutes > expect.maxCycleMinutes) failures.push(`${k.type} ${k.id} took ${k.cycleMinutes} min from spawn to death > ${expect.maxCycleMinutes}`);
  if (expect.maxDeaths != null && deaths > expect.maxDeaths) failures.push(`character deaths ${deaths} > ${expect.maxDeaths}`);
  if (expect.maxErrors != null && report.log.error > expect.maxErrors) failures.push(`coordinator errors ${report.log.error} > ${expect.maxErrors}`);
  if (report.halted || report.failed) failures.push(`simulation ${report.failed ? "failed: " + report.failed : "halted: " + report.halted}`);
  return { pass: !failures.length, failures };
}

/** XP earned across level-ups: the game resets xp at each level, and G.levels[level] is that level's total. */
function levelXp(from, to, sim) {
  let total = 0;
  for (let level = from || 0; level < (to || 0); level++) total += sim.server.G.levels[String(level)] || 0;
  return total;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}

/** What a timeline line keeps: per character, where it is and what the coordinator thinks it is doing. */
function sample(atMs, state, sim) {
  const characters = state && state.characters || {};
  return {
    minute: +(atMs / 60000).toFixed(2),
    characters: Object.fromEntries(Object.entries(characters).map(([name, c]) => [name, {
      map: c.map, x: Math.round(c.x || 0), y: Math.round(c.y || 0), hp: c.hp, rip: !!c.rip, level: c.level,
      navigation: c.navigationState || null, event: c.joinedEvent || null, gold: c.gold, seenAt: c.seenAt,
    }])),
    server: Object.fromEntries(Object.values(sim.server.players || {}).map((p) => [p.name, { map: p.map, x: Math.round(p.x), y: Math.round(p.y), level: p.level, rip: !!p.rip }])),
    // The coordinator's rare hunt (Phoenix patrol): stage, message, coverage and the last skip reason.
    rare: state && state.rareHuntState ? (({ stage, message, patrol, encounter }) => ({ stage, message,
      encounter: encounter && { stage: encounter.stage, id: encounter.id, killedAt: encounter.killedAt, message: encounter.message },
      patrol: patrol && {
      paused: patrol.paused, stage: patrol.stage, message: patrol.message, cycle: patrol.cycle, covered: patrol.covered,
      incomplete: patrol.incomplete, searchers: patrol.searchers, retryReason: patrol.retryReason } }))(state.rareHuntState) : undefined,
    // Loot the party left on the ground: drops nobody opened yet.
    chests: Object.values(sim.server.chests || {}).reduce((sum, c) => ({ count: sum.count + 1, gold: sum.gold + (Number(c.gold) || 0) }), { count: 0, gold: 0 }),
  };
}

main().then(() => process.exit(), (error) => { console.error(error); process.exit(1); });
