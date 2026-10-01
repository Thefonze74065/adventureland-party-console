import type { HuntCycle, HuntStatus } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import type { HuntEventTrips } from "../events/hunt-trip.ts";

export interface HuntModeState extends HuntEventTrips {
  eventReturn?: import("../events/return-types.ts").EventRecovery | null;
  farmingPolicy: string;
  monsterHunt: HuntCycle | null;
  leader: string | null;
  monsterHunterLocation: ReturnLocation | null;
  statuses: Record<string, HuntStatus | undefined>;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[] | undefined>;
  escape?: { stage: string } | null;
  huntBlacklist?: import('./settings.ts').HuntFailureState['huntBlacklist'];
  huntFailures?: import('./settings.ts').HuntFailureState['huntFailures'];
  farmAreaState?: { pending?: unknown; failures?: Record<string, unknown>; paused?: boolean; message?: string | null } | null;
  combatRecovery?: unknown;
  combatHuntBoundary?: unknown;
}
export interface HuntModePorts {
  fighting?(): boolean;
  participants(): string[];
  cancelled(name: string): boolean;
  release(): void;
  authorize(names: string[], location: ReturnLocation | null | undefined, shared: boolean): void;
  monsterDestination(id: string | undefined): ReturnLocation | null | undefined;
  clear(): void;
  selectedDestination(name: string | null): { location: ReturnLocation } | null;
  convoy(location: ReturnLocation, label: string, names: string[]): unknown;
  returnToDaisy(hunt: HuntCycle): void;
  begin(policy: string, location: ReturnLocation | null, preserve: boolean): void;
}

/** Explicit mode changes discard Hunt execution state; live quest observations remain authoritative. */
export function createHuntMode(state: HuntModeState, ports: HuntModePorts) {
  function reset(): void {
    ports.clear();
    state.monsterHunt = null;
    // Exclusions and failure counts are durable preferences. Only the explicit
    // blacklist clear action resets them; restarting Hunt resets execution.
    state.combatRecovery = null;
    state.combatHuntBoundary = null;
    if (state.farmAreaState) {
      state.farmAreaState.pending = null;
      state.farmAreaState.failures = {};
      state.farmAreaState.paused = false;
      state.farmAreaState.message = null;
    }
  }
  function exit(): void {
      // Event permission owns departure before the next heartbeat reports the
      // new map. Turning Hunt off must not replace that entry/combat with a
      // backup convoy; event recovery will select the current normal policy.
      const eventOwnsDeparture = ports.participants().some(name => {
        const trip = state.huntEventTrips?.[name]?.at(-1);
        return !!trip && !trip.endedAt;
      });
      ports.release();
      reset();
      if (eventOwnsDeparture) return;
      const destination = ports.selectedDestination(state.leader);
      if (destination)
        ports.convoy(
          destination.location,
          "the leader's configured farming focus",
          ports.participants(),
        );
  }
  function authorize(location: ReturnLocation | null): void {
    const names = ports.participants();
    const quest = names
      .map((name) => state.statuses[name]?.monsterHunt)
      .find((quest) => !!quest && quest.count > 0);
    ports.release();
    ports.authorize(
      names,
      location || state.monsterHunterLocation || ports.monsterDestination(quest?.id),
      true,
    );
  }
  function resumeRequested(): boolean {
    return (
      ports.participants().some((name) => ports.cancelled(name)) ||
      (!!state.escape && state.escape.stage !== "released")
    );
  }
  function setBackup(backupFocus: string[] | undefined): void {
    if (!backupFocus) return;
    state.monsterFocus = [...new Set(backupFocus)];
    for (const name of ports.participants()) delete state.monsterFocusByCharacter[name];
  }
  function restartRequested(mode: string, previous: string, backupSupplied: boolean): boolean {
    return (
      mode === "hunt" &&
      (backupSupplied || previous !== "hunt" || resumeRequested() || !state.monsterHunt)
    );
  }
  function normalPolicy(previous: string): string {
    return previous === "hunt" ? state.monsterHunt?.returnPolicy || "auto" : previous;
  }
  function postExitLocation(mode: string, location: ReturnLocation | null): ReturnLocation | null | undefined {
    return mode === "hunt" ? undefined : ports.selectedDestination(state.leader)?.location || location;
  }
  function deferToExit(mode: string, policy: string, location: ReturnLocation | null, restart: boolean, previous: string): boolean {
    const recovery = state.eventReturn;
    if (!recovery) return false;
    if (mode === "hunt" && restart && resumeRequested()) authorize(null);
    state.farmingPolicy = mode;
    if (previous === 'hunt' || restart) reset();
    recovery.postExitLocation = postExitLocation(mode, location);
    if (mode === "hunt" && restart) ports.begin(policy, location, false);
    return true;
  }
  function select(
    mode: string,
    location: ReturnLocation | null,
    backupFocus: string[] | undefined,
    backupSupplied: boolean,
  ): void {
    const previous = state.farmingPolicy,
      policy = normalPolicy(previous);
    if (mode === "hunt") setBackup(backupFocus);
    const restart = restartRequested(mode, previous, backupSupplied);
    if (deferToExit(mode, policy, location, restart, previous)) return;
    if (restart && !ports.fighting?.()) authorize(location);
    state.farmingPolicy = mode;
    if (previous === "hunt" && mode !== "hunt") exit();
    else if (restart) { reset(); ports.begin(policy, location, false); }
  }
  return { select };
}
