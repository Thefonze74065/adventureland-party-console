import { autoUpgradeEnabled } from './routines.ts';
import { migrateRoutinePriorities, migrateExchangeAutomations } from './routines.ts';
import type { DeconstructionMark, DeconstructionRules, DeconstructionCatalog } from "./deconstruction.ts";
import type { StandMark } from "./stand-marks.ts";
import type { Item } from "../contracts/item.ts";
import type { createAutomaticSaleRoutes } from "../http/automatic-sales.ts";

interface SavedListing extends Partial<StandMark> {
  [key: string]: unknown;
  item: Item;
  price: number;
  quantity: number;
  id?: string;
  state?: string;
  queuedAt?: number;
}
interface SavedMerchantSettings {
  upgradePreviewResults?: Record<string, import("./upgrade-preview.ts").StoredUpgradePreview>;
  giveawayAttempts?: Record<string, number>;
  deconstructionMarks?: DeconstructionMark[];
  autoDeconstruction?: DeconstructionRules;
  standListings?: SavedListing[];
  npcSaleMarks?: unknown;
  autoNpcSales?: Parameters<typeof createAutomaticSaleRoutes>[0]["autoNpcSales"];
  autoStandMarks?: Parameters<typeof createAutomaticSaleRoutes>[0]["autoStandMarks"];
  merchantRoutinePriorities?: Record<string, number>;
  merchantAutomations?: Record<string, boolean>;
}

export function defaultMerchantRoutinePriorities(): Record<string, number> {
  return {
    "merchant luck": 100,
    "inventory cleanout": 95,
    "manual visit": 90,
    deliveries: 90,
    "ALData authentication": 90,
    "party collection": 90,
    restock: 90,
    "gold threshold": 85,
    "npc sales": 80,
    "auto npc sales": 80,
    "auto npc sale pickup": 80,
    "manual marketplace purchases": 76,
    "upgrade preview": 70,
    "manual upgrades": 70,
    "auto upgrade": 70,
    "manual compounds": 70,
    "manual buying": 65,
    "manual crafting": 65,
    "npc sale pickup": 80,
    "deconstruction": 80,
    "deconstruction pickup": 80,
    "stand purchases": 75,
    "stand bid purchases": 75,
    "ALData marketplace purchases": 76,
    "ALData marketplace sales": 76,
    "upgrades and compounds": 70,
    "auto compound": 68,
    "manual exchange": 67,
    "automatic exchange": 67,
    "merchant commerce": 65,
    "merchant donation": 60,
    "join giveaway": 55,
    "stand search": 50,
    "stand maintenance": 40,
    fishing: 20,
    mining: 20,
    "merchant idle": 0,
    "manual bank exchange": 80,
    "bank unlock": 90,
    "send mail": 90,
    "collect mail": 90,
  };
}
export function defaultMerchantAutomations(): Record<string, boolean> {
  return {
    deliveries: true,
    "merchant luck": true,
    "party collection": true,
    "auto npc sales": true,
    restock: true,
    "gold threshold": true,
    "inventory cleanout": true,
    "auto compound": true,
    "auto upgrade": true,
    "automatic exchange": true,
    "stand bid purchases": true,
    "join giveaway": true,
  };
}

/** Fill legacy listing metadata while retaining saved automation overrides, including false and zero. */
export function initialMerchantSales(settings: SavedMerchantSettings, now: () => number) {
  return {
    upgradePreviewResults: settings.upgradePreviewResults || {},
    giveawayAttempts: settings.giveawayAttempts || {},
    standListings: (settings.standListings || []).map((entry, index) => ({
      ...entry,
      id: entry.id || `stand-migrated-${now()}-${index}`,
      state: entry.state || "configured",
      queuedAt: entry.queuedAt || now() + index,
    })),
    deconstructionMarks: settings.deconstructionMarks || [],
    autoDeconstruction: settings.autoDeconstruction || {},
    deconstructionCatalog: {} as DeconstructionCatalog,
    npcSaleMarks: Array.isArray(settings.npcSaleMarks) ? settings.npcSaleMarks : [],
    autoNpcSales: settings.autoNpcSales || {},
    autoStandMarks: settings.autoStandMarks || {},
    merchantRoutinePriorities: {
      ...defaultMerchantRoutinePriorities(),
      ...migrateRoutinePriorities(settings.merchantRoutinePriorities),
    },
    merchantAutomations: { ...defaultMerchantAutomations(), "auto upgrade": autoUpgradeEnabled(settings.merchantAutomations), ...migrateExchangeAutomations(settings.merchantAutomations) },
  };
}
