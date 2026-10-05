"use client";
import { memo, useState } from "react";
import type { ActionPath } from "./query-actions";
import type { CosmeticsReport } from "./char";
import type { Sprite } from "./sprite";
import { SpriteCrop } from "./sprite-crop";

const buttonClass = "rounded border border-fuchsia-500 bg-black px-2 py-1 text-xs text-fuchsia-100 hover:bg-fuchsia-950 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500";
const rowClass = "flex items-center gap-2 rounded border border-slate-700 bg-black px-2 py-1";
const jarState = (jar: CosmeticsReport["jars"][number]) =>
  jar.kind === "empty" ? "Empty" : jar.locked ? "Locked" : jar.kind === "unknown" ? "Unknown cosmetic" : "Usable";
const seconds = (ms: number) => ms >= 60000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 1000)}s`;

/** The cosmetic's own sprite layer, or an emote's skill icon. Nothing when the game has no art for it. */
function Preview({ sprite, label }: { sprite?: Sprite | null; label: string }) {
  return <span role="img" aria-label={sprite ? `${label} preview` : `${label} has no preview`}
    className="relative inline-block size-8 shrink-0 overflow-hidden rounded border border-slate-700 bg-slate-900">
    {sprite && <SpriteCrop sprite={sprite} size={32} />}
  </span>;
}

/** CX jars in the bag, owned cosmetics, what is worn, and emotes; actions run on the native client. */
export const CosmeticsPanel = memo(function CosmeticsPanel({ name, cosmetics, post }: {
  name: string; cosmetics?: CosmeticsReport | null; post: (path: ActionPath, body: unknown) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  if (!cosmetics) return null;
  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setError(null);
    try { await post("/command", { character: name, ...body }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const usable = cosmetics.jars.filter(jar => jar.usable).length;
  const worn = Object.entries(cosmetics.worn);
  const appearance = cosmetics.owned.filter(entry => entry.kind !== "emote");
  const emotes = cosmetics.owned.filter(entry => entry.kind === "emote");
  const last = cosmetics.lastEmote;
  const lastLabel = last && (emotes.find(entry => entry.name === last.name)?.label || last.name);
  return <section aria-label={`${name} cosmetics`} className="border-t border-slate-800 px-4 py-2 text-xs text-slate-100">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="w-full rounded border border-slate-700 bg-[#0b0d14] px-2 py-1 text-left font-mono uppercase tracking-wider text-fuchsia-200 hover:bg-slate-900">
      Cosmetics · {cosmetics.jars.length} CX jar{cosmetics.jars.length === 1 ? "" : "s"}{usable ? ` (${usable} usable)` : ""}
      {emotes.length ? ` · ${emotes.length} emote${emotes.length === 1 ? "" : "s"}` : ""}
    </button>
    {open && <div className="mt-2 space-y-3 rounded border border-slate-700 bg-[#0b0d14] p-2">
      <div>
        <p className="mb-1 font-semibold text-fuchsia-100">CX jars in inventory</p>
        {cosmetics.jars.length ? <ul className="grid gap-1">{cosmetics.jars.map(jar =>
          <li key={jar.inventorySlot} className={rowClass}>
            <Preview sprite={jar.sprite} label={jar.label || jar.data || "empty jar"} />
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
        <p className="mb-1 font-semibold text-fuchsia-100">Emotes</p>
        {emotes.length ? <ul className="grid gap-1">{emotes.map(entry => {
          const label = entry.label || entry.name, range = entry.range ?? null;
          const options = range === null ? [] : [
            ...(entry.noSelf ? [] : [{ name, distance: 0 }]),
            ...(cosmetics.nearbyPlayers || []).filter(player => player.distance <= range),
          ];
          const target = range === null ? null : (options.some(option => option.name === targets[entry.name]) ? targets[entry.name] : options[0]?.name);
          const cooling = (entry.cooldownLeftMs || 0) > 0;
          return <li key={entry.name} className={`${rowClass} flex-wrap`}>
            <Preview sprite={entry.sprite} label={label} />
            <span className="min-w-0 flex-1 basis-40">
              <span className="block">{label}</span>
              <span className="block text-slate-400">{entry.explanation ? `${entry.explanation} · ` : ""}
                {entry.mp ? `${entry.mp} MP · ` : ""}{seconds(entry.cooldownMs || 0)} cooldown{range !== null ? ` · range ${range}` : ""}</span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
            {range !== null && <select aria-label={`Target for ${label}`} value={target || ""} disabled={!options.length || busy !== null}
              onChange={event => setTargets({ ...targets, [entry.name]: event.target.value })}
              className="rounded border border-slate-600 bg-black px-1 py-1 text-xs text-slate-100">
              {options.length ? options.map(option => <option key={option.name} value={option.name}>
                {option.name === name ? `${name} (self)` : `${option.name} · ${option.distance}`}</option>)
                : <option value="">Nobody in range</option>}
            </select>}
            <button type="button" className={buttonClass} disabled={busy !== null || cooling || (range !== null && !target)}
              aria-label={`Use ${label}`} onClick={() => void run("emote" + entry.name, { type: "cx-emote", name: entry.name, target })}>
              {busy === "emote" + entry.name ? "Using…" : cooling ? `Ready in ${seconds(entry.cooldownLeftMs || 0)}` : "Use"}</button>
            </span>
          </li>;
        })}</ul> : <p className="text-slate-400">No emotes unlocked.</p>}
        {last && <p role="status" className={last.ok ? "mt-1 text-emerald-300" : "mt-1 text-amber-200"}>
          Last emote: {lastLabel}{last.target ? ` → ${last.target}` : ""} · {last.ok ? "used" : last.reason === "pending" ? "sending…" : `refused: ${last.reason}`}
        </p>}
      </div>
      <div>
        <p className="mb-1 font-semibold text-fuchsia-100">Worn</p>
        {worn.length ? <ul className="grid gap-1">{worn.map(([slot, item]) =>
          <li key={slot} className={rowClass}>
            <Preview sprite={cosmetics.owned.find(entry => entry.name === item)?.sprite} label={item} />
            <span className="flex-1">{slot} · {item}</span>
            {slot !== "skin" && <button type="button" className={buttonClass} disabled={busy !== null}
              aria-label={`Remove ${item} from ${slot}`} onClick={() => void run("remove" + slot, { type: "cx-remove", slot })}>
              {busy === "remove" + slot ? "Removing…" : "Remove"}</button>}
          </li>)}</ul> : <p className="text-slate-400">Nothing worn.</p>}
      </div>
      <div>
        <p className="mb-1 font-semibold text-fuchsia-100">Owned</p>
        {appearance.length ? <ul className="grid max-h-60 gap-1 overflow-auto">{appearance.map(entry => {
          const wearing = !!entry.slot && cosmetics.worn[entry.slot] === entry.name;
          return <li key={entry.name} className={rowClass}>
            <Preview sprite={entry.sprite} label={entry.label || entry.name} />
            <span className="flex-1">{entry.label || entry.name}{entry.count > 1 ? ` ×${entry.count}` : ""} · {entry.slot || entry.kind}</span>
            {entry.kind === "appearance" && entry.slot ? <button type="button" className={buttonClass} disabled={busy !== null || wearing}
              aria-label={`Wear ${entry.name}`} onClick={() => void run("wear" + entry.name, { type: "cx-wear", name: entry.name, slot: entry.slot })}>
              {wearing ? "Worn" : busy === "wear" + entry.name ? "Wearing…" : "Wear"}</button> : null}
          </li>;
        })}</ul> : <p className="text-slate-400">No owned cosmetics reported.</p>}
      </div>
      {error && <p role="alert" className="text-rose-200">{error}</p>}
    </div>}
  </section>;
});
