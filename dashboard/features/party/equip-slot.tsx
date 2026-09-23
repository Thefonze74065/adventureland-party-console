"use client";
import { itemActionBanner } from "./item-action-banner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ClearItemMarks } from "./clear-item-marks";
import { Swords } from "lucide-react";
import { AutoUpgradeMarks } from "./auto-upgrade-marks";
import { itemMenuClass } from "./item-menu-style";
import { EquippedEntry } from "./equipped-entry";
import { InventoryEntry } from "./inventory-entry";
import { Item } from "./item";
import { MluckClover } from "./mluck-clover";

import { SpriteCrop } from "./sprite-crop";
import { statBadgeClass } from "./stat-badge-class";
import { StatScrollMark } from "./stat-scroll-mark";

import { UpgradeActions } from "./upgrade-actions";
import { UpgradeMark } from "./upgrade-mark";
import { upgradeRuleTiers } from "./upgrade-rule-tiers";
import { memo } from "react";

export const EquipSlot = memo(function EquipSlot({
  slot,
  equipped,
  mark,
  statScrollMark,
  statScrollInventory: _statScrollInventory,
  setProgress,
  onSelect,
  onUnequip,
  onUpgrade,
  onAutoUpgrade,
  onClearMarks,
  hasAutomaticMarks,
  autoUpgradeMarks,
  isMerchant,
  onStatScroll: _onStatScroll,
  onBuy,
}: {
  slot: string;
  equipped: EquippedEntry | null;
  mark?: UpgradeMark;
  statScrollMark?: StatScrollMark;
  statScrollInventory: Record<string, number>;
  setProgress?: { current: number; total: number };
  onSelect: (entry: InventoryEntry) => void;
  onUnequip: (slot: string, item: Item) => void;
  onUpgrade: (slot: string, item: Item, tiers?: number, remove?: boolean) => void;
  onAutoUpgrade: (slot: string, item: Item, tiers?: number, remove?: boolean) => void;
  onClearMarks: (slot: string, item: Item) => void;
  hasAutomaticMarks?: (item: Item) => boolean;
  autoUpgradeMarks: AutoUpgradeMarks;
  isMerchant: boolean;
  onStatScroll: (slot: string, item: Item, remove?: boolean) => void;
  onBuy: (item: Item) => void;
}) {
  const banner = itemActionBanner([
    !!statScrollMark && {action:'stat',label:'Stat scroll'},
    !!mark && {action:'upgrade',automatic:!!mark.auto,label:`${mark.auto ? 'Auto' : '+'+(mark.item.level || 0)} → +${Number(mark.item.level || 0)+Number(mark.tiers || 1)}`},
  ], isMerchant);
  const contents = (
    <>
      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-emerald-950 bg-black">
        {equipped?.meta?.sprite && <SpriteCrop sprite={equipped.meta.sprite} size={40} />}
        {equipped && (
          <span className="absolute bottom-0.5 right-0.5 z-10 min-w-4 rounded bg-black/85 px-1 text-center font-mono text-[10px] leading-4 text-emerald-300">
            +{equipped.item.level || 0}
          </span>
        )}
        {equipped?.item.stat_type ? (
          <span
            className={`absolute left-0.5 top-0.5 z-10 rounded px-1 font-mono text-[8px] ring-1 ${statBadgeClass(equipped.item.stat_type)}`}
          >
            {equipped.item.stat_type}
          </span>
        ) : null}
        {banner && <span data-item-action-banner className={`absolute inset-x-0 top-0 z-10 text-center text-[8px] leading-tight ${banner.colors}`}>{banner.label}</span>}
        <MluckClover item={equipped?.item} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs capitalize text-emerald-100/50">
          {slot.replace(/(\d+)$/, " $1")}
        </span>
        <span className="block truncate text-xs text-emerald-50/90">
          {equipped
            ? `${String(equipped.meta?.definition.name || equipped.item.name)}${equipped.item.level ? ` +${equipped.item.level}` : ""}`
            : "Empty"}
        </span>
      </span>
      {setProgress ? (
        <span className="absolute right-1.5 top-1.5 z-10 rounded bg-amber-950/95 px-1 font-mono text-[8px] font-semibold leading-4 text-amber-200 ring-1 ring-amber-500/70">
          {setProgress.current}/{setProgress.total}
        </span>
      ) : null}
    </>
  );
  const classes = `relative flex min-w-0 items-center gap-2 rounded border bg-black/25 p-1.5 text-left hover:border-emerald-500 disabled:cursor-default disabled:border-dashed disabled:opacity-55 ${banner?.border || "border-emerald-900"}`;
  if (!equipped)
    return (
      <button disabled className={classes}>
        {contents}
      </button>
    );
  return (
    <ContextMenu>
      <ContextMenuTrigger
        onClick={() => onSelect({ slot: -1, item: equipped.item, meta: equipped.meta })}
        className={classes}
      >
        {contents}
      </ContextMenuTrigger>
      <ContextMenuContent className={itemMenuClass}>
        {slot !== "elixir" && <ContextMenuItem onClick={() => onUnequip(slot, equipped.item)}>
          <Swords className="mr-2 h-4 w-4" />
          Unequip
        </ContextMenuItem>}
        {slot === "elixir" && <ContextMenuItem disabled>Active elixir effect</ContextMenuItem>}
        <UpgradeActions
          offeringSource={{slot,equipped:true}}
          item={equipped.item}
          meta={equipped.meta}
          mark={mark}
          autoTiers={upgradeRuleTiers(
            autoUpgradeMarks[
              `${equipped.item.name}@+${Math.max(0, Number(equipped.item.level) || 0)}`
            ],
          )}
          onMark={(tiers, remove) => onUpgrade(slot, equipped.item, tiers, remove)}
          onAutoMark={(tiers, remove) => onAutoUpgrade(slot, equipped.item, tiers, remove)}
          onBuy={() => onBuy(equipped.item)}
        />
        {(hasAutomaticMarks?.(equipped.item) || mark || statScrollMark || autoUpgradeMarks[`${equipped.item.name}@+${equipped.item.level || 0}`]) && <ClearItemMarks onClear={() => onClearMarks(slot, equipped.item)} />}
      </ContextMenuContent>
    </ContextMenu>
  );
});
