import { requestObject } from "../http/contracts.ts";
import { contains } from "../../../dashboard/lib/farming-zones.ts";
import { characterRuntime, distance, samePlace, reportMatches, type RoutePoint, type RouteWaypoint, type SharedCommand, type SharedConvoy, type SharedRoute, type SharedState } from "./shared-route-types.ts";

// Weak keys prevent completed/cancelled convoys from retaining routes. Never persist this store.
const routes = new WeakMap<SharedConvoy, SharedRoute>();
export const sharedRoute = (convoy: SharedConvoy): SharedRoute | undefined => {
  const route = routes.get(convoy);
  return route?.version === convoy.routeVersion ? route : undefined;
};
export function clearSharedRoute(convoy: SharedConvoy): void { routes.delete(convoy); }

function coordinate(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
export function readRoutePoint(input: unknown): RoutePoint | null {
  const p = requestObject(input);
  if (typeof p.map !== "string" || !/^[a-zA-Z0-9_]+$/.test(p.map)) return null;
  if (!coordinate(p.x) || !coordinate(p.y)) return null;
  if (p.in !== undefined && typeof p.in !== "string" && typeof p.in !== "number") return null;
  return { map: p.map, x: p.x, y: p.y, ...(p.in === undefined ? {} : { in: p.in }) };
}
function waypoint(input: unknown): RouteWaypoint | null {
  const p = requestObject(input), location = readRoutePoint(input);
  if (!location || (p.town && p.transport)) return null;
  if (!validFlags(p)) return null;
  if (!validLeave(p)) return null;
  if (!validMetadata(p)) return null;
  return withMetadata(p, { ...location, ...(p.town === true ? { town: true } : {}),
    ...(p.transport === true ? { transport: true, s: Number(p.s) } : {}) });
}
function validLeave(p: Record<string, unknown>): boolean {
  return p.method !== 'leave' || !(p.town || p.transport || p.s !== undefined || p.key !== undefined);
}
function validFlags(p: Record<string, unknown>): boolean {
  if ([p.town, p.transport].some(flag => flag !== undefined && typeof flag !== 'boolean')) return false;
  return !p.transport || Number.isInteger(p.s) && Number(p.s) >= 0;
}
function withMetadata(p: Record<string, unknown>, location: RouteWaypoint): RouteWaypoint {
  return { ...location,
    ...(typeof p.method === 'string' ? {method: p.method} : {}), ...(typeof p.key === 'string' ? {key: p.key} : {}) };
}
function validMetadata(p: Record<string, unknown>): boolean {
  if (p.method !== undefined && (typeof p.method !== 'string' || !['move', 'town', 'door', 'transport', 'leave'].includes(p.method))) return false;
  return p.key === undefined || typeof p.key === 'string' && p.key.length <= 100;
}
function parseRoute(input: unknown): SharedRoute | null {
  const data = requestObject(input), origin = readRoutePoint(data.origin), destination = readRoutePoint(data.destination);
  const geometry = requestObject(data.geometry);
  if (!validGeometry(geometry)) return null;
  if (!origin || !destination || !Array.isArray(data.plot) || data.plot.length > 10000) return null;
  if (JSON.stringify(input).length > 900000) return null;
  const plot = data.plot.map(waypoint);
  if (plot.some(p => !p)) return null;
  if (!["search", "remainder", "itinerary"].includes(String(data.source))) return null;
  return { engine: ['native','alclient','shared'].includes(String(data.engine)) ? String(data.engine) : 'shared', geometry: {version: Number(geometry.version), fingerprint: geometry.fingerprint}, version: Number(data.version), origin, destination, plot: plot as RouteWaypoint[], source: data.source as SharedRoute["source"] };
}
function validGeometry(g: Record<string, unknown>): g is {version: number; fingerprint: string} {
  return Number.isInteger(g.version) && typeof g.fingerprint === 'string' && g.fingerprint.length <= 100;
}
function currentOwner(state: SharedState, c: SharedConvoy, name: string, command: SharedCommand, now: number): boolean {
  const intent = state.navigationIntents?.[name], status = state.statuses[name];
  if (!status || status.seenAt < now - 3000 || status.rip) return false;
  if (intent && (intent.revision !== command.navigationRevision || intent.cancelled && !c.navigationExempt)) return false;
  return runtimeMatches(state, c, name);
}
function runtimeMatches(state: SharedState, c: SharedConvoy, name: string): boolean {
  return characterRuntime(state.statuses[name]) === c.runtimes?.[name];
}
function routeIdentity(c: SharedConvoy, command: SharedCommand, body: Record<string, unknown>): boolean {
  if (c.id !== body.convoyId || c.epoch !== Number(body.epoch)) return false;
  if (command.convoyId !== c.id || command.id !== Number(body.commandId)) return false;
  const name = String(body.character);
  return command.navigationRevision === Number(body.navigationRevision) &&
    c.runtimes?.[name] === body.runtimeId && c.routeVersion === Number(body.routeVersion);
}
export function routeOwner(state: SharedState, body: Record<string, unknown>, now: number): boolean {
  const c = state.activeConvoy, name = String(body.character), command = state.commands[name];
  if (!c || !command || c.routeProtocol !== 4 || !c.participants.includes(name) || c.phase === "failed") return false;
  return currentOwner(state, c, name, command, now) && routeIdentity(c, command, body);
}
/** Ownership without liveness, so a delayed heartbeat is a wait, not cancellation. */
export function routeIdentityOwned(state: SharedState, body: Record<string, unknown>): boolean {
  const c=state.activeConvoy,name=String(body.character),command=state.commands[name],intent=state.navigationIntents?.[name];
  if(!c || !command || !c.participants.includes(name) || c.phase==='failed')return false;
  if(!intentMatches(intent,command,c))return false;
  return runtimeMatches(state,c,name) && routeIdentity(c,command,body);
}
function intentMatches(intent: {revision:number;cancelled?:boolean}|undefined, command: SharedCommand, c: SharedConvoy): boolean {
  return !intent || intent.revision===command.navigationRevision && (!intent.cancelled || !!c.navigationExempt);
}
function validPublication(state: SharedState, c: SharedConvoy, route: SharedRoute | null): route is SharedRoute {
  const leader = state.statuses[c.leader];
  if (!route || route.version !== c.routeVersion || !leader || leader.moving) return false;
  return distance(route.origin, leader) <= 1 && distance(route.origin, c.rally) <= 1 &&
    contains(c.location, route.destination, 0, 1) && samePlace(route.origin, c.rally);
}
export function publishSharedRoute(state: SharedState, body: Record<string, unknown>, now: number): string | null {
  const c = state.activeConvoy;
  if (!routeOwner(state, body, now) || body.character !== c!.leader || c!.phase !== "shared-prepare") return "stale route publisher";
  const route = parseRoute(body.route);
  if (!validPublication(state, c!, route)) return "invalid route or changed origin/destination";
  // A farming-zone destination can resolve to a different entry point. The client
  // retains its authorized area; only the current leader may resolve that point.
  const old = sharedRoute(c!);
  if (old && JSON.stringify(old) !== JSON.stringify(route)) return "route version already published";
  routes.set(c!, structuredClone(route));
  c!.routePublishedAt ??= now;
  return null;
}
export function sharedArrivalReady(input: unknown, now: number): boolean {
  const state = input as SharedState, c = state.activeConvoy;
  if (!c) return false;
  return c.participants.every(name => {
    const status = state.statuses[name];
    if (!arrivalStatus(status, now) || !arrivalOwned(state, c, name)) return false;
    if (c.completed.includes(name)) return true;
    if (!reportMatches(state, name)) return false;
    if (status.convoyNavigation?.phase !== "arrived" || status.convoyNavigation.routeVersion !== c.routeVersion) return false;
    return arrivedPosition(c, status);
  });
}

function arrivalStatus(s: SharedState['statuses'][string], now: number): s is NonNullable<SharedState['statuses'][string]> {
  return !!s && !s.rip && s.hp !== 0 && !s.moving && s.seenAt >= now - 3000 && s.seenAt <= now + 500;
}
function arrivalOwned(state: SharedState, c: SharedConvoy, name: string): boolean {
  const status = state.statuses[name]!, intent = state.navigationIntents?.[name];
  if (status.server !== c.routeServer || characterRuntime(status) !== c.runtimes?.[name]) return false;
  return !intent || !intent.cancelled && intent.revision === c.expected?.[name]?.revision;
}
function arrivedPosition(c: SharedConvoy, status: import('./shared-route-types.ts').SharedStatus): boolean {
  if (c.purpose === 'monster-hunt' && !samePlace(c.location, status)) return false;
  if (c.purpose === 'monster-hunt' && c.huntTarget) {
    const destination = sharedRoute(c)?.destination;
    return !!destination && samePlace(destination, status) &&
      Math.hypot(status.x - destination.x, status.y - destination.y) <= 50;
  }
  return c.purpose === 'franky-exit' ? status.map === 'main' : contains(c.location, status, 0, 100);
}
