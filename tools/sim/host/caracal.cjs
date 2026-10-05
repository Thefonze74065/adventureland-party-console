"use strict";
// Stand-ins for the caracAL modules the coordinator loads through its platform require
// (runtime/coordinator/infrastructure/dependencies.ts). Nothing here reads the user's .caracal
// install or its config/session; a simulation gets its own run directory and account.
const path = require("node:path");

const ctype_to_clid = { merchant: 1, warrior: 2, paladin: 3, priest: 4, ranger: 5, rogue: 6, mage: 7 };

/** caracAL's structured logger and console facade, written to one simulation log. */
function logging(write) {
  const line = (level) => (details, message) =>
    write(level, typeof details === "string" ? details : message ?? "", typeof details === "string" ? null : details);
  const log = { info: line("info"), warn: line("warn"), error: line("error"), debug: () => {}, trace: () => {} };
  log.child = () => log;
  const text = (level) => (...args) => write(level, args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  const console = { log: text("info"), info: text("info"), warn: text("warn"), error: text("error"), debug: () => {} };
  return { log, console, fakePinoConsole: () => console, ctype_to_clid };
}

/**
 * The account caracAL would fetch from adventure.land: the simulated characters on one realm.
 * `servers` keys follow caracAL (SR_<region><name>); the address is never dialled (Chronal clients
 * connect to the in-memory server).
 */
function account({ realm, characters }) {
  const [, region, name] = /^SR_(US|EU|ASIA)(.+)$/.exec(realm) || [null, "US", "I"];
  const response = {
    servers: [{ key: realm, region, name, addr: "127.0.0.1", port: 7192, path: "/socket.io/", players: characters.length }],
    characters: characters.map((c) => ({ id: c.id, name: c.name, type: c.type, level: c.level, online: 0, server: "", skin: "" })),
  };
  const listeners = [];
  return {
    session: "sim",
    response,
    listeners,
    auto_update: false,
    async updateInfo() { listeners.forEach((f) => f(response)); return response; },
    add_listener: (f) => listeners.push(f),
    remove_listener: (f) => listeners.splice(listeners.indexOf(f) >>> 0, 1),
    resolve_char: (n) => response.characters.find((c) => c.name == n),
    resolve_realm: (k) => response.servers.find((s) => s.key == k),
    destroy() {},
  };
}

/** The game cache: the single pinned game ChronAL runs (tools/sim/setup.mts). */
function gameFiles({ appRoot, version, revision }) {
  return {
    ensure_latest: async () => version,
    get_revision: async () => revision,
    cull_versions: async () => undefined,
    available_versions: async () => [version],
    locate_game_file: (resource) => path.join(appRoot, String(resource).replace(/^\/+/, "")),
    get_game_files: () => [],
    get_runner_files: () => [],
  };
}

/** caracAL's config.js for a simulation: no session, no bot web interface, every character enabled. */
function config({ characters, merchant, realm, port }) {
  return {
    session: "sim-user-sim-auth",
    // No pinned client version: the coordinator only accepts catalogs from unpinned headless clients, and a
    // simulation has exactly one game version anyway.
    characters: Object.fromEntries(characters.map((c) => [c.name, { realm, enabled: true, script: "adventure_land/party-member.js" }])),
    merchant: merchant || null,
    cull_versions: false,
    enable_TYPECODE: false,
    watch_CODE: false,
    log_level: "info",
    log_sinks: [],
    web_app: { party_dashboard: true, expose_CODE: true, enable_bwi: false, enable_minimap: false, port },
  };
}

/** bot-web-interface is disabled in a simulation; the coordinator only checks for its publisher. */
function BotWebInterface() {
  throw new Error("[sim] the bot web interface is not available in a simulation");
}

module.exports = { logging, account, gameFiles, config, BotWebInterface, ctype_to_clid };
