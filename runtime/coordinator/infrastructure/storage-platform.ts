import type { InventoryEntry, Item } from "../contracts/item.ts";
import type { BankboiInventory, StorageReference } from "../inventory/bankboi-completion.ts";

interface StorageRoutingState {
  merchantCharacter: string | null;
  merchantCatalog?: unknown;
  bankSnapshot?: unknown;
  bankbois: Record<string, BankboiInventory>;
  withdrawals: Record<string, StorageReference[] | undefined>;
  bankboiQueue?: { id: string; slot?: number; item?: Item | null; state?: string }[];
}

/** Legacy routing accepts raw bank snapshots and preserves worker/item references. */
export interface BankStackRoutingPlatform {
  identity(this: void, item: unknown): string;
  homes(bank: unknown, workers: Record<string, BankboiInventory> | null | undefined, catalog?: unknown): unknown;
  storageSignature(
    state: { bankSnapshot?: unknown; withdrawals: unknown },
    worker: BankboiInventory,
  ): string;
  servicePlan(state: StorageRoutingState, options?: { includeCoolingDown?: boolean }): {
    candidate: BankboiInventory;
    routes: unknown;
    requests: { id: string }[];
    retrievals: StorageReference[];
  } | null;
}

interface MergeState {
  merchantCharacter: string | null;
  merchantCatalog?: unknown;
  merchantCurrent?: unknown;
  bankboiTransaction?: unknown;
}
interface MergeStatus {
  name?: string;
  items?: (InventoryEntry | null)[];
  inventoryStackRetryAt?: unknown;
  upgradeInventoryBusy?: unknown;
  banking?: unknown;
  gatheringActive?: unknown;
  anniversaryState?: { busy?: unknown };
  rip?: unknown;
}

/** A planned merge forwards the exact inventory items for execution-time revalidation. */
export interface InventoryStacksPlatform {
  plan(
    state: MergeState,
    status: MergeStatus | null | undefined,
    boundary?: {jobId?: unknown; commandId?: unknown; command?: unknown},
  ): {
    from: number;
    to: number;
    source: Item;
    target: Item;
    quantity: number;
  } | null;
}
