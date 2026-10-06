"use strict";
// CODE <-> coordinator HTTP inside the simulation. A request leaves the CODE window at a virtual time and reaches
// the coordinator's captured Express app one way-latency later, where it is dispatched synchronously: the body is
// already parsed (body-parser skips a request marked parsed) and the response is captured at res.end(). An async
// handler finishes in the microtask drain ChronAL runs after every event; a long poll answers when its virtual
// timer fires. The response returns one way-latency after res.end(). Nothing waits on real time, so a run is
// deterministic for a given build and seed, and dispatch also works inside ChronAL's synchronous lockstep windows.
const http = require("node:http");
const { Socket } = require("node:net");

/** Dispatch one request into an Express app; `done` gets { statusCode, statusMessage, headers, body } once. */
function dispatch(app, { method, path, headers, body }, done) {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" }); // the coordinator's loopback checks
  const req = new http.IncomingMessage(socket);
  req.method = method;
  req.url = path;
  req.headers = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  req.httpVersionMajor = 1; req.httpVersionMinor = 1; req.httpVersion = "1.1";
  req.complete = true;
  const type = req.headers["content-type"] || "";
  let parsed = {};
  if (body !== undefined && body !== "") {
    try { parsed = /json/i.test(type) ? JSON.parse(body) : body; }
    catch { return done({ statusCode: 400, statusMessage: "Bad Request", headers: {}, body: JSON.stringify({ error: "invalid JSON body" }) }); }
  }
  req.body = parsed;
  req._body = true;
  const res = new http.ServerResponse(req);
  const chunks = [];
  let finished = false;
  res.write = (chunk, encoding) => {
    if (chunk != null && typeof chunk !== "function") chunks.push(Buffer.from(chunk, typeof encoding === "string" ? encoding : undefined));
    return true;
  };
  res.end = (chunk, encoding) => {
    if (finished) return res;
    finished = true;
    if (chunk != null && typeof chunk !== "function") res.write(chunk, encoding);
    done({ statusCode: res.statusCode, statusMessage: res.statusMessage, headers: res.getHeaders(), body: Buffer.concat(chunks).toString("utf8") });
    return res;
  };
  try {
    app.handle(req, res, (error) => {
      if (finished) return;
      res.statusCode = error ? 500 : 404;
      res.end(error ? String(error && error.stack || error) : `Cannot ${method} ${path}`);
    });
  } catch (error) {
    if (!finished) { res.statusCode = 500; res.end(String(error && error.stack || error)); }
  }
}

function createTransport({ clock, apps, latency }) {
  const stats = { observe: null, observeResponse: null, requests: 0, errors: 0, byPath: new Map(), byStatus: new Map(), firstFailure: new Map(), largestBody: 0 };
  let open = 0; // requests a handler has not answered yet (long polls, async work)

  /** One request; `done` receives { statusCode, headers, body } or an Error, on the virtual clock. */
  function request({ method = "GET", url, headers = {}, body }, done) {
    stats.requests++;
    const parsed = new URL(url, "http://127.0.0.1:924");
    const kind = body && /"combatWait":true/.test(body) ? " [combatWait]" : body && /"combatOnly":true/.test(body) ? " [combatOnly]" : "";
    stats.byPath.set(parsed.pathname + kind, (stats.byPath.get(parsed.pathname + kind) || 0) + 1);
    if (body && body.length > stats.largestBody) stats.largestBody = body.length;
    if (stats.observe) stats.observe(parsed.pathname, body);
    clock.at(clock.now + latency(), () => {
      const local = /^(127\.0\.0\.1|localhost)$/.test(parsed.hostname), app = local && apps.get(Number(parsed.port || 80));
      if (!app) {
        stats.errors++;
        const error = new Error(local ? "nothing listens on " + parsed.host : "network disabled: " + parsed.host);
        return void clock.at(clock.now + latency(), () => done(error), "sim http error");
      }
      open++;
      dispatch(app, { method, path: parsed.pathname + parsed.search, headers, body }, (result) => {
        open--;
        const tag = parsed.pathname + " " + result.statusCode;
        stats.byStatus.set(tag, (stats.byStatus.get(tag) || 0) + 1);
        if (result.statusCode >= 400 && !stats.firstFailure.has(tag)) stats.firstFailure.set(tag, result.body.slice(0, 300));
        if (stats.observeResponse) stats.observeResponse(parsed.pathname, body, result.body);
        clock.at(clock.now + latency(), () => done(result), "sim http response");
      });
    }, "sim http request");
  }

  return { request, ...clientTransport(request), stats, get open() { return open; } };
}


/**
 * XMLHttpRequest and fetch for a CODE window over any request function `request({ method, url, headers, body },
 * done)` whose `done` gets { statusCode, statusMessage, headers, body } or an Error: direct dispatch in a
 * single-thread simulation, a lockstep socket to the coordinator's thread in a threaded one.
 */
function clientTransport(request) {
  /** XMLHttpRequest for a CODE window: enough of the interface for jQuery 3's xhr transport. */
  function xhrClass() {
    return class SimXMLHttpRequest {
      constructor() {
        this.readyState = 0; this.status = 0; this.statusText = ""; this.responseText = ""; this.response = "";
        this.responseType = ""; this.timeout = 0; this.withCredentials = false;
        this.onload = null; this.onerror = null; this.onabort = null; this.ontimeout = null; this.onreadystatechange = null;
        this.upload = {};
        this._headers = {}; this._response = {}; this._aborted = false;
      }
      open(method, url) { this._method = method; this._url = url; this.readyState = 1; }
      setRequestHeader(name, value) { this._headers[String(name).toLowerCase()] = String(value); }
      overrideMimeType() {}
      getResponseHeader(name) { const v = this._response[String(name).toLowerCase()]; return v == null ? null : String(v); }
      getAllResponseHeaders() { return Object.entries(this._response).map(([k, v]) => k + ": " + v).join("\r\n"); }
      abort() {
        if (this._aborted || this.readyState === 4) return;
        this._aborted = true; this.readyState = 4; this.status = 0;
        if (this.onabort) this.onabort();
      }
      send(body) {
        request({ method: this._method, url: this._url, headers: this._headers, body: body == null ? undefined : String(body) }, (result) => {
          if (this._aborted) return;
          this.readyState = 4;
          if (result instanceof Error) { this.status = 0; if (this.onerror) this.onerror(); else if (this.onreadystatechange) this.onreadystatechange(); return; }
          this.status = result.statusCode; this.statusText = result.statusMessage || "";
          this._response = result.headers || {};
          this.responseText = this.response = result.body;
          if (this.onload) this.onload(); else if (this.onreadystatechange) this.onreadystatechange();
        });
      }
    };
  }

  /** fetch for a CODE window, through the same path. */
  function fetchFunction() {
    return (input, init = {}) => new Promise((resolve, reject) => {
      const url = typeof input === "string" ? input : input.url;
      const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
      request({ method: init.method || "GET", url, headers, body: init.body == null ? undefined : String(init.body) }, (result) => {
        if (result instanceof Error) return reject(new TypeError("fetch failed: " + result.message));
        resolve(new Response(result.body, { status: result.statusCode, headers: Object.fromEntries(Object.entries(result.headers || {}).map(([k, v]) => [k, String(v)])) }));
      });
    });
  }

  return { xhrClass, fetchFunction };
}

module.exports = { createTransport, clientTransport, dispatch };
