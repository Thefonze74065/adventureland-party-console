import { admitMerchantInterruption, attachMerchantInterruption } from '../navigation/merchant-interruption.ts';
import { upgradeOfferingReady } from '../inventory/offering-waits.ts';
import { hasMarkedWithdrawals } from '../merchant/marked-withdrawals.ts';
import { deliveryReady, reconcileDeliveries, type DeliveryRequest } from '../merchant/delivery-recovery.ts';
import type { MerchantCommandReport } from "../merchant/recovery.ts";
import type { InventoryEntry, Item, ItemMark } from "../contracts/item.ts";
import type { createGiveawayScheduler } from "../merchant/giveaway-scheduler.ts";
import type { ObservedInventoryEntry } from "./observed-status.ts";

type GiveawayReport = NonNullable<
  Parameters<ReturnType<typeof createGiveawayScheduler>["schedule"]>[0]
>;

interface SchedulingReport extends GiveawayReport {
  name: string;
  merchantCommand?: MerchantCommandReport;
  items?: (ObservedInventoryEntry | null)[];
  gatheringCooldowns?: Record<string, number>;
  nearbyStandListings?: unknown;
}

interface SchedulingState {
  nextCommandId?: number;
  commands?: Record<string, {id?: number; type: string; items?: unknown[]; deliveryIds?: (string | undefined)[]} | undefined>;
  merchantDeliveries?: Record<string, DeliveryRequest[] | undefined>;
  withdrawals?: Record<string, unknown[] | undefined>;
  merchantCharacter: string | null;
  merchantCurrent: import('../merchant/work.ts').MerchantWork | null;
  merchantQueue: unknown[];
  merchantAutomations: Record<string, boolean | undefined>;
  gatheringModes: string[];
  gatheringCooldowns: Record<string, number | undefined>;
  merchantCapacityBlocked: boolean;
  transferSignatures: Record<string, string>;
  itemCollectionThreshold: number;
  upgrades: Record<string, unknown[] | undefined>;
  compounds: Record<string, unknown[] | undefined>;
  purchases?: Record<string, unknown[] | undefined>;
  statScrolls: Record<string, unknown[] | undefined>;
  marked: Record<string, ItemMark[] | undefined>;
  merchantMarked: Record<string, ItemMark[] | undefined>;
  statuses: Record<string, SchedulingReport | undefined>;
  bankCurrent: { name: string } | null;
  bankStartedAt: number;
  threshold: number;
  thresholdRunActive: boolean;
  bankCycleMembers: Record<string, boolean>;
}

interface SupplyRule {
  item: string;
  min: number;
  max: number;
}
interface SchedulingPorts {
  log?(message: string, level: string): void;
  reconcileItems(name: string, report: SchedulingReport): boolean;
  reconcileUpgrades(name: string, report: SchedulingReport): boolean;
  reconcileSales(report: SchedulingReport): boolean;
  luck(): void;
  recovery(name: string, items: SchedulingReport["items"], command?: MerchantCommandReport): void;
  standMarket(listings: unknown): boolean;
  giveaways(report: SchedulingReport): void;
  compounds(name: string, report: SchedulingReport | undefined): void;
  exchanges(report: SchedulingReport | undefined): void;
  policy(name: string): { hp: SupplyRule; mp: SupplyRule };
  queue(names: string[], reason: string): void;
  markedItem(mark: ItemMark): Item | null | undefined;
  sameItem(left: Item | null | undefined, right: Item | null | undefined): boolean;
  collectionSlots(name: string): number;
  standSync(): void;
  dispatch(): void;
  idle(): void;
  bankboi(): void;
  clearCommand(name: string): void;
  dispatchBank(): void;
  activeGold(): { name: string; gold: number }[];
  persist(): void;
  now(): number;
}

function freeSlots(items: SchedulingReport["items"]): number {
  return Array.isArray(items) ? items.filter((entry) => !entry).length : 0;
}

function countItem(items: (InventoryEntry | null)[], name: string): number {
  return items.reduce(
    (total, entry) => total + (entry?.item?.name === name ? Number(entry.item.q) || 1 : 0),
    0,
  );
}

function needsSupply(rule: SupplyRule, items: (InventoryEntry | null)[]): boolean {
  return rule.max > 0 && countItem(items, rule.item) <= rule.min;
}

/** Schedules work in heartbeat order, including dispatch before the reporting fighter's supplies. */
export function createMerchantScheduling(state: SchedulingState, ports: SchedulingPorts) {
  function reconcile(report: SchedulingReport, hadPreviousStatus: boolean): void {
    // Partial reconnect snapshots must not erase durable inventory intent.
    if (!hadPreviousStatus) return;
    const items = ports.reconcileItems(report.name, report);
    const upgrades = ports.reconcileUpgrades(report.name, report);
    const sales = ports.reconcileSales(report);
    if (items || upgrades || sales) ports.persist();
  }

  function cooldowns(report: SchedulingReport): void {
    if (!report.gatheringCooldowns) return;
    let changed = false;
    for (const mode of ["fishing", "mining"]) {
      const reported = Number(report.gatheringCooldowns[mode]) || 0;
      if (reported <= (Number(state.gatheringCooldowns[mode]) || 0)) continue;
      state.gatheringCooldowns[mode] = reported;
      changed = true;
    }
    if (changed) ports.persist();
  }

  function supplies(report: SchedulingReport): void {
    if (state.merchantAutomations.restock === false || !Array.isArray(report.items)) return;
    const policy = ports.policy(report.name);
    if (needsSupply(policy.hp, report.items) || needsSupply(policy.mp, report.items))
      ports.queue([report.name], "restock");
  }

  function merchantInventory(report: SchedulingReport): void {
    ports.exchanges(state.statuses[report.name]);
    supplies(report);
    const blocked = freeSlots(report.items) <= 3;
    if (blocked && !state.merchantCapacityBlocked) state.transferSignatures = {};
    state.merchantCapacityBlocked = blocked;
    if (hasMarkedWithdrawals(state.withdrawals?.[report.name])) ports.queue([report.name], 'withdrawals');
  }

  function upgradeWork(report: SchedulingReport) {
    const upgrades = (state.upgrades[report.name] || []).filter(mark => upgradeOfferingReady(state, mark));
    if (upgrades.some(mark => !(mark as {auto?: boolean})?.auto) || state.statScrolls[report.name]?.length) ports.queue([report.name], "manual upgrades");
    else clearEmptyManualUpgrade(report.name);
    if (state.merchantAutomations["auto upgrade"] !== false && upgrades.some(mark => (mark as {auto?: boolean})?.auto))
      ports.queue([report.name], report.name === state.merchantCharacter ? "auto upgrade" : "marked items");
  }
  function clearEmptyManualUpgrade(name: string) {
    state.merchantQueue = state.merchantQueue.filter(value => {
      const job = value as {target?: string; reason?: string};
      return job.target !== name || job.reason !== 'manual upgrades';
    });
  }
  function manualImprovements(report: SchedulingReport) {
    upgradeWork(report);
    if (state.compounds[report.name]?.length) ports.queue([report.name], "manual compounds");
    if (state.purchases?.[report.name]?.length) ports.queue([report.name], "manual buying");
    if (state.merchantAutomations.deliveries !== false &&
        (state.merchantDeliveries?.[report.name] || []).some(deliveryReady))
      ports.queue([report.name], "deliveries");
  }
  function collectionSignature(report: SchedulingReport): string {
    const marks = [
      ...(state.marked[report.name] || []).map((mark) => ({ mode: "bank", mark })),
      ...(state.merchantMarked[report.name] || []).map((mark) => ({ mode: "merchant", mark })),
    ].filter(({ mark }) =>
      (report.items || []).some(
        (entry) => entry && ports.sameItem(entry.item, ports.markedItem(mark)),
      ),
    );
    return JSON.stringify(
      marks.map(({ mode, mark }) => ({ mode, slot: mark.slot, item: ports.markedItem(mark) })),
    );
  }

  function collection(report: SchedulingReport): void {
    if (state.merchantAutomations["party collection"] === false) return;
    if (freeSlots(state.statuses[String(state.merchantCharacter)]?.items) <= 3) return;
    const signature = collectionSignature(report);
    if (
      ports.collectionSlots(report.name) >= state.itemCollectionThreshold &&
      state.transferSignatures[report.name] !== signature
    )
      ports.queue([report.name], "marked items");
    if (ports.collectionSlots(report.name) >= state.itemCollectionThreshold)
      state.transferSignatures[report.name] = signature;
    else delete state.transferSignatures[report.name];
  }

  function observeMerchant(report: SchedulingReport): void {
    cooldowns(report);
    ports.recovery(report.name, report.items, report.merchantCommand);
    if (ports.standMarket(report.nearbyStandListings)) ports.persist();
    ports.giveaways(report);
  }

  function fighterInventory(report: SchedulingReport): void {
    if (!Array.isArray(report.items)) return;
    supplies(report);
    if (freeSlots(report.items) <= 3 && state.merchantAutomations["inventory cleanout"] !== false)
      ports.queue([report.name], "inventory cleanout");
  }

  function recoverBank(): void {
    if (!state.bankCurrent || ports.now() - state.bankStartedAt <= 180000) return;
    ports.clearCommand(state.bankCurrent.name);
    state.bankCurrent = null;
    ports.dispatchBank();
  }

  function goldThreshold(): void {
    const names = ports
      .activeGold()
      .filter((entry) => entry.name !== state.merchantCharacter && entry.gold > state.threshold)
      .map((entry) => entry.name);
    if (!names.length) {
      state.thresholdRunActive = false;
      state.bankCycleMembers = {};
      return;
    }
    if (!state.thresholdRunActive) {
      state.thresholdRunActive = true;
      state.bankCycleMembers = {};
    }
    const newcomers = names.filter((name) => !state.bankCycleMembers[name]);
    for (const name of newcomers) state.bankCycleMembers[name] = true;
    if (state.merchantAutomations["gold threshold"] !== false)
      ports.queue(newcomers, "gold threshold");
  }

  function pendingEquipment(name: string): DeliveryRequest[] {
    return (state.merchantDeliveries?.[name] || []).filter(mark => mark.awaitingEquip && mark.item && mark.equipFailedAt === undefined);
  }
  const equipRetries = new Map<string, number>();
  function resumeDeliveryEquip(name: string): void {
    if (!state.commands || state.nextCommandId === undefined) return;
    if ((equipRetries.get(name) || 0) > ports.now()) return;
    const marks = pendingEquipment(name);
    const items = marks.map(mark => mark.item!);
    if (!items.length) return;
    if (!equipmentOwnsSlot(name)) return;
    const command = {id: state.nextCommandId++, type:'equip-deliveries', items, deliveryIds: marks.map(mark => mark.id)};
    attachMerchantInterruption(state, name, command);
    state.commands[name] = command;
    equipRetries.set(name, ports.now()+30000);
    ports.persist();
  }
  function equipmentOwnsSlot(name: string): boolean {
    const command = state.commands?.[name];
    if (command && command.type !== 'party-monster-travel') return false;
    const admitted = admitMerchantInterruption(state, name, 'delivery-equipment:' + name, ports.now(), 'equipment');
    if (!admitted) ports.persist();
    return admitted;
  }
  function reconcileDeliveryState(): void {
    const deliveryChanges = reconcileDeliveries(state.merchantDeliveries || {},
      state.statuses[String(state.merchantCharacter)], state.statuses, ports.now());
    if (deliveryChanges.length) {
      ports.persist();
      for (const message of deliveryChanges) ports.log?.(message, 'info');
    }
  }
  function observe(report: SchedulingReport, hadPreviousStatus: boolean): void {
    reconcileDeliveryState();
    resumeDeliveryEquip(report.name);
    const merchant = report.name === state.merchantCharacter;
    reconcile(report, hadPreviousStatus);
    ports.luck();
    if (merchant) observeMerchant(report);
    ports.compounds(report.name, state.statuses[report.name]);
    manualImprovements(report);
    if (merchant) merchantInventory(report);
    else collection(report);
    if (merchant) ports.standSync();
    if (state.merchantCurrent?.phase === 'switching party realm' ||
        !state.merchantCurrent && (state.merchantQueue.length || state.gatheringModes.length))
      ports.dispatch();
    else ports.idle();
    ports.bankboi();
    if (!merchant) fighterInventory(report);
    recoverBank();
    goldThreshold();
  }
  return { observe };
}
