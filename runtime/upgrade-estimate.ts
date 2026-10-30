// caracAL executes this module behind a contextified global proxy. Resolve
// unchanged Math intrinsics once rather than crossing it for every random roll.
const {max: mathMax, min: mathMin, floor: mathFloor, imul: mathImul, ceil: mathCeil} = Math;
/** Catalog subset; unobservable server/player-wide grace is deliberately omitted. */
export interface UpgradeChoice {
  id: string;
  cost: number;
  upgradeable?: boolean;
  upgradeGrade?: number;
  upgradeChances?: number[];
  grades?: number[];
  scrollCosts?: number[];
}
export type UpgradeEstimate =
  | {
      status: "available";
      attempts: number;
      gold: number;
      scrolls: number[];
      /** Only present when the line carried grace options. */
      offerings?: number;
      completed: number;
      rolls: number;
    }
  | { status: "unavailable"; completed: number; rolls: number };
const defaults = [
  [1, 0.9999999, 0.98, 0.95, 0.7, 0.6, 0.4, 0.25, 0.15, 0.07, 0.024, 0.14, 0.11],
  [1, 0.99998, 0.97, 0.94, 0.68, 0.58, 0.38, 0.24, 0.14, 0.066, 0.018, 0.13, 0.1],
  [1, 0.97, 0.94, 0.92, 0.64, 0.52, 0.32, 0.232, 0.13, 0.062, 0.015, 0.12, 0.09],
];
export function highestUpgradeLevel(choice: UpgradeChoice) {
  if (!choice.upgradeable) return 0;
  const chances =
    choice.upgradeChances ||
    defaults[mathMax(0, mathMin(2, mathFloor(choice.upgradeGrade || 0)))]!;
  let level = 0;
  while (level + 1 < chances.length && Number(chances[level + 1]) > 0) level++;
  return level;
}
export function upgradeEstimateKey(choice: UpgradeChoice, quantity: number, target: number, grace?: GraceOptions) {
  return JSON.stringify([
    choice.id,
    choice.cost,
    choice.upgradeable,
    choice.upgradeGrade,
    choice.upgradeChances,
    choice.grades,
    choice.scrollCosts,
    quantity,
    target,
    ...(grace ? [grace] : []),
  ]);
}
/** Starting grace and offering policy. Mirrors the server's grace terms (server.js upgrade handler);
 * omitted means the original grace-free model, with identical estimates and cache keys. */
export interface GraceOptions {
  /** Grace the item already carries; it is lost with the item on a failure. */
  itemGrace?: number;
  /** Account-wide offering grace; it survives failures and decays on success. */
  ograce?: number;
  /** Server-wide grace for every level, 0..18 (the server's +6 term saturates at 18). */
  serverGrace?: number;
  /** Offering grade minus item grade, indexed by the level being attempted; null/absent uses none. */
  offerings?: (number | null)[];
  /** Lowest scroll grade to spend, indexed by the level being attempted; null/absent uses the item's own grade. */
  scrollGrades?: (number | null)[];
}
export interface EstimateLine {
  choice: UpgradeChoice;
  quantity: number;
  target: number;
  grace?: GraceOptions;
}
const cache = new Map<string, UpgradeEstimate[]>();
let scheduler: Promise<unknown> = Promise.resolve();
/** Canonical ordering makes dashboard/server estimates independent of cart order.
 * Cache only complete batches; cancelled edits cannot poison later estimates. */
export function estimateUpgradeBatch(
  lines: EstimateLine[],
  signal?: AbortSignal,
  yieldToIO: () => Promise<void> = () => new Promise<void>((resolve) =>
    typeof setImmediate === "function" ? setImmediate(resolve) : setTimeout(resolve, 0)),
): Promise<UpgradeEstimate[]> {
  const sorted = lines
    .map((line, index) => ({
      line,
      index,
      key: upgradeEstimateKey(line.choice, line.quantity, line.target, line.grace),
    }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const key = JSON.stringify(sorted.map((entry) => entry.key));
  const task = scheduler.then(async () => {
    signal?.throwIfAborted();
    let results = cache.get(key);
    if (!results) {
      const budget = { remaining: 60_000_000, signal, yieldToIO };
      results = [];
      for (const entry of sorted) {
        signal?.throwIfAborted();
        results.push(
          await simulate(entry.line.choice, entry.line.quantity, entry.line.target, budget, entry.line.grace),
        );
      }
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, results);
    }
    const output: UpgradeEstimate[] = [];
    sorted.forEach((entry, index) => {
      output[entry.index] = results![index]!;
    });
    return output;
  });
  scheduler = task.catch(() => {});
  return task;
}
export function estimateUpgrade(
  choice: UpgradeChoice,
  quantity: number,
  target: number,
): Promise<UpgradeEstimate> {
  return estimateUpgradeBatch([{ choice, quantity, target }]).then((results) => results[0]!);
}
/** One deterministic 3000-run batch with a total budget of 60M random rolls.
 * Cut-off runs are discarded; fewer than 30 completions yield no estimate.
 * Cooperative yields keep both browser rendering and coordinator I/O alive. */
function trivialEstimate(choice: UpgradeChoice, quantity: number, target: number): UpgradeEstimate | null {
  if (!target || !choice.upgradeable)
    return { status: "available", attempts: quantity, gold: choice.cost * quantity, scrolls: [], completed: 3000, rolls: 0 };
  return target > highestUpgradeLevel(choice) ? { status: "unavailable", completed: 0, rolls: 0 } : null;
}
async function simulate(
  choice: UpgradeChoice,
  quantity: number,
  target: number,
  budget: { remaining: number; signal?: AbortSignal; yieldToIO(): Promise<void> },
  grace?: GraceOptions,
): Promise<UpgradeEstimate> {
  const trivial = trivialEstimate(choice, quantity, target);
  if (trivial) return trivial;
  const policy = simulationPolicy(choice, target, grace);
  let seed = 2166136261;
  for (const char of `${choice.id}:${quantity}:${target}${grace ? JSON.stringify(grace) : ''}`)
    seed = mathImul(seed ^ char.charCodeAt(0), 16777619);
  function random() {
    seed += 0x6d2b79f5;
    let value = seed;
    value = mathImul(value ^ (value >>> 15), value | 1);
    value ^= value + mathImul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  const runs: { attempts: number; gold: number; scrolls: number[]; offerings?: number }[] = [];
  const startBudget = budget.remaining;
  simulation: for (let run = 0; run < 3000; run++) {
    const grace = Array<number>(20).fill(0),
      scrolls = [0, 0, 0, 0],
      account = newAccount(policy);
    let attempts = 0,
      successes = 0;
    while (successes < quantity) {
      attempts++;
      account.itemGrace = startItemGrace(policy);
      const attempt = upgradeOne(policy, grace, scrolls, random, budget, account);
      const survived = attempt === null || typeof attempt === 'boolean' ? attempt : await attempt;
      if (survived === null) break simulation;
      if (survived) successes++;
    }
    runs.push(runSummary(policy, choice.cost, attempts, scrolls, account));
  }
  return percentile90(runs, startBudget - budget.remaining);
}
function percentile90(runs: { gold: number }[], rolls: number): UpgradeEstimate {
  if (runs.length < 30) return { status: "unavailable", completed: runs.length, rolls };
  runs.sort((a, b) => a.gold - b.gold);
  return {
    status: "available",
    ...(runs[mathCeil(runs.length * 0.9) - 1]! as {attempts: number; gold: number; scrolls: number[]; offerings?: number}),
    completed: runs.length,
    rolls,
  };
}
function runSummary(policy: ReturnType<typeof simulationPolicy>, cost: number, attempts: number, scrolls: number[], account: Account) {
  return {
    ...(policy.extra ? { offerings: account.offerings } : {}),
    attempts,
    gold: attempts * cost + scrolls.reduce((sum, count, grade) => sum + count * (policy.costs[grade] || 0), 0),
    scrolls,
  };
}
function simulationPolicy(choice: UpgradeChoice, target: number, extra?: GraceOptions) {
  const grade = mathMax(0, mathMin(2, mathFloor(choice.upgradeGrade || 0)));
  const igrace = [1, -1, -2][grade]!, chances = choice.upgradeChances || defaults[grade]!;
  return {
    target,
    extra,
    base: chances,
    igrace,
    // Grace changes only in integer steps and its chance bonus saturates at 14.
    // Evaluate the original formula once for each reachable input, exactly.
    rollChances: Array.from({length:target+1}, (_, level) => level === 0 ? [] :
      Array.from({length:15}, (_, grace) => rollChance(chances[level] || 0, level, grace, igrace))),
    grades: choice.grades || [9, 10, 11, 12],
    costs: choice.scrollCosts || [1000, 40000, 1600000, 64000000],
  };
}
function scrollGrade(level: number, grades: number[]) {
  if (level >= (grades[2] ?? 11)) return 3;
  if (level >= (grades[1] ?? 10)) return 2;
  return level >= (grades[0] ?? 9) ? 1 : 0;
}
function rollChance(base: number, level: number, grace: number, igrace: number) {
  const count = mathMax(0, mathMin(level + 1, mathMin(3, grace / 4.5) + igrace));
  let bonus = (base * count) / level + count / 1000;
  bonus = mathMax(0, bonus / 4.8 - 0.4 / (level - 0.999) ** 2);
  return mathMin(base + bonus, mathMin(base + 0.24, base * 2));
}
/** The server's full attempt chance (no higher-tier scroll). `diff` is offering grade minus item grade. */
export function attemptChance(base: number, level: number, ugrace: number, igrace: number, extra: GraceOptions, diff: number | null, boosted = false) {
  const itemGrace = extra.itemGrace ?? 0, serverGrace = mathMin(6, (extra.serverGrace ?? 0) / 3);
  let total = mathMax(0, mathMin(level + 1, itemGrace + mathMin(3, ugrace / 4.5) + igrace) + serverGrace + (extra.ograce ?? 0) / 3.2);
  total = (base * total) / level + total / 1000;
  // A higher-grade scroll scales the base before any grace bonus and widens the cap.
  let chance = boosted ? base * 1.2 + 0.01 : base, high = boosted;
  if (diff === null) chance += mathMax(0, total / 4.8 - 0.4 / (level - 0.999) ** 2);
  else { chance = offeringChance(chance, total, diff); high ||= diff > 0; }
  return high ? mathMin(chance, mathMin(base + 0.36, base * 3)) : mathMin(chance, mathMin(base + 0.24, base * 2));
}
/** The server's multiplier for an offering, by its grade relative to the item's. */
function offeringChance(chance: number, total: number, diff: number) {
  if (diff > 1) return chance * 1.7 + total * 4;
  if (diff === 1) return chance * 1.5 + total * 1.2;
  if (diff === 0) return chance * 1.4 + total;
  return diff === -1 ? chance * 1.15 + total / 3.2 : chance * 1.08 + total / 4;
}
/** The server boosts a scroll of a higher grade than the item's while attempting up to +10. */
function boostedScroll(policy: ReturnType<typeof simulationPolicy>, level: number) {
  return level <= 10 && chosenScrollGrade(policy, level) > scrollGrade(level - 1, policy.grades);
}
function chosenScrollGrade(policy: ReturnType<typeof simulationPolicy>, level: number) {
  return mathMax(scrollGrade(level - 1, policy.grades), policy.extra?.scrollGrades?.[level] ?? 0);
}
function offeringGain(diff: number) {
  return diff > 1 ? 3 : diff === 1 ? 1 : diff === 0 ? 0.4 : diff === -1 ? 0.2 : 0.1;
}
function failedGrace(grace: number[], level: number, offering = false) {
  grace[level - 1]!++;
  grace[level]!++;
  if (level >= 8 && level <= 15) {
    grace[level - 1]!++;
    grace[level - 2]! += offering ? 3 : 2;
    grace[level - 3]! += offering ? 4 : 2;
  }
}
function startItemGrace(policy: ReturnType<typeof simulationPolicy>) { return policy.extra?.itemGrace ?? 0; }
function newAccount(policy: ReturnType<typeof simulationPolicy>): Account {
  return { ograce: policy.extra?.ograce ?? 0, itemGrace: startItemGrace(policy), offerings: 0 };
}
type Account = { ograce: number; itemGrace: number; offerings: number };
/** One roll at `level`: applies this attempt's grace effects and reports whether it succeeded. */
function rollLevel(policy: ReturnType<typeof simulationPolicy>, grace: number[], random: () => number, account: Account, level: number) {
  const graceCount = grace[level]!, extra = policy.extra;
  if (!extra) {
    const success = random() <= policy.rollChances[level]![graceCount >= 14 ? 14 : graceCount]!;
    if (success) grace[level] = 0; else failedGrace(grace, level);
    return success;
  }
  const diff = extra.offerings?.[level] ?? null, boosted = boostedScroll(policy, level);
  const chance = attemptChance(policy.base[level] || 0, level, graceCount, policy.igrace, { ...extra, itemGrace: account.itemGrace, ograce: account.ograce }, diff, boosted);
  if (boosted) account.itemGrace += 0.4;
  if (diff !== null) { account.offerings++; account.itemGrace += offeringGain(diff); }
  const success = random() <= chance;
  settleAccount(grace, account, level, diff, success);
  return success;
}
function settleAccount(grace: number[], account: Account, level: number, diff: number | null, success: boolean) {
  if (success) {
    grace[level] = 0;
    account.ograce *= diff !== null ? 0.25 : 1 - level * 0.005;
    return;
  }
  failedGrace(grace, level, diff !== null);
  if (diff !== null) account.ograce += 0.6;
}
function upgradeOne(
  policy: ReturnType<typeof simulationPolicy>,
  grace: number[],
  scrolls: number[],
  random: () => number,
  budget: { remaining: number; signal?: AbortSignal; yieldToIO(): Promise<void> },
  account: Account,
  level = 1,
  resumed = false,
): boolean | null | Promise<boolean | null> {
  for (; level <= policy.target; level++) {
    if (!budget.remaining) return null;
    if (!resumed && budget.remaining % 32768 === 0) {
      return budget.yieldToIO().then(() => {
        budget.signal?.throwIfAborted();
        return upgradeOne(policy, grace, scrolls, random, budget, account, level, true);
      });
    }
    resumed = false;
    budget.remaining--;
    scrolls[chosenScrollGrade(policy, level)]!++;
    if (!rollLevel(policy, grace, random, account, level)) return false;
  }
  return true;
}
