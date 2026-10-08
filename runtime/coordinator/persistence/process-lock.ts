import * as fs from 'node:fs';

interface ProcessLock { version: 1; pid: number; platform: string; start?: string; boot?: string; namespace?: string; advisory?: boolean }

/** comm (field 2) can itself contain spaces and parentheses. */
export function linuxProcessStart(stat: string): string | undefined {
  const end = stat.lastIndexOf(')');
  if (end < 0) return;
  const token = stat.slice(end + 1).trim().split(/\s+/)[19];
  return token && /^\d+$/.test(token) ? token : undefined;
}

export function processLockIdentity(pid = process.pid): ProcessLock {
  const identity: ProcessLock = {version: 1, pid, platform: process.platform};
  if (process.platform === 'linux') {
    identity.start = linuxProcessStart(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
    identity.boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    identity.namespace = fs.readlinkSync(`/proc/${pid}/ns/pid`);
    if (!identity.start || !identity.boot || !identity.namespace) throw new Error('Unverifiable process identity');
  }
  return identity;
}

function alive(pid: number): boolean {
  try {process.kill(pid, 0); return true;}
  catch (error) {return (error as NodeJS.ErrnoException).code !== 'ESRCH';}
}

function decodeLock(source: string): ProcessLock {
  let owner: ProcessLock;
  try {owner = JSON.parse(source) as ProcessLock;}
  catch {throw new Error('Storage ownership is unverifiable');}
  if (!owner || owner.version !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.platform !== 'string')
    throw new Error('Storage ownership is unverifiable');
  return owner;
}

function linuxOwnerActive(owner: ProcessLock): boolean {
  if (!owner.start || !owner.boot || !owner.namespace) throw new Error('Storage ownership is unverifiable');
  let current: ProcessLock;
  try {current = processLockIdentity();}
  catch {throw new Error('Storage ownership is unverifiable');}
  if (owner.boot !== current.boot) return false;
  if (owner.namespace !== current.namespace) throw new Error('Storage ownership is unverifiable across PID namespaces');
  if (!alive(owner.pid)) return false;
  return sameProcessStart(owner);
}

function sameProcessStart(owner: ProcessLock): boolean {
  try {return processLockIdentity(owner.pid).start === owner.start;}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !alive(owner.pid)) return false;
    throw new Error('Storage ownership is unverifiable');
  }
}

/** False means proven stale, never merely an unreadable or unknown owner. */
export function processLockActive(source: string, advisoryHeld = false): boolean {
  if (/^[1-9]\d*\s*$/.test(source)) {
    const pid = Number(source);
    if (!Number.isSafeInteger(pid)) throw new Error('Storage ownership is unverifiable');
    return alive(pid); // Legacy locks cannot establish a process start identity.
  }
  const owner = decodeLock(source);
  if (owner.platform !== process.platform) throw new Error('Storage ownership is unverifiable across platforms');
  // Only an acquired OS guard proves that a compliant cross-container owner
  // exited. Its persistent inode is shared across all PID namespaces.
  if (advisoryHeld && owner.advisory === true && owner.platform === 'linux') return false;
  return process.platform === 'linux' ? linuxOwnerActive(owner) : alive(owner.pid);
}
