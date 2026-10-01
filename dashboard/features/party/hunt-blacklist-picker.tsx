"use client";
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { MonsterChoice } from './monster-choice';
import { CenteredMonsterSprite } from './centered-monster-sprite';

export function HuntBlacklistPicker({catalog,blacklist,disabled,onAdd,renderMonsterDetails}: {
  catalog: MonsterChoice[]; blacklist: Record<string, unknown>; disabled?: boolean;
  onAdd?: (id: string) => Promise<void>;
  renderMonsterDetails?: (id: string, onClose: () => void) => ReactNode;
}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [inspected,setInspected]=useState<string|null>(null);
  const rows=catalog.filter(monster=>monster.id!=='all' && `${monster.name} ${monster.id}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  async function add(id:string) {
    if (!onAdd || disabled || busy || blacklist[id]) return;
    setBusy(true);setError('');
    try {await onAdd(id);} catch(e) {setError(e instanceof Error?e.message:'Could not add monster to blacklist');}
    finally {setBusy(false);}
  }
  const control='border border-emerald-600 bg-[#07110f] text-emerald-100 hover:border-emerald-300 hover:bg-emerald-950 hover:text-white';
  return <>
    <Button size="sm" disabled={disabled||!onAdd} className={control} onClick={()=>{setSearch('');setError('');setOpen(true);}}>Add</Button>
    <Dialog open={open} onOpenChange={value=>{setOpen(value);if(!value)setInspected(null);}}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-xl">
        <DialogHeader><DialogTitle>Add to Hunt blacklist</DialogTitle><DialogDescription className="text-emerald-100/80">Choose any monster to skip its Hunt quests. Click a monster for details.</DialogDescription></DialogHeader>
        <input aria-label="Search blacklist monsters" placeholder="Search monsters…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded border border-emerald-600 bg-[#07110f] px-3 py-2 text-emerald-50 placeholder:text-emerald-100/60"/>
        <section aria-label="Hunt blacklist monsters" className="min-h-0 max-h-[55vh] space-y-2 overflow-y-auto overscroll-contain">
          {rows.map(monster=><div key={monster.id} className="flex items-center gap-3 rounded border border-emerald-800 bg-[#07110f] p-2">
            <button type="button" aria-label={`Inspect ${monster.name}`} onClick={()=>setInspected(monster.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded border border-transparent bg-[#07110f] p-1 text-left text-emerald-50 hover:border-cyan-600 hover:bg-emerald-950 hover:text-white">
              {monster.sprite&&<span className="pointer-events-none relative h-12 w-12 shrink-0 overflow-hidden"><CenteredMonsterSprite sprite={monster.sprite}/></span>}<span>{monster.name}<span className="block text-xs text-emerald-200">{monster.id}</span></span>
            </button>
            <Button size="sm" className={control} disabled={disabled||busy||!!blacklist[monster.id]} aria-label={blacklist[monster.id]?`${monster.name} is blacklisted`:`Add ${monster.name} to blacklist`} onClick={()=>void add(monster.id)}>{blacklist[monster.id]?'Added':'Add to blacklist'}</Button>
          </div>)}
          {!rows.length&&<p className="text-sm text-emerald-100">No matching monsters.</p>}
        </section>
        {error&&<p role="alert" className="text-sm text-rose-200">{error}</p>}
        {inspected&&renderMonsterDetails?.(inspected,()=>setInspected(null))}
      </DialogContent>
    </Dialog>
  </>;
}
