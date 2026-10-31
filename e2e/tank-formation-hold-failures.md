# Designated tank inside a priest formation: failure inventory

Written before merging Icelocked's PR #2 (review on #39). With a priest in the party the
role runner calls `formationMove`, `kiteIfNeeded` and `defensiveFormationMove` before
`approachCombatTarget`, the only place the designated tank was routed to
`tankMovementTick`. Live journey: `e2e/live-tank-formation-hold.spec.ts`.

1. **Tank kites.** A warrior tank in a warrior/priest/mage formation reports formation
   modes (kiting, approaching) and never `tank-holding`.
2. **Priest tank keeps healer positioning.** A priest tank orbits at its healing range
   instead of standing in melee and absorbing (the user's intended priest-tank role).
3. **Ranged ally starved.** While the tank holds, the mage does not land attacks.
4. **Tank holds while dying.** Below half HP, or (warrior tank) outside the priest's heal
   range, the tank keeps holding instead of moving with the formation. Not exercised live;
   the retained `priest-formation` cases cover it.
5. **Other fighters changed.** A non-tank warrior stops moving with the formation.

## 2026-10-25 replacement

The tank no longer walks to 35 units of its target. It leaves the formation for the
ordinary approach to its own attack range, so it stops outside a pack of idle monsters, and holds by not kiting its
own target until its HP drops below half (it holds again above 80%). Item 1 now reads
"the tank kites its own target"; item 2 is dropped (a priest tank holds at its healing
range); item 4 is covered by the `tankHoldsTarget` cases in `priest-formation.test.cjs`.
The journey counts samples with the target in range and no kiting.
