import type { Area, Checkpoint, Owner, Patrol, Point, Searcher, Status } from "./rare-types.ts";

const distance = (a: Point, b: Point) =>
  a.map === b.map ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
function axis(a: number, b: number, half: number, current: number): number[] {
  if (b - a <= half * 2)
    return [Math.max(Math.max(a, b - half), Math.min(Math.min(b, a + half), current))];
  const count = Math.ceil((b - a - half * 2) / (half * 1.7));
  return Array.from({ length: count + 1 }, (_, i) => a + half + ((b - a - half * 2) * i) / count);
}
/** Observation points whose conservative visibility footprints cover the spawn box. */
export function scanPoints(area: Area, from: Point): Point[] {
  const [x1, y1, x2, y2] = area.boundary!;
  const origin = from.map === area.map ? from : area;
  const xs = axis(x1, x2, 550, origin.x),
    ys = axis(y1, y2, 350, origin.y);
  const points = ys.flatMap((y, i) =>
    (i % 2 ? xs.slice().reverse() : xs).map((x) => ({ map: area.map, x, y })),
  );
  if (distance(from, points.at(-1)!) < distance(from, points[0])) points.reverse();
  return points;
}
export function newPatrol(owner: Owner, id: string): Patrol {
  return { ...owner, id, readyAt: 0, cycle: 0, covered: {}, incomplete: [], searchers: {}, stage: "searching" };
}
export function patrolCheckpoint(p: Patrol): Checkpoint {
  return { leader: p.leader, realm: p.realm, focus: p.focus, policy: p.policy, revisions: { ...p.revisions }, readyAt: p.readyAt };
}
export function searchControlId(p: Patrol, name: string): string | null {
  const s = p.searchers[name];
  return s ? `${p.id}-${p.cycle}-${name}-${s.regionId}-${s.point}` : null;
}
export function searchDestination(p: Patrol, name: string): Point | null {
  const s = p.searchers[name];
  return (s && s.points[s.point]) || null;
}
export interface SearchPorts {
  now: number;
  clock(): number;
  statuses: Record<string, Status>;
  /** Fresh, living, unprotected fighters this tick may direct. */
  searchers: string[];
  /** Spawn regions in the saved order, which breaks route-distance ties. */
  areas: Area[];
  routeDistance?(from: Point, to: Point): Promise<number>;
  /** False once the patrol is stopped, replaced, or superseded by navigation. */
  current(p: Patrol): boolean;
  publish(): void;
}

/**
 * Every fighter searches on its own. A free fighter takes the nearest region by
 * planned route that nobody has checked this cycle and nobody else is heading to;
 * regions are shared only when every unchecked one is already claimed.
 */
export function stepSearch(p: Patrol, ports: SearchPorts): void {
  if (p.paused) return;
  release(p, ports);
  if (!nextCycle(p, ports)) return;
  for (const name of ports.searchers) if (p.searchers[name]) advance(p, name, ports);
  assignFree(p, ports);
  describe(p, ports);
}
function assignFree(p: Patrol, ports: SearchPorts): void {
  const free = ports.searchers.filter((name) => !p.searchers[name]);
  // A planner call that never settles must not freeze assignment forever.
  if (p.assigning && ports.now - (p.assigningAt || 0) > 20000) p.assigning = undefined;
  if (free.length && !p.assigning && ports.now >= (p.assignAfter || 0)) void assign(p, ports, free);
}
/** Brief absences (a map change, a delivered item, a low-HP dip) keep the leg. */
const ABSENCE_GRACE = 10000;
function release(p: Patrol, ports: SearchPorts): void {
  for (const [name, s] of Object.entries(p.searchers)) {
    if (p.covered[s.regionId] || p.incomplete.includes(s.regionId)) delete p.searchers[name];
    else if (ports.searchers.includes(name)) {
      if (s.absentSince) restartWatchdog(s, ports.now);
      s.absentSince = undefined;
    } else if (ports.now - (s.absentSince ||= ports.now) > ABSENCE_GRACE) delete p.searchers[name];
  }
}
function restartWatchdog(s: Searcher, now: number): void {
  s.arrivedAt = 0;
  s.progressAt = now;
  s.progressPosition = undefined;
}
/** A paused patrol keeps its assignments; movement watchdogs restart on resume. */
export function pauseSearch(p: Patrol, now: number): void {
  for (const s of Object.values(p.searchers)) restartWatchdog(s, now);
}
function nextCycle(p: Patrol, ports: SearchPorts): boolean {
  if (p.incomplete.length >= ports.areas.length) {
    p.paused = true;
    p.message = "All Phoenix regions unreachable; restart the patrol to retry";
    return false;
  }
  if (ports.areas.every((a) => p.covered[a.id!] || p.incomplete.includes(a.id!))) {
    // Nothing was found anywhere. Another party may have killed it; search again.
    p.cycle++;
    p.covered = {};
    p.incomplete = [];
    p.searchers = {};
  }
  return true;
}
function advance(p: Patrol, name: string, ports: SearchPorts): void {
  const s = p.searchers[name]!,
    status = ports.statuses[name]!,
    destination = s.points[s.point];
  if (!destination) return finishRegion(p, name, s, ports.now);
  const report = status.rareNavigation;
  if (report?.failed && report.id === searchControlId(p, name)) return skip(p, name, s, ports.now, "route failed");
  if (stalled(s, status, destination, ports.now)) return skip(p, name, s, ports.now, "no movement progress for 30 seconds");
  if (distance(status, destination) > 40) s.arrivedAt = 0;
  else if (observedPoint(p, s, status, destination, ports.now)) {
    nextPoint(s, ports.now);
    if (s.point >= s.points.length) finishRegion(p, name, s, ports.now);
  }
}
/** Arrived: a point counts after a one-second dwell with a fresh post-respawn observation. */
function observedPoint(p: Patrol, s: Searcher, status: Status, destination: Point, now: number): boolean {
  // Pre-positioned before the respawn: hold here. Earlier observations cannot count.
  if (now < p.readyAt) {
    s.arrivedAt = 0;
    return false;
  }
  s.arrivedAt ||= now;
  return now - s.arrivedAt >= 1000 && observedSince(status, Math.max(s.arrivedAt, p.readyAt), destination, now);
}
function observedSince(s: Status, since: number, destination: Point, now: number): boolean {
  const o = s.rareObservation;
  return !!o && o.runtimeId === s.combatSelection?.runtimeId && o.at >= since && o.at <= now + 1000 &&
    o.map === destination.map && o.in === destination.map;
}
function stalled(s: Searcher, status: Status, destination: Point, now: number): boolean {
  const position = s.progressPosition;
  if (!position || distance(position, status) >= 10) {
    s.progressPosition = { map: status.map, x: status.x, y: status.y };
    s.progressAt = now;
  }
  if (distance(status, destination) <= 40) s.progressAt = now;
  return now - s.progressAt >= 30000;
}
function nextPoint(s: Searcher, now: number): void {
  s.point++;
  s.arrivedAt = 0;
  s.progressAt = now;
  s.progressPosition = undefined;
}
function skip(p: Patrol, name: string, s: Searcher, now: number, reason: string): void {
  p.retryReason = `${name}: ${reason}; skipped one scan point`;
  s.skipped++;
  nextPoint(s, now);
  if (s.point >= s.points.length) finishRegion(p, name, s, now);
}
function finishRegion(p: Patrol, name: string, s: Searcher, now: number): void {
  if (s.skipped >= s.points.length) p.incomplete.push(s.regionId);
  else p.covered[s.regionId] = now;
  delete p.searchers[name];
}

let assignments = 0;
async function assign(p: Patrol, ports: SearchPorts, names: string[]): Promise<void> {
  const open = ports.areas.filter((a) => !p.covered[a.id!] && !p.incomplete.includes(a.id!));
  if (!open.length) return;
  const token = (p.assigning = ++assignments), cycle = p.cycle;
  p.assigningAt = ports.now;
  const scored = await Promise.all(names.flatMap((name) => open.map(async (area) => {
    const s = ports.statuses[name]!, from = { map: s.map, x: s.x, y: s.y };
    return { name, area, order: ports.areas.indexOf(area), distance: await routeLength(ports, from, scanPoints(area, from)[0]!) };
  })));
  if (!ports.current(p) || p.assigning !== token) return;
  p.assigning = undefined;
  if (p.cycle !== cycle) return;
  const claimed = new Set(Object.values(p.searchers).map((s) => s.regionId));
  const pending = new Set(names.filter((name) => !p.searchers[name]));
  let unassigned = false;
  while (pending.size) {
    const usable = scored.filter((c) => pending.has(c.name) && Number.isFinite(c.distance) &&
      !p.covered[c.area.id!] && !p.incomplete.includes(c.area.id!));
    if (!usable.length) { unassigned = true; break; }
    const free = usable.filter((c) => !claimed.has(c.area.id!));
    const best = (free.length ? free : usable).sort((a, b) => a.distance - b.distance || a.order - b.order)[0]!;
    const status = ports.statuses[best.name]!;
    p.searchers[best.name] = {
      regionId: best.area.id!,
      points: scanPoints(best.area, { map: status.map, x: status.x, y: status.y }),
      point: 0, skipped: 0, arrivedAt: 0, retry: 0, progressAt: ports.clock(),
    };
    claimed.add(best.area.id!);
    pending.delete(best.name);
  }
  // A fighter with no plannable route retries later instead of hammering the planner.
  p.assignAfter = unassigned ? ports.clock() + 5000 : 0;
  if (unassigned) p.retryReason = "No planned route to an unchecked Phoenix region; retrying";
  ports.publish();
}
async function routeLength(ports: SearchPorts, from: Point, to: Point): Promise<number> {
  if (!ports.routeDistance) return from.map === to.map ? distance(from, to) : 1_000_000;
  try { return await ports.routeDistance(from, to); } catch { return Infinity; }
}

function describe(p: Patrol, ports: SearchPorts): void {
  p.stage = ports.now < p.readyAt ? "respawn" : "searching";
  const activity = p.stage === "respawn"
    ? `Waiting for respawn (${Math.ceil((p.readyAt - ports.now) / 1000)}s)`
    : "Searching";
  const legs = Object.entries(p.searchers).map(([name, s]) => `${name} → ${s.points[0]?.map ?? s.regionId}`);
  p.message = `${activity} · ${Object.keys(p.covered).length}/${ports.areas.length} regions checked` +
    (legs.length ? ` · ${legs.join(", ")}` : p.assigning ? " · planning routes" : "");
}
