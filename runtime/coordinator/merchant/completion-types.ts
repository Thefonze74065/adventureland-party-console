import type { DeliveryRequest } from './delivery-recovery.ts';
import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { RecoverableWork } from "./recovery.ts";
import type { NpcSale } from "./npc-sales.ts";
import type { ResourceBlock } from "./queue.ts";
import type { UpgradeMark } from "../inventory/upgrade-marks.ts";

export interface DeliveryReceipt extends DeliveryRequest {
  awaitingEquip?: boolean;
  item?: Item;
  equipOnDelivery?: boolean;
}
export interface CompletionJob extends RecoverableWork {
  mail?: { id: string };
  handoff?: { cleanoutRemaining?: unknown; partial?: unknown } | null;
  retryCount?: number;
  rendezvousRetryCount?: number;
}
export interface CompletionReport {
  pendingImprovedDeliveries?: DeliveryReceipt[];
  jobId?: string;
  commandId?: number;
  failureKind?: string;
  success?: unknown;
  error?: unknown;
  standSearchResults?: { itemId?: string; listings?: { item?: Item }[]; error?: unknown };
  bidPurchases?: { item?: Item; itemId?: string; quantity: number }[];
  cargo?: { bank?: unknown[]; gold?: unknown };
  mluckRecipients?: unknown[];
  banked?: unknown[];
  upgradesResolved?: unknown;
  upgradeMarksResolved?: UpgradeMark[];
  statScrollsResolved?: unknown[];
  statScrollsReady?: unknown;
  compoundsResolved?: unknown;
  autoCompoundsResolved?: string[];
  withdrawalsDelivered?: unknown;
  purchasesResolved?: unknown;
  kept?: unknown[];
  bankedByCharacter?: Record<string, unknown[]>;
  merchantWithdrawalsDelivered?: unknown[];
  merchantBanked?: unknown[];
  npcSalesResolved?: string[];
  merchantDeliveriesDelivered?: DeliveryReceipt[];
  activity?: unknown[];
  confirmedWithdrawals?: unknown[];
  npcSalesBlocked?: { id: string; error?: unknown }[];
  deferredWork?: unknown;
}
export interface CompletionCommand {
  jobId?: unknown;
  deliveryIds?: (string | undefined)[];
  id?: number;
  type: string;
  items?: unknown[];
  equipItems?: Item[];
  npcSales?: { id: string }[];
}
export interface CompletionState {
  merchantAutomations?: Record<string, boolean>;
  merchantCharacter: string | null;
  merchantCurrent: CompletionJob | null;
  merchantQueue: CompletionJob[];
  commands: Record<string, CompletionCommand | undefined>;
  standSearch: unknown;
  standListingCache?: { item?: Item }[];
  merchantCargo: unknown;
  mluckCastAt: Record<string, number>;
  marked: Record<string, unknown[] | undefined>;
  upgrades: Record<string, unknown[] | undefined>;
  statScrolls: Record<string, unknown[] | undefined>;
  compounds: Record<string, unknown[] | undefined>;
  autoCompounds: Record<string, { name: string }[] | undefined>;
  withdrawals: Record<string, unknown[] | undefined>;
  purchases: Record<string, unknown[] | undefined>;
  merchantMarked: Record<string, unknown[] | undefined>;
  merchantDeliveries: Record<string, DeliveryReceipt[] | undefined>;
  npcSaleMarks: NpcSale[];
  deconstructionMarks?: import("./deconstruction.ts").DeconstructionMark[];
  merchantJobBlocks: Record<string, ResourceBlock>;
  bankSnapshot?: { gold?: number } | null;
  statuses: Record<string, { gold?: number; items?: (InventoryEntry | null)[] } | undefined>;
  aldata: { auth: unknown; authCheckedAt: number; key: string; error?: string | null };
}
export interface CompletionPorts {
  now(): number;
  nextCommand(): number;
  mailComplete(id: string, success: boolean, error: unknown): void;
  fulfill(item: Item, quantity: number): void;
  clearUpgrades(name: string | null, marks: UpgradeMark[]): void;
  clearIncoming(name: string | null, item: Item | undefined): void;
  log(message: string, level: string, details?: unknown): void;
  capacitySignature(name: string | null): string;
  persistALData(): void;
  fetchAuth(character: string | null, key: string): Promise<unknown>;
  publishALData(): void;
  schedule(callback: () => void, delay: number): void;
  stamp(job: CompletionJob): CompletionJob;
  queue(names: (string | null)[], reason: string): void;
  ensureHome(reason: string): void;
  persistBank(): void;
  persist(): void;
  dispatch(): void;
  pontyMatches(): boolean;
  aldataMatches(): unknown;
}
