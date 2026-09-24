import { requestObject } from '../http/contracts.ts';
import { recordConvoyHistory } from './convoy-history.ts';
import { characterRuntime, reportMatches, type SharedConvoy, type SharedState, type SharedReport } from './shared-route-types.ts';

/** Only the old, captured completion-network failure is eligible for migration. */
export function legacyCompletionFailure(c: { id: string; purpose?: string | null; phase: string;
  failure?: string; failureDetails?: unknown; communicationLegacyRecovered?: boolean; location?: {map: string; x: number; y: number} }): boolean {
  if (c.purpose !== 'monster-hunt' || c.phase !== 'failed' || c.communicationLegacyRecovered) return false;
  if (!/POST \/convoy-complete · (network|timeout)(?:$|:)/.test(c.failure || '')) return false;
  const context = requestObject(requestObject(c.failureDetails).failureContext);
  const position = requestObject(context.position), destination = requestObject(context.destination);
  return context.phase === 'arrived' && context.convoyId === c.id && !!c.location &&
    equalPosition(destination, c.location) && equalPosition(position, destination);
}
function equalPosition(a: Record<string, unknown>, b: {map?: unknown; x?: unknown; y?: unknown}): boolean {
  return a.map === b.map && a.x === b.x && a.y === b.y;
}

interface Ports {
  owned(state: SharedState, c: SharedConvoy, name: string): boolean;
  hold(state: SharedState, c: SharedConvoy): void;
  resume(state: SharedState, c: SharedConvoy, now: number): boolean;
  fail(state: SharedState, reason: string, code: string): boolean;
}
interface Stability { since: number; observedAt: number; runtimes: string }

/** Readiness is intentionally not persisted: every restart requires fresh observations. */
export function createCommunicationRecovery(ports: Ports) {
  const stable = new WeakMap<SharedConvoy, Stability>();
  function enter(state: SharedState, c: SharedConvoy, now: number, names: string[], legacy: boolean): boolean {
    c.communicationHold = { since: now, participants: names, reason: legacy ? 'Recovering failed completion acknowledgement' : 'Waiting for coordinator communication', legacy };
    if (legacy) c.communicationLegacyRecovered = true;
    c.phase = 'communication-hold'; c.departAt = null; c.epoch++;
    c.completed = []; c.failureCode = undefined; c.failure = c.communicationHold.reason;
    ports.hold(state, c);
    recordConvoyHistory(state, c, 'communication lost', now, { ...c.communicationHold });
    return true;
  }
  function detect(state: SharedState, c: SharedConvoy, now: number): boolean {
    const legacy = legacyCompletionFailure(c);
    if (c.phase === 'failed' && !legacy) return false;
    const names = c.participants.filter(n => affected(state, c, n, now));
    if (!legacy && !names.length) return false;
    if (!c.participants.every(n => ports.owned(state, c, n))) return false;
    return enter(state, c, now, legacy ? c.participants : names, legacy);
  }
  function rebind(state: SharedState, c: SharedConvoy, now: number): boolean {
    const changed = c.participants.some(n => {
      const s = state.statuses[n];
      return !state.commands[n] || !!s && now - s.seenAt <= 3000 &&
        !!characterRuntime(s) && c.expected?.[n]?.runtimeId !== characterRuntime(s);
    });
    if (!changed) return false;
    stable.delete(c); c.epoch++; ports.hold(state, c);
    return true;
  }
  function ready(state: SharedState, c: SharedConvoy, now: number): boolean {
    const leader = state.statuses[c.leader];
    return c.participants.every(n => {
      const s = state.statuses[n];
      if (!readyStatus(s, now)) return false;
      return s.convoyProtocol === 4 && !!characterRuntime(s) && s.server === (c.routeServer || leader?.server) &&
        reportMatches(state, n) && s.convoyNavigation?.phase === 'held';
    });
  }
  function resume(state: SharedState, c: SharedConvoy, now: number): boolean {
    const hold = c.communicationHold!;
    if (!ready(state, c, now)) { stable.delete(c); c.failure = hold.reason; return false; }
    const runtimes = JSON.stringify(c.participants.map(n => characterRuntime(state.statuses[n])));
    let window = stable.get(c);
    if (!window || window.runtimes !== runtimes || now - window.observedAt > 3000) {
      window = { since: now, observedAt: now, runtimes }; stable.set(c, window);
    }
    window.observedAt = now;
    c.failure = 'Communication restored; checking stable party reports';
    if (now - window.since < 5000 || now - (c.communicationResumedAt ?? -Infinity) < 30000) return false;
    if (!ports.resume(state, c, now)) return false;
    delete c.communicationHold; c.communicationResumedAt = now; c.failure = undefined;
    delete c.failureCode; delete c.failedAt; c.restartRecovery = false;
    // Preserve movement counters. Only the terminal marker for the migrated network failure is retired.
    if (hold.legacy) c.retryExhausted = false;
    recordConvoyHistory(state, c, 'communication restored', now, { durationMs: now - hold.since, participants: hold.participants });
    stable.delete(c);
    return true;
  }
  return function step(state: SharedState, c: SharedConvoy, now: number): boolean | null {
    if (!eligible(state, c)) return null;
    if (!c.communicationHold) return detect(state, c, now) ? true : null;
    if (!c.participants.every(n => ports.owned(state, c, n))) {
      delete c.communicationHold; stable.delete(c);
      return ports.fail(state, 'Communication recovery superseded by newer navigation', 'owner-lost');
    }
    if (rebind(state, c, now)) return true;
    return resume(state, c, now);
  };
}

function eligible(state: SharedState, c: SharedConvoy): boolean {
  return c.purpose === 'monster-hunt' && c.geometryRepair?.phase !== 'waiting' &&
    c.failureCode !== 'geometry-mismatch' && state.monsterHunt?.convoyId === c.id;
}
function readyStatus(s: SharedState['statuses'][string], now: number): s is NonNullable<SharedState['statuses'][string]> {
  return !!s && !s.rip && s.hp !== 0 && !s.moving && now - s.seenAt <= 3000 && s.seenAt <= now + 500;
}

function affected(state: SharedState, c: SharedConvoy, name: string, now: number): boolean {
  if (c.completed.includes(name)) return false;
  const s = state.statuses[name];
  if (s?.rip || s?.hp === 0) return false;
  if (!s || now - s.seenAt > 3000) return true;
  return reportMatches(state, name) && communicationReport(s.convoyNavigation);
}
function communicationReport(report: SharedReport | undefined): boolean {
  return report?.phase === 'communication-hold' && !!report.communication;
}
