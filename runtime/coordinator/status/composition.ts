import { createStatusIngestion, type StatusReport } from "./ingestion.ts";
import {requestObject} from '../http/contracts.ts';
import {
  consumeStatusCatalogs,
  consumeBankVaults,
  consumeOneShotReports,
  type CatalogState,
} from "./catalogs.ts";
import { consumePontyReport } from "./ponty.ts";
import { consumeBankReport } from "./bank.ts";
import { observeScatter, type ScatterState, type ScatterStatus } from "./scatter.ts";
import type { createMerchantObservation } from "./merchant-observation.ts";
import type { AnniversaryBuffStatus } from "../anniversary/return-contracts.ts";

type Report = StatusReport &
  Record<string, unknown> &
  Parameters<typeof consumePontyReport>[0] &
  Parameters<typeof consumeBankReport>[0] &
  ScatterStatus &
  AnniversaryBuffStatus &
  Parameters<ReturnType<typeof createMerchantObservation>["observe"]>[0];
type ObservationState<R extends Report> = Parameters<typeof createStatusIngestion<R>>[0] &
  CatalogState &
  ScatterState & {
    leader: string | null;
    bankbois?: Record<string, unknown>;
    monsterHunt: unknown;
    aldata: { auth: unknown; publishedAt?: number };
  };
type ComposedConsumers =
  | "known"
  | "identifyMerchant"
  | "catalogs"
  | "ponty"
  | "bankVaults"
  | "bank"
  | "oneShots"
  | "huntSnapshot"
  | "scatter"
  | "publishMarket";
type ObservationPorts<R extends Report> = Omit<
  Parameters<typeof createStatusIngestion<R>>[1],
  ComposedConsumers
> & {
  acceptCatalogs?: (body: R) => boolean;
  farmingState?: (name: string) => ObservationState<R>;
  rareOwns?: (name: string) => boolean;
  owned: (name: string) => unknown;
  itemKey: Parameters<typeof consumePontyReport>[2];
  observePonty: (observation: NonNullable<ReturnType<typeof consumePontyReport>>) => void;
  bankState: Parameters<typeof consumeBankReport>[1];
  bankPorts: Parameters<typeof consumeBankReport>[2];
  activeNames: () => string[];
  publish: () => void;
};

function isOwnedMerchant(owned: unknown): boolean {
  return !!owned && typeof owned === "object" && "type" in owned && owned.type === "merchant";
}

/** Compose ordered heartbeat consumers while retaining live ownership, report and market state. */
export function createCoordinatorStatusIngestion<R extends Report>(
  state: ObservationState<R>,
  workers: Record<string, unknown>,
  ports: ObservationPorts<R>,
) {
  const farmingState = (name: string) => ports.farmingState?.(name) || state;
  function scatter(body: R, learned: string[]) {
    const scope = farmingState(body.name);
    const members = ports.activeNames().filter(name => name !== scope.merchantCharacter &&
      (name === scope.leader || (scope as ObservationState<R> & {followers?: Record<string, boolean>}).followers?.[name]));
    observeScatter(scope, members, scope.statuses, scope.statuses[String(scope.leader)] || scope.statuses[body.name], learned, ports.now(), ports.rareOwns?.(scope.leader || body.name));
  }
  return createStatusIngestion(state, {
    ...ports,
    known: (name) => Object.prototype.hasOwnProperty.call(workers, name) || !!ports.owned(name),
    characterId: (name) => {
      const owned = ports.owned(name);
      return owned && typeof owned === 'object' && 'id' in owned &&
        (typeof owned.id === 'string' || typeof owned.id === 'number') ? String(owned.id) : undefined;
    },
    identifyMerchant: (body) => {
      // The first connected, managed merchant owns logistics until explicitly changed.
      // Roster discovery alone must not pick an offline merchant or a storage worker.
      if (state.merchantCharacter || body.ctype !== "merchant" || state.bankbois?.[body.name] ||
          !state.headlessSlots.includes(body.name) && !state.steamMembers.includes(body.name)) return;
      if (!isOwnedMerchant(ports.owned(body.name))) return;
      state.merchantCharacter = body.name;
      ports.persist();
    },
    catalogs: (body) => { if (ports.acceptCatalogs?.(body) !== false) consumeStatusCatalogs(body, state); },
    ponty: (body) => {
      const observation = consumePontyReport(body, state.merchantCharacter, ports.itemKey);
      if (observation) ports.observePonty(observation);
    },
    bankVaults: (body) => { if (ports.acceptCatalogs?.(body) !== false) consumeBankVaults(body, state); },
    bank: (body) => consumeBankReport(body, ports.bankState, ports.bankPorts),
    oneShots: (body) =>
      consumeOneShotReports(body, { types: farmingState(body.name).scatterMonsterTypes, epoch: farmingState(body.name).scatterEpoch }),
    huntSnapshot: () => JSON.stringify({...requestObject(state.monsterHunt), message: undefined}),
    scatter,
    publishMarket: (name) => {
      if (
        name === state.merchantCharacter &&
        state.aldata.auth === "CORRECT" &&
        (!state.aldata.publishedAt || ports.now() - state.aldata.publishedAt > 3600000)
      )
        ports.publish();
    },
  });
}
