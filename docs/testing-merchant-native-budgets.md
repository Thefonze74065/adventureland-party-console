# Merchant native observation budgets

Failure modes were recorded before the fixture changes in
`.build/merchant-native-budget-plan.md`.

The lucky party delivery scenario reached its injected restoration fault after
91.65 seconds in native CI, outside the former 90-second observation window.
Inventory already preserved the upgraded helmet and all four delivered
seashells; receipt recovery remained intentionally blocked. Its fault wait now
allows 150 seconds. The interruption, restart, upgrade count and cargo
conservation assertions remain required.

Fifteen gem exchanges can generate additional boxes. Native inventory packets
showed armor and weapon box counts increasing from two to four each, then
decreasing back to two as the first four box exchanges finished. Six reward
sales and bank travel preceded the next automatic exchange job. A 240-second
wait expired with that job still progressing. The first batch wait allows
420 seconds; the scenario has a scoped 720-second overall budget.

These waits remain bounded. They still detect lost cargo, duplicated upgrades,
unobserved injected faults, journal recovery stalls, forgotten marks, incorrectly
banked nested boxes, consumed locked items, missed reward sales, and stalled
processing. Native input quantities and all conservation, reward, bank fallback
and restart assertions are unchanged.

Validate the existing scenarios with `npm test`; inspect native inventory and
game packet receipts together with final coordinator state. Preserve their
repeatable evidence under `.build/e2e-results/`.
