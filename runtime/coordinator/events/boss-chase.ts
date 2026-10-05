import { requestObject, type HttpRequest, type HttpResponse } from "../http/contracts.ts";

/**
 * Moves the whole party to a realm where ALData reports a live event boss (Franky, Ice Golem,
 * Giga Crab, and the seasonal world bosses) when none is live on the current realm, then returns home once that boss is gone. These
 * can take long enough to kill that a hop is still worthwhile after Hop Sickness (12 minutes of -80%
 * luck/xp/gold): only chase one whose estimated remaining lifetime, from its observed HP drain,
 * exceeds `minEtaMinutes`. Respawning seasonal bosses are also chased ahead of time: ALData reports a
 * dead one's `estimatedRespawn`, so the party can arrive before the spawn with Hop Sickness cleared.
 */
// Giga Crab (960k HP) usually dies well inside Hop Sickness; the ETA gate only lets slow fights through.
// Seasonal bosses (24M-36M HP) only exist while their season runs.
export const chasedBosses = ["franky", "icegolem", "crabxx", "mrpumpkin", "mrgreen", "dragold", "grinch"] as const;
export type ChasedBoss = (typeof chasedBosses)[number];
/** The event a character selects (a G.events key) to opt into chasing each boss. */
export const chasedBossEvents: Record<ChasedBoss, string> = {
  franky: "franky", icegolem: "icegolem", crabxx: "crabxx",
  mrpumpkin: "halloween", mrgreen: "halloween", dragold: "lunarnewyear", grinch: "holidayseason",
};

export interface BossChaseTrip {
  boss: ChasedBoss;
  realm: string;
  /** Set for a trip made ahead of an ALData-estimated respawn; the boss isn't live yet. */
  respawnAt?: number;
  returnRealm: string | null;
  bossId: string;
  startedAt: number;
  arrived: boolean;
  missingPolls: number;
  /** When the chased boss was first seen live with the party on its realm. */
  liveSince?: number;
}
export interface BossChaseSighting {
  boss: ChasedBoss;
  realm: string;
  hp: number;
  etaMinutes: number | null;
  target: string | null;
}
export interface BossChaseRespawn { boss: ChasedBoss; realm: string; respawnAt: number }
export interface BossChaseState {
  enabled: boolean;
  minEtaMinutes: number;
  trip: BossChaseTrip | null;
  retryAt: number;
  lastError: string | null;
  checkedAt: number;
  sightings: BossChaseSighting[];
  respawns: BossChaseRespawn[];
}
export interface BossChaseParty {
  bossChase: BossChaseState;
}
export interface BossChasePorts {
  now(): number;
  /** ALData `/monsters/<a,b,...>`: every instance of these types currently observed on any realm. */
  fetchLive(bosses: readonly ChasedBoss[]): Promise<unknown>;
  /** The party's shared realm, or null while split/unknown. */
  currentRealm(): string | null;
  homeRealm(): string | null;
  realmExists(realm: string): boolean;
  realmSwitchBusy(): boolean;
  /** Another realm errand (e.g. the daily chase) currently owns the party's realm. */
  paused(): boolean;
  /** Whether any active character has this event (a G.events key) selected. */
  selected(event: string): boolean;
  /** Starts the ordinary party realm switch (no home change); resolves with its HTTP outcome. */
  switchRealm(realm: string): Promise<{ ok: boolean; error?: string }>;
  log(message: string, level: string): void;
  persist(): void;
}

export const defaultBossChaseMinEtaMinutes = 15;
const bossNames: Record<ChasedBoss, string> = {
  franky: "Franky", icegolem: "Ice Golem", crabxx: "Giga Crab",
  mrpumpkin: "Mr. Pumpkin", mrgreen: "Mr. Green", dragold: "Dragold", grinch: "Grinch",
};
const pollMs = 60_000;
const staleSightingMs = 5 * 60_000;
const rateWindowMs = 10 * 60_000;
const minRateSpanMs = 50_000;
const retryDelayMs = 5 * 60_000;
// Two consecutive polls without the chased boss (ALData can briefly miss an entity).
const goneAfterMissingPolls = 2;
// Respawn trips leave 13-16 minutes ahead (Hop Sickness plus travel), and wait out a late estimate.
const respawnMinLeadMs = 13 * 60_000, respawnMaxLeadMs = 16 * 60_000, respawnGraceMs = 10 * 60_000;
// A boss respawning on the current realm this soon is worth waiting for rather than hopping.
const homeRespawnHorizonMs = 30 * 60_000;
// A boss here that won't die within this long (e.g. an untouched 120M HP Franky) doesn't hold the party.
const stalledEtaMinutes = 120;
// A trip judges its fight only after the party has had this long to engage.
const engageGraceMs = 5 * 60_000;
const respawningBosses: readonly ChasedBoss[] = ["mrpumpkin", "mrgreen", "dragold", "grinch"];

export function initialBossChase(saved: unknown): BossChaseState {
  const value = requestObject(saved);
  const minEta = Number(value.minEtaMinutes);
  return {
    enabled: value.enabled === true,
    minEtaMinutes: Number.isFinite(minEta) && minEta >= 0 ? minEta : defaultBossChaseMinEtaMinutes,
    trip: (value.trip as BossChaseTrip | null | undefined) || null,
    retryAt: 0,
    lastError: null,
    checkedAt: 0,
    sightings: [],
    respawns: [],
  };
}

interface LiveBoss { boss: ChasedBoss; id: string; realm: string; hp: number; target: string | null }
function realmOf(item: Record<string, unknown>): string | null {
  return typeof item.serverRegion === "string" && typeof item.serverIdentifier === "string"
    ? "SR_" + item.serverRegion + item.serverIdentifier : null;
}
/** Dead respawning bosses ALData expects back soon (it omits hp and reports `estimatedRespawn`). */
function parseRespawns(bosses: readonly ChasedBoss[], value: unknown, now: number): BossChaseRespawn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = requestObject(entry), at = Date.parse(String(item.estimatedRespawn)), realm = realmOf(item);
    const boss = bosses.find((type) => type === item.type && respawningBosses.includes(type));
    return boss && realm && Number.isFinite(at) && at > now - respawnGraceMs ? [{ boss, realm, respawnAt: at }] : [];
  });
}
function parseLive(bosses: readonly ChasedBoss[], value: unknown, now: number): LiveBoss[] {
  if (!Array.isArray(value)) throw new Error("ALData returned an unexpected boss payload");
  return value.flatMap((entry) => {
    const item = requestObject(entry);
    const seen = Date.parse(String(item.lastSeen));
    const hp = Number(item.hp);
    const boss = bosses.find((type) => type === item.type);
    // Dead respawning bosses come back with `estimatedRespawn` and no hp; they aren't live.
    if (!boss || !(hp > 0) || !Number.isFinite(seen) || now - seen > staleSightingMs) return [];
    if (typeof item.serverRegion !== "string" || typeof item.serverIdentifier !== "string") return [];
    return [{
      boss,
      id: String(item.id),
      realm: "SR_" + item.serverRegion + item.serverIdentifier,
      hp,
      target: typeof item.target === "string" ? item.target : null,
    }];
  });
}

export function createBossChase(party: BossChaseParty, ports: BossChasePorts) {
  const samples = new Map<string, { at: number; hp: number }[]>();
  const key = (boss: LiveBoss) => boss.boss + ":" + boss.id;

  function record(live: LiveBoss[], now: number): void {
    const keys = new Set(live.map(key));
    for (const id of samples.keys()) if (!keys.has(id)) samples.delete(id);
    for (const boss of live) {
      const history = (samples.get(key(boss)) || []).filter((sample) => now - sample.at <= rateWindowMs);
      history.push({ at: now, hp: boss.hp });
      samples.set(key(boss), history);
    }
  }
  /** Minutes until death at the observed drain; null until two samples span long enough. */
  function etaMinutes(boss: LiveBoss, since = -Infinity): number | null {
    const history = (samples.get(key(boss)) || []).filter((sample) => sample.at >= since);
    const first = history[0], last = history[history.length - 1];
    if (!first || !last || last.at - first.at < minRateSpanMs) return null;
    const rate = (first.hp - last.hp) / (last.at - first.at);
    return rate > 0 ? boss.hp / rate / 60_000 : null;
  }
  /** Observed long enough to show it isn't draining, or won't die within `stalledEtaMinutes`. */
  function stalled(boss: LiveBoss, since = -Infinity): boolean {
    const history = (samples.get(key(boss)) || []).filter((sample) => sample.at >= since);
    const first = history[0], last = history[history.length - 1];
    if (!first || !last || last.at - first.at < minRateSpanMs) return false;
    const eta = etaMinutes(boss, since);
    return eta === null || eta > stalledEtaMinutes;
  }
  // Bosses the party just left as unwinnable. Their samples still span our own
  // failed fight, so they wait one rate window before they can be chosen again.
  const left = new Map<string, number>();
  function recentlyLeft(boss: LiveBoss, now: number): boolean {
    const at = left.get(key(boss));
    return at !== undefined && now - at < rateWindowMs;
  }

  async function travel(realm: string): Promise<boolean> {
    const result = await ports.switchRealm(realm);
    if (result.ok) return true;
    party.bossChase.lastError = result.error || "Realm switch was refused";
    party.bossChase.retryAt = ports.now() + retryDelayMs;
    ports.log("Boss chase: could not switch to " + realm + ": " + party.bossChase.lastError, "warn");
    return false;
  }

  async function followTrip(trip: BossChaseTrip, live: LiveBoss[]): Promise<void> {
    const chase = party.bossChase;
    const current = ports.currentRealm();
    if (current !== trip.realm) {
      // Arrival never happened (failed switch) or the party was moved elsewhere by hand.
      if (trip.arrived || ports.now() - trip.startedAt > 5 * 60_000) {
        ports.log("Boss chase: party is no longer on " + trip.realm + "; ending the chase", "info");
        chase.trip = null;
        ports.persist();
      }
      return;
    }
    trip.arrived = true;
    const chased = live.find((boss) => boss.boss === trip.boss && boss.realm === trip.realm);
    if (chased) return followLiveBoss(trip, chased);
    // Waiting ahead of a respawn: the boss isn't expected yet, so its absence means nothing.
    if (trip.respawnAt && ports.now() < trip.respawnAt + respawnGraceMs) return ports.persist();
    if (++trip.missingPolls < goneAfterMissingPolls) return ports.persist();
    chase.trip = null;
    ports.persist();
    const home = trip.returnRealm;
    if (!home || home === current) return;
    ports.log("Boss chase: " + bossNames[trip.boss] + " is gone from " + trip.realm + "; returning home", "info");
    await travel(home);
  }

  /**
   * Stay while the fight is winnable. Once the boss has been live with the party here
   * for `engageGraceMs`, an ETK over `stalledEtaMinutes` from samples since then
   * (the party's own damage included) means nobody here can kill it: go home.
   */
  async function followLiveBoss(trip: BossChaseTrip, boss: LiveBoss): Promise<void> {
    const now = ports.now();
    trip.missingPolls = 0;
    delete trip.respawnAt;
    trip.liveSince ??= now;
    if (now - trip.liveSince < engageGraceMs || !stalled(boss, trip.liveSince)) return ports.persist();
    party.bossChase.trip = null;
    left.set(key(boss), now);
    ports.persist();
    const eta = etaMinutes(boss, trip.liveSince);
    ports.log("Boss chase: " + bossNames[boss.boss] + " on " + trip.realm + " won't die in time (" +
      (eta === null ? "no HP drain" : "~" + Math.round(eta) + " min left") + "); leaving it", "info");
    const home = trip.returnRealm;
    if (home && home !== trip.realm) await travel(home);
  }

  function pick(live: LiveBoss[], current: string): (LiveBoss & { eta: number }) | null {
    const minEta = party.bossChase.minEtaMinutes, now = ports.now();
    return live
      .filter((boss) => boss.realm !== current && !boss.realm.endsWith("PVP") && ports.realmExists(boss.realm))
      .filter((boss) => !recentlyLeft(boss, now))
      .map((boss) => ({ ...boss, eta: etaMinutes(boss) }))
      // Worth the hop: long enough to outlast Hop Sickness, short enough that it will actually die.
      .filter((boss): boss is LiveBoss & { eta: number } => boss.eta !== null && boss.eta >= minEta && boss.eta <= stalledEtaMinutes)
      .sort((a, b) => b.eta - a.eta)[0] || null;
  }

  async function observe(bosses: ChasedBoss[], now: number): Promise<LiveBoss[] | null> {
    const chase = party.bossChase;
    try {
      const value = await ports.fetchLive(bosses);
      const live = parseLive(bosses, value, now);
      chase.respawns = parseRespawns(bosses, value, now);
      record(live, now);
      chase.checkedAt = now;
      chase.lastError = null;
      chase.sightings = live.map((boss) => ({ boss: boss.boss, realm: boss.realm, hp: boss.hp, etaMinutes: etaMinutes(boss), target: boss.target }));
      return live;
    } catch (error) {
      chase.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  /** The soonest respawn elsewhere that leaves enough time for Hop Sickness to clear before it. */
  function pickRespawn(current: string, now: number): BossChaseRespawn | null {
    return party.bossChase.respawns
      .filter((entry) => entry.realm !== current && !entry.realm.endsWith("PVP") && ports.realmExists(entry.realm))
      .filter((entry) => entry.respawnAt - now >= respawnMinLeadMs && entry.respawnAt - now <= respawnMaxLeadMs)
      .sort((a, b) => a.respawnAt - b.respawnAt)[0] || null;
  }

  async function startRespawnTrip(current: string, now: number): Promise<void> {
    const chase = party.bossChase, target = pickRespawn(current, now);
    if (!target) return;
    chase.trip = {
      boss: target.boss, realm: target.realm, respawnAt: target.respawnAt, returnRealm: ports.homeRealm() || current,
      bossId: "", startedAt: now, arrived: false, missingPolls: 0,
    };
    ports.persist();
    ports.log("Boss chase: " + bossNames[target.boss] + " respawns on " + target.realm + " at " + new Date(target.respawnAt).toISOString() + "; moving the party ahead of it", "info");
    if (!(await travel(target.realm))) { chase.trip = null; ports.persist(); }
  }

  /** Any wanted boss being killed here, or about to respawn here, beats hopping for another. */
  function holdsParty(local: LiveBoss[], current: string, now: number): boolean {
    return local.some((boss) => !stalled(boss))
      || party.bossChase.respawns.some((entry) => entry.realm === current && entry.respawnAt - now <= homeRespawnHorizonMs);
  }

  async function startTrip(live: LiveBoss[], now: number): Promise<void> {
    const chase = party.bossChase;
    const current = ports.currentRealm();
    if (now < chase.retryAt || !current || ports.paused()) return;
    const local = live.filter((boss) => boss.realm === current);
    if (holdsParty(local, current, now)) return;
    const target = pick(live, current);
    if (!target) return local.length ? undefined : startRespawnTrip(current, now);
    chase.trip = {
      boss: target.boss,
      realm: target.realm,
      returnRealm: ports.homeRealm() || current,
      bossId: target.id,
      startedAt: now,
      arrived: false,
      missingPolls: 0,
    };
    ports.persist();
    const leaving = local.length ? "; leaving stalled " + local.map((boss) => bossNames[boss.boss]).join(", ") + " on " + current : "";
    ports.log("Boss chase: " + bossNames[target.boss] + " live on " + target.realm + " (~" + Math.round(target.eta) + " min left" + leaving + "); moving the party", "info");
    if (!(await travel(target.realm))) { chase.trip = null; ports.persist(); }
  }

  async function tick(): Promise<void> {
    const chase = party.bossChase;
    if (!chase.enabled) {
      if (chase.trip) { chase.trip = null; ports.persist(); }
      return;
    }
    if (ports.realmSwitchBusy()) return;
    // Keep watching the chased boss even if its selection changes mid-trip.
    const bosses = chasedBosses.filter((boss) => ports.selected(chasedBossEvents[boss]) || chase.trip?.boss === boss);
    if (!bosses.length) { chase.sightings = []; chase.respawns = []; return; }
    const now = ports.now();
    const live = await observe(bosses, now);
    if (!live) return;
    if (chase.trip) await followTrip(chase.trip, live);
    else await startTrip(live, now);
  }

  let running = false;
  function start(every: (callback: () => unknown, milliseconds: number) => unknown): void {
    every(() => {
      if (running) return;
      running = true;
      void tick().finally(() => { running = false; });
    }, pollMs);
  }

  function update(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), chase = party.bossChase;
    if (body.enabled !== undefined) chase.enabled = body.enabled === true;
    if (body.minEtaMinutes !== undefined) {
      const minEta = Number(body.minEtaMinutes);
      if (!Number.isFinite(minEta) || minEta < 0 || minEta > 600)
        return res.status(400).json({ error: "minEtaMinutes must be between 0 and 600" });
      chase.minEtaMinutes = minEta;
    }
    if (!chase.enabled) chase.trip = null;
    ports.log("Boss chase " + (chase.enabled ? "enabled (min " + chase.minEtaMinutes + " min left)" : "disabled"), "info");
    ports.persist();
    return res.json({ ok: true, bossChase: chase });
  }

  return { tick, start, update };
}
