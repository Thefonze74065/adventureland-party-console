import { acknowledgeDelivery } from './delivery-recovery.ts';
import { requestObject, requestText } from "../http/contracts.ts";
import { receiveBankDeconstruction } from "./bank-deconstruction.ts";
import { receiveBankUpgrades } from '../inventory/bank-upgrade-receipts.ts';
import type { Item } from "../contracts/item.ts";
import type {
  CompletionState,
  CompletionPorts,
  CompletionJob,
  CompletionReport,
} from "./completion-types.ts";

function removeMatching(pending: unknown[] | undefined, resolved: unknown[] | undefined): void {
  const list = pending || [];
  for (const item of resolved || []) {
    const encoded = JSON.stringify(item),
      index = list.findIndex((entry) => JSON.stringify(entry) === encoded);
    if (index >= 0) list.splice(index, 1);
  }
}

export function createCompletionResults(state: CompletionState, ports: CompletionPorts) {
  function search(body: CompletionReport): void {
    const report = body.standSearchResults;
    if (!report) return;
    const listings = Array.isArray(report.listings) ? report.listings : [];
    state.standSearch = {
      status: body.success ? "complete" : "error",
      itemId: report.itemId || null,
      listings,
      error: report.error || null,
      searchedAt: ports.now(),
    };
    state.standListingCache = (state.standListingCache || [])
      .filter((entry) => entry.item && entry.item.name !== report.itemId)
      .concat(listings)
      .slice(-500);
  }
  function cargo(body: CompletionReport): void {
    if (body.cargo && Array.isArray(body.cargo.bank) && Number.isFinite(Number(body.cargo.gold)))
      state.merchantCargo = { bank: body.cargo.bank, gold: Number(body.cargo.gold) };
  }
  function luck(body: CompletionReport): void {
    for (const recipient of body.mluckRecipients || [])
      if (typeof recipient === "string") state.mluckCastAt[recipient] = ports.now();
  }
  function upgrades(name: string | null, body: CompletionReport): void {
    if (body.upgradesResolved) {
      if (Array.isArray(body.upgradeMarksResolved))
        ports.clearUpgrades(name, body.upgradeMarksResolved);
      else state.upgrades[String(name)] = [];
    }
  }
  function successfulImprovements(name: string | null, body: CompletionReport): void {
    upgrades(name, body);
    removeMatching(state.statScrolls[String(name)], body.statScrollsResolved);
    if (
      body.statScrollsReady &&
      name !== state.merchantCharacter &&
      (state.statScrolls[String(name)] || []).length
    )
      state.commands[String(name)] = {
        id: ports.nextCommand(),
        type: "apply-stat-scrolls",
        items: state.statScrolls[String(name)] || [],
      };
    if (body.compoundsResolved) state.compounds[String(name)] = [];
  }
  function success(name: string | null, body: CompletionReport): void {
    luck(body);
    removeMatching(state.marked[String(name)], body.banked);
    successfulImprovements(name, body);
    // Release withdrawals only through explicit item receipts.
    if (body.purchasesResolved) state.purchases[String(name)] = [];
    removeMatching(state.merchantMarked[String(name)], body.kept);
    for (const [owner, banked] of Object.entries(body.bankedByCharacter || {}))
      removeMatching(state.marked[owner], banked);
  }
  function deliveries(name: string | null, body: CompletionReport): void {
    const equip: Item[] = [];
    const deliveryIds: (string | undefined)[] = [];
    for (const entry of body.merchantDeliveriesDelivered || []) {
      const resolved = acknowledgeDelivery(state.merchantDeliveries[String(name)] || [], entry);
      if (!resolved) continue;
      ports.clearIncoming(name, entry.item);
      if (entry.equipOnDelivery === true && entry.item) {
        equip.push(entry.item);
        deliveryIds.push(resolved.id);
      }
    }
    queueEquipment(name, equip, deliveryIds);
  }
  function queueEquipment(name: string | null, equip: Item[], deliveryIds: (string | undefined)[]): void {
    if (!equip.length) return;
    const identity = deliveryIds.some(Boolean) ? {deliveryIds} : {};
    const command = state.commands[String(name)];
    if (command?.type === 'apply-stat-scrolls') Object.assign(command, {equipItems: equip}, identity);
    // awaitingEquip persists the receipt until scheduling can safely own the slot.
    else if (!command) state.commands[String(name)] = {id: ports.nextCommand(), type: 'equip-deliveries', items: equip, ...identity};
  }
  function commerce(current: CompletionJob, body: CompletionReport): void {
    if (current.reason === "collect mail")
      ports.mailComplete(current.mail!.id, !!body.success, body.error);
    search(body);
    for (const purchase of body.bidPurchases || [])
      ports.fulfill(purchase.item || { name: purchase.itemId, level: 0 }, purchase.quantity);
  }
  function activity(body: CompletionReport): void {
    for (const raw of body.activity || []) {
      const entry = requestObject(raw);
      ports.log(
        requestText(entry.message || raw),
        requestText(entry.level || "info"),
        entry.details,
      );
    }
  }
  function resolve(current: CompletionJob, body: CompletionReport): void {
    const name = current.target;
    deconstructionReceipts(name, body);
    commerce(current, body);
    cargo(body);
    if (body.success || realmFailure(body)) success(name, body);
    // These receipts are final even if a later stage of this job failed.
    removeMatching(
      state.withdrawals[String(state.merchantCharacter)],
      body.merchantWithdrawalsDelivered,
    );
    removeMatching(state.marked[String(state.merchantCharacter)], body.merchantBanked);
    for (const id of body.npcSalesResolved || [])
      state.npcSaleMarks = state.npcSaleMarks.filter((entry) => entry.id !== id);
    deliveries(name, body);
    if (realmFailure(body) && body.pendingImprovedDeliveries?.length) {
      (state.merchantDeliveries[String(name)] ||= []).push(...body.pendingImprovedDeliveries);
    }
    activity(body);
    removeMatching(state.withdrawals[String(name)], body.confirmedWithdrawals);
    if (!body.success) luck(body);
  }
  function deconstructionReceipts(name: string | null, body: CompletionReport) {
    receiveBankDeconstruction(state, state.merchantCharacter, body.merchantWithdrawalsDelivered, ports.now());
    receiveBankDeconstruction(state, name, body.confirmedWithdrawals, ports.now());
    receiveBankUpgrades(state, state.merchantCharacter, body.merchantWithdrawalsDelivered);
    receiveBankUpgrades(state, name, body.confirmedWithdrawals);
  }
  function realmFailure(body: CompletionReport): boolean {
    return !body.success && requestText(body.error || "").startsWith("merchant job failed: wrong realm");
  }
  return { resolve };
}
