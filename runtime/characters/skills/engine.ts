import { createManaBudget } from './budget.ts';
import { errorReason } from '../roles/types.ts';
import { blocked, cost, reserve, unlocked } from './eligibility.ts';
import { bestAttack, damageChoices } from './offense.ts';
import { absorbDecision, paladinSupport, rogueSupport, combatBuffSupport, opener } from './protection.ts';
import type { Combatant, SkillDecision, SkillDiagnostic, SkillId, SkillWorld } from './types.ts';

export interface SkillPorts {
  world(): SkillWorld;
  cast(d: SkillDecision): Promise<unknown>;
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
    if (d.category === 'damage' && w.context.mode !== 'event' && credit < cost(w, d.skill)) {
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
    const actions = d.targets.map(t => w.skills[d.skill]?.hostile ? ports.evidence(t, 'pending') : null);
    report(w, d, 'selected');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([ports.cast(d), new Promise<never>((_, reject) => {
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
      failures.set(d.skill, ports.world().now + 1000);
      report(w, d, 'rejected', errorReason(error));
      return false;
    } finally {
      clearTimeout(timeout);
      if (pending.get(id) === token) pending.delete(id);
    }
  }
  async function first(choices: SkillDecision[]): Promise<boolean> {
    const w = world();
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
        w.now - auraAt >= 10000 && d.argument !== auraState));
    },
    offense(target: Combatant) {
      const w = world();
      return first(damageChoices(w, target));
    },
    attack(target: Combatant): Promise<boolean> | null {
      const w = world();
      if (w.context.mode === 'blocked' || !['ranger', 'rogue'].includes(w.actor.ctype)) return null;
      const opening = opener(w, target);
      if (opening && affordable(w, opening)) {
        openerPending = true;
        return execute(opening).finally(() => { openerPending = false; });
      }
      const d = bestAttack(w, target, d => affordable(w, d));
      return d ? execute(d) : null;
    },
    busy() { world(); return openerPending || pending.has('attack'); },
    reset() { epoch++; budget.reset(); auraAt = -Infinity; auraState = ''; },
    stop() { stopped = true; epoch++; },
  };
}
