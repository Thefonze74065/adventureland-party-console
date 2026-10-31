import { health, type Combatant, type CombatContext, type SkillWorld } from './types.ts';
import { endangered } from './damage.ts';

/** The off tank takes over below this fraction of the main tank's max HP. */
export const HANDOFF_HP = 0.5;
/** The main tank takes its attackers back at or above this fraction, with none left on it. */
export const RETURN_HP = 0.8;

/**
 * Whether the off tank holds the main tank's attackers. It takes them when the main tank is
 * endangered (Ryan's damage.ts signal, which counts every attacker's DPS) or below
 * HANDOFF_HP, or when the main tank is gone. It hands them back once the main tank is at
 * RETURN_HP with nothing targeting it. Between the two the previous answer stands.
 */
export function offTankActive(w: SkillWorld, previous: boolean): boolean {
  const { tank, offTank } = w.context;
  if (!tank || !offTank || tank === offTank) return false;
  const main = w.context.allies.find(a => a.name === tank);
  if (!main || main.rip || main.hp <= 0) return true;
  if (!previous) return endangered(w, main as Combatant) || health(main) < HANDOFF_HP;
  return health(main) < RETURN_HP || w.context.monsters.some(m => m.target === tank);
}

/** The context with `tank` set to whoever holds aggro now and `takeover` set for the off tank. */
export function effectiveTank(context: CombatContext, active: boolean, actor: string): CombatContext {
  if (!active || !context.offTank) return context;
  return { ...context, tank: context.offTank, takeover: context.offTank === actor };
}
