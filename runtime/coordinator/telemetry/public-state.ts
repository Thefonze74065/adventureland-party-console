import { offeringStock } from '../inventory/offering-stock.ts';
import { characterConnections } from '../../roster/connection-status.ts';
import { gameLogs } from "./game-logs.ts";
import { requestText, type HttpRequest, type HttpResponse } from "../http/contracts.ts";
import { selectSnapshot } from "../persistence/snapshots.ts";
import {
  publicStateFields,
  type PublicState,
  type PublicStatePorts,
} from "./public-state-types.ts";
import {
  diagnosticCharacters,
  fastCharacters,
  inventoryCharacters,
  pendingCommands,
} from "./public-state-characters.ts";
import { giveawayDirectory } from "./giveaway-directory.ts";
import { randomUUID } from "node:crypto";
import { requestObject } from "../http/contracts.ts";

function catalogs(state: Readonly<PublicState>): Record<string, unknown> {
  return {
    travelPlaces: state.travelPlaces || [],
    monsterChoices: state.monsterChoices || [],
    bestiaryCatalog: state.bestiaryCatalog || [],
    skillCatalog: state.skillCatalog || [],
    appearanceChoices: state.appearanceChoices || {},
    merchantCatalog: state.merchantCatalog || {
      allItems: [],
      buyable: [],
      craftable: [],
      exchangeable: [],
    },
    bankVaults: state.bankVaults || [],
  };
}

function giveawayPayload(
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
): Record<string, unknown> {
  return {
    giveawayRealms: ports.servers().map((realm) => ({
      key: realm.key,
      label: String(realm.key || "")
        .replace(/^SR_/, "")
        .replace(/^(US|EU|ASIA)(.+)$/, "$1 $2"),
    })),
    giveawayPlayers: giveawayDirectory(state, ports),
  };
}

/**
 * Configuration, rules and marks the dashboard rarely needs fresher than a few
 * seconds old — as opposed to 'core', which is live operational state (active
 * convoy/combat/hunt/bank-job progress) polled roughly every second. Splitting
 * these out means the dashboard's slow-changing majority no longer forces a
 * full structural diff of the fast tier on every poll, and vice versa.
 *
 * Not to be confused with the persistence layer's own `settingsFields` /
 * `settingsSnapshot` in persistence/snapshots.ts, which decide what survives a
 * coordinator restart — a different axis (almost everything persists) from
 * what the dashboard needs to poll quickly.
 */
const configFields = [
  "characterAppearances", "gameVersion", "clientUpdate", "merchantRules",
  "bankboiPrefix", "anniversaryAutoChat", "farmingProfiles",
  "passiveRareHunts", "passiveHunting", "phoenixRouteOrder",
  "threshold", "itemCollectionThreshold",
  "marked", "merchantMarked", "autoItemMarks", "merchantDeliveries",
  "standListings", "npcSaleMarks", "deconstructionMarks", "autoDeconstruction",
  "deconstructionCatalog", "autoNpcSales", "autoStandMarks",
  "merchantRoutinePriorities", "merchantAutomations", "merchantBlacklist",
  "standBids", "nativeStand", "autoStandBuys", "autoBlacklistMerchants", "standSearch",
  "upgrades", "statScrolls", "compounds", "autoCompounds", "autoExchanges", "goldTargets",
  "leader", "followers", "eventsByCharacter", "eventSelectionsByCharacter",
  "monsterFocus", "monsterFocusByCharacter", "monsterPrioritiesByCharacter",
  "monsterSearchRadiusByCharacter", "scatterMonsterTypes",
  "partyFarmingMode", "partyFarmingMonsterType", "farmingPolicy",
  "huntBlacklist", "huntSettings", "huntFailures",
  "restockPolicies", "merchantCharacter", "merchantForceStand", "merchantWeapon",
] as const satisfies readonly (typeof publicStateFields)[number][];
/** Keys present only in the assembled dashboard payload, not publicStateFields. */
const configExtraKeys = [
  "roster", "activeSlots", "classChoices", "eventSchedules", "eventStrategy",
  "anniversary", "giveawayRealms", "giveawayPlayers", "autoUpgradeMarks",
] as const;
function configPayload(
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
): Record<string, unknown> {
  return {
    ...selectSnapshot(state, configFields),
    roster: ports.roster(),
    activeSlots: ports.slots(),
    classChoices: ports.classes,
    eventSchedules: ports.eventSchedules(),
    eventStrategy: state.abtestingStrategy,
    anniversary: ports.anniversary(),
    autoUpgradeMarks: state.autoUpgradeMarks,
    ...giveawayPayload(state, ports),
  };
}
/** 'core' carries only live operational state; config fields have their own section. */
function omitConfigFields<T extends Record<string, unknown>>(payload: T): T {
  for (const key of configFields) delete payload[key];
  for (const key of configExtraKeys) delete payload[key];
  return payload;
}

function fullPayload(
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
  omitCatalog: boolean,
  dashboardCore = false,
): Record<string, unknown> {
  const catalog = omitCatalog ? {} : catalogs(state);
  catalog.autoUpgradeMarks = state.autoUpgradeMarks;
  Object.assign(catalog, offeringPayload(state));
  const steamSwitch = ports.handoff(),
    aldata = ports.aldata();
  if (omitCatalog) {
    delete aldata.listings;
    delete aldata.trades;
    delete aldata.buyOrders;
  }
  Object.assign(catalog, giveawayPayload(state, ports));
  return {
    ...selectSnapshot(
      state,
      dashboardCore
        ? publicStateFields.filter(
            (field) => !["combatLogs", "merchantActivity", "standPriceHistory"].includes(field),
          )
        : publicStateFields,
    ),
    ...(dashboardCore ? {} : { characters: state.statuses }),
    roster: ports.roster(),
    activeSlots: ports.slots(),
    characterConnections: characterConnections(state, ports.now(), name =>
      state.statuses[name]?.runtime === 'native' && state.statuses[name].seenAt > ports.now() - 5000),
    classChoices: ports.classes,
    steamSwitch,
    partyLocation: state.location,
    eventSchedules: ports.eventSchedules(),
    eventStrategy: state.abtestingStrategy,
    anniversary: ports.anniversary(),
    merchantQueue: state.merchantQueue.map((job) => ports.job(job)),
    merchantCurrent: ports.job(state.merchantCurrent),
    mluckSchedule: ports.luckSchedule(),
    aldata,
    ...(dashboardCore ? {} : { bank: state.bankSnapshot, bankVaults: state.bankVaults || [] }),
    ...catalog,
    ...(dashboardCore ? {} : { ponty: state.ponty }),
    bankbois: dashboardCore ? bankboiSummaries(ports.bankbois()) : ports.bankbois(),
    bankboiQueue: state.bankboiQueue,
    bankboiTransaction: state.bankboiTransaction,
    bankboiCreateSingleFlight: true,
    realmControl: ports.realmControl(),
  };
}

function bankboiSummaries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    selectSnapshot(requestObject(entry), [
      "name",
      "ctype",
      "level",
      "state",
      "gold",
      "seenAt",
      "error",
      "transaction",
    ]),
  );
}
function accountId(state: Readonly<PublicState>) {
  const owner = Object.values(state.statuses).find(
    (status) => typeof status.owner === "string" || typeof status.owner === "number",
  )?.owner;
  return typeof owner === "string" || typeof owner === "number" ? String(owner) : null;
}
function dashboardCharacters(state: Readonly<PublicState>, ports: PublicStatePorts) {
  const slots = ports.slots();
  const names = new Set(
    Array.isArray(slots) ? slots.map((slot) => requestObject(slot).character) : [],
  );
  return Object.fromEntries(Object.entries(state.statuses).filter(([name]) => names.has(name)));
}

function fastPayload(state: Readonly<PublicState>, ports: PublicStatePorts) {
  return {
    characters: fastCharacters(state.statuses),
    partyFarmingMode: state.partyFarmingMode,
    partyFarmingMonsterType: state.partyFarmingMonsterType,
    activeConvoy: state.activeConvoy,
    partyLocation: state.location,
    realmControl: ports.realmControl(),
    pendingCommands: pendingCommands(state.commands),
  };
}

function corePayload(payload: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["characters", "combatLogs", "merchantActivity", "bank", "bankVaults"])
    delete payload[key];
  return omitConfigFields(payload);
}

/** Overview sections share one public projection and never expose private coordinator state. */
export function createPublicStateRoute(state: Readonly<PublicState>, ports: PublicStatePorts) {
  let revision = 0;
  const epoch = randomUUID();
  let previousCatalog = "";
  let previousReferences: unknown[] = [];
  function referenceRevision() {
    const references = [
      state.travelPlaces,
      state.monsterChoices,
      state.bestiaryCatalog,
      state.skillCatalog,
      state.appearanceChoices,
      state.merchantCatalog,
    ];
    if (
      references.every((value, index) => value === previousReferences[index]) &&
      previousReferences.length
    )
      return epoch + ":" + revision;
    previousReferences = references;
    const value = JSON.stringify(catalogs(state));
    if (value !== previousCatalog) {
      previousCatalog = value;
      revision++;
    }
    return epoch + ":" + revision;
  }
  return function publicState(request: HttpRequest, response: HttpResponse): unknown {
    const section = requestText(request.query?.section || "");
    const sections: Record<string, () => unknown> = {
      fast: () => fastPayload(state, ports),
      inventory: () => ({ characters: inventoryCharacters(state.statuses) }),
      logs: () => ({ gameLogs, combatLogs: state.combatLogs, merchantActivity: state.merchantActivity }),
      bank: () => ({
        bank: state.bankSnapshot,
        bankVaults: state.bankVaults || [],
        bankCurrent: state.bankCurrent,
        bankQueue: state.bankQueue,
        ...(request.query?.dashboard === "1" ? { bankbois: ports.bankbois() } : {}),
      }),
      market: () => ({
        aldata: ports.aldata(),
        ponty: state.ponty,
        standPriceHistory: state.standPriceHistory,
      }),
      catalog: () => ({ ...catalogs(state), referenceRevision: referenceRevision() }),
      config: () => configPayload(state, ports),
      core: () =>
        request.query?.dashboard !== "1"
          ? corePayload(fullPayload(state, ports, true))
          : omitConfigFields({
              ...fullPayload(state, ports, true, true),
              serverNow: ports.now(),
              accountId: accountId(state),
              bankGold: requestObject(state.bankSnapshot).gold ?? null,
              characterDetails: diagnosticCharacters(dashboardCharacters(state, ports)),
              characters: Object.fromEntries(
                Object.entries(dashboardCharacters(state, ports)).map(([name, status]) => [
                  name,
                  {
                    name,
                    ctype: status.ctype,
                    level: status.level,
                    server: status.server,
                  },
                ]),
              ),
              referenceRevision: referenceRevision(),
            }),
    };
    return response.json(
      Object.hasOwn(sections, section)
        ? sections[section]()
        : fullPayload(state, ports, request.query?.catalog === "0"),
    );
  };
}

function offeringPayload(state: Readonly<PublicState>) {
  return {upgradeOfferingRules:state.upgradeOfferingRules || [], upgradeOfferingStock:offeringStock(state)};
}
