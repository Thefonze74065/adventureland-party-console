import { createKillLuckSwap, type GearItem, type LuckSlot, type LuckSwapMemory } from "./kill-luck-swap.ts";
import type { CombatRoot, Target } from "./types.ts";

export interface KillLuckSwapSkillsPort {
  // Needs the full live entity (resistance/armor/conditions/etc., not just id/hp) to estimate
  // damage; kill-luck-swap.ts itself only ever needs id/hp/dead/rip from its LuckTarget.
  lethalBasicAttack(target: Target): boolean;
  endangeredSelf(): boolean;
}
export interface KillLuckSwapEquipmentPort {
  busy(): boolean;
}

export function installKillLuckSwap(
  root: CombatRoot,
  skills: KillLuckSwapSkillsPort,
  equipment: KillLuckSwapEquipmentPort | null,
) {
  const host = parent as unknown as { __partyKillLuckSwap?: LuckSwapMemory };
  const memory = host.__partyKillLuckSwap ??= {};
  const data = G as unknown as { items: Record<string, { type?: string; luck?: number } | undefined> };
  const fingerprint = (item: GearItem | null): GearItem | null => {
    if (!item) return null;
    const result: GearItem = { name: item.name };
    for (const key of ["level", "p", "stat_type", "data", "rid", "b", "m", "l", "v"])
      if (item[key] !== undefined) result[key] = item[key];
    return result;
  };
  root.partyKillLuckSwap?.stop();
  return root.partyKillLuckSwap = createKillLuckSwap({
    now: Date.now,
    isTank: () => !!sharedRoutine.isTank?.(),
    equipped: (slot: LuckSlot) => character.slots[slot] as GearItem | null,
    items: () => character.items as (GearItem | null)[],
    itemType: item => data.items[item.name]?.type,
    luckValue: item => item ? Number(data.items[item.name]?.luck) || 0 : 0,
    fingerprint,
    same: (item, wanted) => JSON.stringify(fingerprint(item)) === JSON.stringify(fingerprint(wanted)),
    equip: (index, slot) => Promise.resolve(equip(index, slot)),
    lethalBasicAttack: target => skills.lethalBasicAttack(target as unknown as Target),
    holdsAggro: target => (target as unknown as Target).target === character.name,
    endangered: () => skills.endangeredSelf(),
    otherSwapBusy: () => !!equipment?.busy(),
    report(message) {
      if (root.partyCombatState) {
        root.partyCombatState.error = message;
        root.partyCombatState.errorAt = Date.now();
      }
    },
  }, memory);
}
