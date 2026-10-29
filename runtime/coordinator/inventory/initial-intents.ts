import {randomUUID} from 'node:crypto';
import type { createUpgradeCommands } from "./upgrade-commands.ts";
import type { createStatScrollCommands } from "./stat-scroll-commands.ts";
import type { createCompoundCommands } from "./compound-commands.ts";
import type { createMerchantItemCommands } from "./merchant-item-commands.ts";

/** Durable intent uses the same records that the item command handlers update. */
export interface ItemIntents {
  upgradeOfferingRules: import('../../upgrade-offerings.ts').UpgradeOfferingRule[];
  upgradeChanceGuards: import('../../upgrade-chance-guard.ts').UpgradeChanceGuard[];
  upgrades: Parameters<typeof createUpgradeCommands>[0]["upgrades"];
  statScrolls: Parameters<typeof createStatScrollCommands>[0]["statScrolls"];
  purchases: Parameters<typeof createMerchantItemCommands>[0]["purchases"];
  compounds: Parameters<typeof createCompoundCommands>[0]["compounds"];
  autoCompounds: Parameters<typeof createCompoundCommands>[0]["autoCompounds"];
  autoExchanges: Parameters<typeof createMerchantItemCommands>[0]["autoExchanges"];
  goldTargets: Parameters<typeof createUpgradeCommands>[0]["goldTargets"];
}

type SavedItemIntents = { [Key in keyof ItemIntents]?: ItemIntents[Key] | null };

/** Keep durable improvement and purchase intent; processing services reconcile it with live inventory. */
export function initialItemIntents(saved: SavedItemIntents): ItemIntents {
  return {
    upgrades: Object.fromEntries(Object.entries(saved.upgrades || {}).map(([owner,marks]) => [owner,marks?.map(mark => mark.auto || mark.requestId ? mark : {...mark,requestId:mark.passId || randomUUID()})])),
    upgradeOfferingRules: saved.upgradeOfferingRules || [],
    upgradeChanceGuards: saved.upgradeChanceGuards || [],
    statScrolls: saved.statScrolls || {},
    purchases: saved.purchases || {},
    compounds: saved.compounds || {},
    autoCompounds: saved.autoCompounds || {},
    autoExchanges: saved.autoExchanges || {},
    goldTargets: saved.goldTargets || {},
  };
}
