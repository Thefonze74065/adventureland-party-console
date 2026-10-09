import type { DamageType } from "typed-adventureland";

const reflectors = new Set(["slenderman", "tiger", "goblin"]);

function knownDamageType(value: unknown): DamageType | undefined {
  return value === "physical" || value === "magical" || value === "pure" ? value : undefined;
}

/** Native 15555 player serialization can omit damage_type (also absent from
 * upstream Character). The equipped weapon overrides the native class default;
 * a supplied native field remains authoritative. Review on upstream upgrades. */
export function effectiveAttackDamageType(
  actor: Pick<Character, "ctype" | "slots"> & { damage_type?: DamageType },
  data?: Pick<typeof G, "items" | "classes">,
): DamageType | undefined {
  const nativeType = knownDamageType(actor.damage_type);
  if (nativeType) return nativeType;
  const weapon = actor.slots?.mainhand;
  return knownDamageType(weapon && data?.items?.[weapon.name]?.damage_type) ||
    knownDamageType(data?.classes?.[actor.ctype]?.damage_type);
}

/** Server retaliation depends on damage type and range stat, not proximity. */
export function monsterAttackBlock(
  monster: string | undefined,
  damageType: string | undefined,
  range: number,
): string | null {
  if (monster === "porcupine" && damageType !== "magical" && damageType !== "pure" &&
      !(Number.isFinite(range) && range >= 75))
    return "Porcupine damage return: physical attacks require range >= 75";
  if (reflectors.has(monster ?? "") && damageType !== "physical" && damageType !== "pure")
    return "Monster reflection: magical basic attacks disabled";
  return null;
}
