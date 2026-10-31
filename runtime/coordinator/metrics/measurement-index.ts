import type { MetricTotals, MetricResetKind } from '../../metrics/contracts.ts';

type Context = Pick<MetricTotals, 'character' | 'server'>;
export type IndexedDamage = Context & MetricTotals['damage'][number];
export type IndexedLoot = Context & MetricTotals['loot'][number];

/** Totals follow accepted measurements, not append records or rollup copies. */
export function createMeasurementIndex() {
  const damage = new Map<string, IndexedDamage>(), loot = new Map<string, IndexedLoot>();
  function addDamage(row: MetricTotals, direction: 1 | -1) {
    const context = {character: row.character, server: row.server};
    for (const hit of row.damage) {
      const key = JSON.stringify([row.character, row.server, hit.monster, hit.skill]);
      const previous = damage.get(key), amount = (previous?.amount || 0) + direction * hit.amount, hits = (previous?.hits || 0) + direction * hit.hits;
      if (amount > 0) damage.set(key, { ...context, ...hit, amount, hits }); else damage.delete(key);
    }
  }
  function addLoot(row: MetricTotals, direction: 1 | -1) {
    const context = {character: row.character, server: row.server};
    for (const item of row.loot) {
      const key = JSON.stringify([row.character, row.server, item.item, item.variant]);
      const quantity = (loot.get(key)?.quantity || 0) + direction * item.quantity;
      if (quantity > 0) loot.set(key, { ...context, ...item, quantity }); else loot.delete(key);
    }
  }
  function add(rows: MetricTotals[], direction: 1 | -1 = 1) {
    for (const row of rows) { addDamage(row, direction); addLoot(row, direction); }
  }
  return { add, damage: () => damage.values(), loot: () => loot.values(),
    clear(kinds: MetricResetKind[]) { if (kinds.includes('damage')) damage.clear(); if (kinds.includes('loot')) loot.clear(); },
  };
}
