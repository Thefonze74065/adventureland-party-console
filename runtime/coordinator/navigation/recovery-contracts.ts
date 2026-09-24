import type { ReturnLocation } from "../events/return-types.ts";

/** Durable escape ownership; the escape executor retains its per-role progress metadata. */
export interface EscapeRecovery {
  [field: string]: unknown;
  participants: string[];
  stage: string;
}

/** Captured farming authority survives the finishing, escape and farm-return phases. */
export interface CombatRecovery {
  [field: string]: unknown;
  id: string;
  phase: string;
  reason?: string;
  names: string[];
  leader: string | null;
  server?: string;
  focus: string;
  policy: string;
  location: ReturnLocation | null;
  revisions: Record<string, number>;
  at: number;
  deaths: string[];
  resumeReset?: boolean;
  restartedEscapeId?: string;
  returnConvoyId?: string;
}

export interface SavedRecoveryState {
  escape?: EscapeRecovery | null;
  combatRecovery?: CombatRecovery | null;
  combatHuntBoundary?: string | null;
  combatDeathSeen?: Record<string, { at: number; dead: boolean } | undefined> | null;
  combatResetByCharacter?: Record<string, number | undefined> | null;
  groupedCombatResetAt?: number | null;
}
