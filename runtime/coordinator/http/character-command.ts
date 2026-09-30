import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";
import type { Catalog } from "../../../dashboard/lib/farming-zones.ts";

interface CommandState {
  monsterChoices?: Catalog | null;
  farmAreaState: unknown;
  marked: Record<string, unknown>;
  merchantMarked: Record<string, unknown>;
  autoItemMarks: Record<string, unknown>;
  upgrades: Record<string, unknown>;
  statScrolls: Record<string, unknown>;
  compounds: Record<string, unknown>;
  withdrawals: Record<string, unknown>;
}
interface CommandPorts {
  farmingFocus?(name: string, ids: string[]): void;
  managed(name: unknown, body?: Record<string, unknown>): boolean;
  farmingLocation(choices: Catalog, monsters: unknown[], location: unknown): unknown;
  handlers: ((body: Record<string, unknown>) => CommandOutcome)[];
}
/** Keeps shared request validation and acknowledgements separate from domain commands. */
export function createCharacterCommandRoute(state: CommandState, ports: CommandPorts) {
  function applyFarmingFocus(body: Record<string, unknown>, outcome: CommandOutcome): void {
    if ((!outcome || outcome.status < 400) && body.farmingMonsterIds)
      ports.farmingFocus?.(requestText(body.character), body.farmingMonsterIds as string[]);
  }
  function validFarming(body: Record<string, unknown>): boolean {
    const ids = body.farmingMonsterIds;
    if (ids === undefined) return true;
    return (
      Array.isArray(ids) &&
      !!ids.length &&
      ids.every(id => typeof id === 'string' && /^[a-z0-9_]+$/i.test(id)) &&
      !ids.includes("tinyp") &&
      !ids.includes("phoenix") &&
      !!ports.farmingLocation(state.monsterChoices || [], ids, body.location)
    );
  }
  function result(name: string): Record<string, unknown> {
    return {
      ok: true,
      marked: state.marked[name] || [],
      merchantMarked: state.merchantMarked[name] || [],
      autoItemMarks: state.autoItemMarks[name] || {},
      upgrades: state.upgrades[name] || [],
      statScrolls: state.statScrolls[name] || [],
      compounds: state.compounds[name] || [],
      withdrawals: state.withdrawals[name] || [],
    };
  }
  return function command(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (!validFarming(body))
      return res.status(400).json({ error: "The selected farming area is no longer available" });
    if (!ports.managed(body.character, body)) return res.status(400).json({ error: "unknown character" });
    if (body.farmingMonsterIds) {
      body.location = ports.farmingLocation(
        state.monsterChoices || [],
        body.farmingMonsterIds as unknown[],
        body.location,
      );
      state.farmAreaState = { preferredLocation: body.location };
    }
    for (const handler of ports.handlers) {
      const outcome = handler(body);
      if (outcome === undefined) continue;
      applyFarmingFocus(body, outcome);
      if (outcome) return res.status(outcome.status).json(outcome.body);
      return res.json(result(requestText(body.character)));
    }
    return res.status(400).json({ error: "invalid command" });
  };
}
