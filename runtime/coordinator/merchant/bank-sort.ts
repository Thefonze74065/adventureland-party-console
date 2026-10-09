import { randomUUID } from "node:crypto";
import { requestObject, type HttpRequest, type HttpResponse } from "../http/contracts.ts";
import { craftProtection, type CraftReservationState } from './craft-reservations.ts';

export interface BankSortRequest {
  id: string;
  requestedAt: number;
  status: "queued" | "sorting" | "retry";
  runtime?: string;
  visit?: string;
  message?: string;
}
export interface BankSortState {
  bankSortMode?: "automatic" | "request";
  /** "gapped" starts each category on its own row and leaves free slots, so later sorts move few items. */
  bankSortLayout?: "packed" | "gapped";
  bankSortRequest?: BankSortRequest | null;
  merchantCharacter: string | null;
}
interface Ports {
  persist(): void;
  runtime?(name: string): string | undefined;
}

export function initialBankSort(saved: BankSortState | Partial<BankSortState>) {
  const bankSortMode = saved.bankSortMode === "request" ? "request" : "automatic";
  const pending = bankSortMode === "request" ? saved.bankSortRequest : null;
  return { bankSortMode: bankSortMode as "request" | "automatic",
    bankSortLayout: (saved.bankSortLayout === "gapped" ? "gapped" : "packed") as "packed" | "gapped",
    bankSortRequest: pending ? { ...pending, status: pending.status === "sorting" ? "retry" as const : pending.status,
      runtime: undefined, visit: undefined } : null };
}

function validConfiguration(body: Record<string, unknown>): boolean {
  return (body.mode === undefined || body.mode === "automatic" || body.mode === "request") &&
    (body.enabled === undefined || typeof body.enabled === "boolean") &&
    (body.layout === undefined || body.layout === "packed" || body.layout === "gapped");
}
function owns(pending: BankSortRequest, body: Record<string, unknown>): boolean {
  return pending.id === body.id && pending.runtime === body.runtime && pending.visit === body.visit;
}
function claim(pending: BankSortRequest, body: Record<string, unknown>): boolean {
  if (body.action !== "claim" || typeof body.visit !== "string" || typeof body.runtime !== "string") return false;
  if (!Number.isFinite(body.enteredAt)) return false;
  if (Number(body.enteredAt) <= pending.requestedAt && pending.status !== "retry") return false;
  pending.runtime = body.runtime; pending.visit = body.visit; pending.status = "sorting";
  pending.message = undefined;
  return true;
}
function currentRuntime(body: Record<string, unknown>, ports: Ports): boolean {
  return typeof body.character === "string" && typeof body.runtime === "string" &&
    body.runtime === ports.runtime?.(body.character);
}
function updatePending(state: BankSortState, body: Record<string, unknown>): boolean {
  const pending = state.bankSortRequest;
  if (!pending) return false;
  let changed = false;
  if (pending.runtime && pending.runtime !== body.runtime) {
    pending.status = "retry"; pending.runtime = undefined; pending.visit = undefined;
    pending.message = "Merchant restarted; retry pending";
    changed = true;
  }
  if (claim(pending, body)) return true;
  if (!owns(pending, body)) return changed;
  if (body.action === "complete") { state.bankSortRequest = null; return true; }
  if (body.action === "retry") {
    pending.status = "retry";
    pending.message = typeof body.message === "string" ? body.message.slice(0, 300) : "Interrupted; retry on next visit";
    return true;
  }
  return changed;
}

/** A request is a durable intent; a runtime/visit lease is never portable to another runner. */
export function createBankSortRoutes(state: BankSortState & CraftReservationState & {
  withdrawals?: Record<string, {pack?: string; slot?: number}[]>;
}, ports: Ports) {
  function reconcile() {
    const pending = state.bankSortRequest;
    if (!pending || pending.status !== "sorting") return;
    if (state.merchantCharacter && pending.runtime === ports.runtime?.(state.merchantCharacter)) return;
    pending.status = "retry";
    pending.message = "Merchant interrupted; retry on next visit";
    ports.persist();
  }
  function configure(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body);
    if (!validConfiguration(body)) return res.status(400).json({ error: "invalid bank sort setting" });
    if (body.mode === "request" || body.mode === "automatic") state.bankSortMode = body.mode;
    if (body.layout === "packed" || body.layout === "gapped") state.bankSortLayout = body.layout;
    if (state.bankSortMode !== "request" || body.enabled === false) state.bankSortRequest = null;
    else if (body.enabled === true && !state.bankSortRequest)
      state.bankSortRequest = { id: randomUUID(), requestedAt: Date.now(), status: "queued" };
    ports.persist();
    return res.json({ ok: true });
  }
  function checkpoint(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body);
    if (!currentRuntime(body, ports))
      return res.status(409).json({ error: "merchant runtime is no longer current" });
    if (body.action === 'stack') {
      const protection = craftProtection(state);
      return res.json({ protection: {
        locations: Object.values(state.withdrawals || {}).flat().map(({pack, slot}) => ({pack, slot})),
        items: protection.requirements.map(need => ({name: need.id, level: need.level})),
        ...(protection.error ? {error: protection.error} : {}),
      } });
    }
    if (body.character !== state.merchantCharacter)
      return res.json({ mode: state.bankSortMode || "automatic", layout: state.bankSortLayout || "packed", pending: null });
    if (updatePending(state, body)) ports.persist();
    return res.json({ mode: state.bankSortMode || "automatic", layout: state.bankSortLayout || "packed",
      pending: state.bankSortRequest || null });
  }
  return { configure, checkpoint, reconcile };
}
