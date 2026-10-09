import type { Entity, DamageType } from 'typed-adventureland';
import type { GSkill, SkillKey } from 'typed-adventureland/dist/src/types/GTypes/skills/Skills.js';

// Verified against client 17083. Upstream 0.0.57 predates the September 2026
// paladin expansion and Fan of Knives. Review these extensions on upgrade.
export type SkillId = SkillKey | 'fanofknives' | 'aether_shield' | 'cleansing_light' |
  'guardians_oath' | 'beacon_of_resolve' | 'paladin_aura' | 'shield_slam';
export interface SkillDefinition extends Omit<GSkill, 'condition' | 'share'> {
  condition?: string;
  share?: SkillId;
  fixed_range?: boolean;
  no_self?: boolean;
  offhand_type?: string;
  max_targets?: number;
  armor_multiplier?: number;
  armor_cap?: number;
  exclusive_condition?: string;
}
export type Conditions = Record<string, { ms?: number; f?: string; from?: string; s?: number; citizens?: boolean } | undefined>;
// Entity/Character omit new condition IDs and Character omits damage_type.
export type Combatant = Omit<Entity, 's'> & { s: Conditions };
export type Actor = Omit<Character, 's'> & { s: Conditions; damage_type?: DamageType };
export type Spending = 'survival' | 'maintenance' | 'damage';
export interface CombatContext {
  leader: string;
  tank: string | null;
  allies: Combatant[];
  monsters: Combatant[];
  mode: 'grouped' | 'scatter' | 'event' | 'blocked';
  event: string | null;
  /** This character's routine for the active boss encounter (Franky), or null outside one. */
  bossRoutine?: string | null;
  observedAt: number;
}
export interface SkillDecision {
  skill: SkillId;
  targets: Combatant[];
  category: Spending;
  reason: string;
  argument?: string;
}
export interface SkillDiagnostic {
  at: number; skill: SkillId; targets: string[]; reserve: number;
  category: Spending; reason: string; status: 'selected' | 'accepted' | 'skipped' | 'rejected';
}
export interface SkillWorld {
  actor: Actor;
  context: CombatContext;
  now: number;
  skills: Partial<Record<SkillId, SkillDefinition>>;
  item(name: string): { wtype?: string; type?: string; charge?: number } | undefined;
  condition(name: string): { cleansable?: boolean; bad?: boolean; buff?: boolean; debuff?: boolean; persistent?: boolean } | undefined;
  cooldown(skill: SkillId): boolean;
  range(target: Combatant, skill: SkillId): boolean;
  allowed(target: Combatant, skill: SkillId): boolean;
  incoming(target: Combatant): number;
  damageMultiplier(defense: number): number;
}
export const health = (actor: Pick<Actor, 'hp' | 'max_hp'>) => actor.hp / Math.max(1, actor.max_hp);
export const decision = (skill: SkillId, targets: Combatant[] = [], category: Spending = 'damage', reason: string = skill): SkillDecision =>
  ({ skill, targets, category, reason });
