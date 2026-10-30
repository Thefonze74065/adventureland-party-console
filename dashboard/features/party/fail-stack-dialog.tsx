'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePartyAction } from './query-actions';
import { itemMaximumLevel } from './item-maximum-level';
import type { Item } from './item';
import type { MerchantCatalogItem } from './merchant-catalog-item';
import { failStackMaxAttempts } from '../../../runtime/fail-stack';

const secondary = 'border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white';
const control = 'rounded border border-slate-600 bg-slate-900 p-2 text-slate-100 disabled:text-slate-500';
const upgradeable = (item: MerchantCatalogItem) => !!(item.upgradeable || item.meta?.upgradeable);

/** The most any one run can destroy; shown in the confirmation so the cost is never a surprise. */
export function failStackError(attempts: string, percent: string): string {
  const count = Number(attempts);
  if (!Number.isSafeInteger(count) || count < 1 || count > failStackMaxAttempts) return `Choose between 1 and ${failStackMaxAttempts} attempts.`;
  if (percent.trim() === '') return '';
  const chance = Number(percent);
  return Number.isFinite(chance) && chance > 0 && chance <= 100 ? '' : 'Enter a stop chance above 0% and up to 100%, or leave it blank.';
}

/** Fail stacking (#152): burn spare copies at one level to build ugrace and ograce for the item being kept. */
export function FailStackDialog({ item, name, catalog, character, slot, primlings, close }: {
  item: Item; name: string; catalog: MerchantCatalogItem[]; character: string; slot: number; primlings: number; close: () => void;
}) {
  const level = Number(item.level) || 0;
  const [sacrifice, setSacrifice] = useState({ name: String(item.name), level });
  const [attempts, setAttempts] = useState('5'), [percent, setPercent] = useState('');
  const [offering, setOffering] = useState(false), [previewOffering, setPreviewOffering] = useState(false);
  const action = usePartyAction();
  const max = itemMaximumLevel(catalog.find(entry => entry.id === sacrifice.name)?.meta);
  const invalid = failStackError(attempts, percent);
  const sacrificeLabel = catalog.find(entry => entry.id === sacrifice.name)?.name || sacrifice.name;
  async function confirm() {
    if (invalid) return;
    action.reset();
    try {
      await action.mutateAsync({ path: '/fail-stack', body: { character, slot, item, sacrifice, attempts: Number(attempts),
        ...(percent.trim() ? { stopChance: Number(percent) / 100 } : {}), offering, previewOffering } });
      close();
    } catch { /* The error stays visible in the dialog. */ }
  }
  return <Dialog open onOpenChange={open => { if (!open && !action.isPending) close(); }}>
    <DialogContent className="border-slate-600 bg-slate-950 text-slate-100">
      <DialogHeader><DialogTitle>Fail stack</DialogTitle>
        <DialogDescription className="text-slate-300">
          Deliberately fail upgrades on spare copies to build ugrace for {name} +{level}. Each failed attempt raises ugrace at its level and below,
          and with a Primling adds ograce. A success resets that level&apos;s ugrace, so burn copies at the level you want to stack.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2 text-sm">Burn spare
        <select aria-label="Spare item" className={control} disabled={action.isPending} value={sacrifice.name}
          onChange={e => setSacrifice({ name: e.target.value, level: 0 })}>
          {catalog.filter(upgradeable).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select> at
        <select aria-label="Spare level" className={control} disabled={action.isPending} value={sacrifice.level}
          onChange={e => setSacrifice({ ...sacrifice, level: Number(e.target.value) })}>
          {Array.from({ length: max }, (_, n) => <option key={n} value={n}>+{n}</option>)}
        </select>, up to
        <input aria-label="Attempts" className={`${control} w-16`} inputMode="numeric" disabled={action.isPending} value={attempts} onChange={e => setAttempts(e.target.value)} /> times
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">Stop early once the chance reaches
        <input aria-label="Stop chance percent" className={`${control} w-20`} inputMode="decimal" placeholder="never" disabled={action.isPending}
          value={percent} onChange={e => setPercent(e.target.value)} />%</label>
      <fieldset className="space-y-2 text-sm" disabled={action.isPending}><legend className="sr-only">Primling use</legend>
        <label className={`flex items-center gap-2 ${primlings ? '' : 'text-slate-500'}`}><input type="checkbox" aria-label="Use a Primling on each attempt" disabled={!primlings}
          checked={offering} onChange={e => setOffering(e.target.checked)} />Use a Primling on each attempt (+0.6 ograce per failure; {primlings.toLocaleString()} available)</label>
        <label className="flex items-center gap-2"><input type="checkbox" aria-label="Measure with a Primling" checked={previewOffering} onChange={e => setPreviewOffering(e.target.checked)} />
          Measure the chance as if the real attempt uses a Primling</label>
      </fieldset>
      <p role="note" className="rounded border border-rose-800 bg-rose-950 p-2 text-sm text-rose-200">
        This can destroy up to {Number(attempts) > 0 ? Number(attempts) : 0} {sacrificeLabel} +{sacrifice.level} in the merchant&apos;s inventory. Locked, bound and special copies, and the item
        you are stacking for, are never used. Copies already at a different level are left alone.
      </p>
      {(invalid || action.error) && <p role="alert" className="text-sm text-rose-300">{invalid || action.error?.message}</p>}
      <DialogFooter><Button variant="outline" className={secondary} disabled={action.isPending} onClick={close}>Cancel</Button>
        <Button className="border border-rose-400 bg-rose-700 text-white hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-400"
          disabled={action.isPending || !!invalid} onClick={() => void confirm()}>{action.isPending ? 'Queueing…' : 'Burn spares'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
