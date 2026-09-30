"use client";
import { lazy } from "react";
import { DeferredPanel } from "./deferred-panel";
const ItemDetails = lazy(() =>
  import("./item-details").then((module) => ({ default: module.ItemDetails })),
);
import { standIsFull } from "./stand-capacity";
import { same } from "./same";
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
import { ExchangeRewardTile } from './exchange-reward-tile';
import { UpgradeOfferingProvider } from './upgrade-offering-controls';
export function PartyItemDetails({ model }: { model: PartyConsoleModel }) {
  return model.selected ? <PartyItemDetailsConnected base={model} /> : null;
}
function PartyItemDetailsConnected({ base }: { base: PartyConsoleModel }) {
  const model = usePanelModel(base, { inventory: true, vitals: true, bank: true, market: true });
  const {
    state,
    chars,
    setActionError,
    setStandItem,
    setSelected,
    setGearComparison,
    selected,
    monsterAchievements,
    setMonsterNavigateTarget,
    setWtbItem,
  } = model;
  return (
    <DeferredPanel active={!!selected}>
      <UpgradeOfferingProvider character={String(state.merchantCharacter)} executor={state.merchantCharacter} stock={state.upgradeOfferingStock || {}} rules={state.upgradeOfferingRules || []} catalog={state.merchantCatalog?.allItems || []} post={model.post}>
      <ItemDetails
        renderExchangeReward={reward => <ExchangeRewardTile reward={reward} model={model} />}
        selected={selected}
        catalog={state.merchantCatalog?.allItems || []}
        exchanges={state.merchantCatalog?.exchangeable || []}
        monsters={state.bestiaryCatalog || []}
        characters={chars}
        achievements={monsterAchievements}
        standFull={standIsFull(state.standListings || [], state.standBids || {})}
        onNavigate={(monster) => setMonsterNavigateTarget(monster)}
        onAddWTB={(item, meta) => setWtbItem({ item, meta })}
        onAddStand={(entry, source) => {
          const value = { defaultPrice: Math.max(1, Number(entry.meta?.definition.g) || 1) };
          const bankPack = source.kind === "bank" ? source.pack : undefined;
          const existing = (state.standListings || []).find((mark) =>
            bankPack
              ? mark.bankPack === bankPack &&
                mark.bankSlot === entry.slot &&
                same(mark.item, entry.item)
              : !mark.bankPack && mark.slot === entry.slot && same(mark.item, entry.item),
          );
          if (!existing && (state.standListings || []).length >= 16)
            return setActionError("Merchant stand is full (16/16)");
          setStandItem({
            id: existing?.id,
            entry,
            bankPack,
            defaultPrice: value.defaultPrice,
            markAll: false,
            price: String(existing?.price || value.defaultPrice),
            quantity: String(existing?.quantity || entry.item.q || 1),
          });
        }}
        onCompare={(character, entry, slot) => {
          setSelected(null);
          setGearComparison({ character, entry, slot });
        }}
        onCompareCatalog={(entry) => {
          setSelected(null);
          model.setCatalogComparison(entry);
          model.setCatalogOpen(true);
        }}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
      </UpgradeOfferingProvider>
    </DeferredPanel>
  );
}
