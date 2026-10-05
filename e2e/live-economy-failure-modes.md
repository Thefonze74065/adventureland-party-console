# Real-game economic failure modes

Written before implementing `live-economy.spec.ts`.

- A queued NPC purchase never executes on the native client, purchases the wrong
  quantity, charges twice, or loses its result when the coordinator restarts.
- A sale accepts stale inventory, sells more than requested, loses the remaining
  stack, or changes the UI without a real server inventory/gold mutation.
- A bank deposit/withdrawal reports success before the server transfer, duplicates
  a stack, loses part of it, or leaves the command active to run again after restart.
- Cancellation clears only the displayed job while the old client still spends
  gold or consumes items; a cancelled queued order revives after restart.
- An upgrade preview consumes resources; an upgrade reports completion before a
  real server result; a successful result is replayed after restart. A legitimate
  random failure is a valid server outcome, not an assertion that must be hidden.
- Automatic merchant routines race test setup and make an unrelated transaction
  look like success. The fixture disables those routines and the test compares
  exact pre/post item quantities and gold for the requested operation.

Setup may place an initial item in disposable inventory and seed account funds.
After submitting an action, observation is read-only. Tests use maintained
coordinator routes/native CODE, actual game socket handlers and authoritative
server snapshots. They never synthesize economic acknowledgements or assign the
expected inventory, level, gold or bank result.

Each journey records requests, native events, before/after server state and
coordinator durable state through the live fixture. Restart checks must wait for
fresh real-client reports before accepting unchanged conserved quantities.

Pinned upstream upgrade completion deletes `player.p.u_roll`; it is not a durable result. The scenario requires the native placeholder's actual slot and chance, then the matching final `upgrade_success`/`upgrade_fail` response (including `player.hitchhikers`) and consistent server inventory. Lucky-slot handling may relocate the item before the action. The pinned grade-zero level-one base chance is 0.9999999, not one; destruction is accepted only with an explicit native failure and an observed chance below one. A missing item alone never passes.

Combat-interleaved merchant handoff (written before the change):
- The fighter still waits for combat to end, so a durable fight blocks collection
  until the target dies. The journey requires cargo to move while that target lives.
- The fighter walks toward the merchant mid-fight or the post-handoff reunion
  clears its combat target, so damage stalls. The target's native HP must keep
  falling after the first transfer, and the fighter must never report `departing`.
- Interleaved sends push the socket past the native 200 call-cost window and
  trigger `limitdc`. The fighter's client must remain connected throughout.
- Combat or looting shifts slots during a throttle wait and the wrong item (or a
  protected Tracktrix) is sent. Cargo is conserved and the tracker stays put.
- Combat movement carries the fighter out of native send range (400) and the
  handoff fails with `distance`. The merchant must re-approach; the job must finish.
- A handoff that must unequip marked gear unequips it mid-fight. That path still
  waits for combat; it has no live coverage.
