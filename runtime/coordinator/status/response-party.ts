import type { EntityReference, HeartbeatState, HeartbeatStatus, SlendermanSighting } from "./response-types.ts";

const positionFields = [
  "ctype",
  "map",
  "x",
  "y",
  "escape",
  "server",
  "seenAt",
  "in",
  "hp",
  "max_hp",
  "mp",
  "max_mp",
  "rip",
  "attack",
  "frequency",
  "range",
  "activeCombatTarget",
  "monsterHunt",
] as const;

function position(name: string, status: HeartbeatStatus) {
  return {
    name,
    ...Object.fromEntries(positionFields.map((field) => [field, status[field]])),
    ...(status.eventCombatSighting ? { eventCombatSighting: status.eventCombatSighting } : {}),
    kiting: !!status.combat?.kiting,
    team: status.eventTeam || null,
    activeEvent: status.activeEvent || status.joinedEvent || null,
    armorPiercing: status.combatStats && status.combatStats.armorPiercing,
  };
}

function uniqueReferences(entries: (EntityReference | null | undefined)[]): EntityReference[] {
  const seen = new Set<string>();
  return entries.filter((entry): entry is EntityReference => {
    if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function freshSightingTime(value: number | undefined, now: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= now - 3000 && value <= now + 1000;
}

function sightingScope(report: HeartbeatStatus, sighting: SlendermanSighting, server: string | undefined): boolean {
  return !!server && report.server === server && sighting.server === server &&
    report.map === sighting.map && report.in === sighting.in;
}

function sightingPosition(sighting: SlendermanSighting): boolean {
  return typeof sighting.id === 'string' && !!sighting.id && typeof sighting.map === 'string' &&
    !!sighting.map && Number.isFinite(sighting.x) && Number.isFinite(sighting.y);
}

export function partyResponse(
  state: HeartbeatState,
  names: string[],
  leader: HeartbeatStatus | null | undefined,
  recipientServer?: string,
) {
  const now = Date.now();
  const sightings = names.flatMap(name => {
    const report = state.statuses[name], sighting = report?.slendermanSighting;
    if (!report || !sighting || !sightingScope(report, sighting, recipientServer) ||
        !freshSightingTime(report.seenAt, now) || !freshSightingTime(sighting.observedAt, now) ||
        !sightingPosition(sighting)) return [];
    return [sighting];
  }).sort((a, b) => b.observedAt - a.observedAt);
  return {
    ...(sightings[0] ? { partySlendermanSighting: sightings[0] } : {}),
    desiredPartyMembers: names.filter(
      (name) =>
        (name === state.leader || state.followers[name]) &&
        leader &&
        state.statuses[name]?.server === leader.server,
    ),
    partyPositions: names.map((name) => position(name, state.statuses[name]!)),
    partyThreats: uniqueReferences(
      names
        .filter((name) => name !== state.leader)
        .flatMap((name) => {
          const threats = state.statuses[name]?.threats;
          return Array.isArray(threats) ? threats : [];
        }),
    ),
    partyTargets: uniqueReferences(names.map((name) => state.statuses[name]?.target)),
  };
}

export function monsterFocus(state: HeartbeatState, name: string): string[] {
  if (state.farmingPolicy === "hunt" && state.monsterHunt?.target)
    return [state.monsterHunt.target];
  if ((name === state.leader || state.followers[name]) && state.leader) return state.monsterFocus;
  return Object.prototype.hasOwnProperty.call(state.monsterFocusByCharacter, name)
    ? state.monsterFocusByCharacter[name]!
    : state.monsterFocus;
}

const requiredCatalogs = [
  "travelPlaces",
  "monsterChoices",
  "monsterHunterLocation",
  "bestiaryCatalog",
  "skillCatalog",
  "appearanceChoices",
  "merchantCatalog",
] as const;
export function needsCatalog(state: HeartbeatState): boolean {
  return (
    state.monsterLocationsVersion !== 3 ||
    requiredCatalogs.some((field) => !state[field]) ||
    state.merchantCatalogVersion !== "exchange-rewards-v4"
  );
}
