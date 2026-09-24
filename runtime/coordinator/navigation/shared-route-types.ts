import type { ConvoyHistoryState } from "./convoy-history.ts";
import type { PartyConvoy } from "./convoy.ts";
import type { CompletionReceipts } from './completion-receipts.ts';

export interface RoutePoint { map: string; x: number; y: number; in?: string | number }
export interface RouteWaypoint extends RoutePoint { town?: boolean; transport?: boolean; s?: number; method?: string; key?: string }
export interface SharedRoute {
  engine?: string;
  geometry: { version: number; fingerprint: string };
  version: number;
  origin: RoutePoint;
  destination: RoutePoint;
  plot: RouteWaypoint[];
  source: "search" | "remainder" | "itinerary";
}
export interface SharedReport {
  communication?: { operation: string; kind: string; since: number } | null;
  transitionMap?: string;
  townAttempt?: import('./return-town.ts').ReturnTownAttempt;
  id: string; epoch: number; commandId: number; navigationRevision: number;
  runtimeId: string; phase: string; routeReady?: boolean; routeVersion?: number;
  failure?: string; waypointCount?: number; departedAt?: number;
}
export interface SharedStatus extends RoutePoint {
  movementGeometry?: { version: number; fingerprint: string };
  huntReturnProtocol?: number;
  movement?: {progress?:unknown};
  seenAt: number; server?: string; region?: string; rip?: boolean; hp?: number;
  combatSelection?: { runtimeId?: string };
  moving?: boolean; speed?: number; convoyProtocol?: number; convoyNavigation?: SharedReport;
}
export interface SharedCommand {
  returnWalking?: boolean;
  continuousReturn?: number;
  disableTown?: boolean;
  avoidLeave?: boolean;
  nativeFallback?: boolean;
  cause?: "farming-conflict";
  huntTarget?: string;
  id: number; type: string; phase: string; convoyId: string; epoch: number;
  navigationRevision: number; routeProtocol: number; routeVersion: number;
  location: RoutePoint; rally: RoutePoint; leader: string; participants: string[];
  slowestSpeed: number; purpose: string | null; navigationExempt: boolean;
  combatHandoffAllowed: boolean; returnLeg: boolean; nonPreemptible: boolean;
  reason?: string;
  force?: boolean;
  deferRendezvous?: boolean;
}
export interface SharedConvoy extends PartyConvoy {
  failureDetails?: unknown;
  geometryRepair?: { id: string; startedAt: number; expected: {version: number; fingerprint: string}; runtimes: Record<string,string>; phase: 'waiting' | 'complete' | 'failed' };
  arrivalReadySince?: number;
  preparationBlocker?: string;
  continuousReturn?: number;
  disableTown?: boolean;
  finalLocation?: RoutePoint;
  avoidLeave?: boolean;
  nativeFallback?: boolean;
  merchantInterruption?: import("./merchant-interruption.ts").MerchantInterruption;
  farmingEngagement?: { target: RoutePoint & {id: string; mtype: string; server?: string}; at: number; finished?: boolean };
  returnRuntimeRetries?: number;
  routeProtocol?: number; routeVersion?: number; recoveryAttempts?: number;
  sharedStartedAt?: number; sharedProgressAt?: number; sharedDistances?: Record<string, number>;
  sharedReadySince?: number; routePublishedAt?: number; sharedStoppedAt?: number;
  sharedWaitingAt?: number;
  readinessStartedAt?: number;
  walkingFailures?: number;
  missingRoutes?: Record<string, { since: number; observedAt: number }>;
  walkingActivity?: string;
  routeServer?: string;
  retryExhausted?: boolean;
  walkingParents?: Record<string, { revision: number; parentId: number; command?: SharedCommand }>;
  returnRouting?: boolean; returnLegs?: { type: string; location: RoutePoint }[];
  legIndex?: number; townCompleted?: boolean; force?: boolean; nonPreemptible?: boolean;
  runtimes?: Record<string, string> | null; origins?: Record<string, RoutePoint>;
  observedPhase?: string | null; assembledSince?: number;
}
export interface SharedState extends ConvoyHistoryState, CompletionReceipts {
  activeConvoy: SharedConvoy | null;
  commands: Record<string, SharedCommand | undefined>;
  statuses: Record<string, SharedStatus | undefined>;
  navigationIntents?: Record<string, { revision: number; cancelled?: boolean } | undefined>;
  nextCommandId: number;
}

export function samePlace(a: RoutePoint, b: RoutePoint): boolean {
  return a.map === b.map && String(a.in ?? a.map) === String(b.in ?? b.map);
}
export function distance(a: RoutePoint, b: RoutePoint): number {
  return samePlace(a, b) ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
}
export function point(s: RoutePoint): RoutePoint {
  return { map: s.map, x: s.x, y: s.y, ...(s.in === undefined ? {} : { in: s.in }) };
}
export function reportMatches(state: SharedState, name: string): boolean {
  const c = state.activeConvoy, command = state.commands[name], n = state.statuses[name]?.convoyNavigation;
  if (!c || !command || !n || !c.participants.includes(name)) return false;
  return command.convoyId === c.id && command.epoch === c.epoch && sameReport(command, n) && c.runtimes?.[name] === n.runtimeId;
}
function sameReport(command: SharedCommand, n: SharedReport): boolean {
  return n.id === command.convoyId && n.epoch === command.epoch && command.id === n.commandId && command.navigationRevision === n.navigationRevision;
}

export function characterRuntime(status: SharedStatus | undefined): string | undefined {
  return status?.combatSelection?.runtimeId || status?.convoyNavigation?.runtimeId;
}
