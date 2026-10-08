import { createRealmSwitch } from "./realm-switch.ts";

type RealmPorts = Parameters<typeof createRealmSwitch>[0];
interface RealmState {
  commands: Record<string, Parameters<RealmPorts["command"]>[1] | { type: string } | undefined>;
  steamMembers: string[];
  nextCommandId: number;
  statuses: Record<string, ReturnType<RealmPorts["status"]>>;
  activeRealm: string | null;
  leader: string | null;
}
type CompositionPorts = Pick<
  RealmPorts,
  | "now"
  | "sleep"
  | "pauseMerchant"
  | "native"
  | "block"
  | "stop"
  | "persist"
  | "label"
  | "dispatchMerchant"
  | "start"
  | "characterHome"
  | "connectionCount"
>;

/** Realm transitions share command sequencing and always observe current coordinator state. */
export function createCoordinatorRealmSwitch(state: RealmState, ports: CompositionPorts) {
  return createRealmSwitch({
    now: () => ports.now(),
    sleep: (ms) => ports.sleep(ms),
    pauseMerchant: () => ports.pauseMerchant(),
    clearCommand: (name) => {
      delete state.commands[name];
    },
    native: () => ports.native(),
    steamMembers: () => state.steamMembers,
    block: (name) => ports.block(name),
    stop: (block) => ports.stop(block),
    nextCommand: () => state.nextCommandId++,
    command: (name, command) => {
      state.commands[name] = command;
    },
    persist: () => ports.persist(),
    status: (name) => state.statuses[name],
    setActiveRealm: (realm) => {
      state.activeRealm = realm;
    },
    label: (realm) => ports.label(realm),
    leader: () => state.leader,
    dispatchMerchant: () => ports.dispatchMerchant(),
    start: (name) => ports.start(name),
    characterHome: (name) => ports.characterHome(name),
    connectionCount: () => ports.connectionCount(),
  });
}
