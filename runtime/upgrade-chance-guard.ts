/** Chance guards (#152): hold a real upgrade attempt until the server's own preview chance is high enough.
 * The preview already folds in grace the client cannot see (ugrace, server ugrace, ograce), so no hidden state is modelled. */
export interface UpgradeChanceGuard {
  id: string;
  name: string;
  floor: number;
  ceiling: number;
  /** Fraction in (0, 1]. An attempt is allowed at or above it and held below it. */
  minChance: number;
}
export function validChanceGuard(value: unknown): value is UpgradeChanceGuard {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<UpgradeChanceGuard>;
  return nonEmpty(rule.id) && nonEmpty(rule.name) && validMinChance(rule.minChance) && validLevels(rule.floor, rule.ceiling);
}
function nonEmpty(value: unknown) { return typeof value === 'string' && !!value; }
function validLevels(floor: unknown, ceiling: unknown) {
  return Number.isSafeInteger(floor) && Number.isSafeInteger(ceiling) &&
    Number(floor) >= 0 && Number(floor) < Number(ceiling) && Number(ceiling) <= 13;
}
export function validMinChance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}
export function chanceGuardOverlap(rules: readonly UpgradeChanceGuard[], next: UpgradeChanceGuard) {
  return rules.find(rule => rule.id !== next.id && rule.name === next.name && rule.floor < next.ceiling && next.floor < rule.ceiling);
}
export function validChanceGuards(value: unknown): value is UpgradeChanceGuard[] {
  if (!Array.isArray(value) || !value.every(validChanceGuard)) return false;
  return new Set(value.map(rule => rule.id)).size === value.length && !value.some(rule => chanceGuardOverlap(value, rule));
}
/** The guard covering the transition from `level` to `level + 1`. */
export function chanceGuard(rules: readonly UpgradeChanceGuard[], name: string, level: number) {
  return rules.find(rule => rule.name === name && rule.floor <= level && level < rule.ceiling);
}
/** Null lets the attempt proceed; otherwise the attempt is held below the guard's minimum. */
export function chanceHold(rules: readonly UpgradeChanceGuard[], name: string, level: number, chance: number) {
  const guard = chanceGuard(rules, name, level);
  return guard && !(chance >= guard.minChance) ? { guard, chance } : null;
}
