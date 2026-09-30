'use client';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import { AutomaticItemActions } from './automatic-item-actions';
import { automaticCommerceRuleKey } from './automatic-commerce-rule-key';
import { upgradeRuleTiers } from './upgrade-rule-tiers';
import { upgradeRuleQuantity } from './upgrade-rule-quantity';
import { itemActionBanner } from './item-action-banner';
import { ItemSprite } from './item-sprite';
import type { Sprite } from './sprite';
import type { PartyConsoleModel } from './use-party-console';
import { itemMaximumLevel } from './item-maximum-level';
import type { ExchangeMarkMode } from './exchange-mark-controls';

export interface ExchangeRewardTileData {
  id: string; level: number; name: string; quantity: number; sprite?: Sprite | null; detail: string;
  onInspect: () => void; kind?: string;
  marking?: boolean; markMode?: ExchangeMarkMode | null;
  stagedMode?: ExchangeMarkMode; saving?: boolean;
  onStage?: (reward: ExchangeRewardTileData, mode: ExchangeMarkMode) => void;
}
export function ExchangeRewardTile({ reward, model }: { reward: ExchangeRewardTileData; model: PartyConsoleModel }) {
  const { state } = model, merchant = state.merchantCharacter;
  const passive = !!reward.kind && ['empty', 'gold', 'shells', 'cx', 'cxbundle', 'open'].includes(reward.kind);
  const name = reward.kind === 'empty' ? 'No reward' : reward.name;
  const sprite = reward.kind === 'gold' || reward.kind === 'empty'
    ? { url: `/images/exchange/${reward.kind === 'gold' ? 'gold-coins' : 'no-reward'}.png`, tileSize: 1, columns: 1, rows: 1, x: 0, y: 0 }
    : reward.sprite;
  const item = { name: reward.id, level: reward.level };
  const entry = { slot: -1, item, meta: state.merchantCatalog?.allItems?.find(candidate => candidate.id === reward.id)?.meta };
  const key = `${item.name}@+${item.level}`, commerce = automaticCommerceRuleKey(item);
  const bank = state.autoItemMarks?.[String(merchant)]?.[key] || (!item.level ? state.autoItemMarks?.[String(merchant)]?.[item.name] : undefined);
  const upgradeTiers = upgradeRuleTiers(state.autoUpgradeMarks?.[String(merchant)]?.[key]);
  const upgradePending = !!upgradeTiers && upgradeRuleQuantity(state.autoUpgradeMarks?.[String(merchant)]?.[key]) !== 0;
  const compound = state.autoCompounds?.[String(merchant)]?.find(rule => rule.name === item.name);
  const npc = !!state.autoNpcSales?.[commerce], stand = !!state.autoStandMarks?.[commerce];
  const exchange = !!state.autoExchanges?.[`${item.name}@${item.level}`];
  const bulkUnsupported = reward.markMode?.action === 'upgrade' && (!entry.meta?.upgradeable ||
    Number(reward.markMode.targetLevel) <= item.level || Number(reward.markMode.targetLevel) > itemMaximumLevel(entry.meta));
  function clicked() {
    if (!reward.marking) return reward.onInspect();
    if (reward.markMode && merchant && !passive && !bulkUnsupported)
      reward.onStage?.(reward, reward.markMode);
  }
  const staged = reward.stagedMode;
  const stagedBanner = staged && { action: staged.action, automatic: true, label:
    staged.action === 'bank' ? 'Auto bank' : staged.action === 'stand' ? 'Auto stand' : staged.action === 'npc' ? 'Auto sell to NPC' : `Auto upgrade → +${staged.targetLevel}` };
  const banner = itemActionBanner(stagedBanner ? [stagedBanner] : [
    exchange && { action: 'exchange', automatic: true, label: 'Auto exchange' },
    npc && { action: 'npc', automatic: true, label: 'Auto sell to NPC' },
    stand && { action: 'stand', automatic: true, label: 'Auto stand' },
    upgradePending && { action: 'upgrade', automatic: true, label: `Auto upgrade → +${item.level + upgradeTiers}` },
    !!compound && compound.quantity !== 0 && item.level < compound.targetTier && { action: 'compound', automatic: true, label: `Auto compound → +${compound.targetTier}` },
    !!state.autoDeconstruction?.[String(merchant)]?.[commerce] && { action: 'deconstruction', automatic: true, label: 'Auto deconstruction' },
    { action: 'bank', label: bank === 'bank' ? 'Auto bank' : 'Auto bank (default)' },
  ], true)!;
  return <ContextMenu>
    <ContextMenuTrigger render={<button type="button" disabled={passive || reward.saving || !!reward.marking && (!reward.markMode || bulkUnsupported)} aria-label={`Exchange reward: ${reward.id} +${reward.level}`} />} onClick={clicked}
        title={`${name}${reward.level ? ` +${reward.level}` : ''}${passive ? '' : ` · ${banner.label}`}`}
        className="flex h-full w-28 flex-col items-center gap-1 rounded border border-slate-700 bg-slate-950 p-2 text-center text-white hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-default disabled:opacity-60">
        <span className={`relative h-14 w-14 shrink-0 overflow-hidden rounded border bg-black p-1 ${passive ? 'border-slate-600' : banner.border}`}>
          <span className="absolute inset-1">{sprite && <ItemSprite sprite={sprite} />}</span>
          {!passive && <span className={`absolute inset-x-0 top-0 z-10 px-0.5 text-center text-[9px] leading-tight ${banner.colors}`}>{banner.label}</span>}
          {reward.quantity > 1 && <span className="absolute bottom-0 right-0 bg-black px-0.5 text-[9px] text-white">×{reward.quantity.toLocaleString()}</span>}
        </span>
        {reward.marking && <span className="h-3 text-[9px] leading-tight text-sky-300">{staged ? 'Pending' : ''}</span>}
        <span className="font-mono text-[10px] leading-tight text-amber-300">{reward.detail}</span>
        <span className="w-full whitespace-normal break-words text-xs leading-tight text-slate-200">{name}{reward.level ? ` +${reward.level}` : ''}</span>
    </ContextMenuTrigger>
    <ContextMenuContent>
      {merchant && !passive && !reward.marking && <AutomaticItemActions entry={entry} bank={bank === 'bank'} npc={npc} stand={stand} exchange={exchange}
        merchant upgradeTiers={upgradeTiers} compoundTier={compound?.targetTier} buyable={state.merchantCatalog?.buyable || []}
        exchangeable={!!state.merchantCatalog?.exchangeable?.some(choice => !choice.reward && choice.id === item.name && choice.level === item.level)}
        onCommand={(type, extra) => model.command(merchant, type, item, extra)}
        onNpc={() => model.setAutoNpcSaleItem(entry)}
        onStand={() => {
          const price = state.autoStandMarks?.[commerce]?.price || Math.max(1, Number(entry.meta?.definition.g) || 1);
          model.setStandItem({ entry, defaultPrice: price, markAll: false, auto: true, price: String(price), quantity: '1' });
        }} />}
    </ContextMenuContent>
  </ContextMenu>;
}
