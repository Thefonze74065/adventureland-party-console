import { createBankSortRoutes, type BankSortState } from "../merchant/bank-sort.ts";
import { createMerchantSettingsRoutes } from "./merchant-settings.ts";
import { createRoutinePriorityRoute } from "./routine-priorities.ts";
import { createThresholdRoute } from "./thresholds.ts";
import type { MerchantCommand } from "../merchant/work.ts";

type SettingsPorts = Parameters<typeof createMerchantSettingsRoutes>[1];
type RoutinePorts = Parameters<typeof createRoutinePriorityRoute>[1];
interface ConfigurationState extends BankSortState {
  merchantCharacter: string | null;
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, {slot: number; rolls: number}>;
  gatheringModes: string[];
  gatheringNoTool: Record<string, boolean>;
  merchantActivity: unknown[];
  luckySlotTracking?: import("../../lucky-slot-tracking.ts").LuckySlotHistory;
  nextCommandId: number;
  commands: Record<string, MerchantCommand | undefined>;
  merchantCurrent: { id: string } | null;
  merchantRoutinePriorities: Record<string, number>;
  merchantAutomations: Record<string, boolean>;
  merchantQueue: Parameters<typeof createRoutinePriorityRoute>[0]["queue"];
  threshold: number;
  itemCollectionThreshold: number;
  buyUpgradeBatchSize?: number;
  transferSignatures: Record<string, unknown>;
}
type ConfigurationPorts = Omit<SettingsPorts, "nextCommand" | "command" | "currentJob"> &
  Omit<RoutinePorts, "bidPurchaseReasons"> & { bidPurchaseReasons: () => ReadonlySet<string>; runtime?: (name: string) => string | undefined };

/** Settings views retain write-through access even when reports and commands replace their collections. */
export function createCoordinatorMerchantConfiguration(
  state: ConfigurationState,
  ports: ConfigurationPorts,
) {
  const settings = createMerchantSettingsRoutes(
    {
      get merchant() {
        return state.merchantCharacter;
      },
      set merchant(value) {
        state.merchantCharacter = value;
      },
      get luckySlotTracking() { return state.luckySlotTracking; },
      get luckySlotResume() { return state.luckySlotResume; },
      set luckySlotResume(value) { state.luckySlotResume = value; },
      get luckySlotLocks() { return state.luckySlotLocks; },
      set luckySlotLocks(value) { state.luckySlotLocks = value; },
      get modes() {
        return state.gatheringModes;
      },
      set modes(value) {
        state.gatheringModes = value;
      },
      get noTool() {
        return state.gatheringNoTool;
      },
      get activity() {
        return state.merchantActivity;
      },
      set activity(value) {
        state.merchantActivity = value;
      },
    },
    {
      ...ports,
      nextCommand: () => state.nextCommandId++,
      command: (name, command) => {
        state.commands[String(name)] = command;
      },
      currentJob: () => state.merchantCurrent,
    },
  );
  function setGathering(values: Record<string, unknown>): void {
    let changed = false;
    for (const mode of ["fishing", "mining"]) {
      const enabled = values[mode];
      if (typeof enabled !== "boolean" || state.gatheringModes.includes(mode) === enabled) continue;
      changed = true;
      if (enabled) delete state.gatheringNoTool[mode];
      state.gatheringModes = enabled
        ? [...state.gatheringModes, mode]
        : state.gatheringModes.filter((entry) => entry !== mode);
    }
    if (changed && state.merchantCharacter)
      state.commands[state.merchantCharacter] = {
        id: state.nextCommandId++,
        type: "merchant-gather",
        modes: state.gatheringModes.slice(),
      };
  }
  const priorities = createRoutinePriorityRoute(
    {
      get priorities() {
        return state.merchantRoutinePriorities;
      },
      get automations() {
        return state.merchantAutomations;
      },
      get queue() {
        return state.merchantQueue;
      },
      set queue(value) {
        state.merchantQueue = value;
      },
    },
    {
      ...ports,
      gathering: setGathering,
      get bidPurchaseReasons() {
        return ports.bidPurchaseReasons();
      },
    },
  );
  const thresholds = createThresholdRoute(
    {
      get buyUpgradeBatchSize() { return state.buyUpgradeBatchSize ?? 1; },
      set buyUpgradeBatchSize(value) { state.buyUpgradeBatchSize = value; },
      get threshold() {
        return state.threshold;
      },
      set threshold(value) {
        state.threshold = value;
      },
      get itemCollectionThreshold() {
        return state.itemCollectionThreshold;
      },
      set itemCollectionThreshold(value) {
        state.itemCollectionThreshold = value;
      },
    },
    {
      collectionChanged: () => {
        state.transferSignatures = {};
      },
      persist: () => ports.persist(),
    },
  );
  return { settings: { ...settings, bankSort: createBankSortRoutes(state, ports) }, priorities, thresholds };
}
