# Lucky elimination and combat handoff failure inventory

Written before implementation for issues #23 and #66.

Statistical elimination can exclude under-sampled cells, disagree with the
existing joint posterior, remain sticky after competing evidence changes, choose
an eliminated least-sampled cell, overflow during long sessions, or override
manual locks and unlock checkpoints. Console E2E supplies explicitly declared
observation ledgers through the real status boundary, observes row statuses,
counts and next-slot selection, then changes evidence and restarts. These are
historical observations, not fabricated native upgrade receipts.

Combat collection can unequip gear while fighting, make a fighter approach its
merchant during engagement, clear its retained target after stationary pickup,
send outside native range, exhaust call-cost headroom, or resolve a stale slot
after waiting for authorization. Partial timeout can clear unsent marks, duplicate
acknowledged cargo/gold, retry forever, or let stale commands continue after death,
realm changes, reconnect or superseding movement. Cleanout must continue protecting
trackers, supplies and reserved/locked cargo.

Native E2E must prove real damage before pickup, recipient cargo while that same
monster remains alive, continued damage afterward, conserved cargo and completion
before death. A declared long-lived native Goo seed changes its initial health,
not existing damage or death. Existing native Hunt collection restart/death and
Tracktrix cleanout journeys remain regression gates. Add equipped-work, range,
call-cost and partial-timeout probes at explicit fault boundaries; preserve native
send results and receipts rather than replacing send_item or combat handlers.
