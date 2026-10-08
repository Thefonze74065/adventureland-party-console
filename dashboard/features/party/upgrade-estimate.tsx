"use client";
import { estimateUpgrade } from "../../../runtime/upgrade-estimate";
import { MerchantBuyItem } from "./merchant-buy-item";
import { upgradeEstimateCache } from "./upgrade-estimate-cache";

/**
 * 90% buy-and-upgrade budget, shared with the coordinator's order estimate. Approximate for
 * targets too hard to simulate (#63); a level past the chance table is priced as its base item.
 */
export function upgradeEstimate(item: MerchantBuyItem, quantity: number, target: number) {
  const base = { attempts: quantity, gold: item.cost * quantity, scrolls: [] as number[], approximate: false };
  if (!target || !item.upgradeable) return base;
  const cacheKey = `${item.id}:${item.cost}:${item.upgradeGrade || 0}:${quantity}:${target}`;
  const cached = upgradeEstimateCache.get(cacheKey);
  if (cached) return cached;
  let result: typeof base | null = null;
  try {
    result = estimateUpgrade(item, quantity, target, []);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  const estimate = result || base;
  upgradeEstimateCache.set(cacheKey, estimate);
  return estimate;
}
