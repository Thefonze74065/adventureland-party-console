import type { Area, Catalog } from "../../../dashboard/lib/farming-zones.ts";
import type { Point } from "../../navigation/contracts.ts";
import type { ObservedCharacterStatus } from "../status/observed-status.ts";
export type { Area, Catalog, Point };
export interface Owner {
  leader: string;
  realm: string;
  focus: string;
  policy: string;
  revisions: Record<string, number>;
}
export interface Sight extends Point {
  level?: import('typed-adventureland').MonsterEntity['level'];
  id: string;
  mtype: string;
  hp: number;
  target?: string;
  realm: string;
  in: string;
  seenAt: number;
  reporter: string;
  visible?: boolean;
  partyEngaged?: boolean;
  reachable?: boolean;
}
export interface Encounter extends Owner {
  convoyId?: string;
  convoyEpoch?: number;
  id: string;
  target: Sight;
  start: number;
  lastSeen: number;
  lowHp: number;
  progress: number;
  approachSamples?: Record<string, {x:number;y:number;deficit:number;waypoint?:{key:string;remaining:number}}>;
  stage: string;
  generator: string;
  message: string;
  returnLocation: Area | null;
  hunt?: { cycleId?: string } | null;
  engaged?: boolean;
  killedAt?: number;
  deathAt?: number;
  deployer?: string | null;
  deployedAt?: number;
  combatAt?: number;
  travelAt?: number;
  awaitingSelection?: boolean;
  /** Patrol Phoenix: when converging may stop waiting for every fighter. */
  gatherDeadline?: number;
  gatheredAt?: number;
  /** Fighters still out of range when the convergence deadline forced the fight. */
  gatheredWithout?: string[];
  respawnPrepared?: boolean;
}
/** One fighter's independent Phoenix search leg. */
export interface Searcher {
  regionId: string;
  points: Point[];
  point: number;
  skipped: number;
  arrivedAt: number;
  retry: number;
  progressAt: number;
  progressPosition?: Point;
  absentSince?: number;
}
export interface Patrol extends Owner {
  id: string;
  readyAt: number;
  /** Coverage generation; a kill or a fully checked map starts a new one. */
  cycle: number;
  covered: Record<string, number>;
  incomplete: string[];
  searchers: Record<string, Searcher>;
  assigning?: number;
  assigningAt?: number;
  assignAfter?: number;
  stage: string;
  paused?: boolean;
  message?: string;
  retryReason?: string;
}
export interface Checkpoint extends Owner {
  readyAt: number;
  /** Saved by a realm hop: resume only back on `realm`, and only without new navigation. */
  suspended?: boolean;
}
export interface Status extends Point {
  region?: string;
  server?: string;
  seenAt: number;
  rip?: boolean;
  hp?: number;
  max_hp?: number;
  ctype?: string;
  joinedEvent?: string;
  movement?: { event?: unknown };
  eventTraveling?: boolean;
  items?: ObservedCharacterStatus['items'];
  target?: { mtype: string } | null;
  rareSightings?: Sight[];
  groupedCombat?: {approach?: import('../../combat/pursuit.ts').ApproachReport;currentAttackersAt?:number;currentAttackers?:import('./travel-defense.ts').CurrentAttacker[]};
  range?: number;
  combatSelection?: {runtimeId?: string};
  speed?: number;
  rareObservation?: {at: number; runtimeId: string; map: string; in: string; server: string; x: number; y: number; sightings: Sight[]};
  rareKills?: (Point & { id: string; mtype: string; at: number; partyEngaged?: boolean })[];
  rareFields?: { x: number; y: number }[];
  rareDeployment?: { encounterId: string; failed?: boolean };
  rareNavigation?: { id: string; failed?: boolean; at?: number };
  rareLoot?: {
    id: string;
    observedAt: number;
    realm: string;
    map: string;
    in: string;
    complete: boolean;
  };
  convoyLoot?: Status['rareLoot'];
}
export interface Party {
  combatLogs?: Record<string, {at:number;type:string;message:string;details?:unknown}[]>;
  leader: string;
  statuses: Record<string, Status>;
  passiveHunting?: import("./passive-settings.ts").PassiveSettings;
  passiveRareHunts: Record<string, boolean>;
  phoenixRouteOrder: string[];
  phoenixPatrolActive?: boolean;
  phoenixPatrolCheckpoint?: Checkpoint | null;
  monsterChoices?: Catalog | null;
  monsterFocus: string[];
  monsterFocusByCharacter?: Record<string, string[]>;
  monsterPrioritiesByCharacter?: Record<string, Record<string, number>>;
  farmingPolicy: string;
  commands: Record<string, { type?: string; purpose?: string }>;
  activeConvoy?: import('../../combat/hunt-travel.ts').HuntTravelConvoy & {phase:string;purpose?:string;failureCode?:string;communicationHold?:unknown} | null;
  rarePursuitProgress?: Record<string, {start:number;progress:number;lowHp:number}>;
  rareRetryEvidence?: Record<string, import('./rare-retry-evidence.ts').Failed>;
  combatRecovery?: { phase: string };
  eventReturn?: unknown;
  anniversary?: {eventCycle?: {returnCompletedAt?: number; supersededAt?: number; combatHandoffAt?: number} | null};
  townCycle?: unknown;
  escape?: { stage: string };
  monsterHunt?: { cycleId?: string; loot?: { complete: boolean }; travelCheckpoint?: import('./continuous-return.ts').HuntTravelCheckpoint } | null;
  location: Area | null;
  rareHuntReturn?: unknown;
  rareHuntState?: unknown;
  partyFarmingMode?: string;
  scatterBreakTarget?: unknown;
  groupedCombat?: { fights?: unknown[] };
}
export interface Hooks {
  now?: () => number;
  members(): string[];
  intent(name: string): { revision: number; cancelled?: boolean };
  turnIn(): boolean;
  reconcileHuntArrival?(): void;
  persist(): void;
  cancelConvoy(): void;
  convoy(location: Point, label: string, names: string[], purpose: string): unknown;
  routeDistance?(from: Point, to: Point): Promise<number>;
}
export interface Combat {
  grouped(): boolean;
  selected(s: Sight): boolean;
  locked(s: Sight): boolean;
  engaged(s: Sight): boolean;
  busy(): boolean;
  killed(s: Sight): boolean;
  claimed(s: Sight): boolean;
  release(s: Sight, until: number, rejectedAt?: number): void;
  allow(s: Sight): void;
  rejected(s: Sight): boolean;
  current(): Sight | null;
}
export interface FarmingReturn {
  tick(paused: boolean): boolean;
  clear(): void;
  moving(): boolean;
}
