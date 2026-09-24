import {passiveStopRequired, type PassiveTravelSettings} from '../../combat/passive-travel.ts';
import {collectPassing, passingIdentity, type PassingEncounter} from '../../combat/passing.ts';
import type { Fight, Group, Member, Target } from "../../combat/grouped.ts";
import {outboundHunt, huntDefense, updateHuntTravel, type HuntTravelConvoy} from '../../combat/hunt-travel.ts';

export interface CurrentAttacker extends Target { target: string; server?: string }
interface Observation {
  activeEvent?: string | null; joinedEvent?: string | null;
  seenAt?: number; map?: string; in?: string | number; server?: string; hp?: number; rip?: boolean;
  groupedCombat?: { returnDefense?: boolean; passingEncounters?: PassingEncounter[]; currentAttackersAt?: number; currentAttackers?: CurrentAttacker[]; travelCommand?: { id: number; revision: number } | null };
}
export interface DefenseState { passiveHunting?: PassiveTravelSettings; statuses: Record<string, unknown>; groupedCombat?: unknown; activeConvoy?: HuntTravelConvoy & { returnTown?: { walking: boolean } } | null }
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
function ready(status: Observation | undefined, now: number): status is Observation {
  return !!status && !status.rip && status.hp !== 0 && fresh(status.seenAt, now) &&
    fresh(status.groupedCombat?.currentAttackersAt, now) && Array.isArray(status.groupedCombat?.currentAttackers);
}
function current(t: CurrentAttacker, status: Observation, names: string[]): boolean {
  return names.includes(t.target) && t.map === status.map &&
    String(t.in ?? t.map) === String(status.in ?? status.map) &&
    (!t.server || t.server === status.server) && t.hp !== 0;
}
function confirmedDeaths(party: DefenseState): Set<string> {
  const deaths = (party.groupedCombat as { deaths?: (Target & { server?: string })[] } | null)?.deaths || [];
  return new Set(deaths.map(identity));
}
function passingForDefense(party: DefenseState, names: string[], now: number) {
  return new Set(collectPassing(names.map(name=>({name,ctype:"",revision:0,status:party.statuses[name] as Member["status"]})),
    (party.groupedCombat as Group | undefined)?.passingEncounters || [], now).map(passingIdentity));
}
function includeAttacker(party:DefenseState,passing:Set<string>,attacker:CurrentAttacker,departure?:boolean):boolean {
  const c=party.activeConvoy;
  return passiveStopRequired(party.passiveHunting,attacker.mtype) || outboundHunt(c) || !!departure || !!(c?.continuousReturn && !c.returnTown?.walking) || !passing.has(passingIdentity(attacker));
}
/** Travel consults live targeting, never retained engagements or recent outgoing hits. */
export function classifyTravelDefense(party: DefenseState, names: string[], now = Date.now()): DefenseResult {
  const waiting: string[] = [], found = new Map<string, CurrentAttacker>();
  const dead = confirmedDeaths(party);
  const passing = passingForDefense(party,names,now);
  for (const name of names) {
    const status = party.statuses[name] as Observation | undefined;
    if (!ready(status, now)) { waiting.push(name); continue; }
    for (const t of status.groupedCombat!.currentAttackers!) {
      if (current(t, status, names)) {
        const attacker = { ...t, server: status.server };
        if (includeAttacker(party,passing,attacker,status.groupedCombat!.returnDefense) && !dead.has(identity(attacker))) found.set(identity(attacker), attacker);
      }
    }
  }
  const attackers = [...found.values()];
  const defend = huntNeedsDefense(party,names,attackers,now);
  if (defend) return { state: "defending", attackers, waiting,
    message: "Defending " + [...new Set(attackers.map(t => t.target))].join(", ") +
      " from " + attackers.map(t => (t.mtype || "monster") + " " + t.id).join(", ") };
  if (waiting.length) return { state: "waiting-for-observations", attackers, waiting,
    message: "Waiting for fresh travel observations from " + waiting.join(", ") };
  return { state: "clear", attackers, waiting, message: "" };
}

function huntNeedsDefense(party: DefenseState, names: string[], attackers: CurrentAttacker[], now: number): boolean {
  const c=party.activeConvoy;
  if(!c)return attackers.length>0;
  const control=updateHuntTravel(c,names.map(name=>({name,ctype:'',revision:0,status:party.statuses[name] as Member['status']})),now,undefined,party.passiveHunting);
  if(!control)return attackers.length>0;
  if(control.reason==='passive-setting' && !huntDefense(c))return true;
  if(huntDefense(c)) {
    const group=party.groupedCombat as Group | undefined;
    return [attackers.length,control.primary,group?.fights?.length].some(Boolean);
  }
  const encounters=new Set(attackers.map(identity));
  if(control.primary)encounters.add(identity(control.primary));
  return encounters.size>1;
}

export interface TravelState {
  statuses?: Record<string, Observation | undefined>;
  activeConvoy?: { id?: string; epoch?: number; participants: string[]; purpose?: string | null; force?: boolean; phase?: string; farmingEngagement?: unknown } | null;
  commands?: Record<string, { id?: number; type?: string; navigationRevision?: number } | undefined>;
  navigationIntents?: Record<string, { revision?: number; cancelled?: boolean } | undefined>;
  monsterHunt?: { cycleId?: string; stage?: string; currentIndex?: number; startedAt?: number; participants: string[]; exitMode?: string | null } | null;
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
function operation(state: TravelState, name: string): { id: string; at: number } | null {
  const c = state.activeConvoy;
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
  if (!command || !ready(status, Date.now()) || command.revision !== (state.navigationIntents?.[name]?.revision || 0)) return null;
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
  if(members.some(m=>m.status && now-m.status.seenAt<=3000 && m.status.groupedCombat?.huntDefense))return previous;
  const decision = classifyTravelDefense({ groupedCombat: previous, statuses: Object.fromEntries(members.map(m => [m.name, m.status])) }, members.map(m => m.name), now);
  if (decision.waiting.length) return previous;
  const active = new Set(decision.attackers.map(identity));
  const retired = new Map<string, Fight>();
  for (const target of [...previous.fights, ...previous.queue]) if (!active.has(identity(target))) retired.set(identity(target), target);
  if (!retired.size) return previous;
  const keep = (t: Target & { server?: string }) => !retired.has(identity(t));
  return { ...previous, fights: previous.fights.filter(keep), queue: previous.queue.filter(keep),
    evidence: previous.evidence.filter(keep), threats: previous.threats.filter(keep),
    target: null, selection: null, committed: false,
    lostTargets: [...(previous.lostTargets || []), ...[...retired.values()].map(t => ({ ...t, retiredAt: now, reason: "released for travel; no current attacker" }))] };
}
