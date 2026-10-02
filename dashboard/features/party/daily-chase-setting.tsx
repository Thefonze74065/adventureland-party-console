"use client";
import { useState } from 'react';
import type { DailyChaseState } from '../../../runtime/coordinator/events/daily-chase';
import { usePartyAction } from './query-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const realmLabel = (realm: string) => realm.replace(/^SR_/, '').replace(/(US|EU|ASIA)/, '$1 ');
const eventLabel: Record<string, string> = {
  crabxx: 'Giga Crab', goobrawl: 'Goo Brawl', abtesting: 'A/B Testing', icegolem: 'Ice Golem', franky: 'Franky',
};
const timeLabel = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const toggleClass = (on: boolean) => on
  ? 'shrink-0 border-violet-300 bg-violet-600 text-white hover:bg-violet-500 hover:text-white'
  : 'shrink-0 border-violet-600 bg-black text-violet-100 hover:bg-violet-950 hover:text-white';

export function DailyChaseSetting({ chase }: { chase?: DailyChaseState | null }) {
  // An unsaved edit overrides the coordinator value; clearing it follows the server again.
  const [draft, setDraft] = useState<string | null>(null);
  const lead = draft ?? String(chase?.leadMinutes ?? 16);
  const action = usePartyAction();
  const enabled = chase?.enabled === true, otherRegions = chase?.otherRegions === true;
  const validLead = lead.trim() !== '' && Number(lead) >= 14 && Number(lead) <= 120;
  const save = (body: { enabled?: boolean; leadMinutes?: number; otherRegions?: boolean }) => {
    action.reset();
    action.mutate({ path: '/realm/daily-chase', body });
  };
  return <fieldset disabled={action.isPending} className="mt-4 space-y-3 rounded border border-violet-800 bg-[#0b0d14] p-3 text-sm text-slate-100">
    <legend className="sr-only">Scheduled event realm prediction</legend>
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="font-semibold text-violet-100">Predict scheduled events across realms</p>
        <p className="text-xs text-slate-300">Each realm repeats a fixed cycle: dailies every 3 slots, nightlies (Ice Golem/Franky) every 2. When this realm won&apos;t get a selected event, move the party ahead of the slot to a realm predicted to get it, then return home.</p>
      </div>
      <Button type="button" variant="outline" aria-pressed={enabled} onClick={() => save({ enabled: !enabled })} className={toggleClass(enabled)}>
        {enabled ? 'On' : 'Off'}
      </Button>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid flex-1 gap-1 text-xs text-violet-200">Arrive this many minutes before the slot (min 14)
        <Input type="number" min={14} max={120} step={1} value={lead} onChange={event => setDraft(event.target.value)}
          className="border-violet-800 bg-black text-slate-100" />
      </label>
      <Button type="button" variant="outline" disabled={!validLead || Number(lead) === chase?.leadMinutes}
        onClick={() => { save({ leadMinutes: Number(lead) }); setDraft(null); }}
        className="border-violet-500 bg-black text-violet-100 hover:bg-violet-950 hover:text-white">Save</Button>
    </div>
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-slate-300">Also chase other regions&apos; slots (extra events at different times)</p>
      <Button type="button" variant="outline" aria-pressed={otherRegions} onClick={() => save({ otherRegions: !otherRegions })} className={toggleClass(otherRegions)}>
        {otherRegions ? 'On' : 'Off'}
      </Button>
    </div>
    {chase?.trip && <p className="rounded border border-violet-700 bg-violet-950/40 p-2 text-xs text-violet-100">
      {eventLabel[chase.trip.event]} · {chase.trip.arrived ? 'waiting on ' : 'moving to '}{realmLabel(chase.trip.realm)} for {timeLabel(chase.trip.slotAt)}
      {chase.trip.returnRealm ? ` · returns to ${realmLabel(chase.trip.returnRealm)}` : ''}
    </p>}
    <ul className="grid gap-1 text-xs text-slate-200">
      {(chase?.upcoming || []).map(next => <li key={next.rotation + next.region} className="flex justify-between gap-2">
        <span className="font-mono text-violet-200">{next.region} {next.rotation} {timeLabel(next.slotAt)}</span>
        <span className="text-right">{next.predictions.length
          ? next.predictions.map(entry => `${realmLabel(entry.realm)}: ${eventLabel[entry.event]}`).join(' · ')
          : 'no predictions yet'}</span>
      </li>)}
    </ul>
    <p className="text-xs text-slate-400">Predictions come from sightings: the party&apos;s own realm, plus Giga Crab, Goo Brawl, Ice Golem and Franky bosses reported to ALData.</p>
    {chase?.lastError && <p role="alert" className="text-xs text-rose-200">{chase.lastError}</p>}
    {action.error && <p role="alert" className="text-xs text-rose-200">{action.error.message}</p>}
  </fieldset>;
}
