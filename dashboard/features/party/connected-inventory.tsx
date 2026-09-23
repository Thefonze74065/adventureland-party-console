'use client';
import { UpgradeOfferingProvider } from './upgrade-offering-controls';
import { SharedRuleConflicts } from './shared-rule-conflicts';
import { MerchantPendingImprovements } from './merchant-pending-improvements';
import { automaticCommerceRuleKey } from './automatic-commerce-rule-key';
import { InventoryPanel } from './inventory-panel';
import { aggregateSlotTracking } from '../../../runtime/lucky-slot-tracking';
import { LuckySlotDialog } from './lucky-slot-tracker';
import { same } from './same';
import type { InventoryModel } from './character-card-model';
import type { InventoryEntry } from './inventory-entry';
import type { Item } from './item';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { DeconstructionConfirmation, type DeconstructionSelection } from './deconstruction-confirmation';
import { committedLiveRecord } from './live-metrics';
import { usePanelModel } from './use-panel-model';
import { emptyArray, emptyRecord } from './empty-values';
export const ConnectedInventory = memo(function ConnectedInventory({
  name,
  model: base,
}: {
  name: string;
  model: InventoryModel;
}) {
  const model = usePanelModel(base, { inventory: true });
  const {
    state,
    chars,
    command,
    setActionError,
    setStandItem,
    setNpcSaleItem,
    setAutoNpcSaleItem,
    clearAutomaticSales,
    removeAutomaticSale,
    statScrollInventory,
    setSelected,
    detailMeta,
    setGearComparison,
    sendCharacter,
    post,
  } = model;
  const char = state.characters[name];
  useEffect(() => {
    committedLiveRecord(name, 'inventory');
  }, [name, char?.items, char?.slots]);
  const ruleName = state.merchantRules ? String(state.merchantCharacter) : name;
  const marked = state.marked[name] || emptyArray();
  const [deconstructionSelection, setDeconstructionSelection] = useState<DeconstructionSelection | null>(null);
  const [luckySlotOpen, setLuckySlotOpen] = useState(false);
  const luckyTracking = useMemo(
    () => aggregateSlotTracking(state.luckySlotTracking?.[name], char?.luckySlotTracking),
    [state.luckySlotTracking, name, char?.luckySlotTracking],
  );
  const onLuckySlot = useCallback(() => setLuckySlotOpen(true), []);
  const deconstructionMarks = state.deconstructionMarks || emptyArray();
  const standListings = state.standListings || emptyArray();
  const npcSaleMarks = state.npcSaleMarks || emptyArray();
  const onDeconstruction = useCallback(
    (entry: InventoryEntry, auto: boolean, remove: boolean, id?: string) => {
      if (!remove) { setDeconstructionSelection({ entry, auto }); return; }
      void post(auto ? '/deconstruction/auto' : '/deconstruction/mark', {
        character: id ? deconstructionMarks.find(mark => mark.id === id)?.owner || name : name, slot: entry.slot, item: entry.item, remove, id,
      });
    },
    [post, deconstructionMarks, name],
  );
  const onRetryDeconstruction = useCallback(
    (id: string) => void post('/deconstruction/mark', { character: deconstructionMarks.find(mark => mark.id === id)?.owner || name, id, retry: true }),
    [post, deconstructionMarks, name],
  );
  const onRemoveNpcSale = useCallback(
    (id: string) => void post('/merchant/npc-sale', { character: npcSaleMarks.find(mark => mark.id === id)?.character || name, id, remove: true }),
    [post, npcSaleMarks, name],
  );
  const onStand = useCallback(
    (entry: InventoryEntry) => {
      const existing = standListings.find(
        (mark) => mark.slot === entry.slot && same(mark.item, entry.item),
      );
      if (!existing && standListings.length >= 16)
        return setActionError('Merchant stand is full (16/16)');
      const value = { defaultPrice: Math.max(1, Number(entry.meta?.definition.g) || 1) };
      setStandItem({
        entry,
        defaultPrice: value.defaultPrice,
        markAll: false,
        price: String(existing?.price || value.defaultPrice),
        quantity: String(existing?.quantity || entry.item.q || 1),
      });
    },
    [standListings, setActionError, setStandItem],
  );
  const onNpcSale = useCallback(
    (entry: InventoryEntry) =>
      setNpcSaleItem({
        source: name === state.merchantCharacter ? 'merchant' : 'character',
        character: name === state.merchantCharacter ? undefined : name,
        entry,
        quantity: String(entry.item.q || 1),
        acknowledged: false,
      }),
    [name, state.merchantCharacter, setNpcSaleItem],
  );
  const onAutoNpcSale = useCallback(
    (entry: InventoryEntry) => setAutoNpcSaleItem({ ...entry,
      character: name === state.merchantCharacter ? undefined : name }),
    [name, state.merchantCharacter, setAutoNpcSaleItem],
  );
  const onAutoStand = useCallback(
    (entry: InventoryEntry) => {
      const value = { defaultPrice: Math.max(1, Number(entry.meta?.definition.g) || 1) };
      const existing = state.autoStandMarks?.[automaticCommerceRuleKey(entry.item)];
      setStandItem({
        entry,
        defaultPrice: value.defaultPrice,
        markAll: false,
        auto: true,
        price: String(existing?.price || value.defaultPrice),
        quantity: String(entry.item.q || 1),
      });
    },
    [state.autoStandMarks, setStandItem],
  );
  const onClearAutomaticSales = useCallback(
    (kind: 'npc' | 'stand') => {
      if (kind === 'npc' && name !== state.merchantCharacter)
        void post('/merchant/auto-npc-sale', { character: name, action: 'clear-all' });
      else void clearAutomaticSales(kind);
    },
    [name, state.merchantCharacter, post, clearAutomaticSales],
  );
  const onRemoveAutomaticSale = useCallback(
    (kind: 'npc' | 'stand', item: Item) =>
      kind === 'npc' && name !== state.merchantCharacter
        ? void post('/merchant/auto-npc-sale', { character: name, item, action: 'remove' })
        : void removeAutomaticSale(kind, item),
    [name, state.merchantCharacter, post, removeAutomaticSale],
  );
  const onSelect = useCallback(
    (entry: InventoryEntry) =>
      setSelected({
        character: name,
        entry: {
          ...entry,
          meta: detailMeta(entry.item, entry.meta),
        },
        ...(name === state.merchantCharacter
          ? { source: { kind: 'merchant' as const } }
          : {}),
      }),
    [name, state.merchantCharacter, detailMeta, setSelected],
  );
  const onCompare = useCallback(
    (entry: InventoryEntry, slot?: string) =>
      setGearComparison({
        character: char,
        slot,
        entry: {
          ...entry,
          meta: detailMeta(entry.item, entry.meta),
        },
      }),
    [char, detailMeta, setGearComparison],
  );
  const onTravel = useCallback(() => sendCharacter(name), [sendCharacter, name]);
  // Presence and inventory arrive independently, including after reconnects.
  // Missing inventory is still loading, not an empty bag.
  if (!char || !Array.isArray(char.items) || !char.slots) {
    return <output className="block border-t border-emerald-900/70 bg-[#0b1916] p-5 text-emerald-100">Loading inventory…</output>;
  }
  return (
    <UpgradeOfferingProvider character={char.name} executor={state.merchantCharacter} stock={state.upgradeOfferingStock || emptyRecord()} rules={state.upgradeOfferingRules || emptyArray()} catalog={state.merchantCatalog?.allItems || emptyArray()} post={post}>
    <InventoryPanel
      character={char}
      sharedRules={!!state.merchantRules}
      characters={chars}
      leader={state.leader}
      merchant={state.merchantCharacter}
      merchantWeapon={state.merchantWeapon}
      luckyUpgradeSlot={state.luckyUpgradeSlots?.[name]}
      luckySlotTracking={luckyTracking}
      onLuckySlot={onLuckySlot}
      marked={marked}
      merchantMarked={state.merchantMarked?.[char.name] || emptyArray()}
      autoItemMarks={state.autoItemMarks?.[ruleName] || emptyRecord()}
      autoUpgradeMarks={state.autoUpgradeMarks?.[ruleName] || emptyRecord()}
      allAutoUpgradeMarks={state.autoUpgradeMarks || emptyRecord()}
      merchantDeliveries={state.merchantDeliveries || emptyRecord()}
      standListings={standListings}
      standBids={state.standBids || emptyRecord()}
      autoNpcSales={state.autoNpcSales || emptyRecord()}
      npcSaleMarks={npcSaleMarks}
      deconstructionMarks={deconstructionMarks}
      autoDeconstruction={state.autoDeconstruction?.[ruleName] || emptyRecord()}
      deconstructionCatalog={state.deconstructionCatalog || emptyRecord()}
      onDeconstruction={onDeconstruction}
      onRetryDeconstruction={onRetryDeconstruction}
      onRemoveNpcSale={onRemoveNpcSale}
      autoStandMarks={state.autoStandMarks || emptyRecord()}
      buyable={state.merchantCatalog?.buyable || emptyArray()}
      catalog={state.merchantCatalog?.allItems || emptyArray()}
      priceHistory={state.standPriceHistory || emptyRecord()}
      onStand={onStand}
      onNpcSale={onNpcSale}
      onAutoNpcSale={onAutoNpcSale}
      onAutoStand={onAutoStand}
      onClearAutomaticSales={onClearAutomaticSales}
      onRemoveAutomaticSale={onRemoveAutomaticSale}
      upgradeMarks={state.upgrades?.[char.name] || emptyArray()}
      statScrollMarks={state.statScrolls?.[char.name] || emptyArray()}
      statScrollInventory={statScrollInventory}
      compoundGroups={state.compounds?.[char.name] || emptyArray()}
      autoCompoundMarks={state.autoCompounds?.[ruleName] || emptyArray()}
      allAutoCompoundMarks={state.autoCompounds || emptyRecord()}
      autoExchanges={state.autoExchanges || emptyRecord()}
      onSelect={onSelect}
      onCompare={onCompare}
      onCommand={command}
      onTravel={onTravel}
    />
    <LuckySlotDialog character={name} tracking={luckyTracking} verified={state.luckyUpgradeSlots?.[name]} open={luckySlotOpen} onOpenChange={setLuckySlotOpen} />
    {char.name === state.merchantCharacter && <><MerchantPendingImprovements state={state} /><SharedRuleConflicts state={state} onResolve={(id, owner) => post("/merchant/rule-conflict", {id,owner})} /></>}
    <DeconstructionConfirmation selection={deconstructionSelection} catalog={state.deconstructionCatalog || emptyRecord()}
      items={state.merchantCatalog?.allItems || emptyArray()} onClose={() => setDeconstructionSelection(null)}
      onConfirm={async ({ entry, auto }) => {
        await post(auto ? '/deconstruction/auto' : '/deconstruction/mark', { character: char.name, slot: entry.slot, item: entry.item });
      }} />
    </UpgradeOfferingProvider>
  );
});
