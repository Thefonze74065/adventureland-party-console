import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
export function localAddress(value: string): boolean {
 return value === '::1' || /^(fc|fd)[0-9a-f]{2}:/i.test(value) || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
}
function originURL(origin: string) {
 const url = new URL(origin);
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
  throw new Error('Use a LAN server address without a path or credentials');
 return url;
}
export async function tlsHost(origin: string): Promise<string> {
 const url = originURL(origin);
 const host = url.hostname.replace(/^\[|\]$/g, '');
 if (host === 'localhost') return host;
 if (isIP(host)) { if (localAddress(host)) return host; throw new Error('Use a private LAN or loopback address'); }
 const addresses = await lookup(host, { all: true });
 if (!addresses.length || addresses.some(entry => !localAddress(entry.address))) throw new Error('The hostname must resolve only to this LAN');
 return host;
}
export function httpsOrigin(host: string, port: number) { return `https://${host.includes(':') ? '[' + host + ']' : host}:${port}`; }
function fallbackHost(hosts: string[]) {
 return [...hosts].reverse().find(host => isIP(host) && host !== '::1' && !host.startsWith('127.')) || '127.0.0.1';
}
export function certificateProbes(hosts: string[]) {
 // An unconfigured loopback address exercises the same no-SNI fallback as Docker NAT.
 let loopback = 2;
 while (hosts.includes(`127.0.0.${loopback}`)) loopback++;
 const probes = hosts.filter(host => !isIP(host) || host === '::1' || host.startsWith('127.'))
  .map(host => ({ host: isIP(host) ? host : '127.0.0.1', servername: isIP(host) ? '' : host, identity: host }));
 probes.push({ host: `127.0.0.${loopback}`, servername: '', identity: fallbackHost(hosts) });
 return probes;
}
function connectionPolicies(hosts: string[]) {
 // Browsers omit SNI for IP URLs. Native hosts retain the destination IP;
 // Docker NAT hides it, so use the most recently prepared LAN IP as fallback.
 const addresses = hosts.filter(host => isIP(host));
 const fallback = fallbackHost(hosts);
 return [
  ...addresses.map(host => ({ match: { local_ip: { ranges: [host] } }, default_sni: host })),
  { default_sni: fallback },
 ];
}
export function caddyConfig(storage: string, hosts: string[], port: number, upstream: number, admin: number, secret: string) {
 return {
  admin: { listen: `127.0.0.1:${admin}`, config: { persist: false } }, storage: { module: 'file_system', root: storage },
  logging: { logs: { default: { level: 'WARN' } } },
  apps: {
   pki: { certificate_authorities: { local: { name: 'Party Console', install_trust: false } } },
   tls: { automation: { policies: [{ subjects: hosts, issuers: [{ module: 'internal', ca: 'local' }] }] } },
   http: { servers: { party: { listen: [`:${port}`], protocols: ['h1', 'h2'], automatic_https: { disable_redirects: true },
    tls_connection_policies: connectionPolicies(hosts),
    routes: [{ match: [{ host: hosts }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `127.0.0.1:${upstream}` }],
     headers: { request: { set: { 'X-Party-TLS': [secret] } } } }] }] } } },
  },
 };
}
