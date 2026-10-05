# Boss chase: unwinnable-fight failure inventory

Written before the change. The live incident: boss chase took the fighters from
US II to US V for a Giga Crab whose estimated kill time (ETK) was about 115,000
minutes. The party died repeatedly, and the trip never ended, because a trip ends
only when the boss disappears. Live ALData data and real realm switches can't run
in the disposable E2E server, so `scripts/tests/boss-chase-stall.test.cjs` drives
`createBossChase` with simulated ALData payloads and realm switching.

1. **Choosing an unwinnable boss.** `pick()` requires at least `minEtaMinutes`
   left and prefers the longest ETK, so an absurd ETK ranks first. Only bosses
   whose ETK is between `minEtaMinutes` and the 120-minute stall limit qualify.
2. **An active trip never re-checks.** While the chased boss is alive, a trip
   stays forever. Once the boss has been live with the party on its realm for
   5 minutes, an ETK over 120 minutes (or no drain), measured only from samples
   since then, ends the trip and returns the party home.
3. **Leaving before engaging.** Pre-arrival samples (or none) could condemn a
   fight the party hasn't joined yet. The judgement waits 5 minutes from when
   the boss is live with the party on its realm, and ignores earlier samples.
4. **Respawn trips.** A party waiting ahead of a respawn has no live boss yet;
   the 5-minute window starts only once the boss is live.
5. **Ping-pong.** Right after leaving, the boss's samples still span our own
   failed fight. The same boss is not chosen again for 10 minutes (the rate
   window), so its ETK then reflects other players' drain alone.
6. **No way back.** A strong player who brings the ETK under 120 minutes makes
   the boss eligible again after that wait; the party returns.
7. **Return switch refused.** Travel failure keeps the existing retry delay and
   error reporting; the trip is already cleared, so it is not resumed.
