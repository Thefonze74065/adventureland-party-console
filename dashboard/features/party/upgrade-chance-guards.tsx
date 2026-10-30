'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { itemMaximumLevel } from './item-maximum-level';
import { useUpgradeOfferings } from './upgrade-offering-controls';
import type { MerchantCatalogItem } from './merchant-catalog-item';
import { chanceGuardOverlap, type UpgradeChanceGuard } from '../../../runtime/upgrade-chance-guard';

const secondary = 'border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white';
const control = 'rounded border border-slate-600 bg-slate-900 p-2 text-slate-100 disabled:text-slate-500';
interface Draft { id: string; name: string; floor: number; ceiling: number; percent: string; scroll: string }
const percentOf = (guard: UpgradeChanceGuard) => guard.minChance === undefined ? '' : String(Math.round(guard.minChance * 10000) / 100);
const summary = (guard: UpgradeChanceGuard) => [guard.minChance === undefined ? '' : `at least ${percentOf(guard)}%`,
  guard.scrollGrade === undefined ? '' : `grade ${guard.scrollGrade}+ scrolls`].filter(Boolean).join(', ');
const upgradeable = (item: MerchantCatalogItem) => !!(item.upgradeable || item.meta?.upgradeable);

function draftError(draft: Draft, max: number, guards: UpgradeChanceGuard[]): string {
  const percent = Number(draft.percent), hasChance = draft.percent.trim() !== '';
  if (!draft.name || !max) return 'Choose an upgradeable item.';
  if (draft.floor >= draft.ceiling || draft.ceiling > max) return 'Choose a higher destination level.';
  if (!hasChance && !draft.scroll) return 'Enter a minimum chance, choose a scroll grade, or both.';
  if (hasChance && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) return 'Enter a minimum chance above 0% and up to 100%.';
  const overlap = chanceGuardOverlap(guards, { id: draft.id, name: draft.name, floor: draft.floor, ceiling: draft.ceiling, minChance: 1 });
  return overlap ? `There is already a guard that covers +${overlap.floor} to +${overlap.ceiling}.` : '';
}

function GuardDialog({ initial, guards, catalog, command, close }: {
  initial: Draft; guards: UpgradeChanceGuard[]; catalog: MerchantCatalogItem[];
  command: (body: Record<string, unknown>) => Promise<unknown>; close: () => void;
}) {
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const items = catalog.filter(upgradeable);
  const max = itemMaximumLevel(catalog.find(item => item.id === draft.name)?.meta);
  const invalid = draftError(draft, max, guards);
  async function confirm() {
    if (busy || invalid) return;
    setBusy(true); setError('');
    try {
      await command({ type: 'upgrade-chance-guard', rule: { ...(draft.id ? { id: draft.id } : {}), name: draft.name,
        floor: draft.floor, ceiling: draft.ceiling,
        ...(draft.percent.trim() ? { minChance: Number(draft.percent) / 100 } : {}),
        ...(draft.scroll ? { scrollGrade: Number(draft.scroll) } : {}) } });
      close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save guard'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className="border-slate-600 bg-slate-950 text-slate-100">
      <DialogHeader><DialogTitle>{initial.id ? 'Edit chance guard' : 'Add chance guard'}</DialogTitle>
        <DialogDescription className="text-slate-300">Hold an upgrade attempt unless the server&apos;s own chance, with all your grace, is at least this high, and optionally spend a higher-grade scroll than the item needs.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Guarded item" className={control} disabled={busy || !!initial.id} value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value, floor: 0, ceiling: 1 })}>
          <option value="">Choose item</option>
          {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select> when upgrading from
        <select aria-label="Starting level" className={control} disabled={busy} value={draft.floor} onChange={e => setDraft({ ...draft, floor: Number(e.target.value) })}>
          {Array.from({ length: max }, (_, n) => <option key={n} value={n}>+{n}</option>)}
        </select> to
        <select aria-label="Ending level" className={control} disabled={busy} value={draft.ceiling} onChange={e => setDraft({ ...draft, ceiling: Number(e.target.value) })}>
          {Array.from({ length: max }, (_, n) => n + 1).map(n => <option disabled={n <= draft.floor} key={n} value={n}>+{n}</option>)}
        </select> require at least
        <input aria-label="Minimum chance percent" className={`${control} w-20`} inputMode="decimal" placeholder="any" disabled={busy} value={draft.percent}
          onChange={e => setDraft({ ...draft, percent: e.target.value })} />% and use
        <select aria-label="Scroll grade" className={control} disabled={busy} value={draft.scroll} onChange={e => setDraft({ ...draft, scroll: e.target.value })}>
          <option value="">the item&apos;s own scroll</option>
          {[1, 2, 3, 4].map(grade => <option key={grade} value={grade}>grade {grade} or higher scrolls</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-400">A higher-grade scroll than the item needs adds chance only up to +10, and costs far more.</p>
      {(invalid || error) && <p role="alert" className="text-sm text-rose-300">{error || invalid}</p>}
      <DialogFooter><Button variant="outline" className={secondary} disabled={busy} onClick={close}>Cancel</Button>
        <Button className="border border-sky-400 bg-sky-700 text-white hover:bg-sky-600 disabled:bg-slate-800 disabled:text-slate-400" disabled={busy || !!invalid} onClick={() => void confirm()}>{busy ? 'Saving…' : 'Confirm'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Lists, adds, edits and removes chance guards through the coordinator's `upgrade-chance-guard` command. */
export function UpgradeChanceGuardRules() {
  const controls = useUpgradeOfferings();
  const [open, setOpen] = useState(false), [editing, setEditing] = useState<Draft | null>(null), [error, setError] = useState('');
  if (!controls) return null;
  const { guards, catalog, command } = controls;
  async function remove(guard: UpgradeChanceGuard) {
    try { await command({ type: 'upgrade-chance-guard', rule: { id: guard.id }, remove: true }); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove guard'); }
  }
  return <section className="-mx-5 border-y border-sky-800 bg-black text-sky-300">
    <button type="button" aria-label="Chance guards" aria-expanded={open} onClick={() => setOpen(!open)}
      className="flex h-10 w-full min-w-0 items-center gap-2 border-0 bg-black px-5 text-left text-xs text-sky-300 transition-colors hover:bg-slate-900 hover:text-sky-100">
      <ChevronRight className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-90' : ''}`} />
      <ShieldCheck className="h-4 w-4" /><span>Chance guards and scrolls</span>
      <span className="ml-auto font-mono opacity-70">{guards.length}</span>
    </button>
    {open && <div className="space-y-2 border-t border-sky-800 bg-black px-5 py-3">
      {!guards.length && <p className="text-sm text-slate-400">No chance guards or scroll rules. Upgrades are attempted at any chance with the item&apos;s own scroll.</p>}
      {guards.map(guard => <div key={guard.id} className="flex flex-wrap items-center gap-2 border-b border-white/10 py-1 text-xs text-slate-100 last:border-b-0">
        <span>{catalog.find(item => item.id === guard.name)?.name || guard.name}</span>
        <span>+{guard.floor} → +{guard.ceiling}</span><span className="text-sky-200">{summary(guard)}</span>
        <Button variant="outline" className={secondary} onClick={() => setEditing({ id: guard.id, name: guard.name, floor: guard.floor, ceiling: guard.ceiling, percent: percentOf(guard), scroll: guard.scrollGrade === undefined ? '' : String(guard.scrollGrade) })}>Edit</Button>
        <Button variant="outline" className={secondary} onClick={() => void remove(guard)}>Remove</Button>
      </div>)}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <Button variant="outline" className={secondary} onClick={() => setEditing({ id: '', name: '', floor: 0, ceiling: 1, percent: '', scroll: '' })}>Add guard</Button>
    </div>}
    {editing && <GuardDialog initial={editing} guards={guards} catalog={catalog} command={command} close={() => setEditing(null)} />}
  </section>;
}
