import { distance, reportMatches, type SharedConvoy, type SharedState } from './shared-route-types.ts';

// Client clocks are estimated from heartbeat round trips. A released client may
// report movement just before the coordinator's clock reaches the same deadline.
function departed(state: SharedState, c: SharedConvoy, name: string, now: number): boolean {
  const report = state.statuses[name]?.convoyNavigation;
  return !!report && reportMatches(state, name) && report.routeVersion === c.routeVersion &&
    ['travelling', 'arrived'].includes(report.phase) && Number.isFinite(report.departedAt) &&
    now >= c.departAt! - 500 && report.departedAt! >= c.departAt! - 500 && report.departedAt! <= now + 500;
}

export function readinessIssue(state: SharedState, c: SharedConvoy, name: string): string | undefined {
  if (!reportMatches(state, name)) return 'waiting for current route acknowledgement';
  const s = state.statuses[name]!, n = s.convoyNavigation!;
  if (n.routeVersion !== c.routeVersion) return 'installed route version changed';
  if (!n.routeReady || !['route-ready', 'waiting-for-departure'].includes(n.phase)) return 'route not ready (' + n.phase + ')';
  if (s.moving) return 'character still moving';
  if (distance(s, c.rally) > 55) return 'outside rendezvous range';
  if (!(Number(s.speed) > 0 && Number(s.speed) <= c.slowestSpeed + 0.1)) return 'waiting for cruise speed';
  return undefined;
}

export function readinessExpired(c: SharedConvoy, now: number): boolean {
  return c.readinessStartedAt !== undefined && now - c.readinessStartedAt >= 60000;
}

export function readinessFailure(c: SharedConvoy, reason: string): boolean {
  return ['shared-prepare', 'scheduled', 'travel'].includes(c.phase) && !reason.startsWith('Departure readiness timed out:') &&
    preparationChanged(reason);
}

export function departureConfirmed(state: SharedState, c: SharedConvoy, now: number): boolean {
  return c.participants.every(name => c.completed.includes(name) || departed(state, c, name, now));
}

export function recoveryPlanner(c: SharedConvoy, reason: string): void {
  delete c.readinessStartedAt;
  if (/Stalled walking movement/i.test(reason)) c.walkingFailures = (c.walkingFailures || 0) + 1;
  if (/leave transition/i.test(reason)) c.avoidLeave = true;
  // A second no-progress walk is evidence to try another planner, unlike an
  // assembly/acknowledgement failure. Preserve the choice through later retries.
  c.nativeFallback = !!c.nativeFallback || (c.walkingFailures || 0) >= 2 || /route rejected|geometry|unwalkable|path not found|no path/i.test(reason);
}

export function departureIssue(state: SharedState, c: SharedConvoy, now: number): string | undefined {
  for (const name of c.participants.filter(n => !c.completed.includes(n))) {
    if (departed(state, c, name, now)) continue;
    const issue = readinessIssue(state, c, name);
    if (issue) return name + ': ' + issue;
    const origin = c.origins?.[name];
    if (!origin || distance(state.statuses[name]!, origin) > 1) return name + ': route origin changed';
  }
  return undefined;
}

/** Preparation drift is not evidence that the destination is unreachable. */
export function preparationChanged(reason: string): boolean {
  return !reason.includes('Departure readiness timed out:') &&
    /Leader moved from planning origin|Route origin changed before departure|Cruise speed changed|Prepared shared route changed|Departure signal arrived too late|Missed convoy departure window|Departure changed/.test(reason);
}
