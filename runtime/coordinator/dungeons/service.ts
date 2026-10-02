import { createCaveProgress } from "./progress.ts";
import { createCaveTravel } from './travel.ts';
import { createPriestRecovery } from "./priest-recovery.ts";
import type {
  CaveCommand,
  DungeonParty,
  DungeonState,
  DungeonView,
} from "../../dungeons/contracts.ts";
import { dungeonOwns } from "../../dungeons/contracts.ts";
import { requestObject, type HttpRouter } from "../http/contracts.ts";

interface Ports {
  now(): number;
  persist(): void;
  canStart?(names: string[]): void;
  cancel(names: string[]): void;
}
export function createDungeons(party: DungeonParty, ports: Ports) {
  const state = (): DungeonState =>
    (party.dailyDungeons ||= {
      protectFromEvents: true,
      participants: [],
      phase: "idle",
      commands: {},
      operations: [],
    });
  const priestRecovery = createPriestRecovery(party, () => ports.persist());
  const fresh = (name: string) =>
    !!party.statuses[name] && ports.now() - party.statuses[name]!.seenAt < 3000;
  const observation = (name: string) => party.statuses[name]?.dungeon;
  const travel = createCaveTravel(party, {fresh,issue,persist:()=>ports.persist()});
  const progress = createCaveProgress(party, {fresh, issue, startTravel:travel.start, persist: () => ports.persist()});
  function snapshot(): DungeonView {
    reconcile();
    const d = state(),
      names = d.phase === "idle" ? candidates() : d.participants;
    return {
      state: d,
      members: names.map((name) => ({ name, fresh: fresh(name), observation: observation(name) })),
    };
  }
  function candidates() {
    // Match roster presence; shorter heartbeat gaps still fail entry freshness validation.
    const followers = Object.keys(party.followers || {}).filter(
      (n) => party.followers?.[n] && (party.statuses[n]?.seenAt ?? NaN) > ports.now() - 10000,
    );
    return [party.leader, ...followers]
      .filter((n): n is string => !!n && n !== party.merchantCharacter)
      .filter((n, i, all) => all.indexOf(n) === i);
  }
  function issue(
    names: string[],
    action: CaveCommand["action"],
    operation: string,
    extra: Partial<CaveCommand> = {},
  ) {
    const d = state();
    for (const name of names) d.commands[name] = { ...extra, action, id: operation + ":" + name };
    ports.persist();
  }
  function begin(id: string) {
    const d = state(),
      names = candidates();
    if (d.phase !== "idle" && d.phase !== "held")
      throw Error("A dungeon operation already owns the party");
    validateCandidates(names);
    validateLaunch(names);
    const server = party.statuses[names[0]]?.server;
    for (const name of names) validateEntry(name, server);
    const keeper = observation(names[0])?.keeper;
    if (!keeper) throw Error("Dorr location unavailable from the game client");
    Object.assign(d, {
      participants: names,
      phase: "gathering",
      server,
      error: undefined,
      run: undefined,
      pendingEvent: undefined,
      exitDispatched: false,
      priestRecovery: undefined,
      recoveryDeaths: undefined,
      manualRecovery: false,
      travel: undefined,
      stairContinuation: undefined,
      progress: {enabled:false, serial:0, message:'Choose a destination to begin travelling'},
      resuming: names.every((n) => !!observation(n)?.visit?.resume),
    });
    ports.cancel(names);
    issue(names, "gather", id, { target: { ...keeper, id: "dorr", label: "Dorr" } });
  }
  function validateLaunch(names: string[]) {
    ports.canStart?.(names);
    if (!names.every((n) => observation(n)?.visit?.resume)) validateParty({ participants: names });
  }
  function validateCandidates(names: string[]) {
    if (!names.length || names.length > 3 || names[0] !== party.leader)
      throw Error("Select a leader and at most two combat followers");
  }
  function validateEntry(name: string, server?: string) {
    const s = party.statuses[name],
      o = observation(name);
    if (!fresh(name) || !o?.supported || o.protocol !== 1)
      throw Error(name + ": fresh dungeon-compatible runtime required");
    if (s?.rip || s?.server !== server) throw Error(name + ": must be alive on the same server");
    validateVisit(name);
  }
  function validateVisit(name: string) {
    const v = observation(name)?.visit,
      server = party.statuses[name]?.server;
    if (!v || ports.now() - v.checkedAt > 45000)
      throw Error(name + ": daily eligibility needs refreshing");
    if (!v.available && !v.resume) throw Error(name + ": daily visit unavailable");
    if (v.resume && v.resume.server !== server)
      throw Error(name + ": resume on " + v.resume.server);
  }
  function reconcile() {
    adopt();
    const d = party.dailyDungeons;
    if (!d || d.phase === "idle" || !d.participants.length) return;
    observeActions(d);
    if (!d.participants.every(fresh)) return;
    reconcileGather(d);
    reconcileReturns(d);
    reconcileCaves(d);
    priestRecovery.reconcile(d);
    progress.tick(d);
    travel.tick();
  }
  function adopt() {
    const d = state();
    if (d.phase !== "idle") return;
    const names = candidates(),
      inside = names.find((n) => fresh(n) && observation(n)?.cave);
    if (!inside) return;
    d.participants = names;
    d.phase = "entering";
    d.commands = {};
    d.server = party.statuses[inside]?.server;
    d.error = "Reconciling an existing dungeon visit";
    ports.cancel(names);
    ports.persist();
  }
  function observeActions(d: DungeonState) {
    for (const n of d.participants) observeAction(d, n);
  }
  function observeAction(d: DungeonState, n: string) {
    const report = observation(n)?.action,
      command = d.commands[n];
    if (!fresh(n) || !report || report.id !== command?.id) return;
    if (["failed", "uncertain"].includes(report.status)) d.error = n + ": " + report.error;
    if (command.action === "exit" && report.status !== "failed") d.exitDispatched = true;
  }
  function gathered(d: DungeonState, name: string) {
    const report = observation(name)?.action;
    const status = party.statuses[name],
      keeper = observation(name)?.keeper;
    if (!status || !keeper || status.map !== keeper.map) return false;
    if (Math.hypot(Number(status.x) - keeper.x, Number(status.y) - keeper.y) > 80) return false;
    return !!report && report.id === d.commands[name]?.id && report.status === "complete";
  }
  function reconcileGather(d: DungeonState) {
    if (d.phase !== "gathering" || !d.participants.every((n) => gathered(d, n))) return;
    try {
      for (const n of d.participants) validateEntry(n, d.server);
    } catch (error) {
      d.error = String(error);
      return;
    }
    if (!d.resuming) {
      try {
        validateParty(d);
      } catch (error) {
        d.error = String(error);
        return;
      }
    }
    d.error = undefined;
    d.phase = "entering";
    issue(
      d.resuming ? d.participants : [d.participants[0]],
      "enter",
      d.commands[d.participants[0]].id + ":enter",
    );
  }
  function validateParty(d: Pick<DungeonState, "participants">) {
    for (const name of d.participants) {
      const o = observation(name);
      if (!o?.ready) throw Error(name + ": wait until combat and loot finish");
      if (d.participants.length === 1 && !o.leader && o.members.length === 0) continue;
      if (o.leader !== d.participants[0])
        throw Error(name + ": assemble the selected party out of combat");
      if (
        o.members.length !== d.participants.length ||
        o.members.some((n) => !d.participants.includes(n))
      )
        throw Error("In-game party must match dungeon participants exactly");
    }
  }
  function reconcileCaves(d: DungeonState) {
    const caves = d.participants.map((n) => observation(n)?.cave);
    if (d.phase === "held" && caves.some(Boolean)) {
      exit("late-entry:" + ports.now());
      return;
    }
    if (
      ["entering", "active"].includes(d.phase) &&
      caves.every((c) => c && c.run === caves[0]?.run)
    ) {
      if (d.phase !== "active") {
        d.phase = "active";
        d.run = caves[0]!.run;
        d.commands = {};
        d.error = undefined;
        ports.persist();
      }
    }
    if ((d.phase === "active" || d.phase === "exiting") && caves.every((c) => c === null)) {
      d.phase = "held";
      d.commands = {};
      d.run = undefined;
      ports.persist();
    }
  }
  function exit(id: string, event?: string) {
    const d = state();
    if (!dungeonOwns(party)) throw Error("No owned dungeon visit");
    if (d.phase === "exiting" && event) return;
    d.interruptedPhase = d.phase;
    d.interruptedCommands = d.commands;
    d.exitDispatched = false;
    d.commands = {};
    d.phase = "exiting";
    d.pendingEvent = event;
    d.error = undefined;
    issue(d.participants, "exit", id, { run: d.run });
  }
  function eventAllowed(name: string, event?: string, eligible = false) {
    if (!dungeonOwns(party, name)) return true;
    const d = state();
    if (canReleaseForEvent(d, event, eligible)) {
      d.phase = "idle";
      delete d.pendingEvent;
      ports.persist();
      return true;
    }
    if (!event) return d.protectFromEvents === false;
    if (d.protectFromEvents === false && eligible && event && d.phase !== "held")
      exit("event:" + ports.now(), event);
    return false;
  }
  function canReleaseForEvent(d: DungeonState, event: string | undefined, eligible: boolean) {
    return (
      d.phase === "held" &&
      !!event &&
      d.pendingEvent === event &&
      eligible &&
      d.participants.every(fresh)
    );
  }
  function release() {
    reconcile();
    const d = state();
    if (d.phase === "idle") return;
    if (
      d.phase !== "held" ||
      !d.participants.every((n) => fresh(n) && observation(n)?.cave === null)
    )
      throw Error("Exit the dungeon before resuming ordinary travel");
    d.phase = "idle";
    d.commands = {};
    delete d.pendingEvent;
    ports.persist();
  }
  function action(body: Record<string, unknown>) {
    reconcile();
    const d = state(),
      id = body.operationId;
    if (typeof id !== "string" || !id || id.length > 160)
      throw Error("An operation ID is required");
    if (d.operations.includes(id)) return;
    const handlers: Record<string, () => void> = {
      settings: () => settings(body),
      progress: () => {
        if (d.phase !== "active" || typeof body.enabled !== "boolean") throw Error("Active dungeon and enabled flag required");
        progress.set(body.enabled);
      },
      enter: () => begin(id),
      resume: () => begin(id),
      exit: () => exit(id),
      release,
      retry: () => retry(id),
      recover: () => recover(id),
    };
    const handler = Object.hasOwn(handlers, String(body.action)) && handlers[String(body.action)];
    if (handler) handler();
    else perform(body, id);
    d.operations.push(id);
    d.operations = d.operations.slice(-200);
    ports.persist();
  }
  function retry(id: string) {
    const d = state();
    const failed = Object.entries(d.commands).filter(([name, command]) => {
      const receipt = observation(name)?.action;
      return fresh(name) && receipt?.id === command.id && receipt.status === "failed";
    });
    if (!failed.length) throw Error("No confirmed pre-dispatch failure to retry");
    if (d.travel) { travel.start(d.travel.target); return; }
    for (const [name, command] of failed)
      issue([name], command.action, id, { ...command, id: undefined });
    d.error = undefined;
  }
  function recover(id: string) {
    const d = state();
    if (!["entering", "active"].includes(d.phase)) throw Error("No visit to recover");
    const missing = d.participants.filter((n) => observation(n)?.cave === null);
    if (!missing.length) throw Error("No missing participants");
    for (const name of missing) {
      validateEntry(name, d.server);
      const o = observation(name);
      if (!o?.visit?.resume || !o.keeper) throw Error(name + ": server-confirmed return required");
    }
    for (const name of missing)
      issue([name], "gather", id, {
        resume: true,
        target: { ...observation(name)!.keeper!, id: "dorr", label: "Dorr" },
      });
  }
  function reconcileReturns(d: DungeonState) {
    if (!["entering", "active"].includes(d.phase)) return;
    for (const name of d.participants) reconcileReturn(d, name);
  }
  function reconcileReturn(d: DungeonState, name: string) {
    const command = d.commands[name];
    if (command?.action !== "gather" || !command.resume || !gathered(d, name)) return;
    if (observation(name)?.cave || !observation(name)?.visit?.resume) return;
    issue([name], "enter", command.id + ":resume");
  }
  function settings(body: Record<string, unknown>) {
    const d = state();
    if (typeof body.protectFromEvents !== "boolean")
      throw Error("protectFromEvents must be a boolean");
    d.protectFromEvents = body.protectFromEvents;
    if (d.protectFromEvents && d.pendingEvent && !d.exitDispatched) {
      d.phase = d.interruptedPhase || "active";
      d.commands = d.interruptedCommands || {};
      delete d.pendingEvent;
    }
  }
  function perform(body: Record<string, unknown>, id: string) {
    const d = state();
    if (d.phase !== "active" || body.run !== d.run || !d.participants.every(fresh))
      throw Error("Fresh matching dungeon run required");
    const cave = observation(d.participants[0])?.cave;
    if (!cave) throw Error("Dungeon state unavailable");
    ensureSettled(d);
    if (body.action === "revival") return revival(id);
    if (body.action === "move") return move(body, id, cave);
    if (body.action === 'waypoint') return waypoint(body,id,cave.paused);
    return choose(body, id, cave);
  }
  function waypoint(body: Record<string, unknown>, id: string, paused: boolean) {
    if (paused) throw Error('Answer the current encounter before setting a waypoint.');
    if (typeof body.map !== 'string' || body.map !== party.statuses[state().participants[0]]?.map) throw Error('Waypoint is on a different floor.');
    if (typeof body.x !== 'number' || typeof body.y !== 'number' || !Number.isFinite(body.x) || !Number.isFinite(body.y)) throw Error('Choose a point on the map.');
    progress.set(false);
    travel.start({id:'waypoint:'+id,label:'Waypoint',map:body.map,x:body.x,y:body.y});
  }
  function revival(id: string) {
    const d = state(),
      fallen = d.participants.find((n) => observation(n)?.alive === false);
    if (!fallen) throw Error("No fallen participant");
    const choice = observation(fallen)?.cave?.choice;
    if (choice && !choice.resolved) throw Error("Resolve the current vote before calling Nera");
    priestRecovery.manual(d);
    issue([fallen], "revival", id, { run: d.run, choice: choice?.id });
  }
  function ensureSettled(d: DungeonState) {
    for (const [name, command] of Object.entries(d.commands)) {
      if (["move", "gather"].includes(command.action)) continue;
      // Native resolution proves the vote is over even while its request
      // receipt is catching up. Reversible travel may begin after that vote.
      if (voteResolved(name, command)) continue;
      const receipt = observation(name)?.action;
      if (receipt?.id !== command.id || receipt.status !== "complete")
        throw Error("Previous dungeon action needs reconciliation; exit remains available");
    }
  }
  function voteResolved(name: string, command: CaveCommand) {
    const choice = observation(name)?.cave?.choice;
    return command.action === 'vote' && !!choice && choice.id === command.choice && choice.resolved;
  }
  function move(
    body: Record<string, unknown>,
    id: string,
    cave: NonNullable<import("../../dungeons/contracts.ts").CaveObservation["cave"]>,
  ) {
    const d = state();
    const target = cave.points.find((p) => p.id === body.target);
    if (!target || target.locked || target.done || cave.paused)
      throw Error("Destination unavailable");
    if (target.exit) return exit(id);
    if (target.map !== party.statuses[d.participants[0]]?.map)
      throw Error('Waypoint is on a different floor. Use the stairs to reach that floor first.');
    progress.set(false);
    d.progress!.target = target.id;
    d.progress!.message = "Travelling to " + target.label;
    d.error = undefined;
    if (target.down) d.stairContinuation = target;
    else delete d.stairContinuation;
    travel.start(target);
  }
  function choose(
    body: Record<string, unknown>,
    id: string,
    cave: NonNullable<import("../../dungeons/contracts.ts").CaveObservation["cave"]>,
  ) {
    const d = state(),
      choice = cave.choice;
    if (!choice || choice.id !== body.choice) throw Error("Choice is no longer current");
    if (body.action === "vote") {
      const option = choice.options.find((o) => o.id === body.option);
      if (choice.resolved || choice.deadline <= ports.now() || !option || option.unavailable)
        throw Error("Reply unavailable");
      confirmCost(option, body);
      issue(
        d.participants.filter((n) => !choice.votes[n]),
        "vote",
        id,
        {
          run: d.run,
          choice: choice.id,
          option: option.id,
          cost: option.cost || 0,
          amber: option.amber || 0,
        },
      );
      return;
    }
    return buy(body, id, cave, choice);
  }
  function confirmCost(option: { cost?: number; amber?: number }, body: Record<string, unknown>) {
    if ((option.cost || option.amber) && body.confirmed !== true)
      throw Error("Confirm the shared currency cost before voting");
    if (
      Number(body.cost || 0) !== (option.cost || 0) ||
      Number(body.amber || 0) !== (option.amber || 0)
    )
      throw Error("Choice cost changed; review it again");
  }
  function buy(
    body: Record<string, unknown>,
    id: string,
    cave: NonNullable<import("../../dungeons/contracts.ts").CaveObservation["cave"]>,
    choice: import("../../dungeons/contracts.ts").CaveChoice,
  ) {
    const d = state();
    if (
      body.action !== "buy" ||
      body.confirmed !== true ||
      !choice.resolved ||
      !choice.shop ||
      choice.shop.sold ||
      cave.gold < choice.shop.price
    )
      throw Error("Confirmed available purchase required");
    if (body.cost !== choice.shop.price) throw Error("Purchase price changed; review it again");
    const buyer = d.participants.find(
      (n) =>
        observation(n)?.cave?.choice?.id === choice.id &&
        observation(n)?.cave?.choice?.shop?.nearby,
    );
    if (!buyer) throw Error("No participant near the merchant");
    issue([buyer], "buy", id, {
      run: d.run,
      choice: choice.id,
      room: choice.shop.room,
      cost: choice.shop.price,
    });
  }
  function control(name: string) {
    reconcile();
    const d = state(),
      command = d.commands[name];
    if (command?.action === "exit" && !d.exitDispatched) {
      d.exitDispatched = true;
      ports.persist();
    }
    return {
      owned: dungeonOwns(party, name),
      command,
      route: caveRoute(d),
      ...(priestRecovery.control(d, name) ? { recovery: priestRecovery.control(d, name) } : {}),
      movementReady: d.participants.every(readyToMove) && formationReady(d,name),
    };
  }
  function caveRoute(d: DungeonState) {
    const leader = d.participants[0], sample = observation(leader)?.travel;
    return d.travel?.stage === 'travelling' && sample && sample.id === d.commands[leader]?.id ? sample.route : undefined;
  }
  function formationReady(d: DungeonState, name: string) {
    if (!d.travel || d.travel.stage === 'assembling') return true;
    const leader = party.statuses[d.participants[0]], actor = party.statuses[name];
    if (!leader || !actor) return false;
    const samples = d.participants.filter(n => observation(n)?.action?.id !== d.commands[n]?.id || observation(n)?.action?.status !== 'complete')
      .map(n => observation(n)?.travel?.id === d.commands[n]?.id && observation(n)?.travel?.prepared ? observation(n)!.travel!.distance : undefined);
    if (samples.some(s => s === undefined)) return false;
    const own = observation(name)?.travel?.distance || 0;
    // Distance along the walking route is monotonic, including bends. Euclidean
    // distance to the goal can reverse in corridors and deadlock the party.
    return !samples.length || own <= Math.min(...samples.map(s => s ?? 0))+100;
  }
  function readyToMove(name: string) {
    const o = observation(name);
    return fresh(name) && !!o?.alive && o.ready && !o.cave?.paused;
  }
  function install(router: HttpRouter) {
    router.get("/party-api/daily-dungeons", (_req, res) => res.json(snapshot()));
    router.post("/party-api/daily-dungeons", (req, res) => {
      try {
        action(requestObject(req.body));
        return res.json(snapshot());
      } catch (error) {
        return res
          .status(409)
          .json({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  }
  return { snapshot, reconcile, action, exit, eventAllowed, install, control, release };
}
