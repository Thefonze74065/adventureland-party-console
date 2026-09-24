import { migratePassiveSettings, applyPassivePatch, committedPassiveRules, validPassivePatch } from "./passive-settings.ts";
import { createRareRetryEvidence } from './rare-retry-evidence.ts';
// Rare encounters own temporary travel; the saved farming intent remains authoritative.
import * as zones from "../../../dashboard/lib/farming-zones.ts";
import type {
  Catalog,
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
  patrolCheckpoint,
  patrolControlId,
  stepPatrol,
  waitingRegion,
} from "./phoenix-patrol.ts";
export { samples, scanPoints } from "./phoenix-patrol.ts";
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
  const retryEvidence = createRareRetryEvidence();
  const combat = createRareCombat(party, members, realm);
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
    const s = party.statuses[name];
    if (!s) return commandProtected(name);
    if (s.joinedEvent || s.movement?.event || s.eventTraveling || s.rip) return true;
    if (Number(s.max_hp) > 0 && Number(s.hp) / Number(s.max_hp) < 0.35) return true;
    return commandProtected(name);
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
  function validIntent(owner: Owner) {
    return (
      owner.leader === party.leader &&
      (!leader() || leader().seenAt < now() - FRESH || owner.realm === realm(leader())) &&
      owner.focus === JSON.stringify(party.monsterFocus) &&
      owner.policy === party.farmingPolicy &&
      Object.entries(owner.revisions).every(
        ([n, revision]) => !hooks.intent(n).cancelled && hooks.intent(n).revision === revision,
      )
    );
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
    if (message) lastMessage = message;
    party.rareHuntState = {
      encounter: encounter && {
        id: encounter.id,
        revisions: encounter.revisions,
        mtype: encounter.target.mtype,
        stage: encounter.stage,
        generator: encounter.generator,
        message: encounter.message,
      },
      patrol: patrol && {
        active: true,
        paused: !!patrol.paused,
        index: patrol.index,
        total: 5,
        stage: patrol.stage,
        message: patrol.message,
        incomplete: patrol.incomplete,
        regionId: party.phoenixRouteOrder[patrol.index],
        waypoint: patrol.points[patrol.point],
        readyAt: patrol.readyAt,
        retryReason: patrol.retryReason,
      },
      message: message || encounter?.message || patrol?.message || lastMessage,
    };
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
    encounter = null;
    cancelTravel();
    const retryAt = now() + 3000;
    if (!killed) cooldowns.set(key(e.target), retryAt);
    combat.release(e.target, retryAt, now());
    diagnostic('Rare pursuit ended', {id:e.target.id,reason,killed,retryAt});
    if (patrol && e.target.mtype === "phoenix" && killed) {
      prepareWait(e);
    }
    restore(e, travel);
    publish(reason);
    hooks.persist();
  }
  function rejectUnproductive(e: Encounter, killed: boolean, reason: string): void {
    if (!killed && /selection released|no progress|time limit/i.test(reason)) retryEvidence.reject(key(e.target),e.target,leader());
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
      target: r.target,
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
        .filter((n) => (party.statuses[n]?.items || []).some((i) => i?.name === "fieldgen0"))
        .sort(
          (a, b) => distance(party.statuses[a], target) - distance(party.statuses[b], target),
        )[0] || null
    );
  }
  function recordHuntInterruption(target: Sight) {
    const checkpoint=party.monsterHunt?.travelCheckpoint;
    if(checkpoint)checkpoint.interruption={at:now(),reason:'rare:'+target.mtype};
  }
  function retainTravelConvoy(): string | undefined {
    const id=party.activeConvoy?.huntTravel?.reason ? party.activeConvoy.id : undefined;
    if(!id)hooks.cancelConvoy();
    return id;
  }
  function retainRareReturn(e: Encounter): void {
    party.rareHuntReturn=e.convoyId ? null : {...capture(),returnLocation:e.returnLocation,hunt:!!e.hunt,cycleId:e.hunt?.cycleId};
  }
  function begin(target: Sight) {
    recordHuntInterruption(target);
    diagnostic('Rare sighting handed to combat', {id:target.id,mtype:target.mtype,reporter:target.reporter});
    const old = encounter;
    if (old) cooldowns.set(key(old.target), now() + 3000);
    const convoyId=retainTravelConvoy();
    if (patrol) patrol.progressPosition = undefined;
    encounter = {
      ...capture(),
      convoyId,
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
    retainRareReturn(encounter);
    hooks.persist();
    party.partyFarmingMode = "default";
    party.scatterBreakTarget = null;
    if (target.mtype === "tinyp") {
      const carrier = deployer(target);
      encounter.deployer = carrier;
      encounter.generator = carrier ? "approaching" : "unavailable; ordinary attacks";
    }
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
    if (!e.engaged) {
      if (assist(e.target)) prepareWait(e);
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
    if (combat.locked(e.target)) return null;
    if (!e.engaged && (claimed(e.target) || outsideClaim(e.target) || now() - e.lastSeen > FRESH))
      return "Rare pursuit ended: claimed outside party or no fresh sightings";
    if (combat.grouped() && combat.selected(e.target)) return null;
    return timeExpired(e) ? "Rare pursuit ended: no progress or time limit" : null;
  }
  function timeExpired(e: Encounter) {
    return (
      now() - e.lastSeen >= 30000 ||
      now() - e.start >= 300000 ||
      (!!e.combatAt && now() - e.progress >= 30000)
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
    return party.passiveRareHunts[s.mtype] || assist(s) || combat.locked(s);
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
    const expired = encounterExpired(e);
    if (expired) {
      finish(expired);
      return;
    }
    encounterMovement(e);
    tickGenerator(e);
    e.message = `${e.stage === "combat" ? "Fighting" : "Pursuing"} ${passiveName(e.target.mtype)}${e.target.mtype === "tinyp" ? ` · ${e.generator}` : ""}`;
  }
  function collected(e: Encounter): boolean {
    const lead = leader(),
      result = lead?.rareLoot;
    if (!lead || lead.seenAt < now() - FRESH || !result || !result.complete) return false;
    return (
      result.id === e.id &&
      result.observedAt > e.killedAt! &&
      result.realm === e.target.realm &&
      result.map === e.target.map &&
      String(result.in) === e.target.in
    );
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
    party.phoenixPatrolCheckpoint = patrol
      ? patrolCheckpoint(patrol, party.phoenixRouteOrder)
      : null;
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
    stepPatrol(p, {
      now: now(),
      leader: leader(),
      statuses: members().map((n) => party.statuses[n]),
      areas: regions(party.monsterChoices),
      order: party.phoenixRouteOrder,
      convoy: party.activeConvoy,
      cancel: cancelTravel,
      save: savePatrol,
      stop,
      travel: (destination) => {
        hooks.convoy(destination, `Phoenix region ${p.index + 1}/5`, members(), "phoenix-patrol");
      },
    });
  }
  function assist(target: Sight) {
    return !!patrol && !patrol.paused && target.mtype === "phoenix";
  }
  function claimed(target: Sight) {
    return !assist(target) && combat.claimed(target);
  }
  function prepareWait(e: Encounter) {
    const p = patrol!;
    const areas = party.phoenixRouteOrder.map((id) =>
      regions(party.monsterChoices).find((a) => a.id === id)!,
    );
    p.readyAt = (e.deathAt || e.killedAt || now()) + 35000;
    p.area = null;
    p.stage = "respawn";
    p.message = "Phoenix defeated; waiting until 35 seconds after death";
    p.points = [];
    p.waitingRegion = true;
    const current = areas.find((a) => a.map === leader().map && zones.contains(a, leader(), 0, 1));
    if (current) {
      p.index = party.phoenixRouteOrder.indexOf(current.id!);
      savePatrol();
      return;
    }
    p.choosing = true;
    void waitingRegion(
      areas,
      { map: leader().map, x: leader().x, y: leader().y },
      hooks.routeDistance?.bind(hooks),
    ).then((area) => {
      if (patrol !== p || !validIntent(p)) return;
      p.choosing = false;
      if (area) p.index = party.phoenixRouteOrder.indexOf(area.id!);
      else {
        p.paused = true;
        p.message =
          "Unable to plan a reachable Phoenix waiting region; restart the patrol to retry";
      }
      savePatrol();
      publish();
    });
  }
  function expireObservations() {
    for (const [k, s] of sightings) if (now() - s.seenAt > 30000) { sightings.delete(k); retryEvidence.remove(k); }
    for (const [k, t] of cooldowns) if (t <= now()) cooldowns.delete(k);
    for (const [k, t] of kills) if (t <= now()) kills.delete(k);
  }
  function pauseProtected() {
    if (patrol && sightings.size) diagnostic('Phoenix acquisition waiting for protected activity', {});
    if (patrol) {
      patrol.progressAt = now();
      patrol.progressPosition = undefined;
    }
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
  function restorePatrol() {
    if (patrol || !party.phoenixPatrolActive || party.monsterFocus.join(",") !== "phoenix") return;
    if (!validateOrder(party.monsterChoices, party.phoenixRouteOrder)) return;
    patrol = newPatrol(capture(), `patrol-${now()}-${++serial}`);
    const saved = party.phoenixPatrolCheckpoint;
    if (saved && validIntent(saved) && party.phoenixRouteOrder.includes(saved.regionId)) {
      patrol.index = party.phoenixRouteOrder.indexOf(saved.regionId);
      patrol.readyAt = Number.isFinite(saved.readyAt) ? saved.readyAt : 0;
    }
  }
  function eligible(s: Sight) {
    return (
      known(s.mtype) &&
      retryEvidence.eligible(key(s),s,leader()) &&
      committedCandidate(s) &&
      !cooldowns.has(key(s)) &&
      !kills.has(key(s)) &&
      !claimed(s) &&
      !!enabled(s)
    );
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
    if (encounter && lostClaim(encounter))
      finish("Rare pursuit cancelled: claimed outside party", false, false);
    if (encounter && released(encounter)) finish("Rare pursuit cancelled: selection released");
    acquireGrouped();
    if (encounter) {
      tickEncounter();
      publish();
      return true;
    }
    if (!combat.busy()) return false;
    if (patrol) patrol.progressPosition = undefined;
    cancelTravel();
    publish("Finishing party combat");
    return true;
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
    if (!patrol || patrol.paused || encounter || combat.busy()) return;
    if (party.activeConvoy && party.activeConvoy.purpose !== "phoenix-patrol") return;
    const candidate = [...sightings.values()]
      .filter((s) => s.mtype === "phoenix" && s.visible && localFresh(s) && eligible(s))
      .sort((a, b) => distance(leader(), a) - distance(leader(), b))[0];
    if (candidate) begin(candidate);
  }
  function tick() {
    expireObservations();
    if ((encounter && !validIntent(encounter)) || (patrol && !validIntent(patrol))) {
      stop("Rare route superseded");
      return;
    }
    if (protectedActivity()) {
      pauseProtected();
      return;
    }
    restorePatrol();
    acquirePatrolSighting();
    if (groupedTick() || resumeFarm()) return;
    acquirePassive();
    if (encounter) tickEncounter();
    else if (patrol) tickPatrol();
    publish();
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
    if (protectedActivity() && !(encounter && combat.locked(encounter.target))) return null;
    if (encounter) return encounterControl(encounter, name);
    return patrolControl(name);
  }
  function patrolControl(name: string) {
    if (patrol && !patrol.paused && now() >= (patrol.retryAt || 0) && patrol.points[patrol.point])
      return {
        id: patrolControlId(patrol),
        kind: "patrol",
        allowPhoenixAssist: true,
        destination: patrol.points[patrol.point],
        revision: patrol.revisions[name],
      };
    return null;
  }
  publish();
  return {
    report,
    tick,
    start,
    stop,
    control,
    owns: () => !!(encounter || patrol || farmingReturn.moving()),
    patrolAcquisitionAllowed: () => !!patrol && !patrol.paused && !protectedActivity(),
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
