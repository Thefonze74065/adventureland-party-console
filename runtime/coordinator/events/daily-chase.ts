import { requestObject, type HttpRequest, type HttpResponse } from "../http/contracts.ts";

/**
 * Predictive realm hopping for scheduled events (issue #46). Each game server shuffles its
 * `dailies` ["crabxx","goobrawl","abtesting"] and `nightlies` ["icegolem","franky"] once at startup,
 * then fires the next one at every slot of that rotation (node/server.js + server_functions.js
 * `event_loop`). A realm therefore repeats a fixed cycle per rotation until it restarts: one sighting
 * of event X at slot k predicts X at k+3 (dailies) or k+2 (nightlies). When the current realm is
 * known not to get a wanted event at its next slot, move the party to a realm predicted to get it,
 * early enough for Hop Sickness (12 minutes) to clear first, then return.
 */
// Server constants: E.schedule.dailies/nightlies and TIMEO in node/server.js.
export const rotations = {
  daily: { events: ["crabxx", "goobrawl", "abtesting"], hours: [13, 20] },
  nightly: { events: ["icegolem", "franky"], hours: [23] },
} as const;
export type Rotation = keyof typeof rotations;
export const dailyEvents = rotations.daily.events;
export const scheduledEvents = [...rotations.daily.events, ...rotations.nightly.events] as const;
export type DailyEvent = (typeof scheduledEvents)[number];
const rotationNames = Object.keys(rotations) as Rotation[];
const rotationOf = (event: DailyEvent): Rotation =>
  (rotations.daily.events as readonly string[]).includes(event) ? "daily" : "nightly";
const regionOffsets: Record<string, number> = { US: -5, EU: 1, ASIA: 7 };
const hourMs = 3_600_000, dayMs = 86_400_000;
const sicknessMs = 12 * 60_000;
// Events are attributed to the slot that started at most this long before the sighting.
const eventWindowMs = 90 * 60_000;
const observationMaxAgeMs = 2 * dayMs;
const returnQuietChecks = 2;
const retryDelayMs = 5 * 60_000;

export interface DailyObservation { slot: number; at: number }
export interface DailyChaseTrip {
  rotation?: Rotation;
  event: DailyEvent;
  realm: string;
  slot: number;
  slotAt: number;
  returnRealm: string | null;
  startedAt: number;
  arrived: boolean;
  quietChecks: number;
}
export interface DailyPrediction { realm: string; event: DailyEvent }
export interface DailyUpcoming { rotation: Rotation; region: string; slotAt: number; predictions: DailyPrediction[] }
export interface DailyChaseState {
  enabled: boolean;
  /** Arrive this many minutes before the slot; must exceed Hop Sickness plus travel. */
  leadMinutes: number;
  /** Also chase slots on other regions' schedules (extra events, not replacements). */
  otherRegions: boolean;
  observations: Record<string, Partial<Record<DailyEvent, DailyObservation>>>;
  /** Game version the observations were gathered under; an update restarts and reshuffles every realm. */
  gameVersion: number;
  trip: DailyChaseTrip | null;
  retryAt: number;
  lastError: string | null;
  upcoming: DailyUpcoming[];
}
export interface DailyChaseParty { dailyChase: DailyChaseState }
export interface DailyStatusReport { realm: string; live: DailyEvent[] }
export interface DailyChasePorts {
  now(): number;
  /** Installed game version; 0 while unknown. */
  gameVersion(): number;
  /** ALData `/monsters/crabxx,rgoo,bgoo,icegolem,franky`: live scheduled-event bosses on any realm. */
  fetchBosses(): Promise<unknown>;
  /** Fresh reports from the party's own characters: their realm and its live scheduled events. */
  reports(): DailyStatusReport[];
  currentRealm(): string | null;
  homeRealm(): string | null;
  /** Connectable non-PVP realm keys. */
  realms(): string[];
  realmSwitchBusy(): boolean;
  /** Another realm errand (e.g. the boss chase) currently owns the party's realm. */
  paused(): boolean;
  selected(event: DailyEvent): boolean;
  switchRealm(realm: string): Promise<{ ok: boolean; error?: string }>;
  log(message: string, level: string): void;
  persist(): void;
}

const eventNames: Record<DailyEvent, string> = {
  crabxx: "Giga Crab", goobrawl: "Goo Brawl", abtesting: "A/B Testing", icegolem: "Ice Golem", franky: "Franky",
};
const modulo = (value: number, length: number) => ((value % length) + length) % length;
export function realmRegion(realm: string): string | null {
  return /^SR_(US|EU|ASIA)/.exec(realm)?.[1] ?? null;
}
/** Index of the most recent slot of a rotation at or before `at` in a region's local time. */
export function dailySlotIndex(region: string, at: number, rotation: Rotation = "daily"): number {
  const hours = rotations[rotation].hours;
  const local = at + (regionOffsets[region] ?? 0) * hourMs;
  const day = Math.floor(local / dayMs);
  const started = hours.filter((hour) => hour * hourMs <= local - day * dayMs).length;
  return day * hours.length + started - 1;
}
export function dailySlotStart(region: string, slot: number, rotation: Rotation = "daily"): number {
  const hours = rotations[rotation].hours;
  const day = Math.floor(slot / hours.length);
  const hour = hours[slot - day * hours.length];
  return day * dayMs + (hour - (regionOffsets[region] ?? 0)) * hourMs;
}

export function initialDailyChase(saved: unknown): DailyChaseState {
  const value = requestObject(saved);
  const lead = Number(value.leadMinutes);
  return {
    enabled: value.enabled === true,
    leadMinutes: Number.isFinite(lead) && lead >= 14 ? lead : 16,
    otherRegions: value.otherRegions === true,
    observations: (requestObject(value.observations) as DailyChaseState["observations"]) || {},
    gameVersion: Number.isSafeInteger(value.gameVersion) ? Number(value.gameVersion) : 0,
    trip: (value.trip as DailyChaseTrip | null | undefined) || null,
    retryAt: 0,
    lastError: null,
    upcoming: [],
  };
}

/** A realm's cycle position in one rotation, from its sightings at distinct residues. */
export function predictDaily(observed: DailyChaseState["observations"][string] | undefined, slot: number, rotation: Rotation = "daily"): DailyEvent | null {
  const events = rotations[rotation].events, length = events.length;
  const known = events.flatMap((event) => observed?.[event] ? [{ event, slot: observed[event]!.slot }] : []);
  const hit = known.find((entry) => modulo(slot - entry.slot, length) === 0);
  if (hit) return hit.event;
  if (known.length < length - 1) return null;
  // With every other event placed at distinct residues, the last one takes the remaining residue.
  return events.find((event) => !known.some((entry) => entry.event === event)) ?? null;
}

function bossEvent(item: Record<string, unknown>): DailyEvent | null {
  if (item.type === "crabxx" || item.type === "icegolem" || item.type === "franky") return item.type;
  return item.map === "goobrawl" ? "goobrawl" : null;
}

export function createDailyChase(party: DailyChaseParty, ports: DailyChasePorts) {
  function observe(realm: string, event: DailyEvent, at: number): void {
    const region = realmRegion(realm), rotation = rotationOf(event);
    if (!region) return;
    const slot = dailySlotIndex(region, at, rotation);
    if (at - dailySlotStart(region, slot, rotation) > eventWindowMs) return;
    const observed = party.dailyChase.observations[realm] || {};
    if (observed[event]?.slot === slot) return;
    // Any inconsistency with the rotation's cycle means the server restarted and reshuffled.
    const events = rotations[rotation].events;
    const restarted = events.some((other) => {
      const prior = observed[other];
      if (!prior) return false;
      const sameResidue = modulo(slot - prior.slot, events.length) === 0;
      return other === event ? !sameResidue : sameResidue;
    });
    const kept = restarted ? Object.fromEntries(Object.entries(observed).filter(([other]) => !(events as readonly string[]).includes(other))) : observed;
    party.dailyChase.observations[realm] = { ...kept, [event]: { slot, at } };
    ports.persist();
  }

  /** A game update restarts every realm, so every learned cycle is void until seen again. */
  function resetOnUpdate(): void {
    const chase = party.dailyChase, version = ports.gameVersion();
    if (!version || version === chase.gameVersion) return;
    if (chase.gameVersion && Object.keys(chase.observations).length) {
      chase.observations = {};
      ports.log("Event prediction: game updated to " + version + "; cleared realm event cycles", "info");
    }
    chase.gameVersion = version;
    ports.persist();
  }

  function pruneObservations(now: number): void {
    for (const [realm, observed] of Object.entries(party.dailyChase.observations)) {
      for (const event of scheduledEvents) if (observed[event] && now - observed[event]!.at > observationMaxAgeMs) delete observed[event];
      if (!Object.keys(observed).length) delete party.dailyChase.observations[realm];
    }
  }

  function inEventWindow(now: number): boolean {
    return rotationNames.some((rotation) => Object.keys(regionOffsets).some((region) =>
      now - dailySlotStart(region, dailySlotIndex(region, now, rotation), rotation) <= eventWindowMs));
  }

  function observeBoss(item: Record<string, unknown>): void {
    const event = bossEvent(item), seen = Date.parse(String(item.lastSeen));
    if (!event || !Number.isFinite(seen) || typeof item.serverRegion !== "string" || typeof item.serverIdentifier !== "string") return;
    observe("SR_" + item.serverRegion + item.serverIdentifier, event, seen);
  }

  async function collect(now: number): Promise<void> {
    for (const report of ports.reports()) for (const event of report.live) observe(report.realm, event, now);
    if (!inEventWindow(now)) return;
    try {
      const value = await ports.fetchBosses();
      if (!Array.isArray(value)) throw new Error("ALData returned an unexpected event boss payload");
      for (const entry of value) observeBoss(requestObject(entry));
      party.dailyChase.lastError = null;
    } catch (error) {
      party.dailyChase.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  function upcoming(now: number): DailyUpcoming[] {
    const realms = ports.realms();
    return rotationNames.flatMap((rotation) => Object.keys(regionOffsets).map((region) => {
      const slot = dailySlotIndex(region, now, rotation) + 1;
      const predictions = realms.filter((realm) => realmRegion(realm) === region).flatMap((realm) => {
        const event = predictDaily(party.dailyChase.observations[realm], slot, rotation);
        return event ? [{ realm, event }] : [];
      });
      return { rotation, region, slotAt: dailySlotStart(region, slot, rotation), predictions };
    })).sort((a, b) => a.slotAt - b.slotAt);
  }

  /** The current realm is known to miss every wanted event of this rotation at this slot. */
  function homeMisses(current: string, slot: number, rotation: Rotation, wanted: DailyEvent[]): boolean {
    const observed = party.dailyChase.observations[current], length = rotations[rotation].events.length;
    const predicted = predictDaily(observed, slot, rotation);
    if (predicted) return !wanted.includes(predicted);
    return wanted.every((event) => observed?.[event] && modulo(slot - observed[event]!.slot, length) !== 0);
  }

  function candidate(current: string, now: number, wanted: DailyEvent[]): { rotation: Rotation; realm: string; event: DailyEvent; slot: number; slotAt: number } | null {
    const chase = party.dailyChase, homeRegion = realmRegion(current);
    const leadMs = chase.leadMinutes * 60_000, minLeadMs = sicknessMs + 60_000;
    for (const next of upcoming(now)) {
      const until = next.slotAt - now;
      const wantedHere = wanted.filter((event) => rotationOf(event) === next.rotation);
      if (until < minLeadMs || until > leadMs || !wantedHere.length) continue;
      const slot = dailySlotIndex(next.region, next.slotAt, next.rotation);
      if (next.region === homeRegion ? !homeMisses(current, slot, next.rotation, wantedHere) : !chase.otherRegions) continue;
      const pick = next.predictions.find((entry) => entry.realm !== current && wantedHere.includes(entry.event));
      if (pick) return { ...pick, rotation: next.rotation, slot, slotAt: next.slotAt };
    }
    return null;
  }

  async function travel(realm: string): Promise<boolean> {
    const result = await ports.switchRealm(realm);
    if (result.ok) return true;
    party.dailyChase.lastError = result.error || "Realm switch was refused";
    party.dailyChase.retryAt = ports.now() + retryDelayMs;
    ports.log("Event prediction: could not switch to " + realm + ": " + party.dailyChase.lastError, "warn");
    return false;
  }

  async function startTrip(now: number): Promise<void> {
    const chase = party.dailyChase, current = ports.currentRealm();
    if (now < chase.retryAt || !current || ports.paused()) return;
    const wanted = scheduledEvents.filter((event) => ports.selected(event));
    if (!wanted.length) return;
    const target = candidate(current, now, wanted);
    if (!target) return;
    chase.trip = { ...target, returnRealm: ports.homeRealm() || current, startedAt: now, arrived: false, quietChecks: 0 };
    ports.persist();
    ports.log("Event prediction: " + eventNames[target.event] + " predicted on " + target.realm + " at " + new Date(target.slotAt).toISOString() + "; moving the party", "info");
    if (!(await travel(target.realm))) { chase.trip = null; ports.persist(); }
  }

  async function finishTrip(trip: DailyChaseTrip, current: string, reason: string): Promise<void> {
    party.dailyChase.trip = null;
    ports.persist();
    if (!trip.returnRealm || trip.returnRealm === current) return;
    ports.log("Event prediction: " + reason + "; returning home", "info");
    await travel(trip.returnRealm);
  }

  async function followTrip(trip: DailyChaseTrip, now: number): Promise<void> {
    const current = ports.currentRealm();
    if (current !== trip.realm) {
      // The switch failed, or the party was moved elsewhere by hand.
      if (trip.arrived || now > trip.slotAt) {
        ports.log("Event prediction: party is no longer on " + trip.realm + "; ending the chase", "info");
        party.dailyChase.trip = null;
        ports.persist();
      }
      return;
    }
    trip.arrived = true;
    if (now < trip.slotAt + 5 * 60_000) return ports.persist();
    const live = ports.reports().some((report) => report.realm === trip.realm && report.live.includes(trip.event));
    trip.quietChecks = live ? 0 : trip.quietChecks + 1;
    ports.persist();
    if (trip.quietChecks >= returnQuietChecks) return finishTrip(trip, current, eventNames[trip.event] + " is over on " + trip.realm);
    if (now > trip.slotAt + eventWindowMs) return finishTrip(trip, current, eventNames[trip.event] + " window elapsed on " + trip.realm);
  }

  async function tick(): Promise<void> {
    const now = ports.now(), chase = party.dailyChase;
    resetOnUpdate();
    pruneObservations(now);
    await collect(now);
    chase.upcoming = upcoming(now);
    if (!chase.enabled) {
      if (chase.trip) { chase.trip = null; ports.persist(); }
      return;
    }
    if (ports.realmSwitchBusy()) return;
    if (chase.trip) await followTrip(chase.trip, now);
    else await startTrip(now);
  }

  let running = false;
  function start(every: (callback: () => unknown, milliseconds: number) => unknown): void {
    every(() => {
      if (running) return;
      running = true;
      void tick().finally(() => { running = false; });
    }, 60_000);
  }

  function update(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), chase = party.dailyChase;
    if (body.enabled !== undefined) chase.enabled = body.enabled === true;
    if (body.otherRegions !== undefined) chase.otherRegions = body.otherRegions === true;
    if (body.leadMinutes !== undefined) {
      const lead = Number(body.leadMinutes);
      if (!Number.isFinite(lead) || lead < 14 || lead > 120)
        return res.status(400).json({ error: "leadMinutes must be between 14 and 120" });
      chase.leadMinutes = lead;
    }
    if (!chase.enabled) chase.trip = null;
    ports.log("Event prediction " + (chase.enabled ? "enabled (" + chase.leadMinutes + " min lead" + (chase.otherRegions ? ", other regions" : "") + ")" : "disabled"), "info");
    ports.persist();
    return res.json({ ok: true, dailyChase: chase });
  }

  return { tick, start, update };
}
