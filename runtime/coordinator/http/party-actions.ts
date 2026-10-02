import { dungeonOwns } from '../../dungeons/contracts.ts';
import { merchantPartyGroups } from "../../party-groups.ts";
import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import type { MerchantWork } from "../merchant/work.ts";

interface PartyActionState {
  dailyDungeons?: import('../../dungeons/contracts.ts').DungeonState;
  navigationIntents?: Record<string, { revision: number } | undefined>;
  leader: string | null;
  merchantCharacter: string | null;
  statuses: Record<string, { seenAt: number; map: string; x: number; y: number } | undefined>;
  location: ReturnLocation | null;
  commands: Record<string, unknown>;
  townCycle: { id: string; pending: string[]; startedAt: number; revisions?: Record<string, number> } | null;
  escape: unknown;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  upgrades: Record<string, unknown[] | undefined>;
  purchases: Record<string, unknown[] | undefined>;
  compounds: Record<string, { items: unknown[] }[] | undefined>;
  autoCompounds: Record<string, unknown[] | undefined>;
  followers?: Record<string, boolean>;
  bankbois?: Record<string, unknown>;
}
interface PartyActionPorts {
  now(): number;
  nextCommand(): number;
  release(): void;
  dungeon?: { exit(id: string): void; release(): void };
  members(): string[];
  active(): string[];
  authorize(names: string[], location: ReturnLocation, shared: boolean): void;
  invalidate(names: string[], reason: string, shared: boolean): void;
  persist(): void;
  dispatch(): void;
  escape(names: string[]): unknown;
  queue(names: string[], reason: string): void;
  convoy(location: ReturnLocation, label: string, names: string[], purpose: string): boolean;
}

function travelLocation(body: Record<string, unknown>): ReturnLocation | null {
  const map = body.map,
    x = Number(body.x),
    y = Number(body.y);
  return typeof map === "string" &&
    /^[a-z0-9_]+$/i.test(map) &&
    Number.isFinite(x) &&
    Number.isFinite(y)
    ? { map, x, y }
    : null;
}

export function createPartyActionRoutes(state: PartyActionState, ports: PartyActionPorts) {
  function travel(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      location = travelLocation(body);
    if (!location) return res.status(400).json({ error: "invalid location" });
    if (!releaseDungeon(res)) return;
    ports.release();
    ports.authorize(ports.members(), location, true);
    const names = ports.members().filter(name => ports.active().includes(name));
    if (!ports.convoy(location, "party location", names, body.force === true ? "party-force-travel" : "party-travel"))
      return res.status(409).json({ error: "an online party leader is required for shared travel" });
    ports.persist();
    return res.json({ ok: true, partyLocation: state.location });
  }
  function checkpoint(_req: HttpRequest, res: HttpResponse): unknown {
    const status = state.statuses[String(state.leader)];
    if (!state.leader || !status || status.seenAt < ports.now() - 10000)
      return res.status(409).json({ error: "an online party leader is required" });
    ports.authorize(
      ports.members(),
      { map: status.map, x: Number(status.x), y: Number(status.y) },
      true,
    );
    ports.persist();
    return res.json({ ok: true, leader: state.leader, partyLocation: state.location });
  }
  function bank(req: HttpRequest, res: HttpResponse): unknown {
    const groups = merchantPartyGroups(state, ports.active());
    const requested = requestObject(req.body).group;
    const group = requested === undefined && groups.length === 1
      ? groups[0] : groups.find(entry => entry.id === requested);
    if (!group) return res.status(409).json({ error: groups.length ? "Select a party group to visit" : "No party members are online", groups });
    let added = false;
    for (const name of group.members) {
      const existing = [state.merchantCurrent, ...state.merchantQueue].find(job => job?.target === name && job.reason === 'party collection');
      if (existing) { added = existing.manual !== true || added; existing.manual = true; continue; }
      // Queue each member explicitly: positions and arrival-time radius never select recipients.
      state.merchantQueue.push({
        id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
        target: name, reason: "party collection", manual: true, queuedAt: ports.now(),
      });
      added = true;
    }
    if (added) { ports.persist(); ports.dispatch(); }
    return res.json({ ok: true, group: group.id, queued: group.members });
  }
  function town(_req: HttpRequest, res: HttpResponse): unknown {
    if (exitDungeon(res)) return;
    ports.release();
    const names = ports.members().filter((name) => ports.active().includes(name));
    ports.invalidate(ports.members(), "manual Town", true);
    const cycleId = "town-" + ports.now() + "-" + ports.nextCommand();
    state.townCycle = names.length
      ? { id: cycleId, pending: names.slice(), startedAt: ports.now(),
          revisions: Object.fromEntries(names.map(name => [name, state.navigationIntents?.[name]?.revision || 0])) }
      : null;
    for (const name of names)
      state.commands[name] = { id: ports.nextCommand(), type: "town-party", cycleId };
    ports.persist();
    return res.json({ ok: true, queued: names });
  }
  function upgrades(_req: HttpRequest, res: HttpResponse): unknown {
    const names = ports
      .active()
      .filter(
        (name) =>
          (state.upgrades[name] || []).length ||
          (state.purchases[name] || []).length ||
          (state.compounds[name] || []).some((group) => group.items.length === 3) ||
          (state.autoCompounds[name] || []).length,
      );
    ports.queue(names, "upgrades and compounds");
    return res.json({ ok: true, queued: names });
  }
  function escapeState(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json({ escape: state.escape });
  }
  function escape(_req: HttpRequest, res: HttpResponse): unknown {
    if (exitDungeon(res)) return;
    return res.json({ escape: ports.escape(ports.members()) });
  }
  function resume(_req: HttpRequest, res: HttpResponse): unknown {
    if (!releaseDungeon(res)) return;
    ports.release();
    return res.json({ escape: state.escape });
  }
  function exitDungeon(res: HttpResponse) {
    if (!dungeonOwns(state) || !ports.dungeon) return false;
    // A held visit with every participant already outside can release normally.
    // Otherwise Town still exits the live dungeon before mainland travel.
    try { ports.dungeon.release(); return false; } catch { /* Still inside or awaiting fresh observations. */ }
    ports.dungeon.exit('manual-exit:' + ports.now() + ':' + ports.nextCommand());
    res.json({ ok: true, dailyDungeon: state.dailyDungeons }); return true;
  }
  function releaseDungeon(res: HttpResponse) {
    try { ports.dungeon?.release(); return true; }
    catch (error) { res.status(409).json({ error: String(error) }); return false; }
  }
  return { travel, checkpoint, bank, town, upgrades, escapeState, escape, resume };
}
