'use client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Info } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useState } from 'react';
import { exactLevelPrice } from './exact-level-price';
import { Item } from './item';
import { ItemMeta } from './item-meta';
import type { MerchantCatalogItem } from './merchant-catalog-item';
import { MerchantBuyItem } from './merchant-buy-item';
import { npcSaleValue } from './npc-sale-value';
import { pontyPrice } from './ponty-price';
import { StandBid } from './stand-bid';
import { StandPriceButton } from './stand-price-button';
import { StandPriceHistory } from './stand-price-history';
import { useSuggestedItemValue } from './suggested-item-value';
import {
  WTBPreference,
  useWTBReplacement,
  standBuyExplanation,
  higherLevelExplanation,
  type WTBOptions,
} from './wtb-preferences';
import { WTBPriorityInput } from './wtbpriority-input';

export function WTBOrderDialog({
  item,
  onOpenChange,
  buyable,
  catalog = [],
  history,
  existing,
  onSave,
}: {
  item: { item: Item; meta?: ItemMeta | null };
  onOpenChange: (open: boolean) => void;
  buyable: MerchantBuyItem[];
  catalog?: MerchantCatalogItem[];
  history?: StandPriceHistory;
  existing?: StandBid;
  onSave: (
    itemId: string,
    price: number,
    quantity: number,
    level: number,
    priorityOverride: number | null,
    options?: WTBOptions,
  ) => Promise<void>;
}) {
  // Mounted for each new WTB request: polling must not overwrite an open draft.
  const [price, setPrice] = useState(() =>
    existing &&
    Number(existing.minimumQuality || 0) === Number(item.item.level || 0)
      ? String(existing.price)
      : '',
  );
  const [quantity, setQuantity] = useState(() =>
    existing ? String(existing.quantity) : '1',
  );
  const [level, setLevel] = useState(() => String(item.item.level ?? 0));
  const [saving, setSaving] = useState(false);
  const [useStandSlot, setUseStandSlot] = useState(
    existing?.useStandSlot === true,
  );
  const [acceptHigherLevels, setAcceptHigherLevels] = useState(
    existing?.acceptHigherLevels !== false,
  );
  const replacement = useWTBReplacement(catalog);
  const [priorityOverride, setPriorityOverride] = useState(() =>
    existing?.priorityOverride == null ? '' : String(existing.priorityOverride),
  );
  const previewItem = { ...item.item, level: Math.max(0, Number(level) || 0) };
  const valuation = useSuggestedItemValue(
    { slot: -1, item: previewItem, meta: item.meta },
    buyable,
  );
  const defaultPrice = Math.max(
    1,
    Number(item.meta?.definition.g) || valuation.defaultPrice || 1,
  );
  const npcPrice = Math.max(1, npcSaleValue(previewItem, item.meta));
  const pontyValue = Math.max(1, pontyPrice(previewItem, item.meta));
  const marketLow = exactLevelPrice(
    history?.marketLow,
    history?.marketLowLevel,
    previewItem.level,
  );
  const lowest = exactLevelPrice(
    history?.lowest,
    history?.lowestLevel,
    previewItem.level,
  );
  const recent = exactLevelPrice(
    history?.recent,
    history?.recentLevel,
    previewItem.level,
  );
  const highestWTB = exactLevelPrice(
    history?.highestPublicWTB,
    history?.highestPublicWTBLevel,
    previewItem.level,
  );
  const marketReference = marketLow || lowest;
  const apply = (value?: number) => {
    if (value) setPrice(String(Math.max(1, Math.round(value))));
  };
  const buttons: [
    string,
    number | undefined,
    'amber' | 'emerald' | 'cyan' | 'violet' | 'slate',
  ][] = [
    ['Farm price', valuation.suggested, 'amber'],
    ['NPC sale +10%', npcPrice * 1.1, 'emerald'],
    ['Ponty price', pontyValue, 'violet'],
    ['Base value −10%', defaultPrice * 0.9, 'emerald'],
    ['Base value (+0)', defaultPrice, 'emerald'],
    ['Base value +10%', defaultPrice * 1.1, 'emerald'],
    [
      'Market low −5%',
      marketReference ? marketReference * 0.95 : undefined,
      'cyan',
    ],
    ['Market price', marketLow, 'cyan'],
    ['Highest WTB price', highestWTB, 'violet'],
    ['Lowest seen', lowest, 'cyan'],
    ['Recent +5%', recent ? recent * 1.05 : undefined, 'violet'],
    ['Recent price', recent, 'violet'],
    ['Recent −5%', recent ? recent * 0.95 : undefined, 'violet'],
    ['Input +5%', Number(price) ? Number(price) * 1.05 : undefined, 'slate'],
    ['Input −5%', Number(price) ? Number(price) * 0.95 : undefined, 'slate'],
  ];
  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden border-violet-800 bg-black text-emerald-50 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Add to WTB ·{' '}
              {String(item.meta?.definition.name || item.item.name)}
              {item.meta?.upgradeable ||
              item.meta?.compoundable ||
              previewItem.level
                ? ` +${previewItem.level}`
                : ''}
            </DialogTitle>
            <DialogDescription>
              Automatic shopping buys matching items at no more than your bid.
              Native stand orders advertise the selected exact level.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm text-violet-200">
                Maximum price
                <Input
                  inputMode="numeric"
                  value={price}
                  onChange={(event) =>
                    setPrice(event.target.value.replace(/[^0-9]/g, ''))
                  }
                  className="h-9 w-full border-violet-600 bg-black text-right font-mono tabular-nums text-violet-100"
                />
              </label>
              <label className="grid gap-1 text-sm text-violet-200">
                Quantity
                <Input
                  inputMode="numeric"
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(event.target.value.replace(/[^0-9]/g, ''))
                  }
                  className="h-9 w-full border-violet-600 bg-black text-right font-mono tabular-nums text-violet-100"
                />
              </label>
              <label className="grid gap-1 text-sm text-violet-200">
                Selected +level
                <Input
                  inputMode="numeric"
                  value={level}
                  disabled={!item.meta?.upgradeable && !item.meta?.compoundable}
                  onChange={(event) =>
                    setLevel(event.target.value.replace(/[^0-9]/g, ''))
                  }
                  className="h-9 w-full border-violet-600 bg-black text-right font-mono tabular-nums text-violet-100"
                />
              </label>
              <label className="grid gap-1 text-sm text-violet-200">
                Priority override
                <WTBPriorityInput
                  className="h-9 w-full text-right font-mono tabular-nums"
                  value={priorityOverride}
                  onChange={setPriorityOverride}
                />
              </label>
            </div>
            <WTBPreference
              label="Use stand"
              description={standBuyExplanation}
              checked={useStandSlot}
              onChange={setUseStandSlot}
            />
            {(item.meta?.upgradeable || item.meta?.compoundable) && (
              <WTBPreference
                label="Accept higher levels"
                description={higherLevelExplanation}
                checked={acceptHigherLevels}
                onChange={setAcceptHigherLevels}
              />
            )}
            <p className="text-sm text-violet-200">
              Priority: 0–100, higher first. Leave blank to use the routine
              priority.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {buttons.map(([label, value, tone]) => (
                <StandPriceButton
                  key={label}
                  label={label}
                  value={value}
                  disabled={!value}
                  onClick={() => apply(value)}
                  tone={tone}
                  information={
                    label === 'Farm price' ? (
                      <Popover>
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              aria-label="Information: Farm price"
                              className="flex h-5 w-5 items-center justify-center rounded border border-amber-700 bg-black text-amber-200 hover:bg-amber-950 hover:text-white"
                            />
                          }
                        >
                          <Info className="h-3 w-3" />
                        </PopoverTrigger>
                        <PopoverContent className="max-w-xs border-amber-700 bg-black text-sm text-amber-100">
                          Estimated gold you would earn while farming enough
                          monsters to obtain one of this item, based on its drop
                          rate and those monsters' gold rewards.
                        </PopoverContent>
                      </Popover>
                    ) : undefined
                  }
                />
              ))}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-emerald-900 bg-[#081513] pt-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-rose-600 bg-black text-rose-200 hover:bg-rose-950 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              disabled={saving || !Number(price) || !Number(quantity)}
              onClick={async () => {
                setSaving(true);
                try {
                  await replacement.save(async (replaceStandEntry) =>
                    onSave(
                      item.item.name,
                      Number(price),
                      Number(quantity),
                      Math.max(0, Number(level) || 0),
                      priorityOverride === '' ? null : Number(priorityOverride),
                      { useStandSlot, acceptHigherLevels, replaceStandEntry },
                    ),
                  );
                } finally {
                  setSaving(false);
                }
              }}
              className="border border-violet-400 bg-violet-500 text-black hover:border-violet-300 hover:bg-violet-400 hover:text-black"
            >
              {saving ? 'Saving…' : 'Place WTB'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {replacement.dialog}
    </>
  );
}
