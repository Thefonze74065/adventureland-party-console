// Generated from TypeScript. Run npm run build:shared -- --publish; do not edit.

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// dashboard/lib/farming-areas.ts
var farming_areas_exports = {};
__export(farming_areas_exports, {
  defaultPhoenixOrder: () => defaultPhoenixOrder,
  farmingAreas: () => farmingAreas,
  validFarmingLocation: () => validFarmingLocation
});
module.exports = __toCommonJS(farming_areas_exports);

// dashboard/lib/farming-zones.ts
function polygon(shape) {
  if (shape.polygon && shape.polygon.length >= 3) return shape.polygon;
  const b = shape.boundary;
  return b ? [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]]
  ] : [];
}
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / d)) : 0;
  return Math.hypot(p.x - a[0] - dx * t, p.y - a[1] - dy * t);
}
function shapeDistance(shape, p) {
  const poly = polygon(shape);
  let inside = false, distance2 = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    distance2 = Math.min(distance2, segmentDistance(p, a, b));
    if (a[1] > p.y !== b[1] > p.y && p.x < (b[0] - a[0]) * (p.y - a[1]) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside ? 0 : distance2;
}
function distance(area, p) {
  if (!area || !p || p.map && p.map !== area.map) return Infinity;
  if (area.allOf)
    return Math.max.apply(
      null,
      area.allOf.map(function(a) {
        return distance(a, p);
      })
    );
  const shapes = area.shapes || (area.boundary || area.polygon ? [area] : []);
  if (!shapes.length) return Math.hypot(p.x - area.x, p.y - area.y);
  return Math.min.apply(
    null,
    shapes.map(function(s) {
      return shapeDistance(s, p);
    })
  );
}
function contains(area, p, margin = 0, radius = 400) {
  if (!area || !Number.isFinite(p && p.x) || !Number.isFinite(p && p.y))
    return false;
  const shaped = area.shapes || area.boundary || area.polygon || area.allOf;
  return distance(area, p) <= (shaped ? (margin || 0) + 1e-3 : (radius || 400) + (margin || 0));
}
function bounds(area) {
  const points = (area.shapes || [area]).flatMap(polygon);
  return points.length ? [
    Math.min.apply(
      null,
      points.map((p) => p[0])
    ),
    Math.min.apply(
      null,
      points.map((p) => p[1])
    ),
    Math.max.apply(
      null,
      points.map((p) => p[0])
    ),
    Math.max.apply(
      null,
      points.map((p) => p[1])
    )
  ] : [area.x, area.y, area.x, area.y];
}
function overlap(a, b) {
  const x = bounds(a), y = bounds(b);
  if (Math.max(x[0], y[0]) > Math.min(x[2], y[2]) || Math.max(x[1], y[1]) > Math.min(x[3], y[3]))
    return false;
  const pa = (a.shapes || [a]).flatMap(polygon), pb = (b.shapes || [b]).flatMap(polygon);
  if (pa.some((p) => contains(b, { x: p[0], y: p[1] })) || pb.some((p) => contains(a, { x: p[0], y: p[1] })))
    return true;
  function cross(a2, b2, c) {
    return (b2[0] - a2[0]) * (c[1] - a2[1]) - (b2[1] - a2[1]) * (c[0] - a2[0]);
  }
  for (const sa of a.shapes || [a])
    for (const sb of b.shapes || [b]) {
      const ap = polygon(sa), bp = polygon(sb);
      for (let i = 0; i < ap.length; i++)
        for (let j = 0; j < bp.length; j++) {
          const p = ap[i], q = ap[(i + 1) % ap.length], r = bp[j], s = bp[(j + 1) % bp.length];
          if (cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0)
            return true;
        }
    }
  return false;
}
function id(area) {
  return JSON.stringify([
    area.map,
    area.allOf || area.shapes || area.boundary || [area.x, area.y]
  ]);
}
function zones(catalog, ids) {
  const result = [];
  for (const monster of catalog || []) {
    if (!ids.includes(monster.id)) continue;
    for (const loc of monster.locations || []) {
      if (!loc.map || !Number.isFinite(loc.x) || !Number.isFinite(loc.y))
        continue;
      const shapes = loc.shapes || (loc.boundary || loc.polygon ? [{ boundary: loc.boundary, polygon: loc.polygon }] : null);
      const area = Object.assign({}, loc, {
        shapes,
        monsterIds: [monster.id]
      });
      for (let i = result.length - 1; i >= 0; i--) {
        const old = result[i];
        if (old.map === area.map && old.monsterIds[0] === monster.id && shapes && old.shapes && overlap(area, old)) {
          area.shapes = area.shapes.concat(old.shapes);
          result.splice(i, 1);
          i = result.length;
        }
      }
      if (area.shapes) area.boundary = bounds(area);
      area.id = id(area);
      result.push(area);
    }
  }
  return result;
}
function searchPoints(area) {
  if (!area) return [];
  const box = bounds(area), points = [{ map: area.map, x: area.x, y: area.y }];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 5; x++)
      points.push({
        map: area.map,
        x: box[0] + (box[2] - box[0]) * (x + 0.5) / 5,
        y: box[1] + (box[3] - box[1]) * (y + 0.5) / 5
      });
  return points.filter((p) => contains(area, p, 0, 1));
}

// dashboard/lib/farming-areas.ts
function defaultPhoenixOrder(areas) {
  const anchors = [
    { map: "main", x: 641, y: 1803 },
    { map: "cave", x: -180, y: -1164 },
    { map: "main", x: -1184, y: 781 },
    { map: "main", x: 1188, y: -193 },
    { map: "halloween", x: 8, y: 631 }
  ];
  const order = anchors.map((p) => areas.find((a) => a.map === p.map && contains(a, p, 0, 1))?.id);
  return order.every((id2) => !!id2) && new Set(order).size === 5 ? order : [];
}
var key = (a) => JSON.stringify([a.map, a.shapes || a.boundary || [a.x, a.y]]);
function farmingAreas(catalog, ids) {
  const regions = /* @__PURE__ */ new Map();
  for (const a of zones(catalog, ids)) {
    const k = key(a), existing = regions.get(k);
    if (existing)
      existing.monsterIds = [
        .../* @__PURE__ */ new Set([...existing.monsterIds, ...a.monsterIds])
      ];
    else regions.set(k, a);
  }
  const queue = [...regions.values()];
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    for (let j = 0; j < i; j++) {
      const b = queue[j];
      if (a.map !== b.map || !a.boundary || !b.boundary) continue;
      const members = [.../* @__PURE__ */ new Set([...a.monsterIds, ...b.monsterIds])].sort();
      if (members.length <= Math.max(a.monsterIds.length, b.monsterIds.length))
        continue;
      const box = [
        Math.max(a.boundary[0], b.boundary[0]),
        Math.max(a.boundary[1], b.boundary[1]),
        Math.min(a.boundary[2], b.boundary[2]),
        Math.min(a.boundary[3], b.boundary[3])
      ];
      if (box[0] >= box[2] || box[1] >= box[3]) continue;
      const region = {
        map: a.map,
        mapName: a.mapName,
        boundary: box,
        x: Math.round((box[0] + box[2]) / 2),
        y: Math.round((box[1] + box[3]) / 2),
        monsterIds: members,
        allOf: [...a.allOf || [a], ...b.allOf || [b]]
      };
      if (!contains(region, region)) {
        const point = searchPoints(region).find((p) => contains(region, p));
        if (!point) continue;
        region.x = point.x;
        region.y = point.y;
      }
      const k = key(region), existing = regions.get(k);
      if (!existing) {
        regions.set(k, region);
        queue.push(region);
      } else {
        const union = [.../* @__PURE__ */ new Set([...existing.monsterIds, ...members])].sort();
        if (union.length > existing.monsterIds.length) {
          const updated = { ...existing, monsterIds: union };
          regions.set(k, updated);
          queue.push(updated);
        }
      }
    }
  }
  return [...regions.values()].map((a) => ({ ...a, id: key(a), monsterIds: a.monsterIds.sort() })).sort(
    (a, b) => b.monsterIds.length - a.monsterIds.length || a.monsterIds.join(",").localeCompare(b.monsterIds.join(",")) || a.map.localeCompare(b.map) || a.x - b.x || a.y - b.y
  );
}
function validFarmingLocation(catalog, ids, candidate) {
  if (!validMonsterIds(catalog, ids)) return null;
  const location = candidate;
  return farmingAreas(catalog, ids).find(
    (a) => location && a.map === location.map && a.x === location.x && a.y === location.y
  ) || null;
}
function validMonsterIds(catalog, ids) {
  return !(!Array.isArray(ids) || !ids.length || ids.some(
    (id2) => typeof id2 !== "string" || !catalog.some((m) => m.id === id2)
  ));
}
