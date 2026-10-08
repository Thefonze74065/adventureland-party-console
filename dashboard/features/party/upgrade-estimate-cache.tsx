"use client";

export const upgradeEstimateCache = new Map<
  string,
  { attempts: number; gold: number; scrolls: number[]; approximate: boolean }
>();
