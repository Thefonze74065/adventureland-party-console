import { refreshRareApproach } from './rare-progress.ts';
import { migratePassiveSettings, applyPassivePatch, committedPassiveRules, validPassivePatch, passiveLevelAllowed } from "./passive-settings.ts";
import { interruptibleTravel } from '../../combat/hunt-travel.ts';
import { createRareRetryEvidence } from './rare-retry-evidence.ts';
// Rare encounters own temporary travel; the saved farming intent remains authoritative.
import * as zones from "../../../dashboard/lib/farming-zones.ts";
import type {
  Catalog,
  Checkpoint,
  Point,
  Owner,
  Sight,
  Encounter,
  Patrol,
  Party,
  Status,
  Hooks,
} from "./rare-types.ts";
import createRareReturn from "../../../scripts/rare-farming-return.cjs";
import createRareCombat from "../../../scripts/rare-combat.cjs";
import {
  newPatrol,
  pauseSearch,
  patrolCheckpoint,
  searchControlId,
  searchDestination,
  stepSearch,
} from "./phoenix-patrol.ts";
export { scanPoints } from "./phoenix-patrol.ts";
const PRIORITY: Record<string, number> = {
  tinyp: 101,
  phoenix: 100,
  goldenbat: 100,
  cutebee: 100,
  hen: 100,
  rooster: 100,
};
const NAMES: Record<string, string> = {
  tinyp: "Fairy",
  phoenix: "Phoenix",
  goldenbat: "Golden Bat",
  cutebee: "Cute Bee",
  hen: "Hen",
  rooster: "Rooster",
};
const FRESH = 3000;
/** Every fighter within this distance of the Phoenix counts as gathered. */
const GATHER_RANGE = 300;
/** Converging tolerates brief gaps while the spotter re-acquires the Phoenix. */
const CONVERGE_LOST = 10000;
/** Lower bound for waiting on slow, possibly cross-map, convergence. */
const GATHER_MINIMUM = 300000;
/** Map changes can delay a leader heartbeat; split searchers do not depend on it. */
const SEARCH_LEADER_GRACE = 10000;
export const realm = (s?: { region?: string; server?: string }) =>
  `${s?.region || ""}:${s?.server || ""}`;
const instance = (s?: { in?: string | number; map?: string }) => String(s?.in ?? s?.map ?? "");
export const key = (s: { realm: string; map?: string; in?: string | number; id: string }) =>
  `${s.realm}|${s.map}|${s.in}|${s.id}`;
const distance = (a: Point, b: Point) =>
  a?.map === b?.map ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
export function regions(catalog: Catalog | null | undefined) {
  return zones.zones(catalog || [], ["phoenix"]);
}
export function validateOrder(
  catalog: Catalog | null | undefined,
  order: unknown,
): order is string[] {
  const all = regions(catalog);
  return (
    all.length === 5 &&
    Array.isArray(order) &&
    order.length === 5 &&
    new Set(order).size === 5 &&
    order.every((id) => all.some((a) => a.id === id))
  );
}
export function createRareHunting(input: unknown, hooks: Hooks) {
  const party = input as Party;
  const now = hooks.now || Date.now;
  const sightings = new Map<string, Sight>(),
    cooldowns = new Map<string, number>(),
    kills = new Map<string, number>();
  let encounter: Encounter | null = null,
    patrol: Patrol | null = null,
    serial = 0,
    lastMessage: string | null = null;
  const farmingReturn = createRareReturn(party, { ...hooks, realm });
  const retryStores = new WeakMap<NonNullable<Party['rareRetryEvidence']>, ReturnType<typeof createRareRetryEvidence>>();
  function retryEvidence() {
    // Farming scopes change this dictionary when the selected leader changes.
    const saved = party.rareRetryEvidence ||= {};
    let store = retryStores.get(saved);
    if (!store) { store = createRareRetryEvidence(saved); retryStores.set(saved, store); }
    return store;
  }
  retryEvidence();
  const combat = createRareCombat(party, members, realm);
  for (const failed of Object.values(party.rareRetryEvidence || {})) combat.release(failed.sight, Number.MAX_SAFE_INTEGER, now());
  const diagnostics = new Map<string, number>();
  function diagnostic(message: string, detail: {id?: string; [key: string]: unknown}) {
    const id = message + ':' + (detail.id || '');
    if (now() - (diagnostics.get(id) || 0) < 3000) return;
    if (diagnostics.size > 100) diagnostics.clear();
    diagnostics.set(id, now());
    const entries = ((party.combatLogs ||= {})[party.leader] ||= []);
    entries.push({at:now(),type:'navigation',message,details:detail});
    if (entries.length > 200) entries.splice(0,entries.length - 200);
  }
  party.passiveHunting = migratePassiveSettings(party.passiveHunting,party.passiveRareHunts);
  party.passiveRareHunts = committedPassiveRules(party.passiveHunting);
  function passiveName(id: string) { return NAMES[id] || id; }
  function passivePriority(id: string) { return party.passiveHunting?.rules[id]?.priority ?? PRIORITY[id] ?? 100; }
  function known(id: string) { return id !== 'fieldgen0' && (Object.hasOwn(PRIORITY,id) || !!party.passiveHunting?.rules[id]?.enabled); }
  party.phoenixRouteOrder ||= [];
  party.monsterFocus = (party.monsterFocus || []).filter((id) => id !== "tinyp");
  for (const name of Object.keys(party.monsterFocusByCharacter || {}))
    party.monsterFocusByCharacter![name] = party.monsterFocusByCharacter![name].filter(
      (id) => id !== "tinyp",
    );
  function members() {
    return hooks.members();
  }
  function leader() {
    return party.statuses[party.leader];
  }
  function commandProtected(name: string) {
    const c = party.commands[name];
    if (!c) return false;
    if (!["party-monster-travel", "event-resume-travel"].includes(c.type || "")) return true;
    return (
      !!c.purpose &&
      ![
        "monster-hunt",
        "rare-hunt",
        "phoenix-patrol",
        "farm-relocation",
        "manual-monster-override",
        "empty-spawn-recovery",
      ].includes(c.purpose)
    );
  }
  function memberProtected(name: string) {
    return !!memberProtection(name);
  }
  function memberProtection(name: string): string | null {
    const s = party.statuses[name];
    const reason = s ? statusProtection(s) : null;
    if (reason || !commandProtected(name)) return reason;
    const c = party.commands[name]!;
    return `command ${c.type || "?"}/${c.purpose || "-"}`;
  }
  function statusProtection(s: Status): string | null {
    if (s.joinedEvent || s.movement?.event || s.eventTraveling) return "event";
    if (s.rip) return "dead";
    return Number(s.max_hp) > 0 && Number(s.hp) / Number(s.max_hp) < 0.35 ? "low HP" : null;
  }
  function recoveryProtected() {
    if (eventProtected()) return true;
    if (party.combatRecovery && !["complete", "cancelled"].includes(party.combatRecovery.phase))
      return true;
    if (party.monsterHunt?.loot && !party.monsterHunt.loot.complete) return true;
    return !!party.escape && party.escape.stage !== "released";
  }
  function eventProtected(): boolean {
    if (party.eventReturn) return true;
    const cycle=party.anniversary?.eventCycle;
    return !!cycle && !cycle.returnCompletedAt && !cycle.supersededAt && !cycle.combatHandoffAt;
  }
  function protectedActivity(): boolean {
    const lead = leader();
    if (!lead || lead.seenAt < now() - FRESH || lead.rip) return true;
    return (
      !!party.townCycle || recoveryProtected() || hooks.turnIn() || members().some(memberProtected)
    );
  }
  /**
   * Split searchers are independent: one fighter's command, low HP, event, or a
   * leader heartbeat gap during a map change must not pause the others.
   */
  function searchPaused(): string | null {
    const lead = leader();
    if (!lead || lead.seenAt < now() - SEARCH_LEADER_GRACE) return "leader missing";
    if (party.townCycle) return "town";
    if (recoveryProtected()) return "recovery, escape, or event";
    return hooks.turnIn() ? "Hunt turn-in" : null;
  }
  function splitSearch(): boolean {
    return !!patrol && !encounter;
  }
  function blocked(): boolean {
    return splitSearch() ? !!searchPaused() : protectedActivity();
  }
  function validIntent(owner: Owner) {
    return !intentChange(owner);
  }
  /**
   * "navigation": the user (or another owner) gave new orders. "realm": only the
   * leader's realm differs, e.g. boss chase hopped servers; a patrol waits that out.
   */
  function intentChange(owner: Owner): "navigation" | "realm" | null {
    const same =
      owner.leader === party.leader &&
      owner.focus === JSON.stringify(party.monsterFocus) &&
      owner.policy === party.farmingPolicy &&
      Object.entries(owner.revisions).every(
        ([n, revision]) => !hooks.intent(n).cancelled && hooks.intent(n).revision === revision,
      );
    if (!same) return "navigation";
    const lead = leader();
    return lead && lead.seenAt >= now() - FRESH && owner.realm !== realm(lead) ? "realm" : null;
  }
  function capture() {
    return {
      leader: party.leader,
      realm: realm(leader()),
      focus: JSON.stringify(party.monsterFocus),
      policy: party.farmingPolicy,
      revisions: Object.fromEntries(members().map((n) => [n, hooks.intent(n).revision])),
    };
  }
  function cancelTravel() {
    if (["rare-hunt", "phoenix-patrol"].includes(party.activeConvoy?.purpose || ""))
      hooks.cancelConvoy();
  }
  function publish(message?: string) {
    rememberPursuit();
    if (message) lastMessage = message;
    party.rareHuntState = {
      encounter: encounter && {
        id: encounter.id,
        revisions: encounter.revisions,
        mtype: encounter.target.mtype,
        stage: encounter.stage,
        generator: encounter.generator,
        message: encounter.message,
        gatherDeadline: encounter.gatherDeadline,
        gatheredAt: encounter.gatheredAt,
        gatheredWithout: encounter.gatheredWithout,
        targetId: encounter.target.id,
      },
      patrol: patrol && {
        active: true,
        paused: !!patrol.paused,
        stage: patrol.stage,
        message: patrol.message,
        cycle: patrol.cycle,
        covered: Object.keys(patrol.covered),
        incomplete: patrol.incomplete,
        searchers: Object.fromEntries(Object.entries(patrol.searchers).map(([name, s]) =>
          [name, { regionId: s.regionId, waypoint: s.points[s.point] || null, point: s.point, total: s.points.length }])),
        readyAt: patrol.readyAt,
        retryReason: patrol.retryReason,
      },
      message: message || encounter?.message || patrol?.message || lastMessage,
    };
  }
  function restorePursuit(e:Encounter):void {
    const saved=party.rarePursuitProgress?.[key(e.target)];
    if(saved)Object.assign(e,saved);
    rememberPursuit();
  }
  function rememberPursuit():void {
    if(!encounter)return;
    const e=encounter, saved=party.rarePursuitProgress||={};
    saved[key(e.target)]={start:e.start,progress:e.progress,lowHp:e.lowHp};
  }
  function restore(e: Encounter, travel = true) {
    if(e.convoyId){party.rareHuntReturn=null;return;}
    if (!validIntent(e)) return;
    party.location = e.returnLocation;
    if (patrol) {
      party.rareHuntReturn = null;
      return;
    }
    party.rareHuntReturn = {
      leader: e.leader,
      realm: e.realm,
      focus: e.focus,
      policy: e.policy,
      revisions: { ...e.revisions },
      returnLocation: e.returnLocation,
      hunt: !!e.hunt,
      cycleId: e.hunt?.cycleId,
    };
    farmingReturn.tick(!!(!travel || protectedActivity() || combat.busy()));
  }
  function finish(reason: string, killed = false, travel = true) {
    if (!encounter) return;
    const e = encounter!;
    rejectUnproductive(e,killed,reason);
    clearFinishedProgress(e,killed);
    encounter = null;
    cancelTravel();
    const retryAt = retryDeadline(e);
    if (!killed) cooldowns.set(key(e.target), now() + 3000);
    combat.release(e.target, retryAt, now());
    diagnostic('Rare pursuit ended', {id:e.target.id,reason,killed,retryAt});
    if (patrol && e.target.mtype === "phoenix" && killed) {
      prepareWait(e);
    }
    restore(e, travel);
    publish(reason);
    hooks.persist();
  }
  function retryDeadline(e:Encounter):number {
    if (assist(e.target)) return now()+3000;
    return party.rareRetryEvidence?.[key(e.target)] ? Number.MAX_SAFE_INTEGER : now()+3000;
  }
  function clearFinishedProgress(e:Encounter,killed:boolean):void {
    if(killed || party.rareRetryEvidence?.[key(e.target)])delete party.rarePursuitProgress?.[key(e.target)];
  }
  function rejectUnproductive(e: Encounter, killed: boolean, reason: string): void {
    // The patrol exists to hunt Phoenix: a failed attempt only cools down, so a
    // later sighting (including one passed on the way somewhere) retries it.
    if (!killed && !assist(e.target) && /selection released|no progress|time limit/i.test(reason)) retryEvidence().reject(key(e.target),e.target,leader());
  }
  function stop(reason = "Rare hunting cancelled") {
    if (encounter) {
      cooldowns.set(key(encounter.target), now() + 3000);
      combat.release(encounter.target, now() + 3000, now());
    }
    encounter = null;
    patrol = null;
    party.phoenixPatrolActive = false;
    party.phoenixPatrolCheckpoint = null;
    farmingReturn.clear();
    cancelTravel();
    publish(reason);
    hooks.persist();
  }
  function start(order: unknown) {
    if (!validateOrder(party.monsterChoices, order))
      throw new Error("Choose all five Phoenix regions exactly once");
    stop();
    party.phoenixRouteOrder = order.slice();
    party.phoenixPatrolActive = true;
    patrol = newPatrol(capture(), `patrol-${now()}-${++serial}`);
    publish();
    savePatrol();
  }
  function reportSight(name: string, status: Status, r: Sight, observedAt = now()) {
    if (!known(r.mtype) || typeof r.id !== "string" || !r.visible) return;
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.hp) || r.hp <= 0)
      return;
    const sight = {
      id: r.id,
      mtype: r.mtype,
      x: r.x,
      y: r.y,
      hp: r.hp,
      level: r.level,
      target: r.target,
      reachable: r.reachable === true,
      partyEngaged: r.partyEngaged === true,
      map: status.map,
      in: instance(status),
      realm: realm(status),
      seenAt: observedAt,
      reporter: name,
      visible: true,
    };
    sightings.set(key(sight), sight);
    diagnoseSighting(sight);
    if (r.partyEngaged) markEngaged(key(sight));
  }
  function markEngaged(id: string) {
    if (encounter && id === key(encounter.target)) encounter.engaged = true;
  }
  function diagnoseSighting(sight: Sight) {
    if (patrol && sight.mtype === 'phoenix') diagnostic('Phoenix sighting received',
      {id:sight.id,reporter:sight.reporter,map:sight.map,x:sight.x,y:sight.y,observedAt:sight.seenAt});
  }
  function validKillTime(at: number) {
    return Number.isFinite(at) && Math.abs(now() - at) <= 10000;
  }
  function reportKill(status: Status, r: NonNullable<Status["rareKills"]>[number]) {
    if (!known(r.mtype) || r.map !== status.map || String(r.in) !== instance(status)) return;
    if (!validKillTime(r.at)) return;
    const id = key({ ...r, realm: realm(status) });
    kills.set(id, now() + 120000);
    if (!encounter || id !== key(encounter.target) || r.at < encounter.start) return;
    encounter.deathAt = Math.min(encounter.deathAt ?? r.at, r.at);
    if (r.partyEngaged) encounter.engaged = true;
  }
  function report(name: string, input: unknown) {
    const status = input as Status;
    if (!members().includes(name) || status.ctype === "merchant" || status.seenAt < now() - FRESH)
      return;
    reportObservations(name, status);
    for (const r of (Array.isArray(status.rareKills) ? status.rareKills : []).slice(-20))
      reportKill(status, r);
  }
  function reportObservations(name: string, status: Status) {
    const observation = status.rareObservation;
    if (!observation) {
      for (const r of (status.rareSightings || []).slice(0, 64)) reportSight(name, status, r);
      return;
    }
    if (!validObservation(status, observation)) return;
    const observed = {...status, ...observation};
    if (!Array.isArray(observation.sightings)) return;
    for (const r of observation.sightings.slice(0, 64))
      reportSight(name, observed, r, Math.min(now(), observation.at));
  }
  function validObservation(status: Status, observation: NonNullable<Status['rareObservation']>) {
    return observation.runtimeId === status.combatSelection?.runtimeId && Number.isFinite(observation.at) &&
      observation.at >= now() - FRESH && observation.at <= now() + 1000;
  }
  function deployer(target: Sight): string | null {
    if (party.passiveHunting?.useFieldGenerators === false) return null;
    return (
      members()
        .filter((n) => (party.statuses[n]?.items || []).some((i) => i?.item?.name === "fieldgen0"))
        .sort(
          (a, b) => distance(party.statuses[a], target) - distance(party.statuses[b], target),
        )[0] || null
    );
  }
  function recordHuntInterruption(target: Sight) {
    const checkpoint=party.monsterHunt?.travelCheckpoint;
    if(checkpoint)checkpoint.interruption={at:now(),reason:'rare:'+target.mtype};
  }
  function retainTravelConvoy(target:Sight): string | undefined {
    const id=party.activeConvoy && (interruptibleTravel(party.activeConvoy) || party.activeConvoy.huntTravel?.reason) ? party.activeConvoy.id : undefined;
    if(!id)hooks.cancelConvoy();
    else commitTravelTarget(target);
    return id;
  }
  function commitTravelTarget(target:Sight):void {
    const state=party.activeConvoy!.huntTravel ||= {primary:null,searches:{}};
    const fight={...target,server:party.statuses[target.reporter]?.server||leader().server||'',fighter:target.reporter,startedAt:now(),state:'planned' as const};
    state.committed=[...(state.committed||[]).filter(t=>key({...t,realm:target.realm})!==key(target)),fight];
    state.primary ||= fight;
    state.reason='passive-setting';
  }
  function retainRareReturn(e: Encounter): void {
    party.rareHuntReturn=e.convoyId ? null : {...capture(),returnLocation:e.returnLocation,hunt:!!e.hunt,cycleId:e.hunt?.cycleId};
  }
  function retainedConvoyEpoch(convoyId: string | undefined): number | undefined {
    return convoyId ? party.activeConvoy?.epoch : undefined;
  }
  function begin(target: Sight) {
    hooks.reconcileHuntArrival?.();
    recordHuntInterruption(target);
    diagnostic('Rare sighting handed to combat', {id:target.id,mtype:target.mtype,reporter:target.reporter});
    const old = encounter;
    if (old) cooldowns.set(key(old.target), now() + 3000);
    const convoyId=retainTravelConvoy(target);
    // Encounters move searchers; a resumed search plans from their new positions.
    if (patrol) patrol.searchers = {};
    // Scatter farming becomes grouped for the rare. Capture selection admission
    // after that switch, before formation has had a chance to select its target.
    party.partyFarmingMode = "default";
    encounter = {
      ...capture(),
      convoyId,
      convoyEpoch: retainedConvoyEpoch(convoyId),
      id: `rare-${now()}-${++serial}`,
      target,
      start: now(),
      lastSeen: now(),
      lowHp: target.hp,
      progress: now(),
      stage: "approach",
      awaitingSelection: combat.grouped(),
      generator: "none",
      returnLocation: old?.returnLocation ?? party.location,
      hunt: old?.hunt ?? party.monsterHunt,
      message: `Pursuing ${passiveName(target.mtype)}`,
    };
    restorePursuit(encounter);
    beginConverge(encounter);
    retainRareReturn(encounter);
    hooks.persist();
    party.scatterBreakTarget = null;
    if (target.mtype === "tinyp") {
      const carrier = deployer(target);
      encounter.deployer = carrier;
      encounter.generator = carrier ? "approaching" : "unavailable; ordinary attacks";
    }
  }
  /** Patrol searchers are scattered: hold fire until everyone has arrived. */
  function beginConverge(e: Encounter): void {
    if (!patrol || e.target.mtype !== "phoenix") return;
    const started = now();
    e.stage = "converge";
    e.awaitingSelection = false;
    e.gatherDeadline = started + GATHER_MINIMUM;
    e.message = `Phoenix spotted by ${e.target.reporter}; converging`;
    diagnostic('Phoenix convergence started', {id:e.target.id,reporter:e.target.reporter,map:e.target.map});
    if (!hooks.routeDistance) return;
    const destination = { map: e.target.map, x: e.target.x, y: e.target.y };
    void Promise.all(members().map(async (name) => {
      const s = party.statuses[name];
      if (!s) return 0;
      try {
        const length = await hooks.routeDistance!({ map: s.map, x: s.x, y: s.y }, destination);
        return (length / Math.max(10, Number(s.speed) || 55)) * 1000;
      } catch { return 0; }
    })).then((times) => {
      if (encounter !== e || e.stage !== "converge") return;
      // Walking is slow and maps chain; allow twice the slowest planned trip.
      e.gatherDeadline = Math.max(e.gatherDeadline!, started + 2 * Math.max(0, ...times));
      publish();
    });
  }
  function gathered(s: Status | undefined, target: Sight): boolean {
    return !!s && now() - s.seenAt <= FRESH && !s.rip && Number(s.hp) > 0 && realm(s) === target.realm &&
      s.map === target.map && instance(s) === target.in && distance(s, target) <= GATHER_RANGE;
  }
  function tickConverge(e: Encounter): void {
    e.progress = now();
    cancelTravel();
    const names = members().filter((n) => {
      const s = party.statuses[n];
      return !!s && now() - s.seenAt <= FRESH && !s.rip && Number(s.hp) > 0;
    });
    const missing = names.filter((n) => !gathered(party.statuses[n], e.target));
    if (names.length && (!missing.length || now() >= e.gatherDeadline!)) {
      e.stage = "approach";
      e.awaitingSelection = combat.grouped();
      e.gatheredAt = e.progress = now();
      e.gatheredWithout = missing;
      e.message = missing.length
        ? `Convergence deadline passed; engaging Phoenix without ${missing.join(", ")}`
        : "Party gathered; engaging Phoenix";
      diagnostic('Phoenix party gathered', {id:e.target.id,missing});
      return;
    }
    const fought = e.target.target ? "already being fought; members in range join" : "holding fire";
    e.message = `Phoenix spotted by ${e.target.reporter} · converging ${names.length - missing.length}/${names.length} · ${fought}`;
  }
  function fieldAt(target: Sight) {
    return Object.values(party.statuses).some(
      (s) =>
        s.seenAt >= now() - FRESH &&
        realm(s) === target.realm &&
        s.map === target.map &&
        instance(s) === target.in &&
        (s.rareFields || []).some(
          (f) =>
            Number.isFinite(f.x) &&
            Number.isFinite(f.y) &&
            Math.hypot(f.x - target.x, f.y - target.y) < 300,
        ),
    );
  }
  function dead(e: Encounter) {
    return e.stage === "loot" || kills.has(key(e.target)) || combat.killed(e.target);
  }
  function finishDead(e: Encounter) {
    e.deathAt ||= now();
    if (assist(e.target)) prepareWait(e);
    if (!e.engaged) {
      finish("Rare died without confirmed party engagement");
      return;
    }
    if (combat.busy()) {
      cancelTravel();
      e.stage = "loot";
      e.deployer = null;
      e.message = "Finishing party combat before rare loot";
      return;
    }
    tickLoot(e);
  }
  function refreshEncounter(e: Encounter) {
    const sight = sightings.get(key(e.target));
    if (!sight || sight.seenAt <= e.lastSeen) return;
    e.target = sight;
    e.lastSeen = sight.seenAt;
    if (sight.hp < e.lowHp) {
      e.lowHp = sight.hp;
      e.progress = now();
    }
  }
  function outsideClaim(s: Sight) {
    return !assist(s) && !!s.target && !members().includes(s.target);
  }
  function encounterExpired(e: Encounter): string | null {
    if (now()-e.lastSeen<=FRESH && e.target.target && members().includes(e.target.target)) return null;
    if (!e.engaged && (claimed(e.target) || outsideClaim(e.target) || now() - e.lastSeen > FRESH))
      return "Rare pursuit ended: claimed outside party or no fresh sightings";
    refreshRareApproach(e, members().map(n=>party.statuses[n]), now());
    if(waitingForAttackers(e))e.progress=now();
    return timeExpired(e) ? "Rare pursuit ended: no progress or time limit" : null;
  }
  function convergeExpired(e: Encounter): string | null {
    return now() - e.lastSeen > CONVERGE_LOST ? "Phoenix lost while the party converged" : null;
  }
  function waitingForAttackers(e:Encounter):boolean {
    // A gathered patrol Phoenix is still forming until grouped combat locks it;
    // the five-minute limit from the gather bounds that phase.
    if(assist(e.target) && !!e.gatheredAt && !combat.locked(e.target))return true;
    if(combat.selected(e.target))return false;
    return members().some(n=>freshOtherAttacker(party.statuses[n],e));
  }
  function freshOtherAttacker(s:Status|undefined,e:Encounter):boolean {
    const g=s?.groupedCombat;
    if(!s || now()-s.seenAt>FRESH || !g?.currentAttackersAt || now()-g.currentAttackersAt>FRESH)return false;
    return (g.currentAttackers||[]).some(t=>t.id!==e.target.id && t.map===s.map && members().includes(t.target));
  }
  function timeExpired(e: Encounter) {
    return (
      now() - e.lastSeen >= 30000 ||
      now() - (e.gatheredAt ?? e.start) >= 300000 ||
      now() - e.progress >= 30000
    );
  }
  function encounterVisible(e: Encounter) {
    return (
      leader().map === e.target.map &&
      instance(leader()) === e.target.in &&
      (leader().rareSightings || []).some((s) => s.id === e.target.id && s.visible)
    );
  }
  function encounterMovement(e: Encounter) {
    if (combat.grouped()) {
      cancelTravel();
      e.stage = combat.locked(e.target) ? "combat" : "approach";
    } else if (encounterVisible(e)) {
      cancelTravel();
      e.stage = "combat";
    } else {
      e.stage = "approach";
      if (!party.activeConvoy && now() - (e.travelAt || 0) > 3000) {
        e.travelAt = now();
        hooks.convoy(e.target, "Pursuing rare sighting", members(), "rare-hunt");
      }
    }
    if (e.stage === "combat" && !e.combatAt) e.combatAt = e.progress = now();
  }
  function confirmGenerator(e: Encounter) {
    const result = party.statuses[e.deployer!]?.rareDeployment;
    if (result?.encounterId === e.id) {
      e.deployedAt ||= now();
      e.generator = "confirming deployment";
      if (result.failed || now() - e.deployedAt >= 3000) {
        e.generator = "deployment unconfirmed; ordinary attacks";
        e.deployer = null;
      }
    }
    if (now() - e.start > 20000) {
      e.deployer = null;
      e.generator = "deployment timed out; ordinary attacks";
    }
  }
  function tickGenerator(e: Encounter) {
    if (e.target.mtype !== "tinyp") return;
    if (fieldAt(e.target)) {
      e.generator = "field active";
      e.deployer = null;
    } else if (e.deployer) confirmGenerator(e);
    else if (e.generator === "field active") e.generator = "outside field; ordinary attacks";
  }
  function enabled(s: Sight) {
    return party.passiveRareHunts[s.mtype] && passiveLevelAllowed(party.passiveHunting?.rules[s.mtype], s.level) || assist(s) || combat.locked(s);
  }
  function tickEncounter() {
    const e = encounter!;
    if (!validIntent(e)) {
      stop("Rare pursuit cancelled by new navigation");
      return;
    }
    if (combat.engaged(e.target)) e.engaged = true;
    if (dead(e)) {
      finishDead(e);
      return;
    }
    if (!enabled(e.target)) {
      finish("Passive hunt disabled");
      return;
    }
    refreshEncounter(e);
    const expired = e.stage === "converge" ? convergeExpired(e) : encounterExpired(e);
    if (expired) {
      finish(expired);
      return;
    }
    if (e.stage === "converge") {
      tickConverge(e);
      return;
    }
    encounterMovement(e);
    tickGenerator(e);
    e.message = `${e.stage === "combat" ? "Fighting" : "Pursuing"} ${passiveName(e.target.mtype)}${e.target.mtype === "tinyp" ? ` · ${e.generator}` : ""}`;
  }
  function collected(e: Encounter): boolean {
    const lead = leader(),
      result = lead?.rareLoot;
    if (!lead || lead.seenAt < now() - FRESH) return false;
    // The retained convoy owns the departure barrier. Its leader may finish that
    // pass and resume travel before the separate rare receipt is sampled.
    if (collectedByConvoy(e, lead.convoyLoot)) return true;
    if (!result || !result.complete) return false;
    return (
      result.id === e.id &&
      result.observedAt > e.killedAt! &&
      lootPlaceMatches(e, result)
    );
  }
  function lootPlaceMatches(e: Encounter, result: NonNullable<Status['rareLoot']>): boolean {
    return result.realm === e.target.realm && result.map === e.target.map && String(result.in) === e.target.in;
  }
  function convoyLootIdentity(id: string): unknown[] | null {
    let identity: unknown;
    try { identity = JSON.parse(id); } catch { return null; }
    return Array.isArray(identity) && identity.length === 4 ? identity : null;
  }
  function postDeathLootPass(after: unknown, deathAt: number, observedAt: number): boolean {
    return typeof after === 'number' && Number.isFinite(after) && after >= deathAt && observedAt > after;
  }
  function retainedConvoyDied(e: Encounter): boolean {
    return !!e.convoyId && e.convoyEpoch !== undefined && !!e.deathAt;
  }
  function collectedByConvoy(e: Encounter, result: Status['convoyLoot']): boolean {
    if (!retainedConvoyDied(e) || !result?.complete ||
        !lootPlaceMatches(e, result)) return false;
    const identity = convoyLootIdentity(result.id);
    if (!identity) return false;
    const [kind, convoyId, epoch, after] = identity;
    return kind === 'convoy' && convoyId === e.convoyId && epoch === e.convoyEpoch &&
      postDeathLootPass(after, e.deathAt!, result.observedAt);
  }
  function tickLoot(e: Encounter) {
    if (!e.killedAt) {
      e.killedAt = now();
      e.stage = "loot";
      e.deployer = null;
      cancelTravel();
    }
    e.message = `Collecting ${passiveName(e.target.mtype)} drops`;
    if (collected(e)) finish(`${passiveName(e.target.mtype)} defeated; loot checked`, true);
  }
  function savePatrol() {
    party.phoenixPatrolCheckpoint = patrol ? patrolCheckpoint(patrol) : null;
    hooks.persist();
  }
  function tickPatrol() {
    const p = patrol!;
    if (
      !validIntent(p) ||
      party.farmingPolicy === "hunt" ||
      party.monsterFocus.join(",") !== "phoenix"
    ) {
      stop("Phoenix patrol cancelled by farming change");
      return;
    }
    const catalog = regions(party.monsterChoices);
    const areas = party.phoenixRouteOrder.map((id) => catalog.find((a) => a.id === id)).filter((a) => !!a?.boundary);
    if (areas.length !== 5) {
      stop("Phoenix spawn catalog changed; choose the route again");
      return;
    }
    // Patrols saved before split searching may still own a whole-party convoy.
    if (party.activeConvoy?.purpose === "phoenix-patrol") hooks.cancelConvoy();
    stepSearch(p, {
      now: now(),
      clock: now,
      statuses: party.statuses,
      searchers: searchers(),
      areas: areas as NonNullable<typeof areas[number]>[],
      routeDistance: hooks.routeDistance?.bind(hooks),
      current: (q) => patrol === q && validIntent(q),
      publish: () => publish(),
    });
  }
  /** Fighters the patrol may direct now; an encounter keeps its own participants. */
  function searchers(): string[] {
    const spreading = !!encounter && lootSpread(encounter);
    if (encounter && !spreading) return [];
    return members().filter((n) => {
      const s = party.statuses[n];
      return (!spreading || n !== party.leader) && !!s && now() - s.seenAt <= FRESH && !s.rip &&
        Number(s.hp) > 0 && realm(s) === patrol!.realm && !memberProtected(n);
    });
  }
  /** After a patrol kill, only the leader stays for loot; the others pre-position for the respawn. */
  function lootSpread(e: Encounter): boolean {
    return !!patrol && !patrol.paused && e.target.mtype === "phoenix" && e.stage === "loot" &&
      !!e.killedAt && !combat.busy();
  }
  function assist(target: Sight) {
    return !!patrol && !patrol.paused && target.mtype === "phoenix";
  }
  function claimed(target: Sight) {
    return !assist(target) && combat.claimed(target);
  }
  /** Respawn is random across all five regions; restart coverage from current positions. */
  function prepareWait(e: Encounter) {
    const p = patrol;
    if (!p || e.respawnPrepared) return;
    e.respawnPrepared = true;
    p.readyAt = (e.deathAt || e.killedAt || now()) + 35000;
    p.cycle++;
    p.covered = {};
    p.incomplete = [];
    p.searchers = {};
    p.assigning = undefined;
    p.assignAfter = 0;
    p.stage = "respawn";
    p.message = "Phoenix defeated; spreading out before the respawn";
    savePatrol();
  }
  function expireObservations() {
    for (const [k, s] of sightings) if (now() - s.seenAt > 30000) sightings.delete(k);
    for (const [k, t] of cooldowns) if (t <= now()) cooldowns.delete(k);
    for (const [k, t] of kills) if (t <= now()) kills.delete(k);
  }
  function pauseProtected() {
    if (patrol && sightings.size) diagnostic('Phoenix acquisition waiting for protected activity', {});
    // Keep assignments; only the movement watchdogs restart afterwards.
    if (patrol) pauseSearch(patrol, now());
    if (encounter && !combat.locked(encounter.target))
      finish("Rare encounter interrupted by protected activity", false, false);
    cancelTravel();
    if (!encounter) farmingReturn.tick(true);
    publish(
      patrol
        ? "Phoenix patrol waiting for protected activity"
        : party.rareHuntReturn
          ? "Farming return waiting for protected activity"
          : undefined,
    );
  }
  function restorable(): boolean {
    return !patrol && !!party.phoenixPatrolActive && party.monsterFocus.join(",") === "phoenix" &&
      validateOrder(party.monsterChoices, party.phoenixRouteOrder);
  }
  /** True while a suspended patrol must stay off: away on another realm, or superseded. */
  function heldAway(saved: Checkpoint | null | undefined, change: "navigation" | "realm" | null): boolean {
    // Away on another realm: boss chase or an event there owns the party.
    if (change === "realm") {
      lastMessage = `Phoenix patrol suspended while the party is away from ${saved!.realm}; it resumes on return`;
      return true;
    }
    if (!saved?.suspended || !change) return false;
    stop("Phoenix patrol cancelled: new navigation while the party was away");
    return true;
  }
  function restorePatrol() {
    if (!restorable()) return;
    const saved = party.phoenixPatrolCheckpoint;
    const change = saved ? intentChange(saved) : null;
    if (heldAway(saved, change)) return;
    patrol = newPatrol(capture(), `patrol-${now()}-${++serial}`);
    if (saved && !change) patrol.readyAt = Number.isFinite(saved.readyAt) ? saved.readyAt : 0;
    if (saved?.suspended) savePatrol();
  }
  /** A realm hop keeps the patrol on: drop this realm's encounter, keep the checkpoint. */
  function suspendPatrol() {
    if (encounter) {
      cooldowns.set(key(encounter.target), now() + 3000);
      combat.release(encounter.target, now() + 3000, now());
      encounter = null;
    }
    party.phoenixPatrolCheckpoint = { ...patrolCheckpoint(patrol!), suspended: true };
    patrol = null;
    farmingReturn.clear();
    cancelTravel();
    hooks.persist();
    diagnostic('Phoenix patrol suspended by a realm change', {realm:party.phoenixPatrolCheckpoint.realm});
  }
  function eligible(s: Sight) {
    return (
      known(s.mtype) &&
      retryEligible(s) &&
      committedCandidate(s) &&
      !cooldowns.has(key(s)) &&
      !kills.has(key(s)) &&
      !claimed(s) &&
      !!enabled(s)
    );
  }
  function retryEligible(s: Sight): boolean {
    const rejected=!!party.rareRetryEvidence?.[key(s)];
    if (assist(s)) {
      // Clear a rejection recorded before the patrol started.
      if (rejected) { retryEvidence().remove(key(s)); combat.allow(s); hooks.persist(); }
      return true;
    }
    const reachable=s.reachable===true && members().some(n=> {
      const m=party.statuses[n];
      return m && now()-m.seenAt<=FRESH && realm(m)===s.realm && instance(m)===s.in &&
        distance(m,s)<=Number(m.range||0) && Number(m.range)>0;
    });
    if(!retryEvidence().eligible(key(s),s,leader(),reachable))return false;
    if(rejected){combat.allow(s);hooks.persist();}
    return true;
  }
  function committedCandidate(s: Sight): boolean {
    return !(party.passiveHunting?.rules[s.mtype]?.keepMoving && !(s.mtype === 'phoenix' && patrol));
  }
  function released(e: Encounter) {
    if (e.awaitingSelection) {
      if (combat.selected(e.target) || combat.locked(e.target)) {
        e.awaitingSelection = false;
        diagnostic('Rare target selected', {id:e.target.id,mtype:e.target.mtype});
      }
      else return now() - e.start >= 10000;
    }
    return !combat.selected(e.target) && !combat.locked(e.target) && !dead(e);
  }
  function lostClaim(e: Encounter) {
    return !e.engaged && !combat.locked(e.target) && claimed(e.target);
  }
  function groupedTick(): boolean {
    if (!combat.grouped()) return false;
    releaseGrouped();
    acquireGrouped();
    if (encounter) {
      tickOwned();
      publish();
      return true;
    }
    if (!combat.busy()) return false;
    // Split searchers defend themselves; one fighter's defense must not stop the others.
    if (patrol) return false;
    cancelTravel();
    publish("Finishing party combat");
    return true;
  }
  function releaseGrouped() {
    // Converging fighters are apart on purpose; formation cannot select yet.
    if (!encounter || encounter.stage === "converge") return;
    if (lostClaim(encounter)) finish("Rare pursuit cancelled: claimed outside party", false, false);
    if (encounter && released(encounter)) finish("Rare pursuit cancelled: selection released");
  }
  function acquireGrouped() {
    const current = combat.current();
    // The combat bridge supplies placeholder HP; compare actual observations.
    const sight = current && (sightings.get(key(current)) || current);
    if (!encounter && sight && eligible(sight)) begin(sight);
  }
  function resumeFarm(): boolean {
    if (encounter) return false;
    if (patrol && party.rareHuntReturn) farmingReturn.clear();
    if (patrol || !party.rareHuntReturn) return false;
    if (farmingReturn.tick(false)) {
      publish(
        farmingReturn.moving()
          ? "Returning to farming after rare hunt"
          : "Farming resumed; waiting for disconnected members",
      );
      return true;
    }
    publish("Farming resumed");
    return false;
  }
  function localFresh(s: Sight) {
    return (
      members().includes(s.reporter) &&
      s.map === leader().map &&
      s.in === instance(leader()) &&
      s.realm === realm(leader()) &&
      s.seenAt >= now() - FRESH
    );
  }
  function priorityAllowed(s: Sight) {
    if (encounter)
      return (
        encounter.stage !== "loot" &&
        !kills.has(key(encounter.target)) &&
        passivePriority(s.mtype) > passivePriority(encounter.target.mtype)
      );
    const current = leader()?.target,
      priorities = party.monsterPrioritiesByCharacter?.[party.leader] || {};
    const priority = current
      ? party.passiveRareHunts[current.mtype] ? passivePriority(current.mtype) : Number(priorities[current.mtype] ?? 50)
      : 0;
    return passivePriority(s.mtype) >= priority;
  }
  function acquirePassive() {
    const travel = party.activeConvoy;
    const interruptibleTravel = !!travel && ["farm-relocation","monster-hunt","manual-monster-override","party-travel"].includes(travel.purpose || "");
    if (combat.grouped() && !interruptibleTravel || party.groupedCombat?.fights?.length) return;
    const candidate = [...sightings.values()]
      .filter((s) => localFresh(s) && eligible(s) && !outsideClaim(s) && priorityAllowed(s))
      .sort(
        (a, b) =>
          passivePriority(b.mtype) - passivePriority(a.mtype) || distance(leader(), a) - distance(leader(), b),
      )[0];
    if (candidate) begin(candidate);
  }
  function acquirePatrolSighting() {
    if (!patrol || patrol.paused || encounter) return;
    if (party.activeConvoy && party.activeConvoy.purpose !== "phoenix-patrol") return;
    // Searchers are spread across maps: any searcher's fresh sighting counts.
    const candidate = [...sightings.values()]
      .filter((s) => s.mtype === "phoenix" && s.visible && members().includes(s.reporter) &&
        s.realm === patrol!.realm && s.seenAt >= now() - FRESH && eligible(s))
      .sort((a, b) => b.seenAt - a.seenAt)[0];
    if (candidate) begin(candidate);
  }
  function restoreRejections():void {
    for(const failed of Object.values(party.rareRetryEvidence||{}))if(!combat.rejected(failed.sight))combat.release(failed.sight,Number.MAX_SAFE_INTEGER,now());
  }
  /** A realm hop suspends a patrol; any other intent change ends the rare route. */
  function superseded(): boolean {
    if (patrol && intentChange(patrol) === "realm" && (!encounter || intentChange(encounter) !== "navigation"))
      suspendPatrol();
    if (!(encounter && !validIntent(encounter)) && !(patrol && !validIntent(patrol))) return false;
    stop("Rare route superseded");
    return true;
  }
  function tick() {
    restoreRejections();
    expireObservations();
    if (superseded()) return;
    if (blocked()) {
      pauseProtected();
      return;
    }
    restorePatrol();
    acquirePatrolSighting();
    if (groupedTick() || resumeFarm()) return;
    acquirePassive();
    tickOwned();
    publish();
  }
  function tickOwned() {
    if (encounter) tickEncounter();
    // Loot needs only the leader; everyone else spreads out for the respawn.
    if (patrol && (!encounter || lootSpread(encounter))) tickPatrol();
  }
  function encounterControl(e: Encounter, name: string) {
    return {
      id: e.id,
      kind: e.stage === "loot" ? "loot" : "encounter",
      target: e.target,
      destination: e.target,
      deployer: e.deployer,
      generator: e.generator,
      killedAt: e.killedAt,
      allowPhoenixAssist: !!patrol && !patrol.paused,
      revision: e.revisions[name],
    };
  }
  function control(name: string) {
    if (!members().includes(name)) return null;
    if (splitSearch()) return searchControlFor(name);
    if (protectedActivity() && !(encounter && combat.locked(encounter.target))) return null;
    return encounter ? ownedControl(encounter, name) : searchControl(name);
  }
  function searchControlFor(name: string) {
    const reason = searchPaused() || memberProtection(name);
    if (!reason) return searchControl(name);
    diagnostic('Phoenix search control withheld', {id:name,reason});
    return null;
  }
  function ownedControl(e: Encounter, name: string) {
    if (lootSpread(e) && name !== party.leader) return searchControl(name);
    return e.stage === "converge" ? convergeControl(e, name) : encounterControl(e, name);
  }
  /** Members in range join a Phoenix someone is already fighting; the rest keep moving in. */
  function convergeControl(e: Encounter, name: string) {
    const engage = !!e.target.target && gathered(party.statuses[name], e.target);
    return {
      id: e.id,
      kind: engage ? "engage" : "converge",
      target: e.target,
      destination: { map: e.target.map, x: e.target.x, y: e.target.y },
      allowPhoenixAssist: true,
      revision: e.revisions[name],
    };
  }
  /** An unassigned searcher holds position while routes are planned. */
  function searchControl(name: string) {
    if (!patrol || patrol.paused) return null;
    return {
      id: searchControlId(patrol, name) || `${patrol.id}-${patrol.cycle}-${name}-hold`,
      kind: "search",
      allowPhoenixAssist: true,
      destination: searchDestination(patrol, name),
      revision: patrol.revisions[name],
    };
  }
  publish();
  return {
    report,
    tick,
    start,
    stop,
    control,
    owns: () => !!(encounter || patrol || farmingReturn.moving()),
    // Grouped combat may select the Phoenix only after the scattered searchers gather.
    patrolAcquisitionAllowed: () => !!patrol && !patrol.paused && !protectedActivity() &&
      !!encounter && encounter.stage !== "converge",
    abandon: () => {
      encounter = null;
      cancelTravel();
      farmingReturn.clear();
      publish("Rare encounter abandoned after party death");
    },
    blocksPulls: () =>
      !!encounter &&
      (encounter.stage === "loot" ||
        combat.killed(encounter.target) ||
        kills.has(key(encounter.target))),
    encounter: () => !!encounter,
    setSettings(settings: Record<string, unknown>) {
      party.passiveHunting = applyPassivePatch(party.passiveHunting!,settings);
      party.passiveRareHunts = committedPassiveRules(party.passiveHunting);
      tick();
      hooks.persist();
    },
  };
}
export const validPassiveSettings = validPassivePatch;
