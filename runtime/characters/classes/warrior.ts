import { approach, scatterAttack, mayTaunt } from "./warrior-combat.ts";
import type { Role, Target } from "../roles/types.ts";
async function taunt(target: Target){
  if (sharedRoutine.castCombatSkill) return sharedRoutine.castCombatSkill('taunt', target, 'survival');
  const id=sharedRoutine.queueEvidence?.(target,'pending') || undefined;
  try{await use_skill('taunt',target);sharedRoutine.queueEvidence?.(target,'engaged',id);}
  catch(error){if(id)sharedRoutine.queueEvidence?.(target,'rejected',id);throw error;}
}
function partyTarget() {
  return sharedRoutine.getEventTarget() || sharedRoutine.getNearestPartyAttacker() ||
    sharedRoutine.getNearestPartyTarget() || (sharedRoutine.shouldFollowLeader()
      ? sharedRoutine.getLeaderTarget() || sharedRoutine.getEngagedTarget()
      : sharedRoutine.getPreferredTarget());
}
export const role: Partial<Role> = {
  name: "warrior",
  combat: true,
  beforeTarget: async function () {
    if (!sharedRoutine.bossCombatActive?.() && await sharedRoutine.emergencyWarriorStomp()) return true;
    return await sharedRoutine.skillSupport?.() ?? false;
  },
  chooseTarget: function () {
    const scatterBreak = sharedRoutine.getScatterBreakTarget();
    if (sharedRoutine.hasScatterBreakTarget()) {
      const currentTarget = sharedRoutine.getEngagedTarget();
      if (currentTarget || scatterBreak) return currentTarget || scatterBreak;
    }
    if (sharedRoutine.getFarmingMode() === "scatter")
      return sharedRoutine.getEventTarget() || sharedRoutine.getScatterTarget();
    return partyTarget();
  },
  beforeAttack: async function (target) {
    if (await sharedRoutine.skillOffense?.(target)) return true;
    // Boss movement belongs solely to approach-and-hold, including scatter mode.
    if (sharedRoutine.bossCombatActive?.()) return false;
    if (target.mtype === "porcupine" && mayTaunt(target)) {
      await taunt(target);
      return true;
    }
    if (sharedRoutine.getFarmingMode() === "scatter") return scatterAttack(target);
    if (mayTaunt(target)) await taunt(target);
    if (sharedRoutine.allowsTarget && !sharedRoutine.allowsTarget(target)) return false;
    return approach(target);
  },
  usePotion: async function () {
    if (!sharedRoutine.isLeader?.()) return false;
    const threat = sharedRoutine.getNearestPartyAttacker();
    if (!threat || character.mp >= (G.skills.taunt.mp ?? 0)) return false;
    return await sharedRoutine.useRecoveryPotion({ force: "mp" });
  },
};
