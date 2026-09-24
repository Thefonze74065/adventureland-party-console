import { recordConvoyHistory } from './convoy-history.ts';
import { sharedArrivalReady } from './shared-route-store.ts';
import type { SharedConvoy, SharedState } from './shared-route-types.ts';
import { rememberCompletion } from './completion-receipts.ts';

/** Recover a missing HTTP completion using the same owned arrival reports. */
export function reconcileReturnArrival(state: SharedState, c: SharedConvoy, now: number): boolean {
  if (c.purpose !== 'monster-hunt' || !c.continuousReturn || c.phase !== 'travel') return false;
  if (!sharedArrivalReady(state, now)) { delete c.arrivalReadySince; return false; }
  c.arrivalReadySince ??= now;
  // Give the normal completion requests time to settle before retiring their commands.
  if (now - c.arrivalReadySince < 3000) return false;
  for (const name of c.participants) {
    if (!c.completed.includes(name)) {
      const command = state.commands[name]!;
      rememberCompletion(state, name, { convoyId: c.id, epoch: c.epoch, commandId: command.id,
        runtimeId: c.runtimes?.[name], navigationRevision: command.navigationRevision, routeVersion: c.routeVersion });
      delete state.commands[name];
    }
  }
  c.completed = [...c.participants];
  recordConvoyHistory(state, c, 'completed', now, { reason: 'Verified return arrival recovered missing completion acknowledgment' });
  state.activeConvoy = null;
  return true;
}
