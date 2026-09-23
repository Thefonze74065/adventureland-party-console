'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { ItemSprite } from './item-sprite';
import { itemMaximumLevel } from './item-maximum-level';
import type { Item } from './item';
import type { ItemMeta } from './item-meta';
import type { MerchantCatalogItem } from './merchant-catalog-item';
import { upgradeOfferings, offeringOverlap, type UpgradeOffering, type UpgradeOfferingRule } from '../../../runtime/upgrade-offerings';

export type OfferingSource = {slot:number | string; equipped?:boolean};
type Selection = {item:Item; meta?:ItemMeta | null; source?:OfferingSource; offering?:UpgradeOffering; rule?:UpgradeOfferingRule};
interface Controls {
  character:string;
  executor?:string | null;
  stock:Partial<Record<UpgradeOffering,number>>;
  rules:UpgradeOfferingRule[];
  catalog:MerchantCatalogItem[];
  select:(selection:Selection) => void;
  remove:(rule:UpgradeOfferingRule) => Promise<void>;
  clear:() => Promise<void>;
}
const Context = createContext<Controls | null>(null);
export const useUpgradeOfferings = () => useContext(Context);
const secondary = 'border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white';
const control = 'rounded border border-slate-600 bg-slate-900 p-2 text-slate-100 disabled:text-slate-500';

export function UpgradeOfferingProvider({children, character, executor, stock, rules, catalog, post}: {
  children:ReactNode; character:string; stock:Controls['stock']; rules:UpgradeOfferingRule[];
  executor?:string | null;
  catalog:MerchantCatalogItem[]; post:(path:"/command", body:Record<string,unknown>) => Promise<unknown>;
}) {
  const [selection, select] = useState<Selection | null>(null);
  const [error, setError] = useState('');
  const save = useCallback((body:Record<string,unknown>) => post('/command', {character, ...body}), [post, character]);
  const remove = useCallback(async (rule:UpgradeOfferingRule) => {
    try { await save({type:'upgrade-offering-rule', rule:{id:rule.id}, remove:true}); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove rule'); }
  }, [save]);
  const clear = useCallback(async () => {
    setError('');
    try {
      for (const rule of rules) await save({type:'upgrade-offering-rule', rule:{id:rule.id}, remove:true});
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not clear upgrade rules'); }
  }, [rules, save]);
  const value = useMemo<Controls>(() => ({character, executor, stock, rules, catalog, select, remove, clear}),
    [character, executor, stock, rules, catalog, select, remove, clear]);
  return <Context.Provider value={value}>
    {children}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {selection && <OfferingDialog selection={selection} rules={rules} stock={stock} catalog={catalog}
      close={() => select(null)} save={save} />}
  </Context.Provider>;
}

function OfferingIcon({name, catalog}: {name:string; catalog:MerchantCatalogItem[]}) {
  const item = catalog.find(entry => entry.id === name);
  return <span className="relative inline-block h-14 w-14 shrink-0 overflow-hidden rounded border border-slate-600 bg-black" aria-label={item?.name || name}>
    {item?.sprite && <ItemSprite sprite={item.sprite} />}
  </span>;
}

function OfferingDialog({selection, rules, stock, catalog, close, save}: {
  selection:Selection; rules:UpgradeOfferingRule[]; stock:Controls['stock']; catalog:MerchantCatalogItem[];
  close:() => void; save:(body:Record<string,unknown>) => Promise<unknown>;
}) {
  const manual = !!selection.source, level = Number(selection.item.level || 0);
  const meta = selection.meta || catalog.find(item => item.id === selection.item.name)?.meta;
  const max = itemMaximumLevel(meta);
  const [rule, setRule] = useState<UpgradeOfferingRule>(selection.rule || {
    id:'', name:selection.item.name, floor:level, ceiling:Math.min(level+1,max),
    offering:selection.offering || 'offeringp', required:true,
  });
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const overlap = !manual && offeringOverlap(rules,rule);
  const invalid = overlap ? `There is already a rule that covers +${overlap.floor} to +${overlap.ceiling}.`
    : !manual && (rule.floor >= rule.ceiling || rule.ceiling > max) ? 'Choose a higher destination level.'
    : manual && !stock[rule.offering] ? 'This offering is no longer available.' : '';
  const name = catalog.find(entry => entry.id === selection.item.name)?.name || selection.item.name;
  async function confirm() {
    if (busy || invalid) return;
    setBusy(true); setError('');
    try {
      await save(manual ? {type:'upgrade-mark', item:selection.item, ...selection.source, tiers:1, offering:rule.offering}
        : {type:'upgrade-offering-rule', rule});
      close();
    } catch(e) { setError(e instanceof Error ? e.message : 'Could not save upgrade'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => {if (!open && !busy) close();}}>
    <DialogContent className="border-slate-600 bg-slate-950 text-slate-100">
      <DialogHeader><DialogTitle>{manual ? 'Confirm upgrade' : selection.rule ? 'Edit upgrade rule' : 'Add upgrade rule'}</DialogTitle>
        <DialogDescription className="text-slate-300">{manual
          ? `Use ${upgradeOfferings[rule.offering]} to upgrade ${name} from +${level} to +${level+1}?`
          : 'Use an offering during automatic upgrades within this level range.'}</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3"><OfferingIcon name={selection.item.name} catalog={catalog}/><span>{name}</span></div>
      {manual ? <div className="flex items-center gap-3"><OfferingIcon name={rule.offering} catalog={catalog}/>{upgradeOfferings[rule.offering]}</div>
        : <><div className="flex flex-wrap items-center gap-2 text-sm">When upgrading from
          <select aria-label="Starting level" className={control} disabled={busy} value={rule.floor} onChange={e => setRule({...rule,floor:Number(e.target.value)})}>
            {Array.from({length:max},(_,n) => <option key={n} value={n}>+{n}</option>)}
          </select> to
          <select aria-label="Ending level" className={control} disabled={busy} value={rule.ceiling} onChange={e => setRule({...rule,ceiling:Number(e.target.value)})}>
            {Array.from({length:max},(_,n) => n+1).map(n => <option disabled={n <= rule.floor} key={n} value={n}>+{n}</option>)}
          </select> use
          <select aria-label="Upgrade offering" className={control} disabled={busy} value={rule.offering} onChange={e => setRule({...rule,offering:e.target.value as UpgradeOffering})}>
            {Object.entries(upgradeOfferings).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div><fieldset className="space-y-2 text-sm" disabled={busy}><legend className="sr-only">Offering availability</legend>
          <label className="flex items-center gap-2"><input type="radio" name="offering-mode" checked={rule.required} onChange={() => setRule({...rule,required:true})}/>Required to attempt upgrade</label>
          <label className="flex items-center gap-2"><input type="radio" name="offering-mode" checked={!rule.required} onChange={() => setRule({...rule,required:false})}/>Only if item is available</label>
        </fieldset></>}
      {(invalid || error) && <p role="alert" className="text-sm text-rose-300">{invalid || error}</p>}
      <DialogFooter><Button variant="outline" className={secondary} disabled={busy} onClick={close}>Cancel</Button>
        <Button className="border border-sky-400 bg-sky-700 text-white hover:bg-sky-600 disabled:bg-slate-800 disabled:text-slate-400" disabled={busy || !!invalid} onClick={() => void confirm()}>{busy ? 'Saving…' : 'Confirm'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function UpgradeOfferingRules() {
  const controls = useUpgradeOfferings();
  const [open,setOpen] = useState(false);
  const [clearArmed,setClearArmed] = useState(false);
  const [clearing,setClearing] = useState(false);
  if (!controls) return null;
  async function clearRules() {
    if (!controls || clearing) return;
    setClearing(true);
    try { await controls.clear(); }
    finally { setClearing(false); setClearArmed(false); }
  }
  return <section className="-mx-5 border-y border-sky-800 bg-black text-sky-300">
    <div className="flex h-10 w-full items-stretch bg-black">
    <button type="button" aria-label="Upgrade rules" aria-expanded={open} onClick={() => {setOpen(!open); setClearArmed(false);}}
      className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-black px-5 text-left text-xs text-sky-300 transition-colors hover:bg-slate-900 hover:text-sky-100">
      <ChevronRight className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-90' : ''}`} />
      <Sparkles className="h-4 w-4" /><span>Upgrade rules</span>
      <span className="ml-auto font-mono opacity-70">{controls.rules.length}</span>
    </button>
    <button type="button" disabled={!controls.rules.length || clearing}
      aria-label={clearArmed ? 'Really clear all Upgrade rules' : 'Clear all Upgrade rules'}
      title={clearArmed ? 'Click again to clear all' : 'Clear all'}
      onClick={() => {if (clearArmed) void clearRules(); else setClearArmed(true);}}
      className={`flex shrink-0 items-center justify-center overflow-hidden border-l transition-all duration-300 disabled:border-slate-800 disabled:text-slate-700 ${clearArmed ? 'w-24 border-rose-300 bg-rose-600 px-2 text-white hover:bg-rose-500' : 'w-10 border-rose-900 bg-black text-rose-400 hover:bg-rose-950 hover:text-white'}`}>
      <span className={`whitespace-nowrap text-[10px] font-semibold transition-opacity ${clearArmed ? 'opacity-100' : 'opacity-0 w-0'}`}>Really?</span>
      <X className="h-4 w-4 shrink-0" />
    </button>
    </div>
    {open && <div className="space-y-2 border-t border-sky-800 bg-black px-5 py-3">{!controls.rules.length && <p className="text-sm text-slate-400">No upgrade rules.</p>}
      {controls.rules.map(rule => <div key={rule.id} className="flex flex-wrap items-center gap-2 border-b border-white/10 py-1 text-xs text-slate-100 last:border-b-0">
        <OfferingIcon name={rule.name} catalog={controls.catalog}/><span>{controls.catalog.find(item => item.id === rule.name)?.name || rule.name}</span>
        <span>+{rule.floor} → +{rule.ceiling}</span><OfferingIcon name={rule.offering} catalog={controls.catalog}/><span>{upgradeOfferings[rule.offering]}</span>
        <span className="text-sky-200">{rule.required ? 'Required' : 'When available'}</span>
        <Button variant="outline" className={secondary} disabled={clearing} onClick={() => controls.select({item:{name:rule.name},rule})}>Edit</Button>
        <Button variant="outline" className={secondary} disabled={clearing} onClick={() => void controls.remove(rule)}>Remove</Button>
      </div>)}
    </div>}
  </section>;
}
