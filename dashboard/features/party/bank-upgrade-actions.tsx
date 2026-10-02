import { UpgradeActions } from './upgrade-actions';
import type { InventoryEntry } from './inventory-entry';
import type { MerchantCatalogItem } from './merchant-catalog-item';

export function BankUpgradeActions({ entry, pack, catalog, merchant, onUpgrade }: {
  entry: InventoryEntry; pack: string; catalog: MerchantCatalogItem[]; merchant?: string | null;
  onUpgrade: (pack: string, entry: InventoryEntry, tiers: number, auto: boolean) => void;
}) {
  if (!merchant || entry.item.l || entry.item.b) return null;
  const meta = entry.meta || catalog.find(item => item.id === entry.item.name)?.meta;
  return <UpgradeActions item={entry.item} meta={meta} onBuy={() => {}}
    onMark={tiers => { if (tiers) onUpgrade(pack, entry, tiers, false); }}
    onAutoMark={tiers => { if (tiers) onUpgrade(pack, entry, tiers, true); }} />;
}
