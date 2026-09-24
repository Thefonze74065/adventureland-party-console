"use client";
import { memo } from "react";
import { abbreviatedGold } from "./abbreviated-gold";

export const XpMeter = memo(function XpMeter({ value, max }: { value: number; max: number }) {
  const percent = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return (
    <div className="mt-2 w-44 max-w-full">
      <div className="mb-1 flex justify-between font-mono text-[10px] text-violet-200/65">
        <span>XP</span>
        <span title={`${value.toLocaleString()} / ${max.toLocaleString()} XP`}>
          {abbreviatedGold(value)} / {abbreviatedGold(max)} · {percent.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/45">
        <div
          className="h-full rounded-full bg-violet-500 transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
});
