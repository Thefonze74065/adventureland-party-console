# Anniversary staging vs. farm recovery: failure inventory

Written before the change. Found in a two-hour ChronAL simulation (goo farming, warrior
leading a priest): in the 90 s before an Anniversary round, the leader warped to Main's
town point, then `recoverFarmApproach` (movement owner `farm-recovery`, mode
`farm-local-approach`) walked it back toward the goos while its anniversary stage read
"holding in Main until anniversary deadline". Anniversary pre-emption stopped it about
126 px out, outside the 100 px staging radius, so staging warped it back again: a town warp
every ~9 s until after the round, one of which failed ("Failed town warp", convoy held).
`pollFarmingSpawnRecovery` and `pollFarmingCombatHandoff` already stand down while
`anniversaryBusy || anniversaryStaging`; `recoverFarmApproach` did not.

1. **Loop persists.** While staged, the leader must not walk toward its farm area: no
   `farm-recovery` movement owner, no repeated "Anniversary departure" between arrival
   in Main and the kiss.
2. **Stuck in town.** Recovery must resume once staging is cleared (kiss handed off,
   round ended, return convoy): the party is back in its farm area after the round.
3. **No defense while staged.** A selected target (something attacking in town) must still
   be fought; the guard only stops the no-target search and approach walks.
4. **Followers and merchants.** Their paths (grouped follower, merchant early return) are
   unchanged.
5. **Replay drift.** The check uses the deterministic ChronAL replay of the run that found
   it; the comparison is the same scenario and seed with and without the change.

## Why the staging flag was false (found by instrumenting every reset in a replay)

`runAnniversaryHandoff` recovers a pending slice handoff from the coordinator's
`handoffTargets` whenever the slice is still in the bag. With the merchant out of range it
drops the handoff and sets `anniversaryStaging = false`, and recovers it again on the next
call (1,690 resets in one hour of the replay). A slice left from the earlier round (~minute 30)
therefore kept clearing staging during the next round's pre-window, so farm recovery saw an
unstaged leader. Every handoff exit cleared staging without checking which round it was for.

6. **Old round releases new staging.** A handoff for round A must not clear staging while
   a different round B is in its 90 s pre-window or live.
7. **Same-round release.** A handoff for the round being staged (the normal path after a
   kiss) still releases staging exactly as before.
8. **No round in progress.** Outside any pre-window or live round, a handoff exit clears
   staging as before (nothing else may be left holding the party in Main).
9. **Featured hold released early.** When the character or its party is featured, the
   party holds in Main for one minute after the round starts and the anniversary tick
   releases it then. A same-round handoff (merchant out of range) must not release staging
   inside that minute; the replay after the first fix still looped there seven times.
