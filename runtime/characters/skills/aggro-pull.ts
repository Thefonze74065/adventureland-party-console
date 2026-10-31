import type { Combatant, SkillId, SkillWorld } from './types.ts';

/** The aggro fields of a G.monsters definition. */
export interface MonsterAggro { aggro?: number; rage?: number }
/** Skills that pull every monster around the caster at once. */
export const areaPulls: ReadonlySet<SkillId> = new Set<SkillId>(['agitate']);

// The game server's monster tick (kaansoral/adventureland_mongodb node/server.js, the
// "monster.aggro > 0.99 || Math.random() < monster.aggro" branch) makes a targetless monster
// with aggro above 0.99 aggressive on every tick. Its aggressive attack then targets the
// player when Math.random() < monster.rage - player.aggro_diff ("if (monster.rage && ...)
// target_player"), so rage of 1 or more targets any player without bling. Mummies
// (aggro 1.5, rage 1.5) come anyway; targetrons and sparkbots (aggro 0.1, rage 0) stay idle.
export function comesAnyway(definition: MonsterAggro | undefined): boolean {
  return Number(definition?.aggro) > 0.99 && Number(definition?.rage) >= 1;
}

/**
 * An area pull is allowed when every idle monster it grabs would come anyway, or when a
 * party member other than the tank is under attack. An off-tank takeover is always allowed.
 */
export function areaPullAllowed(w: SkillWorld, pulled: Combatant[]): boolean {
  if (w.context.takeover) return true;
  const tank = w.context.tank || w.context.leader;
  if (w.context.allies.some(a => a.name !== tank && w.context.monsters.some(m => m.target === a.name))) return true;
  return pulled.filter(m => !m.target).every(m => comesAnyway(w.monster?.(String(m.mtype))));
}
