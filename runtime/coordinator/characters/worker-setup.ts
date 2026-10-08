import type { CharacterBlock } from "./types.ts";

export type SetupWorker = CharacterBlock;
interface SetupState {
  activeRealm?: string;
  location?: { realm?: string } | null;
  headlessSlots: (string | null)[];
  lifecycle: Record<string, string | undefined>;
  realmSwitch?: { phase: string; realm: string; participants: string[]; homeTargets?: string[] } | null;
}
interface SetupPorts {
  configuredRealm: string;
  homeRealm(name: string): string | null;
  script(name: string): string;
  watch(name: string, worker: SetupWorker): void;
  persist(): void;
  start(name: string): void;
}

/** Normalize worker configuration before starting or assigning it to a headless slot. */
export function createWorkerSetup(
  workers: Record<string, SetupWorker | undefined>,
  state: SetupState,
  ports: SetupPorts,
) {
  function connectionRealm(name: string, block: SetupWorker): string | undefined {
    const switching = state.realmSwitch;
    if (switching && ["switching", "setting-home"].includes(switching.phase)) {
      if (switching.participants.includes(name) || switching.homeTargets?.includes(name)) return switching.realm;
    }
    if (block.instance) return block.realm;
    return ports.homeRealm(name) || ports.configuredRealm;
  }

  function ensure(name: string): SetupWorker {
    const block = workers[name] || (workers[name] = {});
    // Running workers retain explicit event/realm travel ownership. New and
    // restored connections use native home rather than a stale setup default.
    block.realm = connectionRealm(name, block);
    if (block.code_watcher) {
      block.code_watcher.close();
      block.code_watcher = null;
    }
    block.script = ports.script(name);
    block.version = block.version || 0;
    block.connected = !!block.connected;
    ports.watch(name, block);
    return block;
  }
  function assign(slot: number, name: string): void {
    state.headlessSlots[slot - 1] = name;
    ports.persist();
    const block = ensure(name);
    block.enabled = true;
    state.lifecycle[name] = block.connected ? "online" : "starting";
    if (!block.instance) ports.start(name);
  }
  return { ensure, assign };
}
