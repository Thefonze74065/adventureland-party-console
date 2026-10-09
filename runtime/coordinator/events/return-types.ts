export interface ReturnLocation {
  in?: string | number;
  map: string;
  x: number;
  y: number;
  label?: string;
  realm?: string;
}
export type Waypoints = Record<string, { revision: number; location: ReturnLocation | null }>;
/** A saved waypoint gains command ownership as its return journey is dispatched. */
export interface ReturnRoute {
  revision: number;
  location: ReturnLocation | null;
  commandId?: number;
  convoyId?: string;
  engagedAt?: number;
}
export interface ReturnOwner {
  participants: string[];
  waypoints?: Waypoints;
  convoyId?: string | null;
  returnDispatchedAt?: number | null;
  returnCompletedAt?: number;
  returnRoutes?: Record<string, ReturnRoute> | null;
}
export interface EventRecovery extends ReturnOwner {
  blocker?: string;
  postExitLocation?: ReturnLocation | null;
  phase?: "evacuating" | "handoff" | "checkpoint";
  cycleId: string;
  event: string;
  pending: string[];
  startedAt: number;
  checkpoint: ReturnLocation | null;
  deferred: string[];
  exited?: string[];
  exitSuspended?: boolean;
  exitConvoyId?: string;
  anniversaryRound?: string;
}
export type AnniversaryReturnCycle = AnniversaryCycle;
export interface EventReturnState {
  current: EventRecovery | null;
  last: { event: string; finishedAt: number } | null;
  deferred: Record<string, { cycleId: string }>;
}
export interface ReturnStatus {
  x?: number;
  y?: number;
  map?: string;
  mapEvent?: string;
  seenAt?: number;
  rip?: boolean;
  goobrawlCombat?: boolean;
  serverLiveEvents?: { name: string }[];
  /** Local-wall-clock native spawn deadlines; these are attendance, not liveness. */
  serverStagingEvents?: { name: string; spawnAt: number; spawnId?: number }[];
  slendermanSearchExhausted?: boolean;
  eventFeedConnected?: boolean;
  eventClockStale?: boolean;
  eventRecovery?: { cycleId: string; phase: string };
}
export interface ReturnConvoy {
  merchantInterruption?: unknown;
  id: string;
  phase: string;
  participants: string[];
  purpose?: string | null;
  walkingActivity?: string;
  nonPreemptible?: boolean;
  walkingParents?: Record<string, { revision: number; parentId?: number; command?: { cycleId?: string } }>;
}
export interface CommandView {
  convoyId?: string;
  type: string;
  cycleId?: string;
}
export interface EventReturnPorts {
  huntHandoffPending?(): boolean;
  handoffToHunt?(recovery: EventRecovery): boolean;
  now(): number;
  nextCommandId(): number;
  activeNames(): string[];
  merchant(): string | null;
  enabled(name: string, event?: string): boolean;
  statuses(): Readonly<Record<string, ReturnStatus | undefined>>;
  commands(): Readonly<Record<string, CommandView | undefined>>;
  clearCommand(name: string): void;
  town(name: string, recovery: EventRecovery): void;
  checkpoint(): ReturnLocation | null;
  capture(names: string[]): Waypoints;
  clearABStrategy(): void;
  convoy(): ReturnConvoy | null;
  cancelConvoy(): void;
  startExit(names: string[]): boolean;
  townBusy(): boolean;
  anniversary(): AnniversaryReturnCycle | null | undefined;
  anniversaryParticipants(): string[];
  sessions(): readonly { event: string }[];
  dispatch(owner: EventRecovery, names: string[]): boolean;
  reconcile(owner: EventRecovery): boolean;
  finish(owner: AnniversaryReturnCycle, reason: string): void;
  persist(): void;
}
import type { AnniversaryCycle } from "../anniversary/contracts.ts";
