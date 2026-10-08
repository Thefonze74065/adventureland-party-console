import type { MerchantWork } from "../merchant/work.ts";

/** These values are owned by other services; the overview only projects them. */
export const publicStateFields = [
  "characterAppearances",
  "gameVersion", "clientUpdate", "merchantRules",
  "bankboiPrefix", "anniversaryAutoChat",
  "farmingProfiles",
  "passiveRareHunts",
  "passiveHunting",
  "phoenixRouteOrder",
  "rareHuntState",
  "threshold",
  "itemCollectionThreshold", "buyUpgradeBatchSize",
  "marked",
  "merchantMarked",
  "autoItemMarks",
  "merchantDeliveries",
  "standListings",
  "npcSaleMarks",
  "deconstructionMarks",
  "autoDeconstruction",
  "deconstructionCatalog",
  "autoNpcSales",
  "autoStandMarks",
  "merchantRoutinePriorities",
  "merchantAutomations",
  "merchantBlacklist",
  "standBids",
  "nativeStand",
  "autoStandBuys",
  "autoBlacklistMerchants",
  "standPriceHistory",
  "standSearch",
  "upgrades",
  "statScrolls",
  "purchases",
  "compounds",
  "autoCompounds",
  "autoExchanges",
  "goldTargets",
  "withdrawals",
  "activeConvoy",
  "eventReturn",
  "deferredEventReturns",
  "leader",
  "designatedTank",
  "followers",
  "eventsByCharacter",
  "eventSelectionsByCharacter",
  "monsterFocus",
  "monsterFocusByCharacter",
  "monsterPrioritiesByCharacter",
  "monsterSearchRadiusByCharacter",
  "scatterMonsterTypes",
  "partyFarmingMode",
  "partyFarmingMonsterType",
  "combatRecovery",
  "farmingPolicy",
  "monsterHunt",
  "farmAreaState",
  "huntBlacklist",
  "huntSettings",
  "huntFailures",
  "characterLocations",
  "restockPolicies",
  "merchantCharacter",
  "merchantForceStand",
  "merchantStandLocation",
  "bossChase",
  "dailyChase",
  "realmHopBlacklist",
  "merchantWeapon",
  "luckyUpgradeSlots",
  "luckySlotLocks",
  "luckySlotResume",
  "luckySlotTracking",
  "merchantCargo",
  "merchantActivity",
  "combatLogs",
  "bankSortMode", "bankSortRequest",
  "gatheringModes",
  "gatheringNoTool",
  "gatheringCooldowns",
  "bankCurrent",
  "bankQueue",
] as const;

export interface PresentationEntry {
  item?: import("../contracts/item.ts").Item | null;
  [field: string]: unknown;
  meta?: Record<string, unknown> | null;
}
export interface PresentationStatus {
  [field: string]: unknown;
  seenAt: number;
  server?: string;
  realmPlayers?: string[];
  items?: (PresentationEntry | null)[];
  slots?: Record<string, PresentationEntry | null>;
  characterDollHtml?: string;
}
export interface PublicCommand {
  id: number;
  type: string;
  phase?: string | null;
  convoyId?: string | null;
}
export interface PublicState extends Partial<Record<(typeof publicStateFields)[number], unknown>> {
  statuses: Record<string, PresentationStatus>;
  commands: Record<string, PublicCommand | null | undefined>;
  location: unknown;
  abtestingStrategy: unknown;
  bankSnapshot: unknown;
  bankVaults?: unknown[];
  bankboiQueue: unknown;
  bankboiTransaction: unknown;
  ponty: unknown;
  autoUpgradeMarks: unknown;
  upgradeOfferingRules?: import("../../upgrade-offerings.ts").UpgradeOfferingRule[];
  travelPlaces?: unknown[] | null;
  monsterChoices?: unknown[] | null;
  bestiaryCatalog?: unknown[] | null;
  skillCatalog?: unknown[] | null;
  appearanceChoices?: unknown;
  merchantCatalog?: unknown;
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  aldata: {
    merchants?: {
      id?: string;
      lastSeen?: string;
      serverRegion?: string;
      serverIdentifier?: string;
    }[];
  };
}

export interface PublicStatePorts {
  now(): number;
  handoff(): unknown;
  aldata(): Record<string, unknown>;
  servers(): { key?: string }[];
  roster(): unknown;
  slots(): unknown;
  classes: readonly string[];
  eventSchedules(): unknown;
  anniversary(): unknown;
  job(job: MerchantWork | null): unknown;
  luckSchedule(): unknown;
  bankbois(): unknown;
  realmControl(): unknown;
}
