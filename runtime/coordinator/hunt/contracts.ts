import type {HuntFailureState} from "./settings.ts";
import type { Hunt } from "../../hunt/policy.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import type { StoredCombatLogEntry } from "../telemetry/combat-log.ts";
import type { Death, Member } from "../../combat/grouped.ts";

export interface HuntEncounter {
  target: import("../../combat/grouped.ts").Target & { server: string };
  cycleId: string;
  missionIndex: number;
  missionRevision: number;
  convoyId: string;
  revisions: Record<string, number>;
  startedAt: number;
  missingMs?: number;
  resumeReason?: string;
}

export interface HuntCycle extends Hunt {
  encounter?: HuntEncounter;
  travelCheckpoint?: import('../navigation/continuous-return.ts').HuntTravelCheckpoint;
  travelCause?: "farming-conflict";
  expiryAttempts?: Record<string, import("./expiry.ts").HuntExpiryAttempt>;
  backup?: {
    startedAt: number;
    members: Record<
      string,
      { target: string | null; remainingMs: number; ready: boolean; fresh: boolean }
    >;
  };
  batchPickup?: boolean;
  eventTrips?: import("../events/hunt-trip.ts").HuntEventTrips["huntEventTrips"];
  missionRevision?: number;
  originArrivedAt?: number;
  loot?: {
    id: string;
    after: number;
    map: string;
    in: string;
    realm: string;
    x: number;
    y: number;
    complete: boolean;
    progress?: LootProgress;
  };
  version?: number;
  cycleId: string;
  exitMode?: string | null;
  convoyId?: string | null;
  missions: {
    target: string;
    owners: string[];
    skipped?: boolean;
    skipReason?: string;
    destination?: ReturnLocation | null;
    destinationVersion?: number;
    destinationRevisions?: Record<string, number>;
  }[];
  currentIndex: number;
  target: string | null;
  message?: string;
  waitForExpiry?: boolean;
  pickupPending?: boolean;
  skipAfterDeath?: boolean;
  recovering?: boolean;
  resumeStage?: string;
  arrivalHandoff?: { at: number; confirmedAt?: number };
  startedAt?: number;
  returnPolicy?: string;
  returnLocation?: ReturnLocation | null;
  returnFocus?: string;
  deathCount?: number;
  deathObservations?: Record<string, { at: number; dead: boolean; countedAt: number }>;
  endReason?: string;
}
export interface HuntStatus {
  anniversaryState?: { busy?: boolean };
  activeCombatTarget?: { id: string; map: string; in?: string | number; server: string };
  groupedCombat?: {
    currentAttackersAt?: number;
    deaths?: Death[];
    claims?: import("../../combat/claims.ts").ClaimObservation[];
    sightings?: NonNullable<NonNullable<Member["status"]>["groupedCombat"]>["sightings"];
    candidates?: NonNullable<NonNullable<Member["status"]>["groupedCombat"]>["candidates"];
    retentions?: { id: string; eligible: boolean }[];
  };
  region?: string;
  in?: string | number;
  huntLoot?: LootProgress;
  seenAt: number;
  ctype?: string;
  server?: string;
  hp?: number;
  lastDeath?: { at?: number; eventTrip?: import("../events/hunt-trip.ts").HuntEventTrip | null };
  map: string;
  x: number;
  y: number;
  rip?: boolean;
  activeEvent?: string;
  joinedEvent?: string;
  farmReunion?: unknown;
  convoyProtocol?: number;
  huntEventPending?: boolean;
  monsterHunt?: { id: string; count: number; remainingMs: number } | null;
}
export interface LootProgress {
  id: string;
  observedAt: number;
  realm: string;
  map: string;
  in: string;
  complete: boolean;
  error?: string;
}
interface HuntConvoyState {
  communicationHold?: import('../navigation/convoy.ts').PartyConvoy['communicationHold'];
  failureDetails?: unknown;
  communicationLegacyRecovered?: boolean;
  location?: ReturnLocation;
  geometryRepair?: import('../navigation/shared-route-types.ts').SharedConvoy['geometryRepair'];
  nativeFallback?: boolean;
  participants?: string[];
  walkingActivity?: string;
  walkingParents?: Record<string, { revision: number }>;
  continuousReturn?: number;
  returnTown?: import('../navigation/return-town.ts').ReturnTownPolicy;
  cause?: "farming-conflict";
  huntTarget?: string;
  label?: string;
  id: string;
  phase: string;
  purpose?: string | null;
  failedAt?: number;
  failure?: string;
  failureCode?: string;
  expected?: Record<string, { revision: number }>;
  returnRouting?: unknown;
  blockerSummary?: string;
  preparationBlocker?: string;
  blockers?: Record<string, unknown>;
  townFirst?: boolean;
  combatHandoffAllowed?: boolean;
  nonPreemptible?: boolean;
  disableTown?: boolean;
}
/** Ordinary convoys have no leg cursor; routed returns supply the route and cursor together. */
export type HuntConvoy = HuntConvoyState &
  (
    | { returnLegs?: undefined; legIndex?: number }
    | { returnLegs: { type: string }[]; legIndex: number }
  );
export interface HuntCommand {
  nativeFallback?: boolean;
  huntTarget?: string;
  id?: number;
  type: string;
  cycleId?: string;
  action?: string;
  convoyId?: string;
  convoyHandoff?: unknown;
  navigationRevision?: number;
  purpose?: string | null;
  issuedAt?: number;
  combatHandoffAllowed?: boolean;
  nonPreemptible?: boolean;
  returnRouting?: unknown;
}
export interface HuntTickState extends HuntFailureState {
  monsterChoices?: import("../../../dashboard/lib/farming-zones.ts").Catalog | null;
  groupedCombat?: { deaths?: Death[] } | null;
  huntEventTrips?: import("../events/hunt-trip.ts").HuntEventTrips["huntEventTrips"];
  combatRecovery?: { phase: string; reason?: string } | null;
  farmingPolicy: string;
  monsterHunt: HuntCycle | null;
  activeConvoy: HuntConvoy | null;
  /** Null during coordinator startup; active Hunt operations retain their selected-leader precondition. */
  leader: string | null;
  followers: Record<string, boolean>;
  statuses: Record<string, HuntStatus | undefined>;
  commands: Record<string, HuntCommand | undefined>;
  escape?: { stage: string } | null;
  monsterHunterLocation: ReturnLocation | null;
    farmAreaState?: {
      message?: string | null;
    pending?: unknown;
    paused?: boolean;
    failures?: Record<string, unknown>;
  } | null;
  huntBlacklist?: Record<
    string,
    {
      monsterId: string;
      at: number;
      deaths: number;
      expirations?: number;
      characters?: string[];
      lastDeathAt?: number;
      reason?: string;
    }
  >;
  eventReturn: unknown;
  anniversary?: {
    eventCycle?: Partial<Pick<import("../anniversary/contracts.ts").AnniversaryCycle,
      "endsAt" | "participants" | "waypoints" | "returnDispatchedAt" | "kissOperations" |
      "returnReason" | "returnCompletedAt" | "supersededAt" | "combatHandoffAt">> | null;
  };
  monsterSearchRadiusByCharacter: Record<string, number>;
  combatLogs?: Record<string, StoredCombatLogEntry[]>;
}
export interface HuntTickPorts {
  backupDestination?(hunt: HuntCycle): ReturnLocation | null | undefined;
  now(): number;
  rareEncounter(): unknown;
  begin(): unknown;
  intent(name: string): { cancelled?: boolean; revision?: number };
  finishFailed(hunt: HuntCycle): unknown;
  ownsTravel(hunt: HuntCycle): boolean;
  cancelHuntConvoy(): void;
  cancelConvoy(): void;
  prepare(hunt: HuntCycle): void;
  persist(): void;
  fresh(hunt: HuntCycle): boolean;
  start(
    hunt: HuntCycle,
    destination: ReturnLocation | null | undefined,
    label: string,
    stage: string,
  ): unknown;
  recordDeaths(hunt: HuntCycle): string[];
  buildMissions(hunt: HuntCycle): void;
  advance(hunt: HuntCycle): unknown;
  participants(): string[];
  returnToDaisy(hunt: HuntCycle): unknown;
  destination(hunt: HuntCycle): ReturnLocation | null | undefined;
  monsterDestination?(target: string): ReturnLocation | null | undefined;
  processDaisy(hunt: HuntCycle): void;
  contains(
    destination: ReturnLocation,
    status: HuntStatus,
    margin: number,
    radius: number,
  ): boolean;
  arrivalProtected(
    hunt: HuntCycle,
    status: HuntStatus,
    destination: ReturnLocation | null | undefined,
  ): boolean;
  partyFighting(hunt: HuntCycle): boolean;
}
