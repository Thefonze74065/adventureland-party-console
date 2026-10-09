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
import { inventoryCounts } from '@/lib/account-inventory';
import { X, Settings } from 'lucide-react';
import {
  ExchangeMarkControls,
  type ExchangeMarkMode,
} from './exchange-mark-controls';
import { Tooltip as Preview } from '@base-ui/react/tooltip';
import { PartyActionError } from './query-actions';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExchangeRewardTileData } from './exchange-reward-tile';
import { BankSnapshot } from './bank-snapshot';
import { Bankboi } from './bankboi';
import { Char } from './char';
import { CraftMaterial } from './craft-material';
import { ItemMeta } from './item-meta';
import { ItemSprite } from './item-sprite';
import { MerchantBuyItem } from './merchant-buy-item';
import { MerchantCatalog } from './merchant-catalog';
import { MerchantCraftRecipe } from './merchant-craft-recipe';
import { MerchantExchangeItem } from './merchant-exchange-item';
import { Sprite } from './sprite';
import { highestUpgradeLevel, useUpgradeEstimates } from './upgrade-estimate';

export function MerchantCommerceDialog({
  mode,
  onClose,
  catalog,
  characters,
  bank,
  bankbois,
  onInspect,
  onSubmit,
  renderExchangeReward,
  onSaveExchangeMarks,
}: {
  mode: 'buy' | 'craft' | 'exchange' | null;
  renderExchangeReward?: (reward: ExchangeRewardTileData) => ReactNode;
  onSaveExchangeMarks?: (
    drafts: { id: string; level: number; mode: ExchangeMarkMode }[],
  ) => Promise<void>;
  onClose: () => void;
  catalog: MerchantCatalog;
  characters: Char[];
  bank: BankSnapshot | null;
  bankbois: Bankboi[];
  onInspect: (
    item: { id: string; name: string; sprite: Sprite | null },
    meta?: ItemMeta | null,
    exchangeAdd?: { enabled: boolean; onAdd: () => void },
  ) => void;
  onSubmit: (
    buys: {
      id: string;
      quantity: number;
      level?: number;
      budget?: number;
      maxAttempts?: number;
      goldCap?: number;
      acknowledgeUnavailable?: boolean;
    }[],
    crafts: { id: string; quantity: number }[],
    exchanges?: {
      id: string;
      quantity: number;
      level?: number;
      reward?: string;
    }[],
    removeAutoBankMark?: boolean,
  ) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [confirmUnavailable, setConfirmUnavailable] = useState(false);
  const [goldCaps, setGoldCaps] = useState<Record<string, string>>({});
  const [buyCart, setBuyCart] = useState<
    Record<string, { quantity: number; level: number }>
  >({});
  const [craftCart, setCraftCart] = useState<Record<string, number>>({});
  const [exchangeCart, setExchangeCart] = useState<Record<string, number>>({});
  const [hoveredRecipe, setHoveredRecipe] =
    useState<MerchantCraftRecipe | null>(null);
  const [selectedExchange, setSelectedExchange] =
    useState<MerchantExchangeItem | null>(null);
  const [marking, setMarking] = useState(false);
  const [markMode, setMarkMode] = useState<ExchangeMarkMode | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { id: string; level: number; mode: ExchangeMarkMode }>
  >({});
  const [savingMarks, setSavingMarks] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const renderReward = renderExchangeReward
    ? (reward: ExchangeRewardTileData) =>
        renderExchangeReward({
          ...reward,
          marking,
          markMode,
          saving: savingMarks,
          stagedMode: drafts[`${reward.id}@${reward.level}`]?.mode,
          onStage: (item, mode) =>
            setDrafts((current) => ({
              ...current,
              [`${item.id}@${item.level}`]: {
                id: item.id,
                level: item.level,
                mode,
              },
            })),
        })
    : undefined;
  function openRules(item: MerchantExchangeItem | null) {
    setSelectedExchange(item);
    setMarking(false);
    setMarkMode(null);
    setDrafts({});
    setMarkError(null);
  }
  async function toggleMarking() {
    if (!marking) {
      setMarking(true);
      setMarkError(null);
      return;
    }
    setSavingMarks(true);
    setMarkError(null);
    try {
      if (Object.keys(drafts).length) {
        if (!onSaveExchangeMarks)
          throw new Error('Exchange rule saving is unavailable');
        await onSaveExchangeMarks(Object.values(drafts));
      }
      setDrafts({});
      setMarking(false);
      setMarkMode(null);
    } catch (error) {
      setMarkError(
        error instanceof Error
          ? error.message
          : 'Could not save exchange rules',
      );
    } finally {
      setSavingMarks(false);
    }
  }
  const [submitting, setSubmitting] = useState(false);
  const previewId = useId();
  const pending = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<HTMLElement | null>(null);
  const cart: Record<string, number> =
    mode === 'craft'
      ? craftCart
      : mode === 'exchange'
        ? exchangeCart
        : Object.fromEntries(
            Object.entries(buyCart).map(([id, line]) => [id, line.quantity]),
          );
  const draftIdentity1 = [mode];
  const [previousDraftIdentity1, setDraftIdentity1] = useState<
    readonly unknown[] | null
  >(null);
  if (
    !previousDraftIdentity1 ||
    draftIdentity1.some(
      (value, index) => !Object.is(value, previousDraftIdentity1[index]),
    )
  ) {
    setDraftIdentity1(draftIdentity1);
    (() => {
      setSearch('');
      openRules(null);
      setHoveredRecipe(null);
      setPreviewAnchor(null);
      setSubmitError(null);
    })();
  }
  const owned = useMemo(
    () => inventoryCounts(characters, bank, bankbois, true),
    [characters, bank, bankbois],
  );
  const exchangeOwned = useMemo(
    () =>
      inventoryCounts(
        characters.filter((entry) => entry.ctype === 'merchant'),
        bank,
        bankbois,
        true,
      ),
    [characters, bank, bankbois],
  );
  const items =
    mode === 'buy'
      ? catalog.buyable
      : mode === 'exchange'
        ? catalog.exchangeable || []
        : catalog.craftable;
  const catalogKey = (
    item: MerchantBuyItem | MerchantCraftRecipe | MerchantExchangeItem,
  ) => (mode === 'exchange' ? (item as MerchantExchangeItem).key : item.id);
  const buyableById = useMemo(
    () => Object.fromEntries(catalog.buyable.map((item) => [item.id, item])),
    [catalog.buyable],
  );
  const displayedItems =
    mode === 'exchange'
      ? (catalog.exchangeable || []).reduce<MerchantExchangeItem[]>(
          (rows, item) => {
            if (!item.reward) {
              rows.push(item);
              return rows;
            }
            let currency = rows.find(
              (row) => row.choices && row.id === item.id,
            );
            if (!currency) {
              currency = {
                ...item,
                key: `${item.id}@choose`,
                name: item.currencyName || item.id,
                sprite: item.currencySprite || null,
                reward: undefined,
                required: 0,
                choices: [],
              };
              rows.push(currency);
            }
            currency.choices!.push(item);
            return rows;
          },
          [],
        )
      : items;
  const filtered = displayedItems.filter((item) =>
    `${item.name} ${item.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const craftRequirements = useMemo(() => {
    const required: Record<
      string,
      { material: CraftMaterial; quantity: number }
    > = {};
    catalog.craftable.forEach((recipe) => {
      const quantity = cart[recipe.id] || 0;
      if (quantity <= 0) return;
      recipe.materials.forEach((material) => {
        const key = `${material.id}@${material.level || 0}`;
        if (!required[key]) required[key] = { material, quantity: 0 };
        required[key].quantity += material.quantity * quantity;
      });
    });
    return required;
  }, [cart, catalog.craftable]);
  const canPurchaseMaterial = (material: CraftMaterial) =>
    (material.level || 0) === 0 && !!buyableById[material.id];
  const canAddCraft = (recipe: MerchantCraftRecipe) =>
    recipe.materials.every((material) => {
      const key = `${material.id}@${material.level || 0}`;
      const needed =
        (craftRequirements[key]?.quantity || 0) + material.quantity;
      return needed <= (owned[key] || 0) || canPurchaseMaterial(material);
    });
  const ingredientPurchaseCost = Object.entries(craftRequirements).reduce(
    (sum, [key, requirement]) => {
      const missing = Math.max(0, requirement.quantity - (owned[key] || 0));
      return sum + missing * (buyableById[requirement.material.id]?.cost || 0);
    },
    0,
  );
  const additionalRecipeCost = (recipe: MerchantCraftRecipe) =>
    recipe.cost +
    recipe.materials.reduce((sum, material) => {
      const key = `${material.id}@${material.level || 0}`;
      const before = Math.max(
        0,
        (craftRequirements[key]?.quantity || 0) - (owned[key] || 0),
      );
      const after = Math.max(
        0,
        (craftRequirements[key]?.quantity || 0) +
          material.quantity -
          (owned[key] || 0),
      );
      return sum + (after - before) * (buyableById[material.id]?.cost || 0);
    }, 0);
  // The right-hand list is a projection of the cart only. Catalog entries
  // never appear here until the user explicitly selects them.
  const selected = items.filter((item) => Number(cart[catalogKey(item)]) > 0);
  const estimates = useUpgradeEstimates(
    mode === 'buy'
      ? selected.map((item) => ({
          item: item as MerchantBuyItem,
          key: catalogKey(item),
          quantity: cart[catalogKey(item)],
          target: buyCart[item.id]?.level || 0,
        }))
      : [],
  );
  const pendingEstimate =
    mode === 'buy' &&
    selected.some(
      (item) => !estimates[item.id] || estimates[item.id].status === 'pending',
    );
  const unavailable =
    mode === 'buy'
      ? selected.filter((item) => estimates[item.id]?.status === 'unavailable')
      : [];
  const validCaps = unavailable.every(
    (item) =>
      Number.isSafeInteger(Number(goldCaps[item.id])) &&
      Number(goldCaps[item.id]) > 0,
  );
  const hasEstimatedGold =
    mode === 'buy' &&
    selected.some(
      (item) =>
        (buyCart[item.id]?.level || 0) > 0 &&
        (item as MerchantBuyItem).upgradeable,
    );
  const goldTotal =
    selected.reduce(
      (sum, item) =>
        sum +
        (mode === 'buy' && estimates[catalogKey(item)]?.status === 'available'
          ? (
              estimates[catalogKey(item)] as Extract<
                (typeof estimates)[string],
                { status: 'available' }
              >
            ).gold
          : item.cost * cart[catalogKey(item)]),
      0,
    ) + (mode === 'craft' ? ingredientPurchaseCost : 0);
  const materialsAvailable =
    mode !== 'craft' ||
    Object.entries(craftRequirements).every(
      ([key, requirement]) =>
        requirement.quantity <= (owned[key] || 0) ||
        canPurchaseMaterial(requirement.material),
    );
  const exchangeRequired = (id: string, level: number) =>
    (catalog.exchangeable || []).reduce(
      (sum, item) =>
        sum +
        (item.id === id && item.level === level
          ? item.required * (exchangeCart[item.key] || 0)
          : 0),
      0,
    );
  const exchangesAvailable =
    mode !== 'exchange' ||
    selected.every((item) => {
      const exchangeItem = item as MerchantExchangeItem;
      return (
        exchangeRequired(exchangeItem.id, exchangeItem.level) <=
        (exchangeOwned[`${exchangeItem.id}@${exchangeItem.level || 0}`] || 0)
      );
    });
  const add = (id: string) =>
    mode === 'craft'
      ? setCraftCart((old) => ({ ...old, [id]: (old[id] || 0) + 1 }))
      : mode === 'exchange'
        ? setExchangeCart((old) => ({ ...old, [id]: (old[id] || 0) + 1 }))
        : setBuyCart((old) => ({
            ...old,
            [id]: {
              quantity: (old[id]?.quantity || 0) + 1,
              level: old[id]?.level || 0,
            },
          }));
  const setQuantity = (id: string, quantity: number) =>
    mode === 'craft'
      ? setCraftCart((old) => {
          const next = { ...old };
          if (quantity > 0) next[id] = Math.min(9999, quantity);
          else delete next[id];
          return next;
        })
      : mode === 'exchange'
        ? setExchangeCart((old) => {
            const next = { ...old };
            if (quantity > 0) next[id] = Math.min(9999, quantity);
            else delete next[id];
            return next;
          })
        : setBuyCart((old) => {
            const next = { ...old };
            if (quantity > 0)
              next[id] = {
                quantity: Math.min(9999, quantity),
                level: old[id]?.level || 0,
              };
            else delete next[id];
            return next;
          });
  const setBuyLevel = (id: string, level: number) =>
    setBuyCart((old) => ({
      ...old,
      [id]: {
        quantity: old[id]?.quantity || 1,
        level: Math.max(
          0,
          Math.min(highestUpgradeLevel(buyableById[id]), level),
        ),
      },
    }));
  const submit = async (confirmed = false) => {
    if (pendingEstimate) return;
    if (unavailable.length && (!confirmed || !validCaps)) {
      setConfirmUnavailable(true);
      return;
    }
    if (pending.current) return;
    pending.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const lines = selected.map((item) => ({
        id: item.id,
        quantity: cart[catalogKey(item)],
        ...(mode === 'exchange'
          ? {
              level: (item as MerchantExchangeItem).level || 0,
              reward: (item as MerchantExchangeItem).reward,
            }
          : {}),
        ...(mode === 'buy' && buyCart[item.id]?.level
          ? { level: buyCart[item.id].level }
          : {}),
        ...(mode === 'buy' &&
        estimates[item.id]?.status === 'available' &&
        (item as MerchantBuyItem).upgradeable
          ? {
              budget: (
                estimates[item.id] as Extract<
                  (typeof estimates)[string],
                  { status: 'available' }
                >
              ).gold,
            }
          : {}),
        ...(mode === 'buy' && estimates[item.id]?.status === 'unavailable'
          ? { goldCap: Number(goldCaps[item.id]), acknowledgeUnavailable: true }
          : {}),
      }));
      await onSubmit(
        mode === 'buy' ? lines : [],
        mode === 'craft' ? lines : [],
        mode === 'exchange' ? lines : [],
      );
      if (mode === 'craft') setCraftCart({});
      else if (mode === 'exchange') setExchangeCart({});
      else setBuyCart({});
      setConfirmUnavailable(false);
    } catch (error) {
      const missing =
        error instanceof PartyActionError &&
        Array.isArray(error.details.missing)
          ? (error.details.missing as {
              id: string;
              level?: number;
              required: number;
              available: number;
            }[])
          : [];
      setSubmitError(
        (error instanceof Error ? error.message : 'Could not queue order') +
          missing
            .map(
              (item) =>
                ` · ${item.id} +${item.level || 0}: ${item.required} required, ${item.available} available`,
            )
            .join(''),
      );
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };
  return (
    <>
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !savingMarks) {
            openRules(null);
            onClose();
          }
        }}
      >
        <DialogContent
          className="flex max-h-[90vh] flex-col border-emerald-800 bg-[#0b1916] text-emerald-50"
          style={{ width: 'calc(100vw - 2rem)', maxWidth: '1500px' }}
        >
          <DialogHeader>
            <DialogTitle>
              {mode === 'buy'
                ? 'Merchant shopping'
                : mode === 'exchange'
                  ? 'Exchange'
                  : 'Merchant crafting'}
            </DialogTitle>
            <DialogDescription className="text-emerald-100/55">
              {mode === 'buy'
                ? 'Choose anything sold for gold.'
                : mode === 'exchange'
                  ? 'Choose exchange operations backed by the merchant inventory and latest bank snapshot.'
                  : 'Recipes account for materials held by the active party and in the latest bank snapshot.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search items…"
            className="border-emerald-800 bg-black/30"
          />
          <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid max-h-[58vh] grid-cols-2 content-start gap-3 overflow-y-auto pr-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {filtered.map((item) => {
                const recipe =
                  mode === 'craft' ? (item as MerchantCraftRecipe) : null;
                const exchangeItem =
                  mode === 'exchange' ? (item as MerchantExchangeItem) : null;
                const exchangeOwnedCount = exchangeItem
                  ? exchangeOwned[
                      `${exchangeItem.id}@${exchangeItem.level || 0}`
                    ] || 0
                  : 0;
                const enabled = exchangeItem?.choices
                  ? true
                  : exchangeItem
                    ? exchangeOwnedCount >=
                      exchangeItem.required *
                        ((exchangeCart[exchangeItem.key] || 0) + 1)
                    : !recipe || canAddCraft(recipe);
                const catalogMeta = catalog.allItems?.find(
                  (entry) => entry.id === item.id,
                )?.meta || {
                  definition: { name: item.name, g: item.cost },
                  sprite: item.sprite,
                };
                return (
                  <div
                    key={catalogKey(item)}
                    onMouseEnter={(event) => {
                      setHoveredRecipe(recipe);
                      setPreviewAnchor(event.currentTarget);
                    }}
                    onFocus={(event) => {
                      setHoveredRecipe(recipe);
                      setPreviewAnchor(event.currentTarget);
                    }}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        setHoveredRecipe(null);
                    }}
                    onMouseLeave={(event) => {
                      if (!event.currentTarget.contains(document.activeElement))
                        setHoveredRecipe(null);
                    }}
                    className={`group relative flex min-h-36 flex-col items-center rounded border border-emerald-900 bg-black/20 p-2 text-center hover:border-emerald-500 ${enabled || exchangeItem ? '' : 'grayscale opacity-35'}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onInspect(
                          item,
                          catalogMeta,
                          exchangeItem
                            ? {
                                enabled,
                                onAdd: () => {
                                  if (exchangeItem.choices)
                                    openRules(exchangeItem);
                                  else add(catalogKey(item));
                                },
                              }
                            : undefined,
                        )
                      }
                      aria-describedby={
                        recipe && hoveredRecipe === recipe
                          ? previewId
                          : undefined
                      }
                      className="grid w-full flex-1 place-items-center"
                    >
                      <div className="relative h-12 w-12">
                        {item.sprite && <ItemSprite sprite={item.sprite} />}
                      </div>
                      <span className="mt-1 w-full break-words text-xs leading-tight">
                        {item.name}
                      </span>
                      <span className="font-mono text-[10px] text-amber-300">
                        {exchangeItem
                          ? exchangeItem.choices
                            ? `${exchangeOwnedCount} owned`
                            : `${exchangeItem.required} required · ${exchangeOwnedCount} owned`
                          : `${item.cost.toLocaleString()}g`}
                      </span>
                    </button>
                    {exchangeItem && (
                      <Button
                        size="icon"
                        onClick={() => openRules(exchangeItem)}
                        aria-label={`Exchange rules for ${item.name}`}
                        className="absolute right-1 top-1 h-7 w-7 border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={!enabled}
                      onClick={() =>
                        exchangeItem?.choices
                          ? openRules(exchangeItem)
                          : add(catalogKey(item))
                      }
                      className="mt-2 h-7 w-full bg-emerald-800 text-[10px] text-emerald-50 hover:bg-emerald-700"
                    >
                      {exchangeItem?.choices ? 'Choose' : 'Add'}
                    </Button>
                  </div>
                );
              })}
            </div>
            <aside className="min-h-48 overflow-y-auto rounded border border-emerald-900 bg-black/20 p-3">
              <p className="mb-3 font-mono text-xs uppercase text-emerald-300">
                {mode === 'buy'
                  ? 'Cart'
                  : mode === 'exchange'
                    ? 'Exchange cart'
                    : 'Craft list'}
              </p>
              {!selected.length && (
                <p className="text-xs text-emerald-100/40">Nothing selected.</p>
              )}
              {selected.map((item) => (
                <div
                  key={catalogKey(item)}
                  className="mb-2 flex items-center gap-2"
                >
                  <div className="relative h-8 w-8 shrink-0">
                    {item.sprite && <ItemSprite sprite={item.sprite} />}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {item.name}
                    {mode === 'exchange'
                      ? ` ${(item as MerchantExchangeItem).rewardQuantity! > 1 ? `× ${(item as MerchantExchangeItem).rewardQuantity}` : ''} · uses ${(item as MerchantExchangeItem).required} ${(item as MerchantExchangeItem).currencyName || 'ea.'}`
                      : ''}
                  </span>
                  <Input
                    aria-label={`${item.name} quantity`}
                    inputMode="numeric"
                    value={cart[catalogKey(item)]}
                    onChange={(event) =>
                      setQuantity(
                        catalogKey(item),
                        Math.max(
                          0,
                          Number(event.target.value.replace(/[^0-9]/g, '')) ||
                            0,
                        ),
                      )
                    }
                    className="h-7 w-16 border-emerald-800 bg-black/30 px-2 font-mono text-xs"
                  />
                  {mode === 'buy' && (item as MerchantBuyItem).upgradeable ? (
                    <label className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase text-violet-300">
                      Target
                      <Input
                        aria-label={`${item.name} target level`}
                        inputMode="numeric"
                        value={`+${buyCart[item.id]?.level || 0}`}
                        onChange={(event) =>
                          setBuyLevel(
                            item.id,
                            Number(event.target.value.replace(/[^0-9]/g, '')) ||
                              0,
                          )
                        }
                        title="Desired upgrade level"
                        className="h-7 w-16 border-violet-800 bg-black/30 px-2 font-mono text-xs"
                      />
                    </label>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setQuantity(catalogKey(item), 0)}
                    className="h-7 w-7 text-rose-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  {mode === 'buy' &&
                  (buyCart[item.id]?.level || 0) > 0 &&
                  (item as MerchantBuyItem).upgradeable ? (
                    <p className="ml-10 w-full font-mono text-[10px] text-violet-300">
                      {estimates[item.id]?.status === 'available' ? (
                        <>
                          90% budget:{' '}
                          {
                            (
                              estimates[item.id] as Extract<
                                (typeof estimates)[string],
                                { status: 'available' }
                              >
                            ).attempts
                          }{' '}
                          base items ·{' '}
                          {(
                            estimates[item.id] as Extract<
                              (typeof estimates)[string],
                              { status: 'available' }
                            >
                          ).scrolls
                            .map((count, grade) =>
                              count ? `${count} scroll${grade}` : '',
                            )
                            .filter(Boolean)
                            .join(' · ')}
                        </>
                      ) : estimates[item.id]?.status === 'unavailable' ? (
                        'Unable to estimate'
                      ) : (
                        'Estimating…'
                      )}
                    </p>
                  ) : null}
                </div>
              ))}
              {mode === 'craft' && selected.length > 0 && (
                <div className="mt-3 border-t border-violet-900/70 pt-3">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-violet-300">
                    Ingredient totals
                  </p>
                  {Object.entries(craftRequirements).map(
                    ([key, requirement]) => (
                      <div
                        key={key}
                        className="flex items-center gap-2 border-t border-emerald-900/60 py-1.5"
                      >
                        <div className="relative h-6 w-6 shrink-0">
                          {requirement.material.sprite && (
                            <ItemSprite sprite={requirement.material.sprite} />
                          )}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-[11px]">
                          {requirement.material.name}
                          {requirement.material.level
                            ? ` +${requirement.material.level}`
                            : ''}
                        </span>
                        <span
                          className={`shrink-0 whitespace-nowrap font-mono text-[10px] ${requirement.quantity <= (owned[key] || 0) || canPurchaseMaterial(requirement.material) ? 'text-violet-300' : 'text-rose-300'}`}
                          title="Required / available"
                        >
                          {requirement.quantity} needed · {owned[key] || 0}{' '}
                          owned
                          {requirement.quantity > (owned[key] || 0) &&
                          canPurchaseMaterial(requirement.material)
                            ? ` · buy ${requirement.quantity - (owned[key] || 0)}`
                            : ''}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
              {mode !== 'exchange' ? (
                <div className="mt-3 border-t border-emerald-800 pt-3 font-mono text-sm text-amber-300">
                  {unavailable.length ? (
                    'Gold total unavailable'
                  ) : pendingEstimate ? (
                    'Estimating gold…'
                  ) : (
                    <>
                      Gold{hasEstimatedGold ? ' (est)' : ''}:{' '}
                      {goldTotal.toLocaleString()}g
                    </>
                  )}
                </div>
              ) : null}
            </aside>
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-rose-200">
              {submitError}
            </p>
          )}
          <DialogFooter className="shrink-0 border-t border-emerald-900 bg-[#0b1916] pt-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-emerald-800 bg-[#07100f] text-emerald-200 hover:border-emerald-500 hover:bg-emerald-950 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              disabled={
                !selected.length ||
                !materialsAvailable ||
                !exchangesAvailable ||
                submitting ||
                pendingEstimate
              }
              onClick={() => void submit()}
              className="bg-amber-400 text-amber-950 hover:bg-amber-300"
            >
              {submitting
                ? 'Queuing…'
                : mode === 'buy'
                  ? 'Buy all'
                  : mode === 'exchange'
                    ? 'Exchange all'
                    : 'Craft'}
            </Button>
          </DialogFooter>
          {hoveredRecipe && mode === 'craft' && (
            <Preview.Root open disableHoverablePopup>
              <Preview.Portal>
                <Preview.Positioner
                  anchor={previewAnchor}
                  side="right"
                  align="start"
                  sideOffset={8}
                  positionMethod="fixed"
                  collisionPadding={8}
                  collisionAvoidance={{
                    side: 'flip',
                    align: 'shift',
                    fallbackAxisSide: 'end',
                  }}
                  className="pointer-events-none z-[100] data-[anchor-hidden]:hidden"
                >
                  <Preview.Popup
                    id={previewId}
                    className="pointer-events-none w-80 max-w-[var(--available-width)] max-h-[var(--available-height)] overflow-hidden rounded-lg border border-violet-600 bg-[#07100f] p-4 text-emerald-50 shadow-2xl"
                  >
                    <p className="text-sm font-semibold text-violet-200">
                      {hoveredRecipe.name}
                    </p>
                    <p className="mb-3 font-mono text-[10px] uppercase text-violet-300">
                      Complete recipe
                    </p>
                    {hoveredRecipe.materials.map((material) => {
                      const key = `${material.id}@${material.level || 0}`;
                      const available = owned[key] || 0;
                      const purchasable = canPurchaseMaterial(material);
                      return (
                        <div
                          key={`${material.id}-${material.level}`}
                          className="flex items-center gap-3 border-t border-violet-950 py-2"
                        >
                          <div className="relative h-8 w-8 shrink-0">
                            {material.sprite && (
                              <ItemSprite sprite={material.sprite} />
                            )}
                          </div>
                          <span className="min-w-0 flex-1 text-xs">
                            {material.quantity} × {material.name}
                            {material.level ? ` +${material.level}` : ''}
                          </span>
                          <span
                            className={`font-mono text-[10px] ${available >= material.quantity || purchasable ? 'text-emerald-300' : 'text-rose-300'}`}
                          >
                            {available >= material.quantity
                              ? `${available} owned`
                              : purchasable
                                ? `${available} owned · buy ${material.quantity - available}`
                                : `${available} owned · missing`}
                          </span>
                        </div>
                      );
                    })}
                    <p className="mt-3 border-t border-violet-800 pt-3 text-right font-mono text-xs text-amber-300">
                      Next craft:{' '}
                      {additionalRecipeCost(hoveredRecipe).toLocaleString()}
                      g total
                    </p>
                  </Preview.Popup>
                </Preview.Positioner>
              </Preview.Portal>
            </Preview.Root>
          )}
          {selectedExchange && mode === 'exchange' && (
            <div className="absolute inset-6 z-[110] flex flex-col rounded-lg border border-cyan-700 bg-[#07100f] p-5 shadow-2xl">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12">
                    {selectedExchange.sprite && (
                      <ItemSprite sprite={selectedExchange.sprite} />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-cyan-100">
                      {selectedExchange.name}
                    </p>
                    <p className="font-mono text-[10px] uppercase text-cyan-300">
                      {selectedExchange.choices
                        ? 'Choose a reward'
                        : `${selectedExchange.required} required per exchange`}
                    </p>
                  </div>
                </div>
                <Button
                  disabled={savingMarks}
                  onClick={toggleMarking}
                  aria-busy={savingMarks}
                  className="h-9 w-32 shrink-0 border border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900"
                >
                  {marking ? 'Done' : 'Mark multiple'}
                </Button>
                <div className="ml-auto">
                  <ExchangeMarkControls
                    enabled={marking}
                    mode={markMode}
                    saving={savingMarks}
                    onMode={setMarkMode}
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openRules(null)}
                  disabled={savingMarks}
                  aria-label="Close exchange details"
                  className="border border-rose-700 bg-black text-rose-300 hover:bg-rose-950 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {marking && (
                <p className="mt-3 text-xs text-sky-200">
                  {Object.keys(drafts).length} pending changes. Done saves;
                  closing discards.
                  {markMode?.action === 'stand'
                    ? ' Existing prices are kept; new stand rules use the item gold value.'
                    : ''}
                </p>
              )}
              {markError && (
                <p role="alert" className="mt-2 text-sm text-rose-300">
                  {markError}
                </p>
              )}
              <p className="mt-5 font-mono text-xs uppercase text-emerald-300">
                {selectedExchange.choices
                  ? 'Available rewards'
                  : 'Potential results'}
              </p>
              <div
                className={`mt-2 min-h-0 flex-1 content-start gap-2 overflow-y-auto ${selectedExchange.choices ? 'flex flex-wrap items-start' : 'grid max-w-[1072px] grid-cols-[repeat(auto-fill,112px)] items-stretch'}`}
              >
                {selectedExchange.choices?.map((choice) => (
                  <div
                    key={choice.key}
                    className="flex items-center gap-3 rounded border border-cyan-800 bg-[#06110f] p-3 text-emerald-50"
                  >
                    {renderReward ? (
                      renderReward({
                        id: choice.reward?.replace(/-\d+$/, '') || choice.id,
                        level:
                          Number(choice.reward?.match(/-(\d+)$/)?.[1]) || 0,
                        name: choice.name,
                        quantity: choice.rewardQuantity || 1,
                        sprite: choice.sprite,
                        detail: '100%',
                        onInspect: () => {
                          const reward = catalog.allItems?.find(
                            (item) =>
                              item.id === choice.reward?.replace(/-\d+$/, ''),
                          );
                          if (reward) onInspect(reward, reward.meta);
                        },
                      })
                    ) : (
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => {
                          const reward = catalog.allItems?.find(
                            (item) => item.id === choice.reward?.split('-')[0],
                          );
                          if (reward) onInspect(reward, reward.meta);
                        }}
                      >
                        <div className="relative h-10 w-10 shrink-0">
                          {choice.sprite && (
                            <ItemSprite sprite={choice.sprite} />
                          )}
                        </div>
                        <span className="text-sm">
                          {choice.name}
                          {(choice.rewardQuantity || 1) > 1
                            ? ` × ${choice.rewardQuantity}`
                            : ''}
                        </span>
                      </button>
                    )}
                    <span
                      className="flex items-center gap-1 text-sm text-amber-200"
                      title={choice.currencyName}
                    >
                      <span className="relative h-6 w-6">
                        {choice.currencySprite && (
                          <ItemSprite sprite={choice.currencySprite} />
                        )}
                      </span>
                      × {choice.required}
                    </span>
                    <Button
                      disabled={
                        exchangeRequired(choice.id, choice.level) +
                          choice.required >
                        (exchangeOwned[`${choice.id}@${choice.level}`] || 0)
                      }
                      onClick={() => add(choice.key)}
                      className="border border-cyan-700 bg-black text-cyan-100 hover:bg-cyan-950 hover:text-white"
                    >
                      Add
                    </Button>
                  </div>
                ))}
                {selectedExchange.results.map((result, index) => {
                  const reward = ![
                    'gold',
                    'shells',
                    'cx',
                    'empty',
                    'open',
                  ].includes(result.kind)
                    ? catalog.allItems?.find((entry) => entry.id === result.id)
                    : null;
                  const content = (
                    <>
                      <div className="relative h-10 w-10 shrink-0">
                        {result.sprite && <ItemSprite sprite={result.sprite} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs">
                          {result.name}
                          {result.quantity > 1 ? ` × ${result.quantity}` : ''}
                        </p>
                        <p className="font-mono text-[10px] text-amber-300">
                          {(result.chance * 100).toFixed(
                            result.chance * 100 < 0.01 ? 4 : 2,
                          )}
                          %
                        </p>
                      </div>
                    </>
                  );
                  if (renderReward)
                    return (
                      <div key={`${result.kind}-${result.id}-${index}`}>
                        {renderReward({
                          id: result.id,
                          level: 0,
                          name: result.name,
                          quantity: result.quantity,
                          sprite: result.sprite,
                          kind: result.kind,
                          detail: `${Number((result.chance * 100).toFixed(6))}%`,
                          onInspect: () => {
                            const nested = catalog.exchangeable?.find(
                              (choice) =>
                                !choice.reward &&
                                choice.id === result.id &&
                                !choice.level,
                            );
                            if (nested) setSelectedExchange(nested);
                            else if (reward) onInspect(reward, reward.meta);
                          },
                        })}
                      </div>
                    );
                  return reward ? (
                    <button
                      type="button"
                      key={`${result.kind}-${result.id}-${index}`}
                      onClick={() => onInspect(reward, reward.meta)}
                      aria-label={`Inspect ${reward.name}`}
                      className="flex items-center gap-3 rounded border border-emerald-800 bg-black/40 p-3 text-left text-emerald-50 transition hover:border-cyan-400 hover:bg-cyan-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      key={`${result.kind}-${result.id}-${index}`}
                      className="flex items-center gap-3 rounded border border-emerald-900 bg-black/25 p-3"
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmUnavailable && mode === 'buy'}
        onOpenChange={setConfirmUnavailable}
      >
        <DialogContent className="border-amber-800 bg-[#0b1916] text-emerald-50">
          <DialogHeader>
            <DialogTitle>Unable to estimate this order</DialogTitle>
            <DialogDescription className="text-emerald-100">
              Unable to estimate how many operations are required to fill this
              order. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-emerald-100">
            Set a maximum gold spend for each unavailable line. This covers base
            items and scroll purchases and remains in force after restart.
          </p>
          {unavailable.map((item) => (
            <label key={item.id} className="block text-emerald-100">
              {item.name}
              <Input
                aria-label={`${item.name} maximum gold`}
                inputMode="numeric"
                value={goldCaps[item.id] || ''}
                onChange={(event) =>
                  setGoldCaps((old) => ({
                    ...old,
                    [item.id]: event.target.value,
                  }))
                }
                className="border-emerald-600 bg-[#07100f] text-white"
              />
            </label>
          ))}
          {submitError ? (
            <p role="alert" className="text-rose-200">
              {submitError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => setConfirmUnavailable(false)}
              className="border border-emerald-600 bg-[#07100f] text-emerald-100 hover:bg-emerald-950 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              disabled={!validCaps || submitting || pendingEstimate}
              onClick={() => void submit(true)}
              className="border border-amber-500 bg-amber-400 text-amber-950 hover:bg-amber-300"
            >
              Confirm order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
