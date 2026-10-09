import type { Point, Step } from '../navigation/contracts.ts';
import type { MovementHost, NativeFunctions } from './movement-host.ts';
/** Only this adapter touches the game's planner globals. It never runs the native walker. */
export function createNativePlanner(host: MovementHost, native: NativeFunctions) {
  let running = false, failure = '', deadline = 0, serial = 0, limit = 30000;
  let hardDeadline = 0, hardLimit = 30000, lastIndex: number | undefined, advancedAt = 0, progressValid = false;
  let searchQueue: unknown[] | undefined;
  function cancel() { running = false; serial++; void Promise.resolve(native.stop('smart')).catch(() => {}); }
  function begin(destination: Point, town: boolean, now: number, timeout = 30000, progressLimit?: number) {
    cancel(); failure = ''; limit = timeout; deadline = now + timeout;
    hardLimit = progressLimit ?? timeout; hardDeadline = now + hardLimit; lastIndex = undefined; searchQueue = undefined; advancedAt = now; progressValid = progressLimit !== undefined;
    const token = serial;
    const promise = native.move(destination);
    void promise.catch(error => { if (running && token === serial) failure = String(error?.reason || error); });
    host.smart.use_town = town; running = true;
  }
  function validFrontier(index: number | undefined, queue: unknown): queue is unknown[] {
    return Number.isSafeInteger(index) && index! >= 0 && Array.isArray(queue) && index! <= queue.length &&
      (searchQueue === undefined || searchQueue === queue) && (lastIndex === undefined || index! >= lastIndex);
  }
  function observeProgress(now: number) {
    if (!progressValid) return;
    const index = host.start, queue = host.queue;
    if (!validFrontier(index, queue)) { progressValid = false; return; }
    searchQueue = queue;
    if (lastIndex !== undefined && index! > lastIndex) advancedAt = now;
    lastIndex = index;
  }
  function expired(now: number) {
    return now >= hardDeadline || now >= deadline && (!progressValid || now - advancedAt > 15000);
  }
  function checkDeadline(now: number) {
    if (!failure && !expired(now)) return;
    const reason = failure || `Native planning timed out (${(now >= hardDeadline ? hardLimit : limit) / 1000} seconds)`; cancel(); throw Error(reason);
  }
  function tick(now: number): Step[] | undefined {
    if (!running) throw Error('Native search not initialized');
    if (lastIndex !== undefined) observeProgress(now);
    checkDeadline(now);
    if (!host.smart.searching) native.start(); else if (!host.smart.found) native.next();
    observeProgress(now);
    if (!host.smart.moving && !host.smart.found) throw Error('Native planner found no route');
    if (!host.smart.found) return;
    const plot = host.smart.plot.map(p => ({ ...p }));
    cancel(); return plot;
  }
  return { begin, tick, cancel };
}
