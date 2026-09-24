import {collectPassing, passingIdentity} from './passing.ts';
import {trackPursuit} from './pursuit.ts';
import {recoverLostTargets, targetIdentity} from "./lost-target.ts";
import type {Member, Target, Fight, Group, Death} from './grouped.ts';
import {reconcileClaims} from './claims.ts';
import {releaseResetFights} from './reset-fight.ts';
import {retainNominations} from './nomination-retention.ts';
import {releaseUnseenPrimary} from './unseen-primary.ts';
export interface Candidate extends Target {priority?: number; passiveRare?: boolean}
export interface Evidence extends Target {server: string|undefined; at: number; startedAt?: number; action: string; state: 'pending' | 'engaged' | 'rejected'}
export function reconcileQueue(old: Group | undefined | null, members: Member[], leader: string, now: number, key: string, resetAt=0, pullsPaused=false, huntTarget: string | null = null) {
  const huntDefense=members.some(m=>m.status && now-m.status.seenAt<=3000 && m.status.groupedCombat?.huntDefense);
  const defending = new Set(members.flatMap(m => m.status && now-m.status.seenAt<=3000 && m.status.groupedCombat?.returnDefense
    ? (m.status.groupedCombat.currentAttackers || []).map(t => passingIdentity({...t,server:m.status!.server})) : []));
  // A farming Hunt takes ownership of its target, including attacks made en route.
  // Drop cached peer reports too: their normal expiry can otherwise block the pull.
  const passingEncounters=collectPassing(members,old?.passingEncounters||[],now)
    .filter(t=>!huntDefense && t.mtype!==huntTarget && !defending.has(passingIdentity(t)));
  const passing=new Set(passingEncounters.map(passingIdentity));
  const failedRecovery=old?.formationRecovery;
  if(old && failedRecovery?.phase==='failed' && members.every(m=>m.status && now-m.status.seenAt<=3000 && m.status.groupedCombat?.formationRecovery?.ack===failedRecovery.id))
    old={...old,pursuitExclusions:[...(old.pursuitExclusions||[]),{identity:failedRecovery.target,until:now+10000}]};
  const fresh = (m: Member) => !!m.status && now-m.status.seenAt<=3000 && now>=m.status.seenAt-500;
  const reports=members.filter(m=>fresh(m)&&(m.status!.groupedCombat?.epoch||0)>=resetAt);
  const identity=(t: {id:string;map:string;in?:string|number;server?:string})=>JSON.stringify([t.server,t.map,t.in,t.id]);
  const rareRejections=(old?.rareRejections||[]).filter(t=>(t.expiresAt??t.until)>now);
  const rejected=(t:Target & {server:string|undefined})=>rareRejections.some(r=>r.until>now&&identity(r)===identity(t));
  const abandoned=(e:Evidence)=>rareRejections.some(r=>identity(r)===identity(e) &&
    (e.startedAt??e.at)<=(r.rejectedAt??r.until-120000)) && !old?.fights.some(f=>identity(f)===identity(e)&&f.state==='engaged');
  const deaths: Death[]=[...(old?.deaths||[]),...reports.flatMap(m=>m.status!.groupedCombat?.deaths||[])];
  const tombstones=[...new Map(deaths.filter(d=>d.at<=now+500).map(d=>[identity(d),d])).values()].slice(-512);
  const lostTargets=[...((old?.lostTargets||[]).filter(t=>t.retiredAt>=resetAt))];
  const retired=(t:Target & {server:string|undefined},at?:number)=>lostTargets.some(l=>identity(l)===identity(t)&&(at===undefined||at<=l.retiredAt));
  const dead=(t: Target & {server:string|undefined})=>passing.has(passingIdentity(t)) || tombstones.some(d=>identity(d)===identity(t));
  const claims=releaseResetFights(old?.fights||[],reports,reconcileClaims(old?.claims||[],reports,now,resetAt),now).filter(c=>!tombstones.some(d=>identity(c)===identity(d)));
  const claimFor=(t: Target & {server:string|undefined})=>claims.find(c=>identity(c)===identity(t));
  const excluded=(t: Target & {server:string|undefined},at?:number)=>{
    const c=claimFor(t);return dead(t) || retired(t,at) || !!c && (c.external || at!==undefined && c.releasedAt!==undefined && at<=c.releasedAt);
  };
  const events=new Map((old?.evidence||[]).filter(e=>(e.startedAt??e.at)>=resetAt).map(e=>[e.action,e]));
  for(const m of reports) for(const e of m.status!.groupedCombat?.evidence||[]) {
    if(e.server!==m.status!.server || e.map!==m.status!.map || e.in!==m.status!.in || e.at>now+500 || (e.startedAt??e.at)<resetAt)continue;
    const prior=events.get(e.action);
    if(!prior || e.at>prior.at || e.at===prior.at && prior.state==='pending')events.set(e.action,e);
  }
  const evidence=[...events.values()].filter(e=>!excluded(e,e.startedAt??e.at)&&!abandoned(e)&&(!rejected(e)||e.state==='engaged'));
  const fights=(old?.fights||[]).filter(f=>!excluded(f,f.startedAt)&&(!rejected(f)||f.state==='engaged')).map(f=>({...f,state:f.state||'engaged' as const}));
  for(const e of evidence) {
    let f=fights.find(f=>identity(f)===identity(e));
    if(e.state==='rejected')continue;
    if(!f) {f={...e,fighter:leader,startedAt:old?.queue?.find(t=>identity(t)===identity(e))?.startedAt??e.at,state:e.state};fights.push(f);}
    if(e.state==='engaged')f.state='engaged';
  }
  for(let i=fights.length-1;i>=0;i--) if(fights[i].state==='pending' && !evidence.some(e=>identity(e)===identity(fights[i]) && e.state!=='rejected'))fights.splice(i,1);
  for(const m of reports) for(const t of m.status!.groupedCombat?.threats||[]) {
    if(t.map!==m.status!.map || t.in!==m.status!.in)continue;
    const f={...t,server:m.status!.server,fighter:m.name,startedAt:old?.queue?.find(c=>identity(c)===identity({...t,server:m.status!.server}))?.startedAt??now,state:'engaged' as const};
    if(excluded(f,now) || claimFor(f)?.releasedAt!==undefined && !(m.status!.groupedCombat?.claims||[]).some(c=>identity(c)===identity(f)&&!c.external&&c.at>claimFor(f)!.releasedAt!))continue;
    const prior=fights.find(p=>identity(p)===identity(f));
    if(prior){prior.state='engaged';prior.x=t.x;prior.y=t.y;} else fights.push(f);
  }
  for(const m of reports) for(const t of m.status!.groupedCombat?.sightings||[]) {
    const f=fights.find(f=>identity(f)===identity({...t,server:m.status!.server}));
    if(f){f.x=t.x;f.y=t.y;f.fighter=leader;}
  }
  const recovery=recoverLostTargets(fights,members,old?.searches||{},now);
  lostTargets.push(...recovery.lost);
  for(let i=fights.length-1;i>=0;i--)if(recovery.lost.some(t=>targetIdentity(t)===targetIdentity(fights[i])))fights.splice(i,1);
  const selector=members.find(m=>m.name===leader);
  const s=selector?.status;
  const score=(t:Target)=>s ? Math.hypot(s.x-t.x,s.y-t.y) : Infinity;
  const reported = reports.flatMap(m => (m.status!.groupedCombat?.candidates || [])
    .filter(t => m.name === leader || t.passiveRare === true || t.mtype === huntTarget)
    .filter(t => m.status!.server === s?.server && t.map === m.status!.map && t.in === m.status!.in));
  const retained=retainNominations((old?.queue||[]).filter(t=>t.startedAt>=resetAt),members,now);
  const unique:Candidate[] = s ? [...new Map<string,Candidate>([...reported,...retained].map(t => [identity({...t,server:s.server}),t])).values()] : [];
  const candidates=(selector&&fresh(selector)?unique:[])
    .filter(t=>t.map===s?.map&&t.in===s?.in&&!excluded({...t,server:s!.server},now)&&!rejected({...t,server:s!.server})&&!(old?.pursuitExclusions||[]).some(e=>e.until>now&&e.identity===targetIdentity({...t,server:s!.server}))&&!fights.some(f=>identity(f)===identity({...t,server:s!.server})))
    .map(t=>({...t,server:s!.server,fighter:leader,startedAt:old?.queue?.find(c=>c.id===t.id&&c.map===t.map&&c.in===t.in)?.startedAt??now,state:'planned' as const,score:score(t)}))
    .sort((a,b)=>(b.priority??50)-(a.priority??50)||a.score-b.score||a.id.localeCompare(b.id));
  const released = releaseUnseenPrimary(old?.target, fights, candidates, members, recovery.searches, now, pullsPaused);
  if (released) {
    lostTargets.push(released);
    fights.splice(fights.findIndex(f => targetIdentity(f) === targetIdentity(released)), 1);
    delete recovery.searches[targetIdentity(released)];
  }
  const visibleThreat=(f:Fight)=>reports.some(m=>m.status!.server===f.server&&(m.status!.groupedCombat?.threats||[]).some(t=>t.id===f.id&&t.map===f.map&&t.in===f.in));
  const missingHead=old?.target && recovery.searches[targetIdentity(old.target as Fight)];
  const defense=missingHead&&fights.find(visibleThreat);
  const priorFight=defense||fights.find(f=>old?.target && identity(f)===identity(old.target as Fight));
  const ordered=[...(priorFight?[priorFight]:[]),...fights.filter(f=>f!==priorFight).sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id))];
  const planned=old?.target && !ordered.length ? candidates.find(c=>identity(c)===identity(old.target as Fight)) : null;
  const higherRare = planned && candidates.find(c=>c.passiveRare && (c.priority??50)>(planned.priority??50));
  let target=ordered[0]||higherRare||planned||candidates[0]||null;
  const pursuitResult=trackPursuit(old,target,candidates,members,now,key,pullsPaused,huntTarget);
  if(pursuitResult.replacement)target=candidates.find(c=>targetIdentity(c)===targetIdentity(pursuitResult.replacement!))||target;
  const queue=target?[target,...ordered.filter(f=>f!==target),...candidates.filter(c=>c!==target&&!pursuitResult.pursuitExclusions.some(e=>e.identity===targetIdentity(c)))].slice(0,Math.max(3,ordered.length)):[];
  const revision=JSON.stringify([key,queue.map(t=>identity(t))]);
  return {passingEncounters,pursuit:pursuitResult.pursuit,pursuitExclusions:pursuitResult.pursuitExclusions,claims,rareRejections,lostTargets,searches:recovery.searches,fights:ordered,queue,target,queueRevision:revision,deaths:tombstones,evidence:evidence.filter(e=>!retired(e,e.startedAt??e.at)&&(e.state==='pending'||now-e.at<60000)).slice(-256),
    threats:ordered.filter(f=>reports.some(m=>(m.status!.groupedCombat?.threats||[]).some(t=>identity({...t,server:m.status!.server})===identity(f))))};
}
