import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";

/**
 * Per-encounter combat routine selection, saved the same way as farmingPolicy
 * but keyed by encounter id so future collaborative events (not just Franky)
 * can add a routine set here without a new field/route/dashboard control each time.
 */
export const encounterModes: Record<string, readonly string[]> = {
  franky: ["auto", "offtank", "tank"],
};

interface EncounterModeState {
  encounterRoutines?: Record<string, string>;
  encounterAutoDeathLimits?: Record<string, number>;
}
interface EncounterModePorts {
  persist(): void;
}

function applyMode(state: EncounterModeState, encounter: string, value: unknown): string | null {
  const mode = requestText(value);
  if (!encounterModes[encounter]!.includes(mode)) return "invalid encounter mode";
  state.encounterRoutines = { ...state.encounterRoutines, [encounter]: mode };
  return null;
}
function applyDeathLimit(state: EncounterModeState, encounter: string, value: unknown): string | null {
  const deathLimit = Number(value);
  if (!Number.isInteger(deathLimit) || deathLimit < 0) return "invalid death limit";
  state.encounterAutoDeathLimits = { ...state.encounterAutoDeathLimits, [encounter]: deathLimit };
  return null;
}

export function createEncounterModeRoute(state: EncounterModeState, ports: EncounterModePorts) {
  return function encounterMode(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), encounter = requestText(body.encounter);
    if (!encounterModes[encounter]) return res.status(400).json({ error: "invalid encounter mode" });
    if (body.mode === undefined && body.deathLimit === undefined)
      return res.status(400).json({ error: "no encounter setting provided" });
    const modeError = body.mode !== undefined ? applyMode(state, encounter, body.mode) : null;
    if (modeError) return res.status(400).json({ error: modeError });
    const limitError = body.deathLimit !== undefined ? applyDeathLimit(state, encounter, body.deathLimit) : null;
    if (limitError) return res.status(400).json({ error: limitError });
    ports.persist();
    return res.json({ ok: true, encounter, mode: state.encounterRoutines?.[encounter],
      deathLimit: state.encounterAutoDeathLimits?.[encounter] });
  };
}
