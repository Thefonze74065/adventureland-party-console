/**
 * Canonical realm codes. Mirrors the suffix set runtime/coordinator/characters/roster-projection.ts's
 * coordinatorRealmLabel already assumes (I, II, III, IV, V, PVP per region) so the setup realm picker,
 * the account-connect validation, and the rest of the coordinator can't drift apart on what a valid
 * realm code looks like. Adding a region or suffix here updates all three at once.
 */
export const realmRegions = ["US", "EU", "ASIA"] as const;
export const realmSuffixes = ["I", "II", "III", "IV", "V", "PVP"] as const;
export const realmCodes: string[] = realmRegions.flatMap((region) =>
  realmSuffixes.map((suffix) => `SR_${region}${suffix}`),
);
export const realmPattern = new RegExp(`^SR_(${realmRegions.join("|")})(${realmSuffixes.join("|")})$`);
