import type { HuntCycle } from "../hunt/contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import { priority as huntTurnInPriority } from "../../hunt/policy.ts";

interface RecoveryState {
  monsterHunt: HuntCycle | null;
  escape: { participants: string[] } | null;
  commands: Record<string, unknown>;
}
interface RecoveryPorts {
  huntParticipants: () => string[];
  members: () => string[];
  intent: (name: string) => { revision: number; cancelled?: boolean };
  cancelConvoy: () => void;
  convoy: (location: ReturnLocation, label: string, names?: string[], purpose?: string) => unknown;
  persist: () => void;
  prepareHunt: (hunt: HuntCycle) => unknown;
  escape: (names: string[]) => unknown;
  releaseEscape: () => void;
  abandonRare: () => void;
  resumeHunt: () => unknown;
  restartFailedHunt?: () => boolean;
}

/** Bind recovery transitions without capturing a stale Hunt, Escape participant list or command map. */
export function createCoordinatorRecoveryHooks(state: RecoveryState, ports: RecoveryPorts) {
  return {
    rare: {
      members: ports.huntParticipants,
      intent: ports.intent,
      turnIn: () => huntTurnInPriority(state.monsterHunt),
      cancelConvoy: ports.cancelConvoy,
      convoy: ports.convoy,
      persist: ports.persist,
      resumeHunt(hunt: HuntCycle, travel: boolean) {
        delete hunt.turnIn;
        hunt.stage = "checking-quests";
        hunt.target = null;
        hunt.currentIndex = -1;
        hunt.missions = [];
        hunt.pickupPending = false;
        hunt.waitForExpiry = false;
        if (travel) ports.prepareHunt(hunt);
      },
    },
    escape: {
      persist: ports.persist,
      cancel() {
        ports.cancelConvoy();
        for (const name of state.escape?.participants || []) delete state.commands[name];
      },
      convoy: (names: string[]) =>
        ports.convoy({ map: "main", x: 0, y: 0 }, "escape recovery", names, "escape-recovery"),
    },
    disengagement: {
      members: ports.members,
      intent: ports.intent,
      persist: ports.persist,
      escape: ports.escape,
      releaseEscape: ports.releaseEscape,
      abandonRare: ports.abandonRare,
      cancelCombatTravel: ports.cancelConvoy,
      returnToFarm: (location: ReturnLocation, names: string[]) =>
        ports.convoy(location, "Returning after party death", names, "death-recovery"),
      resumeHunt: ports.resumeHunt,
      restartFailedHunt: ports.restartFailedHunt,
    },
  };
}
