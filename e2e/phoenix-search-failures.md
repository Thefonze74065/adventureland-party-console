# Phoenix split search: failure inventory

Written before implementation. Each entry names the expected handling and how
it is observed. The live journey (`live-phoenix-search.spec.ts`) covers the
entries marked **live**; others rely on the coordinator design and review.

## Search

1. **Searchers bunch up.** Two fighters choose the same region while others are
   free. Assignment is one greedy round over a route-distance matrix. A region
   another searcher already claimed is used only when no free one remains.
   **live**: both fighters are in different spawn regions during the search.
2. **Async planner race.** A planning round finishes after the patrol was
   stopped, superseded, or reset by a kill. The result is ignored unless the
   same patrol and cycle are still current.
3. **Unreachable point.** A client `smart_move` fails or makes no progress for
   30 seconds. The point is skipped. If every point in a region is skipped, the
   region is marked incomplete for this cycle. If all five regions are
   incomplete, the patrol pauses with a visible reason.
4. **Searcher lost.** A searcher dies, reloads, goes stale, or becomes protected
   (event, low HP). Its claim is released so others can take that region; it
   gets a new assignment when it is fresh again.
4a. **A returning search assignment is rejected forever (reproduced in simulation).**
    Written before the fix. The client's loot filter (`runtime/combat/departure-loot.ts`)
    retires the id of every rare control it sees replaced and rejects that id from then
    on, so a finished loot or encounter cannot return. Search control ids are rebuilt
    from patrol, cycle, searcher, region and point, so the same assignment legitimately
    comes back: an Anniversary round withheld control (minutes 118.8-121.5), which
    retired the Spooky Forest assignment, and when the coordinator resent it every full
    status nulled it while the combat channel (which skips the filter) restored it. The
    control flipped once a second, each flip cancelled the route, farm recovery walked
    the searchers back toward the farm, the shuffling counted as movement progress, and
    the search never finished again (no kill for the last 70 minutes). Expected: search
    controls are never retired; a search assignment withheld and resent is accepted
    again; loot and encounter controls keep their one-way retirement.
4b. **A failed encounter route blocks the loot walk forever (reproduced in simulation).**
    Written before the fix. An encounter and its loot stage share one control id, and
    `pollRareHunting` never retried a failed route for that id (search and converge
    routes already retry after 5 s; the coordinator only reads failures for search
    points). A walk stopped mid-fight by another mover ("Unattributed movement stop")
    left the leader idle with the loot control for 15+ minutes: the loot stage never
    ended, and the leader stayed out of the search. Expected: encounter and loot routes
    retry after the same 5 s, so the leader walks to the kill and loots.
5. **Coverage before respawn.** A searcher reaches a region before the Phoenix
   has respawned. It waits at the region's first point. Coverage counts only
   observations taken after `readyAt`, plus the one-second dwell.
6. **Endless empty cycle.** All five regions are covered and no Phoenix was seen
   (another party killed it, or it wandered). A new coverage cycle starts.
7. **Long client routes.** Cross-map walks take longer than the old 30-second
   rare route timeout. Search, converge, shadow and engage routes have no
   client timeout; the coordinator's no-progress watchdog decides.
8. **Searcher attacked.** A monster targets a lone searcher. The client releases
   movement and combat ownership to ordinary defense until no visible monster
   targets it, then resumes the same control.

8a. **Searcher stalls under attack (hypothesis, not reproduced).** The live
    stall happened at a Mainland bee spawn. The live journey starts both fighters
    there, but level-80 fighters were not attacked and walked straight out, and
    the live stop stacks pointed to 8b instead. No code change; the journey stays
    as coverage that a search starting on an aggressive spawn still covers a
    region. If a lower-level searcher is ever seen stalling under attack, the
    suspects are grouped-mode target admission (it may block attacking a lone
    attacker) and a watchdog that counts back-and-forth movement as progress.
8b. **Party-wide pause from one fighter.** Seen live: FonzeWarrior's status
    responses alternated between a search control and none, and each empty one
    cancelled its route, so it shuffled in place for over 30 seconds. Every
    member's pending command, low HP, or event, and a leader heartbeat older
    than 3 seconds, paused the whole patrol. Each pause also cleared every
    assignment. While searching, only party-wide conditions (town, recovery,
    escape, events, Hunt turn-in, leader missing over 10 seconds) pause the
    search; a fighter's own condition removes only that fighter. Assignments
    survive pauses and heartbeat gaps under 10 seconds. A rate-limited
    diagnostic names the fighter and condition whenever a search control is
    withheld.

## Sighting and convergence

9. **Spotter attacks too early.** While anyone is converging, the client rejects
   the Phoenix as a target unless someone is already fighting it.
   **live**: no party hit lands on the Phoenix before every fighter is in range.
10. **Premature grouped selection.** Patrol candidates are not fed into grouped
    combat while the encounter is converging, so formation cannot select the
    Phoenix early.
11. **Sighting on another map.** A sighting from a searcher on a map the leader
    is not on must still start the encounter (the old leader-map filter is not
    used for patrol sightings). **live** whenever the first spotter is not the
    leader's map.
12. **Spotter briefly loses sight.** The encounter tolerates 10 seconds without
    a fresh sighting while converging, so the spotter can re-acquire it.
13. **Phoenix moves while members converge.** Converge and shadow destinations
    follow the latest sighting, and the client re-routes when the destination
    moves more than 100 units.
14. **Converge never completes.** The deadline is the later of five minutes and
    twice the slowest member's planned travel time. After it passes, the party
    engages with whoever is in range, and the dashboard names the missing members.
15. **Outsider already fighting.** If the Phoenix has a target (another player,
    or a party member it aggroed), members in range engage immediately; the
    others keep converging.
16. **Another party kills it while we shadow.** This is an unengaged death: no
    loot, and the respawn wait starts from the death time.
17. **Encounter released by grouped-combat checks.** While converging, the
    selection-released and claim checks are skipped. They apply again after
    the party has gathered.

17a. **Patrol Phoenix permanently rejected.** Found live: the party gathered,
    grouped combat selected the Phoenix but was still settling formation, and
    the 30-second no-progress rule ended the encounter. Retry evidence then
    rejected that Phoenix until a fighter was in attack range, so every later
    sighting, including on-route ones, was dropped while fighters walked past.
    A patrol Phoenix is never rejected that way; a failed attempt only gets the
    3-second cooldown, and any existing rejection is cleared on the next sighting.
17b. **No-progress clock during formation.** After the gather, the 30-second
    no-progress clock waits until grouped combat locks the Phoenix. The
    five-minute limit from the gather still bounds the formation phase.

## After the kill

18. **Looter blocks the spread.** Only the leader keeps the loot control. Other
    fighters get search controls once grouped fights have finished, and they
    pre-position for the respawn. **live**: a non-leader fighter leaves while
    the leader's loot is still pending, or is in a different region before `readyAt`.
19. **Stale kill or restart.** `readyAt` persists in the checkpoint; restart
    rebuilds assignments and coverage instead of trusting old positions.
19a. **Realm hop ends the patrol for good.** Seen live: boss chase moved the
    fighters from US II to US V. The leader's realm no longer matched the
    patrol's, the patrol counted as superseded, and `stop()` turned it off, so
    the party idled after coming back. A realm change alone suspends the patrol
    instead: the checkpoint keeps its realm and respawn deadline, and the patrol
    resumes when the leader is back on that realm.
19b. **Patrolling the wrong realm.** While suspended, nothing may restore a
    patrol on the foreign realm; boss chase or the event there owns the party.
19c. **New navigation while away.** A revision, focus, policy, or leader change
    while suspended still stops the patrol for good, as it would at home.
20. **New navigation.** Revision checks cancel search, converge and engage
    controls exactly as before.
