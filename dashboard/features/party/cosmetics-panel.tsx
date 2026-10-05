"use client";
import { memo, useState } from "react";
import type { ActionPath } from "./query-actions";
import type { CosmeticsReport } from "./char";

const buttonClass = "rounded border border-fuchsia-500 bg-black px-2 py-1 text-xs text-fuchsia-100 hover:bg-fuchsia-950 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500";
const jarState = (jar: CosmeticsReport["jars"][number]) =>
  jar.kind === "empty" ? "Empty" : jar.locked ? "Locked" : jar.kind === "unknown" ? "Unknown cosmetic" : "Usable";

/** CX jars in the bag, owned cosmetics and what is worn; actions run on the native client. */
export const CosmeticsPanel = memo(function CosmeticsPanel({ name, cosmetics, post }: {
  name: string; cosmetics?: CosmeticsReport | null; post: (path: ActionPath, body: unknown) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!cosmetics) return null;
  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setError(null);
    try { await post("/command", { character: name, ...body }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const usable = cosmetics.jars.filter(jar => jar.usable).length;
  const worn = Object.entries(cosmetics.worn);
  return <section aria-label={`${name} cosmetics`} className="border-t border-slate-800 px-4 py-2 text-xs text-slate-100">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="w-full rounded border border-slate-700 bg-[#0b0d14] px-2 py-1 text-left font-mono uppercase tracking-wider text-fuchsia-200 hover:bg-slate-900">
      Cosmetics · {cosmetics.jars.length} CX jar{cosmetics.jars.length === 1 ? "" : "s"}{usable ? ` (${usable} usable)` : ""}
    </button>
    {open && <div className="mt-2 space-y-3 rounded border border-slate-700 bg-[#0b0d14] p-2">
      <div>
        <p className="mb-1 font-semibold text-fuchsia-100">CX jars in inventory</p>
        {cosmetics.jars.length ? <ul className="grid gap-1">{cosmetics.jars.map(jar =>
          <li key={jar.inventorySlot} className="flex items-center gap-2 rounded border border-slate-700 bg-black px-2 py-1">
            <span className="flex-1">Slot {jar.inventorySlot} · {jar.label || jar.data || "empty"}{jar.kind === "emote" ? " · emote" : jar.slot ? ` · ${jar.slot}` : ""}</span>
            <span className={jar.usable ? "text-emerald-300" : "text-slate-400"}>{jarState(jar)}</span>
            {jar.usable && <button type="button" className={buttonClass} disabled={busy !== null}
              aria-label={`Open CX jar in slot ${jar.inventorySlot}`}
              onClick={() => void run("jar" + jar.inventorySlot, { type: "cx-open-jar", inventorySlot: jar.inventorySlot })}>
              {busy === "jar" + jar.inventorySlot ? "Opening…" : "Open"}</button>}
          </li>)}</ul> : <p className="text-slate-400">No CX jars.</p>}
        <p className="mt-1 text-slate-400">Opening adds the cosmetic to this character&apos;s collection and uses up the jar.</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-fuchsia-100">Worn</p>
        {worn.length ? <ul className="grid gap-1">{worn.map(([slot, item]) =>
          <li key={slot} className="flex items-center gap-2 rounded border border-slate-700 bg-black px-2 py-1">
            <span className="flex-1">{slot} · {item}</span>
            {slot !== "skin" && <button type="button" className={buttonClass} disabled={busy !== null}
              aria-label={`Remove ${item} from ${slot}`} onClick={() => void run("remove" + slot, { type: "cx-remove", slot })}>
              {busy === "remove" + slot ? "Removing…" : "Remove"}</button>}
          </li>)}</ul> : <p className="text-slate-400">Nothing worn.</p>}
      </div>
      <div>
        <p className="mb-1 font-semibold text-fuchsia-100">Owned</p>
        {cosmetics.owned.length ? <ul className="grid max-h-48 gap-1 overflow-auto">{cosmetics.owned.map(entry => {
          const wearing = !!entry.slot && cosmetics.worn[entry.slot] === entry.name;
          return <li key={entry.name} className="flex items-center gap-2 rounded border border-slate-700 bg-black px-2 py-1">
            <span className="flex-1">{entry.label || entry.name}{entry.count > 1 ? ` ×${entry.count}` : ""} · {entry.kind === "emote" ? "emote" : entry.slot || entry.kind}</span>
            {entry.kind === "emote" ? <span className="text-emerald-300">Unlocked</span>
              : entry.kind === "appearance" && entry.slot ? <button type="button" className={buttonClass} disabled={busy !== null || wearing}
                aria-label={`Wear ${entry.name}`} onClick={() => void run("wear" + entry.name, { type: "cx-wear", name: entry.name, slot: entry.slot })}>
                {wearing ? "Worn" : busy === "wear" + entry.name ? "Wearing…" : "Wear"}</button> : null}
          </li>;
        })}</ul> : <p className="text-slate-400">No owned cosmetics reported.</p>}
      </div>
      {error && <p role="alert" className="text-rose-200">{error}</p>}
    </div>}
  </section>;
});
