"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { memo, useEffect, useRef, useState } from "react";
import { RestockPolicy } from "./restock-policy";

const defaults: RestockPolicy = {
  hp: { min: 5, max: 20, item: "hpot1" },
  mp: { min: 0, max: 0, item: "mpot1" },
};

export const RestockControls = memo(function RestockControls({
  character,
  value,
  onSave,
}: {
  character: string;
  value?: RestockPolicy;
  onSave: (character: string, value: RestockPolicy) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RestockPolicy>(value || defaults),
    dirty = useRef(false);
  // Character status polling returns a new policy object on every refresh.
  // Reconcile it only while the user has no unsaved local edits.
  useEffect(() => {
    if (!dirty.current) setDraft(value || defaults);
  }, [value]);
  const field = (kind: "hp" | "mp", key: "min" | "max", label: string) => (
    <label className="grid gap-1 font-mono text-[10px] uppercase text-emerald-100/45">
      {label}
      <Input
        inputMode="numeric"
        value={draft[kind][key]}
        onChange={(event) => {
          dirty.current = true;
          setDraft({
            ...draft,
            [kind]: {
              ...draft[kind],
              [key]: Number(event.target.value.replace(/[^0-9]/g, "")),
            },
          });
        }}
        className="h-8 border-emerald-900 bg-black/25 text-xs"
      />
    </label>
  );
  return (
    <section className="border-b border-emerald-900/70 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase text-emerald-100/45">Merchant restock</p>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await onSave(character, draft);
            dirty.current = false;
          }}
          className="h-8 border-emerald-800 bg-[#07100f] text-[10px] text-emerald-300 hover:bg-emerald-950 hover:text-emerald-100"
        >
          Save
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {field("hp", "min", "HP min")}
        {field("hp", "max", "HP max")}
        {field("mp", "min", "MP min")}
        {field("mp", "max", "MP max")}
      </div>
    </section>
  );
});
