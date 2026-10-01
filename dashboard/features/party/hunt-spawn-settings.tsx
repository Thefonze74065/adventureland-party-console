"use client";
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FarmingAreaPreview } from './farming-area-preview';
import type { Zone } from '../../lib/farming-zones';
import { zones } from '../../lib/farming-zones';
import { huntSpawnKey } from '../../../runtime/coordinator/hunt/spawn-preferences';
import type { HuntSettings } from '../../../runtime/coordinator/hunt/settings';
import type { MonsterChoice } from './monster-choice';
import { ItemSprite } from './item-sprite';

export function HuntSpawnSettings({ catalog, value, onSave, disabled }: {
  catalog: MonsterChoice[];
  value?: HuntSettings;
  onSave?: (patch: Partial<HuntSettings>) => Promise<void>;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<Zone | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const groupId = useId();
  const monsters = useMemo(() => !open ? [] : catalog.map(monster => ({
    ...monster, spawns: zones([monster], [monster.id]),
  })).filter(monster => monster.spawns.length > 1)
    .sort((a, b) => a.name.localeCompare(b.name)), [catalog, open]);

  async function select(monster: string, key: string) {
    if (!onSave) return;
    setBusy(true); setError(null); setSaved('');
    try {
      await onSave({ preferredSpawns: { [monster]: key } });
      setSaved('Preference saved for future Monster Hunts.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save preferred spawn');
    } finally { setBusy(false); }
  }

  return <>
    <Button type="button" size="sm" disabled={disabled || !onSave} onClick={() => setOpen(true)}
      className="w-fit border border-cyan-700 bg-[#07110f] text-cyan-100 hover:border-cyan-300 hover:bg-emerald-950">
      Set preferred hunt spawns
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Preferred hunt spawns</DialogTitle>
          <DialogDescription className="text-emerald-100/80">
            Choose where to hunt each monster. Changes apply to future Monster Hunt destinations only.
            Automatic prefers the nearest spawn on your leader’s map. Unavailable spawns use automatic selection.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(240px,1fr)_minmax(0,1.4fr)]"><div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {monsters.length === 0 && <p className="text-sm text-emerald-100">No monsters with multiple available spawns.</p>}
          {monsters.map(monster => {
            const preference = value?.preferredSpawns?.[monster.id];
            const selected = monster.spawns.some(spawn => huntSpawnKey(spawn) === preference) ? preference : '';
            return <details onToggle={e=>{if(e.currentTarget.open)setPreview(monster.spawns.find(spawn=>huntSpawnKey(spawn)===selected) || monster.spawns[0]);}} key={monster.id} className="rounded border border-emerald-800 bg-[#07110f]">
              <summary className="cursor-pointer rounded p-3 text-emerald-50 hover:bg-emerald-950 focus-visible:outline-2 focus-visible:outline-cyan-300">
                <span className="inline-flex items-center gap-2 align-middle">
                  {monster.sprite && <span className="relative h-8 w-8"><ItemSprite sprite={monster.sprite}/></span>}
                  <span>{monster.name} <span className="text-xs text-emerald-200">· {monster.spawns.length} spawns{selected ? ' · Custom' : ' · Default'}</span></span>
                </span>
              </summary>
              <fieldset disabled={disabled || busy || !onSave} className="space-y-2 border-t border-emerald-900 p-3">
                <legend className="sr-only">Preferred spawn for {monster.name}</legend>
                <label className="flex cursor-pointer items-center gap-3 rounded border border-emerald-800 bg-[#0c211a] p-3 text-sm text-emerald-50">
                  <input type="radio" name={`${groupId}-${monster.id}`} checked={!selected}
                    onChange={() => void select(monster.id, '')} className="accent-cyan-400"/>
                  Automatic <span className="text-xs text-cyan-200">(default)</span>
                </label>
                {monster.spawns.map(spawn => {
                  const key = huntSpawnKey(spawn);
                  return <label key={key} onMouseEnter={()=>setPreview(spawn)} onFocus={()=>setPreview(spawn)} className="flex cursor-pointer items-center gap-3 rounded border border-emerald-800 bg-[#0c211a] p-3 text-sm text-emerald-50">
                    <input type="radio" name={`${groupId}-${monster.id}`} checked={selected === key}
                      onChange={() => {setPreview(spawn);void select(monster.id, key);}} className="accent-cyan-400"/>
                    <span>{spawn.mapName || spawn.map} <span className="text-emerald-200">({Math.round(spawn.x)}, {Math.round(spawn.y)})</span></span>
                  </label>;
                })}
              </fieldset>
            </details>;
          })}
        </div>
          <div className="min-h-72" aria-label="Preferred hunt spawn map preview">{preview ? <FarmingAreaPreview area={{...preview,id:preview.id || huntSpawnKey(preview)}} radius={400}/> : <p className="p-5 text-sm text-emerald-100">Expand a monster to preview its spawn areas.</p>}</div>
        </div>
        {busy && <p role="status" className="text-sm text-cyan-100">Saving preference…</p>}
        {saved && <p role="status" className="text-sm text-cyan-100">{saved}</p>}
        {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
