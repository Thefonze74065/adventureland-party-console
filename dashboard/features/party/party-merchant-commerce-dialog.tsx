"use client";
import { lazy } from "react";
import { DeferredPanel } from "./deferred-panel";
const MerchantCommerceDialog = lazy(() =>
  import("./merchant-commerce-dialog").then((module) => ({
    default: module.MerchantCommerceDialog,
  })),
);
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
import { automaticCommerceRuleKey } from './automatic-commerce-rule-key';
import { ExchangeRewardTile } from './exchange-reward-tile';
import { UpgradeOfferingProvider } from './upgrade-offering-controls';
export function PartyMerchantCommerceDialog({ model }: { model: PartyConsoleModel }) {
  return model.commerceMode ? <PartyMerchantCommerceDialogConnected base={model} /> : null;
}
function PartyMerchantCommerceDialogConnected({ base }: { base: PartyConsoleModel }) {
  const model = usePanelModel(base, { inventory: true, bank: true });
  const { state, chars, setCommerceMode, setSelected, commerceMode, submitMerchantOrder } = model;
  return (
    <DeferredPanel active={!!commerceMode}>
      <UpgradeOfferingProvider character={String(state.merchantCharacter)} executor={state.merchantCharacter} stock={state.upgradeOfferingStock || {}} rules={state.upgradeOfferingRules || []} catalog={state.merchantCatalog?.allItems || []} post={model.post}>
      <MerchantCommerceDialog
        renderExchangeReward={reward => <ExchangeRewardTile reward={reward} model={model} />}
        onSaveExchangeMarks={async drafts => {
          const character = state.merchantCharacter;
          if (!character) throw new Error('No merchant is assigned');
          for (const draft of drafts) {
            const item = { name: draft.id, level: draft.level };
            if (draft.mode.action === 'bank') await model.post('/command', { character, type: 'auto-item-mark', item, mode: 'bank', action: 'set' });
            else if (draft.mode.action === 'upgrade') await model.post('/command', { character, type: 'auto-upgrade-mark', item, slot: -1, tiers: Number(draft.mode.targetLevel) - draft.level });
            else if (draft.mode.action === 'npc') await model.post('/merchant/auto-npc-sale', { item });
            else {
              const meta = state.merchantCatalog?.allItems?.find(entry => entry.id === draft.id)?.meta;
              const price = state.autoStandMarks?.[automaticCommerceRuleKey(item)]?.price || Math.max(1, Number(meta?.definition.g) || 1);
              await model.post('/merchant/auto-stand', { item, price });
            }
          }
        }}
        mode={commerceMode}
        onClose={() => setCommerceMode(null)}
        catalog={
          state.merchantCatalog || {
            allItems: [],
            buyable: [],
            craftable: [],
            exchangeable: [],
          }
        }
        characters={chars}
        bank={state.bank || null}
        bankbois={state.bankbois || []}
        onInspect={(item, meta, exchangeAdd) =>
          setSelected({
            character:
              commerceMode === "craft"
                ? "Crafting catalog"
                : commerceMode === "exchange"
                  ? "Exchange catalog"
                  : "Merchant catalog",
            entry: { slot: -1, item: { name: item.id }, meta },
            exchangeAdd: exchangeAdd ? { enabled: exchangeAdd.enabled, onAdd: () => { exchangeAdd.onAdd(); setSelected(null); } } : undefined,
          })
        }
        onSubmit={submitMerchantOrder}
      />
      </UpgradeOfferingProvider>
    </DeferredPanel>
  );
}
