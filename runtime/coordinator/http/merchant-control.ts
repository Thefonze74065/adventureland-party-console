import { releaseMerchantInterruption } from "../navigation/merchant-interruption.ts";
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";

interface ControlState {
  merchantCharacter: string | null;
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  commands: Record<string, { id?: number; type: string; mode?: null } | undefined>;
  merchantAutomations: Record<string, boolean>;
  autoExchanges: Record<string, unknown>;
  marked: Record<string, unknown[]>;
  merchantMarked: Record<string, unknown[]>;
  statScrolls: Record<string, unknown[] | undefined>;
  upgrades: Record<string, unknown[] | undefined>;
  compounds: Record<string, unknown[] | undefined>;
  autoCompounds: Record<string, unknown[] | undefined>;
  gatheringModes: unknown[];
  merchantForceStand: boolean;
  merchantHomeReturnAt?: number;
  activeRealm: string;
}
interface ControlPorts {
  now(): number;
  nextCommand(): number;
  stamp(job: MerchantWork): MerchantWork;
  automated(reason: string): boolean;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  dispatch(): void;
  returnHome(merchant: string, realm: string): void;
}
export function createMerchantControlRoutes(state: ControlState, ports: ControlPorts) {
  function retry(req: HttpRequest, res: HttpResponse): unknown {
    const job = state.merchantQueue.find(entry => entry.id === requestObject(req.body).id);
    if (!job) return res.status(404).json({ error: "queued merchant job not found" });
    delete job.realmRetryExhausted;
    delete job.realmBlockedReason;
    delete job.realmError;
    job.realmAttempts = 0;
    job.retryAt = 0;
    ports.persist(); ports.dispatch();
    return res.json({ ok: true });
  }
  function cancelIntent(job: MerchantWork): void {
    const name = job.target;
    if (job.reason === "marked items") {
      state.marked[String(name)] = [];
      state.merchantMarked[String(name)] = [];
    } else if (job.reason === "manual upgrades") {
      state.statScrolls[String(name)] = [];
      state.upgrades[String(name)] = (state.upgrades[String(name)] || []).filter(mark => (mark as {auto?: boolean})?.auto);
    } else if (job.reason === "auto upgrade") {
      state.upgrades[String(name)] = (state.upgrades[String(name)] || []).filter(mark => !(mark as {auto?: boolean})?.auto);
      state.merchantAutomations["auto upgrade"] = false;
    } else if (job.reason === "manual compounds") {
      state.compounds[String(name)] = [];
    } else if (["stat scrolls", "upgrades and compounds"].includes(job.reason)) {
      state.statScrolls[String(name)] = [];
      state.upgrades[String(name)] = [];
      state.compounds[String(name)] = [];
    } else if (job.reason === "auto compound") {
      state.autoCompounds[String(name)] = [];
      state.merchantAutomations["auto compound"] = false;
    } else cancelAutomation(job);
  }
  function cancelAutomation(job: MerchantWork): void {
    if (job.reason === "exchange" && Array.isArray(job.autoExchangeKeys)) {
      for (const key of job.autoExchangeKeys) delete state.autoExchanges[key];
      state.merchantAutomations['automatic exchange'] = false;
    } else if (ports.automated(job.reason)) state.merchantAutomations[job.reason] = false;
  }
  function cancel(req: HttpRequest, res: HttpResponse): unknown {
    const id = requestText(requestObject(req.body).id || ""),
      index = state.merchantQueue.findIndex((job) => job.id === id);
    if (index < 0) return res.status(404).json({ error: "queued merchant job not found" });
    const job = state.merchantQueue.splice(index, 1)[0]!;
    cancelIntent(job);
    ports.log("Cancelled queued merchant job", "info", { reason: job.reason, target: job.target });
    ports.persist();
    return res.json({ ok: true });
  }
  function clear(_req: HttpRequest, res: HttpResponse): unknown {
    releaseMerchantInterruption(state, state.merchantCurrent?.id);
    if (state.merchantCharacter)
      state.commands[String(state.merchantCharacter)] = {
        id: ports.nextCommand(),
        type: "merchant-gather",
        mode: null,
      };
    state.merchantQueue = [];
    state.merchantCurrent = null;
    state.gatheringModes = [];
    ports.log("Merchant work and gathering cleared", "info");
    ports.persist();
    return res.json({ ok: true });
  }
  function pause(): void {
    if (!state.merchantCurrent) return;
    const paused: MerchantWork = {
      ...state.merchantCurrent,
      queuedAt: Number(state.merchantCurrent.queuedAt) || ports.now(),
    };
    delete paused.phase;
    delete paused.startedAt;
    delete paused.heartbeatAt;
    delete paused.progressAt;
    delete paused.handoff;
    releaseMerchantInterruption(state, paused.id);
    state.merchantQueue.unshift(ports.stamp(paused));
    state.merchantCurrent = null;
  }
  function force(req: HttpRequest, res: HttpResponse): unknown {
    const enabled = requestObject(req.body).enabled === true,
      merchant = state.merchantCharacter;
    if (!merchant) return res.status(409).json({ error: "configure a merchant first" });
    state.merchantForceStand = enabled;
    if (enabled) {
      pause();
      delete state.commands[merchant];
      ports.log("Force stand enabled; all merchant work is paused", "warning");
      ports.returnHome(merchant, state.activeRealm);
    } else {
      if (state.commands[merchant]?.type === "merchant-idle") delete state.commands[merchant];
      ports.log("Force stand disabled; merchant work may resume", "info");
      ports.dispatch();
    }
    ports.persist();
    return res.json({ ok: true, enabled: state.merchantForceStand });
  }
  return { cancel, clear, force, retry };
}
