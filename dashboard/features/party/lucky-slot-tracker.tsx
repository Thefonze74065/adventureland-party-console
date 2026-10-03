"use client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { emptyRolls, luckySlotSearch, type LuckySlotTracking } from "../../../runtime/lucky-slot-tracking";
import { validLuckySlot } from "./lucky-upgrade-slot";

export function LuckySlotStatistics({ tracking, verified }: { tracking?: LuckySlotTracking; verified?: number | null }) {
  const rows = Array.from({length: 42}, (_, slot) => {
    const stats = tracking?.slots[slot] || emptyRolls();
    return {slot, ...stats, average: stats.totalRolls ? stats.sumRolls / stats.totalRolls : null};
  });
  const search = luckySlotSearch(tracking || {version: 1, slots: {}});
  const nextSlot = validLuckySlot(verified) ? verified : search.nextSlot;
  const eliminated = new Set(search.eliminated);
  return <div className="space-y-3 text-sm text-zinc-200">
    <p className="rounded border border-amber-600 bg-amber-950 p-3 text-amber-100">{validLuckySlot(verified) ? `Verified slot: ${verified}.` : `Next upgrade will test for lucky upgrade · slot ${nextSlot} (inventory position ${nextSlot + 1}).`}</p>
    <p>{search.total} recorded upgrade rolls · {rows.filter(row => row.totalRolls > 0).length}/42 slots sampled · {eliminated.size}/42 slots ruled out.</p>
    <p>{search.slot === null ? "No evidence yet. Testing starts at slot 0." : `${search.inferred ? 'Statistically inferred' : 'Leading candidate'}: slot ${search.slot} · ${(search.confidence * 100).toFixed(2)}% model confidence · ${search.samples} rolls in that slot.`}</p>
    <p className="text-zinc-300">Normal upgrade jobs rotate through the least-sampled slots that haven&apos;t been ruled out and restore inventory afterward. Once a slot is statistically inferred, upgrades use it while evidence continues to accumulate. No extra upgrades are queued. Slot numbers start at 0.</p>
    <p className="text-zinc-400">Inference requires at least 100 rolls in the leading slot and 99.9% confidence under the published server model. A slot is ruled out once it has at least 100 rolls and a 99.9% chance of being ordinary; new evidence can un-rule-out a slot or change the selected one.</p>
    <div className="max-h-[55vh] overflow-auto rounded border border-zinc-500 bg-zinc-950">
      <table className="w-full text-right text-xs">
        <thead className="sticky top-0 bg-zinc-900 text-zinc-100"><tr>{["Slot", "Rolls", "Average", "> 0.963", "Zero rolls", "Status"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.slot} data-slot={row.slot} className={`border-t border-zinc-700 ${row.slot === nextSlot ? 'bg-amber-950 text-amber-100' : eliminated.has(row.slot) ? 'text-zinc-500' : ''}`}><td className="p-2 text-amber-200">{row.slot}</td><td className="p-2">{row.totalRolls}</td><td className="p-2">{row.average?.toFixed(4) ?? '—'}</td><td className="p-2">{row.rollsAbove96_3} ({row.totalRolls ? (100 * row.rollsAbove96_3 / row.totalRolls).toFixed(1) : '0.0'}%)</td><td className="p-2">{row.perfectRolls} ({row.totalRolls ? (100 * row.perfectRolls / row.totalRolls).toFixed(2) : '0.00'}%)</td><td className="p-2">{row.slot === nextSlot ? 'Next upgrade' : eliminated.has(row.slot) ? 'Ruled out' : row.totalRolls ? 'Sampled' : 'Untested'}</td></tr>)}</tbody>
      </table>
    </div>
  </div>;
}
export function LuckySlotDialog({character, tracking, verified, open, onOpenChange, onReset}: {
  character: string; tracking?: LuckySlotTracking; verified?: number | null; open: boolean; onOpenChange(open: boolean): void;
  onReset?: () => void | Promise<void>;
}) {
  const hasData = !!tracking?.streamId || Object.keys(tracking?.slots || {}).length > 0 || validLuckySlot(verified);
  return <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto border-zinc-500 bg-zinc-950 text-zinc-100 sm:max-w-3xl">
        <DialogHeader><DialogTitle>Lucky slots · {character}</DialogTitle><DialogDescription className="text-zinc-300">Upgrade evidence saved per character in coordinator state, with a local copy for reconnects.</DialogDescription></DialogHeader>
        <LuckySlotStatistics tracking={tracking} verified={verified} />
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            disabled={!hasData || !onReset}
            onClick={() => {
              if (!confirm(`Discard all lucky-slot evidence and the verified slot for ${character}? Use this after deleting and recreating the character, since a new character rolls its own lucky slot.`)) return;
              onReset?.();
            }}
            className="border-rose-500 bg-rose-950 text-rose-100 hover:border-rose-400 hover:bg-rose-900 hover:text-white disabled:border-zinc-600 disabled:bg-zinc-900 disabled:text-zinc-500"
          >
            Reset tracking
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-zinc-500 bg-zinc-900 text-zinc-100 hover:border-zinc-400 hover:bg-zinc-800 hover:text-white">Close</Button>
        </div>
      </DialogContent>
    </Dialog>;
}
