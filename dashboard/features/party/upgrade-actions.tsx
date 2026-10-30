"use client";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useUpgradeOfferings, type OfferingSource } from './upgrade-offering-controls';
import { upgradeOfferings, resolveUpgradeOffering, type UpgradeOffering } from '../../../runtime/upgrade-offerings';
import { SpriteCrop } from './sprite-crop';
import { useState } from "react";
import { UpgradePreviewPanel } from "./upgrade-preview-panel";
import { ArrowUp } from "lucide-react";
import { AutoActionIcon } from './auto-action-icon';
import { Item } from "./item";
import { itemMaximumLevel } from "./item-maximum-level";
import { ItemMeta } from "./item-meta";
import { UpgradeMark } from "./upgrade-mark";
import { upgradeScrollCost } from "./upgrade-scroll-cost";

export function UpgradeActions({
  item,
  meta,
  mark,
  onMark,
  onBuy,
  autoTiers,
  onAutoMark,
  allowBuy = false,
  offeringSource,
  automaticOnly = false,
  showAutomatic = true,
}: {
  automaticOnly?: boolean;
  showAutomatic?: boolean;
  item: Item;
  meta?: ItemMeta | null;
  mark?: UpgradeMark;
  onMark: (tiers?: number, remove?: boolean) => void;
  onBuy: () => void;
  autoTiers?: number;
  onAutoMark: (tiers?: number, remove?: boolean) => void;
  allowBuy?: boolean;
  offeringSource?: OfferingSource;
}) {
  const offerings = useUpgradeOfferings();
  const [previewOpen, setPreviewOpen] = useState(false);
  const menuColors = "border-slate-300 !bg-white !text-black [&_[role=menuitem]]:!text-black [&_[role=menuitem]]:focus:!bg-slate-100 [&_[role=menuitem]]:data-highlighted:!bg-slate-100 [&_[role=menuitem][data-disabled]]:!text-slate-400";
  const level = item.level || 0,
    max = Math.max(0, itemMaximumLevel(meta) - level);
  function destinationOffering(tiers: number) {
    const step = level + tiers - 1;
    const rule = resolveUpgradeOffering(offerings?.rules || [], item.name, step);
    if (!rule) return null;
    const sprite = offerings?.catalog.find(entry => entry.id === rule.offering)?.sprite;
    const name = upgradeOfferings[rule.offering];
    return <span className="inline-flex items-center gap-1" title={`+${step} → +${step+1}: ${name} (${rule.required ? 'required' : 'optional'})`}>
      {!rule.required && '('}<span role="img" aria-label={name} className="relative inline-block h-5 w-5 overflow-hidden">{sprite && <SpriteCrop sprite={sprite} size={20}/>}</span>{!rule.required && ')'}
    </span>;
  }
  return (
    <>
      {!automaticOnly && meta?.upgradeable && max > 0 ? (
        <ContextMenuSub open={previewOpen} onOpenChange={setPreviewOpen}>
          <ContextMenuSubTrigger className="!bg-white !text-black focus:!bg-slate-100 data-open:!bg-slate-100">
            <ArrowUp className="mr-2 h-4 w-4" />
            Mark for upgrade
            {mark ? ` · ${mark.tiers || 1} tier${(mark.tiers || 1) === 1 ? "" : "s"}` : ""}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className={menuColors + " max-w-[calc(100vw-1rem)]"}>
            <div className="flex flex-col sm:flex-row"><div className="min-w-0 flex-1">
            {Array.from({ length: max }, (_, index) => index + 1).map((tiers) => (
              <ContextMenuItem key={tiers} onClick={() => onMark(tiers)}>
                <span>
                  +{level} → +{level + tiers} {destinationOffering(tiers)}
                </span>
                <span title="Scroll cost" className="ml-auto pl-5 font-mono text-black">
                  {upgradeScrollCost(meta, level, tiers).toLocaleString()}g
                </span>
              </ContextMenuItem>
            ))}
            <div className="mt-3 border-t border-slate-300 pt-2">
              {(Object.entries(upgradeOfferings) as [UpgradeOffering,string][]).map(([id,label]) => (
                <ContextMenuItem key={id} disabled={!offerings?.stock[id] || !offeringSource}
                  onClick={() => offerings?.select({item,meta,source:offeringSource,offering:id})}>Upgrade with {label}</ContextMenuItem>
              ))}
              <ContextMenuItem disabled={!offerings?.stock.offeringp || !offeringSource || offeringSource.equipped || offerings.character !== offerings.executor}
                onClick={() => offerings?.stackGrace({item,meta,source:offeringSource})}>Prim stack…</ContextMenuItem>
              <ContextMenuItem disabled={!offerings || !offeringSource || offeringSource.equipped || offerings.character !== offerings.executor}
                onClick={() => offerings?.failStack({item,meta,source:offeringSource})}>Fail stack…</ContextMenuItem>
            </div>
            </div>
            {previewOpen && offeringSource && <UpgradePreviewPanel key={JSON.stringify([item,offeringSource,offerings?.executor])} item={item} source={offeringSource} />}
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {showAutomatic && meta?.upgradeable && max > 0 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="!bg-white !text-black focus:!bg-slate-100 data-open:!bg-slate-100">
            <AutoActionIcon><ArrowUp /></AutoActionIcon>
            Auto mark for upgrade
            {autoTiers ? ` · ${autoTiers} tier${autoTiers === 1 ? "" : "s"}` : ""}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className={menuColors}>
            {Array.from({ length: max }, (_, index) => index + 1).map((tiers) => (
              <ContextMenuItem key={tiers} disabled={autoTiers === tiers} onClick={() => onAutoMark(tiers)}>
                <span>+{level} → +{level + tiers} {destinationOffering(tiers)}</span>
                <span title="Scroll cost" className="ml-auto pl-5 font-mono text-black">
                  {upgradeScrollCost(meta, level, tiers).toLocaleString()}g
                </span>
              </ContextMenuItem>
            ))}
            <div className="mt-3 border-t border-slate-300 pt-2">
              <ContextMenuItem disabled={!offerings} onClick={() => offerings?.select({item,meta})}>Add upgrade rule</ContextMenuItem>
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {allowBuy && meta?.buyable ? (
        <ContextMenuItem onClick={onBuy}>Buy another level 0</ContextMenuItem>
      ) : null}
    </>
  );
}
