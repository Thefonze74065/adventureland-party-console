import { blocked, cost, fanFarming, fanLethal, unrestrictedCleave } from './eligibility.ts';
export { fanFarming, fanVerdict } from './eligibility.ts';
import { damage, usefulDamage, purifiable } from './damage.ts';
import { decision, type Combatant, type SkillDecision, type SkillId, type SkillWorld } from './types.ts';

/**
 * While fan farming with MP for a cast: the spot that keeps the most one-shot mobs within Fan of
 * Knives range (up to its five targets), searched around every one in view rather than only the
 * scatter primary, which is just the nearest. The rogue holds while its spot covers as many, so it
 * does not chase each new primary; the knives go to whatever is in range (`attackChoices`).
 */
export function fanStand(w: SkillWorld, primary: Combatant): { x: number; y: number } | null {
  if (!fanFarming(w) || w.actor.mp < cost(w, 'fanofknives')) return null;
  const reach = w.skills.fanofknives?.range || 160, cap = w.skills.fanofknives?.max_targets || 5;
  const lethal = [primary, ...w.context.monsters.filter(m => m.id !== primary.id)].filter(m => fanLethal(w, m));
  const covered = (p: { x: number; y: number }) =>
    Math.min(cap, lethal.filter(m => Math.hypot(m.x - p.x, m.y - p.y) <= reach).length);
  const here = { x: w.actor.x, y: w.actor.y };
  let best = here, most = covered(here), travel = 0;
  for (const m of lethal) for (const radius of [0, reach / 2, reach * 0.9])
    for (let step = 0; step < (radius ? 16 : 1); step++) {
      const angle = step * Math.PI / 8;
      const spot = { x: m.x + Math.cos(angle) * radius, y: m.y + Math.sin(angle) * radius };
      const count = covered(spot), distance = Math.hypot(spot.x - here.x, spot.y - here.y);
      if (count > most || count === most && best !== here && distance < travel) { best = spot; most = count; travel = distance; }
    }
  return best;
}
export function attackChoices(w: SkillWorld, primary: Combatant): SkillDecision[] {
  const ids: SkillId[] = w.actor.ctype === 'ranger' ? ['piercingshot', '3shot', '5shot'] :
    w.actor.ctype === 'rogue' ? ['fanofknives'] : [];
  // While fan farming the primary is only scatter's nearest pick: with it out of range the
  // knives still go to the one-shot mobs that are in range, instead of losing the slot.
  const anyTargets = (id: SkillId) => id === 'fanofknives' && fanFarming(w);
  return ids.map(id => {
    const cap = w.skills[id]?.max_targets || (id === '5shot' || id === 'fanofknives' ? 5 : id === '3shot' ? 3 : 1);
    const targets = [primary, ...w.context.monsters.filter(t => t.id !== primary.id)]
      .filter(t => !blocked(w, decision(id, [t])))
      .sort((a, b) => Number(b.id === primary.id) - Number(a.id === primary.id) ||
        usefulDamage(w, id, b) - usefulDamage(w, id, a) || a.id.localeCompare(b.id)).slice(0, cap);
    return decision(id, targets);
  }).filter(d => d.targets.some(t => t.id === primary.id) || anyTargets(d.skill) && d.targets.length > 0);
}
export function bestAttack(w: SkillWorld, primary: Combatant, affordable: (d: SkillDecision) => boolean): SkillDecision | null {
  const baseline = usefulDamage(w, 'attack', primary);
  const options = attackChoices(w, primary).filter(affordable).map(d => ({ d,
    score: d.targets.reduce((sum, t) => sum + usefulDamage(w, d.skill, t), 0) }));
  options.sort((a, b) => b.score - a.score || cost(w, a.d.skill) - cost(w, b.d.skill));
  // While fan farming, Fan of Knives replaces the basic attack even on a lone target; the MP
  // reserve and potions keep it affordable, and the basic attack is the fallback below the reserve.
  return options[0]?.score > baseline || fanFarming(w) && options[0]?.score >= baseline ? options[0].d : null;
}
function purifyUseful(w: SkillWorld, target: Combatant): boolean {
  if (damage(w, 'purify', target, true) >= target.hp) return true;
  // Purify strips debuffs too. Do not erase another player's damage setup.
  return !purifiable(w, target).some(id => w.condition(id)?.debuff || w.condition(id)?.bad);
}
function independentUseful(w: SkillWorld, id: SkillId, target: Combatant): boolean {
  const remaining = target.hp - w.incoming(target);
  if (remaining <= 0) return false;
  if (id === 'purify') return purifyUseful(w, target);
  // Fan of Knives needs the MP, so only Mental Burst is used, on any mob it kills; it refunds the HP it
  // removes, and a burst that refunds less than its cost keeps the reserve and budget (burstRefunds).
  if (fanFarming(w)) return id === 'mentalburst' && damage(w, id, target, true) >= remaining;
  if (id === 'huntersmark') return markUseful(w, target, remaining);
  if (id === 'supershot') return remaining >= damage(w, id, target) * .5;
  return true;
}
function markUseful(w: SkillWorld, target: Combatant, remaining: number): boolean {
  const owner = w.context.allies.filter(a => a.ctype === 'ranger' && a.mp >= cost(w, 'huntersmark') && w.range(a, 'huntersmark'))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  return owner?.name === w.actor.name && !target.s?.marked &&
    remaining >= damage(w, 'attack', target) * Math.max(1, w.actor.frequency) * 3;
}
/**
 * While fan farming, Mental Burst goes to any mob within its reach that it kills, not only the
 * scatter primary (just the nearest): the most HP left first, the largest refund and the mob Fan of
 * Knives is least likely to be finishing already.
 */
export function burstChoices(w: SkillWorld, primary?: Combatant): SkillDecision[] {
  const left = (m: Combatant) => m.hp - w.incoming(m);
  const mobs = primary ? [primary, ...w.context.monsters.filter(m => m.id !== primary.id)] : w.context.monsters;
  return mobs.filter(m => independentUseful(w, 'mentalburst', m))
    .map(m => decision('mentalburst', [m])).filter(d => !blocked(w, d))
    .sort((a, b) => left(b.targets[0]) - left(a.targets[0]) || a.targets[0].id.localeCompare(b.targets[0].id));
}
export function damageChoices(w: SkillWorld, target: Combatant): SkillDecision[] {
  if (w.actor.ctype === 'rogue' && fanFarming(w)) return burstChoices(w, target);
  if (w.actor.ctype === 'warrior') {
    // Cleave hits every nearby monster; never hide unauthorized collateral by
    // filtering it out of the proposed cast. Range uses the native strict edge.
    const targets = w.context.monsters.filter(t => !t.dead && !t.rip && t.hp > 0 && w.range(t, 'cleave'));
    const cleave = decision('cleave', targets);
    if (targets.length < 2 || w.context.mode !== 'scatter' && !unrestrictedCleave(w, cleave)) return [];
    return blocked(w, cleave) ? [] : [cleave];
  }
  const classes: Partial<Record<ActorClass, SkillId[]>> = {
    ranger: ['huntersmark', 'supershot'], rogue: ['mentalburst', 'quickstab', 'quickpunch'],
    paladin: ['purify', 'shield_slam', 'smash'],
  };
  const choices = (classes[w.actor.ctype] || []).filter(id => independentUseful(w, id, target))
    .map(id => decision(id, [target])).filter(d => !blocked(w, d));
  const score = (d: SkillDecision) => {
    if (d.skill === 'mentalburst' && damage(w, d.skill, target, true) >= target.hp) return Infinity;
    if (d.skill === 'huntersmark') return Number.MAX_SAFE_INTEGER;
    const divisor = w.context.mode === 'event' ? (w.skills[d.skill]?.cooldown || 1000) / 1000 : Math.max(1, cost(w, d.skill));
    return usefulDamage(w, d.skill, target) / divisor;
  };
  return choices.sort((a, b) => score(b) - score(a));
}
type ActorClass = SkillWorld['actor']['ctype'];
