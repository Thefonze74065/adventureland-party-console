export type GearItem = { name: string; level?: number; [key: string]: unknown };
/**
 * Equip-swappable slots this module will touch. mainhand/offhand are deliberately excluded:
 * they'd collide with porcupine-equipment's weapon swap and losing weapon damage/defense for a
 * loot-odds swap is a worse trade than skipping those two slots. "elixir" is excluded too — it's
 * a one-time consumable, not a restorable equip slot.
 */
export const LUCK_SWAP_SLOTS = [
  "chest", "pants", "helmet", "gloves", "shoes", "cape", "belt", "orb", "amulet",
  "ring1", "ring2", "earring1", "earring2",
] as const;
export type LuckSlot = (typeof LUCK_SWAP_SLOTS)[number];
/** Which G.items[name].type value is acceptable in each tracked slot. */
export const LUCK_SLOT_ITEM_TYPE: Record<LuckSlot, string> = {
  chest: "chest", pants: "pants", helmet: "helmet", gloves: "gloves", shoes: "shoes",
  cape: "cape", belt: "belt", orb: "orb", amulet: "amulet",
  ring1: "ring", ring2: "ring", earring1: "earring", earring2: "earring",
};
type Loadout = Partial<Record<LuckSlot, GearItem | null>>;
export interface LuckSwapSession {
  original: Loadout;
  expected: Loadout;
  plan: Partial<Record<LuckSlot, GearItem>>;
  restoring: boolean;
}
export interface LuckTarget {
  id: string;
  hp: number;
  dead?: unknown;
  rip?: unknown;
}
export interface LuckSwapMemory {
  session?: LuckSwapSession;
  pending?: Promise<void>;
  retryAt?: number;
  swappedInAt?: number;
  hpTrend?: { id: string; samples: { t: number; hp: number }[] };
}
export interface LuckSwapPorts {
  now(): number;
  isTank(): boolean;
  equipped(slot: LuckSlot): GearItem | null;
  items(): (GearItem | null)[];
  itemType(item: GearItem): string | undefined;
  luckValue(item: GearItem | null): number;
  fingerprint(item: GearItem | null): GearItem | null;
  same(a: GearItem | null, b: GearItem | null): boolean;
  equip(index: number, slot: LuckSlot): Promise<unknown>;
  lethalBasicAttack(target: LuckTarget): boolean;
  /**
   * True while this monster's own `.target` is this character's name. Ordinary (non-cooperative)
   * monster deaths roll their drop using only whoever the monster was attacking at that instant
   * (`issue_monster_award`'s `players[name_to_id[monster.target]]`, upstream `node/server.js`) —
   * not a per-contributor share, and not the party's other members at all. A luck swap only pays
   * off if this character actually holds that aggro when the kill lands.
   */
  holdsAggro(target: LuckTarget): boolean;
  endangered(): boolean;
  otherSwapBusy(): boolean;
  report(message: string): void;
}

/**
 * Swaps the designated tank into its highest-luck available gear right before a monster dies,
 * then restores combat gear once the kill is confirmed. Per upstream `node/server.js`'s
 * `issue_monster_award()`, an ordinary (non-cooperative) monster's drop is rolled using only
 * `players[name_to_id[monster.target]]` — whoever it was attacking at the instant it died — not
 * a per-contributor share, and not the rest of the party at all. So this only pays off while the
 * tank actually holds that monster's aggro (`holdsAggro`), with one exception: a lethal attack
 * from this character sets its own aggro as part of landing that same kill, so the one-shot path
 * doesn't need to already hold it. The trigger otherwise predicts "about to die" via an HP-trend
 * time-to-death estimate (scale- and source-agnostic, unlike a fixed HP percentage) plus that
 * one-shot fast path for trash mobs that die in a single hit with no gradual decline to observe.
 */
export function createKillLuckSwap(ports: LuckSwapPorts, memory: LuckSwapMemory = {}) {
  let active = true;
  const copyLoadout = (): Loadout => {
    const loadout: Loadout = {};
    for (const slot of LUCK_SWAP_SLOTS) loadout[slot] = ports.fingerprint(ports.equipped(slot));
    return loadout;
  };
  const matches = (loadout: Loadout) =>
    (Object.keys(loadout) as LuckSlot[]).every(slot => ports.same(ports.equipped(slot), loadout[slot] ?? null));
  function relinquish() { delete memory.session; }
  function owned(session: LuckSwapSession): boolean {
    if (!active || memory.session !== session) return false;
    if (matches(session.expected)) return true;
    relinquish();
    return false;
  }
  function find(item: GearItem): number {
    const index = ports.items().findIndex(candidate => ports.same(candidate, item));
    if (index < 0) throw new Error("Saved luck-swap item is missing from inventory: " + item.name);
    return index;
  }
  async function equipSlot(item: GearItem, slot: LuckSlot, session: LuckSwapSession): Promise<void> {
    if (!owned(session)) return;
    await ports.equip(find(item), slot);
    session.expected = { ...session.expected, [slot]: ports.fingerprint(item) };
    if (!ports.same(ports.equipped(slot), item)) throw new Error("Game did not equip " + item.name);
  }
  function planApplied(session: LuckSwapSession): boolean {
    return (Object.keys(session.plan) as LuckSlot[]).every(slot => ports.same(ports.equipped(slot), session.plan[slot]!));
  }
  async function swap(session: LuckSwapSession): Promise<void> {
    for (const slot of Object.keys(session.plan) as LuckSlot[]) {
      if (!owned(session) || session.restoring) return;
      const wanted = session.plan[slot]!;
      if (!ports.same(ports.equipped(slot), wanted)) await equipSlot(wanted, slot, session);
    }
  }
  async function restore(session: LuckSwapSession): Promise<void> {
    for (const slot of Object.keys(session.original) as LuckSlot[]) {
      if (!owned(session)) return;
      const original = session.original[slot] ?? null;
      if (original && !ports.same(ports.equipped(slot), original)) await equipSlot(original, slot, session);
    }
    if (owned(session) && matches(session.original)) delete memory.session;
  }
  function run(operation: () => Promise<void>): void {
    if (!active || memory.pending || ports.now() < (memory.retryAt || 0)) return;
    const pending = operation().catch(error => {
      memory.retryAt = ports.now() + 2000;
      ports.report(String(error instanceof Error ? error.message : error));
    }).finally(() => { if (memory.pending === pending) delete memory.pending; });
    memory.pending = pending;
  }
  function planSwap(): Partial<Record<LuckSlot, GearItem>> {
    const plan: Partial<Record<LuckSlot, GearItem>> = {};
    const carried = ports.items().filter((item): item is GearItem => !!item);
    for (const slot of LUCK_SWAP_SLOTS) {
      const currentLuck = ports.luckValue(ports.equipped(slot));
      const best = carried
        .filter(item => ports.itemType(item) === LUCK_SLOT_ITEM_TYPE[slot])
        .reduce<{ item: GearItem; luck: number } | null>((top, item) => {
          const luck = ports.luckValue(item);
          return luck > currentLuck && (!top || luck > top.luck) ? { item, luck } : top;
        }, null);
      if (best) plan[slot] = ports.fingerprint(best.item)!;
    }
    return plan;
  }
  function beginSwap(): void {
    const plan = planSwap();
    // No carried item beats what's already equipped anywhere: nothing to gain right now.
    if (!Object.keys(plan).length) { memory.retryAt = ports.now() + 2000; return; }
    const next: LuckSwapSession = { original: copyLoadout(), expected: copyLoadout(), plan, restoring: false };
    memory.session = next;
    memory.swappedInAt = ports.now();
    run(() => swap(next));
  }
  function trackHpTrend(target: LuckTarget): void {
    const trend = memory.hpTrend?.id === target.id ? memory.hpTrend : { id: target.id, samples: [] };
    trend.samples = trend.samples.filter(sample => ports.now() - sample.t <= 2000).concat({ t: ports.now(), hp: target.hp });
    memory.hpTrend = trend;
  }
  function estimatedSecondsToDeath(): number {
    const samples = memory.hpTrend?.samples || [];
    const oldest = samples[0], newest = samples[samples.length - 1];
    if (!oldest || !newest || oldest === newest) return Infinity;
    const elapsedSeconds = (newest.t - oldest.t) / 1000;
    const dps = elapsedSeconds > 0 ? (oldest.hp - newest.hp) / elapsedSeconds : 0;
    return dps > 0 ? newest.hp / dps : Infinity;
  }
  function shouldSwapIn(target: LuckTarget | null): boolean {
    if (!target || !ports.isTank() || ports.otherSwapBusy()) return false;
    trackHpTrend(target);
    // A lethal attack from this character sets (or confirms) its own aggro as part of that same
    // kill, even if the monster had no target yet — so the aggro check only gates the trend-based
    // prediction, where the kill (and whichever aggro was already in place) may come from elsewhere.
    if (ports.lethalBasicAttack(target)) return true;
    return ports.holdsAggro(target) && estimatedSecondsToDeath() <= 3;
  }
  function shouldRestore(target: LuckTarget | null): boolean {
    if (!ports.isTank()) return true;
    if (!target || target.dead || target.rip) return true;
    if (ports.endangered()) return true;
    // Safety timeout: covers a boss phase where the trend estimate dipped then stabilized —
    // don't stay in weaker gear indefinitely waiting for a death that isn't imminent anymore.
    if (ports.now() - (memory.swappedInAt || 0) > 10000) return true;
    return false;
  }
  function continueSession(session: LuckSwapSession, target: LuckTarget | null): void {
    if (!owned(session)) return;
    if (!session.restoring && shouldRestore(target)) session.restoring = true;
    if (session.restoring) { run(() => restore(session)); return; }
    if (!planApplied(session)) run(() => swap(session));
  }
  return {
    tick(target: LuckTarget | null): void {
      if (!active || memory.pending) return;
      const session = memory.session;
      if (session) { continueSession(session, target); return; }
      if (ports.otherSwapBusy()) return;
      if (shouldSwapIn(target)) beginSwap();
    },
    depart(): void {
      if (!memory.session) return;
      memory.session.restoring = true;
      memory.retryAt = 0;
      run(() => restore(memory.session!));
    },
    async manual(): Promise<void> {
      relinquish();
      await memory.pending;
    },
    busy: () => !!memory.pending,
    stop() { active = false; },
  };
}
