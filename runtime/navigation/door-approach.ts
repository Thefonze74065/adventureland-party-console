import { doorDetour } from "./door-detour.ts";
import { stepIssue, type ValidationPorts } from "./validation.ts";
import { distance, isTransition, type Point, type Step } from "./contracts.ts";
import {repairWalkingInteriors} from './walking-interior.ts';

function approaches(ports: ValidationPorts, from: Point, to: Step): Point[] {
  const doors = (ports.game.maps[from.map]?.doors || [])
    .filter((d) => d[4] === to.map && Number(d[5] || 0) === to.s)
    .flatMap((d) => {
      const x = Number(d[0]),
        y = Number(d[1]),
        w = Number(d[2]),
        h = Number(d[3]);
      const spawn = ports.game.maps[from.map].spawns[Number(d[6])];
      const anchors = [
        [x, y],
        [x - w / 2, y],
        [x + w / 2, y],
        [x, y - h],
        [x - w / 2, y - h],
        [x + w / 2, y - h],
        ...(spawn ? [spawn] : []),
      ].map((p) => ({ map: from.map, x: p[0], y: p[1] }));
      // A door's center/spawn can be behind scenery even when its interaction
      // area is reachable. Sample inside the native 40-unit spawn radius;
      // connector still checks both collision clearance and actual door access.
      return anchors.concat(spawn ? Array.from({ length: 32 }, (_, i) => ({
        map: from.map,
        x: spawn[0] + 32 * Math.cos(i * Math.PI / 16),
        y: spawn[1] + 32 * Math.sin(i * Math.PI / 16),
      })) : []);
    });
  return doors.concat(transporterPoints(ports, from, to));
}
function transporterPoints(ports: ValidationPorts, from: Point, to: Step): Point[] {
  if (ports.game.npcs.transporter?.places[to.map] !== to.s) return [];
  const npc = ports.game.maps[from.map]?.npcs?.find((n) => n.id === "transporter")?.position;
  if (!npc) return [];
  return [60, 40].flatMap((radius) =>
    Array.from({ length: 32 }, (_, i) => ({
      map: from.map,
      x: npc[0] + radius * Math.cos((i * Math.PI) / 16),
      y: npc[1] + radius * Math.sin((i * Math.PI) / 16),
    })),
  );
}
/** Choose a native collision-clear point inside the existing transporter interaction radius. */
export function transporterApproach(ports: ValidationPorts, from: Point, to: Step): Point | undefined {
  const candidates=transporterPoints(ports,from,to).sort((a,b)=>distance(from,a)-distance(from,b))
    .filter(point=>ports.walk(point,point)&&!stepIssue(ports,point,to,true));
  const landingId=ports.game.npcs.transporter?.places[from.map];
  const landing=typeof landingId==='number' ? ports.game.maps[from.map]?.spawns[landingId] : undefined;
  // Native line collision accepts a stationary footprint inside enclosed
  // scenery. Prefer a connector from the actor or the transporter's actual
  // landing spawn, so an Inn exit cannot repeatedly target that empty pocket.
  return candidates.find(point=>ports.walk(from,point)||!!landing&&
    ports.walk({map:from.map,x:landing[0],y:landing[1]},point)) || candidates[0];
}
function connector(ports: ValidationPorts, from: Point, to: Step): Point | undefined {
  return approaches(ports, from, to)
    .sort((a, b) => distance(from, a) - distance(from, b))
    .find((p) => ports.walk(from, p) && !stepIssue(ports, p, to, true));
}
function connectorPath(ports: ValidationPorts, from: Point, to: Step): Point[] {
  const direct = connector(ports, from, to);
  return direct ? [direct] : doorDetour(ports, from, to, approaches(ports, from, to)) || [];
}
/** Native-validated approaches with a bounded local detour; inaccessible doors retain fallback. */
export function repairDoorApproaches(ports: ValidationPorts, from: Point, plot: Step[]): Step[] {
  const result: Step[] = [];
  let previous = from;
  for (const [index, step] of plot.entries()) {
    const next = plot[index + 1];
    if (!isTransition(step) && next?.transport && !ports.walk(previous, step)) {
      const repaired = connector(ports, previous, next);
      if (repaired) {
        result.push(repaired);
        previous = repaired;
        continue;
      }
    }
    if (
      step.transport &&
      stepIssue(ports, previous, step, true) === "door/transporter approach or access invalid"
    ) {
      result.push(...connectorPath(ports, previous, step));
    }
    result.push(step);
    previous = step;
  }
  return repairWalkingInteriors(ports,from,result);
}
