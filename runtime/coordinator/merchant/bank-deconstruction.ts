import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { WithdrawalRequest } from "../inventory/exchange-storage.ts";
import { sameMarkedItem } from "../inventory/item-identity.ts";
import { deconstructable, type DeconstructionMark, type DeconstructionCatalog } from "./deconstruction.ts";
import { requestObject, type HttpResponse } from "../http/contracts.ts";

export interface BankDeconstructionState {
  merchantCharacter: string | null;
  deconstructionMarks: DeconstructionMark[];
  deconstructionCatalog: DeconstructionCatalog;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  bankbois?: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  withdrawals?: Record<string, WithdrawalRequest[] | undefined>;
}
interface Ports {
  now(): number; next(): number; persist(): void;
  queue(names: string[], reason: string): void;
  bankService?(): unknown;
  persistBank?(): void;
}
function sources(state: BankDeconstructionState) {
  return [...Object.entries(state.bankSnapshot?.packs || {}),
    ...Object.entries(state.bankbois || {}).map(([name, worker]) => [`bankboi:${name}`, worker?.items] as const)];
}
function matches(a: Item, b: Item) { return sameMarkedItem(a, b) && sameMarkedItem(b, a); }
export function markBankDeconstruction(state: BankDeconstructionState, ports: Ports, body: Record<string, unknown>, res: HttpResponse) {
  const item = requestObject(body.item) as Item, slot = Number(body.slot), pack = String(body.pack);
  const packs = sources(state);
  const selected = packs.find(([name]) => name === pack)?.[1]?.find((entry, index) => (entry?.slot ?? index) === slot)?.item;
  if (!state.merchantCharacter || !selected || !matches(selected, item))
    return res.status(409).json({ error: "Bank item changed; refresh and try again" });
  if (!deconstructable(selected, state.deconstructionCatalog))
    return res.status(400).json({ error: "Item cannot be deconstructed" });
  const targets = matchingTargets(state, item, pack, slot, body.all === true);
  const added = enqueue(state, ports, targets);
  ports.persistBank?.();
  ports.persist();
  if (added) schedule(state, ports);
  return res.json({ ok: true, added });
}
function matchingTargets(state: BankDeconstructionState, item: Item, pack: string, slot: number, all: boolean) {
  return sources(state).flatMap(([source, entries]) => (entries || []).flatMap((entry, index) => {
    const position = entry?.slot ?? index;
    if (!entry?.item || !matches(entry.item, item) || !deconstructable(entry.item, state.deconstructionCatalog)) return [];
    return all || source === pack && position === slot ? [{ pack: source, slot: position, item: entry.item }] : [];
  }));
}
export function enqueueAutomaticBankDeconstruction(state: BankDeconstructionState, ports: Ports, matchesRule: (item: Item) => boolean): void {
  const targets = sources(state).flatMap(([pack, entries]) => (entries || []).flatMap((entry, index) => {
    if (!entry?.item || !matchesRule(entry.item) || !deconstructable(entry.item, state.deconstructionCatalog)) return [];
    const slot = entry.slot ?? index;
    if (state.deconstructionMarks.some(mark => mark.storage?.pack === pack && mark.storage.slot === slot && ports.now() - mark.updatedAt < 60000)) return [];
    return [{ pack, slot, item: entry.item }];
  }));
  if (enqueue(state, ports, targets, true)) { ports.persistBank?.(); schedule(state, ports); }
}
function enqueue(state: BankDeconstructionState, ports: Ports, targets: { pack: string; slot: number; item: Item }[], auto = false) {
  const pending = (state.withdrawals ||= {});
  const merchant = state.merchantCharacter!;
  const withdrawals = (pending[merchant] ||= []);
  let added = 0;
  for (const target of targets) {
    if (state.deconstructionMarks.some(mark => mark.state !== "complete" && mark.storage?.pack === target.pack && mark.storage.slot === target.slot)) continue;
    if (Object.values(pending).some(requests => requests?.some(request => request.pack === target.pack && request.slot === target.slot))) continue;
    const id = "deconstruct-" + ports.next();
    state.deconstructionMarks.push({ id, origin: merchant, owner: merchant,
      slot: -1, storage: { pack: target.pack, slot: target.slot }, item: { ...target.item },
      quantity: Number(target.item.q) || 1, state: "withdrawing", auto, updatedAt: ports.now() });
    withdrawals.push({ ...target, deconstructionId: id }); added++;
  }
  return added;
}
function schedule(state: BankDeconstructionState, ports: Ports) {
    const withdrawals = state.withdrawals![state.merchantCharacter!]!;
    if (withdrawals.some(request => request.pack.startsWith("bankboi:"))) ports.bankService?.();
    if (withdrawals.some(request => !request.pack.startsWith("bankboi:"))) ports.queue([state.merchantCharacter!], "manual bank exchange");
}
export function receiveBankDeconstruction(state: { deconstructionMarks?: DeconstructionMark[]; merchantCharacter: string | null; withdrawals?: Record<string, unknown[] | undefined> }, name: string | null, receipts: unknown, now: number) {
  if (name !== state.merchantCharacter || !Array.isArray(receipts)) return;
  for (const receipt of receipts) {
    const mark = state.deconstructionMarks?.find(mark => mark.id === receipt?.deconstructionId && mark.state === "withdrawing");
    if (!mark) continue;
    if (receipt.deconstructionMissing) {
      mark.state = "blocked"; mark.error = "Bank item is missing; refresh storage and mark it again";
      if (state.withdrawals) state.withdrawals[String(name)] = (state.withdrawals[String(name)] || []).filter(request => requestObject(request).deconstructionId !== mark.id);
      continue;
    }
    mark.storageReceived = true;
    mark.state = "ready"; mark.slot = -1; mark.updatedAt = now;
  }
}
