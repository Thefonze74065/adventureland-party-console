import type { MerchantCommand } from "../merchant/work.ts";
import type { Catalog } from "../../../dashboard/lib/farming-zones.ts";

export interface HeartbeatStatus {
  [field: string]: unknown;
  name: string;
  server?: string;
  map?: string;
  x?: number;
  y?: number;
  seenAt?: number;
  combat?: { kiting?: boolean };
  combatStats?: { armorPiercing?: number };
  combatSelection?: Record<string, unknown>;
  eventTeam?: string;
  activeEvent?: string;
  joinedEvent?: string;
  threats?: EntityReference[];
  target?: EntityReference | null;
  serverLiveEvents?: { name: string }[];
}
export interface EntityReference {
  id?: string;
  target?: string;
  [field: string]: unknown;
}

export const heartbeatStateFields = [
  "combatRecovery",
  "combatResetByCharacter",
  "threshold",
  "passiveRareHunts",
  "passiveHunting",
  "leader",
  "abtestingStrategy",
  "merchantCharacter",
  "merchantForceStand",
  "merchantWeapon",
  "luckyUpgradeSlots",
  "luckySlotTracking",
  "gatheringNoTool",
  "gatheringCooldowns",
  "standListings",
  "scatterMonsterTypes",
  "scatterEpoch",
  "partyFarmingMonsterType",
  "farmingPolicy",
  "monsterHunt",
  "farmAreaState",
  "scatterBreakTarget",
] as const;

export interface HeartbeatState extends Record<(typeof heartbeatStateFields)[number], unknown> {
  passiveHunting: import('../navigation/passive-settings.ts').PassiveSettings;
  eventSessions?: import('../merchant/event-control.ts').MerchantEventState['eventSessions'];
  eventReturn?: import('../merchant/event-control.ts').MerchantEventState['eventReturn'];
  deferredEventReturns?: import('../merchant/event-control.ts').MerchantEventState['deferredEventReturns'];
  merchantQueue?: import("../merchant/work.ts").MerchantWork[];
  huntEventTrips?: import("../events/hunt-trip.ts").HuntEventTrips["huntEventTrips"];
  leader: string | null;
  merchantCharacter: string | null;
  commands: Record<string, MerchantCommand | undefined>;
  statuses: Record<string, HeartbeatStatus | undefined>;
  followers: Record<string, boolean>;
  escape: { stage?: string } | null;
  farmingPolicy: string;
  monsterHunt: HuntCycle | null;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[]>;
  monsterPrioritiesByCharacter: Record<string, Record<string, number>>;
  monsterSearchRadiusByCharacter: Record<string, number>;
  farmAreaState: { paused?: boolean } | null;
  rareHuntState?: { patrol?: { paused?: boolean } } | null;
  townCycle: { id: string; pending: string[]; revisions?: Record<string, number> } | null;
  returnProgress?: Record<string, import("../http/return-progress.ts").ReturnProgress>;
  activeConvoy: (import('../../combat/hunt-travel.ts').HuntTravelConvoy & { participants: string[] }) | null;
  bankCurrent: { name: string } | null;
  bankQueue: { name: string }[];
  bankbois: Record<string, import("../inventory/bankboi-completion.ts").BankboiInventory>;
  goldTargets: Record<string, number>;
  gatheringModes: string[];
  partyFarmingMode: string;
  monsterLocationsVersion?: number;
  travelPlaces: unknown;
  monsterChoices: Catalog | null;
  monsterHunterLocation: unknown;
  bestiaryCatalog: unknown;
  skillCatalog: unknown;
  appearanceChoices: unknown;
  merchantCatalog: unknown;
  merchantCatalogVersion: unknown;
}

export interface HeartbeatResponsePorts {
  now(): number;
  activeNames(): string[];
  enabled(name: string, event?: string): boolean;
  navigationRevision(name: string): number;
  escapeOwns(name: string): boolean;
  rareControl(name: string): unknown;
  convoySignal(name: string): unknown;
  partyLocation(name: string): unknown;
  navigationIntent(name: string): unknown;
  rareEncounter(): unknown;
  huntTurnInOwnsTravel(): boolean;
  mapSubscriberCount(name: string): number;
  bankStackHomes(): unknown;
  groupedCombat(): unknown;
  selectedEvents(name: string): unknown;
  anniversary(): unknown;
  rareOwns(): boolean;
}
import type { HuntCycle } from "../hunt/contracts.ts";
