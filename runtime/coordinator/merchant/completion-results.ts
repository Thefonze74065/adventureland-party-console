import { acknowledgeDelivery, deliveryMatches, deliveryReady } from './delivery-recovery.ts';
import { pruneLuckCasts } from "./luck.ts";
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
    pruneLuckCasts(state.mluckCastAt, ports.now());
  }
  function upgrades(name: string | null, body: CompletionReport): void {
    if (body.upgradesResolved) {
      if (Array.isArray(body.upgradeMarksResolved))
        ports.clearUpgrades(name, body.upgradeMarksResolved);
      else state.upgrades[String(name)] = [];
    }
  }
  type StatReceipt = NonNullable<CompletionReport['statScrollsApplied']>[number];
  function appliedStatOriginal(receipt: StatReceipt): Record<string, unknown> | undefined {
    const mark=requestObject(receipt.mark), original=requestObject(mark.item), actual=receipt.item;
    if (mark.equipped || !Number.isSafeInteger(receipt.slot) || typeof mark.statType!=='string' || actual.stat_type!==mark.statType) return;
    const previous:Item={...actual};
    if(typeof original.stat_type==='string') previous.stat_type=original.stat_type;
    else delete previous.stat_type;
    if (deliveryMatches(previous,original) && deliveryMatches(original,previous)) return original;
  }
  function advanceStatDeliveries(receipt: StatReceipt, original: Record<string, unknown>, readyRecipients: Set<string>): void {
    const mark=requestObject(receipt.mark);
    // Only observed native mutation advances an item's reserved delivery identity.
    for(const [recipient,deliveries] of Object.entries(state.merchantDeliveries)) for(const delivery of deliveries || []) {
      if ((delivery.slot===mark.slot || delivery.slot===receipt.slot) && deliveryMatches(delivery.item,original) && deliveryMatches(original,delivery.item)) {
        delivery.item={...receipt.item};delivery.slot=receipt.slot;
        if(delivery.blocked==='Reserved delivery item missing') delete delivery.blocked;
        if(deliveryReady(delivery)) readyRecipients.add(recipient);
      }
    }
  }
  function appliedStatReceipts(name: string | null, body: CompletionReport): void {
    if (name !== state.merchantCharacter) return;
    const readyRecipients=new Set<string>();
    for (const receipt of body.statScrollsApplied || []) {
      const original = appliedStatOriginal(receipt);
      if (!original) continue;
      advanceStatDeliveries(receipt, original, readyRecipients);
      removeMatching(state.statScrolls[String(name)],[receipt.mark]);
    }
    // The dependency gate may have retired an empty delivery job. Native stat
    // completion is the wakeup: an idle recipient need not publish a full new bag.
    if(state.merchantAutomations?.deliveries!==false && readyRecipients.size)
      ports.queue([...readyRecipients], 'deliveries');
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
    if (current.reason === "send mail" && body.success === true) ports.mailSent?.(current.id, current.mail);
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
    appliedStatReceipts(name, body);
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
    const receipts = Array.isArray(body.merchantWithdrawalsDelivered) ? body.merchantWithdrawalsDelivered : [];
    for (const raw of state.compounds[String(state.merchantCharacter)] || []) {
      const group=requestObject(raw);
      for(const value of Array.isArray(group.items)?group.items:[]) {
        const mark=requestObject(value),source=requestObject(mark.storage);
        const received=receipts.map(value=>requestObject(value)).find(receipt=>receipt.pack===source.pack && receipt.slot===source.slot && deliveryMatches(requestObject(receipt.item),requestObject(mark.item)) && deliveryMatches(requestObject(mark.item),requestObject(receipt.item)));
        if(mark.storage && received && Number.isSafeInteger(received.inventorySlot)) {mark.storageReceived=true;mark.slot=received.inventorySlot;}
      }
    }
  }
  function realmFailure(body: CompletionReport): boolean {
    return !body.success && requestText(body.error || "").startsWith("merchant job failed: wrong realm");
  }
  return { resolve };
}
