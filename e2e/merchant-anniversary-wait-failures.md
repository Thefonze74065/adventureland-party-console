# Merchant work during an unavailable Anniversary round: failure inventory

Written before the change. Seen live: after a coordinator restart at 16:30 the merchant
stood idle for the whole five-minute round with six queued jobs, its status "waiting for
PotatoMerch to become available". The featured player was another player the server
reported as unavailable (`available: false`: offline, dead, stealthed, invisible or on a
private map). `merchantAnniversaryControl` marks the merchant `reserved` for the 90 s
pre-window and the whole live round until its visit completes, and both the dispatcher
and the merchant's own command handler refuse work while reserved. `kissDue` already
requires an available target; `reserved` did not.

Change: while a round is live, its featured player is unavailable and the merchant is not
the one featured, the merchant is not reserved, so queued work runs.

1. **Idle through an unreachable round.** With the featured player unavailable, queued
   merchant work is dispatched and accepted during the live round (not deferred).
2. **Missed visit when the target returns.** If the featured player becomes available
   mid-round, `kissDue` turns true: the dispatcher starts no new job, a running job pauses
   at its next checkpoint ("Service paused for anniversary") and is preserved in the
   queue, and the merchant visits.
3. **Pre-window unchanged.** The 90 s before a round stays reserved: availability is not
   known yet, and the merchant must be in Main when the round opens.
4. **Featured merchant unchanged.** When the merchant itself is featured it still holds
   for the first minute, whatever the `available` flag says.
5. **Active visit unchanged.** A visit in progress (`busy` or `kiss-active`) still owns
   the merchant.
6. **Both sides agree.** The dispatcher and the merchant's command handler use the same
   control, so a job the coordinator sends is not deferred by the client.
7. **Missing flag.** A round payload without `available` counts as available (as
   `kissDue` already does), so the merchant stays reserved.
