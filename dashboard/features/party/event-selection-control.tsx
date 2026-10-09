"use client";
import { CaveEventRow } from './dungeon-settings';
import { memo } from "react";
import { Settings } from "lucide-react";

import { useClock } from "@/hooks/use-clock";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { eventDisplayNames, eventPolicy, selectedEvents, supportedEvents } from "@/lib/event-policy";
import { PartyState } from "./party-state";

export type EventSchedule = { id: string; name: string; live?: boolean; next?: number; expires?: number; stale?: boolean; slotAt?: number; slotKind?: string };
export type EventSelectionState = Pick<PartyState, "leader" | "merchantCharacter" | "followers" |
  "eventsByCharacter" | "eventSelectionsByCharacter" | "eventSchedules"> &
  Partial<Pick<PartyState, "dailyChase" | "realmControl">>;
export function eventTimeLabel(next: number | undefined, now: number) {
  if (!next || !Number.isFinite(next)) return "Time not announced";
  const ms = next < 1e12 ? next * 1000 : next;
  const remaining = Math.max(0, ms - now);
  return `${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(ms)} (${Math.floor(remaining / 60000)}m ${Math.floor(remaining / 1000) % 60}s)`;
}
export const EventSelectionControl = memo(function EventSelectionControl({ state, name, onChange, onAnniversary, onFranky }: {
  state: EventSelectionState; name: string; merchant: boolean; onAnniversary: () => void; onFranky?: () => void; onChange: (events: string[]) => void;
}) {
  const now = useClock(), policy = eventPolicy(state, name), selected = selectedEvents(state, name);
  // Each server fires exactly one event of a rotation per slot (node/server.js dailies/nightlies).
  const exclusiveGroups = [
    { rotation: "daily", label: "Daily — one of these per slot", events: ["crabxx", "goobrawl", "abtesting"] },
    { rotation: "nightly", label: "Nightly — one of these per night", events: ["icegolem", "franky"] },
  ] as const;
  const groupedEvents: readonly string[] = exclusiveGroups.flatMap(group => [...group.events]);
  /** The event-prediction panel's guess for the party's current realm at the rotation's next slot. */
  function predictedEvent(state: EventSelectionState, rotation: string): string | null {
    const realm = state.realmControl?.currentRealm, region = realm && /^SR_(US|EU|ASIA)/.exec(realm)?.[1];
    const next = region ? state.dailyChase?.upcoming?.find(entry => entry.rotation === rotation && entry.region === region) : undefined;
    return next?.predictions.find(entry => entry.realm === realm)?.event ?? null;
  }
  // Server schedules are observations, not the supported catalog: seasonal
  // bosses must remain selectable even when the current feed omits them.
  const schedules = new Map((state.eventSchedules ?? []).map(event => [event.id, event]));
  const catalog: EventSchedule[] = [...new Set([...supportedEvents, ...schedules.keys()])].map(id => {
    const schedule = schedules.get(id);
    return { ...schedule, id, name: eventDisplayNames[id] ?? schedule?.name ?? id };
  });
  const row = (event: EventSchedule, predicted?: string | null) => {
    const supported = supportedEvents.includes(event.id), allowed = supported;
    const timing = !supported ? "Unsupported" : event.live ? "LIVE" : event.next ? eventTimeLabel(event.next, now)
      : event.slotAt ? `Next slot: ${eventTimeLabel(event.slotAt, now)}` : "Time not announced";
    const prediction = event.live || predicted === undefined ? "" : predicted === null ? " · not predicted yet"
      : predicted === event.id ? " · predicted here" : " · not here this slot";
    return <div key={event.id} className="flex items-center gap-2 py-2">
      <input type="checkbox" checked={allowed && selected.includes(event.id)} disabled={!allowed || policy.inherited}
        className="accent-emerald-500" onChange={e => onChange(e.target.checked ? [...selected, event.id] : selected.filter(id => id !== event.id))} />
      <span>{event.name} — {timing}{prediction}{event.stale ? " · timing stale" : ""}</span>
      {event.id === "anniversary" && <button type="button" aria-label="Anniversary settings" onClick={onAnniversary} className="ml-auto rounded border border-slate-500 bg-slate-950 p-2 text-pink-200 hover:bg-slate-800"><Settings className="size-4" /></button>}
      {event.id === "franky" && onFranky && <button type="button" aria-label="Franky routine settings" onClick={onFranky} className="ml-auto rounded border border-slate-500 bg-slate-950 p-2 text-amber-200 hover:bg-slate-800"><Settings className="size-4" /></button>}
    </div>;
  };
  return <Popover>
    <PopoverTrigger className="cursor-pointer rounded border border-slate-500 bg-[#101c1a] px-2 py-1 text-xs text-emerald-100 hover:bg-[#20332e]">Events ({selected.length}) ▾</PopoverTrigger>
    <PopoverContent align="start" className="max-h-[min(20rem,var(--available-height))] w-96 max-w-[calc(100vw-1rem)] overflow-auto rounded border border-slate-500 bg-[#101c1a] p-3 text-xs text-emerald-50 shadow-xl">
      {policy.inherited && <p className="mb-2 text-amber-200">Using {policy.source}’s events</p>}
      <CaveEventRow />
      {exclusiveGroups.map(group => {
        const members = catalog.filter(event => (group.events as readonly string[]).includes(event.id));
        if (!members.length) return null;
        const predicted = predictedEvent(state, group.rotation);
        return <section key={group.rotation} aria-label={group.label} className="my-2 rounded border border-slate-600 bg-[#0b1513] px-2">
          <p className="pt-2 font-mono text-[10px] uppercase tracking-wider text-emerald-300">{group.label}</p>
          {members.map(event => row(event, predicted))}
        </section>;
      })}
      {[...catalog].filter(event => !groupedEvents.includes(event.id)).sort((a, b) => a.name.localeCompare(b.name)).map(event => row(event))}
    </PopoverContent>
  </Popover>;
});
