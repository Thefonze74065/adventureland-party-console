'use client';
import { useState } from 'react';
import { useClock } from '@/hooks/use-clock';
import { dungeonCountdown, useDungeons } from './dungeon-query';
import { dungeonButton } from './dungeon-settings';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { PartyConsoleModel } from './use-party-console';
import type { SelectedItem } from './selected-item';
import { PartyItemDetails } from './party-item-details';
import { ItemSprite } from './item-sprite';
import {CaveMap} from './cave-map';

export function DungeonPanel({ model }: { model: PartyConsoleModel }) {
  const query = useDungeons(),
    now = useClock(),
    view = query.data;
  const [vote, setVote] = useState<{
    choice: string;
    option: string;
    cost: number;
    amber: number;
  } | null>(null);
  const [purchase, setPurchase] = useState<string | null>(null);
  const [inspectedChoice, setInspectedChoice] = useState<string | null>(null);
  const [requestedRoom, setRequestedRoom] = useState<string | null>(null);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [itemInspection, setItemInspection] = useState<SelectedItem | null>(null);
  if (!view || ['idle', 'held'].includes(view.state.phase)) return null;
  const sameRun = view.members.filter(member => member.observation?.cave?.run === view.state.run);
  const cave = sameRun.find(member => member.fresh)?.observation?.cave,
    choice = cave?.choice;
  const mapCave = cave || (view.state.phase === 'active' ? sameRun[0]?.observation?.cave : undefined);
  const mapActionsReady = !!mapCave && view.state.participants.every(name => {
    const member = view.members.find(candidate => candidate.name === name);
    return member?.fresh && member.observation?.alive && member.observation.cave?.run === mapCave.run &&
      member.observation.cave.floor === mapCave.floor && !member.observation.cave.paused;
  });
  const mapWaitingForReports = !!mapCave && view.state.participants.every(name => {
    const member = view.members.find(candidate => candidate.name === name);
    return member?.observation?.alive && member.observation.cave?.run === mapCave.run &&
      member.observation.cave.floor === mapCave.floor && !member.observation.cave.paused;
  }) && view.state.participants.some(name => !view.members.find(member => member.name === name)?.fresh);
  const recovery = view.state.priestRecovery;
  const priest = view.members.find((m) => m.name === recovery?.priest);
  const report =
    priest?.fresh && priest.observation?.recovery?.id === recovery?.id
      ? priest.observation?.recovery
      : undefined;
  const channel = view.members.some(
    (m) => !!m.observation?.recovery?.actor.c?.revival,
  );
  const recoveryBusy =
    (!!recovery?.authorized &&
      (!report || !['failed', 'complete'].includes(report.phase))) ||
    channel;
  const recoveryLabel =
    report?.reason ||
    {
      idle: 'Preparing priest recovery',
      healing: 'Healing gravestone',
      waiting: 'Waiting for priest recovery',
      ready: 'Preparing Revive',
      dispatched: 'Revive sent - awaiting confirmation',
      reviving: 'Reviving',
      uncertain: 'Revive outcome unknown - awaiting confirmation',
      failed: 'Priest revival failed - use Nera',
      complete: 'Revival complete',
    }[report?.phase || 'idle'];
  const action = (body: Record<string, unknown>) =>
    query.action({ run: view.state.run, ...body });
  const shopItem = model.state.merchantCatalog?.allItems?.find(item => item.id === choice?.shop?.name);
  const travelling = view.state.progress?.enabled || !!view.state.travel || Object.values(view.state.commands).some(command => command.action === 'move');
  return (
    <section
      aria-label="Cave of Many Dreams controls"
      className="mb-5 rounded border border-slate-500 bg-[#101c1a] p-3 text-emerald-50"
    >
      <div className="flex justify-end"><button
        className="mb-3 rounded border-2 border-red-500 bg-slate-950 px-3 py-2 text-red-100 hover:border-red-300 hover:bg-red-950 disabled:opacity-50"
        disabled={query.busy || view.state.phase === 'exiting'}
        onClick={() => setExitConfirm(true)}
      >Exit dungeon</button></div>
      <Dialog open={exitConfirm} onOpenChange={setExitConfirm}>
        <DialogContent className="border-slate-500 bg-[#101c1a] text-emerald-50" showCloseButton={false}>
          <DialogHeader><DialogTitle>Exit the dungeon?</DialogTitle>
            <DialogDescription className="text-slate-300">The whole party will leave the cave and stop outside. Leave now?</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2">
            <button className={dungeonButton} onClick={() => setExitConfirm(false)}>Stay in dungeon</button>
            <button className="rounded border-2 border-red-500 bg-slate-950 px-3 py-2 text-red-100 hover:bg-red-950 disabled:opacity-50" disabled={query.busy}
              onClick={() => { setExitConfirm(false); void action({action:'exit'}); }}>Confirm exit</button>
          </div>
        </DialogContent>
      </Dialog>
      {view.state.error && (
        <button
          className={dungeonButton}
          disabled={query.busy}
          onClick={() => void action({ action: 'retry' })}
        >
          Retry failed preparation
        </button>
      )}
      {view.members.some(
        (m) => m.fresh && !m.observation?.cave && m.observation?.visit?.resume,
      ) && (
        <button
          className={dungeonButton}
          disabled={query.busy}
          onClick={() => void action({ action: 'recover' })}
        >
          Return missing participants
        </button>
      )}
      <h2 className="font-semibold">Cave of Many Dreams</h2>
      <p>
        {cave
          ? `Floor ${cave.floor + 1} · ${dungeonCountdown(cave.paused ? now + cave.remainingMs : cave.expires, now)} remaining${cave.paused ? ' (paused' + (choice && !choice.resolved ? ' for ' + choice.title : '') + ')' : ''} · ${cave.gold} gold · ${cave.amber} Amber`
          : view.state.phase}
      </p>
      <p className="text-sm text-slate-300">
        {view.members
          .map((m) => m.name + (m.fresh ? '' : ' — awaiting connection'))
          .join(' · ')}
      </p>
      {mapCave && <CaveMap key={mapCave.run+':'+mapCave.floor} view={view} cave={mapCave} action={action} actionsReady={mapActionsReady} waitingForReports={mapWaitingForReports} error={query.actionError}/>}
      {view.state.phase === 'active' && (
        <div className="mt-3">
          <p className="text-sm text-slate-200">
            {view.state.progress?.message || 'Continue through the cave toward the next floor.'}
          </p>
          <button className={dungeonButton} disabled={query.busy || cave?.paused}
            onClick={() => void action({action: 'progress', enabled: !travelling})}>
            {travelling ? 'Stop travel' : 'Start automatic exploration'}
          </button>
          <p className="mt-1 text-xs text-slate-300">Choose a room below to travel there. Automatic exploration visits required rooms and stairs. Stopping travel still allows defensive combat and healing.</p>
        </div>
      )}
      {recovery && (
        <p role="status" className="mt-2 text-sm text-emerald-100">
          {recovery.priest} reviving {recovery.target}: {recoveryLabel}
        </p>
      )}
      {!recovery &&
        view.members.some((m) => m.observation?.alive === false) && (
          <p role="status" className="mt-2 text-sm text-slate-200">
            {view.state.manualRecovery
              ? 'Nera recovery requested'
              : 'Waiting for an available priest with an Essence of Life. Call Nera if needed.'}
          </p>
        )}
      {view.members.some((m) => m.observation?.alive === false) && (
        <button
          className={dungeonButton}
          disabled={
            query.busy ||
            view.state.phase !== 'active' ||
            recoveryBusy ||
            (!!choice && !choice.resolved)
          }
          onClick={() => void action({ action: 'revival' })}
        >
          Call Nera — revival choices
        </button>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {cave?.points.filter((p) => !p.exit).map((p) => (
          <button
            className={dungeonButton + (p.done ? ' !border-2 !border-green-500 disabled:!opacity-80' : p.required ? ' !border-2 !border-orange-500' : '')}
            key={p.id}
            disabled={
              query.busy ||
              cave.paused ||
              p.locked ||
              p.done ||
              view.state.phase !== 'active'
            }
            onClick={() => {
              setRequestedRoom(p.room || null);
              if (choice?.shop?.nearby && p.room === choice.shop.room) setInspectedChoice(choice.id);
              else void action({ action: 'move', target: p.id });
            }}
          >
            {p.label}
            {p.map !== 'zone_'+cave.run+'_'+cave.floor ? ' — different floor' : ''}
            {p.locked ? ' — locked' : p.done ? ' — complete' : ''}
          </button>
        ))}
      </div>
      {choice?.resolved && <button className={dungeonButton + ' mt-3'} onClick={() => setInspectedChoice(choice.id)}>
        View encounter — {choice.title}
      </button>}
      {choice && (
        <Dialog open={!choice.resolved || inspectedChoice === choice.id || !!(choice.shop?.nearby && requestedRoom === choice.shop.room)}
          onOpenChange={(open) => { if (!open && choice.resolved) { setInspectedChoice(null); setRequestedRoom(null); } }}>
        <DialogContent aria-label="Cave choice" showCloseButton={choice.resolved}
          className="max-h-[85vh] overflow-auto border-slate-500 bg-[#101c1a] text-emerald-50 [&_[data-slot=dialog-close]]:border [&_[data-slot=dialog-close]]:border-slate-500 [&_[data-slot=dialog-close]]:bg-slate-950 [&_[data-slot=dialog-close]]:text-emerald-50 [&_[data-slot=dialog-close]]:hover:bg-slate-800"
          >
          <DialogHeader>
            <DialogTitle>{choice.title}</DialogTitle>
            <p className="text-sm font-semibold text-amber-200">Party funds: {cave.gold.toLocaleString()} gold · {cave.amber.toLocaleString()} Amber</p>
            <DialogDescription className="text-slate-300">{choice.resolved ? 'Encounter result' : 'The cave timer and route are paused until the party answers.'}</DialogDescription>
          </DialogHeader>
          <p>{choice.text}</p>
          {choice.resolved && <p className="text-amber-200">{choice.resultLabel || 'This choice has ended.'} {choice.summary?.join(' ')}</p>}
          {!choice.resolved && (
            <p>Vote closes in {dungeonCountdown(choice.deadline, now)}</p>
          )}
          {!choice.resolved && <p className="text-xs text-slate-300">The cave offers two replies for each encounter. Other gifts or replies mentioned in the story may not be offered on this visit.</p>}
          {!choice.resolved && <div className="grid grid-cols-2 gap-2">
            {choice.options.map((o) => (
              <button
                className={dungeonButton}
                key={o.id}
                disabled={
                  query.busy ||
                  choice.resolved ||
                  now >= choice.deadline ||
                  !!o.unavailable
                }
                onClick={() => {
                  if (o.cost || o.amber)
                    setVote({
                      choice: choice.id,
                      option: o.id,
                      cost: o.cost || 0,
                      amber: o.amber || 0,
                    });
                  else
                    void action({
                      action: 'vote',
                      choice: choice.id,
                      option: o.id,
                    });
                }}
              >
                {o.label}
                {o.cost ? ` — ${o.cost} shared gold` : ''}
                {o.amber ? ` — ${o.amber} Amber` : ''}
                {o.unavailable ? ` — ${o.unavailable}` : ''}
                <span className="block text-xs">
                  {Object.entries(choice.votes)
                    .filter(([, id]) => id === o.id)
                    .map(([name]) => name)
                    .join(', ')}
                </span>
              </button>
            ))}
          </div>}
          {vote?.choice === choice.id && !choice.resolved && (
            <div role="group" aria-label="Confirm paid dungeon choice">
              <p>
                Spend {vote.cost} shared gold and {vote.amber} Amber if this
                choice wins?
              </p>
              <button
                className={dungeonButton}
                disabled={query.busy}
                onClick={() => {
                  void action({
                    action: 'vote',
                    choice: vote.choice,
                    option: vote.option,
                    cost: vote.cost,
                    amber: vote.amber,
                    confirmed: true,
                  });
                  setVote(null);
                }}
              >
                Confirm vote
              </button>
              <button className={dungeonButton} onClick={() => setVote(null)}>
                Cancel
              </button>
            </div>
          )}
          {choice.shop && (
            <div className="mt-2">
              <p>
                {shopItem?.name || choice.shop.name} — {choice.shop.price} shared gold
                {choice.shop.sold ? ' — sold' : ''}
              </p>
              <button className={dungeonButton + ' my-2 flex items-center gap-3'} aria-label="Inspect cave shop item"
                onClick={() => setItemInspection({character: view.members[0]?.name || '', entry:{slot:-1,item:{name:choice.shop!.name,level:0},meta:shopItem?.meta}})}>
                <span className="relative h-12 w-12 bg-black">{shopItem?.sprite && <ItemSprite sprite={shopItem.sprite} />}</span>
                {shopItem?.name || choice.shop.name} — view details
              </button>
              <PartyItemDetails model={{...model, selected:itemInspection, setSelected:setItemInspection}} />
              <button
                className={dungeonButton}
                disabled={
                  query.busy ||
                  choice.shop.sold ||
                  !choice.resolved ||
                  !choice.shop.nearby ||
                  cave!.gold < choice.shop.price
                }
                onClick={() => setPurchase(choice.id)}
              >
                Buy…
              </button>
              {purchase === choice.id && (
                <div role="group" aria-label="Confirm dungeon purchase">
                  <p>
                    Spend {choice.shop.price} shared gold on {shopItem?.name || choice.shop.name}?
                  </p>
                  <button
                    className={dungeonButton}
                    onClick={() => {
                      setPurchase(null);
                      void action({
                        action: 'buy',
                        choice: choice.id,
                        cost: choice.shop!.price,
                        confirmed: true,
                      });
                    }}
                  >
                    Confirm purchase
                  </button>
                  <button
                    className={dungeonButton}
                    onClick={() => setPurchase(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
          {query.actionError && <p role="alert" className="text-rose-200">{query.actionError}</p>}
          <button className="rounded border-2 border-red-500 bg-slate-950 px-3 py-2 text-red-100 hover:bg-red-950 disabled:opacity-50"
            disabled={query.busy || view.state.phase === 'exiting'} onClick={() => setExitConfirm(true)}>Exit dungeon</button>
        </DialogContent>
        </Dialog>
      )}
      {(query.actionError || view.state.error) && (
        <p role="alert" className="text-rose-200">
          {query.actionError || view.state.error}
        </p>
      )}
    </section>
  );
}
