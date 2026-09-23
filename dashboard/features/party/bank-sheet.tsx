"use client";

import { BankSortControl, type BankSortState } from "./bank-sort-control";
import { automaticCommerceRuleKey } from "./automatic-commerce-rule-key";
import { AutoStandBanner } from "./auto-stand-banner";
import type { PartyState } from "./party-state";
import { standIsFull } from "./stand-capacity";
import type { StandBid } from "./stand-bid";
import { itemMenuClass } from "./item-menu-style";

import { BankDeconstructionActions } from './bank-deconstruction-actions';

import type { DeconstructionCatalog } from './deconstruction';

import { Button } from "@/components/ui/button";

import {

  ContextMenu,

  ContextMenuContent,

  ContextMenuItem,

  ContextMenuSeparator,

  ContextMenuTrigger,

} from "@/components/ui/context-menu";

import {

  Dialog,

  DialogContent,

  DialogDescription,

  DialogFooter,

  DialogHeader,

  DialogTitle,

} from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";

import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";

import { DollarSign, RefreshCw, Store, Landmark } from "lucide-react";

import { memo, useRef, useState } from "react";

import { abbreviatedGold } from "./abbreviated-gold";

import { BankSnapshot } from "./bank-snapshot";

import { BankVault } from "./bank-vault";

import { Bankboi } from "./bankboi";

import { Char } from "./char";

import { InventoryEntry } from "./inventory-entry";

import { Item } from "./item";

import { ItemSprite } from "./item-sprite";

import { MerchantBuyItem } from "./merchant-buy-item";

import { MerchantCatalogItem } from "./merchant-catalog-item";

import { MluckClover } from "./mluck-clover";

import { NpcSaleMark } from "./npc-sale-mark";

import { same } from "./same";

import { StandListing } from "./stand-listing";

import { StandPriceHistory } from "./stand-price-history";

import { statBadgeClass } from "./stat-badge-class";


import { Withdrawal } from "./withdrawal";



export const BankSheet = memo(function BankSheet({

  open,

  bankSortState = {},
  bankboiPrefix = "",

  onOpenChange,

  bank,

  bankbois,

  bankboiQueue,

  merchant,

  merchantState,

  vaults,

  withdrawals,







  onSelect,

  onWithdraw,

  onWithdrawAll,

  onCreateBankboi,

  onDeleteBankboi,




  standListings,
  standBids = {},
  autoStandMarks = {},

  onStand,

  onUnstand,

  onNpcSale,

  onDeconstruction,

  deconstructionCatalog,

  npcSaleMarks,

  onUnlock,

}: {

  bankSortState?: BankSortState;
  open: boolean;

  bankboiPrefix?: string;

  onOpenChange: (open: boolean) => void;

  bank: BankSnapshot | null;

  bankbois: Bankboi[];

  bankboiQueue: {

    id: string;

    item: Item;

    state: string;

    bootstrap?: boolean;

  }[];

  merchant?: string | null;

  merchantState?: Char;

  vaults: BankVault[];

  withdrawals: Record<string, Withdrawal[]>;







  onSelect: (pack: string, entry: InventoryEntry) => void;

  onWithdraw: (pack: string, entry: InventoryEntry) => void;

  onWithdrawAll: (pack: string, entry: InventoryEntry) => void;

  onCreateBankboi: () => Promise<string>;

  onDeleteBankboi: (name: string) => Promise<void>;

  buyable: MerchantBuyItem[];

  catalog: MerchantCatalogItem[];

  priceHistory: Record<string, StandPriceHistory>;

  standListings: StandListing[];
  autoStandMarks?: PartyState["autoStandMarks"];
  standBids?: Record<string, StandBid>;

  onStand: (pack: string, entry: InventoryEntry, all?: boolean) => void;

  onUnstand: (pack: string, entry: InventoryEntry) => void;

  onNpcSale: (pack: string, entry: InventoryEntry, all?: boolean) => void;

  onDeconstruction: (pack: string, entry: InventoryEntry, all: boolean) => void;

  deconstructionCatalog: DeconstructionCatalog;

  npcSaleMarks: NpcSaleMark[];

  onUnlock: (vault: BankVault, kind: "key" | "gold") => Promise<void>;

}) {



  const [unlocking, setUnlocking] = useState<BankVault | null>(null);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matchesSearch = (entry: InventoryEntry) => !query ||
    [entry.item.name, entry.meta?.definition.name].some(name =>
      String(name || "").toLowerCase().includes(query),
    );

  const [unlockKind, setUnlockKind] = useState<"key" | "gold">("gold");

  const [bankboiBusy, setBankboiBusy] = useState(false);

  const [confirmFirstBankboi, setConfirmFirstBankboi] = useState(false);

  const [bankboiCreateResult, setBankboiCreateResult] = useState<{

    ok: boolean;

    message: string;

  } | null>(null);

  const [deleteBankboi, setDeleteBankboi] = useState<string | null>(null);

  const creatingBankboi = useRef(false);

  const createBankboi = async () => {

                  if (creatingBankboi.current) return;

                  creatingBankboi.current = true;

                  setBankboiBusy(true);

                  setBankboiCreateResult(null);

                  try {

                    const name = await onCreateBankboi();

                    setConfirmFirstBankboi(false);

                    setBankboiCreateResult({

                      ok: true,

                      message: `${name} created · provisioning queued`,

                    });

                  } catch (error) {

                    setBankboiCreateResult({

                      ok: false,

                      message: error instanceof Error ? error.message : "Bankboi creation failed",

                    });

                  } finally {

                    creatingBankboi.current = false;

                    setBankboiBusy(false);

                  }

                };

  const standFull = standIsFull(standListings, standBids);

  const marked = (pack: string, entry: InventoryEntry) =>

    !!merchant &&

    (withdrawals[merchant] || []).some(

      (request) =>

        request.pack === pack && request.slot === entry.slot && same(request.item, entry.item),

    );

  const standMarked = (pack: string, entry: InventoryEntry) =>

    (standListings || []).some(

      (listing) =>

        listing.bankPack === pack &&

        listing.bankSlot === entry.slot &&

        same(listing.item, entry.item),

    );

  const npcMarked = (pack: string, entry: InventoryEntry) =>

    npcSaleMarks.some(

      (mark) => mark.pack === pack && mark.slot === entry.slot && same(mark.item, entry.item),

    );

  const unlockedPacks = new Set(Object.keys(bank?.packs || {}));

  const keyQuantity = (key: string) => {

    let quantity = (merchantState?.items || []).reduce(

      (sum, entry) => sum + (entry?.item.name === key ? Number(entry.item.q || 1) : 0),

      0,

    );

    Object.values(bank?.packs || {}).forEach((entries) =>

      entries.forEach((entry) => {

        if (entry?.item.name === key) quantity += Number(entry.item.q || 1);

      }),

    );

    return quantity;

  };

  const floorAccessible = (floor: string) =>

    floor === "bank" ||

    vaults.some(

      (vault) => vault.floor === floor && vault.gold === 0 && unlockedPacks.has(vault.pack),

    );

  const floorNames: Record<string, string> = {

    bank: "Main bank",

    bank_b: "Bank basement",

    bank_u: "Bank underground",

  };

  return (

    <>

      <Dialog open={open} onOpenChange={onOpenChange}>

        <DialogContent className="max-h-[90vh] w-[min(1500px,calc(100vw-2rem))] max-w-none overflow-y-auto border-emerald-900 bg-[#091614] text-emerald-50 sm:max-w-none">

          <DialogHeader>

            <DialogTitle className="text-emerald-50">Bank</DialogTitle>

            <DialogDescription className="sr-only">Bank panes and overflow storage</DialogDescription>

            {!bank && <p>No snapshot yet. Send a character to the bank once to load it.</p>}

          </DialogHeader>
          <Input
            type="search"
            aria-label="Search bank items"
            placeholder="Search by item name or ID…"
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="border-emerald-700 bg-[#050b0a] text-emerald-50 placeholder:text-slate-400"
          />
          <BankSortControl state={bankSortState} />



          {bank && (

            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">

              {Object.entries(bank.packs).map(([pack, items]) => (

                <section key={pack}>

                  <div className="mb-2 flex items-center justify-between font-mono text-xs uppercase">

                    <h3 className="text-emerald-300">{pack}</h3>

                    {(() => {

                      const occupied = items.filter(Boolean).length;

                      const usableItems = pack === "items1" ? items.slice(0, 35) : items;

                      const free = usableItems.length - usableItems.filter(Boolean).length;

                      const color =

                        free < 5

                          ? "text-rose-400"

                          : free <= 10

                            ? "text-orange-400"

                            : "text-emerald-100/55";

                      return (

                        <span className={color} title={`${free} slots free`}>

                          {occupied}/{items.length}

                        </span>

                      );

                    })()}

                  </div>

                  <div className="grid grid-cols-7 gap-2">

                    {items.map((entry, i) => {

                      const reserved = pack === "items1" && i >= 35;

                      return entry ? (

                        <ContextMenu key={i}>

                          <Tooltip>

                            <TooltipTrigger

                              render={

                                <ContextMenuTrigger

                                  onClick={() => onSelect(pack, entry)}

                                  aria-label={String(

                                    entry.meta?.definition.name || entry.item.name,

                                  )}

                                  className={`relative aspect-square overflow-hidden rounded border bg-black/35 transition-opacity hover:border-emerald-400 ${matchesSearch(entry) ? "opacity-100" : "opacity-25"} ${reserved ? "border-fuchsia-800" : marked(pack, entry) ? "border-amber-400" : "border-emerald-900"}`}

                                />

                              }

                            >

                              {entry.meta?.sprite && <ItemSprite sprite={entry.meta.sprite} />}{" "}

                              {entry.item.level ? (

                                <span className="absolute bottom-1 left-1 z-10 rounded bg-black/75 px-1 font-mono text-[10px] font-semibold text-emerald-300">

                                  +{entry.item.level}

                                </span>

                              ) : null}

                              {entry.item.stat_type ? (

                                <span

                                  className={`absolute left-1 top-1 z-10 rounded px-1 font-mono text-[9px] font-semibold uppercase ring-1 ${statBadgeClass(entry.item.stat_type)}`}

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
                              <AutoStandBanner item={entry.item} rules={autoStandMarks} />

                              {reserved ? (

                                <span className="pointer-events-none absolute inset-x-[-20%] top-1/2 z-30 -rotate-45 border-y border-fuchsia-500/60 bg-black/80 py-0.5 text-center font-mono text-[8px] font-bold tracking-widest text-fuchsia-200">

                                  RESERVED

                                </span>

                              ) : null}

                              {standMarked(pack, entry) && !autoStandMarks[automaticCommerceRuleKey(entry.item)] ? (

                                <span

                                  title="Configured for merchant stand"

                                  className="absolute right-1 top-1 z-20 grid h-5 w-5 place-items-center rounded-full bg-yellow-400 text-black shadow"

                                >

                                  <DollarSign className="h-3.5 w-3.5" />

                                </span>

                              ) : null}

                              {npcMarked(pack, entry) ? (

                                <span

                                  title="Marked for NPC sale"

                                  className="absolute right-1 top-7 z-20 rounded bg-rose-700 px-1 font-mono text-[8px] font-bold text-white"

                                >

                                  NPC

                                </span>

                              ) : null}

                            </TooltipTrigger>

                          </Tooltip>

                          <ContextMenuContent className={itemMenuClass}>
<ContextMenuItem

                              disabled={!merchant}

                              onClick={() => onWithdraw(pack, entry)}

                            >

                              <Landmark className="mr-2 h-4 w-4" />{marked(pack, entry) ? "Unmark withdrawal" : "Mark for withdrawal"}

                            </ContextMenuItem>

                            <ContextMenuItem

                              disabled={!merchant}

                              onClick={() => onWithdrawAll(pack, entry)}

                            >

                              <Landmark className="mr-2 h-4 w-4" />Mark all for withdrawal

                            </ContextMenuItem>

                            <ContextMenuItem

                              disabled={standFull && !standMarked(pack, entry)}

                              onClick={() => standMarked(pack, entry) ? onUnstand(pack, entry) : onStand(pack, entry)}

                              className="bg-white text-black data-highlighted:bg-slate-100 data-disabled:bg-white data-disabled:text-slate-400"

                            >

                              <Store className="mr-2 h-4 w-4" />{standMarked(pack, entry) ? "Unmark for stand" : "Mark for stand"}

                            </ContextMenuItem>

                            <ContextMenuItem className="text-amber-300" disabled={standFull && !standMarked(pack, entry)}

                              onClick={() => onStand(pack, entry, true)}>

                              <Store className="mr-2 h-4 w-4" />Mark all for stand

                            </ContextMenuItem>



                            <BankDeconstructionActions entry={entry} pack={pack} merchant={merchant} catalog={deconstructionCatalog} onMark={onDeconstruction} />

                            <ContextMenuItem

                              className="text-rose-300"

                              onClick={() => onNpcSale(pack, entry)}

                            >

                              <DollarSign className="mr-2 h-4 w-4" />Sell to NPC…

                            </ContextMenuItem>

                            <ContextMenuItem className="text-rose-300" disabled={!merchant || !!entry.item.l}

                              onClick={() => onNpcSale(pack, entry, true)}>

                              <DollarSign className="mr-2 h-4 w-4" />Sell all to NPC…

                            </ContextMenuItem>

                          </ContextMenuContent>

                        </ContextMenu>

                      ) : (

                        <div

                          key={i}

                          className={`relative aspect-square overflow-hidden rounded border border-dashed ${reserved ? "border-fuchsia-900 bg-fuchsia-950/10" : "border-emerald-950"}`}

                        >

                          {reserved ? (

                            <span className="absolute inset-x-[-20%] top-1/2 -rotate-45 border-y border-fuchsia-700/50 bg-black/70 py-0.5 text-center font-mono text-[8px] font-bold tracking-widest text-fuchsia-300/70">

                              RESERVED

                            </span>

                          ) : null}

                        </div>

                      );

                    })}

                  </div>

                </section>

              ))}

            </div>

          )}

          {!!vaults.length && (

            <section className="mt-8 rounded-lg border border-amber-900/80 bg-black/20 p-4">

              <p className="font-mono text-xs uppercase tracking-wider text-amber-300">

                Additional bank storage

              </p>

              <div className="mt-3 space-y-4">

                {[...new Set(vaults.map((vault) => vault.floor))].map((floor) => {

                  const accessible = floorAccessible(floor);

                  const floorVaults = vaults.filter((vault) => vault.floor === floor);

                  const key = floorVaults.find((vault) => vault.key)?.key;

                  const ownedKeys = key ? keyQuantity(key.id) : 0;

                  const locked = floorVaults.filter(

                    (vault) => !unlockedPacks.has(vault.pack) && vault.gold > 0,

                  );

                  return (

                    <div key={floor} className="rounded border border-amber-950/80 bg-black/20 p-3">

                      <div className="flex flex-wrap items-center justify-between gap-2">

                        <div>

                          <p className="text-sm font-semibold text-amber-100">

                            {floorNames[floor] || floor}

                          </p>

                          <p

                            className={`font-mono text-[10px] uppercase ${accessible ? "text-emerald-300" : "text-rose-300"}`}

                          >

                            {accessible

                              ? "Accessible"

                              : `Locked${key ? ` · requires ${key.name}` : ""}`}

                          </p>

                        </div>

                        {!accessible && key ? (

                          <Button

                            size="sm"

                            variant="outline"

                            disabled={!ownedKeys || !merchant}

                            onClick={() => {

                              setUnlocking(floorVaults[0]);

                              setUnlockKind("key");

                            }}

                            className="h-auto min-w-0 flex-col items-start border-amber-600 bg-black px-3 py-2 text-left text-amber-100 hover:bg-amber-950 hover:text-white disabled:border-slate-800 disabled:text-slate-600"

                          >

                            <span className="max-w-full truncate">Unlock with {key.name}</span>

                            <span className="font-mono text-[10px] text-amber-300">

                              Owned: {ownedKeys}

                            </span>

                          </Button>

                        ) : null}

                      </div>

                      {accessible && locked.length ? (

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">

                          {locked.map((vault) => (

                            <Button

                              key={vault.pack}

                              variant="outline"

                              disabled={!merchant}

                              onClick={() => {

                                setUnlocking(vault);

                                setUnlockKind("gold");

                              }}

                              className="h-auto min-w-0 flex-col items-start border-amber-800 bg-black px-3 py-2 text-left text-amber-100 hover:bg-amber-950 hover:text-white"

                            >

                              <span>Unlock {vault.pack}</span>

                              <span

                                className="max-w-full font-mono text-xs text-amber-300"

                                title={`${vault.gold.toLocaleString()} gold`}

                              >

                                {abbreviatedGold(vault.gold)} gold

                              </span>

                            </Button>

                          ))}

                        </div>

                      ) : accessible ? (

                        <p className="mt-2 text-xs text-emerald-100/45">

                          No purchasable locked vaults detected on this floor.

                        </p>

                      ) : (

                        <p className="mt-2 text-xs text-rose-100/45">

                          Vault purchases remain disabled until floor access is unlocked.

                        </p>

                      )}

                    </div>

                  );

                })}

              </div>

            </section>

          )}

          <Dialog open={confirmFirstBankboi} onOpenChange={(value) => { if (!bankboiBusy) setConfirmFirstBankboi(value); }}>

            <DialogContent className="border border-cyan-700 bg-[#071315] text-slate-100">

              <DialogHeader><DialogTitle>Create first BankBoi?</DialogTitle><DialogDescription className="text-slate-200">This will reserve 7 slots from bank pane 1 for BankBoi logistics.</DialogDescription></DialogHeader>

              {bankboiCreateResult?.ok === false && <p role="alert" className="text-rose-200">{bankboiCreateResult.message}</p>}

              <DialogFooter className="bg-[#071315]">

                <Button disabled={bankboiBusy} variant="outline" className="border-slate-600 bg-black text-white hover:bg-slate-800 hover:text-white" onClick={() => setConfirmFirstBankboi(false)}>Cancel</Button>

                <Button disabled={bankboiBusy} className="border border-cyan-500 bg-cyan-500 text-black hover:bg-cyan-400" onClick={() => void createBankboi()}>{bankboiBusy ? 'Creating…' : 'Create BankBoi'}</Button>

              </DialogFooter>

            </DialogContent>

          </Dialog>

          <section className="mt-6">

            <div className="flex items-center justify-between gap-3">

              <div>

                <p className="font-mono text-xs uppercase tracking-wider text-cyan-300">Bankbois</p>

                <p className="mt-1 text-xs text-slate-400">

                  Transparent overflow storage · {bankboiQueue.length} staged or waiting

                </p>

              </div>

              <Button

                disabled={bankboiBusy || !bankboiPrefix.trim()}

                onClick={() => bankbois.length ? void createBankboi() : setConfirmFirstBankboi(true)}

                className="min-w-40 border border-cyan-500 bg-cyan-500 text-black hover:bg-cyan-400 disabled:border-cyan-900 disabled:bg-[#071315] disabled:text-cyan-300"

              >

                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${bankboiBusy ? "animate-spin" : ""}`} />

                {bankboiBusy ? "Creating…" : "Create bankboi"}

              </Button>

            </div>

            {!bankboiPrefix.trim() && <p role="alert" className="mt-2 text-sm text-rose-400">Set bankboi name in settings first</p>}

            {bankboiCreateResult ? (

              <output

                className={`mt-3 border px-3 py-2 text-xs ${bankboiCreateResult.ok ? "border-emerald-700 bg-emerald-950 text-emerald-200" : "border-rose-700 bg-rose-950 text-rose-100"}`}

              >

                {bankboiCreateResult.ok ? "Success: " : "Failed: "}

                {bankboiCreateResult.message}

              </output>

            ) : null}

            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">

              {bankbois.length ? (

                bankbois.map((bankboi) => {

                  const occupied = (bankboi.items || []).filter(Boolean).length;

                  const empty =

                    occupied === 0 &&

                    !Object.keys(bankboi.slots || {}).length &&

                    !Number(bankboi.gold);

                  return (

                    <div key={bankboi.name} className="min-w-0 rounded border border-cyan-900 bg-[#071315] p-3">

                      <div className="mb-2 flex items-center justify-between">

                        <div>

                          <span className="font-mono text-sm text-cyan-100">{bankboi.name}</span>

                          <span className="ml-2 font-mono text-[10px] uppercase text-cyan-400">

                            {bankboi.transaction

                              ? `${bankboi.transaction.mode} · ${bankboi.transaction.phase}`

                              : bankboi.state}

                          </span>

                        </div>

                        <div className="flex items-center gap-2">

                          <span className="font-mono text-xs text-slate-400">{occupied}/42</span>

                          <button

                            type="button"

                            disabled={!empty}

                            onClick={() =>

                              deleteBankboi === bankboi.name

                                ? void onDeleteBankboi(bankboi.name)

                                : setDeleteBankboi(bankboi.name)

                            }

                            className={`h-7 border px-2 text-[10px] font-bold transition-colors disabled:border-slate-800 disabled:bg-black disabled:text-slate-700 ${deleteBankboi === bankboi.name ? "border-rose-200 bg-rose-600 text-white" : "border-rose-800 bg-black text-rose-300 hover:bg-rose-950"}`}

                          >

                            {deleteBankboi === bankboi.name ? "Really? ×" : "Delete"}

                          </button>

                        </div>

                      </div>

                      {bankboi.error ? (

                        <p className="mb-2 text-xs text-rose-300">{bankboi.error}</p>

                      ) : null}

                      <div className="grid grid-cols-7 gap-2">

                        {Array.from({ length: 42 }, (_, slot) => bankboi.items?.[slot] || null).map(

                          (entry, slot) =>

                            entry ? (

                              <ContextMenu key={slot}>

                                <ContextMenuTrigger

                                  onClick={() => onSelect(`bankboi:${bankboi.name}`, entry)}

                                  className={`relative aspect-square overflow-hidden border bg-black/60 transition-opacity ${matchesSearch(entry) ? "opacity-100" : "opacity-25"} ${marked(`bankboi:${bankboi.name}`, entry) ? "border-amber-400" : "border-cyan-950"} hover:border-cyan-400`}

                                >

                                  {entry.meta?.sprite ? (

                                    <ItemSprite sprite={entry.meta.sprite} />

                                  ) : null}

                                  {entry.item.level ? (

                                    <span className="absolute bottom-1 left-1 bg-black/80 px-1 font-mono text-[9px] text-emerald-300">

                                      +{entry.item.level}

                                    </span>

                                  ) : null}

                                  {entry.item.q && entry.item.q > 1 ? (

                                    <span className="absolute bottom-1 right-1 bg-black/80 px-1 font-mono text-[9px] text-amber-300">

                                      {entry.item.q}

                                    </span>

                                  ) : null}

                                  <MluckClover item={entry.item} />
                              <AutoStandBanner item={entry.item} rules={autoStandMarks} />

                                </ContextMenuTrigger>

                                <ContextMenuContent className={itemMenuClass}>
<ContextMenuItem

                                    onClick={() => onWithdraw(`bankboi:${bankboi.name}`, entry)}

                                  >

                                    <Landmark className="mr-2 h-4 w-4" />{marked(`bankboi:${bankboi.name}`, entry)

                                      ? "Unmark withdrawal"

                                      : "Mark for withdrawal"}

                                  </ContextMenuItem>

                                  <ContextMenuItem

                                    onClick={() => onWithdrawAll(`bankboi:${bankboi.name}`, entry)}

                                  >

                                    <Landmark className="mr-2 h-4 w-4" />Mark all for withdrawal

                                  </ContextMenuItem>

                                  <ContextMenuItem

                                    disabled={

                                      standFull && !standMarked(`bankboi:${bankboi.name}`, entry)

                                    }

                                    onClick={() => standMarked(`bankboi:${bankboi.name}`, entry) ? onUnstand(`bankboi:${bankboi.name}`, entry) : onStand(`bankboi:${bankboi.name}`, entry)}

                                    className="bg-white text-black data-highlighted:bg-slate-100 data-disabled:bg-white data-disabled:text-slate-400"

                                  >

                                    <Store className="mr-2 h-4 w-4" />{standMarked(`bankboi:${bankboi.name}`, entry) ? "Unmark for stand" : "Mark for stand"}

                                  </ContextMenuItem>

                            <ContextMenuItem className="text-amber-300" disabled={standFull && !standMarked(`bankboi:${bankboi.name}`, entry)}

                              onClick={() => onStand(`bankboi:${bankboi.name}`, entry, true)}>

                              <Store className="mr-2 h-4 w-4" />Mark all for stand

                            </ContextMenuItem>



                                  <BankDeconstructionActions entry={entry} pack={`bankboi:${bankboi.name}`} merchant={merchant} catalog={deconstructionCatalog} onMark={onDeconstruction} />

                                  <ContextMenuItem

                                    className="text-rose-300"

                                    onClick={() => onNpcSale(`bankboi:${bankboi.name}`, entry)}

                                  >

                                    <DollarSign className="mr-2 h-4 w-4" />Sell to NPC…

                                  </ContextMenuItem>

                            <ContextMenuItem className="text-rose-300" disabled={!merchant || !!entry.item.l}

                              onClick={() => onNpcSale(`bankboi:${bankboi.name}`, entry, true)}>

                              <DollarSign className="mr-2 h-4 w-4" />Sell all to NPC…

                            </ContextMenuItem>

                                </ContextMenuContent>

                              </ContextMenu>

                            ) : (

                              <div

                                key={slot}

                                className="aspect-square border border-dashed border-cyan-950/70"

                              />

                            ),

                        )}

                      </div>

                    </div>

                  );

                })

              ) : (

                <p className="py-4 text-center text-xs text-slate-500">

                  No bankbois yet. Reserved overflow cargo will wait safely until one is created.

                </p>

              )}

            </div>

          </section>

        </DialogContent>

      </Dialog>

      <Dialog

        open={!!unlocking}

        onOpenChange={(open) => {

          if (!open) setUnlocking(null);

        }}

      >

        <DialogContent className="border-amber-800 bg-[#091614] text-emerald-50 sm:max-w-md">

          <DialogHeader>

            <DialogTitle>

              {unlockKind === "key" ? "Unlock bank floor?" : "Unlock bank vault?"}

            </DialogTitle>

            <DialogDescription className="text-emerald-100/60">

              {unlocking

                ? unlockKind === "key"

                  ? `GoldMajesty will retrieve and consume ${unlocking.key?.name || "the required key"} to unlock ${floorNames[unlocking.floor] || unlocking.floor}.`

                  : `GoldMajesty will spend ${unlocking.gold.toLocaleString()} gold to permanently unlock ${unlocking.pack}.`

                : ""}

            </DialogDescription>

          </DialogHeader>

          <DialogFooter>

            <Button

              variant="outline"

              onClick={() => setUnlocking(null)}

              className="border-rose-600 bg-black text-rose-200 hover:bg-rose-950 hover:text-white"

            >

              Cancel

            </Button>

            <Button

              onClick={async () => {

                if (!unlocking) return;

                const vault = unlocking;

                setUnlocking(null);

                await onUnlock(vault, unlockKind);

              }}

              className="bg-amber-400 text-amber-950 hover:bg-amber-300"

            >

              Confirm unlock

            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

    </>

  );

});
