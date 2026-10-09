"use client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { emptyRolls, luckySlotSearch, type LuckySlotTracking } from "../../../runtime/lucky-slot-tracking";
import { validLuckySlot } from "./lucky-upgrade-slot";

interface LuckySlotControls {
  lockedSlot?: number | null;
  resumingSlot?: number | null;
  onLock?(slot: number): void;
}
export function LuckySlotStatistics({ tracking, verified, lockedSlot, resumingSlot, onLock }: { tracking?: LuckySlotTracking; verified?: number | null } & LuckySlotControls) {
  const rows = Array.from({length: 42}, (_, slot) => {
    const stats = tracking?.slots[slot] || emptyRolls();
    return {slot, ...stats, average: stats.totalRolls ? stats.sumRolls / stats.totalRolls : null};
  });
  const search = luckySlotSearch(tracking || {version: 1, slots: {}});
  const nextSlot = validLuckySlot(lockedSlot) ? lockedSlot : validLuckySlot(resumingSlot) ? resumingSlot : validLuckySlot(verified) ? verified : search.nextSlot;
  return <div className="space-y-3 text-sm text-zinc-200">
    <p className="rounded border border-amber-600 bg-amber-950 p-3 text-amber-100">{validLuckySlot(lockedSlot) ? `Locked slot: ${lockedSlot}. Rolls continue to accumulate in this position.` : validLuckySlot(verified) && !validLuckySlot(resumingSlot) ? `Verified slot: ${verified}.` : `Next upgrade will test for lucky upgrade · slot ${nextSlot} (inventory position ${nextSlot + 1}).`}</p>
    <p>{search.ruledOutCount}/42 slots ruled out.</p>
    <p>{search.total} recorded upgrade rolls · {rows.filter(row => row.totalRolls > 0).length}/42 slots sampled.</p>
    <p>{search.slot === null ? "No evidence yet. Testing starts at slot 0." : `${search.inferred ? 'Statistically inferred' : 'Leading candidate'}: slot ${search.slot} · ${(search.confidence * 100).toFixed(2)}% model confidence · ${search.samples} rolls in that slot.`}</p>
    <p className="text-zinc-300">Normal upgrade jobs rotate through the least-sampled remaining candidates and restore inventory afterward. Once a slot is statistically inferred, upgrades use it while evidence continues to accumulate. No extra upgrades are queued. Slot numbers start at 0.</p>
    <p className="text-zinc-400">Inference requires at least 100 rolls in the leading slot and 99.9% confidence under the published server model. New evidence can change the selected slot. A slot with at least 100 rolls is ruled out when its ordinary probability reaches 99.9% in the same joint model; new evidence can restore it as a candidate.</p>
    <div className="max-h-[55vh] overflow-auto rounded border border-zinc-500 bg-zinc-950">
      <table className="w-full text-right text-xs">
        <thead className="sticky top-0 bg-zinc-900 text-zinc-100"><tr>{["Slot", "Rolls", "Average", "> 0.963", "Zero rolls", "Status", "Position lock"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.slot} data-slot={row.slot} className={`border-t border-zinc-700 ${row.slot === search.slot && search.confidence > 0.95 ? 'bg-green-900 text-green-100' : row.slot === nextSlot ? 'bg-amber-950 text-amber-100' : ''}`}><td className="p-2 text-amber-200">{row.slot}</td><td className="p-2">{row.totalRolls}</td><td className="p-2">{row.average?.toFixed(4) ?? '—'}</td><td className="p-2">{row.rollsAbove96_3} ({row.totalRolls ? (100 * row.rollsAbove96_3 / row.totalRolls).toFixed(1) : '0.0'}%)</td><td className="p-2">{row.perfectRolls} ({row.totalRolls ? (100 * row.perfectRolls / row.totalRolls).toFixed(2) : '0.00'}%)</td><td className="p-2">{[row.slot === lockedSlot ? 'Locked' : row.slot === nextSlot ? 'Next upgrade' : '', search.slots[row.slot]?.ruledOut ? 'Ruled out' : row.slot !== lockedSlot && row.slot !== nextSlot ? row.totalRolls ? 'Sampled' : 'Untested' : ''].filter(Boolean).join(' � ')}</td><td className="p-2"><Button size="sm" variant="outline" aria-label={`${row.slot === lockedSlot ? "Unlock" : "Lock"} lucky slot position · slot ${row.slot}`} disabled={!onLock || validLuckySlot(lockedSlot) && row.slot !== lockedSlot} onClick={() => onLock?.(row.slot)} className="border-zinc-500 bg-zinc-900 text-zinc-100 hover:border-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50">{row.slot === lockedSlot ? "Unlock" : "Lock"}</Button></td></tr>)}</tbody>
      </table>
    </div>
  </div>;
}
export function LuckySlotDialog({character, tracking, verified, lockedSlot, resumingSlot, onLock, open, onOpenChange}: {
  character: string; tracking?: LuckySlotTracking; verified?: number | null; open: boolean; onOpenChange(open: boolean): void;
} & LuckySlotControls) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto border-zinc-500 bg-zinc-950 text-zinc-100 sm:max-w-3xl">
        <DialogHeader><DialogTitle>Lucky slots · {character}</DialogTitle><DialogDescription className="text-zinc-300">Upgrade evidence saved per character in coordinator state, with a local copy for reconnects.</DialogDescription></DialogHeader>
        <LuckySlotStatistics tracking={tracking} verified={verified} lockedSlot={lockedSlot} resumingSlot={resumingSlot} onLock={onLock} />
        <Button variant="outline" onClick={() => onOpenChange(false)} className="border-zinc-500 bg-zinc-900 text-zinc-100 hover:border-zinc-400 hover:bg-zinc-800 hover:text-white">Close</Button>
      </DialogContent>
    </Dialog>;
}
