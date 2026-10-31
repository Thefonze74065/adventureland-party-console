import { errorReason, type CombatState } from "./types.ts";

export type EventRejoinOutcome = { status: "not-applicable" | "recovered" | "retryable" | "cancelled"; phase?: "event-reentry" | "event-travel"; reason?: string };
interface RecoveryPorts {
  isDead(): boolean;
  needsEventReturn?(): boolean;
  blocked?(): boolean;
  respawn(): Promise<unknown>;
  releaseCombat(): void;
  publish(state: CombatState): void;
  rejoinEvent(): Promise<EventRejoinOutcome>;
  rejoinFarm(): unknown;
  log(message: string): void;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout> | undefined): void;
}

/** Alive state, rather than a possibly lost reply, completes the respawn phase. */
export function createDeathRecovery(ports: RecoveryPorts): () => Promise<void> {
  let recovering = false, pendingReturn = false, revived = false, attempt = 0, retryAt = 0;
  let phase = "respawn", lastError: string | null = null, errorAt: number | null = null;
  const publish = (stage: string, error: string | null = null) => {
    if (error) { lastError = error; errorAt = Date.now(); }
    ports.publish({ at: Date.now(), stage, error, recovery: {
      phase, attempt, lastError, errorAt, status: stage, at: Date.now(),
      recoveredAt: stage === "recovery-complete" ? Date.now() : null,
    } });
  };
  async function spawn() {
    phase = "respawn"; attempt++; publish("respawning");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ports.respawn(), new Promise<void>(resolve => {
        timeout = ports.setTimeout(resolve, 3000);
      })]);
    } finally { ports.clearTimeout(timeout); }
    if (ports.isDead()) publish("respawn-waiting", "No alive confirmation yet");
  }
  async function returnToActivity() {
    if (!revived) { ports.releaseCombat(); revived = true; publish("respawned"); }
    phase = "event-reentry";
    const result = await ports.rejoinEvent();
    phase = result.phase || phase;
    if (result.status === "retryable") {
      publish("recovery-retry", result.reason || "Event recovery pending");
      retryAt = Date.now() + 1000;
      return;
    }
    if (result.status === "not-applicable") { phase = "farm-return"; await ports.rejoinFarm(); }
    pendingReturn = false;
    publish(result.status === "cancelled" ? "recovery-cancelled" : "recovery-complete");
  }
  function observeDeath() {
    if (ports.isDead()) {
      if (!pendingReturn || revived) { attempt = 0; lastError = null; errorAt = null; retryAt = 0; }
      pendingReturn = true; revived = false;
    }
    else if (!pendingReturn && ports.needsEventReturn?.()) {
      // CODE may resume after native revival; the saved event intent still owns
      // recovery even when this runner never observed the dead frame.
      pendingReturn = true; revived = false;
    }
  }
  return async () => {
    if (ports.blocked?.()) return;
    observeDeath();
    if (!pendingReturn || recovering || Date.now() < retryAt) return;
    recovering = true;
    try {
      if (ports.isDead()) await spawn();
      if (!ports.isDead() && !ports.blocked?.()) await returnToActivity();
    } catch (error) {
      const reason = errorReason(error);
      publish("recovery-retry", reason);
      if (reason !== "cant_respawn" && reason !== "cooldown")
        ports.log((phase === "respawn" ? "Respawn failed" : phase + " failed") + ": " + reason);
      retryAt = Date.now() + 1000;
    } finally { recovering = false; }
  };
}
