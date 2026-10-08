import { randomUUID } from 'node:crypto';
import type { DeliveryRequest } from '../merchant/delivery-recovery.ts';
import { requestObject, requestText } from "../http/contracts.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";
import type { MerchantCommand } from "../merchant/work.ts";
import { guardBankWithdrawal } from "./withdrawal-bank-guard.ts";
import { merchantWeaponCompatible } from './merchant-item-commands.ts';

interface Delivery extends DeliveryRequest {
  slot: number;
  item: Item;
  equipOnDelivery?: boolean;
  awaitingEquip?: boolean;
}
interface Withdrawal {
  pack: string;
  slot?: number;
  item?: Item | null;
}
type TransferState = Parameters<typeof guardBankWithdrawal>[0] & {
  statuses?: Record<string, (import("../contracts/position.ts").ObservedPosition & {items?: (InventoryEntry | null)[]}) | undefined>;
  merchantCharacter: string | null;
  merchantWeapon: { item?: Item } | null;
  merchantDeliveries: Record<string, Delivery[] | undefined>;
  withdrawals: Record<string, Withdrawal[] | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  bankbois: Record<string, { name: string; items?: (InventoryEntry | null)[] }>;
  commands: Record<string, MerchantCommand | undefined>;
  upgrades: Record<string, import('./upgrade-marks.ts').UpgradeMark[] | undefined>;
}
interface TransferPorts {
  managed(name: unknown): boolean;
  nextCommand(): number;
  removeReservations(name: string, slot: number, item: Item): void;
  clearIncoming(name: string, item: Item): void;
  sameItem(first: Item, second: Item): boolean;
  identity(item: Item | null | undefined): string;
  persist(): void;
  persistBank(): void;
  bankboi(): Promise<unknown>;
  log(message: string, level: string, details: unknown): void;
}
type Request = Record<string, unknown>;
function same(entry: Delivery, slot: number, item: Item): boolean {
  return entry.slot === slot && JSON.stringify(entry.item) === JSON.stringify(item);
}
function removingWithdrawal(body: Request, pending: Withdrawal[], item: Item): boolean {
  return body.markAll !== true && pending.some(entry =>
    JSON.stringify(entry) === JSON.stringify({ pack: body.pack, slot: body.slot, item }));
}
export function createTransferCommands(state: TransferState, ports: TransferPorts) {
  function rememberManualWeapon(body: Request, name: string, item: Item): void {
    if (name !== state.merchantCharacter) return;
    // Dashboard Equip sends an item fingerprint; native equip resolves its live
    // inventory position. An explicit slot, when supplied, still must match.
    const entry = state.statuses?.[name]?.items?.find(candidate => candidate?.item &&
      (body.slot === undefined || candidate.slot === body.slot) && ports.sameItem(candidate.item, item));
    if (!entry?.meta?.definition || typeof entry.slot !== 'number' || !merchantWeaponCompatible(entry.meta.definition)) return;
    state.merchantWeapon = {item};
    ports.removeReservations(name, entry.slot, item);
    ports.persist();
  }
  function equip(body: Request, name: string, item: Item): CommandOutcome {
    if (body.type === "equip") {
      rememberManualWeapon(body, name, item);
      state.commands[name] = { id: ports.nextCommand(), type: "equip", item };
      return null;
    }
    if (typeof body.slot !== "string" || !/^[a-z0-9_]+$/i.test(body.slot)) return undefined;
    if (
      name === state.merchantCharacter &&
      body.slot === "mainhand" &&
      state.merchantWeapon?.item &&
      ports.sameItem(state.merchantWeapon.item, item)
    ) {
      state.merchantWeapon = null;
      ports.persist();
    }
    state.commands[name] = { id: ports.nextCommand(), type: "unequip", slot: body.slot, item };
    return null;
  }
  function delivery(target: string, slot: number, item: Item, equipOnDelivery: boolean): void {
    const existing = (state.merchantDeliveries[target] || []).some(
      (entry) => same(entry, slot, item) && !!entry.equipOnDelivery === equipOnDelivery,
    );
    for (const name of Object.keys(state.merchantDeliveries))
      state.merchantDeliveries[name] = (state.merchantDeliveries[name] || []).filter(
        (entry) => !same(entry, slot, item),
      );
    if (!existing) (state.merchantDeliveries[target] ||= []).push({ id: randomUUID(), slot, item, equipOnDelivery });
  }
  function give(body: Request, name: string, item: Item): CommandOutcome {
    if (
      !Number.isSafeInteger(body.slot) ||
      !ports.managed(body.target) ||
      body.target === body.character
    )
      return undefined;
    const slot = body.slot as number,
      target = requestText(body.target);
    if (name !== state.merchantCharacter && !deliveryInRange(state.statuses?.[name], state.statuses?.[target]))
      return {status:409,body:{error:"Delivery target is out of range; item and marks retained"}};
    if (name === state.merchantCharacter) ports.removeReservations(name, slot, item);
    if (name === state.merchantCharacter)
      delivery(target, slot, item, body.equipOnDelivery === true);
    else {
      ports.clearIncoming(target, item);
      state.commands[name] = { id: ports.nextCommand(), type: "give", item, slot, target };
    }
    ports.persist();
    return null;
  }
  function addMatching(
    pending: Withdrawal[],
    entries: (InventoryEntry | null)[] | undefined,
    pack: string,
    identity: string,
  ): void {
    for (const entry of entries || []) {
      if (!entry || ports.identity(entry.item) !== identity) continue;
      const request = { pack, slot: entry.slot, item: entry.item },
        encoded = JSON.stringify(request);
      if (!pending.some((value) => JSON.stringify(value) === encoded)) pending.push(request);
    }
  }
  function all(pending: Withdrawal[], item: Item): void {
    const identity = ports.identity(item);
    for (const [pack, entries] of Object.entries(state.bankSnapshot?.packs || {}))
      addMatching(pending, entries, pack, identity);
    for (const bankboi of Object.values(state.bankbois))
      addMatching(pending, bankboi.items, "bankboi:" + bankboi.name, identity);
  }
  function validWithdrawal(body: Request): body is Request & { pack: string; slot: number } {
    return typeof body.pack === 'string' && /^(?:[a-z0-9_]+|bankboi:[A-Za-z0-9_]+)$/i.test(body.pack) && Number.isSafeInteger(body.slot);
  }
  function bankEntry(body: Request & { pack: string; slot: number }) {
    const entries = body.pack.startsWith('bankboi:') ? state.bankbois[body.pack.slice(8)]?.items : state.bankSnapshot?.packs?.[body.pack];
    return entries?.find(entry => entry?.slot === body.slot);
  }
  function validBankUpgrade(entry: InventoryEntry | null | undefined, item: Item, tiers: number): boolean {
    if (!entry?.item || !ports.sameItem(entry.item, item)) return false;
    if (!validUpgradeTiers(item, tiers)) return false;
    return !!entry.meta?.upgradeable && !item.l && !item.b;
  }
  function validUpgradeTiers(item: Item, tiers: number): boolean {
    return Number.isSafeInteger(tiers) && tiers >= 1 && tiers + (Number(item.level) || 0) <= 13;
  }
  function validateUpgrade(body: Request & { pack: string; slot: number }, name: string, item: Item): CommandOutcome {
    if (body.upgradeTiers === undefined) return null;
    if (name === state.merchantCharacter && validBankUpgrade(bankEntry(body), item, Number(body.upgradeTiers))) return null;
    return { status: 400, body: { error: 'Bank item is unavailable or cannot be upgraded' } };
  }
  function putBankUpgrade(body: Request & { pack: string; slot: number }, name: string, item: Item): void {
    if (body.upgradeTiers === undefined) return;
    const marks = state.upgrades[name] ||= [];
    const old = marks.find(mark => mark.storage?.pack === body.pack && mark.storage?.slot === body.slot);
    if (old) old.tiers = Number(body.upgradeTiers);
    else marks.push({ passId: randomUUID(), slot: -1, item: { ...item }, tiers: Number(body.upgradeTiers), storage: { pack: body.pack, slot: body.slot } });
    ports.persist();
  }
  function updateWithdrawal(pending: Withdrawal[], body: Request & { pack: string; slot: number }, item: Item): void {
    const request = { pack: body.pack, slot: body.slot, item }, encoded = JSON.stringify(request);
    const index = pending.findIndex(entry => JSON.stringify(entry) === encoded);
    if (index < 0) pending.push(request);
    else if (body.upgradeTiers === undefined) pending.splice(index, 1);
  }
  function withdraw(body: Request, name: string, item: Item): CommandOutcome {
    if (!validWithdrawal(body)) return undefined;
    const invalid = validateUpgrade(body, name, item);
    if (invalid) return invalid;
    const pending = state.withdrawals[name] || [];
    const upgrade = body.upgradeTiers !== undefined;
    if (upgrade || !removingWithdrawal(body, pending, item)) {
      const blocked = guardBankWithdrawal(state, name, item, body.removeAutoBankMark === true, () => ports.persist());
      if (blocked) return blocked;
    }
    state.withdrawals[name] = pending;
    if (body.markAll === true) all(pending, item);
    else updateWithdrawal(pending, body, item);
    putBankUpgrade(body, name, item);
    ports.persistBank();
    if (pending.some((request) => requestText(request.pack || "").startsWith("bankboi:")))
      void ports
        .bankboi()
        .catch((error: unknown) =>
          ports.log("Could not schedule bankboi retrieval", "error", {
            error: requestObject(error).message,
          }),
        );
    return null;
  }
  function handle(body: Request): CommandOutcome {
    const item = requestObject(body.item),
      name = requestText(body.character);
    if (typeof item.name !== "string") return undefined;
    switch (body.type) {
      case "use-item":
        if (!Number.isSafeInteger(body.slot) || Number(body.slot) < 0) return undefined;
        state.commands[name] = {id: ports.nextCommand(), type: "use-item", item, slot: Number(body.slot)};
        return null;
      case "equip":
      case "unequip":
        return equip(body, name, item);
      case "give":
        return give(body, name, item);
      case "withdraw":
        return withdraw(body, name, item);
      default:
        return undefined;
    }
  }
  return { handle };
}

function deliveryInRange(source: import('../contracts/position.ts').ObservedPosition | undefined, target: import('../contracts/position.ts').ObservedPosition | undefined): boolean {
  if (!source || !target || source.map !== target.map || source.in !== target.in || source.server !== target.server) return false;
  if (Date.now() - Number(source.seenAt) > 10000 || Date.now() - Number(target.seenAt) > 10000) return false;
  return Math.hypot(Number(source.x) - Number(target.x), Number(source.y) - Number(target.y)) <= 400;
}
