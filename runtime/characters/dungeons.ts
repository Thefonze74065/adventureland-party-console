import "./cave-request.ts";
import {
  createDungeonJournal,
  type DungeonJournal,
  type DungeonReceipt,
} from "./dungeon-journal.ts";
import type { CaveObservation, CaveCommand, CavePoint, CaveRoute } from "../dungeons/contracts.ts";

// Partial official wire payloads, not complete game objects. See contracts.ts.
interface RawPoint {
  id?: string;
  kind?: string;
  map?: string;
  floor: number;
  x: number;
  y: number;
  name?: string;
  name_message?: unknown;
  locked?: boolean;
  done?: boolean;
  to?: string;
  down?: boolean;
  required?: boolean;
}
interface RawCave {
  run: string;
  floor: number;
  expires: number;
  server_time: number;
  remaining_ms: number;
  paused: boolean;
  gold: number;
  amber: number;
  doors?: RawPoint[];
  objectives?: RawPoint[];
  choice?: {
    id: string;
    title: string;
    text: string;
    title_message?: unknown;
    text_message?: unknown;
    deadline: number;
    resolved: boolean;
    result_label?: string;
    result_message?: unknown;
    summary?: string[];
    votes: Record<string, string>;
    options: {
      id: string;
      label: string;
      label_message?: unknown;
      unavailable?: string;
      unavailable_message?: unknown;
      cost?: number;
      amber?: number;
    }[];
    shop?: { room: string; name: string; price: number; sold: boolean; nearby: boolean };
  };
}
interface Visit {
  available: boolean;
  unlimited?: boolean;
  resets: number;
  server_time: number;
  home: string;
  resume?: { server: string; run?: string };
}
interface Ports {
  name: string;
  members(): string[];
  leader(): string | undefined;
  ready(): boolean;
  now(): number;
  alive(): boolean;
  current(): boolean;
  cave(): RawCave | null;
  supported(): boolean;
  info(): Promise<Visit>;
  request(action: string, fields?: Record<string, unknown>): Promise<unknown>;
  keeper(): { map: string; x: number; y: number } | undefined;
  text(value: unknown): string;
  move(point: CavePoint, command: CaveCommand): Promise<unknown>;
  travel?(): CaveObservation['travel'];
  stop(): Promise<unknown>;
  cruise?(speed: number): void;
  sharedRoute?(route:CaveRoute,command:CaveCommand):void;
  read(): DungeonJournal | DungeonReceipt | null;
  write(journal: DungeonJournal): void;
}
export function installDungeonRuntime(ports: Ports) {
  let visit: CaveObservation["visit"],
    checking = 0,
    checkId = 0,
    visitError: string | undefined,
    nextCheck = 0,
    owned = false;
  let command: CaveCommand | undefined;
  let activeId: string | undefined;
  let observedRun = ports.cave()?.run,
    visitRevision = 0;
  const journal = createDungeonJournal(ports.read, ports.write);
  let movementReady = false,
    controlAt = 0;
  let cruiseSpeed = 500;
  let stopping: Promise<unknown> = Promise.resolve();
  let serverTime = 0,
    serverOffset = 0;
  function caveText(message: unknown, fallback: string | undefined): string {
    const translated = ports.text(message || fallback);
    // Headless clients may lack phrase.message and stringify localization payloads.
    return typeof translated === "string" && translated !== "[object Object]"
      ? translated
      : fallback || "";
  }
  function normalized(): CaveObservation["cave"] {
    const c = ports.cave();
    if (!c) return null;
    if (c.server_time !== serverTime) {
      serverTime = c.server_time;
      serverOffset = c.server_time - ports.now();
    }
    const offset = serverOffset;
    const points = (items: RawPoint[], kind: string): CavePoint[] =>
      items.map((p, i) => ({
        id: c.run + ":" + c.floor + ":" + kind + ":" + i,
        room: kind === "room" ? p.id : undefined,
        kind: p.kind,
        label:
          kind === "door"
            ? p.to === "main"
              ? "Exit dungeon"
              : p.down
                ? "Stairs down"
                : "Stairs up"
            : caveText(p.name_message, p.name),
        map: p.map || "zone_" + c.run + "_" + p.floor,
        x: p.x,
        y: p.y,
        locked: p.locked,
        done: p.done,
        exit: p.to === "main",
        down: p.down,
        to: p.to,
        required: p.required,
      }));
    return {
      run: String(c.run),
      floor: c.floor,
      expires: c.expires - offset,
      remainingMs: c.remaining_ms,
      paused: !!c.paused,
      gold: c.gold,
      amber: c.amber,
      points: [...points(c.doors || [], "door"), ...points(c.objectives || [], "room")],
      choice: c.choice && {
        ...c.choice,
        id: String(c.choice.id),
        deadline: c.choice.deadline - offset,
        title: caveText(c.choice.title_message, c.choice.title),
        text: caveText(c.choice.text_message, c.choice.text),
        resultLabel: caveText(c.choice.result_message, c.choice.result_label),
        summary: c.choice.summary,
        options: c.choice.options.map((o) => ({
          id: String(o.id),
          label: caveText(o.label_message, o.label),
          unavailable: o.unavailable && caveText(o.unavailable_message, o.unavailable),
          cost: o.cost,
          amber: o.amber,
        })),
      },
    };
  }
  function canRefresh() {
    if (checking && ports.now() >= checking) {
      checking = 0;
      checkId++;
      visitError = "Daily eligibility request timed out; retrying";
      nextCheck = ports.now() + 5000;
    }
    return !checking && ports.supported() && ports.now() >= nextCheck;
  }
  function eligibilityError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String((error as { reason?: unknown })?.reason || error);
  }
  async function refresh() {
    if (!canRefresh()) return;
    checking = ports.now() + 12000;
    const id = ++checkId;
    const revision = visitRevision;
    nextCheck = ports.now() + 30000;
    try {
      const v = await ports.info();
      if (id !== checkId || !ports.current()) return;
      if (revision !== visitRevision) {
        nextCheck = 0;
        return;
      }
      visitError = undefined;
      visit = {
        available: !!(v.available || v.unlimited),
        resets: v.resets - (v.server_time - ports.now()),
        home: v.home,
        resume: v.resume,
        checkedAt: ports.now(),
      };
    } catch (error) {
      if (id !== checkId) return;
      visitError = eligibilityError(error);
      nextCheck = ports.now() + 5000;
    } finally {
      if (id === checkId) checking = 0;
    }
  }
  function report(): CaveObservation {
    const run = ports.cave()?.run;
    if (run !== observedRun) {
      observedRun = run;
      visit = undefined;
      visitRevision++;
      nextCheck = 0;
    }
    if (
      visit &&
      !visit.available &&
      visit.checkedAt < visit.resets &&
      ports.now() >= visit.resets &&
      nextCheck > ports.now()
    )
      nextCheck = 0;
    void refresh();
    return {
      protocol: 1,
      at: ports.now(),
      supported: ports.supported(),
      alive: ports.alive(),
      ready: ports.ready(),
      travel: ports.travel?.(),
      members: ports.members(),
      leader: ports.leader(),
      visit,
      visitError,
      cave: normalized(),
      keeper: ports.keeper(),
      action: journal.get(command?.id) || journal.latest(),
    };
  }
  function validate(c: CaveCommand) {
    if (!ports.current() || command?.id !== c.id) throw Error("Dungeon command superseded");
    const cave = normalized();
    if (c.action === "enter" && (!ports.ready() || cave)) throw Error("Entry readiness changed");
    if (c.action === "stairs") {
      const door = cave?.points.find(p => p.id === c.target?.id);
      if (!door?.down || door.locked || door.to !== c.target?.to || !canMove())
        throw Error("Stairs are not ready for the party");
    }
    if (c.action === "revival" && (!cave || ports.alive()))
      throw Error("No fallen dungeon participant");
    if (c.run && cave?.run !== c.run && (c.action !== "exit" || cave))
      throw Error("Dungeon run changed");
    if ((c.action === "vote" || c.action === "buy") && cave?.choice?.id !== c.choice)
      throw Error("Choice changed");
    if (c.action === "vote" && (cave!.choice!.resolved || cave!.choice!.votes[ports.name]))
      return false;
    if (c.action === "vote") {
      const option = cave?.choice?.options.find((o) => o.id === c.option);
      if (
        !option ||
        option.unavailable ||
        (option.cost || 0) !== c.cost ||
        (option.amber || 0) !== c.amber
      )
        throw Error("Vote terms changed");
    }
    if (
      c.action === "buy" &&
      (!cave!.choice!.shop?.nearby ||
        cave!.choice!.shop.price !== c.cost ||
        cave!.choice!.shop.sold ||
        cave!.gold < cave!.choice!.shop.price)
    )
      throw Error("Purchase unavailable");
    return true;
  }
  async function execute(c: CaveCommand) {
    if (activeId || journal.get(c.id)) return;
    activeId = c.id;
    let dispatched = false;
    try {
      await stopping;
      if (!validate(c)) {
        journal.save(c, "complete");
        return;
      }
      if (c.action === "exit" && !ports.cave()) {
        journal.save(c, "complete");
        return;
      }
      if (c.action !== "exit" && journal.blocked(c))
        throw Error("Previous dungeon action needs reconciliation");
      if (c.action === "move" || c.action === "gather") {
        if (!c.target || !ports.alive()) throw Error("Alive participant and destination required");
        await ports.move(c.target,c);
        validate(c);
        journal.save(c, "complete");
        return;
      }
      journal.save(c, "dispatched");
      dispatched = true;
      await ports.request(c.action, { choice: c.choice, option: c.option, room: c.room, to: c.target?.to });
      journal.save(c, "complete");
    } catch (error) {
      if (journal.get(c.id)?.status === "complete") return;
      const reason =
        error && typeof error === "object" && "reason" in error
          ? String(error.reason)
          : String(error);
      // A rejected transport promise does not prove that the server rejected the action.
      journal.save(c, dispatched ? "uncertain" : "failed", reason);
    } finally {
      if (activeId === c.id) activeId = undefined;
    }
  }
  function receive(control?: { owned: boolean; command?: CaveCommand; movementReady?: boolean; route?:CaveRoute }) {
    const nextOwned = !!control?.owned || !!ports.cave();
    if ((nextOwned && !owned) || (command?.id !== control?.command?.id && activeId))
      stopping = ports.stop();
    movementReady = !!control?.movementReady;
    controlAt = ports.now();
    owned = nextOwned;
    command = control?.command;
    if (control?.route && command) ports.sharedRoute?.(control.route,command);
    const nextCruise = command?.cruiseSpeed || 500;
    if (nextCruise !== cruiseSpeed) { cruiseSpeed = nextCruise; ports.cruise?.(nextCruise); }
    journal.reconcile(normalized(), ports.name, visit?.resume);
    if (journal.get(activeId)?.status === "complete") activeId = undefined;
    if (command)
      void execute(command).catch(() => {
        /* Storage failure must never dispatch an action. */
      });
  }
  const canMove = () =>
    !owned || ((movementReady || command?.action === "gather" && command.resume && !ports.cave()) &&
      ports.now() - controlAt < 3000 && ports.ready() && !ports.cave()?.paused);
  return {
    report,
    receive,
    canMove,
    owns: () => owned || !!ports.cave(),
    paused: () => !!ports.cave()?.paused,
  };
}
Object.assign(globalThis, { installDungeonRuntime });
