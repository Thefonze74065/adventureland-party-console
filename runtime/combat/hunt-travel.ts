import {passiveStopRequired, type PassiveTravelSettings} from './passive-travel.ts';
import type {Fight, Member} from './grouped.ts';
import {collectPassing, passingIdentity} from './passing.ts';
import {recoverLostTargets, type SearchState} from './lost-target.ts';

export interface HuntTravelConvoy {
  id?: string; epoch?: number; purpose?: string | null; huntTarget?: string;
  force?: boolean; navigationExempt?: boolean; nonPreemptible?: boolean; continuousReturn?: number; phase?: string; observationPhase?: string;
  huntTravel?: {primary: Fight | null; searches: Record<string, SearchState>; retired?: string[]; committed?: Fight[]; reason?: "passive-setting" | "extra-aggro"};
}
export interface HuntTravelControl {
  id?: string; epoch?: number; primary: Fight | null; defending: boolean; committed?: Fight[]; reason?: "passive-setting" | "extra-aggro";
}
export function outboundHunt(c: HuntTravelConvoy | null | undefined): boolean {
  return !!c && c.purpose === 'monster-hunt' && !!c.huntTarget && !c.continuousReturn;
}
export function interruptibleTravel(c: HuntTravelConvoy | null | undefined): boolean {
  return !!c && !c.force && !c.navigationExempt && !c.nonPreemptible && !c.continuousReturn &&
    !['escape-recovery','franky-exit','event-return','rare-hunt','phoenix-patrol','shared-walk-return'].includes(c.purpose||'') &&
    !(c.purpose==='monster-hunt' && !c.huntTarget);
}
function stopCandidates(members: Member[], settings: PassiveTravelSettings | undefined, now: number): Fight[] {
  const fresh=observations(members,now), names=members.map(m=>m.name);
  const candidates=fresh.flatMap(m=>(m.status?.groupedCombat?.travelCandidates||[]).filter(t=>
    t.map===m.status!.map && String(t.in??t.map)===String(m.status!.in??m.status!.map) && t.hp!==0 && (!t.target || names.includes(t.target)))
    .map(t=>({...t,server:m.status!.server,fighter:m.name,startedAt:now,state:'engaged' as const})));
  const dead=new Set(fresh.flatMap(m=>m.status?.groupedCombat?.deaths||[]).map(passingIdentity));
  return [...huntAttackers(members,now),...candidates].filter(t=>passiveStopRequired(settings,t.mtype) && !dead.has(passingIdentity(t)))
    .sort((a,b)=>(settings?.rules[b.mtype]?.priority||0)-(settings?.rules[a.mtype]?.priority||0)||passingIdentity(a).localeCompare(passingIdentity(b)));
}
export function huntDefense(c: HuntTravelConvoy): boolean {
  return c.phase === 'defending' || c.phase === 'observing' && c.observationPhase === 'defending';
}
function observations(members: Member[], now: number): Member[] {
  return members.filter(m=>!m.cancelled && m.status && !m.status.rip && m.status.hp>0 &&
    now-m.status.seenAt<=3000 && m.status.seenAt<=now+500);
}
export function huntAttackers(members: Member[], now: number): Fight[] {
  const names=members.map(m=>m.name), found=new Map<string,Fight>();
  for(const m of observations(members,now)) {
    const s=m.status!, g=s.groupedCombat;
    if(!g?.currentAttackersAt || now-g.currentAttackersAt>3000 || g.currentAttackersAt>now+500)continue;
    for(const t of g.currentAttackers||[]) {
      if(!names.includes(t.target) || t.hp===0 || t.map!==s.map || String(t.in??t.map)!==String(s.in??s.map))continue;
      const f={...t,server:s.server,fighter:m.name,startedAt:now,state:'engaged' as const};
      found.set(passingIdentity(f),f);
    }
  }
  const dead=new Set(members.flatMap(m=>m.status?.groupedCombat?.deaths||[]).map(passingIdentity));
  return [...found.values()].filter(t=>!dead.has(passingIdentity(t)));
}
/** Keep the encounter independently of range and admission scope changes. */
export function updateHuntTravel(c: HuntTravelConvoy, members: Member[], now: number, scope?: string, settings?: PassiveTravelSettings): HuntTravelControl | undefined {
  if(!interruptibleTravel(c))return undefined;
  const stops=huntDefense(c) ? huntAttackers(members,now).filter(t=>passiveStopRequired(settings,t.mtype)) : stopCandidates(members,settings,now);
  if(!outboundHunt(c) && !c.huntTravel && !stops.length)return undefined;
  const state=c.huntTravel ||= {primary:null,searches:{}};
  const fresh=observations(members,now);
  const deaths=fresh.flatMap(m=>[...(m.status?.groupedCombat?.deaths||[]),...(m.status?.groupedCombat?.state?.lostTargets||[])]);
  if(state.primary && deaths.some(t=>passingIdentity(t)===passingIdentity(state.primary!))) {
    (state.retired||=[]).push(passingIdentity(state.primary));state.primary=null;
  }
  if(state.primary && fresh.length===members.length && fresh.every(m=>m.status!.server!==state.primary!.server || m.status!.map!==state.primary!.map || String(m.status!.in??m.status!.map)!==String(state.primary!.in??state.primary!.map)))state.primary=null;
  if(state.primary) {
    const seen=fresh.flatMap(m=>(m.status?.groupedCombat?.sightings||[]).map(t=>({...t,server:m.status!.server})))
      .find(t=>passingIdentity(t)===passingIdentity(state.primary!));
    if(seen)state.primary={...state.primary,...seen};
    const recovery=recoverLostTargets([state.primary],members,state.searches,now);
    state.searches=recovery.searches;
    if(recovery.lost.length){(state.retired||=[]).push(passingIdentity(state.primary));state.primary=null;}
  }
  if(stops.length || state.primary && passiveStopRequired(settings,state.primary.mtype)) {
    state.reason='passive-setting';
    const stop=stops[0] || state.primary!;
    const retained=[...(state.committed||[]),stop];
    state.committed=[...new Map(retained.map(t=>[passingIdentity(t),t])).values()];
    state.primary ||= stop;
  }
  if(!state.primary && !huntDefense(c) && !state.reason) {
    const attackers=huntAttackers(members,now);
    const proposals=collectPassing(fresh,[],now).filter(t=>!!scope && t.admission?.scope===scope && !state.retired?.includes(passingIdentity(t)))
      .sort((a,b)=>(a.startedAt??a.at)-(b.startedAt??b.at)||passingIdentity(a).localeCompare(passingIdentity(b)));
    const first=attackers[0] || proposals[0];
    if(first)state.primary={...first,server:first.server,fighter:members[0]?.name||'',startedAt:now,state:'engaged'};
  }
  return {id:c.id,epoch:c.epoch,primary:state.primary,defending:huntDefense(c),committed:state.committed,reason:state.reason};
}
