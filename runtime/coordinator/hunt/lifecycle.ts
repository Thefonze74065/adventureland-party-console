import type { HuntCycle, HuntStatus, HuntTickState } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import { currentHuntParty } from "./current-party.ts";
import * as policy from "../../hunt/policy.ts";

interface HuntLifecycleState extends HuntTickState {
  monsterFocus?: string[];
  townCycle?: unknown;
}
interface HuntLifecyclePorts {
  now(): number;
  nextCommand(): number;
  participants(): string[];
  cancelConvoy(): void;
  clear(): void;
  prepare(hunt: HuntCycle): void;
  persist(): void;
  selectedDestination(name: string): { location: ReturnLocation } | null;
  authorize(names: string[], location: ReturnLocation, force: boolean): void;
  start(location: ReturnLocation, label: string, names: string[], purpose: string): boolean;
}

function readyToResume(status: HuntStatus | undefined, now: number): boolean {
  return (
    !!status &&
    !status.rip &&
    !(Number(status.hp) <= 0) &&
    now - status.seenAt <= 10000 &&
    !status.activeEvent &&
    !status.joinedEvent
  );
}

export function createHuntLifecycle(state: HuntLifecycleState, ports: HuntLifecyclePorts) {
  function fresh(hunt: HuntCycle): boolean {
    const waiting = hunt.participants.find((name) => {
      const status = state.statuses[name];
      return (
        !status ||
        ports.now() - status.seenAt > 10000 ||
        status.rip ||
        status.server !== state.statuses[String(state.leader)]?.server
      );
    });
    if (waiting) {
      hunt.message = "Waiting for fresh Hunt status from " + waiting;
      return false;
    }
    return true;
  }

  function fallbackDestination(hunt: HuntCycle): ReturnLocation | null | undefined {
    const focus = state.monsterFocus || [];
    const monsters = (hunt.returnLocation as (ReturnLocation & { monsterIds?: string[] }) | null)?.monsterIds;
    const compatible = !monsters?.length || monsters.some((id) => focus.includes(id));
    return (
      (compatible && hunt.returnFocus === JSON.stringify(focus) && hunt.returnLocation) ||
      ports.selectedDestination(state.leader!)?.location
    );
  }

  function backupDestination(hunt: HuntCycle): ReturnLocation | null | undefined {
    const destination = fallbackDestination(hunt);
    if (destination && destination !== hunt.returnLocation) {
      hunt.returnLocation = destination;
      hunt.returnFocus = JSON.stringify(state.monsterFocus || []);
      ports.persist();
    }
    return destination;
  }

  function finishFailed(hunt: HuntCycle): void {
    if (
      hunt.participants.some((name) => !readyToResume(state.statuses[name], ports.now())) ||
      state.eventReturn ||
      state.activeConvoy ||
      state.townCycle
    )
      return;
    const destination = fallbackDestination(hunt);
    if (destination) {
      ports.authorize(hunt.participants, destination, true);
      if (
        !ports.start(
          destination,
          "Normal farming after Hunt death limit",
          hunt.participants,
          "hunt-fallback",
        )
      )
        return;
    }
    hunt.stage = "ended";
    hunt.exitMode = null;
    hunt.message =
      "Hunt ended: " +
      (hunt.endReason || "two party deaths") +
      (destination ? "; returning to normal farming" : "; no normal farming destination selected");
    ports.persist();
  }

  function endBlacklisted(hunt: HuntCycle): void {
    ports.cancelConvoy();
    hunt.convoyId = null;
    hunt.target = null;
    hunt.exitMode = null;
    hunt.stage = "backup-travel";
    hunt.returnLocation = fallbackDestination(hunt) || hunt.returnLocation;
    hunt.backup = { startedAt: ports.now(), members: {} };
    hunt.policyVersion = 3;
    hunt.selectionLeader = state.leader!;
    delete hunt.loot;
    delete hunt.turnIn;
    delete hunt.endReason;
    hunt.waitForExpiry = false;
    hunt.message = "Backup farming: waiting for all blacklisted quests to expire";
    ports.persist();
  }

  function clearHuntCommands(hunt: HuntCycle): void {
    for (const name of hunt.participants)
      if (state.commands[name]?.purpose === "monster-hunt") delete state.commands[name];
  }

  function resume(hunt: HuntCycle): boolean {
    delete hunt.routeRecovery; // Explicit user retry grants a fresh destination budget.
    ports.cancelConvoy();
    hunt.convoyId = null;
    const pickupStages = ["assigning", "at-daisy", "daisy-sync-travel"];
    if (
      pickupStages.includes(hunt.stage) ||
      (hunt.stage === "paused-event" && pickupStages.includes(hunt.resumeStage || ""))
    )
      hunt.pickupPending = true;
    clearHuntCommands(hunt);
    hunt.stage = "checking-quests";
    if ((!hunt.loot || hunt.loot.complete) && !combatEventPending(hunt)) ports.prepare(hunt);
    ports.persist();
    return true;
  }

  function initialDeaths(names: string[]): HuntCycle["deathObservations"] {
    return Object.fromEntries(
      names.map((name) => [
        name,
        {
          at: Number(state.statuses[name]?.lastDeath?.at) || 0,
          dead: !!state.statuses[name]?.rip,
          countedAt: 0,
        },
      ]),
    );
  }

  function create(
    names: string[],
    returnPolicy: string | undefined,
    location: ReturnLocation | null | undefined,
  ): HuntCycle {
    return {
      version: 2,
      cycleId: "hunt-" + ports.now() + "-" + ports.nextCommand(),
      stage: "daisy-sync-travel",
      participants: names,
      missions: [],
      currentIndex: -1,
      target: null,
      startedAt: ports.now(),
      message: "Synchronizing at Daisy",
      returnPolicy: returnPolicy && returnPolicy !== "hunt" ? returnPolicy : "auto",
      returnLocation: location || null,
      returnFocus: JSON.stringify(state.monsterFocus || []),
      deathCount: 0,
      deathObservations: initialDeaths(names),
    };
  }

  function newCycle(
    returnPolicy: string | undefined,
    location: ReturnLocation | null | undefined,
  ): boolean {
    const recoverBatch =
      state.monsterHunt?.stage === "ended" &&
      state.monsterHunt.endReason === "no eligible quests remain (Hunt blacklist)";
    const current = currentHuntParty(state, ports.now());
    const names = [...new Set([state.leader, ...ports.participants(), ...current])]
      .filter((name): name is string => !!name && current.includes(name));
    if (!names.length) return false;
    const pendingLoot = unfinishedLoot(state.monsterHunt);
    ports.clear();
    const hunt = (state.monsterHunt = create(names, returnPolicy, location));
    if (pendingLoot) hunt.loot = pendingLoot;
    if (recoverBatch) hunt.batchPickup = true;
    hunt.stage = recoverBatch ? "batch-loot" : "checking-quests";
    if (!recoverBatch && !hunt.loot && !combatEventPending(hunt)) ports.prepare(hunt);
    ports.persist();
    return true;
  }

  function unfinishedLoot(hunt: HuntCycle | null | undefined): HuntCycle["loot"] {
    return hunt?.loot && !hunt.loot.complete ? hunt.loot : undefined;
  }

  function combatEventPending(hunt: HuntCycle): boolean {
    return !policy.priority(hunt) && hunt.participants.some(name =>
      state.statuses[name]?.activeEvent || state.statuses[name]?.joinedEvent);
  }

  function begin(
    returnPolicy?: string,
    location?: ReturnLocation | null,
    shouldResume?: boolean,
  ): boolean {
    if (state.farmAreaState) {
      state.farmAreaState.paused = false;
      state.farmAreaState.failures = {};
      state.farmAreaState.pending = null;
    }
    const hunt = state.monsterHunt;
    if (shouldResume && hunt && !hunt.exitMode && hunt.stage !== "ended") {
      if (location) {
        hunt.returnLocation = location;
        hunt.returnFocus = JSON.stringify(state.monsterFocus || []);
      }
      return resume(hunt);
    }
    return newCycle(returnPolicy, location);
  }
  return { fresh, finishFailed, endBlacklisted, begin, backupDestination };
}
