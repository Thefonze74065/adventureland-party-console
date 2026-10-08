# Rare queue selection failure modes

Written before the implementation, from native CI shard 4 evidence.

A selected Tiny P can lose the combat queue head when an earlier ordinary
monster attack is reported. Pending and engaged fights correctly take precedence
over planned nominations. Treating that temporary handoff as abandonment cancels
rare ownership before asynchronous field deployment finishes, then blocks
ordinary Tiny P attacks and rejects the unchanged sighting indefinitely.

The encounter must remain owned while its identity is still nominated in the
queue. Being queued must not count as the active combat selection, an engagement,
or permission to attack alongside another pending fight.

Other failure modes remain authoritative: an outside claim cancels the encounter;
manual navigation and disabled rules cancel it; genuine nomination removal
releases it; death enters loot; stale sightings and the existing progress and
total pursuit limits expire it. Generator success clears the deployment hold;
generator failure retains the existing ordinary-attack fallback timeout.

The reconciled queue excludes tombstoned, externally claimed, retired and rejected
targets. Retention requires current nomination or eligible observation evidence.
Keeping a queue entry therefore does not bypass those exclusions. Encounter
freshness and pursuit timeouts still run every tick while the entry waits.

Validate with the existing native Tiny P Hunt scenario in
`e2e/live-hunt-events.spec.ts`: keep its native party hit, kill, loot, generator
consumption/deployment and same-cycle resumption assertions. Archive the native
packet receipts and coordinator state under `.build/e2e-results/`.
