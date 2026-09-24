import { isTransition, distance, geometryFingerprint, point, type Point, type PlanResult, type Issue, type Step } from '../navigation/contracts.ts';
import { validateRoute, type ValidationPorts } from '../navigation/validation.ts';
import type { MovementHost, MoveState, MovementOptions, MovementPorts, MovementContext } from './movement-host.ts';
import { createNativePlanner } from './native-planner.ts';
import { createMovementExecutor } from './movement-executor.ts';
import { resolveDestination } from './movement-destination.ts';
import { movementDiagnostics } from './movement-diagnostics.ts';
import { repairDoorApproaches } from '../navigation/door-approach.ts';
import { planReturnCandidates } from './return-planner.ts';
interface Journey { id: string; context: MovementContext; options: MovementOptions; native: boolean; pending: boolean; searches: number; retries: number; started: number; planningAt: number; fallback: boolean; plannerMs?: number; requestMs?: number; distance?: number; transitions?: number; importedEngine?: string }
function arrivalTolerance(options: MovementOptions): number {
  const tolerance = options.arrivalTolerance ?? 20;
  if (!Number.isFinite(tolerance) || tolerance < 1) throw Error('Arrival tolerance must be at least 1');
  return tolerance;
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
  function finish(done: boolean, reason?: string) {
    const j = journey;
    if (!j) return;
    const progress=executor.progress();
    journey = undefined; state.moving = state.searching = false; planner.cancel();
    if (done) executor.reset(); else executor.cancel();
    last = {id:j.id,engine:engine(j),version,fingerprint,done,reason,elapsedMs:ports.now()-j.started,
      searches:j.searches,retries:j.retries,plannerMs:j.plannerMs,requestMs:j.requestMs,walkingDistance:j.distance,transitions:j.transitions,progress};
    ports.metrics?.(last);
    if (j.fallback || !done) report(j.id, state, outcome(done, reason), undefined, reason);
    state.on_done(done, reason);
  }
  function engine(j: Journey) { return j.importedEngine || (j.native ? 'native' : 'alclient'); }
  function outcome(done: boolean, reason?: string): string {
    if (done) return 'Native fallback succeeded';
    if (reason === 'Combat handoff') return 'Travel paused for combat';
    return /cancelled|replaced|superseded/i.test(reason || '') ? 'Movement cancelled' : 'Movement failed';
  }
  function fallback(j: Journey, issue: Issue) {
    if (!current(j)) return;
    report(j.id, state, j.native ? 'Native movement recovery' : 'ALClient route rejected', issue, 'falling back to native smart_move');
    j.fallback = true; j.native = true; j.pending = false; j.planningAt = ports.now();
    state.found = state.searching = false; state.plot.length = 0; executor.reset();
  }
  function trimUncheckedFinal(plot: Step[]): Step[] {
    // Both engines' graph nodes can place an unchecked exact endpoint on the far
    // side of a thin obstacle. Keep the reachable predecessor instead when it
    // already satisfies the caller's arrival tolerance, rather than rejecting
    // (ALClient) or force-walking (native) a route that would otherwise arrive.
    const last = plot.at(-1), previous = plot.at(-2);
    if (last && previous && !isTransition(last) && !validation.walk(previous, last) && distance(previous, state) <= state.edge)
      return plot.slice(0, -1);
    return plot;
  }
  function install(plot: Step[], nativeRoute: boolean) {
    if (!nativeRoute) plot = repairDoorApproaches(validation, position(), plot);
    plot = trimUncheckedFinal(finalApproach(plot, position(), state, journey?.options));
    const issue = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
    if (issue) {
      if (nativeRoute) throw Error(`Native route rejected: ${issue.reason} between ${JSON.stringify(issue.from)} and ${JSON.stringify(issue.to)}`);
      fallback(journey!, issue); return false;
    }
    let previous = position(), walking = 0, transitions = 0;
    for (const step of plot) { if (isTransition(step)) transitions++; else walking += distance(previous, step); previous = step; }
    if (journey) { journey.distance = walking; journey.transitions = transitions; }
    state.plot.splice(0, state.plot.length, ...plot); state.searching = false; state.found = true; executor.reset(); return true;
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
    if (!state.searching) { planner.begin(point(state), state.use_town, ports.now()); state.searching = true; j.searches++; }
    const plot = planner.tick(ports.now());
    if (plot) install(plot, true);
  }
  function requestPlan(j: Journey) {
    if (j.pending) return;
    j.pending = true; state.searching = true; j.searches++;
    const from = position(), destination = point(state), town = state.use_town;
    const requestedAt = ports.now();
    const body = {
      id: j.id, character: host.character.name, from, to: destination, speed: j.options.speed || host.character.speed, town, version, fingerprint, avoidLeave: j.options.avoidLeave,
    };
    const planning = j.options.compareTown && town ? planReturnCandidates(ports, validation, body, state.edge)
      : ports.request('/movement-plan', { method: 'POST', timeout: 2000, body });
    planning.then(value => {
      if (!current(j)) return;
      const result = value as PlanResult & { mode?: string; error?: string };
      if (result.error) throw Error(result.error);
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
      const reason = String(error);
      if (/geometry|route|path|walk|segment|collision|blocked/i.test(reason)) fallback(j, { reason, from, to: destination });
      else finish(false, reason);
    });
  }
  function replanDrift(j: Journey) {
    j.pending = false; state.searching = false;
    if (++j.retries > 2) finish(false, 'Character moved while planning');
  }
  function planTick() {
    const j = journey;
    if (!j || state.found) return;
    if (!current(j)) { finish(false, 'Movement superseded'); return; }
    if (host.character.moving || host.is_transporting(host.character)) {
      if (ports.now() - j.started > 5000) finish(false, 'Character did not settle before route planning');
      return;
    }
    try { if (j.native) nativeTick(j); else requestPlan(j); }
    catch (error) { finish(false, String(error)); }
  }
  function recover(j: Journey, error: unknown) {
    if (/leave transition/i.test(String(error))) {
      if (j.options.shared || j.retries >= 2) { finish(false, 'Leave transition failed: ' + String(error)); return; }
      j.retries++; j.options = {...j.options, avoidLeave: true};
      j.pending = false; state.found = state.searching = false; state.plot = []; executor.reset();
      report(j.id, state, 'Leave transition failed; replanning with ALClient');
      return;
    }
    if (j.options.shared || j.retries >= 2) { finish(false, String(error)); return; }
    j.retries++;
    if (/town/i.test(String(error))) state.use_town = false;
    void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {});
    fallback(j, { reason: `${String(error)}; recovery ${j.retries}/2`, from: position(), to: state.plot[0] || point(state) });
  }
  function tick() {
    const j = journey;
    if (!j || !state.moving) return;
    if (!current(j)) { finish(false, 'Movement superseded'); return; }
    if (ports.context().paused) { executor.pause(); return; }
    if (!state.found) { planTick(); return; }
    try { if (executor.tick(j.options)) finish(true); }
    catch (error) { recover(j, error); }
  }
  function move(destination: unknown, callback?: (done: boolean) => void, options: MovementOptions = {}): Promise<unknown> {
    if (host.smart_move_logic !== scheduler) return Promise.reject(Error('Movement scheduler was replaced'));
    finish(false, 'Movement replaced');
    refreshGeometry();
    let target: Point, tolerance: number;
    try { target = resolveDestination(host, destination); tolerance = arrivalTolerance(options); } catch (error) { return Promise.reject(error); }
    if (target.in !== undefined && target.map === host.character.map && String(target.in) !== String(host.character.in ?? host.character.map))
      return Promise.reject(Error('Destination is in another instance; use its instance-entry workflow'));
    delete state.in;
    Object.assign(state, target, { moving: true, found: false, searching: false, plot: [], use_town: options.town !== false, edge: tolerance });
    if (host.character.moving) void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {});
    executor.reset(); const context = ports.context();
    journey = { id: `${host.character.name}:${context.runtime}:${++sequence}`, context, options, native: !!options.native, pending: false, searches: 0, retries: 0, started: ports.now(), planningAt: ports.now(), fallback: !!options.native };
    return new Promise((resolve, reject) => { state.on_done = (done, reason) => { callback?.(done); if (done) resolve({ success: true }); else reject(Error(reason || 'Movement cancelled')); }; });
  }
  function refreshGeometry() {
    const nextVersion = Number(host.parent.__partyClientVersion || host.G.version), nextFingerprint = geometryFingerprint(host.G);
    if (nextVersion === version && nextFingerprint === fingerprint) return;
    version = nextVersion; fingerprint = nextFingerprint;
    report = movementDiagnostics(ports, host.character.name, version, fingerprint);
  }
  function stop(action?: string, success?: boolean) {
    if (!action || action === 'move' || action === 'smart') finish(!!success, success ? undefined : 'Movement cancelled');
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
    return install(plot, true);
  }
  const service = { state, move, stop, tick, planTick, gate, transition: executor.transition, get identity() { return {version, fingerprint}; }, install: importRoute, last: () => last,
    combatHandoff() { finish(false, 'Combat handoff'); },
    report: () => journey ? { id: journey.id, engine: engine(journey), retries: journey.retries, fingerprint, version, remaining: state.plot.length,
      elapsedMs:ports.now()-journey.started,plannerMs:journey.plannerMs,requestMs:journey.requestMs,progress:executor.progress() } : null,
    dispose() { finish(false, 'Runtime replaced'); disposed = true; gate.owner = null; if (host.smart_move_logic === scheduler) host.smart_move_logic = native.tick; host.smart_move = native.move; host.stop = native.stop; },
  };
  host.__partyMovement = service;
  return service;
}
Object.assign(globalThis, { installPartyMovement });
