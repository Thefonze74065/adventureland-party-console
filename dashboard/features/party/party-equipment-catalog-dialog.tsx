"use client";
import { lazy, useCallback, useMemo, useState } from "react";
import { emptyArray } from "./empty-values";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CatalogComparison, comparisonEntry, comparisonButtonClass, type CatalogComparisonEntry } from "./catalog-comparison";
import { DeferredPanel } from "./deferred-panel";
import type { MerchantCatalogItem } from "./merchant-catalog-item";
const EquipmentCatalogDialog = lazy(() =>
  import("./equipment-catalog-dialog").then((module) => ({
    default: module.EquipmentCatalogDialog,
  })),
);
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
export function PartyEquipmentCatalogDialog({ model }: { model: PartyConsoleModel }) {
  return model.catalogOpen ? <PartyEquipmentCatalogDialogConnected base={model} /> : null;
}
function PartyEquipmentCatalogDialogConnected({ base }: { base: PartyConsoleModel }) {
  const model = usePanelModel(base, { inventory: true, vitals: true });
  const { state, setSelected, catalogOpen, setCatalogOpen, setCatalogComparison } = model;
  const [source, setSource] = useState(model.catalogComparison);
  const [entries, setEntries] = useState<CatalogComparisonEntry[]>(() => model.catalogComparison ? [comparisonEntry(model.catalogComparison)] : []);
  const [viewComparison, setViewComparison] = useState(false);
  if (source !== model.catalogComparison) {
    setSource(model.catalogComparison);
    setEntries(model.catalogComparison ? [comparisonEntry(model.catalogComparison)] : []);
    setViewComparison(false);
  }
  const finish = useCallback(() => {
    setCatalogOpen(false);
    setCatalogComparison(null);
    setViewComparison(false);
  }, [setCatalogOpen, setCatalogComparison]);
  const onOpenChange = useCallback(
    (open: boolean) => { if (!open) finish(); else setCatalogOpen(true); },
    [finish, setCatalogOpen],
  );
  const onInspect = useCallback(
    (item: { id: string; meta?: import("./item-meta").ItemMeta | null }) =>
      setSelected({
        character: "Equipment catalog",
        entry: { slot: -1, item: { name: item.id }, meta: item.meta },
      }),
    [setSelected],
  );
  const catalogAllItems = useMemo(() => state.merchantCatalog?.allItems || emptyArray<MerchantCatalogItem>(), [state.merchantCatalog]);
  return (
    <DeferredPanel active={catalogOpen}>
      <EquipmentCatalogDialog
        open={catalogOpen && !viewComparison}
        onOpenChange={onOpenChange}
        catalog={catalogAllItems}
        comparisonSource={source}
        comparison={source && entries.length ? {
          selectedIds: entries.slice(1).map(({ entry }) => entry.item.name),
          onAdd: (item) => setEntries((previous) => previous.length >= 4 || previous.slice(1).some(({ entry }) => entry.item.name === item.id) ? previous : [...previous, comparisonEntry({ slot: -1, item: { name: item.id }, meta: item.meta })]),
          controls: <div className="flex flex-wrap items-center gap-2 rounded border border-cyan-700 bg-[#10251f] p-3 text-sm">
            <span className="mr-auto">A: {String(source.meta?.definition.name || source.item.name)} +{entries[0].level}</span>
            <output>{entries.length - 1}/3 selected</output>
            {entries.slice(1).map(({ entry }, index) => <Button key={entry.item.name} size="sm" variant="outline" className={comparisonButtonClass}
              aria-label={`Remove ${String(entry.meta?.definition.name || entry.item.name)}`}
              onClick={() => setEntries((previous) => previous.filter((_, i) => i !== index + 1))}>
              {String.fromCharCode(66 + index)}: {String(entry.meta?.definition.name || entry.item.name)} ×
            </Button>)}
            <Button variant="outline" className={comparisonButtonClass} disabled={entries.length < 2} onClick={() => setViewComparison(true)}>Compare selected</Button>
            <Button variant="outline" className={comparisonButtonClass} onClick={() => setCatalogComparison(null)}>Cancel comparison</Button>
          </div>,
        } : undefined}
        onInspect={onInspect}
      />
      <Dialog open={catalogOpen && viewComparison} onOpenChange={(open) => { if (!open) finish(); }}>
        <DialogContent className="flex max-h-[92vh] w-[96vw] flex-col border-cyan-800 bg-[#07120f] text-emerald-50 sm:max-w-[1400px]">
          <DialogHeader>
            <DialogTitle>Compare catalog items</DialogTitle>
            <DialogDescription className="text-slate-300">Compare up to three alternatives against item A.</DialogDescription>
          </DialogHeader>
          <div><Button variant="outline" className={comparisonButtonClass} onClick={() => setViewComparison(false)}>Back to catalog · {Math.max(0, entries.length - 1)}/3 selected</Button></div>
          <CatalogComparison entries={entries} onChange={(index, value) => setEntries((previous) => previous.map((entry, i) => i === index ? value : entry))}
            onRemove={(index) => setEntries((previous) => previous.filter((_, i) => i !== index))} />
        </DialogContent>
      </Dialog>
    </DeferredPanel>
  );
}
