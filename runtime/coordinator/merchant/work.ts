import type { BankUpgradeRule } from "./banked-improvements.ts";
import type { Entity } from 'typed-adventureland';
import type { InventoryEntry } from "../contracts/item.ts";
import type { CompoundRule, ExchangeLine } from "./automatic-improvements.ts";
import type { MerchantJob } from "./queue.ts";
import type { createStatScrollCommands } from "../inventory/stat-scroll-commands.ts";

/** Marketplace records retain vendor metadata that the character executor consumes. */
export interface MarketListing {
  [field: string]: unknown;
  key?: string;
  seller?: string;
  serverRegion?: string;
  serverIdentifier?: string;
  price?: number;
  quantity?: number;
  bidItemId?: string | null;
}

/** Work payloads are forwarded unchanged; execution belongs to the character runtime. */
export interface MerchantWork extends MerchantJob {
  operationStage?: import('./activity.ts').MerchantOperationStage;
  expiresAt?: number;
  destinationRealm?: string;
  realmStartedAt?: number;
  realmAttempts?: number;
  realmRetryExhausted?: boolean;
  realmBlockedReason?: string;
  realmError?: string;
  [field: string]: unknown;
  listings?: MarketListing[];
  pontyCandidates?: MarketListing[];
  pontyQuantity?: number;
  pontyPlanned?: boolean;
  manual?: boolean;
  amount?: number;
  itemId?: string;
  sellQuantity?: number;
  homeRealm?: string;
  completedListingKeys?: string[];
  acknowledgedPurchaseKeys?: string[];
  exchanges?: ExchangeLine[];
  exchangeRewards?: unknown[];
  exchangeResume?: boolean;
  autoExchangeKeys?: string[];
  pack?: string;
  floor?: string;
  gold?: number;
  seller?: string;
  slot?: string;
  rid?: string;
  realm?: string | null;
  expandLeaderCluster?: boolean;
  clusterExpanded?: boolean;
  expandLuckCluster?: boolean;
  castMerchantLuck?: boolean;
  radius?: number;
}

export interface ServiceStatus extends Partial<Pick<Entity, 'rip'>> {
  upgradeInventoryBusy?: boolean;
  gatheringPhase?: string;
  gatheringAttemptId?: string;
  seenAt: number;
  server?: string;
  map?: string;
  x?: number;
  y?: number;
  gold?: number;
  items?: (InventoryEntry | null)[];
}

export interface CharacterWork {
  marked: unknown[];
  upgrades: unknown[];
  purchases: unknown[];
  compounds: unknown[];
  autoCompounds: CompoundRule[];
  withdrawals: unknown[];
  statScrolls: NonNullable<Parameters<typeof createStatScrollCommands>[0]["statScrolls"][string]>;
  deliveries: import('./delivery-recovery.ts').DeliveryRequest[];
  goldTarget?: number;
}

export interface CommandInputs {
  buyUpgradeBatchSize?: number;
  craftProtection?: import("../../craft-reservations.ts").CraftProtection;
  bankUpgradeRules?: BankUpgradeRule[];
  sharedAutoCompounds?: (CompoundRule & {existingTargetQuantity?: number})[];
  bankboiItems?: (InventoryEntry | null)[];
  merchant: string | null;
  activeRealm: string;
  aldataKey: string;
  threshold: number;
  gatheringModes: string[];
  cargo: unknown;
  npcSales: unknown[];
  deconstructionMarks?: unknown[];
  standListings: unknown[];
  statScrolls: Parameters<typeof createStatScrollCommands>[0]["statScrolls"];
  work(name: string | null): CharacterWork;
  restock(name: string | null): unknown;
}

export interface MerchantCommand {
  id: number;
  type: string;
  jobId?: string;
  purpose?: string | null;
  [field: string]: unknown;
}
