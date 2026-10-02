import { ruleOwner, itemRuleConflicts, sharedMember, type ConflictState } from "../inventory/shared-rules.ts";
import type { Item, InventoryEntry, ItemMark } from "../contracts/item.ts";
import { markBankDeconstruction, enqueueAutomaticBankDeconstruction, type BankDeconstructionState } from "./bank-deconstruction.ts";
import { automaticCommerceRuleKey, sameMarkedItem } from "../inventory/item-identity.ts";
import { replaceAutomaticAction, type AutomaticActionState } from '../inventory/automatic-action.ts';
import {
  requestObject,
  requestText,
  type HttpRequest,
  type HttpResponse,
} from "../http/contracts.ts";

export interface DeconstructionMark {
  id: string;
  origin: string;
  owner: string;
  slot: number;
  item: Item;
  quantity: number;
  state: "collecting" | "withdrawing" | "ready" | "running" | "blocked" | "complete";
  storage?: { pack: string; slot: number };
  storageReceived?: boolean;
  auto?: boolean;
  error?: string;
  attempt?: string;
  jobId?: string;
  updatedAt: number;
}
export type DeconstructionRules = Record<string, Record<string, { item: Item }>>;
export type DeconstructionCatalog = Record<string, { compound: boolean; cost?: number; rewards?: { name: string; quantity: number; chance: number }[] }>;
export type DeconstructionState = ConflictState & BankDeconstructionState & AutomaticActionState & {
  deconstructionMarks: DeconstructionMark[];
  autoDeconstruction: DeconstructionRules;
  deconstructionCatalog: DeconstructionCatalog;
  merchantCharacter: string | null;
  merchantMarked: Record<string, ItemMark[] | undefined>;
  statuses: Record<string, { seenAt: number; items?: (InventoryEntry | null)[] } | undefined>;
  merchantCurrent: { id: string; reason: string } | null;
}
interface Ports {
  now(): number;
  next(): number;
  persist(): void;
  owned(name: string): unknown;
  queue(names: string[], reason: string): void;
  reserved(name: string, slot: number, item: Item): boolean;
  log(message: string, level: string): void;
  bankService?(): unknown;
  persistBank?(): void;
}
export function deconstructable(item: Item, catalog: DeconstructionCatalog): boolean {
  const definition = catalog[String(item.name)];
  return !!definition && !item.l && !item.b && (!definition.compound || Number(item.level) > 0);
}
export function buildDeconstructionCatalog(data: {
  dismantle?: Record<string, { cost: number; items?: [number, string][] }>;
  items?: Record<string, { compound?: unknown; type?: string }>;
}): DeconstructionCatalog {
  const catalog: DeconstructionCatalog = {};
  for (const [name, recipe] of Object.entries(data.dismantle || {}))
    catalog[name] = { compound: false, cost: recipe.cost, rewards: recipe.items?.map(([amount, name]) => ({
      name, quantity: Math.max(1, amount), chance: Math.min(1, amount),
    })) };
  for (const [name, definition] of Object.entries(data.items || {}))
    if (definition.compound && definition.type !== "booster" && !catalog[name])
      catalog[name] = { compound: true };
  return catalog;
}
export function receiveDeconstruction(
  state: Pick<DeconstructionState, "deconstructionMarks" | "merchantCharacter"> & { merchantMarked?: DeconstructionState["merchantMarked"] },
  owner: string,
  kept: unknown,
  now: number,
): void {
  if (!Array.isArray(kept) || !state.merchantCharacter) return;
  for (const raw of kept) {
    const entry = requestObject(raw);
    const mark = state.deconstructionMarks?.find(
      (m) => m.id === entry.deconstructionId && m.owner === owner && m.state === "collecting",
    );
    if (!mark) continue;
    const quantity = Number(entry.quantity);
    if (Number.isSafeInteger(quantity) && quantity > 0) mark.quantity = Math.min(mark.quantity, quantity);
    if (state.merchantMarked) state.merchantMarked[owner] = (state.merchantMarked[owner] || [])
      .filter(reservation => reservation.deconstructionId !== mark.id);
    mark.owner = state.merchantCharacter;
    mark.slot = -1;
    mark.state = "ready";
    mark.updatedAt = now;
  }
}
export function createDeconstruction(state: DeconstructionState, ports: Ports) {
  // A lost acknowledgement must never replay a destructive operation.
  for (const mark of state.deconstructionMarks)
    if (mark.state === "running") {
      mark.state = "blocked";
      mark.error = "Interrupted action: verify inventory before retrying";
    }
  function pending(mark: DeconstructionMark) {
    return mark.state !== "complete";
  }
  function release(mark: DeconstructionMark) {
    if (state.withdrawals) for (const name of Object.keys(state.withdrawals))
      state.withdrawals[name] = state.withdrawals[name]?.filter(request => request.deconstructionId !== mark.id);
    if (mark.storage) ports.persistBank?.();
    state.merchantMarked[mark.origin] = (state.merchantMarked[mark.origin] || []).filter(
      (entry) => entry.deconstructionId !== mark.id,
    );
  }
  function add(name: string, slot: number, item: Item, auto: boolean) {
    const existing = state.deconstructionMarks.find(
      (m) => m.owner === name && m.slot === slot && pending(m) && sameMarkedItem(item, m.item),
    );
    if (existing) return existing;
    const mark: DeconstructionMark = {
      id: "deconstruct-" + ports.next(),
      origin: name,
      owner: name,
      slot,
      item: { ...item },
      quantity: Math.max(1, Number(item.q) || 1),
      auto,
      updatedAt: ports.now(),
      state: name === state.merchantCharacter ? "ready" : "collecting",
    };
    state.deconstructionMarks.push(mark);
    return mark;
  }
  function reserve(mark: DeconstructionMark) {
    if (mark.state !== "collecting") return;
    const marks = (state.merchantMarked[mark.owner] ||= []);
    const existing = marks.find((m) => m.deconstructionId === mark.id);
    if (existing) existing.slot = mark.slot;
    else
      marks.push({
        slot: mark.slot,
        item: mark.item,
        quantity: mark.quantity,
        deconstructionId: mark.id,
      });
  }
  function automaticRule(name: string, item: Item) {
    return !itemRuleConflicts(state,item).length && !!state.autoDeconstruction[ruleOwner(state,name)]?.[automaticCommerceRuleKey(item)];
  }
  function automaticBank(name: string): void {
    if (name === state.merchantCharacter) enqueueAutomaticBankDeconstruction(state, ports, item => automaticRule(name, item));
  }
  function automatic(name: string, items: (InventoryEntry | null)[]) {
    if (!sharedMember(state,name)) return;
    automaticBank(name);
    for (const entry of items) {
      if (!entry?.item || !Number.isInteger(entry.slot)) continue;
      if (!automaticRule(name,entry.item)) continue;
      if (
        !deconstructable(entry.item, state.deconstructionCatalog) ||
        ports.reserved(name, entry.slot!, entry.item)
      )
        continue;
      // Do not recreate marks from a heartbeat sampled before the last acknowledgement.
      const recent = state.deconstructionMarks.some(
        (m) =>
          (m.owner === name || m.origin === name) &&
          sameMarkedItem(entry.item, m.item) &&
          ports.now() - m.updatedAt < 10000,
      );
      if (!recent) add(name, entry.slot!, entry.item, true);
    }
  }
  function held(mark: DeconstructionMark) {
    if (mark.state === "running" && state.merchantCurrent?.id !== mark.jobId) {
      mark.state = "blocked";
      mark.error = "Job interrupted: verify inventory before retrying";
    }
    return mark.state === "running" || mark.state === "blocked" || mark.state === "withdrawing";
  }
  function waitingForInventory(mark: DeconstructionMark, items: (InventoryEntry | null)[], used: Set<number>) {
    return ports.now() - mark.updatedAt < 10000 || items.some(e => e?.item && used.has(e.slot!) && sameMarkedItem(e.item, mark.item));
  }
  function conflictingAutomatic(mark: DeconstructionMark) { return mark.auto && itemRuleConflicts(state,mark.item).length > 0; }
  function reconcileMark(
    mark: DeconstructionMark,
    items: (InventoryEntry | null)[],
    used: Set<number>,
  ) {
    recoverMissingAutomatic(mark, items, used);
    if (held(mark)) return;
    if (conflictingAutomatic(mark)) {
      mark.state="blocked"; mark.error="Conflicting automatic rules"; release(mark); return;
    }
    const matches = (entry: InventoryEntry | null) =>
      !!entry?.item && !used.has(entry.slot!) && sameMarkedItem(entry.item, mark.item);
    const entry = items.find((e) => e?.slot === mark.slot && matches(e)) || items.find(matches);
    // Several withdrawn stacks may merge into one bag slot. Keep later marks
    // pending while the earlier mark consumes its own quantity from that stack.
    if (!entry && waitingForInventory(mark, items, used)) return;
    if (!entry) {
      mark.state = "blocked";
      mark.error = "Marked item is missing; refresh inventory before retrying";
      release(mark);
      return;
    }
    used.add(entry.slot!);
    mark.slot = entry.slot!;
    if (
      !deconstructable(entry.item!, state.deconstructionCatalog) ||
      ports.reserved(mark.owner, entry.slot!, entry.item!)
    ) {
      mark.state = "blocked";
      mark.error = "Item is protected or cannot be deconstructed";
      release(mark);
      return;
    }
    reserve(mark);
    ports.queue(
      [mark.owner],
      mark.state === "collecting" ? "marked items" : "deconstruction",
    );
  }
  function recoverMissingAutomatic(mark: DeconstructionMark, items: (InventoryEntry | null)[], used: Set<number>) {
    if (!mark.auto || mark.state !== 'blocked' || mark.storage || mark.attempt ||
        mark.error !== 'Marked item is missing; refresh inventory before retrying') return;
    if (!automaticRule(mark.owner, mark.item)) return;
    const entry = items.find(e => e?.item && !used.has(e.slot!) && sameMarkedItem(e.item, mark.item));
    if (!entry) return;
    mark.state = mark.owner === state.merchantCharacter ? 'ready' : 'collecting';
    delete mark.error;
  }
  function reconcile(name: string) {
    const status = state.statuses[name];
    if (!status || status.seenAt < ports.now() - 10000) return false;
    const before = JSON.stringify([state.deconstructionMarks, state.merchantMarked[name]]);
    const items = status.items || [];
    state.deconstructionMarks = state.deconstructionMarks.filter(
      (mark) => mark.state !== "complete" || ports.now() - mark.updatedAt < 60000,
    );
    automatic(name, items);
    const used = new Set<number>();
    for (const mark of state.deconstructionMarks.filter((m) => m.owner === name && pending(m)))
      reconcileMark(mark, items, used);
    const changed =
      before !== JSON.stringify([state.deconstructionMarks, state.merchantMarked[name]]);
    if (changed) ports.persist();
    return changed;
  }
  function markRoute(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (body.pack) return markBankDeconstruction(state, ports, body, res);
    if (!ports.owned(name) || !state.merchantCharacter)
      return res.status(400).json({ error: "Select an owned character and merchant" });
    const existing = state.deconstructionMarks.find(
      (m) => m.id === body.id && (m.owner === name || m.origin === name),
    );
    if (existing && (body.remove || body.retry)) return updateMark(existing, body, res);
    return createMark(name, body, res);
  }
  function updateMark(
    existing: DeconstructionMark,
    body: Record<string, unknown>,
    res: HttpResponse,
  ) {
    if (body.retry && existing.storage && !existing.storageReceived)
      return res.status(409).json({ error: "Remove this mark and mark the current bank item again" });
    if (existing.state === "running")
      return res.status(409).json({ error: "Deconstruction is already in progress" });
    if (body.remove) {
      release(existing);
      state.deconstructionMarks = state.deconstructionMarks.filter((m) => m !== existing);
    } else {
      existing.state = existing.owner === state.merchantCharacter ? "ready" : "collecting";
      delete existing.error;
    }
    ports.persist();
    reconcile(existing.owner);
    return res.json({ ok: true });
  }
  function liveMatches(live: Item | null | undefined, item: Item): live is Item {
    return !!live && !!item.name && sameMarkedItem(live, item);
  }
  function createMark(name: string, body: Record<string, unknown>, res: HttpResponse) {
    const status = state.statuses[name],
      slot = Number(body.slot),
      item = requestObject(body.item) as Item;
    const live = status?.items?.find((e) => e?.slot === slot)?.item;
    if (!status || status.seenAt < ports.now() - 10000 || !liveMatches(live, item))
      return res.status(409).json({ error: "Item changed; refresh and try again" });
    if (!deconstructable(live, state.deconstructionCatalog))
      return res.status(400).json({ error: "Item cannot be deconstructed" });
    if (ports.reserved(name, slot, live))
      return res.status(409).json({ error: "Remove the item's other work marks first" });
    add(name, slot, live, false);
    ports.persist();
    reconcile(name);
    return res.json({ ok: true });
  }
  function autoRoute(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body),
      name = requestText(body.character || ""),
      item = requestObject(body.item) as Item;
    if (!ports.owned(name) || !item.name)
      return res.status(400).json({ error: "Unknown character or item" });
    const rules = (state.autoDeconstruction[ruleOwner(state, name)] ||= {}),
      key = automaticCommerceRuleKey(item);
    if (body.remove) {
      delete rules[key];
      for (const mark of state.deconstructionMarks.filter(
        (m) =>
          m.origin === name &&
          m.auto &&
          m.state !== "running" &&
          automaticCommerceRuleKey(m.item) === key,
      )) {
        release(mark);
        state.deconstructionMarks = state.deconstructionMarks.filter((m) => m !== mark);
      }
    } else {
      if (!deconstructable(item, state.deconstructionCatalog))
        return res.status(400).json({ error: "Item cannot be deconstructed" });
      replaceAutomaticAction(state, name, item, 'deconstruction');
      rules[key] = { item };
    }
    ports.persist();
    reconcile(name);
    return res.json({ ok: true });
  }
  function receipt(mark: DeconstructionMark, body: Record<string, unknown>, res: HttpResponse) {
    if (body.attempt !== mark.attempt || mark.state !== "running")
      return res.status(409).json({ error: "Stale deconstruction receipt" });
    if (body.success === true) {
      mark.quantity--;
      mark.state = mark.quantity > 0 ? "ready" : "complete";
      ports.log("Deconstructed " + mark.item.name, "success");
    } else {
      mark.state = "blocked";
      mark.error = requestText(body.error || "Deconstruction failed");
    }
    mark.updatedAt = ports.now();
    ports.persist();
    return res.json({ ok: true, mark });
  }
  function stepRoute(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || job.id !== body.jobId || job.reason !== "deconstruction")
      return res.status(409).json({ error: "Deconstruction job is no longer current" });
    const mark = state.deconstructionMarks.find(
      (m) => m.id === body.id && m.owner === state.merchantCharacter,
    );
    if (!mark) return res.status(409).json({ error: "Deconstruction mark was removed" });
    if (body.action === "claim") {
      if (mark.state !== "ready")
        return res.status(409).json({ error: "Deconstruction mark is not ready" });
      if (ports.reserved(mark.owner, mark.slot, mark.item))
        return res.status(409).json({ error: "Item now has competing work" });
      mark.state = "running";
      mark.jobId = job.id;
      mark.attempt = String(ports.next());
      mark.updatedAt = ports.now();
    } else {
      return receipt(mark, body, res);
    }
    ports.persist();
    return res.json({ ok: true, mark });
  }
  return { reconcile, mark: markRoute, automatic: autoRoute, step: stepRoute };
}
