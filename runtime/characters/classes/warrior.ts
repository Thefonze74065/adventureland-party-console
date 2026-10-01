import { approach, scatterAttack, mayTaunt } from "./warrior-combat.ts";
import type { Role, Target } from "../roles/types.ts";
async function taunt(target: Target){
  if (sharedRoutine.castCombatSkill) return sharedRoutine.castCombatSkill('taunt', target, 'survival');
  const id=sharedRoutine.queueEvidence?.(target,'pending') || undefined;
  try{await use_skill('taunt',target);sharedRoutine.queueEvidence?.(target,'engaged',id);}
  catch(error){if(id)sharedRoutine.queueEvidence?.(target,'rejected',id);throw error;}
}
async function scare(target: Target){
  // Scare is untargeted (it fears whatever's nearby); track evidence against
  // the boss it's meant to mitigate without passing it to use_skill itself.
  const id=sharedRoutine.queueEvidence?.(target,'pending') || undefined;
  try{await use_skill('scare');sharedRoutine.queueEvidence?.(target,'engaged',id);}
  catch(error){if(id)sharedRoutine.queueEvidence?.(target,'rejected',id);throw error;}
}
function scareReady(target: Target): boolean {
  return character.mp >= (G.skills.scare?.mp ?? 0) && !is_on_cooldown("scare") &&
    is_in_range(target, "scare") && can_use("scare");
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
    if (!sharedRoutine.frankyCombatActive?.() && await sharedRoutine.emergencyWarriorStomp()) return true;
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
    // Franky movement belongs solely to approach-and-hold, including scatter mode.
    if (sharedRoutine.frankyCombatActive?.()) {
      // An off-tank (not currently Franky's target) mitigates his damage with
      // Scare instead of contesting the human tank's aggro for the kill.
      if (target.target !== character.name && scareReady(target)) {
        await scare(target);
        return true;
      }
      return false;
    }
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
