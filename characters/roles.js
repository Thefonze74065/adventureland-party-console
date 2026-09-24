// Generated from TypeScript; run npm run build:runtime -- --publish. Do not edit.
"use strict";
(() => {
  // runtime/characters/classes/mage.ts
  var role = {
    name: "mage",
    combat: true,
    beforeAttack: async function() {
      return await sharedRoutine.energizeLowestMana(0.35);
    },
    usePotion: async function() {
      return await sharedRoutine.useRecoveryPotion({ hpBelow: 0.5, mpBelow: 0.2, priority: "hp" });
    }
  };

  // runtime/characters/classes/priest.ts
  function curseReady(target) {
    if (target.mtype === "tinyp") return false;
    if (target.s?.cursed) return false;
    if (sharedRoutine.combatSkillReady && !sharedRoutine.getAbtestingMode()) return sharedRoutine.combatSkillReady("curse", target, "damage");
    return legacyCurseReady(target);
  }
  function legacyCurseReady(target) {
    return character.mp >= (G.skills.curse.mp ?? 0) && !is_on_cooldown("curse") && is_in_range(target, "curse") && can_use("curse") && sharedRoutine.allowsTarget(target);
  }
  var role2 = {
    name: "priest",
    combat: true,
    beforeTarget: async function() {
      if (await sharedRoutine.absorbSinsBelow(1)) return true;
      return await sharedRoutine.healPartyBelow(0.9);
    },
    usePotion: async function() {
      return await sharedRoutine.useRecoveryPotion({ hpBelow: 0.5, mpBelow: 0.2, priority: "hp" });
    },
    beforeAttack: async function(target) {
      if (sharedRoutine.getFarmingMode() === "scatter") return false;
      if (!target || character.max_mp <= 0 || character.mp / character.max_mp <= 0.5) return false;
      if (!sharedRoutine.isPartyHealthy(0.9) || !sharedRoutine.isCurrentPartyTarget(target))
        return false;
      if (!curseReady(target)) return false;
      if (sharedRoutine.castCombatSkill && !sharedRoutine.getAbtestingMode()) return sharedRoutine.castCombatSkill("curse", target, "damage");
      await use_skill("curse", target);
      return true;
    }
  };

  // runtime/characters/classes/warrior-combat.ts
  function basherEquipped() {
    const weapon = character.slots?.mainhand;
    return !!weapon && G.items[weapon.name]?.wtype === "basher";
  }
  function canStomp() {
    const skill = G.skills.stomp;
    if (!basherEquipped() || !skill) return false;
    return character.max_mp > 0 && character.mp / character.max_mp >= 0.25 && character.mp >= (skill.mp ?? 0) && !is_on_cooldown("stomp") && can_use("stomp");
  }
  function nearbyTargets(target) {
    const range = Number(G.skills.stomp?.range) || 400;
    return Object.values(parent.entities || {}).filter(
      (entity) => entity && entity.type === "monster" && entity.visible && !entity.dead && entity.mtype === target.mtype && Math.hypot(entity.x - character.x, entity.y - character.y) <= range
    ).length;
  }
  async function approach(target) {
    return !is_in_range(target) && await sharedRoutine.dashToward(target);
  }
  async function scatterAttack(target) {
    if (nearbyTargets(target) >= 2 && canStomp()) {
      await use_skill("stomp");
      return true;
    }
    return approach(target);
  }
  function mayTaunt(target) {
    if (!sharedRoutine.isLeader?.()) return false;
    if (character.level < (G.skills.taunt?.level || 0)) return false;
    target = get_entity(target.id) || target;
    return tauntTarget(target) && tauntReady(target);
  }
  function tauntTarget(target) {
    if (!target || target.mtype === "tinyp" || target.type !== "monster") return false;
    const passivePorcupine = target.mtype === "porcupine" && !target.target;
    return target.target !== character.name && (passivePorcupine || sharedRoutine.isAttackingPartyMember(target)) && (!sharedRoutine.allowsTarget || sharedRoutine.allowsTarget(target));
  }
  function tauntReady(target) {
    if (sharedRoutine.combatSkillReady) return sharedRoutine.combatSkillReady("taunt", target, "survival");
    return character.mp >= (G.skills.taunt.mp ?? 0) && !is_on_cooldown("taunt") && is_in_range(target, "taunt");
  }

  // runtime/characters/classes/warrior.ts
  async function taunt(target) {
    if (sharedRoutine.castCombatSkill) return sharedRoutine.castCombatSkill("taunt", target, "survival");
    const id = sharedRoutine.queueEvidence?.(target, "pending") || void 0;
    try {
      await use_skill("taunt", target);
      sharedRoutine.queueEvidence?.(target, "engaged", id);
    } catch (error) {
      if (id) sharedRoutine.queueEvidence?.(target, "rejected", id);
      throw error;
    }
  }
  function partyTarget() {
    return sharedRoutine.getEventTarget() || sharedRoutine.getNearestPartyAttacker() || sharedRoutine.getNearestPartyTarget() || (sharedRoutine.shouldFollowLeader() ? sharedRoutine.getLeaderTarget() || sharedRoutine.getEngagedTarget() : sharedRoutine.getPreferredTarget());
  }
  var role3 = {
    name: "warrior",
    combat: true,
    beforeTarget: async function() {
      return await sharedRoutine.emergencyWarriorStomp();
    },
    chooseTarget: function() {
      const scatterBreak = sharedRoutine.getScatterBreakTarget();
      if (sharedRoutine.hasScatterBreakTarget()) {
        const currentTarget = sharedRoutine.getEngagedTarget();
        if (currentTarget || scatterBreak) return currentTarget || scatterBreak;
      }
      if (sharedRoutine.getFarmingMode() === "scatter")
        return sharedRoutine.getEventTarget() || sharedRoutine.getScatterTarget();
      return partyTarget();
    },
    beforeAttack: async function(target) {
      if (target.mtype === "porcupine" && mayTaunt(target)) {
        await taunt(target);
        return true;
      }
      if (sharedRoutine.getFarmingMode() === "scatter") return scatterAttack(target);
      if (mayTaunt(target)) await taunt(target);
      if (sharedRoutine.allowsTarget && !sharedRoutine.allowsTarget(target)) return false;
      return approach(target);
    },
    usePotion: async function() {
      if (!sharedRoutine.isLeader?.()) return false;
      const threat = sharedRoutine.getNearestPartyAttacker();
      if (!threat || character.mp >= (G.skills.taunt.mp ?? 0)) return false;
      return await sharedRoutine.useRecoveryPotion({ force: "mp" });
    }
  };

  // runtime/characters/classes/ranger.ts
  var role4 = {
    name: "ranger",
    combat: true,
    beforeAttack: (target) => sharedRoutine.skillOffense?.(target) ?? Promise.resolve(false)
  };

  // runtime/characters/classes/rogue.ts
  var role5 = {
    name: "rogue",
    combat: true,
    beforeTarget: () => sharedRoutine.skillSupport?.() ?? Promise.resolve(false),
    beforeAttack: (target) => sharedRoutine.skillOffense?.(target) ?? Promise.resolve(false)
  };

  // runtime/characters/classes/paladin.ts
  var role6 = {
    name: "paladin",
    combat: true,
    beforeTarget: () => sharedRoutine.skillSupport?.() ?? Promise.resolve(false),
    beforeAttack: (target) => sharedRoutine.skillOffense?.(target) ?? Promise.resolve(false)
  };

  // runtime/characters/classes/merchant.ts
  var role7 = {
    name: "merchant",
    combat: true,
    // Use current equipment for events; never acquire ordinary farming targets.
    chooseTarget: () => sharedRoutine.getEventTarget()
  };

  // runtime/combat/passive-travel.ts
  function passiveStopRequired(settings, mtype) {
    const rule = settings?.rules[mtype];
    return !!rule?.enabled && rule.keepMoving === false;
  }

  // runtime/combat/trace.ts
  function installCombatTrace(root, shared) {
    const entries = root.__partyCombatTrace || [];
    root.__partyCombatTrace = entries;
    let signature = "";
    const timer = setInterval(() => {
      const next = shared.combatTraceSnapshot?.();
      if (!next) return;
      const key = JSON.stringify(next);
      if (key === signature) return;
      signature = key;
      entries.push({ at: Date.now(), ...next });
      while (entries.length > 160) entries.shift();
    }, 250);
    return { stop: () => clearInterval(timer) };
  }

  // runtime/combat/entity-refresh.ts
  function createEntityRefresh(ports) {
    let context = "", accepted = 0, stalledAt = null;
    let requestedAt = -Infinity, requests = 0;
    function tick(sample) {
      const now = ports.now();
      if (!sample.enabled || !sample.target) {
        stalledAt = null;
        return;
      }
      if (context !== sample.context || accepted !== sample.accepted || stalledAt === null) {
        context = sample.context;
        accepted = sample.accepted;
        stalledAt = now;
      }
      if (now - stalledAt < 5e3 || now - requestedAt < 1e4) return;
      requestedAt = now;
      if (!ports.request()) return;
      ports.report({
        at: now,
        target: sample.target,
        requests: ++requests,
        reason: "no accepted basic attack for five seconds; requested full entity snapshot"
      });
    }
    return { tick };
  }

  // runtime/characters/roles/monster-attack-policy.ts
  var reflectors = /* @__PURE__ */ new Set(["slenderman", "tiger", "goblin"]);
  function monsterAttackBlock(monster, damageType, range) {
    if (monster === "porcupine" && damageType !== "magical" && damageType !== "pure" && !(Number.isFinite(range) && range >= 75))
      return "Porcupine damage return: physical attacks require range >= 75";
    if (reflectors.has(monster ?? "") && damageType !== "physical" && damageType !== "pure")
      return "Monster reflection: magical basic attacks disabled";
    return null;
  }

  // runtime/characters/roles/porcupine-equipment.ts
  function createPorcupineEquipment(ports, memory = {}) {
    let active = true;
    const copyHands = () => ({
      mainhand: ports.fingerprint(ports.hands().mainhand),
      offhand: ports.fingerprint(ports.hands().offhand)
    });
    const matches = (hands) => ports.same(ports.hands().mainhand, hands.mainhand) && ports.same(ports.hands().offhand, hands.offhand);
    function relinquish() {
      memory.suppressedTarget = memory.target;
      delete memory.session;
    }
    function owned(session) {
      if (!active || memory.session !== session) return false;
      if (matches(session.expected)) return true;
      relinquish();
      return false;
    }
    function find(item) {
      const index = ports.items().findIndex((candidate) => ports.same(candidate, item));
      if (index < 0) throw new Error("Saved porcupine equipment is missing from inventory: " + item.name);
      return index;
    }
    async function equip2(item, slot, session) {
      if (!owned(session)) return;
      await ports.equip(find(item), slot);
      session.expected = copyHands();
      if (!ports.same(ports.hands()[slot], item)) throw new Error("Game did not equip " + item.name);
    }
    async function swap(session) {
      if (!owned(session) || session.restoring) return;
      if (ports.twoHanded(session.bow) && ports.hands().offhand) {
        if (!ports.items().some((item) => !item)) throw new Error("Porcupine bow needs inventory space for offhand");
        await ports.unequip("offhand");
        session.expected = copyHands();
        if (ports.hands().offhand) throw new Error("Game did not clear offhand for porcupine bow");
      }
      if (owned(session) && !session.restoring) await equip2(session.bow, "mainhand", session);
    }
    async function restore(session) {
      if (!owned(session)) return;
      if (session.original.mainhand && !ports.same(ports.hands().mainhand, session.original.mainhand))
        await equip2(session.original.mainhand, "mainhand", session);
      if (!owned(session)) return;
      if (session.original.offhand && !ports.same(ports.hands().offhand, session.original.offhand))
        await equip2(session.original.offhand, "offhand", session);
      if (owned(session) && matches(session.original)) delete memory.session;
    }
    function run(operation) {
      if (!active || memory.pending || ports.now() < (memory.retryAt || 0)) return;
      const pending = operation().catch((error) => {
        memory.retryAt = ports.now() + 2e3;
        ports.report(String(error instanceof Error ? error.message : error));
      }).finally(() => {
        if (memory.pending === pending) delete memory.pending;
      });
      memory.pending = pending;
    }
    function needsBow(target, damageType, range, allowed) {
      return allowed && !!target && target.id !== memory.suppressedTarget && target.mtype === "porcupine" && !!ports.hands().mainhand && !!monsterAttackBlock(target.mtype, damageType, range) && ports.now() >= (memory.retryAt || 0);
    }
    function continueSession(session, target, allowed) {
      if (!owned(session)) return;
      if (session.restoring) run(() => restore(session));
      else if (allowed && target?.mtype === "porcupine" && !ports.same(ports.hands().mainhand, session.bow))
        run(() => swap(session));
    }
    function beginSwap() {
      const bow = ports.items().map((item, index) => ({ item, index })).filter((entry) => !!entry.item && ports.usableBow(entry.item)).sort((a, b) => (Number(b.item.level) || 0) - (Number(a.item.level) || 0) || a.index - b.index)[0]?.item;
      if (!bow) {
        memory.retryAt = ports.now() + 2e3;
        ports.report("Porcupine melee blocked: no usable inventory bow");
        return;
      }
      const next = { original: copyHands(), expected: copyHands(), bow: ports.fingerprint(bow), restoring: false };
      memory.session = next;
      run(() => swap(next));
    }
    return {
      tick(target, damageType, range, allowed) {
        if (!active || memory.pending) return;
        if (target) memory.target = target.id;
        const session = memory.session;
        if (session) {
          continueSession(session, target, allowed);
          return;
        }
        if (needsBow(target, damageType, range, allowed)) beginSwap();
      },
      depart(purpose) {
        if (purpose === "grouped-approach") return;
        memory.suppressedTarget = memory.target;
        if (!memory.session) return;
        memory.session.restoring = true;
        memory.retryAt = 0;
        run(() => restore(memory.session));
      },
      async manual() {
        relinquish();
        await memory.pending;
      },
      busy: () => !!memory.pending,
      stop() {
        active = false;
      }
    };
  }

  // runtime/characters/roles/porcupine-equipment-runtime.ts
  function installPorcupineEquipment(root) {
    const host = parent;
    const memory = host.__partyPorcupineEquipment ??= {};
    const data = G;
    const definition = () => data.classes[character.ctype];
    const classSupportsBow = () => !!definition()?.mainhand?.bow || !!definition()?.doublehand?.bow;
    const fingerprint = (item) => {
      if (!item) return null;
      const result = { name: item.name };
      for (const key of ["level", "p", "stat_type", "data", "rid", "b", "m", "l", "v"])
        if (item[key] !== void 0) result[key] = item[key];
      return result;
    };
    root.partyPorcupineEquipment?.stop();
    return root.partyPorcupineEquipment = createPorcupineEquipment({
      now: Date.now,
      hands: () => ({ mainhand: character.slots.mainhand, offhand: character.slots.offhand }),
      items: () => character.items,
      fingerprint,
      same: (item, wanted) => JSON.stringify(fingerprint(item)) === JSON.stringify(fingerprint(wanted)),
      usableBow(item) {
        const info = data.items[item.name];
        if (info?.wtype !== "bow") return false;
        const classes = typeof info.class === "string" ? [info.class] : info.class;
        return (!classes || classes.includes(character.ctype)) && classSupportsBow();
      },
      twoHanded: (item) => !!definition()?.doublehand?.[data.items[item.name]?.wtype || ""],
      equip: (index, slot) => Promise.resolve(equip(index, slot)),
      unequip: (slot) => Promise.resolve(unequip(slot)),
      report(message) {
        if (root.partyCombatState) {
          root.partyCombatState.error = message;
          root.partyCombatState.errorAt = Date.now();
        }
      }
    }, memory);
  }

  // runtime/coordinator/merchant/anniversary-control.ts
  function stagingWindow(event, now) {
    if (!event || event.active === false || event.live !== false) return false;
    const next = Number(event.next) || 0;
    return !!next && next - now <= 9e4 && next - now >= -15e3;
  }
  function liveRound(event, aborted, now) {
    if (!event || aborted[String(event.round)]) return false;
    return event.active !== false && event.live !== false && !!event.target && (!Number(event.expires) || Number(event.expires) > now);
  }
  function featuredFinished(event, merchant, live, now) {
    if (!live || event?.target !== merchant || !Number(event.expires)) return false;
    return now >= Number(event.expires) - 3e5 + 6e4;
  }
  function isFeatured(event, merchant, live, complete) {
    return live && event?.target === merchant && !complete;
  }
  function visitDue(event, status, live, featured, completed, retryAt, now) {
    return live && !featured && event?.available !== false && !!status?.anniversaryVisit && !completed && retryAt <= now;
  }
  function movementReserved(preWindow, live, complete) {
    return preWindow || live && !complete;
  }
  function busy(state) {
    return !!state.busy || state.mode === "kiss-active";
  }
  function completedVisit(state, event) {
    return state.mode === "complete" && (state.completedRound === void 0 || state.completedRound === String(event?.round));
  }
  function claimedVisit(event, claimedRound) {
    return claimedRound !== void 0 && claimedRound === String(event?.round);
  }
  function merchantAnniversaryControl(merchant, enabled, status, aborted, now, claimedRound) {
    const event = enabled ? status?.anniversaryServer : void 0;
    const state = status?.anniversaryState || {};
    const preWindow = stagingWindow(event, now), live = liveRound(event, aborted, now);
    const complete = featuredFinished(event, merchant, live, now);
    const featured = isFeatured(event, merchant, live, complete);
    const retryAt = Number(state.retryAt) || 0;
    const completed = completedVisit(state, event) || complete || claimedVisit(event, claimedRound);
    const kissDue = visitDue(event, status, live, featured, completed, retryAt, now);
    return {
      live,
      featured,
      kissDue,
      preWindow,
      reserved: movementReserved(preWindow, live, completed),
      busy: live && busy(state),
      retryAt,
      mode: state.mode || "idle"
    };
  }

  // runtime/characters/roles/types.ts
  function errorReason(error) {
    if (error && typeof error === "object") {
      if ("reason" in error && typeof error.reason === "string") return error.reason;
      if ("message" in error && typeof error.message === "string") return error.message;
    }
    return String(error);
  }

  // runtime/characters/roles/crab-range.ts
  function mismatch(s) {
    return s.mtype === "crab" && [
      s.target.width,
      s.target.height,
      s.expected.width,
      s.expected.height,
      s.nativeDistance,
      s.correctedDistance
    ].every(Number.isFinite) && (s.target.width > s.expected.width + 1 || s.target.height > s.expected.height + 1);
  }
  function createCrabRangeRecovery() {
    let diagnostic = null;
    let retryAt = 0;
    function reset(reason = "target changed") {
      retryAt = 0;
      if (diagnostic) {
        diagnostic.active = false;
        diagnostic.reason = reason;
      }
    }
    function distance2(sample, now) {
      if (!sample) return null;
      if (!diagnostic?.active) return null;
      if (sample.targetId !== diagnostic.sample.targetId || sample.map !== diagnostic.sample.map) return null;
      else if (now >= diagnostic.expiresAt) reset("expired; probing native behavior");
      else if (!mismatch(sample)) reset("native geometry agrees");
      return diagnostic.active ? sample.correctedDistance : null;
    }
    return {
      reset,
      distance: distance2,
      select(sample, now) {
        if (diagnostic && (sample?.targetId !== diagnostic.sample.targetId || sample?.map !== diagnostic.sample.map)) reset();
        distance2(sample, now);
      },
      diagnostic: () => diagnostic,
      blocked(sample, now) {
        const corrected = distance2(sample, now);
        return corrected !== null && (now < retryAt || corrected > sample.range);
      },
      reject(sample, rejection, now) {
        if (!mismatch(sample) || sample.nativeDistance > sample.range || sample.correctedDistance <= sample.range) return;
        if (!diagnostic?.active || now >= diagnostic.expiresAt) {
          diagnostic = { active: true, expiresAt: now + 3e4, reason: "crab geometry mismatch", sample, rejection };
        } else {
          diagnostic.sample = sample;
          diagnostic.rejection = rejection;
        }
        retryAt = now + 500;
      }
    };
  }

  // runtime/characters/roles/attack-controller.ts
  function createAttackController(ports) {
    let flight = null;
    let lastSuccessfulTarget = null;
    let timer = null;
    let burstTimer = null;
    let running = false, retryAt = 0, dueAt = 0;
    const clock = () => {
      const client = parent;
      const value = Number(client.next_skill?.attack);
      return Number.isFinite(value) ? value : null;
    };
    const remaining = () => Math.max(0, (clock() ?? retryAt) - Date.now());
    function cancelSlots() {
      if (burstTimer !== null) clearTimeout(burstTimer);
      burstTimer = null;
      if (flight) flight.slotsDone = true;
    }
    function schedule(delay) {
      if (!running) return;
      if (timer !== null) clearTimeout(timer);
      dueAt = Date.now() + Math.max(1, delay);
      timer = setTimeout(() => {
        timer = null;
        tick();
      }, Math.max(1, delay));
    }
    const recovery = createCrabRangeRecovery();
    const sample = (target) => sharedRoutine.describeAttackRange?.(target) ?? null;
    const correctedDistance = (target) => recovery.distance(sample(target), Date.now());
    if (typeof sharedRoutine !== "undefined") sharedRoutine.correctedCombatDistance = correctedDistance;
    function rejected(attempt, error) {
      if (!confirmed(attempt)) return;
      if (errorReason(error) === "too_far" && attempt.range && Date.now() - attempt.sentAt <= 2e3) {
        recovery.reject(attempt.range, error, Date.now());
        ports.state().rangeRecovery = recovery.diagnostic();
      }
      ports.report(error);
    }
    function reserveHealing() {
      if (!sharedRoutine.basicAttackReserved?.()) return false;
      ports.state().skippedAttack = "priest healing priority";
      Promise.resolve(sharedRoutine.healPartyBelow(0.9)).catch(ports.report);
      return true;
    }
    function releaseExpired(target) {
      if (!flight || Date.now() < flight.expires) return;
      const ready = typeof is_on_cooldown === "function" ? !is_on_cooldown("attack") : target && can_attack(target);
      if (ready) {
        cancelSlots();
        flight = null;
      }
    }
    function confirmed(attempt) {
      return passingConfirmed(attempt) && ports.active() && attempt.epoch === ports.epoch() && ports.selected() === attempt.targetId && !!ports.target() && (!sharedRoutine.combatTargetRevision || attempt.revision === sharedRoutine.combatTargetRevision());
    }
    function passingConfirmed(attempt) {
      if (!attempt.passing) return true;
      const target = ports.target();
      return !!target && !!ports.passing?.(target);
    }
    function permitted(target) {
      if (ports.equipmentBusy?.()) {
        ports.state().skippedAttack = "weapon equipment change in progress";
        return false;
      }
      const client = parent;
      if (client.is_disabled?.(character)) {
        ports.state().skippedAttack = "character disabled";
        return false;
      }
      if (!ports.passing?.(target) && sharedRoutine.groupedAttackAllowed && !sharedRoutine.groupedAttackAllowed(target)) {
        ports.state().skippedAttack = "waiting for group readiness and target commitment";
        return false;
      }
      const actor = character;
      const blocked2 = monsterAttackBlock(target.mtype, actor.damage_type, Number(character.range));
      if (blocked2) {
        ports.state().skippedAttack = blocked2;
        return false;
      }
      if (sharedRoutine.rareAttackAllowed && !sharedRoutine.rareAttackAllowed(target, "attack")) {
        ports.state().skippedAttack = "Fairy deployment or attack policy";
        return false;
      }
      return true;
    }
    function send(target) {
      if (!permitted(target)) return;
      if (ports.passing?.(target) && ports.preparePassing?.(target) === false) {
        ports.state().skippedAttack = "waiting for passing encounter acknowledgement";
        return;
      }
      const attempt = {
        passing: !!ports.passing?.(target),
        pending: 0,
        success: false,
        slotsDone: false,
        epoch: ports.epoch(),
        targetId: target.id,
        revision: sharedRoutine.combatTargetRevision?.() ?? null,
        sentAt: Date.now(),
        range: sample(target),
        expires: Date.now() + Math.max(2e3, 2e3 / (Number(character.frequency) || 1))
      };
      flight = attempt;
      ports.state().skippedAttack = null;
      ports.state().stage = "attacking";
      const stats = ports.state().attackTiming ??= { bursts: 0, attempts: 0, accepted: 0, cooldownRejections: 0, timeouts: 0, lastOffsets: [] };
      stats.bursts++;
      stats.lastOffsets = [];
      const deadline = clock() ?? Date.now();
      const end = clock() === null ? Date.now() + 4 : deadline + 2;
      const attemptOnce = () => {
        if (flight !== attempt || !confirmed(attempt) || !ports.allowed() || sharedRoutine.basicAttackReserved?.() || !is_in_range(target) || !permitted(target)) {
          cancelSlots();
          return;
        }
        attempt.pending++;
        stats.attempts++;
        stats.lastOffsets.push(Date.now() - deadline);
        if (attempt.passing && ports.preparePassing?.(target) === false) {
          attempt.pending--;
          cancelSlots();
          return;
        }
        const action = attempt.passing ? null : sharedRoutine.queueEvidence?.(target, "pending");
        try {
          Promise.resolve(attack(target)).then(() => {
            if (flight !== attempt || attempt.epoch !== ports.epoch() || !ports.active() || attempt.success) return;
            attempt.success = true;
            cancelSlots();
            stats.accepted++;
            const client = parent;
            const samples = (client.pings || []).filter((p) => Number.isFinite(p) && p >= 0);
            if (samples.length && typeof reduce_cooldown === "function" && (ports.state().lastHealAt ?? 0) < attempt.sentAt)
              reduce_cooldown("attack", Math.min(remaining(), Math.min(...samples)));
            retryAt = clock() === null ? Date.now() + 1e3 / (Number(character.frequency) || 1) : 0;
            if (confirmed(attempt)) {
              if (!attempt.passing) sharedRoutine.noteAttack(target);
              lastSuccessfulTarget = target.id;
              if ((ports.state().errorAt ?? 0) <= attempt.sentAt) ports.state().error = null;
            }
          }, (error) => {
            if (action) sharedRoutine.queueEvidence?.(target, "rejected", action);
            if (flight !== attempt) return;
            if (errorReason(error) === "cooldown") stats.cooldownRejections++;
            else {
              cancelSlots();
              rejected(attempt, error);
            }
          }).finally(() => {
            attempt.pending--;
            if (flight === attempt && attempt.slotsDone && !attempt.pending) finish();
          });
        } catch (error) {
          if (action) sharedRoutine.queueEvidence?.(target, "rejected", action);
          attempt.pending--;
          cancelSlots();
          rejected(attempt, error);
        }
      };
      const finish = () => {
        if (flight !== attempt) return;
        flight = null;
        if (!attempt.success) retryAt = Math.max(retryAt, Date.now() + 100);
        schedule(Math.max(remaining() - 2, retryAt - Date.now(), 1));
      };
      let count = 0;
      const slot = () => {
        burstTimer = null;
        if (flight !== attempt || attempt.slotsDone) return;
        attemptOnce();
        count++;
        if (count >= 5 || Date.now() >= end || attempt.slotsDone) {
          attempt.slotsDone = true;
          if (!attempt.pending) finish();
          return;
        }
        burstTimer = setTimeout(slot, 1);
      };
      slot();
    }
    function attackTarget(target) {
      if (flight && Date.now() >= flight.expires && can_attack(target)) {
        cancelSlots();
        flight = null;
      }
      if (flight) {
        ports.state().skippedAttack = "attack pending";
        return;
      }
      if (ports.skillBusy?.()) {
        ports.state().skippedAttack = "skill attack pending";
        return;
      }
      if (reserveHealing()) return;
      if (!ports.passing?.(target) && !ports.equipmentBusy?.()) {
        const alternative = ports.skillAttack?.(target);
        if (alternative) {
          const epoch = ports.epoch();
          ports.state().stage = "skill attack";
          void alternative.then((accepted) => {
            if (epoch !== ports.epoch() || !ports.active()) return;
            if (accepted) lastSuccessfulTarget = target.id;
            retryAt = Date.now() + (accepted ? 1 : 100);
            schedule(Math.max(remaining(), retryAt - Date.now()));
          }).catch(ports.report);
          return;
        }
      }
      if (recovery.blocked(sample(target), Date.now())) {
        ports.state().skippedAttack = "crab range recovery";
        return;
      }
      if (!can_attack(target) && !(clock() !== null && remaining() <= 2 && is_in_range(target))) {
        ports.state().skippedAttack = is_in_range(target) ? "cooldown" : "range";
        return;
      }
      send(target);
    }
    function tick() {
      try {
        sharedRoutine.correctedCombatDistance = correctedDistance;
        const target = ports.target();
        if (flight && ports.selected() !== flight.targetId) {
          cancelSlots();
          flight = null;
        }
        recovery.select(target ? sample(target) : null, Date.now());
        if (flight && Date.now() >= flight.expires) {
          const stats = ports.state().attackTiming;
          if (stats) stats.timeouts++;
        }
        releaseExpired(target);
        if (flight && (!confirmed(flight) || !ports.allowed() || sharedRoutine.basicAttackReserved?.())) cancelSlots();
        if (ports.allowed() && !flight && reserveHealing()) return;
        if (!target || !ports.allowed()) {
          ports.state().skippedAttack = "no eligible target or combat blocked";
          return;
        }
        if (Date.now() < retryAt || remaining() > 2) return;
        attackTarget(target);
      } catch (error) {
        cancelSlots();
        flight = null;
        ports.report(error);
      } finally {
        schedule(flight ? Math.max(1, flight.expires - Date.now()) : Math.max(remaining() > 2 ? remaining() - 2 : 100, retryAt - Date.now()));
      }
    }
    return {
      hasStarted(targetId) {
        return flight?.targetId === targetId || lastSuccessfulTarget === targetId;
      },
      reset() {
        cancelSlots();
        flight = null;
        lastSuccessfulTarget = null;
        retryAt = 0;
        recovery.reset("runtime reset");
      },
      start() {
        running = true;
        schedule(Math.max(1, remaining() - 2));
      },
      stop() {
        running = false;
        cancelSlots();
        flight = null;
        if (timer !== null) clearTimeout(timer);
        timer = null;
      },
      wake() {
        const delay = Math.max(1, remaining() - 2, retryAt - Date.now());
        if (timer === null || Date.now() + delay < dueAt) schedule(delay);
      },
      tick
    };
  }

  // runtime/characters/skills/budget.ts
  function createManaBudget() {
    let last = null;
    let credit = 0;
    const recovery = [];
    return {
      observe(now, mp, surplus, cap) {
        if (!last) credit = cap;
        else {
          const recovered = Math.max(0, mp - last.mp);
          if (recovered) recovery.push({ at: now, amount: recovered });
          while (recovery.length && recovery[0].at < now - 3e4) recovery.shift();
          const rate = recovery.reduce((sum, r) => sum + r.amount, 0) / 30 + Math.max(0, surplus) / 30;
          credit += Math.max(0, Math.min(30, (now - last.at) / 1e3)) * rate;
        }
        credit = Math.min(Math.max(0, cap), credit);
        last = { at: now, mp };
        return credit;
      },
      debit(amount) {
        credit = Math.max(0, credit - amount);
      },
      reset() {
        last = null;
        credit = 0;
        recovery.length = 0;
      }
    };
  }

  // runtime/characters/skills/types.ts
  var health = (actor) => actor.hp / Math.max(1, actor.max_hp);
  var decision = (skill, targets = [], category = "damage", reason = skill) => ({ skill, targets, category, reason });

  // runtime/characters/skills/damage.ts
  function rawDamage(w, id, target) {
    const s = w.skills[id];
    if (id === "shield_slam") return shieldDamage(w);
    if (id === "purify") return (s?.damage || 2e3) + purifiable(w, target).length * 400;
    return s?.damage ?? w.actor.attack * (s?.damage_multiplier ?? 1);
  }
  function purifiable(w, target) {
    return Object.keys(target.s).filter((id) => {
      const c = w.condition(id);
      return target.s[id]?.citizens || (c?.buff || c?.debuff) && !c?.persistent;
    });
  }
  function shieldDamage(w) {
    const s = w.skills.shield_slam;
    return w.actor.attack * (s?.damage_multiplier || 3) + Math.min(Math.max(0, w.actor.armor), s?.armor_cap || 1e3) * (s?.armor_multiplier || 12);
  }
  function mitigation(w, id, target) {
    const s = w.skills[id];
    const type = id === "attack" ? w.actor.damage_type : s?.damage_type;
    if (type === "pure") return 1;
    const defense = type === "magical" ? Number(target.resistance) - Number(w.actor.rpiercing || 0) : Number(target.armor) - Number(w.actor.apiercing || 0) - Number(s?.apiercing || 0);
    return w.damageMultiplier(Number.isFinite(defense) ? defense : 0);
  }
  function damage(w, id, target, minimum = false) {
    const s = w.skills[id];
    let result = rawDamage(w, id, target);
    if (!minimum && (id === "attack" || s?.procs)) result *= criticalMultiplier(w);
    result += stackDamage(w, target);
    result *= mitigation(w, id, target) * targetMultiplier(w, target);
    return minimum ? result * 0.9 : result;
  }
  function stackDamage(w, target) {
    return w.actor.ctype === "rogue" ? Math.min(w.skills.stack?.max || 2e3, (target.s.stack?.s || 0) + 1) : 0;
  }
  function targetMultiplier(w, target) {
    const fortitude = Number(Reflect.get(target, "for")) || 0;
    const amp = Number(Reflect.get(target, "incdmgamp")) || 0;
    return w.damageMultiplier(fortitude * 5) * (1 + amp / 100);
  }
  function criticalMultiplier(w) {
    return 1 + Math.min(1, (w.actor.crit || 0) / 100) * ((w.actor.critdamage || 0) / 100 + 1);
  }
  var usefulDamage = (w, id, target) => Math.min(Math.max(0, target.hp - w.incoming(target)), damage(w, id, target));
  function incomingDps(w, actor, extraTarget) {
    return w.context.monsters.filter((m) => m.target === actor.name || !!extraTarget && m.target === extraTarget).reduce((sum, m) => {
      if (!Number.isFinite(m.attack) || !Number.isFinite(m.frequency)) return Infinity;
      const defense = m.damage_type === "magical" ? actor.resistance : actor.armor;
      return sum + m.attack * Number(m.frequency) * w.damageMultiplier(Number(defense) || 0) * 1.1;
    }, 0);
  }
  function safeTransfer(w, source, fraction = 1) {
    if (w.now - w.context.observedAt > 1500) return false;
    const current = incomingDps(w, w.actor);
    const added = fraction === 1 ? incomingDps(w, w.actor, source.name) - current : incomingDps(w, source) * fraction;
    return w.actor.hp - 2 * (current + added) > w.actor.max_hp * 0.3;
  }
  function endangered(w, ally) {
    const dps = incomingDps(w, ally);
    return dps > 0 && (health(ally) < 0.6 || ally.hp - 2 * dps < ally.max_hp * 0.3);
  }

  // runtime/characters/skills/eligibility.ts
  function cost(w, id) {
    const mp = id === "heal" ? w.actor.mp_cost : w.skills[id]?.mp;
    return Math.ceil(Math.max(0, Number(mp) || 0) * (1 - Math.min(100, Math.max(0, w.actor.mp_reduction || 0)) / 100));
  }
  function equipment(w, s) {
    const main = w.actor.slots.mainhand, off = w.actor.slots.offhand;
    const allowed = s.wtype ? [s.wtype].flat() : [];
    const weapon = main ? w.item(main.name)?.wtype : void 0;
    if (allowed.length && !allowed.includes(weapon || "")) return false;
    if (!offhandMatches(w, s, off?.name)) return false;
    return slotsMatch(w, s);
  }
  function offhandMatches(w, s, name) {
    return !s.offhand_type || !!name && w.item(name)?.type === s.offhand_type;
  }
  function slotsMatch(w, s) {
    return !s.slot || s.slot.some(([slot, name]) => {
      const item = w.actor.slots[slot];
      if (item?.name !== name) return false;
      return (item.charges || 0) >= (w.item(name)?.charge || 0);
    });
  }
  function unlocked(w, id) {
    const s = w.skills[id];
    if (!s || s.type === "passive" || s.consume) return false;
    if (s.class && !s.class.includes(w.actor.ctype)) return false;
    if (w.actor.level < (s.level || 0) || !equipment(w, s)) return false;
    return Object.entries(s.requirements || {}).every(([key, value]) => Number(Reflect.get(w.actor, key)) >= Number(value));
  }
  function reserve(w) {
    const availableCost = (id) => unlocked(w, id) ? cost(w, id) : 0;
    const c = w.actor.ctype;
    if (c === "paladin") return Math.max(w.actor.max_mp * 0.3, 2 * availableCost("selfheal") + availableCost("guardians_oath"));
    if (c === "priest") return Math.max(w.actor.max_mp * 0.35, 2 * cost(w, "heal") + availableCost("partyheal"));
    if (c === "warrior") return (w.context.leader === w.actor.name ? availableCost("taunt") : 0) + Math.max(availableCost("stomp"), availableCost("hardshell"));
    return w.actor.max_mp * 0.2;
  }
  function targetBlock(w, d) {
    const s = w.skills[d.skill];
    for (const target of d.targets) {
      if (!living(target)) return "target dead";
      if (s.no_self && target.name === w.actor.name) return "cannot target self";
      if (!w.range(target, d.skill)) return "out of range";
      if (s.hostile && !hostileAllowed(w, d, target)) return "unauthorized or immune target";
    }
    return safePull(w, d) ? null : "unsafe combined pull";
  }
  var living = (target) => !target.dead && !target.rip && target.hp > 0;
  function hostileAllowed(w, d, target) {
    return w.allowed(target, d.skill) && (!target.immune || !!w.skills[d.skill]?.pierces_immunity);
  }
  function safePull(w, d) {
    if (w.context.mode !== "scatter" || !w.skills[d.skill]?.hostile) return true;
    const pulled = new Set(d.targets.filter((t) => !t.target).map((t) => t.id));
    if (!pulled.size) return true;
    const context = { ...w.context, monsters: w.context.monsters.map((m) => pulled.has(m.id) ? { ...m, target: w.actor.name } : m) };
    return w.actor.hp - incomingDps({ ...w, context }, w.actor) * 2 > w.actor.max_hp * 0.3;
  }
  function blocked(w, d, pending = 0) {
    if (w.context.mode === "blocked" || w.actor.rip) return "combat activity blocked";
    if (!ownsAggro(w, d)) return "leader owns aggro transfers";
    if (!unlocked(w, d.skill)) return "level, equipment, or requirements";
    const s = w.skills[d.skill];
    if (w.cooldown(d.skill) || w.cooldown(s.share || d.skill)) return "cooldown";
    return manaBlock(w, d, pending) || targetBlock(w, d);
  }
  function ownsAggro(w, d) {
    return !["absorb", "taunt", "agitate"].includes(d.skill) || w.context.leader === w.actor.name;
  }
  function manaBlock(w, d, pending) {
    const remaining = w.actor.mp - pending - cost(w, d.skill);
    if (remaining < 0) return "insufficient MP";
    if (d.category !== "survival" && remaining < reserve(w)) return "survival MP reserved";
    return null;
  }

  // runtime/characters/skills/offense.ts
  function attackChoices(w, primary) {
    const ids = w.actor.ctype === "ranger" ? ["piercingshot", "3shot", "5shot"] : w.actor.ctype === "rogue" ? ["fanofknives"] : [];
    return ids.map((id) => {
      const cap = w.skills[id]?.max_targets || (id === "5shot" || id === "fanofknives" ? 5 : id === "3shot" ? 3 : 1);
      const targets = [primary, ...w.context.monsters.filter((t) => t.id !== primary.id)].filter((t) => !blocked(w, decision(id, [t]))).sort((a, b) => Number(b.id === primary.id) - Number(a.id === primary.id) || usefulDamage(w, id, b) - usefulDamage(w, id, a) || a.id.localeCompare(b.id)).slice(0, cap);
      return decision(id, targets);
    }).filter((d) => d.targets.some((t) => t.id === primary.id));
  }
  function bestAttack(w, primary, affordable) {
    const baseline = usefulDamage(w, "attack", primary);
    const options = attackChoices(w, primary).filter(affordable).map((d) => ({
      d,
      score: d.targets.reduce((sum, t) => sum + usefulDamage(w, d.skill, t), 0)
    }));
    options.sort((a, b) => b.score - a.score || cost(w, a.d.skill) - cost(w, b.d.skill));
    return options[0]?.score > baseline ? options[0].d : null;
  }
  function purifyUseful(w, target) {
    if (damage(w, "purify", target, true) >= target.hp) return true;
    return !purifiable(w, target).some((id) => w.condition(id)?.debuff || w.condition(id)?.bad);
  }
  function independentUseful(w, id, target) {
    const remaining = target.hp - w.incoming(target);
    if (remaining <= 0) return false;
    if (id === "purify") return purifyUseful(w, target);
    if (id === "huntersmark") return markUseful(w, target, remaining);
    if (id === "supershot") return remaining >= damage(w, id, target) * 0.5;
    return true;
  }
  function markUseful(w, target, remaining) {
    const owner = w.context.allies.filter((a) => a.ctype === "ranger" && a.mp >= cost(w, "huntersmark") && w.range(a, "huntersmark")).sort((a, b) => a.name.localeCompare(b.name))[0];
    return owner?.name === w.actor.name && !target.s?.marked && remaining >= damage(w, "attack", target) * Math.max(1, w.actor.frequency) * 3;
  }
  function damageChoices(w, target) {
    const classes = {
      ranger: ["huntersmark", "supershot"],
      rogue: ["mentalburst", "quickstab", "quickpunch"],
      paladin: ["purify", "shield_slam", "smash"]
    };
    const choices = (classes[w.actor.ctype] || []).filter((id) => independentUseful(w, id, target)).map((id) => decision(id, [target])).filter((d) => !blocked(w, d));
    const score = (d) => {
      if (d.skill === "mentalburst" && damage(w, d.skill, target, true) >= target.hp) return Infinity;
      if (d.skill === "huntersmark") return Number.MAX_SAFE_INTEGER;
      const divisor = w.context.mode === "event" ? (w.skills[d.skill]?.cooldown || 1e3) / 1e3 : Math.max(1, cost(w, d.skill));
      return usefulDamage(w, d.skill, target) / divisor;
    };
    return choices.sort((a, b) => score(b) - score(a));
  }

  // runtime/characters/skills/protection.ts
  function absorbDecision(w) {
    if (w.actor.ctype !== "priest" || w.context.leader !== w.actor.name) return null;
    if (w.actor.mp - cost(w, "absorb") < cost(w, "heal")) return null;
    const ally = w.context.allies.filter((a) => a.name !== w.actor.name && w.context.monsters.some((m) => m.target === a.name) && safeTransfer(w, a)).sort((a, b) => health(a) - health(b) || a.name.localeCompare(b.name)).find((a) => w.range(a, "absorb"));
    return ally ? decision("absorb", [ally], "survival", "leader aggro rescue") : null;
  }
  function selfHeal(w) {
    const output = (w.skills.selfheal?.levels || [[0, w.skills.selfheal?.output || 400]]).filter(([level]) => level <= w.actor.level).at(-1)?.[1] || 400;
    if (health(w.actor) < 0.7 || w.actor.max_hp - w.actor.hp >= output * 0.8)
      return decision("selfheal", [], "survival", "self healing");
    return null;
  }
  function cleanse(w) {
    const candidates = w.context.allies.filter((a) => a.name !== w.actor.name && w.range(a, "cleansing_light")).filter((a) => Object.keys(a.s || {}).some((id) => w.condition(id)?.cleansable)).sort((a, b) => Number(endangered(w, b)) - Number(endangered(w, a)) || Number(b.name === w.context.leader) - Number(a.name === w.context.leader) || health(a) - health(b));
    const ally = candidates[0];
    if (!ally) return null;
    const urgent = endangered(w, ally) || Object.keys(ally.s).some((id) => ["stunned", "frozen", "deepfreezed", "tangled", "poisoned", "burned"].includes(id));
    return decision("cleansing_light", [ally], urgent ? "survival" : "maintenance", "cleanse harmful conditions");
  }
  function oath(w) {
    const outgoing = w.context.allies.some((a) => {
      const s = a.s?.guardians_oath;
      return s?.f === w.actor.name || s?.from === w.actor.name;
    });
    if (outgoing) return null;
    const ally = w.context.allies.filter((a) => a.name !== w.actor.name && !a.s?.guardians_oath).filter((a) => w.range(a, "guardians_oath") && endangered(w, a) && safeTransfer(w, a, 0.35)).sort((a, b) => health(a) - health(b) || Number(b.name === w.context.leader) - Number(a.name === w.context.leader))[0];
    return ally ? decision("guardians_oath", [ally], "survival", "protect endangered ally") : null;
  }
  function beacon(w) {
    const nearby = w.context.allies.filter((a) => w.range(a, "beacon_of_resolve"));
    if (nearby.some((a) => a.s?.beacon_of_resolve)) return null;
    const leader = nearby.find((a) => a.name === w.context.leader);
    const urgent = !!leader && leader.hp - incomingDps(w, leader) * 2 < leader.max_hp * 0.3;
    if (!urgent && nearby.filter((a) => incomingDps(w, a) > 0).length < 2) return null;
    return decision("beacon_of_resolve", [], urgent ? "survival" : "maintenance", "party defensive burst");
  }
  function shield(w) {
    const mana = !!w.actor.s?.mshield;
    const incoming = incomingDps(w, w.actor);
    if (mana && (health(w.actor) > 0.65 || w.actor.mp <= reserve(w)))
      return decision("mshield", [], "survival", "release mana shield");
    if (!mana && health(w.actor) < 0.4 && incoming > 0 && w.actor.mp > reserve(w))
      return decision("mshield", [], "survival", "emergency mana shield");
    return aetherShield(w, incoming);
  }
  function aetherShield(w, incoming) {
    const magic = w.context.monsters.some((m) => m.target === w.actor.name && m.damage_type === "magical");
    if (!w.actor.s.mshield && !w.actor.s.aether_shield && magic && w.actor.hp - incoming * 2 > w.actor.max_hp * 0.3 && w.actor.mp < w.actor.max_mp)
      return decision("aether_shield", [], "maintenance", "recover mana from magical wounds");
    return null;
  }
  function desiredAuras(w) {
    const threatening = w.context.monsters.filter((m) => w.context.allies.some((a) => a.name === m.target));
    const conditionPressure = w.context.allies.some((a) => Object.keys(a.s || {}).some((id) => w.condition(id)?.cleansable));
    if (conditionPressure) return ["warding", "bulwark", "sanctuary", "zeal"];
    const magical = threatening.filter((m) => m.damage_type === "magical").length > threatening.length / 2;
    return magical ? ["sanctuary", "zeal", "bulwark", "warding"] : ["bulwark", "zeal", "sanctuary", "warding"];
  }
  function aura(w) {
    if (!unlocked(w, "paladin_aura")) return null;
    const paladins = w.context.allies.filter((a) => a.ctype === "paladin" && a.level >= (w.skills.paladin_aura?.level || 60) && w.range(a, "paladin_aura")).sort((a, b) => Number(b.name === w.context.leader) - Number(a.name === w.context.leader) || b.level - a.level || a.name.localeCompare(b.name));
    const choices = desiredAuras(w);
    if (!paladins.some((a) => a.name === w.context.leader)) choices.unshift(...choices.splice(choices.indexOf("zeal"), 1));
    const state = choices[Math.max(0, paladins.findIndex((a) => a.name === w.actor.name)) % choices.length];
    const own = w.actor.s?.["paladin_aura_" + state];
    if (own && (own.f === w.actor.name || own.from === w.actor.name)) return null;
    return { ...decision("paladin_aura", [], "maintenance", "party aura coverage"), argument: state };
  }
  function paladinSupport(w) {
    return [selfHeal(w), shield(w), cleanse(w), oath(w), beacon(w), aura(w)].filter((d) => !!d);
  }
  function rogueSupport(w) {
    const rogues = w.context.allies.filter((a) => a.ctype === "rogue" && a.level >= 40).sort((a, b) => a.name.localeCompare(b.name));
    if (rogues[0]?.name !== w.actor.name) return [];
    const target = w.context.allies.find((a) => (!a.s?.rspeed || (a.s.rspeed.ms || 0) < 6e4) && w.range(a, "rspeed"));
    return target ? [decision("rspeed", [target], "maintenance", "maintain party swiftness")] : [];
  }
  function opener(w, target) {
    if (w.actor.ctype !== "rogue" || w.actor.s?.invis || w.actor.s?.marked) return null;
    if (target.target || w.context.monsters.some((m) => m.target === w.actor.name)) return null;
    return decision("invis", [], "maintenance", "unengaged opener");
  }

  // runtime/characters/skills/engine.ts
  function createSkillEngine(ports) {
    const budget = createManaBudget(), pending = /* @__PURE__ */ new Map();
    let epoch = 0, stopped = false, auraAt = -Infinity, auraState = "", openerPending = false;
    const failures = /* @__PURE__ */ new Map();
    function world() {
      const w = ports.world();
      for (const [id, p] of pending) if (p.until <= w.now && !w.cooldown(id)) pending.delete(id);
      return w;
    }
    const family = (w, id) => w.skills[id]?.share || id;
    function report(w, d, status, reason = d.reason) {
      ports.diagnostic({
        at: w.now,
        skill: d.skill,
        targets: d.targets.map((t) => t.id || t.name),
        category: d.category,
        reserve: reserve(w),
        reason,
        status
      });
    }
    function affordable(w, d) {
      const inFlight = [...pending.values()].reduce((n, p) => n + p.cost, 0);
      const reason = blocked(w, d, inFlight);
      if (reason) {
        report(w, d, "skipped", reason);
        return false;
      }
      if (pending.has(family(w, d.skill)) || (failures.get(d.skill) || 0) > w.now) return false;
      const cap = Math.max(0, ...Object.keys(w.skills).map((id) => id).filter((id) => unlocked(w, id) && cost(w, id) <= w.actor.mp - reserve(w)).map((id) => cost(w, id)));
      const credit = budget.observe(w.now, w.actor.mp, w.actor.mp - reserve(w), cap);
      if (d.category === "damage" && w.context.mode !== "event" && credit < cost(w, d.skill)) {
        report(w, d, "skipped", "sustained farming MP budget");
        return false;
      }
      return true;
    }
    function settle(d, actions, result) {
      const response = result;
      const accepted = new Set(response?.targets || (response?.target ? [response.target] : []));
      d.targets.forEach((t, i) => {
        if (!actions[i]) return;
        const success = accepted.has(t.id) || !response?.targets && d.targets.length === 1;
        ports.evidence(t, success ? "engaged" : "rejected", actions[i]);
      });
    }
    function rejectActions(d, actions) {
      actions.forEach((a, i) => {
        if (a) ports.evidence(d.targets[i], "rejected", a);
      });
    }
    function recordAura(w, d) {
      if (d.skill === "paladin_aura") {
        auraAt = w.now;
        auraState = d.argument || "";
      }
    }
    async function execute(d) {
      const w = world();
      if (stopped || !affordable(w, d)) return false;
      const id = family(w, d.skill), amount = cost(w, d.skill);
      const token = { epoch, cost: amount, until: w.now + 2500 };
      pending.set(id, token);
      if (d.category === "damage") budget.debit(amount);
      const actions = d.targets.map((t) => w.skills[d.skill]?.hostile ? ports.evidence(t, "pending") : null);
      report(w, d, "selected");
      let timeout;
      try {
        const result = await Promise.race([ports.cast(d), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("skill acknowledgement timeout")), 2500);
        })]);
        if (epoch !== token.epoch || stopped) return false;
        settle(d, actions, result);
        recordAura(w, d);
        report(w, d, "accepted");
        return true;
      } catch (error) {
        rejectActions(d, actions);
        if (epoch !== token.epoch || stopped) return false;
        failures.set(d.skill, ports.world().now + 1e3);
        report(w, d, "rejected", errorReason(error));
        return false;
      } finally {
        clearTimeout(timeout);
        if (pending.get(id) === token) pending.delete(id);
      }
    }
    async function first(choices) {
      const w = world();
      const d = choices.find((d2) => affordable(w, d2));
      return d ? execute(d) : false;
    }
    return {
      ready(d) {
        return affordable(world(), d);
      },
      cast: execute,
      async absorb() {
        const d = absorbDecision(world());
        return d ? execute(d) : false;
      },
      support() {
        const w = world();
        const choices = w.actor.ctype === "paladin" ? paladinSupport(w) : rogueSupport(w);
        return first(choices.filter((d) => d.skill !== "paladin_aura" || w.now - auraAt >= 1e4 && d.argument !== auraState));
      },
      offense(target) {
        const w = world();
        return first(damageChoices(w, target));
      },
      attack(target) {
        const w = world();
        if (w.context.mode === "blocked" || !["ranger", "rogue"].includes(w.actor.ctype)) return null;
        const opening = opener(w, target);
        if (opening && affordable(w, opening)) {
          openerPending = true;
          return execute(opening).finally(() => {
            openerPending = false;
          });
        }
        const d = bestAttack(w, target, (d2) => affordable(w, d2));
        return d ? execute(d) : null;
      },
      busy() {
        world();
        return openerPending || pending.has("attack");
      },
      reset() {
        epoch++;
        budget.reset();
        auraAt = -Infinity;
        auraState = "";
      },
      stop() {
        stopped = true;
        epoch++;
      }
    };
  }

  // runtime/characters/skills/projectiles.ts
  function usable(data) {
    return !!data.pid && !!data.target && Number(data.damage) > 0 && Number(data.eta) > 0;
  }
  function createProjectileTracker(world) {
    const flights = /* @__PURE__ */ new Map();
    function prune(now) {
      for (const [id, p] of flights) if (p.until <= now) flights.delete(id);
    }
    return {
      action(data) {
        const w = world();
        prune(w.now);
        if (!usable(data)) return;
        if (!w.context.allies.some((a) => a.name === data.attacker || a.id === data.attacker)) return;
        const target = w.context.monsters.find((t) => t.id === data.target);
        if (!target) return;
        const definition = Object.entries(w.skills).find(([id]) => id === data.type)?.[1];
        const defense = definition?.damage_type === "magical" ? target.resistance : target.armor;
        const factor = definition?.damage_type === "pure" ? 1 : w.damageMultiplier(Number(defense) || 0);
        flights.set(data.pid, { target: data.target, amount: Number(data.damage) * factor * 0.9, until: w.now + Number(data.eta) });
      },
      hit(data) {
        if (data.pid) flights.delete(data.pid);
      },
      incoming(target, now) {
        prune(now);
        return [...flights.values()].filter((p) => p.target === target).reduce((n, p) => n + p.amount, 0);
      },
      clear() {
        flights.clear();
      }
    };
  }

  // runtime/characters/skills/runtime.ts
  function mitigation2(defense) {
    const rates = [1e-3, 1e-3, 95e-5, 9e-4, 82e-5, 7e-4, 6e-4, 5e-4];
    const reduction = rates.reduce((sum, rate, i) => sum + Math.max(0, Math.min(100, defense - i * 100)) * rate, 0) + Math.max(0, defense - 800) * 4e-4;
    const piercing = [1e-3, 75e-5, 5e-4].reduce((sum, rate, i) => sum + Math.max(0, Math.min(50, -defense - i * 50)) * rate, 0) + Math.max(0, -defense - 150) * 25e-5;
    return Math.min(1.32, Math.max(0.05, 1 - reduction + piercing));
  }
  function installSkillRuntime(root) {
    const host = parent;
    const shared = root.sharedRoutine;
    const projectiles = createProjectileTracker(world);
    function world() {
      const actor = character;
      const context = shared.combatContext?.() || {
        leader: "",
        allies: [],
        monsters: [],
        mode: "blocked",
        event: null,
        observedAt: 0
      };
      if (host.is_disabled?.(actor)) context.mode = "blocked";
      const skills = G.skills;
      const result = {
        actor,
        context,
        skills,
        now: Date.now(),
        item: (name) => G.items[name],
        condition: (name) => G.conditions[name],
        cooldown: (id) => id === "invis" && !!shared.merchantVisibilityActive?.() || Number(host.next_skill?.[id]) > Date.now(),
        damageMultiplier: host.damage_multiplier || mitigation2,
        incoming: (t) => projectiles.incoming(t.id, Date.now()),
        range: (t, id) => skillRange(actor, t, skills[id]),
        allowed: (t, id) => authorized(result, t, id)
      };
      return result;
    }
    function authorized(w, t, id) {
      const type = w.skills[id]?.damage_type || "physical";
      if (id !== "taunt" && monsterAttackBlock(t.mtype, type, w.actor.range)) return false;
      if (!targetAuthorized(t, id)) return false;
      if (t.target || w.context.mode !== "scatter") return true;
      const added = { ...w.context, monsters: w.context.monsters.map((m) => m.id === t.id ? { ...m, target: w.actor.name } : m) };
      return w.actor.hp - 2 * incomingDps({ ...w, context: added }, w.actor) > w.actor.max_hp * 0.3;
    }
    function targetAuthorized(t, id) {
      return !!shared.skillTargetAllowed?.(t) && shared.rareAttackAllowed?.(t, id) !== false;
    }
    const engine = createSkillEngine({
      world,
      cast: (d) => host.use_skill(d.skill, d.argument ?? (d.targets.length > 1 || world().skills[d.skill]?.multi ? d.targets.map((t) => t.id) : d.targets[0]?.id || d.targets[0]?.name)),
      evidence: (t, state, action2) => shared.queueEvidence?.(t, state, action2) || null,
      diagnostic: (d) => {
        if (root.partyCombatState) root.partyCombatState.skill = d;
      }
    });
    shared.skillSupport = () => engine.support();
    shared.skillOffense = (t) => engine.offense(t);
    shared.absorbLeaderAggro = () => engine.absorb();
    if (shared.combatContext) {
      shared.combatSkillReady = (id, target, category) => engine.ready(decision(id, [target], category));
      shared.castCombatSkill = (id, target, category) => engine.cast(decision(id, [target], category));
    }
    const action = (data) => projectiles.action(data);
    const hit = (data) => projectiles.hit(data);
    host.socket?.on?.("action", action);
    host.socket?.on?.("hit", hit);
    return {
      ...engine,
      reset() {
        engine.reset();
        projectiles.clear();
      },
      stop() {
        engine.stop();
        projectiles.clear();
        host.socket?.off?.("action", action);
        host.socket?.off?.("hit", hit);
      }
    };
  }
  function skillRange(actor, target, s) {
    if (!s) return false;
    const base = s.use_range ? actor.range : s.range || actor.range;
    const range = base * (s.range_multiplier || 1) + (s.range_bonus || 0);
    const distanceTo = typeof distance === "function" ? distance(actor, target) : Math.hypot(actor.x - target.x, actor.y - target.y);
    return distanceTo <= range;
  }

  // runtime/combat/recovery-route.ts
  function recoveryRoute(origin, destination, clear) {
    const start = { x: origin.x, y: origin.y }, goal = { x: destination.x, y: destination.y };
    const open = [{ ...start, cost: 0, rank: 0 }], costs = /* @__PURE__ */ new Map();
    let expanded = 0, finished = false;
    let spacing = 16;
    const key = (p) => `${Math.round((p.x - start.x) / spacing)},${Math.round((p.y - start.y) / spacing)}`;
    const distance2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    costs.set(key(start), 0);
    function path(node) {
      const result = [goal];
      let n = node;
      while (n?.parent) {
        result.unshift({ x: n.x, y: n.y });
        n = n.parent;
      }
      return result;
    }
    function neighbors(current) {
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
        if (!x && !y) continue;
        const next = { x: current.x + x * spacing, y: current.y + y * spacing }, cost2 = current.cost + distance2(current, next);
        if (cost2 >= (costs.get(key(next)) ?? Infinity) || distance2(start, next) > distance2(start, goal) + 384 || !clear(current, next)) continue;
        costs.set(key(next), cost2);
        open.push({ ...next, cost: cost2, rank: cost2 + distance2(next, goal), parent: current });
      }
    }
    return { tick() {
      if (finished) return null;
      for (let i = 0; i < 128 && open.length && expanded < 8192; i++, expanded++) {
        open.sort((a, b) => b.rank - a.rank);
        const current = open.pop();
        if (clear(current, goal)) {
          finished = true;
          return path(current);
        }
        neighbors(current);
      }
      if (!open.length || expanded >= 8192) {
        if (spacing === 16) {
          spacing = 8;
          expanded = 0;
          open.length = 0;
          costs.clear();
          costs.set(key(start), 0);
          open.push({ ...start, cost: 0, rank: 0 });
          return;
        }
        finished = true;
        return null;
      }
    } };
  }

  // runtime/combat/formation-recovery-client.ts
  function routeKey(c) {
    return JSON.stringify([c?.id, c?.phase, c?.attempt]);
  }
  function createFormationRecoveryClient(p) {
    let control, proposal;
    let outcome, route = null, seenId = "", drawings = [];
    let movementBlock;
    let follower;
    function clearDrawings() {
      for (const d of drawings) d?.destroy?.();
      drawings = [];
    }
    function cancel() {
      follower = void 0;
      const old = route;
      route = null;
      movementBlock = void 0;
      clearDrawings();
      if (!old) return;
      if (old.gate.owner === old.owner) old.gate.owner = null;
      if (p.smart().on_done === old.onDone) {
        p.stop();
      }
    }
    function valid() {
      const c = p.context();
      return !!control && c.allowed && c.key === control.key && c.target === control.target;
    }
    function finish(reason) {
      if (!control) return;
      outcome = { target: control.target, at: p.now(), ack: control.id, attempt: control.attempt, outcome: reason ? "failed" : "arrived", reason };
      cancel();
      p.log(reason ? "failed" : "arrived", { ...control, reason });
    }
    function overlay(current, s) {
      if (!p.debug()) {
        clearDrawings();
        return;
      }
      if (p.now() - current.drawAt < 500) return;
      current.drawAt = p.now();
      clearDrawings();
      drawings = p.draw(current.goal, s.plot) || [];
    }
    function shortenSegment(s, self) {
      const next = s.plot[0];
      if (next && !self.moving && p.stepSize) {
        const distance2 = Math.hypot(next.x - self.x, next.y - self.y);
        if (distance2 > p.stepSize) s.plot.unshift({ ...s.plot[0], map: self.map, x: self.x + (next.x - self.x) * p.stepSize / distance2, y: self.y + (next.y - self.y) * p.stepSize / distance2 });
      }
    }
    function segmentReady(s, self) {
      shortenSegment(s, self);
      const segment = self.moving ? { map: self.map, x: Number(self.going_x), y: Number(self.going_y) } : s.plot[0];
      if (segment && p.coveredStep && !p.coveredStep(segment)) {
        movementBlock = "waiting for followers to preserve healing coverage";
        return false;
      }
      movementBlock = void 0;
      if (segment && !p.safe(segment)) {
        if (p.segmentClear && route && !self.moving) {
          route.search = void 0;
          route.checked = false;
          s.found = false;
          s.plot = [];
          movementBlock = "replanning around changed monster positions";
          return false;
        }
        finish("terrain or monster blocks the next segment");
        return false;
      }
      return true;
    }
    function step(current) {
      const s = p.smart(), self = p.self();
      if (!s.found) {
        plan(current, s);
        return;
      }
      if (!current.checked) {
        if (s.plot.some((v) => v.town || v.transport || v.map !== self.map)) {
          finish("route leaves the current map");
          return;
        }
        current.checked = true;
      }
      if (!segmentReady(s, self)) return;
      const remaining = self.moving && current.issued ? [current.issued, ...s.plot] : s.plot;
      current.remaining = remaining.reduce((sum, v, i) => sum + Math.hypot(v.x - (i ? remaining[i - 1].x : self.x), v.y - (i ? remaining[i - 1].y : self.y)), 0);
      if (!self.moving) current.issued = s.plot[0];
      overlay(current, s);
      current.gate.original();
    }
    function walk() {
      if (!route) return;
      if (!valid()) {
        cancel();
        return;
      }
      if (p.smart().on_done !== route.onDone || route.gate.owner !== route.owner) {
        finish("movement ownership changed");
        return;
      }
      if (p.now() - control.phaseAt >= 3e4) {
        finish("route timeout");
        return;
      }
      try {
        step(route);
      } catch (error) {
        finish(errorReason(error));
      }
    }
    function start() {
      if (!control) return;
      const gate = p.gate();
      if (gate.owner) {
        finish("another route owns the native walker");
        return;
      }
      const goal = control.goal || control.goals[(control.attempt - 1) % control.goals.length];
      route = { gate, owner: { tick: walk }, onDone: null, goal, checked: false, drawAt: 0, remaining: Infinity };
      const owned = route;
      gate.owner = owned.owner;
      try {
        const promise = p.start(goal);
        owned.onDone = p.smart().on_done;
        p.log("routing", { ...control, destination: goal });
        Promise.resolve(promise).then(() => {
          if (route !== owned) return;
          finish(Math.hypot(p.self().x - goal.x, p.self().y - goal.y) <= 12 ? void 0 : "route ended before the recovery position");
        }).catch((error) => {
          if (route === owned) finish(errorReason(error));
        });
      } catch (error) {
        finish(errorReason(error));
      }
    }
    function accept(next) {
      if (routeKey(control) !== routeKey(next)) cancel();
      if (control && !next) {
        proposal = void 0;
        outcome = void 0;
        p.release?.();
      }
      control = next;
      if (next && seenId !== next.id) {
        seenId = next.id;
        proposal = void 0;
        outcome = void 0;
        p.hold();
        p.log("pausing", next);
      }
      tick();
    }
    function tick() {
      if (!control) {
        if (!p.context().allowed) proposal = void 0;
        return;
      }
      if (!valid()) {
        cancel();
        proposal = void 0;
        return;
      }
      if (control.phase !== "routing" || control.mover !== p.self().name) return;
      if (outcome?.attempt === control.attempt) return;
      if (!route) start();
    }
    function activeReport() {
      return {
        ...outcome?.attempt === control.attempt ? outcome : void 0,
        target: control.target,
        at: p.now(),
        ack: control.id,
        attempt: control.attempt,
        approachReady: p.approachReady?.(),
        goals: control.phase === "retry" ? p.goals?.() : void 0,
        remaining: route?.remaining
      };
    }
    function plan(current, s) {
      if (!p.segmentClear) {
        p.plan();
        return;
      }
      current.search ??= recoveryRoute(p.self(), current.goal, p.segmentClear);
      const points = current.search.tick();
      if (points === null) {
        finish("no safe same-map route to recovery position");
        return;
      }
      if (points) {
        s.plot = points.map((point) => ({ ...point, map: p.self().map }));
        s.searching = false;
        s.found = true;
      }
    }
    function report() {
      if (valid()) return activeReport();
      if (proposal && p.context().allowed && proposal.target === p.context().target) return { ...proposal, at: p.now() };
    }
    function position() {
      p.position({ ...control, reason: movementBlock || control.reason }, route?.remaining);
    }
    function movement() {
      if (!valid()) return false;
      if (control.mover !== p.self().name && p.follow && control.phase !== "pausing" && control.phase !== "failed") {
        p.follow();
        return true;
      }
      if (control.phase === "regrouping" && p.self().name !== control.mover && !p.context().covered) return false;
      position();
      return true;
    }
    function followPoint(goal) {
      if (!p.segmentClear) return goal;
      const self = p.self();
      if (!follower || Math.hypot(goal.x - follower.goal.x, goal.y - follower.goal.y) > 40)
        follower = { goal: { ...goal }, search: recoveryRoute(self, goal, p.segmentClear) };
      if (!follower.path) {
        const result = follower.search.tick();
        if (result === null) {
          follower = void 0;
          return;
        }
        follower.path = result;
      }
      while (follower.path?.length && Math.hypot(follower.path[0].x - self.x, follower.path[0].y - self.y) < 6) follower.path.shift();
      return follower.path?.[0];
    }
    return {
      accept,
      tick,
      report,
      movement,
      blocks: () => valid(),
      followPoint,
      propose(target, goals) {
        if (!control && goals.length && p.context().allowed) proposal = { target, goals, at: p.now() };
      },
      stop() {
        cancel();
        control = void 0;
        proposal = void 0;
        outcome = void 0;
      }
    };
  }

  // runtime/combat/sight-recovery.ts
  function createSightRecovery(p) {
    let key = "", historyKey = "", history = [], trail = [], side = 1, progressAt = 0, distance2 = Infinity;
    let waypoint = null, fan = 0, retryAt = 0, startedAt = 0, steps = 0;
    const failed = /* @__PURE__ */ new Map(), visited = /* @__PURE__ */ new Map();
    const cell = (v) => Math.round(v.x / 8) + "," + Math.round(v.y / 8);
    function reset() {
      key = "";
      waypoint = null;
      trail = [];
      failed.clear();
      visited.clear();
      fan = 0;
    }
    function observe(id, pos, visible) {
      if (historyKey !== id) {
        historyKey = id;
        history = [];
        reset();
      }
      const now = p.now(), last = history.at(-1);
      if (!last || Math.hypot(last.x - pos.x, last.y - pos.y) >= 4 || last.visible !== visible || now - last.at >= 250)
        history.push({ x: pos.x, y: pos.y, at: now, visible });
      history = history.filter((v) => now - v.at <= 8e3).slice(-80);
      if (visible) reset();
    }
    function tick(id, last, remembered, observers) {
      const now = p.now(), self = p.self();
      if (key !== id) {
        startedAt = now;
        steps = 0;
        key = id;
        side = 1;
        progressAt = now;
        distance2 = Infinity;
        waypoint = null;
        fan = 0;
        retryAt = 0;
        let visibleIndex = -1;
        if (historyKey === id) history.forEach((v, i) => {
          if (v.visible) visibleIndex = i;
        });
        trail = visibleIndex >= 0 ? history.slice(Math.max(0, visibleIndex - 8)).reverse().map((v) => ({ x: v.x, y: v.y })) : remembered ? [remembered] : [];
      }
      if (now - startedAt >= 8e3 || steps >= 6) {
        p.report("Search paused: bounded search exhausted; awaiting fresh coverage or target retirement");
        return true;
      }
      for (const cache of [failed, visited]) for (const [k, at] of cache) if (now - at > 5e3) cache.delete(k);
      if (now < retryAt) return true;
      if (waypoint) {
        const gap2 = Math.hypot(self.x - waypoint.x, self.y - waypoint.y);
        if (gap2 < distance2 - 2) {
          distance2 = gap2;
          progressAt = now;
        }
        if (gap2 < 5) {
          visited.set(cell(waypoint), now);
          waypoint = null;
        } else if (!p.clear(waypoint) || now - progressAt >= 1e3) {
          failed.set(cell(waypoint), now);
          waypoint = null;
          side *= -1;
          fan++;
        } else {
          p.report("Recovering sight: continuing local detour");
          return true;
        }
      }
      while (trail.length && Math.hypot(self.x - trail[0].x, self.y - trail[0].y) < 7) trail.shift();
      const observer = observers.slice().sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y))[0];
      const goal = trail[0] || observer || last;
      const reason = trail.length ? "retracing recent footsteps" : observer ? "approaching teammate who sees target" : "searching from last useful sighting";
      const length = Math.max(8, Math.min(24, self.speed * 0.4)), gap = Math.hypot(goal.x - self.x, goal.y - self.y);
      const heading = Math.atan2(goal.y - self.y, goal.x - self.x);
      const allowed = (v) => !failed.has(cell(v)) && !visited.has(cell(v)) && p.clear(v);
      const send = (v, why) => {
        steps++;
        waypoint = v;
        distance2 = Math.hypot(v.x - self.x, v.y - self.y);
        progressAt = now;
        p.report("Recovering sight: " + why);
        p.move(v);
        return true;
      };
      if (gap >= 7) {
        const direct = { x: self.x + (goal.x - self.x) * Math.min(1, length / gap), y: self.y + (goal.y - self.y) * Math.min(1, length / gap) };
        if (allowed(direct)) return send(direct, reason);
        failed.set(cell(direct), now);
      } else if (trail.length) trail.shift();
      for (let pass = 0; pass < 2; pass++) {
        const candidates = [30, 60, 90, 120, 150].map((degrees, index) => {
          const angle = heading + side * degrees * Math.PI / 180;
          const radius = length * (1 + Math.min(2, Math.floor(fan / 4)) * 0.25);
          return { x: self.x + Math.cos(angle) * radius, y: self.y + Math.sin(angle) * radius, index };
        }).filter(allowed).sort((a, b) => (p.cost?.(a) || 0) - (p.cost?.(b) || 0) || a.index - b.index);
        if (candidates.length) {
          fan++;
          return send(candidates[0], gap < 7 ? "bounded fan search" : "persistent " + (side > 0 ? "left" : "right") + " detour; " + reason);
        }
        side *= -1;
      }
      fan++;
      retryAt = now + 250;
      p.report("Recovering sight: local steps blocked; retrying without releasing target");
      return true;
    }
    return { tick, reset, observe };
  }

  // runtime/combat/evidence.ts
  function sameEvidenceTarget(a, b) {
    return String(a.id) === String(b.id) && a.map === b.map && a.in === b.in && a.server === b.server;
  }
  function retireDeadEvidence(events, deaths, retired) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (!deaths.some((death) => sameEvidenceTarget(events[i], death))) continue;
      retired(events[i]);
      events.splice(i, 1);
    }
  }

  // runtime/combat/passing.ts
  var passingIdentity = (t) => JSON.stringify([t.server, t.map, String(t.in ?? t.map), String(t.id)]);

  // runtime/combat/passing-admission.ts
  function createPassingAdmission(ports) {
    let control = null, receivedAt = 0, serial = 0, serverAt = -Infinity;
    let acknowledgement;
    const proposals = /* @__PURE__ */ new Map();
    const freshControl = () => !!control?.ready && ports.now() - receivedAt < 1e3;
    function apply(next, encounters, at) {
      if (!next || at < serverAt) return;
      serverAt = at;
      receivedAt = ports.now();
      control = next;
      acknowledgement = { scope: next.scope, at, tokens: encounters.filter((e) => e.admission?.scope === next.scope && at - e.at < 6e4).map((e) => e.admission.token) };
    }
    function prepare(target, present) {
      if (!control || !freshControl()) return false;
      const key = passingIdentity(target);
      if (control.hunt && (control.hunt.defending || control.hunt.reason || control.hunt.primary && passingIdentity(control.hunt.primary) !== key)) return false;
      let proposal = proposals.get(key);
      const token = proposal?.token;
      if (!proposal || proposal.scope !== control.scope || present && !present.some((e) => e.admission?.token === token)) {
        proposal = { scope: control.scope, token: JSON.stringify([control.scope, key, ports.now(), ++serial]) };
        proposals.set(key, proposal);
        if (proposals.size > 128) proposals.delete(proposals.keys().next().value);
        ports.reserve(target, proposal);
        return false;
      }
      return control.ready && control.admitted.includes(proposal.token);
    }
    return { apply, prepare, report: () => ports.now() - receivedAt < 1e3 ? acknowledgement : void 0 };
  }

  // runtime/combat/client.ts
  function installQueueClient(root, shared) {
    root.partyQueueClient?.stop();
    let active = true, busy2 = false, waiting = false, signature = "", sentAt = 0, retryAt = 0, revision = "", serial = 0;
    const formation = shared.terrainRecoveryPorts ? createFormationRecoveryClient(shared.terrainRecoveryPorts()) : null;
    const host = parent;
    const passing = createPassingAdmission({ now: () => Date.now(), reserve: (target, admission) => shared.beginPassingAttack(target, admission, true) });
    const events = host.__partyQueueEvidence || [];
    let claims = [];
    const sight = createSightRecovery({
      now: () => Date.now(),
      self: () => character,
      clear: (p) => shared.queueSafePoint(p),
      cost: (p) => shared.queueCoverageCost(p),
      move: (p) => {
        shared.queueRecoveryMove(p);
      },
      report: (reason) => shared.queueRecoveryReason(reason)
    });
    host.__partyQueueEvidence = events;
    function trace(event, reason) {
      const entries = root.__partyQueueEvidenceTrace ||= [];
      entries.push({
        at: Date.now() + shared.queueClockOffset(),
        id: event.id,
        map: event.map,
        in: event.in,
        server: event.server,
        action: event.action,
        state: event.state,
        mode: shared.getFarmingMode?.(),
        reason
      });
      if (entries.length > 32) entries.splice(0, entries.length - 32);
    }
    function reportEvidence(deaths = root.__partyFightDeaths || []) {
      for (let i = events.length - 1; i >= 0; i--) if (shared.isPassingEncounter?.(events[i])) events.splice(i, 1);
      retireDeadEvidence(events, deaths, (event) => trace(event, "confirmed local death"));
      return events;
    }
    reportEvidence();
    function flush() {
      signature = "";
      sentAt = 0;
      tick();
    }
    function evidence(target, state, action) {
      if (!active || !target || shared.isPassingEncounter?.(target)) return null;
      reportEvidence();
      const old = action ? events.findIndex((e) => e.action === action) : -1;
      if (action && old < 0) return null;
      if (!action && !shared.usesGroupedCombat?.()) return null;
      if (old >= 0) {
        const previous = events[old];
        events[old] = { ...previous, state, at: Date.now() + shared.queueClockOffset(), startedAt: previous.startedAt ?? previous.at };
        trace(events[old], "action settled");
        flush();
        return action;
      }
      const report = shared.queueReport();
      const event = {
        id: target.id,
        mtype: target.mtype,
        map: character.map,
        in: character.in,
        server: report.server,
        x: target.x,
        y: target.y,
        action: action || character.name + ":" + Date.now() + ":" + ++serial,
        state,
        at: Date.now() + shared.queueClockOffset()
      };
      if ((report.groupedCombat.deaths || []).some((death) => sameEvidenceTarget(event, death))) return null;
      event.startedAt = event.at;
      events.push(event);
      while (events.length > 256) {
        const i = events.findIndex((e) => e.state !== "pending");
        if (i < 0) break;
        events.splice(i, 1);
      }
      flush();
      return event.action;
    }
    function hit(data) {
      const names = shared.queueMembers();
      if (!data || !names.includes(String(data.hid || data.actor || ""))) return;
      const target = get_entity(data.id);
      if (!target || target.type !== "monster") return;
      const report = shared.queueReport();
      const identity = { id: target.id, map: character.map, in: character.in, server: report.server };
      const pending = reportEvidence().filter((e) => sameEvidenceTarget(e, identity) && e.state === "pending");
      if (!pending.length && shared.sharedTargetId() !== target.id) return;
      if (!pending.length && (shared.queueReport().groupedCombat.epoch || 0) > 0) return;
      if (!pending.length && claims.some((c) => c.id === target.id && c.map === character.map && c.in === character.in && c.releasedAt !== void 0)) return;
      if (pending.length) pending.forEach((e) => evidence(target, "engaged", e.action));
      else evidence(target, "engaged");
    }
    function apply(data) {
      if (!active) return;
      shared.acceptCombatControl?.(data);
      passing.apply(data.passingControl, (data.passingEncounters || []).filter((e) => shared.isPassingEncounter?.(e)), data.serverNow || 0);
      const group = data.groupedCombat;
      claims = group?.claims || claims;
      for (let i = events.length - 1; i >= 0; i--) if (group?.lostTargets?.some((d) => d.id === events[i].id && d.map === events[i].map && d.in === events[i].in && d.server === events[i].server && (events[i].startedAt ?? events[i].at) <= d.retiredAt) || group?.rareRejections?.some((d) => events[i].state === "pending" && d.id === events[i].id && d.map === events[i].map && d.in === events[i].in && d.server === events[i].server) || group?.deaths?.some((d) => d.id === events[i].id && d.map === events[i].map && d.in === events[i].in && d.server === events[i].server) || group?.claims?.some((c) => c.id === events[i].id && c.map === events[i].map && c.in === events[i].in && c.server === events[i].server && (c.external || c.releasedAt >= (events[i].startedAt ?? events[i].at)))) events.splice(i, 1);
      if (shared.sharedTargetId() !== group?.target?.id) sight.reset();
      revision = data.combatRevision || revision;
      shared.acceptQueue(group);
      root.partyRoleRunner?.wake();
    }
    function tick() {
      if (!active || Date.now() < retryAt) return;
      if (!shared.usesGroupedCombat?.() && !shared.passingEncounterReport?.().length && !shared.getPassingTarget?.() && !shared.queueMembers?.().length) return;
      formation?.tick();
      const id = shared.sharedTargetId(), entity = id && get_entity(id);
      if (id) sight.observe(id, character, !!(entity && entity.visible && !entity.dead));
      if (!waiting) {
        waiting = true;
        shared.queueRequest({ combatWait: true, combatRevision: revision }).then(apply).catch(() => {
          retryAt = Date.now() + 1e3;
        }).finally(() => waiting = false);
      }
      if (busy2) return;
      const report = shared.queueReport();
      report.groupedCombat.evidence = reportEvidence(report.groupedCombat.deaths).filter((e) => e.server === report.server && e.map === character.map && e.in === character.in);
      const next = JSON.stringify([report.x, report.y, report.hp, report.rip, report.lastDeath, report.groupedCombat.epoch, report.groupedCombat.currentAttackers, report.groupedCombat.travelCandidates, report.groupedCombat.huntDefense, report.groupedCombat.passingAcknowledgement, report.groupedCombat.passingEncounters, report.groupedCombat.formationRecovery, report.groupedCombat.pursuitAck, report.groupedCombat.lootPending, report.groupedCombat.claims?.map((c) => [c.id, c.map, c.in, c.server, c.external]), report.groupedCombat.candidates, report.groupedCombat.threats, report.groupedCombat.sightings, report.groupedCombat.evidence, report.groupedCombat.deaths, report.groupedCombat.queueAck, report.groupedCombat.ack]);
      if (next === signature && Date.now() - sentAt < 1e3) return;
      signature = next;
      sentAt = Date.now();
      busy2 = true;
      shared.queueRequest({ ...report, combatOnly: true }).then(apply).catch(() => {
        signature = "";
        retryAt = Date.now() + 1e3;
      }).finally(() => busy2 = false);
    }
    const timer = setInterval(tick, 100);
    function preparePassing(target) {
      if (target.type !== "monster") return false;
      const report = shared.queueReport();
      const identity = { ...target, map: report.map, in: report.in, server: report.server, at: Date.now() + shared.queueClockOffset() };
      if (!passing.prepare(identity, report.groupedCombat.passingEncounters)) return false;
      shared.beginPassingAttack(target);
      return true;
    }
    const api = { tick, flush, hit, evidence, events, reportEvidence, sight, formation, preparePassing, passingAcknowledgement: passing.report, reset() {
      events.length = 0;
      sight.reset();
      signature = "";
      sentAt = 0;
    }, stop() {
      formation?.stop();
      active = false;
      clearInterval(timer);
    } };
    root.partyQueueClient = api;
    return api;
  }

  // runtime/combat/marker-style.ts
  function markerStyle(marker, index = 0) {
    const role8 = marker.role || (marker.state === "scatter" ? "current" : ["current", "next", "third"][index]);
    return { color: role8 === "current" ? 15680580 : 16436245, css: role8 === "current" ? "#ef4444" : "#facc15", double: role8 === "third" };
  }

  // runtime/combat/markers.ts
  function installQueueMarkers(root, shared) {
    const host = parent;
    host.__partyQueueMarkers?.stop();
    let graphics = null;
    const clear = () => {
      if (graphics) {
        graphics.destroy();
        graphics = null;
      }
    };
    function draw() {
      const markers = shared.queueMarkers() || [];
      if (!host.PIXI?.Graphics || !host.map || !markers.length || host.socket?.disconnected) {
        clear();
        return;
      }
      if (!graphics || graphics.destroyed || graphics.parent !== host.map) {
        clear();
        graphics = new host.PIXI.Graphics();
        host.map.addChild(graphics);
      }
      graphics.clear();
      const scale = Math.abs(host.map.scale?.x) || 1;
      markers.forEach((t, index) => {
        const e = get_entity(t.id);
        if (!e || !e.visible || e.dead || t.visible === false || t.map !== character.map || t.in !== character.in) return;
        const radius = t.radius || Math.max(18, (Number(e.awidth) || 24) / 2 + 4);
        const style = markerStyle(t, index);
        graphics.lineStyle(3 / scale, style.color);
        graphics.drawCircle(e.real_x ?? e.x, e.real_y ?? e.y, radius);
        if (style.double) graphics.drawCircle(e.real_x ?? e.x, e.real_y ?? e.y, radius + 6 / scale);
      });
    }
    const timer = setInterval(draw, 50);
    const api = { stop() {
      clearInterval(timer);
      clear();
    } };
    host.__partyQueueMarkers = api;
    return api;
  }

  // runtime/hunt/loot-identity.ts
  function huntLootId(hunt) {
    const mission = hunt.missions?.[hunt.currentIndex];
    return JSON.stringify([hunt.cycleId, hunt.missionRevision || 0, hunt.currentIndex, mission?.target, mission?.owners]);
  }

  // runtime/combat/departure-loot.ts
  function createDepartureLoot(ports) {
    let control = null, progress = null, pending = false, retired = /* @__PURE__ */ new Set(), latest = 0;
    const engagements = /* @__PURE__ */ new Map();
    const identity = (t) => JSON.stringify([t.realm, t.map, String(t.in ?? t.map), String(t.id)]);
    function valid(c) {
      const s = ports.position();
      return c && s.realm === c.realm && s.map === c.map && String(s.in) === String(c.in) && Math.hypot(s.x - c.x, s.y - c.y) <= 180 && !ports.cancelled();
    }
    function accept(c, at) {
      if (at < latest) return;
      latest = at;
      if (control && c && identity(control) === identity(c) && control.after === c.after) return;
      if (control && control.id !== c?.id) retired.add(control.id);
      control = c && !retired.has(c.id) ? c : null;
    }
    async function tick() {
      const c = control;
      if (!valid(c) || pending || ports.defending() || progress?.id === c.id && progress.complete) return;
      pending = true;
      try {
        const result = await ports.loot();
        if (control !== c || !valid(c) || ports.defending()) return;
        await ports.nextObservation();
        if (control !== c || !valid(c) || ports.defending()) return;
        progress = {
          id: c.id,
          realm: c.realm,
          map: c.map,
          in: String(c.in),
          observedAt: ports.now(),
          complete: result !== false && ports.chests().length === 0,
          error: void 0
        };
      } catch (error) {
        if (control === c) progress = { id: c.id, realm: c.realm, map: c.map, in: String(c.in), observedAt: ports.now(), complete: false, error: String(error?.reason || error?.message || error) };
      } finally {
        pending = false;
      }
    }
    return {
      accept,
      tick,
      valid,
      report: () => progress,
      blocks: () => valid(control) && !(progress?.id === control.id && progress.complete),
      hit(t) {
        engagements.set(identity(t), ports.now());
      },
      engaged(t) {
        const at = engagements.get(identity(t));
        return at !== void 0 && ports.now() - at < 3e5;
      }
    };
  }
  function installLootClient(root, shared) {
    root.partyLootClient?.stop();
    const ports = shared.departureLootPorts?.();
    if (!ports) return null;
    ports.nextObservation = () => new Promise((resolve, reject) => {
      const socket = ports.socket();
      const observe = () => {
        clearTimeout(timeout);
        ports.afterDraw(resolve);
      };
      const timeout = setTimeout(() => {
        socket.off("entities", observe);
        reject(new Error("waiting for fresh chest observation"));
      }, 3e3);
      socket.once("entities", observe);
    });
    const rare = createDepartureLoot(ports), hunt = createDepartureLoot({
      ...ports,
      defending: () => mission?.encounter && ports.huntEncounterDefending ? ports.huntEncounterDefending() : ports.defending()
    }), convoy = createDepartureLoot(ports);
    let convoyHold = false;
    let lastState = 0, lastRare = null, mission = null, finalKill = null, finalKillAt = 0;
    const activeMission = () => mission && !["ended", "failed-return", "backup-travel", "backup-farming"].includes(mission.stage);
    const retired = /* @__PURE__ */ new Set();
    const timer = setInterval(() => {
      void rare.tick();
      void hunt.tick();
      void convoy.tick();
    }, 100);
    const ownsMission = () => mission?.missions?.[mission.currentIndex]?.owners?.includes(ports.name());
    const participant = () => mission?.participants?.includes(ports.name()) || ownsMission();
    const ownerDone = (limit) => mission?.missions?.[mission.currentIndex]?.owners?.length > 0 && mission.missions[mission.currentIndex].owners.every((name) => {
      const q = name === ports.name() ? ports.quest() : ports.questFor?.(name);
      return q?.id === mission.target && q.count <= limit;
    });
    const api = {
      rare,
      hunt,
      convoy,
      finalKill(mtype) {
        if (mission && participant() && ["farming", "mission-travel"].includes(mission.stage) && mtype === mission.target && ownerDone(1)) {
          finalKill = huntLootId(mission);
          finalKillAt = ports.now?.() ?? Date.now();
        }
      },
      huntPending() {
        if (convoyHold && !ports.cancelled()) return true;
        if (!activeMission() || !participant() || ports.cancelled()) return false;
        if (mission.stage === "farming" && ports.capacityBlocked?.()) return false;
        return !!(hunt.blocks() || mission.batchPickup || ["returning", "at-daisy", "turning-in"].includes(mission.stage) || mission.loot?.id === huntLootId(mission) || finalKill === huntLootId(mission) || ["farming", "mission-travel"].includes(mission.stage) && ownerDone(0));
      },
      accept(state) {
        if (state.serverNow < lastState) return lastRare;
        lastState = state.serverNow;
        convoyHold = !!(state.convoySignal?.phase === "defending" && state.convoySignal.loot);
        convoy.accept(convoyHold ? state.convoySignal.loot : null, state.serverNow);
        mission = state.monsterHunt;
        if (state.farmingPolicy && state.farmingPolicy !== "hunt" && !mission?.exitMode) mission = null;
        if (!activeMission()) {
          mission = null;
          finalKill = null;
        }
        if (finalKill && state.serverNow > finalKillAt + 1500 && !mission?.loot && !ownerDone(0)) finalKill = null;
        if (!mission || finalKill !== huntLootId(mission) || mission.loot?.complete) finalKill = null;
        let c = state.rareControl;
        if (lastRare && lastRare.id !== c?.id) retired.add(lastRare.id);
        if (c && (retired.has(c.id) || c.kind === "loot" && !rare.valid({ ...c.target, id: c.id }))) c = null;
        lastRare = c;
        rare.accept(c?.kind === "loot" ? { ...c.target, id: c.id, after: c.killedAt } : null, state.serverNow);
        hunt.accept(mission?.loot && !mission.loot.complete ? mission.loot : null, state.serverNow);
        return c;
      },
      stop() {
        clearInterval(timer);
      }
    };
    root.partyLootClient = api;
    return api;
  }

  // runtime/characters/roles/death-recovery.ts
  function createDeathRecovery(ports) {
    let recovering = false, pendingReturn = false, revived = false, attempt = 0, retryAt = 0;
    let phase = "respawn", lastError = null, errorAt = null;
    const publish = (stage, error = null) => {
      if (error) {
        lastError = error;
        errorAt = Date.now();
      }
      ports.publish({ at: Date.now(), stage, error, recovery: {
        phase,
        attempt,
        lastError,
        errorAt,
        status: stage,
        at: Date.now(),
        recoveredAt: stage === "recovery-complete" ? Date.now() : null
      } });
    };
    async function spawn() {
      phase = "respawn";
      attempt++;
      publish("respawning");
      let timeout;
      try {
        await Promise.race([ports.respawn(), new Promise((resolve) => {
          timeout = ports.setTimeout(resolve, 3e3);
        })]);
      } finally {
        ports.clearTimeout(timeout);
      }
      if (ports.isDead()) publish("respawn-waiting", "No alive confirmation yet");
    }
    async function returnToActivity() {
      if (!revived) {
        ports.releaseCombat();
        revived = true;
        publish("respawned");
      }
      phase = "event-reentry";
      const result = await ports.rejoinEvent();
      phase = result.phase || phase;
      if (result.status === "retryable") {
        publish("recovery-retry", result.reason || "Event recovery pending");
        retryAt = Date.now() + 1e3;
        return;
      }
      if (result.status === "not-applicable") {
        phase = "farm-return";
        await ports.rejoinFarm();
      }
      pendingReturn = false;
      publish(result.status === "cancelled" ? "recovery-cancelled" : "recovery-complete");
    }
    function observeDeath() {
      if (ports.isDead()) {
        if (!pendingReturn || revived) {
          attempt = 0;
          lastError = null;
          errorAt = null;
          retryAt = 0;
        }
        pendingReturn = true;
        revived = false;
      }
    }
    return async () => {
      observeDeath();
      if (!pendingReturn || recovering || Date.now() < retryAt) return;
      recovering = true;
      try {
        if (ports.isDead()) await spawn();
        if (!ports.isDead()) await returnToActivity();
      } catch (error) {
        const reason = errorReason(error);
        publish("recovery-retry", reason);
        if (reason !== "cant_respawn" && reason !== "cooldown")
          ports.log((phase === "respawn" ? "Respawn failed" : phase + " failed") + ": " + reason);
        retryAt = Date.now() + 1e3;
      } finally {
        recovering = false;
      }
    };
  }

  // runtime/characters/roles/default.ts
  var defaultRole = {
    name: "adventurer",
    combat: true,
    chooseTarget: function() {
      const scatterBreak = sharedRoutine.getScatterBreakTarget();
      if (sharedRoutine.hasScatterBreakTarget()) {
        const currentTarget = sharedRoutine.getEngagedTarget();
        if (currentTarget) return currentTarget;
        if (scatterBreak) return scatterBreak;
      }
      const eventTarget = sharedRoutine.getEventTarget();
      if (eventTarget) return eventTarget;
      if (sharedRoutine.getFarmingMode() === "scatter") return sharedRoutine.getScatterTarget();
      return sharedRoutine.shouldFollowLeader() ? sharedRoutine.getLeaderTarget() || sharedRoutine.getEngagedTarget() : sharedRoutine.getPreferredTarget();
    },
    beforeTarget: async function() {
      return false;
    },
    beforeAttack: async function() {
      return false;
    },
    usePotion: async function() {
      return false;
    }
  };

  // runtime/characters/roles/target-state.ts
  function targetRejection(target) {
    if (!target || !target.visible) return "selected monster not visible";
    if (target.dead || target.rip) return "selected monster died";
    if (target.map && target.map !== character.map) return "selected monster on another map";
    if (!sharedRoutine.allowsTarget(target))
      return sharedRoutine.targetRejectionReason?.(target) ?? "target rejected";
    return null;
  }
  function eligibleSelection(target) {
    return target && target.visible && !target.dead && sharedRoutine.allowsTarget(target) ? target : null;
  }

  // runtime/characters/roles/runner.ts
  function installRoleRunner(classRole, root = globalThis) {
    root.partyPassiveStopRequired = passiveStopRequired;
    root.partyMerchantAnniversaryControl = merchantAnniversaryControl;
    root.partyRoleRunner?.stop();
    let equipment2 = null;
    function resolvedRole() {
      return { ...defaultRole, ...classRole };
    }
    let timer = null, respawnTimer = null, movementTimer = null, targetTimer = null;
    let lootTimer;
    let looting = false;
    let working = false, selecting = false, active = true, generation = 0;
    let selectedTarget = null;
    let invalidated = true, missingSince = 0;
    const entityRefresh = createEntityRefresh({
      now: () => Date.now(),
      request: () => {
        const host = parent;
        if (!host.socket?.connected) return false;
        host.socket.emit("send_updates", {});
        return true;
      },
      report: (diagnostic) => {
        root.partyCombatState.entityRefresh = diagnostic;
      }
    });
    const queueClient = typeof sharedRoutine !== "undefined" && sharedRoutine.queueReport ? installQueueClient(root, sharedRoutine) : null;
    const queueMarkers = typeof sharedRoutine !== "undefined" && sharedRoutine.queueMarkers ? installQueueMarkers(root, sharedRoutine) : null;
    const trace = typeof sharedRoutine !== "undefined" && sharedRoutine.combatTraceSnapshot ? installCombatTrace(root, sharedRoutine) : null;
    const lootClient = typeof sharedRoutine !== "undefined" ? installLootClient(root, sharedRoutine) : null;
    const killed = /* @__PURE__ */ new Map();
    let skills = null;
    const attacks = createAttackController({
      target: attackTarget,
      selected: () => attackTarget()?.id || null,
      epoch: () => generation,
      active: () => active,
      allowed: () => combatAllowed() || !!passingTarget(),
      passing: (target) => target.id !== currentTarget()?.id && target.id === passingTarget()?.id,
      preparePassing: (target) => queueClient?.preparePassing(target) ?? false,
      state: () => root.partyCombatState,
      equipmentBusy: () => !!equipment2?.busy(),
      skillAttack: (target) => skills?.attack(target) ?? null,
      skillBusy: () => skills?.busy() ?? false,
      report: reportError
    });
    const recoverFromDeath = createDeathRecovery({
      isDead: () => !!character.rip,
      respawn: () => Promise.resolve(respawn()),
      releaseCombat: () => {
        working = false;
      },
      publish: (state) => {
        Object.assign(root.partyCombatState, state);
      },
      rejoinEvent: async () => typeof sharedRoutine.rejoinActiveEventAfterRespawn === "function" ? await sharedRoutine.rejoinActiveEventAfterRespawn() : { status: "not-applicable" },
      rejoinFarm: () => sharedRoutine.beginFarmReunion?.(),
      log: (message) => game_log(message, "red"),
      setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeout: (timer2) => globalThis.clearTimeout(timer2)
    });
    function combatAllowed() {
      return active && !character.rip && resolvedRole().combat && (character.ctype !== "merchant" || !!sharedRoutine.merchantEventCombatActive?.()) && !sharedRoutine.isOccupied() && ["pending", "feed"].indexOf(sharedRoutine.getAbtestingMode()) < 0;
    }
    function passingTarget() {
      if (character.ctype === "merchant" || !active || character.rip || !resolvedRole().combat || ["pending", "feed"].includes(sharedRoutine.getAbtestingMode())) return null;
      return sharedRoutine.getPassingTarget?.() || null;
    }
    function attackTarget() {
      const current = currentTarget(), passing = passingTarget();
      if (!current) return passing;
      if (!passing) return current;
      const priority = sharedRoutine.monsterPriority;
      return priority && priority(passing) > priority(current) ? passing : current;
    }
    function currentTarget() {
      let reason = null;
      const target = selectedTarget ? get_entity(selectedTarget) : null;
      if (!combatAllowed()) reason = "combat paused by movement or activity owner";
      else if (!selectedTarget) reason = "no selected target";
      else reason = killed.has(selectedTarget) ? "confirmed dead" : targetRejection(target);
      if (root.partyCombatState) {
        root.partyCombatState.targetRejection = reason;
        root.partyCombatState.selectedTarget = selectedTarget || null;
      }
      return reason ? null : target || null;
    }
    function reportError(error) {
      const reason = errorReason(error);
      if (reason !== "cooldown") {
        root.partyCombatState.error = String(reason);
        root.partyCombatState.errorAt = Date.now();
      }
    }
    function currentEpoch(epoch) {
      return active && epoch === generation;
    }
    function supportAllowed(epoch) {
      return currentEpoch(epoch) && !character.rip && !sharedRoutine.isOccupied();
    }
    function chooseTarget() {
      if (character.ctype === "merchant") return resolvedRole().chooseTarget();
      if (sharedRoutine.usesLeaderTarget?.()) return sharedRoutine.getGroupedTarget();
      const rare = sharedRoutine.getRareTarget?.();
      if (rare) return rare;
      return sharedRoutine.usesLeaderTarget?.() ? sharedRoutine.getGroupedTarget() : resolvedRole().chooseTarget();
    }
    async function publishSelection(target) {
      selectedTarget = target?.id || sharedRoutine.sharedTargetId?.() || null;
      sharedRoutine.setCombatTarget(target);
      if (!target && sharedRoutine.getFarmingMode() !== "scatter" && !sharedRoutine.usesGroupedCombat?.())
        await sharedRoutine.followLeaderIfFar(150);
    }
    async function selectTarget() {
      if (selecting || !active) return;
      if (!combatAllowed()) {
        selectedTarget = null;
        sharedRoutine.setCombatTarget(null);
        if (sharedRoutine.clearCombatSelection) sharedRoutine.clearCombatSelection();
        return;
      }
      const current = currentTarget();
      const closer = current && !attacks.hasStarted(current.id) && sharedRoutine.getCloserHuntTarget?.(current);
      if (closer) {
        root.sharedRoutine?.resetCombatMovement?.();
        await publishSelection(closer);
        attacks.wake();
        return;
      }
      if (!invalidated && current) {
        const rare = sharedRoutine.getRareTarget?.();
        const nominated = sharedRoutine.usesLeaderTarget?.() ? sharedRoutine.getGroupedTarget() : null;
        if ((!rare || rare.id === selectedTarget) && (!sharedRoutine.usesLeaderTarget?.() || nominated?.id === selectedTarget)) return;
      }
      invalidated = false;
      selecting = true;
      const epoch = generation;
      try {
        const selected = chooseTarget();
        if (!currentEpoch(epoch) || !combatAllowed()) return;
        const target = selected && !killed.has(selected.id) ? eligibleSelection(selected) : null;
        await publishSelection(target);
        attacks.wake();
      } catch (error) {
        reportError(error);
      } finally {
        if (epoch === generation) {
          selecting = false;
          if (invalidated && active) void selectTarget();
        }
      }
    }
    function idleMovement() {
      if (combatAllowed() && sharedRoutine.defensiveFormationMove?.()) return;
      root.sharedRoutine?.resetCombatMovement?.();
    }
    function equipmentTick() {
      const actor = character;
      const target = sharedRoutine.equipmentTarget ? sharedRoutine.equipmentTarget() : currentTarget();
      equipment2?.tick(target, actor.damage_type, Number(character.range), combatAllowed());
    }
    function movementTick() {
      try {
        equipmentTick();
        if (sharedRoutine.pollRareHunting?.()) return;
        if (sharedRoutine.pollFarmingCombatHandoff) sharedRoutine.pollFarmingCombatHandoff();
        if (sharedRoutine.pollFarmingSpawnRecovery) sharedRoutine.pollFarmingSpawnRecovery();
        if (selectedTarget && !currentTarget()) {
          invalidated = true;
          void selectTarget();
        }
        const target = currentTarget();
        entityRefresh.tick({
          enabled: combatAllowed(),
          context: JSON.stringify([character.map, character.in]),
          target: selectedTarget,
          accepted: root.partyCombatState.attackTiming?.accepted || 0
        });
        if (target) missingSince = 0;
        else if (!missingSince) missingSince = Date.now();
        attacks.wake();
        if (sharedRoutine.groupedMovement?.()) return;
        if ((target || Date.now() - missingSince >= 750) && sharedRoutine.recoverFarmApproach && sharedRoutine.recoverFarmApproach(target)) return;
        if (!target) {
          idleMovement();
          return;
        }
        if (sharedRoutine.formationMove && sharedRoutine.formationMove(target)) return;
        Promise.resolve(sharedRoutine.kiteIfNeeded(target)).then(function(kiting) {
          if (!kiting && currentTarget() === target)
            return sharedRoutine.approachCombatTarget(target);
        }).catch(reportError);
      } catch (error) {
        reportError(error);
      }
    }
    async function supportTick(role8, epoch) {
      if (!await role8.usePotion()) await sharedRoutine.regenerateHpOrMp();
      if (!supportAllowed(epoch)) return;
      if (await role8.beforeTarget()) return;
      if (!currentEpoch(epoch)) return;
      const target = currentTarget();
      if (target && (!sharedRoutine.groupedAttackAllowed || sharedRoutine.groupedAttackAllowed(target)) && (target.mtype !== "tinyp" || sharedRoutine.rareAttackAllowed?.(target, "support")))
        await role8.beforeAttack(target);
    }
    async function lootTick() {
      if (looting || !active || character.rip || ["pending", "feed"].includes(sharedRoutine.getAbtestingMode())) return;
      looting = true;
      try {
        await sharedRoutine.smartLoot();
      } catch (error) {
        reportError(error);
      } finally {
        looting = false;
      }
    }
    async function tick() {
      if (working || !active) return;
      working = true;
      const epoch = generation;
      try {
        const role8 = resolvedRole();
        if (character.rip || sharedRoutine.isOccupied()) return;
        const mode = sharedRoutine.getAbtestingMode();
        if (mode === "pending") return;
        if (mode === "feed") {
          await sharedRoutine.runAbtestingSabotage();
          return;
        }
        await supportTick(role8, epoch);
      } catch (error) {
        reportError(error);
      } finally {
        if (epoch === generation) working = false;
      }
    }
    return root.partyRoleRunner = {
      isKnownDead(id) {
        return killed.has(id);
      },
      invalidateTarget(id) {
        if (id) killed.set(id, Date.now());
        if (!id || id === selectedTarget) {
          invalidated = true;
          void selectTarget();
        }
        attacks.wake();
      },
      wake() {
        void selectTarget();
        attacks.wake();
      },
      resetTargeting() {
        generation++;
        selectedTarget = null;
        invalidated = true;
        selecting = false;
        working = false;
        attacks.reset();
        skills?.reset();
        queueClient?.reset();
      },
      role: function() {
        return resolvedRole();
      },
      start: function() {
        if (!root.sharedRoutine || typeof root.sharedRoutine.isOccupied !== "function")
          throw new Error("Shared party code is not ready; refusing to start combat timers");
        if (timer) return;
        skills = installSkillRuntime(root);
        equipment2 = installPorcupineEquipment(root);
        game_log(character.name + " loaded generic " + resolvedRole().name + " behavior", "#51D2E1");
        active = true;
        root.partyCombatState = { at: Date.now(), stage: "start", error: null };
        timer = setInterval(tick, 250);
        lootTimer = setInterval(() => {
          void lootTick();
        }, 250);
        targetTimer = setInterval(() => {
          for (const [id, at] of killed) if (Date.now() - at > 1e4) killed.delete(id);
          void selectTarget();
        }, 1e3);
        attacks.start();
        movementTimer = setInterval(movementTick, 100);
        void selectTarget();
        respawnTimer = setInterval(function() {
          if (character.rip) {
            generation += 1;
            selectedTarget = null;
            attacks.reset();
            skills?.reset();
            working = false;
            selecting = false;
          }
          void recoverFromDeath();
        }, 250);
        void recoverFromDeath();
      },
      stop: function() {
        skills?.stop();
        equipment2?.stop();
        queueClient?.stop();
        queueMarkers?.stop();
        lootClient?.stop();
        trace?.stop();
        active = false;
        generation += 1;
        selectedTarget = null;
        attacks.reset();
        attacks.stop();
        if (movementTimer) clearInterval(movementTimer);
        if (targetTimer) clearInterval(targetTimer);
        if (root.sharedRoutine && root.sharedRoutine.resetCombatMovement)
          root.sharedRoutine.resetCombatMovement();
        if (timer) clearInterval(timer);
        clearInterval(lootTimer);
        lootTimer = void 0;
        if (respawnTimer) clearInterval(respawnTimer);
        timer = null;
        respawnTimer = null;
        working = false;
      }
    };
  }

  // runtime/characters/roles/compat.ts
  var roles = { mage: role, priest: role2, warrior: role3, ranger: role4, rogue: role5, paladin: role6, merchant: role7 };
  globalThis.partyRoles = roles;
  installRoleRunner(roles[character.ctype]);
})();
