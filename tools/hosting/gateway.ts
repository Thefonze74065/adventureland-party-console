import { createServer, type ServerResponse } from "node:http";
import { setupPage } from "./page.ts";
import { json, proxy, failure } from "./http.ts";
import { authorizeBrowser, authorizeSteam } from "./authorize.ts";
import type { Options } from "./setup-routes.ts";
import { websocket } from "./websocket.ts";
import { acceptTransfer } from './setup-transfer.ts';
import { steamAction, isSteamAction } from '../steam/routes.ts';
import { startupRealms } from './realms.ts';
export { loaderCode } from "./setup-routes.ts";
async function health(res: ServerResponse, options: Options) {
  const ready = options.healthy ? await options.healthy() : true;
  json(res, ready ? 200 : 503, { ready, configured: options.configured() });
}
function upstreamPort(url: string, options: Options) {
  return /^\/(party-api|CODE)\//.test(url) ? options.apiPort || 924 : options.dashboardPort;
}
async function continueSetup(req: import('node:http').IncomingMessage, res: ServerResponse, url: URL, options: Options) {
  if (url.pathname.startsWith('/console-control/')) {
    if (options.updates?.control) await options.updates.control(req, res, url.pathname);
    else json(res, 404, { error: 'Managed updater unavailable' });
    return true;
  }
  if (url.pathname === '/setup/check-https' && req.method === 'POST') {
    await acceptTransfer(req, res, options, true); return true;
  }
  if (url.pathname !== '/setup/continue') return false;
  if (req.method === 'GET') { res.writeHead(303, { Location: '/setup' }); res.end(); return true; }
  if (req.method !== 'POST') return false;
  await acceptTransfer(req, res, options); return true;
}
async function forward(req: import('node:http').IncomingMessage, res: ServerResponse, url: URL, match: RegExpExecArray | null, options: Options) {
  if (isSteamAction(url, req, match)) { await steamAction(req, res, options); return; }
  const route = req.url || '';
  proxy(req, res, upstreamPort(route, options), !/^\/(party-api|CODE)\//.test(route));
}
export function gateway(options: Options) {
  options = { ...options, realms: options.realms ?? (options.configure ? startupRealms() : Promise.resolve({ realms: [] })) };
  const server = createServer(async (req, res) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url || "/", "http://internal");
      if (await continueSetup(req, res, url, options)) return;
      if (url.pathname === "/health") {
        await health(res, options);
        return;
      }
      if (url.pathname === "/setup" && req.method === "GET") {
        // A form POST from HTTP setup to HTTPS needs its source Origin.
        // no-referrer makes browsers send Origin: null for this navigation.
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(setupPage);
        return;
      }
      const match = /^\/bridge\/([a-f0-9]{64})(\/.*)$/.exec(url.pathname);
      const permitted = match
        ? authorizeSteam(req, res, url, match, options)
        : await authorizeBrowser(req, res, url, options);
      if (permitted) {
        await forward(req, res, url, match, options);
      }
    } catch (error) {
      failure(res, error);
    }
  });
  websocket(server, options);
  return server;
}
