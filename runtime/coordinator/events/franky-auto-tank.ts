/**
 * Auto mode tries Franky tank engagement first; after enough deaths while doing
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

function frankyDeathAt(report: FrankyDeathReport): number | null {
  const at = Number((report.lastDeath as { at?: unknown } | null | undefined)?.at);
  return report.rip && report.joinedEvent === "franky" && Number.isFinite(at) ? at : null;
}
function stillAutoTanking(profile: FrankyAutoTankProfile): boolean {
  if ((profile.encounterRoutines?.franky || "auto") !== "auto") return false;
  const limit = profile.encounterAutoDeathLimits?.franky ?? defaultFrankyAutoTankDeathLimit;
  return limit > 0 && (profile.encounterAutoDeaths?.franky || 0) < limit;
}

/** A character's own death, not a teammate's, is what pushes auto mode away from tanking. */
export function recordFrankyAutoTankDeath(report: FrankyDeathReport, ports: FrankyAutoTankPorts): void {
  const at = frankyDeathAt(report);
  if (at === null) return;
  const profile = ports.profile(report.name);
  if (!stillAutoTanking(profile)) return;
  const countedAt = profile.encounterAutoDeathsAt?.franky || 0;
  if (at <= countedAt) return;
  profile.encounterAutoDeathsAt = { ...profile.encounterAutoDeathsAt, franky: at };
  profile.encounterAutoDeaths = { ...profile.encounterAutoDeaths, franky: (profile.encounterAutoDeaths?.franky || 0) + 1 };
  ports.persist();
}
