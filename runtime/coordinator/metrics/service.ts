import { MetricsJsonlStore } from './jsonl-store.ts';
import { requestObject, type HttpRouter } from '../http/contracts.ts';
import { METRIC_BUCKET_MS, METRIC_RESET_KINDS, type MetricsKillsResponse, type MonsterKillSummary, type MetricResetKind, type MetricResets, type MetricDeathTotal, type MetricFrame, type MetricBatch, type MetricPoint, type MetricTotals, type MetricsResponse } from '../../metrics/contracts.ts';
import { createMeasurementIndex } from './measurement-index.ts';
import { measurementSummary } from './measurement-summary.ts';
import { goldHistory } from './gold-history.ts';
import type { AccountGoldPoint } from '../../metrics/contracts.ts';
import { metricNumber, metricText, parseMetricFrame, parseMetricSample } from '../../metrics/parse.ts';

const DAY = 86_400_000;
/** Below the 1 s collector pulse (runtime/characters/metrics.ts), so a backlog still drains one batch per pulse. */
export const METRICS_COMMIT_MS = 750;
interface StoredBucket extends MetricPoint {
  width: number;
  receipts: string[];
  events: { id: string; at: number }[];
  sources: string[];
}
interface Ports { owned(name: string): boolean; now(): number; warn(error: unknown): void; accountGold?(): number | null }
const bucketKey = (width: number, at: number) => `${width}:${at}`;
function copy<T>(value: T): T { return structuredClone(value); }
function resetKind(value: unknown): value is MetricResetKind {
  return METRIC_RESET_KINDS.some(kind => kind === value);
}

/** Aggregate sums and exposure, preserving endpoints when history is downsampled. */
function mergeTotals(target: MetricTotals[], incoming: MetricTotals) {
  const row = target.find(value => value.character === incoming.character && value.server === incoming.server);
  if (!row) { target.push(copy(incoming)); return; }
  row.observedMs += incoming.observedMs;
  row.partial ||= incoming.partial;
  row.samples += incoming.samples;
  row.luckSum += incoming.luckSum;
  row.pingSum += incoming.pingSum;
  row.pingSamples += incoming.pingSamples;
  if (incoming.first.at < row.first.at) row.first = copy(incoming.first);
  if (incoming.last.at > row.last.at) row.last = copy(incoming.last);
  if (incoming.goldStart && (!row.goldStart || incoming.goldStart.at < row.goldStart.at)) row.goldStart = copy(incoming.goldStart);
  mergeMeasurements(row, incoming);

}

function mergeMeasurements(row: MetricTotals, incoming: MetricTotals) {
  for (const hit of incoming.damage) {
    const previous = row.damage.find(value => value.monster === hit.monster && value.skill === hit.skill);
    if (previous) { previous.amount += hit.amount; previous.hits += hit.hits; }
    else row.damage.push(copy(hit));
  }
  for (const item of incoming.loot) {
    const previous = row.loot.find(value => value.item === item.item && value.variant === item.variant);
    if (previous) previous.quantity += item.quantity; else row.loot.push(copy(item));
  }
  for (const credit of incoming.credits) {
    const previous = row.credits.find(value => value.monster === credit.monster);
    if (previous) previous.count += credit.count; else row.credits.push(copy(credit));
  }
}

function mergeDeaths(target: MetricDeathTotal[], incoming: MetricDeathTotal[]) {
  for (const kill of incoming) {
    const previous = target.find(value => value.server === kill.server && value.monster === kill.monster && value.actor === kill.actor);
    if (previous) previous.count += kill.count; else target.push(copy(kill));
  }
}

function historyNumber(value: unknown, error: string): number {
  if (!metricNumber(value)) throw Error(error);
  return value;
}
function historyArray(value: unknown, error: string): unknown[] {
  if (!Array.isArray(value)) throw Error(error);
  return value;
}
function historyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}
function storedDamage(input: unknown): MetricTotals['damage'][number] {
  const hit=requestObject(input);
  if (!metricText(hit.monster) || !metricText(hit.skill) || !metricNumber(hit.amount) || !metricNumber(hit.hits)) throw Error('Invalid damage history');
  return {monster:hit.monster,skill:hit.skill,amount:hit.amount,hits:hit.hits};
}
function storedLoot(input: unknown): MetricTotals['loot'][number] {
  const item=requestObject(input);
  if (!metricText(item.item) || !metricText(item.variant,500) || !metricNumber(item.quantity)) throw Error('Invalid loot history');
  return {item:item.item,variant:item.variant,quantity:item.quantity};
}
function storedCredit(input: unknown): MetricTotals['credits'][number] {
  const credit=requestObject(input);
  if (!metricText(credit.monster) || !metricNumber(credit.count)) throw Error('Invalid credit history');
  return {monster:credit.monster,count:credit.count};
}
function optionalGoldBaseline(baseline: Record<string, unknown>) {
  return {...(baseline.goldMovement === undefined ? {} : {goldMovement:Number(baseline.goldMovement)}),
    ...(baseline.consumableCost === undefined ? {} : {consumableCost:Number(baseline.consumableCost)}),
    ...(baseline.consumablePurchases === undefined ? {} : {consumablePurchases:Number(baseline.consumablePurchases)})};
}
function storedGoldBaseline(input: unknown): NonNullable<MetricTotals['goldStart']> {
  const baseline=requestObject(input);
  if (!metricNumber(baseline.at) || !metricNumber(baseline.gold)) throw Error('Invalid gold baseline');
  if (baseline.goldMovement !== undefined && !metricNumber(baseline.goldMovement,-Number.MAX_SAFE_INTEGER)) throw Error('Invalid gold movement baseline');
  for (const field of ['consumableCost','consumablePurchases']) if (baseline[field] !== undefined && !metricNumber(baseline[field])) throw Error('Invalid consumable baseline');
  return {at:baseline.at,gold:baseline.gold,...optionalGoldBaseline(baseline)};
}
function storedTotals(input: unknown): MetricTotals {
  const value=requestObject(input),first=parseMetricSample(value.first),last=parseMetricSample(value.last),error='Invalid metrics history totals';
  if (!metricText(value.character) || !metricText(value.server) || !first || !last || typeof value.partial !== 'boolean') throw Error(error);
  const totals: MetricTotals={character:value.character,server:value.server,first,last,partial:value.partial,
    observedMs:historyNumber(value.observedMs,error),samples:historyNumber(value.samples,error),luckSum:historyNumber(value.luckSum,error),
    pingSum:historyNumber(value.pingSum,error),pingSamples:historyNumber(value.pingSamples,error),damage:[],loot:[],credits:[]};
  const damage=historyArray(value.damage,error),loot=historyArray(value.loot,error),credits=historyArray(value.credits,error);
  totals.damage=damage.map(storedDamage);totals.loot=loot.map(storedLoot);totals.credits=credits.map(storedCredit);
  if(value.goldStart!==undefined)totals.goldStart=storedGoldBaseline(value.goldStart);
  return totals;
}
function storedDeath(input: unknown): MetricDeathTotal {
  const kill=requestObject(input);
  if (!metricText(kill.server) || !metricText(kill.monster) || !metricText(kill.actor) || !metricNumber(kill.count)) throw Error('Invalid kill history');
  return {server:kill.server,monster:kill.monster,actor:kill.actor,count:kill.count};
}
function storedEvent(input: unknown): StoredBucket['events'][number] {
  const event=requestObject(input);
  if (!metricText(event.id,500) || !metricNumber(event.at)) throw Error('Invalid metrics event identity');
  return {id:event.id,at:event.at};
}
function storedBucket(value: unknown): StoredBucket {
  const row=requestObject(value);
  if (!metricNumber(row.at) || !metricNumber(row.width) || !Array.isArray(row.values) || !historyStrings(row.receipts) ||
    !historyStrings(row.sources) || !Array.isArray(row.events) || !Array.isArray(row.kills)) throw Error('Invalid metrics history envelope');
  return {at:row.at,width:row.width,values:row.values.map(storedTotals),kills:row.kills.map(storedDeath),
    events:row.events.map(storedEvent),receipts:row.receipts,sources:row.sources};
}

export function createMetricsService(path: string, ports: Ports) {
  const store = new MetricsJsonlStore(path, path + '.compact', 1_800_000);
  const buckets = new Map<string, StoredBucket>();
  const accountGold = new Map<number, AccountGoldPoint>();
  const measurements = createMeasurementIndex();
  const killTotals = new Map<string, MetricDeathTotal>();
  function indexDeaths(deaths: MetricDeathTotal[], direction: 1 | -1 = 1) {
    for (const death of deaths) {
      const key = JSON.stringify([death.server, death.actor, death.monster]);
      const count = (killTotals.get(key)?.count || 0) + direction * death.count;
      if (count > 0) killTotals.set(key, { ...death, count }); else killTotals.delete(key);
    }
  }
  const savedResetState = requestObject(store.get('resetState'));
  const savedResets = requestObject(savedResetState.cuts);
  const resets: MetricResets = {};
  for (const kind of METRIC_RESET_KINDS) {
    const at = savedResets[kind];
    if (metricNumber(at)) resets[kind] = at;
  }
  function resetCutoff(kind: MetricResetKind): number { return resets[kind] || 0; }
  const savedStart = store.get('startedAt');
  const startedAt = metricNumber(savedStart) ? savedStart : ports.now();
  function restoreHistory() {
  try {
    if (savedStart === undefined) store.set('startedAt', startedAt);
    for (const [key, value] of store.entries()) if (key.startsWith('bucket:')) buckets.set(key.slice(7), storedBucket(value));
    for (const [key, value] of store.entries()) if (key.startsWith('accountGold:')) {
      const point = requestObject(value);
      if (!metricNumber(point.at) || (point.total !== null && !metricNumber(point.total))) throw Error('Invalid account gold history');
      accountGold.set(point.at, { at: point.at, total: point.total });
    }
  } catch (error) { void store.close().catch(error => ports.warn(error)); throw error; }
  }
  restoreHistory();
  let lastReceivedAt: number | null = null;
  let unavailable = false;
  let resetting = false;
  function storageFailed(error: unknown) { if (!unavailable) ports.warn(error); unavailable = true; }
  const allCharacters = new Set<string>(), allServers = new Set<string>();
  function indexCharacters() {
    for (const bucket of buckets.values()) for (const row of bucket.values) { allCharacters.add(row.character); allServers.add(row.server); }
  }
  indexCharacters();
  function write(key: string, bucket: StoredBucket) {
    // Receipt identities and measurements share one append record. A lost HTTP
    // acknowledgement can retry safely, including after coordinator restart.
    store.set('bucket:' + key, bucket);
    buckets.set(key, bucket);
  }
  // Group commit for accepted frames (docs/efficiency.md § Metrics history).
  // Every character's frame rewrote the whole 10 s bucket; frames that arrive
  // within METRICS_COMMIT_MS of each other now share one write of each bucket.
  // A POST answers once memory holds its frames and does not wait for the
  // commit. Characters in one browser share its connections to the
  // coordinator, and a POST held for the window delayed their status and
  // combat requests (live-hunt-sparkbot-follow lost its target selection in
  // 3-4 of 12 runs). Each answer names the commit that will write its frames
  // (`commit`) and the last commit on disk (`durableCommit`), both counted
  // within this process (`commitEpoch`). The collector keeps a frame in its
  // outbox until an answer from the same process shows its commit on disk.
  const dirty = new Set<string>();
  const commitEpoch = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  // nextCommit counts the commit that frames accepted now join; commits finish in order.
  let nextCommit = 1, durableCommit = 0, previousCommit: Promise<void> = Promise.resolve();
  let commit: Promise<void> | undefined;
  function writeDirty() {
    for (const key of dirty) { const bucket = buckets.get(key); if (bucket) store.set('bucket:' + key, bucket); }
    dirty.clear();
  }
  function committed(): Promise<void> {
    return commit ??= new Promise<void>(resolve => setTimeout(resolve, METRICS_COMMIT_MS)).then(() => {
      commit = undefined;
      const id = nextCommit++;
      writeDirty();
      const written = previousCommit.then(() => store.flush()).then(() => { durableCommit = id; });
      previousCommit = written.catch(() => undefined);
      return written;
    });
  }
  function seen(id: string, at: number) {
    const start = Math.floor(at / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
    for (const time of [start - METRIC_BUCKET_MS, start, start + METRIC_BUCKET_MS])
      if (buckets.get(bucketKey(METRIC_BUCKET_MS, time))?.events.some(event => event.id === id && Math.abs(event.at - at) < 5000)) return true;
    return false;
  }
  function incomingTotals(character: string, server: string, frame: MetricFrame): MetricTotals {
    const incoming: MetricTotals = { character, server, observedMs: frame.observedMs, partial: frame.partial,
      first: copy(frame.first), last: copy(frame.last), damage: frame.first.at >= resetCutoff('damage') ? frame.damage : [],
      credits: frame.first.at >= resetCutoff('kills') ? frame.credits : [], loot: [], samples: 1,
      luckSum: frame.last.luck, pingSum: frame.last.at >= resetCutoff('ping') ? frame.last.ping ?? 0 : 0,
      pingSamples: frame.last.at >= resetCutoff('ping') && frame.last.ping !== null ? 1 : 0 };
    applyGoldReset(frame,incoming);
    if (frame.first.at < resetCutoff('ping')) incoming.first.ping = null;
    if (frame.last.at < resetCutoff('ping')) incoming.last.ping = null;
    return incoming;
  }
  function applyGoldReset(frame: MetricFrame, incoming: MetricTotals): void {
    if (frame.first.at < resetCutoff('gold')) { incoming.first.gold = 0; delete incoming.first.goldMovement; }
    if (frame.last.at < resetCutoff('gold')) { incoming.last.gold = 0; delete incoming.last.goldMovement; }
    else {
      const baseline = frame.first.at >= resetCutoff('gold') ? frame.first : frame.last;
      incoming.goldStart = { at: baseline.at, gold: baseline.gold,
        ...(baseline.goldMovement === undefined ? {} : { goldMovement: baseline.goldMovement }),
        ...(baseline.consumableCost === undefined ? {} : {consumableCost:Number(baseline.consumableCost)}),
        ...(baseline.consumablePurchases === undefined ? {} : {consumablePurchases:Number(baseline.consumablePurchases)}) };
    }
  }
  function acceptDeaths(server: string, frame: MetricFrame, bucket: StoredBucket): MetricDeathTotal[] {
    const acceptedDeaths: MetricDeathTotal[] = [];
    for (const event of frame.kills) {
      if (event.at < resetCutoff('kills')) continue;
      if (seen(event.id, event.at) || bucket.events.some(value => value.id === event.id && Math.abs(value.at - event.at) < 5000)) continue;
      // Store a death once, attributed to the native attacker even when a tank
      // or healer reports it. Uninstrumented party members remain labelled.
      mergeDeaths(bucket.kills, [{ server, monster: event.monster, actor: event.actor, count: 1 }]);
      acceptedDeaths.push({ server, monster: event.monster, actor: event.actor, count: 1 });
      bucket.events.push({ id: event.id, at: event.at });
    }
    return acceptedDeaths;
  }
  function acceptLoot(frame: MetricFrame, bucket: StoredBucket, incoming: MetricTotals): void {
    for (const event of frame.loot) {
      if (event.at < resetCutoff('loot')) continue;
      if (seen(event.id, event.at) || bucket.events.some(value => value.id === event.id)) continue;
      incoming.loot.push({ item: event.item, variant: event.variant, quantity: event.quantity });
      bucket.events.push({ id: event.id, at: event.at });
    }
  }
  function accept(character: string, server: string, runtime: string, frame: MetricFrame) {
    const allResetAt = Math.min(...METRIC_RESET_KINDS.map(kind => resets[kind] || 0));
    if (frame.last.at < allResetAt) return;
    const key = bucketKey(METRIC_BUCKET_MS, frame.at), receipt = JSON.stringify([character, runtime, frame.sequence]);
    const current = buckets.get(key);
    if (current?.receipts.includes(receipt)) return;
    const bucket: StoredBucket = current ? copy(current) : { at: frame.at, width: METRIC_BUCKET_MS, values: [], kills: [], receipts: [], events: [], sources: [] };
    const incoming=incomingTotals(character,server,frame);
    const acceptedDeaths=acceptDeaths(server,frame,bucket);
    acceptLoot(frame,bucket,incoming);
    mergeTotals(bucket.values, incoming);
    allCharacters.add(character); allServers.add(server);
    bucket.receipts.push(receipt);
    buckets.set(key, bucket); dirty.add(key);
    indexDeaths(acceptedDeaths);
    measurements.add([incoming]);
  }
  function retainGold(now: number): void {
    for (const at of accountGold.keys()) if (at < now - 180 * DAY) { accountGold.delete(at); store.delete('accountGold:' + at); }
    const retainedGold = new Map<string, AccountGoldPoint>();
    for (const point of accountGold.values()) {
      const age = now - point.at, width = age > 30 * DAY ? 900_000 : age > DAY ? 60_000 : METRIC_BUCKET_MS;
      const key = width + ':' + Math.floor(point.at / width);
      const previous = retainedGold.get(key);
      if (!previous || point.at > previous.at) retainedGold.set(key, point);
    }
    const retainedTimes = new Set([...retainedGold.values()].map(point => point.at));
    for (const at of accountGold.keys()) if (!retainedTimes.has(at)) { accountGold.delete(at); store.delete('accountGold:' + at); }
  }
  function retainBucket(key: string, source: StoredBucket, now: number): void {
      const age = now - (source.at + source.width);
      if (age > 180 * DAY) { store.delete('bucket:' + key); buckets.delete(key); indexDeaths(source.kills, -1); measurements.add(source.values, -1); return; }
      const width = source.width === METRIC_BUCKET_MS && age > DAY ? 60_000
        : source.width === 60_000 && age > 30 * DAY ? 900_000 : null;
      if (!width) return;
      const at = Math.floor(source.at / width) * width, destinationKey = bucketKey(width, at), existing = buckets.get(destinationKey);
      const destination: StoredBucket = existing ? copy(existing) : { at, width, values: [], kills: [], receipts: [], events: [], sources: [] };
      // Checkpoint the source inside the destination before removing it. A crash
      // between these writes resumes without merging the same source twice.
      if (!destination.sources.includes(key)) {
        for (const value of source.values) mergeTotals(destination.values, value);
        mergeDeaths(destination.kills, source.kills);
        destination.sources.push(key);
        write(destinationKey, destination);
      }
      store.delete('bucket:' + key); buckets.delete(key);
  }
  function retain() {
    if (resetting) return;
    const now = ports.now();
    retainGold(now);
    for (const resolution of [METRIC_BUCKET_MS, 60_000, 900_000])
    for (const [key, source] of [...buckets].filter(([, bucket]) => bucket.width === resolution).sort((a, b) => a[1].at - b[1].at)) {
      retainBucket(key,source,now);
    }
  }
  try { retain(); } catch (error) { void store.close().catch(error => ports.warn(error)); throw error; }
  for (const bucket of buckets.values()) { indexDeaths(bucket.kills); measurements.add(bucket.values); }
  const timer = setInterval(() => { if (unavailable) return; try { retain(); } catch (error) { storageFailed(error); } }, 300_000);
  timer.unref();
  // Collection belongs to the coordinator, so closing the dashboard cannot stop it.
  const goldTimer = setInterval(() => {
    if (unavailable || resetting || !ports.accountGold) return;
    try {
      const at = Math.floor(ports.now() / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
      if (accountGold.has(at)) return;
      const point = { at, total: ports.accountGold() };
      store.set('accountGold:' + at, point); accountGold.set(at, point);
    } catch (error) { storageFailed(error); }
  }, 1000);
  goldTimer.unref();
  function resetRow(row: MetricTotals, kinds: MetricResetKind[]): void {
        if (kinds.includes('kills')) row.credits = [];
        if (kinds.includes('damage')) row.damage = [];
        if (kinds.includes('loot')) row.loot = [];
        if (kinds.includes('gold')) {
          row.first.gold = row.last.gold = 0;
          delete row.first.goldMovement; delete row.last.goldMovement; delete row.goldStart;
        }
        if (kinds.includes('ping')) { row.first.ping = row.last.ping = null; row.pingSum = row.pingSamples = 0; }
  }
  function hasGold(row: MetricTotals): boolean {
    return row.first.gold !== 0 || row.last.gold !== 0 || row.goldStart !== undefined;
  }
  function hasPing(row: MetricTotals): boolean {
    return row.first.ping !== null || row.last.ping !== null || row.pingSamples > 0;
  }
  function rowHasReset(row: MetricTotals, kinds: MetricResetKind[]): boolean {
    return (kinds.includes('kills') && row.credits.length > 0) || (kinds.includes('damage') && row.damage.length > 0) ||
      (kinds.includes('loot') && row.loot.length > 0) || hasResetBaselines(row,kinds);
  }
  function hasResetBaselines(row: MetricTotals, kinds: MetricResetKind[]): boolean {
    return (kinds.includes('gold') && hasGold(row)) || (kinds.includes('ping') && hasPing(row));
  }
  function bucketHasReset(bucket: StoredBucket, kinds: MetricResetKind[]): boolean {
    return (kinds.includes('kills') && bucket.kills.length > 0) || bucket.values.some(row=>rowHasReset(row,kinds));
  }
  async function erase(kinds: MetricResetKind[]) {
    let count = 0;
    for (const [key, current] of buckets) {
      if (kinds.length === METRIC_RESET_KINDS.length) {
        store.delete('bucket:' + key); buckets.delete(key);
        if (++count % 24 === 0) await new Promise<void>(resolve => setImmediate(resolve));
        continue;
      }
      const changed = bucketHasReset(current,kinds);
      if (!changed) { if (++count % 24 === 0) await new Promise<void>(resolve => setImmediate(resolve)); continue; }
      const bucket = copy(current);
      if (kinds.includes('kills')) bucket.kills = [];
      for (const row of bucket.values) resetRow(row,kinds);
      write(key, bucket);
      // Yield between small batches so character coordination can keep running.
      if (++count % 24 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    store.set('resetState', { cuts: copy(resets), pending: [] });
    if (kinds.includes('kills')) killTotals.clear();
    measurements.clear(kinds);
    // Replace the append journal so the old measurement records are removed too.
    store.refactor();
  }
  const pending = savedResetState.pending;
  if (Array.isArray(pending) && pending.length && pending.every(resetKind)) {
    resetting = true;
    void erase(pending).catch(storageFailed).finally(() => { resetting = false; });
  }
  function matchingBuckets(from: number, to: number): StoredBucket[] {
    // Normal one-hour reads visit hundreds of keys, not six months of history.
    const matching: StoredBucket[] = [];
    for (const [resolution, retention] of [[METRIC_BUCKET_MS, DAY + 900_000], [60_000, 30 * DAY + 900_000], [900_000, 180 * DAY]]) {
      const start = Math.floor(Math.max(from, ports.now() - retention) / resolution) * resolution;
      for (let at = start; at < to; at += resolution) {
        const key = bucketKey(resolution, at), bucket = buckets.get(key);
        if (!bucket) continue;
        const parentWidth = resolution === METRIC_BUCKET_MS ? 60_000 : resolution === 60_000 ? 900_000 : null;
        const parent = parentWidth ? buckets.get(bucketKey(parentWidth, Math.floor(at / parentWidth) * parentWidth)) : undefined;
        if (!parent?.sources.includes(key)) matching.push(bucket);
      }
    }
    return matching;
  }
  function query(from: number, to: number, characters: string[], servers: string[]): MetricsResponse {
    const matching = matchingBuckets(from, to);
    const largest = matching.reduce((width, bucket) => Math.max(width, bucket.width), METRIC_BUCKET_MS);
    const width = Math.max(largest, Math.ceil((to - from) / (600 * largest)) * largest);
    const points = new Map<number, MetricPoint>();
    for (const bucket of matching) {
      const at = Math.floor(bucket.at / width) * width;
      const point = points.get(at) || { at, values: [], kills: [] };
      mergeDeaths(point.kills, bucket.kills.filter(kill => (!characters.length || characters.includes(kill.actor)) && (!servers.length || servers.includes(kill.server))));
      for (const row of bucket.values) {
        if (servers.length && !servers.includes(row.server)) continue;
        if (!characters.length || characters.includes(row.character)) mergeTotals(point.values, row);
      }
      points.set(at, point);
    }
    const ordered = [...points.values()].sort((a, b) => a.at - b.at);
    return { version: 1, startedAt, from: Math.floor(from / width) * width, to: Math.min(ports.now(), Math.ceil(to / width) * width), resolutionMs: width, points: ordered,
      characters: [...allCharacters].sort(), servers: [...allServers].sort(), lastReceivedAt,
      incomplete: ordered.some(point => point.values.some(row => row.partial)), resets: copy(resets) };
  }
  function killsQuery(from: number, to: number, dayFrom: number, dayTo: number, characters: string[], servers: string[]): MetricsKillsResponse {
    const wanted = (death: MetricDeathTotal) => (!characters.length || characters.includes(death.actor)) && (!servers.length || servers.includes(death.server));
    const monsters = new Map<string, MonsterKillSummary>();
    function row(monster: string) {
      const value = monsters.get(monster) || { monster, count: 0, total: 0, today: 0 };
      monsters.set(monster, value); return value;
    }
    for (const death of killTotals.values()) if (wanted(death)) row(death.monster).total += death.count;
    const range = matchingBuckets(from, to);
    const countedFrom = range.reduce((start, bucket) => Math.min(start, bucket.at), from);
    const countedTo = Math.min(ports.now(), range.reduce((end, bucket) => Math.max(end, bucket.at + bucket.width), to));
    for (const bucket of range) for (const death of bucket.kills) if (wanted(death)) row(death.monster).count += death.count;
    for (const bucket of matchingBuckets(dayFrom, dayTo)) for (const death of bucket.kills) if (wanted(death)) row(death.monster).today += death.count;
    return { version: 1, from: countedFrom, to: countedTo, elapsedMs: Math.max(0, countedTo - Math.max(countedFrom, startedAt, resetCutoff('kills'))), dayFrom, dayTo, resetAt: resetCutoff('kills'),
      monsters: [...monsters.values()].sort((a, b) => b.count - a.count || a.monster.localeCompare(b.monster)), lastReceivedAt };
  }
  function validRange(from: number, to: number, now: number): boolean {
    return metricNumber(from) && metricNumber(to) && from < to && to-from <= 180*DAY && to <= now+60_000;
  }
  function validDayRange(from: number, to: number): boolean {
    return metricNumber(from) && metricNumber(to) && from < to && to-from <= 26*3_600_000;
  }
  function requestRange(input: Record<string, unknown>, now: number) {
    return {from:Number(input.from ?? now-3_600_000),to:Number(input.to ?? now),dayFrom:Number(input.dayFrom),dayTo:Number(input.dayTo)};
  }
  function queryNames(value: unknown): string[] {
    return typeof value === 'string' ? value.split(',').slice(0,32) : [];
  }
  function goldPoints(from: number, to: number): AccountGoldPoint[] {
    const width=Math.max(METRIC_BUCKET_MS,Math.ceil((to-from)/(600*METRIC_BUCKET_MS))*METRIC_BUCKET_MS),points=new Map<number,AccountGoldPoint>();
    for(const point of accountGold.values())if(point.at>=from && point.at<=to){
      const at=Math.floor(point.at/width)*width,previous=points.get(at);
      if(!previous || point.at>previous.at)points.set(at,point);
    }
    return [...points.values()].sort((a,b)=>a.at-b.at);
  }
  type BatchEnvelope = Omit<MetricBatch,'frames'> & {frames:unknown[]};
  function validBatch(body: Record<string, unknown>): body is Record<string, unknown> & BatchEnvelope {
    return metricText(body.character) && ports.owned(body.character) && metricText(body.runtime) && metricText(body.server) && Array.isArray(body.frames) && body.frames.length<=6;
  }
  function batchFrames(inputs: unknown[], now: number): MetricFrame[] | null {
    const frames: MetricFrame[]=[];
    for(const input of inputs){
      const frame=parseMetricFrame(input);
      if(!frame || frame.at%METRIC_BUCKET_MS || frame.last.at>now+5000)return null;
      frames.push(frame);
    }
    return frames;
  }
  function queryStart(input: Record<string, unknown>, now: number, resetAt: number): number {
    return input.sinceReset==='gold' ? Math.max(startedAt,resetCutoff('gold'),resetAt,now-180*DAY) : Number(input.from ?? now-3_600_000);
  }
  function install(router: HttpRouter) {
    router.get('/party-api/metrics/account-gold', (request, response) => {
      if (unavailable) return response.status(503).json({ error: 'Metrics storage unavailable' });
      const now = ports.now(), input = request.query || {}, resetAt = Number(input.resetAt ?? 0), to = Number(input.to ?? now);
      if (!metricNumber(resetAt) || !metricNumber(to) || to > now + 60_000) return response.status(400).json({ error: 'Invalid gold range' });
      const from = Math.max(resetAt, accountGold.keys().next().value ?? now, now - 180 * DAY);
      return response.json({from,to,points:goldPoints(from,to)});
    });
    router.get('/party-api/metrics/bars', (request, response) => {
      if (unavailable) return response.status(503).json({ error: 'Metrics storage unavailable' });
      if (resetting) return response.status(503).json({ error: 'Metrics reset in progress' });
      const input = request.query || {}, metric = input.metric, now = ports.now(), {from,to,dayFrom,dayTo}=requestRange(input,now);
      if ((metric !== 'damage' && metric !== 'loot') || !validRange(from,to,now) ||
          !validDayRange(dayFrom,dayTo))
        return response.status(400).json({ error: 'Invalid measurement range' });
      const list = (value: unknown) => typeof value === 'string' ? value.split(',').filter(Boolean).slice(0, 64) : [];
      const scope = { from, to, now, startedAt, resetAt: resetCutoff(metric), dayFrom, dayTo: Math.min(dayTo, now),
        characters: list(input.characters), servers: list(input.servers), monsters: list(input.monsters), skills: list(input.skills), items: list(input.items) };
      const source = { range: matchingBuckets(from, to), day: matchingBuckets(dayFrom, Math.min(dayTo, now)), damage: measurements.damage(), loot: measurements.loot(), lastReceivedAt };
      const summary = metric === 'damage' ? measurementSummary({ ...scope, metric, by: input.by === 'skill' ? 'skill' : 'character' }, source) : measurementSummary({ ...scope, metric, by: 'item' }, source);
      return response.json(summary);
    });
    router.get('/party-api/metrics/kills', (request, response) => {
      if (unavailable) return response.status(503).json({ error: 'Metrics storage unavailable' });
      if (resetting) return response.status(503).json({ error: 'Metrics reset in progress' });
      const input = request.query || {}, now = ports.now(), {from,to,dayFrom,dayTo}=requestRange(input,now);
      if (!validRange(from,to,now) ||
          !validDayRange(dayFrom,dayTo))
        return response.status(400).json({ error: 'Invalid kills range' });
      const names = queryNames(input.characters);
      const servers = queryNames(input.servers);
      return response.json(killsQuery(from, to, dayFrom, Math.min(dayTo, now), names, servers));
    });
    router.post('/party-api/metrics', async (request, response) => {
      if (unavailable) return response.status(503).json({ error: 'Metrics storage unavailable' });
      if (resetting) return response.status(503).json({ error: 'Metrics reset in progress' });
      const body = requestObject(request.body);
      if(!validBatch(body))return response.status(400).json({error:'Invalid metrics batch'});
      const now=ports.now(),frames=batchFrames(body.frames,now);
      if(!frames)return response.status(400).json({error:'Invalid metrics frame'});
      let expired = 0;
      try {
        for (const frame of frames) {
          if (frame.at < now - DAY) { expired++; continue; }
          accept(body.character, body.server, body.runtime, frame);
        }
      } catch (error) {
        storageFailed(error);
        return response.status(503).json({ error: 'Metrics storage unavailable' });
      }
      // A batch without frames only reads durableCommit.
      if (frames.length) { committed().catch(storageFailed); lastReceivedAt = now; }
      return response.json({ ok: true, expired, commitEpoch, commit: nextCommit, durableCommit });
    });
    router.get('/party-api/metrics', async (request, response) => {
      if (unavailable) return response.status(503).json({ error: 'Metrics storage unavailable' });
      if (resetting) return response.status(503).json({ error: 'Metrics reset in progress' });
      const now = ports.now(), input = request.query || {}, to = Number(input.to ?? now);
      const resetAt = Number(input.resetAt ?? 0);
      if (input.sinceReset === 'gold' && !metricNumber(resetAt)) return response.status(400).json({ error: 'Invalid gold reset' });
      const from = queryStart(input,now,resetAt);
      if (!validRange(from,to,now))
        return response.status(400).json({ error: 'Choose a valid metrics range of at most 180 days' });
      if (input.sinceReset === 'gold') {
        const cuts = copy(resets);
        const history = await goldHistory(matchingBuckets(from, to), from, to);
        return response.json({ ...history, startedAt, characters: [...allCharacters].sort(), resets: cuts });
      }
      const names = queryNames(input.characters);
      const servers = queryNames(input.servers);
      return response.json(query(from, to, names, servers));
    });
    router.post('/party-api/metrics/reset', async (request, response) => {
      if (unavailable) return response.status(503).json({ error: 'Metrics storage unavailable' });
      if (resetting) return response.status(409).json({ error: 'Metrics reset already in progress' });
      const metric = requestObject(request.body).metric;
      if (metric !== 'all' && metric !== 'performance' && !resetKind(metric)) return response.status(400).json({ error: 'Unknown metric' });
      const kinds: MetricResetKind[] = metric === 'all' ? [...METRIC_RESET_KINDS] : metric === 'performance' ? ['kills', 'damage'] : [metric];
      resetting = true;
      try {
        const now = ports.now();
        for (const kind of kinds) resets[kind] = now;
        // The cutoff and pending erasure survive a crash. Older outbox frames
        // are acknowledged without resurrecting deleted measurements.
        store.set('resetState', { cuts: copy(resets), pending: kinds });
        await erase(kinds);
        return response.json({ ok: true, resets });
      } catch (error) {
        storageFailed(error);
        return response.status(503).json({ error: 'Metrics storage unavailable' });
      } finally { resetting = false; }
    });
  }
  return { install, async close() {
    clearInterval(timer); clearInterval(goldTimer);
    try { writeDirty(); } finally { await store.close(); }
  } };
}
