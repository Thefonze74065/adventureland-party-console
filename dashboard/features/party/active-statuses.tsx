"use client";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { useClock } from "@/hooks/use-clock";
import { durationSignature, reconcileDurations, statusRemaining, type StatusDuration } from "./status-duration";
import { Condition } from "./condition";
import { durationLabel } from "./duration-label";
import { SpriteCrop } from "./sprite-crop";

export const ActiveStatuses = memo(function ActiveStatuses({
  conditions,
  onSelect,
}: {
  conditions: Condition[];
  onSelect: (condition: Condition) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = useClock();
  const [durations, setDurations] = useState<Record<string, StatusDuration | undefined>>({});
  const signature = durationSignature(conditions);
  useEffect(() => {
    // Anchor newly observed telemetry at commit time; equal timer inputs do not
    // enter this effect. Using the shared clock here would backdate the sample.
    // eslint-disable-next-line react/react-compiler
    setDurations(previous => reconcileDurations(signature, previous, Date.now()));
  }, [signature]);
  return (
    <section className="mt-5 border-t border-emerald-900/70 pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${open ? "mb-2" : ""} flex w-full items-center justify-between text-left`}
      >
        <h3 className="flex items-center gap-2 font-mono text-xs uppercase text-emerald-100/55">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Active status
        </h3>
        <span className="font-mono text-[10px] text-emerald-100/35">{conditions.length}</span>
      </button>
      {open && conditions.length ? (
        <div className="flex flex-wrap gap-2">
          {conditions.map((condition) => {
            const duration = durations[condition.id];
            const remaining = statusRemaining(duration, now);
            const percent = duration?.total ? Math.min(100, (remaining || 0) / duration.total * 100) : 0;
            return (
            <button
              key={condition.id}
              onClick={() => onSelect(condition)}
              title={condition.name}
              className="relative isolate flex max-w-full items-center gap-2 overflow-hidden rounded border border-cyan-800 bg-[#071719] p-1.5 text-left hover:border-cyan-400"
            >
              <span aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 bg-cyan-800 transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${percent}%` }} />
              <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded bg-black">
                {condition.sprite && <SpriteCrop sprite={condition.sprite} size={32} />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs text-cyan-100">{condition.name}</span>
                <span className="block font-mono text-[10px] text-cyan-100">
                  {durationLabel(remaining ?? condition.remainingMs)}
                  {condition.stacks !== null && condition.stacks !== undefined
                    ? ` · ${condition.stacks} stacks`
                    : ""}
                </span>
              </span>
            </button>
          );})}
        </div>
      ) : open ? (
        <p className="text-xs text-emerald-100/35">No active effects</p>
      ) : null}
    </section>
  );
});
