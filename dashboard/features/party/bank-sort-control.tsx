"use client";
import { Button } from "@/components/ui/button";
import { usePartyAction } from "./query-actions";
import type { PartyState } from "./party-state";

export type BankSortState = Pick<PartyState, "bankSortMode" | "bankSortLayout" | "bankSortRequest">;
export function BankSortControl({ state, settings = false }: { state: BankSortState; settings?: boolean }) {
  const action = usePartyAction();
  const mode = state.bankSortMode || "automatic";
  const pending = state.bankSortRequest;
  const update = (body: unknown) => action.mutate({ path: "/merchant/bank-sort", body });
  if (!settings && mode !== "request") return null;
  return <div className="space-y-2 text-sm text-slate-100">
    {settings ? <fieldset disabled={action.isPending} className="space-y-2 rounded-lg border border-slate-600 bg-slate-900 p-4">
      <legend className="px-1 text-slate-100">Bank sorting</legend>
      {([ ["automatic", "Sort every bank visit"], ["request", "Request sorting in bank window"] ] as const).map(([value, label]) =>
        <label key={value} className="flex cursor-pointer items-center gap-2">
          <input type="radio" name="bank-sort-mode" value={value} checked={mode === value}
            onChange={() => update({ mode: value })} className="accent-emerald-400" />{label}
      </label>)}
      <label className="flex cursor-pointer items-center gap-2 border-t border-slate-700 pt-2">
        <input type="checkbox" checked={state.bankSortLayout === "gapped"}
          onChange={event => update({ layout: event.target.checked ? "gapped" : "packed" })} className="accent-emerald-400" />
        Leave gaps between item types
      </label>
      <p className="text-xs text-slate-300">Each item category starts on its own row with free slots after it, so new items drop into a gap instead of shifting the whole bank. Falls back to packed sorting when the bank is too full.</p>
      <p className="text-xs text-slate-300">Compatible stacks are always combined during bank visits. This setting controls item ordering.</p>
    </fieldset> : <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" aria-pressed={!!pending} disabled={action.isPending}
          onClick={() => update({ enabled: !pending })}
          className={pending ? "border-emerald-400 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white" : "border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white"}>
          Sort on next visit · {pending ? "On" : "Off"}
        </Button>
        <output className="text-slate-200">{pending?.status === "sorting" ? "Sorting" : pending?.status === "retry" ? `Retry pending${pending.message ? `: ${pending.message}` : ""}` : pending ? "Queued" : ""}</output>
      </div>
      <p className="text-xs text-slate-300">Sorts all accessible bank floors after banking work. Compatible stacks are always combined, even when sorting is off. Does not send the merchant to the bank. If already banking, waits for the following visit.</p>
    </>}
    {action.error && <p role="alert" className="text-rose-300">{action.error.message}</p>}
  </div>;
}
