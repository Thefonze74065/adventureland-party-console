import type {PassingEncounter} from './passing.ts';
import type {PassingAcknowledgement} from './passing-admission.ts';
import { healingAnchor } from './composition.ts';
import {formationRecovery, type FormationRecovery, type FormationRecoveryReport} from './formation-recovery.ts';
import type {ApproachReport, Pursuit, PursuitExclusion} from './pursuit.ts';
import {targetIdentity} from './lost-target.ts';
import type {Retention} from './nomination-retention.ts';
import type {LostTarget, SearchState} from "./lost-target.ts";
import type { CurrentAttacker } from "../coordinator/navigation/travel-defense.ts";
import {reconcileQueue, type Candidate, type Evidence} from './queue.ts';
import type {ClaimObservation, ClaimState} from './claims.ts';
export interface Member {
  name: string; ctype: string; revision: number; cancelled?: boolean;
  status?: {
    seenAt: number; lastDeath?: {at: number}; hp: number; rip?: boolean; map: string; in?: string | number; server?: string;
    x: number; y: number; range?: number; max_hp?: number; joinedEvent?: unknown; activeEvent?: unknown; mapEvent?: unknown;
    combatSelection?: { id: string | null; map: string | null; revision: number; runtimeId: string; target?: Target | null };
    groupedCombat?: { travelCandidates?: Target[]; huntDefense?: boolean; passingAcknowledgement?: PassingAcknowledgement; returnDefense?: boolean; passingEncounters?: PassingEncounter[]; formationRecovery?: FormationRecoveryReport; approach?: ApproachReport; pursuitAck?: string | null; currentAttackers?: CurrentAttacker[];
      currentAttackersAt?: number; travelCommand?: {id:number;revision:number} | null; retentions?:Retention[];retentionPaused?:boolean; observationAt?:number; lootPending?: boolean; epoch?: number; claims?: ClaimObservation[]; candidates?: Candidate[]; evidence?: Evidence[]; queueAck?: string | null; protocol?: number; ack?: string | null; anchorVisible?: boolean; deaths?: Death[]; threats?: Target[]; sightings?: Target[]; state?: Group | null };
  };
}
export interface Death { id: string; map: string; in?: string | number; server: string; at: number }
export interface Fight extends Target { state?: 'planned' | 'pending' | 'engaged'; score?: number; server: string | undefined; fighter: string; startedAt: number }
export interface Target { target?: string | null; id: string; mtype: string; map: string; in?: string | number; x: number; y: number; hp?:number; max_hp?:number }
export interface Group {
  passingEncounters?: PassingEncounter[];
  formationRecovery?:FormationRecovery;
  pursuit?: Pursuit; pursuitExclusions?: PursuitExclusion[];
  lostTargets?:LostTarget[]; searches?:Record<string,SearchState>; transitionTrace?:{at:number;target:string|null;reason:string}[];
  rareRejections?: (Target & {server:string;until:number;rejectedAt?:number;expiresAt?:number})[];
  resetAt?:number;
  claims?: ClaimState[];
  observers: {name:string;map:string;in?:string|number;server:string|undefined;x:number;y:number;seenAt:number}[];
  queue: Fight[]; queueRevision: string; deaths: Death[]; evidence: Evidence[];
  key: string; phase: string; leader: string; members: string[]; priest: string | null;
  anchor: {name: string; map: string; in?: string | number; server: string | undefined; x: number; y: number} | null;
  range: number; ready: boolean; readySince: number | null; seenAt: number;
  target: Target | null; selection: string | null; committed: boolean;
  blockers: string[]; fights: Fight[]; threats: Fight[]; fighter: Group["anchor"];
  protocol: number; targetLeader: string; participating: string[]; recovering: string[]; recoverySince: Record<string, number>;
}
export function evaluateGroup(previous: Group | null, members: Member[], leader: string, now: number, resetAt = 0, pullsPaused = false, huntTarget: string | null = null): Group {
  pullsPaused ||= members.some(m=>m.status && now-m.status.seenAt<=3000 && m.status.groupedCombat?.lootPending);
  const priest = healingAnchor(members, now, previous?.priest);
  const anchorMember = priest || members.find(m => m.name === leader);
  const anchor = anchorMember?.status;
  const key = JSON.stringify(members.map(m=>[m.name,m.revision,m.cancelled, m.status?.combatSelection?.runtimeId]));
  const same = previous?.key === key;
  const range = priest ? Math.max(0, (anchor?.range || 0) - Math.min(20,Math.max(8,(anchor?.range || 0)*0.1))) : 150;
  const blockers: string[] = [];
  const fresh = (s: Member['status']) => !!s && now-s.seenAt <= 3000 && now >= s.seenAt-500;
  const participating: string[] = [], recovering: string[] = [];
  const recoverySince: Record<string, number> = {};
  const anchorAvailable = !!anchor && fresh(anchor) && !anchor.rip && anchor.hp > 0 && !anchorMember?.cancelled &&
    !anchor.activeEvent && !anchor.joinedEvent && !anchor.mapEvent;
  for (const member of members) {
    const s = member.status;
    const hard = member.cancelled ? 'manual navigation' : !fresh(s) ? 'stale or missing report' :
      !s || s.rip || s.hp <= 0 ? 'dead' : s.groupedCombat?.protocol !== 4 ? 'waiting for updated combat runtime' :
      s.activeEvent || s.joinedEvent || s.mapEvent ? 'event owns character' :
      !anchorAvailable ? 'anchor unavailable' : !range ? 'healing range unavailable' : null;
    if (hard || !s || !anchor) { blockers.push(member.name + ': ' + hard); continue; }
    const samePlace = s.server === anchor.server && s.map === anchor.map && s.in === anchor.in;
    const gap = samePlace ? Math.hypot(s.x-anchor.x,s.y-anchor.y) : Infinity;
    const visible = member.name === anchorMember?.name || s.groupedCombat?.anchorVisible === true;
    const separated = !samePlace || !visible && gap > range;
    const wasRecovering = same && previous.recovering?.includes(member.name);
    if (separated || wasRecovering) {
      const covered = samePlace && visible && gap <= Math.max(10, range - 10);
      if (covered) recoverySince[member.name] = previous?.recoverySince?.[member.name] ?? now;
      const stable = covered && now - recoverySince[member.name]! >= 500;
      const acknowledged = !previous?.selection || s.groupedCombat?.ack === previous.selection;
      if (!stable || !acknowledged) { recovering.push(member.name); continue; }
    }
    participating.push(member.name);
  }
  const readySince = blockers.length ? null : same && previous.readySince !== null ? previous.readySince : now;
  const ready = readySince !== null && now-readySince >= 500;
  // Runtime/formation changes invalidate acknowledgements, never unfinished fights.
  // Reports retain the last coordinator state so a process restart can recover it.
  resetAt=Math.max(resetAt,previous?.resetAt||0,...members.map(m=>m.status?.groupedCombat?.state?.resetAt||0));
  const restored = (previous && (previous.resetAt||0)>=resetAt ? previous : null) || members.map(m=>m.status?.groupedCombat?.state)
    .find(g=>(g?.protocol === 4 || g?.protocol === 3) && g.leader === leader && (g.resetAt||0)>=resetAt);
  const targetLeader = leader;
  const lostByIdentity=new Map<string,LostTarget>();
  for(const g of [restored,...members.map(m=>m.status?.groupedCombat?.state)])for(const t of g?.lostTargets||[])
    if(t.retiredAt>=resetAt && (!lostByIdentity.has(targetIdentity(t))||lostByIdentity.get(targetIdentity(t))!.retiredAt<t.retiredAt))lostByIdentity.set(targetIdentity(t),t);
  const recoveryState=restored?{...restored,lostTargets:[...lostByIdentity.values()]}:null;
  const result = reconcileQueue(recoveryState?.leader===leader ? recoveryState : null, members, leader, now, key, resetAt, pullsPaused || !ready || recovering.length > 0, huntTarget);
  const {passingEncounters, target, fights, threats, queue, queueRevision, deaths, evidence, claims, rareRejections, lostTargets, searches, pursuit, pursuitExclusions} = result;
  const fighterStatus = target && members.find(m=>m.name===target.fighter)?.status;
  const fighter = target && fighterStatus && fresh(fighterStatus) && !fighterStatus.rip && fighterStatus.hp>0 &&
    fighterStatus.server===target.server && fighterStatus.map===target.map && fighterStatus.in===target.in ?
    {name:target.fighter,map:target.map,in:target.in,server:target.server,x:fighterStatus.x,y:fighterStatus.y}:null;
  const selection = target ? JSON.stringify([key,target.id,target.server,target.map,target.in,target.startedAt]) : null;
  const observers=members.filter(m=>fresh(m.status)&&!m.status!.rip&&m.status!.hp>0&&m.status!.server===target?.server&&m.status!.map===target.map&&m.status!.in===target.in&&
    m.status!.groupedCombat?.sightings?.some(t=>t.id===target.id&&t.map===target.map&&t.in===target.in))
    .map(m=>({name:m.name,map:m.status!.map,in:m.status!.in,server:m.status!.server,x:m.status!.x,y:m.status!.y,seenAt:m.status!.seenAt}));
  const acknowledged = !!selection && participating.length > 0 && members.filter(m=>participating.includes(m.name)).every(m=>fresh(m.status) && m.status?.groupedCombat?.ack===selection);
  const preack = !!previous?.queueRevision && members.length>0 && members.every(m=>fresh(m.status) && m.status?.groupedCombat?.queueAck===previous.queueRevision) && previous.queue.some(t=>t.id===target?.id && t.server===(target as Fight)?.server);
  const terrainRecovery=formationRecovery(same ? previous : null,members,target,key,now,pullsPaused,range);
  const committed = !terrainRecovery && !pursuit?.revoking && !!selection && (target?.state!=='planned' || !pullsPaused) && (target?.state==='engaged' || ready && recovering.length===0 &&
    (same && previous.selection===selection && previous.committed || acknowledged || preack));
  if (!blockers.length && !ready) blockers.push('waiting for stable formation');
  if (selection && !acknowledged && !committed) for (const m of members.filter(m=>participating.includes(m.name)))
    if (m.status?.groupedCombat?.ack!==selection) blockers.push(m.name+': awaiting target revision');
  if (pursuit?.reason) blockers.push(pursuit.reason);
  const transitionTrace=(restored?.transitionTrace||[]).slice(-99);
  for(const prior of restored?.queue||[])if(prior.state==='planned'&&!queue.some(t=>targetIdentity(t)===targetIdentity(prior))) {
    const rejection=members.flatMap(m=>m.status?.groupedCombat?.retentions||[]).find(t=>t.id===prior.id&&!t.eligible);
    transitionTrace.push({at:now,target:prior.id,reason:'Nomination removed: '+(rejection?.reason||'queue priority, reset, or report eligibility changed')});
  }
  if(restored?.target?.id!==target?.id||lostTargets.length!==(restored?.lostTargets||[]).length)
    transitionTrace.push({at:now,target:target?.id||null,reason:lostTargets.length>(restored?.lostTargets||[]).length?'target retired as lost':'queue target changed'});
  return {passingEncounters,protocol:4, formationRecovery:terrainRecovery, pursuit, pursuitExclusions, lostTargets, searches, transitionTrace, resetAt, claims, rareRejections, observers, queue, queueRevision, deaths, evidence, fights, threats, fighter, targetLeader, participating, recovering, recoverySince, key,phase:!ready?'regrouping':!target?'ready':target.state==='engaged'?'engaged':target.state==='pending'?'attack-pending':committed?'approaching':'selecting',leader,
    members:members.map(m=>m.name),priest:priest?.name || null,
    anchor:anchor && anchorMember && fresh(anchor) && !anchor.rip && anchor.hp>0 ?
      {name:anchorMember.name,map:anchor.map,in:anchor.in,server:anchor.server,x:anchor.x,y:anchor.y}:null,
    range,ready,readySince,seenAt:now,target,selection,committed,blockers};
}
