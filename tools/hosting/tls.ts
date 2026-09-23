import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes, X509Certificate } from 'node:crypto';
import { createServer } from 'node:net';
import { connect, checkServerIdentity } from 'node:tls';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { caddyPath } from './install-caddy.mts';
import { Services } from './services.ts';
import { caddyConfig, certificateProbes, httpsOrigin, tlsHost } from './tls-config.ts';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export class LocalTLS {
 readonly secret = randomBytes(32).toString('hex');
 readonly port: number;
 readonly publicPort: number;
 private admin = 0;
 private hosts = ['127.0.0.1', 'localhost'];
 private busy = false;
 private error = '';
 private services = new Services();
 private data: string;
 private root: string;
 private upstream: number;
 constructor(root: string, data: string, upstream = Number(process.env.AL_PORT || 3010)) {
  this.root = root; this.upstream = upstream;
  this.data = path.join(data, 'tls');
  this.port = Number(process.env.AL_HTTPS_PORT || 3443);
  this.publicPort = Number(process.env.AL_HTTPS_PUBLIC_PORT || this.port);
  if (![this.port, this.publicPort].every(p => Number.isInteger(p) && p > 0 && p < 65536)) throw new Error('Invalid HTTPS port');
 }
 trusted(req: IncomingMessage) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') && req.headers['x-party-tls'] === this.secret;
 }
 private config() { return caddyConfig(path.join(this.data, 'caddy'), this.hosts, this.port, this.upstream, this.admin, this.secret); }
 async start() {
  try {
   await readFile(caddyPath(this.root));
   await mkdir(this.data, { recursive: true, mode: 0o700 });
   try { this.hosts = JSON.parse(await readFile(path.join(this.data, 'hosts.json'), 'utf8')); } catch { /* first run */ }
   this.admin = await new Promise<number>(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
   const config = path.join(this.data, 'caddy.json');
   await writeFile(config, JSON.stringify(this.config()), { mode: 0o600 });
   this.services.launchBinary(caddyPath(this.root), ['run', '--config', config], this.root, process.env);
   console.log(`HTTPS: port ${this.publicPort}; open HTTP /setup to trust this console.`);
  } catch (error) { this.error = 'HTTPS unavailable: ' + String(error) + '. Run node tools/hosting/install-caddy.mts and restart.'; console.error(this.error); }
 }
 stop() { this.services.stop(); }
 async certificate() { return readFile(path.join(this.data, 'caddy/pki/authorities/local/root.crt'), 'utf8'); }
 private handshake(probe: ReturnType<typeof certificateProbes>[number], ca: string) {
  return new Promise<void>((resolve, reject) => {
   // Probe locally with the same SNI/no-SNI behavior as browsers.
   // Caddy's admin endpoint and root CA can be ready before leaf issuance finishes.
   const socket = connect({ host: probe.host, port: this.port, servername: probe.servername, ca,
    checkServerIdentity: (_name, cert) => checkServerIdentity(probe.identity, cert),
   }, () => { socket.destroy(); resolve(); });
   socket.setTimeout(1500, () => socket.destroy(Error('HTTPS certificate handshake timed out')));
   socket.once('error', reject);
  });
 }
 async status() {
  try {
   if (this.error) throw Error(this.error);
   const response = await fetch(`http://127.0.0.1:${this.admin}/config/`, { headers: { Origin: `http://127.0.0.1:${this.admin}` }, signal: AbortSignal.timeout(1500) });
   if (!response.ok) throw Error('HTTPS service not responding');
   const ca = await this.certificate();
   await Promise.all(certificateProbes(this.hosts).map(probe => this.handshake(probe, ca)));
   const fingerprint = new X509Certificate(ca).fingerprint256;
   return { ready: true, port: this.publicPort, fingerprint, error: '' };
  } catch (error) { return { ready: false, port: this.publicPort, fingerprint: '', error: this.error || 'HTTPS is starting or its port is unavailable: ' + String(error) }; }
 }
 async prepare(origin: string) {
  if (this.busy) throw Error('HTTPS setup is already in progress; retry shortly');
  this.busy = true;
  try {
   const host = await tlsHost(origin);
   if (!(await this.status()).ready) throw Error((await this.status()).error);
   if (this.hosts.at(-1) !== host) {
    if (!this.hosts.includes(host) && this.hosts.length >= 20) throw Error('Too many configured HTTPS addresses');
    const previous = this.hosts; this.hosts = [...previous.filter(value => value !== host), host];
    const response = await fetch(`http://127.0.0.1:${this.admin}/load`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${this.admin}` }, body: JSON.stringify(this.config()), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { this.hosts = previous; throw Error('HTTPS configuration failed; check server logs for port conflicts'); }
    await writeFile(path.join(this.data, 'hosts.json'), JSON.stringify(this.hosts), { mode: 0o600 });
    await writeFile(path.join(this.data, 'caddy.json.tmp'), JSON.stringify(this.config()), { mode: 0o600 });
    await rename(path.join(this.data, 'caddy.json.tmp'), path.join(this.data, 'caddy.json'));
   }
   for (let attempt = 0; attempt < 10; attempt++) {
    const status = await this.status(); if (status.ready) return { ...status, origin: httpsOrigin(host, this.publicPort) }; await delay(200);
   }
   throw Error('HTTPS certificate is not ready; retry shortly');
  } finally { this.busy = false; }
 }
}
