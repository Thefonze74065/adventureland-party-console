'use client';
import { InventoryEntry } from './inventory-entry';
import { ItemSuggestedPrice } from './item-suggested-price';
import { MerchantBuyItem } from './merchant-buy-item';
import { UPGRADE_CHANCES } from './upgrade-chances';
import { useUpgradeEstimates } from './upgrade-estimate';
import type { UpgradeChoice } from '../../../runtime/upgrade-estimate.ts';
export function useSuggestedItemValue(
  entry: InventoryEntry,
  buyable: MerchantBuyItem[],
) {
  const definition = entry.meta?.definition || {},
    defaultPrice = Math.max(1, Number(definition.g) || 1),
    level = Math.max(0, Number(entry.item.level) || 0);
  const catalogItem = buyable.find((item) => item.id === entry.item.name),
    precomputed = entry.meta?.world?.suggestedPrices || [];
  const grade = Math.max(
    0,
    Math.min(2, Number(catalogItem?.upgradeGrade ?? definition.igrade) || 0),
  );
  const lines: {
    key: string;
    quantity: number;
    target: number;
    item: UpgradeChoice;
  }[] = precomputed
    .filter(() => level > 0 && entry.meta?.upgradeable)
    .map((source, index) => ({
      key: String(index),
      quantity: 1,
      target: level,
      item: {
        id: entry.item.name,
        cost: Math.max(defaultPrice, Number(source.suggested) || defaultPrice),
        upgradeable: true,
        upgradeGrade: grade,
        grades:
          catalogItem?.grades || (definition.grades as number[] | undefined),
        upgradeChances: catalogItem?.upgradeChances || UPGRADE_CHANCES[grade],
        scrollCosts: catalogItem?.scrollCosts || [
          1000, 40000, 1600000, 64000000,
        ],
      },
    }));
  if (catalogItem)
    lines.push({ key: 'buy', quantity: 1, target: level, item: catalogItem });
  const estimates = useUpgradeEstimates(lines);
  let pending = false,
    unavailable = false;
  const sources: ItemSuggestedPrice[] = [];
  precomputed.forEach((source, index) => {
    const estimate = estimates[String(index)];
    let suggested = Math.max(
      defaultPrice,
      Number(source.suggested) || defaultPrice,
    );
    if (level > 0 && entry.meta?.upgradeable) {
      if (!estimate || estimate.status === 'pending') {
        pending = true;
        return;
      }
      if (estimate.status === 'unavailable') {
        unavailable = true;
        return;
      }
      suggested = Math.max(suggested, estimate.gold);
    }
    sources.push({
      ...source,
      suggested: Math.max(1, Math.ceil(suggested)),
      purchase: false,
    });
  });
  if (catalogItem) {
    const estimate = estimates.buy;
    if (!estimate || estimate.status === 'pending') pending = true;
    else if (estimate.status === 'unavailable') unavailable = true;
    else
      sources.push({
        monsterId: '__buy__',
        monsterName: level > 0 ? 'buy + upgrade' : 'buy',
        sprite: null,
        rate: level > 0 ? 0.9 : 1,
        quantity: 1,
        kills: estimate.attempts,
        goldPerKill: 0,
        suggested: Math.max(1, estimate.gold),
        paths: [],
        purchase: true,
        attempts: estimate.attempts,
        scrolls: estimate.scrolls,
      });
  }
  sources.sort(
    (a, b) =>
      a.suggested - b.suggested || a.monsterName.localeCompare(b.monsterName),
  );
  return {
    suggested:
      sources[0]?.suggested ??
      (level > 0 && entry.meta?.upgradeable ? undefined : defaultPrice),
    defaultPrice,
    sources,
    pending,
    unavailable,
  };
}
