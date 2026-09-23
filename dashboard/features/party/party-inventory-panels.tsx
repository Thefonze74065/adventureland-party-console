"use client";
import { HostingSettings } from "./hosting-settings";
import { ConsoleUpdateSettings } from './console-updates';
import { AccountSettings } from "./account-settings";
import { lazy, useCallback, useState } from "react";
import { DeconstructionConfirmation, type DeconstructionSelection } from "./deconstruction-confirmation";
import { DeferredPanel } from "./deferred-panel";
import { DashboardStateImport } from "./dashboard-state-import";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Eye, EyeOff, RefreshCw, UserPlus } from "lucide-react";
const BankSheet = lazy(() =>
  import("./bank-sheet").then((module) => ({ default: module.BankSheet })),
);
import { same } from "./same";
import { bankSaleCopies } from "./bank-sale-copies";
const StandSheet = lazy(() =>
  import("./stand-sheet").then((module) => ({ default: module.StandSheet })),
);
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
import { useBankWithdrawal } from "./bank-withdrawal";
import { useForwardingActions } from "./use-forwarding-actions";
import { emptyArray, emptyRecord } from "./empty-values";
import type { InventoryEntry } from "./inventory-entry";
import type { Item } from "./item";
import type { ItemMeta } from "./item-meta";
import type { BankVault } from "./bank-vault";
import type { StandListing } from "./stand-listing";

// These are plain functions rebuilt on every usePartyConsole() render (not
// useState setters), so BankSheet/StandSheet would never see stable props
// without forwarding them through stable wrappers.
const forwardedActions = ['setStandItem', 'setNpcSaleItem', 'removeStandListing',
  'saveStandBid', 'buyALDataListing', 'buyPontyListing', 'sellALDataOrder'] as const;

export function PartyInventoryPanels({ model }: { model: PartyConsoleModel }) {
  return model.realmConfirmOpen || model.bankOpen || model.standOpen || model.marketOpen || model.settingsOpen ? <PartyInventoryPanelsConnected base={model} /> : null;
}
function PartyInventoryPanelsConnected({ base }: { base: PartyConsoleModel }) {
  const [deconstructionSelection, setDeconstructionSelection] = useState<DeconstructionSelection | null>(null);
  const model = usePanelModel(base, { inventory: true, vitals: true, bank: base.bankOpen, market: base.marketOpen || base.standOpen });
  const { setStandItem, setNpcSaleItem, removeStandListing, saveStandBid, buyALDataListing,
    buyPontyListing, sellALDataOrder } = useForwardingActions(base, forwardedActions);
  const {
    bankOpen,
    setBankOpen,
    state,
    setSelected,
    detailMeta,
    setActionError,
    post,
    standOpen,
    setStandOpen,
    marketOpen,
    setMarketOpen,
    settingsOpen,
    setSettingsOpen,
    realmDestination,
    setRealmDestination,
    setRealmSetHome,
    setRealmConfirmOpen,
    setCreateOpen,
    aldataBusy,
    aldataAction,
    aldataKeyVisible,
    aldataKey,
    setALDataKeyVisible,
    realmConfirmOpen,
    realmBusy,
    realmSetHome,
    switchRealm,
    setWtbItem,
  } = model;
  const { withdraw, confirmation } = useBankWithdrawal(post, setActionError);
  const standListings = state.standListings || emptyArray();
  const catalogAllItems = state.merchantCatalog?.allItems || emptyArray();
  const catalogBuyable = state.merchantCatalog?.buyable || emptyArray();
  const standPriceHistory = state.standPriceHistory || emptyRecord();
  const deconstructionCatalog = state.deconstructionCatalog || emptyRecord();
  const standBids = state.standBids || emptyRecord();
  const autoStandMarks = state.autoStandMarks || emptyRecord();

  const onBankSelect = useCallback((pack: string, entry: InventoryEntry) =>
    setSelected({
      character: `Bank · ${pack}`,
      entry: { ...entry, meta: detailMeta(entry.item, entry.meta) },
      source: { kind: "bank", pack },
    }), [setSelected, detailMeta]);
  const onWithdraw = useCallback((pack: string, entry: InventoryEntry) =>
    withdraw(state.merchantCharacter, pack, entry), [withdraw, state.merchantCharacter]);
  const onWithdrawAll = useCallback((pack: string, entry: InventoryEntry) =>
    withdraw(state.merchantCharacter, pack, entry, true), [withdraw, state.merchantCharacter]);
  const onCreateBankboi = useCallback(async () => {
    const result = await post("/bankbois/create", {});
    return String((result.bankboi as { name?: string })?.name || "bankboi");
  }, [post]);
  const onDeleteBankboi = useCallback(async (name: string) => {
    try {
      await post(`/bankbois/${encodeURIComponent(name)}/delete`, {});
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Bankboi deletion failed");
    }
  }, [post, setActionError]);
  const onUnstand = useCallback((pack: string, entry: InventoryEntry) => {
    const listing = standListings.find((mark) =>
      mark.bankPack === pack && mark.bankSlot === entry.slot && same(mark.item, entry.item));
    if (listing) void removeStandListing(listing).catch((error: unknown) =>
      setActionError(error instanceof Error ? error.message : "Could not unmark stand listing"));
  }, [standListings, removeStandListing, setActionError]);
  const onBankStand = useCallback((pack: string, entry: InventoryEntry, all = false) => {
    const knownMeta = catalogAllItems.find((item) => item.id === entry.item.name)?.meta;
    const valuedEntry = {
      ...entry,
      meta: knownMeta
        ? { ...entry.meta, ...knownMeta, world: knownMeta.world || entry.meta?.world }
        : entry.meta,
    };
    const existing = standListings.find(
      (mark) => mark.bankPack === pack && mark.bankSlot === entry.slot && same(mark.item, entry.item),
    );
    if (!existing && standListings.length >= 16)
      return setActionError("Merchant stand is full (16/16)");
    const value = { defaultPrice: Math.max(1, Number(valuedEntry.meta?.definition.g) || 1) };
    setStandItem({
      id: existing?.id,
      entry: valuedEntry,
      bankPack: pack,
      defaultPrice: value.defaultPrice,
      markAll: all,
      price: String(existing?.price || value.defaultPrice),
      quantity: String(existing?.quantity || entry.item.q || 1),
    });
  }, [catalogAllItems, standListings, setActionError, setStandItem]);
  const onBankNpcSale = useCallback((pack: string, entry: InventoryEntry, all = false) => {
    const targets = all ? bankSaleCopies(state.bank, state.bankbois || [], entry) : undefined;
    if (targets && !targets.length) return setActionError("No unlocked matching bank items available");
    setNpcSaleItem({
      source: "bank",
      pack,
      entry,
      targets,
      quantity: String(targets ? targets.reduce((sum, target) => sum + Number(target.entry.item.q || 1), 0) : entry.item.q || 1),
      acknowledged: false,
    });
  }, [state.bank, state.bankbois, setActionError, setNpcSaleItem]);
  const onBankDeconstruction = useCallback((pack: string, entry: InventoryEntry, all: boolean) =>
    setDeconstructionSelection({ pack, entry, all, auto: false }), []);
  const onUnlock = useCallback(async (vault: BankVault, kind: "key" | "gold") => {
    try {
      await post('/bank/unlock', { pack: vault.pack, kind });
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Bank unlock failed'); }
  }, [post, setActionError]);

  const onAutoStandBuys = useCallback(async (enabled: boolean) => {
    await post("/merchant/native-stand", { action: "configure", enabled });
  }, [post]);
  const onStandEdit = useCallback((listing: StandListing) => {
    const knownMeta = catalogAllItems.find((item) => item.id === listing.item.name)?.meta;
    const entry = { slot: listing.slot, item: listing.item, meta: knownMeta };
    const value = { defaultPrice: Math.max(1, Number(entry.meta?.definition.g) || 1) };
    setStandItem({
      id: listing.id,
      entry,
      bankPack: listing.bankPack,
      defaultPrice: value.defaultPrice,
      price: String(listing.price),
      quantity: String(listing.quantity),
      markAll: false,
    });
  }, [catalogAllItems, setStandItem]);
  const onEditBuy = useCallback((item: Item, meta?: ItemMeta | null) =>
    setWtbItem({ item, meta }), [setWtbItem]);
  const onListForWTB = useCallback((entry: InventoryEntry, bankPack: string | undefined, price: number, quantity: number) => {
    const valuedEntry = { ...entry, meta: detailMeta(entry.item, entry.meta) };
    const existing = standListings.find(
      (mark) => mark.bankPack === bankPack && mark.slot === entry.slot && same(mark.item, entry.item),
    );
    const value = { defaultPrice: Math.max(1, Number(valuedEntry.meta?.definition.g) || 1) };
    setStandItem({
      id: existing?.id,
      entry: valuedEntry,
      bankPack,
      markAll: false,
      defaultPrice: value.defaultPrice,
      price: String(price),
      quantity: String(Math.max(1, Math.min(quantity, Number(entry.item.q || 1)))),
    });
  }, [detailMeta, standListings, setStandItem]);
  const onStandInspect = useCallback((item: Item, meta: ItemMeta | null | undefined, context: string) =>
    setSelected({
      character: context,
      entry: { slot: -1, item, meta: detailMeta(item, meta) },
    }), [setSelected, detailMeta]);
  const onALDataSetup = useCallback(() => { setMarketOpen(false); setSettingsOpen(true); }, [setMarketOpen, setSettingsOpen]);

  return (
    <>
      {confirmation}
      <DeferredPanel active={bankOpen}>
        <BankSheet bankSortState={state} bankboiPrefix={state.bankboiPrefix || ""}
          open={bankOpen}
          onOpenChange={setBankOpen}
          bank={state.bank || null}
          bankbois={state.bankbois || emptyArray()}
          bankboiQueue={state.bankboiQueue || emptyArray()}
          merchant={state.merchantCharacter}
          merchantState={
            state.merchantCharacter ? state.characters[state.merchantCharacter] : undefined
          }
          vaults={state.bankVaults || emptyArray()}
          withdrawals={state.withdrawals || emptyRecord()}
          onSelect={onBankSelect}
          onWithdraw={onWithdraw}
          onWithdrawAll={onWithdrawAll}
          onCreateBankboi={onCreateBankboi}
          onDeleteBankboi={onDeleteBankboi}
          buyable={catalogBuyable}
          catalog={catalogAllItems}
          priceHistory={standPriceHistory}
          autoStandMarks={autoStandMarks}
          standListings={standListings}
      standBids={standBids}
          onUnstand={onUnstand}
          onStand={onBankStand}
          onNpcSale={onBankNpcSale}
          npcSaleMarks={state.npcSaleMarks || emptyArray()}
          deconstructionCatalog={deconstructionCatalog}
          onDeconstruction={onBankDeconstruction}
          onUnlock={onUnlock}
        />
      </DeferredPanel>
      <DeconstructionConfirmation selection={deconstructionSelection} catalog={deconstructionCatalog}
        items={catalogAllItems} onClose={() => setDeconstructionSelection(null)}
        onConfirm={async ({ pack, entry, all }) => {
          await model.post('/deconstruction/mark', { pack, slot: entry.slot, item: entry.item, all });
        }} />
      <DeferredPanel active={standOpen || marketOpen}>
        <StandSheet
          open={standOpen}
          onOpenChange={setStandOpen}
          marketOpen={marketOpen}
          onMarketOpenChange={setMarketOpen}
          merchant={state.merchantCharacter ? state.characters[state.merchantCharacter] : undefined}
          bank={state.bank}
          listings={standListings}
          catalog={catalogAllItems}
          buyable={catalogBuyable}
          bids={standBids}
          nativeStand={state.nativeStand}
          autoStandBuys={state.autoStandBuys === true}
          autoBlacklistMerchants={state.autoBlacklistMerchants !== false}
          onAutoStandBuys={onAutoStandBuys}
          priceHistory={standPriceHistory}
          blacklist={state.merchantBlacklist || emptyRecord()}
          onEdit={onStandEdit}
          onRemove={removeStandListing}
          onEditBuy={onEditBuy}
          onBid={saveStandBid}
          onListForWTB={onListForWTB}
          aldata={state.aldata}
          onALDataSetup={onALDataSetup}
          ponty={state.ponty}
          automaticWTBEnabled={state.merchantAutomations?.["stand bid purchases"] !== false}
          onBuyALData={buyALDataListing}
          onBuyPonty={buyPontyListing}
          onSellALData={sellALDataOrder}
          onInspect={onStandInspect}
        />
      </DeferredPanel>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto border-slate-700 bg-[#0b1916] text-emerald-50 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Interface settings</DialogTitle>
            <DialogDescription>
              Manage saved dashboard state, character connections, and market access.
            </DialogDescription>
          </DialogHeader>
          {state.steamSwitch?.phase === "failed" && (
            <Button type="button" variant="outline" onClick={() => void model.recoverSteamHandoff()}
              className="border-amber-700 bg-[#171007] text-amber-100 hover:bg-amber-950 hover:text-white">
              Recover Steam handoff after characters are offline
            </Button>
          )}
          {settingsOpen && <DashboardStateImport />}
          <div className="rounded border border-violet-800 bg-[#07090d] p-4 text-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-violet-100">Realm</p>
                <p
                  className={`font-mono text-[10px] uppercase ${state.realmControl?.split ? "text-rose-300" : "text-slate-400"}`}
                >
                  Current:{" "}
                  {state.realmControl?.split
                    ? "Mixed realms"
                    : state.realmControl?.realms.find(
                        (realm) => realm.key === state.realmControl?.currentRealm,
                      )?.label ||
                      state.realmControl?.currentRealm ||
                      "Unknown"}{" "}
                  · Home:{" "}
                  {state.realmControl?.realms.find(
                    (realm) => realm.key === state.realmControl?.homeRealm,
                  )?.label ||
                    state.realmControl?.homeRealm ||
                    "Unknown"}
                </p>
              </div>
              {state.realmControl?.operation &&
              !["complete", "failed"].includes(state.realmControl.operation.phase) ? (
                <RefreshCw className="h-4 w-4 animate-spin text-violet-300" />
              ) : null}
            </div>
            {state.realmControl?.split ? (
              <div className="mt-3 grid gap-1 rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-100">
                {state.realmControl.characters.map((member) => (
                  <span key={member.name}>
                    {member.name}: {member.realm || "offline"}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-4 flex gap-2">
              <Select
                value={realmDestination}
                onValueChange={(value) => {
                  if (value) setRealmDestination(value);
                  setRealmSetHome(false);
                }}
              >
                <SelectTrigger
                  aria-label="Change realm"
                  className="border-violet-600 bg-black text-violet-50 hover:border-violet-400"
                >
                  <SelectValue placeholder="Change realm…" />
                </SelectTrigger>
                <SelectContent className="border-violet-700 bg-[#07090d] text-violet-50">
                  {(state.realmControl?.realms || []).map((realm) => (
                    <SelectItem
                      key={realm.key}
                      value={realm.key}
                      disabled={realm.pvp}
                      className="focus:bg-violet-950 focus:text-white disabled:text-slate-600"
                    >
                      {realm.label} ({realm.players.toLocaleString()} players)
                      {realm.pvp ? " — disabled" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={
                  !realmDestination ||
                  (!state.realmControl?.split &&
                    realmDestination === state.realmControl?.currentRealm) ||
                  Boolean(
                    state.realmControl?.operation &&
                    !["complete", "failed"].includes(state.realmControl.operation.phase),
                  )
                }
                onClick={() => setRealmConfirmOpen(true)}
                className="shrink-0 border-violet-500 bg-black text-violet-100 hover:bg-violet-950 hover:text-white"
              >
                Change realm
              </Button>
            </div>
            {state.realmControl?.operation ? (
              <div
                className={`mt-3 rounded border p-2 text-xs ${state.realmControl.operation.phase === "failed" ? "border-rose-700 bg-rose-950/40 text-rose-200" : state.realmControl.operation.phase === "complete" ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-violet-700 bg-violet-950/30 text-violet-100"}`}
              >
                <p className="font-semibold capitalize">
                  {state.realmControl.operation.phase.replace(/-/g, " ")}
                </p>
                {state.realmControl.operation.error ? (
                  <p>{state.realmControl.operation.error}</p>
                ) : null}
                {(state.realmControl.operation.characters || []).map((member) => (
                  <p key={member.name}>
                    {member.name}: {member.realm || "waiting"}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <div className="rounded border border-cyan-900/70 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Characters</p>
                <p className="font-mono text-[10px] uppercase text-slate-400">
                  Create and add characters to your account roster.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSettingsOpen(false);
                  setCreateOpen(true);
                }}
                className="border-cyan-600 bg-black text-cyan-100 hover:bg-cyan-950 hover:text-white"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Create character
              </Button>
            </div>
            <AccountSettings state={state} />
          </div>
          <div className="rounded border border-slate-800 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">ALData</p>
                {model.aldataAuthPending ? <output className="block text-sm text-amber-200">Waiting for mail delivery and ALData verification… Do not resend; each message costs gold.</output> : null}
                <p className="font-mono text-[10px] uppercase text-slate-400">
                  Auth: {model.aldataAuthStatus ?? state.aldata?.auth ?? "NO"} · Publish:{" "}
                  {state.aldata?.publishStatus || "idle"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={aldataBusy}
                onClick={() => void aldataAction("check")}
                className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
              >
                Check status
              </Button>
            </div>
            <div className="mt-4 flex gap-2">
              <Input
                readOnly
                type={aldataKeyVisible ? "text" : "password"}
                value={aldataKey}
                placeholder={
                  state.aldata?.hasKey ? "Stored key — reveal to view" : "No key generated"
                }
                className="border-slate-800 bg-black/40 font-mono text-xs"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  if (!aldataKey) void aldataAction("reveal");
                  setALDataKeyVisible((value) => !value);
                }}
                aria-label="Reveal key"
                className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
              >
                {aldataKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="outline"
                disabled={!aldataKey}
                onClick={() => void navigator.clipboard.writeText(aldataKey)}
                aria-label="Copy key"
                className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button
                disabled={aldataBusy}
                onClick={() => void aldataAction("generate")}
                className="bg-slate-700 text-white hover:bg-slate-600"
              >
                Generate key
              </Button>
              <Button
                disabled={aldataBusy || !state.aldata?.hasKey}
                onClick={() => void aldataAction("send")}
                className="bg-violet-700 text-white hover:bg-violet-600"
              >
                Prepare mail
              </Button>

            </div>
            <p className="mt-3 text-xs text-slate-400">
              Public market browsing needs no key or separate ALData server. Publishing requires
              authentication: generate a unique key. Prepare mail opens a prefilled authentication mail. Review the postage and click Send; your merchant will send it.
              ALData stores this key in plaintext; never reuse a password. Allow about a minute,
              then check status.
            </p>
            {state.aldata?.error ? (
              <p className="mt-2 text-xs text-rose-300">{state.aldata.error}</p>
            ) : null}
          </div>
          <HostingSettings />
          <ConsoleUpdateSettings />
        </DialogContent>
      </Dialog>
      <Dialog
        open={realmConfirmOpen}
        onOpenChange={(open) => {
          if (!realmBusy) setRealmConfirmOpen(open);
        }}
      >
        <DialogContent className="border-violet-700 bg-[#080b10] text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Switch realm?</DialogTitle>
            <DialogDescription className="text-slate-300">
              This switches every active party character to{" "}
              {state.realmControl?.realms.find((realm) => realm.key === realmDestination)?.label ||
                realmDestination}{" "}
              and gives non-merchant characters Realm Fatigue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
            <p>
              <strong>Realm Fatigue:</strong> approximately 30 minutes. Home-realm rewards are
              paused; ordinary rewards continue.
            </p>
            {realmDestination !== state.realmControl?.homeRealm ? (
              <p>
                <strong>Outside your home realm:</strong> Hop Sickness applies −80 Luck, Gold, and
                XP, plus −20% output, until you return home or change your home realm through Bean.
              </p>
            ) : (
              <p>This destination is already your home realm, so Hop Sickness should not apply.</p>
            )}
          </div>
          {realmDestination !== state.realmControl?.homeRealm ? (
            <label className="flex items-start gap-3 rounded border border-violet-700 bg-black p-3 text-sm text-violet-100">
              <Checkbox
                checked={realmSetHome}
                onCheckedChange={(checked) => setRealmSetHome(checked === true)}
                className="border-violet-400 bg-black data-checked:bg-violet-700"
              />
              <span>
                <strong>Set as home realm</strong>
                <br />
                <span className="text-xs text-slate-300">
                  After switching, one non-merchant will visit Bean in Main and request the home
                  change. Current game data exposes no separate home-change cooldown.
                </span>
              </span>
            </label>
          ) : null}
          {model.realmError && <p role="alert" className="text-sm text-rose-200">{model.realmError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={realmBusy}
              onClick={() => setRealmConfirmOpen(false)}
              className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={realmBusy}
              onClick={() => void switchRealm()}
              className="bg-violet-600 text-white hover:bg-violet-500"
            >
              {realmBusy ? "Starting…" : "Switch all characters"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
