import type {
  CaveCommand,
  CavePoint,
  DungeonParty,
  DungeonState,
} from "../../dungeons/contracts.ts";

/** Cave-owned assembly and travel. Floor transitions remain native stair actions. */
export function createCaveTravel(
  party: DungeonParty,
  ports: {
    fresh(name: string): boolean;
    issue(
      names: string[],
      action: CaveCommand["action"],
      id: string,
      extra: Partial<CaveCommand>,
    ): void;
    persist(): void;
  },
) {
  const status = (name: string) => party.statuses[name];
  function start(target: CavePoint) {
    const d = party.dailyDungeons!,
      leader = status(d.participants[0]);
    if (!leader?.map || target.map !== leader.map)
      throw Error("Waypoint is on a different floor. Use the stairs to reach that floor first.");
    const serial = (d.travel?.serial || d.progress?.serial || 0) + 1;
    if (d.progress) d.progress.serial = serial;
    d.travel = {
      target,
      origin: {
        id: "assembly",
        label: "Party assembly",
        map: leader.map,
        x: leader.x!,
        y: leader.y!,
      },
      stage: "assembling",
      serial,
    };
    if (target.down) d.stairContinuation = target;
    d.error = undefined;
    ports.issue(d.participants, "gather", "cave-assemble:" + d.run + ":" + serial, {
      run: d.run,
      target: d.travel.origin,
    });
  }
  function arrived(d: DungeonState, point: CavePoint) {
    return d.participants.every(
      (name) => atPoint(name, point) && receiptComplete(name, d.commands[name]),
    );
  }
  function atPoint(name: string, point: CavePoint) {
    const s = status(name);
    return (
      ports.fresh(name) &&
      !!s &&
      s.map === point.map &&
      Math.hypot((s.x ?? Infinity) - point.x, (s.y ?? Infinity) - point.y) <= 50
    );
  }
  function receiptComplete(name: string, command: CaveCommand | undefined) {
    const receipt = status(name)?.dungeon?.action;
    return !!command && receipt?.id === command.id && receipt.status === "complete";
  }
  function tick() {
    const d = party.dailyDungeons!,
      t = d.travel;
    if (!t || d.phase !== "active" || d.participants.some((n) => status(n)?.dungeon?.cave?.paused))
      return;
    if (repairOrRegroup(d,t)) return;
    if (t.stage === "assembling" && arrived(d, t.origin)) {
      t.stage = "travelling";
      const speeds = d.participants
        .map((n) => status(n)?.speed)
        .filter((s): s is number => !!s && Number.isFinite(s));
      ports.issue(d.participants, "move", "cave-travel:" + d.run + ":" + t.serial, {
        run: d.run,
        target: t.target,
        cruiseSpeed: speeds.length ? Math.min(...speeds) : 100,
      });
    }
    if (t.stage === "travelling" && arrived(d, t.target)) finish(d, t);
  }
  function regroupReady(name: string, d: DungeonState, origin: CavePoint) {
    const s = status(name), observation = s?.dungeon;
    if (!ports.fresh(name) || s?.map !== origin.map || !observation?.alive || !observation.ready) return false;
    const cave = observation.cave;
    return !!cave && cave.run === d.run && !cave.paused;
  }
  function displacedGather(name: string, d: DungeonState, origin: CavePoint) {
    const command = d.commands[name];
    return command?.action === 'gather' && command.run === d.run && command.target?.map === origin.map &&
      command.target.x === origin.x && command.target.y === origin.y &&
      receiptComplete(name, command) && !atPoint(name, origin);
  }
  function regroup(d: DungeonState, t: NonNullable<DungeonState['travel']>) {
    if (t.stage !== 'assembling' || !d.participants.every(n => regroupReady(n,d,t.origin))) return false;
    const displaced = d.participants.filter(n => displacedGather(n,d,t.origin));
    if (!displaced.length) return false;
    if ((t.assemblyRepairs || 0) >= 3) {
      d.error = 'Cave assembly repeatedly displaced after completion. Stop travel and choose the destination again.';
      return true;
    }
    t.assemblyRepairs = (t.assemblyRepairs || 0)+1;
    ports.issue(displaced,'gather',`cave-assemble:${d.run}:${t.serial}:regroup:${t.assemblyRepairs}`,{run:d.run,target:t.origin});
    ports.persist();
    return true;
  }
  function repairOrRegroup(d: DungeonState, t: NonNullable<DungeonState['travel']>) {
    return repair(d,t) || regroup(d,t);
  }
  function repair(d: DungeonState, t: NonNullable<DungeonState['travel']>) {
    const failed = d.participants.some(n => {
      const receipt = status(n)?.dungeon?.action;
      return receipt?.id === d.commands[n]?.id && receipt?.status === 'failed';
    });
    if (!failed) return false;
    if ((t.repairs || 0) >= 3 || !d.participants.every(n => status(n)?.dungeon?.ready)) return true;
    start(t.target);
    d.travel!.repairs = (t.repairs || 0)+1;
    ports.persist();
    return true;
  }
  function finish(d: DungeonState, t: NonNullable<DungeonState["travel"]>) {
    if (t.target.down && !d.participants.every((n) => status(n)?.dungeon?.ready)) return;
    if (t.target.down) {
      ports.issue(d.participants, "stairs", "cave-stairs:" + d.run + ":" + t.serial, {
        run: d.run,
        target: t.target,
      });
      d.stairContinuation = t.target;
    } else for (const command of Object.values(d.commands)) delete command.cruiseSpeed;
    delete d.travel;
    ports.persist();
  }
  return { start, tick, arrived };
}
