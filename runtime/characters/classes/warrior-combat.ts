import type { Target } from "../roles/types.ts";

function basherEquipped(): boolean {
  const weapon = character.slots?.mainhand;
  return !!weapon && G.items[weapon.name]?.wtype === "basher";
}
function canStomp(): boolean {
  const skill = G.skills.stomp;
  if (!basherEquipped() || !skill) return false;
  return character.max_mp > 0 && character.mp / character.max_mp >= 0.25 &&
    character.mp >= (skill.mp ?? 0) && !is_on_cooldown("stomp") && can_use("stomp");
}
function nearbyTargets(target: Target): number {
  const range = Number(G.skills.stomp?.range) || 400;
  return Object.values(parent.entities || {}).filter(entity =>
    entity && entity.type === "monster" && entity.visible && !entity.dead &&
    entity.mtype === target.mtype && Math.hypot(entity.x - character.x, entity.y - character.y) <= range,
  ).length;
}
export async function approach(target: Target): Promise<boolean> {
  return !is_in_range(target) && await sharedRoutine.dashToward(target);
}
export async function scatterAttack(target: Target): Promise<boolean> {
  if (nearbyTargets(target) >= 2 && canStomp()) {
    await use_skill("stomp");
    return true;
  }
  return approach(target);
}
function ownsAggroPull(): boolean {
  return sharedRoutine.hasDesignatedTank?.() ? !!sharedRoutine.isTank?.() : !!sharedRoutine.isLeader?.();
}
export function mayTaunt(target: Target): boolean {
  if (!ownsAggroPull()) return false;
  if (character.level < (G.skills.taunt?.level || 0)) return false;
  target = get_entity(target.id) || target;
  return tauntTarget(target) && tauntReady(target);
}
function tauntTarget(target: Target): boolean {
  if (!target || target.mtype === 'tinyp' || target.type !== 'monster') return false;
  // Porcupines must be pulled without the initial melee hit. Do not steal a
  // stranger's pull or repeatedly taunt one already attacking this warrior.
  const passivePorcupine = target.mtype === "porcupine" && !target.target;
  return target.target !== character.name && (passivePorcupine || sharedRoutine.isAttackingPartyMember(target)) &&
    (!sharedRoutine.allowsTarget || sharedRoutine.allowsTarget(target));
}
function tauntReady(target: Target): boolean {
  if (sharedRoutine.combatSkillReady) return sharedRoutine.combatSkillReady('taunt', target, 'survival');
  return character.mp >= (G.skills.taunt.mp ?? 0) && !is_on_cooldown("taunt") && is_in_range(target, "taunt");
}
