# Ice roamer and CI failure investigation

Failure modes recorded before implementation:

- A missing native sprite texture/frame throws in `set_texture`, unwinding `draw`
  before it schedules its next frame. Position interpolation and entity updates
  then stop. The live 17397 log records this stack at 10:58:42 and 10:58:51,
  followed by 15-second draw intervals and the reported 11:07:05 convoy stalls.
- Rendering recovery must retain native movement, entity removal, damage and loot;
  it must not manufacture positions or extend the walking watchdog indefinitely.
- An unavailable cosmetic frame must be retried when its texture becomes available.
  Valid frames and unrelated native errors must retain their original behavior.
- CODE reload must not accumulate renderer wrappers or leave callbacks owned by a
  disposed headless CODE scope in the longer-lived game window.
- CI catalog discovery can starve behind one timer yield per item. No catalog is
  sent until all items finish; empty monster locations block virtually every Hunt
  scenario and empty item catalogs block purchases. Cooperative preparation must
  remain bounded per turn without requiring one timer for every cached item.
- A slow scheduled departure must not spend the route-failure budget for readiness
  drift. Actual failed walking must retain bounded recovery and ownership fencing.
- A suite timeout must leave useful results and sufficient time for reporting.

Use native gameplay for movement, successive Ice Roamer kills and quest rewards.
The narrowly retained renderer regression uses the pinned native `set_texture`
implementation because the disposable server is client 15555, while the incident
was on 17397. Its purpose is native missing-frame behavior and host lifecycle,
not proving public-server gameplay. Live account diagnostic captures stay private.

Full-suite follow-up failure modes (recorded before the recovery change):

- A native merchant death during rendezvous returns an explicit failure receipt
  before revival. Retiring this job loses the user's collection intent; immediately
  dispatching the next job while dead loses that work too. Preserve unfinished
  work with the existing bounded interruption retries, keep confirmed receipts,
  and require a fresh living merchant before dispatch. Validate the existing native
  queued/active death and restart collection scenarios with cargo conservation.
- External polling can miss short native Town casting windows on loaded runners.
  Fault injection must observe the actual native cast packet and issue the real
  stop in the client, retaining evidence of leader arrival and follower position.
- A rare killed by another party member can leave the leader outside loot range.
  Rejecting the loot control because of distance prevents the very movement that
  would reach it. Preserve current-place ownership while approaching; completion
  must still require proximity, a real loot pass and a subsequent observation.
- Loaded native browser timers can miss the 500 ms departure window repeatedly
  even after accepting the schedule and while holding a fresh matching lease.
  The Linux anniversary-return case exhausted readiness this way. Allow a bounded
  1500 ms execution tolerance after an already accepted schedule, while retaining
  signal expiry, origin, speed and ownership checks. A newly received late schedule
  remains rejected; a 2500 ms injected timer stall must still force regrouping.
- Keep-moving combat previously began its multi-party reservation exchange only
  once a monster entered attack range. On a moving party, ordinary network delay
  could consume that entire range window. Reserve a visible eligible monster
  ahead on the current walking direction, without issuing attacks, generators or
  stopping movement. Native range checks and all-party admission still gate the
  eventual attack. Seed the E2E encounter ahead on an actual walking leg rather
  than introducing it at the last possible melee-range instant.
- A delayed Town packet can arrive after walking recovery starts, moving one
  member back to Town and interrupting its walk. After the bounded recovery hold,
  preparing from the retained Town rally while the leader remains far away loops
  on "Leader moved from planning origin". Reassemble at that rally before route
  preparation, then plan from the leader's actual stopped position. Preserve the
  walking timeout, recovery budget, owner checks and restart behavior.
- Ambient Bee damage can interrupt the leader's cast before the partial-Town test
  injects its follower-only interruption. Seed peaceful Bees for this navigation
  scenario, recording and restoring their aggression settings; native casting,
  interruption, walking, collision and reward handling remain under test.
- A successful native fallback arrival can leave its recovery ledger in phase
  `native`. Dispatching that entry while already farming creates endless new
  convoys and repeatedly revokes combat ownership. Retain the ledger/budget, but
  do not dispatch it after confirmed arrival unless a new owned route fails.
- Restart can restore a death blacklist before the native monster catalog arrives.
  Removing an existing saved blacklist entry must work during that window; adding
  an unknown species must still fail. Exercise the native death/restart journey
  while dropping actual catalog-bearing requests until the removal completes.
