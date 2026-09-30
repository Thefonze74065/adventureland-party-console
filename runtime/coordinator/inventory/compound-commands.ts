import { ruleOwner, type SharedScope } from "./shared-rules.ts";
import { requestObject, requestText } from "../http/contracts.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";

interface Entry extends InventoryEntry {
  slot: number;
  item: Item;
}
interface Group {
  id: string;
  name?: string;
  items: Entry[];
}
interface Rule {
  name: string;
  targetTier: number;
  quantity?: number;
}
interface CompoundState extends SharedScope {
  merchantCharacter: string | null;
  compounds: Record<string, Group[] | undefined>;
  autoCompounds: Record<string, Rule[] | undefined>;
  autoUpgradeMarks: Record<string, unknown>;
  upgrades: Record<string, { auto?: boolean }[] | undefined>;
  statuses: Record<string, { items?: (Entry | null)[] } | undefined>;
  merchantQueue: { reason: string }[];
  merchantCurrent: { reason: string } | null;
}
interface CompoundPorts {
  selectAction?(item: Item, name: string): void;
  queue?: (names:string[],reason:string) => void;
  persist(): void;
  schedule(name: string, status: CompoundState["statuses"][string]): void;
  log(message: string, level: string, details?: unknown): void;
}
type Request = Record<string, unknown>;
function reply(body: Record<string, unknown>, status = 200): CommandOutcome {
  return { status, body };
}
function same(entry: Entry, slot: number, item: Item): boolean {
  return entry.slot === slot && JSON.stringify(entry.item) === JSON.stringify(item);
}
function nextGroup(groups: Group[]): number {
  return (
    groups.reduce((highest, entry) => {
      const match = /^group-(\d+)$/.exec(entry.id);
      return Math.max(highest, match ? Number(match[1]) : 0);
    }, 0) + 1
  );
}
function quantityFor(body: Request, previous: Rule | undefined): number {
  if (body.quantity !== undefined) return Number(body.quantity);
  return previous && Number.isSafeInteger(Number(previous.quantity))
    ? Number(previous.quantity)
    : -1;
}
function validTier(tier: unknown): tier is number {
  return typeof tier === "number" && Number.isSafeInteger(tier) && tier >= 1 && tier <= 7;
}
export function createCompoundCommands(state: CompoundState, ports: CompoundPorts) {
  function remove(groups: Group[], slot: number, item: Item): CommandOutcome {
    const group = groups.find((entry) => entry.items.some((mark) => same(mark, slot, item)));
    if (group) {
      group.items = group.items.filter((mark) => !same(mark, slot, item));
      if (!group.items.length) groups.splice(groups.indexOf(group), 1);
      ports.persist();
    }
    return reply({ ok: true, compounds: groups });
  }
  function matching(name: string, groups: Group[], item: Item): Entry[] {
    const unavailable = new Set(groups.flatMap((group) => group.items.map((entry) => entry.slot)));
    return (state.statuses[name]?.items || []).filter(
      (entry): entry is Entry =>
        !!entry &&
        !unavailable.has(entry.slot) &&
        entry.item.name === item.name &&
        (entry.item.level || 0) === (item.level || 0),
    );
  }
  function manual(body: Request, item: Item): CommandOutcome {
    if (!Number.isSafeInteger(body.slot)) return undefined;
    const name = requestText(body.character),
      slot = body.slot as number,
      groups = (state.compounds[name] ||= []);
    if (body.remove === true) return remove(groups, slot, item);
    const matches = matching(name, groups, item),
      selected = matches.find((entry) => entry.slot === slot);
    if (!selected || matches.length < 3)
      return reply({ error: "couldn't make compounding group" }, 409);
    const next = nextGroup(groups),
      triplet = [selected, ...matches.filter((entry) => entry.slot !== slot).slice(0, 2)];
    groups.push({
      id: "group-" + next,
      name: "Group " + next,
      items: triplet.map((entry) => ({ slot: entry.slot, item: entry.item })),
    });
    ports.persist();
    ports.queue?.([name], "manual compounds");
    return null;
  }
  function automatic(body: Request, item: Item & { name: string }): CommandOutcome {
    if (!validTier(body.targetTier)) return undefined;
    const name = ruleOwner(state, requestText(body.character)),
      list = (state.autoCompounds[name] ||= []),
      index = list.findIndex((entry) => entry.name === item.name);
    if (body.remove === true) {
      if (index >= 0) list.splice(index, 1);
    } else {
      const quantity = quantityFor(body, list[index]);
      if (!Number.isSafeInteger(quantity) || (quantity !== -1 && quantity < 1))
        return reply({ error: "invalid automatic compound quantity" }, 400);
      const mark = { name: item.name, targetTier: body.targetTier, quantity };
      ports.selectAction?.(item, name);
      if (index >= 0) list[index] = mark;
      else list.push(mark);
    }
    ports.persist();
    ports.schedule(name, state.statuses[name]);
    return null;
  }
  function clear(body: Request, upgrades: boolean): CommandOutcome {
    const kind = upgrades ? "upgrades" : "compounds";
    if (body.character !== state.merchantCharacter)
      return reply({ error: "only the configured merchant can clear automatic " + kind }, 409);
    if (upgrades) {
      for (const name of Object.keys(state.autoUpgradeMarks)) state.autoUpgradeMarks[name] = {};
      for (const name of Object.keys(state.upgrades))
        state.upgrades[name] = (state.upgrades[name] || []).filter((entry) => !entry.auto);
      ports.persist();
      ports.log("Cleared all automatic upgrade rules", "info");
      return reply({ ok: true, autoUpgradeMarks: state.autoUpgradeMarks });
    }
    for (const name of Object.keys(state.autoCompounds)) state.autoCompounds[name] = [];
    const before = state.merchantQueue.length;
    state.merchantQueue = state.merchantQueue.filter((job) => job.reason !== "auto compound");
    ports.log("Cleared all automatic compound rules", "info", {
      queuedJobsRemoved: before - state.merchantQueue.length,
      activeJobFinishing: state.merchantCurrent?.reason === "auto compound",
    });
    ports.persist();
    return reply({ ok: true, autoCompounds: state.autoCompounds });
  }
  function handle(body: Request): CommandOutcome {
    if (body.type === "clear-auto-upgrades") return clear(body, true);
    if (body.type === "clear-auto-compounds") return clear(body, false);
    const item = requestObject(body.item);
    if (typeof item.name !== "string") return undefined;
    if (body.type === "compound-mark") return manual(body, item);
    if (body.type === "auto-compound-mark") return automatic(body, item as Item & { name: string });
    return undefined;
  }
  return { handle };
}
