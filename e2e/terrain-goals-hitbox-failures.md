# Party terrain recovery against a large target: failure inventory

Written before the change. Seen live: another player fought a Phoenix at
(738, 1702) on Mainland. The party gathered about 425 units away, at
(349, 1532). Terrain blocks the straight line, so grouped combat handed
movement to the party terrain recovery, which reported `goals: []`
(attempt 2) and held all three fighters still. `terrainRecoveryGoals` puts
16 points on a circle whose radius is measured from the target's centre
(34 for a range-36 warrior), then requires an edge-to-edge clearance
(20). Phoenix's 61×55 hitbox covers that whole circle, so every point
fails for a melee fighter against any large monster.

1. **Still no goals.** Against a Phoenix behind a wall, the recovery must
   report goals and route the warrior around, and it must land hits.
2. **Goals inside other monsters or walls.** Widening the circle must keep
   the endpoint checks (`terrainRecoverySafe`): no goal in a wall or within
   another monster's safety radius.
3. **Too far to attack.** The wider circle must still be within the mover's
   attack reach once it arrives. Widen only by the two hitboxes, which is
   the edge distance the formation already measures with, so formation can
   finish the approach.
4. **Small monsters change.** For targets with small hitboxes the goals stay
   nearly where they were.
5. **Ranged movers.** Mage and priest radii change by the same hitbox margin
   and stay within their range.

**Why isolated:** the live harness has no player outside the party to hold a
Phoenix away from it. As soon as the party gathers, its ranged fighters hit the
Phoenix and it counts as engaged, which skips this recovery. A stunned Phoenix
fixture desynchronised the clients' view of its position, so it could not stand
in. One harness run still showed the bug natively: after the party moved on to a
native Phoenix, the warrior's terrain recovery started with 0 goals. The
retained test `scripts/tests/terrain-recovery-goals.test.cjs` therefore runs the
real `terrainRecoveryGoals` and `terrainRecoverySafe` against a 61×55 Phoenix
and a small monster, with every walk allowed. It covers entries 1, 2, 4 and 5;
entry 3 holds by construction, since the circle only grows by the hitbox edges
that formation already measures with.

## Result

`terrain-recovery-goals.test.cjs` failed before the fix (0 goals around the
Phoenix for a warrior; small targets also failed) and passes after it. Every goal
now sits exactly at the mover's reach by the game's `distance()` (34.0 for a
warrior), clear of other monsters, and within a ranged mover's attack range.
Regression: the original Phoenix live journey passes; ChronAL phoenix-mage seeds
2–4 behave as before. Seed 1 killed the Phoenix at 3.22 min, but its mage later
died to two bigbirds while searching alone. Terrain recovery was not active then
(the mage was in ordinary grouped combat, held by "no collision-safe segment"),
so that is a separate, pre-existing exposure of lone searchers.
