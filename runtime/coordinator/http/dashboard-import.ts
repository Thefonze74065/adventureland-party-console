import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  parseDashboardImport,
  exportDashboardSettings,
  applyDashboardImport,
  type DashboardImport,
} from "../persistence/dashboard-import.ts";

interface ImportPorts {
  rosterReady?(): boolean;
  owned(name: string): boolean;
  digest(source: string): string;
  previewDigest(req: HttpRequest): unknown;
  canonicalPath(): string;
  backup(path: string): void;
  suffix(): string;
  persist(): void;
}
type State = Record<string, unknown>;
export function createDashboardImportRoutes(state: State, ports: ImportPorts) {
  function metadata(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json({
      filename: "caraGarage.jsonl",
      canonicalPath: ports.canonicalPath(),
      localPath: "<installation>/.caracal/localStorage/caraGarage.jsonl",
      dockerPath: "/data/localStorage/caraGarage.jsonl",
      maxBytes: 128 * 1024 * 1024,
    });
  }
  function apply(parsed: DashboardImport): boolean {
    const previous = Object.fromEntries(
      parsed.fields.map((key) => [
        key,
        state[key],
      ]),
    );
    try {
      applyDashboardImport(state, parsed);
      ports.persist();
      return true;
    } catch {
      // Restore the exact collections, including profiles introduced by a
      // failed import, rather than merging their preferences again.
      for (const [key, value] of Object.entries(previous)) state[key] = value;
      try {
        ports.persist();
      } catch {
        /* The recovery backup remains available if persistence stays unavailable. */
      }
      return false;
    }
  }
  function handle(req: HttpRequest, res: HttpResponse, preview: boolean): unknown {
    try {
      if (ports.rosterReady && !ports.rosterReady()) throw new Error('Account roster is still loading; retry the import shortly');
      const source = req.body as string,
        parsed = parseDashboardImport(source, (name) => ports.owned(name)),
        digest = ports.digest(JSON.stringify({ source, parsed }));
      const summary = { fields: parsed.fields, characters: parsed.characters, skippedCharacters: parsed.skippedCharacters, digest };
      if (preview) return res.json(summary);
      if (!parsed.fields.length) throw new Error('Nothing to import: all saved characters were skipped');
      if (ports.previewDigest(req) !== digest)
        return res.status(409).json({ error: "Preview this file before importing it" });
      const backupPath = ports
        .canonicalPath()
        .replace(/\.jsonl$/, ".before-import-" + ports.suffix() + ".jsonl");
      ports.backup(backupPath);
      if (!apply(parsed))
        return res
          .status(500)
          .json({
            error:
              "Import could not be saved; previous settings restored in memory. Backup: " +
              backupPath,
          });
      return res.json({ ok: true, ...summary, backupPath });
    } catch (error) {
      return res
        .status(400)
        .json({ error: requestObject(error).message || "Invalid dashboard state file" });
    }
  }
  return {
    metadata,
    exportState: (_req: HttpRequest, res: HttpResponse) => res.json(exportDashboardSettings(state)),
    preferences: (req: HttpRequest, res: HttpResponse) => {
      const body = requestObject(req.body);
      const prefix = body.bankboiPrefix;
      if (prefix !== undefined && (typeof prefix !== "string" || prefix !== "" && !/^[A-Za-z0-9_]{3,11}$/.test(prefix)))
        return res.status(400).json({ error: "Use 3–11 letters, numbers, or underscores" });
      if (body.anniversaryAutoChat !== undefined && typeof body.anniversaryAutoChat !== "boolean")
        return res.status(400).json({ error: "Invalid chat setting" });
      if (prefix !== undefined) state.bankboiPrefix = prefix;
      if (body.anniversaryAutoChat !== undefined) state.anniversaryAutoChat = body.anniversaryAutoChat;
      ports.persist();
      return res.json({ ok: true });
    },
    preview: (req: HttpRequest, res: HttpResponse) => handle(req, res, true),
    importState: (req: HttpRequest, res: HttpResponse) => handle(req, res, false),
  };
}
