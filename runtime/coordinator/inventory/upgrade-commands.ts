import { randomUUID } from 'node:crypto';
import { isUpgradeOffering, type UpgradeOffering } from '../../upgrade-offerings.ts';
import { offeringStock } from './offering-stock.ts';
import { ruleOwner, type SharedScope } from "./shared-rules.ts";
import { requestObject, requestText } from "../http/contracts.ts";
import type { Item } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";

interface Mark {
  slot: string | number;
  item: Item;
  tiers: number;
  equipped?: boolean;
  auto?: boolean;
  offering?: UpgradeOffering;
  requestId?: string;
}
type Rule = number | string | { tiers: number; quantity?: number };
interface UpgradeState extends SharedScope {
  upgrades: Record<string, Mark[] | undefined>;
  autoUpgradeMarks: Record<string, Record<string, Rule | undefined> | undefined>;
  goldTargets: Record<string, number>;
  statuses: Record<string, { items?: unknown } | undefined>;
}
interface UpgradePorts {
  selectAction?(item: Item, name: string): void;
  key(item: Item): string;
  persist(): void;
  queue(names: string[], reason: string): void;
  reconcile(name: string, status: UpgradeState["statuses"][string]): void;
}
type Request = Record<string, unknown>;
interface MarkRequest extends Request {
  item: Item & { name: string };
  slot: string | number;
}
function markRequest(body: Request): body is MarkRequest {
  return (
    typeof requestObject(body.item).name === "string" &&
    (Number.isSafeInteger(body.slot) ||
      (body.equipped === true && typeof body.slot === "string" && /^[a-z0-9_]+$/i.test(body.slot)))
  );
}
function validTiers(value: unknown, level: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 13 - level
  );
}
function failure(message: string, status = 400): CommandOutcome {
  return { status, body: { error: message } };
}

/** Upgrade intents retain their starting item; a retry must not reinterpret the target level. */
export function createUpgradeCommands(state: UpgradeState, ports: UpgradePorts) {
  function mark(body: MarkRequest, auto: boolean): CommandOutcome {
    const name = requestText(body.character),
      list = (state.upgrades[name] ||= []);
    if (auto) return automatic(body, name, list);
    const invalidOffering = validateManualOffering(state, body);
    if (invalidOffering) return invalidOffering;
    const index = list.findIndex(
      (entry) => entry.slot === body.slot && !!entry.equipped === (body.equipped === true),
    );
    if (body.remove === true) {
      if (index >= 0) list.splice(index, 1);
    } else if (validTiers(body.tiers, Number(body.item.level) || 0))
      put(list, index, body, body.tiers, false);
    else return failure("invalid upgrade tiers");
    saveAndQueue(name, body);
    return null;
  }
  function put(list: Mark[], index: number, body: MarkRequest, tiers: number, auto: boolean): void {
    const entry: Mark = {
      slot: body.slot,
      item: body.item,
      ...(body.equipped === true ? { equipped: true } : {}),
      tiers,
      ...(auto ? { auto: true } : {}),
      ...(!auto && isUpgradeOffering(body.offering) ? {offering:body.offering, requestId:randomUUID()} : {}),
    };
    if (index >= 0) list[index] = entry;
    else list.push(entry);
  }
  function removeAutomatic(name: string, key: string, list: Mark[]): void {
    state.upgrades[name] = list.filter((entry) => !(entry.auto && ports.key(entry.item) === key));
  }
  function saveAndQueue(name: string, body: Request, auto = false): void {
    ports.persist();
    if (body.remove !== true) ports.queue([name], auto ? "auto upgrade" : "manual upgrades");
  }
  function reconcileMembers(name: string) {
    for (const member of state.merchantRules?.members || [name]) ports.reconcile(member, state.statuses[member]);
  }
  function automatic(body: MarkRequest, name: string, list: Mark[]): CommandOutcome {
    const key = ports.key(body.item),
      rules = (state.autoUpgradeMarks[ruleOwner(state, name)] ||= {}),
      current = rules[key];
    const tiers = Number(current && typeof current === "object" ? current.tiers : current);
    if (body.remove === true) {
      delete rules[key];
      removeAutomatic(name, key, list);
    } else if (validTiers(body.tiers, Math.max(0, Number(body.item.level) || 0))) {
      ports.selectAction?.(body.item, name);
      rules[key] = { tiers: body.tiers, quantity: automaticQuantity(current, tiers === body.tiers) };
      putAutomatic(list, body, body.tiers);
    } else return failure("invalid automatic upgrade tiers");
    saveAndQueue(name, body, true);
    reconcileMembers(name);
    return null;
  }
  function putAutomatic(list: Mark[], body: MarkRequest, tiers: number): void {
    if (body.slot === -1) return;
    const index = list.findIndex(entry => entry.slot === body.slot && !!entry.equipped === (body.equipped === true));
    put(list, index, body, tiers, true);
  }
  function automaticQuantity(current: Rule | undefined, sameTiers: boolean): number {
    return sameTiers && typeof current === 'object' ? current.quantity ?? -1 : -1;
  }
  function updatedRule(
    body: Request,
    current: Rule | undefined,
    key: string,
  ): { tiers: number; quantity: number } | null {
    const existing =
      current && typeof current === "object" ? current : { tiers: Number(current), quantity: -1 };
    const tiers = body.tiers === undefined ? Number(existing.tiers) : Number(body.tiers);
    const quantity =
      body.quantity === undefined ? Number(existing.quantity) : Number(body.quantity);
    const levelMatch = /@\+(\d+)$/.exec(key),
      level = levelMatch ? Number(levelMatch[1]) : 0;
    if (
      !validTiers(tiers, level) ||
      !Number.isSafeInteger(quantity) ||
      (quantity !== -1 && quantity < 1)
    )
      return null;
    return { tiers, quantity };
  }
  function update(body: Request, key: string): CommandOutcome {
    const name = requestText(body.character),
      rules = (state.autoUpgradeMarks[ruleOwner(state, name)] ||= {});
    if (!Object.hasOwn(rules, key)) return failure("automatic upgrade rule not found", 404);
    const rule = updatedRule(body, rules[key], key);
    if (body.remove === true) delete rules[key];
    else if (rule) rules[key] = rule;
    else return failure("invalid automatic upgrade target");
    const list = (state.upgrades[name] ||= []);
    if (body.remove === true) removeAutomatic(name, key, list);
    else
      for (const entry of list)
        if (entry.auto && ports.key(entry.item) === key) entry.tiers = rule!.tiers;
    ports.persist();
    reconcileMembers(name);
    return null;
  }
  function gold(body: Request): CommandOutcome {
    if (
      typeof body.amount !== "number" ||
      !Number.isSafeInteger(body.amount) ||
      body.amount < 0 ||
      body.amount > 1000000000000
    )
      return undefined;
    state.goldTargets[requestText(body.character)] = body.amount;
    ports.persist();
    return null;
  }
  function handle(body: Request): CommandOutcome {
    switch (body.type) {
      case "gold-target":
        return gold(body);
      case "upgrade-mark":
        return markRequest(body) ? mark(body, false) : undefined;
      case "auto-upgrade-mark":
        return markRequest(body) ? mark(body, true) : undefined;
      case "update-auto-upgrade-rule":
        return typeof body.ruleKey === "string" ? update(body, body.ruleKey) : undefined;
      default:
        return undefined;
    }
  }
  return { handle };
}

function validateManualOffering(state: UpgradeState, body: Request): CommandOutcome {
  if (body.offering === undefined || body.remove === true) return null;
  if (!isUpgradeOffering(body.offering) || body.tiers !== 1) return failure("Invalid manual offering attempt");
  if (!offeringStock(state)[body.offering]) return failure("Offering no longer available in merchant inventory or bank", 409);
  return null;
}
