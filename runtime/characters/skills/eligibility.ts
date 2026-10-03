import type { SkillWorld, SkillId, SkillDefinition, SkillDecision } from './types.ts';
import { incomingDps } from './damage.ts';

export function cost(w: SkillWorld, id: SkillId): number {
  const mp = id === 'heal' ? w.actor.mp_cost : w.skills[id]?.mp;
  return Math.ceil(Math.max(0, Number(mp) || 0) * (1 - Math.min(100, Math.max(0, w.actor.mp_reduction || 0)) / 100));
}
function equipment(w: SkillWorld, s: SkillDefinition): boolean {
  const main = w.actor.slots.mainhand, off = w.actor.slots.offhand;
  const allowed: string[] = s.wtype ? [s.wtype].flat() : [];
  const weapon = main ? w.item(main.name)?.wtype : undefined;
  if (allowed.length && !allowed.includes(weapon || '')) return false;
  if (!offhandMatches(w, s, off?.name)) return false;
  return slotsMatch(w, s);
}
function offhandMatches(w: SkillWorld, s: SkillDefinition, name?: string): boolean {
  return !s.offhand_type || !!name && w.item(name)?.type === s.offhand_type;
}
function slotsMatch(w: SkillWorld, s: SkillDefinition): boolean {
  return !s.slot || s.slot.some(([slot, name]) => {
    const item = w.actor.slots[slot];
    if (item?.name !== name) return false;
    return (item.charges || 0) >= (w.item(name)?.charge || 0);
  });
}
export function unlocked(w: SkillWorld, id: SkillId): boolean {
  const s = w.skills[id];
  if (!s || s.type === 'passive' || s.consume) return false;
  if (s.class && !s.class.includes(w.actor.ctype)) return false;
  if (w.actor.level < (s.level || 0) || !equipment(w, s)) return false;
  return Object.entries(s.requirements || {}).every(([key, value]) =>
    Number(Reflect.get(w.actor, key)) >= Number(value));
}
export function reserve(w: SkillWorld): number {
  const availableCost = (id: SkillId) => unlocked(w, id) ? cost(w, id) : 0;
  const c = w.actor.ctype;
  if (c === 'paladin') return Math.max(w.actor.max_mp * .3, 2 * availableCost('selfheal') + availableCost('guardians_oath'));
  if (c === 'priest') return Math.max(w.actor.max_mp * .35, 2 * cost(w, 'heal') + availableCost('partyheal'));
  if (c === 'warrior') return ((w.context.tank || w.context.leader) === w.actor.name ? availableCost('taunt') : 0) +
    Math.max(availableCost('stomp'), availableCost('hardshell'));
  return w.actor.max_mp * .2;
}
function targetBlock(w: SkillWorld, d: SkillDecision): string | null {
  const s = w.skills[d.skill]!;
  for (const target of d.targets) {
    if (!living(target)) return 'target dead';
    if (s.no_self && target.name === w.actor.name) return 'cannot target self';
    if (!w.range(target, d.skill)) return 'out of range';
    if (s.hostile && !hostileAllowed(w, d, target)) return 'unauthorized or immune target';
  }
  return safePull(w, d) ? null : 'unsafe combined pull';
}
const living = (target: SkillDecision['targets'][number]) => !target.dead && !target.rip && target.hp > 0;
function hostileAllowed(w: SkillWorld, d: SkillDecision, target: SkillDecision['targets'][number]): boolean {
  return w.allowed(target, d.skill) && (!target.immune || !!w.skills[d.skill]?.pierces_immunity);
}
function safePull(w: SkillWorld, d: SkillDecision): boolean {
  if (w.context.mode !== 'scatter' || !w.skills[d.skill]?.hostile) return true;
  const pulled = new Set(d.targets.filter(t => !t.target).map(t => t.id));
  if (!pulled.size) return true;
  const context = { ...w.context, monsters: w.context.monsters.map(m => pulled.has(m.id) ? { ...m, target: w.actor.name } : m) };
  return w.actor.hp - incomingDps({ ...w, context }, w.actor) * 2 > w.actor.max_hp * .3;
}
export function blocked(w: SkillWorld, d: SkillDecision, pending = 0): string | null {
  if (w.context.mode === 'blocked' || w.actor.rip) return 'combat activity blocked';
  if (!ownsAggro(w, d)) return 'leader owns aggro transfers';
  if (!unlocked(w, d.skill)) return 'level, equipment, or requirements';
  const s = w.skills[d.skill]!;
  if (w.cooldown(d.skill) || w.cooldown(s.share || d.skill)) return 'cooldown';
  return manaBlock(w, d, pending) || targetBlock(w, d);
}
function ownsAggro(w: SkillWorld, d: SkillDecision): boolean {
  return !['absorb', 'taunt', 'agitate'].includes(d.skill) || (w.context.tank || w.context.leader) === w.actor.name;
}
function manaBlock(w: SkillWorld, d: SkillDecision, pending: number): string | null {
  const remaining = w.actor.mp - pending - cost(w, d.skill);
  if (remaining < 0) return 'insufficient MP';
  if (d.category !== 'survival' && remaining < reserve(w)) return 'survival MP reserved';
  return null;
}
