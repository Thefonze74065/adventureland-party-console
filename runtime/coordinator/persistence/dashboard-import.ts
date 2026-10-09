import { validOfferingRules } from '../../upgrade-offerings.ts';
import {validPassivePatch, migratePassiveSettings, committedPassiveRules, type PassiveSettings} from "../navigation/passive-settings.ts";
import { migrateRoutinePriorities } from '../merchant/routines.ts';
import {validHuntSettings} from "../hunt/settings.ts";
import { stateKeys } from "./snapshots.ts";
import { validStandLocation } from '../merchant/stand-location.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): value is unknown[] => Array.isArray(value);
const text = (value: unknown) => typeof value === "string";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const boolean = (value: unknown) => typeof value === "boolean";
const mapOf = (check: (value: unknown) => boolean) => (value: unknown) =>
  object(value) && Object.values(value).every(check);
const listOf = (check: (value: unknown) => boolean) => (value: unknown) =>
  list(value) && value.every(check);
const item = (value: unknown) => object(value) && text(value.name);
const mark = (value: unknown) => object(value) && (item(value.item) || item(value));
const positive = (value: unknown) => number(value) && Number(value) > 0;
const upgrade = (value: unknown) => object(value) && item(value.item) && positive(value.tiers);
const upgradeRule = (value: unknown) =>
  positive(Number(value)) || (object(value) && positive(value.tiers));
const compound = (value: unknown) => object(value) && text(value.id) && listOf(mark)(value.items);
const autoCompound = (value: unknown) => item(value) && object(value) && positive(value.targetTier);
const profileFields = ['huntBlacklist', 'huntFailures', 'huntSettings'] as const;
function profilePreferences(value: unknown): unknown {
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([name, profile]) => [name,
    object(profile) ? Object.fromEntries(profileFields.filter(key => key in profile).map(key => [key, profile[key]])) : profile]));
}
function validProfile(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([key, entry]) =>
    profileFields.includes(key as typeof profileFields[number]) && validators[key]!(entry));
}

// Deliberately excludes jobs, credentials, runtime ownership and navigation checkpoints.
export const validators: Record<string, (value: unknown) => boolean> = {
  farmingProfiles: mapOf(validProfile),
  marked: mapOf(listOf(mark)),
  merchantMarked: mapOf(listOf(mark)),
  autoItemMarks: mapOf(mapOf((value) => value === "bank" || value === "merchant")),
  upgrades: mapOf(listOf(upgrade)),
  autoUpgradeMarks: mapOf(mapOf(upgradeRule)),
  upgradeOfferingRules: validOfferingRules,
  compounds: mapOf(listOf(compound)),
  autoCompounds: mapOf(listOf(autoCompound)),
  statScrolls: mapOf(listOf((value) => object(value) && item(value.item))),
  monsterFocus: listOf(text),
  monsterFocusByCharacter: mapOf(listOf(text)),
  monsterPrioritiesByCharacter: mapOf(mapOf(number)),
  monsterSearchRadiusByCharacter: mapOf(positive),
  bankboiPrefix: v => text(v) && (v === "" || /^[A-Za-z0-9_]{3,11}$/.test(v as string)),
  anniversaryAutoChat: boolean,
  merchantStandLocation: validStandLocation,
  threshold: number,
  itemCollectionThreshold: positive,
  buyUpgradeBatchSize: value => number(value) && Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 42,
  goldTargets: mapOf(number),
  eventsByCharacter: mapOf(boolean),
  eventSelectionsByCharacter: mapOf(listOf(text)),
  passiveRareHunts: mapOf(boolean),
  passiveHunting: value => object(value) && value.version === 1 && validPassivePatch({rules:value.rules,useFieldGenerators:value.useFieldGenerators}),
  phoenixRouteOrder: listOf(text),
  merchantRoutinePriorities: mapOf(number),
  merchantAutomations: mapOf(boolean),
  npcSaleMarks: listOf((value) => object(value) && item(value.item) && text(value.id)),
  deconstructionMarks: listOf((value) => object(value) && item(value.item) && text(value.id) && text(value.owner) && text(value.origin) && number(value.quantity)),
  autoDeconstruction: mapOf(mapOf((value) => object(value) && item(value.item))),
  autoNpcSales: mapOf((value) => object(value) && item(value.item)),
  autoStandMarks: mapOf((value) => object(value) && item(value.item) && positive(value.price)),
  autoExchanges: mapOf(item),
  standListings: listOf((value) => object(value) && item(value.item) && positive(value.price)),
  standBids: mapOf((value) => object(value) && positive(value.price) && positive(value.quantity)),
  merchantBlacklist: mapOf(object),
  huntBlacklist: mapOf(object),
  huntSettings: validHuntSettings,
  huntFailures: mapOf(v => object(v) && [v.deaths, v.expirations].every(n => Number.isSafeInteger(n) && Number(n) >= 0)),
  restockPolicies: mapOf(
    (value) =>
      object(value) &&
      [value.hp, value.mp].every(
        (p) => object(p) && number(p.min) && number(p.max) && text(p.item),
      ),
  ),
  bankSortMode: value => value === "automatic" || value === "request",
  bankSortLayout: value => value === "packed" || value === "gapped",
  gatheringModes: listOf(text),
  gatheringNoTool: mapOf(boolean),
};
const perCharacter = new Set([
  'farmingProfiles',
  "marked",
  "merchantMarked",
  "autoItemMarks",
  "upgrades",
  "autoUpgradeMarks",
  "compounds",
  "autoCompounds",
  "statScrolls",
  "monsterFocusByCharacter",
  "monsterPrioritiesByCharacter",
  "monsterSearchRadiusByCharacter",
  "goldTargets",
  "eventsByCharacter",
  "eventSelectionsByCharacter",
  "restockPolicies",
  "autoDeconstruction",
]);

function safeKeys(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("State nesting is too deep");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new Error("Invalid state key");
    safeKeys(child, depth + 1);
  }
}

export interface DashboardImport {
  values: ObjectValue;
  fields: string[];
  characters: string[];
  skippedCharacters?: Record<string, string[]>;
}

function parseRecord(line: string, lineNumber: number): [string, unknown] {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    throw new Error(`Invalid JSON on line ${lineNumber}`);
  }
  if (!object(record) || Object.keys(record).length !== 1)
    throw new Error(`Invalid state record on line ${lineNumber}`);
  return Object.entries(record)[0]!;
}

function decodeRecord(value: unknown, lineNumber: number): ObjectValue {
  let decoded: unknown;
  try {
    decoded = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error(`Invalid dashboard data on line ${lineNumber}`);
  }
  if (!object(decoded)) throw new Error(`Invalid dashboard data on line ${lineNumber}`);
  safeKeys(decoded);
  return decoded;
}

/** Replay JSONL in order, including overwritten records and deletion tombstones. */
function replayRecords(source: string): Map<string, ObjectValue> {
  const records = new Map<string, ObjectValue>();
  let lineNumber = 0;
  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    lineNumber++;
    if (!line.trim()) continue;
    const [key, value] = parseRecord(line, lineNumber);
    if (key !== stateKeys.settings && key !== stateKeys.selections) continue;
    if (value === null) {
      records.delete(key);
      continue;
    }
    records.set(key, decodeRecord(value, lineNumber));
  }
  return records;
}

function validatedValues(merged: ObjectValue, owned: (name: string) => boolean) {
  const values: ObjectValue = {},
    characters = new Set<string>();
  const skippedCharacters: Record<string, string[]> = {};
  const include = (name: string, field: string) => {
    if (owned(name)) { characters.add(name); return true; }
    const fields = skippedCharacters[name] ||= [];
    if (!fields.includes(field)) fields.push(field);
    return false;
  };
  for (const [key, check] of Object.entries(validators)) {
    if (!(key in merged)) continue;
    let value = merged[key];
    if (key === 'farmingProfiles') value = profilePreferences(value);
    if (!check(value)) throw new Error(`Invalid saved ${key}; nothing was imported`);
    if (perCharacter.has(key)) {
      const entries = Object.entries(value as ObjectValue);
      value = Object.fromEntries(entries.filter(([name]) => include(name, key)));
      if (entries.length && !Object.keys(value as ObjectValue).length) continue;
    }
    value = filterCharacterReferences(key, value, include);
    if (value === undefined) continue;
    values[key] = value;
  }
  return { values, characters, skippedCharacters };
}

// These collections use item IDs as keys; character references live in their values.
function filterCharacterReferences(key: string, value: unknown, include: (name: string, field: string) => boolean): unknown {
  if (!['deconstructionMarks', 'npcSaleMarks', 'autoNpcSales'].includes(key)) return value;
  const entries = Object.entries(value as ObjectValue);
  const kept = entries.filter(([, entry]) => {
    const record = entry as ObjectValue;
    const name = key === 'deconstructionMarks' ? record.owner : record.character;
    return typeof name !== 'string' || !name || include(name, key);
  });
  if (entries.length && !kept.length) return undefined;
  return Array.isArray(value) ? kept.map(([, entry]) => entry) : Object.fromEntries(kept);
}

export function exportDashboardSettings(state: ObjectValue) {
  return { format: "party-console-settings", version: 1, settings: Object.fromEntries(
    Object.keys(validators).filter(key => key in state).map(key => [key,
      key === 'farmingProfiles' ? profilePreferences(state[key]) : state[key]])) };
}
function importedSettings(source: string): ObjectValue {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { /* Legacy JSONL. */ }
  if (object(parsed) && parsed.format === "party-console-settings") {
    if (parsed.version !== 1 || !object(parsed.settings)) throw new Error("Unsupported settings file");
    safeKeys(parsed.settings);
    return parsed.settings;
  }
  const records = replayRecords(source);
  return { ...records.get(stateKeys.settings), ...records.get(stateKeys.selections) };
}

export function parseDashboardImport(
  source: string,
  owned: (name: string) => boolean,
): DashboardImport {
  if (typeof source !== "string" || !source.trim())
    throw new Error("Choose a non-empty settings JSON or legacy JSONL file");
  if (Buffer.byteLength(source, "utf8") > 128 * 1024 * 1024)
    throw new Error("State file exceeds 128 MB");
  const merged = importedSettings(source);
  const { values, characters, skippedCharacters } = validatedValues(merged, owned);

  if (!Object.keys(values).length && !Object.keys(skippedCharacters).length)
    throw new Error("No supported dashboard settings or marks found in this file");
  return { values, fields: Object.keys(values).sort(), characters: [...characters].sort(), skippedCharacters };
}

export function applyDashboardImport(state: ObjectValue, parsed: DashboardImport): void {
  for (const [key, value] of Object.entries(parsed.values)) {
    state[key] = importedValue(state, key, value);
  }
  if (state.bankSortMode === "automatic") state.bankSortRequest = null;
  if (Object.hasOwn(parsed.values,"passiveHunting") || Object.hasOwn(parsed.values,"passiveRareHunts")) {
    state.passiveHunting=migratePassiveSettings(parsed.values.passiveHunting as PassiveSettings, state.passiveRareHunts as Record<string,boolean>);
    state.passiveRareHunts=committedPassiveRules(state.passiveHunting as PassiveSettings);
  }
}
function importedValue(state: ObjectValue, key: string, value: unknown): unknown {
  if (key === 'merchantRoutinePriorities') return migrateRoutinePriorities(value as Record<string, number>);
  if (key !== 'farmingProfiles') return value;
  const previous = object(state.farmingProfiles) ? state.farmingProfiles : {};
  return {...previous, ...Object.fromEntries(Object.entries(value as ObjectValue).map(([name, profile]) =>
    [name, {...(object(previous[name]) ? previous[name] : {}), ...(profile as ObjectValue)}]))};
}
