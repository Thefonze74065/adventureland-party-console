import {collectPassing} from '../../combat/passing.ts';
import {passingControl} from '../../combat/passing-admission.ts';
import {outboundHunt} from '../../combat/hunt-travel.ts';
import { merchantEventRecoveryReserved } from '../merchant/event-control.ts';
import type {Member} from '../../combat/grouped.ts';
import { monsterFocus, needsCatalog, partyResponse } from "./response-party.ts";
import {
  heartbeatStateFields,
  type HeartbeatResponsePorts,
  type HeartbeatState,
  type HeartbeatStatus,
} from "./response-types.ts";

const retainedCommands = new Set([
  "bank",
  "bankboi-service",
  "upgrade",
  "merchant-service",
  "merchant-handoff",
  "merchant-idle",
  "merchant-stand-sync",
  "merchant-npc-sale",
  "merchant-self-bank",
  "merchant-self-restock",
  "merchant-self-improve",
  "merchant-donate",
  "merchant-commerce",
  "merchant-exchange",
  "merchant-stand-search",
  "merchant-join-giveaway",
  "merchant-stand-buy",
  "merchant-ponty-buy",
  "merchant-aldata-buy",
  "merchant-aldata-auth",
  "merchant-order-handoff",
  "merchant-mluck",
  "apply-stat-scrolls",
  "equip-deliveries",
  "town-party",
  "event-return-town",
  "event-resume-travel",
  "party-monster-travel",
  "monster-hunt-interact",
  "realm-set-home",
]);
const navigationCommands = new Set([
  "travel",
  "force-travel",
  "character-travel",
  "party-monster-travel",
  "event-resume-travel",
  "return-leader",
]);

/** Long-running commands remain deliverable until their completion endpoint acknowledges them. */
export function createHeartbeatResponse(state: HeartbeatState, ports: HeartbeatResponsePorts) {
  function restoreTownCommand(name: string): void {
    const town = state.townCycle;
    if (town?.pending.includes(name) && !state.commands[name] && town.revisions?.[name] === ports.navigationRevision(name))
      state.commands[name] = {id: ports.now(), type:"town-party", cycleId:town.id};
  }
  function commandFor(name: string) {
    if (ports.escapeOwns(name) && state.escape?.stage !== "recovery-convoy") return null;
    restoreTownCommand(name);
    const command = state.commands[name] || null;
    attachLuckySlot(name, command);
    if (command && !retainedCommands.has(command.type)) delete state.commands[name];
    if (command && navigationCommands.has(command.type) && command.navigationRevision === undefined)
      command.navigationRevision = ports.navigationRevision(name);
    return command;
  }
  function attachLuckySlot(name: string, command: HeartbeatState['commands'][string] | null): void {
    if (!command || name !== state.merchantCharacter) return;
    const slots = state.luckyUpgradeSlots as Record<string, number | null> | undefined;
    command.luckyUpgradeSlot = slots?.[name] ?? null;
  }

  function liveEvent(name: string, names: string[]): string | null {
    const reporter = names
      .map((member) => state.statuses[member])
      .find(
        (status) =>
          status &&
          ports.enabled(status.name) &&
          Array.isArray(status.serverLiveEvents) &&
          status.serverLiveEvents.some((event) => ports.enabled(name, event.name)),
      );
    return (
      reporter?.serverLiveEvents?.find((event) => ports.enabled(name, event.name))?.name || null
    );
  }

  function leaderResponse(leader: HeartbeatStatus | null | undefined) {
    return {
      leaderTarget: (leader && leader.target) || null,
      leaderCombatSelection: leader?.combatSelection
        ? {
            ...leader.combatSelection,
            leader: state.leader,
            server: leader.server,
            seenAt: leader.seenAt,
          }
        : null,
      leaderLocation: leader ? { map: leader.map, x: leader.x, y: leader.y } : null,
    };
  }

  function returnResponse(name: string) {
    return {partyTownCycleId: state.townCycle?.id || null, returnProgress: state.returnProgress?.[name] || null};
  }
  function travelResponse(name: string) {
    return {
      partyLocation: ports.partyLocation(name),
      farmTravelPaused:
        name !== state.merchantCharacter &&
        (!!state.farmAreaState?.paused || !!state.rareHuntState?.patrol?.paused),
      navigationIntent: ports.navigationIntent(name),
      partyTownActive: name !== state.merchantCharacter && !!state.townCycle,
      ...returnResponse(name),
      partyConvoyActive: !!state.activeConvoy?.participants.includes(name),
      huntTurnInPriority: !ports.rareEncounter() && ports.huntTurnInOwnsTravel(),
      mapTelemetry: ports.mapSubscriberCount(name) > 0,
    };
  }

  function merchantResponse(name: string) {
    return {
      bankQueued:
        (state.bankCurrent && state.bankCurrent.name === name) ||
        state.bankQueue.some((job) => job.name === name),
      bankStackHomes: ports.bankStackHomes(),
      merchantGoldTarget: Math.max(
        0,
        Number(state.goldTargets[String(state.merchantCharacter)]) || 0,
      ),
      gatheringModes: state.bankbois[name] ? [] : state.gatheringModes,
    };
  }

  function farmingResponse(name: string) {
    return {
      monsterFocus: monsterFocus(state, name),
      huntCombatTarget: state.farmingPolicy === "hunt" && state.monsterHunt?.stage === "farming" ? state.monsterHunt.target : null,
      monsterPriorities: state.monsterPrioritiesByCharacter[name] || {},
      monsterSearchRadius:
        Number(state.monsterSearchRadiusByCharacter[state.leader || name]) || 400,
      partyFarmingMode:
        ports.rareOwns() ||
        (state.combatRecovery &&
          !["complete", "cancelled"].includes((state.combatRecovery as { phase: string }).phase))
          ? "default"
          : state.partyFarmingMode,
    };
  }

  function passingReports() {
    return collectPassing(ports.activeNames().map(name=>({name,ctype:'',revision:0,status:state.statuses[name]})) as Member[],[],ports.now());
  }
  function passingAdmission() {
    const convoy=state.activeConvoy;
    const names=outboundHunt(convoy) ? convoy!.participants : [...new Set([...ports.activeNames().filter(name=>name!==state.merchantCharacter),...(convoy?.participants||[])])];
    const members=names.map(name=>({name,ctype:'',revision:ports.navigationRevision(name),status:state.statuses[name]})) as Member[];
    return passingControl(members,convoy ? [convoy.id,convoy.epoch] : null,ports.now(),convoy,state.passiveHunting);
  }
  function response(name: string, mode?: "combat"): Record<string, unknown> {
    // Combat polls never deliver commands: do not consume or decorate them here.
    if (mode === "combat")
      return {
        serverNow: ports.now(),
        rareControl: ports.rareControl(name),
        groupedCombat: ports.groupedCombat(),
        passingEncounters: passingReports(),
        passingControl: passingAdmission(),
        convoySignal: ports.convoySignal(name),
        combatRecovery: state.combatRecovery,
        combatResetByCharacter: state.combatResetByCharacter,
        travelCombat: travelCombatFor(state as TravelState, name),
      };
    const names = ports.activeNames();
    const leader = (state.leader && state.statuses[state.leader]) || null;
    const travelCombat = travelCombatFor(state as TravelState, name);
    const command = commandFor(name);
    return {
      ...Object.fromEntries(heartbeatStateFields.map((field) => [field, state[field]])),
      serverNow: ports.now(),
      travelCombat,
      ...realmErrors(name),
      command,
      rareControl: ports.rareControl(name),
      escape: ports.escapeOwns(name) ? state.escape : null,
      eventTrip: state.huntEventTrips?.[name]?.at(-1) || null,
      convoySignal: ports.convoySignal(name),
      ...travelResponse(name),
      ...merchantResponse(name),
      ...(name === state.merchantCharacter ? { merchantEventRecoveryReserved: merchantEventRecoveryReserved(state) } : {}),
      ...partyResponse(state, names, leader),
      groupedCombat: ports.groupedCombat(),
        passingEncounters: passingReports(),
      passingControl: passingAdmission(),
      followLeader: !!state.followers[name],
      eventsEnabled: !!ports.enabled(name),
      eventSelections: ports.selectedEvents(name),
      partyEventHint: liveEvent(name, names),
      anniversary: ports.anniversary(),
      ...leaderResponse(leader),
      needsCatalog: needsCatalog(state),
      ...farmingResponse(name),
    };
  }
  function realmErrors(name: string): Record<string, unknown> {
    if (name !== state.merchantCharacter || !state.merchantQueue?.some(job => job.realmError)) return {};
    return { merchantRealmErrors: state.merchantQueue.filter(job => job.realmError).map(job => ({ id: job.id, message: job.realmError })) };
  }
  return { response };
}
import { travelCombatFor, type TravelState } from "../navigation/travel-defense.ts";
