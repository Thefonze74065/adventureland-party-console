import type {
  AnniversaryReturnCycle,
  EventRecovery,
  ReturnLocation,
  ReturnStatus,
  ReturnRoute,
  Waypoints,
} from "./return-types.ts";

export interface EventSession {
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
  name: string;
  x?: number;
  y?: number;
  joinedEvent?: string;
  serverLiveEvents?: { name: string; id?: string }[];
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
    report: { name: string; id?: string },
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
    if (changed) session.participants.push(name);
    state.sessions[name] = session;
    if (changed || previous !== session) ports.persist();
  }
  function reportLive(name: string, report: { name: string; id?: string }): void {
    if (!ports.enabled(name, report.name)) return;
    const existing = state.sessions[name];
    const previous = existing?.event === report.name ? existing : undefined;
    state.sessions[name] = liveSession(report, previous);
    if (!previous) ports.persist();
  }

  type StagingReport = NonNullable<EventReport["serverStagingEvents"]>[number];
  function validStaging(body: EventReport, report: StagingReport): boolean {
    return body.joinedEvent === report.name && ["mrgreen", "mrpumpkin"].includes(report.name) &&
      ports.enabled(body.name, report.name) && Number.isFinite(report.spawnAt) &&
      report.spawnAt >= ports.now() - 120000 && report.spawnAt <= ports.now() + 60000;
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
    ports.persist();
    return { allowed: true };
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

  function ended(name: string, session: EventSession): boolean {
    if (!session || !ports.enabled(name, session.event)) return false;
    const latest = Math.max(
      ...Object.values(state.sessions)
        .filter((entry) => entry?.event === session.event)
        .map((entry) => Number(entry.lastLiveAt) || 0),
    );
    // Persisted staging owns its immutable deadline across coordinator restarts
    // and temporary report gaps. A stale report must not retire it early.
    const staging = Object.entries(state.sessions).some(([member, entry]) =>
      entry.event === session.event && !entry.wasLive && ports.enabled(member, entry.event) &&
      Number.isFinite(entry.stagingSpawnAt) && ports.now() <= Number(entry.stagingSpawnAt) + 120000);
    return (
      !staging &&
      !rawLive(session.event) &&
      !(session.event === "goobrawl" && ports.goobrawlStillFighting()) &&
      ports.now() - latest >= 10000
    );
  }

  function beginEndedReturn(): void {
    const session = Object.entries(state.sessions).find(([name, value]) => ended(name, value))?.[1];
    if (!session || state.current) return;
    const sessions = Object.values(state.sessions).filter(
      (entry) => entry?.event === session.event,
    );
    const participants = [...new Set(sessions.flatMap((entry) => entry.participants))];
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

  function resumeDeferred(body: EventReport): void {
    const recovery = state.deferred[body.name];
    if (!recovery || ports.hasCommand(body.name)) return;
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

  function observe(body: EventReport): void {
    const reports = Array.isArray(body.serverLiveEvents)
      ? body.serverLiveEvents.filter((entry) => entry && typeof entry.name === "string")
      : [];
    if (ports.enabled(body.name)) for (const report of reports)
      if (!(report.name === "slenderman" && body.slendermanSearchExhausted)) reportLive(body.name, report);
    reportStaging(body);
    const participating = body.joinedEvent || body.mapEvent;
    if (participating && ports.enabled(body.name, participating))
      participate(body.name, participating);
    reportAnniversaryHandoff(body);
    beginEndedReturn();
    deferStaleMembers();
    resumeDeferred(body);
  }
  return { observe, authorize };
}
