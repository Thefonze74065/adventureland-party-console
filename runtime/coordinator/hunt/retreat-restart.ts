import type { HuntCycle, HuntStatus } from './contracts.ts';
import type { CombatRecovery, EscapeRecovery } from '../navigation/recovery-contracts.ts';
import type { StoredCombatLogEntry } from '../telemetry/combat-log.ts';
import { requestObject } from '../http/contracts.ts';

interface State {
  leader: string | null;
  farmingPolicy: string;
  monsterFocus: string[];
  monsterHunt: HuntCycle | null;
  combatRecovery?: CombatRecovery | null;
  escape?: EscapeRecovery | null;
  eventReturn?: unknown;
  activeConvoy?: unknown;
  commands: Record<string, unknown>;
  statuses: Record<string, HuntStatus | undefined>;
  combatLogs: Record<string, StoredCombatLogEntry[]>;
}
interface Ports {
  now(): number;
  intent(name: string): { revision: number; cancelled?: boolean };
  participants(): string[];
  releaseEscape(): void;
  begin(policy?: string, location?: HuntCycle['returnLocation'], resume?: boolean): boolean;
  persist(): void;
}

/** An exhausted escape is terminal; restarting Hunt must not replay it on every heartbeat. */
export function createHuntRetreatRestart(state: State, ports: Ports) {
  function owned(recovery: CombatRecovery): boolean {
    return recovery.leader === state.leader && recovery.focus === JSON.stringify(state.monsterFocus) &&
      recovery.names.every(name => {
        const intent = ports.intent(name);
        return !intent.cancelled && intent.revision === recovery.revisions[name] && !state.commands[name];
      });
  }
  function eventActive(): boolean {
    return !!state.eventReturn || !!state.activeConvoy || state.combatRecovery!.names.some(name => {
      const status = requestObject(state.statuses[name]);
      return status.activeEvent || status.joinedEvent || status.mapEvent || status.eventTraveling;
    });
  }
  function failure(escapeId: string) {
    return state.combatRecovery!.names.flatMap(name => {
      const status = state.statuses[name], report = requestObject(requestObject(status).escape);
      if (!status || ports.now() - status.seenAt > 3000 || status.seenAt > ports.now() + 500 ||
          status.rip || status.hp === 0 || report.id !== escapeId || report.recoveryFailed !== true) return [];
      return [{ name, map: status.map, x: status.x, y: status.y,
        error: typeof report.error === 'string' ? report.error : 'retreat attempts exhausted' }];
    })[0];
  }
  function eligible(recovery: CombatRecovery | null | undefined): recovery is CombatRecovery {
    return state.farmingPolicy === 'hunt' && !!state.monsterHunt && !state.monsterHunt.exitMode &&
      !!recovery && recovery.policy === 'hunt' && ['escaping', 'recovering'].includes(recovery.phase);
  }
  function activeEscape(escape: EscapeRecovery | null | undefined): escape is EscapeRecovery & { id: string } {
    return escape?.stage === 'recovering' && typeof escape.id === 'string';
  }
  function record(failed: NonNullable<ReturnType<typeof failure>>, escapeId: string, recovery: CombatRecovery, oldCycleId: string) {
    const logs = state.combatLogs[state.leader!] ||= [];
    logs.push({ at: ports.now(), type: 'disengagement',
      message: `restarting hunting routine due to failure: ${failed.name} at ${failed.map} (${failed.x}, ${failed.y}): ${failed.error}`,
      details: { ...failed, escapeId, recoveryId: recovery.id, oldCycleId, newCycleId: state.monsterHunt?.cycleId } });
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  }
  return function restart(): boolean {
    const recovery = state.combatRecovery, escape = state.escape, hunt = state.monsterHunt;
    if (!eligible(recovery) || !hunt || !activeEscape(escape) || recovery.restartedEscapeId === escape.id) return false;
    if (!owned(recovery) || eventActive() || !ports.participants().includes(state.leader!)) return false;
    const failed = failure(escape.id);
    if (!failed) return false;
    const escapeId = escape.id, oldCycleId = hunt.cycleId;
    // Persist the handled identity before releasing escape (which also persists).
    recovery.restartedEscapeId = escapeId;
    recovery.phase = 'cancelled';
    recovery.reason = 'Restarting Hunt after exhausted retreat';
    ports.releaseEscape();
    ports.begin(hunt.returnPolicy, hunt.returnLocation, false);
    record(failed, escapeId, recovery, oldCycleId);
    ports.persist();
    return true;
  };
}
