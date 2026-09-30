import type { MerchantExchangeItem } from './merchant-exchange-item';
import { ItemSprite } from './item-sprite';
import type { Sprite } from './sprite';
import type { ReactNode } from 'react';
import type { ExchangeRewardTileData } from './exchange-reward-tile';

const rewardPercentage = (chance: number) =>
  chance > 0 && chance < 0.00000001
    ? '<0.000001%'
    : `${Number((chance * 100).toFixed(6))}%`;

export function ItemExchangeDetails({
  id,
  level,
  box,
  exchanges,
  onInspect,
  renderReward,
}: {
  id: string;
  level: number;
  box: boolean;
  exchanges: MerchantExchangeItem[];
  onInspect: (id: string, context: string, level?: number) => void;
  renderReward?: (reward: ExchangeRewardTileData) => ReactNode;
}) {
  const target = (reward: string) => {
    const match = reward.match(/^(.*)-(\d+)$/);
    return { id: match?.[1] || reward, level: Number(match?.[2]) || 0 };
  };
  const prices = exchanges.filter(
    (entry) =>
      entry.reward &&
      target(entry.reward).id === id &&
      target(entry.reward).level === level,
  );
  const rewards = exchanges.filter(
    (entry) => entry.id === id && entry.level === level,
  );
  // A table can award the same item in different quantities or through nested rolls.
  // Sum those mutually exclusive outcomes for the chance of receiving the item.
  const sources = level === 0 ? exchanges.flatMap((entry) => {
    if (entry.reward) return [];
    const chance = entry.results.reduce((sum, result) =>
      sum + (result.id === id && result.kind === id ? result.chance : 0), 0);
    return chance > 0 ? [{ entry, chance }] : [];
  }).sort((a, b) => b.chance - a.chance || a.entry.name.localeCompare(b.entry.name)) : [];
  const row = (
    key: string,
    item: string,
    name: string,
    quantity: number,
    sprite: Sprite | null | undefined,
    detail: string,
    itemLevel = 0,
    inspectable = true,
    rewardTile = false,
    kind?: string,
  ) => (
    rewardTile && renderReward ? <div key={key}>{renderReward({ id: item, level: itemLevel, name, quantity, sprite, detail, kind, onInspect: () => onInspect(item, `Exchange: ${id}`, itemLevel) })}</div> :
    <button
      key={key}
      type="button"
      disabled={!inspectable}
      onClick={() => onInspect(item, `Exchange: ${id}`, itemLevel)}
      className="flex items-center gap-2 rounded border border-amber-900 bg-slate-950 p-2 text-left text-amber-100 hover:border-amber-400 hover:bg-slate-800 disabled:cursor-default disabled:hover:border-amber-900 disabled:hover:bg-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
    >
      <span className="relative h-8 w-8 shrink-0">
        {sprite && <ItemSprite sprite={sprite} />}
      </span>
      <span className="min-w-0 flex-1 text-xs">
        {quantity.toLocaleString()} × {name}
        {itemLevel ? ` +${itemLevel}` : ''}
      </span>
      <span className="shrink-0 font-mono text-xs text-amber-300">
        {detail}
      </span>
    </button>
  );
  return (
    <>
      {!!prices.length && (
        <section className="rounded border border-amber-900 bg-slate-950 p-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-amber-300">
            Exchange price
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {prices.map((entry) =>
              row(
                entry.key,
                entry.id,
                entry.currencyName || entry.id,
                entry.required,
                entry.currencySprite,
                `for ${entry.rewardQuantity || 1}`,
                entry.level,
              ),
            )}
          </div>
        </section>
      )}
      {!!rewards.length && (
        <section className="rounded border border-amber-900 bg-slate-950 p-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-amber-300">
            {box ? 'Rewards' : 'Exchange reward'}
          </h3>
          {rewards.map((entry) => (
            <div key={entry.key} className="mt-3">
              <p className="mb-2 text-xs text-slate-300">
                Exchange {entry.required} ×{' '}
                {entry.currencyName || (entry.reward ? id : entry.name)}
                {entry.npc ? ` · ${entry.npc}` : ''}
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,112px)] items-stretch gap-2">
                {entry.reward
                  ? row(
                      entry.key,
                      target(entry.reward).id,
                      entry.name,
                      entry.rewardQuantity || 1,
                      entry.sprite,
                      '100%',
                      target(entry.reward).level,
                      true,
                      true,
                    )
                  : entry.results.map((result, index) =>
                      row(
                        `${entry.key}-${index}`,
                        result.id,
                        result.name,
                        result.quantity,
                        result.sprite,
                        rewardPercentage(result.chance),
                        0,
                        !['empty', 'gold', 'shells', 'cx', 'cxbundle'].includes(
                          result.kind,
                        ),
                        true,
                        result.kind,
                      ),
                    )}
              </div>
            </div>
          ))}
          {id.startsWith('cosmo') && (
            <p className="mt-2 text-xs text-slate-400">
              Base chances shown. Already-owned cosmetics change these odds.
            </p>
          )}
          {id === 'sixcake' && (
            <p className="mt-2 text-xs text-slate-400">
              Table rewards shown; anniversary bonuses are awarded separately.
            </p>
          )}
        </section>
      )}
      {!!sources.length && (
        <section className="rounded border border-amber-900 bg-slate-950 p-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-amber-300">Reward in</h3>
          <p className="mt-2 text-xs text-slate-300">Chance per exchange using the quantity shown</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {sources.map(({ entry, chance }) => row(
              entry.key, entry.id, entry.name, entry.required, entry.sprite,
              rewardPercentage(chance), entry.level,
            ))}
          </div>
        </section>
      )}
    </>
  );
}
