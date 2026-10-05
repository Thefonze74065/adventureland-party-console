"use client";
import type { Entity } from 'typed-adventureland';
import type { LuckySlotTracking } from "../../../runtime/lucky-slot-tracking";
import { BestiaryMonster } from "./bestiary-monster";
import { Condition } from "./condition";
import { EquippedEntry } from "./equipped-entry";
import { InventoryEntry } from "./inventory-entry";
import { ItemMeta } from "./item-meta";
import { MonsterChoice } from "./monster-choice";
import { MonsterHuntStatus } from "./monster-hunt-status";
import { Place } from "./place";
import { PlayerStandListing } from "./player-stand-listing";
import { SkillClass } from "./skill-class";
import { Sprite } from "./sprite";

/** Reported by characters/shared.js cosmeticsSnapshot(). */
/**
 * `label` is the game's display name for emotes and the ID for appearance pieces;
 * `sprite` previews the cosmetic's layer or the emote's skill icon. Emote fields come
 * from the skill definition. Optional fields are absent from older reports.
 */
export type CosmeticKind = { kind: "appearance" | "emote" | "unknown" | "empty"; type: string | null; slot: string | null;
  label?: string | null; sprite?: Sprite | null; explanation?: string | null; mp?: number; cooldownMs?: number;
  range?: number | null; noSelf?: boolean; cooldownLeftMs?: number };
export type CosmeticsReport = {
  jars: (CosmeticKind & { inventorySlot: number; data: string | null; locked: boolean; usable: boolean })[];
  owned: (CosmeticKind & { name: string; count: number })[];
  worn: Record<string, string>;
  nearbyPlayers?: { name: string; distance: number }[];
  lastEmote?: { name: string; target: string | null; at: number; ok: boolean; reason: string | null } | null;
};
export type Char = {
  luckySlotTracking?: LuckySlotTracking;
  tracktrix?: { active: boolean; bonuses: Record<string, number> | null; sprite?: Sprite | null };
  lootStatus?: {at:number;map:string;eligible:number;pending:boolean;error?:string|null};
  combat?: {positioning?: {at?:number;mode?:string;reason?:string}};
  activeEvent?:string|null;
  joinedEvent?:string|null;
  standOpen?: boolean;
  /** A lucky-slot/production operation owns the merchant's inventory (live field). */
  upgradeInventoryBusy?: boolean;
  luckyRecoveryError?: { message?: string; at?: number } | null;
  name: string;
  owner?: string | number;
  ctype: string;
  server?: string | null;
  ping?: number | null;
  primaryStat?: string | null;
  level: number;
  attack?: number;
  frequency?: number;
  range?: number;
  speed?: number;
  unrestrictedSpeed?: number | null;
  armor?: number;
  resistance?: number;
  str?: number;
  int?: number;
  dex?: number;
  vit?: number;
  fortitude?: number;
  luck?: number;
  goldBonus?: number;
  xpBonus?: number;
  combatStats?: {
    heal?: number;
    output?: number;
    mpCost?: number;
    crit?: number;
    critDamage?: number;
    evasion?: number;
    miss?: number;
    lifesteal?: number;
    manasteal?: number;
    damageReturn?: number;
    reflection?: number;
    armorPiercing?: number;
    resistancePiercing?: number;
    poisonResistance?: number;
    fireResistance?: number;
    freezeResistance?: number;
    physicalResistance?: number;
    statusResistance?: number;
    blastResistance?: number;
  };
  xp: number;
  max_xp: number;
  hp: number;
  max_hp: number;
  mp: number;
  max_mp: number;
  gold: number;
  map: string;
  // Display telemetry includes nullable instance IDs when no instance is reported.
  in?: Entity['in'] | null;
  x: number;
  y: number;
  rip: boolean;
  banking: boolean;
  bankQueued?: boolean;
  stocking?: boolean;
  upgrading?: boolean;
  seenAt: number;
  inventorySize?: number;
  items: (InventoryEntry | null)[];
  slots: Record<string, EquippedEntry | null>;
  conditions?: Condition[];
  farmingMode?: string;
  monsterHunt?: MonsterHuntStatus | null;
  skin?: string;
  characterSprite?: Sprite | null;
  characterDollHtml?: string | null;
  cosmetics?: CosmeticsReport | null;
  donationXpPerGold?: number;
  gatheringCooldowns?: { fishing?: number; mining?: number };
  nearbyStandListings?: (PlayerStandListing & { meta?: ItemMeta | null })[];
  monsterAchievementKills?: Record<string, number> | null;
  monsterAchievements?: Record<string, { score: number; owner: string | null }> | null;
  travelPlaces?: Place[];
  monsterChoices?: MonsterChoice[];
  bestiaryCatalog?: BestiaryMonster[];
  skillCatalog?: SkillClass[];
  anniversaryVisit?: {
    ms?: number;
    expires?: number;
    round?: number | string;
  } | null;
  anniversaryState?: { busy?: boolean; stage?: string; round?: string | null };
};
