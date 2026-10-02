import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  createMonsterSelection,
  type MonsterSelectionState,
  type MonsterSelectionPorts,
} from "../navigation/monster-selection.ts";

export function createMonsterSelectionRoutes(
  state: MonsterSelectionState,
  ports: MonsterSelectionPorts & { dungeon?: { release(): void } },
) {
  const selection = createMonsterSelection(state, ports);
  function known(id: unknown): id is string {
    return (
      typeof id === "string" &&
      /^[a-z0-9_]+$/i.test(id) &&
      (state.monsterChoices || []).some((entry) => entry.id === id)
    );
  }
  function onlineLeader(): boolean {
    const status = state.statuses[String(state.leader)];
    return !!state.leader && !!status && !(status.seenAt < ports.now() - 10000);
  }
  function releaseDungeon(res: HttpResponse): boolean {
    try { ports.dungeon?.release(); return true; }
    catch (error) { res.status(409).json({ error: String(error) }); return false; }
  }
  function navigate(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      id = body.monsterId;
    if (id === "tinyp")
      return res
        .status(400)
        .json({ error: "Fairy has no regular route; enable passive Fairy hunting" });
    if (id === "phoenix" && !ports.validPhoenixOrder(body.phoenixRouteOrder))
      return res.status(400).json({ error: "Choose all five Phoenix regions exactly once" });
    if (!known(id)) return res.status(400).json({ error: "unknown monster" });
    if (!onlineLeader())
      return res.status(409).json({ error: "an online party leader is required" });
    const location =
      body.location !== undefined ? ports.validLocation(id, body.location) : ports.destination(id);
    if (!location)
      return res.status(409).json({ error: "this monster has no known spawn location" });
    if (!releaseDungeon(res)) return;
    const participants = selection.select(id, location, body.phoenixRouteOrder);
    if (!participants)
      return res.status(409).json({ error: "the party convoy could not be started" });
    return res.json({ ok: true, monsterId: id, location, leader: state.leader, participants });
  }
  function passive(req: HttpRequest, res: HttpResponse): unknown {
    const settings = requestObject(req.body);
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      !ports.validPassive(settings)
    )
      return res.status(400).json({ error: "Invalid passive hunting settings" });
    const rules = requestObject(settings.rules);
    if (Object.keys(rules).some(id => id === 'fieldgen0' || !known(id))) return res.status(400).json({error:'Unknown passive hunting monster'});
    ports.setPassive(settings);
    return res.json({ ok: true, passiveRareHunts: state.passiveRareHunts, passiveHunting:state.passiveHunting });
  }
  return { navigate, passive };
}
