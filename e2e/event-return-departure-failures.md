# Event return departing from an aggressive spawn

Observed live (2026-10-06): after a coordinator restart restored an event return,
the warrior and mage farming bats in the cave held `event-return-town` for over
twenty minutes with navigation `departing`. Merchant emergency cleanouts for
both failed every minute with "Timed out waiting for convoy merchant pause",
because a character holding a navigation command outside a convoy cannot be
paused for collection.

Ways this departure can fail, each checked by
`live-event-return-departure.spec.ts`:

- `afterCombat` waits while any monster is engaged with the character. In an
  aggressive spawn a new bat engages before the last dies, so the wait never ends
  and the return never starts. The journey uses one harmless bat that cannot be
  killed in time, which makes this deterministic.
- Leaving an attacker the character is not faster than lets it chase the
  character down. Per the caught-by-monster rule only attackers it can outrun
  may be left behind; the journey asserts the bat is slower than the warrior.
- Merchant work that unequips gear or acts in place must still wait for combat
  to end; only walking departures may leave outrun attackers.
- Once the walk starts, the role loop must not turn back to fight the bat and
  cancel the route (seen live as "Unattributed movement stop").
- Starting the walk is not enough: the return must reach Main town and be
  acknowledged so the coordinator clears its recovery and command.

Out of scope: on Main itself the return casts Town, which damage interrupts;
that path is unchanged.

## Other walking departures

`character-travel`, `party-monster-travel` (party travel assembly) and
`return-leader` used the same unbounded `afterCombat` wait, so each could stick
in an aggressive spawn the same way. Additional ways they can fail, checked by
the same spec:

- Unlike the event return, `character-travel` and `return-leader` walk with a
  plain `smart_move`, not a convoy. While the departure is pending the role loop
  still fights whatever is engaged; a melee fighter stepping toward an outrun
  attacker cancels the route, so the walk never gets away.
- Party travel assembly hands over to a convoy; the convoy, not the departure
  wait, must own movement once it starts.
- Found while testing: the party-travel convoy then paused itself ("Defending
  party; convoy will resume after combat") for the same bat, both locally on a
  hit and in the coordinator, which defends against every reported travel
  attacker. Attackers the targeted member can outrun are now neither reported
  nor defended during party travel. A brief defense remains possible before the
  client has formed its convoy, from reports sent earlier.
- `return-leader` must reach the leader on another map, not merely start.
- An attacker the character cannot outrun must still be fought before leaving
  (unchanged; the departure keeps waiting for it).
