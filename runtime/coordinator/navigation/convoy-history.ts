import type { PartyConvoy } from "./convoy.ts";
import type { StoredCombatLogEntry } from "../telemetry/combat-log.ts";

export interface ConvoyHistoryState {
  combatLogs?: Record<string, StoredCombatLogEntry[] | undefined>;
  monsterHunt?: { convoyId?: string | null; stage?: string; target?: string | null; returnTown?: import('./return-town.ts').ReturnTownPolicy; travelCheckpoint?: import('./continuous-return.ts').HuntTravelCheckpoint } | null;
}
type Convoy = Pick<PartyConvoy, "id" | "phase"> & Partial<PartyConvoy>;

/** One entry per lifecycle transition, retaining destinations independently of mutable commands. */
export function recordConvoyHistory(state: ConvoyHistoryState, c: Convoy, event: string, now: number,
  details: Record<string, unknown> = {}): void {
  if (!state.combatLogs || !c.leader) return;
  const entries = state.combatLogs[c.leader] ||= [];
  entries.push({ at: now, type: "navigation", message: "Convoy " + event, details: {
    convoyId: c.id, epoch: c.epoch, phase: c.phase, purpose: c.purpose, cause: c.cause, label: c.label,
    destination: c.location && { map: c.location.map, in: c.location.in, x: c.location.x, y: c.location.y },
    huntStage: state.monsterHunt?.stage, huntTarget: state.monsterHunt?.target,
    revisions: Object.fromEntries(Object.entries(c.expected || {}).map(([name, expected]) => [name, expected.revision])),
    ...details,
  } });
  if (entries.length > 500) entries.splice(0, entries.length - 500);
}
