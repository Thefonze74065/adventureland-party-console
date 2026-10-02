import { nextStackMerge, stackDepositPlan, stackIdentity, stackLocations, stackQuantity, stackProtected,
  type StackItem, type StackLocation, type StackProtection } from '../bank-stacks.ts';

interface Origin { pack: string; slot: number; floor: string }
interface Buffer { slot: number; identity: string; origin?: Origin; source?: number }
interface Expected { inventory?: number; bank?: Origin; item: StackItem | null }
interface Journal { buffers: Buffer[]; pending?: Expected[]; supersededBuffers?: Buffer[]; recoveryStartedAt?: number; retryAt?: number }
export interface BankStackPorts {
  items(): (StackItem | null)[];
  bank(): Record<string, unknown>;
  size(): number;
  map(): string;
  floor(pack: string): string;
  reachable(): string[];
  limit(item: StackItem): number;
  protection(): Promise<StackProtection>;
  current(): boolean;
  move(floor: string): Promise<unknown>;
  retrieve(pack: string, slot: number, inv: number): Promise<unknown>;
  store(inv: number, pack: string, slot?: number): Promise<unknown>;
  bankSwap(pack: string, from: number, to: number): Promise<unknown>;
  swap(from: number, to: number): Promise<unknown>;
  split(slot: number, quantity: number): Promise<unknown>;
  read(): Journal | null;
  write(journal: Journal | null): void;
  sleep(ms: number): Promise<unknown>;
  now(): number;
}
export function createBankStacks(p: BankStackPorts) {
  const at = (o: Origin) => (p.bank()[o.pack] as (StackItem | null)[] | undefined)?.[o.slot] || null;
  const origin = (l: StackLocation): Origin => ({ pack: l.pack, slot: l.slot, floor: p.floor(l.pack) });
  const empty = () => Array.from({ length: p.size() }, (_, i) => i).filter(i => !p.items()[i]);
  const copy = (item: StackItem | null | undefined) => item ? { ...item } : null;
  const equal = (a: StackItem | null | undefined, b: StackItem | null | undefined) =>
    stackIdentity(a) === stackIdentity(b) && stackQuantity(a) === stackQuantity(b);
  function active() { if (!p.current()) throw Error('Bank stack runtime replaced'); }
  async function settle(expected: Expected[], recovering = false) {
    active();
    const deadline = p.now() + 5000;
    while (!expected.every(e => equal(e.bank ? at(e.bank) : p.items()[e.inventory!], e.item))) {
      active();
      if (p.now() >= deadline) {
        // Give native updates the same confirmation window before recognizing
        // a reused identity. Quantity-only lag remains bounded by recover().
        if (recovering && expected.some(e => stackIdentity(e.bank ? at(e.bank) : p.items()[e.inventory!]) !== stackIdentity(e.item))) return;
        throw Error('Bank stack transfer not confirmed; recovery pending');
      }
      await p.sleep(100);
    }
    active();
  }
  async function operation(run: () => Promise<unknown>, expected: Expected[]) {
    active();
    const journal = p.read() || { buffers: [] };
    p.write({ ...journal, pending: expected });
    await run();
    await settle(expected);
    p.write({ ...journal, pending: undefined });
  }
  async function travel(floor: string) {
    active();
    if (p.map() !== floor) await p.move(floor);
    if (p.map() !== floor) throw Error('Bank floor not reached');
  }
  async function locations() {
    const protection = await p.protection();
    if (protection.error) throw Error(protection.error);
    const floors = p.reachable();
    return stackLocations(p.bank(), protection).filter(l => floors.includes(p.floor(l.pack)))
      .map(location => ({ ...location, item: copy(location.item) }));
  }
  async function permitted(location: StackLocation) {
    const protection = await p.protection();
    if (stackProtected({ ...location, item: at(origin(location)) }, protection))
      throw Error('Bank stack location is reserved');
  }
  async function returnBuffer(buffer: Buffer) {
    const item = p.items()[buffer.slot];
    if (!item) return;
    if (stackIdentity(item) !== buffer.identity) return;
    if (buffer.source !== undefined) {
      const source = p.items()[buffer.source];
      if (!source || stackIdentity(source) !== buffer.identity || stackQuantity(source) + stackQuantity(item) > p.limit(item))
        return; // Preserve current stock; this old split can no longer be undone.
      await operation(() => p.swap(buffer.source!, buffer.slot), [
        { inventory: buffer.source, item: { ...source, q: stackQuantity(source) + stackQuantity(item) } },
        { inventory: buffer.slot, item: null }]);
    } else if (buffer.origin) {
      await travel(buffer.origin.floor);
      if (at(buffer.origin)) return; // Never overwrite a reused bank location.
      await operation(() => p.store(buffer.slot, buffer.origin!.pack, buffer.origin!.slot), [
        { inventory: buffer.slot, item: null }, { bank: buffer.origin, item: copy(item) }]);
    }
  }
  async function recoverOnce() {
    const journal = p.read();
    if (!journal) return;
    // An uncertain operation is never repeated. Wait until its recorded result is visible.
    if (journal.pending) { await settle(journal.pending, true); p.write({ ...journal, pending: undefined }); }
    // Older IPC-backed journals could retain completed reservations. A later
    // reservation of the same slot was made only after that slot was empty;
    // it supersedes the earlier one. Still validate the latest item's identity.
    let buffers = [...new Map(journal.buffers.map(buffer => [buffer.slot, buffer])).values()];
    if (!journal.pending && buffers.length !== journal.buffers.length) {
      // Only the legacy duplicated journal has this ambiguity. Slots already
      // reused for unrelated items are no longer buffers; never swap those items.
      // Archive the old entries and persist the narrowed recovery before moving.
      buffers = buffers.filter(buffer => stackIdentity(p.items()[buffer.slot]) === buffer.identity);
      p.write({ buffers, supersededBuffers: journal.buffers });
    }
    for (const buffer of buffers.sort((a, b) => Number(b.source !== undefined) - Number(a.source !== undefined)))
      await returnBuffer(buffer);
    p.write(null);
  }
  async function recover() {
    const journal = p.read();
    if (!journal) return;
    const startedAt = journal.recoveryStartedAt ?? p.now();
    if (p.now() - startedAt >= 30_000) {
      // Retire uncertain intent without replaying a transfer or moving inventory.
      // A later deposit/compact plans afresh from the authoritative current stock.
      p.write(null);
      return;
    }
    if ((journal.retryAt || 0) > p.now()) throw Error('Bank stack recovery cooling down');
    p.write({ ...journal, recoveryStartedAt: startedAt });
    try { await recoverOnce(); }
    catch (error) {
      if (p.current() && p.read()) p.write({ ...p.read()!, recoveryStartedAt: startedAt, retryAt: p.now() + 5000 });
      throw error;
    }
  }
  function remember(buffers: Buffer[]) {
    const old = p.read();
    p.write({ buffers: [...(old?.buffers || []), ...buffers] });
  }
  async function retrieve(location: StackLocation, inv: number) {
    const o = origin(location), item = copy(at(o));
    await travel(o.floor);
    await permitted(location);
    if (!equal(at(o), location.item) || p.items()[inv]) throw Error('Bank stack source changed');
    remember([{ slot: inv, identity: stackIdentity(item), origin: o }]);
    await operation(() => p.retrieve(o.pack, o.slot, inv), [{ inventory: inv, item }, { bank: o, item: null }]);
  }
  async function transfer(slot: number, target: StackLocation, quantity: number) {
    const source = copy(p.items()[slot]), targetItem = copy(target.item);
    if (!source || !targetItem) throw Error('Bank stack transfer source missing');
    const buffers = empty(), partial = quantity < stackQuantity(source);
    if (buffers.length < (partial ? 2 : 1)) throw Error('Bank stacking needs free inventory buffers');
    await retrieve(target, buffers[0]);
    let chunk = slot;
    if (partial) {
      // The official split operation uses the first empty inventory slot.
      chunk = empty()[0];
      remember([{ slot: chunk, identity: stackIdentity(source), source: slot }]);
      await operation(() => p.split(slot, quantity), [
        { inventory: slot, item: { ...source, q: stackQuantity(source) - quantity } },
        { inventory: chunk, item: { ...source, q: quantity } }]);
    }
    const combined = { ...targetItem, q: stackQuantity(targetItem) + quantity };
    await operation(() => p.swap(buffers[0], chunk), [{ inventory: buffers[0], item: combined }, { inventory: chunk, item: null }]);
    const o = origin(target);
    if (at(o)) throw Error('Bank stack destination changed');
    await operation(() => p.store(buffers[0], o.pack, o.slot), [{ inventory: buffers[0], item: null }, { bank: o, item: combined }]);
  }
  async function fill(slot: number) {
    await recover();
    const initialFloor = p.map();
    while (p.items()[slot]) {
      const item = copy(p.items()[slot])!, limit = p.limit(item);
      const available = await locations();
      const plan = stackDepositPlan(item, limit, available);
      const target = plan.moves.find(move => move.item);
      if (!target) break;
      await travel(p.floor(target.pack));
      if (!equal(at(origin(target)), target.item) || !equal(p.items()[slot], item))
        throw Error('Bank stack changed during travel; retry deposit');
      // A whole-stack automatic deposit is safe only if the server cannot choose
      // a reserved or staging stack in this pack instead of our planned target.
      const pack = p.bank()[target.pack] as (StackItem | null)[];
      const safe = pack.every((entry, index) => !entry || stackIdentity(entry) !== stackIdentity(item) ||
        available.some(l => l.pack === target.pack && l.slot === index));
      if (target.quantity === stackQuantity(item) && safe) {
        await permitted(target);
        await operation(() => p.store(slot, target.pack), [{ inventory: slot, item: null },
          { bank: origin(target), item: { ...target.item, q: stackQuantity(target.item) + stackQuantity(item) } }]);
      } else await transfer(slot, target, target.quantity);
      await recover();
    }
    await travel(initialFloor);
  }
  async function compact() {
    await recover();
    const initialFloor = p.map();
    let moved = 0, deferred = false;
    // Each successful iteration fills a target or empties a source.
    for (;;) {
      const plan = nextStackMerge(await locations(), item => p.limit(item));
      if (!plan) break;
      const { source, target, quantity } = plan;
      if (source.pack === target.pack && quantity === stackQuantity(source.item)) {
        await travel(p.floor(source.pack));
        await permitted(source); await permitted(target);
        await operation(() => p.bankSwap(source.pack, source.slot, target.slot), [
          { bank: origin(source), item: null }, { bank: origin(target), item: { ...target.item, q: stackQuantity(target.item) + quantity } }]);
        p.write(null);
      } else {
        const buffers = empty();
        if (buffers.length < (quantity < stackQuantity(source.item) ? 3 : 2)) { deferred = true; break; }
        await retrieve(source, buffers[0]);
        await transfer(buffers[0], target, quantity);
        await recover();
      }
      moved++;
    }
    await travel(initialFloor);
    return { moved, deferred };
  }
  let flight: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = flight.then(run, run);
    flight = next.catch(() => {});
    return next;
  }
  return { fill: (slot: number) => serial(() => fill(slot)), compact: () => serial(compact),
    recover: () => serial(recover), locations, pending: () => !!p.read() };
}
Object.assign(globalThis, { partyCreateBankStacks: createBankStacks });
