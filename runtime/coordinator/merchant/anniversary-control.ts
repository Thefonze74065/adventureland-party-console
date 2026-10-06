interface AnniversaryEvent {
  active?: boolean;
  live?: boolean;
  next?: number;
  round?: string | number;
  target?: string;
  expires?: number;
  available?: boolean;
}
export interface AnniversaryMerchantStatus {
  anniversaryServer?: AnniversaryEvent;
  anniversaryState?: {
    busy?: boolean;
    retryAt?: number;
    mode?: string;
    completedRound?: string | null;
  };
  anniversaryVisit?: unknown;
}
export interface MerchantAnniversaryControl {
  live: boolean;
  featured: boolean;
  kissDue: boolean;
  preWindow: boolean;
  reserved: boolean;
  busy: boolean;
  retryAt: number;
  mode: string;
}

function stagingWindow(event: AnniversaryEvent | undefined, now: number): boolean {
  if (!event || event.active === false || event.live !== false) return false;
  const next = Number(event.next) || 0;
  return !!next && next - now <= 90_000 && next - now >= -15_000;
}

function liveRound(
  event: AnniversaryEvent | undefined,
  aborted: Readonly<Record<string, unknown>>,
  now: number,
): boolean {
  if (!event || aborted[String(event.round)]) return false;
  return (
    event.active !== false &&
    event.live !== false &&
    !!event.target &&
    (!Number(event.expires) || Number(event.expires) > now)
  );
}

function featuredFinished(
  event: AnniversaryEvent | undefined,
  merchant: string | null,
  live: boolean,
  now: number,
): boolean {
  if (!live || event?.target !== merchant || !Number(event.expires)) return false;
  return now >= Number(event.expires) - 300_000 + 60_000;
}

function isFeatured(
  event: AnniversaryEvent | undefined,
  merchant: string | null,
  live: boolean,
  complete: boolean,
): boolean {
  return live && event?.target === merchant && !complete;
}

function visitDue(
  event: AnniversaryEvent | undefined,
  status: AnniversaryMerchantStatus | undefined,
  live: boolean,
  featured: boolean,
  completed: boolean,
  retryAt: number,
  now: number,
): boolean {
  return (
    live &&
    !featured &&
    event?.available !== false &&
    !!status?.anniversaryVisit &&
    !completed &&
    retryAt <= now
  );
}

/**
 * The pre-window and a live round hold the merchant in Main, except while the
 * featured player is unavailable (offline, dead, hidden or on a private map):
 * queued work runs then, and `kissDue` reclaims the merchant if it returns.
 */
function movementReserved(preWindow: boolean, live: boolean, complete: boolean, unavailable: boolean): boolean {
  return preWindow || (live && !complete && !unavailable);
}

function busy(state: NonNullable<AnniversaryMerchantStatus["anniversaryState"]>): boolean {
  return !!state.busy || state.mode === "kiss-active";
}

function completedVisit(
  state: NonNullable<AnniversaryMerchantStatus["anniversaryState"]>,
  event: AnniversaryEvent | undefined,
): boolean {
  return (
    state.mode === "complete" &&
    (state.completedRound === undefined || state.completedRound === String(event?.round))
  );
}

/** A live round whose featured player (someone other than the merchant) cannot be visited. */
function unavailableRound(event: AnniversaryEvent | undefined, live: boolean, featured: boolean): boolean {
  return live && !featured && event?.available === false;
}

/** The featured merchant waits one minute; other visits retain their existing retry ownership. */
function claimedVisit(event: AnniversaryEvent | undefined, claimedRound: string | undefined): boolean {
  return claimedRound !== undefined && claimedRound === String(event?.round);
}

export function merchantAnniversaryControl(
  merchant: string | null,
  enabled: boolean,
  status: AnniversaryMerchantStatus | undefined,
  aborted: Readonly<Record<string, unknown>>,
  now: number,
  claimedRound?: string,
): MerchantAnniversaryControl {
  const event = enabled ? status?.anniversaryServer : undefined;
  const state = status?.anniversaryState || {};
  const preWindow = stagingWindow(event, now),
    live = liveRound(event, aborted, now);
  const complete = featuredFinished(event, merchant, live, now);
  const featured = isFeatured(event, merchant, live, complete);
  const retryAt = Number(state.retryAt) || 0;
  const completed = completedVisit(state, event) || complete || claimedVisit(event, claimedRound);
  const kissDue = visitDue(event, status, live, featured, completed, retryAt, now);
  return {
    live,
    featured,
    kissDue,
    preWindow,
    reserved: movementReserved(preWindow, live, completed, unavailableRound(event, live, featured)),
    busy: live && busy(state),
    retryAt,
    mode: state.mode || "idle",
  };
}
