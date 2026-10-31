/** Persisted v1 keys are API contracts: keep them stable across coordinator builds. */
export const stateKeys = {
  bank: "party_dashboard_bank_state_v1",
  settings: "party_dashboard_settings_state_v1",
  selections: "party_dashboard_selections_state_v1",
  history: "party_dashboard_history_state_v1",
  roster: "party_dashboard_roster_state_v1",
  aldata: "party_dashboard_aldata_state_v1",
  /** Settings layout 2: the ALData market cache, saved on each refresh. */
  market: "party_dashboard_market_state_v1",
  /** Settings layout 2: the production receipts and attempt journals. */
  production: "party_dashboard_production_state_v1",
} as const;

/**
 * A settings document carrying this marker gets its market and production
 * fields from their own keys. Without it, the settings document is the only
 * source: a v1.4.0 journal, or settings rewritten by a v1.4.0 build.
 */
export const settingsLayout = { field: "persistenceLayout", split: 2 } as const;

export const rosterFields = [
  "characterSnapshots",
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
  "mailbox",
  "dailyDungeons",
  "merchantRules", "production", "upgradeOfferingRules", "upgradeChanceGuards", "upgradePreviewResults",
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
  "rareRetryEvidence",
  "rarePursuitProgress",
  "escape",
  "threshold",
  "itemCollectionThreshold", "buyUpgradeBatchSize",
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
  "marketIgnoredItems",
  "upgrades",
  "statScrolls",
  "purchases",
  "compounds",
  "autoCompounds",
  "autoExchanges",
  "goldTargets",
  "location",
  "leader",
  "designatedTank",
  "offTank",
  "pullMode",
  "gearSets",
  "followers",
  "eventsByCharacter",
  "eventSelectionsByCharacter", "eventPrioritiesByCharacter", "eventLimitsByCharacter", "eventAttendance",
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
  "alninja",
  "merchantCharacter",
  "merchantRealmRequests",
  "merchantForceStand",
  "merchantStandLocation",
  "merchantWeapon",
  "luckyUpgradeSlots",
  "luckySlotLocks",
  "luckySlotResume",
  "luckySlotTracking",
  "luckySlotCharacterIds",
  "merchantQueue",
  "merchantCurrent",
  "merchantCargo",
  "bankSortMode", "bankSortLayout", "bankSortRequest",
  "gatheringModes",
  "gatheringNoTool",
  "gatheringCooldowns",
  "mluckCastAt",
  "activeRealm",
  "bossChase",
  "realmHopBlacklist",
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

/** Settings fields that layout 2 saves under their own key. */
export const marketSettingsFields = [
  "aldataMarketListings", "aldataMarketBuyOrders", "aldataTrades",
  "aldataMerchantsUpdatedAt", "aldataTradesUpdatedAt",
] as const;
export const productionSettingsFields = ["production"] as const;

export function marketSnapshot(aldata: SettingsInput["aldata"]) {
  return {
    aldataMarketListings: aldata.marketListings,
    aldataMarketBuyOrders: aldata.marketBuyOrders,
    aldataTrades: aldata.trades,
    aldataMerchantsUpdatedAt: aldata.merchantsUpdatedAt,
    aldataTradesUpdatedAt: aldata.tradesUpdatedAt,
  };
}

/** Layout 2 settings: every settings field except the market cache and production. */
export const splitSettingsFields = settingsFields.filter(
  (field) => !(productionSettingsFields as readonly string[]).includes(field));

/**
 * Settings fields whose frequent changes are liveness timestamps. A save whose
 * only changes are those values waits for `SETTINGS_LIVENESS_MS` (writer.ts).
 */
export const livenessFields = new Set<string>([
  "eventAttendance", "eventSessions", "farmingProfiles", "farmAreaState", "standPriceHistory",
]);
const livenessKeys = new Set(["lastLiveAt", "lastObservedAt", "elapsedMs", "authorizedAt", "seenAt"]);

/**
 * JSON of a liveness field with its timestamps blanked. `quiet` keeps its area
 * keys and drops their times. `seen` is the 15 s hit filter in
 * scripts/farm-area-control.cjs and drops out.
 */
export function withoutLiveness(value: unknown): string | undefined {
  return JSON.stringify(value, (key, entry: unknown) => {
    if (typeof entry === "number" && livenessKeys.has(key)) return 0;
    if (key === "seen") return undefined;
    if (key === "quiet" && entry && typeof entry === "object") return Object.keys(entry);
    return entry;
  });
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
