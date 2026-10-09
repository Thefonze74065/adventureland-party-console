# Absorb Sins during boss encounters: failure inventory

Written before the change. Seen live at Franky (level2w): FonzePriest, the party's
designated tank but set to `offtank` for Franky, died about every 30-40 s, once to Franky
and eight times to Mummies, each death 10-20 s after one or two Absorb Sins casts. The
"ranged distance" the user saw was the priest walking back from respawn. `absorbDecision`
lets the designated tank (or leader) pull any ally's attackers onto itself, and its
`safeTransfer` check only looks two seconds ahead; at Franky the fighters stand in the
Mummy swarm, so the priest kept pulling it. The encounter routine (`tank` / `offtank`,
with `auto` resolved by the death limit) governed positioning only.

Change: during a boss encounter (Franky), the priest uses Absorb Sins only when
its routine for that encounter is `tank`.

1. **Off-tank still absorbs.** With a boss encounter active and the priest's routine not
   `tank`, `absorbDecision` makes no decision, whatever the designated tank or leader is.
2. **Boss tank loses its rescue.** With the routine `tank`, Absorb Sins works as before
   (same ownership, MP and `safeTransfer` checks).
3. **Ordinary farming changes.** Outside boss encounters the routine is ignored and the
   designated tank or leader absorbs as before.
4. **Stale routine.** The routine comes from the current boss encounter on each context
   build, not from a setting cached across encounters.
5. **Auto routine.** `auto` resolves to `tank` until the encounter's death limit, then
   `offtank`; the check uses that resolved value.
