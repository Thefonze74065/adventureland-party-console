import { selectSnapshot } from "../persistence/snapshots.ts";
import type { PresentationEntry, PresentationStatus, PublicCommand } from "./public-state-types.ts";

export function diagnosticCharacters(statuses: Readonly<Record<string, PresentationStatus>>) {
  const allowed = new Set([
    "name",
    "recovery",
    "movement",
    "eventWalkFailure",
    "farmingNavigationDebug",
    "ctype",
    "server",
    "level",
    "seenAt",
    "ping",
    "owner",
    "skin",
    "characterSprite",
    "characterDollHtml",
    "primaryStat",
    "attack",
    "frequency",
    "range",
    "speed",
    "unrestrictedSpeed",
    "armor",
    "resistance",
    "str",
    "int",
    "dex",
    "vit",
    "fortitude",
    "luck",
    "goldBonus",
    "xpBonus",
    "combatStats",
    "banking",
    "bankQueued",
    "stocking",
    "upgrading",
    "standOpen",
    "farmingMode",
    "monsterHunt",
    "activeEvent",
    "joinedEvent",
    "donationXpPerGold",
    "gatheringCooldowns",
    "gatheringPhase",
    "gatheringBlockedReason",
    "gatheringAttemptId",
    "monsterAchievementKills",
    "monsterAchievements",
    "tracktrix",
    "cosmetics",
    "anniversaryVisit",
    "anniversaryState",
    "lootStatus",
  ]);
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        ...Object.fromEntries(Object.entries(status).filter(([key]) => allowed.has(key))),
        combat: {
          positioning: (status.combat as { positioning?: unknown } | undefined)?.positioning,
        },
      },
    ]),
  );
}

const omittedFastFields = new Set([
  "items",
  "slots",
  "bank",
  "realmPlayers",
  "nearbyStandListings",
  "nearbyGiveaways",
  "characterDollHtml",
]);
const metadataFields = [
  "definition",
  "upgradeable",
  "compoundable",
  "buyable",
  "properties",
  "scaling",
  "maxLevel",
  "sprite",
] as const;

export function fastCharacters(statuses: Readonly<Record<string, PresentationStatus>>) {
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      Object.fromEntries(
        Object.entries(status || {}).filter(([key]) => !omittedFastFields.has(key)),
      ),
    ]),
  );
}

export function compactEntry(entry: PresentationEntry | null): PresentationEntry | null {
  return !entry
    ? entry
    : { ...entry, meta: entry.meta ? selectSnapshot(entry.meta, metadataFields) : null };
}

export function inventoryCharacters(statuses: Readonly<Record<string, PresentationStatus>>) {
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        items: (status.items || []).map(compactEntry),
        slots: Object.fromEntries(
          Object.entries(status.slots || {}).map(([slot, entry]) => [slot, compactEntry(entry)]),
        ),
        characterDollHtml: status.characterDollHtml || null,
      },
    ]),
  );
}

export function pendingCommands(
  commands: Readonly<Record<string, PublicCommand | null | undefined>>,
) {
  return Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [
      name,
      command && {
        id: command.id,
        type: command.type,
        phase: command.phase || null,
        convoyId: command.convoyId || null,
      },
    ]),
  );
}
