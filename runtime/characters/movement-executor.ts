import { movementError } from './movement-error.ts';
import { isTransition, distance, point, type Point, type Step } from '../navigation/contracts.ts';
import { stepIssue, type ValidationPorts } from '../navigation/validation.ts';
import type { MovementHost, MovementOptions, MoveState } from './movement-host.ts';
function transitionLabel(step: Step): string {
  return step.method === 'leave' ? 'leave transition' : step.town ? 'town warp' : 'map transition';
}
interface Issued { step: Step; from: Point; at: number; progressAt: number; position: Point; error?: Error | string; townUnavailable?: boolean; acknowledged?: boolean; finished?: boolean; aligned?: boolean; connectorFrom?: Point; connectorSentAt?: number; connectorVersion?: number; reissued?: boolean; sendVersion?: number }
export function createMovementExecutor(host: MovementHost, state: MoveState, validation: ValidationPorts, now: () => number, townReady = () => true, lootCollected = () => true) {
  let issued: Issued | undefined, index = 0, barrierPending = false, barrierReady = false, lastBarrier = 0, waitingBarrier = false;
  let walkingEdge: {from: Point; to: Step} | undefined;
  let sampledAt = now(), sampledPhase = 'idle';
  let lootWaitAt: number | undefined;
  let durations: Record<string,number> = {};
  const position = () => ({ map: host.character.map, in: host.character.in, x: host.character.real_x, y: host.character.real_y });
  function reset() { issued = undefined; walkingEdge=undefined; index = 0; barrierPending = false; barrierReady = false; lastBarrier = 0; waitingBarrier=false; lootWaitAt=undefined; sampledAt=now();sampledPhase='idle';durations={}; }
  function cancel() {
    if (issued) {
      void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {});
      if (issued.step.town) void Promise.resolve(host.stop('town')).catch(() => {});
    }
    reset();
  }
  function pause() {
    if (!issued) return;
    issued.progressAt = now(); issued.at = now();
    if (isTransition(issued.step)) return;
    // Stop the travel segment once; combat owns movement until travel resumes.
    issued = undefined;
    barrierReady = false;
    void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {});
  }
  function barrier(options: MovementOptions, step: Step, completed: boolean): boolean {
    if (!options.barrier) return true;
    if (barrierReady) { barrierReady = false; waitingBarrier=false; return true; }
    waitingBarrier=true;
    if (barrierPending || now() - lastBarrier < 250) return false;
    barrierPending = true; lastBarrier = now();
    const captured = issued;
    options.barrier(step, index, completed).then(ready => { if (issued === captured) barrierReady = ready; }, error => {
      if (issued === captured && issued) issued.error = movementError(error);
    }).finally(() => { if (issued === captured) barrierPending = false; });
    return false;
  }
  function complete(current: Issued, options: MovementOptions): boolean {
    const p = position(), transition = isTransition(current.step);
    if (host.character.moving || host.is_transporting(host.character)) return false;
    // A warp at its spawn must still be observed as issued and settled, not skipped.
    if (transition && !current.acknowledged) return false;
    if (transition) alignArrival(current, p);
    if (distance(p, current.step) > 1) return false;
    notifyTown(current,options,'complete');
    if (!transitionReady(current, options, !!transition)) return false;
    notifyTransition(current,options);
    state.plot.shift();
    if(transition){walkingEdge=undefined;index++;}
    else rememberWalkingEdge({...p,x:current.step.x,y:current.step.y},state.plot[0]);
    issued = undefined; barrierReady = false; return true;
  }
  function alignArrival(current: Issued, p: Point) {
    if (distance(p, current.step) <= 1 || distance(p, current.step) > 150) return;
    if (current.aligned) {
      // Native new_map can arrive after the first move's map counter. Retry
      // only the already checked connector, without renewing transition time.
      if (now() - current.progressAt >= 1000 && now() - (current.connectorSentAt || 0) >= 1000) {
        // A later authoritative scatter correction changes the connector's
        // origin. Revalidate that new leg rather than reusing old geometry.
        if (!current.connectorFrom || distance(p, current.connectorFrom) >= 1) {
          if (!validation.walk(p, current.step)) throw Error('Arrival connector collision after native position correction');
          current.connectorFrom = point(p);
        }
        sendConnector(current);
      }
      return;
    }
    // The server scatters Town/door arrivals around their advertised spawn. Join
    // the shared route at its exact spawn using a newly collision-checked leg.
    if (!validation.walk(p, current.step)) throw Error(`Arrival connector collision between ${JSON.stringify(p)} and ${JSON.stringify(current.step)}`);
    current.aligned = true; current.connectorFrom = point(p); current.progressAt = now();
    sendConnector(current);
  }
  function sendConnector(current: Issued) {
    current.connectorSentAt = now();
    const version = current.connectorVersion = (current.connectorVersion || 0) + 1;
    void Promise.resolve(host.move(current.step.x, current.step.y)).catch(error => {
      if (issued === current && current.connectorVersion === version) current.error = String(error);
    });
  }
  function transitionReady(current: Issued, options: MovementOptions, transition: boolean): boolean {
    if (transition && !barrier(options, current.step, true)) { current.progressAt = now(); return false; }
    return true;
  }
  function observe(current: Issued, options: MovementOptions) {
    if (current.error) {
      notifyTownRejection(current,options);
      throw current.error instanceof Error ? current.error : Error(isTransition(current.step) ? transitionLabel(current.step) + ': ' + current.error : String(current.error));
    }
    if (complete(current, options)) return;
    const p = position();
    // Once arrival is confirmed, wait for the party barrier, not the cast timer.
    if (arrivedTransition(current,p)) return;
    if (distance(p, current.position) >= 2) { current.position = p; current.progressAt = now(); }
    const transition = isTransition(current.step);
    if (transition && now() - current.at > 12000) {
      notifyTown(current,options,'interrupted');
      throw Error(`Failed ${transitionLabel(current.step)}`);
    }
    observeWalk(current, p);
  }
  function observeWalk(current: Issued, p: Point): void {
    if (isTransition(current.step)) return;
    if (now() - current.progressAt > 5000) throw Error('Stalled walking movement (5 seconds without progress)');
    retryStoppedWalk(current, p);
  }
  function retryStoppedWalk(current: Issued, p: Point): void {
    if (current.reissued || now() - current.progressAt < 250 || !canStart()) return;
    if (stepIssue(validation, p, current.step, state.use_town)) return;
    current.reissued = true;
    // Reissue only this owned segment. A command is not observed progress and
    // cannot extend the five-second deadline. Ignore its superseded deferred.
    sendObserved(current);
  }
  function arrivedTransition(current: Issued, p: Point): boolean {
    return isTransition(current.step) && !!current.acknowledged && distance(p,current.step)<=1;
  }
  function send(current: Issued) {
    const step = current.step;
    if (step.method === 'leave') {
      const promise = host.parent.push_deferred('leave');
      host.parent.socket.emit('leave', undefined); return promise;
    }
    if (step.town) return host.town ? host.town() : host.use('town');
    if (step.transport) {
      const promise = host.parent.push_deferred('transport');
      host.parent.socket.emit('transport', { to: step.map, s: step.s }); return promise;
    }
    return host.move(step.x, step.y);
  }
  function dispatch(current: Issued, options: MovementOptions) {
      if (current.error) throw current.error instanceof Error ? current.error : Error(current.step.method === "leave" ? "Leave transition failed: " + current.error : String(current.error));
      if (!options.skipLootWait && !lootReady(current.step)) return;
      if(!readyTown(current,options))return;
      if ((isTransition(current.step)) && !barrier(options, current.step, false)) return;
      current.finished = false; current.at = now(); current.progressAt = now();
      const captured = current;
      notifyTown(current,options,'casting');
      sendObserved(captured);
  }
  function sendObserved(captured: Issued): void {
      const version = captured.sendVersion = (captured.sendVersion || 0) + 1;
      if(version===1)captureWalkingEdge(captured);
      try { void Promise.resolve(send(captured)).then(result => {
        if (issued !== captured || captured.sendVersion !== version) return;
        if (result && typeof result === 'object' && 'failed' in result && result.failed) throw result;
        captured.acknowledged = true;
      }).catch(error => { if (issued === captured && captured.sendVersion === version) rejected(captured,error); }); }
      catch (error) { if (issued === captured) rejected(captured,error); }
  }
  function captureWalkingEdge(current: Issued): void {
    if(walkingEdge?.to===current.step)return;
    rememberWalkingEdge(position(),current.step);
  }
  function rememberWalkingEdge(from: Point, next: Step | undefined): void {
    walkingEdge=next && !isTransition(next) && from.map===next.map && validation.walk(from,next)
      ? {from:{...from},to:next} : undefined;
  }
  function rejected(current:Issued,error:unknown):void {
    const reason=error && typeof error==='object' && 'reason' in error ? String(error.reason) : String(error);
    current.error=reason;
    current.townUnavailable=/cooldown|unavailable|not.ready|no.mp|disabled/i.test(reason);
  }
  function tick(options: MovementOptions): boolean {
    sample();
    if (issued && state.plot[0] !== issued.step) reset();
    if (issued?.finished) { dispatch(issued, options); return false; }
    if (issued) { observe(issued, options); return false; }
    if (!state.plot.length) return true;
    if (!canStart()) return false;
    const p = position();
    consumeReachedWalks(p);
    if (!state.plot.length) return true;
    const step = state.plot[0];
    issued = { step, from: point(p), at: now(), progressAt: now(), position: p, finished: true };
    dispatch(issued, options);
    return false;
  }
  function consumeReachedWalks(p: Point): void {
    while (state.plot.length) {
      const next = state.plot[0], reason = stepIssue(validation, p, next, state.use_town);
      if (reason) throw Error(`${reason} between ${p.map} (${p.x}, ${p.y}) and ${next.map} (${next.x}, ${next.y})`);
      // Even a zero-distance game move sets moving=true. Consume reached walking
      // points before issuing it; transitions still require dispatch and acknowledgement.
      if (isTransition(next) || distance(p, next) > 1) break;
      state.plot.shift(); rememberWalkingEdge({...p,x:next.x,y:next.y},state.plot[0]);
    }
  }
  function lootReady(step: Step): boolean {
    if (!isTransition(step) || lootCollected()) { lootWaitAt = undefined; return true; }
    lootWaitAt ??= now();
    if (now() - lootWaitAt >= 30000) throw Error('Pending nearby loot prevented map transition for 30 seconds');
    return false;
  }
  function notifyTownRejection(current:Issued,options:MovementOptions) {
    notifyTown(current,options,current.townUnavailable?'unavailable':'interrupted');
  }
  function notifyTown(current:Issued,options:MovementOptions,outcome:'casting'|'interrupted'|'complete'|'unavailable') {
    if(current.step.town)options.townAttempt?.(outcome,index,current.from,current.step);
  }
  function notifyTransition(current:Issued,options:MovementOptions) {
    if(isTransition(current.step))options.transitionComplete?.(current.step);
  }
  function readyTown(current:Issued,options:MovementOptions):boolean {
    if(!current.step.town || townReady() && host.can_use('use_town'))return true;
    if(!options.townAttempt)throw Error('Town warp currently unavailable');
    if(now()-current.at<5000)return false;
    notifyTown(current,options,'unavailable');
    throw Error('Town unavailable for 5 seconds; use walking route');
  }
  function sample(): void {
    const at=now();durations[sampledPhase]=(durations[sampledPhase]||0)+Math.max(0,at-sampledAt);
    sampledAt=at;sampledPhase=phase();
  }
  function phase(): string {
    if(lootWaitAt !== undefined)return 'pending loot';
    if(waitingBarrier)return 'barrier';
    if(!issued)return 'idle';
    return isTransition(issued.step)?transitionLabel(issued.step):'walking';
  }
  function canStart(): boolean { return !host.character.moving && host.can_walk(host.character) && !host.is_transporting(host.character); }
  return { tick, reset, cancel, pause, progress: () => ({step:index,phase:phase(),destination:issued?.step,durations:{...durations},
    position:position(),noProgressMs:issued ? now()-issued.progressAt : 0,reissued:!!issued?.reissued}),
    transition: () => issued && isTransition(issued.step) ? (issued.step.town ? 'town' : 'transport') : null,
    walkingEdge:()=>walkingEdge?.to===state.plot[0] ? walkingEdge : undefined,
    remaining: () => state.plot.map(p => ({ ...p })) };
}
