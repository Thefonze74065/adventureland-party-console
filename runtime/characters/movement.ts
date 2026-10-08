import { movementError, movementFailureCause, retryableMovementRequest } from './movement-error.ts';
import { movementRelocation } from './movement-relocation.ts';
import { isTransition, distance, geometryFingerprint, point, type Point, type PlanResult, type Issue, type Step } from '../navigation/contracts.ts';
import { validateRoute, stepIssue, type ValidationPorts } from '../navigation/validation.ts';
import type { MovementHost, MoveState, MovementOptions, MovementPorts, MovementContext } from './movement-host.ts';
import { createNativePlanner } from './native-planner.ts';
import { createMovementExecutor } from './movement-executor.ts';
import { resolveDestination } from './movement-destination.ts';
import { movementDiagnostics } from './movement-diagnostics.ts';
import { repairDoorApproaches } from '../navigation/door-approach.ts';
import { planReturnCandidates } from './return-planner.ts';
interface SegmentRepair { plot: Step[]; index: number; target: Point; started: boolean; instance?: string | number; retainEndpoint?: boolean }
interface Journey { settlingAt?: number; repair?: SegmentRepair; repaired?: boolean; repairEndpoints?: string[]; firstIssue?: Issue; failureContext?: Record<string, unknown>; id: string; context: MovementContext; options: MovementOptions; native: boolean; pending: boolean; searches: number; retries: number; started: number; planningAt: number; fallback: boolean; plannerMs?: number; requestMs?: number; distance?: number; transitions?: number; importedEngine?: string }
const failurePhases = new Map([
  ['superseded', 'Movement cancelled'],
  ['convoy-communication-hold', 'Movement paused: coordinator communication unavailable'],
  ['convoy-failure', 'Movement failed'],
]);
function arrivalTolerance(options: MovementOptions): number {
  const tolerance = options.arrivalTolerance ?? 20;
  if (!Number.isFinite(tolerance) || tolerance < 1) throw Error('Arrival tolerance must be at least 1');
  return tolerance;
}
function nativePlanningTimeout(options: MovementOptions): number {
  const timeout = options.nativePlanningTimeoutMs ?? 30000;
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000)
    throw Error('Native planning timeout must be between 1 and 120 seconds');
  return timeout;
}
function finalApproach(plot: Step[], from: Point, to: Point, options?: MovementOptions): Step[] {
  // Precision callers need the final approach that coarse planner nodes omit.
  // The caller validates this connector with native collision rules too.
  if (options?.arrivalTolerance === undefined || options.shared) return plot;
  const remaining = distance(plot.at(-1) || from, to);
  return remaining > 0 && remaining <= 20 ? [...plot, point(to)] : plot;
}
export function installPartyMovement(host: MovementHost, ports: MovementPorts) {
  host.__partyMovement?.dispose();
  const native = host.__partyNativeMovement ||= { move: host.smart_move, stop: host.stop, start: host.start_pathfinding, next: host.continue_pathfinding, tick: host.smart_move_logic };
  const planner = createNativePlanner(host, native);
  const state: MoveState = { map: host.character.map, x: 0, y: 0, moving: false, searching: false, found: false, plot: [], use_town: true, try_exact_spot: false, edge: 20, on_done() {} };
  let version = Number(host.parent.__partyClientVersion || host.G.version), fingerprint = geometryFingerprint(host.G);
  let report = movementDiagnostics(ports, host.character.name, version, fingerprint);
  const validation: ValidationPorts = {
    get game() { return host.G; },
    walk: (a, b) => host.can_move({ map: a.map, x: a.x, y: a.y, going_x: b.x, going_y: b.y, base: host.character.base }),
    door: (p, d) => host.is_door_close(p.map, d, p.x, p.y) && host.can_use_door(p.map, d, p.x, p.y),
    hasKey: key => host.character.items.some(item => item?.name === key),
  };
  const executor = createMovementExecutor(host, state, validation, ports.now, () => ports.townReady?.() ?? true,
    () => ports.transitionReady?.() ?? true);
  let journey: Journey | undefined, sequence = 0, disposed = false;
  let last: Record<string, unknown> | null = null;
  const gate: { original(): void; owner: { tick(): unknown } | null } = { original: tick, owner: null };
  const position = (): Point => ({ map: host.character.map, in: host.character.in, x: host.character.real_x, y: host.character.real_y });
  function current(j: Journey): boolean {
    if (disposed || journey !== j) return false;
    try {
      const c = ports.context();
      return c.current && c.runtime === j.context.runtime && c.revision === j.context.revision && !host.character.rip;
    } catch { return false; } // A retired runner's guarded parent can no longer be read.
  }
  function finish(done: boolean, failure?: unknown, cause?: Record<string, unknown>) {
    const reason = failure === undefined ? undefined : movementError(failure).message;
    cause = movementFailureCause(failure, cause);
    const j = journey;
    if (!j) return;
    const progress=executor.progress();
    journey = undefined; state.moving = state.searching = false; planner.cancel();
    if (done) executor.reset(); else executor.cancel();
    last = {id:j.id,engine:engine(j),version,fingerprint,done,reason,elapsedMs:ports.now()-j.started,
      failureContext:{code: done ? 'arrived' : 'route-failed', character:host.character.name, journeyId:j.id, planner:engine(j), base:{...host.character.base}, ...j.options.owner,...j.failureContext,...cause,origin:position(),destination:point(state),firstIssue:j.firstIssue, relocation:movementRelocation(host.G,position(),state.use_town)},
      searches:j.searches,retries:j.retries,plannerMs:j.plannerMs,requestMs:j.requestMs,walkingDistance:j.distance,transitions:j.transitions,progress};
    ports.metrics?.(last);
    if (j.fallback || !done) report(j.id, state, outcome(done, reason, cause), j.firstIssue, reason, last.failureContext as Record<string, unknown>);
    state.on_done(done, reason, failure);
  }
  function engine(j: Journey) { return j.importedEngine || (j.native ? 'native' : 'alclient'); }
  function outcome(done: boolean, reason?: string, cause?: Record<string,unknown>): string {
    const causePhase = failurePhases.get(String(cause?.code));
    if (causePhase) return causePhase;
    if (done) return 'Native fallback succeeded';
    if (reason === 'Combat handoff') return 'Travel paused for combat';
    return /cancelled|replaced|superseded|stop|regroup|takeover|hold/i.test(reason || '') ? 'Movement cancelled' : 'Movement failed';
  }
  function fallback(j: Journey, issue: Issue) {
    if (!current(j)) return;
    if (j.options.owner?.recoveryStage === 'post-relocation') { finish(false, 'ALClient retry failed after relocation: ' + issue.reason); return; }
    report(j.id, state, j.native ? 'Native movement recovery' : 'Trying native pathfinding', issue, 'falling back to native smart_move');
    j.firstIssue ||= issue;
    delete j.repair;
    j.fallback = true; j.native = true; j.pending = false; j.planningAt = ports.now();
    state.found = state.searching = false; state.plot.length = 0; executor.reset();
  }
  function install(plot: Step[], nativeRoute: boolean) {
    if (!nativeRoute) plot = repairDoorApproaches(validation, position(), plot);
    plot = trimUncheckedFinal(finalApproach(plot, position(), state, journey?.options));
    const issue = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
    if (issue) {
      if (nativeRoute) throw Error(`Native route rejected: ${issue.reason} between ${JSON.stringify(issue.from)} and ${JSON.stringify(issue.to)}`);
      if (!beginRepair(journey!, plot, issue)) fallback(journey!, issue); return false;
    }
    let previous = position(), walking = 0, transitions = 0;
    for (const step of plot) { if (isTransition(step)) transitions++; else walking += distance(previous, step); previous = step; }
    if (journey) { journey.distance = walking; journey.transitions = transitions; }
    state.plot.splice(0, state.plot.length, ...plot); state.searching = false; state.found = true; executor.reset(); return true;
  }
  function beginRepair(j: Journey, plot: Step[], issue: Issue): boolean {
    j.firstIssue ||= issue;
    if (j.options.owner?.recoveryStage === 'post-relocation' || !repairAllowed(j,issue.to) || issue.reason !== 'collisions detected' || issue.from.map !== position().map) return false;
    const index = plot.findIndex(p => p === issue.to);
    if (index < 0 || isTransition(plot[index])) return false;
    recordRepair(j,issue.to);
    j.repair = {plot, index, target: point(issue.to), started: false};
    j.pending = false; state.searching = false;
    report(j.id, state, 'Repairing rejected walking segment', issue, 'native same-map connector; limit 3 seconds');
    return true;
  }
  function repairEndpoint(target: Point): string { return JSON.stringify([target.map,target.x,target.y]); }
  function recordRepair(j: Journey, target: Point): void {
    j.repaired = true;
    if(j.options.shared && j.options.repairSharedDrift)(j.repairEndpoints ||= []).push(repairEndpoint(target));
  }
  function repairAllowed(j: Journey, target: Point): boolean {
    if(!j.options.shared || !j.options.repairSharedDrift)return !j.repaired;
    const endpoints=j.repairEndpoints || [];
    return endpoints.length<3 && !endpoints.includes(repairEndpoint(target));
  }
  function repairTick(j: Journey): void {
    const repair = j.repair!;
    try {
      if (!repairInstanceValid(j,repair)) throw Error('Repair instance changed');
      if (!repair.started) { planner.begin(repair.target, false, ports.now(), 3000); repair.started = true; j.searches++; }
      const bridge = planner.tick(ports.now());
      if (!bridge) return;
      if (distance(bridge.at(-1) || position(), repair.target) > 20) throw Error('Repair missed its connector endpoint');
      if (bridge.some(p => isTransition(p) || p.map !== position().map)) throw Error('Repair left the current map');
      const plot = repair.retainEndpoint ? [...bridge,repair.target,...repair.plot.slice(repair.index)]
        : [...bridge, ...repair.plot.slice(repair.index + 1)];
      const invalid = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
      if (invalid) throw Error('Repair did not validate: ' + invalid.reason);
      delete j.repair; install(plot, true);
      report(j.id, state, 'Walking segment repaired', j.firstIssue);
    } catch (error) { repairFailed(j,error); }
  }
  function repairInstanceValid(j: Journey, repair: SegmentRepair): boolean {
    const from = position(), expected = repair.instance ?? repair.target.map;
    return !j.options.repairSharedDrift || String(from.in ?? from.map) === String(expected);
  }
  function repairFailed(j: Journey, error: unknown): void {
    planner.cancel();
    j.failureContext = {repairFailure: String(error)};
    if (j.options.repairSharedDrift && j.options.shared) { finish(false, 'Shared connector repair failed: ' + String(error)); return; }
    fallback(j, j.firstIssue!);
  }
  function trimUncheckedFinal(plot: Step[]): Step[] {
    // Both planners may append an exact endpoint across a thin obstacle.
    // Shared routes retain their exact, coordinator-owned endpoints.
    if (journey?.options.shared) return plot;
    const last = plot.at(-1), previous = plot.at(-2);
    return last && previous && !isTransition(last) && last.map === previous.map &&
      !validation.walk(previous, last) && distance(previous, state) <= state.edge
      ? plot.slice(0, -1) : plot;
  }
  function nativeTick(j: Journey) {
    if (j.options.awaitSharedRoute) {
      if (ports.now() - j.started > nativePlanningTimeout(j.options) + 30000)
        throw Error('Shared route preparation timed out');
      return;
    }
    if (!state.searching) { planner.begin(point(state), state.use_town, ports.now(), nativePlanningTimeout(j.options)); state.searching = true; j.searches++; }
    const plot = planner.tick(ports.now());
    if (plot) install(plot, true);
  }
  function requestPlan(j: Journey) {
    if (j.pending) return;
    j.pending = true; state.searching = true; j.searches++;
    const from = position(), destination = point(state), town = state.use_town;
    const requestedAt = ports.now();
    const body = {
      base: {...host.character.base}, id: j.id, character: host.character.name, from, to: destination, speed: j.options.speed || host.character.speed, town, version, fingerprint, avoidLeave: j.options.avoidLeave,
    };
    const planning = j.options.compareTown && town ? planReturnCandidates(ports, validation, body, state.edge, true)
      : ports.request('/movement-plan', { method: 'POST', timeout: 2000, body });
    planning.then(value => {
      if (!current(j)) return;
      const result = value as PlanResult & { mode?: string; error?: string };
      if (result.error) { fallback(j, { reason: result.error, from, to: destination }); return; }
      if (result.id !== j.id || result.version !== version || result.fingerprint !== fingerprint) throw Error('Planner response identity mismatch');
      if (distance(position(), from) > 1) {
        replanDrift(j);
        return;
      }
      j.plannerMs = result.ms; j.requestMs = ports.now() - requestedAt;
      if (result.mode === 'shadow') {
        const issue = validateRoute(validation, from, destination, result.plot, town, state.edge);
        ports.metrics?.({id:j.id,phase:'shadow',version,fingerprint,valid:!issue,issue,plot:result.plot,plannerMs:result.ms,requestMs:j.requestMs});
        fallback(j, issue || { reason: 'Shadow comparison valid; native execution selected', from, to: destination }); return;
      }
      install(result.plot, false);
    }).catch(error => {
      if (!current(j)) return;
      if (retryableMovementRequest(error)) { finish(false, error); return; }
      const reason = String(error);
      if (/geometry|route|path|walk|segment|collision|blocked/i.test(reason)) fallback(j, { reason, from, to: destination });
      else finish(false, error);
    });
  }
  function replanDrift(j: Journey) {
    j.pending = false; state.searching = false;
    if (++j.retries > 2) finish(false, 'Character moved while planning');
  }
  function planTick() {
    const j = journey;
    if (!j || state.found) return;
    if (!current(j)) { finish(false, 'Navigation revision or runtime superseded this journey', {code:'superseded'}); return; }
    if (host.character.moving || host.is_transporting(host.character)) {
      j.settlingAt ??= ports.now();
      if (ports.now() - j.settlingAt > 5000) finish(false, 'Character did not settle before route planning');
      return;
    }
    j.settlingAt = undefined;
    try { planningStep(j); }
    catch (error) { finish(false, error); }
  }
  function planningStep(j: Journey): void {
    if (j.options.relocation === 'town') { install([{...point(state),town:true}],true); return; }
    if (j.repair) repairTick(j); else if (j.native) nativeTick(j); else requestPlan(j);
  }
  function recover(j: Journey, error: unknown) {
    if (j.options.shared) {
      if (!repairSharedConnector(j)) finish(false, error);
      return;
    }
    if (/leave transition/i.test(String(error))) {
      if (j.options.shared || j.retries >= 2) { finish(false, 'Leave transition failed: ' + String(error)); return; }
      j.retries++; j.options = {...j.options, avoidLeave: true};
      j.pending = false; state.found = state.searching = false; state.plot = []; executor.reset();
      report(j.id, state, 'Leave transition failed; replanning with ALClient');
      return;
    }
    if (j.options.shared || j.retries >= 2) { finish(false, error); return; }
    j.retries++;
    if (/town/i.test(String(error))) state.use_town = false;
    void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {});
    fallback(j, { reason: `${String(error)}; recovery ${j.retries}/2`, from: position(), to: state.plot[0] || point(state) });
  }
  function repairSharedConnector(j: Journey): boolean {
    const next = state.plot[0], from = position();
    if (!j.options.repairSharedDrift || !next || isTransition(next) || !sameJourneyInstance(j,from)) return false;
    const reason = stepIssue(validation, from, next, state.use_town);
    const join=localWalkingJoin(from,next);
    if (reason !== 'collisions detected' || !join || !beginRepair(j,state.plot.slice(),{reason,from,to:next})) return false;
    j.repair!.target=join.target;
    j.repair!.retainEndpoint=join.retainEndpoint;
    j.repair!.instance = from.in ?? from.map;
    state.found = false;
    executor.cancel();
    return true;
  }
  function localWalkingJoin(from: Point, next: Step): {target:Point;retainEndpoint:boolean} | undefined {
    const edge=executor.walkingEdge();
    if(!edge)return distance(from,next)<=150 ? {target:point(next),retainEndpoint:false} : undefined;
    if(edge.from.map!==from.map || String(edge.from.in??edge.from.map)!==String(from.in??from.map))return;
    const dx=next.x-edge.from.x,dy=next.y-edge.from.y,length=dx*dx+dy*dy;
    const along=length ? Math.max(0,Math.min(1,((from.x-edge.from.x)*dx+(from.y-edge.from.y)*dy)/length)) : 0;
    const target={map:from.map,x:edge.from.x+dx*along,y:edge.from.y+dy*along};
    return distance(from,target)<=150 ? {target,retainEndpoint:true} : undefined;
  }
  function sameJourneyInstance(j: Journey, from: Point): boolean {
    return from.map === j.context.map && String(from.in ?? from.map) === String(j.context.instance ?? j.context.map);
  }
  function tick() {
    const j = journey;
    if (!j || !state.moving) return;
    if (!current(j)) { finish(false, 'Navigation revision or runtime superseded this journey', {code:'superseded'}); return; }
    if (ports.context().paused) { j.settlingAt = undefined; executor.pause(); return; }
    if (!state.found) { planTick(); return; }
    try { if (executor.tick(j.options)) finish(true); }
    catch (error) { recover(j, error); }
  }
  function move(destination: unknown, callback?: (done: boolean) => void, options: MovementOptions = {}): Promise<unknown> {
    if (host.smart_move_logic !== scheduler) return Promise.reject(Error('Movement scheduler was replaced'));
    finish(false, 'Movement replaced by a new destination', {code:'destination-replaced',replacement:destination});
    refreshGeometry();
    let target: Point, tolerance: number;
    try { target = resolveDestination(host, destination); tolerance = arrivalTolerance(options); } catch (error) { return Promise.reject(error); }
    if (target.in !== undefined && target.map === host.character.map && String(target.in) !== String(host.character.in ?? host.character.map))
      return Promise.reject(Error('Destination is in another instance; use its instance-entry workflow'));
    delete state.in;
    Object.assign(state, target, { moving: true, found: false, searching: false, plot: [], use_town: options.town !== false, edge: tolerance });
    if (host.character.moving) void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {});
    executor.reset(); const context = {...ports.context(), map:host.character.map, instance:host.character.in ?? host.character.map};
    journey = { id: `${host.character.name}:${context.runtime}:${++sequence}`, context, options, native: !!options.native, pending: false, searches: 0, retries: 0, started: ports.now(), planningAt: ports.now(), fallback: !!options.native };
    return new Promise((resolve, reject) => { state.on_done = (done, reason, failure) => { callback?.(done); if (done) resolve({ success: true }); else reject(Object.assign(movementError(failure || reason), {movementReported: true})); }; });
  }
  function refreshGeometry() {
    const nextVersion = Number(host.parent.__partyClientVersion || host.G.version), nextFingerprint = geometryFingerprint(host.G);
    if (nextVersion === version && nextFingerprint === fingerprint) return;
    version = nextVersion; fingerprint = nextFingerprint;
    report = movementDiagnostics(ports, host.character.name, version, fingerprint);
  }
  function retainDirectStop(action?: string, success?: boolean) {
    return action === 'move' && !success && journey?.options.retainOnDirectStop;
  }
  function stop(action?: string, success?: boolean) {
    if (retainDirectStop(action, success)) {
      executor.pause();
      return Promise.resolve(host.move(host.character.real_x, host.character.real_y));
    }
    if (!action || action === 'move' || action === 'smart') finish(!!success, success ? undefined : 'Unattributed movement stop', {code:'unattributed-stop',action:action || 'all', stopStack: new Error('Movement stop caller').stack});
    return native.stop(action, success);
  }
  function scheduler() { if (!disposed) { if (gate.owner) gate.owner.tick(); else tick(); } }
  host.smart_move = move; host.stop = stop; host.smart_move_logic = scheduler;
  function importRoute(plot: Step[], identity?: {version: number; fingerprint: string}, plannerEngine = 'shared') {
    refreshGeometry();
    if (!identity || identity.version !== version || identity.fingerprint !== fingerprint)
      throw Error('Shared route game geometry mismatch: expected ' + JSON.stringify(identity) + '; actual ' + JSON.stringify({version, fingerprint}));
    const issue = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
    if (issue) {
      report(journey!.id, state, 'Shared route rejected', issue, 'falling back to native smart_move after party regroup');
      throw Error(`${issue.reason} between ${JSON.stringify(issue.from)} and ${JSON.stringify(issue.to)}; native regroup required`);
    }
    if (journey) journey.importedEngine = plannerEngine;
    planner.cancel();
    return install(plot, true);
  }
  const service = { state, move, stop,
    cancel(reason: string, cause?: Record<string, unknown>) { finish(false, reason, cause); return native.stop('smart'); }, tick, planTick, gate, transition: executor.transition, get identity() { return {version, fingerprint}; }, install: importRoute, last: () => last,
    combatHandoff() { finish(false, 'Combat handoff'); },
    report: () => journey ? { id: journey.id, owner:journey.options.owner, engine: engine(journey), retries: journey.retries, fingerprint, version, remaining: state.plot.length,
      elapsedMs:ports.now()-journey.started,plannerMs:journey.plannerMs,requestMs:journey.requestMs,progress:executor.progress() } : null,
    dispose() { finish(false, 'Runtime replaced'); disposed = true; gate.owner = null; if (host.smart_move_logic === scheduler) host.smart_move_logic = native.tick; host.smart_move = native.move; host.stop = native.stop; },
  };
  host.__partyMovement = service;
  return service;
}
Object.assign(globalThis, { installPartyMovement });
