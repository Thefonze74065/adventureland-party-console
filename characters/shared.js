(function (root) {
  // Migrate a browser runner that has accumulated old async convoy closures.
  // Deleting/recreating its CODE iframe retires those closures and timers.
  if (!parent.caracAL && typeof parent.start_runner === "function" &&
      !parent.__partyFreshConvoyRunnerV3) {
    parent.__partyFreshConvoyRunnerV3 = true;
    var bootstrap = "$.ajax({url:" + JSON.stringify((parent.__partyServer || "http://127.0.0.1:924") + "/CODE/adventure_land/universal-loader.js?t=") + " + Date.now()," +
      "dataType:'text',cache:false}).then(function(source){(0,eval)(source);});";
    parent.setTimeout(function () { parent.start_runner("maincode", bootstrap); }, 0);
    return;
  }
  if (!root.partyFarmingZones) throw new Error("Load farming-zones.js before shared.js; party startup aborted");
  var runtimeGeneration = root.__partyRuntimeGeneration =
    (Number(root.__partyRuntimeGeneration) || 0) + 1;
  function runtimeCurrent() { return Number(root.__partyRuntimeGeneration) === runtimeGeneration; }
  var movement = root.installPartyMovement(root, {
    now: Date.now,
    context: function() { return { runtime: convoyRuntimeId || String(runtimeGeneration), revision: Number(navigationIntent && navigationIntent.revision) || 0,
      current: runtimeCurrent() && (!parent.socket || parent.socket.connected !== false), paused: !!root.__partyMovementPaused }; },
    request: request,
    townReady: function() { return !departureCombatPending() && eligibleDepartureChests().length === 0; },
    transitionReady: function() { return eligibleDepartureChests().length === 0; },
    metrics: function(event) { queueCombatEvent('navigation', 'Movement '+(event.phase || (event.done?'completed':'stopped'))+' · '+(event.engine || 'ALClient comparison'), event, 'movement-metrics:'+event.id+':'+(event.phase || 'done')); },
    diagnostic: function(event, message) {
      game_log(message, event.phase === 'Native fallback succeeded' ? '#94a3b8' : '#fbbf24');
      queueCombatEvent('navigation', message, event, 'movement:'+event.id+':'+event.phase+':'+event.at);
    }
  });
  // Compatibility names refer to the managed service, never the native walker.
  var smart = movement.state, smart_move = bankSortMove, stop = movement.stop;
  var escapeState = null, escapeLocal = null, escapePulseBusy = false, escapeSurvivalBusy = false;
  function escapeOwns() { return !!escapeState && character.ctype !== "merchant"; }
  function escapeCost(skill) {
    var def = G.skills[skill] || {};
    return Math.max(0, Number(def.mp || (skill === "heal" ? character.mp_cost : 0)) || 0) *
      (100 - (Number(character.mp_reduction) || 0)) / 100;
  }
  function escapeReady(skill) {
    return !!G.skills[skill] && character.mp >= escapeCost(skill) && !is_on_cooldown(skill) && can_use(skill);
  }
  function escapeUse(skill, target) {
    return anniversaryWithTimeout(use_skill(skill, target), 2000, "Escape " + skill);
  }
  function escapeObserveHit(data) {
    if (!runtimeCurrent() || !escapeOwns() || !escapeLocal || character.ctype !== "warrior" || character.rip || !data) return;
    var target = String(data.id || data.target || "");
    if (target !== character.name && (!character.id || target !== String(character.id))) return;
    if (!data.heal && (Number(data.damage) > 0 || data.evade || data.miss)) escapeLocal.attacked = true;
  }
  function escapeShielded(local) {
    if (local.shellCasting) return true;
    if (character.s && character.s.hardshell) {
      local.shellObserved = true;
      local.shellCycle = true;
      return true;
    }
    // A successful cast can resolve before its condition reaches the client.
    return !!local.shellPendingUntil && !local.shellObserved && Date.now() < local.shellPendingUntil;
  }
  async function escapePotions(current) {
    var local = escapeLocal;
    if (!local || local.potionBusy || !current() || character.rip) return;
    local.potionBusy = true;
    try {
      var budget = character.ctype === "warrior" ?
        (escapeShielded(local) ? character.max_mp : escapeCost("hardshell") + 2 * escapeCost("dash")) :
        character.ctype === "priest" ? escapeCost("curse") + escapeCost("partyheal") + escapeCost("heal") : character.max_mp;
      if (!is_on_cooldown("use_mp")) {
        if (character.mp < Math.min(character.max_mp, budget)) await escapeUse("use_mp");
        else if (character.ctype !== "mage" && character.hp < character.max_hp) await escapeUse("use_hp");
      }
    } finally { local.potionBusy = false; }
  }
  async function escapeCharge(current, local) {
    if (!current() || character.rip || escapeLocal !== local || local.chargeUsed || escapeShielded(local)) return;
    if (escapeReady("charge")) {
      try {
        await escapeUse("charge");
        if (current() && escapeLocal === local) local.chargeUsed = true;
      } catch (_) { /* Retry on a later pulse; keep retreating. */ }
    }
  }
  async function escapeWarriorDefense(current, point) {
    var local = escapeLocal;
    if (character.ctype !== "warrior" || character.rip || !local || !current()) return false;
    if (local.defenseBusy) return true;
    local.defenseBusy = true;
    try {
      if (escapeShielded(local)) return false;
      var shieldEnded = local.shellCycle;
      if (shieldEnded) {
        local.shellCycle = false;
        local.shellPendingUntil = 0;
        local.shellObserved = false;
        local.chargeUsed = false;
        var weapon = character.slots && character.slots.mainhand;
        var basher = weapon && G.items && G.items[weapon.name] && G.items[weapon.name].wtype === "basher";
        var nearby = Object.values(parent.entities || {}).some(function (e) {
          return e.type === "monster" && e.visible && !e.dead && is_in_range(e, "stomp");
        });
        if (basher && nearby && escapeReady("stomp")) {
          try { await escapeUse("stomp"); } catch (_) { /* Stun is optional; keep escaping. */ }
        }
        if (!current() || escapeLocal !== local || character.rip) return true;
      }
      if (!shieldEnded && local.attacked &&
          (!local.shellAt || Date.now() - local.shellAt >= 500) && escapeReady("hardshell")) {
        local.shellAt = Date.now();
        local.shellCasting = true;
        try {
          await escapeUse("hardshell");
          if (!current() || escapeLocal !== local || character.rip) return true;
          local.shellCycle = true;
          local.shellObserved = !!(character.s && character.s.hardshell);
          local.shellPendingUntil = Date.now() + (Number(G.skills.hardshell.duration) || 8000);
          return false;
        } catch (_) { /* A rejected shield must not prevent retreat. */ }
        finally { local.shellCasting = false; }
      }
      if (!current() || escapeLocal !== local || character.rip || escapeShielded(local)) return true;
      if (!point || character.s && character.s.dash || !can_move_to(point.x, point.y)) return false;
      await escapeCharge(current, local);
      if (!current() || escapeLocal !== local || character.rip || escapeShielded(local)) return true;
      if (!escapeReady("dash")) return false;
      var reserve = escapeCost("hardshell") + 2 * escapeCost("dash");
      if (!local.attacked && character.mp - escapeCost("dash") < reserve) return false;
      character.direction = point.x !== character.x ? (point.x < character.x ? 1 : 2) : (point.y < character.y ? 3 : 0);
      try { await escapeUse("dash"); return true; }
      catch (_) { return false; }
    } finally { local.defenseBusy = false; }
  }
  function escapeForwardPoint() {
    var direction = [[0,40],[-40,0],[40,0],[0,-40]][character.direction];
    return character.moving && direction ? { x: character.x + direction[0], y: character.y + direction[1] } : null;
  }
  async function applyEscape(state) {
    var old = escapeState;
    escapeState = state;
    if (!state) {
      escapeLocal = null;
      if (old) { try { await stop("smart"); } catch (_) {} try { await stop("move"); } catch (_) {} }
      return;
    }
    if (!old || old.id !== state.id || old.stage !== state.stage &&
        ["recovering", "complete", "failed-hold"].indexOf(state.stage) >= 0) {
      if (!old || old.id !== state.id) escapeLocal = { id: state.id, landed: false, error: null, rejected: {} };
      if (escapeState !== state || !runtimeCurrent()) return;
      if (convoyTraveling) { releaseConvoyCruise(convoyTraveling); convoyTraveling.cancelled = true; if (convoyTraveling.release) convoyTraveling.release(); }
      if (farmingTravelToken) farmingTravelToken.cancelled = true;
      if (reunion) reunion.cancelled = true;
      reunion = null; reunionMageOffer = null;
      followingLeader = false; forceTraveling = false; combatTargetId = null;
      root.__partyTownGeneration = (Number(root.__partyTownGeneration) || 0) + 1;
      try { await stop("smart"); } catch (_) {}
      try { await stop("move"); } catch (_) {}
    }
  }
  function escapeLanding() {
    var map = G.maps[character.map] || {}, candidates = [];
    // The Town destination is the map's first spawn. Prefer it on outdoor
    // town maps; underground maps use their actual door coordinates.
    var transporter = (map.npcs || []).find(function (npc) { return npc.id === "transporter"; });
    if (map.outside && !map.event && transporter && map.spawns && map.spawns[0])
      candidates.push({ x: map.spawns[0][0], y: map.spawns[0][1], town: true });
    if (transporter && Array.isArray(transporter.position))
      candidates.push({ x: transporter.position[0], y: transporter.position[1] + 40, town: false });
    (map.doors || []).forEach(function (door) {
      if (Array.isArray(door) && Number.isFinite(door[0]) && Number.isFinite(door[1])) {
        // Offset onto the map side rather than landing directly on a portal.
        [ [0, 40], [0, -40], [40, 0], [-40, 0] ].forEach(function (offset) {
          candidates.push({ x: door[0] + offset[0], y: door[1] + offset[1], town: false });
        });
      }
    });
    var enemies = Object.values(parent.entities || {}).filter(function (e) { return e.type === "monster" && e.visible && !e.dead; });
    candidates = candidates.filter(function (p) {
      if (escapeLocal.rejected[p.x + "," + p.y]) return false;
      return typeof can_move !== "function" || can_move({ map: character.map, x: p.x, y: p.y, going_x: p.x, going_y: p.y, base: character.base });
    });
    candidates.forEach(function (p) {
      p.risk = enemies.reduce(function (risk, e) { return risk + Math.max(0, (Number(e.range) || 80) + 120 - Math.hypot(e.x - p.x, e.y - p.y)); }, 0);
      p.distance = Math.hypot(character.x - p.x, character.y - p.y);
    });
    candidates.sort(function (a, b) { return a.risk - b.risk || Number(b.town) - Number(a.town) || a.distance - b.distance; });
    return candidates[0];
  }
  async function escapeSurvivalPulse() {
    if (!runtimeCurrent() || !escapeOwns() || ['recovering','recovery-convoy','complete','failed-hold'].indexOf(escapeState.stage)<0 || character.rip || escapeSurvivalBusy) return;
    var state = escapeState;
    function current() { return runtimeCurrent() && escapeState && escapeState.id === state.id && !character.rip; }
    escapeSurvivalBusy = true;
    try {
      await escapePotions(current);
      if (!current()) return;
      if (character.ctype === "warrior" && !(character.map === 'main' && Math.hypot(character.x,character.y)<=65)) {
        await escapeWarriorDefense(current, escapeForwardPoint());
      } else if (character.ctype === "priest") await anniversaryWithTimeout(healPartyBelow(.95), 2000, "Escape survival healing");
    } finally { escapeSurvivalBusy = false; }
  }
  async function escapePulse() {
    if (!runtimeCurrent() || !escapeOwns() || !escapeLocal || escapePulseBusy) return;
    var state = escapeState, local = escapeLocal;
    function current() { return runtimeCurrent() && escapeState && escapeState.id === state.id && escapeState.stage === state.stage && escapeLocal === local; }
    escapePulseBusy = true;
    try {
      if (["complete", "failed-hold", "recovery-convoy"].indexOf(state.stage) >= 0) return;
      if (state.stage === "recovering") {
        if(local.recoveryFailed)return;
        if (character.rip) { await respawn(); return; }
        if (character.map === "main" && Math.hypot(character.x, character.y) <= 65) return;
        // Failed group rescue does not stop survivors: each still escapes.
        if (character.ctype === "mage" && !local.recoveryBlinked && escapeReady("blink")) {
          var landing = escapeLanding();
          if (landing) {
            local.recoveryBlinked = true;
            try { await anniversaryWithTimeout(use_skill("blink", [landing.x, landing.y]), 2500, "Independent escape Blink"); }
            catch (error) { local.error = String(error.reason || error.message || error); }
          }
          if (!current()) return;
        }
        if (character.map !== "main") {
          if (character.map === "goobrawl") await exitGoobrawlForRecovery({}, current);
          else {
            try {await eventReturnRouteToMain({ map: "main", x: 0, y: 0 }, Date.now() + 180000, current);}
            catch(error){if(current()){local.recoveryFailed=true;local.error=String(error.message||error);}return;}
          }
        }
        if (current() && character.map === "main") {
          joinedEvent = null; eventTraveling = false; travellingEventName = null;
          if (Math.hypot(character.x, character.y) > 65)
            await anniversaryWithTimeout(smart_move({ map: "main", x: 0, y: 0 }), 20000, "Independent escape to safety");
        }
        return;
      }
      if (character.rip) return;
      var arrived = state.destination && character.map === state.destination.map && character.in === state.destination.in &&
        Math.hypot(character.x - state.destination.x, character.y - state.destination.y) <= 65;
      if (character.ctype !== "mage" && arrived) return;
      await escapePotions(current);
      if (!current()) return;
      if (character.ctype === "mage") {
        if (state.stage === "blink") {
          if (local.destination && character.map === local.destination.map && Math.hypot(character.x - local.destination.x, character.y - local.destination.y) < 40) { local.landed = true; local.error = null; return; }
          if (!escapeReady("blink")) { local.error = "Waiting for Blink mana or cooldown"; return; }
          var point = escapeLanding();
          if (!point) { local.error = "No valid Town or exit landing on " + character.map; return; }
          local.destination = { map: character.map, in: character.in, server: reunionRealm(), x: point.x, y: point.y };
          try { await anniversaryWithTimeout(use_skill("blink", [point.x, point.y]), 2500, "Escape Blink"); }
          catch (error) { if (current()) { local.rejected[point.x + "," + point.y] = true; local.error = String(error.reason || error.message || error); } }
        } else {
          var name = state.roles[state.stage], member = partyPositions.find(function (p) { return p.name === name; });
          if (!name || !member || !member.escape || member.escape.id !== state.id || member.escape.readyForPort !== state.stage) { local.error = "Waiting for " + name + " to accept rescue"; return; }
          if (!escapeReady("magiport")) { local.error = "Waiting for Magiport mana or cooldown"; return; }
          if (local.portAt && Date.now() - local.portAt < 3000) return;
          local.portAt = Date.now();
          await anniversaryWithTimeout(use_skill("magiport", name), 2500, "Escape Magiport");
          local.error = "Waiting for " + name + " arrival";
        }
      } else {
        local.readyForPort = state.stage === character.ctype ? state.stage : null;
        if (character.ctype === "warrior") await escapeWarriorDefense(current, escapeForwardPoint());
        if (!current()) return;
        if (character.ctype === "priest") {
          var healed = await anniversaryWithTimeout(healPartyBelow(0.95), 2000, "Escape healing");
          if (!current()) return;
          var threat = Object.values(parent.entities || {}).find(function (e) { return e.type === "monster" && e.visible && !e.dead && state.participants.indexOf(e.target) >= 0 && !(e.s && e.s.cursed) && is_in_range(e, "curse"); });
          if (!healed && threat && escapeReady("curse")) await escapeUse("curse", threat);
        }
        if (!current() || character.moving) return;
        var enemy = Object.values(parent.entities || {}).filter(function (e) { return e.type === "monster" && e.visible && !e.dead; })
          .sort(function (a, b) { return Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y); })[0];
        if (!enemy) return;
        var steps = [[40,0],[-40,0],[0,40],[0,-40]].map(function (d) { return { x: character.x + d[0], y: character.y + d[1] }; })
          .filter(function (p) { return can_move_to(p.x, p.y); })
          .sort(function (a, b) { return Math.hypot(b.x - enemy.x, b.y - enemy.y) - Math.hypot(a.x - enemy.x, a.y - enemy.y); });
        var step = steps[0]; if (!step) { local.error = "Retreat blocked by terrain"; return; }
        if (!await escapeWarriorDefense(current, step) && current()) move(step.x, step.y);
      }
    } catch (error) { if (current()) local.error = String(error.reason || error.message || error); }
    finally { escapePulseBusy = false; }
  }
  var previous = root.sharedRoutine;
  if (previous && typeof previous.stop === "function") previous.stop();
  // Native CODE iframe replacement does not remove listeners installed on the
  // game window's socket. Keep ownership there so a new iframe can retire them.
  var partyCombatSocketOwner = {};
  function retirePartyCombatSockets(owner) {
    var registered=parent.__partyCombatSocketSubscriptions || [];
    parent.__partyCombatSocketSubscriptions=registered.filter(function(entry) {
      if(owner && entry.owner!==owner)return true;
      if(entry.socket && typeof entry.socket.off==="function")entry.socket.off(entry.event,entry.handler);
      return false;
    });
  }
  function migratePartyCombatSockets() {
    retirePartyCombatSockets();
    var socket=parent.socket;
    if(!socket || typeof socket.listeners!=="function" || typeof socket.off!=="function")return;
    // One-time migration of our pre-registry callbacks. Do not remove the
    // game's callbacks or other scripts' listeners.
    var signatures={action:["rememberMapEvent", "queueCombatEvent"],hit:["rememberMapEvent", "recentOwnHits", "observeFarmHit"],
      death:["deathCombatMessage", "reportFightDeath"],kill_credit:["pendingKillCredits"],
      disappearing_text:["pendingKillCredits"],chest_opened:["lastInventoryTotals"],
      disappear:["observeFightPacket"],entities:["reportFightDeath"]};
    Object.keys(signatures).forEach(function(event) {
      socket.listeners(event).slice().forEach(function(handler) {
        var source=String(handler);
        if(signatures[event].some(function(signature){return source.indexOf(signature)>=0;}))socket.off(event,handler);
      });
    });
  }
  migratePartyCombatSockets();
  if (root.__partyEscapeTimer) clearInterval(root.__partyEscapeTimer);
  root.__partyEscapeTimer = setInterval(function () { escapeSurvivalPulse().catch(function () {}); escapePulse().catch(function () {}); }, 100);
  // This routine means "ensure music is off", not "toggle music". Checking
  // the live flag first prevents a hot reload from accidentally turning it on.
  if (parent.sound_music) {
    if (typeof parent.sound_off === "function") parent.sound_off();
    else {
      parent.sound_music = "";
      if (typeof parent.reflect_music === "function") parent.reflect_music();
    }
  }
  // Navigation labels and half-finished searches live on the game window,
  // outside this routine's closure. Clean them during every code generation.
  root.__partyNavigationDetail = null;
  root.__partyTownGeneration = (Number(root.__partyTownGeneration) || 0) + 1;

  var api = (root.__partyServer || parent.__partyServer || "http://127.0.0.1:924") + "/party-api";
  var timer = null;
  var busy = false;
  var regenerationBusy = false;
  var healingBusy = false;
  if (root.__partyPassiveRegenTimer) clearInterval(root.__partyPassiveRegenTimer);
  root.__partyPassiveRegenTimer = null;
  var coordinatorClockOffset = 0;
  var banking = false;
  var bankQueued = false;
  var stocking = false;
  var upgrading = false;
  var activeUpgrade = null;
  var departurePending = false;
  var townTraveling = false;
  var partyTownActive = false;
  var townOverrideInFlight = false;
  var partyConvoyActive = false;
  var huntTurnInPriority = false;
  var navigationIntent = root.__partyNavigationIntent || { revision: 0, cancelled: false };
  var farmingTravelToken = null;
  var lastStockAttempt = 0;
  // Retained coordinator commands must not restart merely because this file
  // hot-reloaded. A long commerce coroutine cannot be cancelled by replacing
  // sharedRoutine, so keep the consumed command id on the persistent root.
  var lastCommand = Number(root.__partyLastCommand) || 0;
  var partyLocation = null;
  var leader = null;
  var followLeader = false;
  var desiredPartyMembers = [];
  var partySyncBusy = false;
  var lastPartyActionAt = 0;
  var previousPartyInviteHandler = root.on_party_invite;
  var previousPartyRequestHandler = root.on_party_request;
  if (root.__partyRosterTimer) clearInterval(root.__partyRosterTimer);
  root.__partyRosterTimer = null;
  var leaderTarget = null;
  var leaderCombatSelection = null;
  var groupedCombat = root.__partyGroupedCombat || null;
  var fightDeaths = root.__partyFightDeaths || [];
  var fightPackets = root.__partyFightPackets || [];
  var combatSelection = { id: null, revision: 0, map: null };

  var leaderLocation = null;
  var farmingSpawnMissingSince = 0;
  var farmingSpawnRecoveryPending = false;
  var farmingSpawnRecoveryRetryAt = 0;
  var convoyTraveling = null;
  var convoySignal = null;
  var convoyRuntimeId = Date.now() + "-" + Math.random().toString(36).slice(2);
  var dashboardSampler = root.createPartyDashboardSampler && root.createPartyDashboardSampler({
    now: function () { return Date.now() + coordinatorClockOffset; }, current: runtimeCurrent,
    name: function () { return character.name; }, runtime: function () { return convoyRuntimeId; },
    sample: function () {
      return { vitals: { hp: character.hp, mp: character.mp, max_hp: character.max_hp,
        max_mp: character.max_mp, x: character.real_x === undefined ? character.x : character.real_x,
        y: character.real_y === undefined ? character.y : character.real_y, map: character.map,
        in: character.in, xp: character.xp || 0, max_xp: character.max_xp || 0, gold: character.gold,
        rip: !!character.rip, target: character.target || null, conditions: activeConditions(),
        inventorySize: Number(character.isize) || character.items.length },
        items: Object.assign({}, character.items), slots: Object.assign({}, character.slots) };
    },
    entry: function (item, slot, equipment) {
      return equipment ? { item: fingerprint(item), meta: itemDefinition(item) } : inventoryOperationEntry(item, Number(slot));
    },
    send: function (body) { return request("/dashboard-telemetry", { method: "POST", body: body, timeout: 2500 }); }
  });
  var gameLogCapture = root.installPartyGameLogs && root.installPartyGameLogs(parent, function(events) {
    return request("/game-logs", { method: "POST", body: { character: character.name, events: events } });
  });
  var combatTargetId = null;
  var monsterFocus = ["goo"];
  var monsterPriorities = {};
  var passiveHunting = {rules:{},useFieldGenerators:true};
  var passingEncounters = parent.__partyPassingEncounters || (parent.__partyPassingEncounters = {});
  var passiveGeneratorAttempt = null, peerPassingEncounters = parent.__partyPeerPassingEncounters || [];
  var passiveRareHunts = { tinyp: false, phoenix: false, goldenbat: false, cutebee: false, hen: false, rooster: false };
  var rareControlState = null, rareControlAt = 0, rarePath = null;
  var rareLoot = null, rareLootPending = false;
  var rareNavigation = null, rareDeployment = null, rareKills = [], rareKnown = {};
  var monsterSearchRadius = 400;
  var farmingMode = "default";
  var farmingPolicy = "auto";
  var huntCombatTarget = null;
  var farmingModeResetUntil = 0;
  var scatterMonsterTypes = {};
  var observedOneShotTypes = root.__partyObservedOneShotTypes || {};
  var scatterEpoch = 0;
  var farmingMonsterType = null;
  var partyFarmingMonsterType = null;
  var scatterBreakTarget = null;
  var recentCombatDeviation = null;
  var lastFarmingMonsterType = root.__partyLastFarmingMonsterType || null;
  var eventsEnabled = false;
  var enabledEventSelections = null;
  var pendingEventDisables = root.__partyPendingEventDisables || [];
  var travellingEventName = null, eventSelectionRevision = 0;
  var eventClockOffset = 0, eventClockSyncedAt = 0, eventClockRequest = null;
  var eventFeedAt = Date.now(), eventClockTimer = null;
  function eventSelected(name) { return enabledEventSelections === null ? name === "anniversary" || eventsEnabled : enabledEventSelections.indexOf(name) >= 0; }
  function receiveEventFeed() { eventFeedAt = Date.now(); }
  function receiveEventClock(data) {
    if (!eventClockRequest) return;
    var received = Date.now(), time = Date.parse(data && data.date);
    if (Number.isFinite(time) && received - eventClockRequest.wall <= 5000) {
      eventClockOffset = time - (eventClockRequest.wall + received) / 2;
      eventClockSyncedAt = received;
    }
    eventClockRequest = null;
  }
  function syncEventClock() {
    if (!parent.socket || !parent.socket.emit) return;
    eventClockRequest = { wall: Date.now() };
    parent.socket.emit("test", {});
  }
  function eventScheduleSnapshot() {
    var status = eventStatus(), names = Object.keys(G.events || {});
    if (names.indexOf("snowman") < 0) names.push("snowman");
    return names.map(function(id) {
      var value = status[id] || {};
      var schedule = status.schedule || {}, kind = ["crabxx", "goobrawl", "abtesting"].indexOf(id) >= 0 ? "daily" : ["icegolem", "franky"].indexOf(id) >= 0 ? "nightly" : null;
      var hours = kind === "daily" ? schedule.dailies : kind === "nightly" ? schedule.nightlies : null;
      var slotAt = null, now = Date.now() + eventClockOffset, offset = Number(schedule.time_offset);
      if (Array.isArray(hours) && Number.isFinite(offset)) hours.forEach(function(hour) {
        var date = new Date(now); date.setUTCHours((Number(hour) - offset + 24) % 24, 0, 0, 0);
        var next = date.getTime(); if (next <= now) next += 86400000;
        if (!slotAt || next < slotAt) slotAt = next;
      });
      return { slotAt: slotAt || undefined, slotKind: kind || undefined, id: id, name: id === "anniversary" ? "Anniversary" : id === "snowman" ? "Snowman" : G.events[id].name || id,
        live: !!status[id] && value.live !== false && value.active !== false,
        next: anniversaryEpoch(value.next) || undefined, expires: anniversaryEpoch(value.expires || value.end) || undefined };
    });
  }
  var eventTargetTypes = [];
  var eventTraveling = false; travellingEventName = null;
  var eventPollBusy = false;
  var joinedEvent = root.__partyJoinedEvent || null;
  var manuallySuppressedEvent = root.__partyManuallySuppressedEvent || null;
  var eventMissingSince = 0;
  var partyEventHint = null;
  var eventReturnPending = false;
  var eventRecoveryRetryAt = 0;
  var eventRecoveryState = { phase: "idle", cycleId: null, event: null,
    checkpoint: null, attemptAt: 0, lastError: null };
  var abtestingStrategy = null;
  var anniversaryBusy = false;
  var anniversaryStage = "idle";
  var anniversaryRound = null;
  var anniversaryLastAttemptAt = 0;
  var anniversaryMerchantMode = "idle";
  var anniversaryMerchantAttemptAt = 0;
  var anniversaryMerchantRetryAt = 0;
  var anniversaryMerchantFeaturedHold = false;
  var anniversaryCompletedRounds = root.__anniversaryCompletedRounds || {};
  var merchantForceStand = false;
  var merchantCashTarget = 0;
  var anniversaryPlan = null;
  var anniversaryPendingHandoff = root.__anniversaryPendingHandoff || null;
  var anniversaryStaging = false;
  var anniversaryReturnReported = null;
  var anniversaryStagingReported = null;
  var anniversaryReturnLocation = root.__anniversaryReturnLocation || null;
  var anniversaryChatSending = false;
  var anniversaryKissResponses = [];
  root.__anniversaryCompletedRounds = anniversaryCompletedRounds;
  if (root.__partyAnniversaryTimer) clearInterval(root.__partyAnniversaryTimer);
  root.__partyAnniversaryTimer = null;
  if (root.__partyEventTimer) clearInterval(root.__partyEventTimer);
  root.__partyEventTimer = null;
  var partyPositions = [];
  var bankStackHomes = {};
  var reunion = root.__partyReunion || null, reunionWorking = false;
  var reunionMageOffer = null;
  var previousReunionCm = root.on_cm, previousMagiport = root.on_magiport;
  if (root.__partyReunionTimer) clearInterval(root.__partyReunionTimer);
  if (reunion) {
    reunion.cancelled = true;
    reunion = root.__partyReunion = Object.assign({}, reunion, { cancelled: false, moving: false });
    Promise.resolve(stop("smart")).catch(function () {});
  }
  var partyThreats = [];
  var partyTargets = [];
  var lastSeparationAt = 0;
  var catalogKnown = false;
  var catalogPrepared = false;
  var catalogPreparing = false;
  var catalogGeneration = 0;
  var forceTraveling = false;
  var mapTelemetryEnabled = false;
  var mapTelemetryBusy = false;
  var mapTelemetryEvents = [];
  var combatEventQueue = [];
  var combatEventBusy = false;
  var recentCombatEvents = {};
  var recentOwnHits = {};
  var recentOwnKills = [];
  var lastIncomingDamage = null;
  var lastDeathInfo = root.__partyLastDeathInfo || parent.__partyLastDeathInfo || null;
  var huntEventTrip = root.__partyHuntEventTrip || null;

  function captureHuntDeath(death) {
    var at = Date.now();
    var trip = huntEventTrip && !huntEventTrip.endedAt ? huntEventTrip :
      !huntEventTrip && joinedEvent ? {event: joinedEvent, startedAt: at} : null;
    return { at: at, message: death.message, details: death.details,
      eventTrip: trip ? Object.assign({}, trip) : null };
  }
  var pendingKillCredits = [];
  var combatWasDead = !!character.rip;
  var lastInventoryTotals = inventoryTotals();
  if (root.__partyDashboardTelemetryTimer) clearInterval(root.__partyDashboardTelemetryTimer);
  if (root.__partyMapTelemetryTimer) clearInterval(root.__partyMapTelemetryTimer);
  root.__partyMapTelemetryTimer = null;
  if (root.__partyTrackerTimer) clearInterval(root.__partyTrackerTimer);
  root.__partyTrackerTimer = null;
  if (root.__partyPlayerDirectoryTimer) clearInterval(root.__partyPlayerDirectoryTimer);
  root.__partyPlayerDirectoryTimer = null;
  var realmPlayers = [];
  var gatheringMode = null;
  var gatheringModes = [];
  if (root.__merchantGatheringTimer) clearInterval(root.__merchantGatheringTimer);
  root.__merchantGatheringTimer = null;
  root.__merchantGatheringGeneration = (Number(root.__merchantGatheringGeneration) || 0) + 1;
  if (root.__merchantGatheringAttempt) {
    root.__merchantGatheringAttempt.cancelled = "code reload";
    if (typeof stop === "function") Promise.resolve(stop()).catch(function () {});
  }
  var gatheringTimer = null;
  var gatheringActive = false;
  var gatheringRetryAt = 0;
  var gatheringGeneration = root.__merchantGatheringGeneration;
  var gatheringSession = root.__merchantGatheringSession || null;
  var gatheringCooldowns = root.__merchantGatheringCooldowns || { fishing: 0, mining: 0 };
  root.__merchantGatheringCooldowns = gatheringCooldowns;
  var gatheringLastStatus = null;
  var gatheringStatusTimes = root.__merchantGatheringStatusTimes || {};
  root.__merchantGatheringStatusTimes = gatheringStatusTimes;
  if (root.__merchantLuckScanTimer) clearInterval(root.__merchantLuckScanTimer);
  root.__merchantLuckScanTimer = null;
  if (root.__merchantPontyTimer) clearInterval(root.__merchantPontyTimer);
  root.__merchantPontyTimer = null;
  var pontyListings = root.__merchantPontyListings || [];
  var pontyUpdatedAt = Number(root.__merchantPontyUpdatedAt) || 0;
  var pontyError = null;
  var pontyRefreshBusy = false;

  function serverCooldownUntil(mode) {
    var value = parent.next_skill && parent.next_skill[mode];
    if (!value) return 0;
    var timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function syncGatheringCooldown(mode) {
    var observed = serverCooldownUntil(mode);
    if (observed > (Number(gatheringCooldowns[mode]) || 0)) gatheringCooldowns[mode] = observed;
    return Number(gatheringCooldowns[mode]) || 0;
  }

  function hasGatheringAccess(mode) {
    return !!(parent.quirks && parent.quirks[mode]);
  }
  var gatheringStandListings = [];
  var merchantWeapon = null;
  var luckyUpgradeSlot = null;
  var upgradePreviewSession = Date.now() + ":" + Math.random();
  var upgradePreviewActive = false;
  var lastUpgradePreview = null;
  var luckyUpgradeService = null;
  var luckySlotTracker = null;
  function luckySlotTracking() {
    if (!luckySlotTracker) {
      var key = "party-lucky-slot-tracking:" + character.owner + ":" + character.name;
      luckySlotTracker = root.createPartyLuckySlotTracker({
        read: function () { return JSON.parse(root.localStorage.getItem(key) || "null"); },
        write: function (value) { root.localStorage.setItem(key, JSON.stringify(value)); },
        now: Date.now,
        isUpgradeScroll: function (name) { return !!(G.items[name] && G.items[name].type === "uscroll"); }
      });
    }
    return luckySlotTracker;
  }
  function luckySlotRollListener(event) {
    if (runtimeCurrent()) luckySlotTracking().observe(event);
  }
  var merchantIdleActive = false;
  var merchantIdlePending = null;
  var followingLeader = false;
  var lastAttackAt = 0;
  var lastAttackTarget = null;
  var lastLootAt = 0;
  var lastLootChest = null;
  var lootRetryAt = {};
  var lastCleanoutRequestAt = 0;
  // Kept across consecutive collection jobs so the merchant can visit the whole
  // party before making one bank trip.
  var merchantPendingBank = [];
  var merchantPendingGold = 0;
  var itemWorldCache = {};
  var itemDropCache = {};
  var itemValuationCache = {};
  var lootOutcomeCache = {};
  // Suggested-price drop math assumes the party is maintaining at least 115%
  // Luck. Keep canonical drop data untouched for the bestiary/item inspector;
  // only the precomputed valuation probabilities are adjusted.
  var valuationLuckMultiplier = 1.15;
  var merchantCatalogVersion = "exchange-rewards-v4";
  var trackerDropData = typeof tracker !== "undefined" && tracker && Object.keys(tracker).length ? tracker : null;
  var trackerCatalogInitialized = !!trackerDropData;
  // The native game updates parent.tracker before calling render_tracker.
  // Silence automatic responses without hiding unrelated modals or blocking
  // deliberate clicks. Manual requests use the normal socket.emit entrypoint.
  function installSilentTracker() {
    if (root.__partyRestoreTrackerUI) root.__partyRestoreTrackerUI();
    if (parent.caracAL || !parent.socket || typeof parent.render_tracker !== "function") return null;
    var socket = parent.socket, emit = socket.emit, render = parent.render_tracker;
    var automaticUntil = 0, manualUntil = 0;
    function trackedEmit(event) {
      if (event === "tracker") manualUntil = Date.now() + 15000;
      return emit.apply(this, arguments);
    }
    function trackedRender() {
      if (manualUntil > Date.now()) {
        manualUntil = 0;
        return render.apply(this, arguments);
      }
      if (automaticUntil > Date.now()) return;
      return render.apply(this, arguments);
    }
    socket.emit = trackedEmit;
    parent.render_tracker = trackedRender;
    root.__partyRestoreTrackerUI = function () {
      if (socket.emit === trackedEmit) socket.emit = emit;
      if (parent.render_tracker === trackedRender) parent.render_tracker = render;
      root.__partyRestoreTrackerUI = null;
    };
    return function () {
      // Retain the guard through retries and delayed responses. Bypass only
      // our manual-request marker; retain the game's original socket receiver.
      automaticUntil = Date.now() + 60000;
      return emit.call(socket, "tracker");
    };
  }
  var requestSilentTracker = installSilentTracker();
  function holdsTracktrix(items) {
    return (items || []).some(function (item) { return item && item.name === "tracker"; });
  }
  var trackerWasHeld = false;
  function scheduleTrackerSnapshot(delay) {
    if (root.__partyTrackerTimer) clearTimeout(root.__partyTrackerTimer);
    root.__partyTrackerTimer = trackerWasHeld ? setTimeout(requestTrackerSnapshot, delay) : null;
  }
  function requestTrackerSnapshot() {
    if (!trackerWasHeld) return;
    // Retry a missing response; a successful response schedules the slower refresh.
    scheduleTrackerSnapshot(2000);
    if (requestSilentTracker) requestSilentTracker();
    else if (parent.socket && typeof parent.socket.emit === "function") parent.socket.emit("tracker");
  }
  var trackerInventoryListener = function (data) {
    if (!data || !Array.isArray(data.items)) return;
    // Read the packet, not character.items: the game may apply it after this callback.
    var held = holdsTracktrix(data.items), acquired = held && !trackerWasHeld;
    trackerWasHeld = held;
    if (!held) scheduleTrackerSnapshot(0);
    else if (acquired) requestTrackerSnapshot();
  };
  var trackerCatalogListener = function (data) {
    if (!data || typeof data !== "object") return;
    trackerDropData = data;
    scheduleTrackerSnapshot(30000);
    // Drop tables are account-wide and effectively static during a game-data
    // version. Rebuild the large catalog only for the first live Tracktrix
    // response; later polls merely refresh kill progress.
    if (!trackerCatalogInitialized) {
      trackerCatalogInitialized = true;
      itemWorldCache = {};
      itemDropCache = {};
      itemValuationCache = {};
      lootOutcomeCache = {};
      catalogKnown = false;
      catalogPrepared = false;
      catalogGeneration++;
    }
  };
  var playerDirectoryListener = function (data) {
    if (!Array.isArray(data)) return;
    realmPlayers = data.map(function (entry) { return entry && entry.name; })
      .filter(function (name) { return typeof name === "string" && name && name !== "Hidden"; })
      .filter(function (name, index, all) { return all.indexOf(name) === index; })
      .sort(function (a, b) { return a.localeCompare(b); });
  };
  function requestPlayerDirectory() {
    if (parent.socket && typeof parent.socket.emit === "function") parent.socket.emit("players", {});
  }
  var merchantMarketLocation = { map: "main", x: -63, y: 100 };

  async function merchantTownReturn(activity, owns) {
    owns = owns || function () { return true; };
    if (!owns()) return false;
    if (character.ctype !== "merchant") return false;
    var alreadyHome = character.map === merchantMarketLocation.map &&
      Math.hypot(Number(character.x) - merchantMarketLocation.x,
        Number(character.y) - merchantMarketLocation.y) <= 140;
    if (alreadyHome) return false;
    if (character.stand) await close_stand();
    if (!owns()) return false;
    try { if (typeof stop === "function") await stop("smart"); }
    catch (_stopSmartError) { /* No smart path is active. */ }
    if (!owns()) return false;
    try { if (typeof stop === "function") await stop("move"); }
    catch (_stopMoveError) { /* No direct movement is active. */ }
    if (!owns()) return false;
    if (is_on_cooldown("use_town") || !can_use("use_town")) {
      if (activity) activity.push({ level: "info", message: "Town unavailable; walking back to town" });
      return false;
    }
    var before = { map: character.map, x: Number(character.x), y: Number(character.y) };
    try {
      await use_skill("use_town");
      // `use_town` resolves when channeling starts. Wait for the actual
      // relocation before allowing smart_move to replace the channel.
      var deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (!owns()) return false;
        var relocated = character.map !== before.map ||
          Math.hypot(Number(character.x) - before.x, Number(character.y) - before.y) > 90;
        if (relocated && !is_transporting(character)) break;
        await new Promise(function (resolve) { setTimeout(resolve, 200); });
      }
      var succeeded = character.map !== before.map ||
        Math.hypot(Number(character.x) - before.x, Number(character.y) - before.y) > 90;
      if (!succeeded) throw new Error("Town did not relocate the merchant");
      if (activity) activity.push({ level: "success", message: "Used Town to return from the party" });
      return true;
    } catch (error) {
      if (activity) activity.push({ level: "info", message: "Town return failed; walking instead",
        details: String(error.reason || error.message || error) });
      return false;
    }
  }
  var merchantHomeRealm = "SR_USII";
  var donationXpPerGold = 3.2;
  var merchantRuntimeId = Date.now() + "-" + Math.random().toString(36).slice(2);
  var donationRateListener = function (data) {
    if (!data || data.response !== "lostandfound_info") return;
    donationXpPerGold = data.gold < 500000000 ? 4.8 : data.gold < 1000000000 ? 4 : 3.2;
  };

  if (parent.socket && typeof parent.socket.on === "function") {
    parent.socket.on("game_response", donationRateListener);
    parent.socket.on("q_data", luckySlotRollListener);
    parent.socket.on("tracker", trackerCatalogListener);
    parent.socket.on("player", trackerInventoryListener);
    parent.socket.on("players", playerDirectoryListener);
    // Tracker data is demand-loaded by the normal game UI. Request it when
    // the shared routine starts so the dashboard does not depend on somebody
    // opening Adventure Land's TRACKER window first.
    trackerInventoryListener({ items: character.items || [] });
    requestPlayerDirectory();
    root.__partyPlayerDirectoryTimer = setInterval(requestPlayerDirectory, 10000);
  }

  function rememberMapEvent(kind, data) {
    if (!mapTelemetryEnabled || !data) return;
    mapTelemetryEvents.push({ kind: kind, at: Date.now(), data: safeFields(data) });
    if (mapTelemetryEvents.length > 40) mapTelemetryEvents.splice(0, mapTelemetryEvents.length - 40);
  }
  var mapActionListener = function (data) { rememberMapEvent("action", data); };
  var mapHitListener = function (data) { rememberMapEvent("hit", data); };

  function inventoryTotals() {
    return (character.items || []).reduce(function (totals, item) {
      if (item && item.name) totals[item.name] = (totals[item.name] || 0) + (Number(item.q) || 1);
      return totals;
    }, {});
  }

  function combatLabel(id, fallback) {
    var definition = id && G.items && G.items[id];
    return definition && definition.name || fallback || id || "Unknown";
  }

  function queueCombatEvent(type, message, details, dedupeKey) {
    var now = Date.now(), key = dedupeKey || type + ":" + message;
    if (recentCombatEvents[key] && now - recentCombatEvents[key] < 750) return;
    recentCombatEvents[key] = now;
    combatEventQueue.push({ type: type, message: message, details: details || null, at: now });
    if (combatEventQueue.length > 50) combatEventQueue.splice(0, combatEventQueue.length - 50);
    flushCombatEvents();
  }

  async function flushCombatEvents() {
    if (combatEventBusy || !combatEventQueue.length) return;
    combatEventBusy = true;
    var batch = combatEventQueue.splice(0, 20);
    try {
      await request("/combat-log", { method: "POST", body: { character: character.name, events: batch } });
    } catch (_error) {
      combatEventQueue = batch.concat(combatEventQueue).slice(-50);
    } finally {
      combatEventBusy = false;
      if (combatEventQueue.length) setTimeout(flushCombatEvents, 500);
    }
  }

  function ownActor(value) {
    return String(value || "") === String(character.id || "") || String(value || "") === character.name;
  }

  var combatActionListener = function (data) {
    if (!data || !ownActor(data.attacker)) return;
    var skill = data.source || data.skill;
    if (!skill || skill === "attack" || !(G.skills && G.skills[skill])) return;
    var target = data.target && get_entity(data.target);
    queueCombatEvent("skill", "Used " + ((G.skills[skill] && G.skills[skill].name) || skill), {
      skill: skill, target: target && (target.name || target.mtype) || data.target || null,
    }, "skill:" + skill);
  };
  function defendPartyHit(data) {
    // Continuous Hunt returns keep navigation ownership, including under fire.
    if (convoyTraveling && convoyTraveling.continuousReturn === 1) return;
    if(data && currentPartyList().indexOf(String(data.id))>=0) {
      var aggressor=get_entity(data.hid || data.actor);
      if(aggressor && aggressor.type==='monster' && (!isPassingEncounter(aggressor) || returnDepartureDefense()) && !joinedEvent && !eventTargetTypes.length) {
        root.__partyDefensiveHit={target:groupedEntityReport(aggressor),at:Date.now()};
        interruptConvoyForDefense(null, null, aggressor);
        if(root.partyQueueClient)root.partyQueueClient.evidence(aggressor,'engaged');
      }
    }
  }
  var combatHitListener = function (data) {
    escapeObserveHit(data);
    defendPartyHit(data);
    if(data && (data.kill || data.dead) && root.partyLootClient && currentPartyList().indexOf(String(data.hid||data.actor||''))>=0) {
      var finalTarget=get_entity(data.id) || groupedCombat && groupedCombat.target && groupedCombat.target.id===String(data.id) && groupedCombat.target;
      if(finalTarget)root.partyLootClient.finalKill(finalTarget.mtype);
    }
    if (data && (data.kill || data.dead) && root.partyRoleRunner && root.partyRoleRunner.invalidateTarget)
      { reportFightDeath(data.id); root.partyRoleRunner.invalidateTarget(data.id); }
    if (root.partyQueueClient) root.partyQueueClient.hit(data);
    if (root.partyLootClient && data && currentPartyList().indexOf(String(data.hid || data.actor || ''))>=0) {
      var rareHit=get_entity(data.id);
      if(rareKnown[String(data.id)] || rareHit && ['phoenix','tinyp','goldenbat','cutebee','hen','rooster'].indexOf(rareHit.mtype)>=0)
        root.partyLootClient.rare.hit({id:String(data.id),realm:':'+String(parent.server_region||'')+String(parent.server_identifier||''),map:character.map,in:String(character.in||character.map)});
    }
    observeFarmHit(data);
    if (data && data.kill && rareKnown[String(data.id)]) {
      rareKills.push({ id: String(data.id), mtype: rareKnown[String(data.id)], map: character.map,
        in: String(character.in || character.map), at: Date.now() + coordinatorClockOffset,
        partyEngaged: !!(root.partyLootClient && root.partyLootClient.rare.engaged({id:String(data.id),realm:':'+String(parent.server_region||'')+String(parent.server_identifier||''),map:character.map,in:String(character.in||character.map)})) });
      rareKills = rareKills.slice(-20);
    }
    if (data && ownActor(data.id || data.target) && Number(data.damage) > 0) {
      var attackerId = data.hid || data.actor;
      var attacker = attackerId && get_entity(attackerId);
      if (attacker && attacker.type === "monster") {
        lastIncomingDamage = {
          at: Date.now(), id: attackerId, mtype: attacker.mtype,
          name: G.monsters && G.monsters[attacker.mtype] && G.monsters[attacker.mtype].name || attacker.mtype,
        };
      }
    }
    if (!data || !ownActor(data.hid)) return;
    var entity = data.id && get_entity(data.id);
    if (farmingMode === "scatter" && entity && entity.type === "monster" &&
        partyFarmingMonsterType && entity.mtype !== partyFarmingMonsterType) {
      recentCombatDeviation = { id: entity.id, mtype: entity.mtype, at: Date.now(), reason: "party attack" };
    }
    recentOwnHits[data.id] = { at: Date.now(), name: entity && (entity.name || entity.mtype) || data.mtype || "Monster" };
    if (data.kill || data.dead) {
      var killedType = entity && entity.mtype || data.mtype;
      if (killedType) {
        recentOwnKills.push({ at: Date.now(), mtype: killedType, id: data.id || null });
        if (recentOwnKills.length > 20) recentOwnKills.splice(0, recentOwnKills.length - 20);
        var monsterDefinition = G.monsters && G.monsters[killedType];
        var fullHealth = Number(entity && entity.max_hp) || Number(monsterDefinition && monsterDefinition.hp) || 0;
        // Learn scatter eligibility only from an observed lethal single hit.
        // The learned type is synchronized and persisted by the coordinator.
        if (monsterFocus.indexOf(killedType) >= 0 && fullHealth > 0 && Number(data.damage) >= fullHealth) {
          observedOneShotTypes[killedType] = true;
          root.__partyObservedOneShotTypes = observedOneShotTypes;
        }
      }
      delete recentOwnHits[data.id];
    }
  };
  function deathCombatMessage() {
    var recent = lastIncomingDamage && Date.now() - lastIncomingDamage.at < 15000 ? lastIncomingDamage : null;
    return recent ? {
      message: "Killed by " + recent.name,
      details: { monster: recent.mtype, attacker: recent.id, map: character.map, x: character.x, y: character.y },
    } : {
      message: "Killed by unknown monster",
      details: { map: character.map, x: character.x, y: character.y },
    };
  }
  function observeFightPacket(event, data) {
    if (!data) return;
    fightPackets.push({event:event,at:Date.now(),data:data});
    if(fightPackets.length>12)fightPackets.shift();
    root.__partyFightPackets=fightPackets;
  }
  var combatDisappearListener = function(data) {
    observeFightPacket("disappear",data);
    if(data && (data.death===true || data.reason==="death" || data.reason==="dead")) {
      reportFightDeath(data.id);
      if(root.partyRoleRunner)root.partyRoleRunner.invalidateTarget(data.id);
    }
  };
  var combatEntitiesDeathListener = function(data) {
    if(!data || data.in!==character.in || !Array.isArray(data.monsters))return;
    root.__partyEntitiesObservedAt = Date.now() + coordinatorClockOffset;
    data.monsters.forEach(function(e){
      if(e && (e.dead===true || e.hp===0)) {reportFightDeath(e.id);if(root.partyRoleRunner)root.partyRoleRunner.invalidateTarget(e.id);}
    });
  };
  var combatDeathListener = function (data) {
    observeFightPacket("death",data);
    if(data && data.id && data.id!==character.name)reportFightDeath(data.id);
    if (data && data.id && data.id !== character.name && root.partyRoleRunner && root.partyRoleRunner.invalidateTarget)
      { reportFightDeath(data.id); root.partyRoleRunner.invalidateTarget(data.id); }
    if (!data) return;
    if (ownActor(data.id || data.name)) {
      var death = deathCombatMessage();
      lastDeathInfo = root.__partyLastDeathInfo = parent.__partyLastDeathInfo = captureHuntDeath(death);
      queueCombatEvent("death", death.message, death.details, "death:self");
      combatWasDead = true;
      if (eventsEnabled) {
        var liveDeathEvent = activeCombatEvent();
        root.__partyEventRejoinRequired = liveDeathEvent && liveDeathEvent.name ||
          joinedEvent || partyEventHint || null;
      }
      return;
    }
  };
  var combatKillCreditListener = function (data) {
    if (!data || !data.mtype) return;
    observeFightPacket("kill_credit",data);
    var now = Date.now();
    recentOwnKills = recentOwnKills.filter(function (kill) { return now - kill.at < 3000; });
    var ownKillIndex = recentOwnKills.findIndex(function (kill) { return kill.mtype === data.mtype; });
    var ownKill = ownKillIndex >= 0;
    if (ownKill) recentOwnKills.splice(ownKillIndex, 1);
    var credit = {
      at: now, mtype: data.mtype, own: ownKill,
      level: Number(character.level) || 1, xp: Number(character.xp) || 0,
      maxXp: Number(character.max_xp) || 0, resolved: false,
    };
    pendingKillCredits.push(credit);
    if (pendingKillCredits.length > 20) pendingKillCredits.splice(0, pendingKillCredits.length - 20);
    [120, 300, 700].forEach(function (delay) {
      setTimeout(function () {
        if (credit.resolved) return;
        var gained = 0, currentLevel = Number(character.level) || credit.level;
        if (currentLevel === credit.level) gained = Math.max(0, (Number(character.xp) || 0) - credit.xp);
        else if (currentLevel > credit.level) {
          gained = Math.max(0, credit.maxXp - credit.xp) + (Number(character.xp) || 0);
          for (var level = credit.level + 1; level < currentLevel; level += 1)
            gained += Number(G.levels && G.levels[String(level)]) || 0;
        }
        if (!gained) return;
        recordKillCredit(credit, gained);
      }, delay);
    });
  };
  function recordKillCredit(credit, xp) {
    if (!credit || credit.resolved) return;
    credit.resolved = true;
    var index = pendingKillCredits.indexOf(credit);
    if (index >= 0) pendingKillCredits.splice(index, 1);
    var monster = G.monsters && G.monsters[credit.mtype];
    var monsterName = monster && monster.name || credit.mtype;
    var message = (credit.own ? "Killed " : "Party killed ") + monsterName + ", got " + xp.toLocaleString() + " XP";
    queueCombatEvent("kill", message, { monster: credit.mtype, xp: xp, killingBlow: credit.own },
      "kill-credit:" + credit.mtype + ":" + credit.at);
  }
  var combatXpTextListener = function (data) {
    if (!data || !pendingKillCredits.length) return;
    var args = data.args || {}, color = String(args.color || args.c || "").toLowerCase();
    if (color !== "#753d8c" && color !== "#ad73e0") return;
    var match = String(data.message || "").match(/^\+([\d,]+)$/);
    if (!match) return;
    var creditIndex = pendingKillCredits.findIndex(function (credit) { return Date.now() - credit.at < 3000; });
    if (creditIndex < 0) return;
    var credit = pendingKillCredits[creditIndex];
    var xp = Number(match[1].replace(/,/g, "")) || 0;
    recordKillCredit(credit, xp);
  };
  var combatLootListener = function (data) {
    if (!data || data.opener !== character.name) return;
    var before = lastInventoryTotals;
    setTimeout(function () {
      var after = inventoryTotals();
      Object.keys(after).forEach(function (name) {
        var gained = after[name] - (before[name] || 0);
        if (gained > 0) queueCombatEvent("loot", "Looted " + gained + "x " + combatLabel(name), { item: name, quantity: gained });
      });
      lastInventoryTotals = after;
    }, 150);
  };
  var combatResponseListener = function (data) {
    if (!data || data.failed) return;
    var skill = data.place === "skill" ? (data.skill || data.name) : data.place;
    if (skill && skill !== "attack" && G.skills && G.skills[skill]) {
      queueCombatEvent("skill", "Used " + (G.skills[skill].name || skill), { skill: skill }, "skill:" + skill);
    }
    if (data.used === "hp" || data.used === "mp") {
      // Regeneration skills and actual potions both report `used: hp/mp`.
      // Only call it an item use when a potion stack really decreased.
      var beforeUse = lastInventoryTotals;
      setTimeout(function () {
        var afterUse = inventoryTotals(), consumed = null;
        Object.keys(beforeUse).some(function (name) {
          var definition = G.items && G.items[name];
          var isPotion = definition && (definition.type === "pot" || /^hpot|^mpot/.test(name));
          if (isPotion && (beforeUse[name] || 0) > (afterUse[name] || 0)) {
            consumed = name;
            return true;
          }
          return false;
        });
        if (consumed) queueCombatEvent("item", "Used " + combatLabel(consumed), { item: consumed });
        lastInventoryTotals = afterUse;
      }, 150);
    } else if (data.used) {
      queueCombatEvent("item", "Used " + combatLabel(data.used, data.used), { item: data.used });
    }
  };
  var anniversaryResponseListener = function (data) {
    if (!root.__partyAnniversaryKissOperation || !data) return;
    var response = typeof data === "string" ? data : data.response;
    if (!response) return;
    anniversaryKissResponses.push({
      at: Date.now(), response: response,
      place: typeof data === "object" ? data.place || null : null,
      failed: typeof data === "object" ? !!data.failed : false,
      reason: typeof data === "object" ? data.reason || null : null
    });
    if (anniversaryKissResponses.length > 20) anniversaryKissResponses.shift();
  };
  if (parent.socket && typeof parent.socket.on === "function") {
    parent.socket.on("action", mapActionListener);
    parent.socket.on("hit", mapHitListener);
    parent.socket.on("action", combatActionListener);
    parent.socket.on("hit", combatHitListener);
    parent.socket.on("death", combatDeathListener);
    parent.socket.on("disappear", combatDisappearListener);
    parent.socket.on("entities", combatEntitiesDeathListener);
    parent.socket.on("kill_credit", combatKillCreditListener);
    parent.socket.on("disappearing_text", combatXpTextListener);
    parent.socket.on("chest_opened", combatLootListener);
    parent.socket.on("game_response", combatResponseListener);
    [["action",mapActionListener],["hit",mapHitListener],["action",combatActionListener],["hit",combatHitListener],
      ["death",combatDeathListener],["disappear",combatDisappearListener],["entities",combatEntitiesDeathListener],
      ["kill_credit",combatKillCreditListener],["disappearing_text",combatXpTextListener],["chest_opened",combatLootListener],
      ["game_response",combatResponseListener]].forEach(function(entry){
        parent.__partyCombatSocketSubscriptions.push({owner:partyCombatSocketOwner,socket:parent.socket,event:entry[0],handler:entry[1]});
      });
  }

  function fingerprint(item) {
    if (!item) return null;
    var copy = {};
    ["name", "level", "q", "p", "stat_type", "data", "price", "rid", "b", "m", "l", "v"].forEach(function (key) {
      if (item[key] !== undefined) copy[key] = item[key];
    });
    return copy;
  }

  function sameItem(item, wanted) {
    return item && wanted && Object.keys(wanted).filter(function (key) { return key !== "q"; }).every(function (key) {
      return JSON.stringify(item[key]) === JSON.stringify(wanted[key]);
    });
  }

  function sameItemState(item, wanted) {
    if (!item || !wanted) return false;
    var actual = fingerprint(item), expected = fingerprint(wanted);
    if (actual) delete actual.q;
    if (expected) delete expected.q;
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  async function refreshPontyListings() {
    if (character.ctype !== "merchant" || pontyRefreshBusy || typeof get_secondhands !== "function") return;
    pontyRefreshBusy = true;
    try {
      var response = await get_secondhands(10000);
      var items = Array.isArray(response) ? response :
        response && Array.isArray(response.items) ? response.items :
        response && Array.isArray(response.secondhands) ? response.secondhands : [];
      pontyListings = items.filter(function (item) { return item && item.name && item.rid; }).map(function (item) {
        var quantity = Math.max(1, Number(item.q) || 1);
        var multiplier = G.items[item.name] && G.items[item.name].cash ? 3 : 2;
        var unitPrice = Math.max(1, Math.round(Number(calculate_item_value(item)) * multiplier));
        return { key: String(item.rid), rid: String(item.rid), item: Object.assign({}, item),
          serverRegion: parent.server_region, serverIdentifier: parent.server_identifier,
          quantity: quantity, unitPrice: unitPrice, price: unitPrice * quantity };
      });
      pontyUpdatedAt = Date.now();
      pontyError = null;
      root.__merchantPontyListings = pontyListings;
      root.__merchantPontyUpdatedAt = pontyUpdatedAt;
    } catch (error) {
      pontyError = String(error && (error.reason || error.message || error));
    } finally {
      pontyRefreshBusy = false;
    }
  }

  function findMarkedInventoryItem(mark) {
    if (!mark || !mark.item) return -1;
    if (Number.isInteger(mark.slot) && sameItemState(character.items[mark.slot], mark.item))
      return mark.slot;
    for (var slot = 0; slot < character.items.length; slot += 1)
      if (sameItemState(character.items[slot], mark.item)) return slot;
    return -1;
  }

  function findItem(wanted) {
    for (var i = 0; i < character.items.length; i += 1) {
      if (sameItem(character.items[i], wanted)) return i;
    }
    return -1;
  }

  function findInventoryItemByName(name) {
    for (var i = 0; i < character.items.length; i += 1) {
      if (character.items[i] && character.items[i].name === name) return i;
    }
    return -1;
  }

  function inventoryQuantity(name) {
    return character.items.reduce(function (total, item) {
      return total + (item && item.name === name ? (item.q || 1) : 0);
    }, 0);
  }

  // Reusable availability check for any item owned by the character running
  // this routine. `inBank` is authoritative while character.bank is mounted;
  // away from the bank it is zero rather than a stale estimate.
  function itemAvailability(name) {
    var onPlayer = inventoryQuantity(name);
    var inBank = Object.keys(character.bank || {}).reduce(function (total, pack) {
      if (!Array.isArray(character.bank[pack])) return total;
      return total + character.bank[pack].reduce(function (packTotal, item) {
        return packTotal + (item && item.name === name ? itemQuantity(item) : 0);
      }, 0);
    }, 0);
    return { onPlayer: onPlayer, inBank: inBank, total: onPlayer + inBank,
      existsOnPlayer: onPlayer, existsInBank: inBank };
  }

  async function retrieveFromBankUntil(name, requiredOnPlayer) {
    var availability = itemAvailability(name), guard = 0;
    while (availability.onPlayer < requiredOnPlayer && availability.inBank > 0 && guard++ < 100) {
      var found = findBankItem({ name: name });
      if (!found) break;
      await bank_retrieve(found.pack, found.slot);
      availability = itemAvailability(name);
    }
    return availability;
  }

  function safeItemDefinition(definition) {
    var safe = {};
    Object.keys(definition || {}).forEach(function (key) {
      var value = definition[key];
      if (["string", "number", "boolean"].indexOf(typeof value) >= 0 || Array.isArray(value)) safe[key] = value;
    });
    return safe;
  }

  function itemUsage(definition) {
    var classNames = { warrior: "Warrior", mage: "Mage", priest: "Priest", ranger: "Ranger",
      rogue: "Rogue", paladin: "Paladin", merchant: "Merchant" };
    var restricted = Array.isArray(definition && definition['class']) ? definition['class'] :
      typeof (definition && definition['class']) === "string" ? [definition['class']] : null;
    var classes = Object.keys(G.classes || {}).filter(function (ctype) {
      if (restricted) return restricted.indexOf(ctype) >= 0;
      if (!definition || !definition.wtype) return true;
      var classDefinition = G.classes[ctype] || {};
      return !!(classDefinition.mainhand && classDefinition.mainhand[definition.wtype]) ||
        !!(classDefinition.doublehand && classDefinition.doublehand[definition.wtype]) ||
        !!(classDefinition.offhand && classDefinition.offhand[definition.wtype]);
    }).map(function (ctype) {
      var classDefinition = G.classes[ctype] || {}, hands = null;
      if (definition && definition.wtype) {
        if (classDefinition.doublehand && classDefinition.doublehand[definition.wtype]) hands = 2;
        else if ((classDefinition.mainhand && classDefinition.mainhand[definition.wtype]) ||
            (classDefinition.offhand && classDefinition.offhand[definition.wtype])) hands = 1;
      }
      return { id: ctype, name: classNames[ctype] || ctype, hands: hands };
    });
    return { classes: classes, hands: classes.map(function (entry) { return entry.hands; })
      .filter(function (hands, index, all) { return hands && all.indexOf(hands) === index; }) };
  }

  function maximumItemLevel(definition) {
    return definition && definition.compound ? 7 : definition && definition.upgrade ? 13 : 0;
  }

  function lootTableOutcome(tableName, itemName, seen) {
    var cacheKey = tableName + ":" + itemName;
    if (lootOutcomeCache[cacheKey]) return lootOutcomeCache[cacheKey];
    seen = seen || {};
    if (seen[tableName] || !Array.isArray(G.drops && G.drops[tableName])) return null;
    var nextSeen = Object.assign({}, seen); nextSeen[tableName] = true;
    var table = G.drops[tableName], total = table.reduce(function (sum, drop) {
      return sum + (Array.isArray(drop) ? Number(drop[0]) || 0 : 0);
    }, 0);
    if (total <= 0) return null;
    var probability = 0, paths = null;
    table.forEach(function (drop) {
      if (!Array.isArray(drop)) return;
      var result = lootRewardOutcome(drop, itemName, nextSeen);
      if (!result || result.probability <= 0) return;
      probability += (Number(drop[0]) || 0) / total * result.probability;
      if (!paths || (result.paths || []).length < paths.length) paths = result.paths || [];
    });
    var outcome = probability > 0 ? { probability: Math.min(1, probability), paths: paths || [] } : null;
    lootOutcomeCache[cacheKey] = outcome;
    return outcome;
  }

  function lootRewardOutcome(drop, itemName, seen) {
    var reward = drop[1];
    if (reward === itemName) return { probability: 1, paths: [itemName] };
    if (reward === "open" && typeof drop[2] === "string") {
      var opened = lootTableOutcome(drop[2], itemName, seen);
      return opened && { probability: opened.probability, paths: ["open " + drop[2]].concat(opened.paths || []) };
    }
    var exchangeCount = G.items && G.items[reward] && Number(G.items[reward].e);
    if (exchangeCount > 0 && G.drops && Array.isArray(G.drops[reward])) {
      var exchanged = lootTableOutcome(reward, itemName, seen);
      // For multi-item exchanges this is the long-run rolls-per-drop rate. It
      // avoids claiming that one leather immediately opens a 40-leather table.
      return exchanged && { probability: exchanged.probability / exchangeCount,
        paths: [reward + (exchangeCount > 1 ? " ×" + exchangeCount : "")].concat(exchanged.paths || []) };
    }
    return null;
  }

  function resolvedDropOutcome(drop, itemName) {
    if (!Array.isArray(drop) || !Number.isFinite(Number(drop[0]))) return null;
    var reward = lootRewardOutcome(drop, itemName, {});
    if (!reward || reward.probability <= 0) return null;
    return { rate: Math.min(1, Number(drop[0]) * reward.probability), originRate: Number(drop[0]),
      quantity: drop[1] === itemName ? Number(drop[2]) || 1 : 1,
      path: reward.paths || [] };
  }

  function itemDropSources(itemName) {
    if (itemDropCache[itemName]) return itemDropCache[itemName];
    var drops = [];
    var trackedMonsterDrops = trackerDropData && (trackerDropData.drops || trackerDropData.monsters);
    var monsterDrops = trackedMonsterDrops && Object.keys(trackedMonsterDrops).length
      ? trackedMonsterDrops : G.drops && G.drops.monsters || {};
    var trackedMapDrops = trackerDropData && trackerDropData.maps;
    var mapDropsById = trackedMapDrops && Object.keys(trackedMapDrops).length
      ? trackedMapDrops : G.drops && G.drops.maps || {};
    Object.keys(monsterDrops).forEach(function (monsterId) {
      (monsterDrops[monsterId] || []).forEach(function (drop) {
        var outcome = resolvedDropOutcome(drop, itemName);
        if (!outcome) return;
        var monsterDefinition = G.monsters[monsterId] || {};
        var mapGold = G.base_gold && G.base_gold[monsterId] || {};
        var goldValues = Object.keys(mapGold).map(function (mapName) { return Number(mapGold[mapName]); })
          .filter(function (value) { return Number.isFinite(value) && value >= 0; });
        drops.push({ monsterId: monsterId, monsterName: monsterDefinition.name || monsterId,
          sprite: monsterSpriteDefinition(monsterDefinition.skin),
          rate: outcome.rate, originRate: outcome.originRate, quantity: outcome.quantity, acquisitionPath: outcome.path,
          threat: (Number(monsterDefinition.attack) || 0) * (Number(monsterDefinition.frequency) || 0),
          sourceType: "monster",
          goldPerKill: goldValues.length ? Math.min.apply(Math, goldValues) : null });
      });
    });
    Object.keys(mapDropsById).forEach(function (mapId) {
      if (mapId === "global" || mapId === "global_static" || !G.maps[mapId]) return;
      var mapDefinition = G.maps[mapId] || {};
      var mapDrops = (mapDropsById[mapId] || []).map(function (drop) {
        return { drop: drop, outcome: resolvedDropOutcome(drop, itemName) };
      }).filter(function (entry) { return !!entry.outcome; });
      if (!mapDrops.length) return;
      var monsterIds = {};
      (mapDefinition.monsters || []).forEach(function (pack) {
        if (pack && pack.type && G.monsters[pack.type]) monsterIds[pack.type] = true;
      });
      Object.keys(monsterIds).forEach(function (monsterId) {
        var monsterDefinition = G.monsters[monsterId] || {};
        // Training dummies, invulnerable fixtures, one-off event spawns, and
        // hidden definitions aren't repeatably farmable valuation sources.
        if (monsterDefinition.stationary || monsterDefinition.immune || monsterDefinition.unlist ||
            Number(monsterDefinition.respawn) < 0 || Number(monsterDefinition.xp) <= 0) return;
        var gold = Number(G.base_gold && G.base_gold[monsterId] && G.base_gold[monsterId][mapId]);
        mapDrops.forEach(function (entry) {
          var drop = entry.drop, outcome = entry.outcome;
          drops.push({ monsterId: monsterId, monsterName: monsterDefinition.name || monsterId,
            sprite: monsterSpriteDefinition(monsterDefinition.skin), mapId: mapId,
            mapName: mapDefinition.name || mapId, sourceType: "zone",
            // Server map-drop roll: random / (share * luck * hp/1000 * luckx) < rate.
            // Suggested value deliberately assumes neutral share/luck/luckx.
            rate: Math.min(1, outcome.rate * (Number(monsterDefinition.hp) || 0) / 1000),
            originRate: outcome.originRate,
            baseRate: Number(drop[0]), quantity: outcome.quantity, acquisitionPath: outcome.path,
            threat: (Number(monsterDefinition.attack) || 0) * (Number(monsterDefinition.frequency) || 0),
            goldPerKill: Number.isFinite(gold) ? gold : null });
        });
      });
    });
    // Tracktrix exposes two account-wide tables which are deliberately absent
    // from the static game data. `global` scales with monster HP; static global
    // drops use the raw rate. Produce one source per monster so the dashboard
    // can show the world-drop price for every repeatably farmable target.
    ["global_static", "global"].forEach(function (tableName) {
      var table = mapDropsById[tableName] || [];
      if (!table.length) return;
      var outcomes = table.map(function (drop) {
        return { drop: drop, outcome: resolvedDropOutcome(drop, itemName) };
      }).filter(function (entry) { return !!entry.outcome; });
      if (!outcomes.length) return;
      Object.keys(G.monsters || {}).forEach(function (monsterId) {
        if (!farmableValuationMonster(monsterId)) return;
        var monsterDefinition = G.monsters[monsterId] || {};
        var hpMultiplier = tableName === "global"
          ? (Number(monsterDefinition.hp) || 0) / 1000 * (monsterDefinition["1hp"] ? 1000 : 1)
          : (monsterDefinition["1hp"] ? 1000 : 1);
        outcomes.forEach(function (entry) {
          var outcome = entry.outcome;
          drops.push({ monsterId: monsterId, monsterName: monsterDefinition.name || monsterId,
            sprite: monsterSpriteDefinition(monsterDefinition.skin), sourceType: "world",
            rate: Math.min(1, outcome.rate * hpMultiplier), originRate: outcome.originRate,
            baseRate: Number(entry.drop[0]), quantity: outcome.quantity,
            acquisitionPath: [tableName === "global" ? "HP-scaled world drop" : "World drop"]
              .concat(outcome.path || []),
            threat: (Number(monsterDefinition.attack) || 0) * (Number(monsterDefinition.frequency) || 0),
            goldPerKill: null });
        });
      });
    });
    drops.sort(function (a, b) {
      return (Number(a.threat) || 0) - (Number(b.threat) || 0) ||
        (Number(a.rate) || 0) - (Number(b.rate) || 0);
    });
    itemDropCache[itemName] = drops;
    return drops;
  }

  function valuationMonsterMaps(monsterId) {
    return Object.keys(G.maps || {}).filter(function (mapId) {
      return (G.maps[mapId].monsters || []).some(function (spawn) {
        return spawn && spawn.type === monsterId && (Number(spawn.count) || 0) > 0;
      });
    });
  }

  function farmableValuationMonster(monsterId) {
    var definition = G.monsters && G.monsters[monsterId];
    if (!definition || definition.cute || definition.special || definition.stationary ||
        definition.immune || definition.unlist || Number(definition.respawn) <= 0 ||
        Number(definition.xp) <= 0) return false;
    return valuationMonsterMaps(monsterId).length > 0;
  }

  // Suggested values are catalog data, not hover-time calculations. Each row
  // represents the cheapest map-specific route for one repeatably farmable
  // monster; no monster is allowed to suppress the other available choices.
  function itemSuggestedPrices(itemName) {
    if (itemValuationCache[itemName]) return itemValuationCache[itemName];
    var definition = G.items && G.items[itemName] || {};
    var defaultPrice = Math.max(1, Number(definition.g) || 1);
    var byMonster = {};
    itemDropSources(itemName).forEach(function (source) {
      if (!farmableValuationMonster(source.monsterId) || Number(source.originRate) >= 1) return;
      (byMonster[source.monsterId] = byMonster[source.monsterId] || []).push(source);
    });
    var prices = Object.keys(byMonster).map(function (monsterId) {
      var sources = byMonster[monsterId], direct = sources.filter(function (source) {
        return source.sourceType === "monster" || source.sourceType === "world";
      });
      var zoneMaps = sources.filter(function (source) { return source.sourceType === "zone"; })
        .map(function (source) { return source.mapId; });
      var maps = valuationMonsterMaps(monsterId).filter(function (mapId) {
        return Number.isFinite(Number(G.base_gold && G.base_gold[monsterId] && G.base_gold[monsterId][mapId]));
      });
      zoneMaps.forEach(function (mapId) { if (maps.indexOf(mapId) < 0) maps.push(mapId); });
      var candidates = maps.map(function (mapId) {
        var applicable = direct.concat(sources.filter(function (source) {
          return source.sourceType === "zone" && source.mapId === mapId;
        }));
        if (!applicable.length) return null;
        var missChance = 1, expectedYield = 0, paths = [];
        applicable.forEach(function (source) {
          var baseRate = Math.max(0, Math.min(1, Number(source.rate) || 0));
          var rate = Math.min(1, baseRate * valuationLuckMultiplier);
          missChance *= 1 - rate;
          expectedYield += rate * Math.max(1, Number(source.quantity) || 1);
          var path = (source.acquisitionPath || []).join(" → ");
          if (path && paths.indexOf(path) < 0) paths.push(path);
        });
        var chance = 1 - missChance;
        var gold = Number(G.base_gold && G.base_gold[monsterId] && G.base_gold[monsterId][mapId]);
        if (!(chance > 0) || !Number.isFinite(gold)) return null;
        var kills = chance >= 1 ? 1 : Math.ceil(Math.log(0.1) / Math.log(1 - chance));
        var quantity = Math.max(1, expectedYield / chance);
        return { monsterId: monsterId, monsterName: (G.monsters[monsterId] || {}).name || monsterId,
          sprite: monsterSpriteDefinition((G.monsters[monsterId] || {}).skin), mapId: mapId,
          mapName: (G.maps[mapId] || {}).name || mapId, rate: chance, quantity: quantity,
          kills: kills, goldPerKill: gold,
          suggested: Math.max(defaultPrice, Math.ceil(kills * gold / quantity)), paths: paths,
          luckMultiplier: valuationLuckMultiplier,
          worldDrop: applicable.some(function (source) { return source.sourceType === "world"; }) };
      }).filter(Boolean).sort(function (a, b) {
        return a.suggested - b.suggested || a.kills - b.kills;
      });
      return candidates[0] || null;
    }).filter(Boolean).sort(function (a, b) {
      return a.suggested - b.suggested || a.monsterName.localeCompare(b.monsterName);
    });
    itemValuationCache[itemName] = prices;
    return prices;
  }

  function itemCraftUses(itemName) {
    return Object.keys(G.craft || {}).reduce(function (uses, craftedId) {
      var recipe = G.craft[craftedId] || {}, craftedDefinition = G.items[craftedId] || {};
      (recipe.items || []).forEach(function (material) {
        if (!Array.isArray(material) || material[1] !== itemName) return;
        uses.push({ id: craftedId, name: craftedDefinition.name || craftedId,
          quantity: Number(material[0]) || 0, level: Number(material[2]) || 0,
          cost: Number(recipe.cost) || 0, sprite: spriteDefinition(craftedDefinition.skin || craftedId) });
      });
      return uses;
    }, []).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function itemWorldInfo(itemName) {
    if (itemWorldCache[itemName]) return itemWorldCache[itemName];
    var definition = G.items[itemName] || {}, recipe = G.craft && G.craft[itemName];
    var setDefinition = definition.set && G.sets && G.sets[definition.set];
    var setInfo = null;
    if (setDefinition) {
      var setItems = {};
      (setDefinition.items || []).forEach(function (id) { setItems[id] = (setItems[id] || 0) + 1; });
      setInfo = {
        id: definition.set,
        name: setDefinition.name || definition.set,
        explanation: setDefinition.explanation || "",
        items: Object.keys(setItems).map(function (id) {
          var itemDefinition = G.items[id] || {};
          return { id: id, name: itemDefinition.name || id, quantity: setItems[id],
            sprite: spriteDefinition(itemDefinition.skin || id) };
        }),
        bonuses: Object.keys(setDefinition).filter(function (key) { return /^\d+$/.test(key); }).map(function (pieces) {
          return { pieces: Number(pieces), stats: safeFields(setDefinition[pieces] || {}) };
        }).filter(function (bonus) { return Object.keys(bonus.stats).length > 0; }),
      };
    }
    itemWorldCache[itemName] = {
      recipe: recipe ? {
        cost: Number(recipe.cost) || 0,
        quest: recipe.quest || null,
        materials: (recipe.items || []).map(function (material) {
          var materialDefinition = G.items[material[1]] || {};
          return { quantity: Number(material[0]) || 0, id: material[1], level: Number(material[2]) || 0,
            name: materialDefinition.name || material[1], sprite: spriteDefinition(materialDefinition.skin || material[1]),
            drops: itemDropSources(material[1]) };
        }),
      } : null,
      set: setInfo,
      drops: itemDropSources(itemName),
      suggestedPrices: itemSuggestedPrices(itemName),
      usedIn: itemCraftUses(itemName),
    };
    return itemWorldCache[itemName];
  }

  function itemDefinition(item) {
    if (!item || !G.items[item.name]) return null;
    var definition = G.items[item.name];
    var skin = item.skin || definition.skin;
    var position = G.positions[skin];
    var pack = position && G.imagesets[position[0] || "pack_20"];
    var safeDefinition = safeItemDefinition(definition);
    var calculatedProperties = {};
    try {
      var calculated = item_properties(item) || {};
      Object.keys(calculated).forEach(function (key) {
        var value = calculated[key];
        if ((typeof value === "number" && value !== 0) ||
            (typeof value === "boolean" && value) ||
            (typeof value === "string" && value)) {
          calculatedProperties[key] = value;
        }
      });
    } catch (_error) {
      // Base definitions still render if a legacy game build cannot calculate properties.
    }
    return {
      definition: safeDefinition,
      upgradeable: !!definition.upgrade,
      compoundable: !!definition.compound,
      buyable: !!itemSeller(item.name),
      properties: calculatedProperties,
      scaling: safeFields(definition.upgrade || definition.compound || {}),
      maxLevel: maximumItemLevel(definition),
      usage: itemUsage(definition),
      // Live inventory/bank reports must never construct the entire drop graph.
      // Until background preparation finishes, the dashboard uses its catalog.
      world: itemWorldCache[item.name],
      sprite: pack && position ? {
        url: "https://adventure.land" + pack.file,
        tileSize: pack.size,
        columns: pack.columns,
        rows: pack.rows,
        x: position[1],
        y: position[2],
      } : null,
    };
  }

  function spriteDefinition(skin) {
    var position = G.positions[skin];
    var pack = position && G.imagesets[position[0] || "pack_20"];
    if (pack && position) return {
      url: "https://adventure.land" + pack.file,
      tileSize: pack.size,
      columns: pack.columns,
      rows: pack.rows,
      x: position[1],
      y: position[2],
    };

    // Character bodies and cosmetic layers live in G.sprites matrices rather
    // than the item/icon-oriented G.positions index.
    return spriteSheetDefinition(skin);
  }

  function safeFields(value) {
    var output = {};
    Object.keys(value || {}).forEach(function (key) {
      var field = value[key];
      if (["string", "number", "boolean"].indexOf(typeof field) >= 0 || Array.isArray(field))
        output[key] = field;
    });
    return output;
  }

  function catalogValue(value, depth) {
    depth = depth || 0;
    if (depth > 6 || value === null || value === undefined) return value === null ? null : undefined;
    if (["string", "number", "boolean"].indexOf(typeof value) >= 0) return value;
    if (Array.isArray(value)) return value.map(function (entry) { return catalogValue(entry, depth + 1); })
      .filter(function (entry) { return entry !== undefined; });
    if (typeof value !== "object") return undefined;
    var output = {};
    Object.keys(value).forEach(function (key) {
      var safe = catalogValue(value[key], depth + 1);
      if (safe !== undefined) output[key] = safe;
    });
    return output;
  }

  function activeConditions() {
    return Object.keys(character.s || {}).map(function (id) {
      var live = character.s[id] || {};
      var definition = G.conditions[id] || G.skills[id] || {};
      var skin = live.skin || definition.skin;
      return {
        id: id,
        name: definition.name || id,
        explanation: definition.explanation || "",
        remainingMs: typeof live.ms === "number" ? live.ms : null,
        stacks: live.s !== undefined ? live.s : null,
        source: typeof live.f === "string" || typeof live.f === "number" ? live.f :
          (typeof live.source === "string" || typeof live.source === "number" ? live.source : null),
        definition: safeFields(definition),
        live: safeFields(live),
        sprite: skin ? spriteDefinition(skin) : null,
      };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function monsterHuntStatus() {
    var hunt = character.s && character.s.monsterhunt;
    if (!hunt) return null;
    return {
      id: typeof hunt.id === "string" ? hunt.id : null,
      count: Number(hunt.c) || 0,
      remainingMs: typeof hunt.ms === "number" ? hunt.ms : null,
      server: typeof hunt.sn === "string" ? hunt.sn : null,
    };
  }

  function monsterHunterLocation() {
    var location = typeof find_npc === "function" ? find_npc("monsterhunter") : null;
    return location ? { map: location.map, x: Number(location.x), y: Number(location.y) } : null;
  }

  function spriteSheetDefinition(skin) {
    var sheets = Object.keys(G.sprites || {});
    for (var s = 0; s < sheets.length; s += 1) {
      var sheet = G.sprites[sheets[s]];
      if (sheet.skip || !sheet.matrix) continue;
      for (var row = 0; row < sheet.matrix.length; row += 1) {
        var column = sheet.matrix[row].indexOf(skin);
        if (column < 0) continue;
        var frameRows = sheet.type === "animation" || sheet.type === "emblem" || sheet.type === "gravestone" ? 1 : 4;
        var frameColumns = sheet.type === "tail" ? 4 :
          (["v_animation", "head", "hair", "hat", "s_wings", "face", "makeup", "beard", "emblem", "gravestone"].indexOf(sheet.type) >= 0 ? 1 : 3);
        return {
          url: "https://adventure.land" + sheet.file,
          tileSize: 1,
          columns: sheet.columns * frameColumns,
          rows: sheet.rows * frameRows,
          x: column * frameColumns + (frameColumns === 3 ? 1 : 0),
          y: row * frameRows,
        };
      }
    }
    return null;
  }

  function monsterSpriteDefinition(skin) {
    return spriteSheetDefinition(skin);
  }

  function bankSnapshot() {
    if (!character.bank) return null;
    var packs = {};
    Object.keys(character.bank).forEach(function (pack) {
      if (!Array.isArray(character.bank[pack])) return;
      // Bank arrays are sparse and an empty pack can report length 0 or 1.
      // Every unlocked pack has 42 usable slots regardless of its JS length.
      packs[pack] = Array.from({ length: 42 }, function (_unused, slot) {
        var item = character.bank[pack][slot];
        return item ? { slot: slot, item: fingerprint(item), meta: itemDefinition(item) } : null;
      });
    });
    return { gold: character.bank.gold || 0, packs: packs };
  }

  async function waitForBankPack(pack, timeoutMs) {
    var deadline = Date.now() + (Number(timeoutMs) || 10000);
    while (Date.now() < deadline) {
      if (character.bank && Array.isArray(character.bank[pack])) return character.bank[pack];
      await sleep(100);
    }
    throw new Error("bank data did not load: " + pack);
  }

  function bankVaultCatalog() {
    var definitions = typeof bank_packs !== "undefined" ? bank_packs : (parent.bank_packs || {});
    var floorKeys = {};
    Object.keys(G.items || {}).forEach(function (name) {
      var item = G.items[name];
      if (item && item.type === "bank_key" && item.unlocks) floorKeys[item.unlocks] = {
        id: name, name: item.name || name,
        sprite: itemDefinition({ name: name }) && itemDefinition({ name: name }).sprite,
      };
    });
    return Object.keys(definitions).map(function (pack) {
      var definition = definitions[pack] || [];
      return { pack: pack, floor: definition[0], gold: Number(definition[1]) || 0,
        shells: Number(definition[2]) || 0, key: floorKeys[definition[0]] || null };
    }).sort(function (first, second) {
      return Number(first.pack.replace(/\D/g, "")) - Number(second.pack.replace(/\D/g, ""));
    });
  }

  function travelPlaces() {
    var currentWorld = parent.world || "";
    var currentEvent = parent.current_event || "";
    return Object.keys(G.maps).filter(function (id) {
      var map = G.maps[id];
      return !map.ignore && !map.unlist && !map.instance && !map.irregular &&
        (map.world || "") === currentWorld &&
        (!map.event || map.event === currentEvent);
    }).map(function (id) {
      var map = G.maps[id];
      var spawn = map.spawns && map.spawns[0] || [0, 0];
      return { id: id, name: map.name, x: spawn[0], y: spawn[1] };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function monsterChoices() {
    return Object.keys(G.monsters).map(function (id) {
      var locations = [], spawnRecords = [];
      Object.keys(G.maps).forEach(function (mapId) {
        var map = G.maps[mapId];
        if (!Array.isArray(map.monsters)) return;
        map.monsters.forEach(function (spawn) {
          if (!spawn || spawn.type !== id) return;
          var recorded = false;
          function add(mapId, box, position) {
            var target = G.maps[mapId];
            var restrictions = [];
            ["ignore", "instance", "irregular"].forEach(function (flag) {
              if (map[flag] || target && target[flag]) restrictions.push(flag);
            });
            if (spawn.count === 0) restrictions.push("zero-count");
            if (!target) restrictions.push("missing-map");
            var x = position ? position[0] : box ? (box[0] + box[2]) / 2 : NaN;
            var y = position ? position[1] : box ? (box[1] + box[3]) / 2 : NaN;
            var valid = Number.isFinite(x) && Number.isFinite(y) &&
              (!box || box.every(Number.isFinite));
            if (!valid) restrictions.push("invalid-geometry");
            var location = { map: mapId, mapName: target && target.name || mapId,
              x: valid ? Math.round(x) : undefined, y: valid ? Math.round(y) : undefined,
              boundary: box || undefined, polygon: spawn.polygon || undefined };
            spawnRecords.push(Object.assign({ sourceMap: sourceMapId, count: spawn.count,
              restrictions: restrictions }, location));
            recorded = true;
            if (!restrictions.length) locations.push(location);
          }
          var sourceMapId = mapId;
          if (Array.isArray(spawn.position)) add(mapId, null, spawn.position);
          if (Array.isArray(spawn.boundary) && spawn.boundary.length >= 4) add(mapId, spawn.boundary.slice(0, 4));
          (Array.isArray(spawn.boundaries) ? spawn.boundaries : []).forEach(function (box) {
            if (Array.isArray(box) && box.length >= 5) add(box[0], box.slice(1, 5));
          });
          if (!recorded) add(mapId, null, null);
        });
      });
      return { id: id, name: G.monsters[id].name || id, sprite: monsterSpriteDefinition(G.monsters[id].skin), locations: locations, spawnRecords: spawnRecords };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function bestiaryCatalog() {
    var spawns = {};
    monsterChoices().forEach(function (choice) { spawns[choice.id] = choice.spawnRecords; });
    return Object.keys(G.monsters || {}).map(function (id) {
      var definition = G.monsters[id] || {};
      var drops = (G.drops && G.drops.monsters && G.drops.monsters[id] || []).map(function (drop) {
        if (!Array.isArray(drop) || typeof drop[1] !== "string" || !G.items[drop[1]]) return null;
        var item = G.items[drop[1]] || {};
        return { rate: Number(drop[0]) || 0, id: drop[1], name: item.name || drop[1],
          quantity: Number(drop[2]) || 1, sprite: spriteDefinition(item.skin || drop[1]) };
      }).filter(Boolean);
      return { id: id, name: definition.name || id, sprite: monsterSpriteDefinition(definition.skin),
        hp: Number(definition.hp) || 0,
        attack: Number(definition.attack) || 0, xp: Number(definition.xp) || 0,
        range: Number(definition.range) || 0,
        threat: (Number(definition.attack) || 0) * (Number(definition.frequency) || 0),
        definition: catalogValue(definition), drops: drops, spawnRecords: spawns[id] };
    });
  }

  function monsterAchievementKills() {
    // caracAL executes game.js and the character runner in separate VM
    // contexts. The runner's lexical `tracker` remains the initial empty
    // object, while the socket event contains the authoritative account data.
    // trackerCatalogListener already captures that event for drop discovery,
    // so use the same live object here.
    var parentTracker = parent && parent.tracker && Object.keys(parent.tracker).length ? parent.tracker : null;
    var liveTracker = parentTracker || trackerDropData || {};
    var maximums = liveTracker.max && liveTracker.max.monsters || {};
    if (!liveTracker.monsters && !liveTracker.monsters_diff && !Object.keys(maximums).length) return null;
    var own = liveTracker.monsters || {};
    var pending = liveTracker.monsters_diff || {};
    var accountMax = maximums;
    return Object.keys(G.monsters || {}).reduce(function (out, id) {
      if (!Array.isArray(G.monsters[id].achievements) || !G.monsters[id].achievements.length) return out;
      var localCount = (Number(own[id]) || 0) + (Number(pending[id]) || 0);
      var maximumEntry = accountMax[id];
      var maximum = Array.isArray(maximumEntry) ? Number(maximumEntry[0]) || 0 :
        Number(maximumEntry && maximumEntry.count !== undefined ? maximumEntry.count : maximumEntry) || 0;
      out[id] = Math.max(localCount, maximum);
      return out;
    }, {});
  }

  function tracktrixBonuses() {
    var active = !!character.tracker || (character.items || []).some(function (item) {
      return item && ["tracker", "supercomputer"].indexOf(item.name) >= 0;
    });
    var stats = parent.character && parent.character.monster_stats;
    var bonuses = active && stats ? Object.assign({}, stats) : null;
    if (active && !bonuses) {
      var progress = monsterAchievementProgress();
      if (progress) {
        bonuses = {};
        Object.keys(progress).forEach(function (id) {
          (G.monsters[id].achievements || []).forEach(function (reward) {
            if (reward[1] === "stat" && progress[id].score >= Number(reward[0]))
              bonuses[reward[2]] = (bonuses[reward[2]] || 0) + (Number(reward[3]) || 0);
          });
        });
      }
    }
    return { active: active, bonuses: active ? bonuses : {},
      sprite: spriteDefinition((G.items.tracker || {}).skin || "tracker") };
  }

  function monsterAchievementProgress() {
    var parentTracker = parent && parent.tracker && Object.keys(parent.tracker).length ? parent.tracker : null;
    var liveTracker = parentTracker || trackerDropData || {};
    var maximums = liveTracker.max && liveTracker.max.monsters || {};
    if (!liveTracker.monsters && !liveTracker.monsters_diff && !Object.keys(maximums).length) return null;
    var own = liveTracker.monsters || {}, pending = liveTracker.monsters_diff || {};
    return Object.keys(G.monsters || {}).reduce(function (out, id) {
      if (!Array.isArray(G.monsters[id].achievements) || !G.monsters[id].achievements.length) return out;
      var localScore = (Number(own[id]) || 0) + (Number(pending[id]) || 0);
      var maximumEntry = maximums[id];
      var accountScore = Array.isArray(maximumEntry) ? Number(maximumEntry[0]) || 0 :
        Number(maximumEntry && maximumEntry.count !== undefined ? maximumEntry.count : maximumEntry) || 0;
      var accountOwner = Array.isArray(maximumEntry) && typeof maximumEntry[1] === "string" ? maximumEntry[1] : null;
      out[id] = localScore > accountScore ? { score: localScore, owner: character.name } :
        { score: accountScore, owner: accountOwner || (localScore === accountScore && localScore ? character.name : null) };
      return out;
    }, {});
  }

  // Equipment/stat speed before stand, cruise, terrain and other movement restrictions.
  // Mirrors calculate_player_stats in the game's published server implementation.
  function unrestrictedRunSpeed() {
    var definition = G.classes[character.ctype];
    if (!definition) return null;
    var speed = Number(definition.speed) || 0, sets = {};
    Object.keys(character.slots || {}).forEach(function(slot) {
      var item = character.slots[slot], def = item && G.items[item.name];
      if (!def || /^trade/.test(slot)) return;
      var props = typeof calculate_item_properties === "function"
        ? calculate_item_properties(item, {class:character.ctype,map:character.map}) : item_properties(item);
      if (props.class && props.class.indexOf(character.ctype)<0) return;
      speed += Number(props.speed) || 0;
      if (props.set) sets[def.set] = (sets[def.set] || 0)+1;
      if (slot === "mainhand") speed += Number(((definition.doublehand || {})[def.wtype] || (definition.mainhand || {})[def.wtype] || {}).speed) || 0;
      if (slot === "offhand") speed += Number(((definition.offhand || {})[def.wtype] || (definition.offhand || {})[def.type] || {}).speed) || 0;
    });
    Object.keys(sets).forEach(function(id){speed += Number((G.sets[id] && G.sets[id][sets[id]] || {}).speed) || 0;});
    Object.keys(character.s || {}).forEach(function(id){
      speed += (Number(character.s[id].speed) || 0) + (Number((G.conditions[id] || {}).speed) || 0);
    });
    var achievementStats = parent.character && parent.character.monster_stats;
    if (achievementStats) speed += Number(achievementStats.speed) || 0;
    else if (character.tracker || (character.items || []).some(function(item){return item && ["tracker","supercomputer"].indexOf(item.name)>=0;})) {
      var achievements=monsterAchievementProgress() || {};
      Object.keys(achievements).forEach(function(id){
        (G.monsters[id].achievements || []).forEach(function(a){if(a[1]==="stat" && a[2]==="speed" && achievements[id].score>=a[0])speed+=Number(a[3]) || 0;});
      });
    }
    var level=Number(character.level)||0;
    return Math.max(5,speed+Math.min(Number(character.dex)||0,256)/32+Math.min(Number(character.str)||0,256)/64+
      Math.min(level,40)/10+Math.max(0,Math.min(level-40,20))/15+Math.max(0,Math.min(86,level)-60)/16);
  }

  function skillCatalog() {
    var assigned = {};
    var classes = Object.keys(G.classes || {}).map(function (classId) {
      var classDefinition = G.classes[classId] || {};
      var skills = Object.keys(G.skills || {}).filter(function (skillId) {
        var classField = G.skills[skillId] && G.skills[skillId].class;
        var belongs = Array.isArray(classField) ? classField.indexOf(classId) >= 0 : classField === classId;
        if (belongs) assigned[skillId] = true;
        return belongs;
      }).map(function (skillId) {
        var definition = G.skills[skillId] || {};
        return { id: skillId, name: definition.name || skillId,
          sprite: spriteDefinition(definition.skin || skillId), definition: catalogValue(definition) };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return { id: classId, name: classDefinition.name || classId, skills: skills };
    });
    var shared = Object.keys(G.skills || {}).filter(function (skillId) { return !assigned[skillId]; })
      .map(function (skillId) {
        var definition = G.skills[skillId] || {};
        return { id: skillId, name: definition.name || skillId,
          sprite: spriteDefinition(definition.skin || skillId), definition: catalogValue(definition) };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    classes.push({ id: "shared", name: "Shared / system", skills: shared });
    return classes;
  }

  function startingAppearanceHtml(skin, cosmetics) {
    var renderSprite = typeof sprite === "function" ? sprite : parent && typeof parent.sprite === "function" ? parent.sprite : null;
    if (!renderSprite) return null;
    try {
      // The official renderer supplies each layer's native size, head/hair offsets,
      // body-dependent skin layer, and draw order. Independent crops lose these.
      return dashboardDollHtml(String(renderSprite.call(parent, skin, {
        cx: JSON.parse(JSON.stringify(cosmetics)), width: 54, height: 76, scale: 2,
      }) || "").replace(/<img style=(['"])/g, "<img style=$1max-width: none; image-rendering: pixelated; "));
    } catch (_error) { return null; }
  }

  function classAppearanceChoices() {
    return Object.keys(G.classes || {}).reduce(function (out, ctype) {
      out[ctype] = (G.classes[ctype].looks || []).map(function (look, index) {
        var cosmetics = look[1] || {};
        var skins = [look[0]].concat(Object.keys(cosmetics).map(function (key) { return cosmetics[key]; }));
        return { index: index, html: startingAppearanceHtml(look[0], cosmetics), layers: skins.map(spriteDefinition).filter(Boolean) };
      });
      return out;
    }, {});
  }

  // Catalog discovery must not starve the game socket before the first status.
  // Warm the expensive per-item caches cooperatively after a successful report.
  async function prepareCatalog() {
    if (catalogPreparing || catalogPrepared) return;
    catalogPreparing = true;
    var generation = catalogGeneration;
    try {
      var items = Object.keys(G.items || {});
      for (var index = 0; index < items.length; index++) {
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        if (!runtimeCurrent() || generation !== catalogGeneration) return;
        itemWorldInfo(items[index]);
      }
      catalogPrepared = true;
    } catch (error) {
      game_log("Catalog preparation failed: " + String(error && error.message || error), "red");
    } finally {
      catalogPreparing = false;
    }
  }

  function merchantCatalog() {
    var upgradeChanceTable = {
      0: [1, 0.9999999, 0.98, 0.95, 0.7, 0.6, 0.4, 0.25, 0.15, 0.07, 0.024, 0.14, 0.11],
      1: [1, 0.99998, 0.97, 0.94, 0.68, 0.58, 0.38, 0.24, 0.14, 0.066, 0.018, 0.13, 0.10],
      2: [1, 0.97, 0.94, 0.92, 0.64, 0.52, 0.32, 0.232, 0.13, 0.062, 0.015, 0.12, 0.09],
    };
    var allItems = Object.keys(G.items || {}).map(function (id) {
      var definition = G.items[id] || {};
      return { id: id, name: definition.name || id,
        upgradeable: !!definition.upgrade, compoundable: !!definition.compound,
        sprite: spriteDefinition(definition.skin || id),
        meta: { definition: safeItemDefinition(definition), world: itemWorldInfo(id),
          upgradeable: !!definition.upgrade, compoundable: !!definition.compound,
          buyable: !!itemSeller(id), scaling: safeFields(definition.upgrade || definition.compound || {}),
          maxLevel: maximumItemLevel(definition), usage: itemUsage(definition),
          sprite: spriteDefinition(definition.skin || id) } };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var buyable = Object.keys(G.items || {}).map(function (id) {
      var definition = G.items[id], seller = itemSeller(id);
      if (!seller || !Number.isFinite(definition.g) || definition.g < 0 || definition.cash) return null;
      return { id: id, name: definition.name || id, cost: definition.g, seller: seller,
        upgradeable: !!definition.upgrade, compoundable: !!definition.compound,
        upgradeGrade: Number(definition.igrade) || 0, grades: definition.grades || [9, 10, 11, 12],
        upgradeChances: upgradeChanceTable[Number(definition.igrade) || 0] || upgradeChanceTable[0],
        scrollCosts: [0, 1, 2, 3].map(function (grade) { return (G.items["scroll" + grade] || {}).g || 0; }),
        sprite: spriteDefinition(definition.skin || id) };
    }).filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var craftable = Object.keys(G.craft || {}).map(function (id) {
      var recipe = G.craft[id], definition = G.items[id] || {};
      return { id: id, name: definition.name || id, cost: Number(recipe.cost) || 0,
        sprite: spriteDefinition(definition.skin || id),
        materials: (recipe.items || []).map(function (material) {
          var materialDefinition = G.items[material[1]] || {};
          return { quantity: material[0], id: material[1], level: material[2] || 0,
            name: materialDefinition.name || material[1],
            sprite: spriteDefinition(materialDefinition.skin || material[1]) };
        }) };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var exchangeable = Object.keys(G.items || {}).reduce(function (entries, id) {
      var definition = G.items[id] || {};
      if (!definition.e || definition.ignore) return entries;
      var npc = "exchange";
      if (definition.quest) Object.keys(G.npcs || {}).some(function (npcId) {
        if (G.npcs[npcId] && G.npcs[npcId].quest === definition.quest) { npc = npcId; return true; }
        return false;
      });
      var levels = definition.upgrade || definition.compound ?
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] : [0];
      levels.forEach(function (level) {
        var table = G.drops && G.drops[id + (level ? String(level) : "")];
        if (!Array.isArray(table) || !table.length) return;
        entries.push({ key: id + "@" + level, id: id, level: level,
          name: (definition.name || id) + (level ? " +" + level : ""), cost: 0,
          required: Math.max(1, Number(definition.e) || 1), npc: npc,
          sprite: spriteDefinition(definition.skin || id), results: root.partyExchangeRewards(G, id + (level ? String(level) : "")).map(function (result) {
            var resultDefinition = G.items[result.id] || {};
            return Object.assign({}, result, {sprite: G.items[result.id] ? spriteDefinition(resultDefinition.skin || result.id) : null});
          }) });
      });
      return entries;
    }, []).sort(function (a, b) { return a.name.localeCompare(b.name); });
    Object.keys(G.tokens || {}).forEach(function (currency) {
      var token = G.items[currency];
      if (!token || token.ignore) return;
      Object.keys(G.tokens[currency]).forEach(function (reward) {
        var price = Number(G.tokens[currency][reward]), item = G.items[reward.split("-")[0]];
        if (!item || !(price > 0)) return;
          exchangeable.push({ key: currency + "@0:" + reward, id: currency, level: 0,
            reward: reward, name: item.name || reward, cost: 0,
            required: Math.max(1, price), rewardQuantity: price < 1 ? Math.floor(1 / price) : 1,
            currencyName: token.name || currency, currencySprite: spriteDefinition(token.skin || currency),
            npc: token.npc || currency + "s", sprite: spriteDefinition(item.skin || reward.split("-")[0]), results: [] });
      });
    });
    return { version: merchantCatalogVersion, valuationLuckMultiplier: valuationLuckMultiplier,
      allItems: allItems, buyable: buyable, craftable: craftable, exchangeable: exchangeable };
  }

  function nearbyStandListings() {
    if (character.ctype !== "merchant" || character.map !== merchantMarketLocation.map) return [];
    var listings = [];
    Object.keys(parent.entities || {}).forEach(function (id) {
      var seller = parent.entities[id];
      if (!seller || seller.type !== "character" || seller.name === character.name || !seller.stand) return;
      Object.keys(seller.slots || {}).forEach(function (slot) {
        var item = seller.slots[slot];
        if (slot.indexOf("trade") !== 0 || !item || item.b || item.giveaway ||
            !Number.isFinite(Number(item.price)) || Number(item.price) < 1) return;
        listings.push({ seller: seller.name, slot: slot, rid: item.rid, item: fingerprint(item),
          meta: itemDefinition(item), price: Number(item.price), quantity: Number(item.q) || 1,
          map: seller.map, x: Math.round(seller.x), y: Math.round(seller.y) });
      });
    });
    return listings.sort(function (a, b) { return a.price - b.price || a.seller.localeCompare(b.seller); });
  }

  function nearbyGiveaways() {
    if (character.ctype !== "merchant") return [];
    var giveaways = [];
    Object.keys(parent.entities || {}).forEach(function (id) {
      var seller = parent.entities[id];
      if (!seller || seller.type !== "character" || seller.name === character.name || !seller.slots) return;
      Object.keys(seller.slots).forEach(function (slot) {
        var item = seller.slots[slot];
        if (slot.indexOf("trade") !== 0 || !item || !item.giveaway || !item.rid) return;
        giveaways.push({ seller: seller.name, slot: slot, rid: item.rid, item: fingerprint(item),
          minutes: Number(item.giveaway) || 0, entrants: Array.isArray(item.list) ? item.list.slice() : [],
          map: seller.map || character.map, x: Math.round(seller.x), y: Math.round(seller.y) });
      });
    });
    return giveaways;
  }

  var dashboardImageUrls = {};
  function dashboardDollHtml(html) {
    html = String(html || "");
    // Steam's sprite() uses desktop.imageUrl(), whose blobs belong to the
    // game window. Resolve them there before sending HTML to the dashboard.
    var blobs = html.match(/blob:[^'"\s]+/g) || [];
    if (blobs.some(function (url) { return !dashboardImageUrls[url]; }) &&
        parent.desktop && typeof parent.desktop.imageUrl === "function") {
      Object.keys(G.sprites || {}).forEach(function (key) {
        var file = G.sprites[key].file;
        if (!file || !/^(\/|https?:\/\/)/.test(file)) return;
        var url = parent.desktop.imageUrl(file);
        dashboardImageUrls[url] = file;
      });
    }
    var unresolved = false;
    html = html.replace(/src=(['"])(.*?)\1/g, function (_match, quote, url) {
      url = dashboardImageUrls[url] || url;
      if (/^(blob:|file:)/i.test(url)) unresolved = true;
      if (url.indexOf("//") === 0) url = "https:" + url;
      else if (url.charAt(0) === "/") url = "https://adventure.land" + url;
      return "src=" + quote + url + quote;
    });
    // Let the dashboard use its ordinary sprite fallback if a layer cannot
    // be exported, instead of sending an inaccessible image to the browser.
    return unresolved ? null : html;
  }

  function characterDollHtml() {
    var renderSprite = typeof sprite === "function" ? sprite : parent && typeof parent.sprite === "function" ? parent.sprite : null;
    if (!renderSprite) return null;
    try {
      var html = renderSprite.call(parent, character.skin, {
        cx: JSON.parse(JSON.stringify(character.cx || {})),
        width: 54,
        height: 76,
        // An integer scale prevents adjacent sprite rows bleeding into the crop.
        // At 2x the standard 27x36 doll fills this card's 54x76 viewport.
        scale: 2,
      });
      // Game sprite sheets use root-relative URLs. The dashboard is served by
      // localhost, so make those image sources point back to Adventure Land.
      return dashboardDollHtml(String(html || "")
        .replace(/<img style=(['"])/g, "<img style=$1max-width: none; image-rendering: pixelated; "));
    } catch (_error) {
      return null;
    }
  }

  function mapDollHtml(entity, direction) {
    if (!entity || entity.type !== "character") return null;
    var renderSprite = typeof sprite === "function" ? sprite : parent && typeof parent.sprite === "function" ? parent.sprite : null;
    if (!renderSprite) return null;
    try {
      return dashboardDollHtml(renderSprite.call(parent, entity.skin, {
        cx: JSON.parse(JSON.stringify(entity.cx || {})), width: 27, height: 38,
        scale: 1, j: Number(direction) || 0,
      }));
    } catch (_error) { return null; }
  }

  function consoleMaintenanceBusy() {
    return !!(root.__partyUpgradePreviewInFlight || banking || stocking || upgrading || gatheringActive || anniversaryBusy ||
      root.__merchantActiveJob || merchantIdleActive || root.__merchantInventoryTidy ||
      luckyUpgradeService && luckyUpgradeService.pending() ||
      character.q && Object.keys(character.q).length || currentTravelAttackers().length);
  }
  async function handleUpgradePreview(previewRequest) {
    if (previewRequest.id === lastUpgradePreview || previewRequest.session !== upgradePreviewSession ||
        previewRequest.executor !== character.name || upgradePreviewActive) return;
    lastUpgradePreview = previewRequest.id;
    var reason = consoleMaintenanceBusy() || character.rip || character.moving ||
      root.localStorage.getItem(productionJournalKey()) ||
      root.localStorage.getItem("party-lucky-upgrade:" + character.name) ||
      parent.deferreds && parent.deferreds.upgrade && parent.deferreds.upgrade.length
      ? "Merchant busy" : null;
    var result;
    if (reason) {
      result = {executor:character.name,item:previewRequest.item,options:{}};
      ["none","offeringp","offering","offeringx"].forEach(function (option) { result.options[option]={reason:reason}; });
    } else {
      upgradePreviewActive = true;
      upgrading = true;
      // Retain the guard until the official deferred settles, including after an
      // HTTP timeout: a late upgrade_chance must never resolve an actual upgrade.
      var work = root.previewPartyUpgrade(previewRequest, {
        items:function () { return character.items; }, grade:item_grade,
        current:function () { return runtimeCurrent() && previewRequest.session === upgradePreviewSession; },
        now:function () { return Date.now() + coordinatorClockOffset; }, preview:upgrade,
      }).finally(function () {
        upgradePreviewActive=false; upgrading=false;
        if (root.__partyUpgradePreviewInFlight === work) root.__partyUpgradePreviewInFlight=null;
      });
      root.__partyUpgradePreviewInFlight=work;
      var timeout;
      try {
        result = await Promise.race([work, new Promise(function (resolve) {
          timeout=setTimeout(function () { resolve(null); }, 9000);
        })]);
      } finally { clearTimeout(timeout); }
    }
    if (result && runtimeCurrent()) await request("/upgrade-preview/result", {method:"POST",body:{
      character:character.name,id:previewRequest.id,session:upgradePreviewSession,result:result,
    }}).catch(function () {});
  }
  function consoleMaintenanceReport() {
    var pause = root.__partyConsoleMaintenance;
    return pause ? { id: pause.id, ready: !consoleMaintenanceBusy() && !character.moving &&
      !(typeof smart !== 'undefined' && smart.moving) } : null;
  }
  function snapshot() {
    calculateFarmingMode();
    if (character.rip && !combatWasDead) {
      var death = deathCombatMessage();
      lastDeathInfo = root.__partyLastDeathInfo = parent.__partyLastDeathInfo = captureHuntDeath(death);
      queueCombatEvent("death", death.message, death.details, "death:self");
      if (eventsEnabled) {
        var liveSnapshotEvent = activeCombatEvent();
        root.__partyEventRejoinRequired = liveSnapshotEvent && liveSnapshotEvent.name ||
          joinedEvent || partyEventHint || null;
      }
    }
    combatWasDead = !!character.rip;
    if (!combatEventBusy && combatEventQueue.length) flushCombatEvents();
    lastInventoryTotals = inventoryTotals();
    syncGatheringCooldown("fishing");
    syncGatheringCooldown("mining");
    var combatTarget = combatTargetId && get_entity(combatTargetId);
    var threats = Object.keys(parent.entities || {}).map(function (id) {
      return parent.entities[id];
    }).filter(function (entity) {
      return entity && entity.type === "monster" && !entity.dead && entity.target === character.name && isAllowedTarget(entity);
    }).map(function (entity) {
      return { id: entity.id, mtype: entity.mtype };
    });
    // Use the same deterministic event selection for telemetry and travel. In
    // particular, do not let the non-joinable anniversary entry hide a live
    // combat event when both are running at once.
    var selectedLiveEvent = activeCombatEvent();
    var serverLiveEvents = rawServerLiveEvents();
    var liveEventName = selectedLiveEvent && selectedLiveEvent.name || null;
    var status = {
      rareObservation: rareObservationReport(), rareSightings: rareSightings(), rareFields: rareFields(), rareKills: rareKills,
      rareLoot: root.partyLootClient ? root.partyLootClient.rare.report() : rareLoot,
      huntLoot: root.partyLootClient && root.partyLootClient.hunt.report(),
      convoyLoot: root.partyLootClient && root.partyLootClient.convoy.report(),
      lootStatus: root.partyLootStatus || null,
      rareNavigation: rareNavigation, rareDeployment: rareDeployment,
      name: character.name,
      owner: character.owner,
      runtime: parent.caracAL ? "headless" : "native",
      clientVersion: parent.__partyClientVersion || Number(G.version),
      clientInstance: parent.__partyClientInstance || null,
      upgradePreviewSession: upgradePreviewSession,
      luckySlotTracking: luckySlotTracking().report(),
      merchantEventReserved: merchantEventWorkReserved(),
      upgradeInventoryBusy: !!(root.__merchantInventoryTidy || luckyUpgradeService && luckyUpgradeService.pending() ||
        root.localStorage.getItem("party-lucky-upgrade:" + character.name)),
      steamPrimary: !parent.caracAL && !parent.no_html && !parent.is_bot,
      escape: escapeLocal,
      platform: parent.caracAL ? "caracal" : (parent.game && parent.game.platform || "browser"),
      codeGeneration: runtimeGeneration,
      dashboardRuntime: convoyRuntimeId,
      loaderGeneration: Number(root.__partyLoaderGeneration) || 0,
      codeRevision: "realm-logistics-v3",
      consoleMaintenance: consoleMaintenanceReport(),
      bankSortProtocol: 1,
      steamRealmProtocol: parent.__partySteamBridge && parent.__partySteamBridge.realmProtocol || 0,
      combatSelection: { id: combatSelection.id, revision: combatSelection.revision,
        map: combatSelection.map, runtimeId: convoyRuntimeId, target: groupedNomination() },
      queueTiming: root.__partyQueueTiming || null,
      groupedCombat: { approach:groupedApproachReport(),pursuitAck:groupedCombat && groupedCombat.pursuit && groupedCombat.pursuit.revoking || null, lootPending:!!(root.partyLootClient && root.partyLootClient.huntPending()), reportedAt: Date.now()+coordinatorClockOffset, protocol: 4, observationAt:root.__partyEntitiesObservedAt||0,passingEncounters:passingEncounterReport(),passingAcknowledgement:root.partyQueueClient && root.partyQueueClient.passingAcknowledgement && root.partyQueueClient.passingAcknowledgement(),returnDefense:returnDepartureDefense(),currentAttackers:currentTravelAttackers(),currentAttackersAt:travelObservationAt(),travelCommand:localTravelCommand(), epoch: root.__partyCombatResetAt||0, claims: queueClaims(), candidates: queueCandidates(), retentions:queueRetentions(), evidence: root.partyQueueClient ? root.partyQueueClient.reportEvidence(fightDeaths) : [], queueAck: groupedCombat && groupedCombat.queueRevision, deaths: fightDeaths, packets: fightPackets, threats: groupedThreatReports(), sightings: groupedSightings(), ack: groupedAcknowledgement(), anchorVisible: groupedAnchorVisible(), state: groupedCombat },
      convoyProtocol: 4,
      movementGeometry: movement.identity,
      huntReturnProtocol: 2,
      movement: movement.report() || movement.last(),
      convoyNavigation: convoyTraveling ? { id: convoyTraveling.id, epoch: convoyTraveling.epoch,
        navigationRevision: convoyTraveling.navigationRevision,
        returnPlan: convoyTraveling.returnPlan || null,
        commandId: convoyTraveling.commandId, phase: convoyTraveling.phase,
        defenseTargets: convoyTraveling.defenseTargets || [],
        defenseInterruption: convoyTraveling.defenseInterruption || null,
        townAttempt: convoyTraveling.townAttempt || null,
        transitionMap: convoyTraveling.transitionMap || null,
        runtimeId: convoyRuntimeId, routeReady: !!convoyTraveling.routeReady,
        routeVersion: convoyTraveling.routeVersion || 0, routeSource: convoyTraveling.routeSource || null,
        destinationSearches: convoyTraveling.destinationSearches || 0, rendezvousSearches: convoyTraveling.rendezvousSearches || 0,
        routeImports: convoyTraveling.routeImports || 0, reusedRoutes: convoyTraveling.reusedRoutes || 0,
        preparationMs: convoyTraveling.preparationMs || null, waypointCount: convoyTraveling.waypointCount || 0,
        failure: convoyTraveling.failure || null, replanStarts: convoyTraveling.replanStarts || 0,
        routeStarts: convoyTraveling.routeStarts, departedAt: convoyTraveling.departedAt || null } : null,
      activeCombatTarget: activeCombatTarget(),
      combatTrace: root.__partyCombatTrace || [],
      recovery: root.partyCombatState && root.partyCombatState.recovery || null,
      eventWalkFailure: root.__partyEventWalkFailure || null,
      lastCommandId: lastCommand,
      merchantCommand: root.__merchantCommandReport || null,
      server: (parent.server_region && parent.server_identifier) ? parent.server_region + parent.server_identifier : null,
      ping: typeof character.ping === "number" && isFinite(character.ping) && character.ping >= 0 ? character.ping : null,
      home: character.home || null,
      realmPlayers: realmPlayers,
      ctype: character.ctype,
      inventorySize: Number(character.isize) || character.items.length,
      primaryStat: G.classes[character.ctype] && G.classes[character.ctype].main_stat || null,
      level: character.level,
      attack: Number(character.attack) || 0,
      frequency: Number(character.frequency) || 0,
      range: Number(character.range) || 0,
      speed: character.speed,
      unrestrictedSpeed: character.ctype === "merchant" ? unrestrictedRunSpeed() : null,
      armor: Number(character.armor) || 0,
      resistance: Number(character.resistance) || 0,
      str: Number(character.str) || 0,
      int: Number(character.int) || 0,
      dex: Number(character.dex) || 0,
      vit: Number(character.vit) || 0,
      fortitude: Number(character.for) || 0,
      luck: Math.round((Number(character.luckm) || 1) * 100),
      goldBonus: ((Number(character.goldm) || 1) - 1) * 100,
      xpBonus: ((Number(character.xpm) || 1) - 1) * 100,
      combatStats: {
        heal: Number(character.heal) || 0, output: Number(character.output) || 0,
        mpCost: Number(character.mp_cost) || 0, crit: Number(character.crit) || 0,
        critDamage: Number(character.critdamage) || 0, evasion: Number(character.evasion) || 0,
        miss: Number(character.miss) || 0, lifesteal: Number(character.lifesteal) || 0,
        manasteal: Number(character.manasteal) || 0, damageReturn: Number(character.dreturn) || 0,
        reflection: Number(character.reflection) || 0, armorPiercing: Number(character.apiercing) || 0,
        resistancePiercing: Number(character.rpiercing) || 0,
        poisonResistance: Number(character.pnresistance) || 0,
        fireResistance: Number(character.firesistance) || 0,
        freezeResistance: Number(character.fzresistance) || 0,
        physicalResistance: Number(character.phresistance) || 0,
        statusResistance: Number(character.stresistance) || 0,
        blastResistance: Number(character.bmresistance) || 0,
      },
      xp: character.xp || 0,
      max_xp: character.max_xp || 0,
      hp: character.hp,
      max_hp: character.max_hp,
      mp: character.mp,
      max_mp: character.max_mp,
      gold: character.gold,
      gameParty: currentPartyList(),
      standOpen: !!character.stand,
      nearbyStandListings: nearbyStandListings(),
      nearbyGiveaways: nearbyGiveaways(),
      ponty: character.ctype === "merchant" ? { listings: pontyListings,
        updatedAt: pontyUpdatedAt, error: pontyError } : null,
      monsterAchievementKills: monsterAchievementKills(),
      monsterAchievements: monsterAchievementProgress(),
      tracktrix: tracktrixBonuses(),
      donationXpPerGold: donationXpPerGold,
      inventoryStackRetryAt: Number(root.__merchantStackRetryAt) || 0,
      inventoryStackError: root.__merchantStackError || null,
      gatheringActive: gatheringActive,
      gatheringBlockedReason: root.__merchantGatheringBlockedReason || null,
      gatheringPhase: root.__merchantGatheringAttempt && root.__merchantGatheringAttempt.phase || "idle",
      gatheringAttemptId: root.__merchantGatheringAttempt && root.__merchantGatheringAttempt.id || null,
      gatheringCooldowns: {
        fishing: Number(gatheringCooldowns.fishing) || 0,
        mining: Number(gatheringCooldowns.mining) || 0,
      },
      gatheringAccess: { fishing: hasGatheringAccess("fishing"), mining: hasGatheringAccess("mining") },
      map: character.map,
      in: character.in,
      mainTownSpawn: G.maps.main && G.maps.main.spawns[0] ? {x:G.maps.main.spawns[0][0],y:G.maps.main.spawns[0][1]} : null,
      mapEvent: G.maps && G.maps[character.map] && G.maps[character.map].event || null,
      activeEvent: liveEventName,
      serverLiveEvents: serverLiveEvents,
      goobrawlCombat: hasGoobrawlCombat(),
      activeEventId: liveEventName && eventStatus() && eventStatus()[liveEventName] &&
        (eventStatus()[liveEventName].id || eventStatus()[liveEventName].event_id) || null,
      eventTeam: eventTeam(character),
      anniversaryVisit: character.s && character.s.anniversary_visit ? {
        ms: Number(character.s.anniversary_visit.ms) || 0,
        expires: Number(character.s.anniversary_visit.expires) || 0,
        round: character.s.anniversary_visit.round || character.s.anniversary_visit.id || null,
      } : null,
      eventSchedules: eventScheduleSnapshot(), eventFeedAt: eventFeedAt, eventClockStale: !eventClockSyncedAt || Date.now() - eventClockSyncedAt > 360000,
      anniversaryServer: (function () {
        var value = eventStatus() && eventStatus().anniversary;
        if (!value) return null;
        var epoch = function (input) { var time = Number(input) || 0; return time && time < 1000000000000 ? time * 1000 : time; };
        return { active: value.active !== false, live: value.live !== false,
          available: value.available !== false,
          round: value.round || null, target: value.target || null, id: value.id || null,
          map: value.map || null, x: Number(value.x), y: Number(value.y),
          expires: epoch(value.expires), next: epoch(value.next) };
      })(),
      anniversaryState: { busy: anniversaryBusy, stage: anniversaryStage, round: anniversaryRound,
        completedRound: merchantAnniversaryCompletedRound(),
        mode: anniversaryMerchantMode, attemptAt: anniversaryMerchantAttemptAt,
        retryAt: anniversaryMerchantRetryAt, featuredHold: anniversaryMerchantFeaturedHold,
        craftResult: root.__anniversaryCraftResult || null },
      // This survives events hosted on normal maps, where mapEvent is null.
      joinedEvent: joinedEvent,
      eventRecovery: eventRecoveryState,
      farmReunion: reunion && { id: reunion.id, phase: reunion.phase, destination: reunion.destination,
        mage: reunion.mage, retryAt: reunion.retryAt, lastError: reunion.lastError },
      navigationState: townTraveling ? "town" : convoyTraveling ? "convoy" :
        followingLeader ? "follow" : departurePending ? "departing" : "idle",
      navigationDetail: (townTraveling || convoyTraveling || followingLeader || departurePending)
        ? (root.__partyNavigationDetail || null) : null,
      smartNavigation: typeof smart !== "undefined" ? {
        moving: !!smart.moving, searching: !!smart.searching, found: !!smart.found,
        map: smart.map || null, x: Number(smart.x) || 0, y: Number(smart.y) || 0,
        plot: Array.isArray(smart.plot) ? smart.plot.length : 0,
      } : null,
      x: Math.round(character.x),
      y: Math.round(character.y),
      moving: !!character.moving,
      rip: !!character.rip,
      lastDeath: lastDeathInfo,
      farmingNavigationDebug: { location: partyLocation, cancelled: navigationIntent.cancelled,
        occupied: root.sharedRoutine && root.sharedRoutine.isOccupied(),
        combatOwner: root.__partyCombatOwner || null,
        followingLeader: followingLeader, departurePending: departurePending,
        town: partyTownActive || townTraveling, anniversary: anniversaryBusy || anniversaryStaging,
        event: eventTraveling, forceTravel: forceTraveling, stocking: stocking, upgrading: upgrading },
      banking: banking,
      bankQueued: bankQueued,
      stocking: stocking,
      upgrading: upgrading,
      skin: character.skin,
      characterSprite: spriteDefinition(character.skin),
      characterDollHtml: characterDollHtml(),
      target: combatTarget && !combatTarget.dead ? { id: combatTarget.id, type: combatTarget.type,
        name: combatTarget.name || null, team: eventTeam(combatTarget), mtype: combatTarget.mtype,
        hp: combatTarget.hp, max_hp: combatTarget.max_hp, x: combatTarget.x, y: combatTarget.y } : null,
      farmAreaEvidence: farmAreaEvidence,
      farmAreaObservation: farmAreaObserved,
      farmCompetition: farmCompetitionObservation(),
      combat: {
        kiting: isCurrentlyKiting(),
        moving: !!character.moving,
        lastAttackAt: lastAttackAt,
        lastAttackTarget: lastAttackTarget,
        inRange: combatTarget && !combatTarget.dead ? !!is_in_range(combatTarget) : false,
        canAttack: combatTarget && !combatTarget.dead ? !!can_attack(combatTarget) : false,
        runner: root.partyCombatState || null,
        positioning: root.partyCombatPosition || null,
        performance: root.partyCombatPerformance || null,
      },
      farmingMode: farmingMode,
      farmingMonsterType: farmingMonsterType,
      monsterHunt: monsterHuntStatus(),
      huntEventPending: huntEventPending(),
      combatDeviation: recentCombatDeviation && Date.now() - recentCombatDeviation.at < 3000
        ? recentCombatDeviation : null,
      oneShotMonsterTypes: Object.keys(observedOneShotTypes),
      oneShotEpoch: scatterEpoch,
      threats: threats,
      conditions: activeConditions(),
      items: character.items.map(inventoryOperationEntry),
      slots: Object.keys(character.slots || {}).reduce(function (out, slot) {
        var item = character.slots[slot];
        if (item) out[slot] = { item: fingerprint(item), meta: itemDefinition(item) };
        return out;
      }, {}),
      bank: bankSnapshot(),
      bankVaults: bankVaultCatalog(),
    };
    if (!catalogKnown && catalogPrepared) {
      status.merchantCatalogVersion = merchantCatalogVersion;
      status.travelPlaces = travelPlaces();
      status.monsterChoices = monsterChoices();
      status.monsterLocationsVersion = 3;
      status.monsterHunterLocation = monsterHunterLocation();
      status.bestiaryCatalog = bestiaryCatalog();
      status.skillCatalog = skillCatalog();
      status.appearanceChoices = classAppearanceChoices();
      status.merchantCatalog = merchantCatalog();
    }
    return status;
  }

  function diagnosticText(value, limit) {
    return String(value == null ? "" : value)
      .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1?[redacted]")
      .replace(/\b(Bearer)\s+\S+/gi, "$1 [redacted]")
      .replace(/["']?\b(password|token|authorization|api[_ -]?key|secret|session)\b["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]")
      .slice(0, limit || 300);
  }

  function recordStatusFailure(error, phase) {
    var now = Date.now(), convoy = convoySignal || convoyTraveling;
    var details = { character: character.name, phase: phase,
      error: diagnosticText(error && (error.message || error.reason) || error),
      stack: diagnosticText(error && error.stack, 2000),
      request: error && error.partyRequest || null,
      convoy: convoy ? { id: convoy.id, phase: convoy.phase, epoch: convoy.epoch } : null };
    var history = root.__partyStatusDiagnostics || (root.__partyStatusDiagnostics = []);
    var key = JSON.stringify([phase, details.error, details.request, details.convoy]);
    var previous = history[history.length - 1];
    if (previous && previous.key === key && now - previous.at < 30000) {
      previous.details.repeats++; previous.details.lastAt = now;
      return;
    }
    details.repeats = 1; details.lastAt = now;
    var message = "Party status failed [" + phase + "]: " + details.error;
    history.push({ at: now, type: "status-error", message: message.slice(0, 240), details: details, key: key, delivered: false });
    if (history.length > 20) history.splice(0, history.length - 20);
    game_log(message.slice(0, 240), "red");
  }

  async function flushStatusDiagnostics() {
    if (root.__partyStatusDiagnosticsSending) return;
    var batch = (root.__partyStatusDiagnostics || []).filter(function (entry) { return !entry.delivered; });
    if (!batch.length) return;
    root.__partyStatusDiagnosticsSending = true;
    try {
      await request("/combat-log", { method: "POST", body: { character: character.name,
        events: batch.map(function (entry) { return { at: entry.at, type: entry.type, message: entry.message, details: entry.details }; }) } });
      batch.forEach(function (entry) { entry.delivered = true; });
    } catch (_diagnosticDeliveryError) {
      // Retry only after a later successful status update, never recursively.
    } finally { root.__partyStatusDiagnosticsSending = false; }
  }

  function request(path, options) {
    options = options || {};
    var convoyStatusStarted = path === '/status' ? convoyDiagnosticClock() : null;
    return new Promise(function (resolve, reject) {
      $.ajax({
        url: api + path,
        method: options.method || "GET",
        contentType: "application/json",
        dataType: "json",
        data: options.body ? JSON.stringify(options.body) : undefined,
        cache: false,
        // A native Steam runner lives longer than the local coordinator. A
        // half-open localhost request must not leave its one-at-a-time status
        // loop permanently busy after CaracAL or Windows restarts overnight.
        timeout: Number(options.timeout) > 0 ? Number(options.timeout) : 10000,
      }).done(function(value) {
        rememberConvoyStatusRequest(convoyStatusStarted, 'success');
        resolve(value);
      }).fail(function (xhr, status, error) {
        var httpStatus = Number(xhr && xhr.status) || 0;
        var kind = status === "timeout" ? "timeout" : status === "parsererror" ? "invalid-json" :
          status === "abort" ? "aborted" : httpStatus ? "http" : "network";
        rememberConvoyStatusRequest(convoyStatusStarted, kind);
        var serverError = xhr && xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.message);
        var reason = typeof serverError === "string" ? serverError :
          error && error !== "error" ? (error.message || error) : status;
        var context = { method: options.method || "GET", path: String(path).split(/[?#]/)[0],
          status: httpStatus, kind: kind, reason: diagnosticText(reason || kind) };
        var failure = new Error(context.method + " " + context.path + " · " +
          (httpStatus ? "HTTP " + httpStatus + " · " : "") + kind +
          (context.reason && context.reason !== kind && context.reason !== "error" ? ": " + context.reason : ""));
        failure.partyRequest = context;
        reject(failure);
      });
    });
  }

  // Passing encounters own attacks only, never navigation, kiting, or loot waits.
  function committedHuntEncounter(target) {
    // The coordinator supplies huntCombatTarget only after verified origin arrival.
    return !!(target && typeof huntCombatTarget !== 'undefined' && huntCombatTarget && target.mtype === huntCombatTarget &&
      !(typeof partyConvoyActive !== 'undefined' && partyConvoyActive) &&
      !(typeof convoyTraveling !== 'undefined' && convoyTraveling) &&
      !(typeof travelCombatActive === 'function' && travelCombatActive()));
  }

  // Observational only: failures here must never change request settlement.
  function convoyDiagnosticClock() {
    try { return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(); }
    catch (_) { return null; }
  }
  function rememberConvoyStatusRequest(started, outcome) {
    if (started === null) return;
    try {
      var now = convoyDiagnosticClock();
      if (now === null) return;
      var history = root.__partyConvoyHttp || (root.__partyConvoyHttp = {});
      if (outcome === 'success') history.responseAt = now;
      else history.failure = { at: now, kind: outcome, durationMs: Math.max(0, Math.round(now - started)) };
    } catch (_) {}
  }
  function passingKey(target) {
    return JSON.stringify([target.server || reunionRealm(), target.map || character.map,
      String(target.in == null ? character.in || character.map : target.in), String(target.id)]);
  }
  function passingEncounterReport() {
    var now = Date.now() + coordinatorClockOffset;
    Object.keys(passingEncounters).forEach(function(key) {
      var entry = passingEncounters[key], e = get_entity(entry.id);
      if (entry.server !== reunionRealm() || entry.map !== character.map || String(entry.in || entry.map) !== String(character.in || character.map) ||
          e && (e.dead || e.hp === 0) || typeof fightDeaths !== 'undefined' && fightDeaths.some(function(d){return passingKey(d)===key && d.at>=(entry.startedAt || entry.at);}) || committedHuntEncounter(entry) || now - entry.at > 60000) delete passingEncounters[key];
      else if (e && e.visible && !entry.reserved) entry.at = now;
    });
    return Object.values(passingEncounters).slice(-128);
  }
  function isPassingEncounter(target) {
    if (!target) return false;
    if (committedHuntEncounter(target)) return false;
    var key = passingKey(target), now = Date.now() + coordinatorClockOffset;
    if (target.dead || target.hp === 0) return false;
    var passingDeaths = (typeof fightDeaths !== 'undefined' ? fightDeaths : []).concat(groupedCombat && groupedCombat.deaths || []);
    if (passingDeaths.some(function(d){return passingKey(d)===key && now-d.at<60000;})) return false;
    if (peerPassingEncounters.some(function(e){return passingKey(e)===key && now-e.at<60000;})) return true;
    return !!(passingEncounters[key] && now - passingEncounters[key].at < 60000) ||
      !!(groupedCombat && (groupedCombat.passingEncounters || []).some(function(e) {return passingKey(e) === key && now-e.at<60000;}));
  }
  function passingTravelAllowed() {
    if (character.c && character.c.town || typeof movement !== 'undefined' && movement.transition && movement.transition()) return false;
    var convoy = typeof convoyTraveling !== 'undefined' && convoyTraveling;
    var pending = root.partyLootClient && root.partyLootClient.huntPending();
    if (!pending && !(convoy && (convoy.routeProtocol === 4 || convoy.purpose === 'monster-hunt' && (convoy.nonPreemptible || convoy.huntTarget)))) return true;
    var signal = typeof convoySignal !== 'undefined' && convoySignal;
    return !!(convoy && !convoy.cancelled && (convoy.routeProtocol === 4 || convoy.purpose === 'monster-hunt' && (convoy.nonPreemptible || convoy.huntTarget)) &&
      convoy.phase === 'travelling' && signal && signal.phase === 'travel' &&
      signal.id === convoy.id && Number(signal.epoch) === convoy.epoch && Number(signal.commandId) === convoy.commandId &&
      signal.runtimeId === convoyRuntimeId && Number(signal.validUntil) > Date.now() + coordinatorClockOffset &&
      convoy.navigationRevision === Number(navigationIntent.revision || 0));
  }
  function passingTarget() {
    if (!passingTravelAllowed()) return null;
    var convoy = typeof convoyTraveling !== 'undefined' && convoyTraveling;
    var hunting = convoy && convoy.purpose === 'monster-hunt' && convoy.huntTarget;
    var returning = convoy && (convoy.continuousReturn === 1 || hunting);
    if (character.rip || Number(character.max_hp)>0 && character.hp/character.max_hp<0.35 || character.ctype === 'merchant' || navigationIntent.cancelled || escapeOwns() || combatRecoveryActive() ||
        partyTownActive || banking || stocking || upgrading || gatheringActive || forceTraveling || townTraveling || eventTraveling || joinedEvent || activeCombatEvent() ||
        (rareActive() && rareControlState.kind !== "patrol") || !returning && unfinishedFight()) return null;
    var candidates = Object.values(parent.entities || {}).filter(function(e) {
      var rule = e && passiveHunting.rules[e.mtype];
      var defending = returning && e && (e.target === character.name || currentPartyList().indexOf(e.target) >= 0);
      return (defending || hunting && e && e.mtype === hunting || rule && rule.enabled && rule.keepMoving) && !committedHuntEncounter(e) && e.type === 'monster' && e.visible && !e.dead && e.hp > 0 &&
        (!e.map || e.map === character.map) && e.mtype !== 'fieldgen0' && is_in_range(e) &&
        (returning || isPassingEncounter(e) || !(e.target === character.name || currentPartyList().indexOf(e.target) >= 0)) &&
        !isExternallyClaimedMonster(e) && (returning || !groupedCombat || !groupedCombat.target || groupedCombat.target.id !== e.id) &&
        !(root.partyRoleRunner && root.partyRoleRunner.isKnownDead(e.id));
    });
    candidates.sort(function(a,b) {return monsterPriority(b)-monsterPriority(a) || Math.hypot(character.x-a.x,character.y-a.y)-Math.hypot(character.x-b.x,character.y-b.y) || String(a.id).localeCompare(String(b.id));});
    return candidates[0] || null;
  }
  function beginPassingAttack(target, admission, reserveOnly) {
    var previous = passingEncounters[passingKey(target)];
    var entry = Object.assign(groupedEntityReport(target), {server:reunionRealm(),at:Date.now()+coordinatorClockOffset,startedAt:previous && previous.startedAt || Date.now()+coordinatorClockOffset,admission:admission || previous && previous.admission,reserved:!!reserveOnly});
    passingEncounters[passingKey(entry)] = entry;
    if (root.partyQueueClient) root.partyQueueClient.flush();
    if (reserveOnly) return;
    if (target.mtype !== 'tinyp' || !passiveHunting.useFieldGenerators || rareFields().length || Math.hypot(character.x-target.x,character.y-target.y)>=200) return;
    var key = passingKey(entry);
    if (!passiveGeneratorAttempt || passiveGeneratorAttempt.key !== key) passiveGeneratorAttempt={key:key,at:Date.now(),sent:false};
    var rank = currentPartyList().slice().sort().indexOf(character.name);
    if (passiveGeneratorAttempt.sent || Date.now()-passiveGeneratorAttempt.at<Math.max(0,rank)*1000) return;
    var slot = character.items.findIndex(function(item){return item && item.name==='fieldgen0';});
    if (slot<0) return;
    passiveGeneratorAttempt.sent=true;
    Promise.resolve(equip(slot)).catch(function(){passiveGeneratorAttempt=null;});
  }

  function rareSightings() {
    var result = [];
    Object.keys(parent.entities || {}).forEach(function (id) {
      var e = parent.entities[id];
      if (!e || e.type !== "monster" || !(passiveRareHunts[e.mtype] || e.mtype === "phoenix") || isPassingEncounter(e) || !e.visible || e.dead) return;
      rareKnown[String(e.id)] = e.mtype;
      result.push({ id: String(e.id), mtype: e.mtype, x: e.real_x !== undefined ? e.real_x : e.x,
        y: e.real_y !== undefined ? e.real_y : e.y, hp: e.hp, target: e.target || null, visible: true,
        partyEngaged: typeof root !== 'undefined' && !!(root.partyLootClient && root.partyLootClient.rare.engaged({id:String(e.id),realm:':'+String(parent.server_region||'')+String(parent.server_identifier||''),map:character.map,in:String(character.in||character.map)})) });
    });
    return result.sort(function(a,b){return monsterPriority(b)-monsterPriority(a);}).slice(0,64);
  }
  function rareObservationReport() {
    return {at:Date.now()+coordinatorClockOffset,runtimeId:convoyRuntimeId,
      map:character.map,in:String(character.in || character.map),server:reunionRealm(),
      x:character.x,y:character.y,sightings:rareSightings()};
  }
  function rareFields() {
    return Object.values(parent.entities || {}).filter(function (e) {
      return e && e.mtype === "fieldgen0" && !e.dead && e.hp > 0;
    }).map(function (e) { return { id: e.id, x: e.x, y: e.y }; });
  }
  function acceptRareCombatControl(state) {
    if ('partyLocation' in state) return; // Full status applies its existing movement handoff below.
    if (!Object.prototype.hasOwnProperty.call(state,'rareControl') ||
        Number(state.serverNow || 0) < Number(root.__partyRareControlAt || 0)) return;
    root.__partyRareControlAt = Number(state.serverNow || 0);
    if (state.rareControl && (!rareControlState || state.rareControl.id !== rareControlState.id))
      root.__partyRareHandoffPending = true;
    rareControlState = state.rareControl || null; rareControlAt = Date.now();
    if (!rareControlState) { cancelRarePath(); return; }
    if (rareControlState.kind !== 'encounter' || !rareControlCurrent() || state.convoySignal) return;
    var prior = convoyTraveling;
    if (!prior || prior.purpose !== 'phoenix-patrol') return;
    prior.cancelled = true;
    if (prior.detachRoute) prior.detachRoute();
    releaseConvoyCruise(prior);
    if (prior.release) prior.release();
    convoyTraveling = null; partyConvoyActive = false;
    Promise.resolve(stop('smart')).catch(function(){});
  }
  function rareControlCurrent() {
    return !!(rareControlState && Date.now() - rareControlAt < 3500 && !navigationIntent.cancelled &&
      rareControlState.revision === navigationIntent.revision && !character.rip &&
      !partyTownActive && !eventTraveling && !joinedEvent && !escapeOwns());
  }
  function rareActive() {
    if (typeof unfinishedFight === "function" && unfinishedFight() &&
        !(rareControlState && rareControlState.kind === "encounter" && groupedCombat.target &&
          groupedCombat.target.id === rareControlState.target.id)) return false;
    return rareControlCurrent();
  }
  function rareTarget() {
    if (!rareActive() || rareControlState.kind !== "encounter") return null;
    var wanted = rareControlState.target;
    if (wanted.map !== character.map || String(wanted.in) !== String(character.in || character.map)) return null;
    var e = get_entity(wanted.id);
    return e && e.visible && !e.dead && e.mtype === wanted.mtype && !isExternallyClaimedMonster(e) ? e : null;
  }
  function rareAttackAllowed(target, skill) {
    if (!target) return false;
    if (target.mtype === "fieldgen0") return false;
    if (target.mtype !== "tinyp") return true;
    if (isPassingEncounter(target) || skill === "attack" && passingTarget() === target) return skill === "attack";
    if (!rareActive() || !rareTarget() || rareTarget().id !== target.id || skill !== "attack") return false;
    return !rareControlState.deployer;
  }
  function cancelRarePath() {
    if (!rarePath) return;
    var replaced = typeof smart !== "undefined" && rarePath.onDone && smart.on_done !== rarePath.onDone;
    rarePath.cancelled = true; rarePath = null;
    if (!replaced && typeof stop === "function") Promise.resolve(stop("smart")).catch(function () {});
  }
  function pollRareHunting() {
    if (!rareActive()) { cancelRarePath(); return false; }
    var control = rareControlState, target = rareTarget();
    if (control.kind === "patrol") { cancelRarePath(); return true; }
    if (groupedFarming() && control.kind === "encounter" && (control.deployer !== character.name ||
        !target || Math.hypot(character.x-target.x,character.y-target.y)>=200)) {
      cancelRarePath(); return false;
    }
    if (rarePath && (rarePath.id !== control.id || target && control.deployer !== character.name || partyConvoyActive ||
        rarePath.map !== control.destination.map || Math.hypot(rarePath.x-control.destination.x, rarePath.y-control.destination.y) > 100)) cancelRarePath();
    if (convoyTraveling || partyConvoyActive || banking || stocking || upgrading || forceTraveling || townTraveling) return true;
    if (control.kind === "encounter" && target && control.deployer !== character.name) return false;
    var destination = control.destination;
    if (control.kind === "patrol" && character.name !== leader) return false;
    if (control.kind === "encounter" && target && control.deployer === character.name) {
      destination = { map: character.map, x: target.x, y: target.y };
      if (Math.hypot(character.x-target.x, character.y-target.y) < 200) {
        cancelRarePath();
        if (!rareDeployment || rareDeployment.encounterId !== control.id) {
          rareDeployment = { encounterId: control.id, at: Date.now(), failed: false };
          var slot = character.items.findIndex(function (item) { return item && item.name === "fieldgen0"; });
          if (slot < 0) rareDeployment.failed = true;
          else {
            // equip() is the game's consumable/spawner path; verify the slot at dispatch.
            if (character.items[slot] && character.items[slot].name === "fieldgen0") {
              var deployment = rareDeployment;
              Promise.resolve(equip(slot)).catch(function () { deployment.failed = true; });
            } else rareDeployment.failed = true;
          }
        }
        return true;
      }
    }
    if (!destination || !Number.isFinite(destination.x) || !Number.isFinite(destination.y)) return true;
    if (destination.map === character.map && Math.hypot(character.x-destination.x, character.y-destination.y) <= 30) {
      cancelRarePath();
      if (control.kind === "loot") { pollRareLoot(control); return true; }
      return control.kind === "patrol";
    }
    if (rareNavigation && rareNavigation.id === control.id && rareNavigation.failed) return true;
    if (!rarePath) {
      var path = rarePath = { id: control.id, at: Date.now(), cancelled: false,
        map: destination.map, x: destination.x, y: destination.y };
      rareNavigation = { id: control.id, failed: false };
      Promise.resolve(smart_move({ map: destination.map, x: destination.x, y: destination.y }))
        .catch(function (error) {
          if (!path.cancelled && rarePath === path) rareNavigation = { id: path.id, failed: true,
            reason: String(error && (error.reason || error.message) || error) };
        }).finally(function () { if (rarePath === path) rarePath = null; });
      path.onDone = typeof smart !== "undefined" && smart.on_done;
    } else if (Date.now() - rarePath.at > 30000) {
      rareNavigation = { id: control.id, failed: true, reason: "Rare route timed out" }; cancelRarePath();
    }
    return true;
  }

  function pollRareLoot(control) {
    if (typeof root !== "undefined" && root.partyLootClient) { root.partyLootClient.rare.tick(); return; }
    if (rareLootPending) return;
    rareLootPending = true;
    // Rare movement owns this phase, so the ordinary support loot loop is paused.
    Promise.resolve(smartLoot()).then(function () {
      rareLoot = { id: control.id, at: Date.now(), complete: eligibleDepartureChests().length === 0 };
    }).catch(function () {
      rareLoot = { id: control.id, at: Date.now(), complete: false };
    }).finally(function () { rareLootPending = false; });
  }

  function mapEntity(entity, id) {
    if (!entity || entity.dead) return null;
    var type = entity.type || (entity.mtype ? "monster" : null);
    if (["character", "monster", "npc"].indexOf(type) < 0) return null;
    var skin = entity.skin || entity.mtype;
    return {
      id: String(entity.id || id), name: entity.name || entity.mtype || String(id),
      type: type, ctype: entity.ctype || null, mtype: entity.mtype || null,
      x: Number(entity.real_x !== undefined ? entity.real_x : entity.x) || 0,
      y: Number(entity.real_y !== undefined ? entity.real_y : entity.y) || 0,
      hp: Number(entity.hp) || 0, max_hp: Number(entity.max_hp) || 0,
      mp: Number(entity.mp) || 0, max_mp: Number(entity.max_mp) || 0,
      target: entity.target || null, moving: !!entity.moving,
      angle: Number(entity.angle) || 0, direction: Number(entity.direction) || 0,
      going_x: Number(entity.going_x) || 0, going_y: Number(entity.going_y) || 0,
      sprite: skin ? spriteDefinition(skin) : null,
      dollHtml: type === "character" ? mapDollHtml(entity, entity.direction) : null,
      stand: entity.stand || null,
      standSprite: entity.stand ? (spriteDefinition(typeof entity.stand === "string" ? entity.stand : "stand0") || spriteDefinition("stand0")) : null,
    };
  }

  function publishMapFrame() {
    if (!mapTelemetryEnabled || mapTelemetryBusy) return;
    mapTelemetryBusy = true;
    var self = mapEntity(character, character.name);
    if (self) { self.id = character.name; self.name = character.name; self.type = "character"; }
    var entities = Object.keys(parent.entities || {}).map(function (id) {
      return mapEntity(parent.entities[id], id);
    }).filter(Boolean);
    if (self && !entities.some(function (entry) { return entry.id === self.id; })) entities.push(self);
    var events = mapTelemetryEvents.splice(0, mapTelemetryEvents.length);
    $.ajax({
      url: api + "/map-frame", method: "POST", contentType: "application/json",
      data: JSON.stringify({ name: character.name, map: character.map, at: Date.now(),
        x: Number(character.real_x !== undefined ? character.real_x : character.x) || 0,
        y: Number(character.real_y !== undefined ? character.real_y : character.y) || 0,
        target: character.target || combatTargetId || null, eventCombat: eventTargetTypes.length>0, queue: queueMarkers(), queueRevision: groupedCombat && groupedCombat.queueRevision, grouped: groupedFarming(), entities: entities, events: events }),
    }).always(function () { mapTelemetryBusy = false; });
  }

  async function stockUp() {
    var potionName = "hpot1";
    var targetQuantity = 20;
    var currentQuantity = quantity(potionName);
    if (stocking || upgrading || banking || bankQueued || departurePending || character.rip || currentQuantity > 0) return false;
    var potion = G.items[potionName];
    var needed = targetQuantity - currentQuantity;
    if (!potion || character.gold < potion.g * needed) return false;

    stocking = true;
    var origin = { map: character.map, x: character.x, y: character.y };
    try {
      var vendor = find_npc("fancypots");
      if (!vendor) throw new Error("fancypots vendor not found");
      await smart_move(vendor);
      currentQuantity = quantity(potionName);
      needed = Math.max(0, targetQuantity - currentQuantity);
      if (needed && character.gold >= potion.g * needed) {
        await buy(potionName, needed);
        game_log("Stocked " + needed + " quality HP potions", "#51D2E1");
      }
      return quantity(potionName) >= targetQuantity;
    } finally {
      try {
        await smart_move(partyLocation || origin);
      } catch (returnError) {
        game_log("Return from potion vendor failed: " + (returnError.reason || returnError.message || returnError), "red");
      }
      stocking = false;
    }
  }

  function findMarkedItem(mark) {
    if (Number.isInteger(mark.slot) && sameItem(character.items[mark.slot], mark.item)) return mark.slot;
    return findItem(mark.item);
  }

  async function waitForMarkedItem(mark, timeout) {
    var deadline = Date.now() + (timeout || 2000);
    var slot = findMarkedItem(mark);
    while (slot < 0 && Date.now() < deadline) {
      await new Promise(function (resolve) { setTimeout(resolve, 50); });
      slot = findMarkedItem(mark);
    }
    return slot;
  }

  function itemSeller(itemName) {
    for (var npcId in G.npcs) {
      if (Array.isArray(G.npcs[npcId].items) && G.npcs[npcId].items.indexOf(itemName) >= 0 && !G.npcs[npcId].ignore)
        return npcId;
    }
    return null;
  }

  async function upgradeMarked(marks, compoundGroups, purchases, returnLocation) {
    if (upgrading || banking) return;
    while (stocking) await new Promise(function (resolve) { setTimeout(resolve, 250); });
    upgrading = true;
    var origin = { map: character.map, x: character.x, y: character.y };
    var completed = [];
    var purchased = [];
    var compounded = [];
    try {
      var work = [];
      for (var markIndex = 0; markIndex < marks.length; markIndex += 1) {
        var mark = marks[markIndex];
        if (mark.equipped && typeof mark.slot === "string" &&
            sameItem(character.slots[mark.slot], mark.item)) {
          await unequip(mark.slot);
        }
        var slot = await waitForMarkedItem(mark);
        var definition = slot >= 0 && G.items[character.items[slot].name];
        if (slot < 0 || !definition || !definition.upgrade) {
          completed.push(mark);
          continue;
        }
        var remainingLevels = maximumItemLevel(definition) - (character.items[slot].level || 0);
        if (remainingLevels <= 0) { completed.push(mark); continue; }
        var tiers = Math.max(1, Math.min(Number(mark.tiers) || 1, remainingLevels));
        work.push({ mark: mark, slot: slot, tiers: tiers });
      }
      var required = {};
      work.forEach(function (entry) {
        var item = character.items[entry.slot];
        for (var tier = 0; tier < entry.tiers; tier += 1) {
          var scroll = "scroll" + item_grade({ name: item.name, level: (item.level || 0) + tier });
          required[scroll] = (required[scroll] || 0) + 1;
        }
      });
      var compoundWork = [];
      (compoundGroups || []).forEach(function (group) {
        if (!group || !Array.isArray(group.items) || group.items.length !== 3) return;
        var used = {};
        var slots = group.items.map(function (mark) {
          var slot = Number.isInteger(mark.slot) && !used[mark.slot] && sameItem(character.items[mark.slot], mark.item)
            ? mark.slot : character.items.findIndex(function (item, index) {
              return !used[index] && sameItem(item, mark.item);
            });
          if (slot >= 0) used[slot] = true;
          return slot;
        });
        if (slots.some(function (slot) { return slot < 0; })) return;
        var items = slots.map(function (slot) { return character.items[slot]; });
        var definition = G.items[items[0].name];
        if (!definition || !definition.compound || items.some(function (item) {
          return item.name !== items[0].name || (item.level || 0) !== (items[0].level || 0);
        })) return;
        var scroll = "cscroll" + item_grade(items[0]);
        required[scroll] = (required[scroll] || 0) + 1;
        compoundWork.push({ group: group, scroll: scroll });
      });
      Object.keys(required).forEach(function (scroll) {
        var owned = Math.min(required[scroll], inventoryQuantity(scroll));
        if (owned) game_log("Using " + owned + " existing " + G.items[scroll].name +
          " from inventory slot " + findInventoryItemByName(scroll), "#51D2E1");
      });
      var goldNeeded = Object.keys(required).reduce(function (total, scroll) {
        return total + Math.max(0, required[scroll] - inventoryQuantity(scroll)) * G.items[scroll].g;
      }, 0);
      (purchases || []).forEach(function (purchase) {
        if (G.items[purchase.name] && itemSeller(purchase.name)) goldNeeded += G.items[purchase.name].g;
      });
      if (character.gold < goldNeeded) {
        await smart_move("bank");
        var shortfall = goldNeeded - character.gold;
        if (!character.bank || character.bank.gold < shortfall)
          throw new Error("not enough gold in character and bank for upgrade scrolls");
        await withdrawMerchantCash(shortfall);
      }
      for (var purchaseIndex = 0; purchaseIndex < (purchases || []).length; purchaseIndex += 1) {
        var purchase = purchases[purchaseIndex];
        var seller = purchase && itemSeller(purchase.name);
        if (!seller || !G.items[purchase.name]) {
          game_log("Cannot buy another " + (purchase && purchase.name || "item") + ": no merchant found", "red");
          purchased.push(purchase);
          continue;
        }
        await smart_move(find_npc(seller));
        await buy(purchase.name, 1);
        purchased.push(purchase);
      }
      if (goldNeeded) {
        await smart_move(find_npc("scrolls"));
        for (var scroll in required) {
          var missing = Math.max(0, required[scroll] - inventoryQuantity(scroll));
          if (missing) await buy(scroll, missing);
        }
      }
      await smart_move(find_npc("newupgrade"));
      for (var i = 0; i < work.length; i += 1) {
        var itemSlot = findMarkedItem(work[i].mark);
        for (var step = 0; step < work[i].tiers; step += 1) {
          if (itemSlot < 0 || !character.items[itemSlot] || character.items[itemSlot].name !== work[i].mark.item.name) break;
          var scrollName = "scroll" + item_grade(character.items[itemSlot]);
          var scrollSlot = findInventoryItemByName(scrollName);
          if (scrollSlot < 0) break;
          try {
            var preview = await upgrade(itemSlot, scrollSlot, null, true);
            game_log(G.items[character.items[itemSlot].name].name + " upgrade chance: " +
              (preview.chance * 100).toFixed(2) + "%", "#51D2E1");
            await upgradeConfirmed(itemSlot, scrollSlot);
          } catch (upgradeError) {
            if (upgradeError.code === "lucky_slot_unavailable") throw upgradeError;
            game_log("Upgrade failed: " + (upgradeError.reason || upgradeError.message || upgradeError), "red");
            break;
          }
        }
        completed.push(work[i].mark);
      }
      for (var compoundIndex = 0; compoundIndex < compoundWork.length; compoundIndex += 1) {
        var compoundEntry = compoundWork[compoundIndex];
        var usedSlots = {};
        var itemSlots = compoundEntry.group.items.map(function (mark) {
          var slot = Number.isInteger(mark.slot) && !usedSlots[mark.slot] && sameItem(character.items[mark.slot], mark.item)
            ? mark.slot : character.items.findIndex(function (item, index) {
              return !usedSlots[index] && sameItem(item, mark.item);
            });
          if (slot >= 0) usedSlots[slot] = true;
          return slot;
        });
        var compoundScrollSlot = findInventoryItemByName(compoundEntry.scroll);
        if (itemSlots.some(function (slot) { return slot < 0; }) || compoundScrollSlot < 0) continue;
        try {
          var compoundPreview = await compound(itemSlots[0], itemSlots[1], itemSlots[2], compoundScrollSlot, null, true);
          game_log(G.items[character.items[itemSlots[0]].name].name + " compound chance: " +
            (compoundPreview.chance * 100).toFixed(2) + "%", "#51D2E1");
          await compound(itemSlots[0], itemSlots[1], itemSlots[2], compoundScrollSlot);
          compounded.push(compoundEntry.group.id);
        } catch (compoundError) {
          game_log("Compound failed: " + (compoundError.reason || compoundError.message || compoundError), "red");
        }
      }
    } catch (error) {
      game_log("Upgrade run failed: " + (error.reason || error.message || error), "red");
    } finally {
      try {
        await smart_move(returnLocation || partyLocation || origin);
      } catch (returnError) {
        game_log("Return from upgrades failed: " + (returnError.reason || returnError.message || returnError), "red");
      }
      upgrading = false;
      try {
        await request("/bank-complete", { method: "POST", body: {
          character: character.name, upgraded: completed, purchased: purchased, compounded: compounded,
        } });
      } catch (completeError) {
        game_log("Upgrade queue release failed: " + (completeError.message || completeError), "red");
      }
    }
  }

  function findBankItem(wanted, preferredPack, preferredSlot, normalizeLevel) {
    function matches(item) {
      return sameItem(normalizeLevel && item ? Object.assign({}, item, {level:Number(item.level)||0}) : item, wanted);
    }
    if (character.bank && character.bank[preferredPack] &&
        matches(character.bank[preferredPack][preferredSlot])) {
      return { pack: preferredPack, slot: preferredSlot };
    }
    var packs = Object.keys(character.bank || {});
    for (var p = 0; p < packs.length; p += 1) {
      if (!Array.isArray(character.bank[packs[p]])) continue;
      for (var slot = 0; slot < character.bank[packs[p]].length; slot += 1) {
        if (matches(character.bank[packs[p]][slot]))
          return { pack: packs[p], slot: slot };
      }
    }
    return null;
  }

  function bankStackIdentity(item) {
    return JSON.stringify(["name", "level", "p", "stat_type", "data", "rid", "b", "m", "l"].map(function (key) {
      return key === "level" ? Number(item && item.level) || 0 : item && item[key] != null ? item[key] : null;
    }));
  }

  var bankStacks = null, bankStackVisitSignature = null;
  function bankStackService() {
    if (bankStacks) return bankStacks;
    var journalKey = "party-bank-stack-buffer:" + character.name;
    function definitions() { return typeof bank_packs !== "undefined" ? bank_packs : parent.bank_packs || {}; }
    bankStacks = root.partyCreateBankStacks({
      items: function() { return character.items; }, bank: function() { return character.bank || {}; },
      size: function() { return Number(character.isize) || character.items.length; },
      map: function() { return character.map; }, floor: function(pack) { return (definitions()[pack] || [character.map])[0]; },
      reachable: accessibleBankSortFloors, limit: function(item) { return Number((G.items[item.name] || {}).s) || 1; },
      protection: async function() {
        var state = await bankSortCheckpoint("stack");
        if (!state.protection) throw new Error("Bank stack protection unavailable; coordinator update required");
        return state.protection;
      },
      current: runtimeCurrent, move: function(floor) { return movement.move(floor); },
      retrieve: function(pack, slot, inv) { return bank_retrieve(pack, slot, inv); },
      store: function(inv, pack, slot) { return bank_store(inv, pack, slot); },
      bankSwap: function(pack, a, b) { return bank_swap(pack, a, b); },
      swap: function(a, b) { return swap(a, b); }, split: function(slot, q) { return split(slot, q); },
      read: function() {
        // caracAL storage is an IPC-backed cache: delayed echoes of older writes
        // can replace its current value. Keep this runtime's writes authoritative.
        if (Object.prototype.hasOwnProperty.call(root, "__partyBankStackJournal")) return root.__partyBankStackJournal;
        return root.localStorage ? JSON.parse(root.localStorage.getItem(journalKey) || "null") : root.__partyBankStackJournal || null;
      },
      write: function(journal) {
        if (root.localStorage) root.localStorage.setItem(journalKey, JSON.stringify(journal));
        root.__partyBankStackJournal = journal;
      }, sleep: sleep, now: Date.now,
    });
    return bankStacks;
  }
  async function finishBankStacks(activity) {
    var signature = JSON.stringify([bankSortVisit && bankSortVisit.id, character.bank]);
    if (bankStackVisitSignature === signature) return;
    var result = await bankStackService().compact();
    if (!result.deferred) bankStackVisitSignature = JSON.stringify([bankSortVisit && bankSortVisit.id, character.bank]);
    if (result.moved) {
      activity.push({ level: "info", message: "Combined " + result.moved + " bank stacks" });
      await request("/status", { method: "POST", body: snapshot() });
    }
    if (result.deferred) activity.push({ level: "info", message: "Bank stack cleanup deferred: inventory buffers unavailable" });
  }
  async function bankStoreFully(slot) {
    var attempts = 0;
    while (character.items[slot] && attempts < 50) {
      var inventorySize = Number(character.isize) || character.items.length;
      if (slot >= inventorySize) {
        var recoveredSlot = -1;
        for (var validSlot = 0; validSlot < inventorySize; validSlot += 1) {
          if (!character.items[validSlot]) { recoveredSlot = validSlot; break; }
        }
        if (recoveredSlot < 0) throw new Error("Inventory overflow item has no valid recovery slot");
        await swap(slot, recoveredSlot);
        var recoveryDeadline = Date.now() + 2500;
        while (!character.items[recoveredSlot] && Date.now() < recoveryDeadline) await sleep(100);
        if (!character.items[recoveredSlot]) throw new Error("Could not recover inventory overflow item");
        slot = recoveredSlot;
      }
      await bankStackService().fill(slot);
      if (!character.items[slot]) { await bankboiCheckpoint(); return; }
      var allowed = await bankStackService().locations();
      var before = JSON.stringify(fingerprint(character.items[slot]));
      var source = character.items[slot], destination = null, compatibleStack = null;
      var packDefinitions = typeof bank_packs !== "undefined" ? bank_packs : (parent.bank_packs || {});
      var packs = Object.keys(character.bank || {}).filter(function (pack) {
        return pack !== "gold" && Array.isArray(character.bank[pack]) &&
          (!packDefinitions[pack] || packDefinitions[pack][0] === character.map);
      });
      var stackLimit = Number(G.items[source.name] && G.items[source.name].s) || 1;
      for (var p = 0; p < packs.length && !destination && !compatibleStack; p += 1) {
        for (var bankSlot = 0; bankSlot < 42; bankSlot += 1) {
          if (!allowed.some(function(location) { return location.pack === packs[p] && location.slot === bankSlot; })) continue;
          var bankItem = character.bank[packs[p]][bankSlot];
          if (bankItem && stackLimit > 1 && bankStackIdentity(bankItem) === bankStackIdentity(source) &&
              Number(bankItem.q || 1) + Number(source.q || 1) <= stackLimit) {
            compatibleStack = { pack: packs[p], slot: bankSlot }; break;
          }
        }
      }
      // Staging is a transfer pane, so compatible deposits must merge here too.
      if (!compatibleStack && stackLimit > 1 && Array.isArray(character.bank.items1)) {
        for (var stagedSlot = 35; stagedSlot < 42; stagedSlot += 1) {
          var stagedItem = character.bank.items1[stagedSlot];
          if (stagedItem && bankStackIdentity(stagedItem) === bankStackIdentity(source) &&
              Number(stagedItem.q || 1) + Number(source.q || 1) <= stackLimit) {
            compatibleStack = { pack: "items1", slot: stagedSlot }; break;
          }
        }
      }
      var home = stackLimit > 1 && bankStackHomes[bankStackIdentity(source)];
      var virtualHome = home && home.owner !== "bank" && home.owner !== character.name && home.room >= Number(source.q || 1);
      for (var ep = 0; ep < packs.length && !destination && !compatibleStack && !virtualHome; ep += 1) {
        for (var emptyBankSlot = 0; emptyBankSlot < 42; emptyBankSlot += 1) {
          if (!allowed.some(function(location) { return location.pack === packs[ep] && location.slot === emptyBankSlot; })) continue;
          if (!character.bank[packs[ep]][emptyBankSlot]) { destination = { pack: packs[ep], slot: emptyBankSlot }; break; }
        }
      }
      if (!destination && !compatibleStack && Array.isArray(character.bank.items1)) {
        for (var reserveSlot = 35; reserveSlot < 42; reserveSlot += 1) {
          if (!character.bank.items1[reserveSlot]) { destination = { pack: "items1", slot: reserveSlot }; break; }
        }
      }
      if (!destination && !compatibleStack) {
        await bankboiCheckpoint();
        throw new Error("bank_full");
      }
      attempts += 1;
      if (compatibleStack) {
        // Let the server merge into this pack. An explicit occupied bank slot
        // swaps, while withdrawing first can merge bank stock into unrelated,
        // unmarked inventory stacks. Deposit only the requested inventory slot.
        await bank_store(slot, compatibleStack.pack);
      } else await bank_store(slot, destination.pack, destination.slot);
      // The bank_store promise can resolve before the reactive inventory proxy
      // reflects the server mutation. Wait briefly for a real source change.
      var settleDeadline = Date.now() + 2500, after = before;
      while (after === before && Date.now() < settleDeadline) {
        await sleep(100);
        after = character.items[slot] ? JSON.stringify(fingerprint(character.items[slot])) : null;
      }
      if (!character.items[slot]) { await bankboiCheckpoint(); return; }
      if (after === before) throw new Error("Bank did not accept " + character.items[slot].name);
    }
    if (character.items[slot]) throw new Error("Could not completely store " + character.items[slot].name);
  }

  async function bankboiCheckpoint() {
    if (character.ctype !== "merchant") return;
    const result = await request("/bankboi/checkpoint", { method: "POST", body: {
      character: character.name, bank: bankSnapshot(),
    }});
    // The job's existing completion path saves acknowledgements and releases
    // ownership. Only then may the coordinator swap the merchant for storage.
    if (result && result.pending) throw new Error("bankboi_pending");
  }

  // A visit spans all bank floors, and is captured before any asynchronous banking work.
  var bankSortVisit = null, bankSortPass = null, bankSortFlight = null, bankSortObserved = false, bankSortRecovered = false, bankSortRecoveryFlight = null;
  function bankSortMap(map) { return /^bank(?:_|$)/.test(String(map)); }
  function observeBankSortVisit() {
    if (!bankSortMap(character.map)) { bankSortVisit = null; bankSortObserved = true; return; }
    if (!bankSortVisit) bankSortVisit = { id: convoyRuntimeId + ":" + Date.now(),
      enteredAt: bankSortObserved ? Date.now() + (coordinatorClockOffset || 0) : 0, floors: {}, attempted: false };
    bankSortObserved = true;
  }
  async function bankSortCheckpoint(action, id, message) {
    if (!runtimeCurrent()) throw new Error("Bank sort runtime replaced");
    observeBankSortVisit();
    return request("/merchant/bank-sort/checkpoint", { method: "POST", body: {
      character: character.name, runtime: convoyRuntimeId, visit: bankSortVisit && bankSortVisit.id,
      enteredAt: bankSortVisit && bankSortVisit.enteredAt, action: action, id: id, message: message,
    }});
  }
  async function bankSortAuthorization() {
    var state = await bankSortCheckpoint("read");
    if (state.mode === "automatic") return !bankSortPass;
    return !!(bankSortPass && state.pending && state.pending.id === bankSortPass &&
      state.pending.runtime === convoyRuntimeId && state.pending.visit === bankSortVisit.id);
  }
  async function bankSortGuard() {
    if (!await bankSortAuthorization()) throw new Error("Bank sorting cancelled");
  }
  function bankSortSignature() {
    return JSON.stringify(bankPacksOnCurrentFloor().map(function(pack) { return [pack, character.bank[pack]]; }));
  }
  function accessibleBankSortFloors() {
    var floors = [character.map], keys = {};
    Object.keys(G.items).forEach(function(name) {
      if (G.items[name].type === "bank_key") keys[G.items[name].unlocks] = name;
    });
    for (var i = 0; i < floors.length; i += 1) {
      ((G.maps[floors[i]] || {}).doors || []).forEach(function(door) {
        var map = door[4];
        if (!bankSortMap(map) || floors.indexOf(map) >= 0 || door[8] === "complicated") return;
        if (door[7] === "key" && !character.items.some(function(item) { return item && item.name === keys[map]; })) return;
        floors.push(map);
      });
    }
    var definitions = typeof bank_packs !== "undefined" ? bank_packs : (parent.bank_packs || {});
    return floors.filter(function(map) {
      return Object.keys(character.bank || {}).some(function(pack) {
        return Array.isArray(character.bank[pack]) && definitions[pack] && definitions[pack][0] === map;
      });
    });
  }
  async function finishRequestedBankSort() {
    observeBankSortVisit();
    if (!bankSortVisit || bankSortVisit.attempted) return;
    var state = await bankSortCheckpoint("claim");
    var pending = state.pending;
    if (state.mode !== "request" || !pending || pending.runtime !== convoyRuntimeId || pending.visit !== bankSortVisit.id) return;
    bankSortVisit.attempted = true;
    bankSortPass = pending.id;
    var activity = [], origin = { map: character.map, x: character.x, y: character.y };
    try {
      var floors = accessibleBankSortFloors();
      if (!floors.length) throw new Error("Bank floor data unavailable");
      for (var i = 0; i < floors.length; i += 1) {
        await bankSortGuard();
        if (character.map !== floors[i]) await movement.move(floors[i]);
        await sortCurrentBankFloor(activity);
      }
      await bankSortGuard();
      await bankSortCheckpoint("complete", bankSortPass);
    } catch (error) {
      await bankSortCheckpoint("retry", bankSortPass, String(error.message || error)).catch(function() {});
      activity.push({ level: "error", message: "Bank sorting needs retry", details: String(error.message || error) });
    } finally {
      bankSortPass = null;
      if ((root.__partyBankSortBuffers || []).some(function(slot) { return character.items[slot]; }))
        throw new Error("Bank sort buffer cleanup pending; staying in bank");
      if (runtimeCurrent() && bankSortMap(character.map) && character.map !== origin.map) await movement.move(origin);
      activity.forEach(function(entry) { gatheringStatus(entry.message, entry.level, entry.details); });
    }
  }
  function bankSortBufferJournal() {
    if (!root.__partyBankSortJournal) {
      var saved = root.localStorage && root.localStorage.getItem("party-bank-sort-buffer:" + character.name);
      root.__partyBankSortJournal = saved ? JSON.parse(saved) : [];
    }
    return root.__partyBankSortJournal;
  }
  function saveBankSortBuffers(entries) {
    // Journal before each mutation, including both possible sides of an unacknowledged swap.
    if (root.localStorage) root.localStorage.setItem("party-bank-sort-buffer:" + character.name, JSON.stringify(entries));
    root.__partyBankSortJournal = entries;
    root.__partyBankSortBuffers = entries.map(function(entry) { return entry.slot; });
  }
  function rememberBankSortBuffers(slots, incoming) {
    bankSortRecovered = true;
    saveBankSortBuffers(slots.map(function(slot, index) {
      return { slot: slot, floor: character.map, identities: [character.items[slot], incoming[index]].filter(Boolean).map(bankStackIdentity) };
    }));
  }
  async function cleanupBankSortBuffers() {
    var entries = bankSortBufferJournal();
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i], item = character.items[entry.slot];
      if (!item) continue;
      if (entry.identities.indexOf(bankStackIdentity(item)) < 0)
        throw new Error("Bank sort buffer changed; manual recovery required");
      if (character.map !== entry.floor) await movement.move(entry.floor);
      await bankStoreFully(entry.slot);
    }
    saveBankSortBuffers([]);
  }
  async function recoverBankSortBeforeWork() {
    // Unlike the sort-buffer recovery below, this used to run unconditionally on
    // every tick regardless of map. A stuck stack buffer (e.g. an incoming item
    // transfer landing in a slot reserved as a transfer buffer) then blocked the
    // whole character everywhere, not just while banking. Scope it the same way.
    if (bankSortMap(character.map)) await bankStackService().recover();
    if (bankSortRecovered || !bankSortMap(character.map)) return;
    if (!bankSortRecoveryFlight) bankSortRecoveryFlight = cleanupBankSortBuffers().then(function() {
      bankSortRecovered = true;
    }).finally(function() { bankSortRecoveryFlight = null; });
    await bankSortRecoveryFlight;
  }
  async function bankSortMove(destination, callback, options) {
    observeBankSortVisit();
    var map = typeof destination === "string" ? destination : destination && (destination.map || destination.to) || character.map;
    if (character.ctype === "merchant" && bankSortVisit && !bankSortMap(map)) {
      await bankStackService().recover();
      await cleanupBankSortBuffers();
      var stackActivity = [];
      try { await finishBankStacks(stackActivity); }
      catch (stackError) {
        if (bankStackService().pending()) throw stackError;
        stackActivity.push({ level: "error", message: "Bank stack cleanup deferred", details: String(stackError.message || stackError) });
      }
      stackActivity.forEach(function(entry) { gatheringStatus(entry.message, entry.level, entry.details); });
      if (!bankSortFlight) bankSortFlight = finishRequestedBankSort().finally(function() { bankSortFlight = null; });
      await bankSortFlight;
      if ((root.__partyBankSortBuffers || []).some(function(slot) { return character.items[slot]; }))
        throw new Error("Bank sort buffer cleanup pending; staying in bank");
    }
    var result = await movement.move(destination, callback, options);
    observeBankSortVisit();
    await recoverBankSortBeforeWork();
    return result;
  }

  var bankSortTypes = [
    "helmet", "chest", "pants", "gloves", "shoes", "cape", "ring", "earring",
    "amulet", "belt", "orb", "weapon", "shield", "offhand", "elixir", "pot",
    "scroll", "material", "exchange", "",
  ];

  function bankSortCategory(item) {
    if (!item) return bankSortTypes.length;
    var definition = G.items[item.name] || {};
    for (var index = 0; index < bankSortTypes.length; index += 1) {
      var type = bankSortTypes[index];
      if (!type || definition.type === type ||
          (type === "offhand" && ["source", "quiver", "misc_offhand"].indexOf(definition.type) >= 0) ||
          (type === "scroll" && ["cscroll", "uscroll", "pscroll", "offering"].indexOf(definition.type) >= 0) ||
          (type === "exchange" && definition.e)) return index;
    }
    return bankSortTypes.length - 1;
  }

  function compareBankItems(first, second) {
    if (!first && !second) return 0;
    if (!first) return 1;
    if (!second) return -1;
    var category = bankSortCategory(first) - bankSortCategory(second);
    if (category) return category;
    var firstDefinition = G.items[first.name] || {}, secondDefinition = G.items[second.name] || {};
    var value = (Number(firstDefinition.gold_value) || Number(firstDefinition.g) || 0) -
      (Number(secondDefinition.gold_value) || Number(secondDefinition.g) || 0);
    if (value) return value;
    if (first.name !== second.name) return first.name < second.name ? -1 : 1;
    return (Number(second.level) || 0) - (Number(first.level) || 0);
  }

  function bankPacksOnCurrentFloor() {
    var definitions = typeof bank_packs !== "undefined" ? bank_packs : (parent.bank_packs || {});
    return Object.keys(character.bank || {}).filter(function (pack) {
      return pack !== "gold" && Array.isArray(character.bank[pack]) &&
        (!definitions[pack] || definitions[pack][0] === character.map);
    }).sort(function (first, second) {
      return Number(first.replace(/\D/g, "")) - Number(second.replace(/\D/g, ""));
    });
  }

  async function consolidateCurrentBankFloor(activity) {
    await finishBankStacks(activity);
  }

  async function sortCurrentBankFloor(activity) {
    if (!character.bank) {
      if (bankSortPass) throw new Error("Bank data unavailable during requested sort");
      return;
    }
    await consolidateCurrentBankFloor(activity);
    if (!await bankSortAuthorization()) return;
    await cleanupBankSortBuffers();
    var signature = bankSortSignature();
    if (bankSortVisit.floors[character.map] === signature) return;
    var packs = bankPacksOnCurrentFloor();
    if (!packs.length) throw new Error("Bank floor data unavailable during sorting");

    var inventorySlots = [];
    for (var inventoryIndex = 0; inventoryIndex < character.items.length; inventoryIndex += 1) {
      if (!character.items[inventoryIndex]) inventorySlots.push(inventoryIndex);
    }
    if (!inventorySlots.length) {
      throw new Error("Bank sorting needs a free merchant inventory slot");
    }
    // One empty inventory slot is a deterministic swap buffer. Rotating several
    // buffers can strand bank items in the merchant's inventory if sorting
    // reaches its safety limit.
    var bufferSlot = inventorySlots[0];

    var bankItems = [], usableLocations = [];
    packs.forEach(function (pack) {
      for (var slot = 0; slot < 42; slot += 1) {
        if (pack === "items1" && slot >= 35) continue;
        usableLocations.push({ pack: pack, slot: slot });
        bankItems.push(character.bank[pack][slot] || null);
      }
    });
    bankItems.sort(compareBankItems);
    var desired = {};
    packs.forEach(function (pack) { desired[pack] = Array(42).fill(null); });
    usableLocations.forEach(function (location, index) {
      desired[location.pack][location.slot] = bankItems[index] || null;
    });
    var operations = 0, limit = Math.max(200, bankItems.length * 3), failure = null;
    try {
      while (operations < limit) {
        await bankSortGuard();
        var carried = character.items[bufferSlot], swap = null;
        for (var p = 0; p < packs.length && !swap; p += 1) {
          var currentPack = packs[p];
          for (var bankSlot = 0; bankSlot < 42; bankSlot += 1) {
            if (currentPack === "items1" && bankSlot >= 35) continue;
            var current = character.bank[currentPack][bankSlot], wanted = desired[currentPack][bankSlot];
            if (!carried) {
              if (current && compareBankItems(current, wanted)) { swap = { pack: currentPack, slot: bankSlot }; break; }
            } else if (!compareBankItems(carried, wanted) && compareBankItems(current, wanted)) {
              swap = { pack: currentPack, slot: bankSlot }; break;
            }
          }
        }
        if (!swap) break;
        rememberBankSortBuffers([bufferSlot], [character.bank[swap.pack][swap.slot]]);
        parent.socket.emit("bank", { operation: "swap", pack: swap.pack, str: swap.slot, inv: bufferSlot });
        operations += 1;
        await new Promise(function (resolve) { setTimeout(resolve, 220); });
      }
      if (operations >= limit) failure = new Error("Bank sorting exceeded its safe operation limit");
    } finally {
      // Never let a failed/incomplete sort walk away carrying an item that was
      // pulled out of the bank solely for use as the sorting buffer.
      if (character.items[bufferSlot]) {
        try { await bankStoreFully(bufferSlot); }
        catch (bufferError) { failure = failure || bufferError; }
      }
      if (!character.items[bufferSlot]) saveBankSortBuffers([]);
    }
    if (failure) throw failure;
    var stillMisplaced = packs.some(function (pack) {
      for (var slot = 0; slot < 42; slot += 1) {
        if (pack === "items1" && slot >= 35) continue;
        if (compareBankItems(character.bank[pack][slot] || null, desired[pack][slot] || null)) return true;
      }
      return false;
    });
    if (stillMisplaced) throw new Error("Bank sorting stopped before every item was placed");
    bankSortVisit.floors[character.map] = bankSortSignature();
    if (operations) {
      activity.push({ level: "success", message: "Sorted " + packs.length + " bank pack" + (packs.length === 1 ? "" : "s") });
      // Publish the final slot order before a short job can leave the bank;
      // otherwise the dashboard may retain the pre-sort snapshot indefinitely.
      try { await request("/status", { method: "POST", body: snapshot() }); }
      catch (_snapshotError) { /* The normal status heartbeat will retry. */ }
    }
  }

  async function goBank(marked, withdrawals, goldTarget, returnLocation) {
    if (banking) return;
    while (stocking) await new Promise(function (resolve) { setTimeout(resolve, 250); });
    banking = true;
    var origin = { map: character.map, x: character.x, y: character.y };
    try {
      await smart_move("bank");
      for (var i = 0; i < marked.length; i += 1) {
        var slot = findItem(marked[i]);
        if (slot >= 0) await bankStoreFully(slot);
      }
      var withdrawn = [];
      for (var w = 0; w < withdrawals.length; w += 1) {
        if (freeInventorySlots() <= 3) break;
        if (String(withdrawals[w].pack || "").indexOf("bankboi:") === 0) continue;
        var bankItem = findBankItem(withdrawals[w].item, withdrawals[w].pack, withdrawals[w].slot);
        if (!bankItem) continue;
        await bank_retrieve(bankItem.pack, bankItem.slot);
        withdrawn.push(withdrawals[w]);
      }
      var targetGold = Number.isInteger(goldTarget) && goldTarget >= 0 ? goldTarget : 0;
      if (character.gold > targetGold) {
        await bank_deposit(character.gold - targetGold);
      } else if (character.gold < targetGold) {
        var desired = targetGold - character.gold;
        var available = character.bank && Number(character.bank.gold) || 0;
        var amount = Math.min(desired, available);
        if (amount > 0) await bank_withdraw(amount);
        if (amount < desired) game_log("Bank has insufficient gold for the " + targetGold + " target", "red");
      }
      game_log("Bank run complete", "#51D2E1");
    } catch (error) {
      game_log("Bank run failed: " + (error.reason || error.message || error), "red");
    } finally {
      try {
        await smart_move(returnLocation || partyLocation || origin);
      } catch (returnError) {
        game_log("Return from bank failed: " + (returnError.reason || returnError.message || returnError), "red");
      }
      banking = false;
      try {
        await request("/bank-complete", {
          method: "POST",
          body: { character: character.name, withdrawn: withdrawn || [] },
        });
      } catch (completeError) {
        game_log("Bank queue release failed: " + (completeError.message || completeError), "red");
      }
    }
  }

  function statusQuantity(entries, name) {
    return (entries || []).reduce(function (total, entry) {
      return total + (entry && entry.item && entry.item.name === name ? (entry.item.q || 1) : 0);
    }, 0);
  }

  async function buyConfirmed(name, amount) {
    amount = Math.max(1, Number(amount) || 1);
    // NPC bulk-buy quantities apply to stackable items. Equipment is delivered
    // one item per request even if a larger quantity is supplied.
    if (!(G.items[name] && G.items[name].s) && amount > 1) {
      for (var unit = 0; unit < amount; unit += 1) await buyConfirmed(name, 1);
      return;
    }
    var before = quantity(name), settled = false, failure = null;
    Promise.resolve(buy(name, amount)).then(function () {
      settled = true;
    }).catch(function (error) {
      settled = true;
      failure = error;
    });
    var deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (quantity(name) >= before + amount) return;
      if (failure) throw failure;
      // A resolved server purchase can precede the inventory proxy update by a
      // tick, so give the proxy a short opportunity to catch up.
      if (settled) {
        await new Promise(function (resolve) { setTimeout(resolve, 150); });
        if (quantity(name) >= before + amount) return;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    if (quantity(name) >= before + amount) return;
    throw new Error("Purchase did not arrive: " + amount + " × " + name);
  }

  function inventoryOperationEntry(item, slot) {
    var pending = item && item.name === "placeholder" && item.p;
    var active = activeUpgrade && activeUpgrade.slot === slot ? activeUpgrade : null;
    var displayItem = pending && pending.name ? (active && active.item || { name: pending.name, level: pending.level || 0 })
      : item ? fingerprint(item) : active && active.item;
    if (!displayItem) return null;
    var entry = { slot: slot, item: displayItem, meta: itemDefinition(displayItem) };
    if (pending && pending.scroll && /^(c?scroll)\d+$/.test(pending.scroll)) {
      entry.operation = { type: pending.scroll.indexOf("cscroll") === 0 ? "compound" : "upgrade",
        fromLevel: Number(pending.level) || 0, toLevel: (Number(pending.level) || 0) + 1,
        chance: typeof pending.chance === "number" ? pending.chance : null,
        sprite: (itemDefinition({ name: "placeholder" }) || {}).sprite || null };
    }
    return entry;
  }

  function normalBankStackFits(item) {
    var limit = Number(G.items[item.name] && G.items[item.name].s) || 1;
    return limit > 1 && Object.keys(character.bank || {}).find(function (pack) {
      return Array.isArray(character.bank[pack]) && character.bank[pack].some(function (entry, slot) {
        return !(pack === "items1" && slot >= 35) && entry && bankStackIdentity(entry) === bankStackIdentity(item) &&
          Number(entry.q || 1) < limit;
      });
    });
  }

  async function mergeIntoNormalBank(slot) {
    var before = character.items[slot] && Number(character.items[slot].q || 1);
    await bankStackService().fill(slot);
    return before > 0 && !character.items[slot];
  }

  async function bankRetrieveConfirmed(pack, slot) {
    var item = character.bank && character.bank[pack] && character.bank[pack][slot];
    if (!item) throw new Error("Bank withdrawal source is missing");
    var identity = bankStackIdentity(item), quantity = Number(item.q || 1);
    function inventoryCount() {
      return character.items.reduce(function (total, entry) {
        return total + (entry && bankStackIdentity(entry) === identity ? Number(entry.q || 1) : 0);
      }, 0);
    }
    var before = inventoryCount();
    await bank_retrieve(pack, slot);
    var deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!character.bank[pack][slot] && inventoryCount() >= before + quantity) return;
      await sleep(100);
    }
    throw new Error("Bank withdrawal was not confirmed: " + item.name);
  }

  async function bankStageConfirmed(inventorySlot, pack, slot) {
    var item = character.items[inventorySlot];
    if (!item || character.bank[pack][slot]) throw new Error("Bank transfer slots changed before deposit");
    var identity = bankStackIdentity(item), quantity = Number(item.q || 1);
    await bank_store(inventorySlot, pack, slot);
    var deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      var staged = character.bank[pack][slot];
      if (!character.items[inventorySlot] && staged && bankStackIdentity(staged) === identity && Number(staged.q || 1) === quantity) return;
      await sleep(100);
    }
    throw new Error("Bank transfer deposit was not confirmed: " + item.name);
  }

  async function runBankboiService(command) {
    banking = true;
    var activity = [], completed = [], deposited = [], relocated = [];
    async function unloadNormalBank() {
      if (!command.unload) return;
      for (var slot = 0; slot < character.items.length; slot += 1) {
        var item = character.items[slot];
        if (!item || (command.protectedItems || []).concat((command.retrievals || []).map(function (r) { return r.item; })).some(function (wanted) { return bankStackIdentity(wanted) === bankStackIdentity(item); })) continue;
        await bankStackService().fill(slot);
        if (!character.items[slot]) {
          relocated.push({ sourceSlot: slot, item: fingerprint(item) });
          continue;
        }
        item = character.items[slot];
        var allowed = await bankStackService().locations();
        var empty = null, merge = null, limit = Number(G.items[item.name] && G.items[item.name].s) || 1;
        Object.keys(character.bank || {}).sort().forEach(function (pack) {
          if (!Array.isArray(character.bank[pack])) return;
          for (var target = 0; target < 42; target += 1) {
            if (!allowed.some(function(location) { return location.pack === pack && location.slot === target; }) || (command.reservedLocations || []).some(function (r) { return r.pack === pack && r.slot === target; })) continue;
            var existing = character.bank[pack][target];
            if (!existing && !empty) empty = { pack: pack, slot: target };
            if (existing && !merge && limit > 1 && bankStackIdentity(existing) === bankStackIdentity(item) && Number(existing.q || 1) + Number(item.q || 1) <= limit)
              merge = { pack: pack, slot: target };
          }
        });
        var destination = merge || empty;
        if (!destination) continue;
        var definitions = typeof bank_packs !== "undefined" ? bank_packs : parent.bank_packs || {};
        var floor = definitions[destination.pack] && definitions[destination.pack][0];
        if (floor && character.map !== floor) await smart_move(floor);
        await waitForBankPack(destination.pack, 10000);
        var current = character.bank[destination.pack][destination.slot];
        if (merge ? !current || bankStackIdentity(current) !== bankStackIdentity(item) || Number(current.q || 1) + Number(item.q || 1) > limit : !!current) continue;
        await bank_store(slot, destination.pack, merge ? undefined : destination.slot);
        var deadline = Date.now() + 2500;
        while (character.items[slot] && Date.now() < deadline) await sleep(100);
        if (character.items[slot]) throw new Error("Bank did not accept " + item.name);
        relocated.push({ sourceSlot: slot, item: fingerprint(item), pack: destination.pack, slot: destination.slot });
      }
      if (character.map && character.map !== "bank") await smart_move("bank");
    }
    function craftDepositLocation() {
      var packs = Object.keys(character.bank || {}).filter(function (pack) { return /^items\d+$/.test(pack); });
      for (var pack of packs) {
        if (!Array.isArray(character.bank[pack])) continue;
        for (var slot = 0; slot < 42; slot += 1) {
          if (pack === "items1" && slot >= 35) continue;
          if (!character.bank[pack][slot]) return { pack: pack, slot: slot };
        }
      }
      return null;
    }
    try {
      if (command.provision) {
        await smart_move("potions");
        var equipmentSlots = Object.keys(character.slots || {});
        for (var e = 0; e < equipmentSlots.length; e += 1) {
          if (character.slots[equipmentSlots[e]]) await unequip(equipmentSlots[e]);
        }
        for (var sellSlot = 0; sellSlot < character.items.length; sellSlot += 1) {
          if (character.items[sellSlot]) await sell(sellSlot, character.items[sellSlot].q || 1);
        }
      }
      await smart_move("bank");
      // smart_move can resolve on the map transition before the bank proxy is
      // hydrated, especially immediately after swapping to a bankboi. Never
      // index the reserved staging pane until its server snapshot exists.
      await waitForBankPack("items1", 10000);
      if (command.provision && character.gold > 0) await bank_deposit(character.gold);
      await unloadNormalBank();
      for (var storedSlot = 0; storedSlot < character.items.length; storedSlot += 1) {
        var stored = character.items[storedSlot];
        if (!stored || (command.retrievals || []).some(function (r) { return sameItem(stored, r.item); }) ||
          (command.protectedItems || []).some(function (wanted) { return bankStackIdentity(wanted) === bankStackIdentity(stored); })) continue;
        var home = command.stackHomes && command.stackHomes[bankStackIdentity(stored)];
        if (!home || home.owner === character.name || home.room < Number(stored.q || 1)) continue;
        if (home.owner === "bank") {
          if (!await mergeIntoNormalBank(storedSlot)) continue;
        } else {
          var stagingSlot = -1;
          for (var stage = 35; stage < 42; stage += 1) if (!character.bank.items1[stage]) { stagingSlot = stage; break; }
          if (stagingSlot < 0) break;
          await bankStageConfirmed(storedSlot, "items1", stagingSlot);
        }
        home.room -= Number(stored.q || 1);
      }
      for (var index = 0; index < (command.requests || []).length; index += 1) {
        var requestItem = command.requests[index];
        var staged = character.bank[requestItem.pack] && character.bank[requestItem.pack][requestItem.slot];
        // Never use a fallback search: it can steal the normal bank's stack
        // after the staging slot was moved or consumed.
        if (!staged || bankStackIdentity(staged) !== bankStackIdentity(requestItem.item)) {
          completed.push(requestItem.id); continue;
        }
        var stackLimit = Number(G.items[staged.name] && G.items[staged.name].s) || 1;
        var mergeFits = stackLimit > 1 && character.items.some(function (item) {
          return item && bankStackIdentity(item) === bankStackIdentity(staged) &&
            Number(item.q || 1) + Number(staged.q || 1) <= stackLimit;
        });
        if (freeInventorySlots() <= 0 && !mergeFits) break;
        var bankHome = normalBankStackFits(staged);
        var beforeSlots = character.items.map(function (item) { return item && JSON.stringify(item); });
        await bankRetrieveConfirmed(requestItem.pack, requestItem.slot);
        if (bankHome) {
          var received = character.items.findIndex(function (item, slot) {
            return item && bankStackIdentity(item) === bankStackIdentity(staged) && JSON.stringify(item) !== beforeSlots[slot];
          });
          if (received >= 0) await mergeIntoNormalBank(received);
        }
        completed.push(requestItem.id);
      }
      await unloadNormalBank();
      for (var depositIndex = 0; depositIndex < (command.retrievals || []).length; depositIndex += 1) {
        var retrieval = command.retrievals[depositIndex], inventorySlot = findItem(retrieval.item), reserve = -1;
        for (var candidate = 35; candidate < 42; candidate += 1) if (!character.bank.items1[candidate]) { reserve = candidate; break; }
        var destination = retrieval.craftJobId && craftDepositLocation() ||
          (reserve >= 0 ? { pack: "items1", slot: reserve } : null);
        if (inventorySlot < 0 || !destination) break;
        var definitions = typeof bank_packs !== "undefined" ? bank_packs : parent.bank_packs || {};
        var floor = definitions[destination.pack] && definitions[destination.pack][0];
        if (floor && character.map !== floor) await smart_move(floor);
        await waitForBankPack(destination.pack, 10000);
        var depositedItem = fingerprint(character.items[inventorySlot]);
        await bankStageConfirmed(inventorySlot, destination.pack, destination.slot);
        deposited.push({ request: retrieval, pack: destination.pack, slot: destination.slot, item: depositedItem });
        if (floor && floor !== "bank") await smart_move("bank");
      }
      try { if (!relocated.length && !deposited.length) await sortCurrentBankFloor(activity); } catch (sortError) {
        activity.push({ level: "error", message: "Bankboi bank sorting failed", details: String(sortError.reason || sortError.message || sortError) });
      }
      var sortable = character.items.map(function (item, slot) { return item ? { item: item, slot: slot } : null; }).filter(Boolean);
      sortable.sort(function (a, b) { return compareBankItems(a.item, b.item); });
      for (var target = 0; target < sortable.length; target += 1) {
        var wanted = fingerprint(sortable[target].item);
        if (sameItem(character.items[target], wanted)) continue;
        var sourceSlot = character.items.findIndex(function (item, slot) { return slot >= target && sameItem(item, wanted); });
        if (sourceSlot >= 0 && typeof swap === "function") { swap(sourceSlot, target); await sleep(120); }
      }
      await request("/bankboi/complete", { method: "POST", body: {
        character: character.name, commandId: command.id, completed: completed, deposited: deposited, relocated: relocated, bank: bankSnapshot(),
        items: character.items.map(function (item, slot) { return item ? { slot: slot, item: fingerprint(item), meta: itemDefinition(item) } : null; }),
        slots: Object.keys(character.slots || {}).reduce(function (out, key) {
          if (character.slots[key]) out[key] = { item: fingerprint(character.slots[key]), meta: itemDefinition(character.slots[key]) }; return out;
        }, {}), gold: character.gold, activity: activity,
      }});
    } catch (error) {
      await request("/bankboi/complete", { method: "POST", body: { character: character.name,
        commandId: command.id, error: String(error.reason || error.message || error), activity: activity,
        completed: completed, deposited: deposited, relocated: relocated, bank: bankSnapshot(),
        items: character.items.map(function (item, slot) { return item ? { slot: slot, item: fingerprint(item), meta: itemDefinition(item) } : null; }),
      } });
    } finally {
      banking = false;
    }
  }

  async function verifyMerchantItemMarks() {
    var active = root.__merchantActiveJob;
    if (character.ctype !== "merchant" || !active || !active.jobId) return;
    await request("/merchant/checkpoint", { method: "POST", body: { jobId: active.jobId, protectionOnly: true } });
  }

  function productionJournalKey() { return "party-production:" + character.name; }
  async function finishProductionJournal(journal) {
    await request("/merchant/production", {method:"POST",body:{character:character.name,action:journal.request && journal.request.requestId && !journal.issued ? "abort-manual" : "complete",id:journal.id,success:journal.success}});
    root.localStorage.removeItem(productionJournalKey());
  }
  async function recoverProductionJournal(slots) {
    var journal = JSON.parse(root.localStorage.getItem(productionJournalKey()) || "null");
    if (!journal) return;
    if (journal.phase === "complete") return finishProductionJournal(journal);
    if (journal.request && journal.request.requestId && !journal.issued) return finishProductionJournal(journal);
    if (journal.phase === "prepared") {
      await request("/merchant/production", {method:"POST",body:journal.request});
      journal.success=false;
    } else {
      if (character.q && (character.q.upgrade || character.q.compound)) throw Error("Production recovery waiting for game operation");
      if (luckyUpgradeService && luckyUpgradeService.pending()) await luckyUpgradeService.recover();
      else if (character.ctype === "merchant" && root.localStorage.getItem("party-lucky-upgrade:" + character.name)) await merchantLuckyUpgrade().recover();
      var live = character.items[journal.slots[0]];
      if (live && live.name === journal.item.name && (live.level || 0) === (journal.item.level || 0)+1) journal.success=true;
      else if (!live || JSON.stringify(fingerprint(live)) === JSON.stringify(journal.item)) journal.success=false;
      // An item that matches neither the upgraded nor the original fingerprint is a
      // genuine anomaly worth surfacing, but only for attempts touching that same
      // slot; leaving it pending here (instead of throwing) lets an unrelated
      // upgrade/compound proceed rather than being blocked forever by a stale entry.
      else if (slots && slots.indexOf(journal.slots[0]) < 0) return;
      else throw Error("Production outcome needs review before another attempt: " + journal.item.name);
    }
    journal.phase="complete";root.localStorage.setItem(productionJournalKey(),JSON.stringify(journal));
    await finishProductionJournal(journal);
  }
  async function verifyProductionProtection(slots) {
    var active = root.__merchantActiveJob;
    if (!active || !active.jobId) return;
    var result = await request("/merchant/checkpoint", {method:"POST",body:{jobId:active.jobId,protectionOnly:true}});
    if (!result || !result.craftProtection || result.craftProtection.error) throw Error("Craft reservations unavailable; automatic production deferred");
    var entries=character.items.map(function(item,slot){return item ? {item:item,slot:slot,craftLocation:"inventory:"+character.name} : null;});
    var available=globalThis.partyAvailableCraftStock(entries,result.craftProtection);
    if (!slots.every(function(slot){return available[slot] && !available[slot].item.l;})) throw Error("Item reserved for crafting; automatic production deferred");
  }
  async function trackedProduction(kind, slots, automatic, operation, offeringAttempt) {
    if (character.ctype !== "merchant") return operation();
    await recoverProductionJournal(slots);
    await yieldMerchantForEvent();
    if (automatic) await verifyProductionProtection(slots);
    var item=fingerprint(character.items[slots[0]]), id=character.name+":"+Date.now()+":"+Math.random().toString(36).slice(2);
    if (offeringAttempt && offeringAttempt.requestId) id="manual-offering:"+offeringAttempt.requestId;
    var body=Object.assign({character:character.name,id:id,kind:kind,item:item,automatic:automatic}, offeringAttempt || {});
    var journal={id:id,item:item,slots:slots,phase:"prepared",request:body};
    root.localStorage.setItem(productionJournalKey(),JSON.stringify(journal));
    try {
      var admission = await request("/merchant/production",{method:"POST",body:body});
      if (admission && admission.attempt && admission.attempt.completed) {
        root.localStorage.removeItem(productionJournalKey()); return {success:false,alreadyAttempted:true};
      }
    }
    catch(error) { if ((error.partyRequest && error.partyRequest.status === 409) || /quota completed|rule removed|Required upgrade offering|Manual upgrade request|Upgrade offering rule changed/i.test(String(error))) root.localStorage.removeItem(productionJournalKey()); throw error; }
    journal.phase="running";root.localStorage.setItem(productionJournalKey(),JSON.stringify(journal));
    var result, failure;
    try { result=await operation(); } catch(error) { failure=error; }
    if (body.requestId) journal.issued=!!JSON.parse(root.localStorage.getItem(productionJournalKey()) || "{}").issued;
    var live=character.items[slots[0]];
    if (failure && /timed out|uncertain|interrupted|recovery/i.test(String(failure.message || failure))) throw failure;
    journal.success=!!live && live.name===item.name && (live.level || 0)===(item.level || 0)+1;
    journal.phase="complete";root.localStorage.setItem(productionJournalKey(),JSON.stringify(journal));
    await finishProductionJournal(journal);
    if (failure) throw failure;
    return result;
  }
  async function compoundConfirmed(first, second, third, scrollSlot, automatic) {
    return trackedProduction("compound",[first,second,third],automatic,function(){return observedCompoundConfirmed(first,second,third,scrollSlot);});
  }
  async function upgradeConfirmed(itemSlot, scrollSlot, expectedName, expectedLevel, automatic, offeringAttempt) {
    if (character.items[scrollSlot] && !/^scroll[0-9]+$/.test(character.items[scrollSlot].name))
      return observedUpgradeConfirmed(itemSlot,scrollSlot,expectedName,expectedLevel);
    return trackedProduction("upgrade",[itemSlot],automatic,function(){return observedUpgradeConfirmed(itemSlot,scrollSlot,expectedName,expectedLevel,offeringAttempt);},offeringAttempt);
  }
  async function observedCompoundConfirmed(first, second, third, scrollSlot) {
    await verifyMerchantItemMarks();
    var before = [first, second, third, scrollSlot].map(function (slot) {
      return JSON.stringify(fingerprint(character.items[slot]));
    });
    var settled = false, result, failure = null;
    Promise.resolve(compound(first, second, third, scrollSlot)).then(function (value) {
      settled = true;
      result = value;
    }).catch(function (error) {
      settled = true;
      failure = error;
    });
    var deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (settled) return result;
      var changed = [first, second, third, scrollSlot].some(function (slot, index) {
        return JSON.stringify(fingerprint(character.items[slot])) !== before[index];
      });
      if (changed && !(character.q && character.q.compound)) {
        // The authoritative inventory has completed the operation even when
        // the client deferred promise missed its response event.
        await new Promise(function (resolve) { setTimeout(resolve, 200); });
        if (failure) throw failure;
        return result;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    throw new Error("Compound operation timed out");
  }

  async function observedUpgradeConfirmed(itemSlot, scrollSlot, expectedName, expectedLevel, offeringAttempt) {
    var intendedScroll = character.items[scrollSlot] && character.items[scrollSlot].name;
    await verifyMerchantItemMarks();
    if (character.ctype !== "merchant") return upgradeAtSlotConfirmed(itemSlot, scrollSlot, expectedName, expectedLevel);
    var offeringSlot;
    if (offeringAttempt && offeringAttempt.offering) {
      var job = root.__merchantActiveJob;
      if (!job || !job.jobId) throw Error("Offering upgrade requires an active merchant job");
      offeringSlot = carriedOffering(await upgradeOfferingCheckpoint(job), offeringAttempt.offering);
    }
    if (offeringSlot !== undefined && offeringSlot < 0) throw Error("Required upgrade offering missing");
    // Checkpoints yield to inventory updates. Do not use a scroll index that
    // has since moved or was consumed by the preceding step.
    if (intendedScroll) scrollSlot = findInventoryItemByName(intendedScroll);
    var selectedUpgradeSlot = Number.isInteger(luckyUpgradeSlot) && luckyUpgradeSlot >= 0 && luckyUpgradeSlot < 42
      ? luckyUpgradeSlot : luckySlotTracking().select();
    var outcome = await merchantLuckyUpgrade().run(itemSlot, scrollSlot, selectedUpgradeSlot, function (slot, scroll, offering) {
      luckySlotTracking().begin();
      return upgradeAtSlotConfirmed(slot, scroll, expectedName, expectedLevel, offering);
    }, offeringSlot);
    return outcome && Object.assign({}, outcome, {slot: itemSlot});
  }

  function merchantLuckyUpgrade() {
    if (luckyUpgradeService) return luckyUpgradeService;
    var key = "party-lucky-upgrade:" + character.name;
    luckyUpgradeService = root.createPartyLuckyUpgrade({
      item: function (slot) { return fingerprint(character.items[slot]); },
      busy: function () { return !!(character.q && (character.q.upgrade || character.q.compound)) || character.items.some(function (item) { return item && item.name === "placeholder"; }); },
      swap: function (a, b) { return swap(a, b); },
      read: function () { return JSON.parse(root.localStorage.getItem(key) || "null"); },
      write: function (value) { if (value) root.localStorage.setItem(key, JSON.stringify(value)); else root.localStorage.removeItem(key); },
      sleep: sleep, now: Date.now, current: runtimeCurrent,
      log: function (slot) {
        var message = "Using upgrade slot " + slot + " (" + (slot === luckyUpgradeSlot ? "verified" : "lucky-slot search") + ", inventory position " + (slot + 1) + ")";
        game_log(message, "#facc15");
        var job = root.__merchantActiveJob;
        if (job) request("/merchant/activity", {method:"POST",body:{character:character.name,jobId:job.jobId,
          message:message,level:"info",details:{executor:character.name,luckySlot:slot,actualUpgradeSlot:slot}}}).catch(function () {});
      }
    });
    return luckyUpgradeService;
  }

  async function upgradeAtSlotConfirmed(itemSlot, scrollSlot, expectedName, expectedLevel, offeringSlot) {
    var beforeItem = fingerprint(character.items[itemSlot]);
    var before = JSON.stringify(beforeItem);
    expectedName = expectedName || (beforeItem && beforeItem.name);
    expectedLevel = Number.isFinite(Number(expectedLevel)) ? Number(expectedLevel) :
      (Number(beforeItem && beforeItem.level) || 0) + 1;
    activeUpgrade = { slot: itemSlot, item: beforeItem,
      targetLevel: expectedLevel };
    try {
      var settled = false, result, failure = null, operationEndedAt = 0;
      if (offeringSlot !== undefined) {
        var pendingProduction = JSON.parse(root.localStorage.getItem(productionJournalKey()) || "null");
        if (pendingProduction) {
          pendingProduction.issued=true;
          pendingProduction.offeringBefore={slot:offeringSlot,item:fingerprint(character.items[offeringSlot])};
          root.localStorage.setItem(productionJournalKey(),JSON.stringify(pendingProduction));
        }
      }
      Promise.resolve(upgrade(itemSlot, scrollSlot, offeringSlot)).then(function (value) {
        settled = true; result = value;
      }).catch(function (error) { settled = true; failure = error; });
      var deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        var liveItem = character.items[itemSlot];
        // The placeholder is itself authoritative evidence of pending work;
        // q and inventory proxies need not arrive in the same update.
        var queueActive = !!(character.q && character.q.upgrade) || !!(liveItem && liveItem.name === "placeholder");
        if (!queueActive && liveItem && liveItem.name === expectedName &&
            (Number(liveItem.level) || 0) === expectedLevel) {
          return { result: result, slot: itemSlot, item: fingerprint(liveItem),
            fromLevel: Number(beforeItem && beforeItem.level) || 0, toLevel: expectedLevel };
        }
        if (!queueActive && settled && result && result.success === false &&
            (result.num === undefined || Number(result.num) === itemSlot)) {
          if (liveItem && liveItem.name === expectedName)
            return { success: false, slot: itemSlot, item: fingerprint(liveItem) };
          if (!liveItem) { var destroyed = new Error(expectedName + " was destroyed"); destroyed.reason = "upgrade_destroyed"; throw destroyed; }
        }
        // Promise settlement and queue disappearance are not proof of success.
        // Allow the inventory proxy a short synchronization window, then fail
        // unless this exact slot contains the requested next level.
        if (!queueActive && (settled || failure || JSON.stringify(fingerprint(liveItem)) !== before)) {
          if (!operationEndedAt) operationEndedAt = Date.now();
          if (Date.now() - operationEndedAt >= 1500) {
            if (failure) throw failure;
            if (!liveItem) { var missing = new Error(expectedName + " was destroyed"); missing.reason = "upgrade_destroyed"; throw missing; }
            var confirmationError = new Error("Upgrade result was not confirmed in slot " + itemSlot +
              ": expected " + expectedName + " +" + expectedLevel + ", found " +
              (liveItem ? liveItem.name + " +" + (Number(liveItem.level) || 0) : "empty"));
            confirmationError.reason = "upgrade_result_not_confirmed";
            throw confirmationError;
          }
        } else {
          operationEndedAt = 0;
        }
        await new Promise(function (resolve) { setTimeout(resolve, 100); });
      }
      throw new Error("Upgrade operation timed out");
    } finally {
      activeUpgrade = null;
    }
  }

  async function pursueMerchantTarget(name, timeout, readStatus) {
    var deadline = Date.now() + timeout, owner = lastCommand, revision = navigationIntent.revision;
    var route = null, routePending = false, routeAt = 0, routeTargetMap = null, status = null, checkedAt = -Infinity, moving = false;
    var progressAt = Date.now(), progressX = character.x, progressY = character.y, progressMap = character.map;
    var progressDistance = Infinity, recoveries = 0, forceSmartUntil = 0, phase = "waiting-for-target", routeError = null;
    function current() { return runtimeCurrent() && owner === lastCommand && revision === navigationIntent.revision; }
    function travelLeg(destination) {
      if (typeof G === "undefined" || !G.maps) return { map: destination.map };
      // Find the map itinerary cheaply, then ask the native pathfinder to
      // approach only the chosen exit on the current map. Cross it explicitly.
      var queue = [{ map: character.map, first: null }], seen = {};
      seen[character.map] = true;
      for (var index = 0; index < queue.length; index++) {
        var entry = queue[index], map = G.maps[entry.map];
        if (!map) continue;
        var exits = (map.doors || []).filter(function(door){return door[8] !== "complicated";})
          .map(function(door){return {map:door[4],spawn:door[5] || 0,point:map.spawns && map.spawns[door[6]] || [door[0],door[1]]};});
        var transporter = (map.npcs || []).find(function(npc){return npc.id === "transporter";});
        if (transporter) {
          var places = G.npcs && G.npcs.transporter && G.npcs.transporter.places || {};
          Object.keys(places).forEach(function(name){exits.push({map:name,spawn:places[name],point:transporter.position});});
        }
        for (var i = 0; i < exits.length; i++) {
          var exit = exits[i], next = G.maps[exit.map], spawn = next && next.spawns && next.spawns[exit.spawn];
          if (!spawn || seen[exit.map] || next.instance || next.event) continue;
          seen[exit.map] = true;
          var first = entry.first || { map: entry.map, x: exit.point[0], y: exit.point[1], to: exit.map, spawn: exit.spawn };
          if (exit.map === destination.map) return first;
          queue.push({map:exit.map,first:first});
        }
      }
      return { map: destination.map };
    }
    try {
      while (Date.now() < deadline) {
        if (!current()) throw new Error("interrupted");
        if (merchantAnniversaryWorkReserved()) throw new Error("merchant_anniversary_reserved");
        if (character.rip) throw new Error("Merchant died during rendezvous with " + name);
        if (readStatus && Date.now() - checkedAt >= 1000) {
          status = await anniversaryWithTimeout(readStatus(), Math.min(5000, Math.max(1, deadline - Date.now())), "Merchant target status");
          checkedAt = Date.now(); if (!current()) throw new Error("interrupted");
        }
        var fresh = status && Date.now() - status.seenAt <= 15000;
        if (fresh && status.server && status.server.replace(/^SR_/, "") !== reunionRealm().replace(/^SR_/, ""))
          throw new Error("merchant job failed: wrong realm (target was on " + status.server.replace(/^SR_/, "").replace(/^(US|EU|ASIA)/, "$1 ") + ")");
        var player = get_player(name);
        if (fresh && player && (status.map !== (player.map || character.map) ||
            status.in != null && player.in != null && status.in !== player.in)) player = null;
        var visible = player && player.visible !== false && !player.rip && (!player.map || player.map === character.map) &&
          (player.in == null || character.in == null || player.in === character.in);
        var distance = visible ? Math.hypot(player.x - character.x, player.y - character.y) : Infinity;
        if (distance <= 180) return player;
        var destination = visible ? { map: character.map, x: player.x, y: player.y } : fresh && !status.rip ? status : null;
        var targetDistance = destination && destination.map === character.map ? Math.hypot(destination.x-character.x,destination.y-character.y) : Infinity;
        if (character.map !== progressMap || Math.hypot(character.x-progressX,character.y-progressY) >= 20 ||
            Number.isFinite(targetDistance) && progressDistance-targetDistance >= 20) {
          progressAt=Date.now(); progressX=character.x; progressY=character.y; progressMap=character.map; progressDistance=targetDistance;
        }
        // Path calculation is stationary work. Give it a separate budget;
        // the movement watchdog must not repeatedly cancel an unfinished BFS.
        var searching = routePending && typeof smart !== "undefined" && smart.moving && !smart.found;
        if (searching) {
          phase = "pathfinding";
          progressAt = Date.now();
          if (Date.now()-routeAt >= 45000) throw new Error(name + " rendezvous route timed out (pathfinding)");
        }
        if (moving && !searching && Date.now()-progressAt >= 10000) {
          if (recoveries >= 2) throw new Error(name + " rendezvous timed out (no progress)");
          await stop("smart"); if (!current()) throw new Error("interrupted");
          await stop("move"); if (!current()) throw new Error("interrupted");
          recoveries++; route=null; routePending=false; moving=false; forceSmartUntil=Date.now()+10000; progressAt=Date.now();
        }
        if (Date.now() >= forceSmartUntil && visible && distance <= 600 && can_move_to(player.x,player.y)) {
          if (route) { route=null; routePending=false; await stop("smart"); if (!current()) throw new Error("interrupted"); }
          phase="direct"; move(player.x,player.y); moving=true;
        } else if (destination) {
          // A local leg may use a transporter shortcut through another map.
          // Let that owned route return to its endpoint instead of replacing it
          // with a new itinerary from the intermediate map on every heartbeat.
          if (routePending && route && character.map !== route.map && destination.map === routeTargetMap) {
            await new Promise(function(resolve){setTimeout(resolve,200);});
            continue;
          }
          // Solve map transitions separately from the moving recipient's exact
          // position, just as gathering travel does. Do not replan a running
          // cross-map leg because the recipient moved within that map.
          var crossMap = destination.map !== character.map;
          var nextRoute = crossMap ? travelLeg(destination) : { map: destination.map, x: destination.x, y: destination.y };
          if (nextRoute.to && Math.hypot(character.x-nextRoute.x,character.y-nextRoute.y) <= 20) {
            route=null; routePending=false;
            await stop("smart"); if (!current()) throw new Error("interrupted");
            await stop("move"); if (!current()) throw new Error("interrupted");
            phase="transport"; moving=true;
            await anniversaryWithTimeout(transport(nextRoute.to,nextRoute.spawn),8000,"Merchant doorway transport");
            if (!current()) throw new Error("interrupted");
            var crossedBy=Math.min(deadline,Date.now()+8000);
            while(character.map===nextRoute.map && Date.now()<crossedBy) {
              await new Promise(function(resolve){setTimeout(resolve,200);});
              if (!current()) throw new Error("interrupted");
            }
            if(character.map===nextRoute.map)throw new Error("Merchant doorway transport did not reach " + nextRoute.to);
            progressAt=Date.now();
            continue;
          }
          if (!route || !routePending && Date.now()-routeAt >= 2000 || Date.now()-routeAt >= 2000 &&
              (route.map !== nextRoute.map || route.to !== nextRoute.to || !crossMap && !searching &&
                (route.x == null || Math.hypot(route.x-nextRoute.x,route.y-nextRoute.y)>160))) {
            if (route || moving) { await stop("smart"); if (!current()) throw new Error("interrupted"); await stop("move"); if (!current()) throw new Error("interrupted"); }
            phase="smart"; route=nextRoute; routeTargetMap=destination.map; routeAt=Date.now(); routePending=true;
            Promise.resolve(smart_move(route)).catch((function(started){return function(error){
              if(route===started) routeError=String(error && (error.reason || error.message) || error);
            };})(route)).finally((function(started){return function(){if(route===started)routePending=false;};})(route));
            moving=true;
          }
        }
        await new Promise(function(resolve){setTimeout(resolve,200);});
      }
      throw new Error(name + " rendezvous timed out");
    } catch(error) {
      error.details={target:name,merchant:{map:character.map,x:character.x,y:character.y},destination:status ? {map:status.map,x:status.x,y:status.y} : route,
        phase:phase,recoveries:recoveries,routeError:routeError,pauseReason:String(error.message || error)};
      throw error;
    } finally {
      if(current() && moving){try{await stop("smart");}catch(_){} if(current()){try{await stop("move");}catch(_){}}}
      if(!current())throw new Error("interrupted");
    }
  }

  async function waitForPlayer(name, timeout) {
    if (character.ctype === "merchant") return pursueMerchantTarget(name, timeout || 45000);
    var deadline = Date.now() + (timeout || 45000), player, owner = lastCommand,
      revision = navigationIntent.revision, approachPending = false;
    while (Date.now() < deadline) {
      if (!runtimeCurrent() || owner !== lastCommand || navigationIntent.revision !== revision) throw new Error("interrupted");
      player = get_player(name);
      if (player && Math.hypot(Number(player.x) - Number(character.x),
          Number(player.y) - Number(character.y)) <= 300) return player;
      if (player && !character.moving && !approachPending) {
        approachPending = true;
        try {
          Promise.resolve(xmove(Number(player.x), Number(player.y))).catch(function () {}).finally(function () { approachPending = false; });
        } catch (_transferApproachError) { approachPending = false; }
      }
      await new Promise(function (resolve) { setTimeout(resolve, 500); });
    }
    throw new Error(name + " did not become reachable");
  }

  function freeInventorySlots() {
    var inventorySize = Number(character.isize) || character.items.length;
    var free = 0;
    for (var slot = 0; slot < inventorySize; slot += 1) if (!character.items[slot]) free += 1;
    return free;
  }

  function purchasePreservesLogisticsReserve(item, quantity) {
    var remaining = Math.max(1, Number(quantity) || 1);
    var stackLimit = Number(item && G.items[item.name] && G.items[item.name].s) || 1;
    if (stackLimit > 1) character.items.forEach(function (owned) {
      if (!owned || !sameItem(owned, item) || remaining <= 0) return;
      remaining -= Math.max(0, stackLimit - (Number(owned.q) || 1));
    });
    var requiredSlots = remaining > 0 ? Math.ceil(remaining / stackLimit) : 0;
    return freeInventorySlots() - requiredSlots >= 3;
  }

  async function requestMerchantCleanout() {
    if (character.ctype === "merchant" || Date.now() - lastCleanoutRequestAt < 10000) return;
    lastCleanoutRequestAt = Date.now();
    try {
      await request("/merchant/cleanout", { method: "POST", body: { character: character.name } });
      game_log("Inventory low; merchant cleanout queued. Looting continues.", "#f0b429");
    } catch (error) {
      lastCleanoutRequestAt = 0;
      throw error;
    }
  }

  function eligibleDepartureChests() {
    return Object.keys(parent.chests||{}).filter(function(id){
      var c=parent.chests[id];
      // Cached chests can be on other maps or far beyond this encounter.
      // Collect within the 400-unit gold-bonus radius, regardless of bag space.
      return c && !c.to_delete && (!c.map || c.map===character.map) &&
        (c.in==null || String(c.in)===String(character.in)) &&
        Number.isFinite(c.x) && Number.isFinite(c.y) &&
        Math.hypot(c.x-character.x,c.y-character.y)<=400;
    });
  }
  async function smartLoot(eligible) {
    var local=eligibleDepartureChests();
    var chests = Array.isArray(eligible) ? eligible.filter(function(id){return local.indexOf(id)>=0;}) : local;
    if (!chests.length) {
      root.partyLootStatus={at:Date.now(),map:character.map,in:character.in,eligible:0,pending:false,error:null};
      return true;
    }
    if (Date.now() - lastLootAt < 250) return false;
    lastLootAt = Date.now();
    // Rotate past failures as well as successes: an item chest that cannot be
    // collected must not starve later chests containing only gold.
    var start=(chests.indexOf(lastLootChest)+1)%chests.length;
    chests=chests.slice(start).concat(chests.slice(0,start));
    var capacityBlocked=!!(root.partyLootStatus && root.partyLootStatus.capacityBlocked && freeInventorySlots()<=3);
    var progress=root.partyLootStatus={at:lastLootAt,map:character.map,in:character.in,eligible:chests.length,pending:true,error:null,capacityBlocked:capacityBlocked};
    progress.chests=chests.slice(0,8).map(function(id){var c=parent.chests[id]||{};return {id:id,map:c.map,in:c.in,x:c.x,y:c.y,items:c.items,skin:c.skin,deleted:!!c.to_delete,retryAt:lootRetryAt[id]||0};});
    Object.keys(lootRetryAt).forEach(function(id){if(!parent.chests[id])delete lootRetryAt[id];});
    chests=chests.filter(function(id){return !(lootRetryAt[id]>lastLootAt);});
    if(!chests.length){progress.error='waiting to retry rejected chests';return false;}
    // Passing a chest id bypasses loot()'s client inventory-capacity
    // guard. The server then checks the actual items, including whether they
    // merge into an existing stack, and distributes them to party members who
    // can carry them.
    if (freeInventorySlots() <= 3) requestMerchantCleanout().catch(function (error) {
      game_log("Could not queue merchant cleanout: " + (error.message || error), "red");
    });
    for (var i = 0; i < Math.min(chests.length, 2); i += 1) {
      lastLootChest=chests[i];
      try {
        var result=await loot(chests[i]);
        if(result && result.success===false) throw result;
        delete lootRetryAt[chests[i]];
      }
      catch (error) {
        var reason = error && (error.reason || error.message || error);
        progress.error=String(reason);
        if (["cooldown", "loot_no_space", "loot_failed", "openning", "safety", "chest_not_found"].indexOf(reason) < 0) throw error;
        lootRetryAt[chests[i]]=Date.now()+(['cooldown','openning'].indexOf(reason)>=0?250:reason==='loot_failed'?30000:5000);
        if (reason === "loot_no_space") { progress.capacityBlocked=true; requestMerchantCleanout().catch(function () {}); }
        if (Array.isArray(eligible) && reason !== 'chest_not_found') throw error;
      }
    }
    progress.eligible=eligibleDepartureChests().length;
    progress.pending=progress.eligible>0;
    return true;
  }

  function itemQuantity(item) {
    return item ? (Number(item.q) || 1) : 0;
  }

  function inventoryAmount(wanted) {
    return character.items.reduce(function (total, item) {
      return total + (sameItem(item, wanted) ? itemQuantity(item) : 0);
    }, 0);
  }

  async function rendezvous(jobId, name) {
    return pursueMerchantTarget(name, 120000, async function () {
      var job = await request("/merchant/job/" + jobId + "?target=" + encodeURIComponent(name));
      return job.targetStatus;
    });
  }

  async function merchantSendItem(name, slot, quantity) {
    if (character.ctype === "merchant") await waitForPlayer(name, 10000);
    return send_item(name, slot, quantity);
  }

  var merchantLuckScanWorking = false;

  function luckRemaining(player) {
    var buff = player && player.s && player.s.mluck;
    if (!buff || String(buff.f || buff.source || "") !== String(character.name)) return 0;
    return typeof buff.ms === "number" ? Math.max(0, buff.ms) : 0;
  }

  function hasStrongMerchantLuck(player) {
    var buff = player && player.s && player.s.mluck;
    // `strong` prevents a different merchant from overwriting the owning
    // merchant's buff. It must not prevent GoldMajesty refreshing its own.
    return !!(buff && buff.strong && String(buff.f || buff.source || "") !== String(character.name));
  }

  async function castMerchantLuck(player, refreshBelowMs) {
    if (!player || (player.ctype === "merchant" && player.name !== character.name) || player.rip) return false;
    // A strong mluck was cast by a merchant belonging to the same account as
    // its target and cannot be improved/overwritten by us. Leave it alone
    // until the server removes the condition.
    if (hasStrongMerchantLuck(player)) return false;
    if (luckRemaining(player) > refreshBelowMs) return false;
    var dx = Number(player.x) - Number(character.x), dy = Number(player.y) - Number(character.y);
    if (Math.hypot(dx, dy) > 200) return false;
    // A party itinerary can reach the next member before mluck's short
    // cooldown clears. Wait here instead of silently skipping that member.
    var readyDeadline = Date.now() + 5000;
    while (Date.now() < readyDeadline && (is_on_cooldown("mluck") || !can_use("mluck")))
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    if (is_on_cooldown("mluck") || !can_use("mluck")) return false;
    await use_skill("mluck", player);
    return true;
  }

  async function castLuckOnVisiblePlayers(refreshBelowMs, limit) {
    if (character.ctype !== "merchant" || character.level < 40 || merchantLuckScanWorking) return [];
    merchantLuckScanWorking = true;
    var recipients = [];
    try {
      var partyNames = {};
      partyPositions.forEach(function (member) { if (member && member.name) partyNames[member.name] = true; });
      var nearby = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
        .filter(function (entity) {
          return entity && entity.type === "character" && entity.name !== character.name &&
            entity.ctype !== "merchant" && !entity.rip &&
            Math.hypot(Number(entity.x) - Number(character.x), Number(entity.y) - Number(character.y)) <= 200;
        }).sort(function (a, b) {
          var partyPriority = (partyNames[a.name] ? 0 : 1) - (partyNames[b.name] ? 0 : 1);
          return partyPriority || luckRemaining(a) - luckRemaining(b);
        });
      for (var i = 0; i < nearby.length && recipients.length < limit; i += 1) {
        try {
          if (await castMerchantLuck(nearby[i], refreshBelowMs)) {
            recipients.push(nearby[i].name);
            await new Promise(function (resolve) { setTimeout(resolve, 125); });
          }
        } catch (error) {
          var reason = error && (error.reason || error.message || error);
          if (["cooldown", "too_far", "not_found", "already"].indexOf(reason) < 0)
            game_log("Merchant's Luck failed for " + nearby[i].name + ": " + reason, "red");
        }
      }
      return recipients;
    } finally {
      merchantLuckScanWorking = false;
    }
  }

  async function merchantLuck(command) {
    var activity = [], recipients = [];
    try {
      await rendezvous(command.jobId, command.target);
      if (command.target === character.name && await castMerchantLuck(character, 600000))
        recipients.push(character.name);
      var cluster = await request("/merchant/luck-cluster", {
        method: "POST", body: { jobId: command.jobId },
      });
      for (var i = 0; i < (cluster.recipients || []).length; i += 1) {
        var player = get_player(cluster.recipients[i]);
        if (!player) continue;
        try {
          if (await castMerchantLuck(player, 600000)) recipients.push(player.name);
        } catch (error) {
          activity.push({ level: "error", message: "Merchant's Luck failed for " + player.name,
            details: String(error.reason || error.message || error) });
        }
        await new Promise(function (resolve) { setTimeout(resolve, 125); });
      }
      // Include non-party adventurers currently passing within 200 distance.
      var publicRecipients = await castLuckOnVisiblePlayers(600000, 12);
      publicRecipients.forEach(function (name) {
        if (recipients.indexOf(name) < 0) recipients.push(name);
      });
      recipients.forEach(function (name) {
        activity.push({ level: "success", message: "Cast Merchant's Luck on " + name });
      });
      if (!recipients.length)
        activity.push({ level: "info", message: "Merchant's Luck was already active on eligible players near " + command.target });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, mluckRecipients: recipients, activity: activity,
      } });
    } catch (error) {
      activity.push({ level: "error", message: "Merchant's Luck trip to " + command.target + " failed",
        details: String(error.reason || error.message || error) });
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        mluckRecipients: recipients, activity: activity,
      } }); } catch (_completeError) { /* Cleared jobs are already terminal. */ }
      throw error;
    }
  }

  function cleanoutProtected(item) {
    return item.l || item.b || ["tracktrix", "hpot0", "mpot0", "hpot1", "mpot1"].indexOf(item.name) >= 0;
  }

  function cleanoutPriority(entry) {
    if (entry.kind !== "cleanout") return 0;
    var data = G.items[entry.item.name] || {};
    if (data.type === "weapon" || data.wtype) return 4;
    if (["helmet", "chest", "pants", "gloves", "shoes", "cape", "shield"].indexOf(data.type) >= 0) return 3;
    if (["ring", "earring", "belt", "orb", "amulet", "source", "quiver", "offhand"].indexOf(data.type) >= 0) return 2;
    return 1;
  }

  function cleanoutRespectsAutoItemLevel(item, rules) {
    var keys = Object.keys(rules || {}).filter(function (key) {
      if (rules[key] !== "bank" && rules[key] !== "merchant") return false;
      var separator = key.lastIndexOf("@+");
      return (separator < 0 ? key : key.slice(0, separator)) === item.name;
    });
    // An explicit level policy must not become a name-only rule via cleanout.
    return !keys.length || keys.some(function (key) {
      var separator = key.lastIndexOf("@+");
      var level = separator < 0 ? 0 : Math.max(0, Number(key.slice(separator + 2)) || 0);
      return (Number(item.level) || 0) === level;
    });
  }

  async function withMerchantHandoffRecovery(command, action) {
    var revision = navigationIntent.revision;
    try { return await afterCombat(action, "merchant handoff"); }
    finally {
      // A late handoff must never override a new manual move or cleared focus.
      if (!command.convoyContinuation && runtimeCurrent() && lastCommand === command.id && navigationIntent.revision === revision &&
          !navigationIntent.cancelled && partyLocation && character.ctype !== "merchant") {
        beginFarmReunion();
      }
    }
  }

  function assertMerchantContinuation(command) {
    var continuation = command.convoyContinuation;
    if (continuation && (!runtimeCurrent() || lastCommand !== command.id ||
        navigationIntent.revision !== continuation.navigationRevision || Date.now() >= continuation.deadline))
      throw new Error("Merchant collection continuation expired or was superseded");
  }

  async function requestMerchantHandoff(url, options) {
    var deadline = Date.now() + 60000;
    while (true) {
      var result = await request(url, options);
      if (!result.waiting) return result;
      if (Date.now() >= deadline) throw new Error("Timed out waiting for convoy merchant pause");
      await sleep(3000);
    }
  }

  async function merchantHandoff(command) {
    var merchant = await waitForPlayer(command.merchant, 45000);
    assertMerchantContinuation(command);
    var sent = [], banked = [], kept = [], cleaned = [], reserved = [];
    for (var equippedIndex = 0; equippedIndex < (command.upgrades || []).length; equippedIndex += 1) {
      assertMerchantContinuation(command);
      var equippedMark = command.upgrades[equippedIndex];
      if (equippedMark.equipped && typeof equippedMark.slot === "string" && sameItem(character.slots[equippedMark.slot], equippedMark.item)) {
        await unequip(equippedMark.slot);
      }
      reserved.push(equippedMark);
    }
    (command.compounds || []).forEach(function (group) { (group.items || []).forEach(function (mark) { reserved.push(mark); }); });
    var reservedSlots = {};
    var requests = reserved.map(function (mark) {
      var markedSlot = Number.isInteger(mark.slot) ? mark.slot : null;
      var liveSlot = markedSlot !== null && !reservedSlots[markedSlot] && sameItem(character.items[markedSlot], mark.item)
        ? markedSlot : character.items.findIndex(function (item, slot) {
          return !reservedSlots[slot] && sameItem(item, mark.item);
        });
      if (liveSlot < 0) return null;
      reservedSlots[liveSlot] = true;
      return { item: mark.item, slot: liveSlot, mark: mark, kind: "work" };
    }).filter(Boolean);
    if ((command.autoCompounds || []).length) await refreshCompoundProtection(command);
    var deliverySafeStock = compoundAvailableStock(command);
    (command.autoCompounds || []).forEach(function (autoMark) {
      character.items.forEach(function (item, slot) {
        if (!item || !deliverySafeStock[slot] || item.name !== autoMark.name || (item.level || 0) >= autoMark.targetTier ||
            requests.some(function (entry) { return entry.slot === slot; })) return;
        requests.push({ item: fingerprint(item), slot: slot,
          mark: { slot: slot, item: fingerprint(item), autoCompound: true }, kind: "work" });
      });
    });
    (command.marked || []).forEach(function (mark) {
      var wanted = mark && mark.item ? mark.item : mark;
      var markedSlot = mark && Number.isInteger(mark.slot) ? mark.slot : null;
      var liveSlot = markedSlot !== null && sameItem(character.items[markedSlot], wanted)
        ? markedSlot : findItem(wanted);
      if (liveSlot >= 0 && !requests.some(function (request) { return request.slot === liveSlot; }))
        requests.push({ item: wanted, slot: liveSlot, mark: mark, kind: "bank" });
    });
    (command.merchantMarked || []).forEach(function (mark) {
      var wanted = mark && mark.item ? mark.item : mark;
      var markedSlot = mark && Number.isInteger(mark.slot) ? mark.slot : null;
      var liveSlot = markedSlot !== null && sameItem(character.items[markedSlot], wanted)
        ? markedSlot : findItem(wanted);
      if (liveSlot >= 0 && !requests.some(function (request) { return request.slot === liveSlot; }))
        requests.push({ item: wanted, slot: liveSlot, mark: mark, kind: "keep", quantity: (mark.deconstructionId || mark.npcSaleId || mark.automaticPickup) ? mark.quantity : undefined });
    });
    // Resolve automatic rules against the character's live bag at rendezvous
    // time. The coordinator snapshot can be one status beat behind when loot
    // lands immediately before a Merchant's Luck or service visit.
    Object.keys(command.autoItemMarks || {}).forEach(function (ruleKey) {
      var mode = command.autoItemMarks[ruleKey];
      if (mode !== "bank" && mode !== "merchant") return;
      var separator = ruleKey.lastIndexOf("@+");
      var itemName = separator >= 0 ? ruleKey.slice(0, separator) : ruleKey;
      var itemLevel = separator >= 0 ? Math.max(0, Number(ruleKey.slice(separator + 2)) || 0) : 0;
      character.items.forEach(function (item, slot) {
        if (!item || item.name !== itemName || (Number(item.level) || 0) !== itemLevel ||
            requests.some(function (request) { return request.slot === slot; })) return;
        var mark = { slot: slot, item: fingerprint(item), auto: true };
        requests.push({ item: mark.item, slot: slot, mark: mark, kind: mode === "bank" ? "bank" : "keep" });
      });
    });

    if (command.cleanout) {
      character.items.forEach(function (item, slot) {
        if (!item || requests.some(function (entry) { return entry.slot === slot; })) return;
        if (cleanoutProtected(item)) return;
        if (!cleanoutRespectsAutoItemLevel(item, command.autoItemMarks)) return;
        var mark = { slot: slot, item: fingerprint(item), quantity: itemQuantity(item), autoCleanout: true };
        requests.push({ item: mark.item, slot: slot, mark: mark, kind: "cleanout", quantity: mark.quantity });
      });
      requests = requests.filter(function (entry) { return !cleanoutProtected(entry.item); });
      requests.sort(function (a, b) { return cleanoutPriority(a) - cleanoutPriority(b); });
    }
    var capacity = Math.max(0, Number(command.capacity) || 0);
    var cleanoutFreeSlots = freeInventorySlots();
    var cleanoutEmergency = cleanoutFreeSlots <= 3;
    for (var i = 0; i < requests.length; i += 1) {
      assertMerchantContinuation(command);
      if (capacity <= 0) break;
      // Once an emergency visit starts, use its available carrying capacity.
      // Only the follow-up visit depends on the remaining free slots.
      if (requests[i].kind === "cleanout" && !cleanoutEmergency) break;
      var slot = Number.isInteger(requests[i].slot) && sameItem(character.items[requests[i].slot], requests[i].item)
        ? requests[i].slot : findItem(requests[i].item);
      if (slot < 0) continue;
      if (requests[i].mark && requests[i].mark.automaticPickup) {
        // Recheck ownership, enabled rules and craft/delivery reservations immediately before sending.
        var pickupJob = await request("/merchant/job/" + command.jobId + "?target=" + encodeURIComponent(character.name));
        var livePickups = pickupJob.collectionPickups && pickupJob.collectionPickups.keep || [];
        var authorizedPickup = livePickups.find(function (mark) {
          return mark.automaticPickup && mark.slot === requests[i].slot && sameItem(mark.item, requests[i].item);
        });
        slot = requests[i].slot;
        if (!authorizedPickup || !Number.isInteger(slot) || !sameItem(character.items[slot], requests[i].item) ||
            character.items[slot].l || character.items[slot].b) continue;
        command.craftProtection = pickupJob.craftProtection;
        var pickupStock = compoundAvailableStock(command)[slot];
        if (!pickupStock) continue;
        requests[i].quantity = Math.min(Number(authorizedPickup.quantity) || 1, itemQuantity(pickupStock.item));
      }
      if (requests[i].mark && requests[i].mark.autoCompound) {
        await refreshCompoundProtection(command);
        if (!compoundAvailableStock(command)[slot]) continue;
      }
      if (command.cleanout && cleanoutProtected(character.items[slot])) continue;
      var sendQuantity = Math.min(Number(requests[i].quantity) || itemQuantity(character.items[slot]),
        itemQuantity(character.items[slot]));
      if (requests[i].mark && (requests[i].mark.deconstructionId || requests[i].mark.npcSaleId) && (character.items[slot].l || character.items[slot].b)) continue;
      var clearsSlot = sendQuantity >= itemQuantity(character.items[slot]);
      await send_item(command.merchant, slot, sendQuantity);
      if (clearsSlot) cleanoutFreeSlots += 1;
      sent.push(requests[i]);
      capacity -= 1;
      if (requests[i].kind === "bank") banked.push(requests[i].mark);
      if (requests[i].kind === "keep") kept.push((requests[i].mark.deconstructionId || requests[i].mark.npcSaleId || requests[i].mark.automaticPickup) ? Object.assign({}, requests[i].mark, { quantity: sendQuantity }) : requests[i].mark);
      if (requests[i].kind === "cleanout") cleaned.push(requests[i].mark);
    }
    // The threshold only decides when an automatic visit is queued. Once the
    // merchant is here—automatically or manually—the character hands over all
    // carried gold. Any requested walking balance is delivered after pickup.
    var excess = Math.max(0, character.gold);
    assertMerchantContinuation(command);
    if (excess) await send_gold(command.merchant, excess);
    await request("/merchant/handoff-complete", { method: "POST", body: {
      jobId: command.jobId, commandId: command.id, character: character.name, sent: sent, banked: banked, kept: kept, cleaned: cleaned,
      cleanoutRemaining: !!command.cleanout && cleanoutFreeSlots <= 3 && sent.length < requests.length, gold: excess,
    }});
    game_log("Merchant handoff complete", "#51D2E1");
  }

  async function merchantOrderHandoff(command) {
    await waitForPlayer(command.merchant, 45000);
    assertMerchantContinuation(command);
    var sent = [];
    for (var i = 0; i < (command.items || []).length; i += 1) {
      assertMerchantContinuation(command);
      var requestItem = command.items[i], wanted = requestItem.item;
      var slot = Number.isInteger(requestItem.slot) && sameItem(character.items[requestItem.slot], wanted)
        ? requestItem.slot : findItem(wanted);
      if (slot < 0) throw new Error("Missing crafting material " + wanted.name);
      var quantity = Math.min(Number(requestItem.quantity) || 1, character.items[slot].q || 1);
      await send_item(command.merchant, slot, quantity);
      sent.push({ item: wanted, quantity: quantity });
    }
    await request("/merchant/order-handoff-complete", { method: "POST", body: {
      jobId: command.jobId, commandId: command.id, character: character.name, sent: sent,
    }});
  }

  async function withdrawMerchantCash(shortfall, command) {
    var configured = command && Number.isInteger(command.merchantGoldTarget)
      ? Math.max(0, command.merchantGoldTarget) : character.ctype === "merchant" ? merchantCashTarget : 0;
    var required = Math.max(0, Number(shortfall) || 0);
    var available = Math.max(0, Number(character.bank && character.bank.gold) || 0);
    var amount = Math.min(available, Math.max(required, configured - (Number(character.gold) || 0)));
    if (amount > 0) await bank_withdraw(amount);
    return amount;
  }

  async function merchantBankErrands(command, activity) {
    if (command._merchantBankErrandsChecked) return;
    command._merchantBankErrandsChecked = true;
    command._merchantWithdrawalsCompleted = [];
    command._merchantBankedCompleted = [];
    command._npcSalesRetrieved = [];
    async function reservedForCrafting(slot) {
      var protection = command.craftProtection;
      if (command.jobId) {
        var result = await request('/merchant/checkpoint', {method:'POST',body:{jobId:command.jobId,protectionOnly:true}});
        protection = result && result.craftProtection;
        if (!protection) throw Error('Craft reservations unavailable; bank deposit deferred');
      }
      if (!protection) return false;
      if (protection.error) return true;
      var entries=character.items.map(function(item,index){return item ? {item:item,slot:index,craftLocation:'inventory:'+character.name} : null;});
      var available=globalThis.partyAvailableCraftStock(entries,protection);
      // Keep a partially reserved stack intact; its surplus can be banked once
      // the craft completes. A deferred mark must not be acknowledged as banked.
      return !available[slot] || (Number(available[slot].item.q)||1) < (Number(character.items[slot].q)||1);
    }
    var goldTarget = Number.isInteger(command.merchantGoldTarget)
      ? Math.max(0, command.merchantGoldTarget)
      : Number.isInteger(command.goldTarget) ? Math.max(0, command.goldTarget) : 0;
    if (character.gold > goldTarget) {
      var deposit = character.gold - goldTarget;
      await bank_deposit(deposit);
      activity.push({ level: "success", message: "Deposited " + deposit.toLocaleString() + " merchant gold" });
    }
    for (var i = 0; i < (command.merchantWithdrawals || []).length; i += 1) {
      if (freeInventorySlots() <= 3) {
        activity.push({ level: "info", message: "Deferred withdrawals; three inventory slots are reserved" });
        break;
      }
      var withdrawal = command.merchantWithdrawals[i];
      if (String(withdrawal.pack || "").indexOf("bankboi:") === 0) continue;
      var found = findBankItem(withdrawal.item, withdrawal.pack, withdrawal.slot);
      if (!found) {
        // The full bank is authoritative while standing inside it. If an item
        // is absent, its old pack/slot reservation is stale and must not haunt
        // every future merchant visit.
        command._merchantWithdrawalsCompleted.push(withdrawal.deconstructionId
          ? Object.assign({}, withdrawal, { deconstructionMissing: true }) : withdrawal);
        activity.push({ level: "info", message: "Removed stale merchant withdrawal: " + withdrawal.item.name });
        continue;
      }
      await bankRetrieveConfirmed(found.pack, found.slot);
      command._merchantWithdrawalsCompleted.push(withdrawal);
      activity.push({ level: "success", message: "Withdrew " + withdrawal.item.name + " for merchant" });
    }
    for (var markedIndex = 0; markedIndex < (command.merchantBankMarked || []).length; markedIndex += 1) {
      var mark = command.merchantBankMarked[markedIndex];
      var bankingItem = mark.item || mark;
      // Persistent storage preferences yield only for the lifetime of this job.
      var improvementReserved = (command.type === "merchant-self-improve" || command.type === "merchant-service") && ((command.upgrades || []).some(function (work) {
        return work.item && work.item.name === bankingItem.name &&
          (bankingItem.level || 0) >= (work.item.level || 0) &&
          (bankingItem.level || 0) <= (work.item.level || 0) + Number(work.tiers || 1);
      }) || (command.compounds || []).some(function (group) {
        return (group.items || []).some(function (work) { return sameItem(bankingItem, work.item); });
      }) || (command.autoCompounds || []).some(function (rule) {
        return bankingItem.name === rule.name && (bankingItem.level || 0) < rule.targetTier;
      }) || (command.bankUpgradeRules || []).some(function (rule) {
        return bankingItem.name === rule.name && (bankingItem.level || 0) >= rule.level && (bankingItem.level || 0) <= rule.level + rule.tiers;
      })) || (command.merchantWithdrawals || []).some(function (work) {
        return work.improvement && sameItem(bankingItem, work.item);
      });
      if (improvementReserved) continue;
      var slot = findMarkedItem(mark);
      if (slot < 0) {
        // The persistent auto-mark policy lives separately; this concrete slot
        // reservation is stale once the item is no longer in inventory.
        command._merchantBankedCompleted.push(mark);
        activity.push({ level: "info", message: "Removed stale merchant bank mark: " + (mark.item || mark).name });
        continue;
      }
      try {
        if (await reservedForCrafting(slot)) {
          activity.push({level:'info',message:'Kept ' + bankingItem.name + ' reserved for crafting or delivery'});
          continue;
        }
        await bankStoreFully(slot);
      } catch (error) {
        if (String(error && (error.reason || error.message) || error) !== "bank_full") throw error;
        // A scroll-supply visit also runs these optional errands. A full bank
        // must not prevent improvements using items already in inventory.
        // Do not acknowledge this mark: the item still needs to be deposited.
        activity.push({ level: "info", message: "Bank full; deferred deposit of " + (mark.item || mark).name + "; continuing merchant work" });
        continue;
      }
      command._merchantBankedCompleted.push(mark);
      activity.push({ level: "success", message: "Banked " + (mark.item || mark).name + " from merchant inventory" });
    }
    for (var saleIndex = 0; saleIndex < (command.npcSales || []).length; saleIndex += 1) {
      var saleMark = command.npcSales[saleIndex];
      if (findItem(saleMark.item) >= 0) continue;
      if (saleMark.source === "merchant") continue;
      if (character.esize <= 3) {
        activity.push({ level: "info", message: "Deferred NPC-sale withdrawal; merchant inventory reserve reached" });
        break;
      }
      var saleFound = findBankItem(saleMark.item, saleMark.pack, saleMark.slot);
      if (!saleFound) continue;
      await bank_retrieve(saleFound.pack, saleFound.slot);
      command._npcSalesRetrieved.push(saleMark.id);
      activity.push({ level: "success", message: "Withdrew " + saleMark.item.name + " for NPC sale" });
    }
  }

  async function closeMerchantStandForTravel() {
    if (!character.stand) return;
    await close_stand();
    var deadline = Date.now() + 2500;
    while (character.stand && Date.now() < deadline) await sleep(100);
    if (character.stand) throw new Error("Merchant stand did not close before travel");
  }

  async function merchantOperationStage(command, stage) {
    if (!command.processingRoutine || command.operationStage === stage) return;
    command.operationStage = stage;
    await request("/merchant/heartbeat", { method: "POST", body: {
      jobId: command.jobId, operationStage: stage,
    } });
  }

  async function merchantVisitBank(command, activity) {
    await merchantOperationStage(command, command.operationStage === "storing" ? "storing" : "retrieving");
    await closeMerchantStandForTravel();
    await smart_move("bank");
    await waitForBankPack("items0", 10000);
    await bankboiCheckpoint();
    await merchantBankErrands(command, activity);
    await bankboiCheckpoint();
    // Errands are de-duplicated within a job, but sorting is deliberately not:
    // every physical bank visit (including a cash-only visit) tidies the floor.
    try {
      await sortCurrentBankFloor(activity);
    } catch (sortError) {
      activity.push({ level: "error", message: "Bank sorting failed", details: String(sortError.reason || sortError.message || sortError) });
    }
  }

  function findUpgradeMarkSlot(mark, used) {
    if (!mark || !mark.item) return -1;
    // The requested level is anchored to the original mark, not the level
    // reached before an interruption. Durable automatic passes may follow a
    // unique survivor to another slot after inventory recovery.
    var start = Number(mark.item.level) || 0;
    var target = Math.min(maximumItemLevel(G.items[mark.item.name]), start + (Number(mark.tiers) || 1));
    var slot = mark.slot, item = Number.isInteger(slot) && character.items[slot];
    if (item && !used[slot] && (Number(item.level) || 0) >= start &&
        (Number(item.level) || 0) <= target &&
        sameItem(Object.assign({}, item, { level: mark.item.level }), mark.item)) return slot;
    if (mark.auto && mark.passId) {
      var survivors = [];
      character.items.forEach(function (candidate, index) {
        if (!used[index] && candidate && (Number(candidate.level) || 0) >= start &&
            (Number(candidate.level) || 0) <= target &&
            sameItem(Object.assign({},candidate,{level:mark.item.level}),mark.item)) survivors.push(index);
      });
      if (survivors.length > 1) throw Error("Automatic upgrade survivor is ambiguous; waiting for inventory recovery");
      if (survivors.length === 1) return survivors[0];
    }
    return character.items.findIndex(function (candidate, index) {
      return !used[index] && sameItem(candidate, mark.item);
    });
  }

  async function upgradeOfferingCheckpoint(command) {
    var result = await request("/merchant/checkpoint", {method:"POST",body:{jobId:command.jobId,protectionOnly:true}});
    if (!result || !result.craftProtection || result.craftProtection.error) throw Error("Offering reservations unavailable; upgrade deferred");
    return result;
  }
  function availableOfferingEntries(checkpoint) {
    var entries = character.items.map(function(item,slot) { return item ? {item:item,slot:slot,craftLocation:"inventory:"+character.name} : null; });
    Object.keys(character.bank || {}).forEach(function(pack) {
      if (Array.isArray(character.bank[pack])) character.bank[pack].forEach(function(item,slot) {
        if (item) entries.push({item:item,slot:slot,pack:pack,craftLocation:pack});
      });
    });
    return globalThis.partyAvailableCraftStock(entries,checkpoint.craftProtection).filter(function(entry) { return entry && entry.item && !entry.item.l && !entry.item.b; });
  }
  function carriedOffering(checkpoint, name) {
    var found = availableOfferingEntries(checkpoint).find(function(entry) { return !entry.pack && entry.item.name === name; });
    return found ? found.slot : -1;
  }
  async function retrieveUpgradeOffering(command, name, activity) {
    await merchantVisitBank(command,activity);
    var floors = accessibleBankSortFloors();
    for (var i=0;i<floors.length;i++) {
      if (character.map !== floors[i]) await smart_move(floors[i]);
      var checkpoint = await upgradeOfferingCheckpoint(command);
      if (carriedOffering(checkpoint,name) >= 0) return;
      var packs = bankPacksOnCurrentFloor();
      var found = availableOfferingEntries(checkpoint).find(function(entry) {
        return entry.pack && packs.indexOf(entry.pack)>=0 && entry.item.name===name;
      });
      if (!found) continue;
      if (freeInventorySlots()<1) throw Error("Merchant needs a free slot for upgrade offering");
      await bankRetrieveConfirmed(found.pack,found.slot);
      if (carriedOffering(await upgradeOfferingCheckpoint(command),name)>=0) return;
    }
  }
  async function prepareUpgradeOffering(command, mark, slot, activity) {
    if (!mark.auto && !mark.offering) return undefined;
    var checkpoint = await upgradeOfferingCheckpoint(command), item = character.items[slot];
    var level = Number(item.level)||0;
    var rule = mark.offering ? {offering:mark.offering,required:true} : (checkpoint.upgradeOfferingRules || []).find(function(rule) {
      return rule.name===item.name && rule.floor<=level && level<rule.ceiling;
    });
    if (!rule) return undefined;
    if (carriedOffering(checkpoint,rule.offering)<0 && Number((checkpoint.upgradeOfferingStock || {})[rule.offering])>0) {
      await retrieveUpgradeOffering(command,rule.offering,activity);
      checkpoint = await upgradeOfferingCheckpoint(command);
    }
    var offeringSlot = carriedOffering(checkpoint,rule.offering);
    if (offeringSlot<0 && rule.required) {
      await request("/merchant/production", {method:"POST",body:{character:character.name,action:"wait-offering",
        owner:command.target || character.name,mark:mark,liveSlot:findItem(item),level:level,offering:rule.offering}});
      (command._offeringWaits ||= []).push(mark);
      activity.push({level:"info",message:"Waiting for " + (G.items[rule.offering].name || rule.offering) + " to upgrade " + item.name + " from +"+level+" to +"+(level+1)});
      return {waiting:true};
    }
    return offeringSlot<0 ? undefined : {offering:rule.offering,requestId:mark.requestId};
  }

  async function merchantImprove(command, activity) {
    await merchantOperationStage(command, "processing");
    var returns = [], used = {};
    command._upgradeReturns = [];
    async function productionBuff() {
      var skill = character.level >= 60 ? "massproductionpp" : character.level >= 30 ? "massproduction" : null;
      if (!skill || !can_use(skill) || is_on_cooldown(skill)) return false;
      // The runner's generic use_skill path delegates merchant production
      // buffs to the legacy client promise, which can remain pending even
      // after the server applies the condition. The buff is an optimization,
      // never a prerequisite: cap the wait so upgrading cannot deadlock.
      try {
        await Promise.race([
          Promise.resolve(use_skill(skill)),
          new Promise(function (resolve) { setTimeout(resolve, 750); }),
        ]);
      } catch (error) {
        activity.push({ level: "info", message: "Could not apply " + skill + "; continuing without it",
          details: String(error.reason || error.message || error) });
        return false;
      }
      if (character.s && character.s[skill])
        activity.push({ level: "info", message: "Applied " + G.skills[skill].name + " to the next operation" });
      return !!(character.s && character.s[skill]);
    }
    for (var purchaseIndex = 0; purchaseIndex < (command.purchases || []).length; purchaseIndex += 1) {
      var purchase = command.purchases[purchaseIndex], seller = purchase && itemSeller(purchase.name);
      if (!seller || !G.items[purchase.name]) { activity.push({ level: "error", message: "No seller for " + (purchase && purchase.name) }); continue; }
      var purchasePrice = G.items[purchase.name].g || 0;
      if (character.gold < purchasePrice) { await merchantVisitBank(command, activity); await withdrawMerchantCash(Math.min(purchasePrice - character.gold, Number(character.bank && character.bank.gold) || 0), command); }
      await smart_move(find_npc(seller)); await buyConfirmed(purchase.name, 1);
      var purchasedSlot = character.items.findIndex(function (item, index) { return !used[index] && item && item.name === purchase.name && (item.level || 0) === 0; });
      if (purchasedSlot >= 0) { used[purchasedSlot] = true; returns.push(purchasedSlot); }
    }
    for (var i = 0; i < (command.upgrades || []).length; i += 1) {
      var mark = command.upgrades[i], slot = findUpgradeMarkSlot(mark, used);
      if (slot < 0) continue;
      used[slot] = true;
      var targetLevel = Math.min(maximumItemLevel(G.items[mark.item.name]),
        (Number(mark.item.level) || 0) + (Number(mark.tiers) || 1));
      if (mark.auto && !mark.passId) mark.passId = character.name + ":upgrade:" + Date.now() + ":" + Math.random().toString(36).slice(2);
      while (character.items[slot] && (Number(character.items[slot].level) || 0) < targetLevel) {
        var liveBeforeOffering = fingerprint(character.items[slot]);
        var offeringAttempt = await prepareUpgradeOffering(command, mark, slot, activity);
        if (offeringAttempt && offeringAttempt.waiting) break;
        if (!sameItem(character.items[slot], liveBeforeOffering)) slot = findItem(liveBeforeOffering);
        if (slot < 0) throw Error("Upgrade item changed while preparing offering");
        used[slot] = true;
        var scrollName = "scroll" + item_grade(character.items[slot]);
        var scrollSlot = findInventoryItemByName(scrollName);
        if (scrollSlot < 0) {
          // Re-plan only unfinished work using the current item's live level.
          // Do not fall back to one-scroll shopping trips after a batch runs out.
          var remainingUpgrades = command.upgrades.slice(i);
          remainingUpgrades[0] = Object.assign({}, mark, {
            item: fingerprint(character.items[slot]), tiers: targetLevel - (Number(character.items[slot].level) || 0),
          });
          var refillNeeds = manualImprovementScrollNeeds({ upgrades: remainingUpgrades });
          await ensureOwnedItemQuantity(scrollName, refillNeeds[scrollName] || 1, command, activity);
          scrollSlot = findInventoryItemByName(scrollName);
        }
        await smart_move(find_npc("newupgrade"));
        await productionBuff();
        try {
          var before = character.items[slot].level || 0;
          var outcome = await upgradeConfirmed(slot, scrollSlot, undefined, undefined, mark.auto ? {family:"upgrade",key:mark.item.name+"@+"+(mark.item.level||0),mark:Object.assign({},mark,{slot:slot,equipped:false})} : undefined, offeringAttempt);
          if (mark.offering) {
            activity.push({level:outcome && outcome.success === false ? "info" : "success", message:"Completed one upgrade attempt with " + mark.offering});
            break;
          }
          if (outcome && outcome.success === false) {
            activity.push({ level: "info", message: mark.item.name + " survived a failed upgrade; retrying the same item",
              details: { slot: slot, level: character.items[slot].level, targetLevel: targetLevel } });
            continue;
          }
          activity.push({ level: "success", message: mark.item.name + " upgraded from +" + before +
            " to +" + (character.items[slot] && character.items[slot].level || before + 1) });
        } catch (error) {
          activity.push({ level: "error", message: mark.item.name + " upgrade failed", details: String(error.message || error.reason || error) });
          if (error.reason === "upgrade_destroyed") break;
          // A rejected/uncertain operation is not permission to abandon this
          // survivor and consume a different copy. Stop the job for recovery.
          throw error;
        }
      }
      if (character.items[slot]) {
        returns.push(slot);
        if (mark.equipped && typeof mark.slot === "string")
          command._upgradeReturns.push({ slot: mark.slot, item: fingerprint(character.items[slot]) });
      }
    }
    for (var c = 0; c < (command.compounds || []).length; c += 1) {
      var group = command.compounds[c];
      if (!group.items || group.items.length !== 3) continue;
      var slots = [], localUsed = {};
      group.items.forEach(function (mark) {
        var slot = character.items.findIndex(function (item, index) { return !localUsed[index] && sameItem(item, mark.item); });
        if (slot >= 0) localUsed[slot] = true;
        slots.push(slot);
      });
      if (slots.some(function (slot) { return slot < 0; })) continue;
      var cscroll = "cscroll" + item_grade(character.items[slots[0]]), cscrollSlot = findInventoryItemByName(cscroll);
      if (cscrollSlot < 0) {
        await ensureOwnedItemQuantity(cscroll, 1, command, activity);
        cscrollSlot = findInventoryItemByName(cscroll);
      }
      await smart_move(find_npc("newupgrade")); await productionBuff();
      try {
        await compoundConfirmed(slots[0], slots[1], slots[2], cscrollSlot);
        var resultSlot = sameItem(character.items[slots[0]], {
          name: group.items[0].item.name, level: (group.items[0].item.level || 0) + 1
        }) ? slots[0] : character.items.findIndex(function (item, index) {
          if (returns.indexOf(index) >= 0) return false;
          return item && item.name === group.items[0].item.name && (item.level || 0) === (group.items[0].item.level || 0) + 1;
        });
        if (resultSlot >= 0) returns.push(resultSlot);
        activity.push({ level: "success", message: group.name + " compounded" });
      } catch (error) {
        activity.push({ level: "error", message: group.name + " compound failed", details: String(error.reason || error.message || error) });
        slots.forEach(function (slot) { if (slot >= 0 && character.items[slot]) returns.push(slot); });
      }
    }
    command._autoCompoundsResolved = [];
    if ((command.autoCompounds || []).length) await refreshCompoundProtection(command);
    for (var autoIndex = 0; autoIndex < (command.autoCompounds || []).length; autoIndex += 1) {
      var autoMark = command.autoCompounds[autoIndex], targetTier = Math.max(1, Number(autoMark.targetTier) || 1);
      if (command.type === "merchant-self-improve" && !command._autoCompoundBankItems) {
        await merchantVisitBank(command, activity);
        command._autoCompoundBankItems = [];
        Object.keys(character.bank || {}).forEach(function (pack) {
          if (Array.isArray(character.bank[pack])) character.bank[pack].forEach(function (item) {
            if (item) command._autoCompoundBankItems.push(Object.assign({}, item, {craftLocation: pack}));
          });
        });
      }
      var desiredQuantity = Number.isSafeInteger(Number(autoMark.quantity)) ? Number(autoMark.quantity) : -1;
      var producedThisPass = 0;
      var madeProgress = true;
      while (madeProgress) {
        await refreshCompoundProtection(command);
        madeProgress = false;
        var liveCompoundRule = (command.autoCompounds || []).find(function (rule) { return rule.name === autoMark.name && Number(rule.targetTier || 1) === targetTier && Number(rule.quantity) !== 0; });
        if (!liveCompoundRule) break;
        if (desiredQuantity !== -1 && producedThisPass >= desiredQuantity) break;
        // Consume the highest available triple first, freeing workspace before
        // bringing in more low-tier ingredients. Never withdraw the whole bank.
        for (var level = targetTier - 1; level >= 0; level -= 1) {
          var candidates = compoundInventorySlots(command, autoMark.name, level);
          if (candidates.length < 3 && command.type === "merchant-self-improve") {
            var bankCount = compoundAvailableStock(command).slice(character.items.length).filter(function (entry) {
              return entry && !entry.item.l && entry.item.name === autoMark.name && (entry.item.level || 0) === level;
            }).length;
            if (bankCount + candidates.length < 3) continue;
            await merchantVisitBank(command, activity);
            await retrieveAutoCompoundBatch(autoMark.name, level, candidates.length, command);
            candidates = compoundInventorySlots(command, autoMark.name, level);
          }
          if (candidates.length < 3) continue;
          var scrollName = "cscroll" + item_grade(character.items[candidates[0]]);
          var scrollSlot = findInventoryItemByName(scrollName);
          if (scrollSlot < 0) {
            await ensureOwnedItemQuantity(scrollName, 1, command, activity);
            scrollSlot = findInventoryItemByName(scrollName);
          }
          await merchantOperationStage(command, "processing");
          await smart_move(find_npc("newupgrade")); await productionBuff();
          await refreshCompoundProtection(command);
          candidates = compoundInventorySlots(command, autoMark.name, level);
          if (candidates.length < 3) continue;
          scrollSlot = findInventoryItemByName(scrollName);
          if (scrollSlot < 0) continue;
          var beforeCompound = JSON.stringify(candidates.map(function (slot) { return character.items[slot]; }));
          try {
            await compoundConfirmed(candidates[0], candidates[1], candidates[2], scrollSlot, {family:"compound",key:autoMark.name});
            if (level + 1 === targetTier) producedThisPass++;
            activity.push({ level: "success", message: "Auto compounded " + autoMark.name + " to +" + (level + 1) });
          } catch (autoError) {
            activity.push({ level: "error", message: "Auto compound failed for " + autoMark.name,
              details: String(autoError.reason || autoError.message || autoError) });
          }
          madeProgress = beforeCompound !== JSON.stringify(candidates.map(function (slot) { return character.items[slot]; }));
          if (!madeProgress) throw new Error("Auto compound made no inventory progress");
          break;
        }
      }
      character.items.forEach(function (item, slot) {
        if (item && item.name === autoMark.name && (item.level || 0) >= targetTier && returns.indexOf(slot) < 0) returns.push(slot);
      });
    }
    return returns.map(function (slot) { return fingerprint(character.items[slot]); }).filter(Boolean);
  }

  async function retrieveAutoCompoundBatch(name, level, owned, command) {
    await refreshCompoundProtection(command);
    if (!autoCompoundLevelAllowed(command, name, level)) return;
    var needed = 3 - compoundInventorySlots(command, name, level).length, stock = [];
    if (needed <= 0) return;
    Object.keys(character.bank || {}).forEach(function (pack) {
      if (!Array.isArray(character.bank[pack])) return;
      character.bank[pack].forEach(function (item, slot) {
        if (item) stock.push({ pack: pack, slot: slot, craftLocation: pack, item: Object.assign({}, item, {craftLocation: pack}) });
      });
    });
    // Replace stale estimates with the authoritative bank view on each visit.
    command._autoCompoundBankItems = stock.map(function (entry) { return entry.item; });
    var matches = compoundAvailableStock(command, stock).slice(character.items.length).filter(function (entry) {
      return entry && !entry.item.l && entry.item.name === name && (entry.item.level || 0) === level;
    });
    if (matches.length < needed) return;
    var scroll = "cscroll" + item_grade({ name: name, level: level });
    var reserve = findInventoryItemByName(scroll) < 0 ? 1 : 0;
    if (character.esize < needed + reserve) throw new Error("inventory_full");
    for (var index = 0; index < needed; index += 1) {
      await refreshCompoundProtection(command);
      if (!autoCompoundLevelAllowed(command, name, level)) return;
      var available = compoundAvailableStock(command, stock).slice(character.items.length);
      if (!available.some(function (entry) { return entry && entry.pack === matches[index].pack && entry.slot === matches[index].slot; })) return;
      await bank_retrieve(matches[index].pack, matches[index].slot);
      stock = stock.filter(function (entry) { return entry !== matches[index]; });
      var saved = command._autoCompoundBankItems.findIndex(function (item) {
        return !item.l && item.name === name && (item.level || 0) === level && item.craftLocation === matches[index].pack;
      });
      if (saved >= 0) command._autoCompoundBankItems.splice(saved, 1);
    }
  }

  async function refreshCompoundProtection(command) {
    var result = await request("/merchant/checkpoint", {method: "POST", body: {jobId: command.jobId, protectionOnly: true}});
    if (!result || !result.craftProtection) throw new Error("Craft reservations unavailable; auto compound deferred");
    command.craftProtection = result.craftProtection;
    if (Array.isArray(result.compoundRules)) {
      command._compoundRulesChecked = true;
      command.autoCompounds = result.compoundRules.filter(function (rule) {
      return (command.autoCompounds || []).some(function (original) { return original.name === rule.name && Number(original.targetTier || 1) === Number(rule.targetTier || 1); });
    });
    }
    command._compoundBlocked = result.compoundBlocked || [];
    if (command.craftProtection.error) throw new Error(command.craftProtection.error);
  }

  function compoundAvailableStock(command, bankEntries) {
    var inventory = character.items.map(function (item, slot) { return item ? {item: item, slot: slot, craftLocation: "inventory:" + character.name} : null; });
    var bank = bankEntries || (command._autoCompoundBankItems || []).map(function (item) { return {item: item, craftLocation: item.craftLocation}; });
    return globalThis.partyAvailableCraftStock(inventory.concat(bank), command.craftProtection || {requirements: []}).map(function (entry) {
      return entry && (command._compoundBlocked || []).some(function (item) { return sameItem(entry.item, item); }) ? null : entry;
    });
  }

  function autoCompoundLevelAllowed(command, name, level) {
    return !command._compoundRulesChecked || (command.autoCompounds || []).some(function (rule) {
      return rule.name === name && Number(rule.quantity) !== 0 && level < Number(rule.targetTier || 1);
    });
  }

  function compoundInventorySlots(command, name, level) {
    if (!autoCompoundLevelAllowed(command, name, level)) return [];
    return compoundAvailableStock(command).slice(0, character.items.length).filter(function (entry) {
      return entry && !entry.item.l && entry.item.name === name && (entry.item.level || 0) === level;
    }).map(function (entry) { return entry.slot; });
  }

  function manualImprovementScrollNeeds(command) {
    var needs = {}, staged = {}, used = {};
    (command.upgrades || []).forEach(function (mark) {
      if (!mark || !mark.item) return;
      var slot = findUpgradeMarkSlot(mark, used);
      if (slot < 0) return;
      used[slot] = true;
      var liveItem = character.items[slot], start = Number(liveItem.level) || 0;
      var target = Math.min(maximumItemLevel(G.items[liveItem.name]),
        (Number(mark.item.level) || 0) + Math.max(1, Number(mark.tiers) || 1));
      var tiers = Math.max(0, target - start);
      var startingScroll = "scroll" + item_grade(liveItem);
      // Batch only steps within the starting grade across queued items.
      // Later grades are staged one at a time, not charged to this batch.
      for (var tier = 0; tier < tiers; tier += 1) {
        var scroll = "scroll" + item_grade({ name: liveItem.name, level: start + tier });
        if (scroll === startingScroll) needs[scroll] = (needs[scroll] || 0) + 1;
        else staged[scroll] = 1;
      }
    });
    Object.keys(staged).forEach(function (scroll) {
      needs[scroll] = Math.max(needs[scroll] || 0, staged[scroll]);
    });
    (command.compounds || []).forEach(function (group) {
      if (!group || !group.items || group.items.length !== 3 || !group.items[0].item) return;
      var groupUsed = {}, slots = group.items.map(function (mark) {
        var slot = character.items.findIndex(function (item, index) {
          return !used[index] && !groupUsed[index] && sameItem(item, mark.item);
        });
        if (slot >= 0) groupUsed[slot] = true;
        return slot;
      });
      if (slots.some(function (slot) { return slot < 0; })) return;
      slots.forEach(function (slot) { used[slot] = true; });
      var scroll = "cscroll" + item_grade(character.items[slots[0]]);
      // Compound groups are also processed sequentially and supply is checked
      // again after each operation, so one staged scroll of this grade is
      // sufficient regardless of how many groups are queued.
      needs[scroll] = Math.max(needs[scroll] || 0, 1);
    });
    return needs;
  }

  async function ensureOwnedItemQuantity(name, requiredOnPlayer, command, activity) {
    var availability = itemAvailability(name);
    if (availability.onPlayer >= requiredOnPlayer) return availability;
    await merchantVisitBank(command, activity);
    availability = await retrieveFromBankUntil(name, requiredOnPlayer);
    var missing = Math.max(0, requiredOnPlayer - availability.onPlayer);
    if (!missing) return availability;
    var cost = missing * Number(G.items[name] && G.items[name].g || 0);
    if (character.gold < cost) {
      var shortfall = cost - character.gold;
      if ((Number(character.bank && character.bank.gold) || 0) < shortfall)
        throw new Error("Insufficient bank gold for " + missing + " × " + name);
      await withdrawMerchantCash(shortfall, command);
    }
    await smart_move(find_npc("scrolls"));
    await buyConfirmed(name, missing);
    return itemAvailability(name);
  }

  async function prepareManualImprovementScrolls(command, activity) {
    var needs = manualImprovementScrollNeeds(command), names = Object.keys(needs);
    if (!names.length) return needs;
    var mustCheckBank = names.some(function (name) {
      return itemAvailability(name).onPlayer < needs[name];
    });
    if (mustCheckBank) await merchantVisitBank(command, activity);
    for (var index = 0; index < names.length; index += 1)
      await retrieveFromBankUntil(names[index], needs[names[index]]);
    var missing = {}, totalCost = 0;
    names.forEach(function (name) {
      var availability = itemAvailability(name);
      missing[name] = Math.max(0, needs[name] - availability.onPlayer);
      totalCost += missing[name] * Number(G.items[name] && G.items[name].g || 0);
      activity.push({ level: "info", message: "Scroll supply checked: " + name,
        details: { required: needs[name], inventory: availability.onPlayer,
          bank: availability.inBank, buying: missing[name] } });
    });
    if (character.gold < totalCost) {
      if (!character.bank) await merchantVisitBank(command, activity);
      var neededGold = totalCost - character.gold;
      if ((Number(character.bank && character.bank.gold) || 0) < neededGold)
        throw new Error("Insufficient bank gold for requested upgrade and compound scrolls");
      await withdrawMerchantCash(neededGold, command);
    }
    if (names.some(function (name) { return missing[name] > 0; })) {
      await smart_move(find_npc("scrolls"));
      for (var buyIndex = 0; buyIndex < names.length; buyIndex += 1)
        if (missing[names[buyIndex]] > 0) await buyConfirmed(names[buyIndex], missing[names[buyIndex]]);
    }
    return needs;
  }

  function statScrollQuantity(item) {
    return [1, 10, 100, 1000][Math.max(0, Math.min(3, item_grade(item)))] || 1;
  }

  async function preloadStatScrolls(command, activity) {
    var needs = {};
    // Prepare only this visit's deliveries. The old global preload counted all
    // outstanding party marks again on every character leg, buying duplicates
    // while earlier recipients were still applying their delivered scrolls.
    (command.statScrolls || []).forEach(function (mark) {
      if (!mark || !mark.scroll || !mark.item) return;
      needs[mark.scroll] = (needs[mark.scroll] || 0) + statScrollQuantity(mark.item);
    });
    Object.keys(needs).forEach(function (name) {
      needs[name] = Math.max(0, needs[name] - statusQuantity(command.targetInventory || [], name));
    });
    var names = Object.keys(needs).filter(function (name) { return needs[name] > 0; });
    if (!names.length) return;
    var needsBank = names.some(function (name) { return itemAvailability(name).onPlayer < needs[name]; });
    if (needsBank) await merchantVisitBank(command, activity);
    for (var n = 0; n < names.length; n += 1) {
      await retrieveFromBankUntil(names[n], needs[n]);
    }
    var purchasableStatScrolls = { strscroll: true, intscroll: true, dexscroll: true, vitscroll: true };
    for (var requiredIndex = 0; requiredIndex < names.length; requiredIndex += 1) {
      var requiredName = names[requiredIndex];
      if (!purchasableStatScrolls[requiredName] && itemAvailability(requiredName).onPlayer < needs[requiredName])
        throw new Error("Missing " + needs[requiredName] + " × " + requiredName + " in merchant or bank inventory");
    }
    var totalCost = names.reduce(function (total, name) {
      return total + (purchasableStatScrolls[name] ? Math.max(0, needs[name] - itemAvailability(name).onPlayer) : 0) *
        Number(G.items[name] && G.items[name].g || 0);
    }, 0);
    if (character.gold < totalCost) {
      var available = Number(character.bank && character.bank.gold) || 0;
      if (available < totalCost - character.gold) throw new Error("Insufficient bank gold for requested stat scrolls");
      await withdrawMerchantCash(totalCost - character.gold, command);
    }
    if (needsBank && character.bank) {
      try { await sortCurrentBankFloor(activity); }
      catch (preloadSortError) {
        activity.push({ level: "error", message: "Bank sorting failed after stat-scroll withdrawal",
          details: String(preloadSortError.reason || preloadSortError.message || preloadSortError) });
      }
    }
    if (names.some(function (name) { return purchasableStatScrolls[name] && itemAvailability(name).onPlayer < needs[name]; }))
      await smart_move(find_npc("scrolls"));
    for (var b = 0; b < names.length; b += 1) {
      if (!purchasableStatScrolls[names[b]]) continue;
      var buyCount = Math.max(0, needs[names[b]] - itemAvailability(names[b]).onPlayer);
      if (buyCount) await buyConfirmed(names[b], buyCount);
    }
    activity.push({ level: "info", message: "Prepared stat scrolls before the party visit" });
  }

  async function applyStatScrolls(command, activity) {
    var returns = [], resolved = [];
    command._statReturns = [];
    for (var i = 0; i < (command.statScrolls || []).length; i += 1) {
      var mark = command.statScrolls[i];
      // A partial name/level match can select an otherwise identical item that
      // already has a stat applied. Prefer the dashboard's clicked slot and
      // require the complete item state to still match before consuming a
      // potentially expensive scroll stack.
      var itemSlot = findMarkedInventoryItem(mark), scrollSlot = findInventoryItemByName(mark.scroll);
      if (itemSlot < 0) {
        activity.push({ level: "error", message: "Skipped stale stat-scroll request for " + mark.item.name,
          details: "The exact clicked item is no longer present in its expected state; no scroll was consumed." });
        continue;
      }
      if (scrollSlot < 0 || inventoryQuantity(mark.scroll) < statScrollQuantity(character.items[itemSlot])) {
        activity.push({ level: "error", message: "Missing required " + mark.scroll + " copies" });
        returns.push(fingerprint(character.items[itemSlot]));
        continue;
      }
      try {
        await smart_move(find_npc("newupgrade"));
        await upgrade(itemSlot, scrollSlot);
        if (character.items[itemSlot]) {
          var completed = fingerprint(character.items[itemSlot]);
          returns.push(completed);
          if (mark.equipped && typeof mark.slot === "string")
            command._statReturns.push({ slot: mark.slot, item: completed });
        }
        resolved.push(mark);
        activity.push({ level: "success", message: "Applied " + mark.statType.toUpperCase() +
          " to " + mark.item.name + " for " + command.target });
      } catch (error) {
        if (character.items[itemSlot]) returns.push(fingerprint(character.items[itemSlot]));
        activity.push({ level: "error", message: "Stat scroll failed for " + mark.item.name,
          details: String(error.reason || error.message || error) });
      }
    }
    command._statScrollsResolved = resolved;
    return returns;
  }

  async function deliverStatScrolls(command, activity) {
    var needs = {};
    (command.statScrolls || []).forEach(function (mark) {
      if (mark && mark.scroll && mark.item)
        needs[mark.scroll] = (needs[mark.scroll] || 0) + statScrollQuantity(mark.item);
    });
    Object.keys(needs).forEach(function (name) {
      needs[name] = Math.max(0, needs[name] - statusQuantity(command.targetInventory || [], name));
    });
    var names = Object.keys(needs);
    if (!names.length) return false;
    await rendezvous(command.jobId, command.target);
    for (var i = 0; i < names.length; i += 1) {
      var slot = findInventoryItemByName(names[i]);
      if (!needs[names[i]]) continue;
      if (slot < 0 || inventoryQuantity(names[i]) < needs[names[i]])
        throw new Error("Missing prepared " + names[i] + " copies for " + command.target);
      await merchantSendItem(command.target, slot, needs[names[i]]);
      activity.push({ level: "success", message: "Delivered " + needs[names[i]] + " × " + names[i] +
        " to " + command.target + " for equipped armor" });
    }
    return true;
  }

  async function applyOwnedStatScrolls(command) {
    var activity = [], resolved = [], failure = null;
    // The merchant delivers scrolls to the character in the field, so this is
    // the character's actual farming position before it leaves for the shrine.
    var origin = { map: character.map, x: character.x, y: character.y };
    try {
      // Travel while fully equipped. At the shrine, expose only one piece at a
      // time and put it straight back on before touching the next one.
      await smart_move(find_npc("newupgrade"));
      for (var i = 0; i < (command.items || []).length; i += 1) {
        var mark = command.items[i];
        if (!mark || typeof mark.slot !== "string" || !sameItemState(character.slots[mark.slot], mark.item)) {
          activity.push({ level: "error", message: "Skipped stale stat-scroll request for " +
            (mark && mark.item && mark.item.name || "equipment") });
          continue;
        }
        await unequip(mark.slot);
        var itemSlot = findItem(mark.item), scrollSlot = findInventoryItemByName(mark.scroll);
        if (itemSlot < 0 || scrollSlot < 0 || inventoryQuantity(mark.scroll) < statScrollQuantity(mark.item))
          throw new Error("Missing item or required " + mark.scroll + " copies");
        try {
          await upgradeConfirmed(itemSlot, scrollSlot);
          var updated = character.items[itemSlot];
          if (!updated) throw new Error(mark.item.name + " was destroyed while applying its stat scroll");
          await equip(itemSlot, mark.slot);
          resolved.push(mark);
          activity.push({ level: "success", message: "Applied " + mark.statType.toUpperCase() +
            " to " + (G.items[mark.item.name] && G.items[mark.item.name].name || mark.item.name) });
        } catch (error) {
          // Applying the scroll adds stat_type and changes the fingerprint, so
          // prefer the known inventory slot if only the re-equip step failed.
          var restoreSlot = character.items[itemSlot] && character.items[itemSlot].name === mark.item.name
            ? itemSlot : findItem(mark.item);
          if (restoreSlot >= 0) await equip(restoreSlot, mark.slot);
          throw error;
        }
      }
    } catch (error) {
      activity.push({ level: "error", message: "Stat-scroll application failed",
        details: String(error.reason || error.message || error) });
      failure = error;
    }
    try {
      // Resolve this at return time—not dispatch time—because the leader may
      // have moved while the character was applying several scrolls.
      var returningToLeader = !!(followLeader && leader && leader !== character.name && leaderLocation);
      var destination = returningToLeader
        ? { map: leaderLocation.map, x: leaderLocation.x, y: leaderLocation.y } : origin;
      await smart_move(destination);
      activity.push({ level: "success", message: returningToLeader
        ? "Returned " + character.name + " to the party leader after stat scrolling"
        : "Returned " + character.name + " to its farming location after stat scrolling" });
    } catch (returnError) {
      activity.push({ level: "error", message: "Could not return after stat scrolling",
        details: String(returnError.reason || returnError.message || returnError) });
    }
    var deliveryEquipResults = await equipDeliveredItems(command.equipItems || []);
    deliveryEquipResults.forEach(function(result, index) { if (command.deliveryIds) result.deliveryId = command.deliveryIds[index]; });
    await request("/stat-scroll-complete", { method: "POST", body: {
      character: character.name, resolved: resolved, activity: activity, equipResults: deliveryEquipResults,
    }});
    if (failure) throw failure;
  }

  function isDashboardEquipment(item) {
    var definition = G.items[item && item.name] || {};
    return ["helmet", "pants", "chest", "weapon", "amulet", "earring", "shoes", "gloves", "ring", "shield", "belt", "source", "orb", "quiver", "cape", "misc_offhand", "tool"].includes(definition.type);
  }
  async function useDashboardItem(command) {
    var item = character.items[command.slot];
    if (!sameItemState(item, command.item)) throw new Error("item no longer matches that inventory slot");
    var definition = G.items[item.name] || {};
    if (!["elixir", "licence", "spawner"].includes(definition.type) && !Array.isArray(definition.gives))
      throw new Error("item has no supported Use action");
    await consume(command.slot);
  }
  async function equipDeliveredItems(items) {
    var results = [];
    for (var i = 0; i < (items || []).length; i += 1) {
      if (!isDashboardEquipment(items[i])) {
        results.push({item: items[i], success: false, error: "item is not equipment"});
        continue;
      }
      var slot = -1;
      var alreadyEquipped = Object.keys(character.slots || {}).some(function (equippedSlot) {
        return sameItemState(character.slots[equippedSlot], items[i]);
      });
      if (alreadyEquipped && !character.items.some(function (item) { return sameItemState(item, items[i]); })) {
        results.push({ item: items[i], success: true, alreadyEquipped: true });
        continue;
      }
      // Delivery and dashboard polling can cross on the wire. Give the item a
      // brief window to appear before treating the instruction as stale.
      for (var attempt = 0; attempt < 20 && slot < 0; attempt += 1) {
        slot = character.items.findIndex(function (item) { return sameItemState(item, items[i]); });
        if (slot < 0) await sleep(250);
      }
      if (slot < 0) {
        results.push({ item: items[i], success: false, error: "delivered item did not arrive" });
        game_log("Could not equip delivered " + items[i].name + ": item did not arrive", "red");
        continue;
      }
      try {
        var definition = G.items[items[i].name] || {};
        var classDefinition = G.classes && G.classes[character.ctype] || {};
        var twoHanded = definition.wtype && classDefinition.doublehand &&
          classDefinition.doublehand[definition.wtype];
        // Adventure Land rejects a two-handed equip while an offhand remains
        // occupied. Remove the conflict first; the displaced item stays safely
        // in inventory.
        if (twoHanded && character.slots && character.slots.offhand)
          await unequip("offhand");
        await equip(slot);
        await sleep(250);
        var equippedNow = Object.keys(character.slots || {}).some(function (equippedSlot) {
          return sameItemState(character.slots[equippedSlot], items[i]);
        });
        if (!equippedNow) throw new Error("game did not confirm the equipped item");
        results.push({ item: items[i], success: true });
        game_log("Equipped delivered " + (G.items[items[i].name] && G.items[items[i].name].name || items[i].name), "#51D2E1");
      } catch (error) {
        results.push({ item: items[i], success: false,
          error: String(error.reason || error.message || error) });
        game_log("Could not equip delivered " +
          (G.items[items[i].name] && G.items[items[i].name].name || items[i].name) + ": " +
          String(error.reason || error.message || error), "red");
      }
    }
    return results;
  }

  async function merchantService(command) {
    var activity = [], deliveredWithdrawals = false, deliveredMerchantItems = [], luckRecipients = [];
    var handoff = { banked: [], kept: [], cleaned: [], gold: 0, cleanoutRemaining: false }, cargoRecorded = false;
    if (command.cargo && Array.isArray(command.cargo.bank)) {
      merchantPendingBank = command.cargo.bank.slice();
      merchantPendingGold = Number(command.cargo.gold) || 0;
    }
    async function ensureCurrentJob() {
      try { await request("/merchant/job/" + command.jobId); }
      catch (_error) { throw new Error("merchant job was cleared"); }
    }
    function mergeHandoff(next) {
      next = next || {};
      ["banked", "kept", "cleaned"].forEach(function (key) {
        (next[key] || []).forEach(function (entry) { handoff[key].push(entry); });
      });
      handoff.gold += Number(next.gold) || 0;
      handoff.cleanoutRemaining = handoff.cleanoutRemaining || !!next.cleanoutRemaining;
    }
    async function collectFromTarget(useTemporaryReserve) {
      await waitForPlayer(command.target, 10000);
      await requestMerchantHandoff("/merchant/handoff", { method: "POST", body: { jobId: command.jobId, target: command.target,
        // Delivery swaps may borrow two reserve slots, but retain one so the
        // lucky slot can be cleared even before the outbound delivery.
        capacity: Math.max(0, freeInventorySlots() - (useTemporaryReserve ? 1 : 3)) } });
      var deadline = Date.now() + 60000, current;
      do {
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        current = await request("/merchant/job/" + command.jobId);
        if (!current.handoff) await waitForPlayer(command.target, Math.max(1, Math.min(5000, deadline - Date.now())));
      } while (!current.handoff && Date.now() < deadline);
      if (!current.handoff) throw new Error("handoff timed out");
      mergeHandoff(current.handoff);
      // Incoming sends use the game's first empty slot, including the lucky
      // slot. Clear it at the receipt boundary, before continuing the itinerary.
      await merchantLuckyUpgrade().tidy(luckyUpgradeSlot);
      return current;
    }
    try {
      await ensureCurrentJob();
      await preloadStatScrolls(command, activity);
      // Pick up requested bank items and gold before meeting the character.
      var initialGoldShortage = Number.isInteger(command.goldTarget)
        ? Math.max(0, command.goldTarget - (command.targetGold || 0)) : 0;
      if ((command.withdrawals || []).length || initialGoldShortage) {
        await merchantVisitBank(command, activity);
        for (var w = 0; w < (command.withdrawals || []).length; w += 1) {
          var found = findBankItem(command.withdrawals[w].item, command.withdrawals[w].pack, command.withdrawals[w].slot);
          if (found) { await bankRetrieveConfirmed(found.pack, found.slot); deliveredWithdrawals = true; }
        }
        var shortage = initialGoldShortage;
        if (shortage) await withdrawMerchantCash(Math.min(shortage, Number(character.bank && character.bank.gold) || 0), command);
        try { await sortCurrentBankFloor(activity); }
        catch (deliverySortError) {
          activity.push({ level: "error", message: "Bank sorting failed after delivery withdrawal",
            details: String(deliverySortError.reason || deliverySortError.message || deliverySortError) });
        }
      }
      var deliveries = [];
      var restockSupplies = ["hp", "mp"].map(function (kind) {
        var supply = command.restock && command.restock[kind];
        if (!supply || !supply.max) return null;
        return { kind: kind, supply: supply, have: statusQuantity(command.targetInventory, supply.item) };
      }).filter(Boolean);
      // Either low-water mark starts one complete restock. Once the merchant
      // commits to the visit, bring every configured potion up to its maximum.
      var restockTriggered = restockSupplies.some(function (entry) {
        return entry.have <= entry.supply.min;
      });
      if (restockTriggered) for (var restockIndex = 0; restockIndex < restockSupplies.length; restockIndex += 1) {
          var restockEntry = restockSupplies[restockIndex];
          var supply = restockEntry.supply;
          var needed = Math.max(0, supply.max - restockEntry.have), seller = itemSeller(supply.item);
          if (needed > 0 && seller) {
            var buyQuantity = Math.max(0, needed - inventoryQuantity(supply.item));
            if (character.gold >= G.items[supply.item].g * buyQuantity) {
              if (buyQuantity) {
                await smart_move(find_npc(seller));
                await buyConfirmed(supply.item, buyQuantity);
              }
              deliveries.push({ name: supply.item, quantity: needed });
            } else activity.push({ level: "error", message: "Insufficient gold to restock " + command.target });
          }
      }
      var deliveredRestocks = {}, deliveredWithdrawalsByIndex = {};
      async function deliverToTarget() {
        for (var markedDeliveryIndex = 0; markedDeliveryIndex < (command.merchantDeliveries || []).length; markedDeliveryIndex += 1) {
          var deliveryMark = command.merchantDeliveries[markedDeliveryIndex];
          if (deliveredMerchantItems.indexOf(deliveryMark) >= 0) continue;
          var markedDeliverySlot = Number.isInteger(deliveryMark.slot) && sameItem(character.items[deliveryMark.slot], deliveryMark.item)
            ? deliveryMark.slot : findItem(deliveryMark.item);
          if (markedDeliverySlot < 0) {
            activity.push({level:"info", message:"Delivery blocked: " + deliveryMark.item.name + "; continuing collection"});
            continue;
          }
          try {
            if (!await sendReservedMerchantDelivery(command, deliveryMark, markedDeliverySlot)) continue;
          } catch (sendError) {
            if (String(sendError.message || sendError).toLowerCase() === "interrupted") throw sendError;
            activity.push({level:"error", message:"Delivery awaiting reconciliation: " + deliveryMark.item.name,
              details:String(sendError.message || sendError)});
            continue;
          }
          deliveredMerchantItems.push(deliveryMark);
          activity.push({ level: "success", message: "Delivered " + deliveryMark.item.name + " to " + command.target });
        }
        for (var d = 0; d < deliveries.length; d += 1) {
          if (deliveredRestocks[d]) continue;
          var deliverySlot = findInventoryItemByName(deliveries[d].name);
          if (deliverySlot >= 0) await merchantSendItem(command.target, deliverySlot, deliveries[d].quantity);
          deliveredRestocks[d] = true;
        }
        for (var r = 0; r < (command.withdrawals || []).length; r += 1) {
          if (deliveredWithdrawalsByIndex[r]) continue;
          var withdrawalSlot = findItem(command.withdrawals[r].item);
          if (withdrawalSlot < 0) continue;
          await merchantSendItem(command.target, withdrawalSlot, character.items[withdrawalSlot].q || 1);
          deliveredWithdrawalsByIndex[r] = true;
        }
      }
      await rendezvous(command.jobId, command.target);
      if (command.expandLeaderCluster) {
        await request("/merchant/leader-cluster", {
          method: "POST", body: { jobId: command.jobId },
        });
      }
      if (command.expandMarkedCluster) {
        await request("/merchant/marked-cluster", {
          method: "POST", body: { jobId: command.jobId },
        });
      }
      if (command.expandLuckCluster) {
        await request("/merchant/luck-cluster", {
          method: "POST", body: { jobId: command.jobId },
        });
      }
      await ensureCurrentJob();
      await waitForPlayer(command.target, 10000);
      try {
        await deliverToTarget();
      } catch (deliveryError) {
        var deliveryReason = String(deliveryError.reason || deliveryError.message || deliveryError).toLowerCase();
        if (deliveryReason !== "send_no_space") throw deliveryError;
        activity.push({ level: "info", message: command.target + " was full; collecting items before retrying delivery" });
        await collectFromTarget(true);
        await ensureCurrentJob();
        await waitForPlayer(command.target, 10000);
        await deliverToTarget();
      }
      await merchantLuckyUpgrade().tidy(luckyUpgradeSlot);
      if (command.castMerchantLuck && character.level >= 40 && G.skills.mluck) {
        if (await castMerchantLuck(character, 600000)) {
          luckRecipients.push(character.name);
          activity.push({ level: "success", message: "Cast Merchant's Luck on " + character.name });
        }
        var target = get_player(command.target);
        if (await castMerchantLuck(target, 600000)) {
          luckRecipients.push(command.target);
          activity.push({ level: "success", message: "Cast Merchant's Luck on " + command.target });
        }
      }
      var job = await collectFromTarget(false);
      await ensureCurrentJob();
      if (Number.isInteger(command.goldTarget) && command.goldTarget > 0) {
        await rendezvous(command.jobId, command.target);
        await send_gold(command.target, Math.min(command.goldTarget, character.gold));
        deliveredWithdrawals = true;
      }
      handoff.banked.forEach(function (mark) {
        merchantPendingBank.push({ owner: command.target, mark: mark });
      });
      handoff.cleaned.forEach(function (mark) {
        merchantPendingBank.push({ owner: command.target, mark: mark, autoCleanout: true });
      });
      merchantPendingGold += handoff.gold;
      cargoRecorded = true;
      if (handoff.gold) activity.push({ level: "info",
        message: "Collected " + handoff.gold.toLocaleString() + " gold from " + command.target });
      var canContinueCollection = !!job.nextCollectionTarget && freeInventorySlots() > 3;
      root.__merchantLogisticsHoldUntil = canContinueCollection ? Date.now() + 30000 : 0;
      var hasDeferredWork = canContinueCollection && ((command.upgrades || []).length > 0 ||
        (command.purchases || []).length > 0 || (command.compounds || []).length > 0 ||
        (command.autoCompounds || []).length > 0 || (command.statScrolls || []).length > 0);
      var statScrollsDelivered = false;
      var improvedItems = [];
      var improvementsCompleted = false;
      if (command.collectionOnly) {
        // Collection ends with retained cargo; processing is separately scheduled on the merchant.
      } else if (hasDeferredWork) {
        activity.push({ level: "info", message: "Deferred improvements until the Merchant's Luck party itinerary is complete",
          details: command.target });
      } else {
        statScrollsDelivered = await deliverStatScrolls(command, activity);
        await prepareManualImprovementScrolls(command, activity);
        improvedItems = await merchantImprove(command, activity);
        improvementsCompleted = true;
      }
      if (improvedItems.length) {
        await rendezvous(command.jobId, command.target);
        for (var improved = 0; improved < improvedItems.length; improved += 1) {
          var improvedSlot = findItem(improvedItems[improved]);
          var improvedItem = improvedSlot >= 0 && character.items[improvedSlot];
          if (improvedItem) await merchantSendItem(command.target, improvedSlot, improvedItem.q || 1);
        }
      }
      var bankedByCharacter = {};
      if (!canContinueCollection) {
        // This is the final return leg after servicing the player cluster.
        // Teleport out first, then walk from whichever town Town selected to
        // the bank. Never do this between players in the same itinerary.
        await merchantTownReturn(activity);
        await merchantVisitBank(command, activity);
        for (var b = 0; b < merchantPendingBank.length; b += 1) {
          var pending = merchantPendingBank[b];
          var wanted = pending.mark && pending.mark.item ? pending.mark.item : pending.mark;
          var bankSlot = findItem(wanted);
          if (bankSlot < 0) continue;
          // With no forced pack, bank_store first merges into a compatible
          // stack across every accessible pack, then uses the first free slot.
          await bankStoreFully(bankSlot);
          (bankedByCharacter[pending.owner] || (bankedByCharacter[pending.owner] = [])).push(pending.mark);
        }
        merchantPendingBank = [];
        if (merchantPendingGold) {
          var merchantTarget = Number.isInteger(command.merchantGoldTarget) ? command.merchantGoldTarget : 0;
          var goldDeposit = Math.min(merchantPendingGold, Math.max(0, character.gold - merchantTarget));
          await bank_deposit(goldDeposit);
          activity.push({ level: "success", message: "Deposited " + goldDeposit.toLocaleString() + " collected gold" });
        }
        merchantPendingGold = 0;
      }
      activity.push({ level: "success", message: "Serviced " + command.target });
      await request("/merchant/complete", { method: "POST", body: { jobId: command.jobId, success: true,
        banked: bankedByCharacter[command.target] || [], bankedByCharacter: bankedByCharacter,
        kept: handoff.kept,
        cargo: { bank: merchantPendingBank, gold: merchantPendingGold },
        withdrawalsDelivered: deliveredWithdrawals,
        confirmedWithdrawals: (command.withdrawals || []).filter(function (_, index) { return deliveredWithdrawalsByIndex[index]; }),
        upgradesResolved: !hasDeferredWork && (command.upgrades || []).length > 0,
        upgradeMarksResolved: (command.upgrades || []).filter(function(mark) { return (command._offeringWaits || []).indexOf(mark) < 0; }),
        compoundsResolved: !hasDeferredWork && (command.compounds || []).length > 0,
        statScrollsReady: statScrollsDelivered,
        purchasesResolved: !hasDeferredWork && (command.purchases || []).length > 0,
        autoCompoundsResolved: hasDeferredWork ? [] : command._autoCompoundsResolved || [],
        deferredWork: hasDeferredWork,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [],
        mluckRecipients: luckRecipients,
        merchantDeliveriesDelivered: deliveredMerchantItems, activity: activity } });
    } catch (error) {
      // Keep the gathering scheduler from taking over while the coordinator
      // retries or advances a multi-character logistics itinerary.
      root.__merchantLogisticsHoldUntil = Date.now() + 30000;
      if (!cargoRecorded) {
        handoff.banked.forEach(function (mark) { merchantPendingBank.push({ owner: command.target, mark: mark }); });
        handoff.cleaned.forEach(function (mark) { merchantPendingBank.push({ owner: command.target, mark: mark, autoCleanout: true }); });
        merchantPendingGold += handoff.gold;
      }
      var serviceReason = String(error.reason || error.message || error);
      activity.push({ level: serviceReason === "merchant_anniversary_reserved" || serviceReason.toLowerCase() === "interrupted" ? "info" : "error",
        message: serviceReason === "merchant_anniversary_reserved" ? "Service paused for anniversary" : serviceReason.toLowerCase() === "interrupted"
          ? "Service interrupted for " + command.target + "; retrying"
          : "Service failed for " + command.target, details: error.details || serviceReason });
      try {
        await request("/merchant/complete", { method: "POST", body: { jobId: command.jobId, success: false,
          error: String(error.reason || error.message || error),
          ...(serviceReason.indexOf("merchant job failed: wrong realm") === 0 ? {
            upgradesResolved: !!improvementsCompleted,
            compoundsResolved: !!improvementsCompleted,
            purchasesResolved: !!improvementsCompleted,
            autoCompoundsResolved: command._autoCompoundsResolved || [],
            statScrollsReady: !!statScrollsDelivered,
            pendingImprovedDeliveries: improvementsCompleted ? (improvedItems || []).slice(improved || 0).map(function(item){return {item:item};}) : [],
          } : {}),
          confirmedWithdrawals: (command.withdrawals || []).filter(function (_, index) { return deliveredWithdrawalsByIndex && deliveredWithdrawalsByIndex[index]; }),
          mluckRecipients: luckRecipients,
          merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
          merchantBanked: command._merchantBankedCompleted || [],
          cargo: { bank: merchantPendingBank, gold: merchantPendingGold },
          merchantDeliveriesDelivered: deliveredMerchantItems, activity: activity } });
      } catch (_completeError) { /* A cleared job is already terminal. */ }
      throw error;
    }
  }

  var recoveredDeliveryJournal = false;
  function merchantDeliveryJournal() {
    var journal = JSON.parse(root.localStorage.getItem("party-deliveries:" + character.name) || "{}");
    if (!recoveredDeliveryJournal) {
      Object.keys(journal).forEach(function(id) { if (journal[id].phase === "sending") journal[id].phase = "uncertain"; });
      recoveredDeliveryJournal = true;
      saveMerchantDeliveryJournal(journal);
    }
    return journal;
  }
  function saveMerchantDeliveryJournal(journal) {
    root.localStorage.setItem("party-deliveries:" + character.name, JSON.stringify(journal));
  }
  async function recoverMerchantDeliveryReceipts() {
    if (character.ctype !== "merchant" || root.__merchantDeliveryReceiptBusy) return;
    root.__merchantDeliveryReceiptBusy = true;
    try {
      var journal = merchantDeliveryJournal();
      for (var id of Object.keys(journal)) {
        var receipt = journal[id];
        if (receipt.phase === "sending") continue;
        await request("/merchant/delivery-receipt", {method:"POST", body:receipt});
        if (receipt.phase === "confirmed") {
          var latest = merchantDeliveryJournal(); delete latest[id]; saveMerchantDeliveryJournal(latest);
        }
      }
    } finally { root.__merchantDeliveryReceiptBusy = false; }
  }
  async function sendReservedMerchantDelivery(command, mark, slot) {
    if (!mark.id) throw new Error("Delivery identity unavailable; waiting for refreshed command");
    var journal = merchantDeliveryJournal();
    if (journal[mark.id]) return false;
    var receipt = {deliveryReceipt:true, character:character.name, target:command.target,
      deliveryId:mark.id, phase:"uncertain"};
    journal[mark.id] = receipt; saveMerchantDeliveryJournal(journal);
    // Persist uncertainty before the game mutation; an interrupted send is never blindly repeated.
    var admitted = await request("/merchant/delivery-receipt", {method:"POST", body:receipt});
    if (admitted && admitted.pending === false) {
      delete journal[mark.id]; saveMerchantDeliveryJournal(journal); return false;
    }
    receipt.phase = "sending"; journal[mark.id] = receipt; saveMerchantDeliveryJournal(journal);
    try {
      await merchantSendItem(command.target, slot, mark.item.q || 1);
      receipt.phase = "confirmed";
    } catch (error) {
      receipt.phase = "uncertain";
      throw error;
    } finally {
      journal = merchantDeliveryJournal(); journal[mark.id] = receipt; saveMerchantDeliveryJournal(journal);
    }
    try { await recoverMerchantDeliveryReceipts(); } catch (_) { /* Durable receipt retries on the next status poll. */ }
    return true;
  }

  async function prepareBankUpgrades(command, activity) {
    if (!(command.bankUpgradeRules || []).length) return;
    await merchantVisitBank(command, activity);
    command.upgrades = command.upgrades || [];
    var added = 0;
    for (var ruleIndex = 0; ruleIndex < command.bankUpgradeRules.length && added < 3; ruleIndex += 1) {
      var rule = command.bankUpgradeRules[ruleIndex];
      if (!G.items[rule.name] || !G.items[rule.name].upgrade) continue;
      var target = rule.level + rule.tiers;
      var planned = command.upgrades.filter(function (mark) {
        return mark.item.name === rule.name && (mark.item.level || 0) + mark.tiers >= target;
      }).length;
      var needed = rule.quantity === -1 ? 3 : Math.max(0, rule.quantity - planned);
      function available(item) { return item && !item.l && item.name === rule.name && (item.level || 0) === rule.level; }
      while (needed > 0 && added < 3) {
        var slot = character.items.findIndex(function (item, index) {
          return available(item) && !command.upgrades.some(function (mark) { return mark.slot === index; });
        });
        if (slot < 0) {
          if (character.esize <= 3) break;
          var found = null;
          Object.keys(character.bank || {}).some(function (pack) {
            if (!Array.isArray(character.bank[pack])) return false;
            var index = character.bank[pack].findIndex(available);
            if (index < 0) return false;
            found = { pack: pack, slot: index }; return true;
          });
          if (!found) break;
          await bank_retrieve(found.pack, found.slot);
          slot = character.items.findIndex(function (item, index) {
            return available(item) && !command.upgrades.some(function (mark) { return mark.slot === index; });
          });
          if (slot < 0) throw new Error("Bank upgrade withdrawal was not confirmed");
        }
        command.upgrades.push({ slot: slot, item: fingerprint(character.items[slot]), tiers: rule.tiers, auto: true });
        activity.push({ level: "info", message: "Reserved " + rule.name + " for upgrading to +" + target });
        needed--; added++;
      }
    }
  }

  async function merchantSelfImprove(command) {
    var activity = [];
    var staleStatScrolls = [];
    async function restoreAnyEquippedUpgrades() {
      for (var index = 0; index < (command.upgrades || []).length; index += 1) {
        var mark = command.upgrades[index];
        if (!mark.equipped || typeof mark.slot !== "string" || character.slots[mark.slot]) continue;
        var completed = (command._upgradeReturns || []).find(function (entry) { return entry.slot === mark.slot; });
        var slot = completed ? findItem(completed.item) : findItem(mark.item);
        if (slot < 0) {
          var candidates = [];
          character.items.forEach(function (item, itemSlot) {
            if (item && item.name === mark.item.name) candidates.push({ item: item, slot: itemSlot });
          });
          candidates.sort(function (first, second) {
            return (Number(second.item.level) || 0) - (Number(first.item.level) || 0);
          });
          if (candidates.length) slot = candidates[0].slot;
        }
        if (slot >= 0) await equip(slot, mark.slot);
      }
    }
    try {
      // Validate stat-scroll targets before withdrawing gold or buying any
      // scrolls. Inventory marks are tied to the clicked slot when possible;
      // equipped marks must still contain the exact state that was marked.
      command.statScrolls = (command.statScrolls || []).filter(function (mark) {
        var valid = mark && (Number.isInteger(mark.slot)
          ? findMarkedInventoryItem(mark) >= 0
          : typeof mark.slot === "string" && sameItemState(character.slots[mark.slot], mark.item));
        if (!valid) {
          staleStatScrolls.push(mark);
          activity.push({ level: "error", message: "Removed stale stat-scroll request for " +
            (mark && mark.item && mark.item.name || "equipment"),
            details: "The exact clicked item changed or moved; the request was removed and no stat scroll was purchased." });
        }
        return valid;
      });
      for (var upgradeIndex = 0; upgradeIndex < (command.upgrades || []).length; upgradeIndex += 1) {
        var equippedUpgrade = command.upgrades[upgradeIndex];
        if (equippedUpgrade.equipped && typeof equippedUpgrade.slot === "string" &&
            sameItem(character.slots[equippedUpgrade.slot], equippedUpgrade.item)) {
          await unequip(equippedUpgrade.slot);
          activity.push({ level: "info", message: "Unequipped " + equippedUpgrade.item.name + " for upgrading" });
        }
      }
      for (var statIndex = 0; statIndex < (command.statScrolls || []).length; statIndex += 1) {
        var statMark = command.statScrolls[statIndex];
        if (typeof statMark.slot === "string" && sameItemState(character.slots[statMark.slot], statMark.item))
          await unequip(statMark.slot);
      }
      if ((command.bankUpgradeRules || []).length) await prepareBankUpgrades(command, activity);
      await preloadStatScrolls(command, activity);
      await prepareManualImprovementScrolls(command, activity);
      await applyStatScrolls(command, activity);
      command._statScrollsResolved = (command._statScrollsResolved || []).concat(staleStatScrolls);
      await merchantImprove(command, activity);
      if ((command.autoCompounds || []).length) await globalThis.partyStoreCompoundLeftovers({
        refresh: function () { return refreshCompoundProtection(command); },
        rules: function () { return command.autoCompounds || []; },
        inventorySize: function () { return character.items.length; },
        stock: function () {
          var bank = [];
          Object.keys(character.bank || {}).forEach(function (pack) {
            if (Array.isArray(character.bank[pack])) character.bank[pack].forEach(function (item) {
              if (item) bank.push({item: item, craftLocation: pack});
            });
          });
          return compoundAvailableStock(command, bank);
        },
        visitBank: async function () { await merchantOperationStage(command, "storing"); return merchantVisitBank(command, activity); },
        deposit: function (slot) { return bankStoreFully(slot); },
        log: function (message) { activity.push({level: "info", message: message}); },
      });

      for (var restoreIndex = 0; restoreIndex < (command._statReturns || []).length; restoreIndex += 1) {
        var restore = command._statReturns[restoreIndex], restoreSlot = findItem(restore.item);
        if (restoreSlot >= 0) await equip(restoreSlot, restore.slot);
      }
      for (var upgradeRestoreIndex = 0; upgradeRestoreIndex < (command._upgradeReturns || []).length; upgradeRestoreIndex += 1) {
        var upgradeRestore = command._upgradeReturns[upgradeRestoreIndex];
        var upgradedSlot = findItem(upgradeRestore.item);
        if (upgradedSlot >= 0) {
          await equip(upgradedSlot, upgradeRestore.slot);
          activity.push({ level: "success", message: "Re-equipped upgraded " + upgradeRestore.item.name });
        }
      }
      await restoreAnyEquippedUpgrades();
      activity.push({ level: "success", message: "Finished merchant-owned upgrades and compounds" });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, banked: [], bankedByCharacter: {}, kept: [],
        upgradesResolved: (command.upgrades || []).length > 0,
        upgradeMarksResolved: (command.upgrades || []).filter(function(mark) { return (command._offeringWaits || []).indexOf(mark) < 0; }),
        statScrollsResolved: command._statScrollsResolved || [],
        compoundsResolved: (command.compounds || []).length > 0,
        autoCompoundsResolved: command.sharedBankImprovements ? [] : command._autoCompoundsResolved || [],
        purchasesResolved: (command.purchases || []).length > 0,
        withdrawalsDelivered: false,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [], activity: activity,
      }});
    } catch (error) {
      try { await restoreAnyEquippedUpgrades(); }
      catch (restoreError) {
        activity.push({ level: "error", message: "Could not restore merchant equipment",
          details: String(restoreError.reason || restoreError.message || restoreError) });
      }
      var storagePause = String(error.reason || error.message || error) === "bankboi_pending";
      activity.push({ level: storagePause ? "info" : "error",
        message: storagePause ? "Merchant-owned improvement paused for Bankboi" : "Merchant-owned improvement failed",
        details: String(error.reason || error.message || error) });
      try {
        await request("/merchant/complete", { method: "POST", body: {
          jobId: command.jobId, success: false,
          error: String(error.reason || error.message || error),
          merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
          merchantBanked: command._merchantBankedCompleted || [], activity: activity,
        }});
      } catch (_completeError) { /* The job was already cleared. */ }
      throw error;
    }
  }

  async function merchantCommerce(command) {
    var activity = [], order = command.order || {}, buys = order.buys || [], crafts = order.crafts || [];
    var resumeState = command.resumeState || {};
    var prepared = resumeState.phase === "leveling" || resumeState.phase === "crafting";
    // Craft ingredients must survive the bank errands that prepare this order.
    command.merchantBankMarked = (command.merchantBankMarked || []).filter(function (mark) {
      var item = mark.item || mark;
      return !(order.requirements || []).some(function (need) {
        return item.name === need.id && (item.level || 0) === (need.level || 0);
      });
    });
    async function commerceMove(destination) {
      // smart_move can remain pending when asked to path to an NPC whose
      // destination point we already occupy. Commerce revisits the scroll and
      // upgrade NPCs after every failed item, so treat interaction range as
      // arrival instead of starting another smart path.
      if (destination && typeof destination === "object" &&
          (!destination.map || destination.map === character.map) &&
          Number.isFinite(Number(destination.x)) && Number.isFinite(Number(destination.y)) &&
          Math.hypot(character.x - Number(destination.x), character.y - Number(destination.y)) <= 35)
        return;
      await smart_move(destination);
    }
    async function checkpoint(state) {
      var result = await request("/merchant/checkpoint", { method: "POST", body: {
        jobId: command.jobId, state: state,
      }});
      if (root.__merchantActiveJob && root.__merchantActiveJob.jobId === command.jobId)
        root.__merchantActiveJob.progressAt = Date.now();
      if (result && result.yield) {
        var yielded = new Error("merchant_yield");
        yielded.reason = "merchant_yield";
        throw yielded;
      }
    }
    async function liveMerchantActivity(entry) {
      activity.push(entry);
      try {
        await request("/merchant/activity", { method: "POST", body: {
          character: character.name, jobId: command.jobId,
          message: entry.message, level: entry.level || "info",
          details: entry.details,
        }});
        var buffered = activity.indexOf(entry);
        if (buffered >= 0) activity.splice(buffered, 1);
      } catch (_activityError) { /* Final job completion still persists the buffered entry. */ }
    }
    try {
      var sourceNames = prepared ? [] : Object.keys(order.sources || {});
      for (var sourceIndex = 0; sourceIndex < sourceNames.length; sourceIndex += 1) {
        var source = sourceNames[sourceIndex];
        await rendezvous(command.jobId, source);
        await requestMerchantHandoff("/merchant/order-handoff", { method: "POST", body: { jobId: command.jobId, target: source } });
        var handoffDeadline = Date.now() + 90000, handoffJob;
        do {
          await new Promise(function (resolve) { setTimeout(resolve, 750); });
          handoffJob = await request("/merchant/job/" + command.jobId + "?target=" + encodeURIComponent(source));
        } while ((!handoffJob.orderHandoff || handoffJob.orderHandoff.character !== source) && Date.now() < handoffDeadline);
        if (!handoffJob.orderHandoff || handoffJob.orderHandoff.character !== source)
          throw new Error("Material handoff timed out for " + source);
        await merchantLuckyUpgrade().tidy(luckyUpgradeSlot);
      }

      var catalog = merchantCatalog(), prices = {};
      catalog.buyable.forEach(function (item) { prices[item.id] = item.cost; });
      catalog.craftable.forEach(function (item) { prices["craft:" + item.id] = item.cost; });
      function upgradeScrollPlan(itemId, targetLevel, quantity) {
        var plan = {};
        for (var copy = 0; copy < quantity; copy += 1) {
          for (var level = 0; level < targetLevel; level += 1) {
            var scrollName = "scroll" + item_grade({ name: itemId, level: level });
            plan[scrollName] = (plan[scrollName] || 0) + 1;
          }
        }
        return plan;
      }
      var initialScrollNeeds = {};
      buys.forEach(function (line) {
        var definition = G.items[line.id] || {}, targetLevel = Number(line.level) || 0;
        if (!definition.upgrade || !targetLevel) return;
        var plan = upgradeScrollPlan(line.id, targetLevel, Number(line.quantity) || 1);
        Object.keys(plan).forEach(function (name) {
          initialScrollNeeds[name] = (initialScrollNeeds[name] || 0) + plan[name];
        });
      });
      var requiredGold = buys.reduce(function (sum, line) { return sum + (prices[line.id] || 0) * line.quantity; }, 0) +
        crafts.reduce(function (sum, line) { return sum + (prices["craft:" + line.id] || 0) * line.quantity; }, 0);

      async function retrieveBankQuantity(allocation) {
        if (!/^items\d+$/.test(allocation.pack)) throw new Error("Crafting storage is not ready");
        var found = findBankItem(allocation.item, allocation.pack, allocation.slot);
        if (!found) return; // The live requirements pass resolves moved or exhausted allocations.
        var bankItem = character.bank[found.pack][found.slot];
        var available = itemQuantity(bankItem);
        var wanted = Math.min(available, Math.max(1, Number(allocation.quantity) || 1));
        var emptySlot = character.items.findIndex(function (item) { return !item; });
        if (emptySlot < 0) throw new Error("Merchant inventory has no room for crafting material");
        await bank_retrieve(found.pack, found.slot, emptySlot);
        if (available <= wanted) return;
        if (freeInventorySlots() < 1) throw new Error("Merchant needs two free slots to split a bank material stack");
        var beforeSplit = character.items.map(function (item) { return JSON.stringify(fingerprint(item)); });
        await split(emptySlot, wanted);
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        var wantedSlot = character.items.findIndex(function (item, index) {
          return index !== emptySlot && beforeSplit[index] !== JSON.stringify(fingerprint(item)) &&
            sameItem(item, allocation.item) && itemQuantity(item) === wanted;
        });
        if (wantedSlot < 0) throw new Error("Could not split exact crafting quantity for " + allocation.item.name);
        // split() leaves the excess in the original slot and the requested
        // quantity in the new slot. Return only the excess to the bank.
        await bankStoreFully(emptySlot);
      }

      async function retrieveMissingCraftMaterials(requirements) {
        for (var need of requirements) {
          var remaining = Math.max(0, need.quantity - exactInventoryQuantity(need.id, need.level));
          while (remaining > 0) {
            // Scroll stacks omit level; recipes describe them as level zero.
            var found = findBankItem({ name: need.id, level: need.level || 0 }, undefined, undefined, true);
            if (!found) break;
            var liveItem = character.bank[found.pack][found.slot];
            var before = exactInventoryQuantity(need.id, need.level);
            await retrieveBankQuantity({ pack: found.pack, slot: found.slot,
              item: fingerprint(liveItem), quantity: remaining });
            var after = exactInventoryQuantity(need.id, need.level);
            if (after <= before) throw new Error("Crafting withdrawal made no progress: " + need.id);
            remaining = Math.max(0, need.quantity - after);
          }
        }
      }

      if (!prepared) await merchantVisitBank(command, activity);
      for (var bankIndex = 0; bankIndex < (order.bank || []).length; bankIndex += 1) {
        if (prepared) break;
        var allocation = order.bank[bankIndex];
        var requirement = (order.requirements || []).find(function (entry) {
          return entry.id === allocation.item.name && (entry.level || 0) === (allocation.item.level || 0);
        });
        var remaining = requirement ? Math.max(0, requirement.quantity -
          exactInventoryQuantity(requirement.id, requirement.level)) : allocation.quantity;
        if (!remaining) continue;
        await retrieveBankQuantity(Object.assign({}, allocation, { quantity: Math.min(allocation.quantity, remaining) }));
        activity.push({ level: "success", message: "Withdrew " + (allocation.quantity || 1) + " × " +
          (G.items[allocation.item.name] && G.items[allocation.item.name].name || allocation.item.name) + " for crafting" });
      }
      // Inventory counted when the order was queued may have been banked while
      // other jobs ran. Resolve the outstanding quantity against current stock.
      if (!prepared) await retrieveMissingCraftMaterials(order.requirements || []);
      // Reuse scrolls already held by the merchant or stored in any bank pack.
      // Retrieve whole stacks; extras are deliberately retained for later jobs.
      for (var savedScrollName of Object.keys(initialScrollNeeds)) {
        if (prepared) break;
        var savedNeeded = Math.max(0, initialScrollNeeds[savedScrollName] - inventoryQuantity(savedScrollName));
        while (savedNeeded > 0) {
          var savedScroll = findBankItem({ name: savedScrollName, level: 0 });
          if (!savedScroll) break;
          var savedItem = character.bank[savedScroll.pack][savedScroll.slot];
          await bank_retrieve(savedScroll.pack, savedScroll.slot);
          savedNeeded = Math.max(0, savedNeeded - itemQuantity(savedItem));
        }
        initialScrollNeeds[savedScrollName] = Math.max(0,
          initialScrollNeeds[savedScrollName] - inventoryQuantity(savedScrollName));
        requiredGold += initialScrollNeeds[savedScrollName] *
          ((G.items[savedScrollName] && G.items[savedScrollName].g) || 0);
      }
      // Material and saved-scroll retrievals happen after merchantVisitBank's
      // entry errands, so close the resulting gaps before leaving the teller.
      try { if (!prepared) await sortCurrentBankFloor(activity); }
      catch (commerceSortError) {
        activity.push({ level: "error", message: "Bank sorting failed after crafting withdrawals",
          details: String(commerceSortError.reason || commerceSortError.message || commerceSortError) });
      }
      function exactInventoryQuantity(itemId, level) {
        return character.items.reduce(function (total, item) {
          return total + (item && item.name === itemId && (item.level || 0) === (level || 0) ? itemQuantity(item) : 0);
        }, 0);
      }
      var materialBuys = [];
      (prepared ? [] : (order.requirements || [])).forEach(function (requirement) {
        var missing = Math.max(0, Number(requirement.quantity) - exactInventoryQuantity(requirement.id, requirement.level));
        if (!missing) return;
        if ((requirement.level || 0) !== 0 || !itemSeller(requirement.id))
          throw new Error("Crafting material is unavailable: " + requirement.id + " +" + (requirement.level || 0));
        materialBuys.push({ id: requirement.id, quantity: missing });
        requiredGold += missing * (G.items[requirement.id] && G.items[requirement.id].g || 0);
      });
      if (!prepared && character.gold < requiredGold) {
        var shortage = requiredGold - character.gold;
        if ((Number(character.bank && character.bank.gold) || 0) < shortage) throw new Error("Insufficient bank gold for order");
        await withdrawMerchantCash(shortage, command);
      }

      for (var materialIndex = 0; materialIndex < materialBuys.length; materialIndex += 1) {
        var materialPurchase = materialBuys[materialIndex];
        var materialSeller = itemSeller(materialPurchase.id);
        await commerceMove(find_npc(materialSeller));
        await buyConfirmed(materialPurchase.id, materialPurchase.quantity);
        activity.push({ level: "success", message: "Bought " + materialPurchase.quantity + " × " +
          materialPurchase.id + " for crafting" });
      }

      var activePurchase = null, activeSpent = 0;
      function chargePurchase(amount) {
        if (activePurchase && Number.isFinite(Number(activePurchase.budget)) &&
            activeSpent + amount > Number(activePurchase.budget))
          throw new Error("90% estimated budget exhausted for " + activePurchase.id +
            " (spent " + activeSpent.toLocaleString() + " of " + Number(activePurchase.budget).toLocaleString() + " gold)");
        activeSpent += amount;
      }
      async function ensureCommerceGold(amount) {
        if (character.gold >= amount) return;
        await merchantVisitBank(command, activity);
        var shortage = amount - character.gold;
        if ((Number(character.bank && character.bank.gold) || 0) < shortage)
          throw new Error("Insufficient bank gold to finish automated item leveling");
        await withdrawMerchantCash(shortage, command);
      }
      async function buyOne(itemId) {
        var seller = itemSeller(itemId), price = G.items[itemId] && G.items[itemId].g || 0;
        if (!seller) throw new Error("No gold seller found for " + itemId);
        chargePurchase(price);
        await ensureCommerceGold(price);
        await commerceMove(find_npc(seller)); await buyConfirmed(itemId, 1);
      }
      async function ensureScroll(scrollName) {
        var slot = findInventoryItemByName(scrollName);
        if (slot >= 0) return slot;
        var price = G.items[scrollName] && G.items[scrollName].g || 0;
        chargePurchase(price);
        await ensureCommerceGold(price);
        await commerceMove(find_npc("scrolls")); await buyConfirmed(scrollName, 1);
        return findInventoryItemByName(scrollName);
      }
      async function ensureUpgradeScrollBatch(itemId, targetLevel, reserveGold) {
        var plan = upgradeScrollPlan(itemId, targetLevel, 1), missing = {}, totalCost = 0;
        Object.keys(plan).forEach(function (name) {
          missing[name] = Math.max(0, plan[name] - inventoryQuantity(name));
          totalCost += missing[name] * ((G.items[name] && G.items[name].g) || 0);
        });
        Object.keys(missing).forEach(function (name) {
          if (missing[name]) chargePurchase(missing[name] * ((G.items[name] && G.items[name].g) || 0));
        });
        // Fund the replacement base item in the same bank visit as the whole
        // scroll batch so a failed attempt never causes a second cash run.
        await ensureCommerceGold(totalCost + (Number(reserveGold) || 0));
        if (!totalCost) return;
        await commerceMove(find_npc("scrolls"));
        for (var name of Object.keys(missing)) {
          if (missing[name]) await buyConfirmed(name, missing[name]);
        }
        activity.push({ level: "success", message: "Bought upgrade scroll batch for " + itemId +
          " +" + targetLevel + ": " + Object.keys(missing).filter(function (name) { return missing[name]; })
            .map(function (name) { return missing[name] + " × " + name; }).join(", ") });
      }
      function levelSlots(itemId, level) {
        var slots = [];
        character.items.forEach(function (item, slot) {
          if (item && item.name === itemId && (item.level || 0) === level) slots.push(slot);
        });
        return slots;
      }
      for (var buyIndex = resumeState.phase === "crafting" ? buys.length : resumeState.phase === "leveling" ? Number(resumeState.buyIndex) || 0 : 0;
           buyIndex < buys.length; buyIndex += 1) {
        var purchase = buys[buyIndex], definition = G.items[purchase.id] || {}, targetLevel = Number(purchase.level) || 0;
        activePurchase = purchase;
        activeSpent = resumeState.phase === "leveling" && buyIndex === Number(resumeState.buyIndex)
          ? Number(resumeState.spent) || 0 : 0;
        if (!targetLevel) {
          chargePurchase((definition.g || 0) * purchase.quantity);
          await commerceMove(find_npc(itemSeller(purchase.id)));
          await buyConfirmed(purchase.id, purchase.quantity);
          activity.push({ level: "success", message: "Bought " + purchase.quantity + " × " + purchase.id });
          await checkpoint({ phase: "leveling", buyIndex: buyIndex + 1, attempts: 0, spent: 0 });
          continue;
        }
        var startingResults = resumeState.phase === "leveling" && buyIndex === Number(resumeState.buyIndex) &&
          Number.isFinite(Number(resumeState.startingResults)) ? Number(resumeState.startingResults) :
          levelSlots(purchase.id, targetLevel).length;
        // Count results produced by this order, not every matching item in the
        // merchant inventory. Inventory totals are not stable ownership: an
        // older +N item can arrive between checkpoints and a completed result
        // can survive a hot reload. Persist an explicit per-line count.
        var completedResults = resumeState.phase === "leveling" && buyIndex === Number(resumeState.buyIndex) &&
          Number.isFinite(Number(resumeState.completedResults))
          ? Math.max(0, Number(resumeState.completedResults))
          : Math.max(0, levelSlots(purchase.id, targetLevel).length - startingResults);
        // Never trust a persisted completion counter unless the completed
        // target-level items still exist in inventory. This prevents an
        // intermediate survivor from completing an order after a hot reload.
        completedResults = Math.min(completedResults,
          Math.max(0, levelSlots(purchase.id, targetLevel).length - startingResults));
        var attempts = resumeState.phase === "leveling" && buyIndex === Number(resumeState.buyIndex)
          ? Number(resumeState.attempts) || 0 : 0;
        while (completedResults < purchase.quantity) {
          attempts += 1;
          var attemptLimit = Number(purchase.attempts || purchase.maxAttempts) || 0;
          if (!attemptLimit && attempts > 10000) throw new Error("Automated leveling safety limit reached for " + purchase.id);
          if (attemptLimit && attempts > attemptLimit)
            throw new Error("90% attempt allowance exhausted for " + purchase.id + " after spending " +
              activeSpent.toLocaleString() + " of " + Number(purchase.budget).toLocaleString() + " gold");
          if (definition.upgrade) {
            // `var` is function-scoped. Explicitly clear the previous attempt's
            // slot after a destroyed item or the retry loop keeps a stale slot,
            // skips buying a replacement, and spins without making progress.
            var itemSlot = undefined;
            if (resumeState.phase === "leveling" && buyIndex === Number(resumeState.buyIndex) &&
                resumeState.activeItem) {
              var resumedSlot = findItem(resumeState.activeItem);
              if (resumedSlot >= 0 && character.items[resumedSlot] &&
                  (character.items[resumedSlot].level || 0) <= targetLevel) itemSlot = resumedSlot;
            }
            if (itemSlot === undefined) {
              await ensureUpgradeScrollBatch(purchase.id, targetLevel, definition.g || 0);
              await buyOne(purchase.id);
              itemSlot = levelSlots(purchase.id, 0).slice(-1)[0];
            }
            await commerceMove(find_npc("newupgrade"));
            while (itemSlot !== undefined && character.items[itemSlot] && (character.items[itemSlot].level || 0) < targetLevel) {
              var attemptedFromLevel = Number(character.items[itemSlot].level) || 0;
              var attemptedToLevel = attemptedFromLevel + 1;
              var upgradeScroll = "scroll" + item_grade(character.items[itemSlot]);
              var upgradeScrollSlot = await ensureScroll(upgradeScroll);
              try {
                var confirmedUpgrade = await upgradeConfirmed(itemSlot, upgradeScrollSlot,
                  purchase.id, attemptedToLevel);
                if (!confirmedUpgrade || confirmedUpgrade.slot !== itemSlot ||
                    !character.items[itemSlot] || character.items[itemSlot].name !== purchase.id ||
                    (Number(character.items[itemSlot].level) || 0) !== attemptedToLevel)
                  throw new Error("Upgrade confirmation was lost for slot " + itemSlot +
                    " at +" + attemptedToLevel);
              }
              catch (error) {
                if (error.code === "lucky_slot_unavailable") throw error;
                var survived = character.items[itemSlot] && character.items[itemSlot].name === purchase.id;
                var displayName = definition.name || purchase.id;
                await liveMerchantActivity({ level: "error", message: survived
                  ? displayName + " failed upgrading to +" + attemptedToLevel
                  : displayName + " went poof upgrading to +" + attemptedToLevel,
                  details: String(error.reason || error.message || error) });
              }
              await checkpoint({ phase: "leveling", buyIndex: buyIndex, startingResults: startingResults,
                completedResults: completedResults, attempts: attempts, spent: activeSpent,
                activeItem: character.items[itemSlot] && character.items[itemSlot].name === purchase.id
                  ? fingerprint(character.items[itemSlot]) : null });
              if (!character.items[itemSlot] || character.items[itemSlot].name !== purchase.id) break;
            }
            if (itemSlot !== undefined && character.items[itemSlot] &&
                character.items[itemSlot].name === purchase.id &&
                (Number(character.items[itemSlot].level) || 0) === targetLevel) {
              completedResults += 1;
              await checkpoint({ phase: "leveling", buyIndex: buyIndex, startingResults: startingResults,
                completedResults: completedResults, attempts: attempts, spent: activeSpent, activeItem: null });
            }
          } else if (definition.compound) {
            await buyOne(purchase.id);
            var combined = true;
            while (combined) {
              combined = false;
              for (var compoundLevel = 0; compoundLevel < targetLevel; compoundLevel += 1) {
                var candidates = levelSlots(purchase.id, compoundLevel);
                if (candidates.length < 3) continue;
                var compoundScroll = "cscroll" + item_grade(character.items[candidates[0]]);
                var compoundScrollSlot = await ensureScroll(compoundScroll);
                await commerceMove(find_npc("newupgrade"));
                try { await compoundConfirmed(candidates[0], candidates[1], candidates[2], compoundScrollSlot); }
                catch (error) { activity.push({ level: "error", message: purchase.id + " compound attempt failed",
                  details: String(error.reason || error.message || error) }); }
                await checkpoint({ phase: "leveling", buyIndex: buyIndex, startingResults: startingResults,
                  completedResults: completedResults, attempts: attempts, spent: activeSpent });
                combined = true;
                break;
              }
            }
          } else throw new Error(purchase.id + " cannot be leveled");
          if (definition.compound) {
            var producedCompounds = Math.max(0,
              levelSlots(purchase.id, targetLevel).length - startingResults);
            completedResults = Math.max(completedResults, producedCompounds);
          }
        }
        var verifiedResults = Math.max(0, levelSlots(purchase.id, targetLevel).length - startingResults);
        if (verifiedResults < purchase.quantity || completedResults < purchase.quantity)
          throw new Error("Buy-and-level completion check failed for " + purchase.id + " +" + targetLevel +
            ": expected " + purchase.quantity + ", verified " + verifiedResults + " in inventory");
        activity.push({ level: "success", message: "Completed " + purchase.quantity + " × " + purchase.id + " at +" + targetLevel +
          " for " + activeSpent.toLocaleString() + " / " + Number(purchase.budget || activeSpent).toLocaleString() + " estimated gold" });
        await checkpoint({ phase: "leveling", buyIndex: buyIndex + 1, attempts: 0, spent: 0 });
      }
      for (var craftIndex = resumeState.phase === "crafting" ? Number(resumeState.craftIndex) || 0 : 0; craftIndex < crafts.length; craftIndex += 1) {
        var craftLine = crafts[craftIndex];
        var craftRecipe = G.craft[craftLine.id] || {};
        // recipe.quest names the NPC role servicing this recipe; it is not a
        // persistent quest flag. Material Collector recipes belong to Cole.
        var craftProvider = craftRecipe.quest || "craftsman";
        var craftNpc = find_npc(craftProvider);
        if (!craftNpc) throw new Error("Could not find required recipe provider: " + craftProvider);
        var startingCraft = resumeState.phase === "crafting" && craftIndex === Number(resumeState.craftIndex)
          ? Number(resumeState.crafted) || 0 : 0;
        var remainingMaterials = (craftRecipe.items || []).map(function (material) {
          return { id: material[1], level: material[2] || 0,
            quantity: material[0] * (craftLine.quantity - startingCraft) };
        });
        if (prepared && remainingMaterials.some(function (need) {
          return exactInventoryQuantity(need.id, need.level) < need.quantity;
        })) {
          await merchantVisitBank(command, activity);
          await retrieveMissingCraftMaterials(remainingMaterials);
        }
        (craftRecipe.items || []).forEach(function (material) {
          var needed = material[0] * (craftLine.quantity - startingCraft);
          if (exactInventoryQuantity(material[1], material[2] || 0) < needed)
            throw new Error("Crafting material is unavailable: " + material[1] + " +" + (material[2] || 0));
        });
        await checkpoint({ phase: "crafting", craftIndex: craftIndex, crafted: startingCraft });
        await commerceMove(craftNpc);
        if (craftRecipe.quest) activity.push({ level: "info", message: "Visited " +
          ((G.npcs[craftProvider] && G.npcs[craftProvider].name) || craftProvider) +
          " for required recipe " + craftLine.id });
        for (var count = startingCraft; count < craftLine.quantity; count += 1) {
          await auto_craft(craftLine.id);
          await checkpoint({ phase: "crafting", craftIndex: craftIndex, crafted: count + 1 });
        }
        activity.push({ level: "success", message: "Crafted " + craftLine.quantity + " × " + craftLine.id });
      }
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [], activity: activity,
      }});
    } catch (error) {
      if (error && (error.reason === "merchant_yield" || error.message === "merchant_yield")) return;
      activity.push({ level: "error", message: "Merchant order failed", details: String(error.reason || error.message || error) });
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [], activity: activity,
      }}); } catch (_completeError) { /* The job was already cleared. */ }
      throw error;
    }
  }

  function findExchangeBankItem(name, level) {
    var packs = Object.keys(character.bank || {});
    for (var p = 0; p < packs.length; p += 1) {
      var entries = character.bank[packs[p]];
      if (!Array.isArray(entries)) continue;
      for (var slot = 0; slot < entries.length; slot += 1) {
        var item = entries[slot];
        if (item && item.name === name && (Number(item.level) || 0) === (Number(level) || 0))
          return { pack: packs[p], slot: slot };
      }
    }
    return null;
  }

  async function merchantExchange(command) {
    var activity = [], lines = [], rewards = (command.exchangeRewards || []).slice();
    (command.exchanges || []).forEach(function (line) {
      var existing = lines.find(function (candidate) { return candidate.id === line.id &&
        candidate.reward === line.reward &&
        (Number(candidate.level) || 0) === (Number(line.level) || 0); });
      var quantity = Math.max(1, Number(line.quantity) || 1);
      if (existing) existing.quantity += quantity;
      else lines.push({ id: line.id, level: Number(line.level) || 0, quantity: quantity,
        ...(line.reward ? { reward: line.reward } : {}) });
    });
    // Auto-bank marks must not send newly retrieved exchange materials straight
    // back to BankBoi during the bank errands that precede this order.
    command.merchantBankMarked = (command.merchantBankMarked || []).filter(function (mark) {
      var item = mark.item || mark;
      return !lines.some(function (line) { return item.name === line.id &&
        (Number(item.level) || 0) === line.level; });
    });
    function exchangeNpc(itemId) {
      var definition = G.items[itemId] || {}, npc = "exchange";
      if (definition.quest) Object.keys(G.npcs || {}).some(function (npcId) {
        if (G.npcs[npcId] && G.npcs[npcId].quest === definition.quest) { npc = npcId; return true; }
        return false;
      });
      return npc;
    }
    async function splitExact(slot, quantity) {
      var item = character.items[slot], available = itemQuantity(item);
      if (available <= quantity) return slot;
      var before = character.items.map(function (entry) { return JSON.stringify(fingerprint(entry)); });
      await split(slot, quantity);
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
      var result = character.items.findIndex(function (entry, index) {
        return index !== slot && before[index] !== JSON.stringify(fingerprint(entry)) &&
          sameItem(entry, item) && itemQuantity(entry) === quantity;
      });
      if (result < 0) throw new Error("Could not split exchange quantity for " + item.name);
      return result;
    }
    async function applyMassExchange() {
      var skill = character.level >= 70 ? "massexchangepp" : character.level >= 40 ? "massexchange" : null;
      if (!skill || is_on_cooldown(skill) || !can_use(skill)) return;
      await use_skill(skill);
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    function exactInventoryQuantity(itemId, level) {
      return character.items.reduce(function (sum, item) {
        return sum + (item && item.name === itemId && (Number(item.level) || 0) === (Number(level) || 0)
          ? itemQuantity(item) : 0);
      }, 0);
    }
    function exchangeCost(line) {
      if (!line.reward) return Math.max(1, Number((G.items[line.id] || {}).e) || 1);
      var price = Number(G.tokens && G.tokens[line.id] && G.tokens[line.id][line.reward]);
      if (!(price > 0)) throw new Error("Token reward is no longer available: " + line.reward);
      return Math.max(1, price);
    }
    function exchangeSupplies(pending) {
      var result = [];
      pending.forEach(function (line) {
        var entry = result.find(function (item) { return item.id === line.id && item.level === line.level; });
        if (!entry) { entry = {id:line.id, level:line.level, quantity:0}; result.push(entry); }
        entry.quantity += exchangeCost(line) * line.quantity;
      });
      return result;
    }
    try {
      if (!lines.length && !command.exchangeResume) throw new Error("Exchange order is empty");
      await merchantVisitBank(command, activity);
      var supplies = exchangeSupplies(lines);
      for (var retrieveIndex = 0; retrieveIndex < supplies.length; retrieveIndex += 1) {
        var retrieveLine = supplies[retrieveIndex], definition = G.items[retrieveLine.id] || {};
        var needed = retrieveLine.quantity;
        while (exactInventoryQuantity(retrieveLine.id, retrieveLine.level) < needed) {
          var found = findExchangeBankItem(retrieveLine.id, retrieveLine.level);
          if (!found) break;
          var beforeQuantity = exactInventoryQuantity(retrieveLine.id, retrieveLine.level);
          await bank_retrieve(found.pack, found.slot);
          var deadline = Date.now() + 2500;
          while (exactInventoryQuantity(retrieveLine.id, retrieveLine.level) <= beforeQuantity && Date.now() < deadline) await sleep(100);
          if (exactInventoryQuantity(retrieveLine.id, retrieveLine.level) <= beforeQuantity)
            throw new Error("Exchange withdrawal was not confirmed for " + retrieveLine.id);
        }
        var missing = needed - exactInventoryQuantity(retrieveLine.id, retrieveLine.level);
        if (missing > 0) {
          var supply = await request("/merchant/exchange-supply", { method: "POST", body: {
            jobId: command.jobId, shortages: [{ id: retrieveLine.id, level: retrieveLine.level, quantity: missing }],
          }});
          if (supply && supply.pending) throw new Error("bankboi_pending");
          throw new Error("Not enough " + (definition.name || retrieveLine.id) + " to exchange");
        }
      }
      for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        var line = lines[lineIndex], itemDefinition = G.items[line.id] || {}, required = exchangeCost(line);
        // Recheck every remaining line before starting another NPC route.
        var pendingSupplies = exchangeSupplies(lines.slice(lineIndex));
        for (var pendingIndex = 0; pendingIndex < pendingSupplies.length; pendingIndex += 1) {
          var pendingLine = pendingSupplies[pendingIndex];
          var pendingRequired = pendingLine.quantity;
          if (exactInventoryQuantity(pendingLine.id, pendingLine.level) < pendingRequired)
            throw new Error("Exchange inventory changed before travel: " + pendingLine.id);
        }
        await smart_move(find_npc(line.reward ? itemDefinition.npc || line.id + "s" : exchangeNpc(line.id)));
        for (var count = 0; count < Math.max(1, Number(line.quantity) || 1); count += 1) {
          var slot = character.items.findIndex(function (item) {
            return item && item.name === line.id && (Number(item.level) || 0) === (Number(line.level) || 0) &&
              !item.l && itemQuantity(item) >= required;
          });
          if (slot < 0) throw new Error("Exchange stack changed for " + line.id);
          var result;
          if (line.reward) {
            // Select the verified stack explicitly; exchange_buy() otherwise
            // chooses the first stack, which may be locked or too small.
            var purchase = parent.push_deferred("exchange_buy");
            parent.socket.emit("exchange_buy", {num:slot, name:line.reward, q:character.items[slot].q});
            result = await purchase;
          } else {
            slot = await splitExact(slot, required);
            await applyMassExchange();
            await verifyMerchantItemMarks();
            result = await exchange(slot);
          }
          if (result && Number.isInteger(result.num) && character.items[result.num])
            rewards.push(fingerprint(character.items[result.num]));
          var remaining = lines.slice(lineIndex).map(function (pendingLine, index) {
            return { id: pendingLine.id, level: pendingLine.level,
              ...(pendingLine.reward ? {reward:pendingLine.reward} : {}),
              quantity: pendingLine.quantity - (index === 0 ? count + 1 : 0) };
          }).filter(function (pendingLine) { return pendingLine.quantity > 0; });
          await request("/merchant/exchange-progress", { method: "POST", body: {
            jobId: command.jobId, remaining: remaining, rewards: rewards,
          }});
          activity.push({ level: "success", message: "Exchanged " + required + " × " +
            (itemDefinition.name || line.id) + (line.reward ? " for " + line.reward : result && result.reward ? " and received " + result.reward : "") });
        }
      }
      await merchantVisitBank(command, activity);
      for (var rewardIndex = 0; rewardIndex < rewards.length; rewardIndex += 1) {
        var rewardSlot = findItem(rewards[rewardIndex]);
        if (rewardSlot >= 0) await bankStoreFully(rewardSlot);
      }
      activity.push({ level: "success", message: "Exchange results deposited in the bank" });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, autoExchangesResolved: command.autoExchangeKeys || [],
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [], activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [],
        activity: activity.concat([{ level: String(error.reason || error.message || error) === "bankboi_pending" ? "info" : "error",
          message: String(error.reason || error.message || error) === "bankboi_pending" ? "Exchange waiting for BankBoi materials" : "Exchange failed",
          details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) {}
      throw error;
    }
  }

  async function runMerchantJob(command, label, action) {
    var active = root.__merchantActiveJob;
    if (active && active.jobId === command.jobId && active.owner !== merchantRuntimeId) {
      var activeAt = Number(active.lastHeartbeatAt || active.startedAt) || 0;
      if (Date.now() - activeAt <= 20000) {
        game_log("Merchant job already running; hot reload will not start a duplicate", "#f0b429");
        return;
      }
      // The coordinator issued a fresh command after its worker lease expired.
      // Replace the orphaned hot-reload token and resume from durable state.
      root.__merchantActiveJob = null;
    }
    if (active && active.jobId !== command.jobId) {
      // A recovered job has a new coordinator identity. Cancel any unresolved
      // smart path owned by its orphaned predecessor before resuming; the old
      // completion cannot terminate this new ID.
      try { if (typeof stop === "function") await stop("smart"); }
      catch (_stopError) { /* There may be no active smart path to cancel. */ }
      root.__merchantActiveJob = null;
    }
    var token = { jobId: command.jobId, owner: merchantRuntimeId, startedAt: Date.now(),
      lastHeartbeatAt: Date.now(), progressAt: Date.now(), label: label };
    root.__merchantActiveJob = token;
    async function heartbeat() {
      token.lastHeartbeatAt = Date.now();
      try { await request("/merchant/heartbeat", { method: "POST", body: {
        jobId: command.jobId, progressAt: token.progressAt, operationStage: command.operationStage,
      } }); }
      catch (_heartbeatError) { /* Completion or recovery already owns the terminal state. */ }
    }
    await heartbeat();
    var heartbeatTimer = setInterval(heartbeat, 5000), suspendedGathering = null, actionStarted = false;
    try {
      if (["merchant-npc-sale", "merchant-deconstruct"].indexOf(command.type) >= 0) {
        suspendedGathering = gatheringMode;
        gatheringGeneration += 1; root.__merchantGatheringGeneration = gatheringGeneration;
        if (gatheringTimer) clearInterval(gatheringTimer);
        if (root.__merchantGatheringTimer) clearInterval(root.__merchantGatheringTimer);
        gatheringTimer = root.__merchantGatheringTimer = null;
        merchantIdlePending = null;
        try { if (typeof stop === "function") await stop("smart"); } catch (_) {}
        var releaseBy = Date.now() + 15000;
        while (merchantIdleActive || gatheringActive) {
          if (Date.now() >= releaseBy || root.__merchantActiveJob !== token) throw new Error("interrupted");
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
        }
      }
      luckyUpgradeSlot = command.luckyUpgradeSlot;
      if (luckyUpgradeService && luckyUpgradeService.pending()) await luckyUpgradeService.recover();
      else if (character.ctype === "merchant" && root.localStorage.getItem("party-lucky-upgrade:" + character.name)) await merchantLuckyUpgrade().recover();
      if (freeInventorySlots() > 0) await merchantLuckyUpgrade().tidy(luckyUpgradeSlot);
      actionStarted = true;
      return await action();
    } catch (error) {
      if (!actionStarted) {
        try { await request("/merchant/complete", {method:"POST",body:{jobId:command.jobId,success:false,
          error:String(error.reason || error.message || error)}}); } catch (_) {}
      }
      throw error;
    } finally {
      clearInterval(heartbeatTimer);
      if (root.__merchantActiveJob === token) root.__merchantActiveJob = null;
      if (suspendedGathering && !root.__merchantActiveJob) setGathering(suspendedGathering);
    }
  }

  async function merchantStandSearch(command) {
    var activity = [];
    try {
      await smart_move(merchantMarketLocation);
      await new Promise(function (resolve) { setTimeout(resolve, 1200); });
      var listings = [];
      Object.keys(parent.entities || {}).forEach(function (id) {
        var seller = parent.entities[id];
        if (!seller || seller.type !== "character" || seller.name === character.name || !seller.stand) return;
        Object.keys(seller.slots || {}).forEach(function (slot) {
          var item = seller.slots[slot];
          if (slot.indexOf("trade") !== 0 || !item || item.name !== command.itemId || item.b || item.giveaway ||
              !Number.isFinite(Number(item.price)) || Number(item.price) < 1) return;
          listings.push({ seller: seller.name, slot: slot, rid: item.rid, item: fingerprint(item),
            price: Number(item.price), quantity: Number(item.q) || 1,
            map: seller.map, x: Math.round(seller.x), y: Math.round(seller.y) });
        });
      });
      listings.sort(function (a, b) { return a.price - b.price || a.seller.localeCompare(b.seller); });
      activity.push({ level: "info", message: "Found " + listings.length + " stand listing" +
        (listings.length === 1 ? "" : "s") + " for " + command.itemId });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, standSearchResults: { itemId: command.itemId, listings: listings },
        activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        standSearchResults: { itemId: command.itemId, listings: [], error: String(error.reason || error.message || error) },
        activity: [{ level: "error", message: "Stand search failed", details: String(error.reason || error.message || error) }],
      }}); } catch (_completeError) { /* Job was cleared. */ }
      throw error;
    }
  }

  async function merchantStandBuy(command) {
    var activity = [], purchases = command.listings || [], completed = [];
    try {
      var requiredGold = purchases.reduce(function (sum, listing) {
        return sum + Number(listing.price) * Number(listing.buyQuantity);
      }, 0);
      if (character.gold < requiredGold) {
        await merchantVisitBank(command, activity);
        var shortage = requiredGold - character.gold;
        if ((Number(character.bank && character.bank.gold) || 0) < shortage)
          throw new Error("Insufficient bank gold for stand purchases");
        await withdrawMerchantCash(shortage, command);
      }
      for (var index = 0; index < purchases.length; index += 1) {
        var listing = purchases[index];
        await smart_move({ map: listing.map, x: listing.x, y: listing.y });
        var seller = get_player(listing.seller), live = seller && seller.slots && seller.slots[listing.slot];
        if (!seller || !live || live.rid !== listing.rid || live.name !== listing.item.name ||
            Number(live.price) !== Number(listing.price))
          throw new Error("Listing changed or disappeared: " + listing.seller + " / " + listing.item.name);
        var amount = Math.min(Number(listing.buyQuantity) || 1, Number(live.q) || 1);
        if (!purchasePreservesLogisticsReserve(live, amount))
          throw new Error("purchase deferred: three merchant logistics slots are reserved");
        amount = await guardedMarketPurchase(command, listing, live, Number(live.price), amount, function (count) { return trade_buy(seller, listing.slot, count); });
        if (!amount) continue;
        activity.push({ level: "success", message: "Bought " + amount + " × " + listing.item.name +
          " from " + listing.seller + " for " + (amount * listing.price).toLocaleString() + " gold" });
      }
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, activity: activity,
        bidPurchases: completed,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        bidPurchases: completed,
        activity: activity.concat([{ level: "error", message: "Stand purchase failed", details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) { /* Job was cleared. */ }
      throw error;
    }
  }

  async function merchantPontyBuy(command) {
    var activity = [], purchases = command.listings || [], completed = [];
    var done = new Set(command.completedListingKeys || []);
    function currentRealm() { return "SR_" + parent.server_region + parent.server_identifier; }
    async function changeRealm(realm) {
      var response = await request("/merchant/realm-switch", { method: "POST", body: {
        jobId: command.jobId, character: character.name, realm: realm,
      }});
      if (!response.alreadyThere) await new Promise(function () {});
    }
    function exactProperties(item) {
      var clean = Object.assign({}, item, { level: Number(item.level) || 0 });
      ["rid", "q", "price"].forEach(function (key) { delete clean[key]; });
      return JSON.stringify(Object.keys(clean).sort().filter(function (key) { return clean[key] != null; })
        .map(function (key) { return [key, clean[key]]; }));
    }
    try {
      if (character.stand) await close_stand();
      for (var index = 0; index < purchases.length; index += 1) {
        var requested = purchases[index];
        if (done.has(requested.key)) continue;
        var realm = requested.serverRegion && requested.serverIdentifier
          ? "SR_" + requested.serverRegion + requested.serverIdentifier : currentRealm();
        if (realm !== currentRealm()) await changeRealm(realm);
        var failure = null;
        if (character.gold < Number(requested.price)) {
          await merchantVisitBank(command, activity);
          var shortfall = Number(requested.price) - character.gold;
          if ((Number(character.bank && character.bank.gold) || 0) < shortfall) throw new Error("Insufficient bank gold for Ponty purchase: need " + shortfall.toLocaleString() + "g, bank reports " + (Number(character.bank && character.bank.gold) || 0).toLocaleString() + "g");
          await withdrawMerchantCash(shortfall, command);
        }
        try {
        await smart_move(find_npc("secondhands"));
        var response = await get_secondhands(10000);
        var available = Array.isArray(response) ? response :
          response && Array.isArray(response.items) ? response.items :
          response && Array.isArray(response.secondhands) ? response.secondhands : [];
        var live = available.find(function (item) { return item && String(item.rid) === String(requested.rid); });
        if (!live) throw new Error("Ponty listing is no longer available: " + requested.item.name);
        if (exactProperties(live) !== exactProperties(requested.item) ||
            Math.max(1, Number(live.q) || 1) !== requested.quantity)
          throw new Error("Ponty listing properties or quantity changed");
        var quantity = Math.max(1, Number(live.q) || 1);
        var multiplier = G.items[live.name] && G.items[live.name].cash ? 3 : 2;
        var unitPrice = Math.max(1, Math.round(Number(calculate_item_value(live)) * multiplier));
        var totalPrice = unitPrice * quantity;
        if (unitPrice > Number(requested.unitPrice) || totalPrice > Number(requested.price))
          throw new Error("Ponty's price changed for " + requested.item.name);
        if (character.gold < totalPrice) {
          await merchantVisitBank(command, activity);
          var shortage = totalPrice - character.gold;
          if ((Number(character.bank && character.bank.gold) || 0) < shortage)
            throw new Error("Insufficient bank gold for Ponty's " + requested.item.name);
          await withdrawMerchantCash(shortage, command);
          await smart_move(find_npc("secondhands"));
        }
        if (!purchasePreservesLogisticsReserve(live, quantity))
          throw new Error("purchase deferred: three merchant logistics slots are reserved");
        var purchasedQuantity = await guardedMarketPurchase(command, requested, live, unitPrice, quantity, function () { return buy_secondhand(String(live.rid), 10000); }, true);
        if (!purchasedQuantity) throw new Error("WTB no longer needs this Ponty stack");
        activity.push({ level: "success", message: "Bought " + quantity + " × " + live.name +
          " from Ponty for " + totalPrice.toLocaleString() + " gold" });
        } catch (error) {
          failure = String(error.reason || error.message || error);
          if (/Insufficient bank gold|not_in_bank/.test(failure)) throw error;
        }
        await request("/merchant/ponty-progress", { method: "POST", body: {
          jobId: command.jobId, listingKey: requested.key, success: !failure, error: failure,
        }});
        done.add(requested.key);
      }
      if (command.aldataHomeRealm && currentRealm() !== command.aldataHomeRealm) await changeRealm(command.aldataHomeRealm);
      await refreshPontyListings();
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, bidPurchases: completed, activity: activity,
      }});
    } catch (error) {
      await refreshPontyListings();
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        bidPurchases: completed,
        activity: activity.concat([{ level: "error", message: "Ponty purchase failed",
          details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) { /* Job was cleared. */ }
      throw error;
    }
  }

  async function merchantALDataAuth(command) {
    var activity = [];
    try {
      if (!command.aldataKey) throw new Error("ALData authentication key is missing");
      if (character.gold < 50000) {
        await merchantVisitBank(command, activity);
        var shortage = 50000 - character.gold;
        if ((Number(character.bank && character.bank.gold) || 0) < shortage)
          throw new Error("Insufficient bank gold to send ALData authentication mail");
        await withdrawMerchantCash(shortage, command);
      }
      var sent = await send_mail("earthiverse", "aldata_auth", command.aldataKey, false, 20000);
      if (sent && sent.failed) throw new Error(sent.reason || "mail_failed");
      activity.push({ level: "success", message: "Sent ALData authentication mail; confirmation may take about a minute" });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, activity: activity,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [],
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        activity: [{ level: "error", message: "Could not send ALData authentication mail",
          details: String(error.reason || error.message || error) }],
      }}); } catch (_completeError) {}
      throw error;
    }
  }

  async function merchantJoinGiveaway(command) {
    var activity = [];
    function currentRealm() {
      return "SR_" + String(parent.server_region || "US") + String(parent.server_identifier || "II");
    }
    async function changeRealm(realm) {
      await request("/merchant/realm-switch", { method: "POST", body: {
        jobId: command.jobId, character: character.name, realm: realm,
      }});
      await new Promise(function () {});
    }
    function activeGiveaways(seller) {
      if (!seller || !seller.slots) return [];
      return Object.keys(seller.slots).filter(function (slot) {
        var item = seller.slots[slot];
        return slot.indexOf("trade") === 0 && item && item.giveaway && item.rid &&
          (!command.rid || item.rid === command.rid) &&
          (!command.slot || slot === command.slot) &&
          (!command.expectedItem || (item.name === command.expectedItem.name && Number(item.level || 0) === Number(command.expectedItem.level || 0)));
      });
    }
    try {
      if (command.realm && command.realm.indexOf("PVP") >= 0) throw new Error("Automatic giveaway travel excludes PVP");
      if (command.expiresAt && Date.now() >= command.expiresAt) throw new Error("Giveaway observation expired");
      if (command.realm && currentRealm() !== command.realm) await changeRealm(command.realm);
      if (character.stand) await close_stand();
      var destination = command.location && command.location.map ? command.location : merchantMarketLocation;
      await smart_move(destination);
      var deadline = Date.now() + 60000, seller = null, slots = [];
      while (Date.now() < deadline && !slots.length) {
        seller = get_player(command.seller);
        slots = activeGiveaways(seller);
        if (seller && !slots.length && command.rid) break;
        if (!slots.length) await sleep(500);
      }
      if (!seller) throw new Error(command.seller + " was not visible at the market");
      if (!slots.length) throw new Error("No active giveaway was found for " + command.seller);
      if (Math.hypot(Number(character.x) - Number(seller.x), Number(character.y) - Number(seller.y)) > 350)
        await smart_move({ map: character.map, x: Number(seller.x), y: Number(seller.y) });
      var joined = 0;
      for (var index = 0; index < slots.length; index += 1) {
        if (command.expiresAt && Date.now() >= command.expiresAt) throw new Error("Giveaway observation expired before entry");
        seller = get_player(command.seller);
        if (!seller) throw new Error("Giveaway seller disappeared before entry");
        var slot = slots[index], item = seller.slots[slot];
        if (!item || !item.giveaway || !item.rid || activeGiveaways(seller).indexOf(slot) < 0) throw new Error("Giveaway changed before entry");
        if (Array.isArray(item.list) && item.list.indexOf(character.name) >= 0) continue;
        await join_giveaway(seller.name, slot, item.rid);
        joined += 1;
      }
      activity.push({ level: "success", message: joined
        ? "Joined " + joined + " giveaway" + (joined === 1 ? "" : "s") + " from " + seller.name
        : "Already entered " + seller.name + "'s giveaway" });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        activity: activity.concat([{ level: "error", message: "Giveaway entry failed",
          details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) {}
      throw error;
    }
  }

  async function merchantALDataBuy(command) {
    var activity = [], listings = command.listings || [], done = new Set(command.completedListingKeys || []);
    async function marketplaceMove(destination, timeoutMs) {
      var timeout = null, timedOut = false;
      try {
        await Promise.race([
          Promise.resolve(smart_move(destination)),
          new Promise(function (_resolve, reject) {
            timeout = setTimeout(function () {
              timedOut = true;
              var error = new Error("marketplace route timed out after " + Math.round(timeoutMs / 1000) + " seconds");
              error.failureCode = "destination_unreachable";
              reject(error);
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        // smart_move's underlying promise can remain alive after our deadline.
        // Stop both path and direct movement so it cannot resume behind the
        // next merchant task or keep the current job heartbeating forever.
        if (timedOut && typeof stop === "function") {
          try { await stop("smart"); } catch (_marketplaceStopSmart) {}
          try { await stop("move"); } catch (_marketplaceStopMove) {}
        }
      }
    }
    async function reportMarketplace(message, level, details) {
      try {
        await request("/merchant/activity", { method: "POST", body: {
          character: character.name, jobId: command.jobId, message: message,
          level: level || "info", details: details || null,
        }});
      } catch (_activityError) { /* The purchase remains authoritative. */ }
    }
    function matchesListing(item, listing) {
      return item && item.name === listing.item.name &&
        (Number(item.level) || 0) === (Number(listing.item.level) || 0) &&
        (listing.item.p || null) === (item.p || null) && !item.b &&
        Number(item.price) <= Number(listing.price);
    }
    function findLiveListing(seller, listing) {
      if (!seller || !seller.slots) return null;
      var preferred = seller.slots[listing.slot];
      if (matchesListing(preferred, listing)) return { slot: listing.slot, item: preferred };
      var slots = Object.keys(seller.slots);
      for (var slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        var slot = slots[slotIndex];
        if (/^trade/.test(slot) && matchesListing(seller.slots[slot], listing))
          return { slot: slot, item: seller.slots[slot] };
      }
      return null;
    }
    function currentRealm() { return "SR_" + String(parent.server_region || "US") + String(parent.server_identifier || "II"); }
    function listingRealm(listing) { return "SR_" + String(listing.serverRegion || "US") + String(listing.serverIdentifier || "II"); }
    async function changeRealm(realm) {
      await request("/merchant/realm-switch", { method: "POST", body: {
        jobId: command.jobId, character: character.name, realm: realm,
      }});
      await new Promise(function () {});
    }
    try {
      if (character.stand) await close_stand();
      var remaining = listings.filter(function (entry) { return !done.has(entry.key); });
      var requiredGold = remaining.reduce(function (sum, listing) {
        return sum + (Number(listing.price) || 0) * Math.max(1, Number(listing.buyQuantity) || 1);
      }, 0);
      if (character.gold < requiredGold && currentRealm() === command.aldataHomeRealm) {
        await merchantVisitBank(command, activity);
        var shortage = requiredGold - character.gold;
        if ((Number(character.bank && character.bank.gold) || 0) < shortage)
          throw new Error("Insufficient bank gold for ALData marketplace purchases");
        await withdrawMerchantCash(shortage, command);
      }
      for (var index = 0; index < listings.length; index += 1) {
        var listing = listings[index];
        if (done.has(listing.key)) continue;
        var listingCost = (Number(listing.price) || 0) * Math.max(1, Number(listing.buyQuantity) || 1);
        if (character.gold < listingCost) {
          if (currentRealm() !== command.aldataHomeRealm) await changeRealm(command.aldataHomeRealm);
          await merchantVisitBank(command, activity);
          var listingShortage = listingCost - character.gold;
          if ((Number(character.bank && character.bank.gold) || 0) < listingShortage)
            throw new Error("Insufficient bank gold for marketplace listing from " + listing.seller);
          await withdrawMerchantCash(listingShortage, command);
        }
        var realm = listingRealm(listing);
        if (currentRealm() !== realm) await changeRealm(realm);
        var purchased = 0, failure = null, failureCode = null;
        try {
          await marketplaceMove({ map: listing.map, x: Number(listing.x), y: Number(listing.y) }, 45000);
          await reportMarketplace("Reached " + listing.seller + "'s advertised location; looking for an open stand", "info",
            { map: character.map, x: character.x, y: character.y, item: listing.item.name });
          var waitUntil = Date.now() + 60000, seller = null, match = null;
          var sawSeller = false, sawOpenStand = false, lastFollowAt = 0, refreshedLocation = false;
          while (Date.now() < waitUntil && !match) {
            seller = get_player(listing.seller);
            if (!seller && !refreshedLocation) {
              refreshedLocation = true;
              var refreshed = await anniversaryWithTimeout(request("/merchant/refresh-location", { method: "POST",
                body: { jobId: command.jobId, listingKey: listing.key } }), 10000, "Seller location refresh");
              if (!refreshed.location) break;
              await marketplaceMove(refreshed.location, Math.max(1, Math.min(30000, waitUntil - Date.now())));
              seller = get_player(listing.seller);
              if (!seller) break;
            }
            if (seller) {
              sawSeller = true;
              var tradeSlots = seller.slots && Object.keys(seller.slots).filter(function (slot) {
                return /^trade/.test(slot) && seller.slots[slot];
              }) || [];
              if (tradeSlots.length) sawOpenStand = true;
              match = findLiveListing(seller, listing);
              var sellerDistance = Math.hypot(Number(character.x) - Number(seller.x), Number(character.y) - Number(seller.y));
              if (!match && sellerDistance > 300 && Date.now() - lastFollowAt > 1000) {
                lastFollowAt = Date.now();
                try { xmove(Number(seller.x), Number(seller.y)); } catch (_followError) { /* Poll again. */ }
              }
            }
            if (!match) await sleep(500);
          }
          if (!match) {
            failureCode = !sawSeller ? "seller_not_visible" : !sawOpenStand ? "stand_not_open" : "listing_not_available";
            if (!sawSeller)
              throw new Error("reached the advertised location, but " + listing.seller + " was not visible after the bounded location check");
            if (!sawOpenStand)
              throw new Error("found " + listing.seller + ", but their stand did not reopen during the 60-second wait");
            throw new Error("found " + listing.seller + " with an open stand, but the requested item was no longer listed at or below the advertised price");
          }
          if (typeof stop === "function") { try { await stop(); } catch (_stopFollowingError) {} }
          purchased = Math.min(Math.max(1, Number(listing.buyQuantity) || 1), Math.max(1, Number(match.item.q) || 1));
          if (!purchasePreservesLogisticsReserve(match.item, purchased)) {
            failureCode = "inventory_reserve";
            throw new Error("purchase deferred: three merchant logistics slots are reserved");
          }
          purchased = await guardedMarketPurchase(command, listing, match.item, Number(match.item.price), purchased, function (count) { return anniversaryWithTimeout(trade_buy(seller, match.slot, count), 15000, "Marketplace purchase confirmation"); });
        } catch (error) {
          failure = String(error.reason || error.message || error);
          failureCode = failureCode || error.failureCode || null;
        }
        var progress = await request("/merchant/aldata-progress", { method: "POST", body: {
          jobId: command.jobId, listingKey: listing.key, success: !failure,
          quantity: purchased, error: failure, failureCode: failureCode,
        }});
        (progress.additionalListings || []).forEach(function (additional) {
          if (!listings.some(function (entry) { return entry.key === additional.key; })) listings.push(additional);
        });
        if (progress.cancelSeller) {
          listings.forEach(function (entry) {
            if (entry.seller === progress.cancelSeller.seller &&
                entry.serverRegion === progress.cancelSeller.serverRegion &&
                entry.serverIdentifier === progress.cancelSeller.serverIdentifier)
              done.add(entry.key);
          });
        }
        done.add(listing.key);
      }
      if (command.aldataHomeRealm && currentRealm() !== command.aldataHomeRealm)
        await changeRealm(command.aldataHomeRealm);
      activity.push({ level: "success", message: "ALData marketplace itinerary completed" });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        activity: activity.concat([{ level: "error", message: "ALData marketplace purchase failed",
          details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) {}
      throw error;
    }
  }

  async function merchantALDataSell(command) {
    var activity = [], order = command.buyOrder || {}, wanted = Math.max(1, Number(command.sellQuantity) || 1);
    function matchesWanted(item) {
      return item && order.item && item.name === order.item.name &&
        (Number(item.level) || 0) === (Number(order.item.level) || 0) &&
        (item.p || null) === (order.item.p || null);
    }
    function inventoryOwned() {
      return character.items.reduce(function (sum, item) {
        return sum + (matchesWanted(item) ? Math.max(1, Number(item.q) || 1) : 0);
      }, 0);
    }
    function liveBuySlot(buyer) {
      if (!buyer || !buyer.slots) return null;
      var slots = [order.slot].concat(Object.keys(buyer.slots).filter(function (slot) {
        return /^trade/.test(slot) && slot !== order.slot;
      }));
      for (var index = 0; index < slots.length; index += 1) {
        var live = buyer.slots[slots[index]];
        if (matchesWanted(live) && live.b && Number(live.price) >= Number(order.price))
          return { slot: slots[index], item: live };
      }
      return null;
    }
    function currentRealm() { return "SR_" + String(parent.server_region || "US") + String(parent.server_identifier || "II"); }
    function orderRealm() { return "SR_" + String(order.serverRegion || "US") + String(order.serverIdentifier || "II"); }
    async function changeRealm(realm) {
      await request("/merchant/realm-switch", { method: "POST", body: {
        jobId: command.jobId, character: character.name, realm: realm,
      }});
      await new Promise(function () {});
    }
    try {
      if (!order.item || !order.buyer) throw new Error("ALData buy order is incomplete");
      if (character.stand) await close_stand();
      if (inventoryOwned() < wanted) {
        await merchantVisitBank(command, activity);
        var guard = 0;
        while (inventoryOwned() < wanted && guard++ < 100) {
          var found = findBankItem(order.item);
          if (!found) break;
          await bank_retrieve(found.pack, found.slot);
        }
      }
      var owned = inventoryOwned();
      if (!owned) throw new Error("No matching " + order.item.name + " is available in merchant inventory or bank");
      if (currentRealm() !== orderRealm()) await changeRealm(orderRealm());
      await anniversaryWithTimeout(smart_move({ map: order.map, x: Number(order.x), y: Number(order.y) }),
        60000, "Travel to WTB buyer " + order.buyer);
      var waitUntil = Date.now() + 60000, buyer = null, match = null, refreshedLocation = false;
      while (Date.now() < waitUntil && !match) {
        buyer = get_player(order.buyer);
        if (!buyer && !refreshedLocation) {
          refreshedLocation = true;
          var refreshed = await anniversaryWithTimeout(request("/merchant/refresh-location", { method: "POST",
            body: { jobId: command.jobId } }), 10000, "WTB buyer location refresh");
          if (!refreshed.location) break;
          await anniversaryWithTimeout(smart_move(refreshed.location),
            Math.max(1, Math.min(30000, waitUntil - Date.now())), "Travel to refreshed WTB buyer location");
          buyer = get_player(order.buyer);
          if (!buyer) break;
        }
        match = liveBuySlot(buyer);
        if (!match) await sleep(500);
      }
      if (!match) throw new Error("Buyer or matching live WTB was not available after the bounded location check");
      if (typeof stop === "function") { try { await stop(); } catch (_stopError) {} }
      var amount = Math.min(wanted, owned, Math.max(1, Number(match.item.q) || 1));
      await anniversaryWithTimeout(trade_sell(buyer, match.slot, amount), 15000,
        "WTB sale confirmation from " + order.buyer);
      activity.push({ level: "success", message: "Sold " + amount + " × " + order.item.name +
        " to " + order.buyer + " for " + (amount * Number(match.item.price)).toLocaleString() + " gold" });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, activity: activity,
      }});
    } catch (error) {
      try { if (typeof stop === "function") await stop("smart"); } catch (_stopError) {}
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        activity: activity.concat([{ level: "error", message: "ALData marketplace sale failed",
          details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) {}
      throw error;
    }
  }

  async function merchantSelfBank(command) {
    var activity = [], target = Number.isInteger(command.goldTarget) ? Math.max(0, command.goldTarget) : 0;
    try {
      await merchantVisitBank(command, activity);
      if (character.gold > target) await bank_deposit(character.gold - target);
      else if (character.gold < target) {
        var wanted = target - character.gold;
        await withdrawMerchantCash(Math.min(wanted, Number(character.bank && character.bank.gold) || 0), command);
      }
      activity.push({ level: "success", message: "Merchant bank balance set to " + target.toLocaleString() + " gold" });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [], activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [],
        activity: [{ level: "error", message: "Merchant bank exchange failed", details: String(error.reason || error.message || error) }],
      }}); } catch (_completeError) { /* The job was already cleared. */ }
      throw error;
    }
  }

  async function merchantSelfRestock(command) {
    var activity = [];
    try {
      var supplies = [command.restock && command.restock.hp, command.restock && command.restock.mp]
        .filter(function (supply) { return supply && Number(supply.max) > 0; });
      var needs = supplies.map(function (supply) {
        return { supply: supply, quantity: Math.max(0, Number(supply.max) - inventoryQuantity(supply.item)) };
      }).filter(function (entry) { return entry.quantity > 0; });
      var totalCost = needs.reduce(function (sum, entry) {
        return sum + (Number(G.items[entry.supply.item] && G.items[entry.supply.item].g) || 0) * entry.quantity;
      }, 0);
      if (character.gold < totalCost) {
        await merchantVisitBank(command, activity);
        var shortage = totalCost - character.gold;
        if ((Number(character.bank && character.bank.gold) || 0) < shortage)
          throw new Error("Insufficient bank gold to restock merchant potions");
        await withdrawMerchantCash(shortage, command);
      }
      for (var index = 0; index < needs.length; index += 1) {
        var request = needs[index], seller = itemSeller(request.supply.item);
        if (!seller) throw new Error("Could not find potion seller for " + request.supply.item);
        await smart_move(find_npc(seller));
        await buyConfirmed(request.supply.item, request.quantity);
        activity.push({ level: "success", message: "Restocked " + request.quantity + " × " +
          (G.items[request.supply.item] && G.items[request.supply.item].name || request.supply.item) +
          " to " + request.supply.max });
      }
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [], activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [],
        activity: activity.concat([{ level: "error", message: "Merchant potion restock failed",
          details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) { /* Job was already cleared or preempted. */ }
      throw error;
    }
  }

  async function merchantBankUnlock(command) {
    var activity = [];
    try {
      if (command.key) {
        var keySlot = findInventoryItemByName(command.key);
        if (keySlot < 0) {
          await merchantVisitBank(command, activity);
          await retrieveFromBankUntil(command.key, 1);
          keySlot = findInventoryItemByName(command.key);
        }
        if (keySlot < 0) throw new Error("Required bank key is no longer owned: " + command.key);
        await activate(keySlot);
        // Enter the newly accessible floor immediately so its free base pack
        // is captured in the next bank snapshot and the dashboard can enable
        // that floor's purchasable vaults without another manual visit.
        await smart_move(find_npc(command.pack));
        activity.push({ level: "success", message: "Unlocked access with " + command.key,
          details: command.floor });
      } else {
        await smart_move(find_npc(command.pack));
        if (!character.bank) throw new Error("Could not reach " + command.floor);
        if (character.bank[command.pack]) throw new Error(command.pack + " is already unlocked");
        var cost = Math.max(0, Number(command.gold) || 0);
        if (character.gold < cost) {
          var shortfall = cost - character.gold;
          if ((Number(character.bank.gold) || 0) < shortfall)
            throw new Error("Insufficient bank gold: need " + cost.toLocaleString() + " gold to unlock " + command.pack);
          await withdrawMerchantCash(shortfall, command);
        }
        var result = await open_bank_pack(command.pack, "gold");
        if (result && result.failed) throw new Error(result.reason || "bank vault unlock failed");
        activity.push({ level: "success", message: "Unlocked bank vault " + command.pack,
          details: cost.toLocaleString() + " gold" });
      }
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        activity: activity.concat([{ level: "error", message: "Bank unlock failed",
          details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) { /* Job was cleared. */ }
      throw error;
    }
  }

  function deconstructionDefinition(item) {
    if (!item || item.l || item.b) return null;
    var definition = G.items[item.name] || {};
    if (Number(item.level) > 0 && definition.compound && definition.type !== "booster")
      return { cost: Math.min(50000000, item_value(item) * 10), space: 2 };
    var recipe = G.dismantle && G.dismantle[item.name];
    return recipe ? { cost: Number(recipe.cost) || 0, space: (recipe.items || []).length } : null;
  }
  async function merchantDeconstruct(command) {
    var activity = [];
    try {
      if (character.stand) await close_stand();
      await smart_move("craftsman");
      for (var mark of command.deconstructionMarks || []) {
        for (var unit = 0; unit < mark.quantity; unit += 1) {
          assertMerchantContinuation(command);
          var claim = await request("/deconstruction/step", { method: "POST", body: {
            jobId: command.jobId, id: mark.id, action: "claim" } });
          var attempt = claim.mark.attempt, failure = null;
          try {
            assertMerchantContinuation(command);
            var slot = Number.isInteger(mark.slot) && sameItem(character.items[mark.slot], mark.item) ? mark.slot : findItem(mark.item);
            var item = character.items[slot], definition = deconstructionDefinition(item);
            if (slot < 0 || !sameItem(item, mark.item) || !definition) throw new Error("Marked item moved, is protected, or cannot be deconstructed");
            if (character.gold < definition.cost) {
              await smart_move("bank");
              assertMerchantContinuation(command);
              await withdrawMerchantCash(definition.cost - character.gold, command);
              if (character.gold < definition.cost) throw new Error("Insufficient gold: deconstruction needs " + definition.cost);
              await smart_move("craftsman");
              assertMerchantContinuation(command);
              slot = findItem(mark.item);
              item = character.items[slot];
              if (!sameItem(item, mark.item) || !deconstructionDefinition(item)) throw new Error("Marked item changed during bank travel");
            }
            if (freeInventorySlots() < definition.space) throw new Error("Insufficient inventory space for deconstruction results");
            await verifyMerchantItemMarks();
            var result = await anniversaryWithTimeout(dismantle(slot), 10000, "Deconstruction");
            if (result && result.failed) throw new Error(result.reason || "Deconstruction rejected");
          } catch (error) { failure = String(error.reason || error.message || error); }
          await request("/deconstruction/step", { method: "POST", body: {
            jobId: command.jobId, id: mark.id, attempt: attempt, success: !failure, error: failure } });
          if (failure) {
            activity.push({ level: "error", message: "Deconstruction blocked: " + mark.item.name, details: failure });
            break;
          }
          activity.push({ level: "success", message: "Deconstructed " + mark.item.name });
        }
      }
      await request("/merchant/complete", { method: "POST", body: { jobId: command.jobId, success: true, activity: activity } });
    } catch (error) {
      await request("/merchant/complete", { method: "POST", body: { jobId: command.jobId,
        success: false, error: String(error.reason || error.message || error), activity: activity } }).catch(function () {});
      throw error;
    }
  }

  async function merchantNpcSale(command) {
    var activity = [], resolved = [], blocked = [], marks = command.npcSales || [];
    try {
      for (var index = 0; index < marks.length; index += 1) {
        var mark = marks[index], inventorySlot = findItem(mark.item);
        if (inventorySlot < 0) {
          if (mark.source === "merchant") {
            blocked.push({id:mark.id,error:"Marked item is not in merchant inventory"});
            activity.push({ level: "error", message: "Could not find merchant inventory item marked for NPC sale: " + mark.item.name });
            continue;
          }
          await smart_move("bank");
          var found = findBankItem(mark.item, mark.pack, mark.slot);
          if (!found) {
            blocked.push({id:mark.id,error:"Marked item is not in bank inventory"});
            activity.push({ level: "error", message: "Could not find NPC-sale item: " + mark.item.name });
            continue;
          }
          await bank_retrieve(found.pack, found.slot);
          inventorySlot = findItem(mark.item);
        }
        if (inventorySlot < 0 || !sameItem(character.items[inventorySlot], mark.item)) {
          blocked.push({id:mark.id,error:"NPC-sale item changed before sale"});
          activity.push({ level: "error", message: "NPC-sale item changed before sale: " + mark.item.name });
          continue;
        }
        if (character.items[inventorySlot].l) { blocked.push({id:mark.id,error:"Item is locked"}); continue; }
        var quantity = Math.min(Number(mark.quantity) || 1, Number(character.items[inventorySlot].q) || 1);
        await smart_move(find_npc("fancypots"));
        inventorySlot = findItem(mark.item);
        if (inventorySlot < 0 || !sameItem(character.items[inventorySlot], mark.item))
          throw new Error("NPC-sale item moved before confirmation: " + mark.item.name);
        if (character.items[inventorySlot].l) { blocked.push({id:mark.id,error:"Item is locked"}); continue; }
        quantity = Math.min(quantity, Number(character.items[inventorySlot].q) || 1);
        if (!root.__merchantActiveJob || root.__merchantActiveJob.jobId !== command.jobId) throw new Error("interrupted");
        var goldBefore = Number(character.gold) || 0;
        await verifyMerchantItemMarks();
        await sell(inventorySlot, quantity);
        resolved.push(mark.id);
        activity.push({ level: "success", message: "Sold " + quantity + " × " + mark.item.name +
          " to NPC for " + Math.max(0, (Number(character.gold) || 0) - goldBefore).toLocaleString() + " gold" });
      }
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, npcSalesResolved: resolved, npcSalesBlocked: blocked, activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error), npcSalesResolved: resolved, npcSalesBlocked: blocked,
        activity: activity.concat([{ level: "error", message: "NPC sale failed", details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) { /* Job was cleared. */ }
      throw error;
    }
  }

  async function merchantDonate(command) {
    var activity = [], amount = Math.max(0, Math.floor(Number(command.amount) || 0));
    try {
      if (!amount) throw new Error("Donation amount must be positive");
      await merchantVisitBank(command, activity);
      if (character.gold < amount) {
        var shortage = amount - character.gold;
        if ((Number(character.bank && character.bank.gold) || 0) < shortage)
          throw new Error("Insufficient bank gold for donation");
        await withdrawMerchantCash(shortage, command);
      }
      await smart_move(find_npc("lostandfound"));
      parent.socket.emit("lostandfound", "info");
      await new Promise(function (resolve) { setTimeout(resolve, 350); });
      var beforeXp = Number(character.xp) || 0;
      await donate_gold(amount);
      var gained = Math.max(0, (Number(character.xp) || 0) - beforeXp);
      activity.push({ level: "success", message: "Donated " + amount.toLocaleString() +
        " gold at the XP frog" + (gained ? " and gained " + gained.toLocaleString() + " XP" : "") });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [], activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [],
        activity: [{ level: "error", message: "Merchant donation failed", details: String(error.reason || error.message || error) }],
      }}); } catch (_completeError) { /* The job was already cleared. */ }
      throw error;
    }
  }

  // Persist across shared-routine reloads. Server acknowledgements own the ledger;
  // this journal only retains monotonically increasing socket receipt counters.
  var nativeStandJournal = root.__nativeStandJournal ||= { offers: {}, receipts: {} };
  if (parent.__nativeStandListener && parent.socket) parent.socket.off("ui", parent.__nativeStandListener);
  parent.__nativeStandListener = function (event) {
    if (!event || event.type !== "+$$" || event.buyer !== character.name) return;
    var offer = Object.values(nativeStandJournal.offers).find(function (entry) { return entry.slot === event.slot; });
    if (!offer || !event.item || event.item.name !== offer.itemId ||
        Number(event.item.level || 0) !== offer.level || Number(event.item.price) !== offer.price) return;
    nativeStandJournal.receipts[offer.token] = (Number(nativeStandJournal.receipts[offer.token]) || 0) + (Number(event.item.q) || 1);
  };
  if (parent.socket && typeof parent.socket.on === "function") parent.socket.on("ui", parent.__nativeStandListener);
  var nativePurchaseReceipts = root.__nativePurchaseReceipts ||= {};
  async function flushNativePurchaseReceipts() {
    for (var id of Object.keys(nativePurchaseReceipts)) {
      await request("/merchant/native-stand", { method: "POST", body: nativePurchaseReceipts[id] });
      delete nativePurchaseReceipts[id];
    }
  }
  var nativeStandSerial = Promise.resolve();
  function nativeStandSync(command, suspend) {
    var run = nativeStandSerial.then(function () { return reconcileNativeStand(command, suspend); });
    nativeStandSerial = run.catch(function () {});
    return run;
  }
  async function reconcileNativeStand(command, suspend) {
    async function report(extra) {
      var result = await request("/merchant/native-stand", { method: "POST", body: Object.assign({
        character: character.name, jobId: command && command.jobId, suspend: !!suspend,
        slots: character.slots, open: !!character.stand, gold: character.gold,
        space: (character.items || []).filter(function (item) { return !item; }).length > 3,
        receipts: nativeStandJournal.receipts,
      }, extra || {}) });
      Object.values(result.offers || {}).forEach(function (offer) {
        if (nativeStandJournal.receipts[offer.token] == null) {
          var live = character.slots[offer.slot];
          nativeStandJournal.receipts[offer.token] = live && live.b && String(live.rid) === offer.rid
            ? Math.max(offer.acknowledged, offer.quantity - Number(live.q || 1)) : offer.acknowledged;
        }
      });
      nativeStandJournal.offers = result.offers || {};
      return result;
    }
    var response = await report();
    if (suspend && Object.keys(response.offers || {}).length && !character.stand) {
      await open_stand();
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
      response = await report();
    }
    for (var offer of response.remove || []) {
      var current = character.slots[offer.slot];
      if (!current || !current.b || String(current.rid) !== offer.rid) throw new Error("Native offer changed before removal");
      try {
        await unequip(offer.slot);
        for (var attempt = 0; attempt < 30 && character.slots[offer.slot]; attempt++)
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
        if (character.slots[offer.slot]) throw new Error("Native offer removal was not confirmed");
        response = await report({ removed: offer.token });
      } catch (error) { await report({ failed: offer.token }); throw error; }
    }
    // Reserve all requested slots before placing. Each acknowledgement is persisted
    // before another game mutation; the next observation cannot replenish a lost offer.
    for (var creation = 0; creation < 16 && response.create && response.create.length; creation++) {
      var offer = response.create[0];
      try {
        await wishlist(offer.slot, offer.itemId, offer.price, offer.level, offer.quantity);
        for (var attempt = 0; attempt < 30 && !character.slots[offer.slot]; attempt++)
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
        response = await report();
      } catch (error) { await report({ failed: offer.token }); throw error; }
    }
    return response;
  }
  async function guardedMarketPurchase(command, listing, item, price, quantity, purchase, wholeStack) {
    await nativeStandSync(command, true);
    var key = listing.key || [listing.seller, listing.slot, listing.rid].join(":");
    var prepared = await request("/merchant/native-stand", { method: "POST", body: {
      action: "purchase", character: character.name, jobId: command.jobId, key: key,
      item: fingerprint(item), price: price, quantity: quantity, automatic: !!(command.bidItemId || listing.bidItemId),
      wholeStack: !!wholeStack,
    }});
    if (!prepared.quantity) return 0;
    await purchase(prepared.quantity);
    nativePurchaseReceipts[command.jobId + ":" + key] = { action: "purchased", character: character.name, jobId: command.jobId, key: key };
    await flushNativePurchaseReceipts();
    return prepared.quantity;
  }

  async function consolidateMerchantInventory(command) {
    var merge = command.inventoryMerge;
    if (!merge || character.ctype !== "merchant" || root.__merchantActiveJob || anniversaryBusy ||
        banking || gatheringActive || merchantAnniversaryWorkReserved() || !runtimeCurrent()) return;
    if (Date.now() < (Number(root.__merchantStackRetryAt) || 0)) return;
    try {
      var permission = await request("/merchant/stack-merge-permission", { method: "POST", body: {
        character: character.name, merge: merge,
      }});
      if (!permission.allowed || !runtimeCurrent() || root.__merchantActiveJob || anniversaryBusy || banking || gatheringActive) return;
    } catch (_mergePermissionError) { return; }
    var target = character.items[merge.to], source = character.items[merge.from];
    if (!target || !source || merge.to === merge.from || target.l || source.l || target.b || source.b ||
        !!target.v !== !!source.v || !!target.v !== !!merge.target.v || !!source.v !== !!merge.source.v ||
        bankStackIdentity(target) !== bankStackIdentity(merge.target) ||
        bankStackIdentity(source) !== bankStackIdentity(merge.source) ||
        bankStackIdentity(target) !== bankStackIdentity(source) ||
        Number(target.q) !== Number(merge.target.q) || Number(source.q) !== Number(merge.source.q)) return;
    var total = Number(target.q) + Number(source.q), limit = Number(G.items[target.name] && G.items[target.name].s) || 1;
    if (!Number.isSafeInteger(total) || total > limit || limit <= 1) return;
    // The server swaps incompatible items instead of rejecting imove. Use the
    // live SDK rule too, so newly introduced restrictions cannot shuffle stacks.
    if (typeof can_stack === "function" && !can_stack(target, source)) return;
    root.__merchantStackRetryAt = Date.now() + 10000;
    try {
      await anniversaryWithTimeout(swap(merge.to, merge.from), 2000, "Inventory stack merge");
      var deadline = Date.now() + 1500;
      while (runtimeCurrent() && Date.now() < deadline &&
          (character.items[merge.from] || Number((character.items[merge.to] || {}).q) !== total)) await sleep(100);
      if (!character.items[merge.from] && Number((character.items[merge.to] || {}).q) === total) {
        root.__merchantStackRetryAt = 0;
        root.__merchantStackError = null;
      } else root.__merchantStackError = "Inventory stack merge was not confirmed";
    } catch (_stackError) {
      root.__merchantStackError = String(_stackError && (_stackError.message || _stackError.reason) || _stackError);
    }
  }

  async function merchantStandInventoryReady(command) {
    try {
      if (root.__merchantInventoryTidy) await root.__merchantInventoryTidy;
      if (luckyUpgradeService && luckyUpgradeService.pending()) await luckyUpgradeService.recover();
      else if (character.ctype === "merchant" && root.localStorage.getItem("party-lucky-upgrade:" + character.name)) await merchantLuckyUpgrade().recover();
      return true;
    } catch (error) {
      await request("/merchant/idle-status", { method: "POST", body: {
        character: character.name, commandId: command.id, phase: "inventory-recovery",
        error: String(error.reason || error.message || error),
      }});
      return false;
    }
  }

  async function merchantIdle(command) {
    if (root.__partyUpgradePreviewInFlight) return {state:"deferred"};
    if (root.__merchantActiveJob && !(command.inPlace && command.jobId === root.__merchantActiveJob.jobId)) return { state: "skipped" };
    // The gathering cooldown loop and coordinator can both request an idle
    // refresh. Never discard the newer request: wait for the in-flight stand
    // mutation, then reconcile the latest desired listing set.
    if (merchantIdleActive) {
      if (command.inPlace) return { state: "deferred" };
      merchantIdlePending = command;
      return;
    }
    merchantIdleActive = true;
    var resumeGatheringMode = null;
    var standWasOpen = !!character.stand, idleOwner = lastCommand, idleStage = "return";
    function ownsIdle() { return runtimeCurrent() && lastCommand === idleOwner && (!root.__merchantActiveJob || (command.inPlace && command.jobId === root.__merchantActiveJob.jobId)); }
    try {
      if (command.homeRealm) merchantHomeRealm = command.homeRealm;
      var liveRealm = "SR_" + String(parent.server_region || "US") + String(parent.server_identifier || "II");
      if (liveRealm !== merchantHomeRealm) {
        await request("/merchant/ensure-home-realm", { method: "POST", body: {
          character: character.name, realm: merchantHomeRealm,
        }});
        // The coordinator restarts this character on the home realm. Keep this
        // old runtime from walking/opening a stand while shutdown is pending.
        await new Promise(function () {});
      }
      if (command.inPlace) {
        // Closed stands retain their trade inventory server-side. Suspend an
        // optional gathering route so newly marked bag items can be moved into
        // that persistent storage without first walking home.
        resumeGatheringMode = gatheringMode;
        gatheringGeneration += 1;
        root.__merchantGatheringGeneration = gatheringGeneration;
        if (gatheringTimer) clearInterval(gatheringTimer);
        if (root.__merchantGatheringTimer) clearInterval(root.__merchantGatheringTimer);
        gatheringTimer = root.__merchantGatheringTimer = null;
        if (gatheringSession) gatheringSession.atStandForCooldown = false;
        try { if (typeof stop === "function") await stop("smart"); }
        catch (_standSyncStopError) { /* No gathering path was active. */ }
      }
      var atStandLocation = character.map === merchantMarketLocation.map &&
        Math.hypot(character.x - merchantMarketLocation.x, character.y - merchantMarketLocation.y) <= 35;
      // Closing hides trade1..trade16 from the owner's character snapshot, but
      // the server keeps those items in persistent stand storage. A local sync
      // may therefore open, mutate and close the stand anywhere without
      // returning its existing listings to the bag.
      if (!atStandLocation && !command.inPlace) {
        await request("/merchant/idle-status", { method: "POST", body: {
          character: character.name, commandId: command.id, phase: "returning",
        }});
        if (character.stand) await close_stand();
        if (!ownsIdle()) return;
        await merchantTownReturn(null, ownsIdle);
        if (!ownsIdle()) return;
        await anniversaryWithTimeout(smart_move(merchantMarketLocation), 90000, "Merchant stand return");
      }
      if (!command.inPlace && (character.map !== merchantMarketLocation.map ||
          Math.hypot(character.x - merchantMarketLocation.x, character.y - merchantMarketLocation.y) > 35)) {
        throw new Error("Merchant stand return ended before reaching the market");
      }
      if (!runtimeCurrent() || lastCommand !== idleOwner ||
          root.__merchantActiveJob && !(command.inPlace && command.jobId === root.__merchantActiveJob.jobId)) throw new Error("interrupted");
      idleStage = "stand";
      if (!command.inPlace) await request("/merchant/idle-status", { method: "POST", body: {
        character: character.name, commandId: command.id, phase: "arrived",
      }});
      // Trade-slot mutations require the stand to be open, but they can be
      // reconciled in place while it remains open.
      if (!character.stand) {
        await open_stand();
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        if (!character.stand) throw new Error("Merchant stand did not open");
      }
      if (!await merchantStandInventoryReady(command)) return { state: "deferred" };
      if (typeof nativeStandSync === "function") await nativeStandSync(command, false);
      var desired = (command.listings || []).filter(function (entry) { return entry.state !== "paused"; }), consumedListings = {}, liveListings = [];
      for (var tradeIndex = 1; tradeIndex <= 16; tradeIndex += 1) {
        var tradeSlot = "trade" + tradeIndex, listed = character.slots[tradeSlot];
        if (!listed || listed.b) continue;
        var match = desired.find(function (entry, index) {
          return !consumedListings[index] && sameItem(listed, entry.item) &&
            Number(listed.price) === Number(entry.price) &&
            Math.min(Number(entry.quantity) || 1, Number(listed.q) || 1) === (Number(listed.q) || 1);
        });
        if (match) {
          var matchIndex = desired.indexOf(match);
          consumedListings[matchIndex] = true;
          liveListings.push({ id: match.id, tradeSlot: tradeSlot });
        }
        else await unequip(tradeSlot);
      }
      for (var listingIndex = 0; listingIndex < desired.length; listingIndex += 1) {
        var listing = desired[listingIndex];
        if (consumedListings[listingIndex]) continue;
        var inventorySlot = Number.isInteger(listing.slot) && sameItem(character.items[listing.slot], listing.item)
          ? listing.slot : findItem(listing.item);
        if (inventorySlot < 0) continue;
        var emptyTrade = null;
        for (var emptyIndex = 1; emptyIndex <= 16; emptyIndex += 1) {
          if (!character.slots["trade" + emptyIndex]) { emptyTrade = "trade" + emptyIndex; break; }
        }
        if (!emptyTrade) break;
        await verifyMerchantItemMarks();
        await trade(inventorySlot, emptyTrade, listing.price,
          Math.min(listing.quantity || 1, character.items[inventorySlot].q || 1));
        for (var settle = 0; settle < 30 && !sameItem(character.slots[emptyTrade], listing.item); settle += 1)
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
        if (!sameItem(character.slots[emptyTrade], listing.item))
          throw new Error("stand listing did not populate " + emptyTrade + ": " + listing.item.name);
        consumedListings[listingIndex] = true;
        liveListings.push({ id: listing.id, tradeSlot: emptyTrade });
      }
      if (typeof nativeStandSync === "function") await nativeStandSync(command, false);
      await consolidateMerchantInventory(command);
      if (!command.inPlace && ownsIdle() && !root.__merchantActiveJob) {
        root.__merchantInventoryTidy = merchantLuckyUpgrade().tidy(luckyUpgradeSlot);
        try { await root.__merchantInventoryTidy; }
        catch (tidyError) {
          await request("/merchant/idle-status", { method: "POST", body: {
            character: character.name, commandId: command.id, phase: "inventory-recovery",
            error: String(tidyError.reason || tidyError.message || tidyError),
          }});
        }
        finally { root.__merchantInventoryTidy = null; }
      }
      await request("/merchant/idle-status", { method: "POST", body: {
        character: character.name, commandId: command.id, phase: "complete", liveListings: liveListings,
        inventory: character.items.map(function (item, slot) {
          return item ? { slot: slot, item: fingerprint(item) } : null;
        }),
      }});
      if (command.closeAfterSync && !standWasOpen && character.stand) await close_stand();
      game_log(command.inPlace ? "Marked items moved into persistent stand storage" :
        "Merchant stand open; waiting for trades", "#51D2E1");
      return { state: "complete", liveListings: liveListings };
    } catch (error) {
      try { await request("/merchant/idle-status", { method: "POST", body: {
        character: character.name, commandId: command.id, phase: "failed",
        stage: idleStage,
        error: String(error.reason || error.message || error),
      }}); } catch (_statusError) { /* A newer command superseded this attempt. */ }
      throw error;
    } finally {
      merchantIdleActive = false;
      if (!root.__merchantActiveJob && resumeGatheringMode && gatheringModes.indexOf(resumeGatheringMode) >= 0) setGathering(resumeGatheringMode);
      if (merchantIdlePending) {
        var pendingIdle = merchantIdlePending;
        merchantIdlePending = null;
        setTimeout(function () {
          merchantIdle(pendingIdle).catch(function (error) {
            console.warn("deferred merchant stand refresh failed", error);
          });
        }, 0);
      }
    }
  }

  async function merchantStandSync(command) {
    try {
      var result = await merchantIdle({ id: command.id, jobId: command.jobId, listings: command.listings || [], inPlace: true, closeAfterSync: true });
      if (!result || result.state !== "complete") throw new Error("Stand inventory sync did not execute: " + (result && result.state || "interrupted"));
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true,
        activity: [{ level: "success", message: "Marked inventory moved into persistent stand storage" }],
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        activity: [{ level: "error", message: "Stand inventory sync failed",
          details: String(error.reason || error.message || error) }],
      }}); } catch (_completeError) { /* The job was already cleared. */ }
      throw error;
    }
  }

  function gatheringDestination(mode) {
    // Walkable points immediately beside the gathering zones defined in G.maps.
    return mode === "fishing"
      ? { map: "main", x: -1597, y: 552 }
      // Stand in the east corridor immediately beside the mining polygon. The
      // skill targets the adjacent ore zone; coordinates inside that polygon
      // are collision geometry and cannot be walked to.
      : { map: "tunnel", x: 277, y: -96 };
  }

  function gatheringStatus(message, level, details, repeat) {
    var now = Date.now();
    if (!repeat && (gatheringLastStatus === message ||
        now - (Number(gatheringStatusTimes[message]) || 0) < 30000)) return;
    gatheringLastStatus = message;
    gatheringStatusTimes[message] = now;
    request("/merchant/gather-status", { method: "POST", body: {
      character: character.name, mode: gatheringMode, message: message,
      level: level || "info", details: details || null,
    }}).catch(function () { /* Reporting must never stop gathering. */ });
  }

  function gatheringBaseline() {
    var baseline = [];
    function add(item) {
      if (!item) return;
      var existing = baseline.find(function (entry) { return sameItem(entry.item, item); });
      if (existing) existing.quantity += itemQuantity(item);
      else baseline.push({ item: fingerprint(item), quantity: itemQuantity(item) });
    }
    character.items.forEach(add);
    // Equipping the tool moves existing weapons into inventory. Include them so
    // that movement is not mistaken for a newly gathered drop.
    add(character.slots && character.slots.mainhand);
    add(character.slots && character.slots.offhand);
    return baseline;
  }

  function gatheringInventoryTotals() {
    var totals = {};
    character.items.forEach(function (item) {
      if (!item) return;
      var key = item.name + "@" + (item.level || 0);
      if (!totals[key]) totals[key] = { item: fingerprint(item), quantity: 0 };
      totals[key].quantity += itemQuantity(item);
    });
    return totals;
  }

  async function reportGatheringResult(mode, before, result, current) {
    var fishing = mode === "fishing";
    if (result && result.found === false) {
      gatheringStatus(fishing ? "Didn't catch anything" : "Didn't mine anything", "info", null, true);
      return;
    }
    // The success event and inventory update can arrive on adjacent turns.
    await new Promise(function (resolve) { setTimeout(resolve, 250); });
    if (current && !current()) return;
    var after = gatheringInventoryTotals(), gains = [];
    Object.keys(after).forEach(function (key) {
      var quantity = after[key].quantity - (before[key] && before[key].quantity || 0);
      if (quantity > 0) gains.push({ item: after[key].item, quantity: quantity });
    });
    if (!gains.length) {
      gatheringStatus(fishing ? "Caught an item" : "Mined an item", "success", result || null, true);
      return;
    }
    var message = gains.map(function (gain) {
      var name = G.items[gain.item.name] && G.items[gain.item.name].name || gain.item.name;
      return (gain.quantity > 1 ? gain.quantity + " × " : "") + name +
        ((gain.item.level || 0) > 0 ? " +" + gain.item.level : "");
    }).join(", ");
    gatheringStatus((fishing ? "Caught " : "Mined ") + message, "success", null, true);
  }

  async function settleBeforeGathering(current) {
    // smart_move resolves when its route completes, but the final movement
    // packet can still be active on the character/server for a short time.
    if (typeof stop === "function") {
      await stop("smart");
      if (is_moving(character)) await stop("move");
    }
    var deadline = Date.now() + 6000, stableSince = 0;
    var previousX = Number(character.x), previousY = Number(character.y);
    while (Date.now() < deadline) {
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
      if (current && !current()) throw new Error("interrupted");
      var x = Number(character.x), y = Number(character.y);
      var stable = !is_moving(character) && Math.abs(x - previousX) < 0.05 && Math.abs(y - previousY) < 0.05;
      if (stable) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 500) return;
      } else stableSince = 0;
      previousX = x;
      previousY = y;
    }
    throw new Error("movement did not settle at gathering spot");
  }

  function baselineAmount(session, item) {
    var entry = (session.baseline || []).find(function (candidate) { return sameItem(candidate.item, item); });
    return entry ? entry.quantity : 0;
  }

  async function ensureGatheringTool(session, generation, current) {
    function carried() {
      return (character.slots && character.slots.mainhand && character.slots.mainhand.name === session.tool) ||
        character.items.some(function (item) { return item && item.name === session.tool; });
    }
    if (carried()) return true;
    gatheringStatus("Checking bank for " + session.tool, "info");
    if (character.stand) await close_stand();
    if (current && !current()) return false;
    await smart_move("bank");
    if (generation !== root.__merchantGatheringGeneration || current && !current()) return false;
    if (!character.bank) throw new Error("Bank inventory unavailable while checking gathering tool");
    await retrieveFromBankUntil(session.tool, 1);
    if (generation !== root.__merchantGatheringGeneration || current && !current()) return false;
    if (carried()) {
      session.baseline = gatheringBaseline();
      return true;
    }
    await request("/merchant/gather-status", { method: "POST", body: {
      character: character.name, mode: session.mode, noTool: true,
      message: (session.mode === "fishing" ? "Fishing" : "Mining") + " off: no tool in inventory or bank",
      level: "info",
    }});
    if (current && !current()) return false;
    gatheringModes = gatheringModes.filter(function (mode) { return mode !== session.mode; });
    selectGatheringMode();
    return false;
  }

  async function equipGatheringTool(session, current) {
    // A stand and an equipment mutation cannot overlap. This commonly occurs
    // when a gathering cooldown expires while the merchant is idling.
    if (character.stand) {
      await close_stand();
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
      if (current && !current()) return;
    }
    var equipped = character.slots && character.slots.mainhand;
    // Remember equipment actually displaced by this cast, including manual
    // changes made since the gathering session was first created.
    if (equipped && ["rod", "pickaxe"].indexOf(equipped.name) < 0) {
      session.mainhand = fingerprint(equipped);
      session.offhand = fingerprint(character.slots && character.slots.offhand);
    }
    var bestLevel = equipped && equipped.name === session.tool ? Number(equipped.level) || 0 : -1;
    var slot = -1;
    character.items.forEach(function (item, index) {
      if (item && item.name === session.tool && (Number(item.level) || 0) > bestLevel) {
        bestLevel = Number(item.level) || 0;
        slot = index;
      }
    });
    if (slot < 0 && equipped && equipped.name === session.tool) {
      if (character.slots && character.slots.offhand) {
        await unequip("offhand");
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
      }
      return;
    }
    if (slot < 0) throw new Error("Missing " + session.tool + " in merchant inventory");
    // Rods and pickaxes are mainhand tools. An equipped offhand can make the
    // server reject the tool with cant_equip, so preserve it in the session and
    // remove it before equipping the tool.
    if (character.slots && character.slots.offhand) {
      await unequip("offhand");
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
      // Re-find the tool because an unequip packet may occupy an inventory hole.
      if (current && !current()) return;
      slot = character.items.findIndex(function (item) {
        return item && item.name === session.tool && (Number(item.level) || 0) === bestLevel;
      });
      if (slot < 0) throw new Error("Best " + session.tool + " moved while clearing offhand");
    }
    await equip(slot, "mainhand");
    await new Promise(function (resolve) { setTimeout(resolve, 250); });
    if (current && !current()) return;
    if (!character.slots || !character.slots.mainhand || character.slots.mainhand.name !== session.tool)
      throw new Error("Game did not equip " + session.tool);
    gatheringStatus("Equipped best " + session.tool + " (+" + bestLevel + ")", "success");
  }

  async function restoreGatheringEquipment(session, current) {
    if (!session) return true;
    var restoreGeneration = root.__merchantGatheringGeneration;
    var ownsRestore = current || function () { return restoreGeneration === root.__merchantGatheringGeneration; };
    try {
      if (!ownsRestore()) return false;
      if (character.stand) {
        await close_stand();
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        if (!ownsRestore()) return false;
      }
      var designated = merchantWeapon && merchantWeapon.item;
      // Restore the weapon displaced by the tool even without an explicit
      // merchant-weapon mark. A later sale mark releases that saved weapon.
      var savedMainhand = session.mainhand;
      if (savedMainhand && (["rod", "pickaxe"].indexOf(savedMainhand.name) >= 0 ||
          gatheringStandListings.some(function (listing) {
            return listing && listing.item && sameItem(savedMainhand, listing.item);
          }))) savedMainhand = null;
      var restoreMainhand = designated || savedMainhand || null;
      var savedDefinition = restoreMainhand && G.items[restoreMainhand.name];
      var savedWeaponType = savedDefinition && savedDefinition.wtype;
      var classDefinition = G.classes && G.classes[character.ctype] || {};
      var savedMainhandCompatible = !restoreMainhand || !savedWeaponType ||
        !!(classDefinition.mainhand && classDefinition.mainhand[savedWeaponType]) ||
        !!(classDefinition.doublehand && classDefinition.doublehand[savedWeaponType]);
      if (restoreMainhand && !savedMainhandCompatible) {
        gatheringStatus("Merchant weapon is incompatible: " + restoreMainhand.name, "error");
        restoreMainhand = null;
      }
      var isDoublehand = !!(restoreMainhand && savedWeaponType &&
        classDefinition.doublehand && classDefinition.doublehand[savedWeaponType]);
      if (isDoublehand && character.slots && character.slots.offhand) {
        await unequip("offhand");
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        if (!ownsRestore()) return false;
      }
      if (restoreMainhand && !sameItem(character.slots && character.slots.mainhand, restoreMainhand)) {
        var mainSlot = findItem(restoreMainhand);
        if (mainSlot < 0) throw new Error("Merchant weapon is no longer in inventory: " + restoreMainhand.name);
        await equip(mainSlot, "mainhand");
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        if (!ownsRestore()) return false;
        if (!sameItem(character.slots && character.slots.mainhand, restoreMainhand))
          throw new Error("Game did not equip merchant weapon " + restoreMainhand.name);
      } else if (!restoreMainhand && character.slots && character.slots.mainhand &&
          (["rod", "pickaxe"].indexOf(character.slots.mainhand.name) >= 0 ||
           gatheringStandListings.some(function (listing) {
             return listing && listing.item && sameItem(character.slots.mainhand, listing.item);
           }))) {
        await unequip("mainhand");
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        if (!ownsRestore()) return false;
        if (character.slots && character.slots.mainhand)
          throw new Error("Game did not clear the merchant mainhand");
      }
      if (!isDoublehand && session.offhand && !sameItem(character.slots && character.slots.offhand, session.offhand)) {
        var offSlot = findItem(session.offhand);
        if (offSlot < 0) throw new Error("Previous offhand is no longer in inventory");
        await equip(offSlot, "offhand");
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        if (!ownsRestore()) return false;
        if (!sameItem(character.slots && character.slots.offhand, session.offhand))
          throw new Error("Game did not equip previous offhand " + session.offhand.name);
      }
      gatheringStatus(designated ? "Equipped marked merchant weapon after gathering" :
        "Restored equipment after gathering", "success");
      return true;
    } catch (error) {
      if (!ownsRestore()) return false;
      gatheringStatus("Could not restore pre-gathering equipment", "error",
        String(error.reason || error.message || error));
      return false;
    }
  }

  async function depositGatheringGains(session, current) {
    var gains = [];
    character.items.forEach(function (item) {
      if (!item || gains.some(function (gain) { return sameItem(gain.item, item); })) return;
      var gained = inventoryAmount(item) - baselineAmount(session, item);
      if (gained > 0) gains.push({ item: fingerprint(item), quantity: gained });
    });
    if (!gains.length) return 0;
    gatheringStatus("Gathering inventory nearly full; banking new drops", "info");
    await closeMerchantStandForTravel();
    if (current && !current()) return 0;
    await smart_move("bank");
    if (current && !current()) return 0;
    // We have left the market. Never let the cooldown branch mistake the old
    // stand visit for the merchant's current physical location.
    session.atStandForCooldown = false;
    var deposited = 0;
    // Whole new stacks first, creating room to split gains merged into old stacks.
    gains.sort(function (a, b) { return baselineAmount(session, a.item) - baselineAmount(session, b.item); });
    for (var i = 0; i < gains.length; i += 1) {
      var gain = gains[i], remaining = gain.quantity;
      while (remaining > 0) {
        if (current && !current()) return deposited;
        var slot = findItem(gain.item);
        if (slot < 0) break;
        var stackQuantity = itemQuantity(character.items[slot]);
        var keep = Math.max(0, stackQuantity - remaining);
        if (!keep) {
          await bankStoreFully(slot);
          deposited += stackQuantity;
          remaining -= stackQuantity;
          continue;
        }
        if (freeInventorySlots() < 1) break;
        var before = character.items.map(function (item) { return JSON.stringify(fingerprint(item)); });
        var splitQuantity = remaining;
        await split(slot, splitQuantity);
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        if (current && !current()) return deposited;
        var splitSlot = character.items.findIndex(function (item, index) {
          return before[index] !== JSON.stringify(fingerprint(item)) && sameItem(item, gain.item) &&
            itemQuantity(item) === splitQuantity;
        });
        if (splitSlot < 0 || splitSlot === slot) break;
        await bankStoreFully(splitSlot);
        deposited += splitQuantity;
        remaining = 0;
      }
    }
    session.baseline = gatheringBaseline();
    var sortActivity = [];
    try {
      await sortCurrentBankFloor(sortActivity);
      if (sortActivity.length) gatheringStatus(sortActivity[sortActivity.length - 1].message, "success");
    } catch (sortError) {
      gatheringStatus("Bank sorting failed after gathering deposit", "error",
        String(sortError.reason || sortError.message || sortError));
    }
    gatheringStatus("Banked " + deposited + " newly gathered item" + (deposited === 1 ? "" : "s"), "success");
    return deposited;
  }

  function gatheringAttemptCurrent(attempt) {
    return root.__merchantGatheringAttempt === attempt && !attempt.cancelled &&
      attempt.generation === root.__merchantGatheringGeneration &&
      !root.__merchantActiveJob && !anniversaryBusy && !merchantAnniversaryWorkReserved();
  }

  async function gatheringCommandHandoff(command) {
    var attempt = root.__merchantGatheringAttempt;
    if (!attempt || command.type === "merchant-gather") return true;
    var override = !/^merchant-/.test(command.type) || merchantForceStand || merchantAnniversaryWorkReserved();
    if (attempt.phase === "casting" && !override) {
      attempt.waitingCommand = command.id;
      reportMerchantCommand(command, "deferred", "finishing " + attempt.mode + " cast");
      return false;
    }
    attempt.cancelled = "command " + command.type;
    root.__merchantLogisticsHoldUntil = Date.now() + 1000;
    if (typeof stop === "function") await stop();
    await attempt.done;
    return true;
  }

  function gatheringBlockReason(generation) {
    if (generation !== root.__merchantGatheringGeneration) return "superseded generation";
    if (!gatheringMode) return "disabled";
    if (gatheringActive || root.__merchantGatheringAttempt) return "active gathering attempt";
    if (merchantIdleActive) return "stand operation";
    if (busy) return "status update";
    if (banking) return "banking";
    if (root.__merchantActiveJob) return "merchant job";
    if (Date.now() < (Number(root.__merchantLogisticsHoldUntil) || 0)) return "logistics handoff";
    if (anniversaryBusy || merchantAnniversaryWorkReserved()) return "anniversary reservation";
    if (Date.now() < gatheringRetryAt) return "retry delay";
    if (upgrading) return "upgrading";
    if (departurePending) return "departure pending";
    if (character.rip) return "dead";
    return null;
  }

  async function gatheringTick(generation) {
    if (root.__partyConsoleMaintenance) return;
    var blocked = gatheringBlockReason(generation);
    root.__merchantGatheringBlockedReason = blocked;
    if (blocked) {
      if (["merchant job", "stand operation", "banking", "anniversary reservation", "upgrading", "departure pending"].indexOf(blocked) >= 0 &&
          root.__merchantGatheringWaitMessage !== blocked) {
        root.__merchantGatheringWaitMessage = blocked;
        gatheringStatus((gatheringMode === "fishing" ? "Fishing" : "Mining") + " waiting for " + blocked, "info");
      }
      return;
    }
    root.__merchantGatheringWaitMessage = null;
    gatheringActive = true;
    var mode = gatheringMode, session = gatheringSession;
    var attempt = { id: generation + ":" + Date.now(), generation: generation, mode: mode, phase: "preparing" };
    var release;
    attempt.done = new Promise(function (resolve) { release = resolve; });
    root.__merchantGatheringAttempt = attempt;
    function current() { return gatheringAttemptCurrent(attempt); }
    try {
      if (character.level < 16) throw new Error("Gathering requires merchant level 16");
      if (freeInventorySlots() < 3) {
        await depositGatheringGains(session, current);
        if (!current()) return;
      }
      var destination = gatheringDestination(mode);
      session.cooldownUntil = Math.max(Number(session.cooldownUntil) || 0, syncGatheringCooldown(mode));
      if (session.cooldownUntil > Date.now() || is_on_cooldown(mode)) {
        attempt.phase = "cooldown";
        if (session.atStandForCooldown && (!character.stand || character.map !== merchantMarketLocation.map ||
            Math.hypot(character.x - merchantMarketLocation.x, character.y - merchantMarketLocation.y) > 35))
          session.atStandForCooldown = false;
        if (session.atStandForCooldown && character.slots && character.slots.mainhand &&
            character.slots.mainhand.name === session.tool) {
          if (character.stand) await close_stand();
          session.atStandForCooldown = false;
        }
        if (!session.atStandForCooldown) {
          gatheringStatus((mode === "fishing" ? "Fishing" : "Mining") + " cooling down; returning to stand", "info");
          var restored = await restoreGatheringEquipment(session, current);
          if (!current()) return;
          if (!restored) {
            gatheringRetryAt = Date.now() + 5000;
            return;
          }
          // Gathering spots can be several maps away. Use the same Town return
          // used by merchant logistics before walking the short market leg.
          await merchantTownReturn(null, current);
          if (!current()) return;
          // Let the final equip packet settle before open_stand. Without this,
          // the server can reject the stand operation as cant_equip.
          await new Promise(function (resolve) { setTimeout(resolve, 350); });
          if (!current()) return;
          try {
            await merchantIdle({ id: 0, listings: gatheringStandListings });
          } catch (idleError) {
            if (!current()) return;
            gatheringRetryAt = Date.now() + 5000;
            return;
          }
          session.atStandForCooldown = true;
        }
        return;
      }
      if (session.atStandForCooldown) {
        if (character.stand) await close_stand();
        session.atStandForCooldown = false;
      }
      if (!await ensureGatheringTool(session, generation, current)) return;
      if (!current()) return;
      attempt.phase = "travelling";
      // Route to the map spawn first. The legacy pathfinder can exhaust its
      // cross-map search when asked to solve the tunnel transition and an exact
      // interior coordinate in one pass, returning only {reason:"failed"}.
      if (character.map !== destination.map) {
        gatheringStatus("Going " + mode + " · travelling to " + destination.map, "info");
        try { await smart_move(destination.map); }
        catch (travelError) { throw { reason: "travel_to_" + destination.map + ":" +
          String(travelError.reason || travelError.message || travelError) }; }
        if (!current()) return;
      }
      if (Math.hypot(character.x - destination.x, character.y - destination.y) > 1) {
        gatheringStatus("Going " + mode + " · approaching gathering spot", "info");
        try { await smart_move(destination, undefined, { arrivalTolerance: 1 }); }
        catch (approachError) { throw { reason: "approach_spot:" +
          String(approachError.reason || approachError.message || approachError) }; }
        if (!current()) return;
      }
      attempt.phase = "settling";
      await settleBeforeGathering(current);
      if (!current()) return;
      if (character.map !== destination.map || Math.hypot(character.x - destination.x, character.y - destination.y) > 1)
        throw new Error("approach_spot:arrival outside gathering tolerance");
      // Keep travel equipment (notably the broom's speed bonus) until arrival.
      await equipGatheringTool(session, current);
      if (!current()) return;
      if (!is_on_cooldown(mode) && can_use(mode)) {
        var beforeGathering = gatheringInventoryTotals();
        gatheringStatus(mode === "fishing" ? "Fishing…" : "Mining…", "info");
        attempt.phase = "casting";
        var gatheringResult = await use_skill(mode);
        if (!current()) return;
        await reportGatheringResult(mode, beforeGathering, gatheringResult, current);
        if (!current()) return;
        session.cooldownUntil = Date.now() + (Number(G.skills[mode] && G.skills[mode].reuse_cooldown) || 0);
        gatheringCooldowns[mode] = session.cooldownUntil;
        attempt.phase = "cooldown";
        if (freeInventorySlots() < 3 && generation === root.__merchantGatheringGeneration) {
          await depositGatheringGains(session, current);
          if (current()) await smart_move(destination);
        }
      }
    } catch (error) {
      if (!current()) return;
      if (error && (error.reason === "cooldown" || error.message === "cooldown")) {
        var reportedCooldown = Number(error.ms || error.cooldown || error.remaining);
        session.cooldownUntil = Math.max(serverCooldownUntil(mode), Date.now() + (reportedCooldown > 0 ? reportedCooldown :
          Number(G.skills[mode] && G.skills[mode].reuse_cooldown) || 60000));
        gatheringCooldowns[mode] = session.cooldownUntil;
        gatheringStatus((mode === "fishing" ? "Fishing" : "Mining") + " cooldown detected; returning to stand", "info");
        return;
      }
      var reason = String(error && (error.reason || error.message) || error);
      if (reason === "moving" || /(^|:)interrupted$/.test(reason)) {
        session.cooldownUntil = syncGatheringCooldown(mode);
        gatheringStatus((mode === "fishing" ? "Fishing" : "Mining") +
          " interrupted during " + attempt.phase + ": " + (reason === "moving" ? "movement" : "unknown cause") + "; retrying", "info",
          { attemptId: attempt.id, reason: reason, moving: !!character.moving,
            jobId: root.__merchantActiveJob && root.__merchantActiveJob.jobId }, true);
        gatheringRetryAt = Date.now() + 1000;
        return;
      }
      gatheringStatus((mode === "fishing" ? "Fishing" : "Mining") + " attempt failed: " + reason, "error",
        { reason: reason, mode: mode, position: { map: character.map, x: character.x, y: character.y },
          destination: gatheringDestination(mode),
          distance: Math.hypot(character.x - gatheringDestination(mode).x, character.y - gatheringDestination(mode).y),
          access: hasGatheringAccess(mode) }, true);
      gatheringRetryAt = Date.now() + 15000;
      game_log(mode + " failed: " + (error.reason || error.message || error), "red");
    } finally {
      if (attempt.waitingCommand && generation === root.__merchantGatheringGeneration)
        root.__merchantLogisticsHoldUntil = Date.now() + 5000;
      if (attempt.cancelled) gatheringStatus((mode === "fishing" ? "Fishing" : "Mining") +
        " paused during " + attempt.phase + ": " + attempt.cancelled, "info", { attemptId: attempt.id }, true);
      if (root.__merchantGatheringAttempt === attempt) root.__merchantGatheringAttempt = null;
      gatheringActive = false;
      release();
      if (generation === root.__merchantGatheringGeneration) selectGatheringMode();
    }
  }

  function wakeGatheringAfterStatus() {
    if (character.ctype !== "merchant" || !gatheringMode) return;
    var generation = root.__merchantGatheringGeneration;
    // Status responses select gathering while busy is still true. A timer
    // with a matching cadence can repeatedly hit that same status lock.
    // Yield once so an accepted command can acquire ownership first.
    setTimeout(function () {
      if (runtimeCurrent()) gatheringTick(generation);
    }, 0);
  }

  function selectGatheringMode() {
    var enabled = gatheringModes.filter(function (mode) { return mode === "fishing" || mode === "mining"; });
    if (gatheringActive) {
      if (enabled.indexOf(gatheringMode) < 0 && root.__merchantGatheringAttempt) {
        root.__merchantGatheringAttempt.cancelled = "gathering disabled";
        if (typeof stop === "function") Promise.resolve(stop()).catch(function () {});
      }
      return;
    }
    if (!enabled.length) { if (gatheringMode) setGathering(null); return; }
    var ready = enabled.filter(function (mode) {
      return syncGatheringCooldown(mode) <= Date.now() && !is_on_cooldown(mode);
    });
    var choice = ready[0];
    if (!choice) choice = enabled.slice().sort(function (a, b) {
      return syncGatheringCooldown(a) - syncGatheringCooldown(b);
    })[0];
    if (choice !== gatheringMode) setGathering(choice);
  }

  function setGathering(mode) {
    if (mode === gatheringMode && gatheringTimer) return;
    var oldSession = gatheringSession;
    gatheringMode = mode;
    gatheringGeneration += 1;
    root.__merchantGatheringGeneration = gatheringGeneration;
    var generation = gatheringGeneration;
    if (gatheringTimer) clearInterval(gatheringTimer);
    if (root.__merchantGatheringTimer) clearInterval(root.__merchantGatheringTimer);
    gatheringTimer = null;
    gatheringLastStatus = null;
    if (!mode) {
      gatheringSession = null;
      root.__merchantGatheringSession = null;
      restoreGatheringEquipment(oldSession).catch(function () { /* Status is reported by the restore helper. */ });
      return;
    }
    // Recover sessions created by the older passive gathering loop, which did
    // not remember what the tool replaced. Prefer the highest-level real weapon.
    if (oldSession && oldSession.mode === mode && oldSession.mainhand &&
        oldSession.mainhand.name === oldSession.tool) {
      var replacement = character.items.filter(function (item) {
        return item && G.items[item.name] && G.items[item.name].type === "weapon";
      }).sort(function (a, b) { return (Number(b.level) || 0) - (Number(a.level) || 0); })[0];
      if (replacement) oldSession.mainhand = fingerprint(replacement);
    }
    if (!oldSession || oldSession.mode !== mode) {
      // When alternating two enabled gathering modes, inherit the original
      // combat equipment. Do not start an unawaited restore here: it races the
      // new session and can cause the pickaxe/rod to be remembered as normal gear.
      var currentMainhand = oldSession && oldSession.mainhand || fingerprint(character.slots && character.slots.mainhand);
      if (currentMainhand && ["rod", "pickaxe"].indexOf(currentMainhand.name) >= 0) {
        var priorWeapon = character.items.filter(function (item) {
          return item && G.items[item.name] && G.items[item.name].type === "weapon";
        }).sort(function (a, b) { return (Number(b.level) || 0) - (Number(a.level) || 0); })[0];
        currentMainhand = priorWeapon ? fingerprint(priorWeapon) : null;
      }
      gatheringSession = {
        mode: mode,
        tool: mode === "fishing" ? "rod" : "pickaxe",
        mainhand: currentMainhand,
        offhand: oldSession && oldSession.offhand || fingerprint(character.slots && character.slots.offhand),
        baseline: gatheringBaseline(),
        cooldownUntil: Number(gatheringCooldowns[mode]) || 0,
      };
      root.__merchantGatheringSession = gatheringSession;
    }
    if (!root.__merchantActiveJob && (Number(gatheringSession.cooldownUntil) || 0) > Date.now())
      gatheringStatus((mode === "fishing" ? "Fishing" : "Mining") + " cooling down; will resume automatically", "info");
    else if (!root.__merchantActiveJob) gatheringStatus("Preparing to go " + mode, "info");
    gatheringTick(generation);
    gatheringTimer = setInterval(function () { gatheringTick(generation); }, 2000);
    root.__merchantGatheringTimer = gatheringTimer;
  }

  async function applyNavigationIntent(next) {
    if (!next) return;
    var changed = Number(next.revision) !== Number(navigationIntent.revision) ||
      !!next.cancelled !== !!navigationIntent.cancelled;
    navigationIntent = root.__partyNavigationIntent = next;
    if (!changed) return;
    anniversaryReturnLocation = root.__anniversaryReturnLocation = null;
    anniversaryStagingReported = null;
    anniversaryReturnReported = null;
    var ownsMovement = farmingTravelToken || convoyTraveling || followingLeader || forceTraveling;
    if (farmingTravelToken) farmingTravelToken.cancelled = true;
    if (convoyTraveling) {
      releaseConvoyCruise(convoyTraveling);
      convoyTraveling.cancelled = true;
      if (convoyTraveling.release) convoyTraveling.release();
    }
    followingLeader = false;
    forceTraveling = false;
    if (ownsMovement && typeof stop === "function") {
      try { await stop("smart"); } catch (_navigationIntentStop) {}
      try { await stop("move"); } catch (_navigationIntentMove) {}
    }
  }

  async function merchantSendMail(command) {
    var activity = [], mail = command.mail || {}, source = mail.source || {};
    try {
      if (!mail.source) {
        var textResult = await send_mail(mail.recipient, mail.subject, mail.message || "", false, 20000);
        if (textResult && textResult.failed) throw new Error(textResult.reason || "Mail failed");
        await request("/merchant/complete", { method: "POST", body: { jobId: command.jobId, success: true,
          activity: [{ level: "success", message: "Sent mail to " + mail.recipient }] } });
        return;
      }
      var slot = -1;
      if (source.pack === "merchant") slot = findItem(source.item);
      else {
        var definitions = typeof bank_packs !== "undefined" ? bank_packs : (parent.bank_packs || {});
        var floor = definitions[source.pack] && definitions[source.pack][0] || "bank";
        await smart_move(floor);
        var bankItem = findBankItem(source.item, source.pack, Number(source.slot));
        if (!bankItem) throw new Error("mail attachment is no longer in the selected bank slot");
        await bank_retrieve(bankItem.pack, bankItem.slot);
        await sleep(250);
        slot = findItem(source.item);
      }
      if (slot < 0 || !character.items[slot]) throw new Error("mail attachment is unavailable");
      var wanted = Math.max(1, Number(mail.quantity) || 1);
      var available = itemQuantity(character.items[slot]);
      if (wanted > available) throw new Error("mail attachment quantity is no longer available");
      if (wanted < available) {
        if (freeInventorySlots() < 1) throw new Error("merchant needs one free inventory slot to split the mail attachment");
        var before = character.items.map(function (item) { return JSON.stringify(fingerprint(item)); });
        await split(slot, wanted);
        await sleep(250);
        slot = character.items.findIndex(function (item, index) {
          return index !== slot && before[index] !== JSON.stringify(fingerprint(item)) &&
            sameItem(item, source.item) && itemQuantity(item) === wanted;
        });
        if (slot < 0) throw new Error("could not split the requested mail quantity");
      }
      if (slot !== 0) { await swap(slot, 0); await sleep(250); }
      if (!character.items[0] || !sameItem(character.items[0], source.item) || itemQuantity(character.items[0]) !== wanted)
        throw new Error("could not place the attachment in inventory slot 0");
      var mailResult = await send_mail(mail.recipient, mail.subject, mail.message || "", true, 20000);
      if (mailResult && mailResult.failed) throw new Error(mailResult.reason || "Mail failed");
      activity.push({ level: "success", message: "Sent mail to " + mail.recipient + " with " + wanted + " × " + source.item.name });
      await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: true, activity: activity,
      }});
    } catch (error) {
      try { await request("/merchant/complete", { method: "POST", body: {
        jobId: command.jobId, success: false, error: String(error.reason || error.message || error),
        activity: activity.concat([{ level: "error", message: "Mail delivery failed",
          details: String(error.reason || error.message || error) }]),
      }}); } catch (_completeError) {}
      throw error;
    }
  }

  function reportMerchantCommand(command, state, reason) {
    if (character.ctype !== "merchant" || !command || !command.jobId) return;
    root.__merchantCommandReport = { commandId: command.id, jobId: command.jobId,
      state: state, reason: reason || null, at: Date.now() + coordinatorClockOffset };
  }

  async function handle(command) {
    if (escapeOwns() && !(escapeState.stage === "recovery-convoy" && command && command.purpose === "escape-recovery")) {
      reportMerchantCommand(command, "deferred", "escape"); return;
    }
    if (!command || command.id <= lastCommand) return;
    var ownReunionConvoy=root.__partySharedWalking && root.__partySharedWalking.activity==="farm-recovery" &&
      command.type==="party-monster-travel" && /^shared-walk/.test(command.purpose||"");
    if (reunion && !ownReunionConvoy) await cancelFarmReunion("new coordinator command");
    var farming = character.ctype !== "merchant" && ["travel", "force-travel", "character-travel",
      "party-monster-travel", "event-resume-travel", "return-leader"].indexOf(command.type) >= 0;
    if (!farming) return handleCommand(command);
    if (Number(command.navigationRevision || 0) !== Number(navigationIntent.revision) ||
        navigationIntent.cancelled && !command.navigationExempt) return;
    var token = { id: command.id, revision: navigationIntent.revision, cancelled: false,
      defensiveTravel: ["travel", "character-travel", "return-leader"].indexOf(command.type) >= 0 };
    farmingTravelToken = token;
    try { return await handleCommand(command); }
    finally { if (farmingTravelToken === token) farmingTravelToken = null; }
  }

  async function handleCommand(command) {
    if (root.__partyUpgradePreviewInFlight) return;
    if (root.__partyConsoleMaintenance) return;
    if (!command || command.id <= lastCommand) return;
    if (command.type === "party-monster-travel" && command.phase === "event-walk-release") {
      if (Number(command.navigationRevision) !== Number(navigationIntent.revision) || navigationIntent.cancelled) return;
      var held = convoyTraveling;
      if (held && (held.id !== command.convoyId || held.epoch > Number(command.epoch))) return;
      lastCommand = command.id; root.__partyLastCommand = lastCommand;
      if (held) {
        held.cancelled = true;
        if (held.detachRoute) held.detachRoute();
        releaseConvoyCruise(held);
        if (held.release) held.release();
        convoyTraveling = null;
        if (typeof stop === "function") try { await stop("smart"); } catch (_) {}
      }
      root.__partyEventWalkFailure = { at: Date.now(), reason: command.reason, convoyId: command.convoyId };
      if (root.partyRoleRunner) root.partyRoleRunner.wake();
      return;
    }
    if(command.type==='party-monster-travel' && command.phase==='defending') {
      lastCommand=command.id;root.__partyLastCommand=lastCommand;interruptConvoyForDefense(command.convoyId,command.epoch);
      if(convoyTraveling && convoyTraveling.defensePaused && convoyTraveling.id===command.convoyId) {
        convoyTraveling.commandId=command.id;convoyTraveling.epoch=Number(command.epoch);
      }
      return;
    }
    if(command.type==='party-monster-travel')root.__partyConvoyDefense=null;
    // Stand return can travel safely before checking inventory recovery. Its
    // own guard runs before any listing, consolidation, or tidy mutation.
    var returningToStand = command.type === "merchant-idle" && !command.inPlace;
    if (!returningToStand && character.ctype === "merchant" && root.__merchantInventoryTidy) await root.__merchantInventoryTidy;
    if (!returningToStand && character.ctype === "merchant" && luckyUpgradeService && luckyUpgradeService.pending()) {
      if (root.__merchantActiveJob) { reportMerchantCommand(command, "deferred", "lucky slot inventory operation"); return; }
      try { await luckyUpgradeService.recover(); }
      catch (error) { reportMerchantCommand(command, "deferred", error.message || String(error)); return; }
    }
    if (character.ctype === "merchant" && !root.__merchantActiveJob) {
      try { await recoverProductionJournal(); }
      catch (error) { reportMerchantCommand(command, "deferred", error.message || String(error)); return; }
    }
    if (command.luckyUpgradeSlot !== undefined) luckyUpgradeSlot = command.luckyUpgradeSlot;
    // The coordinator normally stops dispatching these commands two minutes
    // before the round. This local gate closes the heartbeat-sized race where
    // an already-delivered command could otherwise begin during that window.
    if (character.ctype === "merchant" && /^merchant-/.test(command.type) && merchantEventWorkReserved()) {
      reportMerchantCommand(command, "deferred", "event"); return;
    }
    if (character.ctype === "merchant" && command.type !== "merchant-idle" && command.type !== "merchant-stand-sync" &&
        /^merchant-/.test(command.type) && merchantAnniversaryWorkReserved()) {
      reportMerchantCommand(command, "deferred", merchantEventWorkReserved() ? "event" : "anniversary"); return;
    }
    if (character.ctype === "merchant" && !await gatheringCommandHandoff(command)) return;
    if (command.id <= lastCommand) return;
    reportMerchantCommand(command, "accepted");
    if (command.type !== "town-party" && command.purpose !== "shared-walk-return") root.__partyTownGeneration += 1;
    lastCommand = command.id;
    root.__partyLastCommand = lastCommand;
    if (convoyTraveling && (command.type !== "party-monster-travel" ||
        command.convoyId !== convoyTraveling.id || command.id !== convoyTraveling.commandId)) {
      // Assembly -> preparation keeps the same convoy's cap. Every other
      // command takeover restores normal speed before awaiting movement stop.
      if (command.type !== "party-monster-travel" || command.convoyId !== convoyTraveling.id ||
          Number(command.epoch) !== convoyTraveling.epoch) releaseConvoyCruise(convoyTraveling);
      else convoyTraveling.cruiseHandoff = true;
      if (convoyTraveling.freezeRoute) convoyTraveling.freezeRoute();
      convoyTraveling.cancelled = true;
      if (convoyTraveling.release) convoyTraveling.release();
      if (typeof stop === "function") {
        try { await stop("smart"); } catch (_stopError) { /* Already stopped. */ }
      }
    }
    if (character.ctype === "merchant" && command.type !== "merchant-idle" && command.type !== "merchant-stand-sync") {
      // A logistics/crafting job may move us away after the gathering cooldown
      // loop already recorded that it had parked at the stand. Invalidate that
      // positional assertion whenever work takes control, even if the stand was
      // closed elsewhere, so the next cooldown tick must return physically.
      if (gatheringSession) gatheringSession.atStandForCooldown = false;
      if (character.stand) await close_stand();
    }
    if (command.type === "merchant-mluck" && character.ctype === "merchant") return runMerchantJob(
      command, "refreshing Merchant's Luck", function () { return afterCombat(function () {
        return merchantLuck(command);
      }, "refreshing Merchant's Luck"); });
    if (command.type === "merchant-service" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant service", function () { return afterCombat(function () {
        return merchantService(command);
      }, "merchant service"); });
    if (command.type === "merchant-self-improve" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant upgrades and compounds", function () { return afterCombat(function () {
        return merchantSelfImprove(command);
      }, "merchant upgrades and compounds"); });
    if (command.type === "merchant-self-bank" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant bank exchange", function () { return afterCombat(function () {
        return merchantSelfBank(command);
      }, "merchant bank exchange"); });
    if (command.type === "merchant-bank-unlock" && character.ctype === "merchant") return runMerchantJob(
      command, "bank unlock", function () { return afterCombat(function () {
        return merchantBankUnlock(command);
      }, "unlocking bank storage"); });
    if (command.type === "merchant-deconstruct" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant deconstruction", function () { return afterCombat(function () {
        return merchantDeconstruct(command);
      }, "merchant deconstruction"); });
    if (command.type === "merchant-npc-sale" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant NPC sale", function () { return afterCombat(function () {
        return merchantNpcSale(command);
      }, "merchant NPC sale"); });
    if (command.type === "merchant-donate" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant donation", function () { return afterCombat(function () {
        return merchantDonate(command);
      }, "merchant donation"); });
    if (command.type === "merchant-self-restock" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant potion restock", function () { return afterCombat(function () {
        return merchantSelfRestock(command);
      }, "merchant potion restock"); });
    if (command.type === "merchant-commerce" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant shopping and crafting", function () {
        return afterCombat(function () { return merchantCommerce(command); }, "merchant shopping and crafting");
      });
    if (command.type === "merchant-exchange" && character.ctype === "merchant") return runMerchantJob(
      command, "merchant exchange", function () {
        return afterCombat(function () { return merchantExchange(command); }, "merchant exchange");
      });
    if (command.type === "merchant-stand-search" && character.ctype === "merchant") return runMerchantJob(
      command, "stand search", function () { return afterCombat(function () {
        return merchantStandSearch(command);
      }, "stand search"); });
    if (command.type === "merchant-join-giveaway" && character.ctype === "merchant") return runMerchantJob(
      command, "joining giveaway", function () { return afterCombat(function () {
        return merchantJoinGiveaway(command);
      }, "joining giveaway"); });
    if (command.type === "merchant-stand-buy" && character.ctype === "merchant") return runMerchantJob(
      command, "stand purchase", function () { return afterCombat(function () {
        return merchantStandBuy(command);
      }, "stand purchase"); });
    if (command.type === "merchant-ponty-buy" && character.ctype === "merchant") return runMerchantJob(
      command, "Ponty purchase", function () { return afterCombat(function () {
        return merchantPontyBuy(command);
      }, "Ponty purchase"); });
    if (command.type === "merchant-aldata-auth" && character.ctype === "merchant") return runMerchantJob(
      command, "ALData authentication", function () { return afterCombat(function () {
        return merchantALDataAuth(command);
      }, "ALData authentication"); });
    if (command.type === "merchant-aldata-buy" && character.ctype === "merchant") return runMerchantJob(
      command, "ALData marketplace purchase", function () { return afterCombat(function () {
        return merchantALDataBuy(command);
      }, "ALData marketplace purchase"); });
    if (command.type === "merchant-aldata-sell" && character.ctype === "merchant") return runMerchantJob(
      command, "ALData marketplace sale", function () { return afterCombat(function () {
        return merchantALDataSell(command);
      }, "ALData marketplace sale"); });
    if (command.type === "merchant-collect-mail" && character.ctype === "merchant") return runMerchantJob(
      command, "collecting mail attachment", function () { return afterCombat(async function () {
        var error = null;
        try {
          if (freeInventorySlots() < 1) throw new Error("Merchant needs a free inventory slot to collect mail");
          await new Promise(function (resolve, reject) {
            var requestId = "mail-" + command.jobId, timeout;
            function finish(problem) {
              clearTimeout(timeout); parent.socket.off("game_response", listener);
              if (problem) reject(new Error(problem)); else resolve();
            }
            function listener(data) {
              if (!data || data.request_id !== requestId) return;
              if (data.response === "mail_item_taken") finish();
              else if (data.failed || data.response === "inv_size" || data.response === "mail_item_already_taken")
                finish(data.reason || data.response);
            }
            parent.socket.on("game_response", listener);
            timeout = setTimeout(function () { finish("Collection timed out; refresh mail before retrying"); }, 20000);
            try { parent.socket.emit("mail_take_item", { id: command.mail.id, request_id: requestId }); }
            catch (problem) { finish(problem.message); }
          });
        } catch (problem) { error = String(problem.reason || problem.message || problem); }
        await request("/merchant/complete", { method: "POST", body: { jobId: command.jobId, success: !error, error: error,
          activity: [{ level: error ? "error" : "success", message: error ? "Mail collection failed" : "Collected mail attachment", details: error }] } });
      }, "collecting mail attachment"); });
    if (command.type === "merchant-send-mail" && character.ctype === "merchant") return runMerchantJob(
      command, "sending mail to " + (command.mail && command.mail.recipient || "recipient"), function () {
        return afterCombat(function () { return merchantSendMail(command); }, "sending mail");
      });
    if (command.type === "merchant-stand-sync" && character.ctype === "merchant") return runMerchantJob(
      command, "stand inventory sync", function () { return merchantStandSync(command); });
    if (command.type === "merchant-idle" && character.ctype === "merchant") return merchantIdle(command);
    if (command.type === "bankboi-service" && character.ctype === "merchant") return runBankboiService(command);
    if (command.type === "merchant-handoff") return withMerchantHandoffRecovery(command, function () { return merchantHandoff(command); });
    if (command.type === "merchant-order-handoff") return afterCombat(function () {
      return merchantOrderHandoff(command);
    }, "merchant material handoff");
    if (command.type === "restore-equipment") {
      for (var restoreIndex = 0; restoreIndex < (command.items || []).length; restoreIndex += 1) {
        var restore = command.items[restoreIndex], restoreSlot = findItem(restore.item);
        if (restoreSlot >= 0) await equip(restoreSlot, restore.slot);
      }
      return;
    }
    if (command.type === "apply-stat-scrolls") return afterCombat(function () {
      return applyOwnedStatScrolls(command);
    }, "applying stat scrolls");
    if (command.type === "monster-hunt-interact") return afterCombat(async function () {
      var result = null, error = null;
      try {
        await smart_move(find_npc("monsterhunter"));
        result = await interact("monsterhunt");
      } catch (huntError) {
        error = String(huntError && (huntError.reason || huntError.message || huntError));
      }
      await request("/monster-hunt-interact-complete", { method: "POST", body: {
        character: character.name, commandId: command.id, cycleId: command.cycleId,
        action: command.action, success: !error, error: error,
      }});
      if (error) throw new Error(error);
      game_log(command.action === "claim" ? "Monster Hunt reward claimed" : "Monster Hunt accepted", "#c084fc");
      return result;
    }, command.action === "claim" ? "claiming Monster Hunt" : "accepting Monster Hunt");
    if (command.type === "merchant-gather" && character.ctype === "merchant") {
      gatheringModes = Array.isArray(command.modes) ? command.modes.slice() : [];
      selectGatheringMode();
      return;
    }
    if (command.type === "bank") return afterCombat(function () {
      return goBank(command.marked || [], command.withdrawals || [], command.goldTarget, command.returnLocation);
    }, "banking");
    if (command.type === "upgrade") return afterCombat(function () {
      return upgradeMarked(command.items || [], command.compounds || [], command.purchases || [], command.returnLocation);
    }, "upgrading");
    if (command.type === "travel" && command.location) {
      partyLocation = command.location;
      return afterCombat(async function () {
        await smart_move(command.location);
        game_log("Arrived at party location", "#51D2E1");
      }, "party travel");
    }
    if (command.type === "force-travel" && command.location) {
      partyLocation = command.location;
      forceTraveling = true;
      combatTargetId = null;
      try {
        await smart_move(command.location);
        game_log("Force travel arrived at party location", "#51D2E1");
      } finally {
        forceTraveling = false;
      }
      return;
    }
    if (command.type === "town-party") {
      // Clear both the persisted rally point and any in-flight smart path. The
      // configured monster focus is intentionally retained; Find monster must
      // be pressed again to create a new destination.
      partyLocation = null;
      followingLeader = false;
      forceTraveling = false;
      combatTargetId = null;
      departurePending = true;
      townTraveling = true;
      var townGeneration = ++root.__partyTownGeneration;
      try {
        if (typeof stop === "function") {
          // Town is a hard override. Cancel both the smart-path planner and any
          // final ordinary movement packet before beginning the channel.
          try { await stop("smart"); } catch (_townStopError) { /* Already stopped. */ }
          try { await stop("move"); } catch (_townMoveStopError) { /* Already stopped. */ }
          try { await stop(); } catch (_townAllStopError) { /* Already stopped. */ }
        }
        if (character.rip) {
          await respawn();
          while (character.rip) await sleep(100);
        }
        combatTargetId = null;
        var townPoint = { map: "main", x: 0, y: 0 };
        // Incoming damage can cancel the Town channel. Keep combat suppressed
        // and retry until the teleport has actually completed.
        while (runtimeCurrent() && !escapeOwns() && root.__partyTownGeneration === townGeneration && (character.map !== townPoint.map ||
            Math.hypot(Number(character.x) - townPoint.x, Number(character.y) - townPoint.y) > 90)) {
          if (character.rip) {
            await respawn();
            while (character.rip) await sleep(100);
          }
          if (character.map !== "main") {
            await prepareReturnExit(command,"town",function(){return runtimeCurrent() && !escapeOwns() && root.__partyTownGeneration===townGeneration;});
            try { await sharedPartyWalk(townPoint,"town-return",command.cycleId,command,function(){return root.__partyTownGeneration===townGeneration;}); }
            catch (townRouteError) { root.__partyNavigationDetail=String(townRouteError.message||townRouteError);await sleep(3000); }
          } else if (Date.now() - (Number(root.__partyTownLastAttempt) || 0) >= 4000) {
            await saveReturnPhase(command,"town","main-town");
            root.__partyTownLastAttempt = Date.now();
            try { await use_skill("use_town"); } catch (_townInterruptedMain) { /* retry */ }
          }
          await sleep(250);
        }
        if (!runtimeCurrent() || escapeOwns() || root.__partyTownGeneration !== townGeneration) return;
        await saveReturnPhase(command,"town","complete");
        game_log("Used Town; all navigation waypoints cleared", "#51D2E1");
        await request("/town-complete", { method: "POST", body: {
          character: character.name, commandId: command.id, cycleId: command.cycleId,
        }});
      } finally {
        townTraveling = false;
        departurePending = false;
      }
      return;
    }
    if (command.type === "event-return-town") {
      // Event recovery is coordinated as a barrier: every opted-in character
      // returns first, then the coordinator routes the leader back to the
      // selected farming target.
      partyLocation = null;
      followingLeader = false;
      forceTraveling = false;
      eventReturnPending = true;
      joinedEvent = null;
      root.__partyJoinedEvent = null;
      // Keep this across command retries and shared-script hot reloads: a
      // second remote Town could undo progress toward the map exit.
      if (!root.__partyEventReturnTravel || root.__partyEventReturnTravel.cycleId !== command.cycleId)
        root.__partyEventReturnTravel = { cycleId: command.cycleId, remoteTownAttempted: false };
      var returnTravel = root.__partyEventReturnTravel;
      eventRecoveryState = { phase: "returning", cycleId: command.cycleId,
        event: command.event || null, checkpoint: command.checkpoint || null,
        attemptAt: Date.now(), lastError: null };
      try {
        if (eventRecoveryRetryAt > Date.now()) await sleep(eventRecoveryRetryAt - Date.now());
        await afterCombat(async function () {
          if (typeof stop === "function") {
            try { await stop("smart"); } catch (_eventReturnStopSmart) {}
            try { await stop("move"); } catch (_eventReturnStopMove) {}
          }
          eventRecoveryState.phase = "leaving-event";
          var eventMap = G.maps && G.maps[character.map] && G.maps[character.map].event;
          if (character.map === "goobrawl") {
            await exitGoobrawlForRecovery(returnTravel,undefined,command);
          } else if (eventMap) {
            try {
              await anniversaryWithTimeout(leave(), 6000, "Event exit");
            } catch (leaveError) {
              // Some completed instances stop accepting `leave` before they
              // eject their occupants. Instance maps retain direct transport
              // as their recovery path; normal maps continue below.
              if (G.maps && G.maps[character.map] && G.maps[character.map].event)
                await anniversaryWithTimeout(transport("main", 0), 6000, "Event transport");
            }
            await sleep(500);
            if (G.maps && G.maps[character.map] && G.maps[character.map].event)
              throw new Error("could not leave ended event " + eventMap);
          }
          var townPoint = { map: "main", x: 0, y: 0 };
          // Damage can cancel Town, so do not release the coordinator barrier
          // until the character is verifiably in Main's town area.
          eventRecoveryState.phase = "returning-to-main";
          var recoveryDeadline = Date.now() + 45000;
          var lastEventWalkError = null;
          while ((character.map !== townPoint.map ||
              Math.hypot(Number(character.x) - townPoint.x, Number(character.y) - townPoint.y) > 90) &&
              Date.now() < recoveryDeadline) {
            if (escapeOwns()) return;
            if (character.rip) {
              await respawn();
              while (character.rip) await sleep(100);
            }
            if (character.map !== "main") {
              // Town is still useful on remote maps because it shortens the
              // fallback route to that map's spawn. `leave()` above remains
              // the preferred cross-map event exit.
              await prepareReturnExit(command,"event",function(){return runtimeCurrent() && !escapeOwns();});
              if (character.map !== "main") {
                try { await sharedPartyWalk(townPoint,"event-return",command.cycleId,command,function(){return !escapeOwns();}); }
                catch (eventTownRouteError) {
                  lastEventWalkError = String(eventTownRouteError && (eventTownRouteError.reason || eventTownRouteError.message) || eventTownRouteError);
                  eventRecoveryState.lastError = lastEventWalkError;
                }
              }
            } else if (!is_on_cooldown("use_town")) {
              await saveReturnPhase(command,"event","main-town");
              try { await anniversaryWithTimeout(town(), 12000, "Town"); }
              catch (_eventTownInterrupted) { /* retry */ }
            }
            await sleep(250);
          }
          if (character.map !== townPoint.map ||
              Math.hypot(Number(character.x) - townPoint.x, Number(character.y) - townPoint.y) > 90)
            throw new Error("event recovery could not reach Main town before its deadline" +
              (lastEventWalkError ? ": " + lastEventWalkError : ""));
          eventRecoveryState.phase = "town-ready";
          await saveReturnPhase(command,"event","complete");
          game_log("Event ended; returned to Town", "#c084fc");
        }, "returning from the event");
        await request("/event-return-complete", {
          method: "POST",
          body: { character: character.name, cycleId: command.cycleId,
            navigationRevision: navigationIntent.revision,
            map: character.map,
            mapEvent: G.maps && G.maps[character.map] && G.maps[character.map].event || null,
            x: Number(character.x), y: Number(character.y) },
        });
        eventRecoveryRetryAt = 0;
        eventRecoveryState.phase = command.deferred ? "deferred-town-ready" : "town-ready";
      } catch (eventRecoveryError) {
        eventRecoveryRetryAt = Date.now() + 2500;
        eventRecoveryState.phase = "retry-wait";
        eventRecoveryState.lastError = String(eventRecoveryError.reason || eventRecoveryError.message || eventRecoveryError);
        throw eventRecoveryError;
      } finally {
        eventReturnPending = false;
      }
      return;
    }
    if (command.type === "character-travel" && command.location) {
      return afterCombat(async function () {
        await smart_move(command.location);
        game_log("Arrived at " + (command.label || "destination"), "#51D2E1");
      }, "travel");
    }
    if (command.type === "party-monster-travel" && command.location) {
      if (command.manualMonsterOverride) {
        var currentEvent = activeCombatEvent();
        if (currentEvent) {
          manuallySuppressedEvent = root.__partyManuallySuppressedEvent = {
            name: currentEvent.name,
            id: currentEvent.state && (currentEvent.state.id || currentEvent.state.event_id) || null,
          };
          eventTargetTypes = [];
          if (character.map === "goobrawl") await exitGoobrawlForRecovery({});
          else if (joinedEvent && eventRequiresJoin(joinedEvent)) {
            try { await leave(); } catch (_manualMonsterLeaveError) {}
          }
          joinedEvent = root.__partyJoinedEvent = null;
          root.__partyEventRejoinRequired = null;
        }
      }
      if (command.purpose === "event-return") {
        eventRecoveryState = { phase: command.phase === "assemble" ? "convoy-assembling" : "convoy-returning",
          cycleId: command.convoyId, event: eventRecoveryState.event,
          checkpoint: command.location, attemptAt: Date.now(), lastError: null };
      }
      if (command.purpose === "anniversary-return" || command.purpose === "event-return" ||
          anniversaryReturnLocation && command.label && /pre-event|farming location/i.test(command.label)) {
        anniversaryReturnLocation = root.__anniversaryReturnLocation = null;
        anniversaryStagingReported = null;
        anniversaryReturnReported = null;
        anniversaryStaging = false;
        anniversaryStage = "returning to regular farming";
      }
      if (command.purpose === "franky-exit" && command.phase === "assemble") {
        joinedEvent = root.__partyJoinedEvent = null;
        partyLocation = null;
        return afterCombat(function () { return coordinatedMonsterTravel(command); }, "leaving Franky with the party");
      }
      if(command.purpose === "party-travel" && command.phase === "assemble")
        return afterCombat(function(){return coordinatedMonsterTravel(command);},"party travel");
      return coordinatedMonsterTravel(command);
    }
    if (command.type === "event-resume-travel" && command.location) {
      anniversaryStaging = false;
      anniversaryStage = "returning to saved farming waypoint";
      beginFarmReunion(command);
      return;
    }
    if (command.type === "return-leader") {
      return afterCombat(async function () {
        if (!leaderLocation) throw new Error("party leader location is unavailable");
        await joinEventDestination(leaderLocation);
        await smart_move(leaderLocation);
        game_log("Returned to party leader", "#51D2E1");
      }, "returning to leader");
    }
    if (command.type === "use-item") return useDashboardItem(command);
    if (command.type === "equip") {
      if (!isDashboardEquipment(command.item)) throw new Error("item is not equipment; use its explicit Use action instead");
      if (root.partyPorcupineEquipment) await root.partyPorcupineEquipment.manual();
      if (character.ctype === "merchant") await closeMerchantStandForTravel();
      var slot = findItem(command.item);
      if (slot >= 0) await equip(slot);
    }
    if (command.type === "equip-deliveries") {
      var equipResults = await equipDeliveredItems(command.items || []);
      equipResults.forEach(function(result, index) { if (command.deliveryIds) result.deliveryId = command.deliveryIds[index]; });
      await request("/equip-delivery-complete", { method: "POST", body: {
        character: character.name, commandId: command.id, results: equipResults,
      }});
    }
    if (command.type === "unequip") {
      if (root.partyPorcupineEquipment) await root.partyPorcupineEquipment.manual();
      if (character.ctype === "merchant") await closeMerchantStandForTravel();
      if (typeof command.slot !== "string" || !sameItem(character.slots[command.slot], command.item))
        throw new Error("equipped item no longer matches that slot");
      await unequip(command.slot);
      if (character.ctype === "merchant" && command.slot === "mainhand" && gatheringSession &&
          sameItem(gatheringSession.mainhand, command.item)) {
        gatheringSession.mainhand = null;
        root.__merchantGatheringSession = gatheringSession;
      }
    }
    if (command.type === "give") {
      var giveSlot = Number.isInteger(command.slot) && sameItem(character.items[command.slot], command.item)
        ? command.slot : findItem(command.item);
      if (giveSlot < 0) throw new Error("item no longer in inventory");
      await merchantSendItem(command.target, giveSlot, character.items[giveSlot].q || 1);
      game_log("Gave " + command.item.name + " to " + command.target, "#51D2E1");
    }
    if (command.type === "native-switch") {
      if (parent.caracAL) throw new Error("Steam switching requires the native game client");
      var region = parent.server_region || "US";
      var server = parent.server_identifier || "II";
      game_log("Switching Steam to " + command.character, "#51D2E1");
      parent.window.location.href = "/character/" + encodeURIComponent(command.character) +
        "/in/" + encodeURIComponent(region) + "/" + encodeURIComponent(server) + "/";
    }
    if (command.type === "native-realm-switch") {
      if (parent.caracAL) throw new Error("Native realm switching requires the Steam game client");
      var realmMatch = String(command.realm || "").match(/^SR_(US|EU|ASIA)(I{1,4}|PVP)$/);
      if (!realmMatch) throw new Error("Invalid realm switch destination");
      game_log("Switching realm to " + realmMatch[1] + " " + realmMatch[2], "#51D2E1");
      parent.window.location.href = "/character/" + encodeURIComponent(character.name) +
        "/in/" + encodeURIComponent(realmMatch[1]) + "/" + encodeURIComponent(realmMatch[2]) + "/";
    }
    if (command.type === "realm-set-home") {
      try {
        await afterCombat(async function () {
          if (character.rip) await respawn();
          await smart_move({ map: "main", x: 74, y: -34 });
          var result = await set_home();
          if (result && (result.failed || result.success === false))
            throw new Error(result.reason || result.message || "Adventure Land rejected the home realm change");
          await sleep(500);
        }, "setting home realm");
        await request("/realm/home-complete", { method: "POST", body: {
          operationId: command.operationId, character: character.name, success: true,
        }});
      } catch (homeError) {
        try { await request("/realm/home-complete", { method: "POST", body: {
          operationId: command.operationId, character: character.name, success: false,
          error: String(homeError.reason || homeError.message || homeError),
        }}); } catch (_homeCompleteError) {}
        throw homeError;
      }
    }
  }

  function returnPhaseRecord(command, kind) {
    var revision=Number(navigationIntent.revision)||0;
    var saved=[root.__partyReturnProgress,parent.__partyReturnProgress].find(function(p){
      return p && p.kind===kind && p.cycleId===command.cycleId && p.revision===revision;
    });
    return saved || {kind:kind,cycleId:command.cycleId,revision:revision,phase:"local-town"};
  }
  async function prepareReturnExit(command, kind, current) {
    var progress=returnPhaseRecord(command,kind);
    if(progress.phase!=="local-town")return;
    if(!current())throw new Error("Return workflow superseded");
    // Persist the attempt before channeling. Even interrupted Town falls back
    // to walking, and reload must never undo progress toward the exit.
    var result=await request("/return-progress",{method:"POST",body:{character:character.name,
      kind:kind,cycleId:command.cycleId,navigationRevision:progress.revision,phase:"exiting-map"}});
    if(!current())throw new Error("Return workflow superseded");
    parent.__partyReturnProgress=root.__partyReturnProgress=result.progress || Object.assign({},progress,{phase:"exiting-map"});
    root.__partyNavigationDetail="Return: exiting "+character.map+" toward Main";
    var spawn=G.maps[character.map] && G.maps[character.map].spawns && G.maps[character.map].spawns[0];
    if(spawn && Math.hypot(character.x-spawn[0],character.y-spawn[1])<=90)return;
    root.__partyTownLastAttempt=Date.now();
    try {await anniversaryWithTimeout(town(),12000,"Local Town shortcut");} catch (_) { /* Walk if interrupted. */ }
    var deadline=Date.now()+12000;
    while(current() && character.c && character.c.town && Date.now()<deadline)await sleep(100);
    if(!current())throw new Error("Return workflow superseded");
  }
  async function saveReturnPhase(command,kind,phase) {
    var saved=returnPhaseRecord(command,kind);
    if(saved.phase===phase)return;
    var result=await request("/return-progress",{method:"POST",body:{character:character.name,
      kind:kind,cycleId:command.cycleId,navigationRevision:saved.revision,phase:phase}});
    if(!runtimeCurrent() || Number(navigationIntent.revision)!==saved.revision)return;
    parent.__partyReturnProgress=root.__partyReturnProgress=result.progress || Object.assign({},saved,{phase:phase});
  }
  async function enforcePartyTownOverride() {
    if (escapeOwns()) return;
    if (character.ctype === "merchant" || !partyTownActive || townTraveling || townOverrideInFlight) return;
    var townPoint = { map: "main", x: 0, y: 0 };
    if (character.map === townPoint.map &&
        Math.hypot(Number(character.x) - townPoint.x, Number(character.y) - townPoint.y) <= 90) return;
    // The retained Town command owns channeling and exit routing. A missing
    // owner is reissued by the coordinator; the watchdog must never recast or
    // stop a valid shared return while that command is suspended.
    if (root.__partyTownCycleId) return;
    var townOwnerGeneration = root.__partyTownGeneration;
    function ownsTown() { return runtimeCurrent() && partyTownActive && !escapeOwns() && root.__partyTownGeneration === townOwnerGeneration; }
    townOverrideInFlight = true;
    departurePending = true;
    followingLeader = false;
    if (convoyTraveling) { releaseConvoyCruise(convoyTraveling); convoyTraveling.cancelled = true; }
    try {
      if (typeof stop === "function") {
        try { await stop("smart"); } catch (_townWatchSmartStop) {}
        if (!ownsTown()) return;
        try { await stop("move"); } catch (_townWatchMoveStop) {}
        if (!ownsTown()) return;
        try { await stop(); } catch (_townWatchAllStop) {}
      }
      if (!ownsTown()) return;
      if (character.rip) {
        await respawn();
        while (ownsTown() && character.rip) await sleep(100);
      }
      if (!ownsTown()) return;
      // Ask the server to Town directly from the current map. Do not create a
      // fallback smart route: it can survive a cancelled channel and reclaim
      // movement from this hard override.
      if (Date.now() - (Number(root.__partyTownLastAttempt) || 0) >= 4000) {
        root.__partyTownLastAttempt = Date.now();
        try { await use_skill("use_town"); } catch (_townWatchInterrupted) { /* Next guard pass retries. */ }
      }
    } finally {
      townOverrideInFlight = false;
      // Keep departurePending asserted while the central Town barrier remains
      // active, preventing combat/follow logic from reclaiming movement.
      departurePending = partyTownActive;
    }
  }


  function maintainTownOverrideGuard() {
    if (escapeOwns()) return;
    if (root.__partyTownGuardTimer) return;
    root.__partyTownGuardTimer = setInterval(function () {
      if (character.ctype === "merchant" || !partyTownActive) {
        clearInterval(root.__partyTownGuardTimer);
        root.__partyTownGuardTimer = null;
        return;
      }
      // Once handle(town-party) owns the operation, its route must be allowed
      // to run to completion. The old watchdog stopped it every 100ms, causing
      // repeated "Path found" messages and tiny two-step movements.
      if (townTraveling) return;
      if (root.__partyTownCycleId) return;
      // A stale smart_move closure can restart itself between dashboard polls.
      // Keep cutting it off throughout the Town cast, not merely once before it.
      if (!townOverrideInFlight && typeof smart !== "undefined" && smart && smart.moving && typeof stop === "function") {
        try { stop("smart"); } catch (_townGuardSmartStop) {}
      }
      if (!townOverrideInFlight && is_moving(character) && typeof stop === "function") {
        try { stop("move"); } catch (_townGuardMoveStop) {}
      }
      enforcePartyTownOverride().catch(function () {});
    }, 100);
  }

  var merchantVisibilityUntil = 0;
  async function applyMerchantVisibility(merchant) {
    var player = merchant && get_player(merchant);
    var nearby = player && !player.rip && (!player.map || player.map === character.map) &&
      (player.in == null || character.in == null || player.in === character.in) &&
      Math.hypot(player.x - character.x, player.y - character.y) <= 180;
    merchantVisibilityUntil = nearby ? Date.now() + 5000 : 0;
    if (nearby && character.s && character.s.invis) await stop("invis");
  }

  async function tick() {
    observeBankSortVisit();
    if (busy) return;
    busy = true;
    root.__partyStatusAttemptAt = Date.now();
    var statusPhase = "bank sort recovery";
    try {
      try { await recoverBankSortBeforeWork(); }
      catch (recoveryError) {
        // Recovery blocks inventory work, not visibility of the connected character.
        await request("/status", { method: "POST", body: snapshot() });
        throw recoveryError;
      }
      statusPhase = "snapshot";
      var statusSentAt = Date.now();
      var statusBody = snapshot();
      statusPhase = "request status";
      var state = await request("/status", { method: "POST", body: statusBody });
      if (!runtimeCurrent()) return;
      root.__partyConsoleMaintenance = state.consoleMaintenance || null;
      if (root.__partyConsoleMaintenance) {
        if (!consoleMaintenanceBusy() && typeof stop === 'function') await stop('smart');
        return;
      }
      if (state.upgradePreview) await handleUpgradePreview(state.upgradePreview);
      await applyMerchantVisibility(state.merchantVisibility);
      if (character.ctype === "merchant") await flushNativePurchaseReceipts();
      if (character.ctype === "merchant" && character.stand && !merchantIdleActive && !root.__merchantActiveJob &&
          !root.__merchantInventoryTidy && !merchantLuckyUpgrade().pending())
        await nativeStandSync(null, false);
      statusPhase = "apply status";
      if (dashboardSampler) dashboardSampler.renew(state.dashboardLease);
      root.__partyStatusSuccessAt = Date.now();
      root.__merchantRealmErrors = root.__merchantRealmErrors || {};
      (state.merchantRealmErrors || []).forEach(function (error) {
        if (root.__merchantRealmErrors[error.id] === error.message) return;
        root.__merchantRealmErrors[error.id] = error.message;
        game_log(error.message, "red");
      });
      if (Number.isFinite(state.serverNow))
        coordinatorClockOffset = state.serverNow - (statusSentAt + Date.now()) / 2;
      // Install the new convoy barrier before releasing Escape. stop() yields,
      // so role timers can otherwise begin an independent route in this gap.
      partyConvoyActive = !!state.partyConvoyActive;
      if(!partyConvoyActive)root.__partyConvoyDefense=null;
      partyTownActive = character.ctype !== "merchant" && !!state.partyTownActive;
      root.__partyTownCycleId=state.partyTownCycleId || null;
      root.__partyReturnProgress=state.returnProgress || null;
      statusPhase = "apply escape";
      await applyEscape(state.escape || null);
      statusPhase = "apply navigation";
      await applyNavigationIntent(state.navigationIntent);
      statusPhase = "apply combat control";
      acceptCombatControl(state);
      if (state.serverNow < (root.__partyRareControlAt || 0)) state.rareControl = rareControlState;
      if(root.partyLootClient)state.rareControl=root.partyLootClient.accept(state);
      if (state.rareControl && (root.__partyRareHandoffPending || !rareControlState || state.rareControl.id !== rareControlState.id)) {
        root.__partyRareHandoffPending = false;
        var priorFarmMovement = followingLeader || farmingTravelToken || farmApproach.route;
        if (farmingTravelToken) farmingTravelToken.cancelled = true;
        followingLeader = false;
        cancelFarmApproach("rare hunting owns movement");
        if (reunion) await cancelFarmReunion("rare hunting owns movement");
        if (priorFarmMovement && !convoyTraveling && typeof stop === "function")
          try { await stop("smart"); } catch (_rareHandoffStop) {}
      }
      passiveHunting = state.passiveHunting || {rules:{},useFieldGenerators:true};
      passiveRareHunts = state.passiveRareHunts || { tinyp: false, phoenix: false, goldenbat: false, cutebee: false, hen: false, rooster: false };
      rareControlState = state.rareControl || null; rareControlAt = Date.now();
      root.__partyRareControlAt = Math.max(Number(root.__partyRareControlAt || 0),Number(state.serverNow || 0));
      if (!rareControlState) cancelRarePath();
      mapTelemetryEnabled = !!state.mapTelemetry;
      partyLocation = state.partyLocation || null;
      farmTravelPaused = !!state.farmTravelPaused;
      bankQueued = !!state.bankQueued;
      leader = state.leader || null;
      var followedBeforeRefresh = followLeader;
      followLeader = !!state.followLeader;
      partyTownActive = character.ctype !== "merchant" && !!state.partyTownActive;
      root.__partyTownCycleId=state.partyTownCycleId || null;
      root.__partyReturnProgress=state.returnProgress || null;
      partyConvoyActive = !!state.partyConvoyActive;
      if(!partyConvoyActive)root.__partyConvoyDefense=null;
      var releasedHuntTurnIn = huntTurnInPriority && !state.huntTurnInPriority;
      huntTurnInPriority = !!state.huntTurnInPriority;
      if (releasedHuntTurnIn) setTimeout(function () { pollEvents(); runAnniversaryKiss(); }, 0);
      convoySignal = state.convoySignal || null;
      reloadConvoyGeometry(convoySignal);
      if (convoyTraveling && convoySignal && convoySignal.id === convoyTraveling.id &&
          Number(convoySignal.epoch) === convoyTraveling.epoch && convoySignal.phase === "failed" &&
          convoyTraveling.fail) convoyTraveling.fail(convoySignal.reason || "Convoy held by coordinator");
      if (convoyTraveling && !partyConvoyActive) {
        releaseConvoyCruise(convoyTraveling);
        convoyTraveling.cancelled = true;
        if (convoyTraveling.release) convoyTraveling.release();
        if (typeof stop === "function") try { await stop("smart"); } catch (_cancelledConvoyStop) {}
        convoyTraveling = null;
        root.__partyNavigationDetail = null;
      }
      if (partyTownActive) {
        maintainTownOverrideGuard();
        enforcePartyTownOverride().catch(function (error) {
          game_log("Town override retry failed: " + (error.reason || error.message || error), "red");
        });
      }
      desiredPartyMembers = Array.isArray(state.desiredPartyMembers) ? state.desiredPartyMembers.slice() : [];
      var previousSelections = enabledEventSelections;
      statusPhase = "apply event selections";
      enabledEventSelections = Array.isArray(state.eventSelections) ? state.eventSelections : null;
      eventsEnabled = !!state.eventsEnabled;
      root.__merchantCoordinatorEventRecovery = !!state.merchantEventRecoveryReserved;
      if (previousSelections && enabledEventSelections && previousSelections.join(",") !== enabledEventSelections.join(",")) {
        eventSelectionRevision++;
        pendingEventDisables = root.__partyPendingEventDisables = Array.from(new Set(pendingEventDisables.concat(previousSelections.filter(function(id) { return !eventSelected(id); }))));
      }
      if (pendingEventDisables.length) {
        for (var disabledEvent of pendingEventDisables.slice()) {
          if (eventSelected(disabledEvent)) { pendingEventDisables.splice(pendingEventDisables.indexOf(disabledEvent), 1); continue; }
          if (disabledEvent === "anniversary") {
            var oldKiss = root.__partyAnniversaryKissOperation;
            if (oldKiss) oldKiss.cancelled = true;
            if (!convoyTraveling && !forceTraveling && !townTraveling) { try { await stop("smart"); await stop(); } catch (_eventDisableStop) {} }
            anniversaryBusy = false; anniversaryStaging = false;
            root.__partyAnniversaryKissOperation = null;
            anniversaryMerchantFeaturedHold = false; anniversaryMerchantRetryAt = 0;
            anniversaryStage = "anniversary disabled; resuming previous activity";
            var disabledResult = await request("/event-disabled", { method: "POST", body: { character: character.name, event: disabledEvent } });
            if (disabledResult.anniversary) anniversaryPlan = disabledResult.anniversary;
          } else if (disabledEvent === joinedEvent || disabledEvent === partyEventHint || disabledEvent === travellingEventName) {
            if (!convoyTraveling && !forceTraveling && !townTraveling) { try { await stop("smart"); await stop(); } catch (_disabledTravel) {} }
            await request("/event-disabled", { method: "POST", body: { character: character.name, event: disabledEvent } });
            eventTargetTypes = []; joinedEvent = null; root.__partyJoinedEvent = null;
          }
          pendingEventDisables.splice(pendingEventDisables.indexOf(disabledEvent), 1);
        }
      }
      if (followedBeforeRefresh && !followLeader && followingLeader && typeof stop === "function") {
        statusPhase = "stop leader follow";
        // A follow path is an asynchronous smart_move. Merely changing the flag
        // does not cancel the path already in progress, so release control now.
        await stop("smart");
        game_log("Leader follow stopped; manual movement is available", "#51D2E1");
      }
      leaderTarget = state.leaderTarget || null;
      statusPhase = "apply party targets";
      leaderCombatSelection = state.leaderCombatSelection || null;
      acceptQueue(state.groupedCombat || null);
      if (root.partyRoleRunner && root.partyRoleRunner.wake) root.partyRoleRunner.wake();
      leaderLocation = state.leaderLocation || null;
      partyEventHint = state.partyEventHint || null;
      if (state.eventTrip && (!huntEventTrip || state.eventTrip.startedAt >= huntEventTrip.startedAt))
        huntEventTrip = root.__partyHuntEventTrip = state.eventTrip;
      abtestingStrategy = state.abtestingStrategy || null;
      anniversaryPlan = state.anniversary || anniversaryPlan;
      statusPhase = "apply anniversary";
      await applyAnniversaryAbort();
      if (character.ctype === "merchant") {
        try { await recoverMerchantDeliveryReceipts(); } catch (_) { /* Keep receipts for the next heartbeat. */ }
      }
      statusPhase = "apply merchant settings";
      var nextStandListings = state.standListings || gatheringStandListings;
      if (JSON.stringify(nextStandListings) !== JSON.stringify(gatheringStandListings) && gatheringSession)
        gatheringSession.atStandForCooldown = false;
      gatheringStandListings = nextStandListings;
      merchantWeapon = state.merchantWeapon || null;
      luckyUpgradeSlot = state.luckyUpgradeSlots && state.luckyUpgradeSlots[character.name];
      luckySlotTracking().sync(state.luckySlotTracking && state.luckySlotTracking[character.name]);
      merchantForceStand = !!state.merchantForceStand;
      merchantCashTarget = Math.max(0, Number(state.merchantGoldTarget) || 0);
      if (character.ctype === "merchant" && !root.__merchantActiveJob && !gatheringActive &&
          !(merchantWeapon && merchantWeapon.item) && character.slots && character.slots.mainhand &&
          gatheringStandListings.some(function (listing) {
            return listing && listing.item && sameItem(character.slots.mainhand, listing.item);
          })) {
        var releasedMainhand = fingerprint(character.slots.mainhand);
        await unequip("mainhand");
        if (gatheringSession && sameItem(gatheringSession.mainhand, releasedMainhand)) {
          gatheringSession.mainhand = null;
          root.__merchantGatheringSession = gatheringSession;
        }
        gatheringStatus("Released unmarked merchant weapon for stand listing", "success");
      }
      if (character.ctype === "merchant" && state.gatheringCooldowns) {
        ["fishing", "mining"].forEach(function (mode) {
          var persisted = Number(state.gatheringCooldowns[mode]) || 0;
          if (persisted > (Number(gatheringCooldowns[mode]) || 0)) gatheringCooldowns[mode] = persisted;
        });
        if (gatheringSession && gatheringSession.mode)
          gatheringSession.cooldownUntil = Math.max(Number(gatheringSession.cooldownUntil) || 0,
            Number(gatheringCooldowns[gatheringSession.mode]) || 0);
      }
      if (character.ctype === "merchant") {
        var enabledGathering = Array.isArray(state.gatheringModes) ? state.gatheringModes : [];
        if (JSON.stringify(enabledGathering) !== JSON.stringify(gatheringModes)) gatheringModes = enabledGathering.slice();
        selectGatheringMode();
      }
      bankStackHomes = state.bankStackHomes || {};
      statusPhase = "apply party settings";
      partyPositions = state.partyPositions || [];
      partyThreats = state.partyThreats || [];
      partyTargets = state.partyTargets || [];
      var nextMonsterFocus = Array.isArray(state.monsterFocus) ? state.monsterFocus :
        (typeof state.monsterFocus === "string" ? [state.monsterFocus] : ["goo"]);
      if (JSON.stringify(nextMonsterFocus) !== JSON.stringify(monsterFocus)) {
        monsterFocus = nextMonsterFocus;
        combatTargetId = null;
        publishCombatSelection(null, true);
        if (root.partyRoleRunner && root.partyRoleRunner.invalidateTarget) root.partyRoleRunner.invalidateTarget();
        farmingMode = "default";
        farmingModeResetUntil = Date.now() + 3000;
        lastFarmingMonsterType = null;
        root.__partyLastFarmingMonsterType = null;
      }
      monsterPriorities = state.monsterPriorities && typeof state.monsterPriorities === "object"
        ? state.monsterPriorities : {};
      monsterSearchRadius = Number.isFinite(Number(state.monsterSearchRadius))
        ? Math.max(1, Number(state.monsterSearchRadius)) : 400;
      var nextScatterEpoch = Number(state.scatterEpoch) || 0;
      if (nextScatterEpoch !== scatterEpoch) {
        scatterEpoch = nextScatterEpoch;
        observedOneShotTypes = {};
        root.__partyObservedOneShotTypes = observedOneShotTypes;
      }
      scatterMonsterTypes = {};
      (state.scatterMonsterTypes || []).forEach(function (monsterType) {
        if (typeof monsterType === "string") scatterMonsterTypes[monsterType] = true;
      });
      farmingPolicy = typeof state.farmingPolicy === "string" ? state.farmingPolicy : "auto";
      huntCombatTarget = state.huntCombatTarget || null;
      farmingMode = character.ctype !== "merchant" && state.partyFarmingMode === "scatter" ? "scatter" : "default";
      partyFarmingMonsterType = typeof state.partyFarmingMonsterType === "string" ? state.partyFarmingMonsterType : null;
      scatterBreakTarget = state.scatterBreakTarget && state.scatterBreakTarget.id ? state.scatterBreakTarget : null;
      catalogKnown = !state.needsCatalog;
      void prepareCatalog();
      flushStatusDiagnostics();
      statusPhase = "dispatch command";
      handle(state.command).catch(function (error) {
        if (state.command && lastCommand === Number(state.command.id) &&
            (state.command.type === "town-party" || state.command.type === "event-return-town" ||
            state.command.type === "event-resume-travel" || state.command.type === "monster-hunt-interact")) {
          lastCommand = Math.min(lastCommand, Number(state.command.id) - 1);
          root.__partyLastCommand = lastCommand;
        }
        game_log("Party command failed: " + (error.reason || error.message || error), "red");
      });
      if (character.ctype === "merchant" && !state.command && !root.__merchantActiveJob && !root.__merchantInventoryTidy &&
          !merchantEventWorkReserved() &&
          !banking && !upgrading && !stocking && !gatheringActive && !merchantIdleActive && !anniversaryBusy && !character.rip) {
        root.__merchantInventoryTidy = merchantLuckyUpgrade().tidy(luckyUpgradeSlot).catch(function (error) {
          game_log(String(error.message || error), "red");
        }).finally(function () { root.__merchantInventoryTidy = null; });
      }
      if (!escapeOwns() && !banking && !bankQueued && !stocking && !upgrading && !departurePending && !character.rip && quantity("hpot1") === 0 &&
          !root.__merchantInventoryTidy && !root.__merchantActiveJob &&
          Date.now() - lastStockAttempt >= 5000) {
        lastStockAttempt = Date.now();
        stockUp().catch(function (error) {
          game_log("Potion stock-up failed: " + (error.reason || error.message || error), "red");
        });
      }
    } catch (error) {
      // The local dashboard is optional; combat continues if it is unavailable.
      recordStatusFailure(error, statusPhase);
    } finally {
      busy = false;
      wakeGatheringAfterStatus();
    }
  }

  function eventStatus() {
    var raw = typeof server !== "undefined" && server && server.status || parent.server && parent.server.status || parent.S || {};
    if (!eventClockOffset) return raw;
    var corrected = {};
    Object.keys(raw).forEach(function(name) {
      var value = raw[name];
      if (!value || typeof value !== "object") { corrected[name] = value; return; }
      corrected[name] = Object.assign({}, value);
      ["next", "expires", "end"].forEach(function(key) {
        if (value[key]) corrected[name][key] = anniversaryEpoch(value[key]) - eventClockOffset;
      });
    });
    return corrected;
  }

  function supportedEventNames() {
    var names = Object.keys(G.events || {});
    if (names.indexOf("snowman") < 0) names.push("snowman");
    return names;
  }

  function rawServerLiveEvents() {
    var status = eventStatus();
    return supportedEventNames().filter(function (name) {
      var state = status && status[name];
      return eventIsSupported(name) && state && state.live !== false;
    }).map(function (name) {
      var state = status[name] || {};
      return { name: name, id: state.id || state.event_id || null };
    });
  }

  var anniversarySliceNames = ["slice_strawberry", "slice_citrus", "slice_honey",
    "slice_mint", "slice_blueberry", "slice_nightberry"];

  function anniversaryFeaturedEntity(event) {
    var entities = parent.entities || {};
    if (event.id && entities[event.id]) return entities[event.id];
    return Object.keys(entities).map(function (id) { return entities[id]; }).find(function (entity) {
      return entity && entity.type === "character" && entity.name === event.target;
    }) || null;
  }

  function anniversaryRoundId(event, ticket) {
    return String(event.round || ticket && (ticket.round || ticket.id) || event.next ||
      [event.target, event.map, event.expires].join(":"));
  }

  function anniversaryEpoch(input) {
    var value = Number(input) || 0;
    return value && value < 1000000000000 ? value * 1000 : value;
  }

  function merchantAnniversaryCompletedRound() {
    var event = eventStatus().anniversary;
    var round = event && anniversaryRoundId(event, character.s && character.s.anniversary_visit);
    var recorded = anniversaryPlan && anniversaryPlan.live &&
      String(anniversaryPlan.live.round) === String(round) && anniversaryPlan.round &&
      anniversaryPlan.round.claims && anniversaryPlan.round.claims[character.name];
    if (round && recorded) anniversaryCompletedRounds[round] = recorded;
    return round && (anniversaryCompletedRounds[round] || root.__merchantAnniversaryReleasedRound === round) ? round : null;
  }

  function merchantEventWorkReserved() {
    return character.ctype === "merchant" && (!!joinedEvent || eventTraveling || eventReturnPending ||
      !!root.__merchantCoordinatorEventRecovery || eventsEnabled && !navigationIntent.cancelled && !!activeCombatEvent());
  }

  async function yieldMerchantForEvent() {
    var active = root.__merchantActiveJob;
    if (!active || !merchantEventWorkReserved()) return;
    // Settle journals before this boundary; do not admit another production
    // operation once event ownership has reserved the merchant.
    var result = await request("/merchant/checkpoint", { method: "POST", body: {
      jobId: active.jobId, eventOnly: true,
    } });
    if (result.yield) throw new Error("merchant_yield");
  }

  function merchantAnniversaryWorkReserved() {
    if (merchantEventWorkReserved()) return true;
    if (character.ctype !== "merchant" || !root.partyMerchantAnniversaryControl) return false;
    var event = eventStatus().anniversary, ticket = character.s && character.s.anniversary_visit;
    var round = event && anniversaryRoundId(event, ticket);
    var completed = merchantAnniversaryCompletedRound() === round;
    var control = root.partyMerchantAnniversaryControl(character.name, eventSelected("anniversary"), {
      anniversaryServer: event && Object.assign({}, event, { round: round,
        next: anniversaryEpoch(event.next), expires: anniversaryEpoch(event.expires) }),
      anniversaryState: { busy: anniversaryBusy, mode: completed ? "complete" : anniversaryMerchantMode,
        completedRound: completed ? round : null, retryAt: anniversaryMerchantRetryAt },
      anniversaryVisit: ticket
    }, anniversaryPlan && anniversaryPlan.abortedRounds || {}, Date.now());
    return control.featured || control.reserved || control.kissDue || control.busy;
  }

  async function exitGoobrawlForRecovery(returnTravel, stillCurrent, parentCommand) {
    stillCurrent = stillCurrent || function () { return !escapeOwns(); };
    if (!stillCurrent()) return;
    var npc = (G.maps.goobrawl.npcs || []).find(function (entry) { return entry.id === "transporter"; });
    if (!npc || !Array.isArray(npc.position)) throw new Error("Goobrawl Transporter location is missing");
    var mainSpawn = G.npcs && G.npcs.transporter && G.npcs.transporter.places && G.npcs.transporter.places.main;
    if (!Number.isInteger(mainSpawn)) throw new Error("Goobrawl Transporter's Main destination is missing");
    var destination = { map: "goobrawl", x: Number(npc.position[0]), y: Number(npc.position[1]) };
    // The instance has no exit door. Transport is only valid near its NPC;
    // leave() followed by transport() also collides with the client's 8s lock.
    function nearTransporter() {
      return character.map === "goobrawl" && Math.hypot(character.x - destination.x, character.y - destination.y) < 70;
    }
    if (!nearTransporter()) {
      eventRecoveryState.phase = "approaching-goobrawl-transporter";
      try {
        if(parentCommand)await sharedPartyWalk(destination,"event-return",parentCommand.cycleId,parentCommand,stillCurrent);
        else await anniversaryWithTimeout(smart_move(destination), 40000, "Goobrawl Transporter approach");
      } finally {
        if (stillCurrent()) { try { await stop("smart"); } catch (_goobrawlStop) {} }
      }
    }
    if (!stillCurrent() || character.map === "main") return;
    if (character.rip || !nearTransporter()) throw new Error("Goobrawl Transporter is not in range");
    // Retries observe the preceding request before issuing another one. A
    // transport acknowledgement is not proof that new_map has arrived.
    while (stillCurrent() && character.map === "goobrawl" && returnTravel.transportAttemptAt &&
        Date.now() - returnTravel.transportAttemptAt < 20000) await sleep(100);
    if (!stillCurrent() || character.map === "main") return;
    eventRecoveryState.phase = "transporting-from-goobrawl";
    returnTravel.transportAttemptAt = Date.now();
    var error = null;
    Promise.resolve(transport("main", mainSpawn)).catch(function (reason) { error = reason; });
    while (stillCurrent() && character.map === "goobrawl" && !character.rip &&
        Date.now() - returnTravel.transportAttemptAt < 20000) {
      if (error && String(error.reason || error.message || error) !== "transport_in_progress") throw error;
      await sleep(100);
    }
    if (!stillCurrent()) return;
    if (character.map !== "main") throw new Error("Goobrawl transport did not reach Main");
    returnTravel.transportAttemptAt = null;
  }

  async function eventReturnRouteToMain(townPoint, recoveryDeadline, stillCurrent) {
    stillCurrent = stillCurrent || function () { return !escapeOwns(); };
    if (!stillCurrent()) return;
    for(var attempt=0;attempt<4 && stillCurrent() && !character.rip && character.map!=="main";attempt++) {
      var leg={settled:false,error:null,owner:null};
      Promise.resolve(smart_move(townPoint)).then(function(saved){return function(){saved.settled=true;};}(leg),
        function(saved){return function(error){saved.settled=true;saved.error=error;};}(leg));
      leg.owner=typeof smart!=="undefined" ? smart.on_done : null;
      var last={map:character.map,in:character.in,x:character.x,y:character.y},progressAt=Date.now();
      try {
        while(stillCurrent() && character.map!=="main" && !character.rip && !leg.settled && Date.now()<recoveryDeadline) {
          if(typeof smart!=="undefined" && smart.on_done!==leg.owner)throw new Error("Exit route superseded");
          if(character.map!==last.map || character.in!==last.in || Math.hypot(character.x-last.x,character.y-last.y)>=10) {
            last={map:character.map,in:character.in,x:character.x,y:character.y};progressAt=Date.now();
          }
          if(Date.now()-progressAt>=15000)break;
          await sleep(100);
        }
      } finally {
        if(stillCurrent() && typeof stop==="function" && (typeof smart==="undefined" || smart.on_done===leg.owner)) {
          try {await stop("smart");} catch (_) {}
          try {await stop("move");} catch (_) {}
        }
      }
      if(Date.now()>=recoveryDeadline)break;
    }
    if(stillCurrent() && !character.rip && character.map!=="main")throw new Error("Exit to Main stalled or exhausted; request Escape again");
  }

  async function anniversaryApproach(point, direct, event, operation, assertCurrent) {
    var settled = false, failure = null;
    Promise.resolve(direct ? xmove(point.x, point.y) : smart_move(point)).then(function() { settled = true; }, function(error) { failure = error; settled = true; });
    var deadline = Math.min(Date.now() + 60000, anniversaryEpoch(event.expires));
    var last = { map: character.map, x: character.x, y: character.y }, progressAt = Date.now();
    try {
      while (Date.now() < deadline) {
        assertCurrent();
        var target = anniversaryFeaturedEntity(event);
        if (character.map === point.map && Math.hypot(character.x - point.x, character.y - point.y) <= 20 ||
            target && (target.map || character.map) === character.map && Math.hypot(character.x - target.x, character.y - target.y) <= 70) return;
        if (failure) throw failure;
        if (settled) return;
        if (character.map !== last.map || Math.hypot(character.x - last.x, character.y - last.y) >= 2) {
          last = { map: character.map, x: character.x, y: character.y }; progressAt = Date.now();
        }
        if (Date.now() - progressAt >= 10000) throw new Error("anniversary movement stalled");
        await new Promise(function(resolve) { setTimeout(resolve, 200); });
      }
      throw new Error("anniversary approach timed out");
    } catch (error) { error.failureReason = "target-unreachable"; throw error; }
    finally {
      if (root.__partyAnniversaryKissOperation === operation && !operation.cancelled && operation.navigationRevision === navigationIntent.revision && !convoyTraveling && !townTraveling && !forceTraveling) {
        try { await stop("smart"); await stop("move"); } catch (_approachStop) {}
      }
    }
  }

  function anniversaryWithTimeout(promise, timeoutMs, label) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timeout = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error(label + " timed out after " + Math.round(timeoutMs / 1000) + " seconds"));
      }, timeoutMs);
      Promise.resolve(promise).then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      }, function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async function anniversaryReturnToTown(event) {
    if (!await eventTravelAllowed()) return;
    if (anniversaryRoundAborted(event)) return;
    var stagingRevision = navigationIntent.revision;
    var stagingOperation = { revision: stagingRevision, cancelled: false };
    function stagingCurrent() { return runtimeCurrent() && !stagingOperation.cancelled && root.__partyAnniversaryStagingOperation === stagingOperation && !huntTurnInPriority && !anniversaryRoundAborted(event) && navigationIntent.revision === stagingRevision; }
    // The merchant has a separate live-round arbitration path. This helper is
    // exclusively for staging the combat party and must never pull its stand
    // between Main's town point and the market location.
    if (character.ctype === "merchant") return;
    if (anniversaryBusy || character.ctype === "merchant" && root.__merchantActiveJob) return;
    if (!await eventTravelAllowed("anniversary")) return;
    var townPoint = { map: "main", x: 0, y: 0 };
    if (character.map === "main" && Math.hypot(Number(character.x), Number(character.y)) <= 100) return;
    anniversaryBusy = true;
    root.__partyAnniversaryStagingOperation = stagingOperation;
    anniversaryStage = "returning to Main for anniversary";
    try {
      if (typeof stop === "function") { try { await stop(); } catch (_anniversaryTownStop) {} }
      if (!stagingCurrent()) return;
      // Joinable event maps are instances. Leave the instance before trying
      // Town so a character already fighting can kiss and then re-join it.
      var currentMapEvent = G.maps && G.maps[character.map] && G.maps[character.map].event;
      if (currentMapEvent && G.events && G.events[currentMapEvent] && G.events[currentMapEvent].join) {
        if (!await eventTravelAllowed("anniversary")) return;
        try { await leave(); } catch (_anniversaryLeaveEvent) { /* Town remains the fallback. */ }
        await new Promise(function (resolve) { setTimeout(resolve, 300); });
        if (!stagingCurrent()) return;
      }
      if (!is_on_cooldown("use_town") && can_use("use_town")) {
        var beforeTown = { map: character.map, x: Number(character.x), y: Number(character.y) };
        game_log("Anniversary departure: casting Town on " + character.map, "#51D2E1");
        try {
          if (!await eventTravelAllowed("anniversary")) return;
          await use_skill("use_town");
          if (!stagingCurrent()) return;
          var townDeadline = Date.now() + 12000;
          while (Date.now() < townDeadline) {
            var relocated = character.map !== beforeTown.map ||
              Math.hypot(Number(character.x) - beforeTown.x, Number(character.y) - beforeTown.y) > 90;
            if (relocated && !is_transporting(character)) break;
            await new Promise(function (resolve) { setTimeout(resolve, 200); });
            if (!stagingCurrent()) return;
          }
        } catch (_anniversaryTownCast) {
          game_log("Anniversary Town interrupted or unavailable; continuing by route", "#f0b429");
        }
      }
      if (stagingCurrent() && (character.map !== "main" || Math.hypot(Number(character.x), Number(character.y)) > 100)) {
        game_log("Anniversary departure: navigating from " + character.map + " to Main after Town attempt", "#51D2E1");
        if (!await eventTravelAllowed("anniversary")) return;
        await sharedPartyWalk(townPoint,"anniversary-staging",String(event && (event.id||event.event_id)||"anniversary"),null,stagingCurrent);
      }
    } finally {
      if (root.__partyAnniversaryStagingOperation === stagingOperation) {
        root.__partyAnniversaryStagingOperation = null;
        anniversaryBusy = false;
      }
    }
  }

  function reportAnniversaryStaging(event) {
    if (anniversaryRoundAborted(event)) return;
    if (character.ctype === "merchant") return;
    var startsAt = event.live === false ? anniversaryEpoch(event.next) : anniversaryEpoch(event.expires) - 300000;
    var key = event.live === false ? "scheduled-" + startsAt : String(event.round || event.target || startsAt);
    // The game switches identifiers when a scheduled round becomes live. Keep
    // the first cycle identity so Main can never replace the captured origin.
    if (anniversaryStagingReported === key) return;
    anniversaryStagingReported = key;
    var selected = partyFarmingMonsterType || farmingMonsterType || monsterFocus[0] || "monster";
    if (!anniversaryReturnLocation) anniversaryReturnLocation = root.__anniversaryReturnLocation = {
      map: character.map, x: character.x, y: character.y,
    };
    request("/anniversary/staging", { method: "POST", body: { character: character.name,
      round: key, map: anniversaryReturnLocation.map, x: anniversaryReturnLocation.x,
      navigationRevision: navigationIntent.revision,
      y: anniversaryReturnLocation.y,
      startsAt: startsAt,
      endsAt: event.live === false ? anniversaryEpoch(event.next) + 300000 : anniversaryEpoch(event.expires),
      label: "the " + selected + " farming location" } }).catch(function () {
        anniversaryStagingReported = null;
      });
  }

  function reportAnniversaryReturn(roundId) {
    if (character.ctype === "merchant" || anniversaryReturnReported === roundId) return;
    anniversaryReturnReported = roundId;
    request("/anniversary/return-ready", { method: "POST", body: {
      character: character.name, round: roundId,
      navigationRevision: navigationIntent.revision,
    }}).catch(function () { anniversaryReturnReported = null; });
  }

  function huntEventPending() {
    if (character.ctype === "merchant") return false;
    if (eventsEnabled && activeCombatEvent()) return true;
    if (!eventSelected("anniversary")) return false;
    var cycle = anniversaryPlan && anniversaryPlan.eventCycle;
    if (cycle && (cycle.returnCompletedAt || cycle.supersededAt || cycle.combatHandoffAt) && Date.now() <= cycle.endsAt) return false;
    var event = eventStatus().anniversary;
    if (!event || event.active === false || anniversaryRoundAborted(event)) return false;
    if (event.live !== false) return !!(character.s && character.s.anniversary_visit) ||
      !(character.s && character.s.anniversary_kiss);
    var next = anniversaryEpoch(event.next);
    return next > Date.now() && next - Date.now() <= 90000;
  }

  async function eventTravelAllowed(eventName) {
    if (character.ctype === "merchant") return runtimeCurrent();
    if (huntTurnInPriority || convoyTraveling && convoyTraveling.nonPreemptible) return false;
    try {
      var permission = await request("/hunt-event-permission", { method: "POST", body: { character: character.name, event: eventName || null } });
      if (permission.reason && permission.reason !== root.__partyEventPermissionReason)
        game_log(permission.reason, "#f0b429");
      root.__partyEventPermissionReason = permission.reason || null;
      if (permission.eventTrip) huntEventTrip = root.__partyHuntEventTrip = permission.eventTrip;
      return runtimeCurrent() && permission.allowed === true && !huntTurnInPriority &&
        !(convoyTraveling && convoyTraveling.nonPreemptible);
    } catch (_eventPermissionUnavailable) { return false; }
  }

  async function preemptConvoyForAnniversary(event) {
    if (anniversaryRoundAborted(event)) return;
    if (huntTurnInPriority || convoyTraveling && convoyTraveling.nonPreemptible) return;
    if (!partyConvoyActive && !convoyTraveling) return;
    if (!await eventTravelAllowed("anniversary")) return;
    var permission = await request("/anniversary/navigation-preempt", { method: "POST", body: {
      character: character.name,
      navigationRevision: navigationIntent.revision,
      startsAt: event && event.live === false ? anniversaryEpoch(event.next) :
        event && anniversaryEpoch(event.expires) - 300000,
    }});
    // Do not wait for the next status heartbeat before allowing the kiss route.
    if (permission.huntTurnIn) { huntTurnInPriority = true; return; }
    if (!await eventTravelAllowed("anniversary")) return;
    if (convoyTraveling) { releaseConvoyCruise(convoyTraveling); convoyTraveling.cancelled = true; }
    followingLeader = false;
    if (typeof stop === "function") {
      try { await stop("smart"); } catch (_anniversaryPreemptSmart) { /* No smart route is active. */ }
      if (!await eventTravelAllowed("anniversary")) return;
      try { await stop("move"); } catch (_anniversaryPreemptMove) { /* No direct move is active. */ }
    }
    partyConvoyActive = false;
  }

  function anniversaryRoundAborted(event) {
    if (!eventSelected("anniversary")) return true;
    if (escapeOwns()) return true;
    if (!event) return false;
    var aborted = anniversaryPlan && anniversaryPlan.abortedRounds || {};
    if (event.live === false) return Object.keys(aborted).some(function (round) {
      return Number(aborted[round].startsAt) === anniversaryEpoch(event.next);
    });
    var round = anniversaryRoundId(event, character.s && character.s.anniversary_visit);
    return !!aborted[round];
  }

  async function applyAnniversaryAbort() {
    var event = eventStatus() && eventStatus().anniversary;
    var operation = root.__partyAnniversaryKissOperation;
    var aborted = anniversaryPlan && anniversaryPlan.abortedRounds || {};
    if (!anniversaryRoundAborted(event) && !(operation && aborted[operation.round])) return false;
    if (operation && aborted[operation.round]) {
      operation.cancelled = true;
      // Only stop the kiss's movement, never a convoy or another owner that
      // has already replaced it. Checks after awaits retire the old closure.
      if (!convoyTraveling && !forceTraveling && !townTraveling) {
        try { await stop("smart"); await stop(); } catch (_kissAbortStop) {}
      }
      if (root.__partyAnniversaryKissOperation === operation) root.__partyAnniversaryKissOperation = null;
    }
    anniversaryBusy = false;
    anniversaryStaging = false;
    anniversaryMerchantFeaturedHold = false;
    anniversaryMerchantRetryAt = 0;
    anniversaryMerchantMode = character.ctype === "merchant" ? "skipped" : anniversaryMerchantMode;
    anniversaryStage = "anniversary round skipped; returning to normal work";
    return true;
  }

  function anniversaryAttemptSucceeded(before, buffMsBefore) {
    var earned = anniversarySliceNames.some(function (name) { return inventoryQuantity(name) > before[name]; });
    var buff = character.s && character.s.anniversary_kiss;
    return earned || !!(buff && (buffMsBefore === null || Number(buff.ms) > buffMsBefore + 1000));
  }

  async function runAnniversaryKiss() {
    if (merchantEventWorkReserved()) return;
    if (!eventSelected("anniversary")) return;
    if (await applyAnniversaryAbort()) return;
    var staleKiss = root.__partyAnniversaryKissOperation;
    if (staleKiss && Date.now() - Number(staleKiss.startedAt || 0) > 180000) {
      staleKiss.cancelled = true;
      root.__partyAnniversaryKissOperation = null;
      anniversaryBusy = false;
    }
    var finishedCycle = anniversaryPlan && anniversaryPlan.eventCycle;
    if (character.ctype !== "merchant" && finishedCycle &&
        (finishedCycle.returnCompletedAt || finishedCycle.supersededAt || finishedCycle.combatHandoffAt) &&
        Date.now() <= finishedCycle.endsAt) {
      var oldStaging = root.__partyAnniversaryStagingOperation;
      if (oldStaging) {
        oldStaging.cancelled = true;
        if (oldStaging.revision === navigationIntent.revision && !convoyTraveling && !townTraveling && !forceTraveling) {
          try { await stop("smart"); } catch (_completedStagingStop) {}
        }
        if (root.__partyAnniversaryStagingOperation === oldStaging) {
          root.__partyAnniversaryStagingOperation = null;
          anniversaryBusy = false;
        }
      }
      anniversaryStaging = false;
      if (eventsEnabled && activeCombatEvent()) setTimeout(function () { pollEvents(); }, 0);
      return;
    }
    if (character.ctype !== "merchant" && eventsEnabled &&
        (activeCombatEvent() || joinedEvent || eventTraveling || eventReturnPending ||
          anniversaryPlan && anniversaryPlan.eventCycle && anniversaryPlan.eventCycle.combatHandoffAt &&
            Date.now() <= anniversaryPlan.eventCycle.endsAt)) {
      if (!anniversaryBusy) anniversaryStaging = false;
      setTimeout(function () { pollEvents(); }, 0);
      return;
    }
    var retainedKiss = root.__partyAnniversaryKissOperation;
    // A function currently awaiting smart_move survives a source hot reload.
    // Its old closure's local anniversaryBusy flag is invisible to the new
    // script, so retain ownership on the character runtime itself.
    if (retainedKiss && Date.now() - Number(retainedKiss.startedAt || 0) > 180000)
      root.__partyAnniversaryKissOperation = null;
    if (anniversaryBusy || root.__partyAnniversaryKissOperation || character.rip || partyTownActive || huntTurnInPriority) return;
    if (character.ctype === "merchant" && merchantForceStand) return;
    var event = eventStatus() && eventStatus().anniversary;
    var ticket = character.s && character.s.anniversary_visit;
    if (!event || event.active === false) {
      var wasAnniversaryStaging = anniversaryStaging;
      anniversaryStaging = false;
      if (character.ctype === "merchant") {
        anniversaryMerchantMode = "idle";
        anniversaryMerchantRetryAt = 0;
        anniversaryMerchantFeaturedHold = false;
      }
      if (wasAnniversaryStaging && eventsEnabled) setTimeout(function () { pollEvents(); }, 0);
      return;
    }
    var nextEventAt = anniversaryEpoch(event.next);
    var featuredCycle = anniversaryPlan && anniversaryPlan.eventCycle;
    var featuredStart = Number(featuredCycle && featuredCycle.startsAt) ||
      (anniversaryEpoch(event.expires) ? anniversaryEpoch(event.expires)-300000 : 0);
    // Release before convoy preemption: the server keeps this round live for
    // five minutes, but our one-minute visit must not pull us back from farming.
    if (event.live !== false && featuredStart && Date.now() >= featuredStart+60000 &&
        (event.target === character.name || anniversaryPlan && anniversaryPlan.partyFeatured)) {
      anniversaryStaging = false;
      anniversaryMerchantFeaturedHold = false;
      anniversaryStage = "one-minute featured hold complete; returning to normal work";
      if (character.ctype === "merchant") { anniversaryMerchantMode = "complete"; root.__merchantAnniversaryReleasedRound = anniversaryRoundId(event, ticket); }
      else if (!featuredCycle || !featuredCycle.combatHandoffAt)
        reportAnniversaryReturn(anniversaryRoundId(event, ticket));
      return;
    }
    var combatOwnsReturn = anniversaryPlan && anniversaryPlan.eventCycle && anniversaryPlan.eventCycle.combatHandoffAt;
    var anniversaryNeedsTravel = !combatOwnsReturn && (event.live !== false ||
      nextEventAt > Date.now() && nextEventAt - Date.now() <= 90000);
    var anniversaryVisitAlreadyComplete = character.ctype !== "merchant" && event.live !== false &&
      !(character.s && character.s.anniversary_visit) &&
      !!(character.s && character.s.anniversary_kiss);
    if (anniversaryNeedsTravel && character.ctype !== "merchant" &&
        !anniversaryVisitAlreadyComplete && (partyConvoyActive || convoyTraveling)) {
      try { await preemptConvoyForAnniversary(event); }
      catch (preemptError) {
        anniversaryStage = "waiting to interrupt farming travel for anniversary";
        return;
      }
    }
    if (anniversaryRoundAborted(event) || !await eventTravelAllowed()) return;
    var persistedCycle = anniversaryPlan && anniversaryPlan.eventCycle;
    if (persistedCycle && persistedCycle.returnCompletedAt) anniversaryStaging = false;
    if (character.ctype !== "merchant" && event.live !== false && !persistedCycle)
      reportAnniversaryStaging(event);
    if (character.ctype !== "merchant" && persistedCycle && !persistedCycle.returnDispatchedAt &&
        !persistedCycle.combatHandoffAt) {
      anniversaryStaging = true;
      if (Date.now() >= Number(persistedCycle.endsAt)) {
        anniversaryStage = "anniversary ended; awaiting farming convoy";
        reportAnniversaryReturn(String(persistedCycle.liveRound || persistedCycle.id));
        return;
      }
      // A broken round may disappear from server.status before its reported
      // window ends. The persisted coordinator cycle keeps the party staged.
      if (event.live === false) {
        await anniversaryReturnToTown(event);
        anniversaryStage = "holding in Main until anniversary deadline";
        return;
      }
    }
    var nextAt = nextEventAt, expiresAt = anniversaryEpoch(event.expires);
    var preWindow = event.live === false && nextAt > Date.now() && nextAt - Date.now() <= 90000;
    var designated = event.target === character.name;
    var partyFeatured = !!(anniversaryPlan && anniversaryPlan.partyFeatured);
    var currentRoundId = anniversaryRoundId(event, ticket);
    var alreadyKissed = !!anniversaryCompletedRounds[currentRoundId];
    // The visit ticket is consumed before the anniversary buff can arrive. If
    // the skill promise or its short reward wait loses that race, the previous
    // implementation left this character in "retrying" with no ticket and no
    // way to reach the return-ready barrier. The server buff is authoritative:
    // recover the completed round on the next poll. This applies to the
    // merchant too: movement can reject after the server has already consumed
    // the ticket and delivered the reward.
    var priorAttempt = root.__partyAnniversaryAttempt;
    if (event.live !== false && !ticket && !alreadyKissed &&
        priorAttempt && priorAttempt.round === currentRoundId &&
        anniversaryAttemptSucceeded(priorAttempt.before, priorAttempt.buffMsBefore)) {
      var recoveredSlice = anniversarySliceNames.find(function (name) {
        return inventoryQuantity(name) > Number(priorAttempt.before[name] || 0);
      }) || null;
      anniversaryCompletedRounds[currentRoundId] = {
        at: Date.now(), target: event.target, slice: recoveredSlice, recoveredFromBuff: true,
      };
      root.__anniversaryCompletedRounds = anniversaryCompletedRounds;
      anniversaryBusy = false;
      anniversaryStaging = false;
      anniversaryStage = "kiss buff confirmed; returning to farming";
      if (character.ctype === "merchant") anniversaryMerchantMode = "complete";
      else if (recoveredSlice) anniversaryPendingHandoff = root.__anniversaryPendingHandoff = {
        round: currentRoundId, slice: recoveredSlice, attempted: false,
      };
      game_log("Anniversary kiss buff confirmed after the visit response; returning to farming", "#ff69b4");
      request("/anniversary/claim", { method: "POST", body: { character: character.name,
        round: currentRoundId, target: event.target, slice: recoveredSlice } }).catch(function () {});
      if (character.ctype === "merchant") {
        request("/anniversary/advertise", { method: "POST", body: { round: currentRoundId } }).then(function (plan) {
          if (plan && plan.message) return say(plan.message);
        }).catch(function () {});
      } else if (!recoveredSlice) reportAnniversaryReturn(currentRoundId);
      return;
    }
    if (character.ctype === "merchant") {
      anniversaryMerchantFeaturedHold = false;
      if (preWindow) {
        // Gathering is autonomous rather than a coordinator job. Interrupt an
        // in-flight trip once as the lead-up begins, then keep it paused until
        // the kiss has completed.
        if (anniversaryMerchantMode !== "leadup-at-stand" && gatheringActive && typeof stop === "function") {
          try { await stop("smart"); } catch (_anniversaryGatheringSmartStop) {}
          try { await stop("move"); } catch (_anniversaryGatheringMoveStop) {}
        }
        anniversaryMerchantMode = "leadup-at-stand";
        anniversaryStage = character.stand ? "at stand; anniversary round approaching" : "anniversary round approaching";
        anniversaryStaging = false;
        return;
      }
      if (event.live === false || !event.target || !expiresAt || expiresAt <= Date.now()) {
        anniversaryMerchantMode = "idle";
        anniversaryMerchantRetryAt = 0;
        anniversaryStaging = false;
        return;
      }
      if (designated) {
        anniversaryMerchantMode = "featured-hold";
        anniversaryMerchantFeaturedHold = true;
        anniversaryStaging = true;
        anniversaryStage = root.__merchantActiveJob ? "featured; finishing current merchant job" :
          "featured player holding at stand";
        return;
      }
      if (root.__merchantActiveJob) {
        anniversaryMerchantMode = "waiting-for-job";
        anniversaryStage = "finishing current merchant job before anniversary kiss";
        return;
      }
      if (alreadyKissed) {
        anniversaryMerchantMode = "complete";
        anniversaryMerchantRetryAt = 0;
        return;
      }
      if (event.available === false) {
        anniversaryMerchantMode = "waiting-available";
        anniversaryStage = "waiting for " + event.target + " to become available";
        return;
      }
      if (anniversaryMerchantRetryAt > Date.now()) {
        anniversaryMerchantMode = "retry-wait";
        anniversaryStage = "anniversary retry cooling down";
        return;
      }
    }
    if (persistedCycle && persistedCycle.combatHandoffAt) {
      // The combat-event lifecycle now owns the eventual return. Discard the
      // anniversary origin so it cannot leak into a later anniversary round.
      anniversaryReturnLocation = root.__anniversaryReturnLocation = null;
      anniversaryStagingReported = null;
      anniversaryReturnReported = null;
    }
    if (preWindow || event.live !== false && expiresAt > Date.now() &&
        designated) {
      if (character.ctype !== "merchant" || designated) anniversaryStaging = true;
      reportAnniversaryStaging(event);
      await anniversaryReturnToTown(event);
      anniversaryStage = character.map === "main" && Math.hypot(Number(character.x), Number(character.y)) <= 100
        ? (designated ? "featured player holding in Main" : "waiting in Main for anniversary")
        : "returning to Main for anniversary";
      return;
    }
    if ((designated || partyFeatured) && expiresAt && expiresAt <= Date.now()) {
      anniversaryStaging = false;
      reportAnniversaryReturn(anniversaryRoundId(event, ticket));
      if (eventsEnabled) setTimeout(function () { pollEvents(); }, 0);
      return;
    }
    if (event.live === false || !event.target || !ticket) {
      if (partyFeatured && expiresAt > Date.now() && !joinedEvent) {
        anniversaryStaging = true;
        await anniversaryReturnToTown(event);
        anniversaryStage = character.map === "main" && Math.hypot(Number(character.x), Number(character.y)) <= 100
          ? "holding with featured party member in Main" : "returning to Main for anniversary";
        return;
      }
      if (!designated && (alreadyKissed || event.live !== false)) anniversaryStaging = false;
      return;
    }
    if (event.available === false) {
      anniversaryStaging = true;
      reportAnniversaryStaging(event);
      await anniversaryReturnToTown(event);
      anniversaryStage = character.map === "main" && Math.hypot(Number(character.x), Number(character.y)) <= 100
        ? "waiting for " + event.target + " to become available" : "returning to Main for anniversary";
      return;
    }
    if (character.ctype === "merchant" && root.__merchantActiveJob) return;
    var roundId = anniversaryRoundId(event, ticket);
    if (anniversaryCompletedRounds[roundId] || Date.now() - anniversaryLastAttemptAt < 1500) return;
    if (!await eventTravelAllowed("anniversary")) return;
    anniversaryBusy = true;
    anniversaryRound = roundId;
    anniversaryLastAttemptAt = Date.now();
    anniversaryKissResponses = [];
    var kissOperation = { round: roundId, target: event.target, startedAt: anniversaryLastAttemptAt,
      navigationRevision: navigationIntent.revision, generation: runtimeGeneration };
    root.__partyAnniversaryKissOperation = kissOperation;
    function assertKissCurrent() {
      if (huntTurnInPriority || kissOperation.cancelled || !runtimeCurrent() || root.__partyAnniversaryKissOperation !== kissOperation ||
          anniversaryRoundAborted(event) || anniversaryEpoch(event.expires) <= Date.now() || !eventSelected("anniversary") || kissOperation.navigationRevision !== navigationIntent.revision)
        throw Object.assign(new Error("Anniversary operation cancelled"), { cancelled: true });
    }
    if (character.ctype === "merchant") {
      anniversaryMerchantMode = "kiss-active";
      anniversaryMerchantAttemptAt = anniversaryLastAttemptAt;
      anniversaryMerchantRetryAt = 0;
    }
    var before = {};
    anniversarySliceNames.forEach(function (name) { before[name] = inventoryQuantity(name); });
    var buffMsBefore = character.s && character.s.anniversary_kiss ? Number(character.s.anniversary_kiss.ms) || 0 : null;
    root.__partyAnniversaryAttempt = { round: roundId, before: before, buffMsBefore: buffMsBefore };
    try {
      if (character.ctype !== "merchant") {
        var kissPermission = await request("/hunt-event-permission", { method: "POST", body: {
          character: character.name, event: "anniversary",
          kissOperation: { id: String(kissOperation.startedAt), phase: "begin" } } });
        if (!kissPermission.allowed) throw Object.assign(new Error("Combat departure takes priority"), { cancelled: true });
        assertKissCurrent();
      }
      if (character.ctype === "merchant" && character.stand) {
        anniversaryStage = "closing stand before anniversary kiss";
        game_log("Closing merchant stand before anniversary travel", "#ff69b4");
        await close_stand();
        var standCloseDeadline = Date.now() + 3000;
        while (character.stand && Date.now() < standCloseDeadline) {
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
          assertKissCurrent();
        }
        if (character.stand) throw new Error("merchant stand did not close before anniversary travel");
        assertKissCurrent();
      }
      var earned = null, buffConfirmed = false;
      for (var pass = 0; pass < 2; pass++) {
        assertKissCurrent();
        var latest = eventStatus().anniversary;
        if (latest && anniversaryRoundId(latest, ticket) === roundId) event = latest;
        var reservation = await request("/anniversary/attempt", { method: "POST", body: {
          character: character.name, round: roundId, target: event.target, navigationRevision: kissOperation.navigationRevision } });
        assertKissCurrent();
        kissOperation.attempt = Number(reservation.attempt) || pass + 1;
        if (reservation.exhausted) throw Object.assign(new Error("two anniversary approaches exhausted"), { failureReason: "kiss-unconfirmed" });
        try {
      anniversaryStage = "travelling to " + event.target + " (" + kissOperation.attempt + "/2)";
      combatTargetId = null;
      followingLeader = false;
      if (typeof stop === "function") {
        try { await stop("smart"); } catch (_anniversaryStopError) {}
      }
      assertKissCurrent();
      var featured = anniversaryFeaturedEntity(event);
      if (!featured || featured.map !== character.map ||
          Math.hypot(Number(featured.x) - Number(character.x), Number(featured.y) - Number(character.y)) > 70) {
        var kissPoint = featured ? { map: featured.map || character.map, x: Number(featured.x), y: Number(featured.y) } : { map: event.map || "main", x: Number(event.x) || 0, y: Number(event.y) || 0 };
        var directKissRoute = character.map === kissPoint.map &&
          (typeof can_move_to !== "function" || can_move_to(kissPoint.x, kissPoint.y));
        var kissDescription = navigationDestinationLabel("anniversary kiss", kissPoint,
          "selected player " + event.target);
        // Most anniversary targets stand in the Main square. Avoid invoking
        // the full pathfinder when a single direct movement segment suffices.
        game_log((directKissRoute ? "Direct move started: " : "Path search started: ") + kissDescription, "#ff69b4");
        if (!await eventTravelAllowed("anniversary")) return;
        await anniversaryApproach(kissPoint, directKissRoute, event, kissOperation, assertKissCurrent);
        assertKissCurrent();
        game_log("Movement finished: " + kissDescription, "#ff69b4");
      }
      anniversaryStage = "looking for " + event.target;
      var findUntil = Math.min(Date.now() + 12000, anniversaryEpoch(event.expires));
      while (!(featured = anniversaryFeaturedEntity(event)) && Date.now() < findUntil) {
        await new Promise(function (resolve) { setTimeout(resolve, 200); });
        assertKissCurrent();
      }
      assertKissCurrent();
      if (!featured) throw Object.assign(new Error("featured player " + event.target + " is not visible"), { failureReason: "target-missing" });
      var separation = Math.hypot(Number(featured.x) - Number(character.x), Number(featured.y) - Number(character.y));
      if (separation > 72) {
        // smart_move intentionally stops short of occupied character tiles.
        // Finish with a direct approach point 55 units from the featured
        // player so the server's strict 80-range kiss check is satisfied.
        var dx = Number(character.x) - Number(featured.x);
        var dy = Number(character.y) - Number(featured.y);
        var length = Math.max(1, Math.hypot(dx, dy));
        await anniversaryApproach({ map: character.map, x: Number(featured.x) + dx / length * 55, y: Number(featured.y) + dy / length * 55 }, true, event, kissOperation, assertKissCurrent);
        assertKissCurrent();
        featured = anniversaryFeaturedEntity(event);
      }
      if (!featured || Math.hypot(Number(featured.x) - Number(character.x), Number(featured.y) - Number(character.y)) > 80)
        throw Object.assign(new Error("featured player moved out of kissing range"), { failureReason: "target-unreachable" });
      var currentSelection = eventStatus().anniversary;
      if (!currentSelection || currentSelection.target !== event.target || anniversaryRoundId(currentSelection, ticket) !== roundId)
        throw Object.assign(new Error("featured player changed"), { failureReason: "target-unreachable" });
      anniversaryStage = "kissing " + event.target;
      // The game's own anniversary_kiss() sends the round's event ID, not the
      // visible player entity. Bound the unresolved deferred so a broken round
      // cannot freeze event work—or the merchant's normal scheduler—forever.
      try {
        await anniversaryWithTimeout(use_skill("ikissyou", event.id || featured.id), Math.min(8000, Math.max(1, anniversaryEpoch(event.expires) - Date.now())), "Anniversary kiss");
      } catch (kissError) {
        assertKissCurrent();
        if (!/timed out/i.test(String(kissError.message || kissError))) throw kissError;
        if (!anniversaryAttemptSucceeded(before, buffMsBefore)) {
          kissError.failureReason = "kiss-timeout";
          throw kissError;
        }
      }
      assertKissCurrent();
      earned = null; buffConfirmed = anniversaryAttemptSucceeded(before, buffMsBefore);
      var rewardWaitUntil = Math.min(Date.now() + 3000, anniversaryEpoch(event.expires));
      while ((!earned || !buffConfirmed) && Date.now() < rewardWaitUntil) {
        earned = anniversarySliceNames.find(function (name) {
          return inventoryQuantity(name) > before[name];
        }) || null;
        buffConfirmed = anniversaryAttemptSucceeded(before, buffMsBefore);
        if (!earned || !buffConfirmed) await new Promise(function (resolve) { setTimeout(resolve, 100); });
        assertKissCurrent();
      }
      var ticketConsumed = !(character.s && character.s.anniversary_visit);
      if (!buffConfirmed) {
        var serverException = anniversaryKissResponses.some(function (entry) {
          return entry.response === "exception";
        });
        throw new Error(serverException ?
          "server exception: visit produced no anniversary buff" :
          ticketConsumed ? "server consumed the visit but delivered no anniversary buff" :
          "anniversary buff was not confirmed by the server");
      }
        break;
        } catch (attemptError) {
          assertKissCurrent();
          if (anniversaryAttemptSucceeded(before, buffMsBefore)) { buffConfirmed = true; break; }
          if (kissOperation.attempt >= 2 || character.ctype !== "merchant" && activeCombatEvent()) { attemptError.failureReason ||= "kiss-unconfirmed"; throw attemptError; }
          anniversaryStage = "retrying approach (2/2)";
          await request("/anniversary/failure", { method: "POST", body: { character: character.name,
            round: roundId, target: event.target, attempt: kissOperation.attempt,
            navigationRevision: kissOperation.navigationRevision, failureReason: attemptError.failureReason || "kiss-unconfirmed",
            error: String(attemptError.message || attemptError) } });
        }
      }
      anniversaryCompletedRounds[roundId] = { at: Date.now(), target: event.target, slice: earned };
      root.__anniversaryCompletedRounds = anniversaryCompletedRounds;
      if (earned && character.ctype !== "merchant") {
        anniversaryPendingHandoff = { round: roundId, slice: earned, attempted: false };
        root.__anniversaryPendingHandoff = anniversaryPendingHandoff;
      }
      anniversaryStage = "kiss confirmed";
      if (character.ctype === "merchant") anniversaryMerchantMode = "complete";
      game_log("Anniversary kiss confirmed: " + event.target + (earned ? " · received " + earned : ""), "#ff69b4");
      request("/anniversary/claim", { method: "POST", body: { character: character.name,
        round: roundId, target: event.target, slice: earned } }).catch(function () {});
      if (character.ctype === "merchant") {
        request("/anniversary/advertise", { method: "POST", body: { round: roundId } }).then(function (plan) {
          if (plan && plan.message) return say(plan.message);
        }).catch(function (advertiseError) {
          game_log("Anniversary advertisement failed: " + (advertiseError.message || advertiseError), "#f0b429");
        });
      }
      if (character.ctype !== "merchant") {
        var postKissEvent = activeCombatEvent();
        // Without a simultaneous event, preserve the normal slice handoff
        // barrier. With one, carry the slice through combat and collect later.
        anniversaryStaging = !!earned && !postKissEvent;
        if (!earned && !postKissEvent) reportAnniversaryReturn(roundId);
        if (postKissEvent) {
          // Do not wait for the normal ten-second event poll after kissing.
          setTimeout(function () { pollEvents(); }, 0);
        }
      }
    } catch (error) {
      if (error.cancelled || kissOperation.cancelled || !runtimeCurrent()) return;
      anniversaryStage = "retrying";
      if (character.ctype === "merchant") {
        anniversaryMerchantMode = "retry-wait";
        anniversaryMerchantRetryAt = Date.now() + 13500;
      }
      if (/timed out/i.test(String(error && (error.message || error))))
        anniversaryLastAttemptAt = Date.now() + 12000;
      game_log("Anniversary kiss retry for selected player " + event.target + " at " +
        (event.map || "main") + " (" + (Number(event.x) || 0) + ", " + (Number(event.y) || 0) + "): " +
        (error.reason || error.message || error), "#f0b429");
      await request("/anniversary/failure", { method: "POST", body: {
        character: character.name, round: roundId, target: event.target,
        attempt: kissOperation.attempt || 0, failureReason: error.failureReason || "kiss-unconfirmed", navigationRevision: kissOperation.navigationRevision,
        error: error.reason || error.message || String(error),
        responses: anniversaryKissResponses.slice(-10)
      } }).then(async function (result) {
        if (!runtimeCurrent()) return;
        if (result.anniversary) anniversaryPlan = result.anniversary;
        await applyAnniversaryAbort();
      }).catch(function () {});
    } finally {
      if (root.__partyAnniversaryKissOperation === kissOperation) {
        anniversaryBusy = false;
        root.__partyAnniversaryKissOperation = null;
      }
      if (character.ctype !== "merchant") {
        await request("/hunt-event-permission", { method: "POST", body: {
          character: character.name, event: "anniversary",
          kissOperation: { id: String(kissOperation.startedAt), phase: "end" } } }).catch(function () {});
        if (activeCombatEvent()) setTimeout(function () { pollEvents(); }, 0);
      }
    }
  }

  var anniversaryHandoffRetryAt = {};
  async function runAnniversaryHandoff() {
    if (anniversaryBusy || character.rip || merchantForceStand || !anniversaryPlan) return;
    if (character.ctype !== "merchant" && eventsEnabled && (activeCombatEvent() || eventTraveling || eventReturnPending)) return;
    if (character.ctype !== "merchant") {
      // A confirmed kiss releases the fighter to combat immediately. Keep the
      // slice until normal event recovery makes the fighter reachable again.
      if (eventsEnabled && joinedEvent) return;
      if (!anniversaryPendingHandoff) {
        var recoveredHandoff = (anniversaryPlan.handoffTargets || []).find(function (entry) {
          return entry.name === character.name && findInventoryItemByName(entry.slice) >= 0;
        });
        if (recoveredHandoff) anniversaryPendingHandoff = root.__anniversaryPendingHandoff = {
          round: recoveredHandoff.round, slice: recoveredHandoff.slice, attempted: false,
        };
      }
      if (!anniversaryPendingHandoff) return;
      var handedOffRound = anniversaryPendingHandoff.round;
      if (anniversaryPendingHandoff.attempted) {
        anniversaryPendingHandoff = root.__anniversaryPendingHandoff = null;
        anniversaryStaging = false;
        if (!activeCombatEvent()) reportAnniversaryReturn(handedOffRound);
        return;
      }
      anniversaryPendingHandoff.attempted = true;
      var merchant = get_player(anniversaryPlan.merchant || "GoldMajesty");
      if (!merchant || merchant.map !== character.map ||
          Math.hypot(merchant.x - character.x, merchant.y - character.y) > 390) {
        anniversaryPendingHandoff = root.__anniversaryPendingHandoff = null;
        anniversaryStaging = false;
        if (!activeCombatEvent()) reportAnniversaryReturn(handedOffRound);
        return;
      }
      var slot = findInventoryItemByName(anniversaryPendingHandoff.slice);
      if (slot < 0) {
        anniversaryPendingHandoff = root.__anniversaryPendingHandoff = null;
        anniversaryStaging = false;
        if (!activeCombatEvent()) reportAnniversaryReturn(handedOffRound);
        return;
      }
      anniversaryBusy = true;
      anniversaryStage = "delivering slice to merchant";
      try {
        await send_item(merchant.name, slot, 1);
        await request("/anniversary/handoff", { method: "POST", body: { character: character.name,
          round: anniversaryPendingHandoff.round, slice: anniversaryPendingHandoff.slice } });
        anniversaryPendingHandoff = root.__anniversaryPendingHandoff = null;
        anniversaryStage = "slice delivered";
        anniversaryStaging = false;
        if (!activeCombatEvent()) reportAnniversaryReturn(handedOffRound);
      } catch (error) {
        anniversaryStage = "slice handoff attempted";
        anniversaryPendingHandoff = root.__anniversaryPendingHandoff = null;
        anniversaryStaging = false;
        if (!activeCombatEvent()) reportAnniversaryReturn(handedOffRound);
      } finally { anniversaryBusy = false; }
      return;
    }
    if (root.__merchantActiveJob || gatheringActive || root.__merchantGatheringAttempt || banking || upgrading) return;
    var target = (anniversaryPlan.handoffTargets || []).find(function (entry) {
      return entry && !entry.event && entry.ctype !== "merchant" &&
        Number(entry.seenAt) >= Date.now() - 10000 &&
        Date.now() >= (anniversaryHandoffRetryAt[entry.name] || 0) &&
        entry.server === ((parent.server_region || "") + (parent.server_identifier || ""));
    });
    if (!target) return;
    anniversaryBusy = true;
    anniversaryStage = "collecting slice from " + target.name;
    function collectionCurrent() {
      return runtimeCurrent() && !character.rip && !root.__merchantActiveJob &&
        !gatheringActive && !root.__merchantGatheringAttempt && !merchantForceStand;
    }
    try {
      if (character.stand) await close_stand();
      if (!collectionCurrent()) return;
      await anniversaryWithTimeout(smart_move({ map: target.map, x: Number(target.x), y: Number(target.y) }),
        30000, "Anniversary slice collection");
      // The fighter owns the confirmed send. Wait briefly for its one-second
      // anniversary tick to observe us and complete the handoff.
      var waitUntil = Date.now() + 15000;
      while (collectionCurrent() && Date.now() < waitUntil && (anniversaryPlan.handoffTargets || []).some(function (entry) {
        return entry.name === target.name && Number(entry.seenAt) >= Date.now() - 10000;
      })) await new Promise(function (resolve) { setTimeout(resolve, 500); });
    } catch (error) {
      anniversaryStage = "collection retrying";
      if (collectionCurrent()) { try { await stop("smart"); } catch (_) {} }
    } finally {
      anniversaryHandoffRetryAt[target.name] = Date.now() + 60000;
      anniversaryBusy = false;
      wakeGatheringAfterStatus();
    }
  }

  function anniversaryItemReceived(data) {
    if (character.ctype !== "merchant" || !data || data.response !== "item_received" ||
        anniversarySliceNames.indexOf(data.item) < 0) return;
    var event = eventStatus() && eventStatus().anniversary;
    var senderEntity = get_player(data.name);
    var owner = senderEntity && (senderEntity.owner || senderEntity.owner_id || senderEntity.account);
    var currentSliceCounts = {};
    anniversarySliceNames.forEach(function (name) { currentSliceCounts[name] = inventoryQuantity(name); });
    request("/anniversary/trade", { method: "POST", body: { sender: data.name, owner: owner, item: data.item,
      counts: currentSliceCounts,
      round: event && event.round || anniversaryRound || "between-rounds",
      map: character.map, x: senderEntity && senderEntity.x || character.x,
      y: senderEntity && senderEntity.y || character.y,
      server: (parent.server_region || "") + (parent.server_identifier || "") } }).then(async function (decision) {
      if (!decision || decision.action === "ignore") return;
      var outgoingSlot = findInventoryItemByName(decision.item);
      try {
        if (outgoingSlot < 0) throw new Error("reciprocal slice is no longer available");
        await send_item(data.name, outgoingSlot, 1);
        if (decision.key) await request("/anniversary/trade-complete", { method: "POST", body: {
          key: decision.key, state: decision.action === "swap" ? "completed" : "returned" } });
        game_log((decision.action === "swap" ? "Completed" : "Returned") +
          " anniversary slice trade with " + data.name, "#ff69b4");
      } catch (sendError) {
        var returned = false, incomingSlot = findInventoryItemByName(data.item);
        if (incomingSlot >= 0) {
          try { await send_item(data.name, incomingSlot, 1); returned = true; }
          catch (_returnError) { /* Persist the debt below. */ }
        }
        if (decision.key) await request("/anniversary/trade-complete", { method: "POST", body: {
          key: decision.key, state: returned ? "returned" : "return_owed" } });
        if (!returned) throw sendError;
        game_log("Returned " + data.name + "'s slice because our reciprocal transfer failed", "#f0b429");
      }
    }).catch(function (error) {
      game_log("Anniversary trade needs attention: " + (error.reason || error.message || error), "red");
    });
  }

  async function runAnniversaryReturns() {
    if (character.ctype !== "merchant" || anniversaryBusy || merchantForceStand || root.__merchantActiveJob ||
        !anniversaryPlan || !(anniversaryPlan.pendingReturns || []).length) return;
    var debt = anniversaryPlan.pendingReturns[0];
    anniversaryBusy = true;
    anniversaryStage = "returning slice to " + debt.sender;
    try {
      if (character.stand) await close_stand();
      await smart_move({ map: debt.map || character.map, x: Number(debt.x), y: Number(debt.y) });
      var sender = get_player(debt.sender);
      if (!sender || sender.map !== character.map || Math.hypot(sender.x - character.x, sender.y - character.y) > 400)
        throw new Error(debt.sender + " is not currently reachable");
      var slot = findInventoryItemByName(debt.item);
      if (slot < 0) throw new Error("owed slice is missing from merchant inventory");
      await send_item(debt.sender, slot, 1);
      await request("/anniversary/trade-complete", { method: "POST", body: { key: debt.key, state: "returned" } });
      anniversaryStage = "owed slice returned";
    } catch (_error) { anniversaryStage = "return queued"; }
    finally { anniversaryBusy = false; }
  }

  async function runAnniversaryChatAdvertisement() {
    if (character.ctype !== "merchant" || anniversaryChatSending || anniversaryBusy ||
        !anniversaryPlan || !anniversaryPlan.chatAdvertisement) return;
    var pending = anniversaryPlan.chatAdvertisement;
    anniversaryChatSending = true;
    try {
      await anniversaryWithTimeout(say(pending.message), 5000, "Chat advertisement");
      await request("/anniversary/chat-advertise-complete", { method: "POST", body: { id: pending.id } });
    } catch (error) {
      game_log("Anniversary chat advertisement retrying: " +
        (error.reason || error.message || error), "#f0b429");
    } finally { anniversaryChatSending = false; }
  }

  async function runAnniversaryTick() {
    if (root.__partyConsoleMaintenance) return;
    if (escapeOwns()) return;
    await runAnniversaryKiss();
    await runAnniversaryChatAdvertisement();
    await runAnniversaryReturns();
    await runAnniversaryHandoff();
  }

  function currentPartyList() {
    if (Array.isArray(parent.party_list)) return parent.party_list.slice();
    var cached = typeof get_party === "function" && get_party();
    return cached ? Object.keys(cached) : [];
  }

  function partyFailureReason(error) {
    return String(error && (error.reason || error.message || error) || "failed");
  }

  function acceptConfiguredPartyInvite(name) {
    if (!followLeader || !leader || name !== leader) return;
    lastPartyActionAt = Date.now();
    accept_party_invite(name).catch(function (error) {
      var reason = partyFailureReason(error);
      if (reason !== "already_in_party" && reason !== "not_found") game_log("Party invite failed: " + reason, "red");
    });
  }

  function acceptConfiguredPartyRequest(name) {
    if (leader !== character.name || desiredPartyMembers.indexOf(name) < 0) return;
    lastPartyActionAt = Date.now();
    accept_party_request(name).catch(function (error) {
      var reason = partyFailureReason(error);
      if (reason !== "already_in_party" && reason !== "not_found") game_log("Party request failed: " + reason, "red");
    });
  }

  root.on_party_invite = acceptConfiguredPartyInvite;
  root.on_party_request = acceptConfiguredPartyRequest;

  async function reconcileGameParty() {
    if (partySyncBusy || !leader || Date.now() - lastPartyActionAt < 4000) return;
    partySyncBusy = true;
    var attempted = "none";
    try {
      var current = currentPartyList();
      var currentLeader = current[0] || null;
      if (leader === character.name) {
        if (current.length && currentLeader !== character.name) {
          attempted = "leader leaving party led by " + currentLeader;
          lastPartyActionAt = Date.now();
          await leave_party();
          return;
        }
        var missing = desiredPartyMembers.find(function (name) {
          return name !== character.name && current.indexOf(name) < 0;
        });
        if (missing) {
          attempted = "leader inviting missing member " + missing;
          lastPartyActionAt = Date.now();
          await send_party_invite(missing);
        }
        return;
      }
      if (!followLeader) {
        if (current.length) {
          attempted = "non-follower leaving current party";
          lastPartyActionAt = Date.now();
          await leave_party();
        }
        return;
      }
      if (currentLeader === leader) return;
      lastPartyActionAt = Date.now();
      if (current.length) {
        attempted = "follower leaving party led by " + currentLeader + " before joining " + leader;
        await leave_party();
      } else {
        attempted = "follower requesting to join " + leader;
        await send_party_request(leader);
      }
    } catch (error) {
      var reason = partyFailureReason(error);
      var after = currentPartyList(), afterLeader = after[0] || null;
      var desiredSatisfied = leader === character.name
        ? afterLeader === character.name && desiredPartyMembers.every(function (name) {
          return name === character.name || after.indexOf(name) >= 0;
        })
        : followLeader && afterLeader === leader;
      if (!desiredSatisfied && ["already_in_party", "already_invited", "pending", "not_found"].indexOf(reason) < 0)
        game_log("Party sync failed: " + reason + "; action=" + attempted +
          "; current=[" + after.join(",") + "]; expectedLeader=" + leader +
          "; followLeader=" + followLeader, "red");
    } finally {
      partySyncBusy = false;
    }
  }

  function eventMonsterTypes(eventName) {
    var definition = G.events && G.events[eventName];
    var candidates = [];
    if (definition && definition.sprite) candidates.push(definition.sprite);
    candidates.push(eventName);
    // Goo Brawl starts with ordinary Brawl Goos and later spawns the Rainbow
    // Goo. Keep both eligible; nearestEventTarget applies its two-phase rule.
    if (eventName === "goobrawl") candidates = ["rgoo", "bgoo", "goo"].concat(candidates);
    return candidates.filter(function (type, index, all) {
      return type && G.monsters && G.monsters[type] && all.indexOf(type) === index;
    });
  }

  function eventRequiresJoin(eventName) {
    return !!(G.events && G.events[eventName] && G.events[eventName].join);
  }

  function eventIsSupported(eventName) {
    // Snowman is a live, open-world boss. It appears in server.status like
    // instanced events do, but has no join action; travel to it normally.
    return eventRequiresJoin(eventName) || eventName === "snowman";
  }

  function eventMapName(eventName) {
    return Object.keys(G.maps || {}).find(function (mapName) {
      return G.maps[mapName] && G.maps[mapName].event === eventName;
    }) || eventName;
  }

  function eventDestination(eventName, state) {
    if (state && state.map && Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y))) {
      return { map: state.map, x: Number(state.x), y: Number(state.y) };
    }
    var mapName = eventMapName(eventName), map = G.maps && G.maps[mapName] || null;
    if (map) {
      var spawn = Array.isArray(map.spawns) && map.spawns[0] || [0, 0];
      return { map: mapName, x: Number(spawn[0]) || 0, y: Number(spawn[1]) || 0 };
    }
    // Some joinable events (notably Giga Crab / crabxx) happen in a normal
    // map instead of a map carrying `map.event`.
    var types = eventMonsterTypes(eventName), location = null;
    Object.keys(G.maps || {}).some(function (candidateMap) {
      var monsters = G.maps[candidateMap] && G.maps[candidateMap].monsters || [];
      var monsterSpawn = monsters.find(function (entry) {
        return entry && types.indexOf(entry.type) >= 0;
      });
      if (!monsterSpawn) return false;
      var bounds = monsterSpawn.boundary ||
        (Array.isArray(monsterSpawn.boundaries) && monsterSpawn.boundaries[0]);
      if (!Array.isArray(bounds)) return false;
      var offset = typeof bounds[0] === "string" ? 1 : 0;
      location = { map: candidateMap,
        x: (Number(bounds[offset]) + Number(bounds[offset + 2])) / 2,
        y: (Number(bounds[offset + 1]) + Number(bounds[offset + 3])) / 2 };
      return true;
    });
    return location || { map: character.map, x: Number(character.x) || 0, y: Number(character.y) || 0 };
  }

  async function joinEventDestination(destination) {
    if (escapeOwns()) return;
    if (!destination || character.map === destination.map) return false;
    var map = G.maps && G.maps[destination.map], eventName = map && map.event;
    if (!eventName || !eventSelected(eventName) || !G.events || !G.events[eventName] || !G.events[eventName].join) return false;
    await join(eventName);
    joinedEvent = eventName;
    root.__partyJoinedEvent = eventName;
    eventTargetTypes = eventMonsterTypes(eventName);
    eventMissingSince = 0;
    await sleep(500);
    return true;
  }

  var goobrawlEvidenceCache = { at: 0, map: null, live: false };
  function hasGoobrawlCombat() {
    if (character.map !== "goobrawl") return false;
    if (goobrawlEvidenceCache.map === character.map && Date.now()-goobrawlEvidenceCache.at < 250) return goobrawlEvidenceCache.live;
    var live = Object.keys(parent.entities || {}).some(function(id) {
      var e=parent.entities[id];
      return e && e.type === "monster" && e.visible !== false && !e.dead && e.hp > 0 &&
        ["rgoo","bgoo","goo"].indexOf(e.mtype)>=0;
    });
    goobrawlEvidenceCache={at:Date.now(),map:character.map,live:live};return live;
  }
  function activeCombatEvent() {
    var status = eventStatus();
    if (manuallySuppressedEvent) {
      var suppressedState = status && status[manuallySuppressedEvent.name];
      var suppressedId = suppressedState && (suppressedState.id || suppressedState.event_id) || null;
      if (!suppressedState || suppressedState.live === false ||
          manuallySuppressedEvent.id && suppressedId && manuallySuppressedEvent.id !== suppressedId) {
        manuallySuppressedEvent = root.__partyManuallySuppressedEvent = null;
      }
    }
    return supportedEventNames().map(function (name) {
      var state = status && status[name];
      var types = eventMonsterTypes(name);
      var corroborated = partyEventHint === name || name === "goobrawl" && hasGoobrawlCombat();
      var kind = name === "abtesting" ? "pvp" : "monster";
      if (manuallySuppressedEvent && manuallySuppressedEvent.name === name) return null;
      if (!eventSelected(name) || !eventIsSupported(name) || (kind === "monster" && !types.length) ||
          (!corroborated && (!state || state.live === false))) return null;
      return { name: name, state: state || {}, types: types, kind: kind };
    }).filter(Boolean).sort(function (a, b) {
      var mapped = G.maps && G.maps[character.map] && G.maps[character.map].event;
      var aCurrent = Number(a.name === mapped || a.name === joinedEvent);
      var bCurrent = Number(b.name === mapped || b.name === joinedEvent);
      return bCurrent - aCurrent || (Number(a.state.end) || Infinity) - (Number(b.state.end) || Infinity);
    })[0] || null;
  }

  function nearestEventTarget() {
    if (joinedEvent && !eventSelected(joinedEvent) || travellingEventName && !eventSelected(travellingEventName)) return null;
    if (isLiveAbtesting()) return nearestAbtestingOpponent();
    // Special/cooperative event bosses are not always returned by the normal
    // path-checked monster selector even when their live entity is visible.
    // Inspect the entity table directly and preserve eventTargetTypes order so
    // a declared boss (Franky, rgoo, etc.) outranks its spawned adds.
    var targets = Object.keys(parent.entities || {}).map(function (id) {
      return parent.entities[id];
    }).filter(function (entity) {
      return entity && entity.type === "monster" && entity.visible !== false && !entity.dead && entity.hp!==0 &&
        (!entity.map || entity.map===character.map) && (entity.in==null || entity.in===character.in) &&
        (character.map === "goobrawl" ? ["rgoo","bgoo","goo"] : eventTargetTypes).indexOf(entity.mtype) >= 0;
    });
    var currentMapEvent = G.maps && G.maps[character.map] && G.maps[character.map].event;
    var gooBrawl = joinedEvent === "goobrawl" || currentMapEvent === "goobrawl";
    if (gooBrawl) {
      // Farm whichever ordinary goo is nearest until Rainbow Goo appears.
      // As soon as it is visible, exclude every filler so the entire party
      // abandons its current goo and focuses the event boss.
      var rainbow = targets.filter(function (target) { return target.mtype === "rgoo"; });
      if (rainbow.length) {
        rainbow.sort(function (a, b) {
          return Math.hypot(a.x - character.x, a.y - character.y) -
            Math.hypot(b.x - character.x, b.y - character.y);
        });
        return rainbow[0];
      }
      targets = targets.filter(function (target) { return target.mtype !== "rgoo"; });
      // Goo Brawl rewards piling onto live targets. Prefer the leader's target,
      // then whichever goo has the most party selections, instead of applying
      // ordinary uncontested/scatter behavior or changing to each tick's
      // nearest goo. This also retains a personal target before telemetry has
      // caught up, eliminating short back-and-forth closing moves.
      var leaderChoice = leaderTarget && targets.find(function (target) {
        return target.id === leaderTarget.id;
      });
      if (leaderChoice) return leaderChoice;
      var partyCounts = {};
      partyTargets.forEach(function (partyTarget) {
        if (partyTarget && partyTarget.id) partyCounts[partyTarget.id] = (partyCounts[partyTarget.id] || 0) + 1;
      });
      var partyChoices = targets.filter(function (target) { return partyCounts[target.id]; });
      partyChoices.sort(function (a, b) {
        return partyCounts[b.id] - partyCounts[a.id] || String(a.id).localeCompare(String(b.id));
      });
      if (partyChoices.length) return partyChoices[0];
      var current = combatTargetId && targets.find(function (target) { return target.id === combatTargetId; });
      if (current) return current;
      targets.sort(function (a, b) {
        return Math.hypot(a.x - character.x, a.y - character.y) -
          Math.hypot(b.x - character.x, b.y - character.y);
      });
      return targets[0] || null;
    }
    targets.sort(function (a, b) {
      var typePriority = eventTargetTypes.indexOf(a.mtype) - eventTargetTypes.indexOf(b.mtype);
      return typePriority || Math.hypot(a.x - character.x, a.y - character.y) -
        Math.hypot(b.x - character.x, b.y - character.y);
    });
    return targets[0] || null;
  }

  function isAggressiveEventCombat() {
    var currentMapEvent = G.maps && G.maps[character.map] && G.maps[character.map].event;
    return joinedEvent === "goobrawl" || currentMapEvent === "goobrawl";
  }

  function isLiveAbtesting() {
    var event = activeCombatEvent();
    var team = eventTeam(character);
    return !!(event && event.name === "abtesting" && character.map === "abtesting" &&
      team && typeof in_pvp === "function" && in_pvp());
  }

  function eventTeam(entity) {
    return entity && (entity.team || entity.s && entity.s.abtesting && entity.s.abtesting.team) || null;
  }

  function abtestingEnemySpawn(team) {
    // Team A enters on the positive/right side; team B enters on the
    // negative/left side. Searching must cross toward the other team's spawn.
    return team === "A" ? { x: -832, y: 0 } : { x: 832, y: 0 };
  }

  function ownedCharacterNames() {
    var names = {};
    partyPositions.forEach(function (member) { if (member && member.name) names[member.name] = true; });
    names[character.name] = true;
    return names;
  }

  function validAbtestingOpponent(target) {
    if (!isLiveAbtesting() || !target || target.type !== "character" || target.visible === false ||
        target.rip || target.dead || !eventTeam(target) || eventTeam(target) === eventTeam(character)) return false;
    if (target.in != null && character.in != null && target.in !== character.in) return false;
    var owned = ownedCharacterNames();
    if (!owned[target.name]) return true;
    return !!(abtestingStrategy && abtestingStrategy.mode === "split" &&
      abtestingStrategy.majorityTeam === eventTeam(character) &&
      (abtestingStrategy.sabotageNames || []).indexOf(target.name) >= 0);
  }

  function nearestAbtestingOpponent() {
    if (!isLiveAbtesting() || !abtestingStrategy || abtestingStrategy.mode === "pending" ||
        (abtestingStrategy.sabotageNames || []).indexOf(character.name) >= 0) return null;
    var ownedFeeder = {}, allies = {};
    (abtestingStrategy.sabotageNames || []).forEach(function (name) { ownedFeeder[name] = true; });
    partyPositions.forEach(function (member) {
      if (member && member.team === eventTeam(character)) allies[member.name] = true;
    });
    allies[character.name] = true;
    var targets = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
      .filter(validAbtestingOpponent);
    targets.sort(function (a, b) {
      return Number(!!ownedFeeder[b.name]) - Number(!!ownedFeeder[a.name]) ||
        Number(!!(b.target && allies[b.target])) - Number(!!(a.target && allies[a.target])) ||
        (Number(a.hp) || Infinity) - (Number(b.hp) || Infinity) ||
        Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y);
    });
    return targets[0] || null;
  }

  function abtestingMode() {
    if (!isLiveAbtesting()) return "none";
    if (!abtestingStrategy || abtestingStrategy.mode === "pending") return "pending";
    return (abtestingStrategy.sabotageNames || []).indexOf(character.name) >= 0 ? "feed" : abtestingStrategy.mode;
  }

  async function sabotageSkill(enemies) {
    if (character.ctype === "mage" && character.max_mp > 0 && character.mp / character.max_mp > 0.35 &&
        !is_on_cooldown("energize") && can_use("energize")) {
      var manaTargets = enemies.filter(function (target) {
        return target.max_mp > 0 && target.mp < target.max_mp && is_in_range(target, "energize");
      }).sort(function (a, b) { return a.mp / a.max_mp - b.mp / b.max_mp || a.mp - b.mp; });
      if (manaTargets.length) {
        var manaTarget = manaTargets[0], available = Math.floor(character.mp - character.max_mp * 0.35);
        var allComfortable = manaTargets.every(function (target) { return target.mp / target.max_mp >= 0.6; });
        var amount = Math.min(available, allComfortable ? 1 : Math.max(1, Math.ceil((manaTarget.max_mp - manaTarget.mp) * 0.2)));
        if (amount > 0) {
          try { await use_skill("energize", manaTarget, amount); return true; }
          catch (_sabotageEnergizeError) { /* Keep feeding if this target rejects support. */ }
        }
      }
    }
    if (character.ctype === "priest") {
      var injuredEnemies = enemies.filter(function (target) {
        return target.max_hp > 0 && target.hp / target.max_hp < 0.9 &&
          character.mp >= G.skills.heal.mp && !is_on_cooldown("heal") && can_use("heal") &&
          is_in_range(target, "heal");
      }).sort(function (a, b) { return a.hp / a.max_hp - b.hp / b.max_hp; });
      if (injuredEnemies.length) {
        try { await heal(injuredEnemies[0]); return true; }
        catch (_sabotageHealError) { /* PvP rules can reject an otherwise visible target. */ }
      }
    }
    if (character.ctype === "priest" && character.mp >= G.skills.curse.mp &&
        !is_on_cooldown("curse") && can_use("curse")) {
      var ownTeam = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
        .filter(function (target) {
          return target && target.type === "character" && target.visible !== false && !target.rip &&
            target.name !== character.name && eventTeam(target) === eventTeam(character) && !(target.s && target.s.cursed) &&
            is_in_range(target, "curse");
        }).sort(function (a, b) { return (Number(b.attack) || 0) - (Number(a.attack) || 0); });
      if (ownTeam.length) {
        try { await use_skill("curse", ownTeam[0]); return true; }
        catch (_sabotageCurseError) { /* Continue toward the enemy if the cast is rejected. */ }
      }
    }
    return false;
  }

  async function runAbtestingSabotage() {
    if (abtestingMode() !== "feed") return false;
    combatTargetId = null;
    var majority = {};
    (abtestingStrategy.majorityNames || []).forEach(function (name) { majority[name] = true; });
    var enemies = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
      .filter(function (entity) {
        return entity && entity.type === "character" && entity.visible !== false && !entity.rip && !entity.dead &&
          eventTeam(entity) && eventTeam(entity) !== eventTeam(character) &&
          (entity.in == null || character.in == null || entity.in === character.in);
      });
    enemies.sort(function (a, b) {
      return Number(!!majority[b.name]) - Number(!!majority[a.name]) ||
        (Number(b.attack) || 0) - (Number(a.attack) || 0) ||
        Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y);
    });
    if (await sabotageSkill(enemies)) return true;
    var target = enemies[0];
    root.partyCombatState = { at: Date.now(), stage: target ? "abtesting-feed" : "abtesting-feed-search", error: null };
    if (target) {
      if (Math.hypot(target.x - character.x, target.y - character.y) > 20 && !character.moving)
        await move(target.x, target.y);
      return true;
    }
    var enemySpawn = abtestingEnemySpawn(eventTeam(character));
    if (!character.moving && Math.hypot(enemySpawn.x - character.x, enemySpawn.y - character.y) > 30)
      await move(enemySpawn.x, enemySpawn.y);
    return true;
  }

  async function pollEvents() {
    if (root.__partyConsoleMaintenance) return;
    if (escapeOwns()) return;
    if (eventPollBusy) return;
    if (huntTurnInPriority || convoyTraveling && convoyTraveling.nonPreemptible) return;
    eventPollBusy = true;
    try {
      if (character.ctype === "merchant" && merchantEventWorkReserved()) {
        // Never take movement from an unsettled inventory operation or worker.
        if (root.__merchantActiveJob || root.__merchantInventoryTidy || merchantIdleActive ||
            banking || stocking || upgrading || root.__partyUpgradePreviewInFlight ||
            luckyUpgradeService && luckyUpgradeService.pending()) return;
        var gatheringAttempt = root.__merchantGatheringAttempt;
        if (gatheringAttempt) {
          gatheringAttempt.cancelled = "event attendance";
          if (gatheringAttempt.phase !== "casting" && typeof stop === "function") await stop("smart");
          return;
        }
        if (gatheringActive) return;
        await closeMerchantStandForTravel();
      }
      if (!eventsEnabled) {
        eventTargetTypes = [];
        joinedEvent = null;
        root.__partyJoinedEvent = null;
        root.__partyEventRejoinRequired = null;
        return;
      }
      // Only an actual kiss attempt is protected. Staging and featured holds
      // must yield before the event's route takes ownership.
      var priorityEvent = activeCombatEvent();
      if (root.__partyAnniversaryKissOperation) return;
      if (anniversaryBusy && !root.__partyAnniversaryStagingOperation) return;
      if (priorityEvent && (anniversaryBusy || anniversaryStaging || root.__partyAnniversaryStagingOperation)) {
        var priorityRevision = navigationIntent.revision;
        var prioritySelectionRevision = eventSelectionRevision;
        if (!await eventTravelAllowed(priorityEvent.name)) return;
        if (!runtimeCurrent() || escapeOwns() || !eventSelected(priorityEvent.name) ||
            priorityRevision !== navigationIntent.revision || prioritySelectionRevision !== eventSelectionRevision) return;
        var staging = root.__partyAnniversaryStagingOperation;
        if (staging) {
          staging.cancelled = true;
          if (staging.revision === navigationIntent.revision && !convoyTraveling && !townTraveling && !forceTraveling) {
            try { await stop("smart"); await stop(); } catch (_anniversaryPreemptStop) {}
          }
          if (root.__partyAnniversaryStagingOperation === staging) root.__partyAnniversaryStagingOperation = null;
        }
        anniversaryBusy = false;
        anniversaryStaging = false;
        anniversaryStage = "joining " + priorityEvent.name;
      } else if (anniversaryBusy || anniversaryStaging) return;
      // A hot reload can retain the character's event map while losing the
      // in-memory join marker. Reconstruct it from the map so an already-ended
      // event can still enter the normal grace-period recovery path.
      var mappedEvent = G.maps && G.maps[character.map] && G.maps[character.map].event;
      if (!joinedEvent && mappedEvent && G.events && G.events[mappedEvent] && G.events[mappedEvent].join) {
        joinedEvent = mappedEvent;
        root.__partyJoinedEvent = mappedEvent;
        eventMissingSince = Date.now();
      }
      var event = activeCombatEvent();
      if (!event) {
        eventTargetTypes = [];
        if (joinedEvent && !eventReturnPending) {
          if (partyEventHint === joinedEvent) {
            eventMissingSince = 0;
            return;
          }
          if (!eventMissingSince) eventMissingSince = Date.now();
          if (Date.now() - eventMissingSince < 10000) return;
          var endedEvent = joinedEvent;
          // Clear this before notifying so repeated polls cannot enqueue the
          // same recovery while the coordinator is responding.
          joinedEvent = null;
          root.__partyJoinedEvent = null;
          try {
            await request("/event-ended", {
              method: "POST",
              body: { character: character.name, event: endedEvent,
                missingFor: Date.now() - eventMissingSince },
            });
          } catch (error) {
            // Restore the marker so the next ten-second poll retries the
            // notification if the local coordinator was temporarily down.
            joinedEvent = endedEvent;
            root.__partyJoinedEvent = endedEvent;
            return;
          }
        }
        return;
      }
      eventMissingSince = 0;
      eventTargetTypes = event.types;
      if (G.maps && G.maps[character.map] && G.maps[character.map].event === event.name &&
          joinedEvent !== event.name) {
        joinedEvent = event.name;
        root.__partyJoinedEvent = event.name;
      }
      if (eventTraveling || banking || stocking || upgrading || departurePending || bankQueued) return;
      if (!await eventTravelAllowed(event.name)) return;
      if (nearestEventTarget()) {
        joinedEvent = event.name;
        root.__partyJoinedEvent = event.name;
        return;
      }
      eventTraveling = true;
      travellingEventName = event.name;
      var travelSelectionRevision = eventSelectionRevision;
      try {
        var destination = eventDestination(event.name, event.state);
        var destinationIsEventMap = G.maps && G.maps[destination.map] &&
          G.maps[destination.map].event === event.name;
        // Death returns an event participant to a normal map while the old
        // in-memory joined marker survives. Physical map presence is the
        // authority: re-join rather than trying to walk back into an instance.
        var rejoinRequired = root.__partyEventRejoinRequired === event.name;
        if (eventRequiresJoin(event.name) &&
            (rejoinRequired || joinedEvent !== event.name || (destinationIsEventMap && character.map !== destination.map))) {
          if (!await eventTravelAllowed(event.name)) return;
          await join(event.name);
          if (!eventSelected(event.name) || travelSelectionRevision !== eventSelectionRevision) return;
          joinedEvent = event.name;
          root.__partyJoinedEvent = event.name;
          root.__partyEventRejoinRequired = null;
          game_log("Joined " + ((G.events[event.name] && G.events[event.name].name) || event.name), "#c084fc");
        }
        if (!eventRequiresJoin(event.name) && joinedEvent !== event.name) {
          joinedEvent = event.name;
          root.__partyJoinedEvent = event.name;
          root.__partyEventRejoinRequired = null;
          game_log("Traveling to " + ((G.events[event.name] && G.events[event.name].name) || event.name), "#c084fc");
        }
        if (!escapeOwns() && event.kind !== "pvp" && !nearestEventTarget() && await eventTravelAllowed(event.name) && eventSelected(event.name) && travelSelectionRevision === eventSelectionRevision)
          await sharedPartyWalk(destination,"event",event.name,null,function(){return !escapeOwns() && eventSelected(event.name) && travelSelectionRevision===eventSelectionRevision;});
      } catch (error) {
        var reason = error && (error.reason || error.message || error);
        if (reason !== "interrupted" && reason !== "event_not_live")
          game_log("Event travel failed: " + reason, "red");
      } finally {
        eventTraveling = false; travellingEventName = null;
      }
    } finally {
      eventPollBusy = false;
    }
  }

  function reunionRealm() { return String(parent.server_region || "") + String(parent.server_identifier || ""); }
  function reunionOrdinaryMap(map) {
    return !!(G.maps && G.maps[map] && !G.maps[map].event && !/^bank/.test(map));
  }
  function reunionBlinkLanding(x, y) {
    return typeof can_move === "function" ? can_move({ map: character.map, x: x, y: y,
      going_x: x, going_y: y, base: character.base }) : can_move_to(x, y);
  }
  function reunionEntrance(map) {
    var doors = (G.maps[character.map] || {}).doors || [], points = [];
    doors.forEach(function (door) {
      if (door[4] !== map) return;
      [[0,40],[0,-40],[40,0],[-40,0]].forEach(function (offset) {
        var point = { x: door[0] + offset[0], y: door[1] + offset[1] };
        if (reunionBlinkLanding(point.x, point.y)) points.push(point);
      });
    });
    return points.sort(function (a, b) {
      return Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y);
    })[0];
  }
  function reunionBlocked() {
    if (escapeOwns()) return true;
    // Pause the return, not defensive combat, when the travel party is attacked.
    // Otherwise isOccupied suppresses healing and attacks while mobs kill us.
    if (Object.values(parent.entities || {}).some(function(enemy) {
      return enemy && enemy.type === "monster" && enemy.visible && !enemy.dead &&
        (typeof isAttackingPartyMember === "function" ? isAttackingPartyMember(enemy) : enemy.target === character.name);
    })) return true;
    if (typeof huntTurnInPriority !== "undefined" && huntTurnInPriority) return true;
    if (typeof rareActive === "function" && rareActive()) return true;
    return character.rip || character.ctype === "merchant" || navigationIntent.cancelled ||
      partyTownActive || townTraveling || partyConvoyActive || convoyTraveling ||
      anniversaryBusy || anniversaryStaging || eventTraveling || activeCombatEvent() ||
      banking || bankQueued || stocking || upgrading || forceTraveling;
  }
  function reunionMembers() {
    if (!partyLocation) return [];
    return partyPositions.filter(function (member) {
      return member.name !== character.name && desiredPartyMembers.indexOf(member.name) >= 0 &&
        member.ctype !== "merchant" && !member.rip && member.hp > 0 && !member.activeEvent &&
        Date.now() + coordinatorClockOffset - Number(member.seenAt) < 10000 &&
        member.server === reunionRealm() && member.map === partyLocation.map &&
        Math.hypot(member.x - partyLocation.x, member.y - partyLocation.y) <= 800;
    }).sort(function (a, b) {
      return Number(b.name === leader) - Number(a.name === leader) ||
        Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y);
    });
  }
  function reunionManaAllowed(skill, reserve) {
    var definition = G.skills && G.skills[skill];
    var cost = definition && Number(definition.mp) * (100 - (Number(character.mp_reduction) || 0)) / 100;
    return !!definition && character.mp - cost >= character.max_mp * reserve &&
      !is_on_cooldown(skill) && can_use(skill);
  }
  function beginFarmReunion(command) {
    if (character.ctype === "merchant") return;
    if (typeof lastDeathInfo !== "undefined" && lastDeathInfo) root.__partyRecoveredDeathAt = parent.__partyRecoveredDeathAt = lastDeathInfo.at;
    if (combatRecoveryActive()) return;
    if (farmingTravelToken) farmingTravelToken.cancelled = true;
    reunion = root.__partyReunion = { id: character.name + "-" + Date.now(),
      revision: navigationIntent.revision, phase: "waiting", retryAt: 0,
      command: command || null, portAttempted: false };
    combatTargetId = null;
    followingLeader = false;
    kiteState.targetId = null;
    Promise.resolve(stop("smart")).catch(function () {});
  }
  function reunionCurrent(token) {
    return runtimeCurrent() && reunion === token && !token.cancelled &&
      token.revision === navigationIntent.revision && !navigationIntent.cancelled;
  }
  async function cancelFarmReunion(reason) {
    var token = reunion;
    if (!token) return;
    token.cancelled = true; token.phase = "cancelled"; token.lastError = reason;
    if (token.moving) { try { await stop("smart"); } catch (_) {} }
    if (reunion === token) reunion = root.__partyReunion = null;
  }
  function reunionMageEligible() {
    return character.ctype === "mage" && !reunionBlocked() && !reunionWorking &&
      !character.moving && !engagedMonster() && !is_transporting(character) &&
      !Object.keys(character.c || {}).length && reunionOrdinaryMap(character.map) && partyLocation &&
      character.map === partyLocation.map && Math.hypot(character.x - partyLocation.x, character.y - partyLocation.y) <= 800 &&
      reunionManaAllowed("magiport", 0.1);
  }
  async function reunionCm(name, data) {
    if (!data || data.type !== "farm-reunion") {
      if (typeof previousReunionCm === "function") return previousReunionCm(name, data);
      return;
    }
    if (desiredPartyMembers.indexOf(name) < 0 || data.realm !== reunionRealm()) return;
    if (data.action === "request" && reunionMageEligible() && (!reunionMageOffer || reunionMageOffer.expires < Date.now())) {
      var member = partyPositions.find(function (entry) { return entry.name === name; });
      if (!member || member.rip || !reunionOrdinaryMap(member.map) || member.server !== reunionRealm() ||
          Date.now() + coordinatorClockOffset - member.seenAt >= 10000) return;
      reunionMageOffer = { id: data.id, name: name, revision: data.revision,
        ownRevision: navigationIntent.revision, expires: Date.now() + 10000, cast: false };
      await send_cm(name, { type: "farm-reunion", action: "offer", id: data.id, realm: reunionRealm() });
    } else if (data.action === "offer" && reunion && reunion.id === data.id && reunion.mage === name &&
        Date.now() < reunion.portExpires && reunionCurrent(reunion) && !reunionBlocked() &&
        reunionMembers().some(function (entry) { return entry.name === name; })) {
      reunion.phase = "accepting-magiport";
      await send_cm(name, { type: "farm-reunion", action: "ready", id: data.id,
        revision: reunion.revision, realm: reunionRealm() });
    } else if (data.action === "ready" && reunionMageOffer && reunionMageOffer.name === name &&
        reunionMageOffer.id === data.id && reunionMageOffer.revision === data.revision &&
        reunionMageOffer.ownRevision === navigationIntent.revision && !reunionMageOffer.cast &&
        Date.now() < reunionMageOffer.expires && reunionMageEligible()) {
      reunionMageOffer.cast = true;
      await use_skill("magiport", name);
      game_log("Magiport reunion requested for " + name, "#51D2E1");
    }
  }
  root.on_cm = function (name, data) { reunionCm(name, data).catch(function (error) {
    game_log("Reunion message failed: " + (error.reason || error.message || error), "#f0b429");
  }); };
  var reunionCmHandler = root.on_cm;
  root.on_magiport = function (name) {
    if (escapeOwns()) {
      var operation = escapeState;
      if (name !== operation.roles.mage || operation.roles[operation.stage] !== character.name ||
          !escapeLocal || escapeLocal.readyForPort !== operation.stage) return;
      Promise.resolve(stop("smart")).then(function () {
        if (escapeState && escapeState.id === operation.id && escapeState.stage === operation.stage && !character.rip)
          return accept_magiport(name);
      }).catch(function (error) { if (escapeLocal) escapeLocal.error = String(error.message || error); });
      return;
    }
    var token = reunion;
    if (!token || token.mage !== name || token.phase !== "accepting-magiport" ||
        Date.now() >= token.portExpires || !reunionCurrent(token) || reunionBlocked() ||
        !reunionOrdinaryMap(character.map) || !reunionMembers().some(function (entry) { return entry.name === name; })) return;
    token.phase = "magiport-arrival";
    Promise.resolve(stop("smart")).then(function () {
      if (reunionCurrent(token) && !reunionBlocked()) return accept_magiport(name);
    }).catch(function (error) { token.lastError = String(error.reason || error.message || error); });
  };
  var reunionMagiportHandler = root.on_magiport;
  async function farmReunionTick() {
    // Respawn can finish after its promise times out, or before a reloaded
    // runner observes rip. Recover authorized displacement independently.
    if (runtimeCurrent() && !reunion && partyLocation && !reunionBlocked() &&
        (character.map !== partyLocation.map || typeof lastDeathInfo !== "undefined" && lastDeathInfo &&
          lastDeathInfo.at > (Math.max(root.__partyRecoveredDeathAt || 0, parent.__partyRecoveredDeathAt || 0)))) {
      beginFarmReunion();
      if (typeof lastDeathInfo !== "undefined" && lastDeathInfo) root.__partyRecoveredDeathAt = parent.__partyRecoveredDeathAt = lastDeathInfo.at;
    }
    if (!runtimeCurrent() || !reunion) return;
    var token = reunion;
    if (!reunionCurrent(token) || character.rip) return cancelFarmReunion("navigation changed or died");
    if(root.__partySharedWalking && root.__partySharedWalking.activity==="farm-recovery")return;
    if (reunionBlocked()) {
      token.portExpires = 0;
      if (token.moving) { token.moving = false; try { await stop("smart"); } catch (_) {} }
      token.phase = "waiting-for-movement-owner"; return;
    }
    if (token.moving && !reunionMembers().length && !partyLocation) {
      token.moving = false; token.phase = "waiting-for-party-near-farm";
      try { await stop("smart"); } catch (_) {}
      token.retryAt = Date.now() + 5000; return;
    }
    if (token.handoffPending || reunionWorking && !token.moving) return;
    var handoffTarget = token.command && token.command.convoyHandoff && farmingTravelTarget(token.command);
    if (handoffTarget) {
      token.handoffPending = true;
      try {
        await request("/event-resume-complete", { method: "POST", body: {
          character: character.name, commandId: token.command.id, navigationRevision: token.revision,
          engagedTarget: { id: handoffTarget.id, map: character.map, x: handoffTarget.x, y: handoffTarget.y } } });
        if (!reunionCurrent(token) || reunionBlocked()) return;
        Promise.resolve(stop("smart")).catch(function () {});
        combatTargetId = handoffTarget.id;
        reunion = root.__partyReunion = null;
        eventRecoveryState.phase = "complete";
      } catch (error) { token.retryAt = Date.now() + 1000; }
      finally { token.handoffPending = false; }
      return;
    }
    // A full wipe has no survivor to rendezvous with. Use the authorized
    // waypoint itself so everyone can return instead of waiting on each other.
    var member = reunionMembers()[0] || (partyLocation && Object.assign({name:"the saved farming waypoint"},partyLocation));
    if (!member) { token.phase = "waiting-for-party-near-farm"; token.retryAt = Date.now() + 5000; return; }
    var distance = character.map === member.map ? Math.hypot(character.x - member.x, character.y - member.y) : Infinity;
    var commandArrived = !token.command || !!token.command.convoyHandoff || (token.command.location.shapes || token.command.location.allOf
      ? inFarmArea(character,token.command.location,0) : character.map === token.command.location.map &&
        Math.hypot(character.x-token.command.location.x,character.y-token.command.location.y)<=150);
    if (distance <= 150 && commandArrived &&
        (character.in == null || member.in == null || character.in === member.in) && can_move_to(member.x, member.y)) {
      if (token.moving) {token.moving=false; try {await stop("smart");} catch (_) {}}
      if (!reunionCurrent(token)) return;
      if (token.command) {
        reunionWorking = true;
        try { await request("/event-resume-complete", { method: "POST", body: {
          character: character.name, commandId: token.command.id, navigationRevision: token.revision } }); }
        catch (error) { token.lastError = String(error.message || error); token.retryAt = Date.now() + 10000; return; }
        finally { reunionWorking = false; }
      }
      token.phase = "complete"; eventRecoveryState.phase = "complete";
      game_log("Rejoined farming party near " + member.name, "#51D2E1");
      reunion = root.__partyReunion = null; return;
    }
    if (reunionWorking || Date.now() < (token.retryAt || 0)) return;
    token.destination = { map: member.map, x: member.x, y: member.y };
    if (token.command && distance <= 150 && !commandArrived) token.destination = token.command.location;
    if (token.portExpires && Date.now() < token.portExpires) return;
    if (!token.portAttempted && distance > 300 && reunionOrdinaryMap(character.map)) {
      var mage = reunionMembers().find(function (entry) { return entry.ctype === "mage"; });
      if (mage) {
        token.portAttempted = true; token.mage = mage.name; token.portExpires = Date.now() + 10000;
        token.phase = "requesting-magiport";
        await send_cm(mage.name, { type: "farm-reunion", action: "request", id: token.id,
          revision: token.revision, realm: reunionRealm() });
        return;
      }
    }
    reunionWorking = true; token.moving = true; token.phase = "travelling";
    try {
      // Blink stays on this map: shorten a direct entrance leg, then use the
      // normal map transition before attempting Blink near the survivors.
      if (character.map !== member.map && character.ctype === "mage" && reunionOrdinaryMap(character.map) &&
          reunionOrdinaryMap(member.map) && !engagedMonster() && !is_transporting(character) &&
          !Object.keys(character.c || {}).length && reunionManaAllowed("blink", 0.3)) {
        var entrance = reunionEntrance(member.map);
        if (entrance && Math.hypot(character.x - entrance.x, character.y - entrance.y) > 300) {
          token.phase = "blinking-to-entrance";
          try { await anniversaryWithTimeout(use_skill("blink", [entrance.x, entrance.y]), 3000, "Reunion entrance Blink"); }
          catch (error) { token.lastError = String(error.reason || error.message || error); }
          if (!reunionCurrent(token) || reunionBlocked()) return;
        }
      }
      var destination = character.map !== member.map ? { map: member.map } : token.destination;
      if (character.map === member.map && character.ctype === "mage" && distance > 300 &&
          (character.in == null || member.in == null || character.in === member.in) && reunionBlinkLanding(member.x, member.y) &&
          reunionOrdinaryMap(member.map) && !engagedMonster() && !is_transporting(character) &&
          !Object.keys(character.c || {}).length && reunionManaAllowed("blink", 0.3)) {
        token.phase = "blinking";
        await stop("smart");
        try { await anniversaryWithTimeout(use_skill("blink", [member.x, member.y]), 3000, "Reunion Blink"); }
        catch (error) { token.lastError = String(error.reason || error.message || error); }
        var blinkDeadline = Date.now() + 3000;
        while (reunionCurrent(token) && !reunionBlocked() && Date.now() < blinkDeadline &&
            !(character.map === member.map && Math.hypot(character.x - member.x, character.y - member.y) <= 150)) await sleep(100);
        if (!token.command && character.map === member.map && Math.hypot(character.x - member.x, character.y - member.y) <= 150) return;
      }
      if (!reunionCurrent(token) || reunionBlocked()) return;
      if(!reunionMembers().length && leader && farmingMode!=="scatter")
        await sharedPartyWalk(farmingEntryPoint(token.destination),"farm-recovery","farming",token.command,function(){return reunionCurrent(token);});
      else await anniversaryWithTimeout(smart_move(farmingEntryPoint(destination)), 90000, "Farming reunion travel");
    } catch (error) {
      if (!reunionCurrent(token)) return;
      token.lastError = String(error.reason || error.message || error); token.retryAt = Date.now() + 10000;
      token.phase = "retry-wait";
      game_log("Farming reunion retry: " + token.lastError, "#f0b429");
    } finally {
      if (reunionCurrent(token) && !reunionBlocked()) { try { await stop("smart"); } catch (_) {} }
      token.moving = false; reunionWorking = false;
    }
  }

  async function rejoinActiveEventAfterRespawn() {
    if (escapeOwns() || navigationIntent.cancelled) return { status: "cancelled" };
    if (!eventsEnabled) return { status: "not-applicable" };
    var requiredEventName = root.__partyEventRejoinRequired;
    var event = activeCombatEvent();
    if (!event && requiredEventName) return { status: "cancelled" };
    if (!event) return { status: "not-applicable" };
    var revision = Number(navigationIntent.revision), selection = eventSelectionRevision;
    function current() { return runtimeCurrent() && !escapeOwns() && !navigationIntent.cancelled &&
      Number(navigationIntent.revision) === revision && eventSelectionRevision === selection && eventSelected(event.name); }
    if (!await eventTravelAllowed(event.name)) return { status: "cancelled" };
    if (eventTraveling) return { status: "retryable", reason: "Event travel already in progress" };
    eventTargetTypes = event.types; eventMissingSince = 0;
    eventTraveling = true; travellingEventName = event.name;
    var phase = "event-reentry";
    try {
      if (typeof stop === "function") try { await stop("smart"); } catch (_) {}
      if (!current()) return { status: "cancelled" };
      var destination = eventDestination(event.name, event.state);
      if (eventRequiresJoin(event.name) && (root.__partyEventRejoinRequired || joinedEvent !== event.name)) await join(event.name);
      if (!current() || !await eventTravelAllowed(event.name)) return { status: "cancelled" };
      joinedEvent = event.name; root.__partyJoinedEvent = event.name; root.__partyEventRejoinRequired = null;
      phase = "event-travel";
      if (event.name !== "abtesting" && !nearestEventTarget())
        await sharedPartyWalk(destination, "event", event.name, null, current);
      if (!current()) return { status: "cancelled" };
      game_log("Recovered " + event.name + " participation after respawning", "#c084fc");
      return { status: "recovered", phase: phase };
    } catch (error) {
      var reason = String(error && (error.reason || error.message || error));
      if (!current() || reason === "event_not_live") return { status: "cancelled", phase: phase, reason: reason };
      return { status: "retryable", phase: phase, reason: reason };
    } finally { eventTraveling = false; travellingEventName = null; }
  }

  async function regenerateHpOrMp() {
    if (escapeOwns() && ["complete", "failed-hold"].indexOf(escapeState.stage) < 0) return false;
    if (regenerationBusy || character.rip) return false;
    var hpRatio = character.max_hp > 0 ? character.hp / character.max_hp : 1;
    var mpRatio = character.max_mp > 0 ? character.mp / character.max_mp : 1;
    var skill = null;
    if (character.ctype === "merchant") {
      // use_hp consumes the last inventory item that grants HP. Match that
      // selection so the threshold reflects the potion actually consumed.
      var healAmount = 0;
      for (var slot = (character.items || []).length - 1; slot >= 0 && !healAmount; slot--) {
        var item = character.items[slot], definition = item && G.items && G.items[item.name];
        var grant = definition && (definition.gives || []).find(function (value) { return value[0] === "hp" && value[1] > 0; });
        if (grant) healAmount = Number(grant[1]);
      }
      if (healAmount > 0 && character.max_hp - character.hp > healAmount) skill = "use_hp";
    }

    // Critical HP remains the only regeneration priority until it clears 50%.
    if (skill) { /* Merchant HP potion takes priority over free regeneration. */ }
    else if (hpRatio < 0.5) skill = "regen_hp";
    // With HP out of danger, restore critical MP before topping off HP.
    else if (mpRatio < 0.5) skill = "regen_mp";
    // In normal conditions HP has priority, followed by MP.
    else if (character.hp < character.max_hp) skill = "regen_hp";
    else if (character.mp < character.max_mp) skill = "regen_mp";

    if (!skill || is_on_cooldown(skill)) return false;
    regenerationBusy = true;
    try {
      await use_skill(skill);
      return true;
    } catch (error) {
      // A failed recovery must not prevent potions, healing, or combat later in the loop.
      var reason = error && (error.reason || error.message);
      if (reason && reason !== "cooldown" && reason !== "no_mp")
        game_log("Recovery failed: " + reason, "red");
      return false;
    } finally {
      regenerationBusy = false;
    }
  }

  function passiveRegenerationEligible() {
    if (character.rip) return false;
    if (character.ctype === "merchant") return true;
    if (escapeOwns() && ["complete", "failed-hold"].indexOf(escapeState.stage) >= 0) return true;
    // The role loop already handles regeneration during ordinary combat and
    // gives configured emergency potions priority. This pulse covers states
    // where navigation/event ownership intentionally blocks that role loop.
    return reunion || anniversaryStaging || anniversaryBusy || eventTraveling || townTraveling ||
      forceTraveling || convoyTraveling || partyConvoyActive || followingLeader ||
      departurePending || partyTownActive || banking || stocking || upgrading ||
      gatheringActive || (character.moving && !engagedMonster());
  }

  function passiveRegenerationTick() {
    if (escapeOwns() && ["complete", "failed-hold"].indexOf(escapeState.stage) < 0) return;
    if (!runtimeCurrent() || !passiveRegenerationEligible()) return;
    // Regular heals do not own movement. Top off nearby party members so
    // their recovery pulse can move on to MP instead of repeatedly healing HP.
    if (character.ctype === "priest") healPartyBelow(1, { regularOnly: true }).catch(function () {});
    regenerateHpOrMp().catch(function () {});
  }

  async function useRecoveryPotion(options) {
    options = options || {};
    if (is_on_cooldown("use_hp")) return false;
    var hpRatio = character.max_hp > 0 ? character.hp / character.max_hp : 1;
    var mpRatio = character.max_mp > 0 ? character.mp / character.max_mp : 1;
    var hpNeeded = Number.isFinite(Number(options.hpBelow)) && hpRatio < Number(options.hpBelow);
    var mpNeeded = Number.isFinite(Number(options.mpBelow)) && mpRatio < Number(options.mpBelow);
    var skill = options.force === "hp" || options.force === "mp" ? "use_" + options.force : null;
    if (!skill && hpNeeded && mpNeeded) skill = options.priority === "mp" ? "use_mp" : "use_hp";
    else if (!skill && hpNeeded) skill = "use_hp";
    else if (!skill && mpNeeded) skill = "use_mp";
    if (!skill) return false;
    try {
      await use_skill(skill);
      return true;
    } catch (error) {
      var reason = error && (error.reason || error.message || error);
      // Missing potions fall through to free regeneration instead of stopping
      // combat or flooding the game log.
      if (["cooldown", "no_item", "not_found", "full"].indexOf(String(reason)) < 0)
        game_log("Potion failed: " + reason, "red");
      return false;
    }
  }

  async function absorbSinsBelow() {
    return !!(root.sharedRoutine && root.sharedRoutine.absorbLeaderAggro &&
      await root.sharedRoutine.absorbLeaderAggro());
  }

  async function healPartyBelow(ratio, options) {
    if (character.ctype !== "priest" || character.rip || healingBusy) return false;
    options = options || {};
    ratio = ratio || 0.9;
    healingBusy = true;
    try {
    var injured = partyPositions.filter(function (member) {
      return member && member.ctype !== "merchant" && sameEventTeamMember(member) && !member.rip && member.map === character.map && member.max_hp > 0 &&
        member.hp / member.max_hp < ratio;
    }).sort(function (a, b) {
      return a.hp / a.max_hp - b.hp / b.max_hp;
    });
    var criticallyInjured = partyPositions.filter(function (member) {
      return member && member.ctype !== "merchant" && sameEventTeamMember(member) && !member.rip && member.map === character.map && member.max_hp > 0 &&
        member.hp / member.max_hp <= 0.5;
    });
    if (!options.regularOnly && criticallyInjured.length >= 2 && (!isLiveAbtesting() || abtestingStrategy && abtestingStrategy.mode === "uniform") &&
        character.mp >= G.skills.partyheal.mp &&
        !is_on_cooldown("partyheal") && can_use("partyheal")) {
      await use_skill("partyheal");
      return true;
    }
    // Heal whichever living party member is hurt most, including the priest.
    // Excluding the caster left priests sitting injured indefinitely while
    // every other party member remained above the healing threshold.
    // An absent/out-of-range member must not block healing somebody nearby.
    // Recheck live HP because coordinator heartbeats can lag behind a heal.
    if (character.mp < Number(G.skills.heal && G.skills.heal.mp || 0)) return false;
    var target = injured.map(function (member) {
      return member.name === character.name ? character : get_player(member.name);
    }).find(function (member) {
      return member && member.ctype !== "merchant" && !member.rip && member.max_hp > 0 && member.hp / member.max_hp < ratio && can_heal(member);
    });
    if (!target) return false;
    var healTimeout, healStartedAt = Date.now();
    try {
      var healed = await Promise.race([Promise.resolve(heal(target)).then(function () { return true; }), new Promise(function (resolve) {
        healTimeout = setTimeout(function () { resolve(false); }, 2000);
      })]);
      if (healed && runtimeCurrent() && root.partyCombatState) {
        root.partyCombatState.lastHealAt = Date.now();
        root.partyCombatState.lastHealTarget = target.name || target.id;
        if (Number(root.partyCombatState.errorAt || 0) <= healStartedAt)
          root.partyCombatState.error = null;
      }
    } finally { clearTimeout(healTimeout); }
    return true;
    } catch (error) {
      if (runtimeCurrent() && root.partyCombatState) {
        root.partyCombatState.error = String(error && (error.reason || error.message) || error);
        root.partyCombatState.errorAt = Date.now();
      }
      throw error;
    } finally { healingBusy = false; }
  }

  async function energizeLowestMana(reserveRatio) {
    if (character.ctype !== "mage" || character.max_mp <= 0) return false;
    reserveRatio = reserveRatio == null ? 0.35 : reserveRatio;
    var reserve = Math.ceil(character.max_mp * reserveRatio);
    var available = Math.floor(character.mp - reserve);
    if (available <= 0 || is_on_cooldown("energize") || !can_use("energize")) return false;
    var partyNames = currentPartyList();
    var candidates = partyPositions.filter(function (member) {
      return member && sameEventTeamMember(member) && member.name !== character.name && partyNames.indexOf(member.name) >= 0 &&
        !member.rip && member.map === character.map && member.max_mp > 0 && member.mp < member.max_mp;
    }).sort(function (a, b) {
      return a.mp / a.max_mp - b.mp / b.max_mp || a.mp - b.mp || a.name.localeCompare(b.name);
    });
    for (var i = 0; i < candidates.length; i += 1) {
      var status = candidates[i];
      var target = get_player(status.name);
      if (!target || !is_in_range(target, "energize")) continue;
      var missing = Math.max(0, Math.floor(status.max_mp - status.mp));
      var allComfortable = candidates.every(function (member) {
        return member.mp / member.max_mp >= 0.6;
      });
      // Above 60%, Energize is primarily an attack-frequency proc. Otherwise
      // replenish gradually so the mage can distribute mana every cooldown.
      var requested = allComfortable ? 1 : Math.max(1, Math.ceil(missing * 0.2));
      var amount = Math.min(available, requested);
      if (amount <= 0) continue;
      await use_skill("energize", target, amount);
      return true;
    }
    return false;
  }

  async function dashToward(target) {
    if (typeof groupedFarming === "function" && groupedFarming() && formationMembers().some(function (member) { return member.ctype === "priest"; })) return false;
    if (character.ctype !== "warrior" || !target || character.max_mp <= 0 ||
        character.mp / character.max_mp < 0.5 || character.mp < G.skills.dash.mp ||
        is_on_cooldown("dash") || !can_use("dash")) return false;
    var dx = target.x - character.x;
    var dy = target.y - character.y;
    // The deployed Dash contract moves exactly 40 units in the character's
    // cardinal facing direction; it does not accept a target entity.
    var dashDistance = 40;
    if (Math.sqrt(dx * dx + dy * dy) <= dashDistance) return false;
    var endpoint = Math.abs(dx) >= Math.abs(dy)
      ? { x: character.x + (dx < 0 ? -40 : 40), y: character.y }
      : { x: character.x, y: character.y + (dy < 0 ? -40 : 40) };
    var hitbox = Math.max(0, Math.hypot(dx, dy) - combatDistance(target));
    if (Math.hypot(endpoint.x - target.x, endpoint.y - target.y) - hitbox < desiredCombatRange() ||
        !safeCombatPoint(endpoint, target)) return false;
    character.direction = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0);
    await use_skill("dash");
    return true;
  }

  function isPartyHealthy(ratio) {
    ratio = ratio || 0.9;
    return partyPositions.filter(function (member) {
      // Match the healing routine's scope: living party members the priest can
      // presently support on this map, including the priest itself.
      return member && sameEventTeamMember(member) && !member.rip && member.map === character.map && member.max_hp > 0;
    }).every(function (member) {
      return member.hp / member.max_hp >= ratio;
    });
  }

  function isCurrentPartyTarget(target) {
    if (!target || !target.id) return false;
    if (leaderTarget && leaderTarget.id === target.id) return true;
    return partyTargets.some(function (partyTarget) {
      return partyTarget && partyTarget.id === target.id;
    });
  }

  function isPartyThreat(target) {
    return target && !isPassingEncounter(target) && partyThreats.some(function (threat) { return threat.id === target.id; });
  }

  function isAttackingPartyMember(target) {
    if (!target || target.type !== "monster" || isPassingEncounter(target) && !returnDepartureDefense() &&
        !(typeof convoyTraveling !== 'undefined' && convoyTraveling && convoyTraveling.continuousReturn === 1)) return false;
    target = get_entity(target.id) || target;
    if (target.target === character.name) return true;
    if (!target.target || currentPartyList().indexOf(target.target) < 0)
      return false;
    return partyPositions.some(function (member) {
      return member && sameEventTeamMember(member) && member.name === target.target && member.map === character.map;
    });
  }

  function getNearestPartyAttacker() {
    var attackers = Object.keys(parent.entities || {}).map(function (id) {
      return parent.entities[id];
    }).filter(function (entity) {
      return entity && entity.type === "monster" && entity.visible && !entity.dead &&
        isAttackingPartyMember(entity) && isAllowedTarget(entity);
    });
    attackers.sort(function (a, b) {
      var adx = a.x - character.x, ady = a.y - character.y;
      var bdx = b.x - character.x, bdy = b.y - character.y;
      return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
    });
    return attackers[0] || null;
  }

  function getNearestPartyTarget() {
    var targets = partyTargets.map(function (target) {
      return target && get_entity(target.id);
    }).filter(function (target) {
      return target && target.type === "monster" && target.visible && !target.dead && isAllowedTarget(target);
    });
    targets.sort(function (a, b) {
      var adx = a.x - character.x, ady = a.y - character.y;
      var bdx = b.x - character.x, bdy = b.y - character.y;
      return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
    });
    return targets[0] || null;
  }

  function isExternallyClaimedMonster(target) {
    if (!target || target.type !== "monster") return false;
    // Re-read the server snapshot: the selected object may predate impact.
    target = get_entity(target.id) || target;
    var definition = G.monsters && G.monsters[target.mtype] || {};
    if (target.mtype === 'phoenix' && typeof rareControlState !== 'undefined' && rareControlState &&
        rareControlState.allowPhoenixAssist && typeof rareControlCurrent === 'function' && rareControlCurrent()) return false;
    if (target.mtype !== 'phoenix' && (target.cooperative || definition.cooperative) || (character.map === "goobrawl" ? ["rgoo","bgoo","goo"] : eventTargetTypes).indexOf(target.mtype) >= 0)
      return false;
    if (!target.target || target.target === character.name) return false;
    return currentPartyList().indexOf(target.target) < 0;
  }

  function returnDepartureDefense() {
    var c=typeof convoyTraveling !== 'undefined' && convoyTraveling;
    return !!(c && c.purpose==='monster-hunt' && c.nonPreemptible && !c.returnWalking &&
      (c.phase!=='travelling' || typeof movement!=='undefined' && movement.transition && movement.transition()==='town'));
  }
  function interruptConvoyForDefense(id, epoch, aggressor) {
    var c=convoyTraveling;
    if(c && id && (c.id!==id || Number(epoch)<c.epoch))return;
    if(c && ((c.navigationExempt && c.purpose!=='anniversary-return') || ['escape-recovery','franky-exit','event-return','rare-hunt','phoenix-patrol'].indexOf(c.purpose)>=0))return;
    if(!c && !id)return;
    if(c && (c.returnWalking || c.continuousReturn === 1 || c.purpose === 'monster-hunt' && c.huntTarget))return;
    root.__partyConvoyDefense=id || c.id;
    if(c && (c.routeProtocol===4 || c.purpose==='monster-hunt' && c.nonPreemptible)) {
      if(c.defensePaused)return;
      c.defenseTargets = aggressor ? [Object.assign(groupedEntityReport(aggressor), {server:reunionRealm()})] :
        typeof currentTravelAttackers === 'function' ? currentTravelAttackers() : [];
      c.defenseInterruption = {at:Date.now(),source:id ? 'coordinator' : 'local-attacker',
        convoyId:c.id,epoch:c.epoch,commandId:c.commandId,navigationRevision:c.navigationRevision,
        phase:c.phase,targets:c.defenseTargets};
      if(c.freezeRoute)c.freezeRoute();
      if(c.detachRoute)c.detachRoute();
      if(c.townAttempt && c.townAttempt.state==='casting')c.townAttempt.state='interrupted';
      c.defensePaused=true;c.phase='defending';c.routeReady=false;
      try {Promise.resolve(stop()).catch(function(){});}catch(_){}
      root.__partyNavigationDetail='Defending party; convoy will resume after combat';
      if(root.partyQueueClient && root.partyQueueClient.flush)root.partyQueueClient.flush();
      if(root.partyRoleRunner)root.partyRoleRunner.wake();
      return;
    }
    if(c) {
      c.cancelled=true;releaseConvoyCruise(c);if(c.release)c.release();convoyTraveling=null;
      try {Promise.resolve(stop()).catch(function(){});}catch(_){}
    }
    root.__partyNavigationDetail='Defending party; convoy will resume after combat';
    if(root.partyRoleRunner)root.partyRoleRunner.wake();
  }
  function groupedFarming() {
    return character.ctype !== "merchant" && (farmingMode !== "scatter" || !!root.__partyConvoyDefense) && !!leader &&
      (leader === character.name || followLeader) && !eventTraveling && !joinedEvent &&
      !eventTargetTypes.length && !(G.maps && G.maps[character.map] && G.maps[character.map].event);
  }
  function groupedFollower() {
    return groupedFarming() && (typeof groupedCombat !== "undefined" && groupedCombat && groupedCombat.protocol === 4 ? groupedCombat.targetLeader : leader) !== character.name;
  }
  function groupedFresh() {
    return groupedCombat && groupedCombat.leader === leader && groupedCombat.members.indexOf(character.name) >= 0 &&
      Date.now() + coordinatorClockOffset - groupedCombat.seenAt <= 3000 &&
      Date.now() + coordinatorClockOffset >= groupedCombat.seenAt - 500 &&
      groupedCombat.key.indexOf(JSON.stringify(convoyRuntimeId)) >= 0;
  }
  function reportFightDeath(id) {
    if (!id) return;
    if(groupedCombat && groupedCombat.target && groupedCombat.target.id===id)root.__partyQueueLastDeath={id:id,at:Date.now()};
    fightDeaths = root.__partyFightDeaths = fightDeaths.filter(function (d) { return Date.now()-d.at<60000; });
    if (!fightDeaths.some(function (d) { return d.id===id && d.map===character.map && d.in===character.in && d.server===reunionRealm(); }))
      fightDeaths.push({id:id,map:character.map,in:character.in,server:reunionRealm(),at:Date.now()+coordinatorClockOffset});
    if(root.partyQueueClient) { root.partyQueueClient.reportEvidence(fightDeaths); root.partyQueueClient.flush(); }
  }
  function groupedEntityReport(e) { return {id:e.id,mtype:e.mtype,map:character.map,in:character.in,x:e.x,y:e.y,hp:e.hp,max_hp:e.max_hp}; }
  function currentTravelAttackers() {
    return Object.values(parent.entities || {}).filter(function(e) {
      return e && e.type === "monster" && departureTargetEngaged(e);
    }).map(function(e) { return Object.assign({}, groupedEntityReport(e), { target: e.target, server: reunionRealm() }); });
  }
  function travelObservationAt() {
    return parent.socket && parent.socket.connected ? Date.now() + coordinatorClockOffset : 0;
  }
  function travelCombatActive() {
    var control = root.__partyTravelCombat;
    return !!localTravelCommand() || !!(control && !navigationIntent.cancelled && control.revision >= (navigationIntent.revision || 0));
  }
  function localTravelCommand() {
    var token = farmingTravelToken;
    return token && token.defensiveTravel && !token.cancelled && !navigationIntent.cancelled && token.revision === navigationIntent.revision
      ? { id: token.id, revision: token.revision } : null;
  }
  function groupedThreatReports() {
    if (!groupedFarming()) return [];
    var threats=Object.values(parent.entities || {}).filter(function(e) {
      return e && e.type==='monster' && e.visible && !e.dead && isAttackingPartyMember(e);
    }).map(groupedEntityReport);
    var hit=root.__partyDefensiveHit;
    if(hit && !isPassingEncounter(hit.target) && Date.now()-hit.at<3000 && !fightDeaths.some(function(d){return d.id===hit.target.id;}))threats.push(hit.target);
    return threats;
  }
  function groupedSightings() {
    var current=groupedCombat && groupedCombat.target && get_entity(groupedCombat.target.id);
    if(current && current.visible && !current.dead)root.__partyTargetLastVisible={id:current.id,map:character.map,in:character.in,x:character.x,y:character.y,at:Date.now()};
    return groupedCombat && groupedCombat.queue ? groupedCombat.queue.map(function(f) {return get_entity(f.id);})
      .filter(function(e) {return e && e.visible && !e.dead;}).map(function(e){return Object.assign(groupedEntityReport(e),{target:e.target || null});}) : [];
  }
  function unfinishedFight() { return groupedFarming() && groupedCombat && groupedCombat.fights && groupedCombat.fights.length>0; }
  function groupedDefensiveTarget() {
    if(!groupedFarming() || !groupedCombat || !groupedCombat.target)return null;
    var e=get_entity(groupedCombat.target.id);
    return e && e.visible && !e.dead && isAttackingPartyMember(e) ? e : null;
  }
  function groupedDefensePending() {
    if (!groupedFarming()) return false;
    return !!groupedDefensiveTarget() || !!(groupedFresh() && groupedCombat.threats && groupedCombat.threats.length);
  }
  function activeCombatTarget() {
    var id=root.partyCombatState && root.partyCombatState.selectedTarget;
    var e=id && get_entity(id);
    return !character.rip && e && e.type==='monster' && e.visible && !e.dead && e.hp>0 ?
      {id:String(e.id),map:character.map,in:character.in,server:reunionRealm(),at:Date.now()+coordinatorClockOffset} : null;
  }
  function queueMarkers() {
    if (typeof eventTargetTypes !== 'undefined' && eventTargetTypes.length && !character.rip) {
      var selected=combatTargetId && get_entity(combatTargetId);
      if (!selected || !selected.visible || selected.dead || selected.hp<=0 ||
          eventTargetTypes.indexOf(selected.mtype)<0 || !isAllowedTarget(selected)) return [];
      return [{id:String(selected.id),map:character.map,in:character.in,state:'event',role:'current',
        radius:Math.max(18,(Number(selected.awidth)||24)/2+4),visible:true}];
    }
    if(!groupedFarming() && farmingMode==='scatter' && !navigationIntent.cancelled && !character.rip) {
      var targets=[activeCombatTarget()].concat((partyPositions||[]).filter(function(p){return Date.now()+coordinatorClockOffset-p.seenAt<=3000 && !p.rip;}).map(function(p){return p.activeCombatTarget;}));
      var seen={};return targets.filter(function(t){if(!t||seen[t.id]||t.server!==reunionRealm()||t.map!==character.map||t.in!==character.in)return false;seen[t.id]=true;return true;})
        .map(function(t){var e=get_entity(t.id);return Object.assign({},t,{role:'current',state:'scatter',visible:!!(e&&e.visible&&!e.dead)});});
    }
    return groupedFarming() && groupedCombat && !navigationIntent.cancelled ? (groupedCombat.queue||[]).slice(0,3).map(function(t,index){
      var e=get_entity(t.id);return {id:t.id,map:t.map,in:t.in,server:t.server,role:['current','next','third'][index],state:t.state,radius:Math.max(18,(Number(e && e.awidth)||24)/2+4),visible:!!(e && e.visible && !e.dead && t.server===reunionRealm() && t.map===character.map && t.in===character.in)};
    }) : [];
  }
  function acceptQueue(next) {
    if(next && Number(next.resetAt||0)<Number(root.__partyCombatResetAt||0))return;
    if(next && groupedCombat && Number(next.seenAt)<Number(groupedCombat.seenAt))return;
    var before=groupedCombat && groupedCombat.target, after=next && next.target;
    if (before && after && before.id!==after.id && groupedCombat.pursuit && groupedCombat.pursuit.replacementKind==='closer-hunt') {
      cancelFarmApproach('Closer hunt monster'); cancelFightRoute(); cancelGroupRoute(); resetCombatMovement();
    }
    if(after && (!before || before.id!==after.id)) {
      cancelFightRoute(); cancelGroupRoute(); resetCombatMovement();
      var death=before && (next.deaths||[]).find(function(d){return d.id===before.id && d.map===before.map && d.in===before.in && d.server===before.server;});
      root.__partyQueueTiming={target:after.id,promotedAt:Date.now(),deathAt:death ? death.at-coordinatorClockOffset : null,firstAttackAt:null};
    }
    groupedCombat=root.__partyGroupedCombat=next || null;
    if(root.partyQueueClient && root.partyQueueClient.formation)root.partyQueueClient.formation.accept(next && next.formationRecovery);
  }
  function queueCandidates() {
    var diagnostic=root.__partyNomination={focus:monsterFocus.slice(),area:typeof partyLocation!=='undefined'&&partyLocation&&partyLocation.id,revision:navigationIntent.revision,rejected:{},eligible:[]};
    var encounter=root.__partyFarmingEngagement;
    if(encounter && !encounter.finished && !navigationIntent.cancelled) {
      var nominated=get_entity(encounter.target.id);
      return character.name===leader && nominated && nominated.visible && !nominated.dead && nominated.hp!==0 && !isExternallyClaimedMonster(nominated)
        ? [Object.assign(groupedEntityReport(nominated),{priority:monsterPriority(nominated),passiveRare:false})] : [];
    }
    var blocked=(typeof localTravelCommand==='function' && localTravelCommand()) || root.__partyTravelCombat && !navigationIntent.cancelled && root.__partyTravelCombat.revision >= (navigationIntent.revision || 0)?'travel intent':root.partyLootClient && root.partyLootClient.huntPending()?'departure loot':
      root.__partyConvoyDefense?'convoy defense':partyConvoyActive?'convoy travel':!groupedFarming()?'event or independent combat':
      navigationIntent.cancelled?'manual navigation':typeof combatRecoveryActive==='function' && combatRecoveryActive()?'death recovery':null;
    if(blocked){diagnostic.blocked=blocked;return [];}
    var eligible=Object.values(parent.entities||{}).filter(function(e){return e && e.type==='monster' && e.visible && !e.dead &&
      !(root.partyRoleRunner && root.partyRoleRunner.isKnownDead(e.id)) && e.mtype!=='fieldgen0' &&
      !isExternallyClaimedMonster(e) && !isPassingEncounter(e) && (passiveRareCandidate(e) || (character.name===leader || typeof huntCombatTarget!=='undefined' && e.mtype===huntCombatTarget) && e.mtype!=='tinyp' &&
      (monsterFocus.indexOf('all')>=0 || monsterFocus.indexOf(e.mtype)>=0) &&
      !(farmApproach.failed[e.id]>Date.now()));
    });
    var normal=selectFarmCandidates(eligible.filter(function(e){return !passiveRareCandidate(e);}));
    Object.values(parent.entities||{}).filter(function(e){return e && e.type==='monster' && e.visible && !e.dead;}).forEach(function(e){
      var reason=isExternallyClaimedMonster(e)?'external claim':farmApproach.failed[e.id]>Date.now()?'failed approach':
        !passiveRareCandidate(e)&&monsterFocus.indexOf('all')<0&&monsterFocus.indexOf(e.mtype)<0?'focus':
        !passiveRareCandidate(e)&&character.name!==leader&&!(typeof huntCombatTarget!=='undefined'&&e.mtype===huntCombatTarget)?'follower':
        !passiveRareCandidate(e)&&normal.indexOf(e)<0?'zone or target eligibility':null;
      if(reason)diagnostic.rejected[e.id]=reason;else diagnostic.eligible.push(e.id);
    });
    return eligible.filter(function(e){return passiveRareCandidate(e) || normal.indexOf(e)>=0;})
      .map(function(e){return Object.assign(groupedEntityReport(e),{priority:monsterPriority(e),passiveRare:passiveRareCandidate(e)});});
  }
  function passiveRareCandidate(target) {
    return !!(target && (passiveRareHunts[target.mtype] || target.mtype === 'phoenix' && monsterFocus.indexOf('phoenix')>=0));
  }
  function queueRetentions() {
    var at=root.__partyEntitiesObservedAt||0;
    return (groupedCombat&&groupedCombat.queue||[]).filter(function(t){return t.state==='planned'&&t.map===character.map&&t.in===character.in&&t.server===reunionRealm();}).map(function(t){
      var e=get_entity(t.id),reason=null;
      if(root.__partyNomination&&root.__partyNomination.blocked)reason='activity changed';
      else if(!e||!e.visible)reason='not visible';
      else if(e.dead||root.partyRoleRunner&&root.partyRoleRunner.isKnownDead(e.id))reason='confirmed death';
      else if(isExternallyClaimedMonster(e))reason='external claim';
      else if(farmApproach.failed[t.id]>Date.now())reason='failed approach';
      else if(!passiveRareCandidate(e)&&monsterFocus.indexOf('all')<0&&monsterFocus.indexOf(e.mtype)<0)reason='focus changed';
      else if(!(typeof huntCombatTarget!=='undefined' && e.mtype===huntCombatTarget && Math.hypot(e.x-character.x,e.y-character.y)<=monsterSearchRadius) &&
        !(root.__partyFarmingEngagement && root.__partyFarmingEngagement.target.id===t.id) && !passiveRareCandidate(e)&&!inFarmArea(e,partyLocation,150)&&
        !((!e.map||e.map===partyLocation.map)&&Math.hypot(e.x-partyLocation.x,e.y-partyLocation.y)<=monsterSearchRadius+150))reason='retention boundary';
      return Object.assign({},t,e&&e.visible?groupedEntityReport(e):{},{at:at,eligible:!reason,reason:reason});
    });
  }
  function queueReport() {
    return {name:character.name,rareObservation:rareObservationReport(),map:character.map,in:character.in,server:reunionRealm(),x:character.x,y:character.y,hp:character.hp,max_hp:character.max_hp,lastDeath:lastDeathInfo,rip:!!character.rip,
      combatSelection:Object.assign({},combatSelection,{runtimeId:convoyRuntimeId,target:groupedNomination()}),
      groupedCombat:{formationRecovery:root.partyQueueClient && root.partyQueueClient.formation ? root.partyQueueClient.formation.report() : undefined,approach:groupedApproachReport(),pursuitAck:groupedCombat && groupedCombat.pursuit && groupedCombat.pursuit.revoking || null,lootPending:!!(root.partyLootClient && root.partyLootClient.huntPending()),reportedAt:Date.now()+coordinatorClockOffset,protocol:4,observationAt:root.__partyEntitiesObservedAt||0,passingEncounters:passingEncounterReport(),passingAcknowledgement:root.partyQueueClient && root.partyQueueClient.passingAcknowledgement && root.partyQueueClient.passingAcknowledgement(),returnDefense:returnDepartureDefense(),currentAttackers:currentTravelAttackers(),currentAttackersAt:travelObservationAt(),travelCommand:localTravelCommand(),epoch:root.__partyCombatResetAt||0,claims:queueClaims(),candidates:queueCandidates(),retentions:queueRetentions(),evidence:root.partyQueueClient ? root.partyQueueClient.reportEvidence(fightDeaths) : [],deaths:fightDeaths,
        threats:groupedThreatReports(),sightings:groupedSightings(),ack:groupedAcknowledgement(),queueAck:groupedCombat && groupedCombat.queueRevision,
        anchorVisible:groupedAnchorVisible(),state:groupedCombat}};
  }
  function acceptCombatControl(state) {
    if (Array.isArray(state.passingEncounters) && (!state.serverNow || state.serverNow >= (root.__partyPassingControlAt || 0))) {
      root.__partyPassingControlAt = state.serverNow || 0;
      var passingNow = Date.now() + coordinatorClockOffset;
      var retainedPassing = {};
      peerPassingEncounters.concat(state.passingEncounters).forEach(function(e) {
        var key = passingKey(e), old = retainedPassing[key];
        if (passingNow-e.at<60000 && (!old || old.at<=e.at)) retainedPassing[key]=e;
      });
      peerPassingEncounters = parent.__partyPeerPassingEncounters = Object.values(retainedPassing).slice(-128);
    }
    if (typeof acceptRareCombatControl === 'function') acceptRareCombatControl(state);
    if(!state.serverNow || state.serverNow >= (root.__partyTravelCombatAt || 0))
      root.__partyFarmingEngagement=state.convoySignal && state.convoySignal.farmingEngagement || null;
    if (Object.prototype.hasOwnProperty.call(state, "travelCombat") &&
        (!state.serverNow || state.serverNow >= (root.__partyTravelCombatAt || 0))) {
      var beforeTravel = root.__partyTravelCombat;
      root.__partyTravelCombat = state.travelCombat;
      root.__partyTravelCombatAt = state.serverNow || root.__partyTravelCombatAt || 0;
      if (state.travelCombat && (!beforeTravel || beforeTravel.id !== state.travelCombat.id || beforeTravel.revision !== state.travelCombat.revision)) {
        combatTargetId = null;
        if (root.partyRoleRunner) root.partyRoleRunner.resetTargeting();
        cancelFarmApproach("Travel owns destination"); cancelFightRoute(); cancelGroupRoute();
      }
    }
    if(state.convoySignal && state.convoySignal.phase==='defending')interruptConvoyForDefense(state.convoySignal.id,state.convoySignal.epoch);
    var at=Math.max(Number(state.combatResetAt || state.combatResetByCharacter && state.combatResetByCharacter[character.name] || 0),
      Number(state.groupedCombat && state.groupedCombat.resetAt || 0));
    if(at<Number(root.__partyCombatResetAt||0))return;
    if (at>Number(root.__partyCombatResetAt||0)) {
      root.__partyCombatResetAt=at;
      groupedCombat=root.__partyGroupedCombat=null;
      combatTargetId=null;publishCombatSelection(null,true);
      if(root.partyRoleRunner && root.partyRoleRunner.resetTargeting)root.partyRoleRunner.resetTargeting();
      cancelFarmApproach('Targeting queue reset');cancelFightRoute();cancelGroupRoute();
      farmApproach.failed={};farmApproach.searchAt=0;
    }
    root.__partyCombatRecovery=state.combatRecovery||null;
  }
  function combatRecoveryActive() {
    var r=root.__partyCombatRecovery;
    return !!(r && r.names.indexOf(character.name)>=0 && ['complete','cancelled','returning-to-farm'].indexOf(r.phase)<0 && !eventTargetTypes.length && !joinedEvent);
  }
  function queueClaims() {
    if (!groupedFarming()) return [];
    var watched=(groupedCombat && groupedCombat.queue || []).concat(groupedCombat && groupedCombat.claims || []);
    return Object.values(parent.entities || {}).filter(function(e) {
      return e && e.type==='monster' && e.visible && !e.dead && e.hp>0 && watched.some(function(t) {
        return t.id===String(e.id) && t.map===character.map && t.in===character.in && t.server===reunionRealm();
      });
    }).map(function(e) {
      return {id:String(e.id),map:character.map,in:character.in,server:reunionRealm(),
        at:Date.now()+coordinatorClockOffset,external:isExternallyClaimedMonster(e)};
    });
  }
  var approachObservation = null;
  function groupedApproachReport() {
    var t=groupedCombat && groupedCombat.target, p=root.partyCombatPosition || {}, now=Date.now()+coordinatorClockOffset;
    if(!t)return null;
    var identity=JSON.stringify([t.server,t.map,t.in,t.id]);
    var prior=approachObservation, displacement=prior && prior.identity===identity ? Math.hypot(character.x-prior.x,character.y-prior.y) : 0;
    approachObservation={identity:identity,x:character.x,y:character.y};
    var entity=get_entity(t.id), recovery=formationState.recovery, point=recovery && recovery.point;
    var active=groupedFresh() && !navigationIntent.cancelled && !partyConvoyActive && !convoyTraveling &&
      !character.rip && !eventTraveling && !joinedEvent && !root.sharedRoutine.isOccupied() &&
      !(groupedCombat.recovering || []).length && p.target===t.id;
    return {target:identity,at:now,active:!!active,visible:!!(entity && entity.visible && !entity.dead),
      intent:combatDistance(t)>Number(character.range || 0) || !(entity && entity.visible && !entity.dead) || Number(p.coverageDeficit)>0 ? 'approach':'hold',moving:!!character.moving,displacement:displacement,
      deficit:Math.max(0,combatDistance(t)-Number(character.range || 0)),coverage:Number(p.coverageDeficit)||0,
      blocked:p.constraint || (String(p.reason || "").indexOf("movement rejected")===0 ? p.reason : null),destination:kiteState.destination || null,issuedAt:kiteState.lastMoveAt,
      waypoint:point ? {key:JSON.stringify([identity,point.x,point.y]),remaining:Math.hypot(character.x-point.x,character.y-point.y)} : undefined};
  }
  function groupedNomination() {
    var target = combatSelection.id && get_entity(combatSelection.id);
    return target && target.visible && !target.dead && !isExternallyClaimedMonster(target) ?
      { id: target.id, mtype: target.mtype, map: character.map, in: character.in, x: target.x, y: target.y } : null;
  }
  function groupedAcknowledgement() {
    if (!groupedFarming() || !groupedFresh() || !groupedCombat.selection || !groupedCombat.target) return null;
    // Acknowledge receipt of the lock, not visibility of its entity.
    return groupedCombat.protocol === 4 ? groupedCombat.selection : null;
  }
  function groupedAnchorVisible() {
    if (!groupedCombat || !groupedCombat.anchor) return false;
    if (groupedCombat.anchor.name === character.name) return true;
    var anchor = get_player(groupedCombat.anchor.name);
    return !!(anchor && anchor.visible && anchor.map === character.map && anchor.in === character.in);
  }
  function groupedCovered() {
    if (!groupedFresh() || !groupedCombat.anchor) return false;
    var anchor = get_player(groupedCombat.anchor.name) || groupedCombat.anchor;
    if (groupedCombat.anchor.name === character.name) anchor = character;
    return anchor.map === character.map && anchor.in === character.in &&
      Math.hypot(character.x-anchor.x,character.y-anchor.y) <= groupedCombat.range;
  }
  function groupedAttackAllowed(target) {
    if(root.partyQueueClient && root.partyQueueClient.formation && root.partyQueueClient.formation.blocks())return false;
    if (travelCombatActive() && !departureTargetEngaged(target)) return false;
    if(root.partyLootClient && root.partyLootClient.huntPending() && !departureTargetEngaged(target))return false;
    if(!groupedFarming())return true;
    if(!target || !groupedCombat || groupedCombat.protocol!==4 || !groupedCombat.target || groupedCombat.target.id!==target.id)return false;
    if(groupedCombat.target.map!==character.map || groupedCombat.target.in!==character.in || groupedCombat.target.server!==reunionRealm())return false;
    if(groupedCombat.target.state==='engaged')return true;
    if(groupedCombat.pursuit && groupedCombat.pursuit.revoking)return false;
    if(!groupedFresh() || !groupedCombat.committed)return false;
    return !Object.values(parent.entities||{}).some(function(e){return e && e.visible && !e.dead && e.type==='monster' && e.id!==target.id && isAttackingPartyMember(e);}) || groupedCombat.target.state==='pending';
  }

  var groupRegroup = { key: null, distance: Infinity, progressAt: 0, attempts: 0, retryAt: 0, route: null };
  var groupApproachPending = false, groupApproachRetryAt = 0;
  var groupMovementLog = { key: null, at: 0 };
  function logGroupMovement(key, message) {
    if (groupMovementLog.key === key && Date.now()-groupMovementLog.at < 15000) return;
    groupMovementLog = { key: key, at: Date.now() };
    game_log(message, "#51D2E1");
  }
  function requestGroupApproach(destination) {
    if (!groupedFarming() || !groupedCombat) return false;
    if (partyConvoyActive || convoyTraveling) return true;
    if (character.name !== leader || !groupedCovered() || groupApproachPending || Date.now()<groupApproachRetryAt) return true;
    groupApproachPending=true;
    request("/grouped-approach", {method:"POST",body:{character:character.name, key:groupedCombat.key,
      navigationRevision:navigationIntent.revision, selection:groupedCombat.selection,
      location:{map:destination.map,x:destination.x,y:destination.y}}})
      .then(function () { logGroupMovement("approach", "Group path recovery: convoy to " + destination.map + " [" + Math.round(destination.x) + ", " + Math.round(destination.y) + "]"); })
      .catch(function (error) {
        root.__partyNavigationDetail="Group approach held: "+String(error.message || error);
        logGroupMovement("approach-held", root.__partyNavigationDetail);
      })
      .finally(function () {groupApproachPending=false;groupApproachRetryAt=Date.now()+3000;});
    return true;
  }
  function cancelGroupRoute() {
    var route = groupRegroup.route;
    groupRegroup.route = null;
    if (route && typeof smart !== "undefined" && smart.on_done === route.onDone) {
      try { Promise.resolve(stop("smart")).catch(function () {}); } catch (_) {}
    }
  }
  var fightRecovery = {key:null,startedAt:0,stageAt:0,stage:0,progressAt:0,distance:Infinity,attempts:0,retryAt:0,route:null};
  function cancelFightRoute() {
    var route=fightRecovery.route; fightRecovery.route=null;
    if(route && typeof smart!=="undefined" && smart.on_done===route.onDone) {
      try { Promise.resolve(stop("smart")).catch(function(){}); } catch(_) {}
    }
  }
  function groupedFightMovement() {
    var fight=groupedCombat.target, now=Date.now(), entity=fight && get_entity(fight.id);
    cancelFightRoute();cancelGroupRoute();
    if(!fight)return false;
    if(fight.map!==character.map || fight.in!==character.in || fight.server!==reunionRealm()) {
      cancelFarmApproach("shared target is in another instance");
      root.partyCombatPosition={at:now,mode:"fight-recovery",movementOwner:"group",reason:"Shared target is in another instance; waiting for authorized farm return"};return true;
    }
    if(entity && entity.visible && !entity.dead) {
      if(root.partyQueueClient)root.partyQueueClient.sight.reset();
      return false; // Visible but outside weapon range uses the ordinary approach.
    }
    cancelFarmApproach("local visibility recovery owns movement");
    if(!root.partyQueueClient){root.partyCombatPosition={at:now,mode:"fight-recovery",reason:"Waiting for local visibility recovery runtime; target retained"};return true;}
    var prior=root.__partyTargetLastVisible;
    var remembered=prior && prior.id===fight.id && prior.map===character.map && prior.in===character.in ? prior : null;
    var allies=(groupedCombat.observers||[]).filter(function(p){return p.name!==character.name && p.map===character.map && p.in===character.in && p.server===reunionRealm() && Date.now()+coordinatorClockOffset-p.seenAt<3000;});
    if(groupedFresh() && allies.length && formationMove(fight))return true;
    return root.partyQueueClient.sight.tick(fight.id,fight,remembered,allies);
  }
  function groupedMovement() {
    if(convoyTraveling && !convoyTraveling.defensePaused)return true;
    if(root.partyQueueClient && root.partyQueueClient.formation && root.partyQueueClient.formation.movement())return true;
    if (groupedDefensiveTarget() && !navigationIntent.cancelled && !character.rip && !root.sharedRoutine.isOccupied()) {
      cancelGroupRoute(); cancelFightRoute(); cancelFarmApproach("defending visible party attackers");
      return false;
    }
    // The coordinator announces ownership before the local command arrives.
    // Never stop or reverse that route while waiting for our command.
    if ((partyConvoyActive || convoyTraveling) && !root.__partyFarmingEngagement) { cancelGroupRoute(); cancelFightRoute(); return true; }
    if (!groupedFarming() || navigationIntent.cancelled || character.rip || root.sharedRoutine.isOccupied() ||
        typeof rareActive === "function" && rareActive() && rareControlState.kind !== "encounter") { cancelGroupRoute(); cancelFightRoute(); return false; }
    if (!groupedCombat) {cancelFightRoute();return false;}
    if (groupedCombat.fights && groupedCombat.fights.length || groupedCombat.target &&
        passiveRareCandidate(groupedCombat.target)) return groupedFightMovement();
    cancelFightRoute();
    var now = Date.now(), fresh = groupedFresh(), anchor = fresh && groupedCombat.anchor;
    var key = groupedCombat.key + ":" + navigationIntent.revision;
    if (key !== groupRegroup.key) {
      cancelGroupRoute(); groupRegroup = { key: key, distance: Infinity, progressAt: now, attempts: 0, retryAt: 0, route: null };
    }
    var covered = fresh && groupedCovered();
    var visible = anchor && (anchor.name === character.name || groupedAnchorVisible());
    var samePlace = anchor && anchor.map === character.map && anchor.in === character.in;
    var separated = anchor && (!samePlace || (!visible || groupedCombat.formationRecovery) && Math.hypot(character.x-anchor.x,character.y-anchor.y) > Math.max(10,groupedCombat.range-10));
    var recovering = groupedCombat.recovering && groupedCombat.recovering.indexOf(character.name) >= 0;
    if (fresh && (!separated && !recovering || covered && visible) && !groupedCombat.formationRecovery) {
      cancelGroupRoute();
      var nominated=groupedCombat.target;
      if(nominated && nominated.state==='planned' && !(groupedCombat.recovering || []).length &&
          nominated.server===reunionRealm() && nominated.map===character.map && nominated.in===character.in) {
        var local=get_entity(nominated.id);
        var sight=(groupedCombat.observers || []).some(function(o){return o.server===reunionRealm() &&
          o.map===character.map && o.in===character.in && now+coordinatorClockOffset-o.seenAt<=3000;});
        cancelFarmApproach("coordinated target approach owns movement");
        if(!groupedCombat.ready)return holdFormation(nominated,"waiting for ready party reports");
        if(local && local.visible && !local.dead || sight) return formationMove(local && local.visible && !local.dead ? local : nominated);
        holdFormation(nominated,"missing fresh target visibility");
        return true;
      }
      return false;
    }
    cancelFarmApproach("group cohesion owns movement");
    var reason = fresh ? groupedCombat.blockers.join("; ") : "waiting for fresh group state";
    root.partyCombatPosition = { at: now, mode: "group-regrouping", movementOwner: "group", reason: reason,
      priest: groupedCombat.priest, healingRange: groupedCombat.range };
    // Do not drag an endangered character into a pathfinding wait.
    if (root.sharedRoutine.defensiveFormationMove()) { cancelGroupRoute(); return true; }
    if (!anchor || anchor.server !== reunionRealm() || groupedCombat.blockers.some(function (reason) { return reason.indexOf(": manual navigation") >= 0; })) {
      cancelGroupRoute(); return true;
    }
    var live = anchor.name === character.name ? character : get_player(anchor.name);
    if (live && live.visible) anchor = Object.assign({}, anchor, {x:live.x,y:live.y});
    var same = anchor.map === character.map && anchor.in === character.in;
    var dist = same ? Math.hypot(character.x-anchor.x,character.y-anchor.y) : Infinity;
    var inner = Math.max(10,groupedCombat.range-10);
    if (anchor.name === character.name || dist <= inner) {
      cancelGroupRoute();
      if (character.moving) { try { Promise.resolve(stop("move")).catch(function () {}); } catch (_) {} }
      return false;
    }
    if (dist < groupRegroup.distance-8) { groupRegroup.distance=dist; groupRegroup.progressAt=now; }
    var route=groupRegroup.route;
    if (route) {
      if (smart.on_done !== route.onDone || now-route.at >= 30000) {
        cancelGroupRoute(); groupRegroup.retryAt=now+[5000,15000,30000][Math.min(2,groupRegroup.attempts-1)];
      } else return true;
    }
    if (same && now-groupRegroup.progressAt < 3000) {
      var length=Math.min(Number(character.speed || 40)*0.6, Math.max(1,dist-inner+5));
      var point={x:character.x+(anchor.x-character.x)*length/dist,y:character.y+(anchor.y-character.y)*length/dist};
      var waypoint = groupRegroup.waypoint;
      if (waypoint && Math.hypot(character.x-waypoint.x,character.y-waypoint.y) < 8) waypoint = null;
      if (!waypoint) {
        var heading = Math.atan2(anchor.y-character.y,anchor.x-character.x);
        var offsets = [0, Math.PI/6, -Math.PI/6, Math.PI/3, -Math.PI/3, Math.PI/2, -Math.PI/2];
        for (var i=0;i<offsets.length;i++) {
          point={x:character.x+Math.cos(heading+offsets[i])*length,y:character.y+Math.sin(heading+offsets[i])*length};
          if (can_move_to(point.x,point.y) && safeCombatPoint(point,null)) { waypoint=point; break; }
        }
        groupRegroup.waypoint=waypoint;
      }
      if (waypoint && can_move_to(waypoint.x,waypoint.y) && safeCombatPoint(waypoint,null)) {
        Promise.resolve(move(waypoint.x,waypoint.y)).catch(function () {}); return true;
      }
    }
    if (now-groupRegroup.progressAt < 3000 || now<groupRegroup.retryAt) return true;
    if (groupRegroup.attempts >= 3) {
      root.partyCombatPosition.reason="regroup route failed after three attempts; holding new pulls"; return true;
    }
    groupRegroup.attempts++;
    root.partyCombatRoutes=root.partyCombatRoutes || {regroup:0,approach:0};root.partyCombatRoutes.regroup++;
    logGroupMovement("regroup-route-"+groupRegroup.attempts, "Regroup path " + groupRegroup.attempts + "/3 toward " + anchor.name + ": " + reason);
    route={at:now,onDone:null}; groupRegroup.route=route;
    try {
      var path=smart_move({map:anchor.map,in:anchor.in,x:anchor.x,y:anchor.y}); route.onDone=smart.on_done;
      Promise.resolve(path).catch(function (error) {
        root.__partyNavigationDetail="Regroup route failed: "+String(error.reason || error.message || error);
      }).finally(function () {
        if (groupRegroup.route===route) { groupRegroup.route=null; groupRegroup.retryAt=Date.now()+[5000,15000,30000][Math.min(2,groupRegroup.attempts-1)]; }
      });
    } catch (_) { groupRegroup.route=null; groupRegroup.retryAt=now+5000; }
    return true;
  }
  function leaderLockAllows(target) {
    if(!groupedFarming())return true;
    return !!(target && groupedCombat && groupedCombat.protocol===4 && groupedCombat.target &&
      groupedCombat.target.id===target.id && groupedCombat.target.map===character.map &&
      groupedCombat.target.in===character.in && groupedCombat.target.server===reunionRealm());
  }
  function publishCombatSelection(target, clear) {
    if (character.name !== (typeof groupedCombat !== "undefined" && groupedCombat && groupedCombat.protocol === 4 ? groupedCombat.targetLeader : leader)) return;
    if (unfinishedFight()) return; // Only coordinator death evidence releases a fight.
    if (!target && !clear) return; // Missing from view is not a new selection.
    var id = target && target.id || null, map = target ? character.map : null;
    if (combatSelection.id !== id || combatSelection.map !== map) {
      combatSelection = { id: id, map: map, revision: combatSelection.revision + 1 };
    }
  }

  function isAllowedTarget(target, huntTravelCommand, diagnostic) {
    function reject(reason) { if (diagnostic) diagnostic.reason = reason; return false; }
    var huntTravel = huntTravelCommand && huntTravelCommand.purpose === "monster-hunt" &&
      huntTravelCommand.combatHandoffAllowed === true && huntTravelCommand.huntTarget === (target && target.mtype);
    huntTravel = huntTravel || !!(huntTravelCommand && ['', 'party-travel', 'farm-relocation', 'manual-monster-override'].indexOf(huntTravelCommand.purpose || '')>=0 && huntTravelCommand.combatHandoffAllowed === true);
    if (travelCombatActive() && !huntTravel && !departureTargetEngaged(target)) return reject("travel owns combat");
    if(typeof root!=='undefined' && root.partyLootClient && root.partyLootClient.huntPending() &&
      target && target.type==='monster' && !isAttackingPartyMember(target))return reject("hunt loot pending");
    if (!target) return reject("missing target");
    if (isPassingEncounter(target)) return reject("passing attack owns this encounter");
    if (typeof combatRecoveryActive==='function' && combatRecoveryActive() &&
        (root.__partyCombatRecovery.phase!=='finishing' || !(root.__partyCombatRecovery.targets||[]).some(function(t){
          return t.id===target.id && t.map===character.map && t.in===character.in && t.server===reunionRealm();
        }))) return reject("combat recovery owns target");
    if (typeof root !== "undefined" && root.partyRoleRunner && root.partyRoleRunner.isKnownDead && root.partyRoleRunner.isKnownDead(target.id)) return reject("confirmed death");
    if (target.mtype === "fieldgen0") return reject("excluded monster");
    // Acquisition nominates a new target; only actual combat requires the group selection lock.
    // An attack already pending or engaged must still finish before another hunt pull.
    if (huntTravel && typeof unfinishedFight === "function" && unfinishedFight()) return reject("unfinished group fight");
    if (!huntTravel && typeof leaderLockAllows === "function" && !leaderLockAllows(target)) return reject("group target lock");
    if (target.mtype === "tinyp" && (typeof rareTarget !== "function" || !rareTarget() || rareTarget().id !== target.id)) return reject("rare target policy");
    if (typeof rareTarget === "function" && rareTarget() && rareTarget().id === target.id) return true;
    if (target.type === "character") return validAbtestingOpponent(target);
    if (target.type !== "monster" || isExternallyClaimedMonster(target)) return reject("external claim or invalid entity");
    if (huntTravel && farmApproach.failed[target.id]>Date.now()) return reject("failed approach cooldown");
    if (typeof passiveRareCandidate === "function" && passiveRareCandidate(target)) return true;
    if (isAttackingPartyMember(target)) return true;
    if(typeof root!=='undefined' && root.__partyFarmingEngagement && root.__partyFarmingEngagement.target.id===target.id) return true;
    // Farm boundaries govern new pulls. The exact unfinished target must stay
    // eligible after it wanders out, or the lock and selector deadlock.
    if (typeof unfinishedFight === "function" && unfinishedFight() &&
        groupedCombat.target && groupedCombat.target.id === target.id &&
        groupedCombat.target.map === character.map && groupedCombat.target.in === character.in &&
        groupedCombat.target.server === reunionRealm()) return true;
    var nearbyHunt = typeof huntCombatTarget !== "undefined" && target.mtype === huntCombatTarget &&
      Math.hypot(target.x-character.x,target.y-character.y)<=monsterSearchRadius;
    if (!huntTravel && !nearbyHunt && character.map !== "goobrawl" && !activeCombatEvent() && !joinedEvent && !isPartyThreat(target) &&
        (!(inFarmArea(target, partyLocation, target.id === combatTargetId && target.id === lastAttackTarget && Date.now()-lastAttackAt<5000 ? 150 : 0) || inFarmRadius(target) || typeof queueRetentions==='function' && queueRetentions().some(function(t){return t.id===target.id && t.eligible;})) || farmApproach.failed[target.id]>Date.now())) return false;
    var convoyThreat = convoyTraveling && partyThreats.some(function (threat) {
      return threat && threat.id === target.id;
    });
    return !!target && (huntTravel && !(farmApproach.failed[target.id]>Date.now()) || target.id === combatTargetId || convoyThreat || isPartyThreat(target) ||
      (scatterBreakTarget && target.id === scatterBreakTarget.id) ||
      (character.map === "goobrawl" ? ["rgoo","bgoo","goo"] : eventTargetTypes).indexOf(target.mtype) >= 0 ||
      (farmingMode === "scatter" && partyFarmingMonsterType && target.mtype === partyFarmingMonsterType) ||
      (followLeader && leaderTarget && target.id === leaderTarget.id) ||
      monsterFocus.indexOf("all") >= 0 ||
      monsterFocus.indexOf(target.mtype) >= 0);
  }

  function sameEventTeamMember(member) {
    return !isLiveAbtesting() || !!(member && member.team && member.team === eventTeam(character));
  }

  function monsterPriority(target) {
    var rule = target && passiveHunting.rules[target.mtype];
    if (rule && rule.enabled) return rule.priority;
    if (target && target.mtype === "tinyp") return 101;
    if (target && ["phoenix", "goldenbat", "cutebee", "hen", "rooster"].indexOf(target.mtype) >= 0 &&
        (passiveRareCandidate(target) || typeof rareActive === "function" && rareActive())) return 100;
    return target && Number.isFinite(Number(monsterPriorities[target.mtype]))
      ? Number(monsterPriorities[target.mtype]) : 50;
  }

  function calculateFarmingMode() {
    if(root.__partyConvoyDefense)return 'default';
    if (combatRecoveryActive()) return 'default';
    if (typeof rareActive === "function" && rareActive()) return "default";
    if (Date.now() < farmingModeResetUntil || character.ctype === "merchant" || eventTargetTypes.length || joinedEvent ||
        monsterFocus.indexOf("all") >= 0 || !monsterFocus.length) {
      farmingMonsterType = null;
      return "default";
    }
    var current = combatTargetId && get_entity(combatTargetId);
    var activeType = current && !current.dead ? current.mtype : null;
    if (!activeType) {
      var visible = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
        .filter(function (target) {
          return target && target.type === "monster" && target.visible && !target.dead &&
            monsterFocus.indexOf(target.mtype) >= 0 &&
            inFarmArea(target,partyLocation);
        }).sort(function (a, b) {
          return monsterPriority(b) - monsterPriority(a) ||
            Math.hypot(a.x - character.x, a.y - character.y) -
            Math.hypot(b.x - character.x, b.y - character.y);
        });
      activeType = visible[0] && visible[0].mtype ||
        (monsterFocus.length === 1 ? monsterFocus[0] : lastFarmingMonsterType);
    }
    if (activeType) {
      lastFarmingMonsterType = activeType;
      root.__partyLastFarmingMonsterType = activeType;
    }
    farmingMonsterType = activeType || null;
    if (farmingPolicy === "scatter") return "scatter";
    if (farmingPolicy === "default") return "default";
    return activeType && scatterMonsterTypes[activeType] ? "scatter" : "default";
  }

  function engagedMonster() {
    var current = combatTargetId && get_entity(combatTargetId);
    if (current && !current.dead && isAllowedTarget(current)) return current;
    combatTargetId = null;
    var attackers = Object.keys(parent.entities || {}).map(function (id) {
      return parent.entities[id];
    }).filter(function (entity) {
      return entity && entity.type === "monster" && !entity.dead && entity.target === character.name && isAllowedTarget(entity);
    });
    attackers.sort(function (a, b) {
      var adx = a.x - character.x, ady = a.y - character.y;
      var bdx = b.x - character.x, bdy = b.y - character.y;
      return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
    });
    if (attackers[0]) combatTargetId = attackers[0].id;
    return attackers[0] || null;
  }

  async function afterCombat(action, label) {
    var navigationOwner = farmingTravelToken;
    departurePending = true;
    var travel = travelCombatActive();
    function waiting() { return travel ? getNearestPartyAttacker() : engagedMonster(); }
    var target = waiting();
    if (target) game_log("Finishing combat before " + label, "#51D2E1");
    try {
      while (waiting()) {
        if (navigationOwner && navigationOwner.cancelled) return;
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
      }
      combatTargetId = null;
      if (navigationOwner && navigationOwner.cancelled) return;
      return await action();
    } finally {
      departurePending = false;
    }
  }

  function inFarmArea(target, location, margin) {
    location = location || partyLocation;
    if (!location) return true;
    if (location.in != null && String(target.in == null ? target.map : target.in) !== String(location.in)) return false;
    if (root.partyFarmingZones) return root.partyFarmingZones.contains(location, target, margin || 0, monsterSearchRadius);
    return (!target.map || target.map === location.map) && Math.hypot(target.x-location.x,target.y-location.y)<=monsterSearchRadius+(margin||0);
  }

  function departureTargetEngaged(target) {
    if(!target || !target.visible || target.dead || target.hp === 0 || root.partyRoleRunner && root.partyRoleRunner.isKnownDead(target.id))return false;
    var deaths = typeof groupedCombat !== 'undefined' && groupedCombat && groupedCombat.deaths || [];
    if(deaths.some(function(d){return String(d.id)===String(target.id) && d.map===character.map &&
      String(d.in==null?d.map:d.in)===String(character.in==null?character.map:character.in) && d.server===reunionRealm();}))return false;
    if(isAttackingPartyMember(target))return true;
    return false;
  }
  function departureCombatPending() {
    return Object.values(parent.entities||{}).some(function(e){return e && e.type==='monster' && departureTargetEngaged(e);});
  }
  function inFarmRadius(target) {
    return !partyLocation || (!target.map || target.map===partyLocation.map) &&
      Math.hypot(target.x-partyLocation.x,target.y-partyLocation.y)<=monsterSearchRadius;
  }
  function selectFarmCandidates(targets) {
    if (typeof huntCombatTarget !== "undefined" && huntCombatTarget) return targets.filter(function(t) {
      return t.mtype===huntCombatTarget && (!t.map || t.map===character.map) &&
        (t.in===undefined || t.in===character.in) && Math.hypot(t.x-character.x,t.y-character.y)<=monsterSearchRadius;
    });
    if(root.partyFarmingZones && root.partyFarmingZones.candidates)return root.partyFarmingZones.candidates(partyLocation,targets,monsterSearchRadius);
    var bounded=targets.filter(function(t){return inFarmArea(t,partyLocation);});
    return bounded.length ? bounded : targets.filter(inFarmRadius);
  }
  var farmAreaEvidence = [], farmSeenMonsters = {}, farmAreaObserved = null, farmTravelPaused = false;
  function observeFarmHit(data) {
    if (!data || !(Number(data.damage)>0 || data.kill || data.dead)) return;
    var actorId = data.hid || data.actor, actor = actorId && get_entity(actorId);
    if (!actor || actor.type === "monster" || actor.npc || actorId === character.name || currentPartyList().indexOf(actorId)>=0) return;
    var target = get_entity(data.id || data.target) || farmSeenMonsters[data.id || data.target];
    if (!target || target.type !== "monster" || !inFarmArea(target, partyLocation)) return;
    var at = Date.now() + coordinatorClockOffset;
    farmAreaEvidence.push({key: JSON.stringify([actorId,data.id||data.target,data.damage,!!(data.kill||data.dead),Math.floor(at/500)]),
      actor: actor.name || actorId, id: data.id||data.target, mtype:target.mtype,map:character.map,x:target.x,y:target.y,
      at:at,kill:!!(data.kill||data.dead)});
    if(farmAreaEvidence.length>20)farmAreaEvidence.shift();
  }
  function farmCompetitionObservation() {
    if (!partyLocation || !partyLocation.id || !parent.socket || !parent.socket.connected) return null;
    var counts={}, players=[], party=currentPartyList();
    Object.keys(parent.entities || {}).forEach(function(id) {
      var e=parent.entities[id];
      if (!e || !e.visible || e.dead || e.rip || (e.map && e.map!==character.map) ||
          (e.in!==undefined && String(e.in)!==String(character.in)) || Math.hypot(e.x-character.x,e.y-character.y)>monsterSearchRadius) return;
      if (e.type==='monster' && e.hp>0) counts[e.mtype]=(counts[e.mtype]||0)+1;
      else if (e.type==='character' && !e.npc && e.name!==character.name && party.indexOf(e.name)<0) players.push(e.name || id);
    });
    return {at:Date.now()+coordinatorClockOffset,runtimeId:convoyRuntimeId,revision:navigationIntent.revision,
      areaId:partyLocation.id,map:character.map,in:String(character.in==null?character.map:character.in),
      server:String(parent.server_region||'')+String(parent.server_identifier||''),radius:monsterSearchRadius,monsters:counts,players:players};
  }
  function observeFarmArea() {
    farmSeenMonsters = {};
    Object.keys(parent.entities||{}).forEach(function(id) {
      var e=parent.entities[id]; if(e && e.visible && !e.dead && e.type==="monster")
        farmSeenMonsters[id]={id:id,type:"monster",mtype:e.mtype,map:character.map,x:e.x,y:e.y};
    });
    farmAreaObserved=null;
    if(root.partyFarmingZones && partyLocation && partyLocation.id && partyLocation.map===character.map) {
      var box=root.partyFarmingZones.bounds(partyLocation);
      if([[box[0],box[1]],[box[2],box[3]],[box[0],box[3]],[box[2],box[1]]].every(function(p){return Math.hypot(p[0]-character.x,p[1]-character.y)<=400;}))
        farmAreaObserved={id:partyLocation.id,at:Date.now()+coordinatorClockOffset};
    }
  }
  function visibleFocusedMonsterWithinRadius() {
    var allTypes = monsterFocus.indexOf("all") >= 0;
    var candidates = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
      .filter(function (entity) {
        return entity && entity.type === "monster" && entity.visible && !entity.dead &&
          (allTypes || monsterFocus.indexOf(entity.mtype) >= 0) && isAllowedTarget(entity);
      }).sort(function (a, b) {
        return Math.hypot(Number(a.x) - character.x, Number(a.y) - character.y) -
          Math.hypot(Number(b.x) - character.x, Number(b.y) - character.y);
      });
    return selectFarmCandidates(candidates)[0] || null;
  }

  function farmingTravelTarget(command) {
    var huntTravel = command && command.purpose === "monster-hunt" && command.combatHandoffAllowed === true && command.huntTarget;
    var farmTravel=command && ['', 'party-travel', 'farm-relocation', 'manual-monster-override'].indexOf(command.purpose || '')>=0 && command.combatHandoffAllowed===true;
    if (travelCombatActive() && !huntTravel && !farmTravel) return null;
    if (command && ["rare-hunt", "phoenix-patrol"].indexOf(command.purpose) >= 0) return null;
    var waypoint = command && command.location;
    if (!waypoint || command.combatHandoffAllowed === false || !huntTravel && !farmTravel && character.map !== waypoint.map) return null;
    if (huntTravel) return huntTravelTarget(command);
    var allTypes = monsterFocus.indexOf("all") >= 0;
    var candidates = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
      .filter(function (entity) {
        return entity && entity.type === "monster" && entity.visible && !entity.dead &&
          (entity.hp === undefined || entity.hp > 0) &&
          (!entity.map || entity.map === character.map) &&
          (entity.in === undefined || entity.in === character.in) &&
          (allTypes || monsterFocus.indexOf(entity.mtype) >= 0) &&
          isAllowedTarget(entity, farmTravel ? command : undefined) && (farmTravel ? Math.hypot(entity.x-character.x,entity.y-character.y)<=monsterSearchRadius : inFarmArea(entity, waypoint));
      });
    candidates.sort(function (a, b) {
      return monsterPriority(b) - monsterPriority(a) ||
        Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y);
    });
    if (farmingMode === "scatter") {
      var unassigned = candidates.filter(function (entity) {
        return !partyTargets.some(function (claimed) { return claimed.id === entity.id && entity.id !== combatTargetId; });
      });
      if (unassigned.length) candidates = unassigned;
    }
    return candidates[0] || null;
  }
  function convoyThreatActive(command) { return !!farmingTravelTarget(command); }

  function huntAcquisitionLog(command, target, reason, details, channel) {
    if (!command || !command.huntTarget || typeof queueCombatEvent !== "function") return;
    var now=Date.now(), key=channel || "scan", logs=command.huntAcquisitionLogs || (command.huntAcquisitionLogs={});
    var signature=JSON.stringify([target && target.id,reason]), previous=logs[key];
    if (previous && (key!=="response" && now-previous.at<2000 || previous.signature===signature && now-previous.at<10000)) return;
    logs[key]={at:now,signature:signature};
    queueCombatEvent("navigation", "Hunt acquisition: "+reason, Object.assign({
      convoyId:command.convoyId, epoch:command.epoch, commandId:command.id, huntTarget:command.huntTarget,
      navigationRevision:command.navigationRevision, destination:command.location && {map:command.location.map,x:command.location.x,y:command.location.y},
      position:{map:character.map,in:character.in,x:character.x,y:character.y}, searchRadius:monsterSearchRadius,
      candidate:target && {id:target.id,mtype:target.mtype,x:target.x,y:target.y},
      distance:target ? Math.hypot(target.x-character.x,target.y-character.y) : null,
    },details || {}),"hunt-acquisition:"+command.convoyId+":"+key);
  }
  function huntAcquisitionPause() {
    if (character.rip) return "character dead";
    if (typeof navigationIntent !== "undefined" && navigationIntent.cancelled) return "navigation cancelled";
    if (typeof escapeOwns === "function" && escapeOwns()) return "escape owns movement";
    if (typeof activeCombatEvent === "function" && activeCombatEvent() || typeof joinedEvent !== "undefined" && joinedEvent) return "event owns movement";
    return null;
  }
  function huntCandidateRejection(target, command) {
    if (!target.visible) return "not visible";
    if (target.dead || target.hp !== undefined && !(target.hp > 0)) return "monster dead";
    if (target.map && target.map!==character.map || target.in!==undefined && target.in!==character.in) return "different map or instance";
    if (!(Math.hypot(target.x-character.x,target.y-character.y)<=monsterSearchRadius)) return "outside search radius";
    var diagnostic={};
    if (!isAllowedTarget(target,command,diagnostic)) return diagnostic.reason || "target ineligible";
    if (typeof is_in_range === "function" && is_in_range(target)) return null;
    var approach=typeof combatApproachPoint === "function" ? combatApproachPoint(target) : target;
    return approach && typeof can_move_to === "function" && can_move_to(approach.x,approach.y) ? null : "attack position unreachable";
  }
  function huntTravelTarget(command) {
    if (command.combatHandoffAllowed === false || command.cause === "farming-conflict") return null;
    var paused=huntAcquisitionPause();
    if (paused) { huntAcquisitionLog(command,null,paused); return null; }
    var candidates=Object.values(parent.entities || {}).filter(function(t){return t && t.type==="monster" && t.mtype===command.huntTarget;});
    candidates.sort(function(a,b){return Math.hypot(a.x-character.x,a.y-character.y)-Math.hypot(b.x-character.x,b.y-character.y);});
    if (typeof farmingMode !== "undefined" && farmingMode === "scatter") {
      var unassigned=candidates.filter(function(t){return !(partyTargets || []).some(function(p){return p.id===t.id && t.id!==combatTargetId;});});
      candidates=unassigned.concat(candidates.filter(function(t){return unassigned.indexOf(t)<0;}));
    }
    var nearestReason=null, selected=null;
    for (var i=0;i<candidates.length;i++) {
      var reason=huntCandidateRejection(candidates[i],command);
      if (i===0) nearestReason=reason;
      if (!reason) {selected=candidates[i];break;}
    }
    huntAcquisitionLog(command,selected || candidates[0],selected ? "eligible candidate" : nearestReason || "no hunt monster observed");
    return selected;
  }

  function navigationDestinationLabel(owner, destination, label) {
    return owner + " -> " + (label || "destination") + " at " + destination.map +
      " (" + Math.round(Number(destination.x)) + ", " + Math.round(Number(destination.y)) + ")";
  }

  // Use the runner's ONE 80ms scheduler. Only a convoy's preparation is gated;
  // ordinary navigation and released routes run through the original function.
  function farmingEntryPoint(location) {
    if(!root.partyFarmingZones || !location || !location.shapes && !location.allOf)return location;
    var points=root.partyFarmingZones.searchPoints(location).filter(function(p){
      return typeof can_move!=="function" || can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:character.base});
    });
    points.sort(function(a,b){
      var origin=character.map===location.map?character:location;
      return Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y);
    });
    if(!points.length)throw new Error("No walkable entry point in selected farming zone");
    return points[0];
  }
  async function sharedPartyWalk(destination, activity, key, parentCommand, current) {
    if(character.name!==leader && !followLeader)return smart_move(destination);
    var revision=Number(navigationIntent.revision)||0,generation=runtimeGeneration;
    var body={character:character.name,runtimeId:convoyRuntimeId,navigationRevision:revision,
      destination:destination,activity:activity,key:String(key||activity),parentCommandId:parentCommand?parentCommand.id:0};
    root.__partyWalkSequence=(Number(root.__partyWalkSequence)||0)+1;
    body.token=convoyRuntimeId+":"+root.__partyWalkSequence;
    var deadline=Date.now()+180000,completed=false,requestFailures=0;
    root.__partySharedWalking=body;
    try {
      while(runtimeCurrent() && runtimeGeneration===generation && Number(navigationIntent.revision)===revision) {
        if(current && !current())throw new Error("Shared walking workflow changed");
        if(activity==="event") {
          var liveEvent=activeCombatEvent();
          if(!liveEvent || liveEvent.name!==key)throw new Error("event_not_live");
          // Join/teleport can finish before the boss entity arrives. Yield the
          // walking owner as soon as combat can acquire it, even while waiting
          // for the rest of the party or a coordinator route.
          if(nearestEventTarget())return;
        }
        if(Date.now()>deadline)throw new Error("Shared walking rendezvous timed out");
        var result;
        try {result=await request("/shared-travel",{method:"POST",timeout:3000,body:body});requestFailures=0;}
        catch(error){if(++requestFailures>=3)throw error;await new Promise(function(resolve){setTimeout(resolve,500);});continue;}
        if(result.error)throw new Error(result.error);
        if(result.phase==="complete"){completed=true;return;}
        if(result.phase==="failed")throw new Error(result.reason||"Shared walking failed");
        await new Promise(function(resolve){setTimeout(resolve,500);});
      }
      throw new Error("Shared walking superseded");
    } finally {
      if(root.__partySharedWalking===body)root.__partySharedWalking=null;
      if(!completed)request("/shared-travel",{method:"POST",timeout:3000,body:Object.assign({},body,{cancel:true})}).catch(function(){});
    }
  }
  function sharedConvoyPoint() {
    return {map:character.map,in:character.in,x:character.real_x,y:character.real_y};
  }
  function captureConvoyFailureContext(convoy, command) {
    try {
      if (convoy.failureContext) return;
      var signal = convoySignal, now = Date.now() + coordinatorClockOffset;
      var mono = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      var http = root.__partyConvoyHttp || {}, mismatches = [];
      var expected = {id:convoy.id,epoch:convoy.epoch,commandId:convoy.commandId,runtimeId:convoyRuntimeId};
      if (command.routeProtocol === 4) expected.routeVersion = command.routeVersion;
      if (signal) Object.keys(expected).forEach(function(field) {
        var actual = field === 'epoch' || field === 'commandId' ? Number(signal[field]) : signal[field];
        if (actual !== expected[field]) mismatches.push({field:field,expected:expected[field],received:signal[field]});
      });
      var expiry = signal && Number.isFinite(Number(signal.validUntil)) ? Math.max(0, Math.round(now - Number(signal.validUntil))) : null;
      var state = !signal ? 'missing' : mismatches.length ? 'identity mismatch' : expiry === null ? 'unknown' : Number(signal.validUntil) <= now ? 'expired' : 'matching';
      var age = function(at) { return typeof at === 'number' && Number.isFinite(at) && mono >= at ? Math.round(mono-at) : null; };
      var p = function(value) { return value ? {map:value.map,x:value.x,y:value.y} : null; };
      convoy.failureContext = {phase:convoy.phase,position:p(character),destination:p(command.location),
        convoyId:convoy.id,epoch:convoy.epoch,commandId:convoy.commandId,runtimeId:convoyRuntimeId,routeVersion:command.routeVersion,
        signal:{state:state,expiredByMs:expiry,mismatches:mismatches},lastStatusResponseAgeMs:age(http.responseAt),
        lastStatusFailure:http.failure ? {kind:http.failure.kind,durationMs:http.failure.durationMs,ageMs:age(http.failure.at)} : null};
    } catch (_) {}
  }
  function logConvoyFailureContext(context) {
    try {
      if (!context) { game_log('Convoy context: unknown', '#94a3b8'); return; }
      var text = function(value) { return value == null ? 'unknown' : String(value).replace(/[\r\n\t]/g,' ').slice(0,100); };
      var ms = function(value) { return value == null ? 'unknown' : text(value)+'ms'; };
      var point = function(value) { return value ? text(value.map)+' ('+text(Number.isFinite(value.x)?Math.round(value.x):null)+','+text(Number.isFinite(value.y)?Math.round(value.y):null)+')' : 'unknown'; };
      game_log('Convoy context: phase='+text(context.phase)+'; position='+point(context.position)+'; destination='+point(context.destination)+
        '; convoy='+text(context.convoyId)+'; epoch='+text(context.epoch)+'; command='+text(context.commandId)+'; runtime='+text(context.runtimeId)+'; route='+text(context.routeVersion), '#94a3b8');
      var signal = context.signal, failure = context.lastStatusFailure;
      var detail = signal.mismatches.map(function(m) { return m.field+' expected='+text(m.expected)+' received='+text(m.received); }).join(', ');
      game_log('Convoy signal: '+signal.state+(detail?' ['+detail+']':'')+'; expiry overrun='+ms(signal.expiredByMs)+
        '; last status response='+ms(context.lastStatusResponseAgeMs)+' ago; latest status failure='+
        (failure ? text(failure.kind)+' after '+ms(failure.durationMs)+' ('+ms(failure.ageMs)+' ago)' : 'unknown'), '#94a3b8');
    } catch (_) {}
  }
  function reloadConvoyGeometry(signal) {
    var repair=signal && signal.geometryReload, convoy=convoyTraveling;
    if (!repair || repair.runtimeId!==convoyRuntimeId || repair.deadline<Date.now()+coordinatorClockOffset || !convoy ||
        convoy.phase!=='held' || signal.id!==convoy.id || signal.epoch!==convoy.epoch || signal.commandId!==convoy.commandId ||
        navigationIntent.cancelled || convoy.navigationRevision!==navigationIntent.revision) return;
    if (parent.__partyGeometryReloaded===repair.id) return;
    parent.__partyGeometryReloaded=repair.id;
    var url=(parent.__partyServer || 'http://127.0.0.1:924')+'/CODE/adventure_land/universal-loader.js?t=';
    var bootstrap="$.ajax({url:"+JSON.stringify(url)+"+Date.now(),dataType:'text',cache:false}).then(function(source){(0,eval)(source);});";
    game_log('Reloading runtime once to repair shared-route geometry', '#f0b429');
    parent.setTimeout(function(){
      if(!runtimeCurrent())return;
      if(!parent.caracAL && repair.expected && Number(movement.identity.version)!==repair.expected.version && parent.location) {
        parent.location.reload();
        return;
      }
      if(!parent.caracAL && typeof parent.start_runner==='function')parent.start_runner('maincode',bootstrap);
      else (0,eval)(bootstrap);
    },0);
  }
  function sharedConvoyDistance(a,b) {
    if(a.map!==b.map || String(a.in==null?a.map:a.in)!==String(b.in==null?b.map:b.in))return Infinity;
    return Math.hypot(a.x-b.x,a.y-b.y);
  }
  function sharedConvoyIdentity(command) {
    return {character:character.name,convoyId:command.convoyId,epoch:Number(command.epoch),commandId:command.id,
      navigationRevision:Number(command.navigationRevision)||0,runtimeId:convoyRuntimeId,routeVersion:command.routeVersion};
  }
  function sharedMovementOptions(command) {
    return { shared: true, avoidLeave: !!command.avoidLeave, native: !!command.nativeFallback, speed: command.slowestSpeed,
      transitionComplete:function(destination) {
        if(convoyTraveling && convoyTraveling.commandId===command.id)convoyTraveling.transitionMap=destination.map;
      },
      compareTown: command.continuousReturn === 1 && !command.disableTown,
      town: command.purpose !== 'monster-hunt' || command.continuousReturn === 1 && !command.disableTown || command.phase === 'plan-return' && !!command.allowTown,
      townAttempt: command.continuousReturn !== 1 ? undefined : function(state, index, from, destination) {
        var c=convoyTraveling;
        if(!c || c.id!==command.convoyId || c.commandId!==command.id)return;
        c.townAttempt={round:[command.epoch,command.routeVersion,index].join(':'),map:from.map,state:state,destination:destination};
      },
      barrier: command.phase === 'plan-return' || command.routeVersion == null ? undefined : function(step, index, completed) {
        return request('/movement-barrier', {method:'POST',timeout:2000,body:Object.assign(sharedConvoyIdentity(command),{
          step:index, destination:step, completed:completed, ready:completed || ((command.continuousReturn === 1 || command.huntTarget) && !step.town || !departureCombatPending()) && (command.huntTarget || eligibleDepartureChests().length === 0) && (!step.town || can_use('use_town'))
        })}).then(function(result){return !!result.ready;});
      }
    };
  }
  function sharedConvoyGate() { return movement.gate; }
  async function sharedRendezvousSearch(convoy,rally,ownsConvoy,command) {
    var gate=sharedConvoyGate();
    var owner={tick:function(){
      if(!ownsConvoy())return;
      if(smart.moving && !smart.found && !smart.searching) {
        convoy.rendezvousSearches=(convoy.rendezvousSearches||0)+1;convoy.routeStarts++;
      }
      return gate.original();
    }};
    gate.owner=owner;
    try {await anniversaryWithTimeout(smart_move(rally,undefined,{town:!command || !command.disableTown}),120000,"Convoy rendezvous");}
    finally {if(gate.owner===owner)gate.owner=null;}
  }
  async function sharedConvoyRendezvous(convoy,command,ownsConvoy,phase) {
    phase("rendezvous");
    if(command.huntTarget) {
      sharedConvoyEngagement(convoy,command,ownsConvoy,phase);
      while(ownsConvoy() && convoy.handoffPending)await new Promise(function(resolve){setTimeout(resolve,80);});
      if(!ownsConvoy())return;
    }
    var rally=command.rally,deadline=Date.now()+120000;
    if(character.name===command.leader) {
      if(sharedConvoyDistance(sharedConvoyPoint(),rally)>1)throw new Error("Leader moved from planning origin");
    } else if(sharedConvoyDistance(sharedConvoyPoint(),rally)>12 || !can_move_to(rally.x,rally.y)) {
      if(Number.isFinite(sharedConvoyDistance(sharedConvoyPoint(),rally)) && can_move_to(rally.x,rally.y) && typeof xmove==="function")
        await anniversaryWithTimeout(xmove(rally.x,rally.y),120000,"Convoy direct rendezvous");
      else await sharedRendezvousSearch(convoy,rally,ownsConvoy,command);
    }
    while(ownsConvoy() && (character.moving || is_transporting(character) ||
        !(Number(character.speed)>0 && Number(character.speed)<=command.slowestSpeed+0.1))) {
      if(Date.now()>deadline)throw new Error("Rendezvous did not settle");
      await new Promise(function(resolve){setTimeout(resolve,80);});
    }
    if(!ownsConvoy())return;
    if(sharedConvoyDistance(sharedConvoyPoint(),rally)>55 || !can_move_to(rally.x,rally.y))
      throw new Error("Follower cannot connect to leader origin");
  }
  function sharedConvoyReusable(command,origin) {
    var saved=root.__partySharedRouteRemainder;
    if(!saved || saved.id!==command.convoyId || saved.revision!==Number(command.navigationRevision||0) ||
        saved.destinationKey!==JSON.stringify(command.location) || saved.runtimeId!==convoyRuntimeId)return null;
    if(!saved.plot.length || saved.transporting)return null;
    var first=saved.plot[0];
    if(first.town || first.transport || first.method === "leave" || first.map!==origin.map || !can_move_to(first.x,first.y))return null;
    return saved;
  }
  function sharedConvoyItinerary(command,origin) {
    var saved=root.__partyHuntRouteSegments;
    if(!saved || !command.returnLeg || saved.id!==command.convoyId || saved.runtimeId!==convoyRuntimeId ||
        saved.revision!==Number(command.navigationRevision||0))return null;
    var segment=saved.segments.find(function(s){return s.location.map===command.location.map &&
      Math.hypot(s.location.x-command.location.x,s.location.y-command.location.y)<1 &&
      s.origin.map===origin.map && Math.hypot(s.origin.x-origin.x,s.origin.y-origin.y)<=55;});
    if(!segment || !segment.plot.length)return null;
    var first=segment.plot[0];
    if(first.town || first.transport || first.method === "leave" || first.map!==origin.map || !can_move_to(first.x,first.y))return null;
    return {destination:segment.location,plot:segment.plot,source:"itinerary"};
  }
  function sharedConvoyEngagement(convoy,command,ownsConvoy,phase) {
    if(command.purpose === "monster-hunt" || command.combatHandoffAllowed===false || convoy.handoffPending || Date.now()<(convoy.handoffRetryAt||0))return;
    if(typeof farmingTravelTarget!=="function" || !command.huntTarget && typeof groupedFollower==="function" && groupedFollower())return;
    var target=farmingTravelTarget(command);
    var approach=target && typeof combatApproachPoint==="function"?combatApproachPoint(target):target;
    if(!target || !(typeof is_in_range==="function" && is_in_range(target) || approach && can_move_to(approach.x,approach.y)))return;
    convoy.handoffPending=true;
    if (command.huntTarget) huntAcquisitionLog(command,target,"requesting handoff",null,"request");
    request("/convoy-engage",{method:"POST",body:Object.assign(sharedConvoyIdentity(command),{
      target:{id:target.id,mtype:target.mtype,map:character.map,in:character.in,x:target.x,y:target.y}})}).then(function(result){
      if (command.huntTarget) huntAcquisitionLog(command,target,result && result.ok ? "handoff accepted" : "handoff rejected",{response:result && result.error,stillOwned:!!ownsConvoy()},"response");
      if(!ownsConvoy() || !result || !result.ok)return;
      if(command.huntTarget && result.location) {
        partyLocation=result.location; huntCombatTarget=command.huntTarget; partyConvoyActive=false;
        root.__partyTravelCombat=null; root.__partyTravelCombatAt=result.serverNow;
        root.__partyNavigationDetail=result.handoff==='temporary' ? 'Fighting encountered '+command.huntTarget+'; continuing to hunt area afterward' : 'Farming encountered hunt spawn';
      }
      convoy.engaged=true;phase("engaging-target");releaseConvoyCruise(convoy);if(convoy.detachRoute)convoy.detachRoute();
      if(typeof movement!=="undefined" && movement.combatHandoff)movement.combatHandoff();
      Promise.resolve(stop("smart")).catch(function(){});
      convoy.cancelled=true;convoyTraveling=null;combatTargetId=target.id;
      if(typeof publishCombatSelection==="function")publishCombatSelection(target,false);
    }).catch(function(error){
      convoy.handoffRetryAt=Date.now()+1000;
      if (command.huntTarget) huntAcquisitionLog(command,target,"handoff rejected",{error:String(error && error.message || error).slice(0,240)},"response");
    }).finally(function(){convoy.handoffPending=false;});
  }
  async function prepareSharedConvoyRoute(convoy,command,ownsConvoy,phase) {
    await sharedConvoyRendezvous(convoy,command,ownsConvoy,phase);
    if(!ownsConvoy())return;
    var leaderRoute=character.name===command.leader,origin=sharedConvoyPoint(),gate=sharedConvoyGate();
    var destination=leaderRoute?farmingEntryPoint(command.location):command.location,started=Date.now(),identity=sharedConvoyIdentity(command);
    var released=false,onDone,plot,issued=null,installed=false,published=false,pending=false,retryAt=0,payload=null,fingerprint=null;
    var saved=leaderRoute && !command.nativeFallback && !command.avoidLeave && !command.disableTown?(sharedConvoyReusable(command,origin)||sharedConvoyItinerary(command,origin)):null;
    if(saved)destination=saved.destination;
    convoy.routeVersion=command.routeVersion;
    phase(leaderRoute?"preparing-route":"waiting-for-route");
    function clone(points){return points.map(function(p){return Object.assign({},p);});}
    function freeze() {
      if(!leaderRoute || !installed || smart.on_done!==onDone)return;
      var remaining=clone(smart.plot);
      if(issued && JSON.stringify(remaining[0])!==JSON.stringify(issued) &&
          (issued.town || issued.transport || issued.method === "leave" || sharedConvoyDistance(sharedConvoyPoint(),issued)>1))remaining.unshift(Object.assign({},issued));
      root.__partySharedRouteRemainder={id:command.convoyId,revision:Number(command.navigationRevision)||0,
        runtimeId:convoyRuntimeId,destinationKey:JSON.stringify(command.location),destination:destination,
        transporting:!!is_transporting(character),plot:remaining};
    }
    convoy.freezeRoute=freeze;
    function install(route) {
      if(route.version!==command.routeVersion || sharedConvoyDistance(route.origin,command.rally)>1 ||
          route.destination.map!==command.location.map || !Array.isArray(route.plot))throw new Error("Shared route identity changed");
      if(sharedConvoyDistance(sharedConvoyPoint(),route.origin)>55 || !can_move_to(route.origin.x,route.origin.y))
        throw new Error("Shared route origin is unreachable");
      destination=route.destination; smart.map=destination.map;smart.x=destination.x;smart.y=destination.y;
      // Keep this runtime's callback/deferred and copy only native route data.
      smart.plot.splice.apply(smart.plot,[0,smart.plot.length].concat(clone(route.plot)));
      if(!leaderRoute && sharedConvoyDistance(sharedConvoyPoint(),route.origin)>1)smart.plot.unshift(Object.assign({},route.origin));
      movement.install(smart.plot.slice(), route.geometry, route.engine);
      smart.try_exact_spot=false;
      installed=true;convoy.routeSource=route.source;convoy.routeImports=leaderRoute?0:1;
      fingerprint=JSON.stringify(smart.plot);
      convoy.waypointCount=smart.plot.length;
      convoy.preparationMs=Date.now()-started;
      convoy.routeReady=true;phase("route-ready");
    }
    function publish() {
      if(pending || published || Date.now()<retryAt)return;
      pending=true;
      request("/convoy-route",{method:"POST",timeout:3000,body:Object.assign({},identity,{route:payload})}).then(function(result){
        if(!ownsConvoy())return;
        if(!result || !result.ok)throw new Error("Leader route publication rejected");
        published=true;convoy.routeReady=true;phase("route-ready");
      }).catch(function(){retryAt=Date.now()+500;}).finally(function(){pending=false;});
    }
    function fetchRoute(signal) {
      if(pending || !signal.routeAvailable || Date.now()<retryAt)return;
      pending=true;
      var query=Object.keys(identity).map(function(k){return encodeURIComponent(k)+"="+encodeURIComponent(identity[k]);}).join("&");
      request("/convoy-route?"+query,{timeout:3000}).then(function(result){
        if(!ownsConvoy())return;
        if(!result || !result.ok)throw new Error("Route unavailable");
        install(result.route);
      }).catch(function(error){
        if(ownsConvoy())convoy.fail(error.message || String(error));
        retryAt=Date.now()+500;
      }).finally(function(){pending=false;});
    }
    function plan() {
      if(installed){publish();return;}
      if(!smart.searching){convoy.destinationSearches=(convoy.destinationSearches||0)+1;convoy.routeStarts++;movement.planTick();}
      else movement.planTick();
      if(!smart.moving || !smart.found)return;
      installed=true;convoy.routeSource="search";convoy.waypointCount=smart.plot.length;
      fingerprint=JSON.stringify(smart.plot);
      convoy.preparationMs=Date.now()-started;
      payload={engine:movement.report().engine,geometry:movement.identity,version:command.routeVersion,origin:origin,destination:destination,plot:clone(smart.plot),source:"search"};
      phase("publishing-route");publish();
    }
    function walk() {
      if(command.purpose==="franky-exit" && character.map==="main") {
        smart.searching=false;smart.plot=[];stop("smart",true);return;
      }
      sharedConvoyEngagement(convoy,command,ownsConvoy,phase);
      if(!smart.found)throw new Error("Native replan requested; regroup required");
      // Inspect before the native walker removes a point and starts smart_move again.
      if(!character.moving && !is_transporting(character) && smart.plot.length) {
        var next=smart.plot[0];
        if(!next.town && !next.transport && next.method !== "leave" && (character.map!==next.map || !can_move_to(next.x,next.y)))
          throw new Error("Shared waypoint blocked; regroup required");
        issued=Object.assign({},next);
      }
      freeze();
      return gate.original();
    }
    var owner={tick:function(){
      if(!ownsConvoy() || convoy.failure)return;
      var nativeTown=smart.use_town;
      if(command.purpose==="monster-hunt")smart.use_town=command.continuousReturn===1 && !command.disableTown;
      try {
        var signal=convoySignal,now=Date.now()+coordinatorClockOffset;
        var matches=signal && signal.id===convoy.id && Number(signal.epoch)===convoy.epoch &&
          Number(signal.commandId)===convoy.commandId && signal.runtimeId===convoyRuntimeId && signal.routeVersion===command.routeVersion;
        if(!matches || Number(signal.validUntil)<=now) {
          if(Date.now()-started<3000 && !released)return;
          throw new Error("Shared route coordinator signal expired");
        }
        if(["failed","shared-hold","defending"].indexOf(signal.phase)>=0)throw new Error("Party requested hold");
        if(!released)sharedConvoyEngagement(convoy,command,ownsConvoy,phase);
        if(smart.on_done!==onDone || smart.plot!==plot || !smart.moving)throw new Error("Shared route ownership lost");
        if(released)return walk();
        if(character.rip || character.moving || sharedConvoyDistance(sharedConvoyPoint(),origin)>1)throw new Error("Route origin changed before departure");
        if(!(Number(character.speed)>0 && Number(character.speed)<=command.slowestSpeed+0.1))throw new Error("Cruise speed changed");
        if(Date.now()-started>=60000 && !convoy.routeReady)throw new Error("Shared route installation timed out");
        if(installed && (!smart.found || JSON.stringify(smart.plot)!==fingerprint))throw new Error("Prepared shared route changed");
        if(leaderRoute)plan();else if(!installed)fetchRoute(signal);
        if(!convoy.routeReady || !signal.departAt || ["scheduled","travel"].indexOf(signal.phase)<0)return;
        if(!convoy.scheduledAt) {
          if(!signal.immediateDeparture && now>=Number(signal.departAt))throw new Error("Departure signal arrived too late");
          convoy.scheduledAt=Number(signal.departAt);
        }
        if(convoy.scheduledAt!==Number(signal.departAt))throw new Error("Departure changed");
        phase("waiting-for-departure");
        if(now<convoy.scheduledAt)return;
        if(!signal.immediateDeparture && now-convoy.scheduledAt>500)throw new Error("Missed convoy departure window");
        released=true;convoy.departedAt=now;phase("travelling");
        if (root.partyPorcupineEquipment) root.partyPorcupineEquipment.depart(command.purpose);
        return walk();
      } catch(error){freeze();convoy.fail(error.message||String(error));}
      finally {smart.use_town=nativeTown;}
    }};
    gate.owner=owner;
    convoy.detachRoute=function(){if(gate.owner===owner){freeze();gate.owner=null;}};
    // Native smart_move initializes a deferred but does not search until the gated tick.
    var route=smart_move(destination, undefined, sharedMovementOptions(command));onDone=smart.on_done;plot=smart.plot;
    if(saved) {
      payload={geometry:movement.identity,version:command.routeVersion,origin:origin,destination:destination,plot:clone(saved.plot),source:saved.source||"remainder"};
      install(payload);convoy.routeReady=false;convoy.reusedRoutes=1;
    }
    return route;
  }

  function prepareConvoyRoute(convoy, command, ownsConvoy, phase) {
    var gate = movement.gate;
    var startedAt = Date.now(), origin = { map: character.map, x: character.real_x, y: character.real_y };
    var route, onDone, initialPlot, released = false, replanning = false;
    convoy.phase = "preparing-route";
    var owner = {
      tick: function () {
        if (!ownsConvoy() || convoy.failure) return;
        if(command.purpose==='anniversary-return' && departureCombatPending()) {
          interruptConvoyForDefense(command.convoyId,command.epoch);
          if(!ownsConvoy())return;
        }
        var nativeTown = smart.use_town;
        if (command.purpose === "monster-hunt") smart.use_town = command.phase === "plan-return" && !!command.allowTown;
        try {
          if (released) {
            if (command.purpose === "franky-exit" && character.map === "main") {
              // Resolve the owned route before the native tick can walk farther
              // into Mainland. The coordinator hands this member straight to Town.
              smart.searching = false;
              smart.plot = [];
              stop("smart", true);
              return;
            }
            if (!convoy.handoffPending && Date.now() >= (convoy.handoffRetryAt || 0) &&
                typeof farmingTravelTarget === "function") {
              var target = typeof groupedFollower === "function" && groupedFollower() ? null : farmingTravelTarget(command);
              // A monster may be visible and inside the destination hunt radius
              // while still sitting around a wall or bend. Do not surrender the
              // obstacle-aware smart route to direct combat movement until the
              // character can actually walk a straight segment into attack
              // position (or is already in range).
              var attackPoint = target && typeof combatApproachPoint === "function"
                ? combatApproachPoint(target) : target;
              var directEngagement = target &&
                (typeof is_in_range === "function" && is_in_range(target) ||
                 typeof can_move_to !== "function" || attackPoint && can_move_to(attackPoint.x, attackPoint.y));
              if (target && directEngagement) {
                convoy.handoffPending = true;
                if (command.huntTarget) huntAcquisitionLog(command,target,"requesting handoff",null,"request");
                request("/convoy-engage", { method: "POST", body: {
                  character: character.name, convoyId: command.convoyId, epoch: Number(command.epoch),
                  commandId: command.id, runtimeId: convoyRuntimeId, navigationRevision: navigationIntent.revision,
                  target: { id: target.id, mtype: target.mtype, map: character.map, in: character.in, x: target.x, y: target.y },
                }}).then(function (result) {
                  if (command.huntTarget) huntAcquisitionLog(command,target,result && result.ok ? "handoff accepted" : "handoff rejected",{response:result && result.error,stillOwned:!!ownsConvoy()},"response");
                  if (!ownsConvoy() || !result || !result.ok) return;
                  if(command.huntTarget && result.location) {
                    partyLocation=result.location; huntCombatTarget=command.huntTarget; partyConvoyActive=false;
                    root.__partyTravelCombat=null; root.__partyTravelCombatAt=result.serverNow;
                  }
                  convoy.engaged = true;
                  phase("engaging-target");
                  releaseConvoyCruise(convoy);
                  convoy.detachRoute();
                  if(movement.combatHandoff)movement.combatHandoff();
                  // Cancel native routing before giving combat direct movement.
                  Promise.resolve(stop("smart")).catch(function () {});
                  convoy.cancelled = true;
                  convoyTraveling = null;
                  combatTargetId = target.id;
                  if (typeof publishCombatSelection === "function") publishCombatSelection(target, false);
                  root.__partyNavigationDetail = result.handoff==='temporary' ? 'Fighting encountered '+command.huntTarget+'; continuing to hunt area afterward' : "Engaging " + target.mtype + " along the route";
                }).catch(function (error) {
                  convoy.handoffRetryAt = Date.now() + 1000;
                  if (command.huntTarget) huntAcquisitionLog(command,target,"handoff rejected",{error:String(error && error.message || error).slice(0,240)},"response");
                })
                  .finally(function () { convoy.handoffPending = false; });
              }
            }
            if (smart.moving && !smart.found && !replanning) { convoy.replanStarts += 1; replanning = true; }
            if (smart.found) replanning = false;
            return gate.original();
          }
          if (character.rip || character.moving || character.map !== origin.map ||
              Math.hypot(character.real_x - origin.x, character.real_y - origin.y) > 1 ||
              !(Number(character.speed) > 0 && Number(character.speed) <= Number(command.slowestSpeed) + 0.1))
            throw new Error("Formation or cruise speed changed during route preparation");
          if (!smart.moving || smart.on_done !== onDone || smart.plot !== initialPlot)
            throw new Error("Prepared route ownership was lost");
          var signal = convoySignal;
          var matches = signal && signal.id === convoy.id && Number(signal.epoch) === convoy.epoch &&
            Number(signal.commandId) === convoy.commandId && signal.runtimeId === convoyRuntimeId;
          var now = Date.now() + coordinatorClockOffset;
          if (!matches || Number(signal.validUntil) <= now)
            throw new Error("Convoy coordinator signal expired or belongs to another runtime");
          if (signal.phase === "failed") throw new Error(signal.reason || "Convoy held by coordinator");
          if (!smart.found) {
            if (convoy.routeReady) throw new Error("Prepared route was invalidated");
            if (Date.now() - startedAt >= (command.phase === "plan-return" ? 30000 : 60000))
              throw new Error("Route preparation timed out");
            // Native search only: smart_move_logic's search branch can send
            // random tiny move packets, so do not execute that branch here.
            if (!smart.searching) movement.planTick();
            else movement.planTick();
            if (!smart.moving) return; // Native search failure settles route.
            if (!smart.found) return;
          }
          // Managed planners can install a path between ticks. Finalize every
          // newly found path, not just a synchronous native search result.
          if (!convoy.routeReady) {
            if (command.phase === "plan-return") {
              convoy.plannedPlot = smart.plot.map(function (point) { return Object.assign({}, point); });
              stop("smart", true);
              return;
            }
            convoy.routeReady = true;
            convoy.preparationMs = Date.now() - startedAt;
            convoy.waypointCount = smart.plot.length;
            phase("route-ready");
            return; // Never search and consume a waypoint in the same tick.
          }
          if (!convoy.routeReady || smart.plot.length !== convoy.waypointCount)
            throw new Error("Prepared route changed before departure");
          if (!signal.departAt || !["scheduled", "travel"].includes(signal.phase)) return;
          if (!convoy.scheduledAt) {
            if (now >= Number(signal.departAt)) throw new Error("Departure signal arrived too late");
            convoy.scheduledAt = Number(signal.departAt);
          }
          if (convoy.scheduledAt !== Number(signal.departAt)) throw new Error("Departure signal changed");
          phase("waiting-for-departure");
          if (now < convoy.scheduledAt) return;
          if (now - convoy.scheduledAt > 500) throw new Error("Missed convoy departure window");
          released = true;
          convoy.departedAt = now;
          phase("travelling");
          if (root.partyPorcupineEquipment) root.partyPorcupineEquipment.depart(command.purpose);
          return gate.original();
        } catch (error) { convoy.fail(error.message || String(error)); }
        finally { smart.use_town = nativeTown; }
      },
    };
    gate.owner = owner;
    convoy.detachRoute = function () { if (gate.owner === owner) gate.owner = null; };
    convoy.routeStarts += 1;
    route = smart_move(typeof farmingEntryPoint === "function" ? farmingEntryPoint(command.location) : command.location, undefined, sharedMovementOptions(command));
    onDone = smart.on_done;
    initialPlot = smart.plot;
    return route;
  }

  function releaseConvoyCruise(convoy) {
    if (!convoy || convoyTraveling !== convoy || convoy.cruiseReleased) return;
    convoy.cruiseReleased = true;
    // cruise's deferred need not settle; emit the reset before relinquishing
    // ownership, never from a delayed callback that might affect a new route.
    try { Promise.resolve(cruise(500)).catch(function () {}); } catch (_) {}
  }

  async function planHuntReturn(convoy, command, ownsConvoy, phase) {
    var candidates = [], failures = [], origin = {map:character.map,x:character.x,y:character.y};
    for (var allowTown of command.disableTown ? [false] : [false, true]) {
      convoy.plannedPlot = null; convoy.failure = null; convoy.routeReady = false;
      try {
        await prepareConvoyRoute(convoy, Object.assign({},command,{allowTown:allowTown}), ownsConvoy, phase);
        if (!ownsConvoy()) return null;
        if (convoy.plannedPlot) {
          var previous = origin, cost = 0;
          convoy.plannedPlot.forEach(function (point) {
            cost += point.town ? 7000 : (point.transport || point.method === "leave") ? 1000 :
              previous.map === point.map ? 1000*Math.hypot(point.x-previous.x,point.y-previous.y)/Math.max(1,command.slowestSpeed) : 1000;
            previous = point;
          });
          candidates.push({plot:convoy.plannedPlot,cost:cost});
        }
      } catch (error) {
        if (!ownsConvoy()) return null;
        failures.push((allowTown ? "Town allowed" : "walking only") + ": " +
          (convoy.failure || error.message || String(error)));
      }
      finally { if (convoy.detachRoute) convoy.detachRoute(); }
    }
    convoy.failure = null;
    if (!candidates.length) throw new Error("No route to Daisy could be prepared: " + failures.join("; "));
    candidates.sort(function(a,b){return a.cost-b.cost;});
    var legs = [], previous = origin, segmentOrigin=Object.assign({},origin), segment=[], segments=[];
    function point(p) { return {map:p.map,x:Number(p.x),y:Number(p.y)}; }
    function saveSegment(location) {
      if(segment.length)segments.push({origin:segmentOrigin,location:point(location),plot:segment.slice()});
      segment=[];segmentOrigin=point(location);
    }
    candidates[0].plot.forEach(function (p) {
      if (p.town) {
        saveSegment(previous);segmentOrigin=point(p);
        if (previous.map !== origin.map || Math.hypot(previous.x-origin.x,previous.y-origin.y)>12)
          legs.push({type:"walk",location:point(previous)});
        legs.push({type:"town",location:point(p)});
        origin = point(p);
      } else if (p.transport) {
        segment.push(Object.assign({},p));saveSegment(p);
        legs.push({type:"walk",location:point(p)});
        origin = point(p);
      } else segment.push(Object.assign({},p));
      previous = p;
    });
    legs.push({type:"walk",location:point(command.location)});
    saveSegment(command.location);
    root.__partyHuntRouteSegments={id:command.convoyId,runtimeId:convoyRuntimeId,revision:Number(command.navigationRevision)||0,segments:segments};
    return legs;
  }

  async function coordinatedMonsterTravel(command) {
    var convoy = { id: command.convoyId, epoch: Number(command.epoch), commandId: command.id,
      routeProtocol: command.routeProtocol,
      navigationRevision: Number(command.navigationRevision) || 0,
      generation: runtimeGeneration, destination: command.location, cancelled: false,
      phase: "taking-control", routeStarts: 0, replanStarts: 0,
      purpose:command.purpose,huntTarget:command.huntTarget,navigationExempt:!!command.navigationExempt,nonPreemptible: !!command.nonPreemptible,continuousReturn:command.continuousReturn,returnWalking:!!command.returnWalking };
    convoyTraveling = convoy;
    if(command.purpose === "party-force-travel")forceTraveling=true;
    if (command.purpose !== "grouped-approach" && !/^shared-walk/.test(command.purpose||""))
      partyLocation = command.purpose === "franky-exit" ? null : command.location;
    function ownsConvoy() {
      return runtimeCurrent() && !convoy.cancelled && !convoy.defensePaused && convoyTraveling === convoy &&
        (!navigationIntent.cancelled || command.navigationExempt) && Number(command.navigationRevision || 0) === Number(navigationIntent.revision);
    }
    function phase(value) {
      if (convoy.phase !== value && ["assembling", "assembled", "travelling", "travel", "arrived", "failed"].indexOf(value) >= 0)
        game_log("Convoy " + value + " · " + (command.purpose || "party navigation") + " · " +
          command.location.map + " [" + Math.round(command.location.x) + ", " + Math.round(command.location.y) + "]", "#51D2E1");
      convoy.phase = value;
      if (ownsConvoy()) root.__partyNavigationDetail = value;
    }
    convoy.fail = function (reason) {
      if (!ownsConvoy() || convoy.failure) return;
      captureConvoyFailureContext(convoy,command);
      if(convoy.freezeRoute)convoy.freezeRoute();
      convoy.failure = String(reason); convoy.routeReady = false;
      phase("failed");
      Promise.resolve(stop()).catch(function () {});
    };
    async function stopForConvoy() {
      var started=Date.now();
      while(ownsConvoy()) {
        if(character.rip)throw new Error("dead during convoy setup");
        var disabled=typeof can_walk==="function" && !can_walk(character);
        var flags={transporting:!!parent.transporting,statuses:Object.keys(character.s||{}).filter(function(k){return ["dash","stunned","fingered","stoned","deepfreezed","sleeping"].indexOf(k)>=0;})};
        convoy.movementLock=disabled?flags:null;
        if(!disabled) {
          // Native stop() calls move(real_x, real_y), setting moving=true even
          // at rest. Do not disturb the stationary assembly -> prepare barrier.
          if (!character.moving && !parent.transporting) return;
          try {await stop();return;} catch(error){if(!error || error.reason!=="unable")throw error;convoy.movementLock=flags;}
        }
        phase("waiting-movement-unlock");
        if(Date.now()-started>=10000)throw new Error("movement remained locked for 10 seconds: "+JSON.stringify(flags));
        await new Promise(function(resolve){setTimeout(resolve,100);});
      }
    }
    function navigate(destination) {
      convoy.routeStarts += 1;
      var result = smart_move(destination,undefined,command.continuousReturn===1 ? Object.assign({},sharedMovementOptions(command),{barrier:undefined}) : undefined);
      var onDone = smart.on_done;
      smart.on_done = function (done, reason) {
        if (!done && ownsConvoy()) convoy.interruption = {
          reason: reason, stack: String(new Error("Convoy interrupted here").stack),
        };
        return onDone.apply(this, arguments);
      };
      return result;
    }
    try {
      followingLeader = false;
      await stop("smart");
      if (!ownsConvoy()) return;
      // stop("smart") cancels only path ownership; stop() also sends a move
      // packet. Wait for that physical stop before declaring assembly ready.
      await stopForConvoy();
      if (!ownsConvoy()) return;
      if(command.huntTarget && command.combatHandoffAllowed) {
        sharedConvoyEngagement(convoy,command,ownsConvoy,phase);
        while(ownsConvoy() && convoy.handoffPending)await new Promise(function(resolve){setTimeout(resolve,80);});
        if(!ownsConvoy())return;
      }
      if (command.phase === "hold") {
        convoy.failure = command.reason || "Convoy held; request a fresh convoy to retry";
        phase("failed");
        root.__partyNavigationDetail = "Convoy held: " + convoy.failure;
        game_log("Convoy held: " + convoy.failure, "red");
        await new Promise(function (resolve) { convoy.release = resolve; });
        return;
      }
      if (command.phase === "shared-hold") {
        if (command.reason) root.__partyNavigationDetail = command.reason;
        phase("held");
        await new Promise(function(resolve){convoy.release=resolve;});
        return;
      }
      if (command.phase === "plan-return") {
        phase("planning-return");
        convoy.returnPlan = await planHuntReturn(convoy,command,ownsConvoy,phase);
        if (!ownsConvoy()) return;
        phase("return-route-ready");
        await new Promise(function(resolve){convoy.release=resolve;});
        return;
      }
      if (command.phase === "assemble") {
        phase("assembling");
        var rally = command.rally;
        if (!rally) throw new Error("Convoy rally point is missing");
        var distance = character.map === rally.map
          ? Math.hypot(character.x - rally.x, character.y - rally.y) : Infinity;
        if (distance > 12 && !command.deferRendezvous) {
          await navigate(rally);
        }
        if (!ownsConvoy()) return;
        // cruise is a server speed cap; the source does not settle its
        // deferred on the game_response acknowledgement. Observe the resulting
        // character speed instead of awaiting that deferred.
        Promise.resolve(cruise(Number(command.slowestSpeed) || character.speed)).catch(function () {});
        phase("assembled");
        // Keep ownership until the coordinator sends the scheduled travel
        // command. The role loop must not walk away from the rally.
        await new Promise(function (resolve) { convoy.release = resolve; });
        return;
      }
      if (command.phase === "town") {
        phase("casting-town");
        var townReadyDeadline = Date.now() + 5000;
        while (ownsConvoy() && (!can_use("use_town") || is_on_cooldown("use_town")) && Date.now() < townReadyDeadline)
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
        if (!ownsConvoy()) return;
        if (!can_use("use_town") || is_on_cooldown("use_town")) throw new Error("Town shortcut unavailable; party remains held");
        {
          var townOrigin = { map: character.map, x: Number(character.x), y: Number(character.y) };
          var spawn = G.maps[character.map] && G.maps[character.map].spawns[0];
          var result = typeof town === "function" ? await town() : await use_skill("use_town");
          if (result && (result.failed || result.success === false)) throw new Error("Town shortcut rejected");
          var townDeadline = Date.now() + 12000;
          while (ownsConvoy() && Date.now() < townDeadline) {
            if (!is_transporting(character) && character.map === townOrigin.map && spawn &&
                Math.hypot(Number(character.x)-spawn[0],Number(character.y)-spawn[1])<=150) break;
            await new Promise(function (resolve) { setTimeout(resolve, 100); });
          }
          if (ownsConvoy() && (is_transporting(character) || character.map !== townOrigin.map || !spawn ||
              Math.hypot(Number(character.x)-spawn[0],Number(character.y)-spawn[1])>150))
            throw new Error("Town shortcut did not complete; party remains held");
        }
        if (!ownsConvoy()) return;
        await stop();
        phase("towned");
        await new Promise(function (resolve) { convoy.release = resolve; });
        return;
      }
      if (command.phase !== "prepare" && command.phase !== "shared-prepare") throw new Error("A fresh prepared convoy is required");
      // A hot reload releases the old runtime's throttle. Re-establish it
      // when resuming preparation even if assembly was already completed.
      Promise.resolve(cruise(Number(command.slowestSpeed) || character.speed)).catch(function () {});
      if(command.phase === "shared-prepare") await prepareSharedConvoyRoute(convoy, command, ownsConvoy, phase);
      else await prepareConvoyRoute(convoy, command, ownsConvoy, phase);
      if (!ownsConvoy()) return;
      if(command.phase === "shared-prepare" && convoy.detachRoute)convoy.detachRoute();
      if (command.returnLeg) {
        phase("leg-arrived");
        await new Promise(function(resolve){convoy.release=resolve;});
        return;
      }
      phase("arrived");
      var completion;
      do {
        try { completion = await request("/convoy-complete", { method: "POST", body: {
          character: character.name, convoyId: command.convoyId,
          epoch: Number(command.epoch), commandId: command.id, runtimeId: convoyRuntimeId,
          navigationRevision:Number(command.navigationRevision)||0,routeVersion:command.routeVersion,
        }}); } catch(error) {
          if (!/stale convoy completion/.test(String(error && (error.message || error)))) throw error;
          // Another member can fail while our arrival request is in flight.
          // Keep arrival observational; wait for the replacement command instead
          // of reporting a second failure against the retired generation.
          if (ownsConvoy()) await new Promise(function(resolve){convoy.release=resolve;});
          return;
        }
        if(completion && completion.waiting)await new Promise(function(resolve){setTimeout(resolve,250);});
      } while(ownsConvoy() && completion && completion.waiting);
      if(!ownsConvoy())return;
      if (completion && completion.superseded) return;
      if (command.purpose === "event-return") eventRecoveryState.phase = "complete";
      game_log("Arrived with party at " + (command.label || "selected monster"), "#51D2E1");
    } catch (error) {
      if (!ownsConvoy()) return;
      captureConvoyFailureContext(convoy,command);
      phase("failed");
      var reason = convoy.failure || String(error && (error.reason || error.message || error));
      convoy.failure = reason; convoy.routeReady = false;
      await Promise.resolve(stop()).catch(function () {});
      if (!ownsConvoy()) return;
      await request("/convoy-failed", { method: "POST", body: {
        character: character.name, convoyId: command.convoyId,
        epoch: Number(command.epoch), commandId: command.id, runtimeId: convoyRuntimeId, reason: reason,
        failureCode: convoy.townAttempt && ['interrupted','unavailable'].indexOf(convoy.townAttempt.state)>=0 ? 'town-interrupted' : command.phase === "town" ? "town-unavailable" : "route-failed",
        townAttempt: convoy.townAttempt || null,
        routeVersion: command.routeVersion,
        details: { phase: convoy.phase, failureContext: convoy.failureContext || null, routeStarts: convoy.routeStarts,
          map: character.map, x: character.x, y: character.y, movementLock: convoy.movementLock || null, interruption: convoy.interruption || null,
          movement: movement.report() || movement.last() },
      }}).catch(function () {});
      game_log("Convoy movement failed: " + reason, "red");
      logConvoyFailureContext(convoy.failureContext);
      if (ownsConvoy()) await new Promise(function (resolve) { convoy.release = resolve; });
    } finally {
      if(convoy.defensePaused && !convoy.cancelled && convoyTraveling===convoy)
        await new Promise(function(resolve){convoy.release=resolve;});
      if (convoy.detachRoute) convoy.detachRoute();
      // A cancelled assembly coroutine can finish after travel has started.
      // It must never reset the new route's speed, label, or smart state.
      if (convoyTraveling === convoy) {
        if(command.purpose === "party-force-travel")forceTraveling=false;
        if (runtimeCurrent() && !convoy.cruiseHandoff && (command.phase !== "assemble" || convoy.cancelled)) releaseConvoyCruise(convoy);
        convoyTraveling = null;
        if (runtimeCurrent()) {
          root.__partyNavigationDetail = null;
        }
      }
    }
  }

  var kiteState = { targetId: null, center: null, offset: 0, lastMoveAt: 0 };

  function isCurrentlyKiting() {
    var target = kiteState.targetId && get_entity(kiteState.targetId);
    return !!(target && !target.dead && target.target === character.name &&
      Date.now() - kiteState.lastMoveAt < 1500);
  }

  async function emergencyWarriorStomp() {
    if (typeof rareTarget === "function" && rareTarget() && rareTarget().mtype === "tinyp") return false;
    if (character.ctype !== "warrior" || farmingMode === "scatter") return false;
    var skill = G.skills && G.skills.stomp;
    if (unfinishedFight() && Object.values(parent.entities || {}).some(function(e) {
      return e && e.type==='monster' && e.visible && !e.dead && !leaderLockAllows(e) &&
        Math.hypot(e.x-character.x,e.y-character.y)<=Number(skill && skill.range || 400);
    })) return false;
    if (!skill || character.mp < skill.mp || is_on_cooldown("stomp") || !can_use("stomp")) return false;
    var roster = currentPartyList();
    var monsters = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
      .filter(function (entity) { return entity && entity.type === "monster" && !entity.dead && entity.visible; });
    var ownAggro = monsters.filter(function (entity) { return entity.target === character.name; }).length;
    var danger = ownAggro >= 2 || isCurrentlyKiting() || partyPositions.some(function (member) {
      if (!member || member.name === character.name || roster.indexOf(member.name) < 0 ||
          member.rip || member.map !== character.map || !sameEventTeamMember(member) ||
          (member.in != null && character.in != null && member.in !== character.in) ||
          Date.now() - Number(member.seenAt || 0) > 5000) return false;
      var live = get_entity(member.name);
      var hp = live || member;
      return !hp.rip && ((hp.max_hp > 0 && hp.hp / hp.max_hp < 0.6) || member.kiting);
    });
    // Do not spend MP on an empty area; Stomp only helps enemies in range.
    if (!danger || !monsters.some(function (entity) {
      return Math.hypot(entity.x - character.x, entity.y - character.y) <= Number(skill.range || 400) &&
        (entity.target === character.name || roster.indexOf(entity.target) >= 0);
    })) return false;
    await use_skill("stomp");
    return true;
  }

  var farmApproach = { target: null, progressAt: 0, distance: Infinity, route: null, failed: {}, searchAt: 0, searchIndex: 0, areaId: null, points: null };
  function cancelFarmApproach(reason) {
    var route=farmApproach.route;
    farmApproach.route=null;
    if (route && typeof smart!=="undefined" && smart.on_done===route.onDone) {
      try { Promise.resolve(stop("smart")).catch(function(){}); } catch(_) {}
    }
    if(route)root.partyCombatPosition={at:Date.now(),mode:"recovery-cancelled",reason:reason,movementOwner:null};
  }
  function recoverFarmApproach(target) {
    if (typeof groupedDefensiveTarget === "function" && groupedDefensiveTarget()) {
      cancelFarmApproach("defending visible party attackers");
      return false;
    }
    if (!target && typeof rareActive === "function" && rareActive()) {
      cancelFarmApproach("rare encounter owns movement; waiting for combat selection");
      return true;
    }
    if (!target && typeof unfinishedFight === "function" && unfinishedFight()) {
      cancelFarmApproach("unfinished fight; no empty-area search");
      return true;
    }
    if(!target && typeof groupedCombat!=='undefined' && groupedCombat && groupedCombat.target && groupedCombat.target.state==='planned') {
      root.partyCombatPosition={at:Date.now(),mode:'target-observation',movementOwner:'group',target:groupedCombat.target.id,reason:'Waiting for party observation of nominated target'};
      return true;
    }
    if (character.ctype === "merchant") return false;
    if ((partyConvoyActive || convoyTraveling) && !root.__partyConvoyDefense) {
      cancelFarmApproach("convoy owns movement"); return true;
    }
    if (!runtimeCurrent() || character.rip || root.sharedRoutine.isOccupied() || activeCombatEvent() || joinedEvent || navigationIntent.cancelled) {
      cancelFarmApproach("navigation or activity changed"); return false;
    }
    var now=Date.now(), route=farmApproach.route;
    if (!target && partyLocation && inFarmArea(character, partyLocation, 0)) {
      cancelFarmApproach("inside farming area; waiting for respawns");
      farmApproach.searchAt=0;
      root.partyCombatPosition={at:now,mode:"farm-search-wait",movementOwner:null,reason:"inside farming area; waiting for respawns"};
      return false;
    }
    if(route) {
      var arrived=character.map===route.destination.map && Math.hypot(character.x-route.destination.x,character.y-route.destination.y)<15;
      var threat=Object.keys(parent.entities||{}).some(function(id){var e=parent.entities[id];return e && e.visible && !e.dead && e.type==="monster" && e.target===character.name;});
      var ready=target && is_in_range(target);
      var replaced=typeof smart!=="undefined" && smart.on_done!==route.onDone;
      if(replaced || route.revision!==navigationIntent.revision || ready || threat || arrived ||
          route.target && (!target || target.id!==route.target) || now-route.at>=30000) {
        if(now-route.at>=30000 && route.target)farmApproach.failed[route.target]=now+10000;
        cancelFarmApproach(replaced?"new movement owner":ready?"engaging reachable target":threat?"defending":arrived?"search point reached":"approach expired or target changed");
        farmApproach.searchAt=now+1000;farmApproach.progressAt=now;
        return false;
      }
      root.partyCombatPosition={at:now,mode:"farm-approach-route",target:route.target,movementOwner:"farm-recovery",reason:"routing around obstacle"};
      return true;
    }
    if(farmTravelPaused) {
      if(target && is_in_range(target) || Object.keys(parent.entities||{}).some(function(id){var e=parent.entities[id];return e && e.visible && !e.dead && e.type==="monster" && e.target===character.name;}))return false;
      root.partyCombatPosition={at:now,mode:"farm-travel-paused",movementOwner:null,reason:"zone travel failed; choose a farming area to retry"};return true;
    }
    if(!partyLocation || !root.partyFarmingZones || typeof smart_move!=="function")return false;
    if(now < farmApproach.searchAt)return false;
    var destination=null;
    if(target) {
      if(is_in_range(target) && combatDistance(target) <= Number(character.range)) {farmApproach.progressAt=now;return false;}
      var distance=combatDistance(target);
      if(farmApproach.target!==target.id || distance<farmApproach.distance-8) {
        farmApproach.target=target.id;farmApproach.distance=distance;farmApproach.progressAt=now;return false;
      }
      if(now-farmApproach.progressAt<1500)return false;
      // Selected is not the same as engaged: an unreachable selection must not
      // indefinitely suppress path recovery. Never path away from actual aggro.
      if(Object.keys(parent.entities||{}).some(function(id){var e=parent.entities[id];return e && e.visible && !e.dead && e.type==="monster" && e.target===character.name;}))return false;
      if(now-Number(lastAttackAt||0)<3000)return false;
      var enemies=Object.keys(parent.entities||{}).map(function(id){return parent.entities[id];}).filter(function(e){return e && e.visible && !e.dead && e.type==="monster";});
      formationFrame={attackers:[],enemies:enemies,motions:new Map(),self:formationBody(character)};
      try {
        var local=recoverFormationCorner(target,character,true,[],Math.max(1,character.speed*0.6));
        if(local && root.partyCombatPosition.mode==="formation-regrouping")return true;
      } finally {formationFrame=null;}
      destination=combatApproachPoint(target);
      destination.map=character.map;
    } else {
      if (typeof groupedFollower === "function" && groupedFollower()) return false;
      if(farmApproach.areaId!==partyLocation.id || !farmApproach.points) {
        farmApproach.areaId=partyLocation.id;farmApproach.searchIndex=0;
        farmApproach.points=root.partyFarmingZones.searchPoints(partyLocation).filter(function(p){return typeof can_move!=="function" || can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:character.base});});
      }
      if(!farmApproach.points.length || farmApproach.searchIndex>=farmApproach.points.length) {
        farmApproach.searchAt=now+10000;farmApproach.searchIndex=0;
        root.partyCombatPosition={at:now,mode:"farm-search-wait",movementOwner:null,reason:"zone search exhausted; waiting for reachable spawns"};return true;
      }
      destination=farmApproach.points[farmApproach.searchIndex++];
      if(character.map===destination.map && Math.hypot(character.x-destination.x,character.y-destination.y)<20) {
        farmApproach.searchAt=now+1000;return true;
      }
    }
    if(typeof can_walk==="function" && !can_walk(character))return true;
    if (destination.map === character.map && can_move_to(destination.x,destination.y) && safeCombatPoint(destination,target)) {
      if (!target) farmApproach.searchIndex = Math.max(0, farmApproach.searchIndex-1);
      Promise.resolve(move(destination.x,destination.y)).catch(function () {});
      root.partyCombatPosition={at:now,mode:"farm-local-approach",target:target && target.id,movementOwner:"farm-recovery",reason:"clear local approach"};
      return true;
    }
    var localKey=JSON.stringify([destination.map,target ? target.id : [destination.x,destination.y],navigationIntent.revision]);
    var local=farmApproach.local;
    var gap=destination.map===character.map ? Math.hypot(character.x-destination.x,character.y-destination.y) : Infinity;
    if (!local || local.key!==localKey) local=farmApproach.local={key:localKey,at:now,gap:gap,point:null};
    if (gap<local.gap-8) {local.gap=gap;local.at=now;}
    if (destination.map===character.map && now-local.at<3000) {
      if (!target) farmApproach.searchIndex=Math.max(0,farmApproach.searchIndex-1);
      if (local.point && Math.hypot(character.x-local.point.x,character.y-local.point.y)<8) local.point=null;
      if (!local.point) {
        var bearing=Math.atan2(destination.y-character.y,destination.x-character.x), step=Number(character.speed || 40)*0.6;
        var turns=[Math.PI/6,-Math.PI/6,Math.PI/3,-Math.PI/3,Math.PI/2,-Math.PI/2];
        for (var turn=0;turn<turns.length;turn++) {
          var point={x:character.x+Math.cos(bearing+turns[turn])*step,y:character.y+Math.sin(bearing+turns[turn])*step};
          if (can_move_to(point.x,point.y) && safeCombatPoint(point,target)) {local.point=point;break;}
        }
      }
      if (local.point && can_move_to(local.point.x,local.point.y) && safeCombatPoint(local.point,target))
        Promise.resolve(move(local.point.x,local.point.y)).catch(function(){});
      root.partyCombatPosition={at:now,mode:"farm-local-detour",movementOwner:"farm-recovery",reason:"trying local obstacle recovery"};
      return true;
    }
    farmApproach.local=null;
    var recovery={target:target && target.id || null,destination:destination,revision:navigationIntent.revision,at:now,onDone:null};
    farmApproach.route=recovery;
    root.partyCombatRoutes=root.partyCombatRoutes || {regroup:0,approach:0};root.partyCombatRoutes.approach++;
    try {
      var promise=smart_move(destination);recovery.onDone=smart.on_done;
      Promise.resolve(promise).catch(function(){if(farmApproach.route===recovery && recovery.target)farmApproach.failed[recovery.target]=Date.now()+10000;})
        .finally(function(){if(farmApproach.route===recovery){farmApproach.route=null;farmApproach.searchAt=Date.now()+1000;farmApproach.progressAt=Date.now();}});
    } catch(error) { farmApproach.route=null;farmApproach.searchAt=now+10000;if(target)farmApproach.failed[target.id]=now+10000; }
    root.partyCombatPosition={at:now,mode:"farm-approach-route",target:recovery.target,movementOwner:"farm-recovery",reason:target?"blocked target approach":"searching selected zone"};
    return true;
  }
  var formationState = { priest: null, direction: 1, heading: null, targetId: null };
  function formationDistance(a, b) {
    return typeof distance === "function" ? distance(a, b) : Math.hypot(a.x - b.x, a.y - b.y);
  }
  function formationMelee(member) {
    return ["warrior", "paladin", "rogue"].indexOf(member.ctype) >= 0 && Number(member.range) < 100;
  }
  function formationMembers() {
    var roster = currentPartyList(), now = Date.now() + coordinatorClockOffset;
    return partyPositions.filter(function (member) {
      return member && roster.indexOf(member.name) >= 0 && member.ctype !== "merchant";
    }).map(function (member) {
      var live = member.name === character.name ? character : get_player(member.name);
      if (live && (live === character || live.visible)) return Object.assign(formationBody(live), {
        name: live.name, ctype: live.ctype, hp: live.hp, rip: live.rip, range: live.range, team: live.team });
      if (now - Number(member.seenAt) > 3000 || member.server !== reunionRealm()) return null;
      return member;
    }).filter(function (member) {
      return member && !member.rip && member.hp > 0 && member.map === character.map &&
        (member.in == null || character.in == null || member.in === character.in);
    });
  }
  // Only numeric geometry enters the solver. Never copy renderer/game entities.
  function formationBody(entity, point) {
    return { x: point ? point.x : Number(entity.real_x !== undefined ? entity.real_x : entity.x),
      y: point ? point.y : Number(entity.real_y !== undefined ? entity.real_y : entity.y),
      awidth: Number(entity.awidth !== undefined ? entity.awidth : (entity.width || 0) / (entity.mscale || 1)) || 0,
      aheight: Number(entity.aheight !== undefined ? entity.aheight : (entity.height || 0) / (entity.mscale || 1)) || 0,
      map: entity.map, in: entity.in };
  }
  function formationMotion(entity) {
    var body = formationBody(entity);
    var moving = entity.moving && Number.isFinite(entity.going_x) && Number.isFinite(entity.going_y);
    var dx = moving ? entity.going_x - body.x : 0, dy = moving ? entity.going_y - body.y : 0;
    var speed = Number(entity.speed) || 0, length = Math.hypot(dx, dy);
    var duration = length && speed > 0 ? length / speed : 0;
    var definition = G.monsters && G.monsters[entity.mtype] || {};
    return { body: body, duration: duration, vx: duration ? dx / duration : 0, vy: duration ? dy / duration : 0,
      id: entity.id, safety: formationMonsterSafety(entity) };
  }
  function formationMonsterSafety(entity) {
    var definition=G.monsters && G.monsters[entity.mtype] || {};
    var range=Number(entity.range || definition.range) || 20;
    var selected=entity.id===formationState.targetId || groupedCombat && groupedCombat.target && entity.id===groupedCombat.target.id;
    if(selected)return Math.min(range,Math.max(6,Number(character.range)-24))+8;
    // A neutral ranged monster's weapon reach is not a solid collision obstacle.
    if(!entity.target && range>Number(character.range))return 38;
    return range+8;
  }
  var formationFrame = null;
  function priestSecondaryClearance(point, enemies) {
    var math = Math;
    var own = formationFrame ? formationFrame.self : formationBody(character), speed = Number(character.speed) || 0;
    var dx = point.x - own.x, dy = point.y - own.y, length = math.hypot(dx, dy);
    var duration = length && speed > 0 ? length / speed : 0;
    var vx = duration ? dx / duration : 0, vy = duration ? dy / duration : 0;
    var result = { minimum: Infinity, end: Infinity, current: Infinity, nearest: null, risk: 0 };
    for (var n = 0; n < enemies.length; n++) {
      var enemy = enemies[n], other = formationFrame && formationFrame.motions.get(enemy);
      if (!other) {
        other = formationMotion(enemy);
        if (formationFrame) formationFrame.motions.set(enemy, other);
      }
      var b = other.body;
      function separation(time) {
        var ax = own.x + vx * math.min(time, duration), ay = own.y + vy * math.min(time, duration);
        var bx = b.x + other.vx * math.min(time, other.duration), by = b.y + other.vy * math.min(time, other.duration);
        return math.hypot(math.max(math.abs(ax - bx) - (own.awidth + b.awidth) / 2, 0),
          math.max(by - b.aheight - ay, ay - own.aheight - by, 0));
      }
      var initial = separation(0), minimum = initial;
      if (initial < result.current) { result.current = initial; result.nearest = other.id; }
      var first = math.min(0.6, duration, other.duration), second = math.min(0.6, math.max(duration, other.duration));
      var start = 0;
      for (var i = 0; i < 3; i++) {
        var end = i === 0 ? first : i === 1 ? second : 0.6;
        if (end <= start) continue;
        var rx = vx * (start < duration ? 1 : 0) - other.vx * (start < other.duration ? 1 : 0);
        var ry = vy * (start < duration ? 1 : 0) - other.vy * (start < other.duration ? 1 : 0);
        var ax = own.x + vx * math.min(start, duration) - b.x - other.vx * math.min(start, other.duration);
        var ay = own.y + vy * math.min(start, duration) - b.y - other.vy * math.min(start, other.duration);
        var denominator = rx * rx + ry * ry;
        var closest = denominator ? math.max(0, math.min(end - start, -(ax * rx + ay * ry) / denominator)) : 0;
        minimum = math.min(minimum, separation(start), separation(start + closest), separation(end));
        start = end;
      }
      result.minimum = math.min(result.minimum, minimum);
      result.end = math.min(result.end, separation(0.6));
      result.risk += math.max(0, other.safety - minimum);
    }
    return result;
  }
  function formationSegmentSafe(from, to, obstacles) {
    var length = Math.hypot(to.x - from.x, to.y - from.y);
    var count = Math.max(1, Math.ceil(length / Math.max(8, Number(character.speed || 40) * 0.6)));
    var saved = formationFrame.self;
    try {
      for (var i = 0; i < count; i++) {
        var start = { x: from.x + (to.x - from.x) * i / count, y: from.y + (to.y - from.y) * i / count };
        var end = { x: from.x + (to.x - from.x) * (i + 1) / count, y: from.y + (to.y - from.y) * (i + 1) / count };
        formationFrame.self = formationBody(character, start);
        if (priestSecondaryClearance(end, obstacles).risk > priestSecondaryClearance(start, obstacles).risk + 0.01) return false;
      }
      return true;
    } finally { formationFrame.self = saved; }
  }
  // A bounded local detour, not smart_move/A*. One owner keeps the waypoint
  // until reached; the full formation optimizer cannot fight it each tick.
  function recoverFormationCorner(reference, priest, selfPriest, members, step) {
    var goal = combatApproachPoint(reference, formationDesiredRange(reference, priest, selfPriest, members, step));
    if (!selfPriest && character.ctype === "mage" && formationDistance(character, priest) > Number(priest.range) * 0.9) goal = priest;
    var obstacles = formationFrame.enemies.filter(function (e) { return e.id !== reference.id || !formationMelee(character); });
    var identity = [reference.id, priest.name, character.map, character.in, joinedEvent, eventTraveling].join(":");
    if (formationState.approachIdentity !== identity) {
      formationState.approachIdentity = identity; formationState.approachProgress = null; formationState.recovery = null;
    }
    var gap = Math.hypot(goal.x - character.x, goal.y - character.y), now = Date.now();
    var tracking = formationState.approachProgress;
    if (!tracking || tracking.target !== reference.id || gap < tracking.gap - 8) {
      tracking = formationState.approachProgress = { target: reference.id, gap: gap, at: now };
    }
    if (gap < 12) { formationState.recovery = null; return false; }
    if (now - tracking.at < 1500 && !formationState.recovery) return false;
    var directClear = can_move_to(goal.x, goal.y) && formationSegmentSafe(character, goal, obstacles);
    var recovery = formationState.recovery;
    if (!recovery || recovery.target !== reference.id || Math.hypot(recovery.goal.x - goal.x, recovery.goal.y - goal.y) > 80) {
      recovery = formationState.recovery = { target: reference.id, goal: { x: goal.x, y: goal.y }, retryAt: 0, point: null };
    }
    if (recovery.point && (Math.hypot(recovery.point.x - character.x, recovery.point.y - character.y) < 8 ||
        !can_move_to(recovery.point.x, recovery.point.y) || !formationSegmentSafe(character, recovery.point, obstacles))) recovery.point = null;
    if (!recovery.point && now >= recovery.retryAt) {
      recovery.retryAt = now + 1000;
      var best = directClear ? gap : Infinity;
      if (directClear) recovery.point = { x: goal.x, y: goal.y };
      if (typeof can_move === "function") for (var ring = 0; ring < 4; ring++) for (var angle = 0; angle < 16; angle++) {
        var radius = 80 * Math.pow(2, ring), radians = angle * Math.PI / 8;
        var point = { x: character.x + Math.cos(radians) * radius, y: character.y + Math.sin(radians) * radius };
        var score = radius + Math.hypot(goal.x - point.x, goal.y - point.y);
        if (score >= best || !can_move_to(point.x, point.y) || !can_move({ map: character.map, x: point.x, y: point.y,
            going_x: goal.x, going_y: goal.y, base: character.base }) ||
            !formationSegmentSafe(character, point, obstacles) || !formationSegmentSafe(point, goal, obstacles)) continue;
        recovery.point = point; best = score;
      }
    }
    if (recovery.point) {
      var dx = recovery.point.x - character.x, dy = recovery.point.y - character.y;
      var fraction = Math.min(1, step / Math.hypot(dx, dy));
      var next = { x: character.x + dx * fraction, y: character.y + dy * fraction };
      var held = priestSecondaryClearance(character, obstacles), moving = priestSecondaryClearance(next, obstacles);
      if (moving.risk <= held.risk && safeCombatPoint(next, reference)) {
        return next;
      }
    }
    // Keep immediate defensive movement available, but don't oscillate merely
    // because the straight-line range objective is unreachable around a wall.
    if (formationFrame.attackers.length) return false;
    return {blocked:true,reason:can_move_to(goal.x, goal.y) ? "monster-blocked approach" : "terrain-blocked approach"};
  }
  function terrainRecoveryContext() {
    var g=groupedCombat,t=g && g.target;
    return {key:g && g.key,target:t && JSON.stringify([t.server,t.map,t.in,t.id]),
      covered:!!(g && g.anchor && Math.hypot(character.x-g.anchor.x,character.y-g.anchor.y)<=Math.max(10,g.range-10)),
      allowed:!!(t && t.state==='planned' && groupedFarming() && groupedFresh() && !navigationIntent.cancelled && !character.rip &&
        t.map===character.map && t.in===character.in && t.server===reunionRealm() && !unfinishedFight() &&
        (!partyConvoyActive || !!root.__partyFarmingEngagement) && !convoyTraveling && !travelCombatActive() && !eventTraveling && !joinedEvent && !activeCombatEvent() &&
        !root.sharedRoutine.isOccupied() && !combatRecoveryActive() && !currentTravelAttackers().length &&
        !(root.partyLootClient && root.partyLootClient.huntPending()))};
  }
  // Native route segments are additionally gated by live party healing coverage.
  function terrainRecoverySafe(point, endpointOnly, from) {
    if(!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))return false;
    var origin=from || (endpointOnly ? point : character);
    if(!can_move({map:character.map,x:origin.x,y:origin.y,going_x:point.x,going_y:point.y,base:character.base}))return false;
    var dx=point.x-origin.x,dy=point.y-origin.y,length=dx*dx+dy*dy;
    return Object.values(parent.entities || {}).every(function(e){
      if(!e || e.type!=='monster' || !e.visible || e.dead || e.hp===0 || e.map && e.map!==character.map || e.in!=null && e.in!==character.in)return true;
      var fraction=length ? Math.max(0,Math.min(1,((e.x-origin.x)*dx+(e.y-origin.y)*dy)/length)) : 0;
      var closest={x:origin.x+dx*fraction,y:origin.y+dy*fraction};
      var safety=formationMonsterSafety(e);
      var clearance=formationDistance(formationBody(character,closest),formationBody(e));
      if(endpointOnly)return clearance>safety;
      var before=formationDistance(formationBody(character,origin),formationBody(e));
      return clearance>=Math.min(before,safety)-0.01;
    });
  }
  function terrainRecoveryGoals(reference,desired) {
    if(!reference)return [];
    var radius=Math.max(desired,formationMonsterSafety(reference)+12),goals=[];
    for(var i=0;i<16;i++) {
      var angle=i*Math.PI/8,p={x:reference.x+Math.cos(angle)*radius,y:reference.y+Math.sin(angle)*radius};
      if(terrainRecoverySafe(p,true))goals.push(p);
    }
    goals.sort(function(a,b){return Math.hypot(a.x-character.x,a.y-character.y)-Math.hypot(b.x-character.x,b.y-character.y);});
    return goals;
  }
  function proposeTerrainRecovery(reference,desired) {
    var client=root.partyQueueClient && root.partyQueueClient.formation;
    if(!client || !terrainRecoveryContext().allowed)return;
    var goals=terrainRecoveryGoals(reference,desired);
    client.propose(terrainRecoveryContext().target,goals);
    root.partyCombatPosition.recoveryGoals=goals.length;
  }
  function terrainCoverageStep(point) {
    var members=formationMembers(),priest=members.find(function(m){return m.ctype==='priest';});
    if(!priest)return false;
    var safeRange=Number(priest.range)-Math.min(20,Math.max(8,Number(priest.range)*0.1));
    var body=formationBody(character,point);
    if(priest.name!==character.name)return formationDistance(body,priest)<=Math.max(safeRange,formationDistance(character,priest))+0.01;
    return members.every(function(m){return m.name===character.name || formationDistance(body,m)<=Math.max(safeRange,formationDistance(character,m))+0.01;});
  }
  function terrainApproachReady() {
    var g=groupedCombat,t=g && g.target;
    if(!t || !groupedFresh() || !groupedCovered())return false;
    var local=get_entity(t.id),seen=local && local.visible && !local.dead;
    if(!seen && !(g.observers||[]).some(function(o){return o.server===reunionRealm() && o.map===character.map && o.in===character.in && Date.now()+coordinatorClockOffset-o.seenAt<=3000;}))return false;
    var reference=seen?local:t;
    if(seen && is_in_range(reference))return true;
    var members=formationMembers(),priest=members.find(function(m){return m.ctype==='priest';});
    if(!priest)return false;
    var desired=formationDesiredRange(reference,priest,priest.name===character.name,members,Number(character.speed||40)*0.6);
    var goal=combatApproachPoint(reference,desired);
    return can_move_to(goal.x,goal.y) && formationRecoverySafePoint(goal);
  }
  function followTerrainRecovery() {
    var g=groupedCombat,r=g && g.formationRecovery;
    var mover=r && formationMembers().find(function(m){return m.name===r.mover;});
    if(!mover || !g.target)return;
    var distance=Math.hypot(mover.x-character.x,mover.y-character.y);
    if(distance<=40){holdFormation(g.target,'waiting for recovery leader to advance');return;}
    var client=root.partyQueueClient && root.partyQueueClient.formation;
    var waypoint=client && client.followPoint ? client.followPoint({x:mover.x,y:mover.y}) : mover;
    if(!waypoint){holdFormation(g.target,'finding safe recovery follower route');return;}
    var heading=Math.atan2(waypoint.y-character.y,waypoint.x-character.x),length=Math.min(Number(character.speed||40)*0.25,distance-40,Math.hypot(waypoint.x-character.x,waypoint.y-character.y));
    var offsets=[0,Math.PI/6,-Math.PI/6,Math.PI/3,-Math.PI/3,Math.PI/2,-Math.PI/2];
    for(var i=0;i<offsets.length;i++){
      var point={x:character.x+Math.cos(heading+offsets[i])*length,y:character.y+Math.sin(heading+offsets[i])*length};
      // An obstacle detour can temporarily increase distance to the priest.
      // Only the certified route direction may do this, during peaceful recovery;
      // every issued segment still checks live terrain and monster clearance.
      var detour=i===0 && client && client.followPoint && mover.ctype==='priest' &&
        terrainRecoveryContext().allowed && !can_move_to(mover.x,mover.y);
      if((terrainCoverageStep(point) || detour) && terrainRecoverySafe(point)){
        sendCombatMove(g.target,point,'formation-regrouping');
        root.partyCombatPosition.reason=detour?'following safe detour to recovery leader':'following recovery leader within healing coverage';return;
      }
    }
    holdFormation(g.target,'recovery follower blocked by terrain, monsters or coverage');
  }
  function terrainRecoveryPorts() {
    return {
      now:function(){return Date.now()+coordinatorClockOffset;},self:function(){return character;},context:terrainRecoveryContext,
      gate:sharedConvoyGate,smart:function(){return smart;},safe:terrainRecoverySafe,
      segmentClear:function(from,to){return terrainRecoverySafe(to,false,from);},
      approachReady:terrainApproachReady,coveredStep:terrainCoverageStep,follow:followTerrainRecovery,stepSize:Math.max(1,Number(character.speed||40)*0.25),
      release:function(){resetCombatMovement();if(root.partyQueueClient)root.partyQueueClient.sight.reset();if(root.partyRoleRunner)root.partyRoleRunner.wake();},
      goals:function(){return terrainRecoveryGoals(groupedCombat && groupedCombat.target,desiredCombatRange());},
      plan:function(){var town=smart.use_town;smart.use_town=false;try{if(!smart.searching)movement.planTick();else movement.planTick();}finally{smart.use_town=town;}},
      start:function(goal){cancelGroupRoute();cancelFightRoute();cancelFarmApproach('terrain recovery');resetCombatMovement();return smart_move({map:character.map,x:goal.x,y:goal.y}, undefined, {town:false});},
      stop:function(){try{Promise.resolve(stop('smart')).catch(function(){});}catch(_){}},
      hold:function(){cancelGroupRoute();cancelFightRoute();cancelFarmApproach('terrain recovery pause');resetCombatMovement();},
      position:function(r,remaining){root.partyCombatPosition={at:Date.now(),mode:'formation-path-'+r.phase,movementOwner:'formation-recovery',
        target:groupedCombat.target.id,reason:r.reason || (r.mover===character.name?'routing to combat position':'waiting for '+r.mover),
        recoveryId:r.id,mover:r.mover,attempt:r.attempt,destination:r.goal || r.goals[(r.attempt-1)%r.goals.length],remaining:remaining};},
      log:function(phase,r){queueCombatEvent('navigation','Formation recovery: '+phase,r,'formation-recovery:'+r.id+':'+phase+':'+r.attempt);},
      debug:function(){return !!root.partyFormationRecoveryDebug;},
      draw:function(goal,points){
        if(typeof draw_line!=='function')return [];
        var drawings=[draw_line(character.x,character.y,goal.x,goal.y,2,can_move_to(goal.x,goal.y)?0x55dd88:0xee5555)];
        var from=character;points.forEach(function(p){drawings.push(draw_line(from.x,from.y,p.x,p.y,2,0x55bbff));from=p;});
        if(typeof draw_circle==='function')drawings.push(draw_circle(goal.x,goal.y,8,2,0xffdd55));
        return drawings;
      }
    };
  }
  function formationRecoverySafePoint(point) {
    var saved=formationFrame;
    var enemies=Object.values(parent.entities || {}).filter(function(e){return e && e.type==='monster' && e.visible && !e.dead &&
      (!e.map || e.map===character.map) && (e.in==null || e.in===character.in);});
    formationFrame={self:formationBody(character),enemies:enemies,attackers:enemies.filter(function(e){return e.target===character.name;}),motions:new Map()};
    try {
      var members=formationMembers(), priest=members.find(function(m){return m.ctype==='priest';});
      var target=groupedCombat && groupedCombat.target;
      if(!priest)return safeCombatPoint(point,target) && formationSegmentSafe(character,point,enemies);
      var range=Number(priest.range), safeRange=range-Math.min(20,Math.max(8,range*0.1));
      return formationStepSafe(point,target || {},priest,priest.name===character.name,members,safeRange);
    } finally {formationFrame=saved;}
  }
  function formationDesiredRange(reference, priest, selfPriest, members, step) {
    var desired=desiredCombatRange();
    if(!selfPriest)return desired;
    var safeRange=Number(priest.range)-Math.min(20,Math.max(8,Number(priest.range)*0.1));
    members.forEach(function(ally){
      if(formationMelee(ally) && formationDistance(ally,reference)>Number(ally.range)+3)
        desired=Math.min(desired,Math.max(1,Number(ally.range)-2+safeRange-step));
    });
    return desired;
  }
  function formationStepSafe(point, reference, priest, selfPriest, members, safeRange) {
    if(!safeCombatPoint(point,reference))return false;
    var body=formationBody(character,point);
    var covered=selfPriest ? members.every(function(ally){return ally.name===character.name ||
      formationDistance(body,ally)<=Math.max(safeRange,formationDistance(character,ally))+0.01;}) :
      formationDistance(body,priest)<=Math.max(safeRange,formationDistance(character,priest))+0.01;
    if(!covered)return false;
    var obstacles=formationFrame.enemies.filter(function(e){return e.id!==reference.id || !formationMelee(character);});
    return priestSecondaryClearance(point,obstacles).risk<=priestSecondaryClearance(character,obstacles).risk+0.01;
  }
  function holdFormation(reference, reason) {
    var destination=kiteState.destination;
    if(destination && character.moving && Math.hypot(character.going_x-destination.x,character.going_y-destination.y)<2) {
      try {Promise.resolve(stop("move")).catch(function(){});}catch(_){}
    }
    kiteState.destination=null;formationState.warriorSegment=null;
    root.partyCombatPosition={at:Date.now(),target:reference.id,mode:"formation-hold",movementOwner:"combat",intent:"hold",
      reason:reason,constraint:reason,distance:combatDistance(reference),desiredRange:desiredCombatRange()};
    return true;
  }

  var formationPerformance = { ticks: 0, totalMs: 0, maxMs: 0, candidates: 0, collisionChecks: 0 };
  function formationMove(target) {
    if(root.partyQueueClient && root.partyQueueClient.formation && root.partyQueueClient.formation.movement())return true;
    var context = [character.map, character.in, character.rip, joinedEvent, eventTraveling].join(":");
    if (formationState.mapContext !== context) {
      formationState.mapContext = context; formationState.approachProgress = null; formationState.recovery = null;
    }
    var started = typeof performance !== "undefined" ? performance.now() : Date.now();
    var enemies = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; }).filter(function (e) {
      return e && e.visible && !e.dead && e.type === "monster" && (!e.map || e.map === character.map) &&
        !(root.partyRoleRunner && root.partyRoleRunner.isKnownDead(e.id)) &&
        (e.in == null || character.in == null || e.in === character.in);
    });
    formationFrame = { attackers: enemies.filter(function (e) { return e.target === character.name; }),
      enemies: enemies, motions: new Map(), self: formationBody(character) };
    try { return solveFormationMove(target); }
    finally {
      var elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
      formationPerformance.ticks++; formationPerformance.totalMs += elapsed;
      formationPerformance.maxMs = Math.max(formationPerformance.maxMs, elapsed);
      root.partyCombatPerformance = formationPerformance;
      formationFrame = null;
    }
  }
  function solveFormationMove(target) {
    var mageEscort = farmingMode !== "scatter" && character.ctype === "mage" && !!leader && (leader === character.name || followLeader) && !eventTraveling;
    if (!groupedFarming() && !mageEscort) return false;
    var members = formationMembers().filter(function (member) {
      if (typeof groupedCombat !== "undefined" && groupedCombat && groupedCombat.protocol === 4 &&
          groupedCombat.recovering.indexOf(member.name) >= 0) return false;
      return typeof sameEventTeamMember !== "function" || sameEventTeamMember(member);
    });
    var healerName = typeof groupedCombat !== "undefined" && groupedCombat && groupedCombat.priest || formationState.priest;
    var priest = members.filter(function (member) { return member.ctype === "priest"; })
      .sort(function (a, b) { return Number(b.name === healerName) - Number(a.name === healerName) ||
        String(a.name).localeCompare(String(b.name)); })[0];
    if (!priest) { formationState.priest = null; return false; }
    var selfPriest = priest.name === character.name;
    var healRange = Number(priest.range) || 0;
    if (!healRange) return false;
    var safeRange = healRange - Math.min(20, Math.max(8, healRange * 0.1));
    var attackers = formationFrame.attackers;
    var chased = attackers.length > 0;
    var reference = target || attackers.sort(function (a, b) { return combatDistance(a) - combatDistance(b); })[0];
    if (!reference) return false;
    if (formationState.priest !== priest.name || formationState.targetId !== reference.id) {
      formationState.priest = priest.name; formationState.targetId = reference.id; formationState.direction = 1;
      formationState.secondaryDirection = 0; formationState.secondaryMoving = false;
      formationState.warriorPhase = null; formationState.warriorSegment = null;
      if (formationMelee(character)) kiteState.destination = null;
    }
    var step = Math.max(1, Number(character.speed || 40) * 0.6);
    var meleeReady=formationMelee(character) && is_in_range(reference);
    var recoveryCandidate = meleeReady ? false : recoverFormationCorner(reference, priest, selfPriest, members, step);
    // A stalled healer can fence in the warrior even when its own straight line is clear.
    // Recovery must respond to the party's inability to engage, not only a wall hit.
    var stalled=formationState.approachProgress && Date.now()-formationState.approachProgress.at>=1500;
    var fighter=members.find(function(m){return formationMelee(m);});
    var meleeGap=fighter ? Math.max(0,formationDistance(fighter,reference)-Number(fighter.range)) : 0;
    var meleeProgress=formationState.meleeProgress;
    if(!meleeProgress || meleeProgress.target!==reference.id || meleeGap<meleeProgress.gap-8)
      meleeProgress=formationState.meleeProgress={target:reference.id,gap:meleeGap,at:Date.now()};
    var needsMelee=meleeGap>3 && Date.now()-meleeProgress.at>=1500;
    if(selfPriest && stalled && needsMelee && !(recoveryCandidate && recoveryCandidate.blocked) && root.partyQueueClient && root.partyQueueClient.formation && terrainRecoveryContext().allowed) {
      proposeTerrainRecovery(reference,formationDesiredRange(reference,priest,selfPriest,members,step));
    }

    var desired = formationDesiredRange(reference, priest, selfPriest, members, step);
    var warrior = formationMelee(character);
    var mage = character.ctype === "mage";
    var priestSpacing = 25;
    var warriorPhaseBefore = formationState.warriorPhase;
    if (warrior) {
      if (!is_in_range(reference))
        formationState.warriorPhase = "approaching";
      if (is_in_range(reference)) formationState.warriorPhase = "melee-kiting";
    }
    var closing = warrior && formationState.warriorPhase === "approaching";
    var secondary = selfPriest || mage ? formationFrame.enemies.filter(function (enemy) {
      if (!mage && enemy.id === reference.id) return false;
      // Keep every enemy capable of entering the swept safety area, with a
      // nearby clearance preference zone. Distant mobs must
      // not make an otherwise settled formation orbit forever.
      var motion = formationMotion(enemy);
      formationFrame.motions.set(enemy, motion);
      return formationDistance(character, enemy) <= Math.max(160,
        motion.safety + step + (Number(enemy.speed) || 0) * 0.6 + 40);
    }) : [];
    var avoiding = secondary.length > 0;
    var heldClearance = avoiding ? priestSecondaryClearance(character, secondary) : null;
    var px = character.x - priest.x, py = character.y - priest.y, plen = Math.hypot(px, py) || 1;
    var tangent = selfPriest ? { x: character.x - reference.x, y: character.y - reference.y }
      : { x: -py / plen * formationState.direction, y: px / plen * formationState.direction };
    var tlen = Math.hypot(tangent.x, tangent.y) || 1; tangent.x /= tlen; tangent.y /= tlen;
    function metrics(point) {
      var candidate = formationBody(character, point);
      var coverage = selfPriest ? members.reduce(function (worst, ally) {
        return ally.name === character.name ? worst : Math.max(worst, formationDistance(candidate, ally) - safeRange);
      }, 0) : Math.max(0, formationDistance(candidate, priest) - safeRange);
      var danger = attackers.reduce(function (sum, enemy) {
        // A melee warrior must enter the selected enemy's attack radius to
        // fight it. Other attackers retain their full avoidance priority.
        if (warrior && enemy.id === reference.id) return sum;
        var definition = G.monsters && G.monsters[enemy.mtype] || {};
        var limit = Number(enemy.range || definition.range) || 20;
        // Immediate danger means moving deeper into an existing attack zone.
        var before = Math.max(0, limit + 4 - formationDistance(character, enemy));
        return sum + Math.max(0, limit + 4 - formationDistance(candidate, enemy) - before);
      }, 0);
      var rangeError = Math.abs(formationDistance(candidate, reference) - desired);
      var towardPriestX = priest.x - reference.x, towardPriestY = priest.y - reference.y;
      var facing = !selfPriest && ((point.x - reference.x) * towardPriestX +
        (point.y - reference.y) * towardPriestY < 0) ? 1 : 0;
      var dx = point.x - character.x, dy = point.y - character.y;
      var progress = dx * tangent.x + dy * tangent.y;
      var heading = Math.atan2(dy, dx);
      var turn = formationState.heading == null ? 0 : 1 - Math.cos(heading - formationState.heading);
      var clearance = avoiding ? priestSecondaryClearance(point, secondary) : null;
      var secondaryRisk = clearance ? clearance.risk : 0;
      var orbitCross = (character.x - reference.x) * (point.y - character.y) -
        (character.y - reference.y) * (point.x - character.x);
      return { point: point, coverage: coverage, danger: danger, rangeError: rangeError,
        clearance: clearance, direction: Math.abs(orbitCross) < 0.01 ? 0 : Math.sign(orbitCross),
        facing: facing, progress: progress, heading: heading, turn: turn,
        score: mage ? [Math.round((danger + secondaryRisk) * 2), Math.ceil(coverage / 2), facing,
          Math.ceil(Math.max(0, formationDistance(candidate, reference) - Number(character.range)) / 3),
          Math.ceil(Math.max(0, formationDistance(candidate, priest) - priestSpacing) / 3),
          chased ? -progress : Math.hypot(dx, dy), rangeError, turn] :
          [Math.round((danger + secondaryRisk) * 2), Math.ceil(coverage / 2),
          closing ? rangeError : facing,
          closing ? facing : Math.floor(Math.max(0, rangeError - 3) / 3),
          clearance ? -clearance.minimum : 0, clearance ? -clearance.end : 0,
          chased ? -progress : Math.hypot(dx, dy),
          selfPriest ? 0 : -formationDistance(candidate, priest), turn] };
    }
    var current = metrics(character);
    if(recoveryCandidate && !recoveryCandidate.blocked && formationStepSafe(recoveryCandidate,reference,priest,selfPriest,members,safeRange)) {
      sendCombatMove(reference,recoveryCandidate,"formation-regrouping");
      root.partyCombatPosition.reason="local detour around blocked approach";
      root.partyCombatPosition.coverageDeficit=metrics(recoveryCandidate).coverage;
      return true;
    }
    if(recoveryCandidate && !recoveryCandidate.blocked && !chased &&
        root.partyQueueClient && root.partyQueueClient.formation && terrainRecoveryContext().allowed) {
      var terrainGoal=combatApproachPoint(reference,desired);
      if(!can_move_to(terrainGoal.x,terrainGoal.y)) {
        holdFormation(reference,"terrain detour requires temporary separation");
        root.partyCombatPosition.constraint="terrain-blocked approach";
        proposeTerrainRecovery(reference,desired);
        return true;
      }
    }
    if(recoveryCandidate && recoveryCandidate.blocked && !chased) {
      holdFormation(reference,"no safe local detour; waiting for an opening");
      root.partyCombatPosition.mode="formation-blocked";
      root.partyCombatPosition.constraint=recoveryCandidate.reason;
      proposeTerrainRecovery(reference,desired);
      return true;
    }

    var warriorMoveReason = "new segment";
    if (warrior) {
      var segment = formationState.warriorSegment;
      var held = segment && metrics(segment.point);
      var remaining = segment ? Math.hypot(character.x - segment.point.x, character.y - segment.point.y) : 0;
      var safeHeld = held && formationStepSafe(segment.point, reference, priest, selfPriest, members, safeRange) && held.danger <= 0 &&
        held.coverage <= current.coverage && !held.facing;
      var usefulHeld = held && (closing ? held.rangeError < current.rangeError - 0.5 : held.rangeError <= 5);
      warriorMoveReason = !segment ? "new target or formation" : !safeHeld ? "segment became unsafe" :
        warriorPhaseBefore !== formationState.warriorPhase ? "melee state changed" :
        !usefulHeld ? "target moved" : remaining <= Number(character.speed) * 0.15 ? "segment nearly complete" : "segment refresh";
      if (segment && character.moving && safeHeld && usefulHeld &&
          warriorPhaseBefore === formationState.warriorPhase && Date.now() - segment.sentAt < 250 &&
          remaining > Number(character.speed) * 0.15) {
        root.partyCombatPosition = Object.assign({}, root.partyCombatPosition, {
          at: Date.now(), distance: combatDistance(reference), warriorPhase: formationState.warriorPhase,
          healingDistance: formationDistance(character, priest), movementReason: "retaining safe segment" });
        return true;
      }
    }
    if (((!avoiding && !mage && current.rangeError <= 3 && (!warrior || meleeReady)) ||
        (mage && formationDistance(character, priest) <= priestSpacing && combatDistance(reference) <= Number(character.range) &&
          (!heldClearance || heldClearance.risk === 0))) && !chased && current.coverage <= 0 && !current.facing) {
      holdFormation(reference,"settled in formation");
      kiteState.targetId = null;
      if (warrior && formationState.warriorSegment) {
        if (character.moving) { try { Promise.resolve(stop("move")).catch(function () {}); } catch (_) {} }
        formationState.warriorSegment = null;
      }
      root.partyCombatPosition = { at: Date.now(), mode: "formation-hold", movementOwner: "combat",
        priest: priest.name, healingDistance: selfPriest ? 0 : formationDistance(character, priest),
        healingRange: safeRange, target: reference.id, desiredRange: desired, distance: combatDistance(reference) };
      return true;
    }
    var points = [];
    if (avoiding || warrior && chased && !closing) {
      var radial = Math.hypot(character.x - reference.x, character.y - reference.y);
      var ring = desired + Math.max(0, radial - combatDistance(reference));
      var bearing = Math.atan2(character.y - reference.y, character.x - reference.x);
      [1, -1].forEach(function (sign) {
        var turn = Math.min(0.5, step / Math.max(1, ring));
        var destination = { x: reference.x + ring * Math.cos(bearing + sign * turn),
          y: reference.y + ring * Math.sin(bearing + sign * turn) };
        var length = Math.hypot(destination.x - character.x, destination.y - character.y);
        var fraction = Math.min(1, step / Math.max(1, length));
        points.push({ x: character.x + (destination.x - character.x) * fraction,
          y: character.y + (destination.y - character.y) * fraction });
      });
    }
    for (var i = 0; i < 32; i++) {
      var angle = i * Math.PI / 16;
      points.push({ x: character.x + Math.cos(angle) * step, y: character.y + Math.sin(angle) * step });
      points.push({ x: character.x + Math.cos(angle) * step * 0.5, y: character.y + Math.sin(angle) * step * 0.5 });
    }
    // Include exact range corrections, so stationary formations don't oscillate
    // between fixed-size steps on either side of the desired radius.
    var ideal = combatApproachPoint(reference, desired), dx = ideal.x - character.x, dy = ideal.y - character.y;
    var len = Math.hypot(dx, dy);
    if (len > 0.5 && (closing || !chased || len > Number(character.speed) * 0.2))
      points.push({ x: character.x + dx * Math.min(1, step / len), y: character.y + dy * Math.min(1, step / len) });
    if (mage) {
      var priestDistance = Math.hypot(character.x - priest.x, character.y - priest.y);
      var approach = Math.min(step, Math.max(0, priestDistance - priestSpacing));
      if (approach > 0) points.push({ x: character.x + (priest.x - character.x) / priestDistance * approach,
        y: character.y + (priest.y - character.y) / priestDistance * approach });
    }
    formationPerformance.candidates += points.length;
    var candidates = points.map(metrics);
    function collisionSafe(candidate) {
      if (candidate.safe === undefined) candidate.safe = formationStepSafe(candidate.point, reference, priest, selfPriest, members, safeRange) &&
        (!mage || !candidate.clearance || candidate.clearance.risk <= heldClearance.risk + 0.01);
      return candidate.safe;
    }
    candidates.sort(function (a, b) {
      for (var i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
      return 0;
    });
    var best = candidates.find(collisionSafe);
    if (!best) {
      holdFormation(reference,"no safe formation step");
      if (warrior && formationState.warriorSegment) {
        if (character.moving) { try { Promise.resolve(stop("move")).catch(function () {}); } catch (_) {} }
        formationState.warriorSegment = null;
      }
      root.partyCombatPosition = { at: Date.now(), mode: "formation-blocked", priest: priest.name,
        movementOwner: "combat", target: reference.id, constraint: "no collision-safe segment" };
      if (avoiding) Object.assign(root.partyCombatPosition, { nearestOtherMonster: heldClearance.nearest,
        secondaryClearance: heldClearance.current, predictedSecondaryClearance: heldClearance.minimum,
        avoidanceDirection: formationState.secondaryDirection || 0, avoidanceReason: "both arcs blocked" });
      return true;
    }
    if(closing && !attackers.some(function(e){return e.id!==reference.id;}) && best.rangeError>=current.rangeError-0.5 && best.coverage>=current.coverage-0.5 && best.danger>=current.danger) {
      holdFormation(reference,"waiting for healing coverage or a clear melee approach");
      root.partyCombatPosition.constraint="melee approach constrained";
      return true;
    }
    if(!chased && (!avoiding || mage)) {
      var improvement=best.danger<current.danger-0.5 || best.coverage<current.coverage-0.5 ||
        best.rangeError<current.rangeError-0.5 || mage && formationDistance(formationBody(character,best.point),priest)<formationDistance(character,priest)-0.5 ||
        best.clearance && (best.clearance.risk<current.clearance.risk-0.01 || best.clearance.minimum>current.clearance.minimum+5);
      if(!improvement)return holdFormation(reference,"no meaningful safe improvement");
    }
    if (warrior && chased && !closing) {
      // Retain our arc direction whenever it meets the same safety, healing,
      // facing and attack-range constraints as the best alternative.
      var sameDirection = candidates.find(function (candidate) {
        return candidate.progress > 1 && collisionSafe(candidate) && candidate.score.slice(0, 4).every(function (value, i) {
          return value <= best.score[i];
        });
      });
      if (sameDirection) best = sameDirection;
    }
    if (avoiding && !mage) {
      function advantage(a, b) {
        return Math.max(a.clearance.minimum - b.clearance.minimum, a.clearance.end - b.clearance.end);
      }
      var preferred = candidates.find(function (candidate) {
        return candidate.direction === formationState.secondaryDirection && collisionSafe(candidate) &&
          candidate.score.slice(0, 4).every(function (value, i) { return value === best.score[i]; });
      });
      var reason = "increasing secondary clearance";
      if (preferred && advantage(best, preferred) < 5) { best = preferred; reason = "retaining arc direction"; }
      var preventsEncroachment = heldClearance.minimum < heldClearance.current - 0.5 &&
        best.clearance.minimum >= heldClearance.current - 0.5;
      if (!chased && current.coverage <= 0 && current.rangeError <= 3 && best.score[0] >= current.score[0] &&
          (best.score[0] > current.score[0] || best.score[1] > current.score[1] || best.rangeError > 3 ||
           !preventsEncroachment && advantage(best, current) < 5)) {
        kiteState.targetId = null;
        // Retire an obsolete direct destination when holding is now equally safe.
        holdFormation(reference,"no meaningful safe improvement");
        formationState.secondaryMoving = false;
        root.partyCombatPosition = { at: Date.now(), mode: "formation-hold", movementOwner: "combat",
          priest: priest.name, target: reference.id, desiredRange: desired, distance: combatDistance(reference),
          nearestOtherMonster: heldClearance.nearest, secondaryClearance: heldClearance.current,
          predictedSecondaryClearance: heldClearance.minimum, avoidanceReason: "no meaningful safe improvement",
          avoidanceDirection: formationState.secondaryDirection || 0 };
        return true;
      }
      if (formationState.secondaryDirection && best.direction && best.direction !== formationState.secondaryDirection)
        reason = preferred ? "reversing for safer clearance" : "reversing around blocked or infeasible arc";
      if (best.direction) formationState.secondaryDirection = best.direction;
      formationState.secondaryMoving = true;
      formationState.avoidanceDetail = { nearestOtherMonster: heldClearance.nearest,
        secondaryClearance: heldClearance.current, predictedSecondaryClearance: best.clearance.minimum,
        endpointSecondaryClearance: best.clearance.end, avoidanceDirection: best.direction,
        avoidanceReason: reason };
    }
    if (!selfPriest && chased && !closing && best.progress < -1) {
      formationState.direction *= -1;
      if (warrior) warriorMoveReason = "reversing for formation safety or range";
    }
    formationState.heading = best.heading;
    kiteState.targetId = chased ? attackers[0].id : null;
    sendCombatMove(reference, best.point, closing ? "formation-approaching" : chased ? "formation-kiting" : "formation-positioning");
    if (warrior) {
      formationState.warriorSegment = { point: best.point, sentAt: Date.now() };
      root.partyCombatPosition.warriorPhase = formationState.warriorPhase;
      root.partyCombatPosition.movementReason = warriorMoveReason;
    }
    root.partyCombatPosition = Object.assign({}, root.partyCombatPosition, avoiding ? formationState.avoidanceDetail : {}, { priest: priest.name,
      healingDistance: selfPriest ? 0 : formationDistance(character, priest), healingRange: safeRange, coverageDeficit:best.coverage,
      targetRevision: leaderCombatSelection && leaderCombatSelection.revision,
      constraint: best.danger > 0 ? "immediate danger" : best.clearance && best.clearance.risk > 0 ? "monster avoidance" : best.coverage > 0 ? "recovering healing coverage" :
        best.rangeError > 3 ? "weapon range sacrificed" : null });
    return true;
  }

  function desiredCombatRange() {
    var range = Math.max(1, Number(character.range) || 25);
    return Math.max(1, range - Math.min(12, Math.max(2, range * 0.05)));
  }
  function combatDistance(target) {
    var corrected = root.sharedRoutine && root.sharedRoutine.correctedCombatDistance && root.sharedRoutine.correctedCombatDistance(target);
    if (typeof corrected === "number") return corrected;
    return typeof distance === "function" ? distance(character, target) :
      Math.hypot(character.x - target.x, character.y - target.y);
  }
  function combatApproachPoint(target, desired) {
    if (!target) return null;
    var dx = character.x - target.x, dy = character.y - target.y, length = Math.hypot(dx, dy);
    if (length < 0.001) { dx = 1; dy = 0; length = 1; }
    // Translate the engine's hitbox-aware attack distance into a center radius.
    var radius = (desired == null ? desiredCombatRange() : desired) + Math.max(0, length - combatDistance(target));
    return { x: target.x + dx / length * radius, y: target.y + dy / length * radius };
  }
  function resetCombatMovement() {
    // Only cancel the exact direct segment still owned by combat. Navigation
    // may already have installed another destination since the last tick.
    var dest = kiteState.destination;
    if (dest && character.moving && Number.isFinite(character.going_x) && Number.isFinite(character.going_y) &&
        Math.hypot(character.going_x - dest.x, character.going_y - dest.y) < 2) {
      try { Promise.resolve(stop("move")).catch(function () {}); } catch (_) {}
    }
    formationState.recovery = null;
    root.partyCombatPosition = { at: Date.now(), mode: "idle", movementOwner: null, target: null,
      reason: "no valid target or immediate threat" };
    formationState.warriorPhase = null; formationState.warriorSegment = null;
    formationState.approachProgress = null; formationState.approachIdentity = null; formationState.recovery = null;
    kiteState.targetId = null; kiteState.destination = null; kiteState.mode = "idle";
  }
  function sendCombatMove(target, destination, mode) {
    var now = Date.now(), old = kiteState.destination;
    var timing=root.__partyQueueTiming;
    if(timing && timing.target===target.id && !timing.firstMovementAt)timing.firstMovementAt=now;
    if (old && character.moving && Math.hypot(old.x - destination.x, old.y - destination.y) < 2 &&
        Math.hypot(character.x - old.x, character.y - old.y) > Math.max(4, character.speed * 0.25)) return true;
    kiteState.destination = destination; kiteState.lastMoveAt = now; kiteState.mode = mode;
    root.partyCombatPosition = { at: now, target: target.id, distance: combatDistance(target),
      desiredRange: desiredCombatRange(), mode: mode, movementOwner: "combat", intent:"approach", destination:destination, issuedAt:now };
    try { Promise.resolve(move(destination.x, destination.y)).catch(function (error) {
      if(kiteState.destination===destination)root.partyCombatPosition.reason="movement rejected: "+String(error && error.message || error);
    }); } catch (error) { root.partyCombatPosition.reason="movement rejected: "+String(error && error.message || error); }
    return true;
  }
  function safeCombatPoint(point, target) {
    formationPerformance.collisionChecks++;
    if (typeof can_move_to !== "function" || !can_move_to(point.x, point.y)) return false;
    // Do not gain distance from one attacker by stepping closer to another
    // attacker already inside its striking range.
    return (formationFrame ? formationFrame.attackers : Object.keys(parent.entities || {}).map(function (id) {
      return parent.entities[id];
    })).every(function (enemy) {
      // CODE snapshots/proxies need not share object references with parent.entities.
      // The selected monster must never become its own secondary-attacker barrier.
      if (!enemy || target && enemy.id === target.id && (!enemy.map || !target.map || enemy.map === target.map) &&
          (enemy.in == null || target.in == null || enemy.in === target.in) || enemy.type !== "monster" || !enemy.visible || enemy.dead ||
          enemy.target !== character.name) return true;
      var before = Math.hypot(character.x - enemy.x, character.y - enemy.y);
      var after = Math.hypot(point.x - enemy.x, point.y - enemy.y);
      return after >= Math.min(before, Number(enemy.range) || 30) - 1;
    });
  }
  async function kiteIfNeeded(target) {
    var attacker = target && target.target === character.name ? target : Object.keys(parent.entities || {})
      .map(function (id) { return parent.entities[id]; }).filter(function (enemy) {
        return enemy && enemy.type === "monster" && enemy.visible && !enemy.dead && enemy.target === character.name;
      }).sort(function (a, b) { return combatDistance(a) - combatDistance(b); })[0];
    if (!attacker || attacker.dead) { kiteState.targetId = null; return false; }
    if (kiteState.targetId !== attacker.id) { kiteState.targetId = attacker.id; kiteState.direction = 1; }
    var dx = character.x - attacker.x, dy = character.y - attacker.y;
    var radius = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
    var desired = desiredCombatRange() + Math.max(0, radius - combatDistance(attacker));
    var step = Math.max(1, (Number(character.speed) || 40) * 0.6);
    var turn = Math.min(0.65, step / Math.max(desired, radius, 1));
    var nextRadius = radius + Math.max(-step * 0.65, Math.min(step * 0.8, desired - radius));
    nextRadius = Math.max(1, nextRadius);
    var signs = [kiteState.direction || 1, -(kiteState.direction || 1)];
    for (var i = 0; i < signs.length; i++) {
      var nextAngle = angle + turn * signs[i];
      var point = { x: attacker.x + nextRadius * Math.cos(nextAngle), y: attacker.y + nextRadius * Math.sin(nextAngle) };
      if (safeCombatPoint(point, attacker)) {
        kiteState.direction = signs[i]; return sendCombatMove(attacker, point, "kiting");
      }
    }
    var outward = { x: character.x + Math.cos(angle) * step, y: character.y + Math.sin(angle) * step };
    if (safeCombatPoint(outward, attacker)) return sendCombatMove(attacker, outward, "escaping");
    root.partyCombatPosition = { at: Date.now(), target: attacker.id, distance: combatDistance(attacker),
      desiredRange: desiredCombatRange(), mode: "blocked", movementOwner: "combat" };
    return true;
  }
  async function approachCombatTarget(target) {
    if (!target || target.dead) return false;
    var delta = combatDistance(target) - desiredCombatRange();
    var tolerance = Math.min(3, Math.max(0.5, Number(character.range) * 0.01));
    if (Math.abs(delta) <= tolerance && is_in_range(target)) return false;
    var destination = combatApproachPoint(target);
    var dx = destination.x - character.x, dy = destination.y - character.y, length = Math.hypot(dx, dy);
    var step = Math.min(length, Math.max(1, Number(character.speed || 40) * 0.6));
    var angle = Math.atan2(dy, dx);
    for (var i = 0, offsets = [0, 0.4, -0.4, 0.8, -0.8]; i < offsets.length; i++) {
      var point = { x: character.x + Math.cos(angle + offsets[i]) * step,
        y: character.y + Math.sin(angle + offsets[i]) * step };
      if (safeCombatPoint(point, target)) return sendCombatMove(target, point, delta > 0 ? "approaching" : "retreating");
    }
    root.partyCombatPosition = { at: Date.now(), target: target.id, distance: combatDistance(target),
      desiredRange: desiredCombatRange(), mode: "blocked", movementOwner: "combat" };
    return false;
  }

  root.sharedRoutine = {
    merchantVisibilityActive: function () { return Date.now() < merchantVisibilityUntil; },
    describeAttackRange: function (target) {
      if (!target || target.mtype !== "crab" || typeof get_width !== "function" || typeof get_height !== "function") return null;
      var dimensions = G.dimensions && G.dimensions.crab;
      var size = Number(G.monsters.crab.size) || 1;
      var expected = { width: Math.round((dimensions ? dimensions[0] : 24) * size),
        height: Math.round((dimensions ? dimensions[1] : 24) * size) };
      var actor = { x: character.x, y: character.y, width: get_width(character), height: get_height(character) };
      var box = { x: get_x(target), y: get_y(target), width: get_width(target), height: get_height(target) };
      var correctedTarget = { x: box.x, y: box.y, width: expected.width, height: expected.height };
      return { targetId: target.id, map: character.map, mtype: target.mtype, at: Date.now(), range: character.range,
        actor: actor, target: box, expected: expected, nativeDistance: distance(character, target),
        correctedDistance: distance(actor, correctedTarget) };
    },
    start: function () {
      if (timer) return;
      tick();
      timer = setInterval(function(){ if (gameLogCapture) void gameLogCapture.pulse(); observeFarmArea(); tick(); }, 1000);
      reconcileGameParty();
      root.__partyRosterTimer = setInterval(reconcileGameParty, 5000);
      pollEvents();
      root.__partyEventTimer = setInterval(pollEvents, 10000);
      runAnniversaryTick();
      root.__partyAnniversaryTimer = setInterval(runAnniversaryTick, 1000);
      if (parent.socket && parent.socket.on) {
        parent.socket.on("server_info", receiveEventFeed);
        parent.socket.on("test", receiveEventClock);
        parent.socket.on("connect", syncEventClock);
        syncEventClock();
        eventClockTimer = setInterval(syncEventClock, 300000);
      }
      passiveRegenerationTick();
      root.__partyPassiveRegenTimer = setInterval(passiveRegenerationTick, 500);
      root.__partyReunionTimer = setInterval(function () {
        farmReunionTick().catch(function (error) {
          if (reunion) { reunion.lastError = String(error.reason || error.message || error); reunion.retryAt = Date.now() + 10000; }
        });
      }, 500);
      if (parent.socket && typeof parent.socket.on === "function")
        parent.socket.on("game_response", anniversaryItemReceived);
      if (parent.socket && typeof parent.socket.on === "function")
        parent.socket.on("game_response", anniversaryResponseListener);
      root.__partyMapTelemetryTimer = setInterval(publishMapFrame, 100);
      if (root.__partyDashboardTelemetryTimer) clearInterval(root.__partyDashboardTelemetryTimer);
      if (dashboardSampler) root.__partyDashboardTelemetryTimer = setInterval(dashboardSampler.pulse, 100);
      if (character.ctype === "merchant" && character.level >= 40) {
        root.__merchantLuckScanTimer = setInterval(function () {
          if (!character.moving) return;
          castLuckOnVisiblePlayers(600000, 4).catch(function () {});
        }, 750);
      }
      if (character.ctype === "merchant") {
        refreshPontyListings();
        root.__merchantPontyTimer = setInterval(refreshPontyListings, 10000);
      }
    },
    stop: function () {
      catalogGeneration++;
      retirePartyCombatSockets(partyCombatSocketOwner);
      cancelGroupRoute();
      cancelFightRoute();
      cancelRarePath(); rareControlState = null;
      if (root.__partyEscapeTimer) clearInterval(root.__partyEscapeTimer);
      root.__partyEscapeTimer = null;
      escapeState = null;
      if (root.__partyReunionTimer) clearInterval(root.__partyReunionTimer);
      if (root.on_cm === reunionCmHandler) root.on_cm = previousReunionCm;
      if (root.on_magiport === reunionMagiportHandler) root.on_magiport = previousMagiport;
      if (townTraveling) {
        root.__partyLastCommand = Math.min(Number(root.__partyLastCommand) || 0, lastCommand - 1);
      }
      if (convoyTraveling) {
        releaseConvoyCruise(convoyTraveling);
        convoyTraveling.cancelled = true;
        if (convoyTraveling.release) convoyTraveling.release();
        // The coordinator retains convoy commands until arrival. Allow a newly
        // evaluated shared script to accept this command again after hot reload.
        root.__partyLastCommand = Math.min(Number(root.__partyLastCommand) || 0,
          (Number(convoyTraveling.commandId) || 1) - 1);
      }
      if (convoyTraveling && typeof stop === "function") {
        try { stop("smart"); } catch (_navigationStopError) { /* Already stopped. */ }
      }
      if (timer) clearInterval(timer);
      if (gatheringTimer) clearInterval(gatheringTimer);
      if (root.__merchantGatheringTimer) clearInterval(root.__merchantGatheringTimer);
      if (root.__merchantLuckScanTimer) clearInterval(root.__merchantLuckScanTimer);
      if (root.__merchantPontyTimer) clearInterval(root.__merchantPontyTimer);
      if (root.__partyDashboardTelemetryTimer) clearInterval(root.__partyDashboardTelemetryTimer);
  if (root.__partyMapTelemetryTimer) clearInterval(root.__partyMapTelemetryTimer);
      if (root.__partyTrackerTimer) clearInterval(root.__partyTrackerTimer);
      if (root.__partyRestoreTrackerUI) root.__partyRestoreTrackerUI();
      if (root.__partyPlayerDirectoryTimer) clearInterval(root.__partyPlayerDirectoryTimer);
      if (root.__partyEventTimer) clearInterval(root.__partyEventTimer);
      if (root.__partyAnniversaryTimer) clearInterval(root.__partyAnniversaryTimer);
      if (root.__partyPassiveRegenTimer) clearInterval(root.__partyPassiveRegenTimer);
      if (root.__partyRosterTimer) clearInterval(root.__partyRosterTimer);
      if (root.__partyTownGuardTimer) {
        clearInterval(root.__partyTownGuardTimer);
        root.__partyTownGuardTimer = null;
      }
      if (parent.socket && typeof parent.socket.off === "function") {
        clearInterval(eventClockTimer);
        parent.socket.off("server_info", receiveEventFeed);
        parent.socket.off("test", receiveEventClock);
        parent.socket.off("connect", syncEventClock);
        parent.socket.off("game_response", donationRateListener);
        parent.socket.off("q_data", luckySlotRollListener);
        parent.socket.off("tracker", trackerCatalogListener);
        parent.socket.off("player", trackerInventoryListener);
        parent.socket.off("players", playerDirectoryListener);
        parent.socket.off("action", mapActionListener);
        parent.socket.off("hit", mapHitListener);
        parent.socket.off("action", combatActionListener);
        parent.socket.off("hit", combatHitListener);
        parent.socket.off("death", combatDeathListener);
        parent.socket.off("disappear", combatDisappearListener);
        parent.socket.off("entities", combatEntitiesDeathListener);
        parent.socket.off("kill_credit", combatKillCreditListener);
        parent.socket.off("disappearing_text", combatXpTextListener);
        parent.socket.off("chest_opened", combatLootListener);
        parent.socket.off("game_response", combatResponseListener);
        parent.socket.off("game_response", anniversaryItemReceived);
        parent.socket.off("game_response", anniversaryResponseListener);
      }
      timer = null;
      gatheringTimer = null;
      root.__merchantGatheringTimer = null;
      root.__merchantLuckScanTimer = null;
      root.__merchantPontyTimer = null;
      root.__partyMapTelemetryTimer = null;
      root.__partyTrackerTimer = null;
      root.__partyEventTimer = null;
      root.__partyAnniversaryTimer = null;
      root.__partyPassiveRegenTimer = null;
      root.__partyRosterTimer = null;
      if (root.on_party_invite === acceptConfiguredPartyInvite) root.on_party_invite = previousPartyInviteHandler;
      if (root.on_party_request === acceptConfiguredPartyRequest) root.on_party_request = previousPartyRequestHandler;
    },
    isBanking: function () { return banking || bankQueued; },
    merchantEventCombatActive: function () {
      return character.ctype === "merchant" && !!joinedEvent && eventSelected(joinedEvent) &&
        !eventReturnPending && !root.__merchantActiveJob;
    },
    isOccupied: function () {
      if (root.__partyUpgradePreviewInFlight) return true;
      if (root.__partyConsoleMaintenance) return true;
      if (convoyTraveling && (convoyTraveling.continuousReturn === 1 || convoyTraveling.purpose === 'monster-hunt' && convoyTraveling.huntTarget)) {
        root.__partyCombatOwner = "convoy:" + convoyTraveling.phase;
        return true;
      }
      if (character.ctype === "merchant" && (root.__merchantInventoryTidy || luckyUpgradeService && luckyUpgradeService.pending())) return true;
      if (travelCombatActive() && !departureCombatPending()) return true;
      if(root.partyLootClient && root.partyLootClient.huntPending() && !departureCombatPending())return true;
      if(convoyTraveling && !joinedEvent && !eventTargetTypes.length && Object.values(parent.entities||{}).some(function(e){
        return e && e.type==='monster' && e.visible && !e.dead && isAttackingPartyMember(e);
      }))interruptConvoyForDefense();
      if (combatRecoveryActive() && root.__partyCombatRecovery.phase!=='finishing') return true;
      if (escapeOwns()) return true;
      if (typeof rareActive === "function" && rareActive() && (rareControlState.kind === "patrol" || rareControlState.kind === "loot" || rarePath ||
          !groupedFarming() && rareControlState.deployer === character.name)) return true;
      // A convoy owns movement completely. Releasing the role loop for a
      // passing threat lets kiting/follow movement replace smart_move, which
      // caused QwenTina's one-step search/restart loop. Late joiners still use
      // the coordinator flag below and are not blocked without a local route.
      var convoyBlocksCombat = !!convoyTraveling && !convoyTraveling.defensePaused;
      root.__partyCombatOwner = convoyTraveling ? "convoy:" + convoyTraveling.phase : eventTraveling ? "event-travel" : followingLeader ? "follow" : null;
      if (reunion && !reunionBlocked() || banking || stocking || upgrading || forceTraveling || townTraveling || partyTownActive || convoyBlocksCombat || gatheringActive || followingLeader || eventTraveling || (anniversaryBusy || anniversaryStaging) && !root.__partyConvoyDefense) return true;
      if (departurePending || bankQueued) return !engagedMonster();
      return false;
    },
    isConvoyTraveling: function () { return !!convoyTraveling; },
    isStocking: function () { return stocking; },
    isUpgrading: function () { return upgrading; },
    stockUp: stockUp,
    getItemAvailability: itemAvailability,
    separateFromParty: async function (minimumDistance) {
      minimumDistance = minimumDistance || 16;
      if (banking || bankQueued || stocking || departurePending || partyConvoyActive || convoyTraveling || followingLeader || character.moving ||
          Date.now() - lastSeparationAt < 1500) return false;
      var overlapping = partyPositions.filter(function (member) {
        if (!member || member.name === character.name || member.map !== character.map) return false;
        var dx = member.x - character.x;
        var dy = member.y - character.y;
        return Math.sqrt(dx * dx + dy * dy) < minimumDistance;
      });
      if (!overlapping.length) return false;
      var names = overlapping.map(function (member) { return member.name; }).concat(character.name).sort();
      var position = names.indexOf(character.name);
      if (position === 0) return false;
      var hash = 0;
      for (var i = 0; i < character.name.length; i += 1)
        hash = (hash * 31 + character.name.charCodeAt(i)) >>> 0;
      var angle = hash % 360 * Math.PI / 180;
      var step = minimumDistance + 10 + position * 4;
      lastSeparationAt = Date.now();
      await move(character.x + Math.cos(angle) * step, character.y + Math.sin(angle) * step);
      return true;
    },
    regenerateHpOrMp: regenerateHpOrMp,
    useRecoveryPotion: useRecoveryPotion,
    smartLoot: smartLoot,
    absorbSinsBelow: absorbSinsBelow,
    healPartyBelow: healPartyBelow,
    energizeLowestMana: energizeLowestMana,
    rejoinActiveEventAfterRespawn: rejoinActiveEventAfterRespawn,
    beginFarmReunion: beginFarmReunion,
    getAbtestingMode: abtestingMode,
    isAbtestingPvp: isLiveAbtesting,
    runAbtestingSabotage: runAbtestingSabotage,
    dashToward: dashToward,
    isPartyHealthy: isPartyHealthy,
    emergencyWarriorStomp: emergencyWarriorStomp,
    isCurrentPartyTarget: isCurrentPartyTarget,
    kiteIfNeeded: kiteIfNeeded,
    approachCombatTarget: approachCombatTarget,
    targetRejectionReason: function (target) {
      if (!target) return "selected monster not visible";
      if (!leaderLockAllows(target)) return "waiting for fresh leader target";
      if (isExternallyClaimedMonster(target)) return "monster claimed outside party";
      return "target outside allowed combat selection";
    },
    recoverFarmApproach: recoverFarmApproach,
    resetCombatMovement: resetCombatMovement,
    formationMove: formationMove,
    groupedMovement: groupedMovement,
    groupedAttackAllowed: groupedAttackAllowed,
    terrainRecoveryPorts: terrainRecoveryPorts,
    queueReport: queueReport,
    queueSafePoint: formationRecoverySafePoint,
    queueRecoveryMove: function(p){var t=groupedCombat && groupedCombat.target;
      if(t && formationRecoverySafePoint(p))sendCombatMove(t,p,"fight-recovery");},
    queueCoverageCost: function(p){var a=groupedCombat && groupedCombat.anchor;return a && a.map===character.map && a.in===character.in ? Math.max(0,Math.hypot(p.x-a.x,p.y-a.y)-groupedCombat.range) : 0;},
    queueRecoveryReason: function(reason){root.partyCombatPosition={at:Date.now(),mode:"fight-recovery",movementOwner:"group",reason:reason};},
    queueMarkers: queueMarkers,
    combatTraceSnapshot: function(){var p=root.partyCombatPosition||{};return {
      mode:farmingMode,epoch:root.__partyCombatResetAt||0,queueRevision:groupedCombat&&groupedCombat.queueRevision,
      owner:p.movementOwner||null,reason:p.reason||p.mode,cell:[Math.round(character.x/8),Math.round(character.y/8)],
      target:(activeCombatTarget()||{}).id,markers:queueMarkers().map(function(t){return {id:t.id,role:t.role,visible:t.visible};}),
      departure:!!(root.partyLootClient&&root.partyLootClient.huntPending()),cancelled:navigationIntent.cancelled,
      approach:groupedApproachReport(),pursuit:groupedCombat && groupedCombat.pursuit,
      nominations:root.__partyNomination||null,
      convoy:convoyTraveling&&convoyTraveling.id,rare:rareControlState&&rareControlState.id};},
    acceptCombatControl: acceptCombatControl,
    queueClockOffset: function(){return coordinatorClockOffset;},
    queueMembers: function(){return currentPartyList();},
    queueRequest: function(body){return request('/status',{method:'POST',body:Object.assign({name:character.name},body)});},
    acceptQueue: acceptQueue,
    sharedTargetId: function(){return groupedFarming() && groupedCombat && groupedCombat.target && groupedCombat.target.id || null;},
    queueEvidence: function(target,state,action){return root.partyQueueClient && root.partyQueueClient.evidence(target,state,action);},
    usesGroupedCombat: groupedFarming,
    defensiveFormationMove: function () {
      if (!groupedFarming()) return false;
      var threat = Object.keys(parent.entities || {}).map(function (id) { return parent.entities[id]; })
        .filter(function (enemy) { return enemy && enemy.visible && !enemy.dead && enemy.type === "monster" &&
          (!enemy.map || enemy.map === character.map) && (enemy.in == null || character.in == null || enemy.in === character.in) &&
          enemy.target === character.name; }).sort(function (a, b) { return combatDistance(a) - combatDistance(b); })[0];
      if (!threat) return false;
      // No attack target: only evade an attacker that can reach us shortly.
      var definition = G.monsters && G.monsters[threat.mtype] || {};
      if (combatDistance(threat) > (Number(threat.range || definition.range) || 20) +
          (Number(threat.speed) || 0) * 0.6 + 20) return false;
      kiteIfNeeded(threat).catch(function () {});
      if (root.partyCombatPosition) root.partyCombatPosition.reason = "defending against " + threat.id;
      return true;
    },
    pollFarmingCombatHandoff: function () {
      if (typeof unfinishedFight === "function" && unfinishedFight()) return;
      if (typeof rareActive === "function" && rareActive()) return;
      if (!followingLeader || navigationIntent.cancelled || activeCombatEvent() ||
          banking || bankQueued || stocking || upgrading || forceTraveling || townTraveling ||
          partyTownActive || convoyTraveling || partyConvoyActive || gatheringActive ||
          eventTraveling || anniversaryBusy || anniversaryStaging || departurePending || reunion) return;
      var target = farmingTravelTarget({ location: partyLocation });
      if (!target || !is_in_range(target) && !can_move_to(combatApproachPoint(target).x, combatApproachPoint(target).y)) return;
      Promise.resolve(stop("smart")).catch(function () {});
      followingLeader = false;
      combatTargetId = target.id;
    },
    pollFarmingSpawnRecovery: function () {
      if (typeof unfinishedFight === "function" && unfinishedFight()) return;
      if (typeof rareActive === "function" && rareActive()) return;
      if (groupedFarming() && groupedCombat && !groupedCovered()) return;
      if (character.name !== leader || farmingMode === "scatter" || !partyLocation ||
          navigationIntent.cancelled || activeCombatEvent() || joinedEvent ||
          G.maps && G.maps[character.map] && G.maps[character.map].event ||
          banking || bankQueued || stocking || upgrading || forceTraveling || townTraveling ||
          partyTownActive || convoyTraveling || partyConvoyActive || gatheringActive ||
          eventTraveling || anniversaryBusy || anniversaryStaging || departurePending || reunion ||
          engagedMonster() || partyTargets.length || visibleFocusedMonsterWithinRadius()) {
        farmingSpawnMissingSince = 0; return;
      }
      if (inFarmArea(character, partyLocation, 0)) { farmingSpawnMissingSince = 0; return; }
      if (!farmingSpawnMissingSince) farmingSpawnMissingSince = Date.now();
      if (Date.now() - farmingSpawnMissingSince < 1500 || farmingSpawnRecoveryPending ||
          Date.now() < farmingSpawnRecoveryRetryAt) return;
      farmingSpawnRecoveryPending = true;
      request("/farming-return", { method: "POST", body: {
        character: character.name, location: partyLocation,
      }}).then(function (result) {
        if (result && result.ok && !result.skipped) {
          farmingSpawnMissingSince = 0;
          root.__partyNavigationDetail = "Returning to farming spawn after target area emptied";
        }
      }).catch(function () { farmingSpawnRecoveryRetryAt = Date.now() + 3000; })
        .finally(function () { farmingSpawnRecoveryPending = false; });
    },
    basicAttackReserved: function () {
      if (character.ctype !== "priest") return false;
      if (healingBusy) return true;
      if (character.mp < Number(G.skills.heal && G.skills.heal.mp || 0)) return false;
      return partyPositions.some(function (member) {
        if (!member || !sameEventTeamMember(member) || member.rip || member.map !== character.map) return false;
        var live = member.name === character.name ? character : get_player(member.name);
        return live && !live.rip && live.max_hp > 0 && live.hp / live.max_hp < 0.9 && can_heal(live);
      });
    },
    shouldFollowLeader: function () {
      if (navigationIntent.cancelled && !activeCombatEvent()) return false;
      if (typeof groupedFarming === "function" && groupedFarming() && groupedCombat && groupedCombat.protocol === 4) return groupedFollower();
      if (!(followLeader && leader && leader !== character.name)) return false;
      if (!isLiveAbtesting()) return true;
      var leaderStatus = partyPositions.find(function (member) { return member && member.name === leader; });
      return !!(leaderStatus && leaderStatus.team === eventTeam(character));
    },
    isLeader: function () { return (leader || character.name) === character.name; },
    combatContext: function () {
      var event = activeCombatEvent();
      var roster = currentPartyList();
      var allies = [character].concat(roster.filter(function(name){return name !== character.name;})
        .map(function(name){return get_player(name);})).filter(function(member){
          return member && !member.rip && member.hp > 0 && member.ctype !== "merchant" &&
            member.map === character.map && member.in === character.in && sameEventTeamMember(member);
        });
      var monsters = Object.values(parent.entities || {}).filter(function(m){
        return m && m.type === "monster" && m.visible !== false && !m.dead && m.hp > 0 &&
          (!m.map || m.map === character.map) && (m.in == null || m.in === character.in);
      }).map(function(m){
        var def = G.monsters[m.mtype] || {};
        return Object.assign({}, def, m);
      });
      var eventCombat = event && (joinedEvent === event.name ||
        G.maps[character.map] && G.maps[character.map].event === event.name ||
        monsters.some(function(m){return event.types.indexOf(m.mtype) >= 0;}));
      return { leader: leader || character.name, allies: allies, monsters: monsters,
        event: eventCombat ? event.name : null,
        mode: root.sharedRoutine.isOccupied() || isLiveAbtesting() ? "blocked" : eventCombat ? "event" : farmingMode === "scatter" ? "scatter" : "grouped",
        observedAt: parent.socket && parent.socket.connected ? Date.now() : 0 };
    },
    skillTargetAllowed: function(target) {
      if (!target || target.type !== "monster" || !isAllowedTarget(target) || root.sharedRoutine.isOccupied() || isLiveAbtesting()) return false;
      if (target.target && !isAttackingPartyMember(target)) return false;
      if (groupedAttackAllowed(target)) return true;
      return groupedFarming() && groupedFresh() && groupedCombat.committed &&
        isAttackingPartyMember(target) && !travelCombatActive();
    },
    followLeaderIfFar: async function (maximumDistance) {
      if (farmApproach.route || farmingMode === "scatter") return false;
      if (partyTownActive || partyConvoyActive || convoyTraveling || departurePending || bankQueued || !this.shouldFollowLeader() || !leaderLocation) return false;
      // Movement belonging to an active kite must not be mistaken for leader-following.
      if (kiteState.targetId) return false;
      maximumDistance = maximumDistance || 150;
      if (character.moving) return true;
      var dx = leaderLocation.x - character.x;
      var dy = leaderLocation.y - character.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (character.map === leaderLocation.map && distance <= maximumDistance) return false;
      followingLeader = true;
      try {
        await joinEventDestination(leaderLocation);
        await smart_move(leaderLocation);
        return true;
      } catch (error) {
        var reason = error && (error.reason || error.message || error);
        if (reason !== "interrupted") game_log("Follow path failed: " + reason, "red");
        return true;
      } finally {
        followingLeader = false;
      }
    },
    getLeaderTarget: function () {
      if (departurePending || bankQueued) return engagedMonster();
      if (groupedFollower()) return this.getGroupedTarget();
      if (convoyTraveling) {
        var threatened = partyThreats.map(function (threat) { return get_entity(threat.id); })
          .filter(function (target) { return target && !target.dead && !isExternallyClaimedMonster(target); });
        threatened.sort(function (a, b) {
          return Math.hypot(a.x - character.x, a.y - character.y) -
            Math.hypot(b.x - character.x, b.y - character.y);
        });
        if (threatened.length) return threatened[0];
      }
      if (!leaderTarget) return null;
      var target = get_entity(leaderTarget.id);
      // Following the leader is an explicit targeting mode. Personal focus only
      // controls autonomous acquisition and must not veto the leader's target.
      return target && !target.dead && !isExternallyClaimedMonster(target) ? target : null;
    },
    getNearestFocusedMonster: function (options) {
      options = options || {};
      var focusTypes = options.monsterType ? [options.monsterType] : monsterFocus;
      var allTypes = focusTypes.indexOf("all") >= 0;
      var candidates = Object.keys(parent.entities || {}).map(function (id) {
        return parent.entities[id];
      }).filter(function (target) {
        if (!target || target.type !== "monster" || target.dead || !target.visible) return false;
        if (typeof root !== "undefined" && root.partyRoleRunner && root.partyRoleRunner.isKnownDead && root.partyRoleRunner.isKnownDead(target.id)) return false;
        if (target.mtype === "fieldgen0" || target.mtype === "tinyp") return false;
        if (isExternallyClaimedMonster(target)) return false;
        if (!allTypes && focusTypes.indexOf(target.mtype) < 0) return false;
        return !(farmApproach.failed[target.id] > Date.now());
      });
      if (options.excludePartyTargets) {
        var occupiedTargets = {};
        partyTargets.forEach(function (target) {
          if (target && target.id && target.id !== combatTargetId) occupiedTargets[target.id] = true;
        });
        candidates = candidates.filter(function (target) { return !occupiedTargets[target.id]; });
      }
      candidates=selectFarmCandidates(candidates);
      function byDistance(a, b) {
        return Math.hypot(a.x - character.x, a.y - character.y) -
          Math.hypot(b.x - character.x, b.y - character.y);
      }
      function scatterChoice(list) {
        if (!options.excludePartyTargets || list.length < 2) return list[0] || null;
        // Every party member sees the same stable ordering while assembled,
        // then selects a different rank. This avoids the first-tick race where
        // target telemetry has not yet announced anybody's selection.
        list.sort(function (a, b) {
          return String(a.id).localeCompare(String(b.id)) || Number(a.x) - Number(b.x) || Number(a.y) - Number(b.y);
        });
        var scatterMembers = partyPositions.filter(function (member) {
          return member && !member.rip && member.ctype !== "merchant" && member.map === character.map;
        }).map(function (member) { return member.name; });
        if (scatterMembers.indexOf(character.name) < 0) scatterMembers.push(character.name);
        scatterMembers.sort();
        var rank = Math.max(0, scatterMembers.indexOf(character.name));
        return list[rank % list.length];
      }
      function priorityOf(target) {
        return monsterPriority(target);
      }
      // Priority is absolute between selected monster types. Apply the
      // contested/nearest rules only within the highest-priority tier.
      if (candidates.length) {
        var highestPriority = candidates.reduce(function (highest, target) {
          return Math.max(highest, priorityOf(target));
        }, -Infinity);
        candidates = candidates.filter(function (target) {
          return priorityOf(target) === highestPriority;
        });
      }
      candidates.sort(byDistance);
      if (candidates.length) return options.excludePartyTargets ? scatterChoice(candidates) : candidates[0];
      // Outside the configured local decision radius, retain the game's path-
      // checked nearest lookup so a sparse spawn can still be approached.
      var typeOptions = allTypes ? [null] : focusTypes.slice().sort(function (a, b) {
        var ap = Number.isFinite(Number(monsterPriorities[a])) ? Number(monsterPriorities[a]) : 50;
        var bp = Number.isFinite(Number(monsterPriorities[b])) ? Number(monsterPriorities[b]) : 50;
        return bp - ap;
      });
      var distant = typeOptions.map(function (type) {
        var query = { path_check: true, no_target: true };
        if (type) query.type = type;
        return get_nearest_monster(query);
      }).filter(function (target) { return target && !isExternallyClaimedMonster(target); }).sort(function (a, b) {
        return priorityOf(b) - priorityOf(a) || byDistance(a, b);
      });
      return distant.find(function (target) { return target.mtype !== "fieldgen0" && target.mtype !== "tinyp" &&
        (inFarmArea(target, partyLocation) || inFarmRadius(target)) && !(farmApproach.failed[target.id]>Date.now()); }) || null;
    },
    getPreferredTarget: function () {
      if (typeof rareTarget === "function" && rareTarget()) return rareTarget();
      if (townTraveling || partyTownActive) return null;
      var current = engagedMonster();
      if (current && isAllowedTarget(current)) return current;
      if (departurePending || bankQueued) return null;
      var interruptedTarget = scatterBreakTarget && get_entity(scatterBreakTarget.id);
      if (interruptedTarget && !interruptedTarget.dead && !isExternallyClaimedMonster(interruptedTarget)) return interruptedTarget;
      if (convoyTraveling) {
        var convoyTargets = partyThreats.map(function (threat) { return get_entity(threat.id); })
          .filter(function (target) { return target && !target.dead && !isExternallyClaimedMonster(target); });
        convoyTargets.sort(function (a, b) {
          return Math.hypot(a.x - character.x, a.y - character.y) -
            Math.hypot(b.x - character.x, b.y - character.y);
        });
        // Passive monsters never enter partyThreats. convoyThreatActive()
        // deliberately yields route ownership for a visible configured target,
        // so the selector must be able to acquire that same target or the
        // character deadlocks in `convoy-combat` with `no-target`.
        return convoyTargets[0] || this.getNearestFocusedMonster();
      }
      var defenders = partyThreats.map(function (threat) {
        return get_entity(threat.id);
      }).filter(function (target) { return target && !target.dead && !isExternallyClaimedMonster(target); });
      defenders.sort(function (a, b) {
        var adx = a.x - character.x, ady = a.y - character.y;
        var bdx = b.x - character.x, bdy = b.y - character.y;
        return monsterPriority(b) - monsterPriority(a) ||
          adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
      });
      if (defenders.length) return defenders[0];
      return this.getNearestFocusedMonster();
    },
    getScatterTarget: function () {
      if (townTraveling || partyTownActive) return null;
      var current = engagedMonster();
      if (current && isAllowedTarget(current)) return current;
      if (departurePending || bankQueued) return null;
      // Scatter is scoped to one learned monster type, but target priority is
      // stronger than that scope. If a selected higher-priority type appears,
      // acquire it so the coordinator can return the whole party to default
      // mode and converge after each member finishes its current target.
      var priorityCandidate = this.getNearestFocusedMonster({ excludePartyTargets: true });
      var scatterTypePriority = monsterPriority({ mtype: partyFarmingMonsterType });
      if (priorityCandidate && monsterPriority(priorityCandidate) > scatterTypePriority)
        return priorityCandidate;
      // In scatter mode only defend the character actually under attack;
      // converging on another member's target defeats the purpose of fanning out.
      var ownAttacker = Object.keys(parent.entities || {}).map(function (id) {
        return parent.entities[id];
      }).filter(function (target) {
        return target && target.type === "monster" && target.visible && !target.dead &&
          target.target === character.name && isAllowedTarget(target);
      }).sort(function (a, b) {
        return monsterPriority(b) - monsterPriority(a) ||
          Math.hypot(a.x - character.x, a.y - character.y) -
          Math.hypot(b.x - character.x, b.y - character.y);
      })[0];
      return ownAttacker || this.getNearestFocusedMonster({ excludePartyTargets: true,
        monsterType: partyFarmingMonsterType || null });
    },
    getNearestPartyAttacker: getNearestPartyAttacker,
    getNearestPartyTarget: getNearestPartyTarget,
    isAttackingPartyMember: isAttackingPartyMember,
    allowsTarget: isAllowedTarget,
    getEventTarget: nearestEventTarget,
    isAggressiveEventCombat: isAggressiveEventCombat,
    getMonsterFocus: function () { return monsterFocus.slice(); },
    getFarmingMode: function () {
      return typeof rareActive === "function" && rareActive() ? "default" : farmingMode;
    },
    getEngagedTarget: engagedMonster,
    getCloserHuntTarget: function(current) {
      if (!huntCombatTarget || !current || current.mtype!==huntCombatTarget || groupedFarming() ||
          activeCombatEvent() || joinedEvent || travelCombatActive() || isAttackingPartyMember(current)) return null;
      var distance = function(t) { return Math.hypot(t.x-character.x,t.y-character.y); };
      var targets = Object.values(parent.entities || {}).filter(function(t) {
        return t && t.type==='monster' && t.visible && !t.dead && t.hp>0 && t.mtype===huntCombatTarget &&
          t.id!==current.id && distance(t)<distance(current) && distance(t)<=monsterSearchRadius &&
          (!t.map || t.map===character.map) && (t.in===undefined || t.in===character.in) && isAllowedTarget(t) &&
          (farmingMode!=='scatter' || !partyTargets.some(function(p){return p.id===t.id;}));
      });
      targets.sort(function(a,b){return distance(a)-distance(b);});
      return targets[0] || null;
    },
    getRareTarget: rareTarget,
    getPassingTarget: passingTarget,
    monsterPriority: monsterPriority,
    passingEncounterReport: passingEncounterReport,
    isPassingEncounter: isPassingEncounter,
    beginPassingAttack: beginPassingAttack,
    rareAttackAllowed: rareAttackAllowed,
    departureLootPorts: function () { return {
      capacityBlocked:function(){return !!(root.partyLootStatus && root.partyLootStatus.capacityBlocked);},
      questFor: function(name){var p=(partyPositions||[]).find(function(p){return p.name===name && Date.now()+coordinatorClockOffset-p.seenAt<=3000;});return p && p.monsterHunt;},
      name:function(){return character.name;},
      quest:monsterHuntStatus,
      now:function(){return Date.now()+coordinatorClockOffset;},
      position:function(){return {realm:':'+String(parent.server_region||'')+String(parent.server_identifier||''),map:character.map,in:String(character.in||character.map),x:character.x,y:character.y};},
      cancelled:function(){return navigationIntent.cancelled || character.rip || escapeOwns() || !!joinedEvent;},
      defending:departureCombatPending,
      huntEncounterDefending:function(){return Object.values(parent.entities||{}).some(function(e){
        return e && e.type==='monster' && !isPassingEncounter(e) && departureTargetEngaged(e);
      });},
      loot:function(){return smartLoot(eligibleDepartureChests());},chests:eligibleDepartureChests,
      socket:function(){return parent.socket;},afterDraw:function(done){parent.draw_trigger(done);}
    };},
    pollRareHunting: pollRareHunting,
    usesLeaderTarget: function () { return groupedFarming(); },
    clearCombatSelection: function () { publishCombatSelection(null, true); },
    getGroupedTarget: function () {
      if (!groupedFarming() && typeof rareTarget === "function" && rareTarget()) return rareTarget();
      var lock = groupedCombat && groupedCombat.protocol === 4 ? groupedCombat.target : leaderCombatSelection;
      var target = lock && lock.id && get_entity(lock.id);
      if (target && target.visible && !target.dead && isAllowedTarget(target) &&
          (!unfinishedFight() || is_in_range(target))) return target;
      return groupedDefensiveTarget() || (target && target.visible && !target.dead && isAllowedTarget(target) ? target : null);
    },
    combatTargetRevision: function () {
      if (groupedCombat && groupedCombat.protocol === 4) return groupedCombat.selection;
      var lock = groupedFollower() ? leaderCombatSelection : combatSelection;
      return lock ? String(lock.runtimeId || convoyRuntimeId) + ":" + lock.revision : null;
    },
    hasScatterBreakTarget: function () {
      var target = scatterBreakTarget && get_entity(scatterBreakTarget.id);
      return !!(target && !target.dead && !isExternallyClaimedMonster(target));
    },
    getScatterBreakTarget: function () {
      var target = scatterBreakTarget && get_entity(scatterBreakTarget.id);
      return target && !target.dead && !isExternallyClaimedMonster(target) ? target : null;
    },
    equipmentTarget: function () {
      if (groupedFarming() && groupedCombat && groupedCombat.protocol === 4) return groupedCombat.target || null;
      var target = combatTargetId && get_entity(combatTargetId);
      return target && target.visible && !target.dead ? target : null;
    },
    setCombatTarget: function (target) {
      publishCombatSelection(target, false);
      combatTargetId = target && target.id || null;
      // Melee classes retain a visible selection while the shared safety rule
      // blocks attacks or the equipment controller switches to a bow.
      if (target && target.mtype === "porcupine" &&
          character.target !== target.id && typeof change_target === "function") change_target(target);
      if (target && target.mtype) {
        lastFarmingMonsterType = target.mtype;
        root.__partyLastFarmingMonsterType = target.mtype;
      }
    },
    noteAttack: function (target) {
      if (isExternallyClaimedMonster(target)) combatTargetId = null;
      lastAttackAt = Date.now();
      lastAttackTarget = target && target.id || null;
      var timing=root.__partyQueueTiming;
      if(timing && target && timing.target===target.id && !timing.firstAttackAt){timing.firstAttackAt=Date.now();timing.deathToAttackMs=timing.deathAt ? Date.now()-timing.deathAt : null;}
    },
  };
  root.sharedRoutine.start();
})(globalThis);
