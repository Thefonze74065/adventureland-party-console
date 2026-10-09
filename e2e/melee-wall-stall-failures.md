# Melee fighter behind a wall from an engaged target: failure inventory (#83)

Written before the change. In ChronAL (`tools/sim/scenarios/phoenix-mage.json`),
seeds 1 and 3 park the Phoenix against a wall while it chases the priest. The
warrior holds at about 150 units with `terrain-blocked approach` for the rest of
the fight. `recoverFormationCorner` only searches for a detour to the approach
point on the warrior's bearing, which lies behind the wall. Party terrain recovery
is limited to planned targets, so nothing else moves the warrior. The fix lets
the local detour aim at any approach point around the target that is reachable
from the target's own position.

1. **Still stalled.** On seeds 1 and 3 the warrior must reach melee and the
   Phoenix must die within the 5-minute run.
2. **Unreachable alternative.** An approach point on the far side of another wall
   is useless. Only points the game's `can_move` reaches from the target's own
   position may be used.
3. **Walking through danger.** The detour keeps the existing
   `formationSegmentSafe` checks on both legs, so it must not walk the warrior
   through other monsters' reach. Every step still passes `formationStepSafe`,
   so it must not leave the priest's healing range.
4. **Oscillation.** Once the warrior reaches a waypoint, the next tick must not
   bounce it back toward the blocked bearing. The new bearing becomes reachable,
   or the next waypoint keeps going around.
5. **Regressions where nothing is blocked.** When the bearing point is reachable,
   nothing changes. Seeds that already killed the Phoenix (2, 4, 5, 6, 8) must
   still kill it with no deaths, and the mage must still close to range (#75).
6. **Cost.** At most 16 `can_move` checks from the target, of which the 4 reachable
   points nearest the fighter join the ring search, at the existing 1 s retry.

## Leaving healing coverage for a detour

Written before the change. Seed 4 showed a second limit. The priest kites the
Phoenix around a wall and strands the warrior 187 units from it, outside its
108-unit healing range. The only detour moves farther away (225), and
`formationStepSafe` refuses any step that increases the priest's distance, so the
warrior holds for the rest of the fight. The fix lets a detour step leave
coverage under strict conditions: the fighter is melee and not the priest, no
monster targets it, its HP is at least 60%, and its own target is attacking
someone else.

7. **Separated fighter gets attacked.** When anything targets the fighter, the
   exception ends on the next tick. Ordinary steps may then never move farther
   from the priest, so it must not keep walking away.
8. **Low HP away from the healer.** Below 60% HP the exception doesn't apply.
9. **Scope leak.** Only the local wall-detour steps from `recoverFormationCorner`
   use it. The formation optimizer, the priest's own steps and ranged classes
   keep the coverage rule. Monster-safety checks (`safeCombatPoint`, secondary
   risk) still apply to every detour step.
10. **Seed 4 still stalls.** On seed 4 the warrior must leave the corner, reach
    melee, and the Phoenix must die, with no deaths on seeds 1–8.

## Result

ChronAL `phoenix-mage.json`, seeds 1–8, 5 minutes each:

| seed | before #83 | detour only | detour + coverage exception |
|---|---|---|---|
| 1 | stalled at 150, alive | killed 3.27 | killed 3.27 |
| 2 | killed 3.69 | killed 3.61 | killed 3.61 |
| 3 | stalled at 125–150, 87k HP left | melee, 16.8k left | melee, 2.1k left (fight began 3:43) |
| 4 | killed 4.09 | stalled at 150 (coverage), alive | killed 4.22 |
| 5 | killed 4.04 | killed 3.94 | killed 4.11 |
| 6 | killed 3.79 | killed 3.51 | killed 3.51 |
| 7 | killed 4.74 | killed 4.39 | killed 4.39 |
| 8 | killed 4.61 | killed 4.81 | killed 4.79 |

No deaths or errors in any run. While separated on seed 4, the warrior's HP never
fell below 9,598 of 10,107.
