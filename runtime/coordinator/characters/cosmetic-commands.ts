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
type Report = NonNullable<State["statuses"][string]>["cosmetics"] & object;
type Built = { command: Record<string, unknown> } | { failure: ReturnType<typeof fail> };

/** One validator per command type, against the character's latest cosmetics report. */
const builders: Record<string, (report: Report, body: Record<string, unknown>) => Built> = {
  "cx-open-jar"(report, body) {
    const jar = report.jars.find((entry) => entry.inventorySlot === body.inventorySlot);
    if (!jar?.usable || !jar.data) return { failure: fail(400, "That inventory slot has no usable CX jar") };
    return { command: { inventorySlot: jar.inventorySlot, data: jar.data } };
  },
  "cx-wear"(report, body) {
    const owned = report.owned.find((entry) => entry.name === body.name);
    if (!owned || owned.kind !== "appearance" || !owned.slot || owned.slot !== body.slot)
      return { failure: fail(400, "Only an owned appearance cosmetic can be worn, in its own slot") };
    return { command: { slot: owned.slot, name: owned.name } };
  },
  "cx-emote"(report, body) {
    const owned = report.owned.find((entry) => entry.name === body.name);
    if (!owned || owned.kind !== "emote") return { failure: fail(400, "Only an owned emote can be used") };
    const target = body.target === undefined || body.target === null ? null : requestText(body.target);
    if (target !== null && (!target || target.length > 40)) return { failure: fail(400, "Invalid emote target") };
    return { command: { name: owned.name, target } };
  },
  "cx-remove"(report, body) {
    const slot = requestText(body.slot);
    if (slot === "skin" || !report.worn[slot]) return { failure: fail(400, "Nothing removable is worn in that slot") };
    return { command: { slot } };
  },
};

export function createCosmeticCommands(state: State, ports: Ports) {
  return function cosmetic(body: Record<string, unknown>): CommandOutcome {
    const type = requestText(body.type);
    const build = Object.hasOwn(builders, type) ? builders[type] : undefined;
    if (!build) return undefined;
    const name = requestText(body.character);
    if (state.commands[name]) return fail(409, "This character is busy with another command; try again shortly");
    const report = state.statuses[name]?.cosmetics;
    if (!report) return fail(409, "No cosmetics report from this character yet");
    const built = build(report, body);
    if ("failure" in built) return built.failure;
    state.commands[name] = { id: ports.nextCommand(), type, ...built.command };
    ports.log(name + ": " + type + " " + JSON.stringify(built.command), "info");
    ports.persist();
    return null;
  };
}
