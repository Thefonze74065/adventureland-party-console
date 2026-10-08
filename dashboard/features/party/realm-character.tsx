"use client";

export type RealmCharacter = {
  name: string;
  ctype: string;
  realm: string | null;
  online: boolean;
  homeConfirmed?: boolean;
};
