import type { ItemInfo } from 'typed-adventureland';

/** Partial server observations can contain newer IDs and properties than upstream. */
export interface StackItem extends Pick<ItemInfo, 'q' | 'level'> {
  name?: string;
  [key: string]: unknown;
}
export interface StackLocation { pack: string; slot: number; item?: StackItem | null }
export interface StackProtection {
  staging?: boolean;
  locations: { pack?: string; slot?: number }[];
  items: { name: string; level?: number }[];
  error?: string;
}
export const stackQuantity = (item?: StackItem | null): number => item ? Number(item.q) || 1 : 0;
export function stackIdentity(item?: StackItem | null): string {
  return JSON.stringify(['name', 'level', 'p', 'stat_type', 'data', 'rid', 'b', 'm', 'l']
    .map(key => key === 'level' ? Number(item?.level) || 0 : item?.[key] ?? null));
}
export function stackProtected(location: StackLocation, protection: StackProtection): boolean {
  return !!protection.error || (protection.staging !== false && location.pack === 'items1' && location.slot >= 35) ||
    !!location.item?.b || !!location.item?.l || location.item?.name === 'placeholder' ||
    protection.locations.some(mark => mark.pack === location.pack && (mark.slot === undefined || mark.slot === location.slot)) ||
    protection.items.some(item => item.name === location.item?.name && (item.level || 0) === (location.item?.level || 0));
}
export function stackLocations(bank: Record<string, unknown>, protection: StackProtection): StackLocation[] {
  return Object.keys(bank).filter(pack => /^items\d+$/.test(pack) && Array.isArray(bank[pack]))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .flatMap(pack => Array.from({ length: 42 }, (_, slot) => ({ pack, slot, item: (bank[pack] as (StackItem | null)[])[slot] })))
    .filter(location => !stackProtected(location, protection));
}
/** Capacity is allocated over all partial stacks before considering empty slots. */
export function stackDepositPlan(item: StackItem, limit: number, locations: StackLocation[],
  compatible: (a: StackItem, b: StackItem) => boolean = (a,b) =>
    stackIdentity(a) === stackIdentity(b) && !!a.v === !!b.v && !!a.acl === !!b.acl) {
  let remaining = stackQuantity(item);
  const moves: (StackLocation & { quantity: number })[] = [];
  const partials = locations.filter(location => location.item && limit > 1 &&
    compatible(location.item, item) && stackQuantity(location.item) < limit);
  for (const location of [...partials, ...locations.filter(location => !location.item)]) {
    const quantity = Math.min(remaining, Math.max(0, limit - stackQuantity(location.item)));
    if (quantity) moves.push({ ...location, quantity });
    remaining -= quantity;
    if (!remaining) break;
  }
  return { moves, remaining };
}
export function nextStackMerge(locations: StackLocation[], limitOf: (item: StackItem) => number,
  compatible: (a: StackItem, b: StackItem) => boolean = (a,b) => stackIdentity(a) === stackIdentity(b) && !!a.v === !!b.v && !!a.acl === !!b.acl) {
  for (let a = 0; a < locations.length; a++) {
    const target = locations[a], limit = target.item ? limitOf(target.item) : 1;
    if (!target.item || limit <= stackQuantity(target.item)) continue;
    for (let b = locations.length - 1; b > a; b--) {
      const source = locations[b];
      if (source.item && compatible(target.item, source.item))
        return { source, target, quantity: Math.min(stackQuantity(source.item), limit - stackQuantity(target.item)) };
    }
  }
  return null;
}
