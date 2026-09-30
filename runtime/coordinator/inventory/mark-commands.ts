import { ruleOwner, type SharedScope } from "./shared-rules.ts";
import { requestObject, requestText } from "../http/contracts.ts";
import type { Item } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";

interface Mark extends Item {
  slot?: number;
  item?: Item;
}
interface MarkState extends SharedScope {
  marked: Record<string, Mark[] | undefined>;
  merchantMarked: Record<string, Mark[] | undefined>;
  autoItemMarks: Record<string, Record<string, unknown> | undefined>;
  statuses: Record<string, { items?: unknown } | undefined>;
}
interface MarkPorts {
  selectAction?(item: Item, name: string, action: 'bank' | 'merchant'): void;
  key(item: Item): string;
  mode(rules: Record<string, unknown>, item: Item): unknown;
  reconcile(name: string, status: MarkState["statuses"][string]): void;
  persist(): void;
}
type Request = Record<string, unknown>;
function validAutomatic(body: Request): boolean {
  if (body.type === "auto-item-mark") return typeof requestObject(body.item).name === "string";
  return body.type !== "remove-auto-item-mark" || typeof body.ruleKey === "string";
}
export function createMarkCommands(state: MarkState, ports: MarkPorts) {
  function toggle(
    rules: Record<string, unknown>,
    item: Item & { name: string },
    mode: string,
    name: string,
  ): void {
    const key = ports.key(item);
    if (ports.mode(rules, item) === mode) delete rules[key];
    else {
      ports.selectAction?.(item, name, mode as 'bank' | 'merchant');
      rules[key] = mode;
    }
    if ((Number(item.level) || 0) === 0) delete rules[item.name];
  }
  function reconcileMembers(name: string) {
    for (const member of state.merchantRules?.members || [name]) ports.reconcile(member, state.statuses[member]);
  }
  function selectAutomatic(body: Request, rules: Record<string, unknown>, item: Item & { name: string }, mode: string, name: string): void {
    if (body.action !== 'set') return toggle(rules, item, mode, name);
    // Painting a rule is idempotent, including duplicate outcomes of the same item.
    ports.selectAction?.(item, name, mode as 'bank' | 'merchant');
    rules[ports.key(item)] = mode;
    if ((Number(item.level) || 0) === 0) delete rules[item.name];
  }
  function automatic(body: Request, name: string, mode: string): CommandOutcome {
    const item = requestObject(body.item);
    if (!validAutomatic(body)) return undefined;
    const rules = (state.autoItemMarks[ruleOwner(state, name)] ||= {});
    if (body.type === "auto-item-mark") {
      selectAutomatic(body, rules, item as Item & { name: string }, mode, name);
    } else if (body.type === "clear-auto-item-marks") {
      for (const key of Object.keys(rules)) if (rules[key] === mode) delete rules[key];
    } else if (typeof body.ruleKey === "string") {
      if (rules[body.ruleKey] === mode) delete rules[body.ruleKey];
    } else return undefined;
    reconcileMembers(name);
    ports.persist();
    return null;
  }
  function bank(name: string, slot: number, item: Item): null {
    const list = (state.marked[name] ||= []);
    const index = list.findIndex((entry) =>
      Number.isSafeInteger(entry?.slot)
        ? entry.slot === slot
        : JSON.stringify(entry) === JSON.stringify(item),
    );
    if (index >= 0) list.splice(index, 1);
    else {
      list.push({ slot, item });
      state.merchantMarked[name] = (state.merchantMarked[name] || []).filter(
        (entry) => entry.slot !== slot,
      );
    }
    ports.persist();
    return null;
  }
  function merchant(name: string, slot: number, item: Item): null {
    const list = (state.merchantMarked[name] ||= []),
      index = list.findIndex((entry) => entry.slot === slot);
    if (index >= 0) list.splice(index, 1);
    else {
      list.push({ slot, item });
      state.marked[name] = (state.marked[name] || []).filter(
        (entry) => !(Number.isSafeInteger(entry?.slot) && entry.slot === slot),
      );
    }
    ports.persist();
    return null;
  }
  function handle(body: Request): CommandOutcome {
    const name = requestText(body.character);
    if (
      ["auto-item-mark", "clear-auto-item-marks", "remove-auto-item-mark"].includes(
        requestText(body.type),
      )
    )
      return body.mode === "bank" || body.mode === "merchant"
        ? automatic(body, name, body.mode)
        : undefined;
    const item = requestObject(body.item);
    if (typeof item.name !== "string" || !Number.isSafeInteger(body.slot)) return undefined;
    if (body.type === "mark") return bank(name, body.slot as number, item);
    if (body.type === "merchant-mark") return merchant(name, body.slot as number, item);
    return undefined;
  }
  return { handle };
}
