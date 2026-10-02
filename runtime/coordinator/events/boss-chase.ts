import { requestObject, type HttpRequest, type HttpResponse } from "../http/contracts.ts";

/**
 * Moves the whole party to a realm where ALData reports a live long-lived event boss (Franky, Ice
 * Golem) when none is live on the current realm, then returns home once that boss is gone. These
 * take long enough to kill that a hop is still worthwhile after Hop Sickness (12 minutes of -80%
 * luck/xp/gold): only chase one whose estimated remaining lifetime, from its observed HP drain,
 * exceeds `minEtaMinutes`.
 */
export const chasedBosses = ["franky", "icegolem"] as const;
export type ChasedBoss = (typeof chasedBosses)[number];

export interface BossChaseTrip {
  boss: ChasedBoss;
  realm: string;
  returnRealm: string | null;
  bossId: string;
  startedAt: number;
  arrived: boolean;
  missingPolls: number;
}
export interface BossChaseSighting {
  boss: ChasedBoss;
  realm: string;
  hp: number;
  etaMinutes: number | null;
  target: string | null;
}
export interface BossChaseState {
  enabled: boolean;
  minEtaMinutes: number;
  trip: BossChaseTrip | null;
  retryAt: number;
  lastError: string | null;
  checkedAt: number;
  sightings: BossChaseSighting[];
}
export interface BossChaseParty {
  bossChase: BossChaseState;
}
export interface BossChasePorts {
  now(): number;
  /** ALData `/monsters/<boss>`: every instance currently observed on any realm. */
  fetchLive(boss: ChasedBoss): Promise<unknown>;
  /** The party's shared realm, or null while split/unknown. */
  currentRealm(): string | null;
  homeRealm(): string | null;
  realmExists(realm: string): boolean;
  realmSwitchBusy(): boolean;
  /** Whether any active character has this boss's event selected. */
  selected(boss: ChasedBoss): boolean;
  /** Starts the ordinary party realm switch (no home change); resolves with its HTTP outcome. */
  switchRealm(realm: string): Promise<{ ok: boolean; error?: string }>;
  log(message: string, level: string): void;
  persist(): void;
}

export const defaultBossChaseMinEtaMinutes = 15;
const bossNames: Record<ChasedBoss, string> = { franky: "Franky", icegolem: "Ice Golem" };
const pollMs = 60_000;
const staleSightingMs = 5 * 60_000;
const rateWindowMs = 10 * 60_000;
const minRateSpanMs = 50_000;
const retryDelayMs = 5 * 60_000;
// Two consecutive polls without the chased boss (ALData can briefly miss an entity).
const goneAfterMissingPolls = 2;

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
  };
}

interface LiveBoss { boss: ChasedBoss; id: string; realm: string; hp: number; target: string | null }
function parseLive(boss: ChasedBoss, value: unknown, now: number): LiveBoss[] {
  if (!Array.isArray(value)) throw new Error("ALData returned an unexpected " + bossNames[boss] + " payload");
  return value.flatMap((entry) => {
    const item = requestObject(entry);
    const seen = Date.parse(String(item.lastSeen));
    const hp = Number(item.hp);
    if (item.type !== boss || !(hp > 0) || !Number.isFinite(seen) || now - seen > staleSightingMs) return [];
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
  function etaMinutes(boss: LiveBoss): number | null {
    const history = samples.get(key(boss)) || [];
    const first = history[0], last = history[history.length - 1];
    if (!first || !last || last.at - first.at < minRateSpanMs) return null;
    const rate = (first.hp - last.hp) / (last.at - first.at);
    return rate > 0 ? boss.hp / rate / 60_000 : null;
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
    if (live.some((boss) => boss.boss === trip.boss && boss.realm === trip.realm)) {
      trip.missingPolls = 0;
      ports.persist();
      return;
    }
    if (++trip.missingPolls < goneAfterMissingPolls) return ports.persist();
    chase.trip = null;
    ports.persist();
    const home = trip.returnRealm;
    if (!home || home === current) return;
    ports.log("Boss chase: " + bossNames[trip.boss] + " is gone from " + trip.realm + "; returning home", "info");
    await travel(home);
  }

  function pick(live: LiveBoss[], current: string): (LiveBoss & { eta: number }) | null {
    const minEta = party.bossChase.minEtaMinutes;
    return live
      .filter((boss) => boss.realm !== current && !boss.realm.endsWith("PVP") && ports.realmExists(boss.realm))
      .map((boss) => ({ ...boss, eta: etaMinutes(boss) }))
      .filter((boss): boss is LiveBoss & { eta: number } => boss.eta !== null && boss.eta >= minEta)
      .sort((a, b) => b.eta - a.eta)[0] || null;
  }

  async function observe(bosses: ChasedBoss[], now: number): Promise<LiveBoss[] | null> {
    const chase = party.bossChase;
    try {
      const live = (await Promise.all(bosses.map(async (boss) => parseLive(boss, await ports.fetchLive(boss), now)))).flat();
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

  async function startTrip(live: LiveBoss[], now: number): Promise<void> {
    const chase = party.bossChase;
    const current = ports.currentRealm();
    if (now < chase.retryAt || !current) return;
    // Any wanted boss already live here beats hopping for another.
    if (live.some((boss) => boss.realm === current)) return;
    const target = pick(live, current);
    if (!target) return;
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
    ports.log("Boss chase: " + bossNames[target.boss] + " live on " + target.realm + " (~" + Math.round(target.eta) + " min left); moving the party", "info");
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
    const bosses = chasedBosses.filter((boss) => ports.selected(boss) || chase.trip?.boss === boss);
    if (!bosses.length) { chase.sightings = []; return; }
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
