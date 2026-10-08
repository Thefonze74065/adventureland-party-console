import { randomUUID } from "node:crypto";
import {
  requestObject,
  type HttpRequest,
  type HttpResponse,
  type HttpRouter,
} from "../http/contracts.ts";
import type { PresentationStatus } from "./public-state-types.ts";
import { compactEntry } from "./public-state-characters.ts";

export const liveFields = [
  "hp",
  "mp",
  "max_hp",
  "max_mp",
  "x",
  "y",
  "map",
  "in",
  "xp",
  "max_xp",
  "gold",
  "rip",
  "target",
  "standOpen",
  "conditions",
  "inventorySize",
  "upgradeInventoryBusy",
] as const;
type RecordValue = Record<string, unknown>;
export interface LiveRecord {
  generation: string;
  sample: number;
  sampledAt: number;
  vitals: RecordValue;
  items: RecordValue;
  slots: RecordValue;
}
interface Ports<Timer> {
  now(): number;
  statuses(): Record<string, PresentationStatus>;
  active(name: string): boolean;
  every(callback: () => void, ms: number): Timer;
  cancel(timer: Timer): void;
}
function entries(value: unknown): RecordValue {
  return Object.fromEntries(
    Object.entries(requestObject(value)).filter(([key]) => key !== "__proto__"),
  );
}
function difference(before: RecordValue, after: RecordValue): RecordValue {
  const result: RecordValue = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      result[key] = after[key] ?? null;
  }
  return result;
}
function pickVitals(status: RecordValue): RecordValue {
  return displayVitals(Object.fromEntries(liveFields.map((field) => [field, status[field] ?? null])));
}
/** Display precision only. Never modify the authoritative status or incoming sample. */
function displayVitals(vitals: RecordValue): RecordValue {
  if (!Array.isArray(vitals.conditions)) return vitals;
  const rounded = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.ceil(value / 1000) * 1000 : value;
  return { ...vitals, conditions: vitals.conditions.map(value => {
    const condition = requestObject(value);
    const live = requestObject(condition.live);
    return { ...condition,
      ...('remainingMs' in condition ? { remainingMs: rounded(condition.remainingMs) } : {}),
      ...('ms' in live ? { live: { ...live, ms: rounded(live.ms) } } : {}),
    };
  }) };
}
function bag(status: PresentationStatus): RecordValue {
  return Object.fromEntries(
    (status.items || []).map((value, index) => [String(index), compactEntry(value)]),
  );
}
function compactSlots(value: unknown): RecordValue {
  return Object.fromEntries(
    Object.entries(entries(value)).map(([key, entry]) => [
      key,
      entry ? compactEntry(requestObject(entry)) : null,
    ]),
  );
}

/** A display-only store. No automation, roster, ownership, or command ports are available here. */
export function createDashboardStream<Timer>(ports: Ports<Timer>) {
  const epoch = randomUUID();
  let sequence = 0;
  const records = new Map<string, LiveRecord>();
  const sessions = new Map<
    string,
    { runtime: string; generation: string; retired: Set<string>; sample: number }
  >();
  const clients = new Map<HttpResponse, Timer>();
  const stalled = new Map<HttpResponse, Timer>();
  const metrics = { accepted: 0, rejected: 0, bytes: 0, slowClients: 0 };
  function sessionFor(name: string, runtime: string) {
    let session = sessions.get(name);
    if (session?.retired.has(runtime)) return;
    if (session?.runtime === runtime) return session;
    const retired = session?.retired || new Set<string>();
    if (session) retired.add(session.runtime);
    session = { runtime, generation: randomUUID(), retired, sample: 0 };
    sessions.set(name, session);
    records.delete(name);
    return session;
  }
  function disconnect(client: HttpResponse) {
    const timer = clients.get(client);
    if (timer !== undefined) ports.cancel(timer);
    clients.delete(client);
    const stall = stalled.get(client);
    if (stall !== undefined) ports.cancel(stall);
    stalled.delete(client);
    client.end();
  }
  function backpressure(client: HttpResponse) {
    if (!client.once) {
      metrics.slowClients++;
      disconnect(client);
      return;
    }
    stalled.set(
      client,
      ports.every(() => {
        metrics.slowClients++;
        disconnect(client);
      }, 1000),
    );
    client.once("drain", () => {
      const timer = stalled.get(client);
      if (timer !== undefined) ports.cancel(timer);
      stalled.delete(client);
    });
  }
  function send(client: HttpResponse, type: string, data: unknown) {
    if (stalled.has(client)) {
      metrics.slowClients++;
      disconnect(client);
      return;
    }
    const message =
      "data: " + JSON.stringify({ epoch, sequence, type, ...requestObject(data) }) + "\n\n";
    metrics.bytes += Buffer.byteLength(message);
    try {
      if (client.write(message) === false) backpressure(client);
    } catch {
      disconnect(client);
    }
  }
  function publish(name: string, next: LiveRecord) {
    const previous = records.get(name);
    records.set(name, next);
    const changed =
      !previous || previous.generation !== next.generation
        ? next
        : {
            ...next,
            vitals: difference(previous.vitals, next.vitals),
            items: difference(previous.items, next.items),
            slots: difference(previous.slots, next.slots),
          };
    if (
      previous &&
      previous.generation === next.generation &&
      !Object.keys(changed.vitals).length &&
      !Object.keys(changed.items).length &&
      !Object.keys(changed.slots).length
    )
      return;
    sequence++;
    for (const client of clients.keys()) send(client, "delta", { characters: { [name]: changed } });
  }
  function observe(name: string) {
    const status = ports.statuses()[name];
    if (!status || !ports.active(name)) return;
    const runtime =
      typeof status.dashboardRuntime === "string" ? status.dashboardRuntime : "legacy";
    const session = sessionFor(name, runtime);
    if (!session) return;
    // Once fast telemetry is accepted, ordinary status owns diagnostics only.
    if (session.sample > 0) return;
    publish(name, {
      generation: session.generation,
      sample: 0,
      sampledAt: ports.now(),
      vitals: pickVitals(status),
      items: bag(status),
      slots: compactSlots(status.slots),
    });
  }
  function reconcile() {
    for (const name of records.keys()) {
      if (ports.active(name) && ports.statuses()[name]) continue;
      records.delete(name);
      sessions.delete(name);
      sequence++;
      for (const client of clients.keys()) send(client, "delta", { characters: { [name]: null } });
    }
  }
  function lease(name: string) {
    observe(name);
    return { epoch, generation: sessions.get(name)?.generation, duration: clients.size ? 3000 : 0 };
  }
  function stream(request: HttpRequest, response: HttpResponse) {
    reconcile();
    for (const name of Object.keys(ports.statuses())) observe(name);
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    response.flushHeaders?.();
    const timer = ports.every(() => {
      reconcile();
      send(response, "heartbeat", { at: ports.now() });
    }, 5000);
    clients.set(response, timer);
    request.on("close", () => disconnect(response));
    send(response, "snapshot", { characters: Object.fromEntries(records) });
  }
  function validSample(name: string, body: RecordValue) {
    const session = sessions.get(name);
    return (
      !!session &&
      ports.active(name) &&
      body.epoch === epoch &&
      body.generation === session.generation &&
      body.runtime === session.runtime &&
      ports.statuses()[name]?.dashboardRuntime === session.runtime &&
      Number.isSafeInteger(body.sample) &&
      Number(body.sample) > session.sample
    );
  }
  function receive(request: HttpRequest, response: HttpResponse) {
    const body = requestObject(request.body);
    const name = typeof body.name === "string" ? body.name : "";
    if (!validSample(name, body)) {
      metrics.rejected++;
      return response.status(409).json({ error: "outdated telemetry" });
    }
    const session = sessions.get(name)!;
    if (!clients.size) return response.json({ accepted: false });
    const current = records.get(name)!;
    const data = requestObject(body.data);
    const itemChanges = compactSlots(data.items),
      slotChanges = compactSlots(data.slots);
    if (Object.keys(itemChanges).length > 256 || Object.keys(slotChanges).length > 128)
      return response.status(400).json({ error: "oversized telemetry" });
    session.sample = Number(body.sample);
    metrics.accepted++;
    publish(name, {
      generation: session.generation,
      sample: session.sample,
      sampledAt: Number(body.sampledAt) || ports.now(),
      vitals: { ...current.vitals, ...displayVitals(entries(data.vitals)) },
      items: { ...current.items, ...itemChanges },
      slots: { ...current.slots, ...slotChanges },
    });
    return response.json({ accepted: true });
  }
  function install(router: HttpRouter) {
    router.get("/party-api/dashboard-stream", stream);
    router.post("/party-api/dashboard-telemetry", receive);
  }
  return { install, lease, observe, metrics, count: () => clients.size };
}
