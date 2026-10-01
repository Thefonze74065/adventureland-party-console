"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { abbreviatedGold } from "./abbreviated-gold";

export function StandPriceButton({
  label,
  value,
  disabled,
  onClick,
  tone,
  information,
}: {
  label: string;
  information?: ReactNode;
  value?: number;
  disabled?: boolean;
  onClick: () => void;
  tone: "amber" | "emerald" | "cyan" | "violet" | "slate";
}) {
  const toneClasses = {
    amber: "border-amber-700 text-amber-200 hover:bg-amber-950",
    emerald: "border-emerald-700 text-emerald-200 hover:bg-emerald-950",
    cyan: "border-cyan-700 text-cyan-200 hover:bg-cyan-950",
    violet: "border-violet-700 text-violet-200 hover:bg-violet-950",
    slate: "border-slate-600 text-slate-100 hover:bg-slate-900",
  }[tone];
  const usableValue = Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
  return (
    <div className="relative w-full">
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className={`h-auto min-h-14 w-full flex-col gap-0.5 bg-black px-3 py-2 ${toneClasses}`}
    >
      <span className="font-semibold">{label}</span>
      <span className="font-mono text-[11px] opacity-75">
        {usableValue
          ? `${abbreviatedGold(Math.max(1, Math.round(usableValue)))} gold`
          : "Unavailable"}
      </span>
    </Button>
    {information && <div className="absolute right-1 top-1">{information}</div>}
    </div>
  );
}
