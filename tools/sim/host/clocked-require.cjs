"use strict";
// A vm context on a ChronAL virtual clock and a require that evaluates the repository's own modules inside it,
// the way ChronAL hosts the game's server.js: their Date, timers and performance are virtual. Node built-ins and
// node_modules load normally; `byName` / `byPath` replace modules by request or by resolved path (no extension).
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

function clockedContext({ clock, globals = {}, onError }) {
  const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  Object.assign(ctx, {
    console, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal, queueMicrotask, atob, btoa,
    Headers, Request, Response, FormData, Blob, structuredClone, WebAssembly, EventTarget, Event,
    crypto: globalThis.crypto, process,
    fetch: async () => { throw new Error("[sim] network disabled"); },
    ...globals,
  });
  ctx.global = ctx;
  clock.installInto(ctx, { profile: "node", onError: onError || ((e) => console.error("[sim] timer error:", e)) });
  ctx.setImmediate = (fn, ...args) => ({ id: clock.at(clock.now, () => fn(...args), "setImmediate") });
  ctx.clearImmediate = (handle) => handle && clock.cancel(handle.id);
  return ctx;
}

function clockedRequire({ ctx, root, byName = {}, byPath = {}, cache = new Map() }) {
  const ours = (file) => file.startsWith(root + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`) && /\.c?js$/.test(file);
  function make(fromFile) {
    const real = Module.createRequire(fromFile);
    function req(id) {
      if (Object.prototype.hasOwnProperty.call(byName, id)) return byName[id];
      if (id.startsWith(".")) {
        const target = path.resolve(path.dirname(fromFile), id).replace(/\.c?js$/, "");
        if (Object.prototype.hasOwnProperty.call(byPath, target)) return byPath[target];
      }
      if (Module.isBuiltin(id)) return real(id);
      const file = real.resolve(id);
      if (!ours(file)) return real(id);
      if (cache.has(file)) return cache.get(file).exports;
      const module = { exports: {}, id: file, filename: file, loaded: false, children: [], paths: [] };
      cache.set(file, module);
      const source = fs.readFileSync(file, "utf8").replace(/^#!.*/, "");
      const wrapped = vm.runInContext(`(function (exports, require, module, __filename, __dirname) {${source}\n})`, ctx, { filename: file });
      wrapped.call(module.exports, module.exports, make(file), module, file, path.dirname(file));
      module.loaded = true;
      return module.exports;
    }
    req.resolve = real.resolve;
    req.cache = {};
    return req;
  }
  return make;
}

/**
 * The repository's runner host (runtime/lifecycle) on a clock. Its CODE files are read synchronously, so a character's
 * CODE starts inside the virtual timeline instead of whenever real I/O completes.
 */
function clockedLifecycle({ clock, root, onError }) {
  const ctx = clockedContext({ clock, onError });
  const fsp = require("node:fs/promises");
  const syncReads = { ...fsp, readFile: async (file, options) => fs.readFileSync(file, options) };
  const make = clockedRequire({ ctx, root, byName: { "node:fs/promises": syncReads, "fs/promises": syncReads } });
  return make(path.join(root, "tools/sim/host/lifecycle-entry.cjs"))(path.join(root, ".build/runtime/lifecycle.cjs"));
}

module.exports = { clockedContext, clockedRequire, clockedLifecycle };
