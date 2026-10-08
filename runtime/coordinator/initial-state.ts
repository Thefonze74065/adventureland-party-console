import {
  initialRecoveryState,
  initialPartySelection,
  initialEventState,
  initialMarketObservations,
  initialCatalogs,
} from "./initial-core.ts";
import { initialCollectionState } from "./inventory/initial-collection.ts";
import { initialMerchantSales } from "./merchant/initial-settings.ts";
import { initialItemIntents } from "./inventory/initial-intents.ts";
import { initialCommandState } from "./navigation/initial-commands.ts";
import { initialFarmingSelections } from "./navigation/initial-focus.ts";
import { initialFarmingState } from "./navigation/initial-farming.ts";
import { initialMerchantRuntime } from "./merchant/initial-runtime.ts";
import { initialCoordinatorHistory } from "./telemetry/initial-history.ts";
import { initialGatheringState } from "./merchant/initial-gathering.ts";
import { initialBankState } from "./inventory/initial-bank.ts";
import { initialSteamRoster } from "./characters/initial-roster.ts";
import { initialAnniversaryState } from "./anniversary/initial-state.ts";
import { initialALDataState } from "./commerce/initial-aldata.ts";
import type { SavedServiceSettings } from "./persistence/settings-contracts.ts";
import type { loadCoordinatorBankVaults } from "./infrastructure/game-data.ts";
import type { ResourceBlock } from "./merchant/queue.ts";

type Settings = Record<string, unknown> &
  SavedServiceSettings &
  Parameters<typeof initialRecoveryState>[0] &
  Parameters<typeof initialPartySelection>[0] &
  Parameters<typeof initialEventState>[0] &
  Parameters<typeof initialCollectionState>[0] &
  Parameters<typeof initialMerchantSales>[0] &
  Parameters<typeof initialItemIntents>[0] &
  Parameters<typeof initialCommandState>[0] &
  Parameters<typeof initialFarmingSelections>[0] &
  Parameters<typeof initialFarmingState>[0] &
  Parameters<typeof initialMerchantRuntime>[0] &
  Parameters<typeof initialGatheringState>[0] &
  Parameters<typeof initialCoordinatorHistory>[1] &
  Parameters<typeof initialALDataState>[1] & {
    anniversary?: Parameters<typeof initialAnniversaryState>[0];
  };
interface InitialStateInput {
  persistedSettings: Settings;
  persistedSelections: Parameters<typeof initialCollectionState>[1] &
    Parameters<typeof initialFarmingSelections>[1];
  persistedHistory: Parameters<typeof initialCoordinatorHistory>[0];
  persistedBankState: Parameters<typeof initialBankState>[0];
  persistedRoster: Parameters<typeof initialSteamRoster>[0];
  persistedALData: Parameters<typeof initialALDataState>[0];
  initialHeadless: (string | null)[];
  configuredRealm: string;
}
interface InitialStatePorts<Merchant extends string | null = string> {
  now: () => number;
  loadBankVaultDefinitions: () => ReturnType<typeof loadCoordinatorBankVaults>;
  merchantDefault?: Merchant;
}

/** Compose startup state in legacy evaluation order; runtime services reconcile it afterward. */
export function createInitialCoordinatorState<Merchant extends string | null = string>(
  input: InitialStateInput,
  ports: InitialStatePorts<Merchant>,
) {
  const {
    persistedSettings,
    persistedSelections,
    persistedHistory,
    persistedBankState,
    persistedRoster,
    persistedALData,
    initialHeadless,
    configuredRealm,
  } = input;
  return {
    gameVersion: 0,
    dailyDungeons: persistedSettings.dailyDungeons as import("../dungeons/contracts.ts").DungeonState | undefined,
    ...sharedSettings(persistedSettings),
    clientUpdate: null as import("./characters/client-updates.ts").ClientUpdateStatus | null,
    ...dashboardPreferences(persistedSettings),
    ...initialRecoveryState(persistedSettings),
    ...initialCollectionState(persistedSettings, persistedSelections),
    merchantDeliveries: persistedSettings.merchantDeliveries || {},
    ...initialMerchantSales(persistedSettings, ports.now),
    merchantJobBlocks: {} as Record<string, ResourceBlock>,
    standBids: Object.fromEntries(Object.entries(persistedSettings.standBids || {}).map(([id, bid]) => [id, { useStandSlot: false, acceptHigherLevels: true, ...bid }])),
    nativeStand: persistedSettings.nativeStand || { sequence: 0, offers: {}, problems: {} },
    autoStandBuys: persistedSettings.autoStandBuys === true,
    autoBlacklistMerchants: persistedSettings.autoBlacklistMerchants !== false,
    standPriceHistory: persistedSettings.standPriceHistory || {},
    merchantBlacklist: persistedSettings.merchantBlacklist || {},
    ...initialItemIntents(persistedSettings),
    ...initialCommandState(persistedSettings, ports.now),
    ...initialPartySelection(persistedSettings),
    ...initialFarmingSelections(persistedSettings, persistedSelections),
    ...initialFarmingState(persistedSettings, ports.now),
    characterLocations: persistedSettings.characterLocations || {},
    navigationIntents: persistedSettings.navigationIntents || {},
    restockPolicies: persistedSettings.restockPolicies || {},
    ...initialMerchantRuntime<Merchant>(persistedSettings, ports.merchantDefault),
    ...initialCoordinatorHistory(persistedHistory, persistedSettings),
    ...initialMarketObservations(),
    ...initialGatheringState(persistedSettings),
    ...initialBankState(persistedBankState, ports.loadBankVaultDefinitions),
    ...initialCatalogs(),
    headlessSlots: initialHeadless,
    ...initialSteamRoster(persistedRoster),
    ...initialEventState(persistedSettings, configuredRealm),
    anniversary: initialAnniversaryState(persistedSettings.anniversary),
    townCycle: persistedSettings.townCycle || null,
    merchantCapacityBlocked: false,
    transferSignatures: {} as Record<string, string>,
    aldata: initialALDataState(persistedALData, persistedSettings),
  };
}

function dashboardPreferences(saved: Record<string, unknown>) {
  return { bankboiPrefix: typeof saved.bankboiPrefix === "string" ? saved.bankboiPrefix : "", anniversaryAutoChat: saved.anniversaryAutoChat === true };
}

function sharedSettings(settings: Record<string, unknown>) {
  return { production: (settings.production || {attempts:{}}) as import("./inventory/production.ts").ProductionState,
    merchantRules: (settings.merchantRules || null) as import("./inventory/shared-rules.ts").SharedRules | null };
}
