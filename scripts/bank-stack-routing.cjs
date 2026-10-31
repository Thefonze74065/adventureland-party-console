const {stackDepositPlan} = require('../runtime/bank-stacks.ts');
const {bankStagingReserved} = require('../runtime/coordinator/inventory/reserved-cargo.ts');
const {entryMeta} = require('../runtime/coordinator/inventory/catalog-meta.ts');
const {retryableStorageError} = require('../runtime/coordinator/inventory/storage-retry.ts');
// Reports carry per-copy meta, so the stack size comes from merchantCatalog.
const stackLimit = (entry, catalog) => Number(entryMeta(catalog, entry)?.definition?.s) || 1;
// A partial stack has one preferred home across physical and virtual panes.
function identity(item) {
  return JSON.stringify(['name', 'level', 'p', 'stat_type', 'data', 'rid', 'b', 'm', 'l']
    .map(key => key === 'level' ? Number(item?.level) || 0 : item?.[key] ?? null));
}
function homes(bank, workers, catalog) {
  const result = {};
  const staging = bankStagingReserved({bankbois:workers});
  const add = (entry, owner) => {
    const limit = stackLimit(entry, catalog);
    if (!entry?.item || limit <= 1 || Number(entry.item.q || 1) >= limit) return;
    const key = identity(entry.item);
    if (!result[key]) result[key] = { owner, item: entry.item, limit, room: limit - Number(entry.item.q || 1) };
  };
  Object.entries(bank?.packs || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([pack, entries]) =>
    (entries || []).forEach((entry, slot) => { if (!staging || pack !== 'items1' || slot < 35) add(entry, 'bank'); }));
  Object.values(workers || {}).sort((a, b) => a.name.localeCompare(b.name)).forEach(worker =>
    (worker.items || []).forEach(entry => add(entry, worker.name)));
  return result;
}
function needsReconcile(worker, routes, withdrawals) {
  return (worker.items || []).some(entry => {
    if (!entry?.item || (withdrawals || []).some(r => r.pack === 'bankboi:' + worker.name && identity(r.item) === identity(entry.item))) return false;
    const home = routes[identity(entry.item)];
    return home && home.owner !== worker.name && home.room >= Number(entry.item.q || 1);
  });
}
function accepts(worker, request, routes) {
  const home = routes[identity(request.item)];
  if (home && home.owner !== 'bank' && home.room >= Number(request.item.q || 1)) return home.owner === worker.name;
  return (worker.items || []).filter(Boolean).length < 42;
}
function storageSignature(party, worker) {
  return JSON.stringify(['normal-bank-unload-v1', party.bankSnapshot?.packs, worker.items, party.withdrawals]);
}
function unloadPlan(party, worker) {
  const withdrawals = Object.values(party.withdrawals || {}).flat();
  const slots = Object.entries(party.bankSnapshot?.packs || {}).filter(([, entries]) => Array.isArray(entries))
    .flatMap(([pack, entries]) => Array.from({length:42}, (_, slot) => ({pack, slot, item:entries[slot]?.item})))
    .filter(location => !(bankStagingReserved(party) && location.pack === 'items1' && location.slot >= 35) &&
      !withdrawals.some(request => request.pack === location.pack && request.slot === location.slot));
  const moves = [];
  (worker.items || []).forEach((entry, slot) => {
    if (!entry?.item || withdrawals.some(request => request.pack === 'bankboi:' + worker.name &&
      identity(request.item) === identity(entry.item))) return;
    const item = entry.item, limit = stackLimit(entry, party.merchantCatalog);
    const plan = stackDepositPlan(item, limit, slots);
    if (plan.remaining || !plan.moves.length) return;
    // Keep the public scheduling shape: one source entry, with capacity reserved
    // across every destination so another source cannot spend it again.
    const first = plan.moves[0];
    moves.push({slot, item, pack:first.pack, bankSlot:first.slot});
    for (const move of plan.moves) {
      const destination = slots.find(target => target.pack === move.pack && target.slot === move.slot);
      destination.item = {...item, q:Number(destination.item?.q || (destination.item ? 1 : 0)) + move.quantity};
    }
  });
  return moves;
}
// Checkpoint transport failures can resume through the existing durable bank
// journal. Unknown operation/game errors still require review.
function servicePlan(party, { includeCoolingDown = false } = {}) {
  // Checkpoints and merchant reservations must retain work while a worker retries.
  // Dispatch uses the default so it never starts a worker before its retry time.
  const merchant = party.merchantCharacter;
  const withdrawals = party.withdrawals[merchant] || [];
  const routes = homes(party.bankSnapshot, party.bankbois, party.merchantCatalog);
  const workers = Object.values(party.bankbois).sort((a, b) => Number(a.seenAt || 0) - Number(b.seenAt || 0));
  const available = entry => entry.state === 'ready' || entry.state === 'error' &&
    retryableStorageError(entry.error) &&
    (includeCoolingDown || Date.now() >= Number(entry.retryAt || 0));
  const reserved = slot => Object.values(party.withdrawals || {}).some(requests =>
    (requests || []).some(request => request.pack === 'items1' && request.slot === slot));
  const staged = (party.bankboiQueue || []).filter(request => request.state === 'staged' && !reserved(request.slot));
  const reserve = party.bankSnapshot?.packs?.items1;
  const freeReserve = Array.from({length:7},(_,i)=>35+i).filter(slot => !reserve?.[slot]).length;
  const outgoing = Array.from({length:7},(_,i)=>35+i).some(slot => reserve?.[slot] && reserved(slot));
  // The merchant must finish the outbound handoff before any other worker
  // borrows its slot, even when other staging slots still have free space.
  if (outgoing) return null;
  // Drain staging first: retrievals need the same seven transfer slots.
  const candidate = workers.find(entry => entry.state === 'provisioning') ||
    workers.find(entry => available(entry) && staged.some(request => accepts(entry, request, routes))) ||
    workers.find(entry => available(entry) && freeReserve > 0 && withdrawals.some(request => request.pack === 'bankboi:' + entry.name)) ||
    workers.find(entry => available(entry) && !outgoing && needsReconcile(entry, routes, withdrawals)) ||
    workers.find(entry => available(entry) && entry.unloadBlockedSignature !== storageSignature(party, entry) && unloadPlan(party, entry).length);
  if (!candidate) return null;
  return { candidate, routes,
    requests: staged.filter(request => accepts(candidate, request, routes)).slice(0, 7),
    retrievals: withdrawals.filter(request => request.pack === 'bankboi:' + candidate.name).slice(0, 7) };
}
module.exports = { identity, homes, needsReconcile, accepts, servicePlan, unloadPlan, storageSignature };
