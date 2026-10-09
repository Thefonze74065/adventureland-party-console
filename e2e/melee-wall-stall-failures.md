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
