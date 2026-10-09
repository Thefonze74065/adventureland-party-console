import { dungeonOwns } from '../../dungeons/contracts.ts';
import { realmRequestArrived, type RealmRequest } from '../characters/realm-request.ts';
import { pendingProduction, type ProductionState } from '../inventory/production.ts';
import { upgradeOfferingReady } from '../inventory/offering-waits.ts';
import { deliveryReady } from './delivery-recovery.ts';
import { merchantEventReserved, type MerchantEventState } from './event-control.ts';
import { ruleOwner } from "../inventory/shared-rules.ts";
import { routineEnabled } from './routines.ts';
import { craftProtection } from './craft-reservations.ts';
import { activeStandSales } from "./stand-reconciliation.ts";
import { hasWaitingUpgrade, sharedCompoundRules, sharedUpgradeRules, type BankImprovementState } from "./banked-improvements.ts";
import type { DeconstructionMark } from "./deconstruction.ts";
import { createMerchantDispatcher, type DispatchPorts } from "./dispatcher.ts";
import { readyNpcSales } from "./npc-sales.ts";
import type { BankboiInventory } from "../inventory/bankboi-completion.ts";
import type {
  CharacterWork,
  CommandInputs,
  MerchantCommand,
  MerchantWork,
  ServiceStatus,
} from "./work.ts";

interface DispatchCoordinatorState extends BankImprovementState, MerchantEventState {
  production: ProductionState;
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  nextCommandId: number;
  merchantCharacter: string | null;
  merchantHomeReturnAt?: unknown;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  bankbois?: Record<string, BankboiInventory>;
  bankboiTransaction: unknown;
  merchantForceStand: unknown;
  commands: Record<string, MerchantCommand | undefined>;
  gatheringModes: string[];
  gatheringCooldowns: Record<string, number | undefined>;
  statuses: Record<string, ServiceStatus | undefined>;
  activeRealm: string;
  aldata: { key: string };
  threshold: number;
  buyUpgradeBatchSize?: number;
  merchantCargo: unknown;
  deconstructionMarks?: DeconstructionMark[];
  npcSaleMarks?: Parameters<typeof readyNpcSales>[0];
  standListings?: { state?: string }[];
  marked: Record<string, CharacterWork["marked"] | undefined>;
  upgrades: Record<string, CharacterWork["upgrades"] | undefined>;
  purchases: Record<string, CharacterWork["purchases"] | undefined>;
  compounds: Record<string, CharacterWork["compounds"] | undefined>;
  autoCompounds: Record<string, CharacterWork["autoCompounds"] | undefined>;
  withdrawals: Record<string, CharacterWork["withdrawals"] | undefined>;
  statScrolls: CommandInputs["statScrolls"];
  merchantDeliveries: Record<string, CharacterWork["deliveries"] | undefined>;
  goldTargets: Record<string, number | undefined>;
}
type CompositionPorts = Pick<
  DispatchPorts,
  | "now"
  | "travel"
  | "headless"
  | "ensureHome"
  | "routineNeedsHome"
  | "startStorage"
  | "anniversary"
  | "routinePriority"
  | "priority"
  | "capacityBlocked"
  | "collectionReady"
  | "pick"
  | "stamp"
  | "planPonty"
  | "idle"
  | "persist"
  | "log"
> & {
  storageBusy: () => boolean;
  storagePlan: () => unknown;
  restock: CommandInputs["restock"];
};

function characterWork(state: DispatchCoordinatorState, name: string | null): CharacterWork {
  return {
    marked: state.marked[String(name)] || [],
    upgrades: (state.upgrades[String(name)] || []).filter(mark => upgradeOfferingReady(state, mark)),
    purchases: state.purchases[String(name)] || [],
    compounds: state.compounds[String(name)] || [],
    autoCompounds: state.autoCompounds[ruleOwner(state, String(name))] || [],
    withdrawals: state.withdrawals[String(name)] || [],
    statScrolls: state.statScrolls[String(name)] || [],
    deliveries: (state.merchantDeliveries[String(name)] || []).filter(deliveryReady),
    goldTarget: state.goldTargets[String(name)],
  };
}

function commandInputs(state: DispatchCoordinatorState, ports: CompositionPorts): CommandInputs {
  return {
    buyUpgradeBatchSize: state.buyUpgradeBatchSize ?? 1,
    craftProtection: craftProtection(state),
    bankUpgradeRules: state.merchantAutomations?.["auto upgrade"] === false ? [] : sharedUpgradeRules(state).filter(rule => rule.quantity !== 0 && !hasWaitingUpgrade(state, rule)),
    sharedAutoCompounds: state.merchantAutomations?.["auto compound"] === false ? [] : sharedCompoundRules(state).filter(rule => rule.quantity !== 0),
    bankboiItems: Object.values(state.bankbois || {}).flatMap((worker) => worker.items || []),
    merchant: state.merchantCharacter,
    activeRealm: state.activeRealm,
    aldataKey: state.aldata.key,
    threshold: state.threshold,
    gatheringModes: state.gatheringModes,
    cargo: state.merchantCargo,
    deconstructionMarks: (state.deconstructionMarks || []).filter(mark => mark.owner === state.merchantCharacter && mark.state === "ready"),
    npcSales: readyNpcSales(state.npcSaleMarks || [], ports.now()),
    standListings: activeStandSales(state.standListings || []),
    statScrolls: state.statScrolls,
    work: (name) => characterWork(state, name),
    restock: (name) => ports.restock(name),
  };
}

/** Dispatch policy receives live coordinator state; command payload arrays retain their original identity. */
export function createCoordinatorMerchantDispatcher(
  state: DispatchCoordinatorState,
  ports: CompositionPorts,
) {
  return createMerchantDispatcher(
    {
      get queue() {
        return state.merchantQueue;
      },
      set queue(value) {
        state.merchantQueue = value;
      },
      get current() {
        return state.merchantCurrent;
      },
      set current(value) {
        state.merchantCurrent = value;
      },
    },
    {
      ...ports,
      productionPending: () => pendingProduction(state.production),
      eventReserved: () => merchantEventReserved(state, ports.now()),
      enabled: job => !(job.target && dungeonOwns(state, job.target)) && routineEnabled(job, state.merchantAutomations || {}),
      nextCommand: () => state.nextCommandId++,
      merchant: () => state.merchantCharacter,
      returningHome: () => !!state.merchantHomeReturnAt && !state.merchantRealmRequests?.[String(state.merchantCharacter)]?.exhausted,
      homeBlocked: () => {
        const request = state.merchantRealmRequests?.[String(state.merchantCharacter)];
        const status = state.statuses[String(state.merchantCharacter)];
        if (!request || request.owner !== 'home' || request.realm !== state.activeRealm || !request.exhausted) return false;
        return !realmRequestArrived(status, request, ports.now());
      },
      bankboi: (name) => !!state.bankbois?.[String(name)],
      storagePending: () =>
        !!(ports.storageBusy() || state.bankboiTransaction || ports.storagePlan()),
      forcedStand: () => !!state.merchantForceStand,
      manualEquipmentPending: () =>
        ["equip", "unequip", "use-item"].includes(state.commands[String(state.merchantCharacter)]?.type ?? ""),
      gatheringModes: () => state.gatheringModes,
      gatheringCooldown: (mode) => state.gatheringCooldowns[mode],
      status: (name) => state.statuses[String(name)],
      inputs: () => commandInputs(state, ports),
      command: (name, command) => {
        state.commands[String(name)] = command;
      },
    },
  );
}
