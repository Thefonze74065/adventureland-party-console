import { createManaBudget } from './budget.ts';
import { errorReason } from '../roles/types.ts';
import { blocked, burstRefunds, cost, reserve, unlocked, unrestrictedCleave } from './eligibility.ts';
import { bestAttack, burstChoices, damageChoices, fanFarming, fanStand, fanVerdict } from './offense.ts';
import { absorbDecision, paladinSupport, rogueSupport, combatBuffSupport, opener } from './protection.ts';
import type { Combatant, SkillDecision, SkillDiagnostic, SkillId, SkillWorld } from './types.ts';

export interface SkillPorts {
  world(): SkillWorld;
  cast(d: SkillDecision): Promise<unknown>;
  publishAfterCast?(d: SkillDecision): boolean;
  evidence(target: Combatant, state: 'pending' | 'engaged' | 'rejected', action?: string): string | null;
  diagnostic(d: SkillDiagnostic): void;
}
interface Pending { cost: number; until: number; epoch: number }
export function createSkillEngine(ports: SkillPorts) {
  const budget = createManaBudget(), pending = new Map<SkillId, Pending>();
  let epoch = 0, stopped = false, auraAt = -Infinity, auraState = '', openerPending = false;
  const failures = new Map<SkillId, number>();
  function world() {
    const w = ports.world();
    for (const [id, p] of pending) if (p.until <= w.now && !w.cooldown(id)) pending.delete(id);
    return w;
  }
  const family = (w: SkillWorld, id: SkillId) => w.skills[id]?.share || id;
  function report(w: SkillWorld, d: SkillDecision, status: SkillDiagnostic['status'], reason = d.reason) {
    ports.diagnostic({ at: w.now, skill: d.skill, targets: d.targets.map(t => t.id || t.name),
      category: d.category, reserve: reserve(w), reason, status });
  }
  function affordable(w: SkillWorld, d: SkillDecision): boolean {
    const inFlight = [...pending.values()].reduce((n, p) => n + p.cost, 0);
    const reason = blocked(w, d, inFlight);
    if (reason) { report(w, d, 'skipped', reason); return false; }
    if (pending.has(family(w, d.skill)) || (failures.get(d.skill) || 0) > w.now) return false;
    const cap = Math.max(0, ...Object.keys(w.skills).map(id => id as SkillId)
      .filter(id => unlocked(w, id) && cost(w, id) <= w.actor.mp - reserve(w))
      .map(id => cost(w, id)));
    const credit = budget.observe(w.now, w.actor.mp, w.actor.mp - reserve(w), cap);
    // Fan of Knives one-shots while scatter farming: spend down to the reserve; MP potions refill it.
    const sustained = d.skill === 'fanofknives' && fanFarming(w) || burstRefunds(w, d);
    if (d.category === 'damage' && !unrestrictedCleave(w, d) && w.context.mode !== 'event' && !sustained && credit < cost(w, d.skill)) {
      report(w, d, 'skipped', 'sustained farming MP budget'); return false;
    }
    return true;
  }
  function settle(d: SkillDecision, actions: (string | null)[], result: unknown) {
    const response = result as { targets?: string[]; target?: string } | undefined;
    const accepted = new Set(response?.targets || (response?.target ? [response.target] : []));
    d.targets.forEach((t, i) => {
      if (!actions[i]) return;
      const success = accepted.has(t.id) || !response?.targets && d.targets.length === 1;
      ports.evidence(t, success ? 'engaged' : 'rejected', actions[i]!);
    });
  }
  function rejectActions(d: SkillDecision, actions: (string | null)[]) {
    actions.forEach((a, i) => { if (a) ports.evidence(d.targets[i], 'rejected', a); });
  }
  function recordAura(w: SkillWorld, d: SkillDecision) {
    if (d.skill === 'paladin_aura') { auraAt = w.now; auraState = d.argument || ''; }
  }
  async function execute(d: SkillDecision): Promise<boolean> {
    const w = world();
    if (stopped || !affordable(w, d)) return false;
    const id = family(w, d.skill), amount = cost(w, d.skill);
    const token = { epoch, cost: amount, until: w.now + 2500 };
    pending.set(id, token);
    if (d.category === 'damage') budget.debit(amount);
    const publishAfterCast = !!ports.publishAfterCast?.(d);
    let actions = publishAfterCast ? [] : d.targets.map(t => w.skills[d.skill]?.hostile ? ports.evidence(t, 'pending') : null);
    report(w, d, 'selected');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const casting = ports.cast(d);
      // Retain a rejection handler even if optional evidence publication throws.
      void Promise.resolve(casting).catch(() => {});
      if (publishAfterCast) actions = d.targets.map(t => w.skills[d.skill]?.hostile ? ports.evidence(t, 'pending') : null);
      const result = await Promise.race([casting, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('skill acknowledgement timeout')), 2500);
      })]);
      if (epoch !== token.epoch || stopped) return false;
      settle(d, actions, result);
      recordAura(w, d);
      report(w, d, 'accepted');
      return true;
    } catch (error) {
      rejectActions(d, actions);
      if (epoch !== token.epoch || stopped) return false;
      // A cooldown race at the attack cooldown's edge retries on the next attack instead of a lockout,
      // and so does a Mental Burst whose mob died first: the next try picks another.
      const reason = errorReason(error);
      if (reason !== 'cooldown' && !(d.skill === 'mentalburst' && ['not_there', 'no_target'].includes(reason)))
        failures.set(d.skill, ports.world().now + 1000);
      report(w, d, 'rejected', errorReason(error));
      return false;
    } finally {
      clearTimeout(timeout);
      if (pending.get(id) === token) pending.delete(id);
    }
  }
  // The caller's world comes from the same synchronous turn, so first() checks
  // the choices against it and builds no second combat context.
  async function first(choices: SkillDecision[], w: SkillWorld): Promise<boolean> {
    const d = choices.find(d => affordable(w, d));
    return d ? execute(d) : false;
  }
  return {
    ready(d: SkillDecision) { return affordable(world(), d); },
    cast: execute,
    async absorb() { const d = absorbDecision(world()); return d ? execute(d) : false; },
    support() {
      const w = world();
      const choices = w.actor.ctype === 'paladin' ? paladinSupport(w) :
        w.actor.ctype === 'rogue' ? rogueSupport(w) : combatBuffSupport(w);
      return first(choices.filter(d => d.skill !== 'paladin_aura' ||
        w.now - auraAt >= 10000 && d.argument !== auraState), w);
    },
    offense(target: Combatant) {
      const w = world();
      return first(damageChoices(w, target), w);
    },
    /** A fan-farming rogue's Mental Burst at any mob it kills, without waiting for a primary target. */
    burst() {
      const w = world();
      return w.actor.ctype === 'rogue' && fanFarming(w) ? first(burstChoices(w), w) : Promise.resolve(false);
    },
    attack(target: Combatant): Promise<boolean> | null {
      const w = world();
      // The class check comes first so other classes never build the context.
      if (!['ranger', 'rogue'].includes(w.actor.ctype) || w.context.mode === 'blocked') return null;
      const opening = opener(w, target);
      if (opening && affordable(w, opening)) {
        openerPending = true;
        return execute(opening).finally(() => { openerPending = false; });
      }
      const d = bestAttack(w, target, d => affordable(w, d));
      return d ? execute(d) : null;
    },
    busy() { world(); return openerPending || pending.has('attack'); },
    fanFarming() { return fanFarming(world()); },
    fanVerdict() { return fanVerdict(world()); },
    fanStand(target: Combatant) { return fanStand(world(), target); },
    reset() { epoch++; budget.reset(); auraAt = -Infinity; auraState = ''; },
    stop() { stopped = true; epoch++; },
  };
}
