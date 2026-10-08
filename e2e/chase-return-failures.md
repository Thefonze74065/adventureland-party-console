# Chase return home: failure inventory (#46)

Written before the change. Live incident (2026-10-07/08): the party ended up off its
home realm with `activeRealm` on EU III. After the characters reconnected on their
home (US II), the merchant looped "Returning FonzeMerch to EU III" for hours with
its queue held (upstream #74). Boss chase and event prediction both clear their
trip *before* travelling home, and a refused return switch is never retried.

Live ALData data and real realm switches can't run in the disposable E2E server, so
`scripts/tests/chase-return.test.cjs` drives `createBossChase` and
`createDailyChase` with simulated payloads and a realm switch that can refuse
(retained isolated exception, like `boss-chase-stall` and `realm-hop-blacklist`).

1. **A refused return strands the party.** A switch refused because a character is
   briefly disconnected or a bankboi transaction is running leaves the party on
   the chase realm, with no trip left to retry it.
2. **The retry is lost on restart.** A pending return must be persisted with the
   chase state and resumed after a coordinator restart.
3. **Retrying too often.** A refused switch is retried on the chase's existing
   5-minute retry delay, not on every poll.
4. **Retrying after arriving.** Once the party is on its return realm, the pending
   return clears; no further switch is sent.
5. **Fighting a manual move.** If the party is moved by hand to a realm that is
   neither the chase realm nor home, the pending return is dropped.
6. **Hopping onward instead of home.** No new chase trip starts while a return is
   pending.
7. **The other chase moving the party.** Boss chase and event prediction pause each
   other while either has a trip or a pending return.
8. **Disabling the chase.** Turning the chase off drops its pending return, as it
   already drops its trip; the operator has taken control.
