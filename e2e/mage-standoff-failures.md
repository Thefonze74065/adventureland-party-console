# Mage standoff against a fast target: failure inventory (#75)

Written before the change. Live and in ChronAL (`phoenix-mage` scenario: level-80
warrior, priest and mage hunting Phoenix), the mage targeted the Phoenix for the
whole fight at 210–218 units with 170 range and never attacked, while the priest
closed to 21–29 and the warrior to about 95. Only a mage counts its own target as a
"secondary" enemy, and secondary risk (safety 128 minus the edge separation over the
next 0.6 s, with a speed-50 Phoenix covering 30 units) outranks range in its score.

1. **Holding out of range.** Against a fast selected target the mage must reach its
   own attack range and attack.
2. **Walking into the target's reach.** While the target attacks the party, the
   danger term (`range + 4`, 124 for Phoenix) must still keep the mage out of it.
3. **Losing avoidance of other enemies.** Adds and other attackers must keep their
   full secondary avoidance; only the selected target is exempt.
4. **Changing other classes.** Warriors, priests and rangers already excluded the
   selected target; their movement must not change.
5. **Extra deaths.** The Phoenix scenario must not add deaths for any member.

## Result

The mage now scores its selected target's risk separately, below "within my attack
range". Measured with `tools/sim/scenarios/phoenix-mage.json` at seeds 1–8 against the
previous code (identical seeds, sim deterministic per seed), median mage-to-Phoenix
distance:

| seed | before | after |
| --- | --- | --- |
| 1 | 212 | 172 |
| 2 | 159 | 184 |
| 3 | 160 | 170 |
| 4 | 167 | 164 |
| 5 | 165 | 145 |
| 6 | 193 | 175 |
| 8 | 187 | 159 |

Seed 7 never brought the mage near the fight in either version. No deaths in any run.
Phoenix kills: 7/8 before, 6/8 after. Every fight that went unkilled (before: seed 6;
after: seeds 1 and 3) is the same separate stall: the Phoenix parks so the warrior's melee
approach is `terrain-blocked approach` while the tanking priest has no collision-safe
step. The warrior supplies most of the damage, so where the Phoenix parks decides
the kill time far more than the mage's position does.
