"use client";
import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { defaultPassiveRule, type PassiveSettings, type PassiveRule } from '../../../runtime/coordinator/navigation/passive-settings';
import type { MonsterChoice } from './monster-choice';
import { CenteredMonsterSprite } from './centered-monster-sprite';

export type PassivePatch = {rules?:Record<string,Partial<PassiveRule>>;useFieldGenerators?:boolean};
const control = 'border border-cyan-700 bg-[#07110f] text-cyan-100 hover:border-cyan-300 hover:bg-emerald-950';
const check = 'border-cyan-400 bg-[#07110f] text-white data-checked:bg-cyan-700';
export function PassiveHuntingMenu({settings,catalog,disabled,onSave,renderMonsterDetails}: {
  renderMonsterDetails?:(id:string,onClose:()=>void)=>ReactNode;
  settings:PassiveSettings;catalog:MonsterChoice[];disabled?:boolean;onSave?:(patch:PassivePatch)=>Promise<void>;
}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [inspectedMonster,setInspectedMonster]=useState<string|null>(null);
  const [levelDrafts,setLevelDrafts]=useState<Record<string,string>>({});
  function commitLevel(id:string) {
    const draft=levelDrafts[id];
    if(draft===undefined)return;
    const value=Number(draft);
    if(!draft.trim() || !Number.isSafeInteger(value) || value!==-1 && value<=0) {setError('Max level must be -1 (any level) or a positive whole number.');return;}
    setLevelDrafts(current=>{const next={...current};delete next[id];return next;});
    if(value!==(rule(id).maxLevel??-1))void save({rules:{[id]:{maxLevel:value}}});
  }
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  async function save(patch:PassivePatch) {
    if (!onSave || busy) return;
    setBusy(true);setError(null);
    try { await onSave(patch); } catch(e) {setError(e instanceof Error?e.message:'Could not save passive hunting settings');}
    finally {setBusy(false);}
  }
  const rule=(id:string)=>settings.rules[id] || defaultPassiveRule(id);
  const rows=catalog.filter(monster=>monster.id!=='all' && monster.id!=='fieldgen0' && `${monster.name} ${monster.id}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b)=>Number(rule(b.id).enabled)-Number(rule(a.id).enabled)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const locked=disabled||busy||!onSave;
  function commit(id:string) {
    if (drafts[id] === undefined) return;
    const value=Number(drafts[id]);
    if (!drafts[id].trim() || !Number.isInteger(value) || value<0 || value>1000) {setError('Priority must be a whole number from 0 to 1000.');return;}
    setDrafts(current=>{const next={...current};delete next[id];return next;});
    if(value!==rule(id).priority) void save({rules:{[id]:{priority:value}}});
  }
  return <div className="space-y-3 rounded border border-emerald-700 bg-[#07110f] p-3 text-emerald-50">
    <p className="text-sm">Monsters that are automatically attacked when spotted on the map</p>
    <label className="flex items-center gap-3 text-sm"><Checkbox className={check} disabled={locked} checked={settings.useFieldGenerators}
      onCheckedChange={checked=>void save({useFieldGenerators:!!checked})}/><span>Use field generators when passively hunting fairy</span></label>
    <Button className={control} onClick={()=>setOpen(true)}>Open passive hunting menu</Button>
    {!open && error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-hidden border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-3xl">
      <DialogHeader><div className="flex items-center gap-3"><DialogTitle>Passive hunting</DialogTitle>
        <Popover><PopoverTrigger render={<button type="button" aria-label="About passive hunting" className={`rounded p-1 ${control}`} />}><Info className="h-4 w-4"/></PopoverTrigger>
          <PopoverContent className="w-80 border border-emerald-700 bg-[#081713] text-emerald-50"><p className="text-sm">&quot;Keep moving to destination&quot; means characters will not stop to engage the sighted monster until death. They will only attack while in range, and will not chase, reposition, or start kiting behavior.</p><p className="mt-2 text-sm">This setting also applies when the monster attacks back. Emergency escape and recovery still take precedence over this setting.</p><p className="mt-2 text-sm">Priority affects both active and passive hunting targets - it is recommended to set a higher priority for passive targets.</p></PopoverContent>
        </Popover></div><DialogDescription className="text-emerald-100/80">Select monsters to attack on sight. Settings apply to the party. Max level -1 allows any level; a positive number limits intentional passive attacks.</DialogDescription></DialogHeader>
      <input aria-label="Filter passive hunting monsters" placeholder="Search monsters…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded border border-cyan-700 bg-[#07110f] px-3 py-2 text-emerald-50 placeholder:text-emerald-100/60"/>
      <div className="max-h-[55vh] overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-[#081713] text-emerald-100"><tr><th className="w-10 p-2"><span className="sr-only">Enabled</span></th><th className="p-2">Monster</th><th className="p-2">Keep moving to destination</th><th className="p-2">Max level</th><th className="p-2">Priority</th></tr></thead>
        <tbody>{rows.map(monster=><tr key={monster.id} className="border-t border-emerald-900"><td className="p-2"><Checkbox aria-label={`Passively hunt ${monster.name}`} className={check} disabled={locked} checked={rule(monster.id).enabled} onCheckedChange={checked=>void save({rules:{[monster.id]:{enabled:!!checked}}})}/></td>
          <td className="p-2"><button type="button" aria-label={`Inspect ${monster.name}`} onClick={()=>setInspectedMonster(monster.id)} className="flex w-full items-center gap-2 rounded border-0 bg-[#081713] text-left text-emerald-50 ring-inset hover:ring-1 hover:ring-cyan-600 hover:bg-emerald-950 hover:text-white">{monster.sprite && <span className="relative h-8 w-8 shrink-0"><CenteredMonsterSprite sprite={monster.sprite}/></span>}{monster.name}</button></td>
          <td className="p-2"><Checkbox aria-label={`Keep moving to destination for ${monster.name}`} className={check} disabled={locked} checked={rule(monster.id).keepMoving} onCheckedChange={checked=>void save({rules:{[monster.id]:{keepMoving:!!checked}}})}/></td>
          <td className="p-2"><input aria-label={`${monster.name} passive max level`} type="number" min={-1} step={1} disabled={locked} className="w-20 rounded border border-cyan-700 bg-[#07110f] px-2 py-1 text-cyan-100" value={levelDrafts[monster.id]??rule(monster.id).maxLevel??-1} onChange={e=>setLevelDrafts({...levelDrafts,[monster.id]:e.target.value})} onBlur={()=>commitLevel(monster.id)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></td>
          <td className="p-2"><input aria-label={`${monster.name} passive priority`} type="number" min={0} max={1000} step={1} disabled={locked} className="w-20 rounded border border-cyan-700 bg-[#07110f] px-2 py-1 text-cyan-100" value={drafts[monster.id]??rule(monster.id).priority} onChange={e=>setDrafts({...drafts,[monster.id]:e.target.value})} onBlur={()=>commit(monster.id)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></td></tr>)}</tbody></table>
        {!rows.length && <p className="p-3 text-emerald-100">No matching monsters.</p>}</div>
      {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
      {inspectedMonster && renderMonsterDetails?.(inspectedMonster,()=>setInspectedMonster(null))}
    </DialogContent></Dialog>
  </div>;
}
