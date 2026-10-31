import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";
import {
  createStorageReferenceUpdates,
  type StorageCompletionState,
  type StorageReference,
  type StorageDeposit,
  type BankboiInventory,
} from "../inventory/bankboi-completion.ts";

interface CompletionBody {
  character: string;
  error?: unknown;
  items?: (InventoryEntry | null)[];
  slots?: Record<string, unknown>;
  gold?: unknown;
  bank?: Record<string, unknown>;
  relocated?: StorageReference[];
  completed?: string[];
  deposited?: StorageDeposit[];
}
interface StorageState<Transaction> extends StorageCompletionState {
  bankbois: Record<string, BankboiInventory>;
  bankSnapshot: Record<string, unknown> | null;
  bankboiTransaction: Transaction | null;
  bankboiQueue: { id: string; bankboi?: string }[];
  commands: Record<string, unknown>;
}
interface StoragePorts<Transaction> {
  now(): number;
  identity(item: Item | null | undefined): string;
  log(message: string, level: string, details?: unknown): void;
  signature(entry: BankboiInventory): unknown;
  adopt(): void;
  persist(): void;
  persistJobs?(): void;
  pending(): boolean;
  restore(transaction: Transaction): Promise<void>;
}

export function createBankboiStorageRoutes<Transaction extends { bankboi: string; commandId?: number }>(
  state: StorageState<Transaction>,
  ports: StoragePorts<Transaction>,
) {
  const completedReports = new Set<string>();
  const references = createStorageReferenceUpdates(state, (item) => ports.identity(item));
  function observeBank(body: CompletionBody): boolean {
    if (!body.bank?.packs) return false;
    state.bankSnapshot = { ...body.bank, character: body.character, seenAt: ports.now() };
    return true;
  }
  function checkpoint(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (body.character !== state.merchantCharacter || !requestObject(body.bank).packs)
      return res.status(400).json({ error: "merchant bank snapshot required" });
    observeBank(body as unknown as CompletionBody);
    ports.adopt();
    ports.persist();
    return res.json({ ok: true, pending: ports.pending() });
  }
  function recordInventory(body: CompletionBody, entry: BankboiInventory): void {
    entry.items = Array.isArray(body.items) ? body.items : entry.items || [];
    entry.slots = body.slots || entry.slots || {};
    if (body.gold !== undefined) entry.gold = Number(body.gold) || 0;
    entry.seenAt = ports.now();
    if (!body.error) {
      entry.error = null;
      entry.state = "ready";
      entry.retryAt = 0;
    }
  }
  function recordMoves(body: CompletionBody, entry: BankboiInventory): void {
    references.relocated(body.character, body.relocated || []);
    if (body.relocated?.length)
      ports.log(
        "Returned " + body.relocated.length + " BankBoi inventory stacks to normal bank storage",
        "success",
        { bankboi: body.character },
      );
    entry.unloadBlockedSignature =
      !Array.isArray(body.relocated) || body.relocated.length || body.error
        ? null
        : ports.signature(entry);
    const completed = new Set(body.completed || []);
    state.bankboiQueue = state.bankboiQueue.filter((request) => !completed.has(request.id));
    references.deposited(body.deposited || []);
    persistCraftDeposits(body.deposited);
  }
  function persistCraftDeposits(deposits: StorageDeposit[] = []): void {
    if (deposits.some((deposit) => deposit.request?.craftJobId || deposit.request?.improvement === 'manual compounds')) ports.persistJobs?.();
  }
  function ownsCompletion(transaction: Transaction | null, raw: Record<string, unknown>): boolean {
    return !!transaction && transaction.bankboi === raw.character &&
      (transaction.commandId === undefined || raw.commandId === transaction.commandId);
  }
  function complete(req: HttpRequest, res: HttpResponse): unknown {
    const raw = requestObject(req.body),
      transaction = state.bankboiTransaction;
    const receipt = raw.commandId === undefined ? "" : requestText(raw.character) + ":" + requestText(raw.commandId);
    if (receipt && completedReports.has(receipt)) return res.json({ ok: true, duplicate: true });
    if (!ownsCompletion(transaction, raw))
      return res.status(409).json({ error: "bankboi does not own the storage transaction" });
    const body = raw as unknown as CompletionBody,
      entry = state.bankbois[body.character]!;
    if (body.error) {
      entry.state = "error";
      entry.error = body.error;
      entry.retryAt = ports.now() + 10000;
      ports.log("Bankboi storage failed", "error", { bankboi: body.character, error: body.error });
    }
    recordInventory(body, entry);
    const observed = observeBank(body);
    recordMoves(body, entry);
    if(body.relocated?.length)ports.persistJobs?.();
    if (observed) ports.adopt();
    delete state.commands[body.character];
    ports.persist();
    rememberCompletion(receipt);
    const response = res.json({ ok: true });
    ports
      .restore(transaction!)
      .catch((error) =>
        ports.log(
          "Merchant restoration after bankboi failed",
          "error",
          requestText(requestObject(error).message || error),
        ),
      );
    return response;
  }
  function rememberCompletion(receipt: string): void {
    if (receipt) {
      completedReports.add(receipt);
      if (completedReports.size > 32) completedReports.delete(completedReports.values().next().value!);
    }
  }
  return { checkpoint, complete };
}
