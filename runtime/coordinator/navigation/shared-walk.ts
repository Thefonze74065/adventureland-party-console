import { characterRuntime, distance, type RoutePoint, type SharedConvoy, type SharedState, type SharedStatus } from "./shared-route-types.ts";
import { readRoutePoint } from "./shared-route-store.ts";

interface WalkRequest {
  name: string; token: string; runtimeId: string; revision: number; at: number;
  activity: string; key: string; destination: RoutePoint; parentId: number;
  parent?: SharedState["commands"][string]; complete?: boolean; failed?: string; convoyId?: string;
}
interface WalkSession { requests: WalkRequest[]; convoy: SharedConvoy }
const sessions = new WeakMap<SharedConvoy, WalkSession>();
export function completeSharedWalkMember(convoy: unknown, name: string): SharedState["commands"][string] {
  const session = sessions.get(convoy as SharedConvoy), request = session?.requests.find(r => r.name === name);
  if (!request) return (convoy as SharedConvoy).walkingParents?.[name]?.command;
  request.complete = true;
  return request.parent;
}
interface WalkPorts {
  now(): number; members(): string[]; owned(name: string): unknown;
  enabled(name: string, event?: string): boolean;
  allowed(activity: string): boolean;
  start(destination: RoutePoint, label: string, names: string[], purpose: string): boolean;
  persist(): void;
  cancel(): void;
}
interface WalkState extends SharedState {
  phoenixPatrolActive?: boolean;
  rareHuntState?: {encounter?: unknown} | null;
  anniversary?: { eventCycle?: {
    participants?: string[]; combatHandoffAt?: number;
    returnCompletedAt?: number; supersededAt?: number;
  } | null };
  leader: string | null; merchantCharacter: string | null;
  eventReturn?: {
    event?: string;
    cycleId?: string;
    participants: string[];
    pending?: string[];
    returnRoutes?: Record<string, { commandId?: number; revision: number }> | null;
  } | null;
}
function parse(body: Record<string, unknown>, now: number): WalkRequest | null {
  const p = readRoutePoint(body.destination);
  if (!p) return null;
  if (!["event", "anniversary-staging", "town-return", "event-return", "farm-recovery"].includes(String(body.activity))) return null;
  if (typeof body.token !== "string" || body.token.length > 300 || typeof body.key !== "string" || body.key.length > 200) return null;
  return { name: String(body.character), token: body.token, runtimeId: String(body.runtimeId),
    revision: Number(body.navigationRevision), activity: String(body.activity), key: body.key, at: now,
    parentId: Number(body.parentCommandId) || 0, destination: p };
}
function sameWalk(a: WalkRequest, b: WalkRequest): boolean {
  return a.activity === b.activity && a.key === b.key &&
    String(a.destination.in ?? a.destination.map) === String(b.destination.in ?? b.destination.map) &&
    distance(a.destination, b.destination) <= 1;
}
/** Coalesces independently entered workflow walking legs without duplicating their continuations. */
export function createSharedWalks(input: unknown, ports: WalkPorts) {
  const state = input as WalkState, requests = new Map<string, WalkRequest>();
  function merchantWalk(r: WalkRequest): boolean {
    return r.name === state.merchantCharacter &&
      (["event", "event-return"].includes(r.activity) || recoveryContinuation(r));
  }
  function validIntent(r: WalkRequest): boolean {
    if (!ports.members().includes(r.name) && !merchantWalk(r)) return false;
    const intent = state.navigationIntents?.[r.name];
    if ((intent?.revision || 0) !== r.revision) return false;
    return !intent?.cancelled || ["town-return", "event-return"].includes(r.activity);
  }
  function authorized(r: WalkRequest): boolean {
    const s = state.statuses[r.name];
    if (!managedWalker(r) || !s || s.seenAt < ports.now() - 3000) return false;
    if (s.convoyProtocol !== 4 || !validIntent(r) || !ports.allowed(r.activity)) return false;
    if (!workflowCurrent(r)) return false;
    return r.activity !== "event" || ports.enabled(r.name, r.key);
  }
  function managedWalker(r: WalkRequest): boolean {
    return !!ports.owned(r.name) && (r.name !== state.merchantCharacter || merchantWalk(r));
  }
  function workflowCurrent(r: WalkRequest): boolean {
    if (rareOwnsRecovery(r)) return false;
    const recoveryOwns = ["farm-recovery", "event", "anniversary-staging"].includes(r.activity) &&
      !!state.eventReturn?.participants.includes(r.name);
    return runtimeMatches(r) && !stagingHandedOff(r) && (!recoveryOwns || recoveryContinuation(r));
  }
  function rareOwnsRecovery(r: WalkRequest): boolean {
    return r.activity === 'farm-recovery' && !recoveryContinuation(r) &&
      !!(state.phoenixPatrolActive || state.rareHuntState?.encounter);
  }
  function stagingHandedOff(r: WalkRequest): boolean {
    const cycle = state.anniversary?.eventCycle;
    if (r.activity !== "anniversary-staging" || !cycle) return false;
    return !!cycle.combatHandoffAt && !cycle.returnCompletedAt && !cycle.supersededAt &&
      !!cycle.participants?.includes(r.name);
  }
  function recoveryContinuation(r: WalkRequest): boolean {
    const route = state.eventReturn?.returnRoutes?.[r.name];
    return r.activity === "farm-recovery" && r.parentId > 0 &&
      route?.commandId === r.parentId && route.revision === r.revision;
  }
  function runtimeMatches(r: WalkRequest): boolean {
    const runtime = characterRuntime(state.statuses[r.name]);
    return !runtime || runtime === r.runtimeId;
  }
  function eligible(r: WalkRequest): string[] {
    const server = state.statuses[r.name]?.server;
    const names = workflowMembers(r);
    return names.filter(name => {
      const s = state.statuses[name];
      if (!s || s.rip || s.seenAt < ports.now() - 3000 || s.server !== server) return false;
      return r.activity !== "event" || ports.enabled(name, r.key);
    });
  }
  function workflowMembers(r: WalkRequest): string[] {
    if (merchantWalk(r)) return [r.name];
    const names = ports.members(), recovery = state.eventReturn;
    // Town-ready members already supplied the native receipt and no longer
    // run an exit command. They cannot join this remaining walking rendezvous.
    if (r.activity === "event-return" && recovery?.cycleId === r.key && recovery.pending)
      return names.filter(name => recovery.pending!.includes(name));
    return names.filter(name => !alreadyFighting(r, name));
  }
  function alreadyFighting(r: WalkRequest, name: string): boolean {
    if (r.activity !== "event" || name === r.name) return false;
    const s = state.statuses[name];
    if (!s) return false;
    const boss = s.eventCombatSighting;
    if (!boss || !boss.id || s.joinedEvent !== r.key || boss.mtype !== r.key) return false;
    return freshAttendee(r, s) && freshBoss(boss) && bossAtDestination(r, s, boss);
  }
  function freshAttendee(r: WalkRequest, s: NonNullable<SharedState["statuses"][string]>): boolean {
    const now = ports.now(), server = state.statuses[r.name]?.server;
    return !!server && s.server === server && Number.isFinite(s.seenAt) &&
      s.seenAt >= now - 3000 && s.seenAt <= now + 1000 && !s.rip;
  }
  function freshBoss(boss: NonNullable<SharedState["statuses"][string]>["eventCombatSighting"]): boolean {
    if (!boss || !readRoutePoint(boss) || !Number.isFinite(boss.observedAt)) return false;
    const now = ports.now();
    return boss.observedAt >= now - 3000 && boss.observedAt <= now + 1000;
  }
  function bossAtDestination(r: WalkRequest, s: NonNullable<SharedState["statuses"][string]>,
    boss: NonNullable<typeof s.eventCombatSighting>): boolean {
    return boss.map === s.map && boss.map === r.destination.map &&
      String(boss.in) === String(s.in ?? s.map) &&
      String(boss.in) === String(r.destination.in ?? r.destination.map) &&
      distance(boss, r.destination) <= 100;
  }
  function pending(r: WalkRequest): WalkRequest[] {
    return [...requests.values()].filter(other => !other.complete && !other.failed && !other.convoyId &&
      sameWalk(r, other) && authorized(other) && ports.now() - other.at < 10000);
  }
  function anchor(r: WalkRequest, waiting: WalkRequest[], name: string): void {
    if (!name || waiting.some(other => other.name === name) || state.commands[name]) return;
    const leader = state.statuses[name];
    if (!leader || leader.moving || !atDestination(leader, r.destination)) return;
    waiting.push({ ...r, name, parentId: 0, token: "anchor:" + r.token, revision: state.navigationIntents?.[name]?.revision || 0 });
  }
  function captureParents(waiting: WalkRequest[]): boolean {
    for (const other of waiting) {
      const command = state.commands[other.name];
      if (command && command.id !== other.parentId) return false;
      other.parent = command;
    }
    return true;
  }
  function failedEntry(c: SharedConvoy): boolean {
    return c.phase === "failed" && (c.retryExhausted || c.walkingActivity === "event" || c.label === "event walking leg") === true;
  }
  function canReplace(r: WalkRequest): boolean {
    const c = state.activeConvoy;
    if (!c) return true;
    if (failedEntry(c)) return false;
    if (c.restartRecovery && c.walkingParents && !c.retryExhausted) return ports.allowed(r.activity);
    return r.activity === "event" && !sessions.has(c) && !c.navigationExempt && !c.nonPreemptible && ports.allowed(r.activity);
  }
  function replaceActive(): void { if (state.activeConvoy) ports.cancel(); }
  function leaderForRequest(r: WalkRequest): string | undefined {
    const names = eligible(r);
    return state.leader && names.includes(state.leader) ? state.leader : names[0];
  }
  function restoreParents(waiting: WalkRequest[]): boolean {
    const c = state.activeConvoy;
    if (!c?.restartRecovery || !c.walkingParents) return true;
    if (waiting.some(r => c.walkingParents![r.name]?.revision !== r.revision || c.walkingParents![r.name]?.parentId !== r.parentId)) return false;
    if (waiting.some(r => state.commands[r.name] && state.commands[r.name]!.convoyId !== c.id)) return false;
    const parents = c.walkingParents;
    ports.cancel();
    for (const r of waiting) if (parents[r.name]?.command) state.commands[r.name] = parents[r.name]!.command;
    return true;
  }
  function retainParents(c: SharedConvoy, waiting: WalkRequest[]): void {
    c.walkingParents = Object.fromEntries(waiting.map(r => [r.name, { revision: r.revision, parentId: r.parentId, command: r.parent }]));
  }
  function tryStart(r: WalkRequest): void {
    const leaderName = leaderForRequest(r);
    if (!canReplace(r) || !leaderName) return;
    const waiting = pending(r), expected = eligible(r);
    anchor(r, waiting, leaderName);
    if (!waiting.some(other => other.name === leaderName)) return;
    // A member already at the destination need not be pulled away from it.
    if (expected.some(name => !waiting.some(other => other.name === name) && distance(state.statuses[name]!, r.destination) > 55)) return;
    const names = [leaderName, ...waiting.map(other => other.name).filter(name => name !== leaderName)];
    if (!restoreParents(waiting)) return;
    replaceActive();
    if (!captureParents(waiting)) return;
    const returning = ["town-return", "event-return"].includes(r.activity);
    if (!ports.start(r.destination, r.activity + " walking leg", names, returning ? "shared-walk-return" : "shared-walk")) return;
    attach(waiting, returning);
  }
  function attach(waiting: WalkRequest[], returning: boolean): void {
    const convoy = state.activeConvoy as SharedConvoy | null;
    if (!convoy) return;
    convoy.walkingActivity = waiting[0]?.activity;
    if (convoy.walkingActivity === "event") convoy.walkingEvent = waiting[0]?.key;
    // Staging shares the moving-defense return policy with Hunt turn-in.
    convoy.navigationExempt = returning;
    if (convoy.walkingActivity === "anniversary-staging" || halloweenExit(convoy, waiting)) convoy.continuousReturn = 1;
    convoy.combatHandoffAllowed = false;
    for (const name of convoy.participants) state.commands[name]!.navigationExempt = convoy.navigationExempt;
    waiting.forEach(other => { other.convoyId = convoy.id; });
    retainParents(convoy, waiting);
    sessions.set(convoy, { requests: waiting, convoy });
    ports.persist();
  }
  function halloweenExit(convoy: SharedConvoy, waiting: WalkRequest[]): boolean {
    const recovery = state.eventReturn;
    return convoy.walkingActivity === "event-return" && !!recovery &&
      ["slenderman", "mrgreen", "mrpumpkin"].includes(recovery.event || "") &&
      waiting.some(r => r.key === recovery.cycleId);
  }
  function existing(r: WalkRequest): Record<string, unknown> | null {
    const prior = requests.get(r.name);
    if (!prior || prior.token !== r.token) return null;
    if (!sameWalk(prior, r) || prior.parentId !== r.parentId) return { error: "walking request changed" };
    if (prior.revision !== r.revision || prior.runtimeId !== r.runtimeId) return { error: "walking owner changed" };
    return progress(prior);
  }
  function progress(prior: WalkRequest): Record<string, unknown> {
    if (prior.failed) return { ok: true, phase: "failed", reason: prior.failed };
    if (prior.complete) return { ok: true, phase: "complete" };
    const c = state.activeConvoy, session = c && sessions.get(c);
    prior.at = ports.now();
    if (session?.requests.includes(prior)) return { ok: true, phase: walkingPhase(c!), reason: c!.failure, convoyId: c!.id };
    if (prior.convoyId) return { error: "walking leg superseded" };
    if (parentSuperseded(prior)) return { error: "walking leg superseded" };
    tryStart(prior);
    return { ok: true, phase: "waiting" };
  }
  function parentSuperseded(prior: WalkRequest): boolean {
    return !!prior.parent && state.commands[prior.name]?.id !== prior.parent.id;
  }
  function cancel(r: WalkRequest): Record<string, unknown> {
    const prior = requests.get(r.name), c = state.activeConvoy, session = c && sessions.get(c);
    if (prior?.token === r.token && session?.requests.includes(prior)) {
      if (returnRetryPending(c!) || c!.geometryRepair?.phase === 'waiting') return {ok:true,phase:"waiting"};
      session.requests.forEach(entry => { entry.failed = "Walking workflow cancelled"; });
      if (c!.phase !== "failed") ports.cancel();
      ports.persist();
    }
    return { ok: true, phase: "failed" };
  }
  function retainedFailure(r: WalkRequest): Record<string, unknown> | null {
    const failed = state.activeConvoy;
    if (r.activity !== "event" || !failed || !failedEntry(failed)) return null;
    if (failed.walkingParents?.[r.name]?.revision !== r.revision) return null;
    return { ok: true, phase: "failed", reason: failed.failure || "Event walking retries exhausted" };
  }
  function retirePreDeathWalk(r: WalkRequest): void {
    const c = state.activeConvoy, s = state.statuses[r.name];
    if (!c || !s || !preDeathEventFailure(c, r)) return;
    if (!eventReentryOwner(c, r, s) || !deathInvalidatedPreparation(c, r, s)) return;
    if (!c.participants.every(name => participantOwned(c, name))) return;
    cancelObsoleteWalk(c);
  }
  function preDeathEventFailure(c: SharedConvoy, r: WalkRequest): boolean {
    return r.activity === 'event' && c.phase === 'failed' && c.walkingActivity === 'event' &&
      !c.retryExhausted && c.participants.includes(r.name) && walkingEventMatches(c, r);
  }
  function walkingEventMatches(c: SharedConvoy, r: WalkRequest): boolean {
    return c.walkingEvent === r.key || !!sessions.get(c)?.requests.some(entry => entry.name === r.name && entry.key === r.key);
  }
  function eventReentryOwner(c: SharedConvoy, r: WalkRequest, s: SharedStatus): boolean {
    const parent = c.walkingParents?.[r.name];
    if (!parent) return false;
    return parent.revision === r.revision && parent.parentId === r.parentId &&
      c.runtimes?.[r.name] === r.runtimeId && characterRuntime(s) === r.runtimeId && s.server === c.routeServer;
  }
  function deathInvalidatedPreparation(c: SharedConvoy, r: WalkRequest, s: SharedStatus): boolean {
    const death = s.lastDeath, preparedAt = c.sharedPreparationStartedAt ?? c.sharedStartedAt;
    if (!death || typeof preparedAt !== 'number' || !Number.isFinite(preparedAt)) return false;
    return Number.isFinite(death.at) && death.at > preparedAt && revivedReport(s, death.at) && deathBindsEvent(death, r, s);
  }
  function revivedReport(s: SharedStatus, deathAt: number): boolean {
    return !s.rip && Number(s.hp) > 0 && s.seenAt > deathAt &&
      s.seenAt >= ports.now() - 3000 && s.seenAt <= ports.now() + 1000;
  }
  function deathBindsEvent(death: NonNullable<SharedStatus['lastDeath']>, r: WalkRequest, s: SharedStatus): boolean {
    return death.eventTrip?.event === r.key && s.joinedEvent === r.key && ports.enabled(r.name, r.key);
  }
  function participantOwned(c: SharedConvoy, name: string): boolean {
    const owner = c.walkingParents?.[name], command = state.commands[name];
    if (!owner || owner.revision !== (state.navigationIntents?.[name]?.revision || 0)) return false;
    return !command || command.convoyId === c.id && command.navigationRevision === owner.revision;
  }
  function cancelObsoleteWalk(c: SharedConvoy): void {
    // Only the pre-death owner's release commands and in-memory session retire.
    for (const name of c.participants) {
      const command = state.commands[name];
      if (command?.convoyId === c.id && command.phase === 'event-walk-release') delete state.commands[name];
    }
    for (const [name, request] of requests) if (request.convoyId === c.id) requests.delete(name);
    sessions.delete(c);
    ports.cancel();
    ports.persist();
  }
  function retainedReturn(r:WalkRequest):Record<string,unknown> | null {
    const c=state.activeConvoy;
    if(!c?.continuousReturn || c.walkingActivity!==r.activity || c.walkingParents?.[r.name]?.revision!==r.revision)return null;
    return {ok:true,phase:'travelling',convoyId:c.id,reason:c.failure};
  }
  function submit(body: Record<string, unknown>): Record<string, unknown> {
    const r = parse(body, ports.now());
    if (!r || !authorized(r)) return { error: "unauthorized walking leg" };
    if (body.cancel === true) return cancel(r);
    retirePreDeathWalk(r);
    const failure = retainedFailure(r);
    if (failure) return failure;
    const retained = retainedReturn(r);
    if(retained)return retained;
    const previous = existing(r);
    if (previous) return previous;
    requests.set(r.name, r);
    tryStart(r);
    return { ok: true, phase: "waiting" };
  }
  return { submit };
}
function returnRetryPending(c: SharedConvoy): boolean {
  return c.purpose === "shared-walk-return" && c.phase === "failed" && c.failureCode === "runtime-lost" && !c.retryExhausted;
}
function atDestination(point: RoutePoint, destination: RoutePoint): boolean {
  return point.map === destination.map && Math.hypot(point.x-destination.x,point.y-destination.y)<=100;
}

function walkingPhase(c:SharedConvoy):string {
  if(c.continuousReturn)return 'travelling';
  if(returnRetryPending(c))return 'waiting';
  return c.phase==='failed'?'failed':'travelling';
}
