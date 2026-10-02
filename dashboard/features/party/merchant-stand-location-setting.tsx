"use client";
import { useEffect, useState } from 'react';
import type { MerchantStandLocation } from '../../../runtime/coordinator/merchant/stand-location';
import { usePartyAction } from './query-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function MerchantStandLocationSetting({ location }: { location?: MerchantStandLocation | null }) {
  const [x,setX] = useState(String(location?.x ?? ''));
  const [y,setY] = useState(String(location?.y ?? ''));
  useEffect(() => { setX(String(location?.x ?? '')); setY(String(location?.y ?? '')); }, [location?.x,location?.y]);
  const action = usePartyAction();
  const valid = x.trim() !== '' && y.trim() !== '' && Number.isFinite(Number(x)) && Number.isFinite(Number(y));
  return <fieldset disabled={action.isPending} className="space-y-3 rounded-lg border border-emerald-900/80 bg-slate-900 p-4 text-sm text-slate-100">
    <legend className="sr-only">Merchant stand location</legend>
    <p className="font-mono text-xs uppercase tracking-wider text-emerald-400">Merchant stand location</p>
    <p className="text-xs text-slate-300">Main map coordinates to return to when opening the stand. The saved position is checked against map obstacles.</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid flex-1 gap-1 text-xs text-emerald-200">Stand X
        <Input type="number" step="any" value={x} onChange={event => setX(event.target.value)} className="border-emerald-800 bg-slate-950 text-slate-100" />
      </label>
      <label className="grid flex-1 gap-1 text-xs text-emerald-200">Stand Y
        <Input type="number" step="any" value={y} onChange={event => setY(event.target.value)} className="border-emerald-800 bg-slate-950 text-slate-100" />
      </label>
      <Button disabled={!valid} onClick={() => { action.reset(); action.mutate({path:'/merchant/stand-location',body:{map:'main',x:Number(x),y:Number(y)}}); }}
        className="border border-emerald-400 bg-emerald-500 text-emerald-950 hover:bg-emerald-400">Save stand location</Button>
    </div>
    {action.error && <p role="alert" className="text-rose-200">{action.error.message}</p>}
  </fieldset>;
}
