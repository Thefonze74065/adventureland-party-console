import {passiveStopRequired, type PassiveTravelSettings} from '../../combat/passive-travel.ts';
import {collectPassing, passingIdentity, type PassingEncounter} from '../../combat/passing.ts';
import type { Fight, Group, Member, Target } from "../../combat/grouped.ts";
import {outboundHunt, huntDefense, huntAttackers, updateHuntTravel, type HuntTravelConvoy} from '../../combat/hunt-travel.ts';

export interface CurrentAttacker extends Target { target: string; server?: string }
interface Observation {
  activeEvent?: string | null; joinedEvent?: string | null;
  seenAt?: number; map?: string; in?: string | number; server?: string; hp?: number; rip?: boolean;
  serverLiveEvents?: { name?: string }[];
  groupedCombat?: { returnDefense?: boolean; passingEncounters?: PassingEncounter[]; currentAttackersAt?: number; currentAttackers?: CurrentAttacker[]; travelCommand?: { id: number; revision: number } | null };
}
export interface DefenseState { passiveHunting?: PassiveTravelSettings; statuses: Record<string, unknown>; groupedCombat?: unknown; activeConvoy?: HuntTravelConvoy & { participants?: string[]; returnTown?: { walking: boolean } } | null }
export interface DefenseResult {
  state: "clear" | "defending" | "waiting-for-observations";
  attackers: CurrentAttacker[];
  waiting: string[];
  message: string;
}
const identity = (t: { server?: string; map: string; in?: string | number; id: string }) =>
  JSON.stringify([t.server, t.map, String(t.in ?? t.map), String(t.id)]);
function fresh(at: number | undefined, now: number): boolean {
  return typeof at === "number" && now - at <= 3000 && at <= now + 500;
}
export function travelObservationIssue(status: Observation | undefined, now: number): string | null {
  if (!status) return 'missing character report';
  if (!fresh(status.seenAt, now)) return 'character report age ' + Math.round(now - (status.seenAt || 0)) + ' ms';
  const g = status.groupedCombat;
  if (!g?.currentAttackersAt) return 'missing connected attacker observation';
  if (!fresh(g.currentAttackersAt, now)) return 'attacker observation age ' + Math.round(now - g.currentAttackersAt) + ' ms';
  return Array.isArray(g.currentAttackers) ? null : 'missing attacker observation list';
}
function ready(status: Observation | undefined, now: number): status is Observation {
  return !!status && !status.rip && status.hp !== 0 && !travelObservationIssue(status, now);
}

function current(t: CurrentAttacker, status: Observation, names: string[]): boolean {
  return names.includes(t.target) && t.map === status.map &&
    String(t.in ?? t.map) === String(status.in ?? status.map) &&
    (!t.server || t.server === status.server) && t.hp !== 0;
}
// A member fighting a live event boss a map away from the leader belongs to
// that fight. Holding the convoy would stop a leader that cannot reach it
// (live 2026-10-21 05:28Z: leader held in main while followers fought
// Mr. Pumpkin in halloween).
function liveEventAttacker(t: CurrentAttacker, status: Observation): boolean {
  return !!t.mtype && !!status.serverLiveEvents?.some(event => event?.name === t.mtype);
}
function differentEventLocation(status: Observation, leader: Observation): boolean {
  return status.map !== leader.map || String(status.in ?? status.map) !== String(leader.in ?? leader.map);
}
function eventBossElsewhere(t: CurrentAttacker, status: Observation, leader: Observation | undefined, now: number): boolean {
  if (!leader || !fresh(leader.seenAt, now) || !leader.map || !status.map || !status.server || status.server !== leader.server || !liveEventAttacker(t, status)) return false;
  return differentEventLocation(status, leader);
}
/** The member's only attackers are live event bosses, a map away from the leader. */
export function eventFightElsewhere(party: DefenseState, name: string, now = Date.now()): boolean {
  const status = party.statuses[name] as Observation | undefined, attackers = status?.groupedCombat?.currentAttackers;
  if (!ready(status, now) || !attackers?.length) return false;
  const leader = convoyLeader(party);
  return attackers.every(t => current(t, status, party.activeConvoy?.participants || []) && eventBossElsewhere(t, status, leader, now));
}
function convoyLeader(party: DefenseState): Observation | undefined {
  const name = (party.activeConvoy as { leader?: string } | null | undefined)?.leader;
  return name ? party.statuses[name] as Observation | undefined : undefined;
}
function confirmedDeaths(party: DefenseState): Set<string> {
  const deaths = (party.groupedCombat as { deaths?: (Target & { server?: string })[] } | null)?.deaths || [];
  return new Set(deaths.map(identity));
}
function passingForDefense(party: DefenseState, names: string[], now: number) {
  return new Map(collectPassing(names.map(name=>({name,ctype:"",revision:0,status:party.statuses[name] as Member["status"]})),
    (party.groupedCombat as Group | undefined)?.passingEncounters || [], now).map(t=>[passingIdentity(t),t]));
}
function includeAttacker(party:DefenseState,passing:Map<string,PassingEncounter>,attacker:CurrentAttacker,departure?:boolean):boolean {
  const c=party.activeConvoy;
  if(passing.get(passingIdentity(attacker))?.keepMoving && !passiveStopRequired(party.passiveHunting,attacker.mtype))return false;
  return passiveStopRequired(party.passiveHunting,attacker.mtype) || outboundHunt(c) || !!departure || !!c?.continuousReturn || !passing.has(passingIdentity(attacker));
}
function observeTravelAttackers(party: DefenseState, names: string[], now: number, includePassingAttackers: boolean): Pick<DefenseResult, 'attackers' | 'waiting'> {
  const waiting: string[] = [], found = new Map<string, CurrentAttacker>();
  const dead = confirmedDeaths(party);
  const passing = includePassingAttackers ? new Map<string,PassingEncounter>() : passingForDefense(party,names,now);
  const leader = convoyLeader(party);
  for (const name of names) {
    const status = party.statuses[name] as Observation | undefined;
    if (!ready(status, now)) { waiting.push(name); continue; }
    for (const t of status.groupedCombat!.currentAttackers!) {
      if (current(t, status, names) && !eventBossElsewhere(t, status, leader, now)) {
        const attacker = { ...t, server: status.server };
        if (includeAttacker(party,passing,attacker,status.groupedCombat!.returnDefense) && !dead.has(identity(attacker))) found.set(identity(attacker), attacker);
      }
    }
  }
  return { attackers: [...found.values()], waiting };
}

/** Travel consults live targeting, never retained engagements or recent outgoing hits. */
export function classifyTravelDefense(party: DefenseState, names: string[], now = Date.now(), includePassingAttackers = false): DefenseResult {
  const { attackers, waiting } = observeTravelAttackers(party, names, now, includePassingAttackers);
  const defend = huntNeedsDefense(party,names,attackers,now);
  if (defend) return { state: "defending", attackers, waiting,
    message: defenseMessage(party,attackers) };

  if (waiting.length) return { state: "waiting-for-observations", attackers, waiting,
    message: "Waiting for fresh travel observations from " + waiting.join(", ") };
  return { state: "clear", attackers, waiting, message: "" };
}

function defenseMessage(party: DefenseState, attackers: CurrentAttacker[]): string {
  if(!attackers.length)return 'Travel encounter: pursuing '+(party.activeConvoy?.huntTravel?.committed||[]).map(t=>(t.mtype==='tinyp'?'Fairy':t.mtype)+' '+t.id).join(', ');
  return 'Defending '+[...new Set(attackers.map(t=>t.target))].join(', ')+' from '+attackers.map(t=>(t.mtype||'monster')+' '+t.id).join(', ');
}

function huntNeedsDefense(party: DefenseState, names: string[], attackers: CurrentAttacker[], now: number): boolean {
  const c=party.activeConvoy;
  if(!c)return attackers.length>0;
  const control=updateHuntTravel(c,names.map(name=>({name,ctype:'',revision:0,status:party.statuses[name] as Member['status']})),now,undefined,party.passiveHunting);
  if(!control)return attackers.length>0;
  if(control.reason==='passive-setting' && !huntDefense(c))return true;
  if(huntDefense(c)) {
    return attackers.length>0 || !!control.committed?.length;
  }
  const encounters=new Set(attackers.map(identity));
  if(control.primary)encounters.add(identity(control.primary));
  return encounters.size>1;
}

export interface TravelState {
  statuses?: Record<string, Observation | undefined>;
  activeConvoy?: { id?: string; epoch?: number; participants: string[]; purpose?: string | null; force?: boolean; phase?: string; farmingEngagement?: unknown } | null;
  commands?: Record<string, { id?: number; type?: string; phase?: string; convoyId?: string; navigationRevision?: number } | undefined>;
  navigationIntents?: Record<string, { revision?: number; cancelled?: boolean } | undefined>;
  monsterHunt?: { arrivalHandoff?: {releasedCommands?: Record<string, {id: number; revision: number}>}; cycleId?: string; stage?: string; currentIndex?: number; startedAt?: number; participants: string[]; exitMode?: string | null } | null;
  farmingPolicy?: string;
  rareHuntState?: { encounter?: { revisions?: Record<string, number> } | null } | null;
  farmAreaState?: { pending?: { at?: number } | null } | null;
  followers?: Record<string, unknown>;
  leader?: string | null;
  escape?: { stage?: string } | null;
}
export interface TravelCombat { id: string; revision: number; startedAt: number }
const controls = new WeakMap<TravelState, Map<string, TravelCombat>>();
export function normalTravel(purpose: string | null | undefined): boolean {
  return !["escape-recovery", "franky-exit", "event-return", "rare-hunt", "phoenix-patrol", "grouped-approach", "shared-walk-return"].includes(purpose || "");
}
function huntOperation(state: TravelState, name: string): { id: string; at: number } | null {
  const h = state.monsterHunt;
  if (!h?.participants?.includes(name) || !(state.farmingPolicy === "hunt" || h.exitMode)) return null;
  if (!["returning", "daisy-sync-travel", "mission-travel", "backup-travel", "batch-loot", "at-daisy", "turning-in"].includes(h.stage || "")) return null;
  return { id: [h.cycleId, h.stage, h.currentIndex].join(":"), at: h.startedAt || 0 };
}
function eventOwnsParticipant(state: TravelState, name: string): boolean {
  const participant = state.statuses?.[name];
  return !!(participant?.activeEvent || participant?.joinedEvent);
}
function waitingOperation(state: TravelState, name: string): { id: string; at: number } | null {
  if (eventOwnsParticipant(state, name)) return null;
  if (rareOwnsParticipant(state, name)) return null;
  const hunt = huntOperation(state, name);
  if (hunt) return hunt;
  if (state.farmAreaState?.pending && (name === state.leader || state.followers?.[name]))
    return { id: "farm:" + state.farmAreaState.pending.at, at: state.farmAreaState.pending.at || 0 };
  return null;
}
function rareOwnsParticipant(state: TravelState, name: string): boolean {
  const revision = state.rareHuntState?.encounter?.revisions?.[name];
  return revision !== undefined && revision === (state.navigationIntents?.[name]?.revision || 0);
}
function commandOperation(state: TravelState, name: string): { id: string; at: number } | null {
  const command = state.commands?.[name];
  if (!command || !["travel", "character-travel", "event-resume-travel", "return-leader"].includes(command.type || "")) return null;
  return { id: "command:" + command.id, at: command.id || 0 };
}
function releasedEventWalk(state: TravelState, name: string): boolean {
  const c = state.activeConvoy;
  const command = state.commands?.[name];
  // A terminal event-entry walk explicitly returns movement to event combat.
  // Retaining its diagnostic convoy must not keep the character combat-paused.
  return c?.phase === "failed" && command?.phase === "event-walk-release" && command.convoyId === c.id &&
      command.navigationRevision === (state.navigationIntents?.[name]?.revision || 0);
}
function operation(state: TravelState, name: string): { id: string; at: number } | null {
  const c = state.activeConvoy;
  if (releasedEventWalk(state, name)) return null;
  if (c?.participants?.includes(name)) return !c.force && normalTravel(c.purpose)
    ? convoyOperation(c) : null;
  return nonConvoyOperation(state, name);
}
function convoyOperation(c: NonNullable<TravelState['activeConvoy']>): {id:string;at:number} | null {
  return c.farmingEngagement ? null : {id:c.id || 'convoy',at:c.epoch || 0};
}
function nonConvoyOperation(state: TravelState, name: string): { id: string; at: number } | null {
  if (state.commands?.[name]?.type === "force-travel") return null;
  return commandOperation(state, name) || localOperation(state, name) || waitingOperation(state, name);
}
function localOperation(state: TravelState, name: string): { id: string; at: number } | null {
  const status = state.statuses?.[name], command = status?.groupedCombat?.travelCommand;
  if (releasedArrivalCommand(state, name, command)) return null;
  if (!command || !ready(status, Date.now()) || command.revision !== travelRevision(state, name)) return null;
  return { id: "command:" + command.id, at: status.groupedCombat!.currentAttackersAt! };
}
function control(state: TravelState, name: string, owner: { id: string } | null): TravelCombat | null {
  let members = controls.get(state);
  if (!members) { members = new Map(); controls.set(state, members); }
  if (!owner) { members.delete(name); return null; }
  const before = members.get(name), revision = state.navigationIntents?.[name]?.revision || 0;
  if (before?.id === owner.id && before.revision === revision) return before;
  const next = { id: owner.id, revision, startedAt: Date.now() };
  members.set(name, next);
  return next;
}
export function travelCombatFor(state: TravelState, name: string): TravelCombat | null {
  if (state.escape && state.escape.stage !== "released" || state.navigationIntents?.[name]?.cancelled) return control(state, name, null);
  const owner = operation(state, name);
  return control(state, name, owner);
}

/** Tombstones stop delayed attack evidence and restored snapshots from reviving abandoned targets. */
export function retireTravelTargets(previous: Group | null, members: Member[], now: number): Group | null {
  if (!previous) return null;
  const commitments=members.flatMap(m=>m.status?.groupedCombat?.travelCommitted||[]);
  const decision = classifyTravelDefense({ groupedCombat: previous, statuses: Object.fromEntries(members.map(m => [m.name, m.status])) }, members.map(m => m.name), now);
  if (decision.waiting.length) return previous;
  const active = new Set([...decision.attackers,...huntAttackers(members,now),...commitments].map(identity));
  const retired = new Map<string, Fight>();
  for (const target of [...previous.fights, ...previous.queue]) if (!active.has(identity(target))) retired.set(identity(target), target);
  if (!retired.size) return previous;
  const keep = (t: Target & { server?: string }) => !retired.has(identity(t));
  return { ...previous, fights: previous.fights.filter(keep), queue: previous.queue.filter(keep),
    evidence: previous.evidence.filter(keep), threats: previous.threats.filter(keep),
    target: null, selection: null, committed: false,
    lostTargets: [...(previous.lostTargets || []), ...[...retired.values()].map(t => ({ ...t, retiredAt: now, reason: "released for travel; no current attacker" }))] };
}

function releasedArrivalCommand(state: TravelState, name: string, command: {id: number; revision: number} | null | undefined): boolean {
  if (state.monsterHunt?.stage !== 'farming' || !command) return false;
  const released = state.monsterHunt.arrivalHandoff?.releasedCommands?.[name];
  return released?.id === command.id && released.revision === command.revision;
}

function travelRevision(state: TravelState, name: string): number { return state.navigationIntents?.[name]?.revision || 0; }
