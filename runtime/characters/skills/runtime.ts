import type { CombatRoot, Target } from '../roles/types.ts';
import { effectiveAttackDamageType, monsterAttackBlock } from '../roles/monster-attack-policy.ts';
import { createSkillEngine } from './engine.ts';
import { decision, type Actor, type Combatant, type CombatContext, type SkillDefinition, type SkillDecision, type SkillId, type SkillWorld } from './types.ts';
import { damage, endangered, incomingDps } from './damage.ts';
import { createProjectileTracker } from './projectiles.ts';
import { effectiveTank, offTankActive } from './tank-handoff.ts';

interface Host {
  damage_multiplier?(this: void, defense: number): number;
  is_disabled?(actor: Actor): boolean;
  next_skill?: Partial<Record<SkillId, Date>>;
  socket?: { connected: boolean;
    on?(event: string, listener: (data: object) => void): void;
    off?(event: string, listener: (data: object) => void): void;
  };
  entities: Record<string, Combatant>;
  G: typeof G;
  use_skill(id: SkillId, target?: string | string[]): Promise<unknown>;
}
export function mitigation(defense: number): number {
  const rates = [.001, .001, .00095, .0009, .00082, .0007, .0006, .0005];
  const reduction = rates.reduce((sum, rate, i) => sum + Math.max(0, Math.min(100, defense - i * 100)) * rate, 0) + Math.max(0, defense - 800) * .0004;
  const piercing = [.001, .00075, .0005].reduce((sum, rate, i) => sum + Math.max(0, Math.min(50, -defense - i * 50)) * rate, 0) + Math.max(0, -defense - 150) * .00025;
  return Math.min(1.32, Math.max(.05, 1 - reduction + piercing));
}
export function installSkillRuntime(root: CombatRoot) {
  const host = parent as unknown as Host;
  const shared = root.sharedRoutine;
  const projectiles = createProjectileTracker(world);
  // The off-tank handoff keeps its answer between worlds so its thresholds can hold.
  let handoff = false, handoffTank: { at: number; name: string | null } | null = null;
  function world(): SkillWorld {
    // Normalize the local skill world, never mutate the native player object.
    // Offensive skill definitions retain their own damage_type precedence.
    const actor: Actor = { ...character, ...hitbox(character), damage_type: effectiveAttackDamageType(character, typeof G === 'undefined' ? undefined : G) };
    // combatContext copies every visible monster, the largest console self
    // time in a fighter thread (docs/efficiency.md, CT7). busy(), attack() for
    // classes without attack skills and projectile pruning never read it, so
    // world() builds it on the first read and keeps it for this world.
    let context: CombatContext | undefined;
    const build = (): CombatContext => {
      const built: CombatContext = shared.combatContext?.() || {
        leader: '', tank: null, allies: [], monsters: [], mode: 'blocked', event: null, observedAt: 0,
      };
      if (host.is_disabled?.(actor)) built.mode = 'blocked';
      // Copy result's descriptors so reading the view's context cannot re-enter build().
      const view = Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(result), context: { value: built } }) as SkillWorld;
      handoff = offTankActive(view, handoff);
      return effectiveTank(built, handoff, actor.name);
    };
    const skills: Partial<Record<SkillId, SkillDefinition>> = G.skills;
    const result: SkillWorld = {
      actor, get context() { return context ??= build(); }, skills, now: Date.now(),
      item: name => (G.items as Record<string, { wtype?: string; type?: string; charge?: number }>)[name],
      condition: name => (G.conditions as Record<string, ReturnType<SkillWorld['condition']>>)[name],
      // The attack controller swings up to 2 ms before the attack cooldown ends. A skill sharing that
      // cooldown (Fan of Knives, 3-shot, 5-shot) must be ready on the same edge, or the slot falls back
      // to a basic attack; an early cast rejected as `cooldown` retries without a lockout.
      cooldown: id => id === 'invis' && !!shared.merchantVisibilityActive?.() ||
        Number(host.next_skill?.[id]) - Date.now() > (id === 'attack' || skills[id]?.share === 'attack' ? 2 : 0),
      damageMultiplier: host.damage_multiplier || mitigation,
      incoming: t => projectiles.incoming(t.id, Date.now()),
      range: (t, id) => skillRange(actor, t, skills[id], id),
      allowed: (t, id) => authorized(result, t, id),
      monster: mtype => (G.monsters as Record<string, { aggro?: number; rage?: number } | undefined>)[mtype],
    };
    return result;
  }
  function authorized(w: SkillWorld, t: Combatant, id: SkillId): boolean {
    if(returnTargetBlocked(t,id) || bossSkillBlocked(id, [t]))return false;
    const type = w.skills[id]?.damage_type || 'physical';
    if (id !== 'taunt' && monsterAttackBlock(t.mtype, type, w.actor.range)) return false;
    if (!targetAuthorized(t, id)) return false;
    if (t.target || w.context.mode !== 'scatter') return true;
    const added = { ...w.context, monsters: w.context.monsters.map(m => m.id === t.id ? { ...m, target: w.actor.name } : m) };
    return w.actor.hp - 2 * incomingDps({ ...w, context: added }, w.actor) > w.actor.max_hp * .3;
  }
  function targetAuthorized(t: Combatant, id: SkillId): boolean {
    return !!shared.skillTargetAllowed?.(t as Target, id) && shared.rareAttackAllowed?.(t as Target, id) !== false;
  }
  const returnExcluded = new Set<string>(['taunt','agitate','charge','dash','blink','scare','stomp','cleave','fanofknives']);
  function returnTargetBlocked(t:Combatant,id:SkillId):boolean {
    return !!shared.returnCombatActive?.() && (returnExcluded.has(id) || !shared.returnAttacker?.(t as Target));
  }
  function returnCastBlocked(d:SkillDecision):boolean {
    if(!shared.returnCombatActive?.())return false;
    if(returnExcluded.has(d.skill))return true;
    return !!world().skills[d.skill]?.hostile && d.targets.some(t=>!shared.returnAttacker?.(t as Target));
  }
  // Area effects and movement skills cannot honor strict boss-only, hold-position combat
  // (Franky). Cleave is the explicit area exception; Scare is blocked. Single-target skills defend only
  // against this member's mummies while the boss remains the default target.
  const bossExcluded = new Set<string>(['agitate','charge','dash','blink','scare','stomp','fanofknives']);
  function bossSkillBlocked(id: SkillId, targets: Combatant[]): boolean {
    if (!shared.bossCombatActive?.()) return false;
    return bossExcluded.has(id) || !!world().skills[id]?.hostile &&
      targets.some(t => t.type !== 'monster' ||
        id !== 'cleave' && !shared.bossTargetAllowed?.(t as Target) ||
        !shared.skillTargetAllowed?.(t as Target, id));
  }
  // While fan farming, the next Mental Burst is tried the moment its cooldown ends instead of on the
  // next support tick (a median 350 ms later); with no mob to kill then, the support tick keeps trying.
  let burstTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleBurst(castAt: number) {
    if (burstTimer) clearTimeout(burstTimer);
    const ready = Math.max(Number(host.next_skill?.mentalburst) || 0, castAt + (G.skills.mentalburst?.cooldown || 900));
    burstTimer = setTimeout(() => {
      burstTimer = null;
      // The client's cooldown can end a little after the estimate; wait for it rather than give up.
      const left = Number(host.next_skill?.mentalburst) - Date.now();
      if (left > 0) return void (burstTimer = setTimeout(() => { burstTimer = null; void engine.burst().catch(() => false); }, left));
      void engine.burst().catch(() => false);
    }, Math.max(0, ready - Date.now()));
  }
  function castSkill(d:SkillDecision):Promise<unknown> {
    if (bossSkillBlocked(d.skill, d.targets)) return Promise.reject(new Error('Skill conflicts with boss-only combat'));
    if(returnCastBlocked(d))return Promise.reject(new Error('Skill conflicts with return movement or attacker-only policy'));
    const argument=d.skill === 'cleave' ? undefined : d.argument ?? (d.targets.length>1 || world().skills[d.skill]?.multi ? d.targets.map(t=>t.id) : d.targets[0]?.id || d.targets[0]?.name);
    const castAt = Date.now(), cast = host.use_skill(d.skill,argument);
    if (d.skill === 'mentalburst') void cast.then(() => scheduleBurst(castAt), () => undefined);
    return cast;
  }
  const engine = createSkillEngine({
    world,
    cast:castSkill,
    publishAfterCast: d => {
      const skills: Partial<Record<SkillId, SkillDefinition>> = G.skills;
      return !!skills[d.skill]?.hostile && d.targets.length > 0 &&
        d.targets.every(t => shared.independentPullActive?.(t as Target));
    },
    evidence: (t, state, action) => shared.queueEvidence?.(t as Target, state, action) || null,
    diagnostic: d => { if (root.partyCombatState) root.partyCombatState.skill = d; },
  });
  shared.skillSupport = () => engine.support();
  // Movement asks several times a tick; one world per 250 ms answers them all.
  shared.aggroTank = () => {
    if (!handoffTank || Date.now() - handoffTank.at >= 250) handoffTank = { at: Date.now(), name: world().context.tank };
    return handoffTank.name;
  };
  shared.skillOffense = t => engine.offense(t);
  shared.absorbLeaderAggro = () => engine.absorb();
  shared.fanOfKnivesFarming = () => engine.fanFarming();
  shared.fanOfKnivesVerdict = () => engine.fanVerdict();
  shared.fanOfKnivesStand = t => engine.fanStand(t as unknown as Combatant);
  if (shared.combatContext) {
    shared.combatSkillReady = (id, target, category) => engine.ready(decision(id, [target], category));
    shared.castCombatSkill = (id, target, category) => engine.cast(decision(id, [target], category));
  }
  const action = (data: object) => projectiles.action(data);
  const hit = (data: object) => projectiles.hit(data);
  host.socket?.on?.('action', action);
  host.socket?.on?.('hit', hit);
  return { ...engine,
    // A basic attack that would drop the target below zero right now. Used to decide
    // whether a kill-time gear swap (e.g. the designated tank's luck swap) needs to
    // happen before this tick's attack, for a target with no HP-decline history yet.
    lethalBasicAttack: (target: Combatant) => damage(world(), 'attack', target, true) >= target.hp,
    // Used by the designated tank's kill-time luck swap to bail out of weaker gear
    // immediately if it starts taking dangerous damage rather than finish a swap.
    endangeredSelf: () => endangered(world(), world().actor as unknown as Combatant),
    reset() { engine.reset(); projectiles.clear(); },
    stop() {
      if (burstTimer) clearTimeout(burstTimer);
      engine.stop(); projectiles.clear();
      host.socket?.off?.('action', action); host.socket?.off?.('hit', hit);
    },
  };
}
/**
 * Native `distance()` is edge to edge, reading `awidth` or PIXI's `width` getter, which a spread
 * copy loses. Carry the native size so ranges match the server's (crab rate item 4).
 */
export function hitbox(entity: object): { awidth?: number; aheight?: number } {
  const native = globalThis as unknown as { get_width?: (e: object) => number; get_height?: (e: object) => number };
  if (typeof native.get_width !== 'function' || typeof native.get_height !== 'function') return {};
  return { awidth: native.get_width(entity), aheight: native.get_height(entity) };
}
export function skillRange(actor: Actor, target: Combatant, s?: SkillDefinition, id?: SkillId): boolean {
  if (!s) return false;
  const base = s.use_range ? actor.range : s.range || actor.range;
  const range = base * (s.range_multiplier || 1) + (s.range_bonus || 0);
  const distanceTo = typeof distance === 'function' ? distance(actor, target) : Math.hypot(actor.x - target.x, actor.y - target.y);
  return id === 'cleave' ? distanceTo < range : distanceTo <= range;
}
