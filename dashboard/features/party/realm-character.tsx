"use client";

export type RealmCharacter = {
  name: string;
  ctype: string;
  realm: string | null;
  /** This character's own home realm; Adventure Land keeps a home per character. */
  home?: string | null;
  online: boolean;
};
