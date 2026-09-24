import { classifyTravelDefense, normalTravel, type DefenseState } from "./travel-defense.ts";
import { returnWalking, type ReturnTownPolicy } from './return-town.ts';
import { collectPassing, passingIdentity, type PassingEncounter } from '../../combat/passing.ts';
import type { Member } from '../../combat/grouped.ts';
import {outboundHunt, huntDefense, type HuntTravelConvoy} from '../../combat/hunt-travel.ts';
export { classifyTravelDefense } from "./travel-defense.ts";
interface Loot { id: string; after: number; realm: string; map: string; in: string; x: number; y: number; complete: boolean; progress?: Progress }
interface Progress { id: string; observedAt: number; realm: string; map: string; in: string; complete: boolean; error?: string }
interface Status { seenAt: number; rip?: boolean; hp: number; map: string; in?: string; region?: string; server: string; x: number; y: number; convoyLoot?: Progress; activeEvent?: unknown; joinedEvent?: unknown; mapEvent?: unknown }
interface Convoy extends HuntTravelConvoy {
  defenseTargets?: PassingEncounter[];
  continuousReturn?: number; huntTarget?: string; returnTown?: ReturnTownPolicy; townRetry?: boolean;
  returnTownRally?: {map:string;x:number;y:number};
  farmingEngagement?: {target: {id:string;map:string;in?:string|number;server?:string};at:number;finished?:boolean};
  id: string; epoch: number; phase: string; purpose?: string | null; force?: boolean; navigationExempt?: boolean;
  participants: string[]; leader: string; label?: string; loot?: Loot; defenseAt?: number; defenseReason?: string | null;
  departAt?: number | null; completed: string[]; rally?: { map: string; x: number; y: number };
  observedPhase?: string | null; assembledSince?: number; runtimes?: unknown; location: unknown; finalLocation?: unknown;
  returnLegs?: unknown; returnRouting?: boolean; townFirst?: boolean; townCompleted?: boolean;
  failure?: string | null; failureCode?: string | null; failedAt?: number | null;
  observationPhase?: string;
}
interface Party extends DefenseState {
  activeConvoy?: Convoy | null; commands: Record<string, unknown>;
  navigationIntents?: Record<string, { cancelled?: boolean } | undefined>;
  escape?: { stage: string } | null;
}
export function fighting(party: DefenseState, names: string[], now = Date.now()): boolean {
  return classifyTravelDefense(party, names, now).state === "defending";
}
export function eligible(input: unknown, convoy: unknown): boolean {
  const party = input as Party, c = convoy as Convoy | null;
  return !!c && !c.force && normalTravel(c.purpose) &&
    (!c.navigationExempt || c.purpose === "anniversary-return") && !c.participants.some(name => {
      const s = party.statuses[name] as Status | undefined;
      return s?.activeEvent || s?.joinedEvent || s?.mapEvent;
    });
}
function cancelled(p: Party, c: Convoy): boolean {
  return c.participants.some(n => p.navigationIntents?.[n]?.cancelled) || !!p.escape && p.escape.stage !== "released";
}
function createLoot(c: Convoy, lead: Status, now: number): Loot {
  return { id: JSON.stringify(["convoy", c.id, c.epoch, now]), after: now, realm: `${lead.region || ""}:${lead.server || ""}`,
    map: lead.map, in: String(lead.in ?? lead.map), x: lead.x, y: lead.y, complete: false };
}
function matching(progress: Progress | undefined, loot: Loot, lead: Status): progress is Progress {
  return !!progress && progress.id === loot.id && progress.observedAt > loot.after &&
    progress.realm === loot.realm && progress.map === loot.map && String(progress.in) === loot.in &&
    lead.map === loot.map && String(lead.in ?? lead.map) === loot.in && Math.hypot(lead.x - loot.x, lead.y - loot.y) <= 180;
}
function lootComplete(p: Party, c: Convoy, now: number): boolean {
  const lead = p.statuses[c.leader] as Status;
  c.loot ||= createLoot(c, lead, now);
  if (matching(lead.convoyLoot, c.loot, lead)) { c.loot.progress = lead.convoyLoot; c.loot.complete = lead.convoyLoot.complete; }
  if (c.loot.complete) return true;
  c.defenseReason = "Pending travel loot: " + (c.loot.progress?.error || "collecting defensive kill drops");
  return false;
}
function resume(c: Convoy): void {
  if(huntDefense(c))delete c.huntTravel;
  delete c.defenseTargets;
  c.townRetry = false;
  delete c.farmingEngagement;
  delete c.loot;
  c.phase = "assemble"; c.epoch++; c.observedPhase = null; c.assembledSince = 0;
  c.runtimes = null; c.completed = []; c.location = c.finalLocation || c.location; c.returnLegs = null;
  c.returnRouting = !!c.returnRouting; c.townFirst = false; c.townCompleted = false;
  c.failure = null; c.failureCode = null; c.failedAt = null; c.defenseReason = null;
}
function observeHold<S, C>(input: S, p: Party, c: Convoy, message: string,
  commandFor: (state: S, convoy: C, phase: string, name: string) => unknown): boolean {
  c.defenseReason = message;
  if (c.phase === "observing") return true;
  c.observationPhase = c.phase; c.phase = "observing"; c.departAt = null;
  for (const name of c.participants) p.commands[name] = commandFor(input, c as C, "hold", name);
  return true;
}
function resumeObservation<S, C>(input: S, p: Party, c: Convoy,
  commandFor: (state: S, convoy: C, phase: string, name: string) => unknown): boolean {
  if (c.phase !== "observing") return false;
  const defended = c.observationPhase === "defending";
  delete c.observationPhase;
  if (defended) { c.phase = "defending"; return false; }
  resume(c);
  for (const name of c.participants) p.commands[name] = commandFor(input, c as C, "assemble", name);
  return true;
}
function finishDefense(p: Party, c: Convoy, now: number): boolean {
  if (!lootComplete(p, c, now)) return false;
  const lead = p.statuses[c.leader] as Status;
  resume(c); c.rally = c.returnTownRally || { map: lead.map, x: lead.x, y: lead.y };
  return true;
}
function defend(c: Convoy, now: number, message: string): boolean {
  delete c.loot; c.defenseReason = message;
  if (c.phase === "defending") return false;
  c.phase = "defending"; c.defenseAt = now; c.departAt = null; c.completed = [];
  return true;
}
function ownedConvoy(p: Party): Convoy | null {
  const c = p.activeConvoy;
  return c && !c.continuousReturn && !returnWalking(c) && eligible(p, c) && !cancelled(p, c) && !superseded(p, c) && !casualty(p, c) ? c : null;
}
function superseded(p: Party, c: Convoy): boolean {
  return c.participants.some(name => {
    const command = p.commands[name] as { type?: string; convoyId?: string } | undefined;
    return !!command && (!!command.type && command.type !== "party-monster-travel" || !!command.convoyId && command.convoyId !== c.id);
  });
}
function casualty(p: Party, c: Convoy): boolean {
  return c.participants.some(name => { const s = p.statuses[name] as Status | undefined; return s?.rip || s?.hp === 0; });
}
function localDefense(p: Party, c: Convoy): boolean {
  return c.participants.some(name => {
    const command = p.commands[name] as {id?:number;convoyId?:string;epoch?:number;navigationRevision?:number} | undefined;
    const s = p.statuses[name] as {convoyNavigation?: {id:string;epoch:number;commandId:number;navigationRevision:number;runtimeId:string;phase:string};combatSelection?:{runtimeId?:string}} | undefined;
    const n=s?.convoyNavigation;
    if(!n || !command || n.phase!=='defending')return false;
    return [command.convoyId===c.id,n.id===c.id,n.epoch===c.epoch,n.commandId===command.id,
      n.navigationRevision===command.navigationRevision,n.runtimeId===s?.combatSelection?.runtimeId].every(Boolean);
  });
}
interface DefenseReport {
  seenAt?: number;
  convoyNavigation?: {id:string;epoch:number;commandId:number;runtimeId:string;navigationRevision:number;phase:string;
    defenseTargets?:PassingEncounter[];defenseInterruption?:{source:string}};
  combatSelection?: {runtimeId:string};
}
function stoppedReports(p: Party, c: Convoy): (DefenseReport & {name:string})[] {
  return c.participants.map(name=>({...p.statuses[name] as DefenseReport,name})).filter(s=>
    s?.convoyNavigation?.phase==='defending' && s.convoyNavigation.id===c.id && s.convoyNavigation.epoch===c.epoch);
}
function reportOwned(p: Party, c: Convoy, s: DefenseReport & {name:string}, now: number): boolean {
  const n=s.convoyNavigation!;
  const command=p.commands[s.name] as {id?:number;convoyId?:string;navigationRevision?:number} | undefined;
  return !!s.seenAt && now-s.seenAt<=3000 && n.runtimeId===s.combatSelection?.runtimeId &&
    command?.convoyId===c.id && n.commandId===command.id && n.navigationRevision===command.navigationRevision;
}
function stoppedCauses(c: Convoy, reports: DefenseReport[]): PassingEncounter[] | null {
  const causes=[...(c.defenseTargets||[])];
  for(const s of reports) {
    const n=s.convoyNavigation!, targets=n.defenseTargets||[];
    if(!targets.length && !(causes.length && n.defenseInterruption?.source==='coordinator'))return null;
    causes.push(...targets);
  }
  return causes.length ? causes : null;
}
function obsoleteDefense(p: Party, c: Convoy, now: number): boolean {
  if(outboundHunt(c) || c.huntTravel?.reason)return false;
  const members=c.participants.map(name=>({name,ctype:'',revision:0,status:p.statuses[name] as Member['status']}));
  const passing=new Set(collectPassing(members,[],now).map(passingIdentity));
  const reports=stoppedReports(p,c);
  if(!reports.every(s=>reportOwned(p,c,s,now)))return false;
  const causes=stoppedCauses(c,reports);
  return !!causes && causes.every(t=>passing.has(passingIdentity(t)));
}
function resumePassingDefense<S,C>(input:S,p:Party,c:Convoy,state:string,now:number,
  commandFor:(state:S,convoy:C,phase:string,name:string)=>unknown):boolean {
  if(state!=='clear' || !obsoleteDefense(p,c,now))return false;
  // Detached routes rebuild under a new epoch; passing-only stops own no loot.
  resume(c);
  for(const name of c.participants)p.commands[name]=commandFor(input,c as C,'assemble',name);
  return true;
}
function rememberDefenseTargets(p:Party,c:Convoy,attackers:PassingEncounter[]):void {
  if(c.huntTravel)c.huntTravel.reason ||= 'extra-aggro';
  if(attackers.length)c.defenseTargets=[...new Map([...(c.defenseTargets||[]),...attackers].map(t=>[passingIdentity(t),t])).values()];
  else c.defenseTargets=stoppedCauses(c,stoppedReports(p,c))||undefined;
}
function defenseParticipants(c: Convoy): string[] {
  return outboundHunt(c) ? c.participants : c.participants.filter(name=>!c.completed.includes(name));
}
/** All route implementations share this barrier and keep their own command identities. */
export function step<S, C>(input: S, now: number, commandFor: (state: S, convoy: C, phase: string, name: string) => unknown): boolean {
  const p = input as Party, c = ownedConvoy(p);
  if (!c) return false;
  const decision = classifyTravelDefense(p, defenseParticipants(c), now);
  if (farmingEngagementPending(p,c,now)) return true;
  if (decision.state === "waiting-for-observations") return observeHold(input, p, c, decision.message, commandFor);
  if(resumePassingDefense(input,p,c,decision.state,now,commandFor))return true;
  const observationResumed=resumeObservation(input, p, c, commandFor);
  if ([observationResumed,decision.state === "clear"].every(Boolean)) return true;
  if (needsDefense(p,c,decision.state)) {
    rememberDefenseTargets(p,c,decision.attackers.map(t=>({...t,at:now})));
    if (!defend(c, now, decision.message)) return true;
  } else {
    if (c.phase !== "defending") { c.defenseReason = null; return false; }
    if (!finishDefense(p, c, now)) return true;
  }
  c.participants.forEach(name=>{p.commands[name] = commandFor(input, c as C, c.phase, name);});
  return true;
}

function farmingEngagementPending(p: Party, c: Convoy, now: number): boolean {
  const encounter=c.farmingEngagement;
  if (!encounter || encounter.finished) return false;
  const group=p.groupedCombat as {deaths?: {id:string;map:string;in?:string|number;server?:string}[];lostTargets?: {id:string;map:string;in?:string|number;server?:string}[];target?:{id:string}} | undefined;
  const matches=(t: typeof encounter.target)=>t.id===encounter.target.id && t.map===encounter.target.map &&
    String(t.in??t.map)===String(encounter.target.in??encounter.target.map) && t.server===encounter.target.server;
  const retired=group ? [...(group.deaths||[]),...(group.lostTargets||[])] : [];
  encounter.finished=retired.some(matches) ||
    now-encounter.at>15000 && group?.target?.id!==encounter.target.id;
  return !encounter.finished;
}

function needsDefense(p:Party,c:Convoy,state:string):boolean {
  return state==='defending' || c.phase!=='defending' && localDefense(p,c);
}
