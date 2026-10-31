import { octoberEvents, validEventLimits, type EventLimits } from "../../../dashboard/lib/event-policy.ts";
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";

interface FormationState {
  leader: string | null;
  designatedTank: string | null;
  offTank: string | null;
  pullMode: boolean;
  merchantCharacter: string | null;
  followers: Record<string, boolean>;
  eventsByCharacter: Record<string, boolean>;
  eventLimitsByCharacter: Record<string, Record<string, EventLimits>>;
  eventPrioritiesByCharacter: Record<string, string[]>;
  eventSelectionsByCharacter: Record<string, string[]>;
}
interface FormationPorts {
  changed?(previous: { leader: string | null; followers: Record<string, boolean> }): void;
  managed(name: string): boolean;
  owned(name: string): unknown;
  supported: readonly string[];
  inherited(name: string): boolean;
  selected(name: string): string[];
  persist(): void;
}
interface FormationError {
  code: number;
  error: string;
}

export function createFormationRoute(state: FormationState, ports: FormationPorts) {
  function selections(name: string, value: unknown): FormationError | null {
    if (!Array.isArray(value) || value.some((id) => !ports.supported.includes(id)))
      return { code: 400, error: "invalid event selections" };
    if (ports.inherited(name)) return { code: 409, error: "using leader events" };
    state.eventSelectionsByCharacter[name] = [...new Set(value as string[])];
    return null;
  }
  function legacyEvents(name: string, value: unknown): FormationError | null {
    if (typeof value !== "boolean") return { code: 400, error: "invalid events setting" };
    state.eventsByCharacter[name] = value;
    state.eventSelectionsByCharacter[name] = [
      ...(ports.selected(name).includes("anniversary") ? ["anniversary"] : []),
      ...(value ? ports.supported.filter((id) => id !== "anniversary") : []),
    ];
    return null;
  }
  function assignManaged(value: unknown): { name: string | null } | null {
    if (value === null) return { name: null };
    const name = requestText(value);
    return ports.managed(name) ? { name } : null;
  }
  /** A complete order, or the order of a client built before octoberEvents with them appended. */
  function completeOrder(value: unknown): string[] | null {
    if (!Array.isArray(value) || new Set(value).size !== value.length) return null;
    const ids = value.filter((id): id is string => typeof id === "string" && ports.supported.includes(id));
    const required = ports.supported.filter(id => !octoberEvents.includes(id));
    if (ids.length !== value.length || required.some(id => !ids.includes(id))) return null;
    return [...ids, ...ports.supported.filter(id => !ids.includes(id))];
  }
  function priorities(name: string, value: unknown): FormationError | null {
    const order = completeOrder(value);
    if (!order) return { code: 400, error: "invalid event priorities" };
    if (ports.inherited(name)) return { code: 409, error: "using leader events" };
    state.eventPrioritiesByCharacter[name] = order;
    return null;
  }
  function limits(name: string, value: unknown): FormationError | null {
    const patch = requestObject(value);
    if (!ports.supported.includes(requestText(patch.event)) || !validEventLimits(patch.limits))
      return { code: 400, error: "invalid event limits" };
    if (ports.inherited(name)) return { code: 409, error: "using leader events" };
    const settings = state.eventLimitsByCharacter[name] ??= {};
    settings[requestText(patch.event)] = structuredClone(patch.limits);
    return null;
  }
  function settings(name: string, body: Record<string, unknown>): FormationError | null {
    if (body.eventLimits !== undefined) {
      const error = limits(name, body.eventLimits);
      if (error) return error;
    }
    if (body.eventPriorities !== undefined) {
      const error = priorities(name, body.eventPriorities);
      if (error) return error;
    }
    return body.eventSelections !== undefined ? selections(name, body.eventSelections) : null;
  }
  function character(body: Record<string, unknown>): FormationError | null {
    const name = requestText(body.character);
    if (!ports.owned(name)) return { code: 400, error: "invalid character" };
    if (body.follow !== undefined) {
      if (typeof body.follow !== "boolean") return { code: 400, error: "invalid follower" };
      state.followers[name] = body.follow;
    }
    const error = settings(name, body);
    if (error) return error;
    return body.events !== undefined ? legacyEvents(name, body.events) : null;
  }
  /** The tank, off tank and pull mode fields; the error text, or null once applied. */
  function tankRoles(body: Record<string, unknown>): string | null {
    const tank = body.tank !== undefined ? assignManaged(body.tank) : undefined;
    if (tank === null) return "unknown tank";
    const off = body.offTank !== undefined ? assignManaged(body.offTank) : undefined;
    if (off === null) return "unknown off tank";
    if (body.pullMode !== undefined && typeof body.pullMode !== "boolean") return "invalid pull mode";
    if (tank) state.designatedTank = tank.name;
    if (off) state.offTank = off.name;
    if (typeof body.pullMode === "boolean") state.pullMode = body.pullMode;
    return null;
  }
  return function formation(req: HttpRequest, res: HttpResponse): unknown {
    const previous = { leader: state.leader, followers: { ...state.followers } };
    const body = requestObject(req.body);
    if (body.leader !== undefined) {
      const next = assignManaged(body.leader);
      if (!next) return res.status(400).json({ error: "unknown leader" });
      state.leader = next.name;
    }
    const roleError = tankRoles(body);
    if (roleError) return res.status(400).json({ error: roleError });
    const error = body.character !== undefined ? character(body) : null;
    if (error) return res.status(error.code).json({ error: error.error });
    ports.changed?.(previous);
    ports.persist();
    return res.json({
      ok: true,
      leader: state.leader,
      tank: state.designatedTank,
      offTank: state.offTank,
      pullMode: state.pullMode,
      followers: state.followers,
      eventsByCharacter: state.eventsByCharacter,
      eventLimitsByCharacter: state.eventLimitsByCharacter,
      eventPrioritiesByCharacter: state.eventPrioritiesByCharacter,
      eventSelectionsByCharacter: state.eventSelectionsByCharacter,
    });
  };
}
