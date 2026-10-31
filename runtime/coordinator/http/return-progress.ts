import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
export interface ReturnProgress {
  kind: string; cycleId: string; revision: number; phase: string;
  exitMap?: string; exitAttempts?: number; blockedTownAttempted?: boolean; exitReconnectAttempted?: boolean;
}
export interface ReturnProgressState {
  returnProgress?: Record<string, ReturnProgress>;
  townCycle?: { id: string; pending: string[] } | null;
  eventReturn?: { cycleId: string; pending: string[] } | null;
  deferredEventReturns: Record<string, { cycleId: string } | undefined>;
}
const phases = ["local-town", "exiting-map", "main-town", "complete"];
function sameReturn(prior: ReturnProgress | undefined, next: ReturnProgress): boolean {
  return !!prior && prior.kind === next.kind && prior.cycleId === next.cycleId && prior.revision === next.revision;
}
export function createReturnProgressRoute(state: ReturnProgressState, ports: {
  owned(name: string): unknown; intent(name: string): { revision: number }; persist(): void;
}) {
  function authorized(name: string, kind: string, cycle: string): boolean {
    if (kind === "town") return state.townCycle?.id === cycle && state.townCycle.pending.includes(name);
    if (kind !== "event") return false;
    return (state.eventReturn?.cycleId === cycle && state.eventReturn.pending.includes(name)) ||
      state.deferredEventReturns[name]?.cycleId === cycle;
  }
  return function progress(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), name = requestText(body.character);
    const kind = requestText(body.kind), cycleId = requestText(body.cycleId);
    const revision = Number(body.navigationRevision), phase = requestText(body.phase);
    if (!ports.owned(name) || ports.intent(name).revision !== revision || !authorized(name, kind, cycleId))
      return res.status(409).json({error:"return workflow superseded"});
    if (!phases.includes(phase)) return res.status(400).json({error:"invalid return phase"});
    const all = state.returnProgress ||= {}, prior = all[name];
    const same = sameReturn(prior,{kind,cycleId,revision,phase});
    if (!same || phases.indexOf(phase) > phases.indexOf(prior.phase)) {
      all[name] = { ...(same ? prior : {}), kind, cycleId, revision, phase }; ports.persist();
    }
    const before = JSON.stringify(all[name]);
    updateExitProgress(all[name]!, body);
    if (before !== JSON.stringify(all[name])) ports.persist();
    return res.json({ok:true, progress:all[name]});
  };
}

function validExitAttempts(attempts: number): boolean {
  return Number.isInteger(attempts) && attempts >= 0 && attempts <= 3;
}
function updateExitProgress(progress: ReturnProgress, body: Record<string, unknown>): void {
  if (progress.kind !== "event" || typeof body.exitMap !== "string") return;
  if (progress.exitMap && progress.exitMap !== body.exitMap) return;
  progress.exitMap = body.exitMap;
  const attempts = Number(body.exitAttempts);
  if (validExitAttempts(attempts))
    progress.exitAttempts = Math.max(progress.exitAttempts || 0, attempts);
  if (body.blockedTownAttempted === true) progress.blockedTownAttempted = true;
  if (body.exitReconnectAttempted === true) progress.exitReconnectAttempted = true;
}
