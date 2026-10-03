import { requestText } from "../http/contracts.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";
import { resetLuckySlotTracking, type LuckySlotState } from "../status/lucky-slot-tracking.ts";

interface State extends LuckySlotState {
  commands: Record<string, { id?: number; type: string } | undefined>;
}
interface Ports {
  persist(): void;
  log(message: string, level: string, details?: unknown): void;
  nextCommand(): number;
}

/** Dashboard action for discarding lucky-slot discovery evidence/verified slot
 * a character inherited from a prior character that used the same name (#52).
 * A connected character independently tracks this evidence in its own browser
 * storage and replays it on every heartbeat, so clearing coordinator state
 * alone would be undone within one heartbeat; the character must also be told
 * to abandon its local stream. */
export function createResetLuckySlotTracking(state: State, ports: Ports) {
  return function reset(body: Record<string, unknown>): CommandOutcome {
    if (body.type !== "reset-lucky-slot-tracking") return undefined;
    const name = requestText(body.character);
    if (!resetLuckySlotTracking(state, name))
      return { status: 404, body: { error: "No lucky-slot data recorded for this character" } };
    state.commands[name] = { id: ports.nextCommand(), type: "reset-lucky-slot-tracking" };
    ports.log("Cleared lucky-slot tracking for " + name, "warning");
    ports.persist();
    return null;
  };
}
