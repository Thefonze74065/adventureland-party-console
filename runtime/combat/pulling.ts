/** Pull mode: the party's longest-range member draws one monster at a time to a waiting spot. */
export interface Point { x: number; y: number }
export interface PullMember { name: string; ctype: string; range: number; rip?: boolean }
export interface PullMonster extends Point { id: string; target?: string | null; dead?: boolean }

// The game server's monster tick puts an aggressive monster in a 32-unit grid
// (set_ghash(aggressives, monster, 32), node/server.js) and each player checks the 3x3
// cells around it (get_nearby_ghash, node/server_functions.js). A player more than two
// cells away on either axis is never in an idle monster's aggro check: two cells of 32
// units on both axes is at most 90.5 units, and AGGRO_REACH rounds that up.
export const AGGRO_REACH = 96;
/** Extra clearance the waiting spot and the puller keep beyond AGGRO_REACH. */
export const PULL_MARGIN = 24;
/** A puller needs an attack range that clears AGGRO_REACH of the monsters next to its pull. */
export const MIN_PULL_RANGE = 100;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const idle = (monsters: PullMonster[]) => monsters.filter(m => !m.dead && !m.target);

/** The living member with the longest attack range of at least MIN_PULL_RANGE; ties by name. */
export function choosePuller(members: PullMember[]): string | null {
  return members.filter(m => !m.rip && Number(m.range) >= MIN_PULL_RANGE)
    .sort((a, b) => b.range - a.range || a.name.localeCompare(b.name))[0]?.name || null;
}

/** True when the point is outside every idle monster's aggro check, with the margin. */
export function outsideReach(point: Point, monsters: PullMonster[], except?: string): boolean {
  return idle(monsters).every(m => m.id === except || distance(point, m) > AGGRO_REACH + PULL_MARGIN);
}

/**
 * The nearest walkable point to `origin` outside every idle monster's aggro check: `origin`
 * itself when it is clear, otherwise the first clear point on rings of 16 directions every
 * 40 units out to 600. Null when no ring point is clear and walkable.
 */
export function waitingSpot(origin: Point, monsters: PullMonster[], walkable: (point: Point) => boolean = () => true): Point | null {
  if (outsideReach(origin, monsters)) return { x: origin.x, y: origin.y };
  for (let radius = 40; radius <= 600; radius += 40) {
    const ring: Point[] = [];
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      ring.push({ x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius });
    }
    const clear = ring.filter(p => outsideReach(p, monsters) && walkable(p));
    if (clear.length) return clear.sort((a, b) => distance(a, origin) - distance(b, origin))[0];
  }
  return null;
}

/** How far beyond AGGRO_REACH and PULL_MARGIN the staging point stands from the pack's edge. */
export const STAGING_GAP = 40;
/**
 * Where the party waits: on the line from the idle eligible monster nearest `anchor` back
 * toward `anchor`, AGGRO_REACH + PULL_MARGIN + STAGING_GAP from that monster, so the
 * puller walks a short way. `anchor` itself when it is already that close or nothing is idle.
 */
export function stagingPoint(anchor: Point, monsters: PullMonster[], eligible: (monster: PullMonster) => boolean = () => true): Point {
  const nearest = idle(monsters).filter(eligible).sort((a, b) => distance(a, anchor) - distance(b, anchor))[0];
  const gap = nearest ? distance(nearest, anchor) : 0, stand = AGGRO_REACH + PULL_MARGIN + STAGING_GAP;
  if (!nearest || gap <= stand) return { x: anchor.x, y: anchor.y };
  return { x: nearest.x + (anchor.x - nearest.x) / gap * stand, y: nearest.y + (anchor.y - nearest.y) / gap * stand };
}

/** True when every point every 20 units from `a` to `b` is outside the reach of all but `except`. */
export function pathOutsideReach(a: Point, b: Point, monsters: PullMonster[], except?: string): boolean {
  const steps = Math.max(1, Math.ceil(distance(a, b) / 20));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!outsideReach({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, monsters, except)) return false;
  }
  return true;
}

export interface PullPlan { target: string; from: Point }
/**
 * One idle monster to pull and the point the puller attacks it from: `range - 10` from the
 * monster on the line toward the waiting spot, outside the aggro check of every other idle
 * monster, along a straight walk from the spot that stays outside them too. It prefers the
 * monster farthest from the others, then the one nearest the spot.
 * Only `eligible` monsters are pulled; every idle monster counts for the aggro checks.
 */
export function choosePullTarget(monsters: PullMonster[], spot: Point, range: number, walkable: (point: Point) => boolean = () => true,
  eligible: (monster: PullMonster) => boolean = () => true): PullPlan | null {
  const candidates = idle(monsters);
  const plans = candidates.filter(eligible).map(m => {
    const others = candidates.filter(o => o.id !== m.id);
    const isolation = others.length ? Math.min(...others.map(o => distance(o, m))) : Infinity;
    const gap = distance(m, spot), stand = Math.max(1, range - 10);
    const from = gap <= stand ? { x: spot.x, y: spot.y } :
      { x: m.x + (spot.x - m.x) / gap * stand, y: m.y + (spot.y - m.y) / gap * stand };
    return { m, isolation, gap, from };
  }).filter(p => pathOutsideReach(spot, p.from, candidates, p.m.id) && walkable(p.from))
    .sort((a, b) => b.isolation - a.isolation || a.gap - b.gap || a.m.id.localeCompare(b.m.id));
  return plans[0] ? { target: plans[0].m.id, from: plans[0].from } : null;
}

/** The next pull waits until no monster targets the party and no fight is unfinished. */
export function pullAllowed(monsters: PullMonster[], party: string[], unfinishedFight: boolean): boolean {
  return !unfinishedFight && !monsters.some(m => !m.dead && !!m.target && party.includes(m.target));
}
