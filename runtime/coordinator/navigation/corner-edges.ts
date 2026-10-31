import type { Geometry, Point, Step } from '../../navigation/contracts.ts';

type Base = Geometry;
type Walk = (from: Point, to: Point, base: Base) => boolean;

/**
 * alpathfinder accepts some walking edges that cut a wall corner the game's
 * can_move rejects (#147). Replace each rejected same-map edge with one detour
 * point that passes both legs; an edge without one is left for the client's
 * bounded repair. Valid edges and transitions are never changed.
 */
export function detourRejectedEdges(plot: Step[], base: Base, walk: Walk) {
  let detoured = 0;
  const unresolved: [Step, Step][] = [], result: Step[] = [];
  try {
    for (let i = 0; i < plot.length; i++) {
      const next = plot[i], previous = result.at(-1);
      if (previous && walkingEdge(previous, next) && !walk(previous, next, base)) {
        const via = detourPoint(previous, next, base, walk);
        if (via) { result.push(via); detoured++; } else unresolved.push([previous, next]);
      }
      result.push(next);
    }
  } catch { return { plot, detoured: 0, unresolved: [] }; }
  return { plot: detoured ? result : plot, detoured, unresolved };
}

function walkingEdge(from: Step, to: Step): boolean {
  return from.map === to.map && (from.in === undefined || to.in === undefined || String(from.in) === String(to.in)) &&
    !to.transport && !to.town && (to.method === undefined || to.method === 'move');
}

function detourCandidates(from: Step, to: Step): {x:number;y:number}[] {
  const candidates: { x: number; y: number }[] = [];
  const offsets = [0, 4, 8, 12, 16, 24, 32];
  for (const [x, y] of [[from.x, to.y], [to.x, from.y]])
    for (const dx of offsets) for (const dy of offsets)
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) candidates.push({ x: x + sx * dx, y: y + sy * dy });
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const nx = -(to.y - from.y) / length, ny = (to.x - from.x) / length;
  for (const along of [0.25, 0.5, 0.75]) for (const side of [-64, -48, -32, -24, -16, -8, 8, 16, 24, 32, 48, 64])
    candidates.push({ x: from.x + (to.x - from.x) * along + nx * side, y: from.y + (to.y - from.y) * along + ny * side });
  return candidates;
}

/** The shortest single point near the edge's elbows or midpoint that both legs can walk. */
function detourPoint(from: Step, to: Step, base: Base, walk: Walk): Step | null {
  const candidates=detourCandidates(from,to);
  let best: Step | null = null, bestLength = Infinity;
  for (const c of candidates) {
    const total = Math.hypot(c.x - from.x, c.y - from.y) + Math.hypot(to.x - c.x, to.y - c.y);
    if (total >= bestLength) continue;
    const point: Step = { map: from.map, ...(from.in === undefined ? {} : {in:from.in}), x: Math.round(c.x), y: Math.round(c.y), method: 'move' };
    if (walk(from, point, base) && walk(point, to, base)) { best = point; bestLength = total; }
  }
  return best;
}
