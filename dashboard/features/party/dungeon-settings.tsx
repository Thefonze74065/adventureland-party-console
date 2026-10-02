'use client';
import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useClock } from '@/hooks/use-clock';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { dungeonEntryLabel, useDungeons } from './dungeon-query';

export const dungeonButton =
  'rounded border border-slate-500 bg-slate-950 px-3 py-2 text-emerald-50 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';
export function CaveEventRow() {
  const [open, setOpen] = useState(false);
  const query = useDungeons(),
    now = useClock(),
    view = query.data;
  useEffect(() => {
    if (view?.state.phase === 'active') setOpen(false);
  }, [view?.state.phase]);
  const resume = view?.members[0]?.observation?.visit?.resume;
  const eligible =
    !!view?.members.length &&
    view.members.length <= 3 &&
    view.members.every(
      (m) =>
        m.fresh &&
        m.observation?.supported &&
        m.observation.visit &&
        now - m.observation.visit.checkedAt < 45000 &&
        (m.observation.visit.available || m.observation.visit.resume),
    );
  return (
    <div className="flex items-center gap-2 border-b border-slate-600 py-2">
      <span>Cave of Many Dreams — {dungeonEntryLabel(view, now)}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          aria-label="Cave of Many Dreams settings"
          className={dungeonButton + ' ml-auto'}
        >
          <Settings className="size-4" />
        </DialogTrigger>
        <DialogContent
          showCloseButton={false}
          className="max-h-[85vh] overflow-auto border-slate-500 bg-[#101c1a] text-emerald-50"
        >
          <DialogHeader>
            <DialogTitle>Cave of Many Dreams</DialogTitle>
            <DialogDescription className="text-slate-300">
              Manual entry and event protection
            </DialogDescription>
          </DialogHeader>
          <p>{dungeonEntryLabel(view, now)}</p>
          {resume && (
            <p>Resume on {resume.server}. Realm changes are manual.</p>
          )}
          <p>
            Participants:{' '}
            {view?.members
              .map((m) => m.name + (m.fresh ? '' : ' (offline)'))
              .join(', ') || 'Select a leader and combat followers'}
            .
          </p>
          {view?.members.filter((m) => m.observation?.visitError).map((m) => (
            <p key={m.name} className="text-amber-200">
              {m.name}: eligibility check failed ({m.observation?.visitError}); retrying.
            </p>
          ))}
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 accent-emerald-500"
              checked={view?.state.protectFromEvents !== false}
              disabled={!view || query.busy}
              onChange={(e) =>
                void query.action({
                  action: 'settings',
                  protectFromEvents: e.target.checked,
                })
              }
            />
            Don’t leave the Cave of Many Dreams for other events
          </label>
          <p className="text-sm text-slate-300">
            Disabling this allows enabled events, including Anniversary, to end
            your visit. You may not be able to enter again until the daily
            reset.
          </p>
          <button
            className={dungeonButton}
            disabled={
              !eligible ||
              query.busy ||
              (!!view && !['idle', 'held'].includes(view.state.phase))
            }
            onClick={() =>
              void query.action({ action: resume ? 'resume' : 'enter' })
            }
          >
            {resume ? 'Resume visit' : 'Enter now'}
          </button>
          {view?.state.phase === 'held' && (
            <button
              className={dungeonButton}
              disabled={query.busy}
              onClick={() => void query.action({ action: 'release' })}
            >
              Resume ordinary activity
            </button>
          )}
          {!eligible && (
            <p className="text-amber-200">
              Entry needs fresh eligible characters: a leader and at most two
              combat followers, excluding the merchant.
            </p>
          )}
          {(query.actionError || query.error || view?.state.error) && (
            <p role="alert" className="text-rose-200">
              {query.actionError || query.error?.message || view?.state.error}
            </p>
          )}
          <DialogClose className={dungeonButton}>Close</DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}
