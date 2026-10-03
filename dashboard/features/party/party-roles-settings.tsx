"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "none";

export function PartyRolesSettings({
  tank,
  characters,
  onSelectTank,
}: {
  tank: string | null;
  characters: string[];
  onSelectTank: (name: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded border border-emerald-900 bg-[#071315] p-3 text-sm text-emerald-100">
      <label className="grid gap-1 text-xs uppercase tracking-wider text-emerald-400">
        Tank
        <Select
          value={tank || NONE}
          onValueChange={(value) => onSelectTank(value === NONE ? null : value)}
        >
          <SelectTrigger className="min-w-40 border-cyan-800 bg-black/30 text-sm text-emerald-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {characters.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <p className="max-w-sm text-xs text-emerald-100/60">
        Holds melee range for the party regardless of class, owns taunt/absorb aggro-pulling, and
        swaps into its highest-luck available gear right before a kill.
      </p>
    </div>
  );
}
