'use client';
import { ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@/components/ui/context-menu';
import { ArrowRightLeft, Blender, DollarSign, Landmark, Store } from 'lucide-react';
import { AutoActionIcon } from './auto-action-icon';
import { UpgradeActions } from './upgrade-actions';
import { itemMaximumLevel } from './item-maximum-level';
import { compoundPassCost } from '@/lib/compound-cost';
import type { InventoryEntry } from './inventory-entry';

export interface AutomaticItemActionsProps {
  section?: 'bank' | 'stand' | 'exchange' | 'upgrade' | 'compound' | 'npc';
  entry: InventoryEntry;
  bank: boolean;
  stand?: boolean;
  npc?: boolean;
  exchange?: boolean;
  exchangeable: boolean;
  merchant: boolean;
  upgradeTiers: number;
  compoundTier?: number;
  buyable: { id: string; cost: number }[];
  onCommand: (type: 'auto-item-mark' | 'auto-exchange' | 'auto-upgrade-mark' | 'auto-compound-mark', extra: Record<string, unknown>) => void;
  onStand: () => void;
  onNpc: () => void;
}

/** Shared automatic actions for physical inventory and prospective exchange rewards. */
export function AutomaticItemActions({ section, entry, bank, stand, npc, exchange, exchangeable, merchant, upgradeTiers, compoundTier, buyable, onCommand, onStand, onNpc }: AutomaticItemActionsProps) {
  const show = (action: AutomaticItemActionsProps['section']) => !section || section === action;
  const level = Number(entry.item.level) || 0;
  const max = Math.min(7, itemMaximumLevel(entry.meta));
  return <>
    {show('bank') && <ContextMenuItem disabled={bank} onClick={() => onCommand('auto-item-mark', { mode: 'bank' })}>
      <AutoActionIcon><Landmark /></AutoActionIcon>Auto mark for bank
    </ContextMenuItem>}
    {show('stand') && merchant && <ContextMenuItem onClick={onStand}>
      <AutoActionIcon><Store /></AutoActionIcon>{stand ? 'Update auto mark for stand…' : 'Auto mark for stand…'}
    </ContextMenuItem>}
    {show('exchange') && exchangeable && <ContextMenuItem disabled={exchange} onClick={() => onCommand('auto-exchange', { slot: entry.slot })}>
      <AutoActionIcon><ArrowRightLeft /></AutoActionIcon>Auto exchange
    </ContextMenuItem>}
    {show('upgrade') && <UpgradeActions item={entry.item} meta={entry.meta} autoTiers={upgradeTiers} automaticOnly
      onMark={() => {}} onBuy={() => {}} onAutoMark={tiers => onCommand('auto-upgrade-mark', { slot: entry.slot, tiers })} />}
    {show('compound') && entry.meta?.compoundable && level < max && <ContextMenuSub>
      <ContextMenuSubTrigger><AutoActionIcon><Blender /></AutoActionIcon>{compoundTier ? `Auto compound to +${compoundTier}` : 'Auto compound'}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {Array.from({ length: max - level }, (_, index) => level + index + 1).map(tier => {
          const cost = compoundPassCost(entry.meta?.definition.grades as number[] | undefined, tier, buyable);
          return <ContextMenuItem key={tier} onClick={() => onCommand('auto-compound-mark', { targetTier: tier })}>
            <span>+{tier}</span><span className="ml-auto pl-5 font-mono text-black">{cost ? `${cost.gold.toLocaleString()}g` : 'Price unavailable'}</span>
          </ContextMenuItem>;
        })}
      </ContextMenuSubContent>
    </ContextMenuSub>}
    {show('npc') && <ContextMenuItem onClick={onNpc}><AutoActionIcon><DollarSign /></AutoActionIcon>{npc ? 'Update auto sell to NPC…' : 'Auto sell to NPC…'}</ContextMenuItem>}
  </>;
}
