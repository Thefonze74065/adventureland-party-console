"use client";
import { RealmCharacter } from "./realm-character";
import { RealmOperation } from "./realm-operation";
import { RealmOption } from "./realm-option";

export type RealmControl = {
  activeRealm: string;
  currentRealm?: string | null;
  homeRealm?: string | null;
  homeCharacters?: { name: string; home: string | null }[];
  split: boolean;
  merchantRealm?: string | null;
  characters: RealmCharacter[];
  realms: RealmOption[];
  operation?: RealmOperation | null;
};
