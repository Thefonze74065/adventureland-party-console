"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Coins, Landmark } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { abbreviatedGold } from "./abbreviated-gold";

export const GoldTargetControl = memo(function GoldTargetControl({
  character,
  gold,
  target,
  onSave,
  onBank,
}: {
  character: string;
  gold: number;
  target: number;
  onSave: (amount: number) => Promise<void>;
  onBank: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(target));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(String(target));
  }, [target]);
  const parsed = () => {
    const amount = Number(draft);
    return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
  };
  const save = async () => {
    const amount = parsed();
    if (amount === null) return;
    await onSave(amount);
  };
  return (
    <div className="mt-4 flex min-w-0 items-center gap-2">
      <div
        className="flex shrink-0 items-center gap-1.5 font-mono text-sm text-amber-300"
        title={`${gold.toLocaleString()} gold`}
      >
        <Coins className="h-4 w-4" />
        {abbreviatedGold(gold)}
      </div>
      <Input
        aria-label="Merchant's pocket money"
        inputMode="numeric"
        placeholder="Set target amount"
        value={draft}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          editing.current = false;
          void save();
        }}
        className="h-8 min-w-0 flex-1 border-amber-900 bg-black/30 font-mono text-xs text-amber-100"
      />
      <Button
        type="button"
        size="icon"
        variant="outline"
        title="Exchange gold and items with bank"
        aria-label="Exchange gold and items with bank"
        className="h-8 w-8 shrink-0 border-amber-800 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40"
        onClick={async () => {
          await save();
          await onBank();
        }}
      >
        <Landmark className="h-4 w-4" />
      </Button>
    </div>
  );
});
