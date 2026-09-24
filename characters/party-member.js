// Generated from TypeScript; run npm run build:runtime -- --publish. Do not edit.
"use strict";
(() => {
  // runtime/navigation/contracts.ts
  var isTransition = (step) => !!(step.town || step.transport || step.method === "leave");
  var point = (p) => ({ map: p.map, x: p.x, y: p.y, ...p.in === void 0 ? {} : { in: p.in } });
  var distance = (a, b) => a.map === b.map && (a.in === void 0 || b.in === void 0 || a.in === b.in) ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
  function isPoint(p) {
    if (!p || typeof p !== "object") return false;
    const v = p;
    return typeof v.map === "string" && /^[\w-]+$/.test(v.map) && Number.isFinite(v.x) && Number.isFinite(v.y);
  }
  function geometryFingerprint(g) {
    const geometry = g.geometry;
    const maps = Object.keys(g.maps).sort().map((name) => {
      const m = g.maps[name], collision = geometry?.[name];
      const transporters = (m.npcs || []).filter((n) => n.id === "transporter").map((n) => n.position);
      return [name, collision?.x_lines || [], collision?.y_lines || [], m.spawns, m.doors || [], transporters, !!m.instance, m.event || null];
    });
    const value = JSON.stringify([maps, g.npcs.transporter?.places]);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b, 33) ^ value.charCodeAt(i);
    }
    return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${value.length}`;
  }

  // runtime/navigation/validation.ts
  function atSpawn(g, p, spawn) {
    const xy = g.maps[p.map]?.spawns[spawn];
    return !!xy && Math.hypot(p.x - xy[0], p.y - xy[1]) <= 1;
  }
  function doorAllowed(ports, from, to) {
    const key = to.key || { bank_b: "bkey", bank_u: "ukey" }[to.map];
    return !!ports.game.maps[from.map]?.doors?.some((d) => d[4] === to.map && Number(d[5] || 0) === to.s && d[8] !== "complicated" && (d[7] !== "key" || !!key && ports.hasKey(key)) && ports.door(from, d));
  }
  function transporterAllowed(g, from, to) {
    if (g.npcs.transporter?.places[to.map] !== to.s) return false;
    return !!g.maps[from.map]?.npcs?.some((n) => n.id === "transporter" && n.position && Math.hypot(from.x - n.position[0], from.y - n.position[1]) < 75);
  }
  function stepIssue(ports, from, to, town) {
    if (!isPoint(to) || !ports.game.maps[to.map]) return "invalid waypoint";
    if (to.method && !["move", "door", "transport", "town", "leave"].includes(to.method)) return `unsupported transition ${to.method}`;
    if (to.method === "leave") return leaveIssue(ports.game, from, to);
    if (to.town) return townIssue(ports.game, from, to, town);
    if (!to.transport) return from.map === to.map && ports.walk(from, to) ? null : "collisions detected";
    return transportIssue(ports, from, to);
  }
  function townIssue(game, from, to, allowed) {
    return allowed && to.map === from.map && atSpawn(game, to, 0) ? null : "town warp prohibited or invalid spawn";
  }
  function transportIssue(ports, from, to) {
    if (ports.game.maps[to.map].instance || ports.game.maps[to.map].event) return "instance/event transition requires its workflow";
    if (!Number.isInteger(to.s) || !atSpawn(ports.game, to, to.s)) return "invalid destination spawn";
    return doorAllowed(ports, from, to) || transporterAllowed(ports.game, from, to) ? null : "door/transporter approach or access invalid";
  }
  function validateRoute(ports, from, destination, plot, town, tolerance = 20) {
    if (!Array.isArray(plot) || plot.length > 1e4) return { reason: "invalid route size", from, to: destination };
    let previous = from;
    for (const next of plot) {
      const reason = stepIssue(ports, previous, next, town);
      if (reason) return { reason, from: previous, to: next };
      previous = next;
    }
    return distance(previous, destination) <= tolerance ? null : { reason: "route misses destination", from: previous, to: destination };
  }
  function leaveIssue(game, from, to) {
    if (to.town || to.transport || to.s !== void 0 || to.key) return "conflicting leave metadata";
    return ["cyberland", "jail"].includes(from.map) && to.map === "main" && (to.in === void 0 || to.in === "main") && atSpawn(game, to, 0) ? null : "invalid leave exit";
  }

  // runtime/characters/native-planner.ts
  function createNativePlanner(host, native) {
    let running = false, failure = "", deadline = 0, serial = 0;
    function cancel() {
      running = false;
      serial++;
      void Promise.resolve(native.stop("smart")).catch(() => {
      });
    }
    function begin(destination, town, now) {
      cancel();
      failure = "";
      deadline = now + 3e4;
      const token = serial;
      const promise = native.move(destination);
      void promise.catch((error) => {
        if (running && token === serial) failure = String(error?.reason || error);
      });
      host.smart.use_town = town;
      running = true;
    }
    function tick(now) {
      if (!running) throw Error("Native search not initialized");
      if (failure || now >= deadline) {
        const reason = failure || "Native planning timed out (30 seconds)";
        cancel();
        throw Error(reason);
      }
      if (!host.smart.searching) native.start();
      else if (!host.smart.found) native.next();
      if (!host.smart.moving && !host.smart.found) throw Error("Native planner found no route");
      if (!host.smart.found) return;
      const plot = host.smart.plot.map((p) => ({ ...p }));
      cancel();
      return plot;
    }
    return { begin, tick, cancel };
  }

  // runtime/characters/movement-executor.ts
  function transitionLabel(step) {
    return step.method === "leave" ? "leave transition" : step.town ? "town warp" : "map transition";
  }
  function createMovementExecutor(host, state, validation, now, townReady = () => true, lootCollected = () => true) {
    let issued, index = 0, barrierPending = false, barrierReady = false, lastBarrier = 0, waitingBarrier = false;
    let sampledAt = now(), sampledPhase = "idle";
    let lootWaitAt;
    let durations = {};
    const position = () => ({ map: host.character.map, in: host.character.in, x: host.character.real_x, y: host.character.real_y });
    function reset() {
      issued = void 0;
      index = 0;
      barrierPending = false;
      barrierReady = false;
      lastBarrier = 0;
      waitingBarrier = false;
      lootWaitAt = void 0;
      sampledAt = now();
      sampledPhase = "idle";
      durations = {};
    }
    function cancel() {
      if (issued) {
        void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {
        });
        if (issued.step.town) void Promise.resolve(host.stop("town")).catch(() => {
        });
      }
      reset();
    }
    function pause() {
      if (issued) {
        issued.progressAt = now();
        issued.at = now();
      }
    }
    function barrier(options, step, completed) {
      if (!options.barrier) return true;
      if (barrierReady) {
        barrierReady = false;
        waitingBarrier = false;
        return true;
      }
      waitingBarrier = true;
      if (barrierPending || now() - lastBarrier < 250) return false;
      barrierPending = true;
      lastBarrier = now();
      const captured = issued;
      options.barrier(step, index, completed).then((ready) => {
        if (issued === captured) barrierReady = ready;
      }, (error) => {
        if (issued === captured && issued) issued.error = String(error);
      }).finally(() => {
        if (issued === captured) barrierPending = false;
      });
      return false;
    }
    function complete(current, options) {
      const p = position(), transition = isTransition(current.step);
      if (host.character.moving || host.is_transporting(host.character)) return false;
      if (transition && !current.acknowledged) return false;
      if (transition) alignArrival(current, p);
      if (distance(p, current.step) > 1) return false;
      notifyTown(current, options, "complete");
      if (!transitionReady(current, options, !!transition)) return false;
      notifyTransition(current, options);
      state.plot.shift();
      if (transition) index++;
      issued = void 0;
      barrierReady = false;
      return true;
    }
    function alignArrival(current, p) {
      if (current.aligned || distance(p, current.step) <= 1 || distance(p, current.step) > 150) return;
      if (!validation.walk(p, current.step)) throw Error(`Arrival connector collision between ${JSON.stringify(p)} and ${JSON.stringify(current.step)}`);
      current.aligned = true;
      current.progressAt = now();
      void Promise.resolve(host.move(current.step.x, current.step.y)).catch((error) => {
        if (issued === current) current.error = String(error);
      });
    }
    function transitionReady(current, options, transition) {
      if (transition && !barrier(options, current.step, true)) {
        current.progressAt = now();
        return false;
      }
      return true;
    }
    function observe(current, options) {
      if (current.error) {
        notifyTownRejection(current, options);
        throw Error(isTransition(current.step) ? transitionLabel(current.step) + ": " + current.error : current.error);
      }
      if (complete(current, options)) return;
      const p = position();
      if (arrivedTransition(current, p)) return;
      if (distance(p, current.position) >= 2) {
        current.position = p;
        current.progressAt = now();
      }
      const transition = isTransition(current.step);
      if (transition && now() - current.at > 12e3) {
        notifyTown(current, options, "interrupted");
        throw Error(`Failed ${transitionLabel(current.step)}`);
      }
      observeWalk(current, p);
    }
    function observeWalk(current, p) {
      if (isTransition(current.step)) return;
      if (now() - current.progressAt > 5e3) throw Error("Stalled walking movement (5 seconds without progress)");
      retryStoppedWalk(current, p);
    }
    function retryStoppedWalk(current, p) {
      if (current.reissued || now() - current.progressAt < 250 || !canStart()) return;
      if (stepIssue(validation, p, current.step, state.use_town)) return;
      current.reissued = true;
      sendObserved(current);
    }
    function arrivedTransition(current, p) {
      return isTransition(current.step) && !!current.acknowledged && distance(p, current.step) <= 1;
    }
    function send(current) {
      const step = current.step;
      if (step.method === "leave") {
        const promise = host.parent.push_deferred("leave");
        host.parent.socket.emit("leave", void 0);
        return promise;
      }
      if (step.town) return host.town ? host.town() : host.use("town");
      if (step.transport) {
        const promise = host.parent.push_deferred("transport");
        host.parent.socket.emit("transport", { to: step.map, s: step.s });
        return promise;
      }
      return host.move(step.x, step.y);
    }
    function dispatch(current, options) {
      if (current.error) throw Error(current.step.method === "leave" ? "Leave transition failed: " + current.error : current.error);
      if (!lootReady(current.step)) return;
      if (!readyTown(current, options)) return;
      if (isTransition(current.step) && !barrier(options, current.step, false)) return;
      current.finished = false;
      current.at = now();
      current.progressAt = now();
      const captured = current;
      notifyTown(current, options, "casting");
      sendObserved(captured);
    }
    function sendObserved(captured) {
      const version = captured.sendVersion = (captured.sendVersion || 0) + 1;
      try {
        void Promise.resolve(send(captured)).then((result) => {
          if (issued !== captured || captured.sendVersion !== version) return;
          if (result && typeof result === "object" && "failed" in result && result.failed) throw result;
          captured.acknowledged = true;
        }).catch((error) => {
          if (issued === captured && captured.sendVersion === version) rejected(captured, error);
        });
      } catch (error) {
        if (issued === captured) rejected(captured, error);
      }
    }
    function rejected(current, error) {
      const reason = error && typeof error === "object" && "reason" in error ? String(error.reason) : String(error);
      current.error = reason;
      current.townUnavailable = /cooldown|unavailable|not.ready|no.mp|disabled/i.test(reason);
    }
    function tick(options) {
      sample();
      if (issued && state.plot[0] !== issued.step) reset();
      if (issued?.finished) {
        dispatch(issued, options);
        return false;
      }
      if (issued) {
        observe(issued, options);
        return false;
      }
      if (!state.plot.length) return true;
      if (!canStart()) return false;
      const step = state.plot[0], p = position(), reason = stepIssue(validation, p, step, state.use_town);
      if (reason) throw Error(`${reason} between ${p.map} (${p.x}, ${p.y}) and ${step.map} (${step.x}, ${step.y})`);
      issued = { step, from: point(p), at: now(), progressAt: now(), position: p, finished: true };
      dispatch(issued, options);
      return false;
    }
    function lootReady(step) {
      if (!isTransition(step) || lootCollected()) {
        lootWaitAt = void 0;
        return true;
      }
      lootWaitAt ??= now();
      if (now() - lootWaitAt >= 3e4) throw Error("Pending nearby loot prevented map transition for 30 seconds");
      return false;
    }
    function notifyTownRejection(current, options) {
      notifyTown(current, options, current.townUnavailable ? "unavailable" : "interrupted");
    }
    function notifyTown(current, options, outcome) {
      if (current.step.town) options.townAttempt?.(outcome, index, current.from, current.step);
    }
    function notifyTransition(current, options) {
      if (isTransition(current.step)) options.transitionComplete?.(current.step);
    }
    function readyTown(current, options) {
      if (!current.step.town || townReady() && host.can_use("use_town")) return true;
      if (!options.townAttempt) throw Error("Town warp currently unavailable");
      if (now() - current.at < 5e3) return false;
      notifyTown(current, options, "unavailable");
      throw Error("Town unavailable for 5 seconds; use walking route");
    }
    function sample() {
      const at = now();
      durations[sampledPhase] = (durations[sampledPhase] || 0) + Math.max(0, at - sampledAt);
      sampledAt = at;
      sampledPhase = phase();
    }
    function phase() {
      if (lootWaitAt !== void 0) return "pending loot";
      if (waitingBarrier) return "barrier";
      if (!issued) return "idle";
      return isTransition(issued.step) ? transitionLabel(issued.step) : "walking";
    }
    function canStart() {
      return !host.character.moving && host.can_walk(host.character) && !host.is_transporting(host.character);
    }
    return {
      tick,
      reset,
      cancel,
      pause,
      progress: () => ({
        step: index,
        phase: phase(),
        destination: issued?.step,
        durations: { ...durations },
        position: position(),
        noProgressMs: issued ? now() - issued.progressAt : 0,
        reissued: !!issued?.reissued
      }),
      transition: () => issued && isTransition(issued.step) ? issued.step.town ? "town" : "transport" : null,
      remaining: () => state.plot.map((p) => ({ ...p }))
    };
  }

  // runtime/characters/movement-destination.ts
  function resolveDestination(host, input) {
    if (input && typeof input === "object") {
      const p = { map: host.character.map, ...input };
      if (isPoint(p)) return p;
    }
    return resolveName(host, destinationName(input));
  }
  function destinationName(input) {
    if (typeof input === "string") return input;
    const p = input;
    return String(p?.to || p?.map || "");
  }
  function resolveName(host, value) {
    const name = value === "town" ? "main" : value;
    const map = host.G.maps[name];
    if (map?.event) throw Error(`Event ${map.event} requires the event joining workflow`);
    if (map?.spawns[0]) return { map: name, x: map.spawns[0][0], y: map.spawns[0][1] };
    const npc = host.find_npc(name);
    if (npc) return { ...npc, y: npc.y + 15 };
    const aliases = { upgrade: { map: "main", x: -204, y: -129 }, compound: { map: "main", x: -204, y: -129 }, exchange: { map: "main", x: -26, y: -432 }, scrolls: { map: "main", x: -465, y: -71 } };
    if (name === "potions") return potions(host.character.map);
    if (aliases[name]) return aliases[name];
    throw Error(`Unknown movement destination ${name}`);
  }
  function potions(map) {
    if (map === "halloween") return { map, x: 149, y: -182 };
    if (["winterland", "winter_inn", "winter_cave"].includes(map)) return { map: "winter_inn", x: -84, y: -173 };
    return { map: "main", x: 56, y: -122 };
  }

  // runtime/characters/movement-diagnostics.ts
  var coordinates = (p) => `${p.map} (${Math.round(p.x * 100) / 100}, ${Math.round(p.y * 100) / 100})`;
  function movementDiagnostics(ports, name, version, fingerprint) {
    const recent = /* @__PURE__ */ new Map();
    return (id, destination, phase, issue, detail) => {
      destination = point(destination);
      if (issue) issue = { reason: issue.reason, from: point(issue.from), to: point(issue.to) };
      const message = `${name}: ${phase}${issue ? ` \u2014 ${issue.reason} between ${coordinates(issue.from)} and ${coordinates(issue.to)}` : ""}${detail ? `; ${detail}` : ""}. Destination: ${coordinates(destination)}. Journey: ${id}; game ${version}; geometry ${fingerprint}.`;
      const key = JSON.stringify([phase, issue, destination]);
      const prior = recent.get(key), now = ports.now();
      const count = (prior?.count || 0) + 1;
      if (prior && now - prior.at < 1e4) {
        prior.count = count;
        return;
      }
      recent.set(key, { count, at: now });
      if (recent.size > 100) recent.delete(recent.keys().next().value);
      ports.diagnostic({ id, character: name, version, fingerprint, destination, phase, issue, count, at: now }, message + (count > 1 ? ` Repeated ${count} times.` : ""));
    };
  }

  // runtime/navigation/door-approach.ts
  function approaches(ports, from, to) {
    const doors = (ports.game.maps[from.map]?.doors || []).filter((d) => d[4] === to.map && Number(d[5] || 0) === to.s).flatMap((d) => {
      const x = Number(d[0]), y = Number(d[1]), w = Number(d[2]), h = Number(d[3]);
      const spawn = ports.game.maps[from.map].spawns[Number(d[6])];
      return [
        [x, y],
        [x - w / 2, y],
        [x + w / 2, y],
        [x, y - h],
        [x - w / 2, y - h],
        [x + w / 2, y - h],
        ...spawn ? [spawn] : []
      ].map((p) => ({ map: from.map, x: p[0], y: p[1] }));
    });
    return doors.concat(transporterPoints(ports, from, to));
  }
  function transporterPoints(ports, from, to) {
    if (ports.game.npcs.transporter?.places[to.map] !== to.s) return [];
    const npc = ports.game.maps[from.map]?.npcs?.find((n) => n.id === "transporter")?.position;
    if (!npc) return [];
    return [60, 40].flatMap(
      (radius) => Array.from({ length: 32 }, (_, i) => ({
        map: from.map,
        x: npc[0] + radius * Math.cos(i * Math.PI / 16),
        y: npc[1] + radius * Math.sin(i * Math.PI / 16)
      }))
    );
  }
  function connector(ports, from, to) {
    return approaches(ports, from, to).sort((a, b) => distance(from, a) - distance(from, b)).find((p) => ports.walk(from, p) && !stepIssue(ports, p, to, true));
  }
  function repairDoorApproaches(ports, from, plot) {
    const result = [];
    let previous = from;
    for (const [index, step] of plot.entries()) {
      const next = plot[index + 1];
      if (!isTransition(step) && next?.transport && !ports.walk(previous, step)) {
        const repaired = connector(ports, previous, next);
        if (repaired) {
          result.push(repaired);
          previous = repaired;
          continue;
        }
      }
      if (step.transport && stepIssue(ports, previous, step, true) === "door/transporter approach or access invalid") {
        const repaired = connector(ports, previous, step);
        if (repaired) result.push(repaired);
      }
      result.push(step);
      previous = step;
    }
    return result;
  }

  // runtime/characters/return-planner.ts
  function routeDuration(request, plot) {
    let at = request.from, ms = 0;
    for (const step of plot) {
      ms += step.town ? 7e3 : isTransition(step) ? 1e3 : distance(at, step) * 1e3 / Math.max(1, request.speed);
      at = step;
    }
    return ms;
  }
  async function planReturnCandidates(ports, validation, request, tolerance) {
    const outcomes = await Promise.allSettled(
      [false, true].map(async (town) => {
        const candidateId = `${request.id}:${town ? "town" : "walk"}`;
        const response = await ports.request("/movement-plan", {
          method: "POST",
          timeout: 2e3,
          body: { ...request, id: candidateId, town }
        });
        if (response.error) throw Error(response.error);
        if (response.id !== candidateId || response.version !== request.version || response.fingerprint !== request.fingerprint)
          throw Error("Planner response identity mismatch");
        if (response.mode === "shadow") return response;
        const plot = repairDoorApproaches(validation, request.from, response.plot);
        const issue = validateRoute(validation, request.from, request.to, plot, town, tolerance);
        if (issue) throw Error((town ? "Town" : "Walking") + " route: " + issue.reason);
        return { ...response, plot };
      })
    );
    const valid = outcomes.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
    if (!valid.length)
      throw Error(
        "Return route candidates failed: " + outcomes.map((r) => r.status === "rejected" ? String(r.reason) : "").join("; ")
      );
    const selected = valid.sort((a, b) => routeDuration(request, a.plot) - routeDuration(request, b.plot))[0];
    return { ...selected, id: request.id };
  }

  // runtime/characters/movement.ts
  function arrivalTolerance(options) {
    const tolerance = options.arrivalTolerance ?? 20;
    if (!Number.isFinite(tolerance) || tolerance < 1) throw Error("Arrival tolerance must be at least 1");
    return tolerance;
  }
  function finalApproach(plot, from, to, options) {
    if (options?.arrivalTolerance === void 0 || options.shared) return plot;
    const remaining = distance(plot.at(-1) || from, to);
    return remaining > 0 && remaining <= 20 ? [...plot, point(to)] : plot;
  }
  function installPartyMovement(host, ports) {
    host.__partyMovement?.dispose();
    const native = host.__partyNativeMovement ||= { move: host.smart_move, stop: host.stop, start: host.start_pathfinding, next: host.continue_pathfinding, tick: host.smart_move_logic };
    const planner = createNativePlanner(host, native);
    const state = { map: host.character.map, x: 0, y: 0, moving: false, searching: false, found: false, plot: [], use_town: true, try_exact_spot: false, edge: 20, on_done() {
    } };
    let version = Number(host.parent.__partyClientVersion || host.G.version), fingerprint = geometryFingerprint(host.G);
    let report = movementDiagnostics(ports, host.character.name, version, fingerprint);
    const validation = {
      get game() {
        return host.G;
      },
      walk: (a, b) => host.can_move({ map: a.map, x: a.x, y: a.y, going_x: b.x, going_y: b.y, base: host.character.base }),
      door: (p, d) => host.is_door_close(p.map, d, p.x, p.y) && host.can_use_door(p.map, d, p.x, p.y),
      hasKey: (key) => host.character.items.some((item) => item?.name === key)
    };
    const executor = createMovementExecutor(
      host,
      state,
      validation,
      ports.now,
      () => ports.townReady?.() ?? true,
      () => ports.transitionReady?.() ?? true
    );
    let journey, sequence = 0, disposed = false;
    let last = null;
    const gate = { original: tick, owner: null };
    const position = () => ({ map: host.character.map, in: host.character.in, x: host.character.real_x, y: host.character.real_y });
    function current(j) {
      if (disposed || journey !== j) return false;
      try {
        const c = ports.context();
        return c.current && c.runtime === j.context.runtime && c.revision === j.context.revision && !host.character.rip;
      } catch {
        return false;
      }
    }
    function finish(done, reason) {
      const j = journey;
      if (!j) return;
      const progress = executor.progress();
      journey = void 0;
      state.moving = state.searching = false;
      planner.cancel();
      if (done) executor.reset();
      else executor.cancel();
      last = {
        id: j.id,
        engine: engine(j),
        version,
        fingerprint,
        done,
        reason,
        elapsedMs: ports.now() - j.started,
        searches: j.searches,
        retries: j.retries,
        plannerMs: j.plannerMs,
        requestMs: j.requestMs,
        walkingDistance: j.distance,
        transitions: j.transitions,
        progress
      };
      ports.metrics?.(last);
      if (j.fallback || !done) report(j.id, state, outcome(done, reason), void 0, reason);
      state.on_done(done, reason);
    }
    function engine(j) {
      return j.importedEngine || (j.native ? "native" : "alclient");
    }
    function outcome(done, reason) {
      if (done) return "Native fallback succeeded";
      if (reason === "Combat handoff") return "Travel paused for combat";
      return /cancelled|replaced|superseded/i.test(reason || "") ? "Movement cancelled" : "Movement failed";
    }
    function fallback(j, issue) {
      if (!current(j)) return;
      report(j.id, state, j.native ? "Native movement recovery" : "ALClient route rejected", issue, "falling back to native smart_move");
      j.fallback = true;
      j.native = true;
      j.pending = false;
      j.planningAt = ports.now();
      state.found = state.searching = false;
      state.plot.length = 0;
      executor.reset();
    }
    function install(plot, nativeRoute) {
      if (!nativeRoute) plot = repairDoorApproaches(validation, position(), plot);
      plot = trimUncheckedFinal(finalApproach(plot, position(), state, journey?.options));
      const issue = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
      if (issue) {
        if (nativeRoute) throw Error(`Native route rejected: ${issue.reason} between ${JSON.stringify(issue.from)} and ${JSON.stringify(issue.to)}`);
        fallback(journey, issue);
        return false;
      }
      let previous = position(), walking = 0, transitions = 0;
      for (const step of plot) {
        if (isTransition(step)) transitions++;
        else walking += distance(previous, step);
        previous = step;
      }
      if (journey) {
        journey.distance = walking;
        journey.transitions = transitions;
      }
      state.plot.splice(0, state.plot.length, ...plot);
      state.searching = false;
      state.found = true;
      executor.reset();
      return true;
    }
    function trimUncheckedFinal(plot) {
      if (journey?.options.shared) return plot;
      const last2 = plot.at(-1), previous = plot.at(-2);
      return last2 && previous && !isTransition(last2) && last2.map === previous.map && !validation.walk(previous, last2) && distance(previous, state) <= state.edge ? plot.slice(0, -1) : plot;
    }
    function nativeTick(j) {
      if (!state.searching) {
        planner.begin(point(state), state.use_town, ports.now());
        state.searching = true;
        j.searches++;
      }
      const plot = planner.tick(ports.now());
      if (plot) install(plot, true);
    }
    function requestPlan(j) {
      if (j.pending) return;
      j.pending = true;
      state.searching = true;
      j.searches++;
      const from = position(), destination = point(state), town = state.use_town;
      const requestedAt = ports.now();
      const body = {
        id: j.id,
        character: host.character.name,
        from,
        to: destination,
        speed: j.options.speed || host.character.speed,
        town,
        version,
        fingerprint,
        avoidLeave: j.options.avoidLeave
      };
      const planning = j.options.compareTown && town ? planReturnCandidates(ports, validation, body, state.edge) : ports.request("/movement-plan", { method: "POST", timeout: 2e3, body });
      planning.then((value) => {
        if (!current(j)) return;
        const result = value;
        if (result.error) throw Error(result.error);
        if (result.id !== j.id || result.version !== version || result.fingerprint !== fingerprint) throw Error("Planner response identity mismatch");
        if (distance(position(), from) > 1) {
          replanDrift(j);
          return;
        }
        j.plannerMs = result.ms;
        j.requestMs = ports.now() - requestedAt;
        if (result.mode === "shadow") {
          const issue = validateRoute(validation, from, destination, result.plot, town, state.edge);
          ports.metrics?.({ id: j.id, phase: "shadow", version, fingerprint, valid: !issue, issue, plot: result.plot, plannerMs: result.ms, requestMs: j.requestMs });
          fallback(j, issue || { reason: "Shadow comparison valid; native execution selected", from, to: destination });
          return;
        }
        install(result.plot, false);
      }).catch((error) => {
        if (!current(j)) return;
        const reason = String(error);
        if (/geometry|route|path|walk|segment|collision|blocked/i.test(reason)) fallback(j, { reason, from, to: destination });
        else finish(false, reason);
      });
    }
    function replanDrift(j) {
      j.pending = false;
      state.searching = false;
      if (++j.retries > 2) finish(false, "Character moved while planning");
    }
    function planTick() {
      const j = journey;
      if (!j || state.found) return;
      if (!current(j)) {
        finish(false, "Movement superseded");
        return;
      }
      if (host.character.moving || host.is_transporting(host.character)) {
        if (ports.now() - j.started > 5e3) finish(false, "Character did not settle before route planning");
        return;
      }
      try {
        if (j.native) nativeTick(j);
        else requestPlan(j);
      } catch (error) {
        finish(false, String(error));
      }
    }
    function recover(j, error) {
      if (/leave transition/i.test(String(error))) {
        if (j.options.shared || j.retries >= 2) {
          finish(false, "Leave transition failed: " + String(error));
          return;
        }
        j.retries++;
        j.options = { ...j.options, avoidLeave: true };
        j.pending = false;
        state.found = state.searching = false;
        state.plot = [];
        executor.reset();
        report(j.id, state, "Leave transition failed; replanning with ALClient");
        return;
      }
      if (j.options.shared || j.retries >= 2) {
        finish(false, String(error));
        return;
      }
      j.retries++;
      if (/town/i.test(String(error))) state.use_town = false;
      void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {
      });
      fallback(j, { reason: `${String(error)}; recovery ${j.retries}/2`, from: position(), to: state.plot[0] || point(state) });
    }
    function tick() {
      const j = journey;
      if (!j || !state.moving) return;
      if (!current(j)) {
        finish(false, "Movement superseded");
        return;
      }
      if (ports.context().paused) {
        executor.pause();
        return;
      }
      if (!state.found) {
        planTick();
        return;
      }
      try {
        if (executor.tick(j.options)) finish(true);
      } catch (error) {
        recover(j, error);
      }
    }
    function move(destination, callback, options = {}) {
      if (host.smart_move_logic !== scheduler) return Promise.reject(Error("Movement scheduler was replaced"));
      finish(false, "Movement replaced");
      refreshGeometry();
      let target, tolerance;
      try {
        target = resolveDestination(host, destination);
        tolerance = arrivalTolerance(options);
      } catch (error) {
        return Promise.reject(error);
      }
      if (target.in !== void 0 && target.map === host.character.map && String(target.in) !== String(host.character.in ?? host.character.map))
        return Promise.reject(Error("Destination is in another instance; use its instance-entry workflow"));
      delete state.in;
      Object.assign(state, target, { moving: true, found: false, searching: false, plot: [], use_town: options.town !== false, edge: tolerance });
      if (host.character.moving) void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {
      });
      executor.reset();
      const context = ports.context();
      journey = { id: `${host.character.name}:${context.runtime}:${++sequence}`, context, options, native: !!options.native, pending: false, searches: 0, retries: 0, started: ports.now(), planningAt: ports.now(), fallback: !!options.native };
      return new Promise((resolve, reject) => {
        state.on_done = (done, reason) => {
          callback?.(done);
          if (done) resolve({ success: true });
          else reject(Error(reason || "Movement cancelled"));
        };
      });
    }
    function refreshGeometry() {
      const nextVersion = Number(host.parent.__partyClientVersion || host.G.version), nextFingerprint = geometryFingerprint(host.G);
      if (nextVersion === version && nextFingerprint === fingerprint) return;
      version = nextVersion;
      fingerprint = nextFingerprint;
      report = movementDiagnostics(ports, host.character.name, version, fingerprint);
    }
    function stop(action, success) {
      if (!action || action === "move" || action === "smart") finish(!!success, success ? void 0 : "Movement cancelled");
      return native.stop(action, success);
    }
    function scheduler() {
      if (!disposed) {
        if (gate.owner) gate.owner.tick();
        else tick();
      }
    }
    host.smart_move = move;
    host.stop = stop;
    host.smart_move_logic = scheduler;
    function importRoute(plot, identity, plannerEngine = "shared") {
      refreshGeometry();
      if (!identity || identity.version !== version || identity.fingerprint !== fingerprint)
        throw Error("Shared route game geometry mismatch: expected " + JSON.stringify(identity) + "; actual " + JSON.stringify({ version, fingerprint }));
      const issue = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
      if (issue) {
        report(journey.id, state, "Shared route rejected", issue, "falling back to native smart_move after party regroup");
        throw Error(`${issue.reason} between ${JSON.stringify(issue.from)} and ${JSON.stringify(issue.to)}; native regroup required`);
      }
      if (journey) journey.importedEngine = plannerEngine;
      return install(plot, true);
    }
    const service = {
      state,
      move,
      stop,
      tick,
      planTick,
      gate,
      transition: executor.transition,
      get identity() {
        return { version, fingerprint };
      },
      install: importRoute,
      last: () => last,
      combatHandoff() {
        finish(false, "Combat handoff");
      },
      report: () => journey ? {
        id: journey.id,
        engine: engine(journey),
        retries: journey.retries,
        fingerprint,
        version,
        remaining: state.plot.length,
        elapsedMs: ports.now() - journey.started,
        plannerMs: journey.plannerMs,
        requestMs: journey.requestMs,
        progress: executor.progress()
      } : null,
      dispose() {
        finish(false, "Runtime replaced");
        disposed = true;
        gate.owner = null;
        if (host.smart_move_logic === scheduler) host.smart_move_logic = native.tick;
        host.smart_move = native.move;
        host.stop = native.stop;
      }
    };
    host.__partyMovement = service;
    return service;
  }
  Object.assign(globalThis, { installPartyMovement });

  // runtime/bank-stacks.ts
  var stackQuantity = (item) => item ? Number(item.q) || 1 : 0;
  function stackIdentity(item) {
    return JSON.stringify(["name", "level", "p", "stat_type", "data", "rid", "b", "m", "l"].map((key) => key === "level" ? Number(item?.level) || 0 : item?.[key] ?? null));
  }
  function stackProtected(location, protection) {
    return !!protection.error || location.pack === "items1" && location.slot >= 35 || !!location.item?.b || location.item?.name === "placeholder" || protection.locations.some((mark) => mark.pack === location.pack && (mark.slot === void 0 || mark.slot === location.slot)) || protection.items.some((item) => item.name === location.item?.name && (item.level || 0) === (location.item?.level || 0));
  }
  function stackLocations(bank, protection) {
    return Object.keys(bank).filter((pack) => /^items\d+$/.test(pack) && Array.isArray(bank[pack])).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))).flatMap((pack) => Array.from({ length: 42 }, (_, slot) => ({ pack, slot, item: bank[pack][slot] }))).filter((location) => !stackProtected(location, protection));
  }
  function stackDepositPlan(item, limit, locations) {
    let remaining = stackQuantity(item);
    const moves = [];
    const compatible = locations.filter((location) => location.item && limit > 1 && stackIdentity(location.item) === stackIdentity(item) && stackQuantity(location.item) < limit);
    for (const location of [...compatible, ...locations.filter((location2) => !location2.item)]) {
      const quantity = Math.min(remaining, Math.max(0, limit - stackQuantity(location.item)));
      if (quantity) moves.push({ ...location, quantity });
      remaining -= quantity;
      if (!remaining) break;
    }
    return { moves, remaining };
  }
  function nextStackMerge(locations, limitOf) {
    for (let a = 0; a < locations.length; a++) {
      const target = locations[a], limit = target.item ? limitOf(target.item) : 1;
      if (!target.item || limit <= stackQuantity(target.item)) continue;
      for (let b = locations.length - 1; b > a; b--) {
        const source = locations[b];
        if (source.item && stackIdentity(source.item) === stackIdentity(target.item))
          return { source, target, quantity: Math.min(stackQuantity(source.item), limit - stackQuantity(target.item)) };
      }
    }
    return null;
  }

  // runtime/characters/bank-stacks.ts
  function createBankStacks(p) {
    const at = (o) => p.bank()[o.pack]?.[o.slot] || null;
    const origin = (l) => ({ pack: l.pack, slot: l.slot, floor: p.floor(l.pack) });
    const empty = () => Array.from({ length: p.size() }, (_, i) => i).filter((i) => !p.items()[i]);
    const copy = (item) => item ? { ...item } : null;
    const equal = (a, b) => stackIdentity(a) === stackIdentity(b) && stackQuantity(a) === stackQuantity(b);
    function active() {
      if (!p.current()) throw Error("Bank stack runtime replaced");
    }
    async function settle(expected) {
      active();
      const deadline = p.now() + 5e3;
      while (!expected.every((e) => equal(e.bank ? at(e.bank) : p.items()[e.inventory], e.item))) {
        active();
        if (p.now() >= deadline) throw Error("Bank stack transfer not confirmed; recovery pending");
        await p.sleep(100);
      }
      active();
    }
    async function operation(run, expected) {
      active();
      const journal = p.read() || { buffers: [] };
      p.write({ ...journal, pending: expected });
      await run();
      await settle(expected);
      p.write({ ...journal, pending: void 0 });
    }
    async function travel(floor) {
      active();
      if (p.map() !== floor) await p.move(floor);
      if (p.map() !== floor) throw Error("Bank floor not reached");
    }
    async function locations() {
      const protection = await p.protection();
      if (protection.error) throw Error(protection.error);
      const floors = p.reachable();
      return stackLocations(p.bank(), protection).filter((l) => floors.includes(p.floor(l.pack))).map((location) => ({ ...location, item: copy(location.item) }));
    }
    async function permitted(location) {
      const protection = await p.protection();
      if (stackProtected({ ...location, item: at(origin(location)) }, protection))
        throw Error("Bank stack location is reserved");
    }
    async function returnBuffer(buffer) {
      const item = p.items()[buffer.slot];
      if (!item) return;
      if (stackIdentity(item) !== buffer.identity) throw Error("Bank stack buffer changed; manual recovery required");
      if (buffer.source !== void 0) {
        const source = p.items()[buffer.source];
        if (!source || stackIdentity(source) !== buffer.identity || stackQuantity(source) + stackQuantity(item) > p.limit(item))
          throw Error("Bank stack split recovery blocked");
        await operation(() => p.swap(buffer.source, buffer.slot), [
          { inventory: buffer.source, item: { ...source, q: stackQuantity(source) + stackQuantity(item) } },
          { inventory: buffer.slot, item: null }
        ]);
      } else if (buffer.origin) {
        await travel(buffer.origin.floor);
        if (at(buffer.origin)) throw Error("Bank stack recovery location occupied");
        await operation(() => p.store(buffer.slot, buffer.origin.pack, buffer.origin.slot), [
          { inventory: buffer.slot, item: null },
          { bank: buffer.origin, item: copy(item) }
        ]);
      }
    }
    async function recover() {
      const journal = p.read();
      if (!journal) return;
      if (journal.pending) {
        await settle(journal.pending);
        p.write({ ...journal, pending: void 0 });
      }
      let buffers = [...new Map(journal.buffers.map((buffer) => [buffer.slot, buffer])).values()];
      if (!journal.pending && buffers.length !== journal.buffers.length) {
        buffers = buffers.filter((buffer) => stackIdentity(p.items()[buffer.slot]) === buffer.identity);
        p.write({ buffers, supersededBuffers: journal.buffers });
      }
      for (const buffer of buffers.sort((a, b) => Number(b.source !== void 0) - Number(a.source !== void 0)))
        await returnBuffer(buffer);
      p.write(null);
    }
    function remember(buffers) {
      const old = p.read();
      p.write({ buffers: [...old?.buffers || [], ...buffers] });
    }
    async function retrieve(location, inv) {
      const o = origin(location), item = copy(at(o));
      await travel(o.floor);
      await permitted(location);
      if (!equal(at(o), location.item) || p.items()[inv]) throw Error("Bank stack source changed");
      remember([{ slot: inv, identity: stackIdentity(item), origin: o }]);
      await operation(() => p.retrieve(o.pack, o.slot, inv), [{ inventory: inv, item }, { bank: o, item: null }]);
    }
    async function transfer(slot, target, quantity) {
      const source = copy(p.items()[slot]), targetItem = copy(target.item);
      if (!source || !targetItem) throw Error("Bank stack transfer source missing");
      const buffers = empty(), partial = quantity < stackQuantity(source);
      if (buffers.length < (partial ? 2 : 1)) throw Error("Bank stacking needs free inventory buffers");
      await retrieve(target, buffers[0]);
      let chunk = slot;
      if (partial) {
        chunk = empty()[0];
        remember([{ slot: chunk, identity: stackIdentity(source), source: slot }]);
        await operation(() => p.split(slot, quantity), [
          { inventory: slot, item: { ...source, q: stackQuantity(source) - quantity } },
          { inventory: chunk, item: { ...source, q: quantity } }
        ]);
      }
      const combined = { ...targetItem, q: stackQuantity(targetItem) + quantity };
      await operation(() => p.swap(buffers[0], chunk), [{ inventory: buffers[0], item: combined }, { inventory: chunk, item: null }]);
      const o = origin(target);
      if (at(o)) throw Error("Bank stack destination changed");
      await operation(() => p.store(buffers[0], o.pack, o.slot), [{ inventory: buffers[0], item: null }, { bank: o, item: combined }]);
    }
    async function fill(slot) {
      await recover();
      const initialFloor = p.map();
      while (p.items()[slot]) {
        const item = copy(p.items()[slot]), limit = p.limit(item);
        const available = await locations();
        const plan = stackDepositPlan(item, limit, available);
        const target = plan.moves.find((move) => move.item);
        if (!target) break;
        await travel(p.floor(target.pack));
        if (!equal(at(origin(target)), target.item) || !equal(p.items()[slot], item))
          throw Error("Bank stack changed during travel; retry deposit");
        const pack = p.bank()[target.pack];
        const safe = pack.every((entry, index) => !entry || stackIdentity(entry) !== stackIdentity(item) || available.some((l) => l.pack === target.pack && l.slot === index));
        if (target.quantity === stackQuantity(item) && safe) {
          await permitted(target);
          await operation(() => p.store(slot, target.pack), [
            { inventory: slot, item: null },
            { bank: origin(target), item: { ...target.item, q: stackQuantity(target.item) + stackQuantity(item) } }
          ]);
        } else await transfer(slot, target, target.quantity);
        await recover();
      }
      await travel(initialFloor);
    }
    async function compact() {
      await recover();
      const initialFloor = p.map();
      let moved = 0, deferred = false;
      for (; ; ) {
        const plan = nextStackMerge(await locations(), (item) => p.limit(item));
        if (!plan) break;
        const { source, target, quantity } = plan;
        if (source.pack === target.pack && quantity === stackQuantity(source.item)) {
          await travel(p.floor(source.pack));
          await permitted(source);
          await permitted(target);
          await operation(() => p.bankSwap(source.pack, source.slot, target.slot), [
            { bank: origin(source), item: null },
            { bank: origin(target), item: { ...target.item, q: stackQuantity(target.item) + quantity } }
          ]);
          p.write(null);
        } else {
          const buffers = empty();
          if (buffers.length < (quantity < stackQuantity(source.item) ? 3 : 2)) {
            deferred = true;
            break;
          }
          await retrieve(source, buffers[0]);
          await transfer(buffers[0], target, quantity);
          await recover();
        }
        moved++;
      }
      await travel(initialFloor);
      return { moved, deferred };
    }
    let flight = Promise.resolve();
    function serial(run) {
      const next = flight.then(run, run);
      flight = next.catch(() => {
      });
      return next;
    }
    return {
      fill: (slot) => serial(() => fill(slot)),
      compact: () => serial(compact),
      recover: () => serial(recover),
      locations,
      pending: () => !!p.read()
    };
  }
  Object.assign(globalThis, { partyCreateBankStacks: createBankStacks });

  // runtime/upgrade-preview.ts
  var previewOptions = ["none", "offeringp", "offering", "offeringx"];
  function unavailablePreview(executor, item, reason) {
    return { executor, item, options: Object.fromEntries(previewOptions.map((option) => [option, { reason }])) };
  }

  // runtime/characters/upgrade-preview.ts
  var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function matchesPreviewItem(live, wanted) {
    return !!live && Object.entries(wanted).every(([key, value]) => same(live[key], value));
  }
  async function previewUpgrade(request, ports) {
    const live = ports.items()[request.slot];
    if (!matchesPreviewItem(live, request.item)) return unavailablePreview(request.executor, request.item, "Item changed; reopen the menu");
    const original = JSON.stringify(live);
    const result = unavailablePreview(request.executor, request.item, "Preview expired; refresh");
    for (const option of previewOptions) {
      if (!ports.current() || ports.now() >= request.expiresAt) break;
      if (JSON.stringify(ports.items()[request.slot]) !== original)
        return unavailablePreview(request.executor, request.item, "Item changed; reopen the menu");
      result.options[option] = await previewOption(request, ports, live, option);
      if (!ports.current() || JSON.stringify(ports.items()[request.slot]) !== original)
        return unavailablePreview(request.executor, request.item, "Item or session changed; reopen the menu");
    }
    return result;
  }
  async function previewOption(request, ports, live, option) {
    const scrollName = "scroll" + ports.grade(live);
    const scroll = ports.items().findIndex((item) => item?.name === scrollName);
    const offering = option === "none" ? null : ports.items().findIndex((item) => item?.name === option && !item.l);
    if (scroll < 0) return { reason: "Missing " + scrollName + " in merchant inventory" };
    if (offering === -1) return { reason: "Offering not in merchant inventory" };
    try {
      const preview = await ports.preview(request.slot, scroll, offering, true);
      if (!validPreview(preview, request.item, scrollName, option)) throw Error("Mismatched server preview");
      return { preview, observedAt: ports.now() };
    } catch (error) {
      return { reason: previewError(error) };
    }
  }
  function validPreview(preview, item, scroll, option) {
    return preview.calculate === true && Number.isFinite(preview.chance) && preview.chance >= 0 && preview.scroll === scroll && (preview.offering || void 0) === (option === "none" ? void 0 : option) && matchesPreviewItem(preview.item, item);
  }
  function previewError(error) {
    if (error instanceof Error) return error.message;
    const data = error;
    const reason = data?.reason || data?.response || "Server preview unavailable";
    return { cant_in_bank: "Merchant is in the bank", distance: "Merchant must be near the upgrader or have a computer", upgrade_in_progress: "Merchant busy", item_locked: "Item is locked" }[reason] || reason;
  }
  globalThis.previewPartyUpgrade = previewUpgrade;

  // runtime/characters/legacy-entry.ts
  var root = globalThis;
  root.__partyReady = root.parent.caracAL.load_scripts([
    "adventure_land/farming-zones.js",
    "adventure_land/shared.js",
    "adventure_land/profiles.js",
    "adventure_land/roles.js"
  ]).then(() => root.partyRoleRunner.start());
})();
