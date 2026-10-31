// Plan one conservative merge at an existing idle/stand reconciliation boundary.
const { identity } = require('./bank-stack-routing.cjs');
const { entryMeta } = require('../runtime/coordinator/inventory/catalog-meta.ts');
function plan(party, status, boundary) {
  const merchant = party.merchantCharacter;
  const current = party.merchantCurrent;
  const ownsBoundary = current && typeof boundary?.jobId === 'string' && Number.isSafeInteger(boundary.commandId) &&
    boundary.jobId === current.id && boundary.commandId === current.commandId;
  if (!status || status.name !== merchant || current && !ownsBoundary || party.bankboiTransaction ||
      Number(status.inventoryStackRetryAt || 0) > Date.now() || status.upgradeInventoryBusy || status.banking || status.gatheringActive || status.anniversaryState?.busy || status.rip) return null;
  const reserved = new Set();
  function reserve(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.name === 'string') reserved.add(value.name);
    Object.values(value).forEach(reserve);
  }
  function reserveJob(job) {
    if (!job || typeof job !== 'object') return;
    // Exchange rewards are quantity receipts, not slot-owned future inputs.
    // They survive resume and must not reserve every copy of that item type.
    if (job.reason === 'exchange' || job.type === 'merchant-exchange') {
      const work = { ...job };
      delete work.exchangeRewards;
      reserve(work);
    } else reserve(job);
  }
  [party.marked?.[merchant], party.merchantMarked?.[merchant], party.upgrades?.[merchant],
    party.compounds?.[merchant], party.statScrolls?.[merchant], party.withdrawals?.[merchant],
    party.standListings, party.npcSaleMarks, (party.deconstructionMarks || []).filter(mark => mark.state !== "complete"), party.merchantDeliveries, party.merchantCargo,
    ].forEach(reserve);
  (party.merchantQueue || []).forEach(reserveJob);
  reserveJob(current);
  if (boundary?.command) {
    // A merge proposal describes the very copies being authorized, not future
    // work that owns them. Otherwise the second permission check vetoes every
    // active-job merge by reserving its own source and target item names.
    const command = { ...boundary.command };
    delete command.inventoryMerge;
    reserveJob(command);
  }
  const groups = new Map();
  for (const entry of status.items || []) {
    // Reports carry per-copy meta, so the stack size comes from merchantCatalog.
    const item = entry?.item, limit = Number(entryMeta(party.merchantCatalog, entry)?.definition?.s) || 1;
    if (!item || !Number.isSafeInteger(entry.slot) || item.l || item.b || reserved.has(item.name) ||
        limit <= 1 || !Number.isSafeInteger(item.q) || item.q <= 0 || item.q >= limit) continue;
    // PvP-marked loot cannot stack with unmarked loot. Timestamp equality is
    // irrelevant: the game checks marker presence. Replan from each new report.
    const key = JSON.stringify([identity(item), !!item.v, !!item.acl, item.ps || []]), previous = groups.get(key);
    if (previous) {
      const quantity = Math.min(item.q, limit - previous.item.q);
      // Partial fills need a native split buffer; whole merges do not.
      if (quantity === item.q || (status.items || []).filter(Boolean).length < 42)
        return { to: previous.slot, from: entry.slot, target: previous.item, source: item, quantity };
    }
    if (!previous || item.q < previous.item.q) groups.set(key, entry);
  }
  return null;
}
module.exports = { plan };
