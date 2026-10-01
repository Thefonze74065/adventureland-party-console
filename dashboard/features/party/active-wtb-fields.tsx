"use client";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { StandBid } from "./stand-bid";

export type WTBField = "quantity" | "price" | "priority";
const labels = {quantity: "Quantity", price: "Price", priority: "Priority"};
const dimensions = "h-8 w-24 shrink-0 rounded border px-2 text-right font-mono text-xs tabular-nums";

export function ActiveWTBFields({name, bid, disabled, onEditPrice, onSave}: {
  name: string; bid: StandBid; disabled?: boolean;
  onEditPrice: () => void;
  onSave: (field: WTBField, value: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState<WTBField | null>(null), [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const current = useRef<WTBField | null>(null), pending = useRef(false);
  function edit(field: WTBField) {
    if (pending.current) return;
    current.current = field; setEditing(field); setError("");
    setDraft(String((field === "priority" ? bid.priorityOverride : bid[field]) ?? ""));
  }
  async function save() {
    const field = current.current;
    if (!field || pending.current) return;
    const value = field === "priority" && draft === "" ? null : Number(draft);
    if (value !== null && (!Number.isSafeInteger(value) || value < (field === "priority" ? 0 : 1) || (field === "priority" && value > 100))) {
      setError(field === "priority" ? "Priority must be 0–100 or blank." : `${labels[field]} must be a positive whole number.`); return;
    }
    pending.current = true; setSaving(true); setError("");
    try { await onSave(field, value); current.current = null; setEditing(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { pending.current = false; setSaving(false); }
  }
  return <div className="relative flex shrink-0 items-center gap-1">
    {(["quantity", "price", "priority"] as const).map(field => editing === field ? (
      <Input key={field} autoFocus aria-label={`${labels[field]} for ${name}`} title="Enter or click away to save; Escape to cancel"
        inputMode="numeric" placeholder={field === "priority" ? "Default" : undefined} value={draft} disabled={disabled || saving}
        onFocus={event => event.target.select()} onChange={event => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => void save()} onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); void save(); }
          if (event.key === "Escape") { event.preventDefault(); current.current = null; setEditing(null); setError(""); }
        }} className={`${dimensions} border-violet-600 bg-black text-violet-100 placeholder:text-violet-300`} />
    ) : (
      <button key={field} type="button" aria-label={`Edit ${labels[field].toLowerCase()} for ${name}`} title={labels[field]}
        disabled={disabled || saving} onClick={() => field === "price" ? onEditPrice() : edit(field)}
        className={`${dimensions} truncate border-violet-600 bg-violet-950 text-violet-100 hover:border-violet-400 hover:bg-violet-900 disabled:opacity-50`}>
        {field === "quantity" ? `×${bid.quantity.toLocaleString()}` : field === "price" ? `${bid.price.toLocaleString()}g` : `P ${bid.priorityOverride ?? "Default"}`}
      </button>
    ))}
    {error && <span role="alert" className="absolute right-0 top-full z-10 mt-1 max-w-72 rounded border border-rose-700 bg-black p-2 text-xs text-rose-200">{error}</span>}
  </div>;
}
