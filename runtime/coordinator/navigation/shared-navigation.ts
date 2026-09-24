import { recordConvoyHistory } from "./convoy-history.ts";
import { createCommunicationRecovery } from './communication-recovery.ts';
import { beginGeometryRepair, geometryMismatch, geometryRepairReady, geometryReloadSignal } from './geometry-repair.ts';
import { reconcileReturnArrival } from './return-arrival.ts';
import { departureIssue, readinessIssue, readinessExpired, readinessFailure, recoveryPlanner } from './shared-departure.ts';
import { prepareContinuousReturn, checkpointContinuousReturn } from './continuous-return.ts';
import { stepMerchantInterruption } from "./merchant-interruption.ts";
import { observeReturnTown, returnWalking, townOutcomesReady } from './return-town.ts';
import type { ConvoyNavigationPlatform } from "../infrastructure/convoy-platform.ts";
import { engageHunt, propagateHuntTarget } from "../hunt/engagement.ts";
import { engageFarming } from "./farming-engagement.ts";
import { clearSharedRoute, sharedRoute } from "./shared-route-store.ts";
import { characterRuntime, distance, point, reportMatches, type SharedCommand, type SharedConvoy, type SharedState, type SharedStatus } from "./shared-route-types.ts";

export function sharedCommand(state: SharedState, c: SharedConvoy, phase: string, name: string): SharedCommand {
  const command: SharedCommand = { id: state.nextCommandId++, type: "party-monster-travel", phase,
    convoyId: c.id, epoch: c.epoch, navigationRevision: state.navigationIntents?.[name]?.revision || 0,
    routeProtocol: 4, routeVersion: c.routeVersion || 0, nativeFallback: c.nativeFallback, avoidLeave: c.avoidLeave, location: c.location, rally: c.rally,
    leader: c.leader, participants: c.participants, slowestSpeed: c.slowestSpeed, purpose: c.purpose,
    navigationExempt: c.navigationExempt, combatHandoffAllowed: c.combatHandoffAllowed, cause: c.cause, huntTarget: c.huntTarget,
    continuousReturn: c.continuousReturn, disableTown: c.disableTown, returnWalking: returnWalking(c),
    returnLeg: !c.continuousReturn && !!c.returnLegs, nonPreemptible: !!c.nonPreemptible, force: c.force };
  (c.expected ||= {})[name] = { commandId: command.id, revision: command.navigationRevision,
    phase, runtimeId: characterRuntime(state.statuses[name]) || null };
  return command;
}
function issue(state: SharedState, c: SharedConvoy, phase: string): void {
  for (const name of c.participants) {
    if (!c.completed.includes(name)) state.commands[name] = sharedCommand(state, c, phase, name);
  }
}
function members(c: SharedConvoy): string[] { return c.participants.filter(n => !c.completed.includes(n)); }
function unpreparedHuntReturn(c: SharedConvoy): boolean {
  return c.purpose === "monster-hunt" && !!c.returnRouting && !c.routeServer && !c.routeVersion;
}
function disableFailedTown(c: SharedConvoy, reason: string): void {
  // Interrupted casts use the map-local round counter, never a text match.
  if (!c.continuousReturn && /town/i.test(reason)) c.disableTown = true;
}
function reassembleReturn(state: SharedState, c: SharedConvoy): void {
  c.phase = "assemble"; c.departAt = null; c.observedPhase = null;
  delete c.returnLegs; c.townFirst = false; c.completed = [];
  c.rally = c.returnTownRally || point(state.statuses[c.leader]!);
  c.failure = undefined; c.failureCode = undefined;
  clearSharedRoute(c);
  issue(state, c, "assemble");
}
function deferredAssembly(state: SharedState, c: SharedConvoy): boolean {
  return members(c).some(name => state.commands[name]?.deferRendezvous);
}
function walkingAssembly(c: SharedConvoy): boolean {
  return c.phase === "assemble" && !c.townFirst && (!!c.continuousReturn || !c.returnRouting || !!c.returnLegs);
}
function fresh(s: SharedStatus | undefined, now: number): s is SharedStatus {
  return !!s && s.seenAt >= now - 3000 && !s.rip && s.hp !== 0;
}
function compatible(state: SharedState, c: SharedConvoy, now: number): boolean {
  const leader = state.statuses[c.leader];
  return members(c).every(name => {
    const s = state.statuses[name];
    return fresh(s, now) && s.convoyProtocol === 4 && !!characterRuntime(s) && s.server === leader?.server;
  });
}
function begin(state: SharedState, c: SharedConvoy, now: number): boolean {
  delete c.missingRoutes;
  const leader = state.statuses[c.leader];
  if (!compatible(state, c, now) || !leader || leader.moving) return false;
  c.phase = "shared-prepare";
  delete c.arrivalReadySince;
  c.routeVersion = (c.routeVersion || 0) + 1;
  c.rally = point(leader); c.departAt = null; c.sharedReadySince = 0;
  delete c.returnTownRally;
  c.routeServer = leader.server;
  c.sharedStartedAt = now; c.sharedProgressAt = now; c.sharedDistances = {};
  delete c.sharedWaitingAt;
  delete c.routePublishedAt;
  c.runtimes = Object.fromEntries(members(c).map(n => [n, characterRuntime(state.statuses[n])!]));
  clearSharedRoute(c);
  issue(state, c, "shared-prepare");
  recordConvoyHistory(state, c, "route preparation", now, { routeVersion: c.routeVersion, origin: c.rally, reason: c.failure });
  return true;
}
function lostOwner(state: SharedState, c: SharedConvoy, name: string): boolean {
  const command = state.commands[name], intent = state.navigationIntents?.[name];
  if (!command || command.convoyId !== c.id) return true;
  if (intent?.cancelled && !c.navigationExempt) return true;
  return !!intent && intent.revision !== command.navigationRevision;
}
function scanAssemblyReady(state: SharedState, c: SharedConvoy): boolean {
  if (c.purpose !== 'phoenix-patrol') return true;
  return members(c).every(name => {
    const s=state.statuses[name], n=s?.convoyNavigation, command=state.commands[name];
    return !!n && !!command && n.id===c.id && n.epoch===c.epoch && n.commandId===command.id &&
      n.navigationRevision===command.navigationRevision && n.runtimeId===characterRuntime(s) &&
      n.phase==='assembled' && !s!.moving;
  });
}
function ownerLostReason(state: SharedState, c: SharedConvoy): string {
  const name = members(c).find(n => lostOwner(state, c, n));
  if (!name) return "Convoy owner-lost";
  const command = state.commands[name];
  return "Convoy owner-lost: " + name + " travel replaced by " + (command?.type || "no command") +
    " (saved revision " + c.expected?.[name]?.revision + ", current " + state.navigationIntents?.[name]?.revision + ")";
}
function readyMember(state: SharedState, c: SharedConvoy, name: string): boolean {
  return !readinessIssue(state, c, name);
}
function preparationBlocker(state: SharedState, c: SharedConvoy): string | undefined {
  const missing = members(c).filter(name => !reportMatches(state, name));
  if (missing.length) return 'Waiting for current route acknowledgement: ' + missing.map(n=>n+' ('+acknowledgementReason(state,c,n)+')').join(', ');
  if (!sharedRoute(c)) return 'Waiting for ' + c.leader + ' to publish the return route';
  const waiting = members(c).filter(name => !readyMember(state, c, name));
  if (waiting.length) return 'Waiting for stopped formation and installed route: ' + waiting.join(', ');
  return undefined;
}
function acknowledgementReason(state:SharedState,c:SharedConvoy,name:string):string {
  const n=state.statuses[name]?.convoyNavigation,cmd=state.commands[name];
  if(!n || !n.id)return 'no local return handle';
  if(!cmd || n.commandId!==cmd.id)return 'waiting for command '+cmd?.id+'; reported '+n.commandId;
  if(n.runtimeId!==c.runtimes?.[name])return 'runtime changed';
  return 'return generation or navigation changed';
}
function observeProgress(state: SharedState, c: SharedConvoy, now: number): void {
  const distances = c.sharedDistances ||= {};
  for (const name of members(c)) {
    const d = distance(state.statuses[name]!, c.rally);
    if (distances[name] === undefined || d < distances[name]! - 5) { distances[name] = d; c.sharedProgressAt = now; }
  }
}
function assemblyTimeout(c: SharedConvoy, now: number): boolean {
  return now - c.sharedStartedAt! >= 120000 || now - c.sharedProgressAt! >= 30000;
}
function authorizedHold(state: SharedState, c: SharedConvoy, name: string): boolean {
  const intent = state.navigationIntents?.[name], command = state.commands[name];
  if (command && command.convoyId !== c.id) return false;
  if (intent?.cancelled && !c.navigationExempt) return false;
  return holdRevision(state, c, name) === (intent?.revision || 0);
}
function holdRevision(state: SharedState, c: SharedConvoy, name: string): number | undefined {
  return c.expected?.[name]?.revision ?? state.commands[name]?.navigationRevision;
}

function eventEntry(c: SharedConvoy): boolean {
  return c.purpose === "shared-walk" && !c.navigationExempt && !c.nonPreemptible &&
    (c.walkingActivity === "event" || c.label === "event walking leg");
}
function terminalCommand(state: SharedState, c: SharedConvoy, name: string): SharedCommand {
  const command = sharedCommand(state, c, eventEntry(c) ? "event-walk-release" : "hold", name);
  command.reason = c.failure || "Event walking failed";
  return command;
}
/** Existing Town/itinerary/defense barriers delegate here for every walking leg. */
export function createSharedConvoyNavigation(legacy: ConvoyNavigationPlatform,
  defense: (state: SharedState, now: number, command: typeof sharedCommand) => boolean = () => false): ConvoyNavigationPlatform {
  const communication = createCommunicationRecovery({ owned: authorizedHold, fail: terminal, resume: begin,
    hold: (state, c) => {
      c.completed = [];
      clearSharedRoute(c); delete c.readinessStartedAt; delete c.arrivalReadySince;
      c.runtimes = Object.fromEntries(c.participants.map(n => [n, characterRuntime(state.statuses[n]) || '']));
      issue(state, c, 'shared-hold');
    } });
  function terminal(state: SharedState, reason: string, code: string): boolean {
    const c = state.activeConvoy;
    if (c?.routeProtocol !== 4) return legacy.hold(state, reason, code);
    if (c.phase === "failed") return false;
    clearSharedRoute(c); c.phase = "failed"; c.failure = reason; c.failureCode = code; c.failedAt = Date.now(); c.departAt = null;
    if (code === 'geometry-mismatch') { c.retryExhausted=true; if(c.geometryRepair)c.geometryRepair.phase='failed'; }
    recordConvoyHistory(state, c, "failed", c.failedAt, { reason, code, commands: Object.fromEntries(members(c).map(name => [name, state.commands[name]?.type])) });
    for (const name of members(c)) if (authorizedHold(state, c, name)) state.commands[name] = terminalCommand(state, c, name);
    return true;
  }
  function recover(state: SharedState, reason: string, now: number): boolean {
    const c = state.activeConvoy!;
    if (/game geometry mismatch/i.test(reason)) return repairGeometry(state, c, reason, now);
    if (c.phase === "shared-hold" || c.phase === "failed") return false;
    if (readinessFailure(c, reason)) return prepareAgain(state, c, reason, now);
    if ((c.recoveryAttempts || 0) >= 2) {
      c.retryExhausted = true;
      return terminal(state, "Regroup retries exhausted: " + reason, "route-failed");
    }
    c.recoveryAttempts = (c.recoveryAttempts || 0) + 1;
    recoveryPlanner(c, reason);
    disableFailedTown(c,reason);
    // Return itinerary planning precedes begin(), so there is no shared-route
    // realm/runtime identity to validate or resume yet.
    if (unpreparedHuntReturn(c)) {
      return recoverUnprepared(state,c,reason,now);
    }
    c.epoch++; c.phase = "shared-hold"; c.departAt = null; c.failure = reason;
    c.sharedStoppedAt = now; clearSharedRoute(c);
    issue(state, c, "shared-hold");
    recordConvoyHistory(state, c, "regrouping", now, { reason, recoveryAttempts: c.recoveryAttempts });
    return true;
  }
  function repairGeometry(state: SharedState, c: SharedConvoy, reason: string, now: number): boolean {
    if (c.geometryRepair?.phase === 'waiting') return false;
    if (!beginGeometryRepair(state,c,now))
      return terminal(state, 'Geometry recovery failed: ' + reason, 'geometry-mismatch');
    c.epoch++; c.phase='shared-hold'; c.departAt=null; c.failure=reason;
    c.sharedStoppedAt=now; clearSharedRoute(c); issue(state,c,'shared-hold');
    recordConvoyHistory(state,c,'geometry repair',now,{reason,repair:c.geometryRepair});
    return true;
  }
  function stepGeometryRepair(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (!members(c).every(n=>authorizedHold(state,c,n))) {
      c.geometryRepair!.phase='failed';
      return terminal(state,'Geometry recovery superseded by newer navigation','owner-lost');
    }
    // A restart preserves the repair budget but recreates only still-owned holds.
    if (members(c).some(n=>!state.commands[n])) { issue(state,c,'shared-hold'); return true; }
    if (geometryRepairReady(state,c,now)) {
      c.geometryRepair!.phase='complete'; c.failure=undefined;
      return begin(state,c,now);
    }
    if (now-c.geometryRepair!.startedAt<60000) return false;
    c.geometryRepair!.phase='failed';
    return terminal(state,'Geometry recovery failed after one reload: fresh compatible game geometry not received within 60 seconds','geometry-mismatch');
  }
  function recoverUnprepared(state: SharedState, c: SharedConvoy, reason: string, now: number): boolean {
    if (!returnRuntimeReady(state,c,now))
      return terminal(state,"Hunt return recovery requires fresh compatible participants and unchanged navigation","owner-lost");
    c.epoch++; reassembleReturn(state,c);
    recordConvoyHistory(state,c,"regrouping",now,{reason,recoveryAttempts:c.recoveryAttempts});
    return true;
  }
  function hold(input: Parameters<ConvoyNavigationPlatform["hold"]>[0], reason: string, code = "route-failed"): boolean {
    const state = input as SharedState, c = state.activeConvoy;
    if (c?.continuousReturn && code === 'town-interrupted')return true;
    if (c?.routeProtocol === 4 && code === "route-failed") return recover(state, reason, Date.now());
    return terminal(state, reason, code);
  }
  function health(state: SharedState, c: SharedConvoy, now: number): string | null {
    for (const name of members(c)) {
      if (lostOwner(state, c, name)) return "owner-lost";
      if (!fresh(state.statuses[name], now)) return "unavailable";
      if (state.statuses[name]!.server !== c.routeServer) return "realm-lost";
      if (characterRuntime(state.statuses[name]) !== c.runtimes?.[name]) return "runtime-lost";
    }
    return null;
  }
  function resume(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (now - c.sharedStoppedAt! > 30000) return terminal(state, "Party did not acknowledge regroup hold", "assembly-timeout");
    const stopped = members(c).every(name => reportMatches(state, name) &&
      state.statuses[name]!.convoyNavigation?.phase === "held" && !state.statuses[name]!.moving);
    if (!stopped) return false;
    c.failure = undefined;
    return begin(state, c, now);
  }
  function prepare(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (readinessExpired(c, now)) return readinessTimeout(state, c, now);
    observeProgress(state, c, now);
    c.preparationBlocker = preparationBlocker(state, c);
    const allReady = !!sharedRoute(c) && members(c).every(n => readyMember(state, c, n));
    if (!allReady) {
      c.sharedReadySince = 0;
      const assembling = members(c).some(n => distance(state.statuses[n]!, c.rally) > 55 || state.statuses[n]!.moving);
      if (assembling && assemblyTimeout(c, now)) return recover(state, "Rendezvous made no progress", now);
      if (!assembling && now - c.sharedStartedAt! >= 60000) return recover(state, "Shared route preparation timed out", now);
      return false;
    }
    if (!c.sharedReadySince) { c.sharedReadySince = now; return true; }
    if (now - c.sharedReadySince < 500) return false;
    c.origins = Object.fromEntries(members(c).map(n => [n, point(state.statuses[n]!)]));
    c.phase = "scheduled"; c.departAt = now + departureDelay(c);
    return true;
  }
  function travel(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (c.phase === "scheduled" && now < c.departAt!) {
      const issue = departureIssue(state, c, now);
      if (issue) return prepareAgain(state, c, issue, now);
      return false;
    }
    if (c.phase === "scheduled") { c.phase = "travel"; delete c.readinessStartedAt; return true; }
    if (reconcileReturnArrival(state, c, now)) return true;
    const missing = missingTravelRoute(state, c, now);
    if (missing) return recover(state, "Travel route disappeared: " + missing, now);
    // Native legacy completion/leg barriers still own workflow advancement.
    return c.returnRouting && !c.continuousReturn ? legacy.step(state, now) : false;
  }
  function readinessTimeout(state: SharedState, c: SharedConvoy, now: number): boolean {
    return recover(state, 'Departure readiness timed out: ' + (c.preparationBlocker || 'unstable formation'), now);
  }
  function prepareAgain(state: SharedState, c: SharedConvoy, reason: string, now: number): boolean {
    c.readinessStartedAt ??= c.sharedStartedAt || now;
    if (now - c.readinessStartedAt >= 60000) return recover(state, 'Departure readiness timed out: ' + reason, now);
    c.preparationBlocker = reason;
    c.epoch++; c.phase = 'shared-hold'; c.departAt = null; c.sharedReadySince = 0;
    c.sharedStoppedAt = now; clearSharedRoute(c); issue(state, c, 'shared-hold');
    recordConvoyHistory(state, c, 'departure deferred', now, { reason });
    return true;
  }
  function activeStep(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (c.geometryRepair?.phase === 'waiting') return stepGeometryRepair(state,c,now);
    const problem = health(state, c, now);
    if (problem) return terminal(state, problem === "owner-lost" ? ownerLostReason(state, c) : "Convoy " + problem, problem);
    const mismatched = geometryMismatch(state,c);
    if (mismatched.length) return repairGeometry(state,c,'Shared route game geometry mismatch: ' + JSON.stringify({
      expected:sharedRoute(c)?.geometry || state.statuses[c.leader]?.movementGeometry,
      actual:Object.fromEntries(mismatched.map(n=>[n,state.statuses[n]?.movementGeometry]))}),now);
    if (c.phase === "shared-hold") return resume(state, c, now);
    return advanceHealthyRoute(state,c,now);
  }
  function advanceHealthyRoute(state: SharedState, c: SharedConvoy, now: number): boolean {
    const failed = members(c).find(n => reportMatches(state, n) && state.statuses[n]!.convoyNavigation?.phase === 'failed');
    if (failed) return recover(state, failed + ': ' + (state.statuses[failed]!.convoyNavigation?.failure || 'Character requested route recovery'), now);
    if (c.phase === "shared-prepare") return prepare(state, c, now);
    return travel(state, c, now);
  }
  function bootstrap(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (c.retryExhausted) return terminal(state, "Regroup retries exhausted; select the destination again", "route-failed");
    if (prepareContinuousReturn(state, c)) return false;
    if (walkingAssembly(c)) {
      return bootstrapWalking(state,c,now);
    }
    if (c.phase === "assemble" && deferredAssembly(state, c)) {
      issue(state, c, "assemble");
      return true;
    }
    const changed = legacy.step(state, now);
    if (c.phase === "prepare") return begin(state, c, now) || changed;
    return changed;
  }
  function bootstrapWalking(state: SharedState, c: SharedConvoy, now: number): boolean {
    if(c.sharedWaitingAt===undefined){c.sharedWaitingAt=now;c.sharedStartedAt=now;c.sharedProgressAt=now;c.sharedDistances={};}
    if(c.returnTownRally && compatible(state,c,now))return awaitTownRally(state,c,now);
    if (now-c.sharedWaitingAt>30000)return terminal(state,"Waiting for protocol 4 party runtimes","runtime-lost");
    return scanAssemblyReady(state,c) && begin(state,c,now);
  }
  function awaitTownRally(state:SharedState,c:SharedConvoy,now:number):boolean {
    observeProgress(state,c,now);
    if(members(c).every(n=>distance(state.statuses[n]!,c.rally)<=55))return begin(state,c,now);
    if(assemblyTimeout(c,now))return recover(state,'Town rendezvous made no progress',now);
    return false;
  }
  function step(input: Parameters<ConvoyNavigationPlatform["step"]>[0], now = Date.now()): boolean {
    const state = input as SharedState, c = state.activeConvoy;
    if (c?.routeProtocol !== 4) return legacy.step(state, now);
    const communicationChanged = communication(state, c, now);
    if (communicationChanged !== null) return communicationChanged;
    if (refreshReturnTown(state,c,now))return true;
    const interruption = stepMerchantInterruption(state, now, {
      hold: name => sharedCommand(state, c, "shared-hold", name),
      resume: phase => {
        c.epoch++; clearSharedRoute(c);
        if (["shared-prepare", "shared-hold", "scheduled", "travel"].includes(phase)) {
          c.phase = "shared-hold"; c.sharedStoppedAt = now;
          return begin(state, c, now);
        }
        c.phase = phase; issue(state, c, phase); return true;
      },
      fail: reason => terminal(state, reason, "owner-lost"),
    });
    if (interruption !== null) return interruption;
    return advanceRoute(state,c,now);
  }
  function advanceRoute(state:SharedState,c:SharedConvoy,now:number):boolean {
    if (c.geometryRepair?.phase === 'waiting') return stepGeometryRepair(state,c,now);
    if (c.phase === "failed") return failedStep(state, c, now);
    if (!c.force && defense(state, now, sharedCommand)) { clearSharedRoute(c); return true; }
    if(c.townRetry)return retryTown(state,c,now);
    if (["shared-prepare", "shared-hold", "scheduled", "travel"].includes(c.phase)) return activeStep(state, c, now);
    return bootstrap(state, c, now);
  }
  function retryTown(state:SharedState,c:SharedConvoy,now:number):boolean {
    if(townOutcomesReady(state,c,now))return resumeTownRetry(state,c);
    if(now-(c.townRetryAt || now)>15000)return recover(state,'Town cast outcomes not received',now);
    return false;
  }
  function releaseFailedEntry(state: SharedState, c: SharedConvoy): boolean {
    let changed = false;
    for (const name of members(c)) {
      if (!authorizedHold(state, c, name) || state.commands[name]?.phase === "event-walk-release") continue;
      state.commands[name] = terminalCommand(state, c, name); changed = true;
    }
    return changed;
  }
  function failedStep(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (recoverUnpreparedReturn(state, c, now)) return true;
    if (recoverReturnRuntime(state, c, now)) return true;
    if (eventEntry(c)) return releaseFailedEntry(state, c);
    if (members(c).every(name => authorizedHold(state, c, name)) && defense(state, now, sharedCommand)) return true;
    let changed = false;
    for (const name of members(c)) if (!state.commands[name] && authorizedHold(state, c, name)) {
      state.commands[name] = terminalCommand(state, c, name); changed = true;
    }
    return changed;
  }
  function returnRuntimeReady(state: SharedState, c: SharedConvoy, now: number): boolean {
    return compatible(state, c, now) && !state.statuses[c.leader]?.moving && members(c).every(name => authorizedHold(state, c, name));
  }
  function recoverUnpreparedReturn(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (!unpreparedHuntReturn(c) || c.failureCode !== "realm-lost" || c.retryExhausted || c.returnRuntimeRetries) return false;
    if (!returnRuntimeReady(state, c, now)) return false;
    c.returnRuntimeRetries = 1; c.epoch++;
    reassembleReturn(state, c);
    recordConvoyHistory(state, c, "regrouping", now, { reason: "Rebuilding Hunt return without initialized route identity" });
    return true;
  }
  function recoverReturnRuntime(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (c.purpose !== "shared-walk-return" || c.failureCode !== "runtime-lost" || c.retryExhausted) return false;
    const attempts = c.returnRuntimeRetries || 0;
    if (attempts >= 3) { c.retryExhausted = true; c.failure = "Return runtime recovery exhausted; request Party Town again"; return true; }
    if (now - (c.failedAt || now) < [5000,15000,30000][attempts]!) return false;
    if (!returnRuntimeReady(state, c, now)) return false;
    c.returnRuntimeRetries = attempts + 1;
    c.epoch++; c.failure = undefined; c.failureCode = undefined;
    return begin(state, c, now);
  }
  function signal(input: Parameters<ConvoyNavigationPlatform["signal"]>[0], name: string, now = Date.now()): unknown {
    const state = input as SharedState, c = state.activeConvoy;
    const result = legacy.signal(state, name, now) as Record<string, unknown> | null;
    if (!result || c?.routeProtocol !== 4) return result;
    return { ...result, geometryReload: geometryReloadSignal(state,c,name), returnWalking: returnWalking(c), immediateDeparture: immediateTownDeparture(c), farmingEngagement: c.farmingEngagement || null, routeProtocol: 4, routeVersion: c.routeVersion || 0, routeAvailable: !!sharedRoute(c) };
  }
  const engage: ConvoyNavigationPlatform["engage"] = (state, body, options) =>
    ["", "party-travel", "farm-relocation"].includes((state as SharedState).activeConvoy?.purpose || "")
      ? engageFarming(state as SharedState, body, options, legacy, sharedCommand)
      : engageHunt(state, body, options, legacy);
  return { ...legacy, step: (state, now) => {
    const changed = step(state, now);
    const checkpoint = checkpointContinuousReturn(state as SharedState, now ?? Date.now());
    propagateHuntTarget(state);
    return changed || checkpoint;
  }, signal, hold, engage };
}

// Health/ownership checks run first. Only fresh, continuously missing handles
// authorize regrouping; completed members and superseding navigation never do.
function missingTravelRoute(state: SharedState, c: SharedConvoy, now: number): string | undefined {
  const missing = c.missingRoutes ||= {};
  for (const name of members(c)) {
    const status = state.statuses[name]!;
    if (status.convoyNavigation) { delete missing[name]; continue; }
    const previous = missing[name];
    if (!previous || status.seenAt - previous.observedAt > 3000)
      missing[name] = { since: now, observedAt: status.seenAt };
    else previous.observedAt = status.seenAt;
    if (now - missing[name]!.since >= 3000) return name;
  }
  return undefined;
}

function departureDelay(c:SharedConvoy):number {
  return immediateTownDeparture(c) ? 0 : 4000;
}
function refreshReturnTown(state:SharedState,c:SharedConvoy,now:number):boolean {
  if(c.participants.some(n=>lostOwner(state,c,n)))return false;
  if(!observeReturnTown(state,c,now))return false;
  c.epoch++;reassembleReturn(state,c);return true;
}
function resumeTownRetry(state:SharedState,c:SharedConvoy):boolean {
  if(!c.townRetry)return false;
  c.townRetry=false;c.epoch++;reassembleReturn(state,c);return true;
}

function immediateTownDeparture(c:SharedConvoy):boolean {
  if(!c.continuousReturn)return false;
  const route=sharedRoute(c);
  if(!route)return false;
  const first=route.plot.find(p=>p.town || p.transport || p.method==='leave' || distance(p,route.origin)>1);
  return first?.town===true;
}
