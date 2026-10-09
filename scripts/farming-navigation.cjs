// Coordinator-owned farming intent. Event snapshots never authorize movement.
const farmZones = require('../characters/farming-zones.cjs');
const {returnArrivalRadius}=require('../runtime/coordinator/navigation/halloween-return-arrival.ts');
module.exports = function farmingNavigation(party, hooks) {
  const now = hooks.now || Date.now;
  party.navigationIntents ||= {};
  function intent(name) {
    const saved=party.navigationIntents[name] || { revision: 0, cancelled: false };
    // An empty ordinary farming focus is a backup preference while Hunt owns
    // the destination. Recover legacy cancellations without reviving manual Town.
    if(saved.cancelled && saved.reason==='monster focus cleared' && party.farmingPolicy==='hunt' &&
        party.monsterHunt && !party.monsterHunt.exitMode && party.monsterHunt.participants.includes(name))
      return {...saved,cancelled:false};
    return saved;
  }
  function members() {
    return hooks.names().filter(name => name !== party.merchantCharacter &&
      (name === party.leader || party.followers[name]));
  }
  function waypoint(name) {
    if (intent(name).cancelled) return null;
    return party.characterLocations[name] || (members().includes(name) ? party.location : null) || null;
  }
  function capture(names = members()) {
    return Object.fromEntries(names.map(name => [name, {
      revision: intent(name).revision, location: waypoint(name) && { ...waypoint(name) },
    }]));
  }
  function location(owner, name) {
    const saved = owner.waypoints && owner.waypoints[name];
    if (intent(name).cancelled) return null;
    // Legacy cycles may use only the current authorized waypoint, never a
    // historical coordinate whose relationship to navigation intent is lost.
    if (!saved) return owner.waypoints ? null : waypoint(name);
    return saved.revision === intent(name).revision ? saved.location : null;
  }
  function at(name, destination, radius=180) {
    const status = party.statuses[name];
    return !!(destination && status && status.seenAt >= now() - 10000 && !status.rip && status.hp !== 0 &&
      status.map === destination.map && (destination.in == null || String(status.in ?? status.map) === String(destination.in)) &&
      (destination.boundary || destination.polygon || destination.shapes || destination.allOf
        ? farmZones.contains(destination, status, 0, 180)
        : Math.hypot(Number(status.x) - destination.x, Number(status.y) - destination.y) <= radius));
  }
  function releaseReturn(owner) {
    const routes = Object.values(owner.returnRoutes || {});
    const convoy = party.activeConvoy;
    let changed = false;
    if (convoy && (convoy.id === owner.convoyId || routes.some(route => route.convoyId === convoy.id))) {
      hooks.cancelConvoy();
      changed = true;
    }
    for (const [name, route] of Object.entries(owner.returnRoutes || {})) {
      if (route.commandId && party.commands[name]?.id === route.commandId) {
        delete party.commands[name];
        changed = true;
      }
    }
    return changed;
  }
  function finish(owner, reason) {
    releaseReturn(owner);
    owner.returnDispatchedAt ||= now();
    owner.returnCompletedAt = now();
    owner.returnReason = reason;
    for (const name of owner.participants || []) {
      if (party.deferredEventReturns[name]?.cycleId === (owner.cycleId || owner.id)) continue;
      const trip = party.huntEventTrips?.[name]?.at(-1);
      if (trip && !trip.endedAt && (trip.event === owner.event || trip.event === 'anniversary' && owner === party.anniversary.eventCycle)) trip.endedAt = now();
    }
    completeEventHandoff();
    if (owner === party.anniversary.eventCycle) {
      party.anniversary.returnReady = {};
      party.anniversary.returnDestination = null;
      party.anniversary.partyHold = null;
    }
  }
  function completeEventHandoff() {
    if (party.combatEventHandoff && !Object.values(party.huntEventTrips || {}).some(trips => trips.length && !trips.at(-1).endedAt))
      party.combatEventHandoff.endedAt ||= now();
  }
  function invalidate(names, reason, shared = false) {
    const affected = new Set(names);
    if (shared) party.location = null;
    for (const name of affected) {
      if (reason !== 'new destination') {
        const trip = party.huntEventTrips?.[name]?.at(-1);
        if (trip && !trip.endedAt) trip.endedAt = now();
      }
      party.navigationIntents[name] = { revision: intent(name).revision + 1, cancelled: true, reason };
      delete party.characterLocations[name];
      const command = party.commands[name];
      if (command && ['travel', 'force-travel', 'character-travel', 'party-monster-travel',
        'event-resume-travel', 'return-leader'].includes(command.type)) delete party.commands[name];
      const deferred = party.deferredEventReturns[name];
      if (deferred) {
        deferred.checkpoint = null;
        deferred.navigationRevision = intent(name).revision;
      }
    }
    for (const owner of [party.anniversary.eventCycle, party.eventReturn, ...Object.values(party.eventSessions)]) {
      if (!owner) continue;
      owner.waypoints ||= capture(owner.participants || members());
      for (const name of affected) {
        owner.waypoints[name] = { revision: intent(name).revision, location: null };
        if (owner.returnRoutes) delete owner.returnRoutes[name];
      }
      if (shared) { owner.destination = null; owner.checkpoint = null; }
    }
    if (shared) party.anniversary.returnDestination = null;
    const convoy = party.activeConvoy;
    if (convoy && convoy.participants.some(name => affected.has(name))) {
      const remaining = convoy.participants.filter(name => !affected.has(name));
      hooks.cancelConvoy();
      // Remaining members retain their destination. Reassemble once so a
      // removed pace character cannot leave the other members waiting on it.
      if (remaining.includes(party.leader) && remaining.length) {
        hooks.startConvoy(convoy.location, convoy.label, remaining, convoy.purpose);
        for (const owner of [party.anniversary.eventCycle, party.eventReturn]) {
          if (owner && owner.convoyId === convoy.id) owner.convoyId = party.activeConvoy && party.activeConvoy.id;
        }
      }
    }
    completeEventHandoff();
    hooks.persist();
  }
  function authorize(names, destination, shared = false) {
    // Changing destinations invalidates old event snapshots too. A future
    // event captures the newly selected waypoint, not the replaced one.
    invalidate(names, 'new destination', shared);
    for (const name of names) {
      party.navigationIntents[name] = { revision: intent(name).revision, cancelled: false };
      if (!shared) party.characterLocations[name] = { ...destination };
    }
    if (shared) party.location = { ...destination };
    for (const owner of [party.anniversary.eventCycle, party.eventReturn, ...Object.values(party.eventSessions)]) {
      if (!owner || owner.returnCompletedAt || owner.supersededAt) continue;
      owner.waypoints ||= capture(owner.participants || members());
      for (const name of names) owner.waypoints[name] = {
        revision: intent(name).revision, location: { ...destination },
      };
      if (shared) { owner.destination = { ...destination }; owner.checkpoint = { ...destination }; }
    }
    // Explicit movement releases the manual Town barrier for those members.
    if (party.townCycle) {
      party.townCycle.pending = party.townCycle.pending.filter(name => !names.includes(name));
      if (!party.townCycle.pending.length) party.townCycle = null;
    }
    hooks.persist();
  }
  function dispatch(owner, purpose, names) {
    if (owner.returnCompletedAt || owner.supersededAt) return true;
    // Replayed dispatch must preserve command/convoy identities and in-flight paths.
    if (owner.returnDispatchedAt && owner.returnRoutes) { reconcile(owner, purpose); return true; }
    const routes = {};
    for (const name of names) {
      const destination = location(owner, name);
      if (!destination) continue;
      if (!hooks.activeNames().includes(name)) {
        party.deferredEventReturns[name] = { cycleId: owner.cycleId || owner.id, event: owner.event || null,
          checkpoint: { ...destination }, navigationRevision: intent(name).revision,
          phase: 'awaiting-reconnect', deferredAt: now() };
        continue;
      }
      routes[name] = { location: { ...destination }, revision: intent(name).revision };
    }
    owner.returnRoutes = routes;
    if (!Object.keys(routes).length) { finish(owner, 'no active farming waypoint'); hooks.persist(); return true; }
    const pending = Object.keys(routes).filter(name => !at(name, routes[name].location,returnArrivalRadius(owner)));
    if (!pending.length) { finish(owner, 'already at return destination'); hooks.persist(); return true; }
    const leaderRoute = routes[party.leader];
    const group = leaderRoute ? pending.filter(name => {
      const a = routes[name].location, b = leaderRoute.location;
      return a.map === b.map && a.x === b.x && a.y === b.y;
    }) : [];
    // Convoys require a leader. If the leader is already there, individual
    // return commands avoid making the leader depart for another assembly.
    if (group.includes(party.leader)) {
      if (party.activeConvoy || !hooks.startConvoy(leaderRoute.location,
        'the saved farming waypoint', group, purpose)) return false;
      owner.convoyId = party.activeConvoy.id;
      for (const name of group) routes[name].convoyId = owner.convoyId;
    }
    for (const name of pending) {
      if (routes[name].convoyId) continue;
      const command = { id: party.nextCommandId++, type: 'event-resume-travel',
        cycleId: owner.cycleId || owner.id, event: owner.event || null,
        purpose, location: routes[name].location, navigationRevision: routes[name].revision,
        label: 'the saved farming waypoint' };
      party.commands[name] = command;
      routes[name].commandId = command.id;
    }
    owner.returnDispatchedAt = now();
    if (owner === party.anniversary.eventCycle) {
      party.anniversary.returnReady = {};
      party.anniversary.returnDestination = null;
      party.anniversary.partyHold = null;
    }
    hooks.persist();
    return true;
  }
  function reconcile(owner, purpose) {
    if (owner.returnCompletedAt || owner.supersededAt) {
      if (releaseReturn(owner)) {
        hooks.log('Released completed event return travel', 'info');
        hooks.persist();
      }
      return true;
    }
    const routes = owner.returnRoutes;
    if (!routes) return false;
    const pending = Object.keys(routes).filter(name => routes[name].revision === intent(name).revision &&
      !intent(name).cancelled && !routes[name].engagedAt && !at(name, routes[name].location,returnArrivalRadius(owner)));
    if (!pending.length) { finish(owner, 'return completed'); hooks.persist(); return true; }
    if (now() - owner.returnDispatchedAt < 2000) return false;
    // A failed barrier cannot make progress, even though its identity still matches.
    // Release only this return's convoy; manual revisions are checked above.
    const convoy = party.activeConvoy;
    if (convoy?.phase === 'failed' && pending.some(name => routes[name].convoyId === convoy.id))
      hooks.cancelConvoy();
    // A command/convoy with a different identity cannot keep this return alive.
    const missing = pending.filter(name => {
      const route = routes[name], command = party.commands[name];
      const status = party.statuses[name];
      if (route.commandId === command?.id && now() - owner.returnDispatchedAt >= 10000 &&
          status?.seenAt >= now() - 10000 && status.farmReunion?.phase === 'waiting-for-party-near-farm')
        return true;
      return !(route.convoyId && party.activeConvoy && party.activeConvoy.id === route.convoyId) &&
        !(route.commandId && command && command.id === route.commandId);
    });
    if (!missing.length || party.activeConvoy || now() < (owner.returnRetryNotBefore || 0)) return false;
    // Offline members retain a deferred waypoint instead of causing a retry loop.
    for (const name of missing.filter(name => !hooks.activeNames().includes(name))) {
      party.deferredEventReturns[name] = { cycleId: owner.cycleId || owner.id, event: owner.event || null,
        checkpoint: routes[name].location, navigationRevision: routes[name].revision,
        phase: 'awaiting-reconnect', deferredAt: now() };
      delete routes[name];
    }
    const retry = missing.filter(name => hooks.activeNames().includes(name));
    if (retry.length) {
      // When everyone is still in town, individual reunion commands wait for
      // someone already at the farm. Send the leader's group there as a convoy.
      const leaderRoute = routes[party.leader];
      const group = leaderRoute && retry.includes(party.leader) ? retry.filter(name => {
        const a = routes[name].location, b = leaderRoute.location;
        return a.map === b.map && a.x === b.x && a.y === b.y;
      }) : [];
      const grouped = group.length && hooks.startConvoy(leaderRoute.location,
        'the saved farming waypoint', group, purpose);
      if (grouped) owner.convoyId = party.activeConvoy.id;
      for (const name of retry) {
        const route = routes[name];
        if (grouped && group.includes(name)) {
          if (party.commands[name]?.id === route.commandId) delete party.commands[name];
          route.convoyId = owner.convoyId;
          delete route.commandId;
          continue;
        }
        const command = { id: party.nextCommandId++, type: 'event-resume-travel',
          cycleId: owner.cycleId || owner.id, purpose, location: route.location,
          navigationRevision: route.revision, label: 'the saved farming waypoint' };
        party.commands[name] = command;
        route.commandId = command.id;
        delete route.convoyId;
      }
      hooks.log('Retrying interrupted farming return for ' + retry.join(', '), 'info');
      owner.returnRetryCount = (owner.returnRetryCount || 0) + 1;
      owner.returnRetryNotBefore = now() + [5000,15000,30000,60000][Math.min(owner.returnRetryCount - 1,3)];
    }
    owner.returnDispatchedAt = now();
    hooks.persist();
    return false;
  }
  function supersede(cycle) {
    if (!cycle || cycle.returnCompletedAt) return;
    cycle.supersededAt = now();
    if (party.activeConvoy && party.activeConvoy.id === cycle.convoyId) hooks.cancelConvoy();
    for (const [name, route] of Object.entries(cycle.returnRoutes || {})) {
      if (party.commands[name] && party.commands[name].id === route.commandId) delete party.commands[name];
    }
    finish(cycle, 'superseded by next anniversary round');
    hooks.persist();
  }
  return { intent, members, waypoint, capture, location, at, releaseReturn, finish, invalidate, authorize, dispatch, reconcile, supersede };
};
