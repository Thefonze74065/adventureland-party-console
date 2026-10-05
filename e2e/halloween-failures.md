# Halloween attendance: failure inventory

Written before the change. Mr. Pumpkin and Mr. Green become attended events held
to Franky's standard. Slenderman follows in a second phase, gated on a rogue.

Native facts (pinned server): both bosses spawn at a fixed map point from
`G.maps[*].monsters`. They are broadcast in `S` as `{live, map, x, y, hp, max_hp,
target}` while alive and `{live:false, spawn}` until respawn (54 / 94 minutes).
They are cooperative, have 36M HP and no adds. Mr. Pumpkin: magical, range 520,
aggro 0.05. Mr. Green: physical, range 620, aggro 1, rage. Neither is in `G.events`.

1. **Broken event catalog.** The schedule snapshot reads `G.events[id].name`; a
   boss without a `G.events` entry throws and empties the whole Events dropdown.
   Rows must show each boss's native name and its live/respawn timer.
2. **Attending a boss that isn't there.** Travel starts only while `S[boss].live`
   is true on the current realm, using the broadcast map/x/y.
3. **Pulling the map.** Halloween and Spooky Forest are full of monsters.
   Attendance must target only the boss; hostile skills with other targets and
   area skills that can't exclude them are suppressed, as for Franky.
4. **Off-tank death or stall.** An off-tank attacks only after another living
   player has held the boss for 5 seconds. When the boss targets it, it leaves
   the boss's range (there are no doors to flee through on an open map) and
   returns once the boss holds someone else.
5. **Auto mode never falls back.** Deaths while attending a Halloween boss must
   count against that boss's auto-tank death limit, not Franky's.
6. **Franky regressions.** Generalizing must keep Franky's keepalive, door flee,
   exit convoy and saved settings unchanged.
7. **Stuck after the kill or on deselect.** A dead boss or a deselected row ends
   attendance and resumes the saved activity through the normal event return.
8. **Boss chase fights attendance.** Realm hopping stays with boss chase; once
   on the boss's realm, attendance owns movement and combat.
9. **Slenderman offered without a rogue.** Its row stays disabled, with the
   reason, unless a connected roster member is a rogue.
10. **Party members never start walking.** The broadcast x/y follows the roaming
    boss, and the coordinator merges a party walk only when every member names the
    same destination (within 1 unit). Found live: clients reading the broadcast
    moments apart disagreed and waited forever. Attendance walks to the boss's
    fixed spawn area instead.
11. **A targeted off-tank never flees (Franky too).** The off-tank's attack target
    is withheld until another player holds the boss, so movement must read the
    boss's aggro from the live entity. Found live; the Franky encounter-mode
    journey failed this way before this change as well.
