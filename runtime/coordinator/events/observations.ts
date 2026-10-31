import type { MonsterEntity } from "typed-adventureland";
import type { CombatReference } from "../status/scatter.ts";
import type {
  AnniversaryReturnCycle,
  EventRecovery,
  ReturnLocation,
  ReturnStatus,
  ReturnRoute,
  Waypoints,
} from "./return-types.ts";

export interface EventSession {
  /** Exact native realm at an actual coordinator admission, before the first joined report. */
  authorizedRealm?: string;
  authorizedAt?: number;
  event: string;
  id: string | null;
  lastLiveAt: number;
  checkpoint: ReturnLocation | null;
  waypoints: Waypoints;
  participants: string[];
  participationRecorded?: boolean;
  returnRoutes?: Record<string, ReturnRoute> | null;
  stagingSpawnAt?: number;
  stagingSpawnId?: number;
  wasLive?: boolean;
}

export interface DeferredRecovery {
  event: string;
  cycleId: string;
  checkpoint: ReturnLocation | null;
  navigationRevision?: number;
  deferredAt: number;
  phase: string;
}

interface EventObservationState {
  sessions: Record<string, EventSession>;
  current: EventRecovery | null;
  deferred: Record<string, DeferredRecovery>;
  anniversary: {
    eventCycle?: AnniversaryReturnCycle | null;
    returnReady?: Record<string, unknown>;
    returnDestination?: unknown;
    partyHold?: unknown;
  };
}

interface EventReport extends ReturnStatus {
  /** Native target wire inherits its report context when coordinates omit it.
   * IDs/types may describe newer game entities than the upstream catalog. */
  target?: (CombatReference & Partial<Pick<MonsterEntity, "hp">> &
    {type?: string; map?: string; in?: string | number; server?: string}) | null;
  in?: string | number;
  server?: string;
  name: string;
  x?: number;
  y?: number;
  joinedEvent?: string;
  serverLiveEvents?: { name: string; id?: string | null }[];
}

interface EventObservationPorts {
  now(): number;
  activeNames(): string[];
  merchant(): string | null;
  enabled(name: string, event?: string): boolean;
  checkpoint(): ReturnLocation | null;
  capture(names?: string[]): Waypoints;
  persist(): void;
  log(message: string, level: string): void;
  statuses(): Readonly<Record<string, ReturnStatus | undefined>>;
  goobrawlStillFighting(): boolean;
  begin(event: string, session: EventSession): unknown;
  finishIfReady(): unknown;
  location(recovery: EventRecovery, name: string): ReturnLocation | null;
  intent(name: string): { revision: number; cancelled?: boolean };
  hasCommand(name: string): boolean;
  retireDeferredCommand?(name: string, cycleId: string): void;
  retireDeferredWalk?(name: string, cycleId: string): void;
  finishDeferred?(name: string, cycleId: string, event: string): void;
  command(name: string, command: Record<string, unknown>): void;
  nextCommand(): number;
  releaseAnniversary?(cycle: AnniversaryReturnCycle): unknown;
}

/** Raw server reports own event liveness; derived event hints must never refresh it. */
export function createEventObservations(
  state: EventObservationState,
  ports: EventObservationPorts,
) {
  function sessionSnapshot(previous: EventSession | undefined) {
    return {
      checkpoint: previous?.checkpoint || ports.checkpoint(),
      waypoints: previous?.waypoints || ports.capture(),
    };
  }

  function liveSession(
    report: { name: string; id?: string | null },
    previous?: EventSession,
  ): EventSession {
    return {
      event: report.name,
      id: report.id || previous?.id || null,
      lastLiveAt: ports.now(),
      ...sessionSnapshot(previous),
      participants: previous?.participants || [],
      participationRecorded: previous?.participationRecorded ?? true,
      wasLive: true,
    };
  }

  // Permission records departure before a join/route can fail. Seeing a boss
  // globally does not make every enabled character a participant.
  function participate(name: string, event: string): void {
    const previous = state.sessions[name];
    const session =
      previous?.event === event
        ? previous
        : {
            event,
            id: null,
            lastLiveAt: ports.now(),
            ...sessionSnapshot(undefined),
            participants: [],
          };
    const changed = !session.participants.includes(name);
    if (!session.waypoints[name]) Object.assign(session.waypoints, ports.capture([name]));
    session.participationRecorded = true;
    session.authorizedRealm = ports.statuses()[name]?.server;
    session.authorizedAt = ports.now();
    if (changed) session.participants.push(name);
    state.sessions[name] = session;
    if (changed || previous !== session) ports.persist();
  }
  function reportLive(name: string, report: { name: string; id?: string | null }): void {
    if (!ports.enabled(name, report.name)) return;
    const existing = state.sessions[name];
    const previous = existing?.event === report.name ? existing : undefined;
    state.sessions[name] = liveSession(report, previous);
    if (!previous) ports.persist();
  }

  type StagingReport = NonNullable<EventReport["serverStagingEvents"]>[number];
  function ownsPrejoinStaging(name: string, event: string): boolean {
    const session=state.sessions[name];
    return !!session && session.event===event && !session.wasLive && session.participationRecorded===true &&
      session.participants.includes(name);
  }
  function authorizedPrejoinStaging(body: EventReport, event: string): boolean {
    const status=ports.statuses()[body.name];
    return ownsPrejoinStaging(body.name,event) && !body.rip && !ports.intent(body.name).cancelled &&
      freshDeferredFighter(status) && liveFeedReady(status) && typeof body.server==='string' &&
      body.server.length>0 && body.server===status.server;
  }
  function validStaging(body: EventReport, report: StagingReport): boolean {
    return (body.joinedEvent === report.name || authorizedPrejoinStaging(body,report.name)) && ["mrgreen", "mrpumpkin", "horseman", "graveyard"].includes(report.name) &&
      ports.enabled(body.name, report.name) && Number.isFinite(report.spawnAt) &&
      report.spawnAt >= ports.now() - 120000 && report.spawnAt <= ports.now() + 120000;
  }
  function sameStagingRound(previous: EventSession | undefined, report: StagingReport): boolean {
    if (!previous) return true;
    if (previous.wasLive) return false;
    if (previous.stagingSpawnId === undefined) return true;
    return previous.stagingSpawnId === (report.spawnId ?? report.spawnAt);
  }
  function stagingSession(previous: EventSession | undefined, report: StagingReport): EventSession {
    const prior: EventSession = previous || { event: report.name, id: null,
      lastLiveAt: ports.now(), ...sessionSnapshot(undefined), participants: [], participationRecorded: false };
    return { ...prior, stagingSpawnAt: prior.stagingSpawnAt ?? report.spawnAt,
      stagingSpawnId: prior.stagingSpawnId ?? report.spawnId ?? report.spawnAt };
  }
  function applyStaging(name: string, report: StagingReport): void {
    const existing = state.sessions[name];
    const previous = existing?.event === report.name ? existing : undefined;
    if (!sameStagingRound(previous, report)) return;
    state.sessions[name] = stagingSession(previous, report);
    if (!previous || previous.stagingSpawnAt === undefined) ports.persist();
  }
  function reportStaging(body: EventReport): void {
    if (body.eventFeedConnected === false || body.eventClockStale) return;
    for (const report of body.serverStagingEvents || []) {
      if (!validStaging(body, report)) continue;
      applyStaging(body.name, report);
    }
  }

  function endKiss(cycle: AnniversaryReturnCycle, name: string, id: string): void {
    if (cycle.kissOperations?.[name]?.id === id) delete cycle.kissOperations[name];
    ports.persist();
  }
  function combatDeparturePending(cycle: AnniversaryReturnCycle): boolean {
    return ports.now() <= cycle.endsAt && !!(cycle.combatHandoffAt || cycle.combatPendingEvent);
  }
  function anniversaryPermission(name: string, operation?: { id: string; phase: string }) {
    if (!ports.enabled(name, "anniversary")) return { allowed: false, reason: "anniversary disabled or instance exhausted" };
    const cycle = state.anniversary.eventCycle;
    if (name === ports.merchant()) return { allowed: true };
    if (!cycle) return { allowed: true };
    if (operation?.phase === "end") {
      endKiss(cycle, name, operation.id);
      return { allowed: true };
    }
    if (combatDeparturePending(cycle))
      return { allowed: false, reason: "combat event departure pending" };
    if (operation?.phase === "begin") {
      (cycle.kissOperations ||= {})[name] = { id: operation.id, expiresAt: ports.now() + 180000 };
      ports.persist();
    }
    return { allowed: true };
  }
  function pendingKisses(cycle: AnniversaryReturnCycle): string[] {
    for (const [member, kiss] of Object.entries(cycle.kissOperations || {}))
      if (kiss.expiresAt <= ports.now() || !ports.activeNames().includes(member))
        delete cycle.kissOperations![member];
    return Object.keys(cycle.kissOperations || {});
  }
  function handoffCombat(cycle: AnniversaryReturnCycle, name: string, event: string) {
    if (cycle.combatPendingEvent !== event) {
      cycle.combatPendingEvent = event;
      ports.log("Anniversary waiting interrupted by " + event, "info");
    }
    const kissing = pendingKisses(cycle);
    ports.persist();
    if (kissing.length)
      return { allowed: false, reason: "Finishing anniversary kiss: " + kissing.join(", ") };
    ports.releaseAnniversary?.(cycle);
    cycle.combatEvent = event;
    cycle.combatHandoffAt = ports.now();
    cycle.combatHandoffCharacter = name;
    state.anniversary.returnReady = {};
    state.anniversary.returnDestination = null;
    state.anniversary.partyHold = null;
    ports.log("Anniversary handed off to " + event + "; combat recovery owns the return", "info");
    return { allowed: true };
  }
  function needsCombatHandoff(
    cycle: AnniversaryReturnCycle | null | undefined,
  ): cycle is AnniversaryReturnCycle {
    return !!cycle && !cycle.returnCompletedAt && !cycle.supersededAt && !cycle.combatHandoffAt;
  }
  function authorize(name: string, event: string, operation?: { id: string; phase: string }) {
    if (event === "anniversary") return anniversaryPermission(name, operation);
    if (!ports.enabled(name, event) || ports.intent(name).cancelled)
      return { allowed: false, reason: "event disabled or movement cancelled" };
    const cycle = state.anniversary.eventCycle;
    if (needsCombatHandoff(cycle)) {
      const result = handoffCombat(cycle, name, event);
      if (!result.allowed) return result;
    }
    participate(name, event);
    if (cycle?.combatEvent === event && cycle.waypoints)
      state.sessions[name]!.waypoints = cycle.waypoints;
    transferDeferredParty(name, event);
    ports.persist();
    return { allowed: true };
  }
  function transferDeferredCheckpoint(name: string): void {
    const recovery = state.deferred[name];
    if (!recovery) return;
    ports.retireDeferredWalk?.(name, recovery.cycleId);
    const intent = ports.intent(name), session = state.sessions[name]!;
    if (recovery.checkpoint && recovery.navigationRevision === intent.revision && !intent.cancelled)
      session.waypoints = {...session.waypoints, [name]: {revision:intent.revision, location:{...recovery.checkpoint}}};
    ports.retireDeferredCommand?.(name, recovery.cycleId);
    delete state.deferred[name];
  }
  function transferDeferredParty(name: string, event: string): void {
    const cycleId = state.deferred[name]?.cycleId;
    const followers = cycleId ? ports.activeNames().filter(member =>
      member !== name && canTransferDeferredFighter(member, cycleId, event)) : [];
    // Admission, not a global boss sighting, hands the original return party
    // to combat. Blocked followers cannot independently request permission.
    transferDeferredCheckpoint(name);
    for (const member of followers) {
      participate(member, event);
      transferDeferredCheckpoint(member);
    }
  }
  function canTransferDeferredFighter(name: string, cycleId: string, event: string): boolean {
    const deferred = state.deferred[name], intent = ports.intent(name);
    if (!deferred || deferred.cycleId !== cycleId || name === ports.merchant() ||
        !ports.enabled(name, event) || intent.cancelled || deferred.navigationRevision !== intent.revision) return false;
    return freshDeferredFighter(ports.statuses()[name]);
  }
  function freshDeferredFighter(report: ReturnStatus | undefined): boolean {
    const at = Number(report?.seenAt);
    return !!report && !report.rip && Number.isFinite(at) && ports.now()-at<=3000 && at<=ports.now()+500;
  }

  function reportAnniversaryHandoff(body: EventReport): void {
    const cycle = state.anniversary.eventCycle;
    if (
      !ports.enabled(body.name, body.joinedEvent) ||
      !body.joinedEvent ||
      !cycle ||
      cycle.returnDispatchedAt ||
      cycle.combatHandoffAt ||
      ports.now() > Number(cycle.endsAt || 0) + 60000
    )
      return;
    ports.releaseAnniversary?.(cycle);
    cycle.combatEvent = String(body.joinedEvent);
    cycle.combatHandoffAt = ports.now();
    cycle.combatHandoffCharacter = body.name;
    state.anniversary.returnReady = {};
    state.anniversary.returnDestination = null;
    state.anniversary.partyHold = null;
    ports.log(
      "Anniversary visits handed off to " +
        cycle.combatEvent +
        "; combat-event recovery now owns the party return",
      "info",
    );
    ports.persist();
  }

  function rawLive(event: string): boolean {
    return ports
      .activeNames()
      .some(
        (name) =>
          ports.enabled(name, event) &&
          !(event === "slenderman" && ports.statuses()[name]?.slendermanSearchExhausted) &&
          ports.statuses()[name]?.serverLiveEvents?.some((entry) => entry && entry.name === event),
      );
  }

  function liveFeedReady(report: ReturnStatus | undefined): report is ReturnStatus {
    const at = Number(report?.seenAt);
    return !!report && Number.isFinite(at) && ports.now() - at <= 10000 && at <= ports.now() + 500 &&
      report.eventFeedConnected !== false && !report.eventClockStale;
  }

  function nextLiveEvent(name: string, returningFrom: string): string | null {
    const report = ports.statuses()[name];
    if (!liveFeedReady(report) || ports.intent(name).cancelled) return null;
    return report.serverLiveEvents?.find(entry => entry.name !== returningFrom &&
      ports.enabled(name, entry.name) && rawLive(entry.name) &&
      !(entry.name === 'slenderman' && report.slendermanSearchExhausted))?.name || null;
  }

  function carryCheckpoint(name: string, event: string, previous: EventSession): void {
    const waypoint = previous.waypoints[name];
    const intent = ports.intent(name);
    if (!waypoint || waypoint.revision !== intent.revision || intent.cancelled) return;
    const target = state.sessions[name]?.event === event ? state.sessions[name] : liveSession({name: event});
    target.waypoints[name] = {
      revision: waypoint.revision,
      location: waypoint.location && {...waypoint.location},
    };
    state.sessions[name] = target;
  }

  function releaseLiveMembers(): void {
    const recovery = state.current;
    if (!recovery) return;
    const released = recovery.participants.filter(name => nextLiveEvent(name, recovery.event));
    if (!released.length) return;
    for (const name of released) {
      // Retain the checkpoint until normal event authorization adopts it.
      // Merely observing a live boss must not manufacture participation.
      state.deferred[name] = {
        event: recovery.event,
        cycleId: recovery.cycleId,
        checkpoint: ports.location(recovery, name),
        navigationRevision: ports.intent(name).revision,
        deferredAt: ports.now(),
        phase: 'awaiting-event-handoff',
      };
      ports.retireDeferredWalk?.(name, recovery.cycleId);
      ports.retireDeferredCommand?.(name, recovery.cycleId);
      if (recovery.returnRoutes) delete recovery.returnRoutes[name];
    }
    recovery.participants = recovery.participants.filter(name => !released.includes(name));
    recovery.pending = recovery.pending.filter(name => !released.includes(name));
    if (!recovery.participants.length) {
      recovery.returnRoutes = null;
      recovery.returnDispatchedAt = null;
    }
    ports.persist();
    ports.finishIfReady();
  }

  function ended(name: string, session: EventSession): boolean {
    if (!session || !ports.enabled(name, session.event)) return false;
    const latest = Math.max(
      ...Object.values(state.sessions)
        .filter((entry) => entry?.event === session.event)
        .map((entry) => Number(entry.lastLiveAt) || 0),
    );
    // Persisted staging owns its immutable deadline across restarts/report
    // gaps. A fresh connected feed can explicitly withdraw that announcement.
    const staging = Object.entries(state.sessions).some(([member, entry]) =>
      entry.event === session.event && !entry.wasLive && ports.enabled(member, entry.event) &&
      Number.isFinite(entry.stagingSpawnAt) && ports.now() <= Number(entry.stagingSpawnAt) + 120000 &&
      stagingStillAnnounced(member, entry));
    return (
      !staging &&
      !rawLive(session.event) &&
      !(session.event === "goobrawl" && ports.goobrawlStillFighting()) &&
      ports.now() - latest >= 10000
    );
  }

  function stagingStillAnnounced(member: string, session: EventSession): boolean {
    const report = ports.statuses()[member];
    if (!report || ports.now() - Number(report.seenAt) > 15000 || !liveFeedReady(report) ||
        !Array.isArray(report.serverStagingEvents)) return true;
    return report.serverStagingEvents.some(entry => entry.name === session.event &&
      (entry.spawnId ?? entry.spawnAt) === session.stagingSpawnId);
  }

  function beginEndedReturn(): void {
    const session = Object.entries(state.sessions).find(([name, value]) => ended(name, value))?.[1];
    if (!session || state.current) return;
    const sessions = Object.values(state.sessions).filter(
      (entry) => entry?.event === session.event,
    );
    const participants = [...new Set(sessions.flatMap((entry) => entry.participants))].filter(name => {
      const event = nextLiveEvent(name, session.event);
      if (!event) return true;
      const previous = sessions.find(entry => entry.participants.includes(name))!;
      carryCheckpoint(name, event, previous);
      return false;
    });
    if (participants.length) ports.begin(session.event, { ...session, participants });
    clearEndedSessions(session.event);
    ports.persist();
  }
  function clearEndedSessions(event: string): void {
    const cycle = state.anniversary.eventCycle;
    if (cycle?.combatPendingEvent === event && !cycle.combatHandoffAt)
      delete cycle.combatPendingEvent;
    for (const [name, entry] of Object.entries(state.sessions))
      if (entry?.event === event) delete state.sessions[name];
  }

  function deferStaleMembers(): void {
    const recovery = state.current;
    if (!recovery || ports.now() - Number(recovery.startedAt) < 30000) return;
    const stale = recovery.pending.filter(
      (name) =>
        !ports.statuses()[name] || Number(ports.statuses()[name]?.seenAt) < ports.now() - 10000,
    );
    for (const name of stale) {
      state.deferred[name] = {
        event: recovery.event,
        cycleId: recovery.cycleId,
        checkpoint: ports.location(recovery, name),
        navigationRevision: ports.intent(name).revision,
        deferredAt: ports.now(),
        phase: "awaiting-reconnect",
      };
      recovery.pending = recovery.pending.filter((pendingName) => pendingName !== name);
    }
    if (stale.length) {
      ports.persist();
      ports.finishIfReady();
    }
  }

  function invalidateCheckpoint(recovery: DeferredRecovery, name: string): number {
    const intent = ports.intent(name);
    if (intent.cancelled || Number(recovery.navigationRevision || 0) !== intent.revision)
      recovery.checkpoint = null;
    return intent.revision;
  }

  function awaitingRetiredSameEvent(name: string, recovery: DeferredRecovery): boolean {
    const report=ports.statuses()[name], intent=ports.intent(name);
    if(state.current || intent.cancelled || recovery.navigationRevision!==intent.revision ||
      !freshDeferredFighter(report) || !liveFeedReady(report) || !ports.enabled(name,recovery.event))return false;
    return !!report?.serverLiveEvents?.some(entry=>entry.name===recovery.event &&
      !(entry.name==='slenderman' && report.slendermanSearchExhausted));
  }
  function awaitEventAdmission(recovery: DeferredRecovery): void {
    if(recovery.phase==="awaiting-event-admission")return;
    recovery.phase="awaiting-event-admission";ports.persist();
  }
  function retireOldDeferredContinuation(name: string, cycleId: string): void {
    // Actual authorization adopts the checkpoint and records participation.
    // These hooks reject unrelated commands, walks and renewed navigation.
    ports.retireDeferredWalk?.(name,cycleId);
    ports.retireDeferredCommand?.(name,cycleId);
  }
  function deferredAtTown(report: ReturnStatus | undefined): boolean {
    return !!report && freshDeferredFighter(report) && !report.mapEvent && report.map==='main' &&
      (report.in==null || report.in==='main') && Number.isFinite(report.x) && Number.isFinite(report.y) &&
      Math.hypot(Number(report.x),Number(report.y))<=90;
  }
  function retireEmptyCheckpoint(body: EventReport, recovery: DeferredRecovery): boolean {
    const report=ports.statuses()[body.name];
    if(recovery.phase!=='returning-to-checkpoint' || recovery.checkpoint || body.joinedEvent ||
        !deferredAtTown(report))return false;
    // Hunt policy may remove the old waypoint after its command was issued.
    // That retained command must not keep the retired return owner alive.
    retireOldDeferredContinuation(body.name,recovery.cycleId);
    if(state.deferred[body.name]!==recovery)return true;
    ports.finishDeferred?.(body.name,recovery.cycleId,recovery.event);
    delete state.deferred[body.name];
    ports.persist();return true;
  }
  function skipDeferredResume(body: EventReport, recovery: DeferredRecovery): boolean {
    if(awaitingRetiredSameEvent(body.name,recovery)){
      retireOldDeferredContinuation(body.name,recovery.cycleId);
      awaitEventAdmission(recovery);
      return true;
    }
    return !!nextLiveEvent(body.name,recovery.event) || retireEmptyCheckpoint(body,recovery) || ports.hasCommand(body.name);
  }
  function resumeDeferred(body: EventReport): void {
    const recovery = state.deferred[body.name];
    if (!recovery || skipDeferredResume(body,recovery)) return;
    const atTown = body.map === "main" && Math.hypot(Number(body.x), Number(body.y)) <= 90;
    const revision = invalidateCheckpoint(recovery, body.name);
    if (atTown && !recovery.checkpoint) delete state.deferred[body.name];
    else
      ports.command(
        body.name,
        atTown
          ? {
              id: ports.nextCommand(),
              type: "event-resume-travel",
              cycleId: recovery.cycleId,
              navigationRevision: revision,
              event: recovery.event,
              location: recovery.checkpoint,
              label: "the saved pre-event checkpoint",
            }
          : {
              id: ports.nextCommand(),
              type: "event-return-town",
              cycleId: recovery.cycleId,
              event: recovery.event,
              checkpoint: recovery.checkpoint,
              deferred: true,
            },
      );
    recovery.phase = atTown ? "returning-to-checkpoint" : "returning-to-town";
    ports.persist();
  }

  function nativeHalloweenTarget(body: EventReport): string | undefined {
    const target = body.target;
    if (!target || target.type !== "monster" || !target.id || !(Number(target.hp) > 0)) return;
    if (!localTarget(body)) return;
    return ["mrgreen", "mrpumpkin", "slenderman"].includes(target.mtype || "") ? target.mtype : undefined;
  }

  function localTarget(body: EventReport): boolean {
    const target = body.target!;
    return (target.map === undefined || target.map === body.map) &&
      (target.in === undefined || String(target.in) === String(body.in ?? body.map)) &&
      (target.server === undefined || target.server === body.server);
  }

  function matchingNativeContext(body: EventReport, status: ReturnStatus): boolean {
    return typeof body.map === "string" && body.map === status.map &&
      typeof body.server === "string" && body.server === status.server &&
      String(body.in ?? body.map) === String(status.in ?? status.map);
  }

  function assistedReportReady(body: EventReport): boolean {
    const status = ports.statuses()[body.name];
    return liveFeedReady(status) && !ports.intent(body.name).cancelled && !body.rip &&
      !body.eventClockStale && body.eventFeedConnected !== false && matchingNativeContext(body, status);
  }

  function observedParticipation(body: EventReport, reports: {name: string}[]): string | undefined {
    if (body.joinedEvent || body.mapEvent) return body.joinedEvent || body.mapEvent;
    if (!assistedReportReady(body)) return;
    const event = nativeHalloweenTarget(body);
    // A following fighter can assist a real boss without the join flag. Its
    // actual living target establishes attendance; a global sighting cannot.
    return event && reports.some(report => report.name === event) ? event : undefined;
  }

  function observe(body: EventReport): void {
    retireMerchantTownReturn(body);
    const reports = Array.isArray(body.serverLiveEvents)
      ? body.serverLiveEvents.filter((entry) => entry && typeof entry.name === "string")
      : [];
    if (ports.enabled(body.name)) for (const report of reports)
      if (!(report.name === "slenderman" && body.slendermanSearchExhausted)) reportLive(body.name, report);
    reportStaging(body);
    const participating = observedParticipation(body, reports);
    if (participating && ports.enabled(body.name, participating))
      participate(body.name, participating);
    reportAnniversaryHandoff(body);
    releaseLiveMembers();
    beginEndedReturn();
    deferStaleMembers();
    resumeDeferred(body);
  }

  function retireMerchantTownReturn(body: EventReport): void {
    const name=body.name;
    const report=ports.statuses()[name];
    if(name!==ports.merchant()||!deferredAtTown(report))return;
    const current=state.current,deferred=state.deferred[name];
    if(merchantReturnStillExiting(name))return;
    if(emptyMerchantReturn(current,name))completeMerchantTownReturn(name,current);
    if(deferred?.checkpoint===null)completeMerchantDeferredReturn(name,deferred);
  }
  function merchantReturnStillExiting(name: string): boolean {
    const current=state.current,deferred=state.deferred[name];
    const exiting=ports.statuses()[name]?.eventRecovery;
    return !!(exiting&&[current?.cycleId,deferred?.cycleId].includes(exiting.cycleId)&&
        !['town-ready','deferred-town-ready','idle'].includes(exiting.phase));
  }
  function emptyMerchantReturn(current: EventRecovery | null, name: string): current is EventRecovery {
    return !!(current?.participants.includes(name)&&current.exited?.includes(name)&&!current.pending.includes(name)&&
        current.waypoints?.[name]?.location===null);
  }
  function completeMerchantTownReturn(name: string, current: EventRecovery): void {
      retireOldDeferredContinuation(name,current.cycleId);
      current.participants=current.participants.filter(member=>member!==name);
      if(current.returnRoutes)delete current.returnRoutes[name];
      if(state.sessions[name]?.event===current.event)delete state.sessions[name];
      ports.persist();ports.finishIfReady();
  }
  function completeMerchantDeferredReturn(name: string, deferred: DeferredRecovery): void {
      // This merchant has no farming waypoint to resume. Main arrival completes
      // only its old return; a newer event session/command keeps its ownership.
      retireOldDeferredContinuation(name,deferred.cycleId);
      ports.finishDeferred?.(name,deferred.cycleId,deferred.event);
      if(state.sessions[name]?.event===deferred.event)delete state.sessions[name];
      if(state.deferred[name]===deferred)delete state.deferred[name];
      ports.persist();
  }
  return { observe, authorize };
}
