"use client";
import { memo } from "react";
import { Settings } from "lucide-react";

import { useClock } from "@/hooks/use-clock";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { eventPolicy, selectedEvents, supportedEvents } from "@/lib/event-policy";
import { PartyState } from "./party-state";

export type EventSchedule = { id: string; name: string; live?: boolean; next?: number; expires?: number; stale?: boolean; slotAt?: number; slotKind?: string };
export type EventSelectionState = Pick<PartyState, "leader" | "merchantCharacter" | "followers" |
  "eventsByCharacter" | "eventSelectionsByCharacter" | "eventSchedules">;
export function eventTimeLabel(next: number | undefined, now: number) {
  if (!next || !Number.isFinite(next)) return "Time not announced";
  const ms = next < 1e12 ? next * 1000 : next;
  const remaining = Math.max(0, ms - now);
  return `${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(ms)} (${Math.floor(remaining / 60000)}m ${Math.floor(remaining / 1000) % 60}s)`;
}
export const EventSelectionControl = memo(function EventSelectionControl({ state, name, onChange, onAnniversary }: {
  state: EventSelectionState; name: string; merchant: boolean; onAnniversary: () => void; onChange: (events: string[]) => void;
}) {
  const now = useClock(), policy = eventPolicy(state, name), selected = selectedEvents(state, name);
  const catalog: EventSchedule[] = state.eventSchedules?.length ? state.eventSchedules : supportedEvents.map(id => ({ id, name: id }));
  return <Popover>
    <PopoverTrigger className="cursor-pointer rounded border border-slate-500 bg-[#101c1a] px-2 py-1 text-xs text-emerald-100 hover:bg-[#20332e]">Events ({selected.length}) ▾</PopoverTrigger>
    <PopoverContent align="start" className="max-h-[min(20rem,var(--available-height))] w-96 max-w-[calc(100vw-1rem)] overflow-auto rounded border border-slate-500 bg-[#101c1a] p-3 text-xs text-emerald-50 shadow-xl">
      {policy.inherited && <p className="mb-2 text-amber-200">Using {policy.source}’s events</p>}
      {catalog.map(event => {
        const supported = supportedEvents.includes(event.id), allowed = supported;
        return <div key={event.id} className="flex items-center gap-2 py-2">
          <input type="checkbox" checked={allowed && selected.includes(event.id)} disabled={!allowed || policy.inherited}
            className="accent-emerald-500" onChange={e => onChange(e.target.checked ? [...selected, event.id] : selected.filter(id => id !== event.id))} />
          <span>{event.name} — {!supported ? "Unsupported" : event.live ? "LIVE" : event.next ? eventTimeLabel(event.next, now) : event.slotAt ? `Next ${event.slotKind} slot: ${eventTimeLabel(event.slotAt, now)} · event not guaranteed` : "Time not announced"}{event.stale ? " · timing stale" : ""}</span>
          {event.id === "anniversary" && <button type="button" aria-label="Anniversary settings" onClick={onAnniversary} className="ml-auto rounded border border-slate-500 bg-slate-950 p-2 text-pink-200 hover:bg-slate-800"><Settings className="size-4" /></button>}
        </div>;
      })}
    </PopoverContent>
  </Popover>;
});
