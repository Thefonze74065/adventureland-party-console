import type { Area, Catalog } from "../../../dashboard/lib/farming-zones.ts";
import type { Point } from "../../navigation/contracts.ts";
export type { Area, Catalog, Point };
export interface Owner {
  leader: string;
  realm: string;
  focus: string;
  policy: string;
  revisions: Record<string, number>;
}
export interface Sight extends Point {
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
}
export interface Encounter extends Owner {
  convoyId?: string;
  id: string;
  target: Sight;
  start: number;
  lastSeen: number;
  lowHp: number;
  progress: number;
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
}
export interface Patrol extends Owner {
  id: string;
  index: number;
  area: Area | null;
  readyAt: number;
  incomplete: string[];
  stage: string;
  failures: Record<number, number>;
  points: Point[];
  remaining: Point[];
  point: number;
  arrivedAt: number;
  fallbacks: number;
  retry?: number;
  paused?: boolean;
  message?: string;
  progressAt?: number;
  progressPosition?: Point;
  progressPoint?: string;
  waitingRegion?: boolean;
  choosing?: boolean;
  retryReason?: string;
  retryAt?: number;
}
export interface Checkpoint extends Owner {
  regionId: string;
  readyAt: number;
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
  items?: ({ name: string } | null)[];
  target?: { mtype: string } | null;
  rareSightings?: Sight[];
  combatSelection?: {runtimeId?: string};
  rareObservation?: {at: number; runtimeId: string; map: string; in: string; server: string; x: number; y: number; sightings: Sight[]};
  rareKills?: (Point & { id: string; mtype: string; at: number; partyEngaged?: boolean })[];
  rareFields?: { x: number; y: number }[];
  rareDeployment?: { encounterId: string; failed?: boolean };
  rareNavigation?: { id: string; failed?: boolean };
  rareLoot?: {
    id: string;
    observedAt: number;
    realm: string;
    map: string;
    in: string;
    complete: boolean;
  };
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
  activeConvoy?: { id?: string; huntTravel?: {reason?: string}; purpose?: string; phase: string; failureCode?: string } | null;
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
  current(): Sight | null;
}
export interface FarmingReturn {
  tick(paused: boolean): boolean;
  clear(): void;
  moving(): boolean;
}
