import { characterRuntime, distance, samePlace, type RoutePoint, type SharedConvoy, type SharedState, type SharedStatus } from './shared-route-types.ts';

/** Actual party sightings can update an owned walking leg; schedules cannot. */
export function movingEventDestination(state: SharedState, c: SharedConvoy, now: number): RoutePoint | null {
  if (!eventTravel(c) || !retargetDue(c, now)) return null;
  if (!c.participants.every(name => ownsEventWalk(state, c, name, now))) return null;
  const reporter = Object.values(state.statuses).find(s => actualBoss(s, c, now));
  const boss = reporter?.eventCombatSighting;
  if (!boss || distance(boss, c.location) < 250) return null;
  if (c.eventPursuitBossId && c.eventPursuitBossId !== boss.id) return null;
  c.eventPursuitBossId = boss.id;
  return { map: boss.map, in: boss.in, x: boss.x, y: boss.y };
}
function retargetDue(c: SharedConvoy, now: number): boolean {
  return now - (c.eventRetargetedAt ?? c.sharedStartedAt ?? now) >= 20000;
}

function eventTravel(c: SharedConvoy): boolean {
  return c.phase === 'travel' && c.purpose === 'shared-walk' && c.walkingActivity === 'event' &&
    ['mrgreen', 'mrpumpkin', 'slenderman'].includes(c.walkingEvent || '') && !c.nonPreemptible && c.readinessStartedAt === undefined;
}
function ownsEventWalk(state: SharedState, c: SharedConvoy, name: string, now: number): boolean {
  const s = state.statuses[name], command = state.commands[name], parent = c.walkingParents?.[name];
  if (!fresh(s, now) || !command || !parent || s.joinedEvent !== c.walkingEvent) return false;
  return command.convoyId === c.id && command.navigationRevision === parent.revision &&
    ownsRevision(state, name, parent.revision) && characterRuntime(s) === c.runtimes?.[name];
}
function ownsRevision(state: SharedState, name: string, revision: number): boolean {
  const intent = state.navigationIntents?.[name];
  return !!intent && intent.revision === revision && !intent.cancelled;
}
function actualBoss(s: SharedStatus | undefined, c: SharedConvoy, now: number): boolean {
  if (!fresh(s, now) || s.joinedEvent !== c.walkingEvent || s.server !== c.routeServer) return false;
  const boss = s.eventCombatSighting;
  if (!boss?.id || boss.mtype !== c.walkingEvent || !Number.isFinite(boss.observedAt)) return false;
  return freshBossPosition(boss, now) && samePlace(boss, s) && samePlace(boss, c.location);
}
function freshBossPosition(boss: NonNullable<SharedStatus['eventCombatSighting']>, now: number): boolean {
  return boss.observedAt >= now - 3000 && boss.observedAt <= now + 1000 && Number.isFinite(boss.x) && Number.isFinite(boss.y);
}
function fresh(s: SharedStatus | undefined, now: number): s is SharedStatus {
  return !!s && !s.rip && s.hp !== 0 && Number.isFinite(s.seenAt) && s.seenAt >= now - 3000 && s.seenAt <= now + 1000;
}
