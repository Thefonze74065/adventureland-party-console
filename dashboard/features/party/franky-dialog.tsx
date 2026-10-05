"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

type Encounter = "franky" | "halloween";
const encounterCopy: Record<Encounter, { title: string; boss: string; offtank: string; tank: string }> = {
  franky: { title: "Franky routine", boss: "Franky", offtank: "Stack on whoever else has aggro; leave the room if Franky targets you",
    tank: "Engage Franky directly and hold at weapon range, like normal combat" },
  halloween: { title: "Halloween routine", boss: "the Halloween boss",
    offtank: "Attack once someone else has held the boss for 5 seconds; step out of its range if it targets you",
    tank: "Engage Mr. Pumpkin or Mr. Green directly and hold at weapon range" },
};
const frankyModes: { id: string; label: string; description: string; color: string }[] = [
  {
    id: "auto",
    label: "Auto",
    description: "Try Tank first; switch to Off-tank for good after too many deaths (below)",
    color: "border-cyan-600 bg-cyan-950 text-cyan-100 hover:bg-cyan-900",
  },
  {
    id: "offtank",
    label: "Off-tank",
    description: "Stack on whoever else has aggro; leave the room if Franky targets you",
    color: "border-emerald-600 bg-emerald-950 text-emerald-100 hover:bg-emerald-900",
  },
  {
    id: "tank",
    label: "Tank",
    description: "Engage Franky directly and hold at weapon range, like normal combat",
    color: "border-amber-600 bg-amber-950 text-amber-100 hover:bg-amber-900",
  },
];

export function FrankyDialog({
  encounter = "franky",
  open,
  onOpenChange,
  character,
  mode,
  inherited,
  onSelect,
  autoDeathLimit,
  autoDeaths,
  onAutoDeathLimitChange,
}: {
  encounter?: Encounter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  character: string;
  mode: string;
  inherited?: boolean;
  onSelect: (mode: string) => Promise<void>;
  autoDeathLimit: number;
  autoDeaths: number;
  onAutoDeathLimitChange: (deathLimit: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState(String(autoDeathLimit));
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setLimitDraft(String(autoDeathLimit));
  }, [open, autoDeathLimit]);
  async function select(id: string) {
    setBusy(id);
    setError(null);
    try {
      await onSelect(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save " + encounterCopy[encounter].title.toLowerCase());
    } finally {
      setBusy(null);
    }
  }
  async function saveLimit() {
    const value = Math.round(Number(limitDraft));
    if (!Number.isFinite(value) || value < 0) {
      setLimitError("Enter 0 or a positive number of deaths.");
      return;
    }
    setLimitBusy(true);
    setLimitError(null);
    try {
      await onAutoDeathLimitChange(value);
    } catch (e) {
      setLimitError(e instanceof Error ? e.message : "Could not save the death limit");
    } finally {
      setLimitBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-amber-800 bg-[#0b1110] text-emerald-50 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-amber-200">{encounterCopy[encounter].title} · {character}</DialogTitle>
          <DialogDescription className="text-emerald-100/60">
            Choose how this character reacts to {encounterCopy[encounter].boss}&apos;s aggro once it&apos;s live.
          </DialogDescription>
        </DialogHeader>
        {inherited && <p className="text-xs text-cyan-100">Inherited from the leader.</p>}
        <div className="flex flex-col gap-2">
          {frankyModes.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={inherited || busy !== null}
              aria-pressed={mode === entry.id}
              onClick={() => void select(entry.id)}
              className={`rounded border px-3 py-2 text-left transition-colors disabled:opacity-50 ${entry.color} ${
                mode === entry.id ? "ring-2 ring-white/70" : "opacity-80"
              }`}
            >
              <p className="font-mono text-xs uppercase">{busy === entry.id ? "Saving…" : entry.label}</p>
              <p className="mt-0.5 text-xs font-normal opacity-90">
                {entry.id === "offtank" ? encounterCopy[encounter].offtank : entry.id === "tank" ? encounterCopy[encounter].tank : entry.description}
              </p>
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
        )}
        <div className="rounded border border-slate-700 bg-black/30 p-3">
          <p className="text-xs text-emerald-100/80">
            In Auto mode, this character tries Tank first. After this many deaths to
            {" "}{encounterCopy[encounter].boss} while auto-tanking, Auto switches to Off-tank for good. Set to 0 to
            skip Tank entirely in Auto mode. Raising the limit later lets it try Tank again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              aria-label="Auto-tank death limit"
              type="number"
              min={0}
              step={1}
              value={limitDraft}
              disabled={inherited || limitBusy}
              onChange={(e) => setLimitDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveLimit();
              }}
              className="w-24 border-slate-600 bg-[#07100f] text-emerald-50"
            />
            <button
              type="button"
              disabled={inherited || limitBusy}
              onClick={() => void saveLimit()}
              className="rounded border border-slate-500 bg-slate-950 px-3 py-1.5 text-xs text-emerald-100 hover:bg-slate-800 disabled:opacity-50"
            >
              {limitBusy ? "Saving…" : "Set"}
            </button>
            <span className="text-xs text-amber-200">
              Deaths while auto-tanking: {autoDeaths}
              {autoDeathLimit > 0 ? `/${autoDeathLimit}` : ""}
            </span>
          </div>
          {limitError && (
            <p role="alert" className="mt-2 text-sm text-rose-200">
              {limitError}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
