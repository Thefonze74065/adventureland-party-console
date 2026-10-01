export interface PassiveRule { enabled: boolean; keepMoving: boolean; priority: number; maxLevel?: number }
export interface PassiveSettings { version: 1; rules: Record<string, PassiveRule>; useFieldGenerators: boolean }
export const legacyPriorities: Record<string, number> = {tinyp:101,phoenix:100,goldenbat:100,cutebee:100,hen:100,rooster:100};
export function defaultPassiveRule(id: string): PassiveRule { return {enabled:false,keepMoving:false,priority:legacyPriorities[id] ?? 100,maxLevel:-1}; }
/** Older saved rules omit the cap. Unknown levels cannot satisfy a finite cap. */
export function passiveLevelAllowed(rule: PassiveRule | undefined, level: number | undefined): boolean {
  const cap = rule?.maxLevel ?? -1;
  return cap === -1 || Number.isFinite(level) && Number(level) <= cap;
}
export function migratePassiveSettings(saved?: PassiveSettings | null, legacy: Record<string,boolean> = {}): PassiveSettings {
  if (saved?.version === 1) return saved;
  return {version:1,useFieldGenerators:true,rules:Object.fromEntries(Object.entries(legacy).map(([id,enabled]) => [id,{...defaultPassiveRule(id),enabled}]))};
}
function object(value: unknown): value is Record<string,unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validRule(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([key,v]) =>
    ['enabled','keepMoving'].includes(key) ? typeof v === 'boolean' : key === 'maxLevel' ? Number.isSafeInteger(v) && (v === -1 || Number(v) > 0) : key === 'priority' && Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 1000);
}
export function validPassivePatch(value: unknown): boolean {
  if (!object(value)) return false;
  return Object.entries(value).every(([key,v]) => {
    if (key === 'useFieldGenerators') return typeof v === 'boolean';
    if (key === 'rules') return object(v) && Object.entries(v).every(([id,rule]) => /^[a-z0-9_]+$/i.test(id) && id !== 'fieldgen0' && validRule(rule));
    return Object.hasOwn(legacyPriorities,key) && typeof v === 'boolean';
  });
}
export function applyPassivePatch(settings: PassiveSettings, patch: Record<string,unknown>): PassiveSettings {
  const rules = {...settings.rules};
  for (const [id,value] of Object.entries(patch)) if (typeof value === 'boolean' && Object.hasOwn(legacyPriorities,id))
    rules[id] = {...defaultPassiveRule(id),...rules[id],enabled:value};
  for (const [id,value] of Object.entries(object(patch.rules) ? patch.rules : {}))
    rules[id] = {...defaultPassiveRule(id),...rules[id],...value as Partial<PassiveRule>};
  return {...settings,rules,useFieldGenerators:typeof patch.useFieldGenerators === 'boolean' ? patch.useFieldGenerators : settings.useFieldGenerators};
}
export function committedPassiveRules(settings: PassiveSettings): Record<string,boolean> {
  return Object.fromEntries(Object.entries(settings.rules).map(([id,rule]) => [id,rule.enabled && !rule.keepMoving]));
}
