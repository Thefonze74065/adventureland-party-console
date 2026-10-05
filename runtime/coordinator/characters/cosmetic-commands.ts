import { requestText } from "../http/contracts.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";

/** One CX jar or owned cosmetic as the character reports it (characters/shared.js cosmeticsSnapshot). */
interface CosmeticEntry { kind: string; slot: string | null }
interface CosmeticsReport {
  jars: (CosmeticEntry & { inventorySlot: number; data: string | null; usable: boolean })[];
  owned: (CosmeticEntry & { name: string })[];
  worn: Record<string, string>;
}
interface State {
  commands: Record<string, { id?: number; type: string } | undefined>;
  statuses: Record<string, { cosmetics?: CosmeticsReport | null } | undefined>;
}
interface Ports {
  nextCommand(): number;
  persist(): void;
  log(message: string, level: string): void;
}

const fail = (status: number, error: string) => ({ status, body: { error } });

/**
 * Open a CX jar, wear an owned cosmetic, remove a worn one, or use an owned emote. Each is checked
 * against the character's latest report and re-checked by the character, which
 * runs it without taking over navigation or combat. A pending command is never
 * overwritten.
 */
export function createCosmeticCommands(state: State, ports: Ports) {
  return function cosmetic(body: Record<string, unknown>): CommandOutcome {
    const type = requestText(body.type);
    if (!["cx-open-jar", "cx-wear", "cx-remove", "cx-emote"].includes(type)) return undefined;
    const name = requestText(body.character);
    if (state.commands[name]) return fail(409, "This character is busy with another command; try again shortly");
    const report = state.statuses[name]?.cosmetics;
    if (!report) return fail(409, "No cosmetics report from this character yet");
    let command: Record<string, unknown>;
    if (type === "cx-open-jar") {
      const jar = report.jars.find((entry) => entry.inventorySlot === body.inventorySlot);
      if (!jar?.usable || !jar.data) return fail(400, "That inventory slot has no usable CX jar");
      command = { inventorySlot: jar.inventorySlot, data: jar.data };
    } else if (type === "cx-wear") {
      const owned = report.owned.find((entry) => entry.name === body.name);
      if (!owned || owned.kind !== "appearance" || !owned.slot || owned.slot !== body.slot)
        return fail(400, "Only an owned appearance cosmetic can be worn, in its own slot");
      command = { slot: owned.slot, name: owned.name };
    } else if (type === "cx-emote") {
      const owned = report.owned.find((entry) => entry.name === body.name);
      if (!owned || owned.kind !== "emote") return fail(400, "Only an owned emote can be used");
      const target = body.target === undefined || body.target === null ? null : requestText(body.target);
      if (target !== null && (!target || target.length > 40)) return fail(400, "Invalid emote target");
      command = { name: owned.name, target };
    } else {
      const slot = requestText(body.slot);
      if (slot === "skin" || !report.worn[slot]) return fail(400, "Nothing removable is worn in that slot");
      command = { slot };
    }
    state.commands[name] = { id: ports.nextCommand(), type, ...command };
    ports.log(name + ": " + type + " " + JSON.stringify(command), "info");
    ports.persist();
    return null;
  };
}
