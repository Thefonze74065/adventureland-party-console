"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

import { API } from "./api";
import { StateExportButton } from "./state-export-button";

interface SourceInfo { filename: string; canonicalPath: string; localPath: string; dockerPath: string; maxBytes: number }
interface Preview { fields: string[]; characters: string[]; digest: string; skippedCharacters?: Record<string, string[]> }
const label = (field: string) => ({ marked: "Bank collection marks", merchantMarked: "Merchant collection marks",
  compounds: "Compound groups", autoCompounds: "Automatic compound rules", upgrades: "Upgrade marks",
  upgradeOfferingRules: "Upgrade offering rules", upgradeChanceGuards: "Upgrade chance guards", autoUpgradeMarks: "Automatic upgrade rules", autoItemMarks: "Automatic collection rules" }[field] || field.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()));

export function DashboardStateImport() {
  const [info, setInfo] = useState<SourceInfo | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorContext, setErrorContext] = useState("Could not load import/export settings");
  const [backup, setBackup] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const content = useRef("");
  const picker = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const currentSelection = selection;
    fetch(`${API}/dashboard-state`, { signal: controller.signal }).then(async response => {
      if (!response.ok) {
        const body = await response.text();
        let detail = body; try { detail = JSON.parse(body).error || body; } catch {}
        throw new Error(detail || `HTTP ${response.status} ${response.statusText}`);
      }
      setInfo(await response.json());
    }).catch(error => { if (!controller.signal.aborted) setError(String(error.message)); });
    return () => { controller.abort(); currentSelection.current++; };
  }, []);

  async function request(action: string, source: string, digest?: string) {
    const response = await fetch(`${API}/dashboard-state/${action}`, { method: "POST", body: source,
      headers: { "Content-Type": "text/plain;charset=UTF-8", ...(digest ? { "X-State-Preview": digest } : {}) } });
    const text = await response.text();
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new Error(text || `HTTP ${response.status} ${response.statusText}`); }
    const data = parsed as (Preview & { error?: string; backupPath?: string }) | null;
    if (!response.ok || !data) throw new Error(data?.error || `Import request failed (${response.status})`);
    if (!Array.isArray(data.fields) || !Array.isArray(data.characters) || typeof data.digest !== "string") throw new Error("Invalid import response");
    return data;
  }
  async function choose(file?: File) {
    if (!file) return;
    const revision = ++selection.current;
    setError(""); setBackup(""); setPreview(null); content.current = ""; setFilename(file.name);
    setErrorContext("Error reading state file");
    if (file.size > (info?.maxBytes || 128 * 1024 * 1024)) { setError("Choose a state file smaller than 128 MB."); return; }
    setBusy(true);
    try {
      const source = await file.text();
      const result = await request("preview", source);
      if (revision !== selection.current) return;
      content.current = source; setPreview(result);
    } catch (error) { if (revision === selection.current) setError(error instanceof Error ? error.message : "Could not read this file"); }
    finally { if (revision === selection.current) setBusy(false); }
  }
  async function apply() {
    if (!preview || busy) return;
    setBusy(true); setError("");
    setErrorContext("Error importing state file");
    try {
      const result = await request("import", content.current, preview.digest);
      setSkipped(Object.keys(result.skippedCharacters || {}));
      setBackup(result.backupPath || "Saved beside caraGarage.jsonl"); setPreview(null); content.current = "";
      if (picker.current) picker.current.value = "";
    } catch (error) { setError(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  }
  return <section className="min-w-0 rounded border border-slate-600 bg-[#101c1a] p-4 text-emerald-50">
    <h3 className="font-semibold">Dashboard state import/export</h3>

    <p className="mt-1 text-sm text-slate-200">Choose an exported settings JSON file or a legacy <code>caraGarage.jsonl</code> file. Import saved marks, automation rules, farming and event preferences.</p>
    <dl className="mt-3 space-y-2 text-xs text-slate-200">
      <div><dt className="font-semibold text-emerald-100">This server’s canonical path</dt><dd className="break-all font-mono">{info?.canonicalPath || "Loading…"}</dd></div>
      <div><dt className="font-semibold text-emerald-100">Local installation</dt><dd className="break-all font-mono">{info?.localPath || "<installation>/.caracal/localStorage/caraGarage.jsonl"}</dd></div>
      <div><dt className="font-semibold text-emerald-100">Docker volume</dt><dd className="break-all font-mono">/data/localStorage/caraGarage.jsonl</dd></div>
    </dl>
    <p className="mt-3 text-xs text-slate-300">Use a copy taken while the old service was stopped. Credentials, logins, queued work and travel state stay as they are. Full migration instructions are in the README.</p>
    <input ref={picker} type="file" accept=".json,application/json,.jsonl,application/x-ndjson,text/plain" aria-label="Import state file" className="sr-only"
      disabled={busy} onChange={event => void choose(event.target.files?.[0])} />
    <div className="mt-3 flex flex-wrap items-start gap-2">
    <StateExportButton />
    <Button type="button" disabled={busy} onClick={() => { if (picker.current) { picker.current.value = ""; picker.current.click(); } }}
      className="border border-cyan-600 bg-[#07100f] text-cyan-100 hover:bg-cyan-950 hover:text-white disabled:opacity-50">
      {busy ? "Working…" : "Import state file"}
    </Button>
    </div>
    {preview && <div className="mt-3 rounded border border-amber-600 bg-[#241e10] p-3 text-sm text-amber-100">
      <p className="break-all font-semibold">Review {filename}</p>
      <p className="mt-1">These saved settings will replace the corresponding settings here, including empty lists. Missing settings are kept.</p>
      <p className="mt-2">Characters: {preview.characters.join(", ") || "Shared settings only"}</p>
      {Object.entries(preview.skippedCharacters || {}).map(([name, fields]) => <p key={name} className="mt-2">Skipping {name} (not in this account): {fields.map(label).join(', ')}.</p>)}
      <ul className="mt-2 max-h-40 list-inside list-disc overflow-y-auto">{preview.fields.map(field => <li key={field}>{label(field)}</li>)}</ul>
      <p className="mt-2">{preview.fields.length ? 'A backup is saved on this server before importing. Imported automation rules take effect immediately.' : 'Nothing to import: all saved characters were skipped.'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy || !preview.fields.length} onClick={() => void apply()} className="border border-emerald-500 bg-[#10392b] text-emerald-50 hover:bg-[#18513c] hover:text-white">Import dashboard state</Button>
        <Button disabled={busy} onClick={() => { setPreview(null); content.current = ""; }} className="border border-slate-500 bg-[#101c1a] text-slate-100 hover:bg-slate-700 hover:text-white">Cancel</Button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-3 break-words text-sm text-rose-200">{errorContext}: {error}</p>}
    {backup && <output className="mt-3 block break-all text-sm text-emerald-200">Dashboard state imported. {skipped.length > 0 && `Skipped: ${skipped.join(', ')}. `}Backup: <span className="font-mono">{backup}</span></output>}
  </section>;
}
