import type { MaterialOrder, StorageAllocation } from "../merchant/order-types.ts";
import type { InventoryEntry, Item } from "../contracts/item.ts";
import { requestObject } from '../http/contracts.ts';

export interface StorageReference extends InventoryEntry {
  pack?: string;
  bankPack?: string;
  bankSlot?: number;
  mailJobId?: string;
  craftJobId?: string;
  allocationId?: string;
}
export interface StorageDeposit extends InventoryEntry {
  pack: string;
  request: StorageReference;
}
export interface BankboiInventory {
  name: string;
  items?: (InventoryEntry | null)[];
  slots?: Record<string, unknown>;
  gold?: number;
  state?: string;
  error?: unknown;
  retryAt?: number;
  seenAt?: number;
  createdAt?: number;
  unloadBlockedSignature?: unknown;
}
interface MailStorageJob {
  id: string;
  mail?: { source?: StorageReference };
  order?: MaterialOrder;
  blockedOnBankboi?: boolean;
}
export interface StorageCompletionState {
  standListings: StorageReference[];
  npcSaleMarks: StorageReference[];
  merchantQueue: MailStorageJob[];
  withdrawals: Record<string, StorageReference[] | undefined>;
  merchantCharacter: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  compounds?: Record<string, {items:{item:Item;storage?:{pack:string;slot:number}}[]}[] | undefined>;
}

/** Retarget durable item references as storage moves between bank panes and BankBoi. */
export function createStorageReferenceUpdates(
  state: StorageCompletionState,
  identity: (item: Item | null | undefined) => string,
) {
  function relocated(character: string, moves: StorageReference[]): void {
    for (const move of moves) {
      relocateListings(character, move);
      relocateManual(character, move);
    }
  }
  function relocateListings(character: string, move: StorageReference): void {
      for (const reference of [...state.standListings, ...state.npcSaleMarks]) {
        const packKey = Object.prototype.hasOwnProperty.call(reference, "bankPack")
          ? "bankPack"
          : "pack";
        const slotKey = packKey === "bankPack" ? "bankSlot" : "slot";
        if (
          reference[packKey] === "bankboi:" + character &&
          identity(reference.item) === identity(move.item)
        ) {
          reference[packKey] = move.pack;
          reference[slotKey] = move.slot;
        }
      }
  }
  function compoundMarks() {
    return (state.compounds?.[String(state.merchantCharacter)] || []).flatMap(group => group.items);
  }
  function moveCompounds(pack: string | undefined, slot: unknown, item: Item | null | undefined, destination: string, destinationSlot: number): void {
    for (const mark of compoundMarks()) {
      const source = mark.storage;
      if (source && source.pack === pack && source.slot === slot && identity(mark.item) === identity(item)) {
        source.pack = destination; source.slot = destinationSlot;
      }
    }
  }
  function relocateWithdrawals(pack: string, move: StorageReference): void {
    for (const request of state.withdrawals[String(state.merchantCharacter)] || []) {
      if (request.improvement === 'manual compounds' && request.pack === pack &&
        request.slot === move.sourceSlot && identity(request.item) === identity(move.item)) {
        request.pack = move.pack; request.slot = move.slot;
      }
    }
  }
  function relocateManual(character: string, move: StorageReference): void {
    // A manual selection can arrive after the worker captured its unload plan.
    // Follow that exact source slot if it was unloaded before retrieval began.
      if(typeof move.sourceSlot!=='number'||typeof move.slot!=='number'||typeof move.pack!=='string')return;
      const pack='bankboi:'+character;
      moveCompounds(pack, move.sourceSlot, move.item, move.pack, move.slot);
      relocateWithdrawals(pack, move);
  }
  function validCraftDeposit(allocation: StorageAllocation, deposit: StorageDeposit): boolean {
    return /^items\d+$/.test(deposit.pack) && Number.isInteger(deposit.slot) &&
      identity(allocation.item) === identity(deposit.item) &&
      (deposit.item?.q || 1) >= allocation.quantity;
  }
  function craftDeposit(deposit: StorageDeposit, withdrawals: StorageReference[]): void {
    const request = deposit.request;
    const job = state.merchantQueue.find((candidate) => candidate.id === request.craftJobId);
    const allocation = job?.order?.storage?.find((entry) => entry.allocationId === request.allocationId);
    if (allocation && !allocation.resolved) {
      if (!validCraftDeposit(allocation, deposit)) return;
      job!.order!.bank.push({ pack: deposit.pack, slot: deposit.slot,
        item: deposit.item!, quantity: allocation.quantity });
      allocation.resolved = true;
      job!.blockedOnBankboi = job!.order!.storage!.some((entry) => !entry.resolved);
    }
    const index = withdrawals.findIndex((entry) => entry.craftJobId === request.craftJobId &&
      entry.allocationId === request.allocationId);
    if (index >= 0) withdrawals.splice(index, 1);
  }
  function mailDeposit(deposit: StorageDeposit, withdrawals: StorageReference[]): void {
    const job = state.merchantQueue.find((job) => job.id === deposit.request.mailJobId);
    if (job?.mail) {
      job.mail.source = { pack: deposit.pack, slot: deposit.slot, item: deposit.item };
      job.blockedOnBankboi = false;
    }
    const index = withdrawals.findIndex(
      (request) => request.mailJobId === deposit.request.mailJobId,
    );
    if (index >= 0) withdrawals.splice(index, 1);
  }
  function moveReference(
    reference: StorageReference,
    deposit: StorageDeposit,
    packKey: "pack" | "bankPack",
    slotKey: "slot" | "bankSlot",
  ): void {
    if (
      reference[packKey] === deposit.request.pack &&
      reference[slotKey] === deposit.request.slot &&
      identity(reference.item) === identity(deposit.item)
    ) {
      reference[packKey] = deposit.pack;
      reference[slotKey] = deposit.slot;
    }
  }
  function normalDeposit(deposit: StorageDeposit, withdrawals: StorageReference[]): void {
    const encoded = JSON.stringify(deposit.request),
      index = withdrawals.findIndex((request) => JSON.stringify(request) === encoded);
    if (index >= 0)
      withdrawals[index] = { ...withdrawals[index], pack: deposit.pack, slot: deposit.slot, item: deposit.item };
    state.standListings.forEach((reference) =>
      moveReference(reference, deposit, "bankPack", "bankSlot"),
    );
    state.npcSaleMarks.forEach((reference) => moveReference(reference, deposit, "pack", "slot"));
    if (typeof deposit.slot === 'number')
      moveCompounds(deposit.request.pack, deposit.request.slot, deposit.item, deposit.pack, deposit.slot);
    upgradeDeposit(deposit);
  }
  function upgradeDeposit(deposit: StorageDeposit): void {
    for (const raw of state.upgrades?.[String(state.merchantCharacter)] || []) {
      const mark = requestObject(raw), storage = requestObject(mark.storage);
      if (mark.storage && storage.pack === deposit.request.pack && storage.slot === deposit.request.slot && identity(requestObject(mark.item)) === identity(deposit.item)) {
        storage.pack = deposit.pack; storage.slot = deposit.slot;
      }
    }
  }
  function deposited(deposits: StorageDeposit[]): void {
    const withdrawals = state.withdrawals[String(state.merchantCharacter)] || [];
    for (const deposit of deposits) {
      if (deposit.request?.craftJobId) craftDeposit(deposit, withdrawals);
      else if (deposit.request?.mailJobId) mailDeposit(deposit, withdrawals);
      else normalDeposit(deposit, withdrawals);
    }
  }
  return { relocated, deposited };
}
