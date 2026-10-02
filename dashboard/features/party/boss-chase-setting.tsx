"use client";
import { useState } from 'react';
import type { BossChaseState } from '../../../runtime/coordinator/events/boss-chase';
import { usePartyAction } from './query-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const realmLabel = (realm: string) => realm.replace(/^SR_/, '').replace(/(US|EU|ASIA)/, '$1 ');
const bossLabel: Record<string, string> = {
  franky: 'Franky', icegolem: 'Ice Golem', crabxx: 'Giga Crab',
  mrpumpkin: 'Mr. Pumpkin', mrgreen: 'Mr. Green', dragold: 'Dragold', grinch: 'Grinch',
};

export function BossChaseSetting({ chase }: { chase?: BossChaseState | null }) {
  // An unsaved edit overrides the coordinator value; clearing it follows the server again.
  const [draft, setDraft] = useState<string | null>(null);
  const minEta = draft ?? String(chase?.minEtaMinutes ?? 15);
  const action = usePartyAction();
  const enabled = chase?.enabled === true;
  const validEta = minEta.trim() !== '' && Number.isFinite(Number(minEta)) && Number(minEta) >= 0;
  const save = (body: { enabled?: boolean; minEtaMinutes?: number }) => {
    action.reset();
    action.mutate({ path: '/realm/boss-chase', body });
  };
  return <fieldset disabled={action.isPending} className="mt-4 space-y-3 rounded border border-violet-800 bg-[#0b0d14] p-3 text-sm text-slate-100">
    <legend className="sr-only">Event boss realm chase</legend>
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="font-semibold text-violet-100">Chase event bosses across realms</p>
        <p className="text-xs text-slate-300">When an event boss (Franky, Ice Golem, Giga Crab, or a seasonal boss) isn&apos;t live here, move the party to a realm where one is, then return home once it&apos;s gone. Only bosses whose event is selected are chased.</p>
      </div>
      <Button type="button" variant="outline" aria-pressed={enabled} onClick={() => save({ enabled: !enabled })}
        className={enabled
          ? 'shrink-0 border-violet-300 bg-violet-600 text-white hover:bg-violet-500 hover:text-white'
          : 'shrink-0 border-violet-600 bg-black text-violet-100 hover:bg-violet-950 hover:text-white'}>
        {enabled ? 'On' : 'Off'}
      </Button>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid flex-1 gap-1 text-xs text-violet-200">Only hop if at least this many minutes remain
        <Input type="number" min={0} step={1} value={minEta} onChange={event => setDraft(event.target.value)}
          className="border-violet-800 bg-black text-slate-100" />
      </label>
      <Button type="button" variant="outline" disabled={!validEta || Number(minEta) === chase?.minEtaMinutes}
        onClick={() => { save({ minEtaMinutes: Number(minEta) }); setDraft(null); }}
        className="border-violet-500 bg-black text-violet-100 hover:bg-violet-950 hover:text-white">Save</Button>
    </div>
    <p className="text-xs text-slate-400">Hop Sickness lasts 12 minutes; the remaining time is estimated from each boss&apos;s observed HP drain.</p>
    {chase?.trip && <p className="rounded border border-violet-700 bg-violet-950/40 p-2 text-xs text-violet-100">
      {bossLabel[chase.trip.boss] || chase.trip.boss} · {chase.trip.arrived ? (chase.trip.respawnAt ? 'waiting for respawn on ' : 'fighting on ') : 'moving to '}{realmLabel(chase.trip.realm)}
      {chase.trip.respawnAt ? ` at ${new Date(chase.trip.respawnAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
      {chase.trip.returnRealm ? ` · returns to ${realmLabel(chase.trip.returnRealm)}` : ''}
    </p>}
    {enabled && (chase?.sightings?.length ? <ul className="grid gap-1 text-xs text-slate-200">
      {chase.sightings.map(sighting => <li key={sighting.boss + sighting.realm} className="flex justify-between gap-2">
        <span>{bossLabel[sighting.boss] || sighting.boss} · {realmLabel(sighting.realm)}{sighting.target ? ` · ${sighting.target}` : ''}</span>
        <span className="font-mono">{(sighting.hp / 1e6).toFixed(1)}M HP · {sighting.etaMinutes == null ? 'estimating…' : `~${Math.round(sighting.etaMinutes)} min`}</span>
      </li>)}
    </ul> : <p className="text-xs text-slate-400">{chase?.checkedAt ? 'No live bosses reported.' : 'Waiting for the first check…'}</p>)}
    {enabled && !!chase?.respawns?.length && <ul className="grid gap-1 text-xs text-slate-300">
      {chase.respawns.map(entry => <li key={'respawn' + entry.boss + entry.realm} className="flex justify-between gap-2">
        <span>{bossLabel[entry.boss] || entry.boss} · {realmLabel(entry.realm)}</span>
        <span className="font-mono">respawns {new Date(entry.respawnAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </li>)}
    </ul>}
    {chase?.lastError && <p role="alert" className="text-xs text-rose-200">{chase.lastError}</p>}
    {action.error && <p role="alert" className="text-xs text-rose-200">{action.error.message}</p>}
  </fieldset>;
}
