import {
  anniversaryHolding,
  goobrawlStillFighting,
  lostCombatHandoff,
  newAnniversaryRound,
  recoveryConvoy,
  returnedFromDeferred,
} from "./return-guards.ts";
import { ownsWorkflowWalk } from "./walk-ownership.ts";
import { applyReturnPolicy } from "./return-policy.ts";
import { repairReturnWalk } from "./repair-return-walk.ts";
import type {
  AnniversaryReturnCycle,
  EventRecovery,
  EventReturnPorts,
  EventReturnState,
  ReturnConvoy,
  Waypoints,
} from "./return-types.ts";

function obsoleteRecoveryWalk(convoy: ReturnConvoy): boolean {
  return convoy.purpose === "shared-walk" &&
    (["farm-recovery", "anniversary-staging"].includes(convoy.walkingActivity || "") ||
      (convoy.walkingActivity === "event" && convoy.phase === "failed"));
}

export function createEventReturns(state: EventReturnState, ports: EventReturnPorts) {
  // Event exit owns movement before its first walking request. In particular,
  // Restored farming walks and failed event entry must not block the exit.
  function releaseObsoleteWalk(recovery: EventRecovery): void {
    const convoy = ports.convoy();
    if (!convoy || recovery.returnDispatchedAt || convoy.nonPreemptible ||
        !obsoleteRecoveryWalk(convoy)) return;
    const current = ports.capture(convoy.participants);
    if (!ownsWorkflowWalk(convoy, recovery, current)) return;
    ports.cancelConvoy();
    ports.persist();
  }
  function clearRecoveryCommands(recovery: EventRecovery): void {
    for (const [name, command] of Object.entries(ports.commands())) {
      if (
        command?.cycleId === recovery.cycleId &&
        ["event-return-town", "event-resume-travel"].includes(command.type)
      )
        ports.clearCommand(name);
    }
  }
  function cancelPrematureGoobrawlReturn(): boolean {
    const recovery = state.current;
    if (!recovery || recovery.event !== "goobrawl" || !goobrawlStillFighting(ports)) return false;
    if (recoveryConvoy(recovery, ports.convoy())) ports.cancelConvoy();
    clearRecoveryCommands(recovery);
    for (const [name, deferred] of Object.entries(state.deferred))
      if (deferred.cycleId === recovery.cycleId) delete state.deferred[name];
    state.current = null;
    ports.persist();
    return true;
  }

  function recentReturn(event: string): boolean {
    if (state.last?.event !== event || ports.now() - state.last.finishedAt >= 60_000) return false;
    return !ports
      .activeNames()
      .some((name) => ports.enabled(name) && ports.statuses()[name]?.mapEvent === event);
  }

  function exitParticipants(recovery: EventRecovery): string[] {
    return recovery.pending.filter(
      (name) =>
        !(recovery.exited || []).includes(name) &&
        ports.activeNames().includes(name) &&
        !!ports.statuses()[name] &&
        ports.statuses()[name]?.map !== "main",
    );
  }

  function startFrankyExitConvoy(recovery: EventRecovery): boolean {
    if (recovery.event !== "franky" || recovery.exitSuspended) return false;
    const existing = ports.convoy();
    if (existing) {
      if (existing.id !== recovery.exitConvoyId || existing.phase !== "failed") return false;
      ports.cancelConvoy();
    }
    const participants = exitParticipants(recovery);
    if (!participants.length || !ports.startExit(participants)) return false;
    recovery.exitConvoyId = ports.convoy()?.id;
    ports.persist();
    return true;
  }

  function issueInitialTown(name: string, recovery: EventRecovery): void {
    if (!ports.activeNames().includes(name)) return;
    const convoy = ports.convoy();
    if (convoy?.id === recovery.exitConvoyId && convoy?.participants.includes(name)) return;
    ports.town(name, recovery);
  }

  function participantsFor(
    event: string,
    captured: string[] | undefined,
    forced: boolean,
  ): string[] {
    const names = Array.isArray(captured) && captured.length ? captured : ports.activeNames();
    return names.filter(
      (name) => forced || ports.enabled(name, event),
    );
  }

  function newRecovery(
    event: string,
    participants: string[],
    waypoints: Waypoints | undefined,
  ): EventRecovery {
    return {
      phase: "evacuating",
      cycleId: "event-return-" + ports.now() + "-" + ports.nextCommandId(),
      event,
      participants: participants.slice(),
      pending: participants.slice(),
      startedAt: ports.now(),
      checkpoint: ports.checkpoint(),
      waypoints: waypoints || ports.capture(participants),
      deferred: [],
    };
  }

  function waitingForCombat(event: string, forced: boolean): boolean {
    return !forced && event === "goobrawl" && goobrawlStillFighting(ports);
  }

  function begin(
    event: string,
    session?: { participants?: string[]; waypoints?: Waypoints } | null,
    forced = false,
  ): EventRecovery | null {
    if (waitingForCombat(event, forced)) return null;
    if (state.current) return state.current;
    if (recentReturn(event)) return null;
    const participants = participantsFor(event, session?.participants, forced);
    if (!participants.length) return null;
    const recovery = newRecovery(event, participants, session?.waypoints);
    state.current = recovery;
    releaseObsoleteWalk(recovery);
    if (event === "abtesting") ports.clearABStrategy();
    startFrankyExitConvoy(recovery);
    for (const name of participants) issueInitialTown(name, recovery);
    ports.persist();
    return recovery;
  }

  function complete(recovery: EventRecovery): void {
    state.last = { event: recovery.event, finishedAt: ports.now() };
    const cycle = ports.anniversary();
    if (cycle && (cycle.combatEvent === recovery.event || recovery.anniversaryRound === cycle.id))
      ports.finish(cycle, "combat-event recovery complete");
    if (state.current === recovery) state.current = null;
  }

  function returnWaiting(recovery: EventRecovery): boolean {
    return !!ports.huntHandoffPending?.() || !!recovery.pending.length || !!recovery.returnDispatchedAt;
  }
  function finishIfReady(): boolean {
    const recovery = state.current;
    if (recovery) applyReturnPolicy(recovery, ports);
    if (finishHuntReturn()) return true;
    if (!recovery || returnWaiting(recovery)) return false;
    if (anniversaryHolding(ports.anniversary(), ports) || ports.convoy() || ports.townBusy())
      return false;
    const names = recovery.participants.filter(
      (name) => !state.deferred[name] && ports.activeNames().includes(name),
    );
    recovery.phase = "checkpoint";
    if (!ports.dispatch(recovery, names)) return false;
    if (recovery.returnCompletedAt) complete(recovery);
    ports.persist();
    return true;
  }

  function finishHuntReturn(): boolean {
    const recovery = state.current;
    if (!recovery || !ports.handoffToHunt?.(recovery)) return false;
    complete(recovery);
    ports.persist();
    return true;
  }

  function suspendForAnniversary(recovery: EventRecovery, cycle: AnniversaryReturnCycle): void {
    recovery.anniversaryRound = cycle.id;
    if (recoveryConvoy(recovery, ports.convoy())) ports.cancelConvoy();
    recovery.exitSuspended = true;
    recovery.convoyId = null;
    recovery.returnDispatchedAt = null;
    recovery.returnRoutes = null;
    recovery.pending = recovery.participants.filter((name) => ports.activeNames().includes(name));
    for (const name of recovery.pending) {
      delete state.deferred[name];
      ports.town(name, recovery);
    }
    ports.persist();
  }

  function reconcileDeferred(name: string, recovery: EventRecovery): void {
    if (!state.deferred[name] || !returnedFromDeferred(name, recovery, ports)) return;
    delete state.deferred[name];
    recovery.pending = recovery.pending.filter((pending) => pending !== name);
    const convoy = ports.convoy();
    if (convoy && convoy.id === recovery.convoyId && !convoy.participants.includes(name)) {
      ports.cancelConvoy();
      recovery.convoyId = null;
    }
    ports.persist();
  }

  function joinedReturn(name: string, recovery: EventRecovery, current: Waypoints): boolean {
    const waypoint = recovery.waypoints?.[name];
    if (!waypoint?.location) return false;
    return !state.deferred[name] && !recovery.returnRoutes?.[name] &&
      current[name]?.revision === waypoint.revision && returnedFromDeferred(name, recovery, ports);
  }

  function refreshReturnParticipants(recovery: EventRecovery): void {
    if (!recovery.returnDispatchedAt || recovery.returnCompletedAt) return;
    const current = ports.capture(ports.activeNames());
    if (!recovery.participants.some(name => joinedReturn(name, recovery, current))) return;
    const convoy = ports.convoy();
    if (convoy && !recoveryConvoy(recovery, convoy)) return;
    if (convoy) ports.cancelConvoy();
    recovery.convoyId = null;
    recovery.returnDispatchedAt = null;
    recovery.returnRoutes = null;
    ports.persist();
  }

  function reconcile(): void {
    if (cancelPrematureGoobrawlReturn()) return;
    const cycle = ports.anniversary();
    if (!state.current && lostCombatHandoff(cycle, ports))
      begin(cycle.combatEvent, { waypoints: cycle.waypoints, participants: cycle.participants });
    const recovery = state.current;
    if (!recovery) return;
    applyReturnPolicy(recovery, ports);
    if (finishHuntReturn()) return;
    repairReturnWalk(recovery, ports);
    if (!recovery.participants.length) { complete(recovery); ports.persist(); return; }
    releaseObsoleteWalk(recovery);
    if (newAnniversaryRound(cycle, recovery, ports)) suspendForAnniversary(recovery, cycle);
    for (const name of recovery.participants) reconcileDeferred(name, recovery);
    refreshReturnParticipants(recovery);
    startFrankyExitConvoy(recovery);
    restoreCommands(recovery);
    advanceReturn(recovery);
  }

  function advanceReturn(recovery: EventRecovery): void {
    if (ports.huntHandoffPending?.()) return;
    if (recovery.returnDispatchedAt) {
      if (ports.reconcile(recovery)) complete(recovery);
      ports.persist();
    } else finishIfReady();
  }

  function restoreCommands(recovery: EventRecovery): void {
    for (const name of recovery.pending) {
      if (!ports.activeNames().includes(name)) continue;
      if (!ports.commands()[name] || consumedIdleExit(name, recovery)) ports.town(name, recovery);
    }
  }

  function consumedIdleExit(name: string, recovery: EventRecovery): boolean {
    const command = ports.commands()[name], status = ports.statuses()[name];
    if (command?.type !== "event-return-town" || command.cycleId !== recovery.cycleId) return false;
    if (!idleExitConsumed(status, command.id)) return false;
    if (!savedExitRevision(name, recovery)) return false;
    const convoy = ports.convoy();
    return !convoy?.participants.includes(name) || ["complete", "failed"].includes(convoy.phase);
  }

  function savedExitRevision(name: string, recovery: EventRecovery): boolean {
    const saved = recovery.waypoints?.[name];
    return !!saved && ports.capture([name])[name]?.revision === saved.revision;
  }

  function idleExitConsumed(status: ReturnType<EventReturnPorts["statuses"]>[string], commandId: number | undefined): boolean {
    if (!status || status.rip || status.eventRecovery?.phase !== "idle") return false;
    const seen = Number(status.seenAt), last = Number(status.lastCommandId);
    return Number.isFinite(seen) && seen >= ports.now() - 3000 && seen <= ports.now() + 1000 &&
      Number.isFinite(commandId) && Number.isFinite(last) && last >= Number(commandId);
  }

  return {
    begin,
    complete,
    finishIfReady,
    reconcile,
    startFrankyExitConvoy,
    cancelPrematureGoobrawlReturn,
    goobrawlStillFighting: () => goobrawlStillFighting(ports),
  };
}
