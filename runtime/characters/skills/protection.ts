import { decision, health, type SkillWorld, type SkillDecision, type Combatant } from './types.ts';
import { cost, reserve, unlocked } from './eligibility.ts';
import { endangered, incomingDps, safeTransfer } from './damage.ts';

export function absorbDecision(w: SkillWorld): SkillDecision | null {
  const aggroOwner = w.context.tank || w.context.leader;
  if (w.actor.ctype !== 'priest' || aggroOwner !== w.actor.name) return null;
  if (w.actor.mp - cost(w, 'absorb') < cost(w, 'heal')) return null;
  const ally = w.context.allies.filter(a => a.name !== w.actor.name &&
    w.context.monsters.some(m => m.target === a.name) && safeTransfer(w, a))
    .sort((a, b) => health(a) - health(b) || a.name.localeCompare(b.name))
    .find(a => w.range(a, 'absorb'));
  return ally ? decision('absorb', [ally], 'survival', 'leader aggro rescue') : null;
}
export function selfHeal(w: SkillWorld): SkillDecision | null {
  const output = (w.skills.selfheal?.levels || [[0, w.skills.selfheal?.output || 400]])
    .filter(([level]) => level <= w.actor.level).at(-1)?.[1] || 400;
  if (health(w.actor) < .7 || w.actor.max_hp - w.actor.hp >= output * .8)
    return decision('selfheal', [], 'survival', 'self healing');
  return null;
}
export function cleanse(w: SkillWorld): SkillDecision | null {
  const candidates = w.context.allies.filter(a => a.name !== w.actor.name && w.range(a, 'cleansing_light'))
    .filter(a => Object.keys(a.s || {}).some(id => w.condition(id)?.cleansable))
    .sort((a, b) => Number(endangered(w, b)) - Number(endangered(w, a)) ||
      Number(b.name === w.context.leader) - Number(a.name === w.context.leader) || health(a) - health(b));
  const ally = candidates[0];
  if (!ally) return null;
  const urgent = endangered(w, ally) || Object.keys(ally.s).some(id =>
    ['stunned', 'frozen', 'deepfreezed', 'tangled', 'poisoned', 'burned'].includes(id));
  return decision('cleansing_light', [ally], urgent ? 'survival' : 'maintenance', 'cleanse harmful conditions');
}
export function oath(w: SkillWorld): SkillDecision | null {
  const outgoing = w.context.allies.some(a => {
    const s = a.s?.guardians_oath;
    return s?.f === w.actor.name || s?.from === w.actor.name;
  });
  if (outgoing) return null;
  const ally = w.context.allies.filter(a => a.name !== w.actor.name && !a.s?.guardians_oath)
    .filter(a => w.range(a, 'guardians_oath') && endangered(w, a) && safeTransfer(w, a, .35))
    .sort((a, b) => health(a) - health(b) || Number(b.name === w.context.leader) - Number(a.name === w.context.leader))[0];
  return ally ? decision('guardians_oath', [ally], 'survival', 'protect endangered ally') : null;
}
export function beacon(w: SkillWorld): SkillDecision | null {
  const nearby = w.context.allies.filter(a => w.range(a, 'beacon_of_resolve'));
  if (nearby.some(a => a.s?.beacon_of_resolve)) return null;
  const leader = nearby.find(a => a.name === w.context.leader);
  const urgent = !!leader && leader.hp - incomingDps(w, leader) * 2 < leader.max_hp * .3;
  if (!urgent && nearby.filter(a => incomingDps(w, a) > 0).length < 2) return null;
  return decision('beacon_of_resolve', [], urgent ? 'survival' : 'maintenance', 'party defensive burst');
}
export function shield(w: SkillWorld): SkillDecision | null {
  const mana = !!w.actor.s?.mshield;
  const incoming = incomingDps(w, w.actor);
  if (mana && (health(w.actor) > .65 || w.actor.mp <= reserve(w)))
    return decision('mshield', [], 'survival', 'release mana shield');
  if (!mana && health(w.actor) < .4 && incoming > 0 && w.actor.mp > reserve(w))
    return decision('mshield', [], 'survival', 'emergency mana shield');
  return aetherShield(w, incoming);
}
function aetherShield(w: SkillWorld, incoming: number): SkillDecision | null {
  const magic = w.context.monsters.some(m => m.target === w.actor.name && m.damage_type === 'magical');
  if (!w.actor.s.mshield && !w.actor.s.aether_shield && magic && w.actor.hp - incoming * 2 > w.actor.max_hp * .3 && w.actor.mp < w.actor.max_mp)
    return decision('aether_shield', [], 'maintenance', 'recover mana from magical wounds');
  return null;
}
function desiredAuras(w: SkillWorld): string[] {
  const threatening = w.context.monsters.filter(m => w.context.allies.some(a => a.name === m.target));
  const conditionPressure = w.context.allies.some(a => Object.keys(a.s || {}).some(id => w.condition(id)?.cleansable));
  if (conditionPressure) return ['warding', 'bulwark', 'sanctuary', 'zeal'];
  const magical = threatening.filter(m => m.damage_type === 'magical').length > threatening.length / 2;
  return magical ? ['sanctuary', 'zeal', 'bulwark', 'warding'] : ['bulwark', 'zeal', 'sanctuary', 'warding'];
}
export function aura(w: SkillWorld): SkillDecision | null {
  if (!unlocked(w, 'paladin_aura')) return null;
  const paladins = w.context.allies.filter(a => a.ctype === 'paladin' && a.level >= (w.skills.paladin_aura?.level || 60) && w.range(a, 'paladin_aura'))
    .sort((a, b) => Number(b.name === w.context.leader) - Number(a.name === w.context.leader) || b.level - a.level || a.name.localeCompare(b.name));
  const choices = desiredAuras(w);
  if (!paladins.some(a => a.name === w.context.leader)) choices.unshift(...choices.splice(choices.indexOf('zeal'), 1));
  const state = choices[Math.max(0, paladins.findIndex(a => a.name === w.actor.name)) % choices.length];
  // An aura on us can come from another paladin; only our own source proves it is set.
  const own = w.actor.s?.['paladin_aura_' + state];
  if (own && (own.f === w.actor.name || own.from === w.actor.name)) return null;
  return { ...decision('paladin_aura', [], 'maintenance', 'party aura coverage'), argument: state };
}
export function paladinSupport(w: SkillWorld): SkillDecision[] {
  return [selfHeal(w), shield(w), cleanse(w), oath(w), beacon(w), aura(w)]
    .filter((d): d is SkillDecision => !!d);
}
export function rogueSupport(w: SkillWorld): SkillDecision[] {
  const rogues = w.context.allies.filter(a => a.ctype === 'rogue' && a.level >= 40)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (rogues[0]?.name !== w.actor.name) return [];
  const target = w.context.allies.find(a => (!a.s?.rspeed || (a.s.rspeed.ms || 0) < 60000) && w.range(a, 'rspeed'));
  return target ? [decision('rspeed', [target], 'maintenance', 'maintain party swiftness')] : [];
}
export function combatBuffSupport(w: SkillWorld): SkillDecision[] {
  const skill = w.actor.ctype === 'warrior' ? 'warcry' :
    w.actor.ctype === 'priest' ? 'darkblessing' : null;
  // These buffs coexist. Only the matching active effect prevents a refresh.
  if (!skill || w.actor.s?.[skill]) return [];
  return [decision(skill, [], 'maintenance', 'maintain combat buff')];
}
export function opener(w: SkillWorld, target: Combatant): SkillDecision | null {
  if (w.actor.ctype !== 'rogue' || w.actor.s?.invis || w.actor.s?.marked) return null;
  if (target.target || w.context.monsters.some(m => m.target === w.actor.name)) return null;
  return decision('invis', [], 'maintenance', 'unengaged opener');
}
