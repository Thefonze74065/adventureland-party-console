import { isDeepStrictEqual } from 'node:util';
import { requestObject } from '../http/contracts.ts';

export type CatalogDefinitions = Record<'monsters' | 'skills' | 'items', Record<string, unknown>> & {conditions?:Record<string,unknown>};
type Kind = 'bestiaryCatalog' | 'skillCatalog' | 'merchantCatalog';
const domains = { bestiaryCatalog: 'monsters', skillCatalog: 'skills', merchantCatalog: 'items' } as const;

function catalogValue(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (depth > 6) return undefined;
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(entry => catalogValue(entry, depth + 1)).filter(entry => entry !== undefined);
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(requestObject(value)).map(([key, entry]) => [key, catalogValue(entry, depth + 1)]).filter(([, entry]) => entry !== undefined));
}
function itemDefinition(value: unknown) {
  return Object.fromEntries(Object.entries(requestObject(value)).filter(([, entry]) =>
    ['string', 'number', 'boolean'].includes(typeof entry) || Array.isArray(entry)));
}
function entries(kind: Kind, value: unknown): unknown[] {
  if (kind === 'merchantCatalog') return array(requestObject(value).allItems);
  if (kind === 'skillCatalog') return array(value).filter(group=>requestObject(group).id!=='conditions').flatMap(group => array(requestObject(group).skills));
  return array(value);
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function matchesDefinition(kind: Kind, entry: Record<string, unknown>, expected: unknown): boolean {
  const actual = kind === 'merchantCatalog' ? requestObject(entry.meta).definition : entry.definition;
  const wanted = kind === 'merchantCatalog' ? itemDefinition(expected) : catalogValue(expected);
  // The game adds derived top-level fields (e.g. max_hp and item id) after
  // loading G. Validate every installed field while allowing those additions.
  const reported = requestObject(actual);
  const projected = Object.fromEntries(Object.keys(requestObject(wanted)).map(key => [key, reported[key]]));
  return isDeepStrictEqual(JSON.parse(JSON.stringify(projected)), JSON.parse(JSON.stringify(wanted)));
}

function catalogEntryId(entry: Record<string, unknown>): string {
  return typeof entry.id === 'string' ? entry.id : '';
}
function validateConditions(kind: Kind, value: unknown, definitions: CatalogDefinitions): string | null {
  if(kind==='skillCatalog' && definitions.conditions){
    const group=array(value).find(entry=>requestObject(entry).id==='conditions');
    const conditions=array(requestObject(group).skills);
    const result=validateCatalog('bestiaryCatalog',conditions,{...definitions,monsters:definitions.conditions});
    if(result)return 'conditions: '+result;
  }
  return null;
}

/** Compare complete client projections against the installed version's definitions. */
export function validateCatalog(kind: Kind, value: unknown, definitions: CatalogDefinitions): string | null {
  const conditionError=validateConditions(kind,value,definitions);
  if(conditionError)return conditionError;
  const expected = definitions[domains[kind]], found = new Set<string>();
  if (!expected || !Object.keys(expected).length) return 'installed definitions unavailable';
  for (const raw of entries(kind, value)) {
    const entry = requestObject(raw), id = catalogEntryId(entry);
    if (!Object.hasOwn(expected, id)) return 'unknown entry: ' + id;
    if (found.has(id) && kind !== 'skillCatalog') return 'duplicate entry: ' + id;
    found.add(id);
    // JSON normalization removes VM prototypes and matches the wire representation.
    if (!matchesDefinition(kind, entry, expected[id]))
      return 'definition mismatch: ' + id;
  }
  const missing = Object.keys(expected).find(id => !found.has(id));
  return missing ? 'missing entry: ' + missing : null;
}

export function createCatalogValidation(version: number, definitions: CatalogDefinitions, report: (message: string) => void) {
  const previous = new Map<Kind, string>();
  return (kind: Kind, value: unknown, clientVersion: unknown) => {
    const error = Number(clientVersion) !== version ? 'game version mismatch' : validateCatalog(kind, value, definitions);
    const result = error || 'validated';
    if (previous.get(kind) !== result) report(`${kind}: ${result} (game ${version})`);
    previous.set(kind, result);
    return !error;
  };
}

/** Missing local data blocks catalog acceptance, not the rest of the coordinator. */
export function createInstalledCatalogValidation(version: number, load: () => CatalogDefinitions, report: (message: string) => void) {
  let validate: ReturnType<typeof createCatalogValidation> | undefined, warned = false;
  function prepare() {
    if (validate) return;
    try {
      const definitions = load();
      if (!definitions) throw new Error('missing game data');
      validate = createCatalogValidation(version, definitions, report);
    } catch {
      if (!warned) report(`Catalog validation waiting for installed game ${version} definitions`);
      warned = true;
    }
  }
  prepare();
  return (...args: Parameters<ReturnType<typeof createCatalogValidation>>) => {
    prepare();
    return validate ? validate(...args) : false;
  };
}
