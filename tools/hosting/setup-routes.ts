import type { IncomingMessage, ServerResponse } from "node:http";
import type { Access } from "./access.ts";
import { body, json, text } from "./http.ts";
import { steamBootstrap } from "../../runtime/steam/connection.ts";
import { validBrowser } from "./authorize.ts";
import { setupAddress } from "./address.ts";
import type { LocalTLS } from './tls.ts';
import { trustHelper } from './trust.ts';
import { requestOrigin } from './request-origin.ts';
import { transfer } from './setup-transfer.ts';
import { toString as qrToString } from 'qrcode';
export interface Options {
  realms?: Promise<import('./realms.ts').RealmDiscovery>;
  debug?: import('../debug/service.ts').DebugInstances;
  steam?: import('../steam/service.ts').LocalSteam;
  tls?: LocalTLS;
  updates?: import('../update/hosting.ts').UpdateRoutes;
  access: Access;
  configured(): boolean;
  healthy?(): Promise<boolean>;
  configure?(session: string, realm: string): Promise<void>;
  dashboardPort: number;
  apiPort?: number;
  publicUrl?: string;
}
export const loaderCode = steamBootstrap;
async function steamLoader(options: Options, input: Record<string, unknown>) {
  if (options.steam && input.placement !== undefined) await options.steam.preferences.save(input);
  const address = new URL(text(input.origin));
  if (
    !["http:", "https:"].includes(address.protocol) ||
    address.username ||
    address.password ||
    address.pathname !== "/" ||
    address.search ||
    address.hash
  )
    throw new Error("Enter the server origin, without a path");
  const suffix = options.access.required ? "/bridge/" + await options.access.steam() : "";
  return { code: loaderCode(address.origin + suffix) };
}
export async function pair(req: IncomingMessage, res: ServerResponse, options: Options) {
  const credential = await options.access.pair(text((await body(req)).token));
  browserCookie(req, res, credential);
  json(res, 200, { ok: true });
}
function browserCookie(req: IncomingMessage, res: ServerResponse, credential: string) {
  // Use the validated requesting origin: LAN HTTP must still work alongside a public HTTPS URL.
  const secure = req.headers.origin?.startsWith("https:") ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `party=${credential}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`,
  );
}
async function setupState(req: IncomingMessage, options: Options) {
  const secure = options.tls?.trusted(req);
  const origin = options.publicUrl || (secure ? requestOrigin(req, options) : undefined);
  const tls = options.tls ? { tls: await options.tls.status(), secure, httpPort: Number(process.env.AL_HTTP_PUBLIC_PORT || process.env.AL_PORT || 3010) } : {};
  return { configured: options.configured(), requirePairing: options.access.required, canConfigureAccount: !!options.configure, serverAddress: setupAddress(req, origin), steamPreferences: await options.steam?.preferences.read(), ...await options.realms, ...tls };
}
async function readSetup(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: Options,
) {
  if (pathname === "/setup/state" && req.method === "GET") {
    json(res, 200, await setupState(req, options));
    return true;
  }
  if (req.method === 'GET' && /^\/setup\/trust\/(certificate|windows|linux)$/.test(pathname)) {
    if (!options.tls) throw Error('HTTPS is not installed');
    const kind = pathname.split('/').pop();
    const pem = await options.tls.certificate();
    const file = kind === 'certificate' ? 'party-console-root.crt' : 'party-console-trust.' + (kind === 'windows' ? 'cmd' : 'sh');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(kind === 'certificate' ? pem : await trustHelper(pem, kind as 'windows' | 'linux')); return true;
  }
  return false;
}
export async function setupRoute(req: IncomingMessage, res: ServerResponse, pathname: string, options: Options) {
  if (await readSetup(req, res, pathname, options)) return;
  if (req.method !== "POST") {
    json(res, 405, { error: "POST required" });
    return;
  }
  const input = await body(req);
  if (options.access.required && !validBrowser(req, options)) {
    json(res, 401, { error: "Pair this browser before changing setup" }); return;
  }
  const handlers: Record<string, () => Promise<unknown>> = {
    '/setup/client': async () => {
      if (!options.steam) throw Error('Local Steam launcher is unavailable.');
      return options.steam.preferences.save(input);
    },
    '/setup/transfer': () => transfer(req, options, input),
    '/setup/https': async () => {
      if (!options.tls) throw Error('HTTPS is not installed');
      return options.tls.prepare(text(input.origin));
    },
    "/setup/pairing": async () => {
      if (typeof input.requirePairing !== "boolean") throw new Error("requirePairing must be a boolean");
      const credential = await options.access.setRequired(input.requirePairing);
      if (credential) browserCookie(req, res, credential);
      return { requirePairing: options.access.required };
    },
    "/setup/session": async () => {
      if (!options.configure) throw new Error("Configure this account in the Windows launcher");
      await options.configure(text(input.session), text(input.realm));
      return { ok: true };
    },
    "/setup/invite": async () => {
      const token = await options.access.invitation();
      // POSTs are origin-checked (sameBrowserOrigin), so Origin is the address this browser really uses;
      // the Host header can be an internal address behind a reverse proxy or public URL.
      const origin = req.headers.origin || options.publicUrl || requestOrigin(req, options);
      const url = `${origin}/setup#${token}`;
      const qrSvg = await qrToString(url, { type: "svg", margin: 1 });
      return { token, url, qrSvg };
    },
    "/setup/revoke": async () => {
      await options.access.revokeSteam();
      return { ok: true };
    },
    "/setup/steam": () => steamLoader(options, input),
  };
  const handler = handlers[pathname];
  if (handler) json(res, 200, await handler());
  else json(res, 404, { error: "Unknown setup action" });
}
