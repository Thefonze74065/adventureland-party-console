import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { UpgradeChoice } from "./upgrade-estimate.ts";

export interface CraftMaterial {
  id: string;
  quantity: number;
  level?: number;
}
export interface OrderChoice extends UpgradeChoice {
  compoundable?: boolean;
  materials?: CraftMaterial[];
}
export interface OrderLine {
  id: string;
  quantity: number;
  level?: number;
  attempts?: number;
  budget?: number;
  scrolls?: number[];
  goldCap?: number;
  estimateUnavailable?: boolean;
  acknowledgeUnavailable?: boolean;
}
export interface Allocation {
  slot?: number;
  item: Item;
  quantity: number;
}
export interface StorageAllocation extends Allocation {
  allocationId: string;
  pack: string;
  resolved?: boolean;
}
export interface MaterialOrder {
  craftMaterials?: CraftMaterial[][];
  inventory?: Allocation[];
  buys: OrderLine[];
  crafts: OrderLine[];
  sources: Record<string, Allocation[]>;
  bank: (Allocation & { pack: string })[];
  storage?: StorageAllocation[];
  requirements: CraftMaterial[];
  materialBuys: CraftMaterial[];
}
export type MaterialEntry = InventoryEntry & Item;
