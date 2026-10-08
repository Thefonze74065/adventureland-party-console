/**
 * Buy-and-upgrade budget shared by the dashboard and the coordinator: the gold, base items and
 * scrolls that reach `target` on `quantity` items in 90% of cases.
 *
 * The chance per attempt follows the server's upgrade (node/server.js): grace number
 * min(L+1, min(3, personal/4.5) + igrace), with igrace +1/-1/-2 for item grades 0/1/2 (#73).
 * Server-wide grace (S.ugrace), offering grace and the random +1 bonus are not observable
 * here and are left out.
 *
 * Targets whose 3,000-run simulation fits ROLL_BUDGET are simulated as before. Harder targets
 * use an analytic estimate (expected cost per level, in the manner of Crowns3bc's upgrade cost
 * calculator) instead of simulating for minutes (#63). It ignores failstacked personal grace,
 * so it comes out slightly high: 1% to 8% above the simulation from +7 to +10.
 */
export interface UpgradeChoice {
  id: string;
  cost: number;
  upgradeable?: boolean;
  upgradeGrade?: number;
  upgradeChances?: number[];
  grades?: number[];
  scrollCosts?: number[];
}
export interface UpgradeEstimate {
  attempts: number;
  gold: number;
  scrolls: number[];
  /** True when the budget comes from the analytic estimate rather than the simulation. */
  approximate: boolean;
}

const RUNS = 3000;
const RUN_GUARD = 2_000_000;
/** About a second of simulation; +9 at quantity 1 needs about 37M rolls. */
const ROLL_BUDGET = 60_000_000;
const MIN_RUNS = 30;
const fallbackChances = [1, 0.9999999, 0.98, 0.95, 0.7, 0.6, 0.4, 0.25, 0.15, 0.07, 0.024, 0.14, 0.11];

/** The server's per-grade grace modifier (node/server_functions.js sprocess_game_data). */
export function igrace(grade: number): number {
  return [1, -1, -2][Math.max(0, Math.min(2, grade))]!;
}

/** Highest level the chance table can reach; the game's table stops at +12. */
export function maxUpgradeLevel(choice: Pick<UpgradeChoice, "upgradeChances">): number {
  const chances = choice.upgradeChances || fallbackChances;
  let level = 0;
  while (level + 1 < chances.length && (chances[level + 1] || 0) > 0) level++;
  return level;
}

function upgradeChance(base: number, level: number, personal: number, itemGrace: number): number {
  const count = Math.max(0, Math.min(level + 1, Math.min(3, personal / 4.5) + itemGrace));
  let grace = (base * count) / level + count / 1000;
  grace = Math.max(0, grace / 4.8 - 0.4 / (level - 0.999) ** 2);
  return Math.min(base + grace, Math.min(base + 0.24, base * 2));
}

function scrollGrade(level: number, grades: number[]): number {
  if (level >= (grades[2] ?? 11)) return 3;
  if (level >= (grades[1] ?? 10)) return 2;
  return level >= (grades[0] ?? 9) ? 1 : 0;
}

interface Policy {
  target: number;
  quantity: number;
  chances: number[];
  grades: number[];
  itemGrace: number;
  scrollCosts: number[];
  cost: number;
}

function seededRandom(key: string): () => number {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gold(policy: Policy, attempts: number, scrolls: number[]): number {
  return attempts * policy.cost + scrolls.reduce((sum, count, grade) => sum + count * (policy.scrollCosts[grade] || 0), 0);
}

/** Per level without failstacked grace: chance, and the share of attempts that reach it. */
function ladder(policy: Policy) {
  const steps: { chance: number; reach: number; scroll: number }[] = [];
  let reach = 1;
  for (let level = 1; level <= policy.target; level++) {
    const chance = upgradeChance(policy.chances[level] || 0, level, 0, policy.itemGrace);
    steps.push({ chance, reach, scroll: scrollGrade(level - 1, policy.grades) });
    reach *= chance;
  }
  return { steps, success: reach };
}

/** Rolls the 3,000-run simulation is expected to need, to decide before spending them. */
function expectedRolls(policy: Policy): number {
  const { steps, success } = ladder(policy);
  const perAttempt = steps.reduce((sum, step) => sum + step.reach, 0);
  return success > 0 ? (RUNS * policy.quantity * perAttempt) / success : Infinity;
}

/**
 * 90th percentile of the total attempts for `quantity` successes. For the small per-attempt
 * success chances that reach this path, the count is close to Gamma(quantity) / success; the
 * Wilson-Hilferty approximation gives its quantile (ln 10 at quantity 1).
 */
function analytic(policy: Policy): UpgradeEstimate {
  const { steps, success } = ladder(policy);
  const k = policy.quantity, z = 1.2816;
  const attempts = Math.ceil((k * (1 - 1 / (9 * k) + z * Math.sqrt(1 / (9 * k))) ** 3) / success);
  const scrolls = [0, 0, 0, 0];
  for (const step of steps) scrolls[step.scroll]! += step.reach * attempts;
  const rounded = scrolls.map(Math.ceil);
  return { attempts, gold: gold(policy, attempts, rounded), scrolls: rounded, approximate: true };
}

function failedGrace(personal: number[], level: number): void {
  personal[level - 1]! += 1;
  personal[level]! += 1;
  if (level >= 8 && level <= 15) {
    personal[level - 1]! += 1;
    personal[level - 2]! += 2;
    personal[level - 3]! += 2;
  }
}

interface Simulation {
  policy: Policy;
  random: () => number;
  rolls: number;
}

/** One attempt from +0: true on reaching the target, null once ROLL_BUDGET is spent. */
function upgradeOnce(sim: Simulation, personal: number[], scrolls: number[]): boolean | null {
  for (let level = 0; level < sim.policy.target; level++) {
    if (++sim.rolls > ROLL_BUDGET) return null;
    const next = level + 1;
    scrolls[scrollGrade(level, sim.policy.grades)]! += 1;
    if (sim.random() > upgradeChance(sim.policy.chances[next] || 0, next, personal[next] || 0, sim.policy.itemGrace)) {
      failedGrace(personal, next);
      return false;
    }
    personal[next] = 0;
  }
  return true;
}

/** One run until `quantity` successes (or the per-run guard); null when the budget cuts it off. */
function simulateRun(sim: Simulation): { attempts: number; gold: number; scrolls: number[] } | null {
  const personal = Array<number>(20).fill(0), scrolls = [0, 0, 0, 0];
  let attempts = 0, successes = 0;
  while (successes < sim.policy.quantity && attempts < RUN_GUARD) {
    attempts++;
    const result = upgradeOnce(sim, personal, scrolls);
    if (result === null) return null;
    if (result) successes++;
  }
  return { attempts, gold: gold(sim.policy, attempts, scrolls), scrolls };
}

/** The previous 3,000-run simulation, stopped at ROLL_BUDGET; the cut-off run is dropped. */
function simulate(policy: Policy, random: () => number): UpgradeEstimate | null {
  const sim: Simulation = { policy, random, rolls: 0 }, runs: { attempts: number; gold: number; scrolls: number[] }[] = [];
  for (let run = 0; run < RUNS; run++) {
    const result = simulateRun(sim);
    if (!result) break;
    runs.push(result);
  }
  if (runs.length < MIN_RUNS) return null;
  runs.sort((a, b) => a.gold - b.gold);
  return { ...runs[Math.min(runs.length - 1, Math.ceil(runs.length * 0.9) - 1)]!, approximate: false };
}

/**
 * Null when there is nothing to upgrade. Throws a RangeError for a target past the chance
 * table, which no number of attempts can reach.
 */
export function estimateUpgrade(
  choice: UpgradeChoice,
  quantity: number,
  target: number,
  defaultScrollCosts: number[],
): UpgradeEstimate | null {
  if (!target || !choice.upgradeable) return null;
  if (target > maxUpgradeLevel(choice)) throw new RangeError(`${choice.id} cannot be upgraded past +${maxUpgradeLevel(choice)}`);
  const policy: Policy = {
    target,
    quantity,
    chances: choice.upgradeChances || fallbackChances,
    grades: choice.grades || [9, 10, 11, 12],
    itemGrace: igrace(Math.max(0, Number(choice.upgradeGrade) || 0)),
    scrollCosts: choice.scrollCosts || defaultScrollCosts,
    cost: choice.cost,
  };
  if (expectedRolls(policy) > ROLL_BUDGET) return analytic(policy);
  return simulate(policy, seededRandom(`${choice.id}:${quantity}:${target}`)) || analytic(policy);
}
