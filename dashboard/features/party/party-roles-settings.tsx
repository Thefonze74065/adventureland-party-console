"use client";
import { useId } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "none";

export type PartyRoles = {
  tank: string | null;
  offTank: string | null;
  pullMode: boolean;
  characters: string[];
  formation: (body: { tank?: string | null; offTank?: string | null; pullMode?: boolean }) => void;
};

const TANK_HINT = "The tank holds its target at its own range, owns taunt and absorb, and swaps into its saved luck gear set right before a kill.";
const OFF_TANK_HINT = "The off tank takes the tank's attackers while the tank is in danger and hands them back once it recovers.";
const PULL_HINT = "With Pull on, the party waits outside the pack and its longest-range member draws one monster at a time.";

function RolePicker({
  label,
  hint,
  value,
  characters,
  onSelect,
}: {
  label: string;
  hint: string;
  value: string | null;
  characters: string[];
  onSelect: (name: string | null) => void;
}) {
  const hintId = useId();
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap font-mono text-[10px] uppercase text-emerald-400" title={hint}>
      {label}
      <Select value={value || NONE} onValueChange={(next) => onSelect(next === NONE ? null : next)}>
        <SelectTrigger size="sm" aria-describedby={hintId} title={hint}
          className="min-w-0 flex-1 border-cyan-800 bg-black/30 py-0 pr-1 pl-1.5 text-[11px] normal-case text-emerald-100">
          <SelectValue>{(selected: string) => (selected === NONE ? "None" : selected)}</SelectValue>
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
      <span id={hintId} hidden>{hint}</span>
    </label>
  );
}

/** Party-wide tank, off tank and pull mode; every card's Farming settings dialog shows the same values. */
export function PartyRolesSettings({ roles }: { roles: PartyRoles }) {
  const { tank, offTank, pullMode, characters, formation } = roles;
  const pullHint = useId();
  return (
    <fieldset aria-label="Party roles" className="flex min-w-0 flex-nowrap items-center gap-3 rounded border border-emerald-700 bg-[#07110f] p-3">
      <RolePicker label="Tank" hint={TANK_HINT} value={tank} characters={characters} onSelect={(next) => formation({ tank: next })} />
      <RolePicker label="Off tank" hint={OFF_TANK_HINT} value={offTank} characters={characters}
        onSelect={(next) => formation({ offTank: next })} />
      <label className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase text-emerald-400" title={PULL_HINT}>
        <input type="checkbox" checked={pullMode} aria-describedby={pullHint}
          onChange={(event) => formation({ pullMode: event.target.checked })} />
        Pull
        <span id={pullHint} hidden>{PULL_HINT}</span>
      </label>
    </fieldset>
  );
}
