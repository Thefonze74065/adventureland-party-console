# Designated tank with its target behind a wall: failure inventory

Written before the change (2026-10-13). Since PR #2 the holding tank's movement belongs
to `tankMovementTick`, which only takes short straight steps toward its target at five
angles. Twice in `live-tank-formation-hold.spec.ts` the tank's goo sat behind terrain
and the tank stood still for the whole fight as "blocked: No terrain-clear approach for
the designated tank". Live journey: `e2e/live-tank-wall.spec.ts`.

1. **Stuck behind a wall.** A tank whose target has no straight terrain-clear approach
   never moves toward it.
2. **Fallback never returns.** After routing around the wall, the tank keeps the normal
   approach and never holds in melee.
3. **Unsafe route.** The fallback walks through terrain or skips the native collision
   checks the normal approach uses.
4. **Open ground changed.** With a clear straight line, the tank still steps in and
   holds as before (`live-tank-formation-hold.spec.ts`).

## 2026-10-25 replacement

`tankMovementTick` is gone: the tank takes the ordinary approach of every fighter and holds by not kiting its own target (`tankHoldsTarget` in
`characters/shared.js`). Item 2 now reads "never holds its target in its own attack
range"; item 4 reads "holds in range as before". The journey checks `is_in_range` and a
mode other than kiting or escaping, not `tank-holding` within 100 units.
