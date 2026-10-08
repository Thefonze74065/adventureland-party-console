import type { CharacterBlock } from "./types.ts";

export interface RealmOperation {
  id: string;
  realm: string;
  participants: string[];
  startedAt: number;
  setHome?: boolean;
  phase: string;
  characters: { name: string; realm: string | null; arrived: boolean; homeConfirmed?: boolean }[];
  completedAt?: number | null;
  message?: string;
  error?: string | null;
  fromRealm?: string | null;
  homeRealm?: string | null;
  homeExecutors?: string[];
  homeTargets?: string[];
}
interface RealmStatus {
  seenAt: number;
  server?: string;
  ctype?: string;
  home?: string;
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
  start(name: string): unknown;
  characterHome(name: string): string | null;
  connectionCount(): number;
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
    if (native && "SR_" + ports.status(native)?.server !== operation.realm)
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

  function assignHomeExecutor(operation: RealmOperation): void {
    operation.homeExecutors = [...operation.participants];
    for (const executor of operation.homeExecutors) {
      const home = currentHome(executor, operation);
      if (home && "SR_" + home.replace(/^SR_/, "") === operation.realm) {
        const entry = operation.characters.find((character) => character.name === executor);
        if (entry) entry.homeConfirmed = true;
        continue;
      }
      ports.command(executor, {
      id: ports.nextCommand(),
      type: "realm-set-home",
      operationId: operation.id,
      realm: operation.realm,
      });
    }
  }

  async function waitHome(operation: RealmOperation, names: string[]): Promise<void> {
    const deadline = ports.now() + 120_000;
    while (ports.now() < deadline) {
      if (operation.phase === "failed") throw new Error(operation.error || "Home change failed");
      if (names.every((name) => operation.characters.some((entry) => entry.name === name && entry.homeConfirmed))) return;
      await ports.sleep(500);
    }
    throw new Error("Home realm confirmation timed out for " + names.join(", "));
  }

  function currentHome(name: string, operation: RealmOperation): string | null {
    const status = ports.status(name);
    const fresh = status && status.seenAt >= Math.max(operation.startedAt, ports.now() - 5000) &&
      "SR_" + String(status.server || "").replace(/^SR_/, "") === operation.realm;
    return fresh && status.home ? status.home : ports.characterHome(name);
  }

  async function withCleanup(work: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
    const errors: unknown[] = [];
    try { await work(); } catch (error) { errors.push(error); }
    try { await cleanup(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      const messages = errors.map((error) => error instanceof Error ? error.message : String(error));
      throw new AggregateError(errors, messages.join("; cleanup also failed: "));
    }
  }

  async function freshArrival(name: string, operation: RealmOperation, since: number, message: string): Promise<void> {
    const deadline = ports.now() + 60_000;
    const fresh = () => arrived(name, operation) && ports.status(name)!.seenAt >= since;
    while (!fresh() && ports.now() < deadline) await ports.sleep(500);
    if (!fresh()) throw new Error(message + name);
  }

  async function visitHome(name: string, operation: RealmOperation): Promise<void> {
    const block = ports.block(name);
    if (block.instance) throw new Error(name + " already has an unmanaged connection; refusing to replace it");
    const previous = { enabled: block.enabled, realm: block.realm };
    await withCleanup(async () => {
      block.enabled = true;
      block.realm = operation.realm;
      const loginStartedAt = ports.now();
      if (!ports.start(name)) throw new Error("Could not temporarily log in " + name);
      await freshArrival(name, operation, loginStartedAt, "Temporary login timed out for ");
      operation.characters.push({ name, realm: operation.realm, arrived: true });
      operation.homeExecutors!.push(name);
      ports.command(name, { id: ports.nextCommand(), type: "realm-set-home", operationId: operation.id, realm: operation.realm });
      await waitHome(operation, [name]);
    }, async () => {
      ports.clearCommand(name);
      block.enabled = false;
      await withCleanup(() => ports.stop(block), async () => {
        block.enabled = previous.enabled;
        block.realm = previous.realm;
        ports.persist();
      });
    });
  }

  function connectionToSuspend(operation: RealmOperation): string | undefined {
    if (ports.connectionCount() < 4) return undefined;
    const name = operation.participants.find((participant) => !ports.steamMembers().includes(participant));
    if (!name) throw new Error("A headless slot must be available to temporarily log in offline characters; existing Steam sessions were preserved");
    return name;
  }

  async function restoreConnection(name: string, block: CharacterBlock, enabled: boolean | undefined, operation: RealmOperation): Promise<void> {
    block.enabled = enabled;
    if (!enabled) return;
    const restoredAt = ports.now();
    if (!ports.start(name)) throw new Error("Could not restore " + name);
    await freshArrival(name, operation, restoredAt, "Reconnection timed out for ");
  }

  async function offlineHomes(operation: RealmOperation): Promise<void> {
    const offline = (operation.homeTargets || []).filter((name) => {
      const home = ports.characterHome(name);
      return !operation.participants.includes(name) && (!home || "SR_" + home.replace(/^SR_/, "") !== operation.realm);
    });
    if (!offline.length) return;
    // Free one headless connection while retaining its slot and configuration. No
    // Steam window is replaced, and temporary visitors are never assigned slots.
    const suspendedName = connectionToSuspend(operation);
    const suspended = suspendedName ? ports.block(suspendedName) : null;
    const enabled = suspended?.enabled;
    await withCleanup(async () => {
      if (suspended) { suspended.enabled = false; await ports.stop(suspended); }
      for (const name of offline) await visitHome(name, operation);
    }, async () => {
      await withCleanup(async () => {
        if (suspended && suspendedName) await restoreConnection(suspendedName, suspended, enabled, operation);
      }, async () => { ports.persist(); });
    });
  }

  async function finish(operation: RealmOperation): Promise<void> {
    ports.setActiveRealm(operation.realm);
    operation.phase = operation.setHome ? "setting-home" : "complete";
    operation.completedAt = operation.setHome ? null : ports.now();
    operation.message = operation.setHome
      ? "Party arrived; every participant is setting their home realm"
      : "Every active character arrived on " + ports.label(operation.realm);
    ports.persist();
    if (operation.setHome) {
      assignHomeExecutor(operation);
      await waitHome(operation, operation.participants);
      await offlineHomes(operation);
      operation.phase = "complete";
      operation.homeRealm = operation.realm;
      operation.completedAt = ports.now();
      operation.message = "Home realm changed for every character in the account";
      ports.persist();
    }
    ports.dispatchMerchant();
  }

  async function run(operation: RealmOperation): Promise<void> {
    try {
      await depart(operation);
      await awaitArrival(operation);
      await finish(operation);
    } catch (error) {
      operation.phase = "failed";
      operation.error = error instanceof Error ? error.message : String(error);
      operation.completedAt = ports.now();
      ports.persist();
      for (const name of operation.homeExecutors || []) ports.clearCommand(name);
    }
  }

  return { run };
}
/** Temporary home visitors retain exclusive command ownership until cleanup. */
export function realmOperationOwnsCharacter(operation: RealmOperation | null, name: string | null): boolean {
  return !!operation && !!name && ["switching", "setting-home"].includes(operation.phase) &&
    [...operation.participants, ...(operation.homeTargets || [])].includes(name);
}
