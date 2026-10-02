import type { CharacterBlock } from "./types.ts";

export interface RealmOperation {
  id: string;
  realm: string;
  participants: string[];
  startedAt: number;
  setHome?: boolean;
  phase: string;
  characters: { name: string; realm: string | null; arrived: boolean }[];
  completedAt?: number | null;
  message?: string;
  error?: string | null;
  fromRealm?: string | null;
  homeRealm?: string | null;
  homeExecutor?: string;
  /** Home realm is per character in Adventure Land, so every connected participant visits Bean. */
  homeTargets?: string[];
  /** Targets that haven't reported their set_home result yet. */
  homePending?: string[];
  homeFailures?: Record<string, string>;
}
interface RealmStatus {
  seenAt: number;
  server?: string;
  ctype?: string;
}
interface RealmCommand {
  id: number;
  type: "native-realm-switch" | "realm-set-home";
  realm: string;
  operationId: string;
}
interface RealmPorts {
  now(): number;
  sleep(ms: number): Promise<void>;
  pauseMerchant(): void;
  clearCommand(name: string): void;
  native(): string | null;
  steamMembers(): readonly string[];
  block(name: string): CharacterBlock;
  stop(block: CharacterBlock): Promise<void>;
  nextCommand(): number;
  command(name: string, command: RealmCommand): void;
  persist(): void;
  status(name: string): RealmStatus | undefined;
  setActiveRealm(realm: string): void;
  label(realm: string): string;
  leader(): string | null;
  dispatchMerchant(): void;
  /** Schedules a one-off check (setTimeout in the coordinator). */
  timeout?(ms: number, callback: () => void): void;
}

/** Coordinates one requested realm transition without changing worker restart ownership. */
export function createRealmSwitch(ports: RealmPorts) {
  function arrived(name: string, operation: RealmOperation): boolean {
    const status = ports.status(name);
    return (
      !!status && status.seenAt >= operation.startedAt && "SR_" + status.server === operation.realm
    );
  }

  function observations(operation: RealmOperation): RealmOperation["characters"] {
    return operation.participants.map((name) => ({
      name,
      realm: ports.status(name)?.server ? "SR_" + ports.status(name)?.server : null,
      arrived: arrived(name, operation),
    }));
  }

  async function depart(operation: RealmOperation): Promise<void> {
    ports.pauseMerchant();
    operation.participants.forEach((name) => ports.clearCommand(name));
    const native = ports.native();
    const headless = operation.participants.filter((name) => !ports.steamMembers().includes(name));
    for (const name of headless) {
      const block = ports.block(name);
      block.realm = operation.realm;
      if (block.enabled) await ports.stop(block);
    }
    if (native)
      ports.command(native, {
        id: ports.nextCommand(),
        type: "native-realm-switch",
        realm: operation.realm,
        operationId: operation.id,
      });
    ports.persist();
  }

  async function awaitArrival(operation: RealmOperation): Promise<void> {
    const deadline = ports.now() + 60_000;
    while (ports.now() < deadline) {
      const allArrived = operation.participants.every((name) => arrived(name, operation));
      operation.characters = observations(operation);
      if (allArrived) break;
      await ports.sleep(500);
    }
    if (
      !operation.participants.every((name) =>
        operation.characters.some((entry) => entry.name === name && entry.arrived),
      )
    )
      throw new Error("Not every active character confirmed the destination within 60 seconds");
  }

  // A character that never reports back (deferred command, disconnect) must not hold the
  // realm switch in "setting-home" forever; that phase blocks every later switch.
  const homeTimeoutMs = 5 * 60_000;
  function assignHomeExecutors(operation: RealmOperation): void {
    const targets = operation.participants.filter((name) => !!ports.status(name));
    if (!targets.length) throw new Error("No connected character can visit Bean");
    operation.homeTargets = targets;
    operation.homePending = [...targets];
    operation.homeFailures = {};
    operation.homeExecutor = targets[0];
    for (const name of targets)
      ports.command(name, {
        id: ports.nextCommand(),
        type: "realm-set-home",
        operationId: operation.id,
        realm: operation.realm,
      });
    ports.timeout?.(homeTimeoutMs, () => {
      if (operation.phase !== "setting-home") return;
      operation.phase = "failed";
      operation.error = "No home realm confirmation from " + (operation.homePending || []).join(", ");
      operation.completedAt = ports.now();
      ports.persist();
    });
  }

  function finish(operation: RealmOperation): void {
    ports.setActiveRealm(operation.realm);
    operation.phase = operation.setHome ? "setting-home" : "complete";
    operation.completedAt = operation.setHome ? null : ports.now();
    operation.message = operation.setHome
      ? "Party arrived; every character is visiting Bean to set its home realm"
      : "Every active character arrived on " + ports.label(operation.realm);
    ports.persist();
    if (operation.setHome) assignHomeExecutors(operation);
    else ports.dispatchMerchant();
  }

  async function run(operation: RealmOperation): Promise<void> {
    try {
      await depart(operation);
      await awaitArrival(operation);
      finish(operation);
    } catch (error) {
      operation.phase = "failed";
      operation.error = error instanceof Error ? error.message : String(error);
      operation.completedAt = ports.now();
      ports.persist();
    }
  }

  return { run };
}
