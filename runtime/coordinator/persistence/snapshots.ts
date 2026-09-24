/** Persisted v1 keys are API contracts: keep them stable across coordinator builds. */
export const stateKeys = {
  bank: "party_dashboard_bank_state_v1",
  settings: "party_dashboard_settings_state_v1",
  selections: "party_dashboard_selections_state_v1",
  history: "party_dashboard_history_state_v1",
  roster: "party_dashboard_roster_state_v1",
  aldata: "party_dashboard_aldata_state_v1",
} as const;

export const rosterFields = [
  "characterAppearances",
  "headlessSlots",
  "nativeOwner",
  "steamMembers",
  "steamSwitch",
] as const;
export const bankFields = [
  "bankSnapshot",
  "withdrawals",
  "bankbois",
  "bankboiQueue",
  "bankboiTransaction",
  "bankboiReservedMigrated",
] as const;
export const selectionFields = [
  "marked",
  "merchantMarked",
  "autoItemMarks",
  "autoUpgradeMarks",
  "monsterFocus",
  "monsterFocusByCharacter",
  "monsterPrioritiesByCharacter",
  "monsterSearchRadiusByCharacter",
] as const;

export const settingsFields = [
  "merchantRules", "production", "upgradeOfferingRules",
  "bankboiPrefix", "anniversaryAutoChat",
  "farmingProfiles",
  "combatRecovery",
  "combatDeathSeen",
  "combatResetByCharacter",
  "groupedCombatResetAt",
  "combatHuntBoundary",
  "huntEventTrips",
  "combatEventHandoff",
  "passiveRareHunts",
  "passiveHunting",
  "phoenixRouteOrder",
  "phoenixPatrolActive",
  "phoenixPatrolCheckpoint",
  "rareHuntReturn",
  "escape",
  "threshold",
  "itemCollectionThreshold",
  "merchantDeliveries",
  "standListings",
  "npcSaleMarks",
  "deconstructionMarks",
  "autoDeconstruction",
  "autoNpcSales",
  "autoStandMarks",
  "merchantRoutinePriorities",
  "giveawayAttempts",
  "merchantAutomations",
  "standBids",
  "nativeStand",
  "autoStandBuys",
  "autoBlacklistMerchants",
  "standPriceHistory",
  "merchantBlacklist",
  "upgrades",
  "statScrolls",
  "purchases",
  "compounds",
  "autoCompounds",
  "autoExchanges",
  "goldTargets",
  "location",
  "leader",
  "followers",
  "eventsByCharacter",
  "eventSelectionsByCharacter",
  "eventSessions",
  "eventReturn",
  "deferredEventReturns",
  "abtestingStrategy",
  "anniversary",
  "farmingPolicy",
  "monsterHunt",
  "farmAreaState",
  "huntBlacklist",
  "huntSettings",
  "huntFailures",
  "characterLocations",
  "navigationIntents",
  "townCycle",
  "returnProgress",
  "restockPolicies",
  "merchantCharacter",
  "merchantForceStand",
  "merchantWeapon",
  "luckyUpgradeSlots",
  "luckySlotTracking",
  "merchantQueue",
  "merchantCurrent",
  "merchantCargo",
  "bankSortMode", "bankSortRequest",
  "gatheringModes",
  "gatheringNoTool",
  "gatheringCooldowns",
  "mluckCastAt",
  "activeRealm",
  "activeConvoy",
  "convoyCompletionReceipts",
  "navigationEpoch",
] as const;

const marketFields = [
  "marketListings",
  "marketBuyOrders",
  "trades",
  "merchantsUpdatedAt",
  "tradesUpdatedAt",
] as const;
const authFields = ["key", "auth", "authCheckedAt", "publishedAt"] as const;

/** Selectors preserve the domain's types while excluding timers, processes, and transient state. */
export function selectSnapshot<T, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const snapshot = {} as Pick<T, K>;
  for (const key of keys) snapshot[key] = source[key];
  return snapshot;
}

type SettingsInput = Record<(typeof settingsFields)[number], unknown> & {
  aldata: Record<(typeof marketFields)[number], unknown>;
};

export function settingsSnapshot<T extends SettingsInput>(state: T) {
  return {
    ...selectSnapshot(state, settingsFields),
    aldataMarketListings: state.aldata.marketListings,
    aldataMarketBuyOrders: state.aldata.marketBuyOrders,
    aldataTrades: state.aldata.trades,
    aldataMerchantsUpdatedAt: state.aldata.merchantsUpdatedAt,
    aldataTradesUpdatedAt: state.aldata.tradesUpdatedAt,
  };
}

export function authSnapshot<T extends Record<(typeof authFields)[number], unknown>>(state: T) {
  return selectSnapshot(state, authFields);
}

/** History is intentionally capped independently for each character. */
export function historySnapshot<A, C>(
  activity: readonly A[],
  combat: Readonly<Record<string, readonly C[]>>,
) {
  return {
    merchantActivity: activity.slice(-500),
    combatLogs: Object.fromEntries(
      Object.entries(combat).map(([name, entries]) => [name, entries.slice(-500)]),
    ),
  };
}
