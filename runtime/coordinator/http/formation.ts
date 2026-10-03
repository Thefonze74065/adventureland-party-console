import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";

interface FormationState {
  leader: string | null;
  designatedTank: string | null;
  merchantCharacter: string | null;
  followers: Record<string, boolean>;
  eventsByCharacter: Record<string, boolean>;
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
  function character(body: Record<string, unknown>): FormationError | null {
    const name = requestText(body.character);
    if (!ports.owned(name)) return { code: 400, error: "invalid character" };
    if (body.follow !== undefined) {
      if (typeof body.follow !== "boolean") return { code: 400, error: "invalid follower" };
      state.followers[name] = body.follow;
    }
    if (body.eventSelections !== undefined) {
      const error = selections(name, body.eventSelections);
      if (error) return error;
    }
    return body.events !== undefined ? legacyEvents(name, body.events) : null;
  }
  return function formation(req: HttpRequest, res: HttpResponse): unknown {
    const previous = { leader: state.leader, followers: { ...state.followers } };
    const body = requestObject(req.body);
    if (body.leader !== undefined) {
      const next = assignManaged(body.leader);
      if (!next) return res.status(400).json({ error: "unknown leader" });
      state.leader = next.name;
    }
    if (body.tank !== undefined) {
      const next = assignManaged(body.tank);
      if (!next) return res.status(400).json({ error: "unknown tank" });
      state.designatedTank = next.name;
    }
    const error = body.character !== undefined ? character(body) : null;
    if (error) return res.status(error.code).json({ error: error.error });
    ports.changed?.(previous);
    ports.persist();
    return res.json({
      ok: true,
      leader: state.leader,
      tank: state.designatedTank,
      followers: state.followers,
      eventsByCharacter: state.eventsByCharacter,
      eventSelectionsByCharacter: state.eventSelectionsByCharacter,
    });
  };
}
