import { requestObject, requestText } from "../http/contracts.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";

interface Entry extends InventoryEntry {
  slot: number;
  item: Item;
}
interface Status {
  items?: (Entry | null)[];
}
interface MerchantItemState {
  merchantCharacter: string | null;
  merchantWeapon: { item: Item } | null;
  statuses: Record<string, Status | undefined>;
  merchantCatalog?: { exchangeable?: { id: string; level?: number; reward?: unknown }[] } | null;
  autoExchanges: Record<string, { name: string; level: number }>;
  purchases: Record<string, { name: string }[] | undefined>;
}
interface Ports {
  selectAction?(item: Item, name: string): void;
  persist(): void;
  scheduleExchange(status: Status | undefined): void;
}
const weaponTypes = new Set([
  "mace",
  "staff",
  "bow",
  "spear",
  "short_sword",
  "fist",
  "dartgun",
  "dagger",
  "axe",
  "basher",
]);
export function merchantWeaponCompatible(definition: {type?: string; wtype?: string}): boolean {
  return definition.type === 'weapon' && weaponTypes.has(definition.wtype || '');
}
type Request = Record<string, unknown>;
function failure(message: string, status = 400): CommandOutcome {
  return { status, body: { error: message } };
}
export function createMerchantItemCommands(state: MerchantItemState, ports: Ports) {
  function weapon(body: Request, entry: Entry): CommandOutcome {
    const definition = entry.meta?.definition || {};
    if (!merchantWeaponCompatible(definition))
      return failure("select a normal merchant-compatible weapon");
    state.merchantWeapon = body.remove === true ? null : { item: requestObject(body.item) };
    ports.persist();
    return null;
  }
  function exchange(item: Item & { name: string }, status: Status | undefined): CommandOutcome {
    const level = Number(item.level) || 0;
    const choice = state.merchantCatalog?.exchangeable?.find(
      (entry) => !entry.reward && entry.id === item.name && (Number(entry.level) || 0) === level,
    );
    if (!choice) return failure("this item cannot be exchanged");
    const key = item.name + "@" + level;
    if (state.autoExchanges[key]) delete state.autoExchanges[key];
    else {
      ports.selectAction?.(item, String(state.merchantCharacter));
      state.autoExchanges[key] = { name: item.name, level };
    }
    ports.persist();
    ports.scheduleExchange(status);
    return null;
  }
  function selected(body: Request, item: Item & { name: string }): CommandOutcome {
    if (body.character !== state.merchantCharacter || !Number.isSafeInteger(body.slot))
      return undefined;
    const status = state.statuses[String(state.merchantCharacter)],
      entry = status?.items?.find((candidate) => candidate?.slot === body.slot);
    if (body.type === 'auto-exchange' && body.slot === -1) return exchange(item, status);
    if (!entry || JSON.stringify(entry.item) !== JSON.stringify(item))
      return failure("merchant inventory item changed; refresh and try again", 409);
    return body.type === "merchant-weapon" ? weapon(body, entry) : exchange(item, status);
  }
  function handle(body: Request): CommandOutcome {
    const item = requestObject(body.item);
    if (typeof item.name !== "string") return undefined;
    if (body.type === "buy-copy") {
      (state.purchases[requestText(body.character)] ||= []).push({ name: item.name });
      ports.persist();
      return null;
    }
    if (body.type !== "merchant-weapon" && body.type !== "auto-exchange") return undefined;
    return selected(body, item as Item & { name: string });
  }
  return { handle };
}
