import type {Fight, Group, Member} from './grouped.ts';
import {targetIdentity} from './lost-target.ts';

export interface ApproachReport {
  target: string; at: number; active: boolean; visible: boolean;
  intent: 'approach' | 'hold'; moving: boolean; displacement: number;
  deficit: number; coverage: number; blocked?: string | null;
  waypoint?: {key: string; remaining: number};
  destination?: {x: number; y: number} | null; issuedAt?: number;
}
interface Sample {x: number; y: number; deficit: number; coverage: number; visible: boolean; waypoint?: ApproachReport['waypoint']}
export interface Pursuit {
  identity: string; key: string; lastAt: number; idleMs: number;
  samples: Record<string, Sample>; revoking?: string; revokingAt?: number;
  reason?: string;
  replacementKind?: 'closer-hunt' | 'closer-target';
}
export interface PursuitExclusion {identity: string; until: number}

function available(m: Member): boolean {
  const s = m.status;
  if (!s || m.cancelled || s.rip || s.hp <= 0) return false;
  return !s.activeEvent && !s.joinedEvent && !s.mapEvent && !s.groupedCombat?.travelCommand;
}
function usable(m: Member, current: Fight, now: number): boolean {
  const s = m.status, a = s?.groupedCombat?.approach;
  if (!available(m) || !s || !a) return false;
  if (!samePlace(s,current)) return false;
  return fresh(s.seenAt,now) && fresh(a.at,now) && a.target === targetIdentity(current) && a.active;
}
function samePlace(s: NonNullable<Member['status']>, t: Fight): boolean {return s.server===t.server && s.map===t.map && s.in===t.in;}
function fresh(at: number, now: number): boolean {return now-at <= 3000 && at <= now+500;}
function samples(members: Member[]): Record<string, Sample> {
  return Object.fromEntries(members.map(m => {
    const s = m.status!, a = s.groupedCombat!.approach!;
    return [m.name, {x:s.x, y:s.y, deficit:a.deficit, coverage:a.coverage, visible:a.visible, waypoint:a.waypoint}];
  }));
}
function improved(before: Sample, after: Sample): boolean {
  if (!before.visible && after.visible) return true;
  if (Math.hypot(after.x-before.x, after.y-before.y) < 2) return false;
  if (before.deficit-after.deficit >= 8 || before.coverage-after.coverage >= 8) return true;
  return !!before.waypoint && before.waypoint.key === after.waypoint?.key &&
    before.waypoint.remaining-after.waypoint.remaining >= 8;
}
function alternative(candidates: Fight[], current: Fight, exclusions: PursuitExclusion[]): Fight | undefined {
  return candidates.find(c => targetIdentity(c) !== targetIdentity(current) &&
    !exclusions.some(e => e.identity === targetIdentity(c)));
}

interface Result {pursuit?: Pursuit; pursuitExclusions: PursuitExclusion[]; replacement?: Fight}
function updateProgress(p: Pursuit, members: Member[], now: number, lastAt: number) {
  const snapshot = samples(members);
  const progress = members.some(m => !p.samples[m.name] || improved(p.samples[m.name], snapshot[m.name]));
  if (progress) {p.samples=snapshot; p.idleMs=0; if (!p.revoking) delete p.reason;}
  else p.idleMs += Math.min(1000, Math.max(0, now-lastAt));
}
function resolveRevocation(p: Pursuit, next: Fight | undefined, members: Member[], now: number, result: Result) {
  const acknowledged = members.every(m => m.status!.seenAt >= p.revokingAt! &&
    m.status!.groupedCombat?.pursuitAck === p.revoking);
  if (!acknowledged) return;
  if (!next) {delete p.revoking; delete p.revokingAt; delete p.replacementKind; delete p.reason; return;}
  if (!p.replacementKind) result.pursuitExclusions.push({identity:p.identity, until:now+10000});
  result.replacement=next;
  delete result.pursuit;
}
function considerReplacement(p: Pursuit, next: Fight | undefined, members: Member[], now: number, result: Result) {
  if (p.revoking) {resolveRevocation(p,next,members,now,result); return;}
  if (p.idleMs < 5000) return;
  p.reason = next ? 'stalled pursuit; revoking pull authorization' : 'stalled pursuit; no eligible alternative';
  if (next) {p.revoking=JSON.stringify([p.key, p.identity, now]); p.revokingAt=now;}
}
function ordinary(current: Fight | null): current is Fight {
  return !!current && current.state === 'planned' && !(current as Fight & {passiveRare?:boolean}).passiveRare;
}
function previousPursuit(old: Group | null | undefined, identity: string, key: string): Pursuit | undefined {
  const p=old?.pursuit;
  return p?.identity===identity && p.key===key ? p : undefined;
}
function closerHunt(current: Fight, candidates: Fight[], members: Member[], leader: string, huntTarget: string | null): Fight | undefined {
  if (huntTarget && current.mtype !== huntTarget) return;
  const origin = members.find(m => m.name === leader)?.status;
  if (!origin) return;
  const distance = (t: Fight) => Math.hypot(t.x-origin.x,t.y-origin.y);
  return candidates.filter(t => (!huntTarget || t.mtype === huntTarget) && t.id !== current.id &&
    priority(t) >= priority(current) && distance(t) < distance(current) - (huntTarget ? 0 : 8))
    .sort((a,b) => distance(a)-distance(b))[0];
}
function priority(target: Fight): number {return (target as Fight & {priority?:number}).priority ?? 50;}
function partyReady(members:Member[],current:Fight,now:number,paused:boolean):boolean {
  return !paused && members.length>0 && members.every(m=>available(m) && !!m.status && fresh(m.status.seenAt,now) && samePlace(m.status,current));
}
function huntReplacement(p: Pursuit, current: Fight, candidates: Fight[], members: Member[], old: Group | null | undefined,
  huntTarget: string | null, now: number, result: Result): boolean {
  const next = closerHunt(current,candidates,members,old?.leader || current.fighter,huntTarget);
  if (p.replacementKind) {resolveRevocation(p,next,members,now,result);return true;}
  if (!next || p.revoking) return false;
  p.replacementKind=huntTarget?'closer-hunt':'closer-target';p.reason='closer eligible monster; revoking pull authorization';
  p.revoking=JSON.stringify([p.key,p.identity,now]);p.revokingAt=now;
  return true;
}
/** Revocation is acknowledged with the same report that carries pending attack evidence. */
export function trackPursuit(old: Group | null | undefined, current: Fight | null, candidates: Fight[],
  members: Member[], now: number, key: string, paused: boolean, huntTarget: string | null = null): Result {
  const exclusions = currentExclusions(old,now);
  const result: Result = {pursuitExclusions:exclusions};
  if (!ordinary(current)) return result;
  const identity = targetIdentity(current), prior = previousPursuit(old,identity,key);
  const p: Pursuit = prior ? {...prior,lastAt:now} : {identity,key,lastAt:now,idleMs:0,samples:{}};
  result.pursuit = p;
  // The closer candidate can create the first locked pair in the same tick
  // that revokes the old pull. Finish that acknowledged switch; a locked pair
  // still prevents starting any new distance-based replacement.
  if ((!old?.pairRevision || p.replacementKind) && partyReady(members,current,now,paused) && huntReplacement(p,current,candidates,members,old,huntTarget,now,result)) return result;
  if(recovering(old,current))return result;
  progressPursuit(p,prior,current,candidates,members,now,paused,result);
  return result;
}
function currentExclusions(old:Group|null|undefined,now:number):PursuitExclusion[] {return (old?.pursuitExclusions || []).filter(e=>e.until>now);}
function recovering(old:Group|null|undefined,current:Fight):boolean {return old?.formationRecovery?.target===targetIdentity(current);}
function progressPursuit(p:Pursuit,prior:Pursuit|undefined,current:Fight,candidates:Fight[],members:Member[],now:number,paused:boolean,result:Result):void {
  const active = !paused && members.length > 0 && members.every(m => usable(m, current, now));
  if (!active) {p.idleMs=0; p.samples={}; return;}
  updateProgress(p,members,now,prior?.lastAt ?? now);
  considerReplacement(p,alternative(candidates,current,result.pursuitExclusions),members,now,result);
}
