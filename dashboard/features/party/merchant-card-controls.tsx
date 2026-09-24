"use client";
import { MerchantCollectionSettings, type MerchantCollectionSettingsProps } from "./merchant-collection-settings";
import { useClock } from "@/hooks/use-clock";
import { MerchantActivityLog } from "@/components/merchant-activity";
import { Button } from "@/components/ui/button";
import {
  Check,
  ChevronRight,
  Gift,
  Hammer,
  HandCoins,
  Landmark,
  RefreshCw,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { memo, useState } from "react";
import { usePartyAction } from "./query-actions";
import { domainOptions, useVisible } from "./query-cache";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { durationLabel } from "./duration-label";
import { MerchantJob } from "./merchant-job";
import { merchantJobLabel } from "./merchant-job-label";
import { PartyState } from "./party-state";
import { SendToPartyControl } from "./send-to-party-control";
import { MerchantCancelJobControl } from "./merchant-cancel-job-control";

export const MerchantCardControls = memo(function MerchantCardControls({
  state: baseState,
  collectionSettings,
  onBank,
  onClear,
  onForceStand,
  onCancelJob,
  onRoutines,
  onGather,
  onBuy,
  onCraft,
  onExchange,
  onDonate,
  onGiveaway,
}: {
  state: PartyState;
  collectionSettings: MerchantCollectionSettingsProps;
  onBank: (group?: string) => Promise<void>;
  onClear: () => Promise<void>;
  onForceStand: (enabled: boolean) => Promise<void>;
  onCancelJob: (id?: string) => Promise<void>;
  onRoutines: () => void;
  onGather: (mode: string, enabled: boolean) => Promise<void>;
  onBuy: () => void;
  onCraft: () => void;
  onExchange: () => void;
  onDonate: () => void;
  onGiveaway: () => void;
}) {
  const now = useClock();
  const action = usePartyAction();
  const [activityOpen, setActivityOpen] = useState(false);
  const client = useQueryClient(), visible = useVisible();
  const logs = useQueries({ queries: [{ ...domainOptions(client, 'logs'), enabled: visible }].filter(() => activityOpen) })[0];
  const state = { ...baseState, ...logs?.data };
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const merchant = state.merchantCharacter ? state.characters[state.merchantCharacter] : null;
  const readiness = (mode: "fishing" | "mining") => {
    const remaining = Math.max(
      0,
      Math.max(
        Number(merchant?.gatheringCooldowns?.[mode] || 0),
        Number(state.gatheringCooldowns?.[mode] || 0),
      ) - now,
    );
    if (!remaining)
      return (
        <span className="flex items-center gap-0.5 text-[10px] text-emerald-300">
          <Check className="h-3 w-3" /> Ready
        </span>
      );
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return (
      <span className="font-mono text-[10px] opacity-80">
        {minutes}:{String(seconds).padStart(2, "0")}
      </span>
    );
  };
  const jobLabel = (job: MerchantJob) => merchantJobLabel(job, state.merchantCatalog?.allItems);
  const merchantJobs = [
    ...(state.merchantCurrent
      ? [
          {
            job: state.merchantCurrent,
            status: state.merchantCurrent.commandReport?.state === "deferred"
              ? `Waiting: ${state.merchantCurrent.commandReport.reason || "temporarily blocked"}`
              : state.merchantCurrent.reason === "marked items" && state.merchantCurrent.phase === "processing"
                ? "finishing collection"
                : state.merchantCurrent.phase || "in progress",
          },
        ]
      : []),
    ...(state.merchantQueue || []).map((job) => ({ job, status: "queued" })),
  ];
  return (
    <section className="border-b border-amber-900/70 bg-amber-400/[0.03] p-4">
      <details className="group mb-3 rounded border border-amber-900/60 bg-black/20">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-300">
          <span>Merchant logistics · {state.merchantQueue?.length || 0} queued</span>
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        </summary>
        <div className="space-y-1 border-t border-amber-900/50 px-3 py-2 font-mono text-[10px]">
          {!merchantJobs.length && (
            <p className="text-emerald-100/45">No queued work</p>
          )}
          {merchantJobs.map(({ job, status }, index) => (
            <div
              key={job.id || `${job.reason}-${index}`}
              className="flex min-w-0 items-center gap-3 text-left"
            >
              {status === "queued" && job.reason !== "fishing" && job.reason !== "mining" ? (
                <MerchantCancelJobControl id={job.id} reason={job.reason} label={jobLabel(job)} onCancel={onCancelJob} />
              ) : null}
              <span title={`${jobLabel(job)}${job.target && job.reason !== "join giveaway" ? ` · ${job.target}` : ""}`}
                className={
                  `min-w-0 flex-1 truncate text-left ${index === 0 && state.merchantCurrent ? "text-amber-200" : "text-emerald-100/70"}`
                }
              >
                <span className="mr-1 text-amber-300">
                  P{job.priority ?? state.merchantRoutinePriorities?.[job.reason] ?? 50}
                </span>
                {jobLabel(job)}
                {job.target && job.reason !== "join giveaway" ? ` · ${job.target}` : ""}
              </span>
              <span className="max-w-32 shrink-0 truncate text-emerald-100/70" title={job.realmBlockedReason || status}>{job.realmBlockedReason || status}</span>
              {job.realmRetryExhausted && <button type="button"
                className="rounded border border-amber-600 bg-zinc-950 px-2 py-1 text-amber-200 hover:border-amber-300 hover:bg-amber-950 hover:text-white"
                onClick={() => action.mutate({ path: '/merchant/job/retry', body: { id: job.id } })}>Retry</button>}
            </div>
          ))}
          {state.mluckSchedule && !merchantJobs.some(({ job }) =>
            job.reason === "merchant luck" && job.target === state.mluckSchedule?.target
          ) && (
            <div className="flex min-w-0 items-center gap-3 text-left">
              <span className="text-emerald-100/70">
                Merchant&apos;s Luck upkeep · {state.mluckSchedule.target}
              </span>
              <span className="shrink-0 text-emerald-100/40">
                {state.mluckSchedule.status === "scheduled"
                  ? `dispatch in ${durationLabel(state.mluckSchedule.dispatchInMs)}`
                  : state.mluckSchedule.status}
              </span>
            </div>
          )}
        </div>
      </details>
      <details className="mb-3" onToggle={event => setActivityOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer font-mono text-[10px] uppercase text-amber-300">
            Activity
          </summary>
          <div className="mt-2 flex items-center justify-end gap-2">
            {cleanupResult ? (
              <span className="mr-auto font-mono text-[9px] text-emerald-300">{cleanupResult}</span>
            ) : null}
            <button
              type="button"
              className="font-mono text-[9px] text-purple-300 hover:text-purple-200"
              onClick={async () => {
                try {
                  const result = await action.mutateAsync({ path: '/merchant/stale-orders/clear', body: {} });
                  setCleanupResult(`Removed ${Number(result.deliveriesRemoved) || 0} deliveries, ${Number(result.bankMarksRemoved) || 0} bank marks`);
                } catch (error) { setCleanupResult(error instanceof Error ? error.message : 'Cleanup failed'); }

              }}
            >
              Clear stale orders
            </button>
            <button
              type="button"
              className="font-mono text-[9px] text-rose-300 hover:text-rose-200"
              onClick={async () => {
                try {
                  await action.mutateAsync({ path: '/merchant/activity/clear', body: {} });
                  setCleanupResult('Activity history cleared');
                } catch (error) { setCleanupResult(error instanceof Error ? error.message : 'Cleanup failed'); }

              }}
            >
              Clear history
            </button>
          </div>
          <MerchantActivityLog entries={state.merchantActivity || []} />
        </details>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={onBuy}
          className="h-9 border-amber-700 bg-[#07100f] text-xs text-amber-300 hover:bg-amber-950"
        >
          <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />
          Buy
        </Button>
        <Button
          variant="outline"
          onClick={onCraft}
          className="h-9 border-violet-700 bg-[#07100f] text-xs text-violet-300 hover:bg-violet-950"
        >
          <Hammer className="mr-1.5 h-3.5 w-3.5" />
          Craft
        </Button>
        <Button
          variant="outline"
          onClick={onExchange}
          className="h-9 border-cyan-700 bg-[#07100f] text-xs text-cyan-300 hover:bg-cyan-950"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Exchange
        </Button>
        <Button
          variant="outline"
          onClick={onDonate}
          className="h-9 border-amber-700 bg-[#07100f] text-xs text-amber-300 hover:bg-amber-950"
        >
          <HandCoins className="mr-1.5 h-3.5 w-3.5" />
          Donate gold
        </Button>
        <Button
          variant="outline"
          onClick={onGiveaway}
          className="h-9 border-cyan-700 bg-[#07100f] text-xs text-cyan-200 hover:bg-cyan-950 hover:text-cyan-50"
        >
          <Gift className="mr-1.5 h-3.5 w-3.5" />
          Join giveaway
        </Button>
        <SendToPartyControl state={state} onSend={onBank} />
        <Button
          variant="outline"
          aria-pressed={state.merchantForceStand === true}
          onClick={() => void onForceStand(state.merchantForceStand !== true)}
          className={
            state.merchantForceStand
              ? "h-9 border-rose-300 bg-rose-600 text-xs font-semibold text-white hover:bg-rose-500"
              : "h-9 border-amber-700 bg-[#07100f] text-xs text-amber-200 hover:bg-amber-950"
          }
        >
          <Landmark className="mr-1.5 h-3.5 w-3.5" />
          Force stand · {state.merchantForceStand ? "On" : "Off"}
        </Button>
        <Button
          variant="outline"
          onClick={onRoutines}
          className="h-9 border-violet-800 bg-[#07100f] text-xs text-violet-300 hover:bg-violet-950"
        >
          <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
          Routines
        </Button>

        <Button
          variant="outline"
          aria-pressed={state.gatheringModes?.includes("mining")}
          onClick={() => void onGather("mining", !state.gatheringModes?.includes("mining"))}
          className={
            state.gatheringModes?.includes("mining")
              ? "h-9 border-emerald-300 bg-emerald-500 px-2 text-[11px] text-emerald-950 hover:bg-emerald-400"
              : "h-9 border-emerald-700 bg-[#07100f] px-2 text-[11px] text-emerald-300 hover:bg-emerald-950"
          }
        >
          <span className="flex items-center justify-center gap-1 whitespace-nowrap">
            <span>Mining · {state.gatheringModes?.includes("mining") ? "On" : "Off"} ·</span>
            {state.gatheringNoTool?.mining && !state.gatheringModes?.includes("mining") ? (
              <span className="text-amber-200">No tool</span>
            ) : (
              readiness("mining")
            )}
          </span>
        </Button>
        <Button
          variant="outline"
          aria-pressed={state.gatheringModes?.includes("fishing")}
          onClick={() => void onGather("fishing", !state.gatheringModes?.includes("fishing"))}
          className={
            state.gatheringModes?.includes("fishing")
              ? "h-9 border-cyan-300 bg-cyan-400 px-2 text-[11px] text-cyan-950 hover:bg-cyan-300"
              : "h-9 border-cyan-700 bg-[#07100f] px-2 text-[11px] text-cyan-300 hover:bg-cyan-950"
          }
        >
          <span className="flex items-center justify-center gap-1 whitespace-nowrap">
            <span>Fishing · {state.gatheringModes?.includes("fishing") ? "On" : "Off"} ·</span>
            {state.gatheringNoTool?.fishing && !state.gatheringModes?.includes("fishing") ? (
              <span className="text-amber-200">No tool</span>
            ) : (
              readiness("fishing")
            )}
          </span>
        </Button>
        <Button
          variant="outline"
          onClick={() => void onClear()}
          className="h-9 border-rose-800 bg-[#07100f] text-xs text-rose-300 hover:bg-rose-950"
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Clear job queue
        </Button>
        <MerchantCollectionSettings {...collectionSettings} bankSortState={state} deliveryTripsEnabled={state.merchantAutomations?.deliveries !== false} />
      </div>

    </section>
  );
});
