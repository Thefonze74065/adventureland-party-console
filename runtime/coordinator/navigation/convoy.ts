import type { ReturnLocation } from "../events/return-types.ts";
import type { MerchantCommand } from "../merchant/work.ts";
import { recordConvoyHistory, type ConvoyHistoryState } from "./convoy-history.ts";

interface ConvoyStatus {
  hp?: number;
  rip?: boolean;
  convoyProtocol?: number;
  seenAt: number;
  map: string;
  x: number;
  y: number;
  server?: string;
  speed?: number;
  mainTownSpawn?: { x: number; y: number };
  convoyNavigation?: { runtimeId?: string };
}
export interface PartyConvoy {
  communicationHold?: { since: number; reason: string; participants: string[]; legacy?: boolean };
  communicationResumedAt?: number;
  communicationLegacyRecovered?: boolean;
  returnTown?: import('./return-town.ts').ReturnTownPolicy;
  townRetry?: boolean;
  townRetryAt?: number;
  returnTownRally?: { map: string; x: number; y: number };
  cause?: "farming-conflict";
  huntTarget?: string;
  routeProtocol?: number;
  force?: boolean;
  id: string;
  epoch: number;
  phase: string;
  location: ReturnLocation;
  rally: ReturnLocation;
  label: string;
  leader: string;
  participants: string[];
  slowestSpeed: number;
  paceCharacter: string | null;
  townFirst: boolean;
  completed: string[];
  navigationExempt: boolean;
  combatHandoffAllowed: boolean;
  purpose: string | null;
  departAt?: number | null;
  failure?: string;
  failureCode?: string;
  failedAt?: number;
  restartRecovery?: boolean;
  restartAttempts?: number;
  restartRevisions?: Record<string, number>;
  expected?: Record<
    string,
    { commandId: number; revision: number; phase: string; runtimeId: string | null }
  >;
}
interface ConvoyState extends ConvoyHistoryState {
  leader: string | null;
  merchantCharacter: string | null;
  statuses: Record<string, ConvoyStatus | undefined>;
  followers: Record<string, boolean>;
  commands: Record<string, MerchantCommand | undefined>;
  escape?: { stage: string } | null;
  activeConvoy: PartyConvoy | null;
  navigationEpoch: number;
  location: ReturnLocation | null;
}
interface ConvoyPorts {
  now(): number;
  nextCommand(): number;
  activeNames(): string[];
  intent(name: string): { cancelled?: boolean; revision: number };
  resolve(input: ReturnLocation): ReturnLocation | null;
  persist(): void;
}

function townFirst(leader: ConvoyStatus, location: ReturnLocation): boolean {
  const town = leader.mainTownSpawn || { x: 0, y: 0 };
  const leaderDistance =
    leader.map === location.map
      ? Math.hypot(Number(leader.x) - location.x, Number(leader.y) - location.y)
      : Infinity;
  const townDistance =
    location.map === "main" ? Math.hypot(town.x - location.x, town.y - location.y) : Infinity;
  return location.map === "main" && (leader.map !== "main" || leaderDistance > townDistance + 200);
}

function allowsEarlyCombat(purpose: string | null | undefined, cause?: string): boolean {
  return !cause && ["", "party-travel", "farm-relocation", "manual-monster-override"].includes(purpose || "");
}

export function createPartyConvoys(state: ConvoyState, ports: ConvoyPorts) {
  function workflowPurpose(purpose: string | null | undefined): boolean {
    return ["shared-walk", "shared-walk-return", "franky-exit", "event-return"].includes(purpose || "");
  }
  function memberRole(name: string, explicitWorkflow: boolean, escape: boolean): boolean {
    if (explicitWorkflow) return true;
    return name !== state.merchantCharacter && (escape || name === state.leader || !!state.followers[name]);
  }
  function leaderFor(
    names: string[] | undefined,
    purpose: string | null | undefined,
  ): string | null | undefined {
    if (purpose === "escape-recovery") return (names || [])[0];
    if (purpose?.startsWith("shared-walk")) return names?.[0] || state.leader;
    if (purpose === "franky-exit")
      return (names || []).find(
        (name) => state.statuses[name] && state.statuses[name]?.map !== "main",
      );
    return state.leader;
  }

  function participants(
    leader: ConvoyStatus,
    names: string[] | undefined,
    escape: boolean,
    exit: boolean,
    workflow: boolean,
  ): string[] {
    const requested = Array.isArray(names) ? new Set(names) : null;
    return ports
      .activeNames()
      .filter(
        (name) =>
          memberRole(name, workflow && !!requested?.has(name), escape) &&
          (exit || !ports.intent(name).cancelled) &&
          state.statuses[name]?.server === leader.server &&
          (!requested || requested.has(name)),
      );
  }

  function cancel(reason = "cancelled by owner"): void {
    const convoy = state.activeConvoy;
    if (!convoy) return;
    recordConvoyHistory(state, convoy, "cancelled", ports.now(), { reason });
    for (const name of convoy.participants || []) {
      const command = state.commands[name];
      if (command?.type === "party-monster-travel" && command.convoyId === convoy.id)
        delete state.commands[name];
    }
    state.activeConvoy = null;
  }

  function pace(names: string[]) {
    const speed = names.reduce((lowest, name) => {
      const current = Number(state.statuses[name]?.speed);
      return current > 0 ? Math.min(lowest, current) : lowest;
    }, Infinity);
    const character =
      [...names].sort(
        (a, b) =>
          (Number(state.statuses[a]?.speed) || Infinity) -
          (Number(state.statuses[b]?.speed) || Infinity),
      )[0] || state.leader;
    return { slowestSpeed: Number.isFinite(speed) ? speed : 0, paceCharacter: character };
  }

  function issue(convoy: PartyConvoy): void {
    for (const name of convoy.participants) {
      const id = ports.nextCommand(),
        revision = ports.intent(name).revision;
      state.commands[name] = {
        id,
        type: "party-monster-travel",
        phase: "assemble",
        routeProtocol: 4,
        deferRendezvous: true,
        navigationRevision: revision,
        convoyId: convoy.id,
        epoch: convoy.epoch,
        location: convoy.location,
        label: convoy.label,
        leader: convoy.leader,
        participants: convoy.participants,
        slowestSpeed: convoy.slowestSpeed,
        purpose: convoy.purpose,
        navigationExempt: convoy.navigationExempt,
        combatHandoffAllowed: convoy.combatHandoffAllowed,
        cause: convoy.cause,
        paceCharacter: convoy.paceCharacter,
        rally: convoy.rally,
      };
      (convoy.expected ||= {})[name] = {
        commandId: id,
        revision,
        phase: "assemble",
        runtimeId: state.statuses[name]?.convoyNavigation?.runtimeId || null,
      };
    }
  }

  function assemble(
    location: ReturnLocation,
    label: string | undefined,
    leaderName: string,
    names: string[],
    exit: boolean,
    purpose: string | null | undefined,
    cause?: "farming-conflict",
  ): void {
    const replacedConvoyId = state.activeConvoy?.id;
    cancel("replaced by a new convoy");
    const epoch = ++state.navigationEpoch,
      id = "convoy-" + ports.now() + "-" + ports.nextCommand();
    const speed = pace(names),
      leader = state.statuses[leaderName]!;
    const convoy = (state.activeConvoy = {
      routeProtocol: 4,
      cause,
      force: purpose === "party-force-travel",
      id,
      epoch,
      phase: "assemble",
      location,
      rally: { map: leader.map, x: Number(leader.x), y: Number(leader.y) },
      label: label || "selected monster",
      leader: leaderName,
      participants: names,
      ...speed,
      townFirst: purpose?.startsWith("shared-walk") ? false : townFirst(leader, location),
      completed: [],
      navigationExempt: exit,
      combatHandoffAllowed: allowsEarlyCombat(purpose, cause),
      purpose: purpose || null,
    });
    issue(convoy);
    recordConvoyHistory(state, convoy, "started", ports.now(), { replacedConvoyId, origin: convoy.rally });
    if (!exit && !["rare-hunt", "phoenix-patrol", "grouped-approach", "shared-walk"].includes(purpose || ""))
      state.location = location;
    ports.persist();
  }

  function start(
    input: ReturnLocation,
    label?: string,
    names?: string[],
    purpose?: string | null,
    cause?: "farming-conflict",
  ): boolean {
    if (state.escape && state.escape.stage !== "released" && purpose !== "escape-recovery")
      return false;
    const escape = purpose === "escape-recovery",
      exit = purpose === "franky-exit" || purpose === "shared-walk-return" || escape;
    const leaderName = leaderFor(names, purpose),
      leader = leaderName ? state.statuses[leaderName] : undefined;
    if (!leader || leader.seenAt < ports.now() - 10000) return false;
    const location = resolveLocation(input, purpose);
    const workflow = workflowPurpose(purpose);
    const selected = participants(leader, names, escape, exit, workflow);
    if (!selected.includes(leaderName!)) return false;
    assemble(location, label, leaderName!, selected, exit, purpose, cause);
    return true;
  }
  function resolveLocation(input: ReturnLocation, purpose: string | null | undefined): ReturnLocation {
    const direct = ["phoenix-patrol", "rare-hunt", "grouped-approach", "party-travel", "party-force-travel", "shared-walk", "shared-walk-return"].includes(purpose || "");
    return { ...(direct ? {} : ports.resolve(input)), map: input.map, x: Number(input.x), y: Number(input.y) };
  }
  return { start, cancel };
}
