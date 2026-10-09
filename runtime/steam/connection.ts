interface ConnectionHost {
  __partyServer?: string;
  parent?: { __partyServer?: string };
  document?: { currentScript: { src?: string } | SVGScriptElement | null };
}
export const steamBridgeVersion = 12;
export function needsSteamBridge(bridge: { version?: number; server?: string } | undefined, server: string): boolean {
  return !bridge || bridge.version !== steamBridgeVersion || bridge.server !== server;
}
/** Capture currentScript synchronously, before the loader starts any async work. */
export function initializeConnection(host: ConnectionHost = globalThis as ConnectionHost): string {
  const script = host.document?.currentScript;
  const src = script && 'src' in script ? script.src : undefined;
  let server = serverAddress(host);
  if (src) {
    const url = new URL(src);
    const suffix = '/CODE/adventure_land/universal-loader.js';
    if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.endsWith(suffix))
      throw new Error('Invalid Party Console loader URL');
    server = url.origin + url.pathname.slice(0, -suffix.length);
  }
  host.__partyServer = server;
  if (host.parent) host.parent.__partyServer = server;
  return server;
}
export function serverAddress(host: ConnectionHost = globalThis as ConnectionHost): string {
  return (host.__partyServer || host.parent?.__partyServer || "http://127.0.0.1:924").replace(
    /\/$/,
    "",
  );
}
export function steamBootstrap(base: string): string {
  return `$.getScript(${JSON.stringify(base.replace(/\/$/, '') + "/CODE/adventure_land/universal-loader.js")});`;
}
/** Exact prior managed content, retained solely to migrate its saved slot safely. */
export function previousSteamBootstrap(base: string): string {
  return `/* party-managed-bootstrap-v2 */
globalThis.__partyServer=${JSON.stringify(base)};parent.__partyServer=globalThis.__partyServer;
(function(){
 if(globalThis.__partyBootstrapPending||globalThis.__partyCodeLoader)return;
 globalThis.__partyBootstrapPending=true;
 var delay=1000,base=globalThis.__partyServer+"/CODE/adventure_land/";
 async function download(file){var r=await fetch(base+file+"?t="+Date.now(),{cache:"no-store",signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error("HTTP "+r.status);return r.text();}
 async function run(){try{
  if(!parent.no_html&&!parent.is_bot&&!parent.__partySteamBridge)parent.eval(await download("steam-bridge.js"));
  if(parent.localStorage.getItem("party-code-stopped:"+parent.character.name)==="1"){globalThis.__partyBootstrapPending=false;return;}
  (0,eval)(await download("universal-loader.js"));globalThis.__partyBootstrapPending=false;
 }catch(e){console.warn("Party bootstrap retry",String(e));setTimeout(run,delay);delay=Math.min(delay*2,30000);}}
 void run();
})();`;
}
