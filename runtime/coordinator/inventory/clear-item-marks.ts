import { ruleOwner, type SharedScope } from "./shared-rules.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";
import { requestObject, requestText } from "../http/contracts.ts";
import { autoItemRuleKey, automaticCommerceRuleKey, sameMarkedItem } from "./item-identity.ts";

interface Mark { slot?: number | string; item?: Item; equipped?: boolean; auto?: boolean; tiers?: number; storage?: { pack: string; slot: number } }
interface Sale extends Mark {
  id?: string; source?: string; character?: string; owner?: string;
  state?: string; autoRuleKey?: string; bankPack?: string; bankSlot?: number; pack?: string;
}
interface State extends SharedScope {
  merchantCharacter: string | null;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  bankbois?: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  withdrawals?: Record<string, { pack: string; slot?: number; item?: Item | null; deconstructionId?: string; standListingId?: string }[] | undefined>;
  statuses: Record<string, { items?: (InventoryEntry | null)[]; slots?: Record<string, { item: Item } | null | undefined> } | undefined>;
  marked: Record<string, Mark[] | undefined>;
  merchantMarked: Record<string, Mark[] | undefined>;
  upgrades: Record<string, Mark[] | undefined>;
  statScrolls: Record<string, Mark[] | undefined>;
  compounds: Record<string, { items: Mark[] }[] | undefined>;
  autoItemMarks: Record<string, Record<string, unknown> | undefined>;
  autoUpgradeMarks: Record<string, Record<string, unknown> | undefined>;
  autoCompounds: Record<string, { name: string }[] | undefined>;
  autoExchanges: Record<string, unknown>;
  merchantWeapon: { item: Item } | null;
  autoNpcSales?: Record<string, { item: Item; character?: string }>;
  autoStandMarks?: Record<string, { item: Item }>;
  autoDeconstruction?: Record<string, Record<string, { item: Item }>>;
  npcSaleMarks?: Sale[];
  standListings?: Sale[];
  deconstructionMarks?: Sale[];
  merchantCurrent?: { reason: string; itemMarksCleared?: boolean } | null;
  merchantQueue?: { reason: string; autoExchangeKeys?: string[]; exchanges?: { id: string; level?: number }[] }[];
}
interface Ports { persist(): void; persistBank?(): void; changed(): void }
interface Selection { name: string; slot: string | number; item: Item; equipped: boolean }
const matches = (mark: Mark, selected: Selection) =>
  mark.slot === selected.slot && !!mark.equipped === selected.equipped && sameMarkedItem(selected.item, mark.item);

function selectedBankEntry(state: State, body: Record<string, unknown>, pack: string) {
  if (body.character !== state.merchantCharacter) return null;
  const entries = pack.startsWith('bankboi:') ? state.bankbois?.[pack.slice(8)]?.items : state.bankSnapshot?.packs?.[pack];
  return entries?.find(entry => entry?.slot === body.slot);
}
function bankSourceMatches(mark: Omit<Sale, 'item'> & { item?: Item | null }, body: Record<string, unknown>, item: Item): boolean {
  if (!sameMarkedItem(item, mark.item)) return false;
  return mark.storage?.pack === body.pack && mark.storage?.slot === body.slot ||
    mark.bankPack === body.pack && mark.bankSlot === body.slot ||
    mark.pack === body.pack && mark.slot === body.slot;
}
function clearBankSources(state: State, body: Record<string, unknown>, name: string, item: Item): void {
  if (typeof body.pack !== 'string') return;
  state.upgrades[name] = (state.upgrades[name] || []).filter(mark => !bankSourceMatches(mark, body, item));
  for (const field of ['npcSaleMarks', 'standListings', 'deconstructionMarks'] as const)
    state[field] = state[field]?.filter(mark => !bankSourceMatches(mark, body, item));
  if (state.withdrawals) state.withdrawals[name] = state.withdrawals[name]?.filter(request => !bankSourceMatches(request, body, item));
}
function persistStorage(body: Record<string, unknown>, ports: Ports): void {
  if (typeof body.pack === 'string') ports.persistBank?.();
}

function selectedEntry(state: State, body: Record<string, unknown>) {
  if (typeof body.pack === 'string') return selectedBankEntry(state, body, body.pack);
  const status = state.statuses[requestText(body.character)];
  if (body.equipped === true) return status?.slots?.[String(body.slot)];
  return status?.items?.find(candidate => candidate?.slot === body.slot);
}

function invalidateImprovements(state: State): void {
  const current = state.merchantCurrent;
  if (current && ["manual upgrades", "auto upgrade", "manual compounds", "auto compound", "upgrades and compounds", "npc sales", "auto npc sales", "deconstruction", "stand maintenance", "exchange"].includes(current.reason))
    current.itemMarksCleared = true;
}

function clearUpgrades(state: State, selected: Selection): void {
  const keys = new Set([autoItemRuleKey(selected.item)]);
  const marks = state.upgrades[selected.name] || [];
  for (const mark of marks)
    if (upgradeMatches(mark, selected) && mark.auto) keys.add(autoItemRuleKey(mark.item));
  for (const key of keys) delete state.autoUpgradeMarks[ruleOwner(state, selected.name)]?.[key];
  state.upgrades[selected.name] = marks.filter(mark => !upgradeMatches(mark, selected));
  for (const name of members(state,selected.name))
    state.upgrades[name] = state.upgrades[name]?.filter(mark => !(mark.auto && keys.has(autoItemRuleKey(mark.item))));
}

function upgradeMatches(mark: Mark, selected: Selection): boolean {
  if (mark.slot !== selected.slot || !!mark.equipped !== selected.equipped || !mark.item) return false;
  const start = Number(mark.item.level) || 0, level = Number(selected.item.level) || 0;
  return level >= start && level <= start + Number(mark.tiers || 0) &&
    sameMarkedItem({ ...selected.item, level: mark.item.level }, mark.item);
}

function clearLocal(state: State, selected: Selection): void {
  const { name, item } = selected, key = autoItemRuleKey(item);
  clearUpgrades(state, selected);
  for (const field of [state.autoItemMarks, state.autoUpgradeMarks]) {
    delete field[ruleOwner(state, name)]?.[key];
    if (!Number(item.level)) delete field[ruleOwner(state, name)]?.[String(item.name)];
  }
  for (const field of [state.marked, state.merchantMarked, state.upgrades, state.statScrolls])
    field[name] = (field[name] || []).filter(mark => !matches(mark, selected) && !(mark.auto && autoItemRuleKey(mark.item) === key));
  clearSharedCollection(state,name,key);
  state.compounds[name] = (state.compounds[name] || []).filter(group => !group.items.some(mark => matches(mark, selected)));
  state.autoCompounds[ruleOwner(state, name)] = (state.autoCompounds[ruleOwner(state, name)] || []).filter(rule => rule.name !== item.name);
}

function clearQueuedExchanges(state: State, key: string): void {
  if (!state.merchantQueue) return;
  state.merchantQueue = state.merchantQueue.filter(job => {
    if (job.reason !== "exchange" || !job.autoExchangeKeys?.includes(key)) return true;
    job.autoExchangeKeys = job.autoExchangeKeys.filter(value => value !== key);
    job.exchanges = job.exchanges?.filter(line => line.id + "@" + (Number(line.level) || 0) !== key);
    return job.autoExchangeKeys.length > 0;
  });
}

function clearMerchantRules(state: State, selected: Selection): void {
  if (ruleOwner(state, selected.name) !== state.merchantCharacter) return;
  const item = selected.item;
  delete state.autoStandMarks?.[automaticCommerceRuleKey(item)];
  delete state.autoExchanges[String(item.name) + "@" + (Number(item.level) || 0)];
  clearQueuedExchanges(state, String(item.name) + "@" + (Number(item.level) || 0));
  if (sameMarkedItem(item, state.merchantWeapon?.item)) state.merchantWeapon = null;
}

function clearRules(state: State, selected: Selection): Set<string> {
  const { name, item } = selected, key = automaticCommerceRuleKey(item), removed = new Set<string>();
  for (const [ruleKey, rule] of Object.entries(state.autoNpcSales || {})) {
    const owner = rule.character || state.merchantCharacter;
    if (owner === ruleOwner(state, name) && automaticCommerceRuleKey(rule.item) === key) {
      delete state.autoNpcSales![ruleKey];
      removed.add(ruleKey);
    }
  }
  delete state.autoDeconstruction?.[ruleOwner(state, name)]?.[key];
  if (ruleOwner(state, name) === state.merchantCharacter) removed.add(key);
  clearMerchantRules(state, selected);
  return removed;
}

function owned(mark: Sale, state: State, selected: Selection): boolean {
  if (mark.bankPack || mark.source === "bank") return false;
  return (mark.owner || mark.character || state.merchantCharacter) === selected.name;
}

function clearSales(state: State, selected: Selection, removed: Set<string>): void {
  const removedIds = new Set<string>();
  for (const field of ["npcSaleMarks", "standListings", "deconstructionMarks"] as const) {
    if (!state[field]) continue;
    state[field] = state[field]!.filter(mark => {
      const direct = owned(mark, state, selected) && matches(mark, selected);
      const automatic = automaticRemoved(mark, field, state, selected, removed);
      if (!direct && !automatic) return true;
      if (mark.id) removedIds.add(mark.id);
      return false;
    });
  }
  for (const [name, marks] of Object.entries(state.merchantMarked))
    state.merchantMarked[name] = marks?.filter(mark => {
      const reservation = mark as Mark & { npcSaleId?: string; deconstructionId?: string };
      return !removedIds.has(reservation.npcSaleId || "") && !removedIds.has(reservation.deconstructionId || "");
    });
}

function automaticRemoved(mark: Sale, field: string, state: State, selected: Selection, removed: Set<string>): boolean {
  if (!mark.auto) return false;
  if (field === "deconstructionMarks")
    return (state.merchantRules ? true : owned(mark, state, selected)) && automaticCommerceRuleKey(mark.item) === automaticCommerceRuleKey(selected.item);
  return !!mark.autoRuleKey && removed.has(mark.autoRuleKey);
}

function markSnapshot(state: State): string {
  return JSON.stringify([state.marked, state.merchantMarked, state.upgrades, state.statScrolls,
    state.compounds, state.autoItemMarks, state.autoUpgradeMarks, state.autoCompounds,
    state.autoExchanges, state.merchantWeapon, state.autoNpcSales, state.autoStandMarks,
    state.autoDeconstruction, state.npcSaleMarks, state.standListings, state.deconstructionMarks]);
}

/** One validated mutation removes rules before reconciliation can recreate their marks. */
export function createClearItemMarks(state: State, ports: Ports) {
  return function clear(body: Record<string, unknown>): CommandOutcome {
    if (body.type !== "clear-item-marks") return undefined;
    const name = requestText(body.character), item = requestObject(body.item);
    const equipped = body.equipped === true;
    const entry = selectedEntry(state, body);
    if (!entry?.item || JSON.stringify(entry.item) !== JSON.stringify(item))
      return { status: 409, body: { error: "Item changed; refresh and try again" } };
    const selected = { name, item, slot: typeof body.pack === 'string' ? '__bank__' : body.slot as string | number, equipped };
    const before = markSnapshot(state);
    clearBankSources(state, body, name, item);
    clearLocal(state, selected);
    clearSales(state, selected, clearRules(state, selected));
    // The active worker finishes its current server operation, then refreshes work.
    if (before !== markSnapshot(state)) invalidateImprovements(state);
    ports.persist();
    persistStorage(body, ports);
    ports.changed();
    return null;
  };
}

function members(state: State, name: string) { return state.merchantRules?.members || [name]; }
function clearSharedCollection(state: State, name: string, key: string) {
  for (const member of members(state,name)) for (const field of [state.marked, state.merchantMarked])
    field[member] = field[member]?.filter(mark => !(mark.auto && autoItemRuleKey(mark.item) === key));
}

