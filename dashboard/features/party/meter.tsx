"use client";
import { memo } from "react";

export const Meter = memo(function Meter({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-[11px] text-emerald-100/55">
        <span>{label}</span>
        <span>
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${color}`}
          style={{
            width: `${Math.max(0, Math.min(100, max ? (value / max) * 100 : 0))}%`,
          }}
        />
      </div>
    </div>
  );
});
