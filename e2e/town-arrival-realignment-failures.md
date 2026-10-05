# Town arrival realignment: failure inventory

Written before the change (runtime/characters/movement-executor.ts).

Found in a two-hour ChronAL simulation (goo farming), during repeated Anniversary staging
warps: Town landed the warrior at (16, 34) (the server scatters arrivals), `alignArrival` sent one connector move to (0, 0) and marked the step aligned,
and the character never moved; 12 s later the step failed ("Failed town warp"). The
server ignores a `move` whose map counter `m` predates the warp's `new_map`, without a
response, so a connector sent in that gap is lost and was never resent.

1. **Dropped connector.** A connector the server dropped must be resent while the
   character is still off the spawn, not moving and has made no progress; the warp's 12 s
   deadline still bounds the whole step.
2. **Call cost.** No resend while the character is moving or has progressed within the
   last second: one move per second at most, as before for a working connector.
3. **Collision check.** The connector is still collision-checked before it is first sent;
   an arrival with a blocked connector fails as before.

Verified with the deterministic replay of that run (same scenario and seed): the original
failed one warp at 01:00:39 ("Failed town warp", convoy held); with the change, all 17
staging warps in minutes 58-70 completed, with no convoy failure.
