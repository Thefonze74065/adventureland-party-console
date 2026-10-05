/**
 * Auto mode tries boss tank engagement first (Franky, Halloween); after enough deaths while doing
 * so it falls back to the off-tank/support routine for good, mirroring how
 * Hunt's own deathThreshold auto-blacklists a monster (see hunt/settings.ts).
 * A deathLimit of 0 disables the tank attempt entirely (see encounter-mode.ts).
 */
export const defaultFrankyAutoTankDeathLimit = 3;

interface FrankyDeathReport {
  name: string;
  rip?: unknown;
  joinedEvent?: unknown;
  lastDeath?: unknown;
}
interface FrankyAutoTankProfile {
  encounterRoutines?: Record<string, string>;
  encounterAutoDeathLimits?: Record<string, number>;
  encounterAutoDeaths?: Record<string, number>;
  encounterAutoDeathsAt?: Record<string, number>;
}
interface FrankyAutoTankPorts {
  /** The effective (leader-resolved) profile that this character actually reads at runtime. */
  profile(name: string): FrankyAutoTankProfile;
  persist(): void;
}

/** Boss encounters whose auto mode tries tanking first (see encounter-mode.ts). */
export const autoTankEncounters = ["franky", "halloween"] as const;

function encounterDeathAt(report: FrankyDeathReport, encounter: string): number | null {
  const at = Number((report.lastDeath as { at?: unknown } | null | undefined)?.at);
  return report.rip && report.joinedEvent === encounter && Number.isFinite(at) ? at : null;
}
function stillAutoTanking(profile: FrankyAutoTankProfile, encounter: string): boolean {
  if ((profile.encounterRoutines?.[encounter] || "auto") !== "auto") return false;
  const limit = profile.encounterAutoDeathLimits?.[encounter] ?? defaultFrankyAutoTankDeathLimit;
  return limit > 0 && (profile.encounterAutoDeaths?.[encounter] || 0) < limit;
}

/**
 * A character's own death, not a teammate's, is what pushes auto mode away from tanking.
 * Each death counts against the boss encounter (Franky or Halloween) it happened in.
 */
export function recordFrankyAutoTankDeath(report: FrankyDeathReport, ports: FrankyAutoTankPorts): void {
  for (const encounter of autoTankEncounters) {
    const at = encounterDeathAt(report, encounter);
    if (at === null) continue;
    const profile = ports.profile(report.name);
    if (!stillAutoTanking(profile, encounter)) return;
    const countedAt = profile.encounterAutoDeathsAt?.[encounter] || 0;
    if (at <= countedAt) return;
    profile.encounterAutoDeathsAt = { ...profile.encounterAutoDeathsAt, [encounter]: at };
    profile.encounterAutoDeaths = { ...profile.encounterAutoDeaths, [encounter]: (profile.encounterAutoDeaths?.[encounter] || 0) + 1 };
    ports.persist();
    return;
  }
}
