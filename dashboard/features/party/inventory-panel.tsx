"use client";
import { itemActionBanner } from "./item-action-banner";
import { standIsFull } from "./stand-capacity";
import type { StandBid } from "./stand-bid";
import { isEquipment, isUsable } from "./item-actions";
import { itemMenuClass } from "./item-menu-style";
import { canDeconstruct, type DeconstructionMark, type DeconstructionCatalog } from "./deconstruction";
import { MerchantVisitControl } from "./merchant-visit-control";
import { Button } from "@/components/ui/button";
import { AutoActionIcon } from "./auto-action-icon";
import { BrokenStickIcon } from "./broken-stick-icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compoundPassCost } from "@/lib/compound-cost";
import {
  Blender,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Home as HomeIcon,
  Landmark,
  MapPin,
  PackageOpen,
  Radio,
  ShoppingCart,
  Store,
  SlidersHorizontal,
  Sparkles,
  Swords,
  ScrollText,
  FlaskConical,
  Truck,
  X,
} from "lucide-react";
import { memo, useCallback, useState, type ReactNode } from "react";
import { AutoCompoundMark } from "./auto-compound-mark";
import { ClearItemMarks } from "./clear-item-marks";
import { AutoUpgradeMarks } from "./auto-upgrade-marks";
import { automaticCommerceRuleKey } from "./automatic-commerce-rule-key";
import { BankMark } from "./bank-mark";
import { Char } from "./char";
import { compactInventory } from "./compact-inventory";
import { LuckySlotOutline, physicalInventory, validLuckySlot } from "./lucky-upgrade-slot";
import { LuckySlotMenu, type LuckySlotMenuSelection } from "./lucky-slot-menu";
import { luckySlotSearch, type LuckySlotTracking } from "../../../runtime/lucky-slot-tracking";
import { CompoundGroup } from "./compound-group";
import { Equipment } from "./equipment";
import { InventoryEntry } from "./inventory-entry";
import { Item } from "./item";
import type { NpcSaleMark } from "./npc-sale-mark";
import { itemLevelLabelClass } from "./item-level-label-class";
import { itemMaximumLevel } from "./item-maximum-level";
import { ItemOperationOverlay } from "./item-operation-overlay";
import { ItemSprite } from "./item-sprite";
import { MerchantBuyItem } from "./merchant-buy-item";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { MluckClover } from "./mluck-clover";
import { primaryStatScrollCost } from "./primary-stat-scroll-cost";
import { same } from "./same";
import { StandListing } from "./stand-listing";
import { StandPriceHistory } from "./stand-price-history";
import { statBadgeClass } from "./stat-badge-class";
import { StatScrollMark } from "./stat-scroll-mark";
import { statScrollQuantity } from "./stat-scroll-quantity";
import { STAT_SCROLLS } from "./stat-scrolls";
import { SuggestedPriceDetails } from "./suggested-price-details";
import { UpgradeOfferingRules } from './upgrade-offering-controls';
import { UpgradeActions } from "./upgrade-actions";
import { UpgradeMark } from "./upgrade-mark";
import { upgradeRuleQuantity } from "./upgrade-rule-quantity";
import { upgradeRuleTiers } from "./upgrade-rule-tiers";

export const InventoryPanel = memo(function InventoryPanel({
  character,
  sharedRules = false,
  characters,
  leader,
  merchant,
  merchantWeapon,
  luckyUpgradeSlot,
  luckySlotTracking,
  onLuckySlot,
  marked,
  merchantMarked,
  autoItemMarks,
  autoUpgradeMarks,
  allAutoUpgradeMarks,
  merchantDeliveries,
  standListings,
  standBids = {},
  autoNpcSales,
  npcSaleMarks = [],
  deconstructionMarks = [],
  autoDeconstruction = {},
  deconstructionCatalog = {},
  onDeconstruction,
  onRetryDeconstruction,
  onRemoveNpcSale,
  autoStandMarks,
  buyable,
  catalog,
  priceHistory,
  onStand,
  upgradeMarks,
  statScrollMarks,
  statScrollInventory,
  compoundGroups,
  autoCompoundMarks,
  allAutoCompoundMarks,
  autoExchanges,
  onSelect,
  onCompare,
  onCommand,
  onTravel,
  onNpcSale,
  onAutoNpcSale,
  onAutoStand,
  onClearAutomaticSales,
  onRemoveAutomaticSale,
}: {
  character: Char;
  sharedRules?: boolean;
  characters: Char[];
  leader?: string | null;
  merchant?: string | null;
  merchantWeapon?: { item: Item } | null;
  luckyUpgradeSlot?: number | null;
  luckySlotTracking?: LuckySlotTracking;
  onLuckySlot?: () => void;
  marked: BankMark[];
  merchantMarked: BankMark[];
  autoItemMarks: Record<string, "bank" | "merchant">;
  autoUpgradeMarks: AutoUpgradeMarks;
  allAutoUpgradeMarks: Record<string, AutoUpgradeMarks>;
  merchantDeliveries: Record<string, BankMark[]>;
  standListings: StandListing[];
  standBids?: Record<string, StandBid>;
  npcSaleMarks?: NpcSaleMark[];
  deconstructionMarks?: DeconstructionMark[];
  autoDeconstruction?: Record<string, { item: Item }>;
  deconstructionCatalog?: DeconstructionCatalog;
  onDeconstruction?: (entry: InventoryEntry, auto: boolean, remove: boolean, id?: string) => void;
  onRetryDeconstruction?: (id: string) => void;
  onRemoveNpcSale?: (id: string) => void;
  autoNpcSales: Record<string, { item: Item; createdAt: number; character?: string }>;
  autoStandMarks: Record<string, { item: Item; price: number; createdAt: number }>;
  buyable: MerchantBuyItem[];
  catalog: MerchantCatalogItem[];
  priceHistory: Record<string, StandPriceHistory>;
  upgradeMarks: UpgradeMark[];
  statScrollMarks: StatScrollMark[];
  statScrollInventory: Record<string, number>;
  compoundGroups: CompoundGroup[];
  autoCompoundMarks: AutoCompoundMark[];
  allAutoCompoundMarks: Record<string, AutoCompoundMark[]>;
  autoExchanges: Record<string, { name: string; level: number }>;
  onSelect: (entry: InventoryEntry) => void;
  onCompare: (entry: InventoryEntry, slot?: string) => void;
  onCommand: (
    character: string,
    type:
      | "bank"
      | "town"
      | "go-home"
      | "return-leader"
      | "equip"
      | "use-item"
      | "unequip"
      | "mark"
      | "merchant-mark"
      | "auto-item-mark"
      | "auto-upgrade-mark"
      | "clear-item-marks"
      | "clear-auto-item-marks"
      | "remove-auto-item-mark"
      | "clear-auto-compounds"
      | "clear-auto-upgrades"
      | "update-auto-upgrade-rule"
      | "give"
      | "withdraw"
      | "upgrade-mark"
      | "stat-scroll-mark"
      | "buy-copy"
      | "compound-mark"
      | "auto-compound-mark"
      | "auto-exchange"
      | "merchant-weapon",
    item?: Item,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  onTravel: () => void;
  onStand: (entry: InventoryEntry) => void;
  onNpcSale: (entry: InventoryEntry) => void;
  onAutoNpcSale: (entry: InventoryEntry) => void;
  onAutoStand: (entry: InventoryEntry) => void;
  onClearAutomaticSales: (kind: "npc" | "stand") => void;
  onRemoveAutomaticSale: (kind: "npc" | "stand", item: Item) => void;
}) {
  const leaderOnline =
    !!leader &&
    leader !== character.name &&
    characters.some((member) => member.name === leader && member.seenAt > 0);
  const [inventoryOpen, setInventoryOpen] = useState(true);
  const [luckySlotMenu, setLuckySlotMenu] = useState<LuckySlotMenuSelection | null>(null);
  const nextUpgradeSlot = validLuckySlot(luckyUpgradeSlot) ? luckyUpgradeSlot :
    luckySlotSearch(luckySlotTracking || {version: 1, slots: {}}).nextSlot;
  const luckySlotLabel = validLuckySlot(luckyUpgradeSlot) ? "Verified lucky upgrade slot" : "Next upgrade will test for lucky upgrade";
  type AutomaticSection = "npc" | "stand" | "upgrade" | "compound" | "merchant" | "bank" | "deconstruction";
  const [openAutomaticSections, setOpenAutomaticSections] = useState<
    Partial<Record<AutomaticSection, boolean>>
  >({});
  const [editingAutomaticRule, setEditingAutomaticRule] = useState<string | null>(null);
  const [automaticRuleValue, setAutomaticRuleValue] = useState("");
  const [pendingAutomaticRemoval, setPendingAutomaticRemoval] = useState<string | null>(null);
  const [pendingAutomaticClear, setPendingAutomaticClear] = useState<AutomaticSection | null>(null);
  const occupiedSlots = character.items.filter(Boolean).length;
  const totalSlots = character.inventorySize || character.items.length;
  const freeSlots = totalSlots - occupiedSlots;
  const standFull = standIsFull(standListings, standBids);
  const capacityColor =
    freeSlots < 5 ? "text-rose-400" : freeSlots <= 10 ? "text-orange-400" : "text-emerald-100/55";
  const automaticRuleItem = (key: string): Item => {
    const match = /^(.*)@\+(\d+)$/.exec(key);
    return {
      name: match ? match[1] : key,
      level: match ? Number(match[2]) : 0,
    };
  };
  const toggleAutomaticSection = (section: AutomaticSection) =>
    setOpenAutomaticSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  const requestAutomaticRemoval = (key: string, remove: () => void) => {
    if (pendingAutomaticRemoval === key) {
      setPendingAutomaticRemoval(null);
      remove();
    } else {
      setPendingAutomaticRemoval(key);
      setEditingAutomaticRule(null);
    }
  };
  const automaticSection = (
    section: AutomaticSection,
    title: string,
    icon: ReactNode,
    color: string,
    entries: {
      key: string;
      item: Item;
      detail?: string;
      disabled?: boolean;
      retry?: () => void;
      upgradeTarget?: number;
      edits?: {
        id: string;
        value: number;
        label: string;
        min: number;
        max: number;
        allowUnlimited?: boolean;
        onSave: (value: number) => void;
      }[];
      onRemove: () => void;
    }[],
  ) => {
    if (character.name !== merchant) return null;
    const open = openAutomaticSections[section] === true;
    const clearArmed = pendingAutomaticClear === section;
    return (
      <section className={`-mx-5 border-y ${color}`}>
        <div className="flex h-10 w-full items-stretch bg-black">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              toggleAutomaticSection(section);
              setPendingAutomaticClear(null);
              setPendingAutomaticRemoval(null);
              setEditingAutomaticRule(null);
            }}
            className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-black px-5 text-left text-xs text-inherit transition-colors hover:bg-slate-900 hover:text-white"
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform duration-300 ${open ? "rotate-90" : ""}`}
            />
            {icon}
            <span>{title}</span>
            <span className="ml-auto font-mono opacity-70">{entries.length}</span>
          </button>
          <button
            type="button"
            disabled={!entries.length}
            aria-label={clearArmed ? `Really clear all ${title}` : `Clear all ${title}`}
            title={clearArmed ? "Click again to clear all" : "Clear all"}
            onClick={() => {
              if (clearArmed) void clearAutomaticSection(section);
              else {
                setPendingAutomaticClear(section);
                setPendingAutomaticRemoval(null);
              }
            }}
            className={`flex shrink-0 items-center justify-center overflow-hidden border-l transition-all duration-300 disabled:border-slate-800 disabled:text-slate-700 ${clearArmed ? "w-24 border-rose-300 bg-rose-600 px-2 text-white hover:bg-rose-500" : "w-10 border-rose-900 bg-black text-rose-400 hover:bg-rose-950 hover:text-white"}`}
          >
            <span
              className={`whitespace-nowrap text-[10px] font-semibold transition-opacity ${clearArmed ? "opacity-100" : "opacity-0 w-0"}`}
            >
              Really?
            </span>
            <X className="h-4 w-4 shrink-0" />
          </button>
        </div>
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        >
          <div className="overflow-hidden">
            <div className="space-y-2 border-t border-current/30 bg-black/95 px-5 py-3">
              {entries.length ? (
                entries.map((entry) => {
                  const definition = catalog.find((candidate) => candidate.id === entry.item.name);
                  const editKey = `${section}:${entry.key}`;
                  const removalArmed = pendingAutomaticRemoval === editKey;
                  const title = `${definition?.name || entry.item.name}${entry.item.level ? ` +${entry.item.level}` : ""}`;
                  const upgradeRange =
                    entry.upgradeTarget === undefined
                      ? null
                      : `+${Number(entry.item.level || 0)} → +${entry.upgradeTarget}`;
                  return (
                    <div
                      key={entry.key}
                      className="flex min-h-12 items-center gap-2 border-b border-white/10 py-1 text-xs last:border-b-0"
                    >
                      <button
                        type="button"
                        title={`View ${title}${upgradeRange ? ` · ${upgradeRange}` : ""}`}
                        aria-label={`View ${title}${upgradeRange ? ` · ${upgradeRange}` : ""}`}
                        onClick={() =>
                          onSelect({
                            slot: -1,
                            item: entry.item,
                            meta: definition?.meta,
                          })
                        }
                        className={`relative shrink-0 border border-slate-600 bg-[#080b0d] text-sky-100 hover:border-emerald-400 hover:bg-emerald-950 hover:text-white ${upgradeRange ? "h-14 w-16" : "h-10 w-10"}`}
                      >
                        <span
                          className={
                            upgradeRange
                              ? "absolute inset-x-0 top-0 mx-auto block h-10 w-10"
                              : "absolute inset-0 block"
                          }
                        >
                          {definition?.sprite ? (
                            <ItemSprite sprite={definition.sprite} />
                          ) : (
                            <PackageOpen className="m-auto h-5 w-5 text-slate-400" />
                          )}
                      </span>
                        {upgradeRange ? (
                          <span className="absolute inset-x-0 bottom-0 border-t border-sky-800 bg-[#07121f] text-center font-mono text-xs leading-4 tracking-tight text-sky-100">
                            {upgradeRange}
                          </span>
                        ) : entry.item.level ? (
                          <span className="absolute bottom-0 right-0 bg-black px-0.5 font-mono text-[9px] text-amber-200">
                            +{entry.item.level}
                          </span>
                        ) : null}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-emerald-50">{title}</div>
                        {entry.detail ? (
                          <div className="truncate text-[10px] text-slate-400">{entry.detail}</div>
                        ) : null}
                      </div>
                      {!removalArmed
                        ? entry.edits?.map((edit) => {
                            const fieldKey = `${editKey}:${edit.id}`;
                            const editing = editingAutomaticRule === fieldKey;
                            const parsed = Number(automaticRuleValue);
                            const valid =
                              Number.isSafeInteger(parsed) &&
                              ((edit.allowUnlimited && parsed === -1) ||
                                (parsed >= edit.min && parsed <= edit.max));
                            return editing ? (
                              <div
                                key={edit.id}
                                onBlur={(event) => {
                                  if (
                                    !event.currentTarget.contains(
                                      event.relatedTarget as Node | null,
                                    )
                                  ) {
                                    setEditingAutomaticRule(null);
                                    setAutomaticRuleValue("");
                                  }
                                }}
                                className="flex shrink-0 items-center gap-1"
                              >
                                <Input
                                  aria-label={`New ${edit.id} for ${title}`}
                                  inputMode="numeric"
                                  value={automaticRuleValue}
                                  onChange={(event) =>
                                    setAutomaticRuleValue(
                                      event.target.value.replace(
                                        edit.allowUnlimited ? /[^0-9-]/g : /[^0-9]/g,
                                        "",
                                      ),
                                    )
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" && valid) {
                                      edit.onSave(parsed);
                                      setEditingAutomaticRule(null);
                                      setAutomaticRuleValue("");
                                    }
                                    if (event.key === "Escape") {
                                      setEditingAutomaticRule(null);
                                      setAutomaticRuleValue("");
                                    }
                                  }}
                                  className="h-7 w-14 border-emerald-600 bg-black px-1 text-center font-mono text-xs text-emerald-100"
                                />
                                <button
                                  type="button"
                                  aria-label={`Save ${edit.id} for ${title}`}
                                  disabled={!valid}
                                  onClick={() => {
                                    edit.onSave(parsed);
                                    setEditingAutomaticRule(null);
                                    setAutomaticRuleValue("");
                                  }}
                                  className="flex h-7 w-7 items-center justify-center border border-emerald-300 bg-emerald-500 text-black hover:bg-emerald-400 disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-600"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <button
                                key={edit.id}
                                type="button"
                                title={`Edit ${edit.id}`}
                                onClick={() => {
                                  setEditingAutomaticRule(fieldKey);
                                  setAutomaticRuleValue(String(edit.value));
                                }}
                                className="shrink-0 border border-emerald-700 bg-black px-2 py-1 font-mono text-xs text-emerald-200 hover:bg-emerald-950"
                              >
                                {edit.label}
                              </button>
                            );
                          })
                        : null}
                      <button
                        type="button"
                        aria-label={removalArmed ? `Really remove ${title}` : `Remove ${title}`}
                        disabled={entry.disabled}
                        title={removalArmed ? "Click again to remove" : "Remove"}
                        onClick={() => requestAutomaticRemoval(editKey, entry.onRemove)}
                        className={`flex h-7 shrink-0 items-center justify-center overflow-hidden border transition-all duration-300 disabled:opacity-40 ${removalArmed ? "w-20 border-rose-300 bg-rose-600 px-1 text-white hover:bg-rose-500" : "w-7 border-rose-800 bg-black text-rose-300 hover:bg-rose-950 hover:text-white"}`}
                      >
                        <span
                          className={`whitespace-nowrap text-[10px] font-semibold transition-opacity ${removalArmed ? "opacity-100" : "w-0 opacity-0"}`}
                        >
                          Really?
                        </span>
                        <X className="h-4 w-4 shrink-0" />
                      </button>
                      {entry.retry ? <button type="button" onClick={entry.retry} className="h-7 shrink-0 border border-orange-700 bg-black px-2 text-xs text-orange-200 hover:bg-orange-950 hover:text-white">Retry</button> : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-emerald-100/45">No active marks.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  };
  const onUnequip = useCallback(
    (slot: string, item: Item) => onCommand(character.name, "unequip", item, { slot }),
    [onCommand, character.name],
  );
  const onEquipmentUpgrade = useCallback(
    (slot: string, item: Item, tiers?: number, remove?: boolean) =>
      onCommand(character.name, "upgrade-mark", item, { slot, equipped: true, tiers, remove }),
    [onCommand, character.name],
  );
  const onEquipmentAutoUpgrade = useCallback(
    (slot: string, item: Item, tiers?: number, remove?: boolean) =>
      onCommand(character.name, "auto-upgrade-mark", item, { slot, equipped: true, tiers, remove }),
    [onCommand, character.name],
  );
  const onEquipmentStatScroll = useCallback(
    (slot: string, item: Item, remove?: boolean) =>
      onCommand(character.name, "stat-scroll-mark", item, { slot, remove }),
    [onCommand, character.name],
  );
  const hasAutomaticMarks = useCallback(
    (item: Item) => {
      const key = `${item.name}@+${item.level || 0}`, commerceKey = automaticCommerceRuleKey(item);
      return Boolean(autoItemMarks[key] || (!item.level && autoItemMarks[item.name]) || autoUpgradeMarks[key] ||
        autoCompoundMarks.some(rule => rule.name === item.name) || autoDeconstruction[commerceKey] ||
        autoNpcSales[sharedRules || character.name === merchant ? commerceKey : JSON.stringify([character.name, commerceKey])] ||
        (character.name === merchant && (autoStandMarks[commerceKey] || autoExchanges[`${item.name}@${item.level || 0}`] || (merchantWeapon?.item && same(item, merchantWeapon.item)))));
    },
    [autoItemMarks, autoUpgradeMarks, autoCompoundMarks, autoDeconstruction, autoNpcSales, sharedRules, character.name, merchant, autoStandMarks, autoExchanges, merchantWeapon],
  );
  const onEquipmentClearMarks = useCallback(
    (slot: string, item: Item) => onCommand(character.name, "clear-item-marks", item, { slot, equipped: true }),
    [onCommand, character.name],
  );
  const onEquipmentBuy = useCallback(
    (item: Item) => onCommand(character.name, "buy-copy", item),
    [onCommand, character.name],
  );
  const clearAutomaticSection = async (section: AutomaticSection) => {
    if (section === "npc" || section === "stand") onClearAutomaticSales(section);
    else if (section === "compound") await onCommand(character.name, "clear-auto-compounds");
    else if (section === "upgrade") await onCommand(character.name, "clear-auto-upgrades");
    else if (section === "deconstruction") {
      for (const rule of Object.values(autoDeconstruction))
        onDeconstruction?.({ slot: -1, item: rule.item }, true, true);
    }
    else
      await onCommand(character.name, "clear-auto-item-marks", undefined, {
        mode: section,
      });
    setPendingAutomaticClear(null);
  };
  return (
    <div className="p-5">
      <Equipment
        character={character}
        upgradeMarks={upgradeMarks}
        autoUpgradeMarks={autoUpgradeMarks}
        statScrollMarks={statScrollMarks}
        statScrollInventory={statScrollInventory}
        onSelect={onSelect}
        onUnequip={onUnequip}
        onUpgrade={onEquipmentUpgrade}
        onAutoUpgrade={onEquipmentAutoUpgrade}
        onStatScroll={onEquipmentStatScroll}
        hasAutomaticMarks={hasAutomaticMarks}
        onClearMarks={onEquipmentClearMarks}
        onBuy={onEquipmentBuy}
      />
      <button
        type="button"
        aria-expanded={inventoryOpen}
        onClick={() => setInventoryOpen((open) => !open)}
        className="mb-3 mt-5 flex w-full items-center justify-between border-t border-emerald-900 pt-5 text-left"
      >
        <span className="flex items-center gap-2 font-mono text-xs uppercase text-emerald-100/55">
          {inventoryOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Inventory
        </span>
        <span className={`font-mono text-xs ${capacityColor}`} title={`${freeSlots} slots free`}>
          {occupiedSlots}/{totalSlots}
        </span>
      </button>
      {inventoryOpen ? (
        <>
          <LuckySlotMenu selection={luckySlotMenu} onClose={() => setLuckySlotMenu(null)} onData={() => onLuckySlot?.()} onItem={onSelect} />
          <p className="mb-3 text-right text-xs text-emerald-100/40">
            Left-click: details · Right-click: actions
          </p>
          <div className="grid grid-cols-5 gap-2">
            {(character.name === merchant ? physicalInventory(character.items) : compactInventory(character.items)).map((entry, i) => {
              const lucky = character.name === merchant && i === nextUpgradeSlot;
              if (!entry)
                return (
                  lucky ? <Tooltip key={`empty-${i}`}>
                    <TooltipTrigger render={<button type="button" onClick={event => setLuckySlotMenu({anchor: event.currentTarget, slot: i, entry: null})} aria-haspopup="menu" aria-expanded={luckySlotMenu?.slot === i} aria-label={`${luckySlotLabel}, slot ${i}. Open lucky slot options`} className="relative aspect-square rounded border border-amber-500 bg-zinc-950 text-amber-200 hover:border-amber-300 hover:bg-amber-950 hover:text-amber-100 focus-visible:outline-2 focus-visible:outline-amber-200" />}>
                      <LuckySlotOutline />
                    </TooltipTrigger>
                    <TooltipContent className="border border-amber-600 bg-zinc-950 text-amber-100">{luckySlotLabel} · slot {i}. Click for options.</TooltipContent>
                  </Tooltip> :
                  <div
                    key={`empty-${i}`}
                    className="aspect-square rounded border border-dashed border-emerald-950"
                  />
                );
              const bankMarked = marked.some((mark) =>
                "item" in mark
                  ? mark.slot === entry.slot && same(mark.item, entry.item)
                  : same(mark, entry.item),
              );
              const merchantMarkedItem = merchantMarked.some((mark) =>
                "item" in mark
                  ? mark.slot === entry.slot && same(mark.item, entry.item)
                  : same(mark, entry.item),
              );
              const autoRuleKey = `${entry.item.name}@+${Math.max(0, Number(entry.item.level) || 0)}`;
              // Name-only rules are from older builds and intentionally apply only
              // to +0 items; upgraded copies must remain independent.
              const autoMarkMode =
                autoItemMarks[autoRuleKey] ||
                ((Number(entry.item.level) || 0) === 0
                  ? autoItemMarks[entry.item.name]
                  : undefined);
              const deliveryTarget =
                character.name === merchant
                  ? Object.keys(merchantDeliveries).find((target) =>
                      (merchantDeliveries[target] || []).some((mark) =>
                        "item" in mark
                          ? mark.slot === entry.slot && same(mark.item, entry.item)
                          : same(mark, entry.item),
                      ),
                    )
                  : undefined;
              const standMarked =
                character.name === merchant &&
                standListings.some(
                  (mark) => !mark.bankPack && mark.slot === entry.slot && same(mark.item, entry.item),
                );
              const merchantWeaponMarked =
                character.name === merchant &&
                !!merchantWeapon?.item &&
                same(merchantWeapon.item, entry.item);
              const upgradeable = !!entry.meta?.upgradeable;
              const compoundable = !!entry.meta?.compoundable;
              const itemType = String(entry.meta?.definition.type || "");
              const classUsage = entry.meta?.usage?.classes.find(
                (usage) => usage.id === character.ctype,
              );
              const comparisonSlots =
                itemType === "ring"
                  ? ["ring1", "ring2"]
                  : itemType === "earring"
                    ? ["earring1", "earring2"]
                    : itemType === "weapon" && classUsage?.hands === 1
                      ? ["mainhand", "offhand"]
                      : [];
              const upgradeMark = upgradeable
                ? upgradeMarks.find(
                    (mark) =>
                      !mark.equipped && mark.slot === entry.slot && same(mark.item, entry.item),
                  )
                : undefined;
              const inventoryStatScrollMark =
                character.name === merchant
                  ? statScrollMarks.find(
                      (mark) =>
                        !mark.equipped && mark.slot === entry.slot && same(mark.item, entry.item),
                    )
                  : undefined;
              const compoundGroup = compoundGroups.find((group) =>
                group.items.some((mark) => mark.slot === entry.slot && same(mark.item, entry.item)),
              );
              const autoCompoundMark = autoCompoundMarks.find(
                (mark) => mark.name === entry.item.name,
              );
              const autoCompoundPending =
                !!autoCompoundMark && Number(entry.item.level || 0) < autoCompoundMark.targetTier && Number(autoCompoundMark.quantity) !== 0;
              const autoExchangeKey = `${entry.item.name}@${entry.item.level || 0}`;
              const autoExchangeMarked =
                character.name === merchant && !!autoExchanges[autoExchangeKey];
              const automaticSaleKey = automaticCommerceRuleKey(entry.item);
              const autoNpcSaleMarked =
                !!autoNpcSales[sharedRules || character.name === merchant ? automaticSaleKey : JSON.stringify([character.name, automaticSaleKey])];
              const npcSale = npcSaleMarks.find(mark =>
                (character.name === merchant ? mark.source === "merchant" : mark.source === "character" && mark.character === character.name) && mark.slot === entry.slot &&
                automaticCommerceRuleKey(mark.item) === automaticSaleKey);
              const npcSaleStatus = npcSale ? (npcSale.state || "queued") : null;
              const npcSaleDetails = npcSale ? [
                `NPC sale: ${npcSaleStatus}`,
                npcSale.error,
                npcSale.retryAt ? `Retry after ${new Date(npcSale.retryAt).toLocaleTimeString()}` : null,
              ].filter(Boolean).join(" · ") : null;
              const deconstruction = deconstructionMarks.find(mark => mark.owner === character.name && mark.slot === entry.slot &&
                mark.state !== "complete" && same(entry.item, mark.item));
              const autoDeconstruct = !!autoDeconstruction[automaticSaleKey];
              const deconstructable = canDeconstruct(entry.item, deconstructionCatalog);
              const autoStandMarked =
                character.name === merchant && autoStandMarks[automaticSaleKey];
              const exchangeable =
                character.name === merchant && Number(entry.meta?.definition.e || 0) > 0;
              const maxCompoundTier = itemMaximumLevel(entry.meta);
              const banner = itemActionBanner([
                !!deconstruction && {action:'deconstruction',label:'Deconstruction'},
                !!npcSale && {action:'npc',label:'NPC sale',automatic:!!npcSale.auto,title:npcSaleDetails || undefined},
                !!inventoryStatScrollMark && {action:'stat',label:'Stat scroll'},
                !!upgradeMark && {action:'upgrade',automatic:!!upgradeMark.auto,label:upgradeMark.auto ? `Auto → +${Number(upgradeMark.item.level || 0)+Number(upgradeMark.tiers || 1)}` : `+${upgradeMark.item.level || 0} → +${Number(upgradeMark.item.level || 0)+Number(upgradeMark.tiers || 1)}`},
                !!compoundGroup && {action:'compound',label:`+${entry.item.level || 0} → +${Number(entry.item.level || 0)+1}`},
                !!standMarked && {action:'stand',label:'Stand sale'},
                autoCompoundPending && {action:'compound',automatic:true,label:`Auto compound → +${autoCompoundMark!.targetTier}`},
                autoDeconstruct && {action:'deconstruction',automatic:true,label:'Auto deconstruction'},
                autoNpcSaleMarked && {action:'npc',automatic:true,label:'NPC sale',title:npcSaleDetails || 'Auto NPC sale'},
                !!autoStandMarked && {action:'stand',automatic:true,label:'Auto stand'},
                autoExchangeMarked && {action:'exchange',automatic:true,label:'Auto exchange'},
                !!deliveryTarget && {action:'delivery',label:`To ${deliveryTarget}`},
                (autoMarkMode === 'bank' || bankMarked) && {action:'bank',label:autoMarkMode === 'bank' ? 'Auto bank' : 'Bank'},
                (autoMarkMode === 'merchant' || merchantMarkedItem) && {action:'merchant',label:autoMarkMode === 'merchant' ? 'Auto merchant' : 'Mark for merchant'},
                merchantWeaponMarked && {action:'weapon',label:'Merchant weapon'},
              ], character.name === merchant);

              return (
                <ContextMenu key={entry.slot}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <ContextMenuTrigger
                          onClick={event => lucky ? setLuckySlotMenu({anchor: event.currentTarget, slot: i, entry}) : onSelect(entry)}
                          aria-haspopup={lucky ? "menu" : undefined}
                          aria-expanded={lucky ? luckySlotMenu?.slot === i : undefined}
                          className={`relative aspect-square ${lucky ? "overflow-visible" : "overflow-hidden"} rounded border bg-black/40 p-1 text-left hover:border-emerald-400 ${banner?.border || "border-emerald-900"}`}
                          aria-label={String(entry.meta?.definition.name || entry.item.name)}
                        />
                      }
                    >
                      {lucky ? <LuckySlotOutline /> : null}
                      {entry.meta?.sprite ? (
                        <ItemSprite sprite={entry.meta.sprite} />
                      ) : (
                        <span className="block truncate font-mono text-[10px]">
                          {entry.item.name}
                        </span>
                      )}
                      {entry.operation ? (
                        <ItemOperationOverlay operation={entry.operation} />
                      ) : null}
                      {!entry.operation && entry.item.level ? (
                        <span className={`${itemLevelLabelClass} left-1`}>+{entry.item.level}</span>
                      ) : null}
                      {entry.item.stat_type ? (
                        <span
                          className={`absolute left-1 top-1 z-10 rounded px-1 font-mono text-[9px] ring-1 ${statBadgeClass(entry.item.stat_type)}`}
                        >
                          {entry.item.stat_type}
                        </span>
                      ) : null}
                      {entry.item.q && entry.item.q > 1 ? (
                        <span className="absolute bottom-1 right-1 z-10 rounded bg-black/70 px-1 text-[10px] text-amber-300">
                          {entry.item.q}
                        </span>
                      ) : null}
                      <MluckClover item={entry.item} />
                      {banner && <span data-item-action-banner title={banner.title} className={`absolute inset-x-0 top-0 z-10 whitespace-normal break-words px-1 text-center text-[9px] leading-tight ${banner.colors}`}>{banner.label}</span>}
                    </TooltipTrigger>
                    {character.name === merchant ? (
                      <TooltipContent
                        side="top"
                        align="center"
                        className="block max-h-[70vh] w-96 overflow-y-auto border border-amber-700 bg-black p-3 text-left font-mono text-[11px] leading-relaxed text-emerald-50 shadow-2xl"
                      >
                        {lucky ? <p className="mb-2 text-amber-300">{luckySlotLabel} · slot {i}. Click for options.</p> : null}
                        <SuggestedPriceDetails
                          entry={entry}
                          buyable={buyable}
                          observed={priceHistory[entry.item.name]}
                        />
                        {deconstruction || autoDeconstruct ? <p className="mt-1 text-[#dfb18c]">Deconstruction{autoDeconstruct ? " · automatic" : ""}{deconstruction ? " · " + deconstruction.state : ""}</p> : null}
                        {npcSaleDetails ? <p className="mt-1 text-rose-200">{npcSaleDetails}</p> : null}
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                  <ContextMenuContent className={itemMenuClass}>
                    {isEquipment(entry.meta?.definition) && <ContextMenuItem onClick={() => onCommand(character.name, "equip", entry.item)}>
                      <Swords className="mr-2 h-4 w-4" />
                      Equip
                    </ContextMenuItem>}
                    {isUsable(entry.meta?.definition) && <ContextMenuItem onClick={() => onCommand(character.name, "use-item", entry.item, {slot: entry.slot})}>
                      <FlaskConical className="mr-2 h-4 w-4" />{itemType === "elixir" ? "Use elixir" : "Use"}
                    </ContextMenuItem>}
                    {isEquipment(entry.meta?.definition) && (comparisonSlots.length > 1 ? (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <SlidersHorizontal className="mr-2 h-4 w-4" />
                          Compare with equipped
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {comparisonSlots.map((slot) => (
                            <ContextMenuItem key={slot} onClick={() => onCompare(entry, slot)}>
                              {slot === "mainhand"
                                ? "Main hand"
                                : slot === "offhand"
                                  ? "Off hand"
                                  : slot === "ring1"
                                    ? "Ring 1"
                                    : slot === "ring2"
                                      ? "Ring 2"
                                      : slot === "earring1"
                                        ? "Earring 1"
                                        : "Earring 2"}
                              <span className="ml-auto pl-5 text-xs text-muted-foreground">
                                {character.slots[slot]
                                  ? String(
                                      character.slots[slot].meta?.definition.name ||
                                        character.slots[slot].item.name,
                                    )
                                  : "Empty"}
                              </span>
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    ) : (
                      <ContextMenuItem onClick={() => onCompare(entry)}>
                        <SlidersHorizontal className="mr-2 h-4 w-4" />
                        Compare with equipped
                      </ContextMenuItem>
                    ))}
                    {character.name === merchant && exchangeable ? (
                      <ContextMenuItem
                        disabled={autoExchangeMarked}
                        onClick={() =>
                          onCommand(character.name, "auto-exchange", entry.item, {
                            slot: entry.slot,
                          })
                        }
                      >
                        <AutoActionIcon><ArrowRightLeft /></AutoActionIcon>
                        Auto exchange
                      </ContextMenuItem>
                    ) : null}
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Truck className="mr-2 h-4 w-4" />
                        Deliver to…
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        {characters
                          .filter(
                            (target) =>
                              target.name !== character.name && target.seenAt > 0,
                          )
                          .map((target) =>
                            character.name === merchant && isEquipment(entry.meta?.definition) ? (
                              <ContextMenuSub key={target.name}>
                                <ContextMenuSubTrigger>
                                  {target.name}
                                  {deliveryTarget === target.name ? " ✓" : ""}
                                </ContextMenuSubTrigger>
                                <ContextMenuSubContent>
                                  <ContextMenuItem
                                    onClick={() =>
                                      onCommand(character.name, "give", entry.item, {
                                        target: target.name,
                                        slot: entry.slot,
                                        equipOnDelivery: false,
                                      })
                                    }
                                  >
                                    Don&apos;t equip
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onClick={() =>
                                      onCommand(character.name, "give", entry.item, {
                                        target: target.name,
                                        slot: entry.slot,
                                        equipOnDelivery: true,
                                      })
                                    }
                                  >
                                    Equip
                                  </ContextMenuItem>
                                </ContextMenuSubContent>
                              </ContextMenuSub>
                            ) : (
                              <ContextMenuItem
                                key={target.name}
                                onClick={() =>
                                  onCommand(character.name, "give", entry.item, {
                                    target: target.name,
                                    slot: entry.slot,
                                  })
                                }
                              >
                                {target.name}
                              </ContextMenuItem>
                            ),
                          )}
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    {character.name === merchant && entry.meta?.definition.stat ? (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <ScrollText className="mr-2 h-4 w-4" />
                          {inventoryStatScrollMark
                            ? `Stat scroll: ${inventoryStatScrollMark.statType.toUpperCase()}`
                            : entry.item.stat_type
                              ? `Change stat scroll · ${entry.item.stat_type.toUpperCase()}`
                              : "Add stat scroll"}
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {STAT_SCROLLS.filter(
                            (choice) =>
                              choice.purchasable ||
                              (statScrollInventory[choice.scroll] || 0) >=
                                statScrollQuantity(entry.meta, entry.item),
                          ).map((choice) => {
                            const required = statScrollQuantity(entry.meta, entry.item);
                            const owned = statScrollInventory[choice.scroll] || 0;
                            return (
                              <ContextMenuItem
                                key={choice.stat}
                                disabled={entry.item.stat_type === choice.stat}
                                onClick={() =>
                                  entry.item.stat_type !== choice.stat &&
                                  onCommand(character.name, "stat-scroll-mark", entry.item, {
                                    slot: entry.slot,
                                    statType: choice.stat,
                                  })
                                }
                              >
                                <span>
                                  {choice.label}
                                  {entry.item.stat_type === choice.stat ? " · current" : ""}
                                </span>
                                <span className="ml-auto pl-5 font-mono text-black">
                                  {choice.purchasable
                                    ? `${primaryStatScrollCost(entry.meta, entry.item).toLocaleString()}g · ${required} scroll${required === 1 ? "" : "s"}`
                                    : `${owned}/${required} owned`}
                                </span>
                              </ContextMenuItem>
                            );
                          })}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    ) : null}
                    <ContextMenuItem
                      disabled={bankMarked}
                      onClick={() =>
                        onCommand(character.name, "mark", entry.item, {
                          slot: entry.slot,
                        })
                      }
                    >
                      <Landmark className="mr-2 h-4 w-4" />
                      Mark for bank
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={autoMarkMode === "bank"}
                      onClick={() =>
                        onCommand(character.name, "auto-item-mark", entry.item, { mode: "bank" })
                      }
                    >
                      <AutoActionIcon><Landmark /></AutoActionIcon>
                      Auto mark for bank
                    </ContextMenuItem>
                    {character.name === merchant ? (
                      <>
                        <ContextMenuItem
                          disabled={standFull && !standMarked}
                          onClick={() => { if (!standFull || standMarked) onStand(entry); }}
                          className="bg-white text-black data-highlighted:bg-slate-100 data-disabled:bg-white data-disabled:text-slate-400"
                        >
                          <Store className="mr-2 h-4 w-4" />
                          {standMarked ? "Edit stand listing" : "Mark for stand"}
                        </ContextMenuItem>
                        <ContextMenuItem className="text-amber-300" onClick={() => onAutoStand(entry)}>
                          <AutoActionIcon><Store /></AutoActionIcon>
                          {autoStandMarked ? "Update auto mark for stand…" : "Auto mark for stand…"}
                        </ContextMenuItem>
                      </>
                    ) : null}


                    {character.name !== merchant ? (
                      <>
                        <ContextMenuItem
                          disabled={!!merchantMarkedItem}
                          onClick={() =>
                            onCommand(character.name, "merchant-mark", entry.item, {
                              slot: entry.slot,
                            })
                          }
                        >
                          <PackageOpen className="mr-2 h-4 w-4" />
                          Mark for merchant
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={autoMarkMode === "merchant"}
                          onClick={() =>
                            onCommand(character.name, "auto-item-mark", entry.item, {
                              mode: "merchant",
                            })
                          }
                        >
                          <AutoActionIcon><PackageOpen /></AutoActionIcon>
                          Auto mark for merchant
                        </ContextMenuItem>
                      </>
                    ) : null}
                    {merchant ? (
                      <UpgradeActions
                        offeringSource={{slot:entry.slot}}
                        item={entry.item}
                        meta={entry.meta}
                        mark={upgradeMark}
                        autoTiers={upgradeRuleTiers(autoUpgradeMarks[autoRuleKey])}
                        allowBuy={character.name !== merchant}
                        onMark={(tiers, remove) =>
                          onCommand(character.name, "upgrade-mark", entry.item, {
                            slot: entry.slot,
                            tiers,
                            remove,
                          })
                        }
                        onBuy={() => onCommand(character.name, "buy-copy", entry.item)}
                        onAutoMark={(tiers, remove) =>
                          onCommand(character.name, "auto-upgrade-mark", entry.item, {
                            slot: entry.slot,
                            tiers,
                            remove,
                          })
                        }
                      />
                    ) : null}
                    {!!merchant && compoundable && !compoundGroup ? (
                      <ContextMenuItem
                        onClick={() =>
                          onCommand(character.name, "compound-mark", entry.item, {
                            slot: entry.slot,
                          })
                        }
                      >
                        <Blender className="mr-2 h-4 w-4" />
                        Mark for compounding
                      </ContextMenuItem>
                    ) : null}
                    {!!merchant && compoundable ? (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <AutoActionIcon><Blender /></AutoActionIcon>
                          {autoCompoundMark
                            ? `Auto compound to +${autoCompoundMark.targetTier}`
                            : "Auto compound"}
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {Array.from(
                            {
                              length: Math.max(0, maxCompoundTier - (entry.item.level || 0)),
                            },
                            (_, index) => (entry.item.level || 0) + index + 1,
                          ).map((tier) => {
                            const cost = compoundPassCost(
                              entry.meta?.definition.grades as number[] | undefined,
                              tier,
                              buyable,
                            );
                            return (
                              <ContextMenuItem
                                key={tier}

                                onClick={() =>
                                  onCommand(character.name, "auto-compound-mark", entry.item, {
                                    targetTier: tier,
                                  })
                                }
                              >
                                <span>+{tier}</span>
                                <span className="ml-auto pl-5 font-mono text-black">
                                  {cost ? `${cost.gold.toLocaleString()}g` : "Price unavailable"}
                                </span>
                              </ContextMenuItem>
                            );
                          })}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    ) : null}
                    {merchant || deconstructable && onDeconstruction ? <ContextMenuSeparator className="my-1 h-px bg-slate-600" /> : null}
                    {deconstructable && onDeconstruction ? <>
                      <ContextMenuItem className="text-orange-300" disabled={!!deconstruction} onClick={() => onDeconstruction(entry, false, false)}>
                        <BrokenStickIcon className="mr-2 h-4 w-4" />
                        Mark for deconstruction
                      </ContextMenuItem>
                      <ContextMenuItem className="text-orange-300" disabled={autoDeconstruct} onClick={() => onDeconstruction(entry, true, false)}>
                        <AutoActionIcon><BrokenStickIcon /></AutoActionIcon>
                        Auto mark for deconstruction
                      </ContextMenuItem>
                    </> : null}
                    {merchant ? (
                      <>
                        <ContextMenuItem className="text-rose-300" onClick={() => onNpcSale(entry)}>
                          <DollarSign className="mr-2 h-4 w-4" />
                          Sell to NPC…
                        </ContextMenuItem>
                        <ContextMenuItem
                          className="text-rose-300"
                          onClick={() => onAutoNpcSale(entry)}
                        >
                          <AutoActionIcon><DollarSign /></AutoActionIcon>
                          {autoNpcSaleMarked ? "Update auto sell to NPC…" : "Auto sell to NPC…"}
                        </ContextMenuItem>
                      </>
                    ) : null}
                    {Boolean(bankMarked || merchantMarkedItem || autoMarkMode || upgradeMark || autoUpgradeMarks[autoRuleKey] || inventoryStatScrollMark || compoundGroup || autoCompoundMark || autoExchangeMarked || merchantWeaponMarked || npcSale || autoNpcSaleMarked || standMarked || autoStandMarked || deconstruction || autoDeconstruct) && (
                      <ClearItemMarks onClear={() => onCommand(character.name, "clear-item-marks", entry.item, { slot: entry.slot })} />
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </>
      ) : null}
      {character.name !== merchant && (
        <div className="mt-5 grid gap-2 border-t border-emerald-900 pt-4">
          <Button
            variant="outline"
            onClick={onTravel}
            className="h-11 w-full justify-start border-cyan-800 bg-cyan-400/5 text-sm text-cyan-300 hover:bg-cyan-950 hover:text-cyan-200"
          >
            <MapPin className="mr-2 h-4 w-4" />
            Send to…
          </Button>
        </div>
      )}
      <div className={`${character.name !== merchant ? "mt-2" : "mt-5"} grid gap-2`}>
        {automaticSection(
              "npc",
              "Auto NPC sales",
              <DollarSign className="h-4 w-4" />,
              "border-rose-800 text-rose-300",
              [...Object.entries(autoNpcSales).filter(([, rule]) => character.name === merchant ? !rule.character : rule.character === character.name).map(([key, rule]) => ({
                key,
                item: rule.item,
                onRemove: () => onRemoveAutomaticSale("npc", rule.item),
              })), ...npcSaleMarks.map(mark => ({
                key: mark.id, item: mark.item, detail: `${mark.character || merchant} · ${mark.quantity} × · ${mark.state || 'queued'}${mark.error ? ` · ${mark.error}` : ''}`,
                disabled: mark.state === 'running', onRemove: () => onRemoveNpcSale?.(mark.id),
              }))],
            )}
        {automaticSection(
          "deconstruction", "Auto deconstruction", <BrokenStickIcon className="h-4 w-4" />,
          "border-orange-800 text-orange-300",
          [...Object.entries(autoDeconstruction).map(([key, rule]) => ({
            key, item: rule.item, detail: 'Automatic',
            onRemove: () => onDeconstruction?.({ slot: -1, item: rule.item }, true, true),
          })), ...deconstructionMarks.filter(mark => mark.state !== 'complete').map(mark => ({
            key: mark.id, item: mark.item, detail: `${mark.owner} · ${mark.quantity} × · ${mark.state}${mark.error ? ` · ${mark.error}` : ''}`,
            disabled: mark.state === 'running',
            retry: mark.state === 'blocked' ? () => onRetryDeconstruction?.(mark.id) : undefined,
            onRemove: () => onDeconstruction?.({ slot: mark.slot, item: mark.item }, false, true, mark.id),
          }))],
        )}
        {character.name === merchant ? (
          <>
            {automaticSection(
              "stand",
              "Auto stand marks",
              <ShoppingCart className="h-4 w-4" />,
              "border-amber-800 text-amber-300",
              Object.entries(autoStandMarks).map(([key, rule]) => ({
                key,
                item: rule.item,
                detail: `${rule.price.toLocaleString()}g`,
                onRemove: () => onRemoveAutomaticSale("stand", rule.item),
              })),
            )}
            {automaticSection(
              "upgrade",
              "Auto upgrades",
              <Sparkles className="h-4 w-4" />,
              "border-sky-800 text-sky-300",
              Object.entries(allAutoUpgradeMarks).flatMap(([owner, rules]) =>
                Object.entries(rules).map(([ruleKey, rule]) => {
                  const item = automaticRuleItem(ruleKey);
                  const tiers = upgradeRuleTiers(rule),
                    quantity = upgradeRuleQuantity(rule);
                  return {
                    key: `${owner}:${ruleKey}`,
                    item,
                    upgradeTarget: Number(item.level || 0) + tiers,
                    detail: owner === character.name ? undefined : owner,
                    edits: [
                      {
                        id: "target",
                        value: tiers,
                        label: `${tiers} tier${tiers === 1 ? "" : "s"} → +${Number(item.level || 0) + tiers}`,
                        min: 1,
                        max: Math.max(1, 13 - Number(item.level || 0)),
                        onSave: (value: number) =>
                          void onCommand(owner, "update-auto-upgrade-rule", item, {
                            ruleKey,
                            tiers: value,
                          }),
                      },
                      {
                        id: "quantity",
                        value: quantity,
                        label: quantity === -1 ? "Remaining ∞" : quantity === 0 ? "Completed" : `Remaining ${quantity}`,
                        min: 1,
                        max: 9999,
                        allowUnlimited: true,
                        onSave: (value: number) =>
                          void onCommand(owner, "update-auto-upgrade-rule", item, {
                            ruleKey,
                            quantity: value,
                          }),
                      },
                    ],
                    onRemove: () =>
                      void onCommand(owner, "update-auto-upgrade-rule", item, {
                        ruleKey,
                        remove: true,
                      }),
                  };
                }),
              ),
            )}
            <UpgradeOfferingRules />
            {automaticSection(
              "compound",
              "Auto compounds",
              <Blender className="h-4 w-4" />,
              "border-fuchsia-800 text-fuchsia-300",
              Object.entries(allAutoCompoundMarks).flatMap(([owner, rules]) =>
                rules.map((rule) => ({
                  key: `${owner}:${rule.name}`,
                  item: { name: rule.name, level: 0 },
                  detail: owner === character.name ? undefined : owner,
                  edits: [
                    {
                      id: "target",
                      value: rule.targetTier,
                      label: `Target +${rule.targetTier}`,
                      min: 1,
                      max: 7,
                      onSave: (value: number) =>
                        void onCommand(
                          owner,
                          "auto-compound-mark",
                          { name: rule.name },
                          { targetTier: value },
                        ),
                    },
                    {
                      id: "quantity",
                      value: Number.isSafeInteger(Number(rule.quantity))
                        ? Number(rule.quantity)
                        : -1,
                      label:
                        Number(rule.quantity) === -1 || rule.quantity === undefined
                          ? "Remaining ∞"
                          : Number(rule.quantity) === 0 ? "Completed" : `Remaining ${rule.quantity}`,
                      min: 1,
                      max: 9999,
                      allowUnlimited: true,
                      onSave: (value: number) =>
                        void onCommand(
                          owner,
                          "auto-compound-mark",
                          { name: rule.name },
                          { targetTier: rule.targetTier, quantity: value },
                        ),
                    },
                  ],
                  onRemove: () =>
                    void onCommand(
                      owner,
                      "auto-compound-mark",
                      { name: rule.name },
                      { targetTier: rule.targetTier, remove: true },
                    ),
                })),
              ),
            )}
          </>
        ) : null}
        {character.name === merchant
          ? automaticSection(
              "merchant",
              "Auto merchant marks",
              <PackageOpen className="h-4 w-4" />,
              "border-purple-800 text-purple-300",
              Object.entries(autoItemMarks)
                .filter(([, mode]) => mode === "merchant")
                .map(([key]) => ({
                  key,
                  item: automaticRuleItem(key),
                  onRemove: () =>
                    void onCommand(character.name, "remove-auto-item-mark", undefined, {
                      mode: "merchant",
                      ruleKey: key,
                    }),
                })),
            )
          : null}
        {automaticSection(
          "bank",
          "Auto bank marks",
          <Landmark className="h-4 w-4" />,
          "border-amber-800 text-amber-300",
          Object.entries(autoItemMarks)
            .filter(([, mode]) => mode === "bank")
            .map(([key]) => ({
              key,
              item: automaticRuleItem(key),
              onRemove: () =>
                void onCommand(character.name, "remove-auto-item-mark", undefined, {
                  mode: "bank",
                  ruleKey: key,
                }),
            })),
        )}
        {character.name === merchant ? (
          <>
          <MerchantVisitControl characters={characters} merchant={merchant} />
          <Button
            variant="outline"
            onClick={() => onCommand(character.name, "go-home")}
            className="h-9 w-full justify-start border-cyan-700 bg-[#071719] text-xs text-cyan-100 hover:border-cyan-500 hover:bg-cyan-950 hover:text-white"
          >
            <HomeIcon className="mr-2 h-4 w-4" />
            Go home
          </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={!leaderOnline}
            onClick={() => onCommand(character.name, "return-leader")}
            className="mt-1 h-11 w-full justify-start border-emerald-800 bg-black text-sm text-emerald-300 hover:bg-emerald-950 hover:text-emerald-100"
          >
            <Radio className="mr-2 h-4 w-4" />
            Return to leader
          </Button>
        )}
      </div>
    </div>
  );
});
