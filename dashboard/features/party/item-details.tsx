"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, DollarSign, HandCoins, MapPin, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { TracktrixBonuses } from './tracktrix-bonuses';
import { BestiaryDrops } from "./bestiary-drops";
import { BestiaryMonster } from "./bestiary-monster";
import { calculatedLevelProperties } from "./calculated-level-properties";
import { Char } from "./char";
import { comparisonSlotLabel } from "./comparison-slot-label";
import { comparisonSlotsFor } from "./comparison-slots-for";
import { COMPARISON_SLOTS } from "./comparison-slots";
import { DefinitionGrid } from "./definition-grid";
import { durationStat } from "./format-duration";
import { InventoryEntry } from "./inventory-entry";
import { EQUIPMENT_TYPES } from "./equipment-types";
import { propertiesAtLevel } from "./properties-at-level";
import { Item } from "./item";
import { ITEM_DETAIL_PROPERTY_RANK } from "./item-detail-property-rank";
import { effectiveDropRate, formatDropRate as dropRate } from "./drop-rate";
import { itemMaximumLevel } from "./item-maximum-level";
import { ItemMeta } from "./item-meta";
import { ItemSprite } from "./item-sprite";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { MonsterAchievementProgress } from "./monster-achievement-progress";
import { npcSaleValue } from "./npc-sale-value";
import { SelectedItem } from "./selected-item";
import { SpriteCrop } from "./sprite-crop";

import { ItemExchangeDetails } from "./item-exchange-details";
import type { MerchantExchangeItem } from "./merchant-exchange-item";
import type { ReactNode } from 'react';
import type { ExchangeRewardTileData } from './exchange-reward-tile';

export function ItemDetails({
  selected: initialSelected,
  catalog,
  exchanges = [],
  renderExchangeReward,
  monsters,
  characters,
  achievements,
  standFull,
  onNavigate,
  onAddWTB,
  onAddStand,
  onCompare,
  onCompareCatalog,
  onOpenChange,
}: {
  selected: SelectedItem | null;
  catalog: MerchantCatalogItem[];
  exchanges?: MerchantExchangeItem[];
  renderExchangeReward?: (reward: ExchangeRewardTileData) => ReactNode;
  monsters: BestiaryMonster[];
  characters: Char[];
  achievements: Record<string, { score: number; owner: string | null }>;
  standFull: boolean;
  onNavigate: (monster: BestiaryMonster) => void;
  onAddWTB: (item: Item, meta?: ItemMeta | null) => void;
  onAddStand: (entry: InventoryEntry, source: NonNullable<SelectedItem["source"]>) => void;
  onCompare: (character: Char, entry: InventoryEntry, slot?: string) => void;
  onCompareCatalog: (entry: InventoryEntry) => void;
  onOpenChange: (open: boolean) => void;
}) {
  type DetailNode =
    | { kind: "item"; selected: SelectedItem }
    | { kind: "monster"; monster: BestiaryMonster };
  const [trail, setTrail] = useState<DetailNode[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [dropSort, setDropSort] = useState<"name" | "percentage">("percentage");
  const [compareCharacter, setCompareCharacter] = useState<Char | null>(null);
  const draftIdentity1 = [
    initialSelected?.character,
    initialSelected?.entry.slot,
    initialSelected?.entry.item.name,
  ];
  const [previousDraftIdentity1, setDraftIdentity1] = useState<readonly unknown[] | null>(null);
  if (
    !previousDraftIdentity1 ||
    draftIdentity1.some((value, index) => !Object.is(value, previousDraftIdentity1[index]))
  ) {
    setDraftIdentity1(draftIdentity1);
    (() => {
      setTrail([]);
    })();
  }
  const active = trail[trail.length - 1];
  const selected = active?.kind === "item" ? active.selected : initialSelected;
  const selectedMonster = active?.kind === "monster" ? active.monster : null;
  const actualLevel = Math.max(0, Number(selected?.entry.item.level) || 0);
  const [previewLevel, setPreviewLevel] = useState(actualLevel);
  const draftIdentity2 = [
    selected?.character,
    selected?.entry.slot,
    selected?.entry.item.name,
    actualLevel,
  ];
  const [previousDraftIdentity2, setDraftIdentity2] = useState<readonly unknown[] | null>(null);
  if (
    !previousDraftIdentity2 ||
    draftIdentity2.some((value, index) => !Object.is(value, previousDraftIdentity2[index]))
  ) {
    setDraftIdentity2(draftIdentity2);
    (() => {
      setPreviewLevel(actualLevel);
    })();
  }
  const draftIdentity3 = [selected?.character, selected?.entry.slot, selected?.entry.item.name];
  const [previousDraftIdentity3, setDraftIdentity3] = useState<readonly unknown[] | null>(null);
  if (
    !previousDraftIdentity3 ||
    draftIdentity3.some((value, index) => !Object.is(value, previousDraftIdentity3[index]))
  ) {
    setDraftIdentity3(draftIdentity3);
    (() => {
      setCompareOpen(false);
      setCompareCharacter(null);
    })();
  }
  const onInspectItem = (itemId: string, context: string, level = 0) => {
    const found = catalog.find((entry) => entry.id === itemId);
    if (!found) return;
    setTrail((current) => [
      ...current,
      {
        kind: "item",
        selected: {
          character: context,
          entry: { slot: -1, item: { name: itemId, level }, meta: found.meta },
        },
      },
    ]);
  };
  const onInspectMonster = (monsterId: string) => {
    const found = monsters.find((monster) => monster.id === monsterId);
    if (found) setTrail((current) => [...current, { kind: "monster", monster: found }]);
  };
  const goBack = () => setTrail((current) => current.slice(0, -1));
  const compareEntry = selected
    ? {
        ...selected.entry,
        item: { ...selected.entry.item, level: previewLevel },
      }
    : null;
  const comparable =
    !!selected &&
    EQUIPMENT_TYPES.includes(String(selected.entry.meta?.definition.type || ""));
  const chooseComparisonCharacter = (character: Char) => {
    if (!compareEntry) return;
    const slots = comparisonSlotsFor(compareEntry.meta, character);
    if (slots.length > 1) {
      setCompareCharacter(character);
      return;
    }
    setCompareOpen(false);
    onCompare(character, compareEntry, slots[0]);
  };
  const def = selected?.entry.meta?.definition || {},
    properties = selected?.entry.meta?.properties || {},
    world = selected?.entry.meta?.world,
    currentCalculated = calculatedLevelProperties(
      selected?.entry.meta ?? undefined,
      selected?.entry.item || { name: "" },
      actualLevel,
    ),
    previewCalculated = calculatedLevelProperties(
      selected?.entry.meta ?? undefined,
      selected?.entry.item || { name: "" },
      previewLevel,
    ),
    previewProperties = Object.keys({
      ...currentCalculated,
      ...previewCalculated,
    }).reduce<Record<string, string | number | boolean>>((out, key) => {
      const current = Number(properties[key] ?? currentCalculated[key] ?? 0);
      const delta = Number(previewCalculated[key] || 0) - Number(currentCalculated[key] || 0);
      const value = current + delta;
      if (value) out[key] = value;
      return out;
    }, {}),
    display = {
      ...def,
      ...previewProperties,
      ...((COMPARISON_SLOTS[String(def.type)] || []).length ? {
        equip_slot: def.type === "weapon"
          ? "Main hand" + (selected?.entry.meta?.usage?.hands.includes(1) ? " (off hand depends on class)" : "")
          : COMPARISON_SLOTS[String(def.type)].map((slot) => {
              const label = comparisonSlotLabel(slot);
              return label.charAt(0).toUpperCase() + label.slice(1);
            }).join(" or "),
      } : {}),
      stackable: Number(def.s || 1) > 1,
      ...(Number(def.s || 0) > 1 ? { max_stack_size: Number(def.s) } : {}),
    },
    ignored = new Set([
      "skin",
      "skin_a",
      "skin_c",
      "skin_r",
      "name",
      "explanation",
      "type",
      "g",
      "s",
      "grades",
      "upgrade",
      "compound",
      "level",
      "set",
    ]);
  const stats = Object.entries(display)
    .filter(([key]) => !ignored.has(key))
    .sort(([left], [right]) => {
      const leftRank = ITEM_DETAIL_PROPERTY_RANK.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = ITEM_DETAIL_PROPERTY_RANK.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.localeCompare(right);
    });
  const statSummary = (values: Record<string, string | number | boolean>) =>
    Object.entries(values)
      .map(
        ([key, value]) =>
          `${key.replaceAll("_", " ")} ${typeof value === "number" && value > 0 ? "+" : ""}${String(value)}`,
      )
      .join(" · ");
  if (selectedMonster)
    return (
      <Dialog open={!!initialSelected} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border border-rose-800 bg-[#0b1916] text-emerald-50 sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={goBack}
                title="Back"
                aria-label="Back"
                className="shrink-0 text-rose-200 hover:bg-rose-950"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="relative h-14 w-14 shrink-0">
                {selectedMonster.sprite && <SpriteCrop sprite={selectedMonster.sprite} size={56} />}
              </div>
              <div>
                <DialogTitle>{selectedMonster.name}</DialogTitle>
                <DialogDescription className="mt-1 font-mono text-emerald-100/45">
                  G.monsters.{selectedMonster.id}
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onNavigate(selectedMonster)}
                title={`Navigate to ${selectedMonster.name}`}
                aria-label={`Navigate to ${selectedMonster.name}`}
                className="ml-auto shrink-0 border-cyan-600 bg-black text-cyan-200 hover:bg-cyan-950 hover:text-white"
              >
                <MapPin className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <MonsterAchievementProgress
            monster={selectedMonster}
            achievement={achievements[selectedMonster.id] || null}
          />
          <DefinitionGrid
            value={selectedMonster.definition}
            omit={["name", "skin", "achievements"]}
          />
          <section className="rounded border border-amber-900/80 bg-amber-950/10 p-4">
            <BestiaryDrops
              monster={selectedMonster}
              catalog={catalog}
              onInspectDrop={(itemId) =>
                onInspectItem(itemId, `Dropped by ${selectedMonster.name}`)
              }
            />
          </section>
        </DialogContent>
      </Dialog>
    );
  return (
    <Dialog open={!!initialSelected} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border border-emerald-800 bg-[#0b1916] text-emerald-50 sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-4 pr-8">
            {trail.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={goBack}
                title="Back"
                aria-label="Back"
                className="shrink-0 text-emerald-200 hover:bg-emerald-950"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {selected?.entry.meta?.sprite && (
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded border border-emerald-700 bg-black">
                <ItemSprite sprite={selected.entry.meta.sprite} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle>
                {String(def.name || selected?.entry.item.name || "Item")}
                {selected?.entry.item.level ? ` +${selected.entry.item.level}` : ""}
              </DialogTitle>
              <DialogDescription className="mt-1 text-emerald-100/55">
                {selected?.character} · slot {selected?.entry.slot}
              </DialogDescription>
            </div>
            {selected?.entry.item.name ? (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {selected.source && selected.entry.slot >= 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={standFull}
                    onClick={() => onAddStand(selected.entry, selected.source!)}
                    className="border-amber-600 bg-black text-amber-200 hover:bg-amber-950 hover:text-white disabled:border-slate-700 disabled:bg-black disabled:text-slate-600"
                  >
                    <DollarSign className="mr-2 h-4 w-4" />
                    Add to stand
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    onAddWTB({ ...selected.entry.item, level: previewLevel }, selected.entry.meta)
                  }
                  className="border-violet-600 bg-black text-violet-200 hover:bg-violet-950 hover:text-white"
                >
                  <HandCoins className="mr-2 h-4 w-4" />
                  Add to WTB
                </Button>
              </div>
            ) : null}
          </div>
        </DialogHeader>
        {selected && ['tracker', 'supercomputer'].includes(selected.entry.item.name) && characters.some(character => character.name === selected.character) && <TracktrixBonuses name={selected.character} />}
        {def.explanation && (
          <p className="text-sm leading-6 text-emerald-50/80">{String(def.explanation)}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
        {selected?.entry && (
          <div className="flex items-center justify-between rounded border border-amber-900/70 bg-amber-950/10 px-3 py-2 text-xs">
            <span className="text-emerald-100/55">Buy from NPC</span>
            <span className="font-mono text-amber-300">
              {selected.entry.meta?.buyable && previewLevel === 0 && Number.isFinite(Number(def.g))
                ? `${Number(def.g).toLocaleString()}g`
                : "unavailable"}
            </span>
          </div>
        )}
        {selected?.entry ? (
          <div className="flex items-center justify-between rounded border border-rose-900/60 bg-rose-950/10 px-3 py-2 text-xs">
            <span className="text-emerald-100/55">Sell to NPC</span>
            <span className="font-mono text-rose-200">
              {npcSaleValue(
                { ...selected.entry.item, level: previewLevel },
                selected.entry.meta,
              ).toLocaleString()}
              g
            </span>
          </div>
        ) : null}
        </div>
        {!!selected?.entry.meta?.usage?.classes.length && (
          <section className="rounded border border-sky-900/70 bg-sky-950/10 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-sky-300">
                Eligible classes
              </span>
              {selected.entry.meta.usage.classes.map((entry) => (
                <span
                  key={entry.id}
                  className="rounded border border-sky-800/70 bg-black/25 px-2 py-1 text-[11px] text-sky-100"
                >
                  {entry.name}
                  {entry.hands ? ` · ${entry.hands}H` : ""}
                </span>
              ))}
            </div>
            {!!selected.entry.meta.usage.hands.length && (
              <p className="mt-2 text-xs text-emerald-100/55">
                Hands required:{" "}
                <span className="font-mono text-sky-200">
                  {selected.entry.meta.usage.hands.join(" or ")}
                </span>
                {selected.entry.meta.usage.hands.length > 1 ? " depending on class" : ""}
              </p>
            )}
          </section>
        )}
        {(selected?.entry.meta?.upgradeable || selected?.entry.meta?.compoundable) && (
          <section className="rounded border border-violet-900/80 bg-violet-950/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-violet-300">
                  Level stat preview
                </h3>
                <p className="mt-1 text-[11px] text-emerald-100/45">
                  Preview only—the item is not changed.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {comparable ? (
                  <Popover
                    open={compareOpen}
                    onOpenChange={(open) => {
                      setCompareOpen(open);
                      if (!open) setCompareCharacter(null);
                    }}
                  >
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-cyan-600 bg-black text-cyan-100 hover:border-cyan-400 hover:bg-cyan-950 hover:text-white"
                        />
                      }
                    >
                      <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
                      Compare
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-72 border border-cyan-700 bg-[#07100f] p-2 text-cyan-50 shadow-2xl"
                    >
                      {compareCharacter ? (
                        <>
                          <div className="mb-2 flex items-center gap-2 border-b border-cyan-900 pb-2">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              onClick={() => setCompareCharacter(null)}
                              aria-label="Back to characters"
                              title="Back to characters"
                              className="h-7 w-7 border-cyan-700 bg-black text-cyan-200 hover:bg-cyan-950 hover:text-white"
                            >
                              <ArrowLeft className="h-3.5 w-3.5" />
                            </Button>
                            <div>
                              <p className="text-xs font-semibold text-cyan-100">
                                {compareCharacter.name}
                              </p>
                              <p className="font-mono text-[10px] uppercase text-cyan-300">
                                Choose equipment slot
                              </p>
                            </div>
                          </div>
                          <div className="grid gap-1">
                            {comparisonSlotsFor(selected?.entry.meta, compareCharacter).map(
                              (slot) => (
                                <button
                                  type="button"
                                  key={slot}
                                  onClick={() => {
                                    if (compareEntry)
                                      onCompare(compareCharacter, compareEntry, slot);
                                    setCompareOpen(false);
                                  }}
                                  className="flex items-center justify-between gap-3 border border-cyan-900 bg-black px-3 py-2 text-left text-xs text-cyan-50 transition hover:border-cyan-400 hover:bg-cyan-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                                >
                                  <span>{comparisonSlotLabel(slot)}</span>
                                  <span className="min-w-0 truncate font-mono text-[10px] text-cyan-200/60">
                                    {compareCharacter.slots[slot]
                                      ? String(
                                          compareCharacter.slots[slot].meta?.definition.name ||
                                            compareCharacter.slots[slot].item.name,
                                        )
                                      : "Empty"}
                                  </span>
                                </button>
                              ),
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="mb-2 border-b border-cyan-900 px-1 pb-2 font-mono text-[10px] uppercase tracking-wider text-cyan-300">
                            Compare +{previewLevel} for
                          </p>
                          <div className="grid gap-1">
                            {characters.map((character) => (
                              <button
                                type="button"
                                key={character.name}
                                onClick={() => chooseComparisonCharacter(character)}
                                className="flex items-center justify-between border border-cyan-900 bg-black px-3 py-2 text-left text-xs text-cyan-50 transition hover:border-cyan-400 hover:bg-cyan-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                              >
                                <span>{character.name}</span>
                                <span className="font-mono text-[10px] uppercase text-cyan-200/55">
                                  {character.ctype}
                                </span>
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setCompareOpen(false);
                                if (compareEntry && selected) onCompareCatalog({
                                  ...compareEntry,
                                  meta: selected.entry.meta ? {
                                    ...selected.entry.meta,
                                    properties: propertiesAtLevel(selected.entry.meta, selected.entry.item, previewLevel, selected.entry.item.stat_type),
                                  } : selected.entry.meta,
                                });
                              }}
                              className="mt-1 border border-cyan-700 bg-[#10251f] px-3 py-2 text-left text-sm text-cyan-100 hover:border-cyan-400 hover:bg-cyan-950 hover:text-white"
                            >
                              From catalog
                            </button>
                          </div>
                        </>
                      )}
                    </PopoverContent>
                  </Popover>
                ) : null}
                <span className="rounded border border-violet-700 bg-black/40 px-2 py-1 font-mono text-sm text-violet-200">
                  +{previewLevel}
                  {previewLevel === actualLevel ? " · current" : ""}
                </span>
              </div>
            </div>
            <Slider
              min={0}
              max={Math.max(actualLevel, itemMaximumLevel(selected.entry.meta))}
              step={1}
              value={previewLevel}
              onValueChange={(value) =>
                setPreviewLevel(typeof value === "number" ? value : value[0] || 0)
              }
            />
            <div className="relative mt-2 h-4 font-mono text-[9px] text-violet-200/50">
              <span className="absolute left-0">+0</span>
              <span
                className="absolute -translate-x-1/2 text-amber-300"
                style={{
                  left: `${(actualLevel / Math.max(1, actualLevel, itemMaximumLevel(selected.entry.meta))) * 100}%`,
                }}
              >
                +{actualLevel} current
              </span>
              <span className="absolute right-0">
                +{Math.max(actualLevel, itemMaximumLevel(selected.entry.meta))}
              </span>
            </div>
          </section>
        )}
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2 border-t border-emerald-900 pt-4">
          {stats.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 border-b border-emerald-950 pb-1">
              <dt className="capitalize text-emerald-100/50">{key.replaceAll("_", " ")}</dt>
              <dd className="font-mono text-emerald-200">
                {durationStat(key, value, def) ?? (Array.isArray(value)
                  ? value.map((v) => (Array.isArray(v) ? v.join(" ") : String(v))).join(", ")
                  : String(value))}
              </dd>
            </div>
          ))}
        </dl>
        {world?.set && (
          <section className="rounded border border-cyan-900/80 bg-cyan-950/10 p-4">
            <h3 className="font-mono text-xs uppercase tracking-wider text-cyan-300">
              Set bonus · {world.set.name}
            </h3>
            {world.set.explanation && (
              <p className="mt-2 text-xs leading-5 text-emerald-100/60">{world.set.explanation}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {world.set.items.map((item) => (
                <button
                  type="button"
                  onClick={() => onInspectItem(item.id, world.set?.name || "Item set")}
                  key={item.id}
                  className={`flex items-center gap-2 rounded border p-2 text-left transition hover:border-cyan-400 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${item.id === selected?.entry.item.name ? "border-cyan-400 bg-cyan-400/10" : "border-cyan-950"}`}
                >
                  <div className="relative h-8 w-8 shrink-0">
                    {item.sprite && <ItemSprite sprite={item.sprite} />}
                  </div>
                  <span className="text-[11px]">
                    {item.quantity > 1 ? `${item.quantity} × ` : ""}
                    {item.name}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-1">
              {world.set.bonuses.map((bonus) => (
                <div
                  key={bonus.pieces}
                  className="flex gap-3 border-t border-cyan-950 py-1.5 text-xs"
                >
                  <span className="w-16 shrink-0 font-mono text-cyan-300">
                    {bonus.pieces} pieces
                  </span>
                  <span className="text-emerald-100/75">{statSummary(bonus.stats)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {!!world?.usedIn?.length && (
          <section className="rounded border border-emerald-900/80 bg-emerald-950/10 p-4">
            <h3 className="font-mono text-xs uppercase tracking-wider text-emerald-300">
              Ingredient in
            </h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {world.usedIn.map((use) => (
                <button
                  type="button"
                  key={`${use.id}-${use.level}`}
                  onClick={() =>
                    onInspectItem(
                      use.id,
                      `Crafted with ${String(def.name || selected?.entry.item.name || "ingredient")}`,
                    )
                  }
                  className="flex items-center gap-2 rounded border border-emerald-950 p-2 text-left transition hover:border-emerald-500 hover:bg-emerald-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <div className="relative h-8 w-8 shrink-0">
                    {use.sprite && <ItemSprite sprite={use.sprite} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">{use.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-emerald-100/50">
                      Uses {use.quantity} ×{use.level ? ` at +${use.level}` : ""} ·{" "}
                      {use.cost.toLocaleString()}g craft fee
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
        {world?.recipe && (
          <section className="rounded border border-violet-900/80 bg-violet-950/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-mono text-xs uppercase tracking-wider text-violet-300">
                Craftable
              </h3>
              <span className="font-mono text-xs text-amber-300">
                {world.recipe.cost.toLocaleString()}g fee
              </span>
            </div>
            {world.recipe.quest && (
              <p className="mt-1 text-[11px] text-violet-200/55">
                Requires quest: {world.recipe.quest}
              </p>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {world.recipe.materials.map((material) => (
                <button
                  type="button"
                  onClick={() =>
                    onInspectItem(
                      material.id,
                      `Recipe ingredient for ${String(def.name || selected?.entry.item.name || "item")}`,
                      material.level ?? 0,
                    )
                  }
                  key={`${material.id}-${material.level}`}
                  className="flex items-center gap-2 rounded border border-violet-950 p-2 text-left transition hover:border-violet-500 hover:bg-violet-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <div className="relative h-8 w-8 shrink-0">
                    {material.sprite && <ItemSprite sprite={material.sprite} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs">
                      {material.quantity} × {material.name}
                      {material.level ? ` +${material.level}` : ""}
                    </p>
                    {!!material.drops?.length && (
                      <p className="mt-0.5 text-[10px] text-amber-300/70">
                        {material.drops
                          .map((source) => `${source.monsterName} ${dropRate(source)}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
        <ItemExchangeDetails id={selected?.entry.item.name || ""} level={previewLevel} box={def.type === "box" || /box/i.test(selected?.entry.item.name || "")} exchanges={exchanges} onInspect={onInspectItem} renderReward={renderExchangeReward} />
        {!!world?.drops?.length && (
          <section className="rounded border border-amber-900/80 bg-amber-950/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-amber-300">Monster drops</h3>
              <label className="flex items-center gap-2 text-xs text-amber-100">
                Sort
                <select aria-label="Sort monster drops" value={dropSort}
                  onChange={event => setDropSort(event.target.value as "name" | "percentage")}
                  className="rounded border border-amber-700 bg-[#07100f] px-2 py-1 text-amber-100 hover:bg-amber-950">
                  <option value="name">Name</option>
                  <option value="percentage">Percentage</option>
                </select>
              </label>
            </div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {[...world.drops].sort((a, b) =>
                (dropSort === "percentage" ? effectiveDropRate(b) - effectiveDropRate(a) : 0) ||
                a.monsterName.localeCompare(b.monsterName),
              ).map((source, index) => (
                <button
                  type="button"
                  onClick={() => onInspectMonster(source.monsterId)}
                  key={`${source.monsterId}-${index}`}
                  className="flex items-center justify-between gap-3 rounded border-t border-amber-950 p-2 text-left text-xs transition hover:bg-amber-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="relative h-9 w-9 shrink-0">
                      {source.sprite && <SpriteCrop sprite={source.sprite} size={36} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{source.monsterName}</span>
                      <span className="font-mono text-[10px] text-emerald-100/35">
                        {source.monsterId}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-amber-300">{dropRate(source)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {selected?.exchangeAdd && !selectedMonster && <Button disabled={!selected.exchangeAdd.enabled} onClick={selected.exchangeAdd.onAdd}
          className="w-full border border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900">Add</Button>}
      </DialogContent>
    </Dialog>
  );
}
