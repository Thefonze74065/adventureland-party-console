import type { EventRecovery, EventReturnState } from "./return-types.ts";
import type { EventSession, DeferredRecovery } from "./observations.ts";
import type { HuntEventTrips } from "./hunt-trip.ts";
import type { ABStrategy } from "./abtesting.ts";

/** Durable event ownership loaded before observations rebuild live event state. */
export interface SavedEventState extends HuntEventTrips {
  activeRealm?: unknown;
  eventReturn?: EventRecovery | null;
  eventSessions?: Record<string, EventSession> | null;
  deferredEventReturns?: Record<string, DeferredRecovery> | null;
  abtestingStrategy?: ABStrategy | null;
  bossChase?: unknown;
  dailyChase?: unknown;
}

export type LastEventReturn = EventReturnState["last"];
