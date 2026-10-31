import {collectPassing} from '../../combat/passing.ts';
import {eventLimits} from '../../../dashboard/lib/event-policy.ts';
import {cipherIngredients, type CipherGatheringPlan, type CipherGatheringContext} from '../../events/october.ts';
import { bankStagingReserved } from '../inventory/reserved-cargo.ts';
import {passingControl} from '../../combat/passing-admission.ts';
import {requestObject} from '../http/contracts.ts';
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
  "merchant-production-recover",
  "merchant-donate",
  "merchant-commerce",
  "merchant-exchange",
  "merchant-stand-search",
  "merchant-join-giveaway",
  "merchant-stand-buy",
  "merchant-ponty-buy",
  "merchant-aldata-buy",
  "merchant-aldata-sell",
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
// Manual equipment can wait for a gathering handoff before the client accepts it.
// Keep the dispatch guard occupied through that wait, without replaying consumables.
const acceptanceRetainedCommands = new Set(["equip", "unequip"]);

/** Long-running commands remain deliverable until their completion endpoint acknowledges them. */
export function createHeartbeatResponse(state: HeartbeatState, ports: HeartbeatResponsePorts) {
  function reportedCipher(report: HeartbeatStatus | undefined) {
    return report?.eventSchedules?.find(entry=>entry.id==='witchcipher')?.cipher;
  }
  function sharesCipher(name: string, leader: string | null): boolean {
    return !!leader && ports.selectedEvents(leader).includes('witchcipher') &&
      (name===leader || !!state.followers[name] || name===state.merchantCharacter);
  }
  function cipherParticipants(owner: string, shared: boolean, realm: string | undefined): string[] {
    // Independent fighter scopes omit the merchant from activeNames; stock still includes it.
    const merchant=state.merchantCharacter;
    const members=ports.activeNames().filter(member=>shared && !!state.followers[member] && state.statuses[member]?.server===realm);
    return [...new Set([owner,...members,...(merchant && state.statuses[merchant]?.server===realm ? [merchant] : [])])];
  }
  function observedCipherStock(member: string, realm: string | undefined, round: string | undefined) {
    const report=state.statuses[member],cipher=reportedCipher(report);
    // Require current-round inventory in the same fresh observation.
    if(!round || cipher?.board?.id!==round || !report || !realm || report.server!==realm || ports.now()-Number(report.seenAt)>15000)return;
    return cipher.runtime?.stock;
  }
  function cipherStock(participants: string[], realm: string | undefined, round: string | undefined) {
    const stock=Object.fromEntries(cipherIngredients.map(id=>[id,0]));let ready=true;
    for(const member of participants){
      const observed=observedCipherStock(member,realm,round);
      if(!observed){ready=false;continue;}
      for(const id of cipherIngredients)stock[id]+=Math.max(0,Number(observed[id])||0);
    }
    return {stock,ready};
  }
  function merchantCipherRuntime(realm: string | undefined) {
    const merchant=state.statuses[state.merchantCharacter??''];
    return merchant && merchant.server===realm && ports.now()-Number(merchant.seenAt)<15000 ? reportedCipher(merchant)?.runtime : undefined;
  }
  function cipherPlan(owner: string, realm: string | undefined, ownerPlan: CipherGatheringPlan | undefined, shortage: CipherGatheringPlan | undefined) {
    return shortage?.reason==='recipe shortage' && shortage.owner===owner && shortage.realm===realm &&
      (!ownerPlan || shortage.round===ownerPlan.round && shortage.selectedAt>ownerPlan.selectedAt) ? shortage : ownerPlan;
  }
  function gatheringPlan(runtime: ReturnType<typeof merchantCipherRuntime>) {
    return runtime?.journal?.gathering;
  }
  function cipherGathering(name:string):CipherGatheringContext {
    const shared=sharesCipher(name,state.leader),owner=shared?state.leader!:name,report=state.statuses[owner],realm=report?.server;
    const cipher=reportedCipher(report),round=cipher?.board?.id;
    const {stock,ready}=cipherStock(cipherParticipants(owner,shared,realm),realm,round);
    const ownerPlan=gatheringPlan(cipher?.runtime),runtime=merchantCipherRuntime(realm);
    const plan=cipherPlan(owner,realm,ownerPlan,gatheringPlan(runtime));
    return {owner,round,ready,stock,plan,mixesLeft:runtime?.day?.mixes_left};
  }
  function retireTownMembership(name: string): boolean {
    const town = state.townCycle;
    if (!town?.pending.includes(name) || town.revisions?.[name] === ports.navigationRevision(name)) return false;
    town.pending = town.pending.filter(member => member !== name);
    const command = state.commands[name];
    if (command?.type === "town-party" && command.cycleId === town.id) delete state.commands[name];
    if (!town.pending.length) state.townCycle = null;
    return true;
  }
  function orphanedTownCommand(name: string): boolean {
    if (state.commands[name]?.type !== "town-party") return false;
    const town = state.townCycle;
    // Town admission updates its cycle and commands synchronously. A command
    // outside the canonical pending cycle is orphaned, never a newer admission.
    return !town || state.commands[name]?.cycleId !== town.id || !town.pending.includes(name);
  }
  function retireTownCommand(name: string): void {
    let changed = retireTownMembership(name);
    if (orphanedTownCommand(name)) {
      delete state.commands[name];
      changed = true;
    }
    if (changed) ports.persist?.();
  }
  function restoreTownCommand(name: string): void {
    const town = state.townCycle;
    if (town?.pending.includes(name) && !state.commands[name] && town.revisions?.[name] === ports.navigationRevision(name))
      state.commands[name] = {id: state.nextCommandId++, type:"town-party", cycleId:town.id};
  }
  function commandFor(name: string) {
    retireTownCommand(name);
    if (ports.escapeOwns(name) && state.escape?.stage !== "recovery-convoy") return null;
    restoreTownCommand(name);
    const command = state.commands[name] || null;
    if (retireAcceptedEquipment(name, command)) return null;
    attachLuckySlot(name, command);
    if (!retainCommand(command)) delete state.commands[name];
    if (command && navigationCommands.has(command.type) && command.navigationRevision === undefined)
      command.navigationRevision = ports.navigationRevision(name);
    return command;
  }
  function retainCommand(command: HeartbeatState['commands'][string] | null): boolean {
    return !command || retainedCommands.has(command.type) || acceptanceRetainedCommands.has(command.type);
  }
  function retireAcceptedEquipment(name: string, command: HeartbeatState['commands'][string] | null): boolean {
    if (!command || !acceptanceRetainedCommands.has(command.type) ||
        !(Number(state.statuses[name]?.lastCommandId) >= command.id)) return false;
    delete state.commands[name];
    return true;
  }
  function attachLuckySlot(name: string, command: HeartbeatState['commands'][string] | null): void {
    if (!command || name !== state.merchantCharacter) return;
    const slots = state.luckyUpgradeSlots as Record<string, number | null> | undefined;
    const locks = state.luckySlotLocks as Record<string, number | null> | undefined;
    const resume = state.luckySlotResume as Record<string, {slot: number}> | undefined;
    command.luckyUpgradeSlot = locks?.[name] ?? resume?.[name]?.slot ?? slots?.[name] ?? null;
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
      ports.selectedEvents(name).find(event => reporter?.serverLiveEvents?.some(live => live.name === event)) || null
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
    const deferred = requestObject(state.deferredEventReturns?.[name]);
    const cycleId = state.eventReturn?.participants.includes(name) ? state.eventReturn.cycleId : deferred.phase === "awaiting-event-admission" ? null : deferred.cycleId;
    return {partyTownCycleId: state.townCycle?.id || null, returnProgress: state.returnProgress?.[name] || null,
      eventReturnCycleId: typeof cycleId === 'string' ? cycleId : null};
  }
  function turnInPriority(name: string): boolean {
    return name !== state.merchantCharacter && !!state.monsterHunt?.participants?.includes(name) &&
      !ports.rareEncounter() && ports.huntTurnInOwnsTravel();
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
      huntTurnInPriority: turnInPriority(name),
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
      gatheringAutoCraft: {fishing: state.merchantAutomations?.['craft fishing tools'] === true,
        mining: state.merchantAutomations?.['craft mining tools'] === true},
      bankboiStorage: !!state.bankbois[name],
      bankStaging: bankStagingReserved(state),
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
        ...returnResponse(name),
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
      ...partyResponse(state, names, leader, state.statuses[name]?.server),
      groupedCombat: ports.groupedCombat(),
        passingEncounters: passingReports(),
      passingControl: passingAdmission(),
      followLeader: !!state.followers[name],
      eventsEnabled: !!ports.enabled(name),
      eventSelections: ports.selectedEvents(name),
      eventSettings: eventLimits(state, name),
      cipherMerchant: state.merchantCharacter,
      cipherGathering: cipherGathering(name),
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
