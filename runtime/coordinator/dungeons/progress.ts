import type { CaveCommand, CaveObservation, CavePoint, DungeonParty, DungeonState } from "../../dungeons/contracts.ts";
type Cave = NonNullable<CaveObservation["cave"]>;
interface Ports {
  fresh(name: string): boolean;
  issue(names: string[], action: CaveCommand["action"], id: string, extra: Partial<CaveCommand>): void;
  persist(): void;
  startTravel(target: CavePoint): void;
}
export function createCaveProgress(party: DungeonParty, ports: Ports) {
  const observation = (name: string) => party.statuses[name]?.dungeon;
  function settled(d: DungeonState) {
    return Object.entries(d.commands).every(([name, command]) => actionSettled(name,command));
  }
  function actionSettled(name: string, command: CaveCommand) {
    if (['move','gather'].includes(command.action)) return true;
    if (command.action === 'vote' && observation(name)?.cave?.choice?.resolved) return true;
    const receipt = observation(name)?.action;
    return receipt?.id === command.id && receipt.status === 'complete';
  }
  function available(d: DungeonState) {
    return d.participants.every(name => ports.fresh(name) && observation(name)?.alive &&
      observation(name)?.cave?.run === d.run && !observation(name)?.cave?.paused);
  }
  function choose(cave: Cave, previous?: string) {
    const down = cave.points.find(p => p.down && !p.exit);
    if (down && !down.locked) return down;
    const rooms = cave.points.filter(p => p.required && !p.done && !p.exit && p.map === 'zone_'+cave.run+'_'+cave.floor);
    const current = rooms.find(p => p.id === previous);
    if (current) return current;
    const leader = party.statuses[party.dailyDungeons!.participants[0]];
    return rooms.sort((a,b) => distance(a, leader) - distance(b, leader))[0];
  }
  function distance(p: CavePoint, status: DungeonParty["statuses"][string]) {
    return Math.hypot(p.x - (status?.x || 0), p.y - (status?.y || 0));
  }
  function arrived(d: DungeonState, target: CavePoint) {
    return d.participants.every(name => {
      const s = party.statuses[name], command = d.commands[name], receipt = observation(name)?.action;
      return s?.map === target.map && distance(target, s) <= 50 && command?.target?.id === target.id &&
        receipt?.id === command.id && receipt.status === "complete";
    });
  }
  function dispatch(d: DungeonState, target: CavePoint, action: "move" | "stairs") {
    if (action === 'move') { ports.startTravel(target); return; }
    const p = d.progress!;
    p.serial++;
    ports.issue(d.participants, action, "cave-progress:" + d.run + ":" + p.serial, {run:d.run, target});
    ports.persist();
  }
  function failed(d: DungeonState) {
    return d.participants.some(n => {
      const receipt = observation(n)?.action;
      return receipt?.id === d.commands[n]?.id && receipt?.status === "failed";
    });
  }
  function sameFloor(d: DungeonState, cave: Cave) {
    return d.participants.every(n => observation(n)?.cave?.floor === cave.floor);
  }
  function commandsNeedTravel(d: DungeonState) {
    const commands = Object.values(d.commands);
    return !commands.length || commands.some(c => c.action !== "move" && c.action !== "stairs");
  }
  function finishMessage(cave: Cave) {
    return cave.points.some(p => p.down) ? "Waiting for stairs to unlock" : "Floor complete; no further stairs. Exit remains manual.";
  }
  function route(d: DungeonState, cave: Cave, target: CavePoint) {
    const p = d.progress!;
    p.message = target.down ? "Moving to stairs down" : "Unlocking stairs: " + target.label;
    if (p.target !== target.id || p.floor !== cave.floor) {
      p.target = target.id; p.floor = cave.floor;
      dispatch(d, target, "move"); return;
    }
    const commands = Object.values(d.commands);
    if (commands.some(c => c.action === "stairs")) { p.message = "Waiting for the party to reach the next floor"; return; }
    if (failed(d)) { p.message = "Travel failed; use Retry failed preparation"; return; }
    if (commandsNeedTravel(d)) {
      dispatch(d, target, "move"); return;
    }
    if (!arrived(d, target)) return;
    if (target.down && d.participants.every(n => observation(n)?.ready)) dispatch(d, target, "stairs");
    else p.message = "Waiting for " + target.label + " to finish";
  }
  function encounterPause(d: DungeonState) {
    if (d.participants.some(n => observation(n)?.cave?.paused)) {
      const stairs = d.stairContinuation;
      if (d.progress!.enabled || d.travel || Object.values(d.commands).some(c => c.action === 'move')) set(false);
      d.stairContinuation = stairs;
      d.progress!.message = 'Answer the cave encounter, then choose your next destination';
      return true;
    }
    return false;
  }
  function initializeProgress(d: DungeonState) {
    d.progress ||= {enabled:false, serial:0, message:'Choose a destination to begin travelling'};
  }
  function tick(d: DungeonState) {
    if (d.phase !== "active") return;
    initializeProgress(d);
    if (encounterPause(d)) return;
    continueStairs(d);
    if (d.travel) { travelMessage(d); return; }
    automaticTick(d);
  }
  function travelMessage(d: DungeonState) {
    d.progress!.message = failed(d) ? 'Travel failed; use Retry failed preparation' :
      (d.travel!.stage === 'assembling' ? 'Grouping up before ' : 'Travelling together to ') + d.travel!.target.label;
  }
  function automaticTick(d: DungeonState) {
    if (!d.progress!.enabled) { manualStatus(d); return; }
    if (!available(d)) { d.progress!.message = "Waiting for party, revival, or a cave choice"; return; }
    if (!settled(d)) { d.progress!.message = "Waiting for dungeon action confirmation"; return; }
    const cave = observation(d.participants[0])?.cave;
    if (!cave || !sameFloor(d, cave)) return;
    const target = choose(cave, d.progress!.target);
    if (!target) {
      d.progress!.message = finishMessage(cave);
      return;
    }
    route(d, cave, target);
  }
  function continueStairs(d: DungeonState) {
    const stairs = d.stairContinuation;
    if (!stairs || d.travel) return;
    if (d.participants.every(n => observation(n)?.cave && party.statuses[n]?.map !== stairs.map)) {
      delete d.stairContinuation;
      d.commands = {};
      d.error = undefined;
      ports.persist();
      return;
    }
    if (Object.values(d.commands).some(c => c.action === 'stairs') || !available(d) || !settled(d)) return;
    const target = caveTarget(d);
    if (target) ports.startTravel(target);
    else delete d.stairContinuation;
  }
  function manualStatus(d: DungeonState) {
    if (d.travel?.stage === 'assembling') { d.progress!.message = 'Grouping up before travelling to ' + d.travel.target.label; return; }
    if (Object.values(d.commands).some(c => c.action === 'stairs')) { d.progress!.message = 'Descending stairs — waiting for the party on the next floor'; return; }
    const target = Object.values(d.commands).find(c => c.action === 'move')?.target;
    if (!target) { d.progress!.message = 'Travel stopped. Choose a destination or start automatic exploration.'; return; }
    if (failed(d)) { d.progress!.message = 'Travel failed; use Retry failed preparation'; return; }
    if (arrived(d, target)) { d.progress!.message = 'Arrived at ' + target.label; return; }
    d.progress!.message = available(d) && d.participants.every(n => observation(n)?.ready)
      ? 'Travelling to ' + target.label : 'Travelling to ' + target.label + ' — waiting for nearby combat, loot, or party readiness';
  }
  function set(enabled: boolean) {
    const d = party.dailyDungeons!;
    delete d.travel;
    delete d.stairContinuation;
    d.progress = {...d.progress, serial: d.progress?.serial || 0, enabled, target:undefined,
      message: enabled ? "Preparing automatic exploration" : "Travel stopped. Choose a destination."};
    if (!enabled) for (const [name, command] of Object.entries(d.commands))
      if (command.action === "move" || command.action === 'gather') delete d.commands[name];
    ports.persist();
  }
  function caveTarget(d: DungeonState) {
    return observation(d.participants[0])?.cave?.points.find(p => p.id === d.stairContinuation?.id && p.down && !p.locked);
  }
  return {tick, set};
}
