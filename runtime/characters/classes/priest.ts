import type { Role, Target } from "../roles/types.ts";
function curseReady(target: Target): boolean {
  if (target.mtype === "tinyp") return false;
  if (target.s?.cursed) return false;
  if (sharedRoutine.combatSkillReady && !sharedRoutine.getAbtestingMode()) return sharedRoutine.combatSkillReady('curse', target, 'damage');
  return legacyCurseReady(target);
}
function legacyCurseReady(target: Target): boolean {
  return character.mp >= (G.skills.curse.mp ?? 0) && !is_on_cooldown("curse") &&
    is_in_range(target, "curse") && can_use("curse") && sharedRoutine.allowsTarget(target);
}
export const role: Partial<Role> = {
  name: "priest",
  combat: true,
  beforeTarget: async function () {
    // At this gear level Franky's damage needs continuous AoE healing, not the
    // normal reactive threshold: spam partyheal whenever it's off cooldown.
    if (sharedRoutine.frankyCombatActive?.() && await sharedRoutine.frankySpamPartyHeal?.()) return true;
    if (await sharedRoutine.absorbSinsBelow(1)) return true;
    if (await sharedRoutine.healPartyBelow(0.9)) return true;
    return await sharedRoutine.skillSupport?.() ?? false;
  },
  usePotion: async function () {
    return await sharedRoutine.useRecoveryPotion({ hpBelow: 0.5, mpBelow: 0.2, priority: "hp" });
  },
  beforeAttack: async function (target) {
    if (sharedRoutine.getFarmingMode() === "scatter") return false;
    if (!target || character.max_mp <= 0 || character.mp / character.max_mp <= 0.5) return false;
    if (!sharedRoutine.isPartyHealthy(0.9) || !sharedRoutine.isCurrentPartyTarget(target))
      return false;
    if (!curseReady(target)) return false;
    if (sharedRoutine.castCombatSkill && !sharedRoutine.getAbtestingMode()) return sharedRoutine.castCombatSkill('curse', target, 'damage');
    await use_skill("curse", target);
    return true;
  },
};
