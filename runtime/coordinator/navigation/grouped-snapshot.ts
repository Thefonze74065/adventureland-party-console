import { caveCombat } from "../dungeons/combat.ts";
import type { DungeonState, CaveObservation } from "../../dungeons/contracts.ts";
import {authorizeSuccessor, type HandoffPolicy} from '../../combat/successor-grant.ts';
import {owner as huntOwner} from '../../hunt/policy.ts';
import type { Group, Member } from "../../combat/grouped.ts";
import type { StoredCombatLogEntry } from "../telemetry/combat-log.ts";
import { retireTravelTargets, travelCombatFor, type TravelState } from "./travel-defense.ts";
import { phoenixCandidates } from './phoenix-candidates.ts';
import {updateHuntTravel, interruptibleTravel, type HuntTravelConvoy} from '../../combat/hunt-travel.ts';
import {passingIdentity} from '../../combat/passing.ts';
interface GroupedState {
  dailyDungeons?: DungeonState;
  passiveHunting?: import('../../combat/passive-travel.ts').PassiveTravelSettings;
  phoenixPatrolActive?: boolean;
  farmingPolicy?: string;
  monsterHunt?: import("../../hunt/policy.ts").Hunt & {target:string|null} | null;
  anniversary?: {eventCycle?: {returnCompletedAt?:number;supersededAt?:number;combatHandoffAt?:number} | null};
  combatEventHandoff?: { startedAt: number; endedAt?: number } | null;
  eventReturn?: unknown;
  leader: string | null;
  statuses: Record<string, Member["status"] & { ctype?: string; dungeon?: CaveObservation }>;
  groupedCombat?: Group | null;
  groupedCombatResetAt?: number;
  partyFarmingMode: string;
  activeConvoy?: HuntTravelConvoy & { phase: string } | null;
  headlessSlots: (string | null)[];
  steamMembers: string[];
  followers: Record<string, unknown>;
  merchantCharacter: string | null;
  combatLogs: Record<string, StoredCombatLogEntry[]>;
}
interface GroupedPorts {
  patrolAcquisitionAllowed?: () => boolean;
  now: () => number;
  tickDisengagement: () => void;
  disengagementActive: () => boolean;
  intent: (name: string) => { revision: number; cancelled?: boolean };
  owned: (name: string) => { type?: string } | undefined;
  prepare: (members: Member[]) => Member[];
  evaluate: (
    previous: Group | null,
    members: Member[],
    leader: string,
    now: number,
    resetAt: number,
    paused: boolean,
    huntTarget?: string | null,
  ) => Group;
  finalize: (group: Group) => Group;
  blocksPulls: () => boolean;
}

function farmingHuntTarget(state: GroupedState): string | null {
  return state.farmingPolicy === "hunt" && state.monsterHunt?.stage === "farming" ? state.monsterHunt.target : null;
}

function participantNames(state: GroupedState, leader: string): string[] {
  const assigned = new Set([...state.headlessSlots, ...state.steamMembers].filter(Boolean));
  return [
    ...new Set([
      leader,
      ...Object.keys(state.followers).filter((name) => state.followers[name] && assigned.has(name)),
    ]),
  ]
    .filter((name) => name !== state.merchantCharacter)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function changed(previous: Group | null, group: Group): boolean {
  return (
    !previous ||
    previous.phase !== group.phase ||
    previous.selection !== group.selection ||
    previous.blockers.join(";") !== group.blockers.join(";") ||
    JSON.stringify(previous.recovering) !== JSON.stringify(group.recovering)
  );
}

function logFormation(state: GroupedState, leader: string, group: Group, now: () => number): void {
  const entries = state.combatLogs[leader] || (state.combatLogs[leader] = []);
  entries.push({
    at: now(),
    type: "formation",
    message: "Group " + group.phase,
    details: {
      target: group.target?.id || null,
      blockers: group.blockers,
      priest: group.priest,
      targetLeader: group.targetLeader,
      participating: group.participating,
      recovering: group.recovering,
    },
  });
  if (entries.length > 200) entries.splice(0, entries.length - 200);
}

function scatterWithoutDefense(state: GroupedState, ports: GroupedPorts): boolean {
  return (
    state.partyFarmingMode === "scatter" &&
    !ports.disengagementActive() &&
    state.activeConvoy?.phase !== "defending"
  );
}

function inEvent(status: Member["status"]): boolean {
  return !!(status?.activeEvent || status?.joinedEvent || status?.mapEvent);
}

/** Events retain the prior group; cancelled navigation and ordinary scatter clear it. */
export function coordinatorGroupedSnapshot(state: GroupedState, ports: GroupedPorts): Group | null {
  if (state.dailyDungeons && state.dailyDungeons.phase !== "idle") {
    state.groupedCombat = caveCombat(state, ports.now());
    return state.groupedCombat;
  }
  ports.tickDisengagement();
  const leader = state.leader,
    lead = state.statuses[String(leader)];
  if (leader && ports.intent(leader).cancelled) {
    state.groupedCombat = null;
    state.groupedCombatResetAt = ports.now();
    return null;
  }
  if (inEvent(lead)) return null;
  if (!leader || scatterWithoutDefense(state, ports)) {
    state.groupedCombat = null;
    return null;
  }
  return evaluateParticipants(state, ports, leader);
}

function evaluateParticipants(
  state: GroupedState,
  ports: GroupedPorts,
  leader: string,
): Group | null {
  const names = participantNames(state, leader);
  if (!names.length) {
    state.groupedCombat = null;
    return null;
  }
  let members = names.map((name) => ({
    name,
    ctype: (ports.owned(name)?.type || state.statuses[name]?.ctype)!,
    revision: ports.intent(name).revision,
    cancelled: ports.intent(name).cancelled,
    status: state.statuses[name],
  }));
  members = patrolMembers(state,ports,members) as typeof members;
  members = huntDefenseMembers(state,members,ports.now()) as typeof members;
  members = withoutEscaped(members) as typeof members;
  retireEventTargets(state, members, ports.now());
  const travelling = names.some(name => travelCombatFor(state as TravelState, name));
  // Apply travel restrictions here, before death-recovery preparation. A saved
  // Hunt stage alone cannot override the rare encounter that took ownership.
  const previous = travelPrevious(state, members, leader, travelling, ports.now());
  const group = ports.finalize(
    ports.evaluate(
      previous,
      ports.prepare(travelling ? defensiveMembers(members, ports.now(), !!state.activeConvoy?.huntArrival) : members),
      leader,
      ports.now(),
      state.groupedCombatResetAt || 0,
      travelling || ports.blocksPulls() || ports.disengagementActive(),
      travelling ? null : farmingHuntTarget(state),
    ),
  );
  authorizeSuccessor(state,group,members,successorPolicy(state,ports,leader,travelling),ports.now());
  state.groupedCombat = group;
  if (changed(previous, group)) logFormation(state, leader, group, ports.now);
  logUnseenRelease(state, leader, previous, group);
  return group;
}
function successorPolicy(state:GroupedState,ports:GroupedPorts,leader:string,travelling:boolean):HandoffPolicy {
  const activeHunt=state.farmingPolicy==='hunt' ? state.monsterHunt : null;
  const allowed=successorActivityClear(state,travelling) && !ports.blocksPulls() && !ports.disengagementActive() &&
    (state.farmingPolicy!=='hunt' || activeHunt?.stage==='farming');
  if(!activeHunt)return {allowed};
  const owner=huntOwner(activeHunt,leader);
  return {allowed,hunt:successorQuest(owner,state.statuses[owner],ports.now())};
}
function successorQuest(owner:string,status:Member['status'],now:number):NonNullable<HandoffPolicy['hunt']> {
  const quest=status?.monsterHunt;
  return {owner,quest:quest?.id||'',count:quest?.count||0,fresh:successorQuestFresh(status,now)};
}
function successorQuestFresh(status:Member['status'],now:number):boolean {
  return !!status?.monsterHunt && status.monsterHunt.remainingMs>0 && now-status.seenAt<=3000 && status.seenAt<=now+500;
}
function successorActivityClear(state:GroupedState,travelling:boolean):boolean {
  const cycle=state.anniversary?.eventCycle;
  return !travelling && !state.activeConvoy && !state.eventReturn &&
    !(cycle && !cycle.returnCompletedAt && !cycle.supersededAt && !cycle.combatHandoffAt);
}
/**
 * A member on its way that is faster than its attacker walks on (reported as
 * `escaping`). No member's report may make that monster the party's fight, or the
 * caught member stops to fight it alone. The ordinary attacker reports stay intact
 * in the stored statuses for the other features that read them.
 */
function withoutEscaped(members: Member[]): Member[] {
  const escaped = members.flatMap(m => m.status?.groupedCombat?.escaping || []);
  if (!escaped.length) return members;
  const kept = <T extends { id?: string | number; map?: string }>(list: T[] | undefined) =>
    list?.filter(t => !escaped.some(e => String(e.id) === String(t.id) && (!t.map || e.map === t.map)));
  return members.map(m => {
    const g = m.status?.groupedCombat;
    if (!m.status || !g) return m;
    return { ...m, status: { ...m.status, groupedCombat: { ...g,
      threats: kept(g.threats), currentAttackers: kept(g.currentAttackers), candidates: kept(g.candidates),
      claims: kept(g.claims), sightings: kept(g.sightings), evidence: kept(g.evidence), travelCandidates: kept(g.travelCandidates) } } };
  });
}
function huntDefenseMembers(state: GroupedState, members: Member[], now: number): Member[] {
  const c=state.activeConvoy;
  if(!c || !interruptibleTravel(c) || members.some(m=>m.cancelled))return members;
  const control=updateHuntTravel(c,members,now,undefined,state.passiveHunting);
  const targets=control?.committed||[];
  return members.map(m=> {
    const s=m.status,g=s?.groupedCombat;
    if(!s || !g)return m;
    const seen=(g.sightings||[]).filter(t=>targets.some(primary=>passingIdentity({...t,server:s.server})===passingIdentity(primary)));
    return {...m,status:{...s,groupedCombat:{...g,huntDefense:!!control?.defending,travelCommitted:targets,threats:seen}}};
  });
}
function travelPrevious(state: GroupedState, members: Member[], leader: string, travelling: boolean, now: number): Group | null {
  if (!travelling || state.activeConvoy?.huntArrival) return state.groupedCombat || null;
  const restored = state.groupedCombat || members.map(m => m.status?.groupedCombat?.state).find(g => g?.leader === leader) || null;
  const previous = retireTravelTargets(restored, members, now);
  if (previous !== restored && previous) logTravelRetirement(state, leader, restored, previous, now);
  return previous;
}

function logUnseenRelease(state: GroupedState, leader: string, previous: Group | null, group: Group): void {
  const released = (group.lostTargets || []).filter(t =>
    t.reason === "unseen primary released after bounded search; visible alternative available" &&
    !(previous?.lostTargets || []).some(old => old.id === t.id && old.retiredAt === t.retiredAt));
  for (const target of released) (state.combatLogs[leader] ||= []).push({
    at:group.seenAt, type:"formation", message:"Unseen primary released; advancing combat queue",
    details:{target:target.id, mtype:target.mtype, next:group.target?.id, reason:target.reason},
  });
}
function patrolMembers(state: GroupedState, ports: GroupedPorts, members: Member[]): Member[] {
  return state.phoenixPatrolActive && ports.patrolAcquisitionAllowed?.()
    ? phoenixCandidates(members,ports.now()) : members;
}

function defensiveThreats(group: NonNullable<NonNullable<Member['status']>['groupedCombat']>) {
  return group.travelCommitted?.length || group.huntDefense ? [...(group.currentAttackers || []), ...(group.threats || [])] : group.currentAttackers || [];
}
function defensiveMembers(members: Member[], now: number, preserve = false): Member[] {
  return members.map(m => {
    const group = m.status?.groupedCombat;
    if (!m.status || !group) return m;
    const attackers = defensiveThreats(group);
    const active = new Set(attackers.map(t => t.id));
    return { ...m, status: { ...m.status, groupedCombat: { ...group, candidates: [], retentionPaused: true,
      threats: attackers, evidence: preserve ? group.evidence : group.evidence?.filter(e => active.has(e.id)),
      state: preserve ? group.state : group.state ? retireTravelTargets(group.state, members, now) : null } } };
  });
}
function logTravelRetirement(state: GroupedState, leader: string, before: Group | null, after: Group, at: number): void {
  const added = (after.lostTargets || []).slice(before?.lostTargets?.length || 0);
  if (!added.length) return;
  const entries = state.combatLogs[leader] ||= [];
  entries.push({ at, type: "formation", message: "Released passive targets for travel", details: { targets: added.map(t => t.id) } });
  if (entries.length > 200) entries.splice(0, entries.length - 200);
}

function staleEventMember(member: Member, endedAt: number, now: number): boolean {
  return (
    !member.status ||
    member.status.seenAt < endedAt ||
    now - member.status.seenAt > 3000 ||
    inEvent(member.status)
  );
}

function priorEventGroup(state: GroupedState, members: Member[]): Group | null | undefined {
  return (
    state.groupedCombat ||
    members.map((m) => m.status?.groupedCombat?.state).find((g) => g?.leader === state.leader)
  );
}

/** Only the completed event boundary may release an unseen unfinished target. */
function retireEventTargets(state: GroupedState, members: Member[], now: number): void {
  const handoff = state.combatEventHandoff;
  if (
    !handoff?.endedAt ||
    state.eventReturn ||
    members.some((m) => staleEventMember(m, handoff.endedAt!, now))
  )
    return;
  const previous = priorEventGroup(state, members);
  state.combatEventHandoff = null;
  if (!previous) return;
  const identity = (t: { id: string; map: string; in?: string | number; server?: string }) =>
    JSON.stringify([t.server, t.map, t.in, t.id]);
  const observed = new Set(
    members.flatMap((m) =>
      [
        ...(m.status?.groupedCombat?.sightings || []),
        ...(m.status?.groupedCombat?.threats || []),
      ].map((t) => identity({ ...t, server: m.status!.server })),
    ),
  );
  const stale = new Set(
    (previous.queue || [])
      .filter((t) => t.startedAt < handoff.startedAt && !observed.has(identity(t)))
      .map(identity),
  );
  if (!stale.size) return;
  const keep = (t: { id: string; map: string; in?: string | number; server?: string }) =>
    !stale.has(identity(t));
  state.groupedCombatResetAt = now;
  state.groupedCombat = {
    ...previous,
    resetAt: now,
    fights: previous.fights.filter(keep),
    queue: previous.queue.filter(keep),
    evidence: previous.evidence.filter(keep),
    threats: previous.threats.filter(keep),
    target: null,
    selection: null,
    committed: false,
  };
  const entries = (state.combatLogs[String(state.leader)] ||= []);
  entries.push({
    at: now,
    type: "formation",
    message: "Event return retired unseen pre-event targets",
    details: { targets: [...stale] },
  });
  if (entries.length > 200) entries.splice(0, entries.length - 200);
}
