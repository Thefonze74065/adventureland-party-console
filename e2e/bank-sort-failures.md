Bank sorting failure inventory

- Native storage removes merchant-luck attribution (`m`); expecting it to survive
  a deposit leaves an already completed swap permanently pending.
- Old persisted swap expectations must reconcile that same native normalization
  after CODE replacement without replaying the swap or losing locked stock.
- A rejected operation must not leave a journal expecting a swap that never ran.
- Inventory overflow cells are not usable empty native inventory slots.
- Request mode must sort through the bank popup, clear the matching request,
  conserve quantities and locks, empty its buffer, and permit departure.

Use the ChronAL native bank journey in live-bank-collection.spec.ts; retain
client storage, native bank/inventory and coordinator snapshots with the report.
