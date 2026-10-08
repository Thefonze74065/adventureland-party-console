import { estimateUpgrade as sharedEstimate, type UpgradeChoice } from "../../upgrade-estimate.ts";

export type { UpgradeChoice };
interface Estimate {
  attempts: number;
  budget: number;
  scrolls: number[];
  approximate: boolean;
}

/**
 * The order's 90th-percentile budget, identical to the dashboard's (runtime/upgrade-estimate.ts).
 * Throws a RangeError for a target past the item's chance table.
 */
export function estimateUpgrade(choice: UpgradeChoice, quantity: number, target: number): Estimate | null {
  const result = sharedEstimate(choice, quantity, target, [1000, 40000, 1600000, 480000000]);
  return result && { attempts: result.attempts, budget: result.gold, scrolls: result.scrolls, approximate: result.approximate };
}
