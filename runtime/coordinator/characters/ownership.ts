import type { RosterOwnership } from "../../roster/handoff.ts";
import type { RosterRoutesPorts } from "../../roster/routes.ts";
import { recordConnections } from '../../roster/connection-status.ts';

interface Status {
  server?: string;
  runtime?: string;
  seenAt?: number;
  banking?: unknown;
  stocking?: unknown;
  upgrading?: unknown;
  actualParty?: string | null;
}

interface OwnershipState {
  steamMembers: RosterOwnership["steam"];
  headlessSlots: RosterOwnership["slots"];
  nativeOwner: RosterOwnership["native"];
  steamSwitch: RosterOwnership["handoff"];
  statuses: Record<string, Status>;
  bankbois: Record<string, unknown>;
  bankboiTransaction: unknown;
  merchantCharacter: string | null;
  merchantCurrent: unknown;
  activeRealm?: string | null;
  leader: string | null;
  lifecycle: Record<string, string>;
}

interface Member {
  name: string;
  ctype?: string;
  online: boolean;
}
interface OwnershipPorts<Block> {
  now: () => number;
  id: () => string;
  save: () => void;
  owned: (name: string) => { online?: unknown; home?: string } | undefined;
  updateAccount: () => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<unknown>;
  stop: (block: Block, reason: string) => Promise<unknown>;
  assignSlot: (slot: number, name: string) => unknown;
  roster: () => Member[];
  configuredRealm: string;
  releaseBankboi?: (confirm: (name: string) => Promise<boolean>) => Promise<void>;
}

/** Accessors keep ownership changes attached to the coordinator's persisted state. */
export function coordinatorOwnership(state: OwnershipState): RosterOwnership {
  return {
    get steam() {
      return state.steamMembers;
    },
    set steam(value) {
      state.steamMembers = value;
    },
    get slots() {
      return state.headlessSlots;
    },
    set slots(value) {
      state.headlessSlots = value;
    },
    get native() {
      return state.nativeOwner;
    },
    set native(value) {
      state.nativeOwner = value;
    },
    get handoff() {
      return state.steamSwitch;
    },
    set handoff(value) {
      state.steamSwitch = value;
    },
  };
}

function inventoryBusy(status: Status | undefined): boolean {
  return !!(status?.banking || status?.stocking || status?.upgrading);
}

function groupLabel(
  group: string | null | undefined,
  primary: string | null | undefined,
  secondary: string | null | undefined,
): string {
  if (!group) return "ungrouped";
  if (group === primary) return "primary";
  return group === secondary ? "secondary" : "other";
}

function groupedRoster(
  state: OwnershipState,
  roster: () => Member[],
): ReturnType<RosterRoutesPorts["members"]> {
  const primary = state.statuses[String(state.leader)]?.actualParty;
  const groups = [
    ...new Set(
      Object.values(state.statuses)
        .map((status) => status.actualParty)
        .filter(Boolean),
    ),
  ].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  const secondary = groups.find((group) => group !== primary);
  return roster()
    .filter((member) => !state.bankbois[member.name])
    .map((member) => ({
      ...member,
      group: groupLabel(state.statuses[member.name]?.actualParty, primary, secondary),
    }));
}

/** Require two authoritative offline observations, with the original eight-attempt limit. */
async function confirmOffline<Block>(name: string, ports: OwnershipPorts<Block>): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await ports.updateAccount();
    if (!ports.owned(name)) throw new Error("Character is no longer in the account roster");
    if (!ports.owned(name)!.online) {
      await ports.sleep(500);
      await ports.updateAccount();
      if (!ports.owned(name)!.online) return true;
    }
    await ports.sleep(1000);
  }
  return false;
}

export function createCoordinatorOwnershipPorts<Block extends { enabled?: boolean }>(
  state: OwnershipState,
  workers: Record<string, Block>,
  ports: OwnershipPorts<Block>,
): RosterRoutesPorts {
  const ready = (name: string, runtime: string) =>
    state.statuses[name]?.runtime === runtime &&
    (state.statuses[name]?.seenAt ?? NaN) > ports.now() - 5000;
  const observedRealm = (name: string, since = 0) => {
    const status = state.statuses[name];
    return status?.server && (status.seenAt || 0) > Math.max(ports.now() - 5000, since)
      ? "SR_" + status.server.replace(/^SR_/, "") : null;
  };
  const busy = (name: string) =>
    !!(
      state.bankboiTransaction ||
      ((state.statuses[name]?.seenAt ?? 0) > ports.now() - 5000 && inventoryBusy(state.statuses[name])) ||
      ((state.statuses[name]?.seenAt ?? 0) > ports.now() - 5000 && name === state.merchantCharacter && state.merchantCurrent)
    );
  return {
    now: ports.now,
    id: ports.id,
    save: ports.save,
    owned: (name) => !!ports.owned(name) && !state.bankbois[name],
    bridgeReady: () => false,
    headlessReady: (name) => ready(name, "headless"),
    codeRunning: (name) => ready(name, "native"),
    characterBusy: busy,
    prepareSteam: async (name) => {
      if (name === state.merchantCharacter && state.bankboiTransaction && ports.releaseBankboi)
        await ports.releaseBankboi((worker) => confirmOffline(worker, ports));
    },
    nativeBusy: () => busy(String(state.nativeOwner)),
    realm: () => state.activeRealm || ports.configuredRealm,
    observedRealm,
    realmContext: () => {
      const primary = String(state.nativeOwner);
      const home = ports.owned(primary)?.home;
      return { current: observedRealm(primary), home: home ? "SR_" + home.replace(/^SR_/, "") : null };
    },
    bridgeChanged: () => {},
    observationsChanged: entries => recordConnections(state, entries, ports.now()),
    validateParticipants: (names) => {
      if (new Set(names).size !== names.length || names.length > 4)
        throw new Error("maximum characters logged in");
      if (state.bankboiTransaction) throw new Error("Wait for the bankboi transaction to finish");
      if (names.some(name => busy(name))) throw new Error("Wait for the character's active inventory operation to finish");
    },
    stopHeadless: async (name) => {
      const block = workers[name];
      if (!block) return;
      block.enabled = false;
      state.lifecycle[name] = "stopping";
      await ports.stop(block, "dashboard ownership transfer");
      state.lifecycle[name] = "offline";
    },
    startHeadless: (name, index) => ports.assignSlot(index + 1, name),
    confirmOffline: (name) => confirmOffline(name, ports),
    members: () => groupedRoster(state, ports.roster),
  };
}
