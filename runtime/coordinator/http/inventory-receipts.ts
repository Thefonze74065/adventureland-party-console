import { finishMerchantInterruption } from '../navigation/merchant-interruption.ts';
import type { DeliveryRequest } from '../merchant/delivery-recovery.ts';
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { receiveBankDeconstruction } from "../merchant/bank-deconstruction.ts";
import { receiveBankUpgrades } from '../inventory/bank-upgrade-receipts.ts';

interface ReceiptState {
  merchantDeliveries?: Record<string, DeliveryRequest[] | undefined>;
  merchantCharacter?: string | null;
  deconstructionMarks?: import("../merchant/deconstruction.ts").DeconstructionMark[];
  commands: Record<string, { id?: unknown; type: string } | undefined>;
  statScrolls: Record<string, unknown[] | undefined>;
  withdrawals: Record<string, unknown[] | undefined>;
  upgrades: Record<string, unknown[] | undefined>;
  purchases: Record<string, unknown[] | undefined>;
  compounds: Record<string, { id: unknown }[] | undefined>;
  bankCurrent: { name: string } | null;
  bankStartedAt: number;
  merchantCatalog?: { allItems?: { id: string; name?: string }[] } | null;
}
interface ReceiptPorts {
  owned(name: string): unknown;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  persistBank(): void;
  dispatchBank(): void;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Each receipt consumes one matching request; identical pending requests remain distinct. */
function consume(pending: unknown[] | undefined, receipts: unknown[]): void {
  for (const receipt of receipts) {
    const encoded = JSON.stringify(receipt);
    const index = (pending || []).findIndex((entry) => JSON.stringify(entry) === encoded);
    if (index >= 0) pending!.splice(index, 1);
  }
}

export function createInventoryReceiptRoutes(state: ReceiptState, ports: ReceiptPorts) {
  function statScrolls(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const pending = state.statScrolls[name] || [];
    consume(pending, list(body.resolved));
    for (const raw of list(body.activity)) {
      const entry = requestObject(raw);
      ports.log(
        requestText(entry.message || raw),
        requestText(entry.level || "info"),
        entry.details,
      );
    }
    for (const result of list(body.equipResults)) { equipmentLog(result,name); confirmDeliveryEquip(name,result); }
    if (state.commands[name]?.type === "apply-stat-scrolls") delete state.commands[name];
    ports.persist();
    return res.json({ ok: true, remaining: pending.length });
  }
  function equipmentLog(raw: unknown, name: string): void {
    const result = requestObject(raw),
      item = requestObject(result.item);
    const itemName = requestText(item.name || "delivered item");
    const displayName =
      state.merchantCatalog?.allItems?.find((entry) => entry.id === itemName)?.name || itemName;
    ports.log(
      (result.success ? "Equipped delivered " : "Could not equip delivered ") +
        displayName +
        " on " +
        name,
      result.success ? "success" : "error",
      result.error,
    );
  }
  function confirmDeliveryEquip(name: string, raw: unknown): void {
    const result = requestObject(raw);
    const marks = state.merchantDeliveries?.[name] || [];
    const index = marks.findIndex(mark => mark.awaitingEquip &&
      (result.deliveryId ? mark.id === result.deliveryId : !mark.id) && JSON.stringify(mark.item) === JSON.stringify(result.item));
    if (index < 0) return;
    if (result.success === true) marks.splice(index,1);
    else marks[index].equipFailedAt = Date.now();
  }
  function equipment(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const command = state.commands[name];
    if (!command || command.type !== "equip-deliveries" || command.id !== body.commandId)
      return res.status(409).json({ error: "equip-delivery command is no longer current" });
    for (const result of list(body.results)) { equipmentLog(result, name); confirmDeliveryEquip(name,result); }
    finishMerchantInterruption(state, name, command.id);
    delete state.commands[name];
    ports.persist();
    return res.json({ ok: true });
  }
  function improvements(name: string, body: Record<string, unknown>): void {
    const upgraded = list(body.upgraded),
      purchased = list(body.purchased),
      compounded = list(body.compounded);
    consume(state.upgrades[name], upgraded);
    consume(state.purchases[name], purchased);
    const compounds = state.compounds[name] || [];
    for (const id of compounded) {
      const index = compounds.findIndex((group) => group.id === id);
      if (index >= 0) compounds.splice(index, 1);
    }
    if (upgraded.length || purchased.length || compounded.length) ports.persist();
  }
  function bank(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (!state.bankCurrent || body.character !== state.bankCurrent.name)
      return res.status(409).json({ error: "character does not own the bank slot" });
    const name = state.bankCurrent.name,
      withdrawn = list(body.withdrawn);
    receiveBankDeconstruction({ ...state, merchantCharacter: state.merchantCharacter || null }, name, withdrawn, Date.now());
    receiveBankUpgrades(state, name, withdrawn);
    if (state.deconstructionMarks?.length) ports.persist();
    consume(state.withdrawals[name], withdrawn);
    if (withdrawn.length) ports.persistBank();
    improvements(name, body);
    if (["bank", "upgrade"].includes(state.commands[name]?.type || "")) delete state.commands[name];
    state.bankCurrent = null;
    state.bankStartedAt = 0;
    ports.dispatchBank();
    return res.json({ ok: true });
  }
  return { statScrolls, equipment, bank };
}
