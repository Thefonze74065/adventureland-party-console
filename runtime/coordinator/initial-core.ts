import type { SavedPartySelection } from "./navigation/selection-contracts.ts";
import type { SavedEventState, LastEventReturn } from "./events/initial-contracts.ts";
import type { SavedRecoveryState } from "./navigation/recovery-contracts.ts";
import type { Catalog } from "../../dashboard/lib/farming-zones.ts";
import { initialBossChase } from "./events/boss-chase.ts";
import { initialDailyChase } from "./events/daily-chase.ts";
import { initialRealmHopBlacklist } from "./navigation/realm-hop-blacklist.ts";
import type { RealmOperation } from "./characters/realm-switch.ts";

export function initialRecoveryState(saved: SavedRecoveryState) {
  return {
    escape: saved.escape || null,
    combatRecovery: saved.combatRecovery || null,
    combatHuntBoundary: saved.combatHuntBoundary || null,
    combatDeathSeen: saved.combatDeathSeen || {},
    combatResetByCharacter: saved.combatResetByCharacter || {},
    groupedCombatResetAt: saved.groupedCombatResetAt || 0,
  };
}
export function initialPartySelection(saved: SavedPartySelection) {
  return {
    location: saved.location || null,
    leader: saved.leader || null,
    designatedTank: saved.designatedTank || null,
    followers: saved.followers || {},
    eventsByCharacter: saved.eventsByCharacter || {},
    eventSelectionsByCharacter: saved.eventSelectionsByCharacter || {},
  };
}
export function initialEventState(saved: SavedEventState, configuredRealm: string) {
  return {
    activeRealm: typeof saved.activeRealm === "string" ? saved.activeRealm : configuredRealm,
    realmSwitch: null as RealmOperation | null,
    eventReturn: saved.eventReturn || null,
    eventReturnLast: null as LastEventReturn,
    eventSessions: saved.eventSessions || {},
    deferredEventReturns: saved.deferredEventReturns || {},
    huntEventTrips: saved.huntEventTrips || {},
    combatEventHandoff: saved.combatEventHandoff || null,
    abtestingStrategy: saved.abtestingStrategy || null,
    bossChase: initialBossChase(saved.bossChase),
    dailyChase: initialDailyChase(saved.dailyChase),
    realmHopBlacklist: initialRealmHopBlacklist(saved.realmHopBlacklist),
  };
}
export function initialMarketObservations() {
  return {
    standSearch: { status: "idle", itemId: null, listings: [], error: null },
    standListingCache: [],
    ponty: { listings: [], updatedAt: 0, error: null },
  };
}
export function initialCatalogs() {
  return {
    travelPlaces: null,
    monsterChoices: null as Catalog | null,
    bestiaryCatalog: null,
    skillCatalog: null,
    appearanceChoices: null,
    merchantCatalog: null,
    merchantCatalogVersion: null,
  };
}
