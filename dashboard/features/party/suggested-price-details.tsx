'use client';
import { Coins } from 'lucide-react';
import { abbreviatedGold } from './abbreviated-gold';
import { exactLevelPrice } from './exact-level-price';
import { InventoryEntry } from './inventory-entry';
import { MerchantBuyItem } from './merchant-buy-item';
import { SpriteCrop } from './sprite-crop';
import { StandPriceHistory } from './stand-price-history';
import { useSuggestedItemValue } from './suggested-item-value';

export function SuggestedPriceDetails({
  entry,
  buyable,
  observed,
}: {
  entry: InventoryEntry;
  buyable: MerchantBuyItem[];
  observed?: StandPriceHistory;
}) {
  const valuation = useSuggestedItemValue(entry, buyable);
  const itemLevel = Number(entry.item.level) || 0;
  const observedPrice = (
    price: number | undefined,
    level: number | undefined,
    fallback: string,
  ) =>
    exactLevelPrice(price, level, itemLevel)
      ? `${abbreviatedGold(price!)} gold (+${itemLevel})`
      : `${fallback} for +${itemLevel}`;
  return (
    <>
      {valuation.pending ? (
        <output>Estimating replacement price…</output>
      ) : null}
      {valuation.unavailable ? (
        <output>Unable to estimate replacement price</output>
      ) : null}
      <span className="mb-3 block border-b border-amber-950/80 pb-2">
        {itemLevel === 0 && (
          <span className="block text-emerald-100/65">
            Default price: {abbreviatedGold(valuation.defaultPrice)} gold
          </span>
        )}
        <span className="block text-cyan-300">
          Lowest price seen:{' '}
          {observedPrice(
            observed?.lowest,
            observed?.lowestLevel,
            'Not observed',
          )}
        </span>
        <span className="block text-cyan-100/65">
          Most recent price seen:{' '}
          {observedPrice(
            observed?.recent,
            observed?.recentLevel,
            'Not observed',
          )}
        </span>
        <span className="block text-cyan-100/65">
          Current market low:{' '}
          {observedPrice(
            observed?.marketLow,
            observed?.marketLowLevel,
            'No fresh listing',
          )}
        </span>
        <span className="block text-violet-200/70">
          Highest public WTB:{' '}
          {observedPrice(
            observed?.highestPublicWTB,
            observed?.highestPublicWTBLevel,
            'Not advertised',
          )}
        </span>
      </span>
      {valuation.sources.length ? (
        <span className="mb-2 block space-y-2">
          {valuation.sources.map((source) => (
            <span
              key={`${source.monsterId}:${source.mapId || ''}`}
              className="flex items-start gap-2 rounded border border-amber-950/80 bg-amber-950/15 p-2"
            >
              <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
                {source.sprite ? (
                  <SpriteCrop sprite={source.sprite} size={32} />
                ) : source.purchase ? (
                  <Coins className="h-5 w-5 text-amber-300" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block text-amber-300">
                  Suggested price (
                  {source.worldDrop
                    ? `world drop · ${source.monsterName}`
                    : source.monsterName}
                  ): {abbreviatedGold(source.suggested)} gold
                </span>
                {source.purchase ? (
                  Number(entry.item.level || 0) > 0 ? (
                    <span className="block text-emerald-100/55">
                      90% chance of producing +{entry.item.level} within this
                      budget · approximately{' '}
                      {(source.attempts || 0).toLocaleString()} base items ·{' '}
                      {(source.scrolls || [])
                        .reduce((sum, count) => sum + count, 0)
                        .toLocaleString()}{' '}
                      scrolls
                    </span>
                  ) : (
                    <span className="block text-emerald-100/55">
                      Guaranteed vendor purchase
                    </span>
                  )
                ) : (
                  <span className="block text-emerald-100/55">
                    {source.kills.toLocaleString()} kills for 90% confidence ·{' '}
                    {(source.rate * 100).toPrecision(3)}% per kill
                    {source.luckMultiplier
                      ? ` at ${(source.luckMultiplier * 100).toFixed(0)}% Luck`
                      : ''}
                    {source.mapName ? ` · ${source.mapName}` : ''}
                  </span>
                )}
                {!source.purchase && source.paths?.length ? (
                  <span
                    className="block truncate text-fuchsia-200/70"
                    title={source.paths.join(' | ')}
                  >
                    Via: {source.paths.join(' | ')}
                  </span>
                ) : null}
              </span>
            </span>
          ))}
        </span>
      ) : (
        <span className="block text-amber-300">
          No repeatably farmable source
        </span>
      )}
      {Number(entry.item.level || 0) > 0 &&
      entry.meta?.upgradeable &&
      !valuation.pending &&
      !valuation.unavailable &&
      valuation.sources.length ? (
        <span className="mt-1 block text-violet-300/80">
          Includes the +{entry.item.level} 90%-confidence replacement estimate.
        </span>
      ) : null}
    </>
  );
}
