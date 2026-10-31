# Gathering equipment handoff (#153)

Failure modes recorded before implementation:

- A deferred Ponty command is accepted after casting releases its attempt, leaving the tool equipped.
- Cancelling a preparing/settling attempt releases it without restoring either hand.
- A casting merchant command interrupts a cast instead of deferring.
- A gathering command or manual movement restores gear it does not own.
- An obsolete gathering generation mutates equipment after a CODE replacement.
- Missing saved equipment silently admits the next job with the tool still equipped.

Extend the retained gathering-equipment isolation regression to deterministically
exercise the no-attempt and cancellation boundaries with the real restore helper.
Native timing cannot reliably select both sides of the attempt-release boundary;
this exception supplements the native equipment gathering/restart journey, rather
than claiming native Ponty purchase coverage. Observe both hands and retain TAP
output. Run the existing native equipment journey through ChronAL as well.

The timer/preflight interception must end before the separate coordinator restart.
Otherwise route.fetch can reject with ECONNREFUSED during the intentional outage,
even when native equip, restoration and restart persistence succeed. Drain all
owned handlers, restore gathering timers, and require observed collisions with
exactly one inventory-command owner before restarting. Preserve ordinary browser
transport failures and recovery; do not catch and discard interception errors.
Seed availability before login here too: a response already in the browser can
restore an old cooldown after a live reset. Disable modes before adding tools.
A manual equipment command can be delivered while production preflight and the
old gathering channel are still settling. Deleting it on response delivery lets
an automatic gather command overtake it before the client accepts it. Reproduce
with the real pending-production response held only across that owned channel
boundary and observe the next genuine command. Retention must stop at client
acceptance, must not issue duplicate native equips, must not block forever after
acknowledgment, and must still allow a newer explicit user command to supersede
an older one. Consumption commands must not acquire unsafe replay semantics.
