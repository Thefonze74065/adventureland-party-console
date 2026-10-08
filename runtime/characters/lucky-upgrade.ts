type Item = { name: string; level?: number; [key: string]: unknown };
interface Journal { from: number; to: number; item: Item; displaced: Item | null; scrollDisplaced?: boolean; offeringDisplaced?: boolean; phase: 'preparing' | 'running' | 'restoring'; result?: Item | null }
interface Ports {
  item(slot: number): Item | null;
  busy(): boolean;
  swap(a: number, b: number): Promise<unknown>;
  read(): Journal | null;
  write(value: Journal | null): void;
  checkpoint?(value: Journal): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  current(): boolean;
  log(slot: number): void;
}
const copy = (item: Item | null): Item | null => item && JSON.parse(JSON.stringify(item));
// Normalize both sides so journals saved before null metadata was omitted still
// match native inventory. Non-null identity fields remain exact comparisons.
const identity = (item: Item | null) => item && Object.fromEntries(Object.entries(item).filter(([,value]) => value != null));
const same = (a: Item | null, b: Item | null) => JSON.stringify(identity(a)) === JSON.stringify(identity(b));
const level = (item: Item) => Number(item.level || 0);
function describe(error: unknown): string { return error instanceof Error ? error.message : JSON.stringify(error); }
function reconcileScroll(j: Journal, current: Item | null): void {
  if (!(j.scrollDisplaced || j.offeringDisplaced) || j.phase !== 'running') return;
  const consumed = copy(j.displaced), quantity = Number(j.displaced?.q || 1);
  if (consumed && quantity > 1) consumed.q = quantity - 1;
  if (same(current, quantity > 1 ? consumed : null)) j.displaced = copy(current);
}
function sameStack(previous: Item | null, current: Item | null): boolean {
  if (!previous || !current) return false;
  if (previous.q === undefined && current.q === undefined) return false;
  const previousQuantity = Number(previous.q ?? 1), currentQuantity = Number(current.q ?? 1);
  if (![previousQuantity,currentQuantity].every(quantity => Number.isSafeInteger(quantity) && quantity > 0)) return false;
  const previousIdentity = {...previous}, currentIdentity = {...current};
  delete previousIdentity.q; delete currentIdentity.q;
  // Native potion use and incoming stack transfers can change quantity while
  // production runs. Preserve the observed stack; never recreate consumed units.
  return same(previousIdentity,currentIdentity);
}
function reconcileStack(j: Journal, current: Item | null): void {
  // A saved restoration can resume after a potion or incoming transfer changed
  // the displaced stack. Its identity, not its old quantity, owns the return.
  if (sameStack(j.displaced,current)) j.displaced = copy(current);
}
function returnedResult(j: Journal, from: Item | null, to: Item | null): boolean {
  // Once a nonempty result is back in its source slot, an originally empty
  // lucky slot can already have received loot or an incoming item transfer.
  // That delivery does not undo the confirmed return and must not be swapped.
  if (j.phase !== 'restoring' || !same(from,j.result ?? null)) return false;
  return j.displaced === null && !!j.result || sameStack(j.displaced,to);
}
function originalLayout(j: Journal, from: Item | null, to: Item | null): boolean {
  if (returnedResult(j,from,to)) return true;
  // Preparation has not issued an upgrade. A delivery into an originally
  // empty destination does not invalidate the unchanged source item.
  if (j.phase === 'preparing' && same(from,j.item))
    return j.displaced === null || same(to,j.displaced) || sameStack(j.displaced,to);
  if (!same(to, j.displaced)) return false;
  return j.phase === 'restoring' && same(from, j.result ?? null);
}
function validResult(j: Journal, result: Item | null): boolean {
  return !result || result.name === j.item.name && [level(j.item), level(j.item) + 1].includes(level(result));
}
const validSlot = (slot: unknown) => Number.isInteger(slot) && Number(slot) >= 0 && Number(slot) < 42;
function failure(reason: string): Error & {reason: string; code: string} {
  const message = "Couldn't use lucky slot: " + reason;
  return Object.assign(new Error(message), {reason: message, code: 'lucky_slot_unavailable'});
}
export function createLuckyUpgrade(ports: Ports) {
  let active = false;
  async function save(journal: Journal): Promise<void> {
    ports.write(journal);
    await ports.checkpoint?.(journal);
  }
  async function wait(check: () => boolean, reason: string): Promise<void> {
    if (!ports.current()) throw failure('runtime interrupted');
    const end = ports.now() + 5000;
    while (!check()) {
      if (!ports.current() || ports.now() >= end) throw failure(reason);
      await ports.sleep(100);
    }
  }
  async function swapConfirmed(a: number, b: number, check: () => boolean): Promise<void> {
    let rejected: unknown;
    // Inventory confirmation, not deferred settlement, authorizes the next step.
    try { void Promise.resolve(ports.swap(a, b)).catch(error => { rejected = error; }); }
    catch (error) { throw failure(describe(error)); }
    await wait(() => {
      if (rejected) throw failure('swap rejected: ' + describe(rejected));
      return check();
    }, 'swap was not confirmed');
  }
  async function restore(j: Journal): Promise<void> {
    await wait(() => !ports.busy(), 'upgrade still pending; inventory recovery required');
    if (originalLayout(j, ports.item(j.from), ports.item(j.to))) {
      ports.write(null); return;
    }
    reconcileScroll(j, ports.item(j.from));
    reconcileStack(j, ports.item(j.from));
    // A send/loot event can fill the source cell while the upgrade runs.
    // Adopt that incoming item as the displaced contents before the return
    // swap, so both items remain accounted for across interruption/restart.
    if (j.displaced === null && ports.item(j.from) && arrivalResult(j, ports.item(j.to))) {
      j.displaced = copy(ports.item(j.from)); await save(j);
    }
    if (!same(ports.item(j.from), j.displaced)) throw inventoryFailure(j);
    const result = ports.item(j.to);
    if (!validResult(j, result))
      throw failure('upgrade slot changed; inventory recovery required');
    j.result = copy(result); j.phase = 'restoring'; await save(j);
    await swapConfirmed(j.from, j.to, () => originalLayout(j, ports.item(j.from), ports.item(j.to)));
    ports.write(null);
  }
  function inventoryFailure(j: Journal): Error {
    return failure('displaced item changed; inventory recovery required ' + JSON.stringify({
      phase:j.phase,from:j.from,to:j.to,expected:j.displaced,actual:ports.item(j.from),upgrade:ports.item(j.to),
    }));
  }
  function arrivalResult(j: Journal, item: Item | null): boolean {
    if (j.phase === 'preparing') return same(item,j.item);
    if (j.phase === 'restoring') return same(item,j.result ?? null);
    return validResult(j,item);
  }
  async function refreshPreparation(j: Journal): Promise<void> {
    if (!same(ports.item(j.from),j.item)) throw failure('source item changed during preparation');
    const current = ports.item(j.to);
    if (same(current,j.displaced)) return;
    if (j.displaced !== null && !sameStack(j.displaced,current)) throw inventoryFailure(j);
    j.displaced = copy(current);
    await save(j);
  }
  function preparedSwap(j: Journal): boolean {
    if (!same(ports.item(j.to),j.item)) return false;
    const from = ports.item(j.from);
    return same(from,j.displaced) || sameStack(j.displaced,from) || j.displaced === null;
  }
  async function recover(): Promise<void> {
    if (active) throw failure('another upgrade owns the inventory');
    await wait(() => !ports.busy(), 'upgrade still pending; inventory recovery required');
    const journal = ports.read();
    if (journal) await restore(journal);
  }
  function retireSettled(): boolean {
    // Only the caller's authoritative absence of pending production receipts
    // permits this path. The displaced destination proves the return layout is
    // already restored; later cargo/gear movement need not match the old source.
    if (active || ports.busy()) return false;
    const journal = ports.read();
    if (!journal) return false;
    const destination = ports.item(journal.to);
    if (!same(destination,journal.displaced) && !sameStack(journal.displaced,destination)) return false;
    ports.write(null);
    return true;
  }
  function runInput(from: number, scroll: number, lucky: unknown, offering?: number) {
    if (active) throw failure('another upgrade owns the inventory');
    const to = validSlot(lucky) ? Number(lucky) : from;
    const item = copy(ports.item(from)), scrollItem = copy(ports.item(scroll));
    if (!item || !scrollItem || from === scroll) throw failure('item or scroll unavailable');
    return {to, item, scrollItem, offeringItem: offeringInput(from, scroll, offering)};
  }
  function offeringInput(from: number, scroll: number, offering?: number) {
    if (offering === undefined) return null;
    const item = copy(ports.item(offering));
    if (!item || offering === from || offering === scroll) throw failure('offering unavailable');
    return item;
  }
  async function run<T>(from: number, scroll: number, lucky: unknown, action: (slot: number, scroll: number, offering?: number) => Promise<T>, offering?: number): Promise<T> {
    await recover();
    const {to, item, scrollItem, offeringItem} = runInput(from, scroll, lucky, offering);
    active = true;
    try {
      if (from === to) { if (validSlot(lucky)) ports.log(to); return await action(from, scroll, offering); }
      const journal: Journal = {from, to, item, displaced: copy(ports.item(to)), scrollDisplaced: scroll === to, offeringDisplaced: offering === to, phase: 'preparing'};
      await save(journal);
      await refreshPreparation(journal);
      await swapConfirmed(from, to, () => preparedSwap(journal));
      // The native swap may race another delivery after the checkpoint. Capture
      // the actual displaced contents before admitting the game operation.
      journal.displaced = copy(ports.item(from));
      const nextScroll = scroll === to ? from : scroll;
      const nextOffering = offering === to ? from : offering;
      if (nextOffering !== undefined && !same(ports.item(nextOffering), offeringItem)) throw failure("offering changed during preparation");
      if (!same(ports.item(nextScroll), scrollItem)) throw failure('scroll changed during preparation');
      // A scroll displaced from the lucky slot will be consumed by the operation.
      journal.phase = 'running'; await save(journal); ports.log(to);
      try { return await action(to, nextScroll, nextOffering); }
      finally {
        await restore(journal);
      }
    } finally { active = false; }
  }
  async function tidy(lucky: unknown): Promise<void> {
    await recover();
    if (active || !validSlot(lucky)) return;
    const tracker = ports.item(41);
    const pinned = tracker?.name === 'tracker' || tracker?.name === 'supercomputer';
    const targets = Array.from({length: 42}, (_, i) => i).filter(i => i !== lucky && !(pinned && i === 41));
    const ordered = Array.from({length: 42}, (_, i) => pinned && i === 41 ? null : copy(ports.item(i))).filter((item): item is Item => !!item);
    if (ordered.length > targets.length) throw failure('no room to keep lucky slot empty');
    active = true;
    try {
      for (let index = 0; index < ordered.length; index++) {
        const target = targets[index]!, wanted = ordered[index];
        if (same(ports.item(target), wanted)) continue;
        const from = Array.from({length: 42}, (_, i) => i).find(i => (i >= target || i === lucky) && same(ports.item(i), wanted));
        if (from === undefined) throw failure('inventory changed while tidying');
        await emptyTarget(target, lucky);
        await swapConfirmed(from, target, () => same(ports.item(target), wanted) && !ports.item(from));
      }
    } finally { active = false; }
  }
  async function emptyTarget(target: number, lucky: unknown): Promise<void> {
    const displaced = copy(ports.item(target));
    if (!displaced) return;
    const empty = Array.from({length: 42}, (_, i) => i).find(i => i !== lucky && !ports.item(i));
    if (empty === undefined) throw failure('no spare slot for inventory tidying');
    // imove merges compatible stacks. Move through an empty cell instead of
    // ever swapping two occupied cells while packing the bag.
    await swapConfirmed(target, empty, () => !ports.item(target) && same(ports.item(empty), displaced));
  }
  return {run, recover, retireSettled, tidy, pending: () => active || !!ports.read()};
}
(globalThis as unknown as {createPartyLuckyUpgrade: typeof createLuckyUpgrade}).createPartyLuckyUpgrade = createLuckyUpgrade;
