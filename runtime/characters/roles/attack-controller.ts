import type { CombatState, Target } from "./types.ts";
import { errorReason } from "./types.ts";
import { createCrabRangeRecovery, type RangeSample } from "./crab-range.ts";
import { effectiveAttackDamageType, monsterAttackBlock } from "./monster-attack-policy.ts";

interface Flight {
  passing: boolean;
  epoch: number;
  targetId: string;
  revision: string | null;
  expires: number;
  sentAt: number;
  range: RangeSample | null;
  pending: number;
  success: boolean;
  slotsDone: boolean;
}
interface AttackPorts {
  skillAttack?(target: Target): Promise<boolean> | null;
  skillBusy?(): boolean;
  passing?(target: Target): boolean;
  preparePassing?(target: Target): boolean | void;
  equipmentBusy?(): boolean;
  target(): Target | null;
  selected(): string | null;
  epoch(): number;
  active(): boolean;
  allowed(): boolean;
  state(): CombatState;
  report(this: void, error: unknown): void;
}
export function createAttackController(ports: AttackPorts) {
  let flight: Flight | null = null;
  let lastSuccessfulTarget: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let burstTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false, retryAt = 0, dueAt = 0;
  let lastTimerLatenessMs=0;
  const monotonic=()=>typeof performance==='undefined'?Date.now():performance.now();
  const clock = () => {
    const client = parent as unknown as { next_skill?: { attack?: Date }; pings?: number[] };
    const value = Number(client.next_skill?.attack);
    return Number.isFinite(value) ? value : null;
  };
  const remaining = () => Math.max(0, (clock() ?? retryAt) - Date.now());
  function cancelSlots() {
    if (burstTimer !== null) clearTimeout(burstTimer);
    burstTimer = null;
    if (flight) flight.slotsDone = true;
  }
  function schedule(delay: number) {
    if (!running) return;
    if (timer !== null) clearTimeout(timer);
    dueAt = Date.now() + Math.max(1, delay);
    const scheduled=monotonic(),wait=Math.max(1,delay);
    timer = setTimeout(() => { lastTimerLatenessMs=Math.max(0,monotonic()-scheduled-wait);timer = null; tick(); }, Math.max(1, delay));
  }
  const recovery = createCrabRangeRecovery();
  const sample = (target: Target) => sharedRoutine.describeAttackRange?.(target) ?? null;
  const correctedDistance = (target: Target) => recovery.distance(sample(target), Date.now());
  if (typeof sharedRoutine !== "undefined") sharedRoutine.correctedCombatDistance = correctedDistance;
  function rejected(attempt: Flight, error: unknown): void {
    if (!confirmed(attempt)) return;
    if (errorReason(error) === "too_far" && attempt.range && Date.now() - attempt.sentAt <= 2000) {
      recovery.reject(attempt.range, error, Date.now());
      ports.state().rangeRecovery = recovery.diagnostic();
    }
    ports.report(error);
  }
  function reserveHealing(): boolean {
    if (!sharedRoutine.basicAttackReserved?.()) {
      if (!sharedRoutine.caveRecoveryReserved?.()) return false;
      ports.state().skippedAttack = "cave priest recovery";
      return true;
    }
    ports.state().skippedAttack = "priest healing priority";
    Promise.resolve(sharedRoutine.healPartyBelow(0.9)).catch(ports.report);
    return true;
  }
  function releaseExpired(target: Target | null): void {
    if (!flight || Date.now() < flight.expires) return;
    const ready = typeof is_on_cooldown === "function"
      ? !is_on_cooldown("attack") : target && can_attack(target);
    if (ready) { cancelSlots(); flight = null; }
  }
  function confirmed(attempt: Flight): boolean {
    return passingConfirmed(attempt) && ports.active() && attempt.epoch === ports.epoch() &&
      ports.selected() === attempt.targetId && !!ports.target() &&
      (!sharedRoutine.combatTargetRevision || attempt.revision === sharedRoutine.combatTargetRevision());
  }
  function passingConfirmed(attempt: Flight): boolean {
    if (!attempt.passing) return true;
    const target = ports.target();
    return !!target && !!ports.passing?.(target);
  }
  function permitted(target: Target): boolean {
    if (ports.equipmentBusy?.()) {
      ports.state().skippedAttack = "weapon equipment change in progress";
      return false;
    }
    const client = parent as unknown as { is_disabled?: (actor: typeof character) => boolean };
    if (client.is_disabled?.(character)) { ports.state().skippedAttack = "character disabled"; return false; }
    if (!ports.passing?.(target) && sharedRoutine.groupedAttackAllowed && !sharedRoutine.groupedAttackAllowed(target)) {
      ports.state().skippedAttack = "waiting for group readiness and target commitment";
      return false;
    }
    const blocked = monsterAttackBlock(target.mtype, effectiveAttackDamageType(character, typeof G === "undefined" ? undefined : G), Number(character.range));
    if (blocked) {
      ports.state().skippedAttack = blocked;
      return false;
    }
    if (sharedRoutine.rareAttackAllowed && !sharedRoutine.rareAttackAllowed(target, "attack")) {
      ports.state().skippedAttack = "Fairy deployment or attack policy";
      return false;
    }
    return true;
  }
  function send(target: Target): void {
    if (!permitted(target)) return;
    if (ports.passing?.(target) && ports.preparePassing?.(target) === false) {
      ports.state().skippedAttack = 'waiting for passing encounter acknowledgement';
      return;
    }
    const attempt: Flight = {
      passing: !!ports.passing?.(target), pending: 0, success: false, slotsDone: false,
      epoch: ports.epoch(), targetId: target.id,
      revision: sharedRoutine.combatTargetRevision?.() ?? null,
      sentAt: Date.now(),
      range: sample(target),
      expires: Date.now() + Math.max(2000, 2000 / (Number(character.frequency) || 1)),
    };
    flight = attempt;
    ports.state().skippedAttack = null;
    ports.state().stage = "attacking";
    const stats = ports.state().attackTiming ??= { bursts: 0, attempts: 0, accepted: 0, cooldownRejections: 0, timeouts: 0, lastOffsets: [] };
    stats.bursts++;
    stats.lastOffsets = [];
    // The deadline has already been compensated after the preceding success.
    const deadline = clock() ?? Date.now();
    const end = clock() === null ? Date.now() + 4 : deadline + 2;
    const attemptOnce = () => {
      if (flight !== attempt || !confirmed(attempt) || !ports.allowed() ||
          (sharedRoutine.basicAttackReserved?.() || sharedRoutine.caveRecoveryReserved?.()) || !is_in_range(target) || !permitted(target)) {
        cancelSlots(); return;
      }
      attempt.pending++;
      stats.attempts++;
      stats.lastOffsets.push(Date.now() - deadline);
      if (attempt.passing && ports.preparePassing?.(target) === false) {
        attempt.pending--; cancelSlots(); return;
      }
      const action=attempt.passing ? null : (sharedRoutine as any).queueEvidence?.(target,'pending');
      try {
        sharedRoutine.noteCombatHandoff?.('attempt', target.id, {cooldownReadyAt:clock(), frequency:Number(character.frequency),timerLatenessMs:lastTimerLatenessMs});
        Promise.resolve(attack(target)).then(() => {
          if (flight !== attempt || attempt.epoch !== ports.epoch() || !ports.active() || attempt.success) return;
          attempt.success = true;
          cancelSlots();
          stats.accepted++;
          sharedRoutine.noteCombatHandoff?.('accepted', target.id, {sentAt:attempt.sentAt});
          const client = parent as unknown as { pings?: number[] };
          const samples = (client.pings || []).filter(p => Number.isFinite(p) && p >= 0);
          if (samples.length && typeof reduce_cooldown === "function" &&
              (ports.state().lastHealAt ?? 0) < attempt.sentAt)
            reduce_cooldown("attack", Math.min(remaining(), Math.min(...samples)));
          retryAt = clock() === null ? Date.now() + 1000 / (Number(character.frequency) || 1) : 0;
          if (confirmed(attempt)) {
            if (!attempt.passing) sharedRoutine.noteAttack(target);
            lastSuccessfulTarget = target.id;
            if ((ports.state().errorAt ?? 0) <= attempt.sentAt) ports.state().error = null;
          }
        }, error => {
          if(action)(sharedRoutine as any).queueEvidence?.(target,'rejected',action);
          if (flight !== attempt) return;
          if (errorReason(error) === "cooldown") stats.cooldownRejections++;
          else { cancelSlots(); rejected(attempt, error); }
        }).finally(() => {
          attempt.pending--;
          if (flight === attempt && attempt.slotsDone && !attempt.pending) finish();
        });
      } catch (error) {
        if(action)(sharedRoutine as any).queueEvidence?.(target,'rejected',action);
        attempt.pending--; cancelSlots(); rejected(attempt, error);
      }
    };
    const finish = () => {
      if (flight !== attempt) return;
      flight = null;
      if (!attempt.success) retryAt = Math.max(retryAt, Date.now() + 100);
      schedule(Math.max(remaining() - 2, retryAt - Date.now(), 1));
    };
    let count = 0;
    const slot = () => {
      burstTimer = null;
      if (flight !== attempt || attempt.slotsDone) return;
      attemptOnce(); count++;
      if (count >= 5 || Date.now() >= end || attempt.slotsDone) {
        attempt.slotsDone = true;
        if (!attempt.pending) finish();
        return;
      }
      // Schedule from actual execution time: missed slots are never replayed.
      burstTimer = setTimeout(slot, 1);
    };
    slot();
  }

  function attackTarget(target: Target): void {
    // A missing deferred can be retried only after its acknowledgement window
    // and the real attack cooldown have both elapsed.
    if (flight && Date.now() >= flight.expires && can_attack(target)) { cancelSlots(); flight = null; }
    if (flight) { ports.state().skippedAttack = "attack pending"; return; }
    if (ports.skillBusy?.()) { ports.state().skippedAttack = 'skill attack pending'; return; }
    if (reserveHealing()) return;
    if (!ports.passing?.(target) && !ports.equipmentBusy?.()) {
      const alternative = ports.skillAttack?.(target);
      if (alternative) {
        const epoch = ports.epoch();
        ports.state().stage = 'skill attack';
        void alternative.then(accepted => {
          if (epoch !== ports.epoch() || !ports.active()) return;
          if (accepted) lastSuccessfulTarget = target.id;
          retryAt = Date.now() + (accepted ? 1 : 100);
          schedule(Math.max(remaining(), retryAt - Date.now()));
        }).catch(ports.report);
        return;
      }
    }
    if (recovery.blocked(sample(target), Date.now())) {
      ports.state().skippedAttack = "crab range recovery"; return;
    }
    if (!can_attack(target) && !(clock() !== null && remaining() <= 2 && is_in_range(target))) {
      ports.state().skippedAttack = is_in_range(target) ? "cooldown" : "range";
      return;
    }
    send(target);
  }
  function tick() {
    ports.state().skippedAttack=undefined;
    try {
      sharedRoutine.correctedCombatDistance = correctedDistance;
      const target = ports.target();
      if(flight && ports.selected()!==flight.targetId){cancelSlots();flight=null;}
      recovery.select(target ? sample(target) : null, Date.now());
      if (flight && Date.now() >= flight.expires) {
        const stats = ports.state().attackTiming;
        if (stats) stats.timeouts++;
      }
      releaseExpired(target);
      if (flight && (!confirmed(flight) || !ports.allowed() || sharedRoutine.basicAttackReserved?.() || sharedRoutine.caveRecoveryReserved?.())) cancelSlots();
      if (ports.allowed() && !flight && reserveHealing()) return;
      if (!target || !ports.allowed()) { ports.state().skippedAttack = "no eligible target or combat blocked"; return; }
      if (Date.now() < retryAt || remaining() > 2) {
        ports.state().skippedAttack = remaining() > 2 ? 'cooldown' : 'attack retry backoff';
        return;
      }
      attackTarget(target);
    } catch (error) { cancelSlots(); flight = null; ports.report(error); }
    finally {
      const id=ports.selected(), reason=ports.state().skippedAttack;
      if(id && reason)sharedRoutine.noteCombatHandoff?.('blocked',id,{reason,cooldownReadyAt:clock()});
      schedule(flight ? Math.max(1, flight.expires - Date.now()) : Math.max(remaining() > 2 ? remaining() - 2 : 100, retryAt - Date.now()));
    }
  }
  return {
    pending() { return !!flight; },
    hasStarted(targetId: string) { return flight?.targetId === targetId || lastSuccessfulTarget === targetId; },
    reset() { cancelSlots(); flight = null; lastSuccessfulTarget = null; retryAt = 0; recovery.reset("runtime reset"); },
    start() { running = true; schedule(Math.max(1, remaining() - 2)); },
    stop() { running = false; cancelSlots(); flight = null; if (timer !== null) clearTimeout(timer); timer = null; },
    wake() {
      const delay = Math.max(1, remaining() - 2, retryAt - Date.now());
      if (timer === null || Date.now() + delay < dueAt) schedule(delay);
    },
    tick,
  };
}
