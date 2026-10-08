# Passing Goo native encounter setup

Recorded before adjusting the existing outbound/return scenario setup.

Native CI evidence shows the party walking directly through the seeded Goo,
without any native attack or death receipt. The fixture introduced it 250 units
ahead. Passing admission correctly requires both participants to install the
encounter reservation before firing. Native-client report round trips took
1.1–1.94 seconds; the first two reservations appeared 1.75 and 3.15 seconds after
the seed. The required exchanges outlasted the roughly 5.4-second approach and
range window at speed 79 and Warrior range 179.

Introduce the initial encounter 400 units ahead, matching the existing maximum
reservation lookahead. The same reachable native walking leg must be used and
movement must continue. Do not weaken admission freshness, alter characters or
existing monsters, add a movement hold, or manufacture attack/death evidence.

Failure modes remain observable: unreachable placement, introducing a monster
during Town instead of native walking, missing peer reservation, failure to
attack while walking, no native death, lost quest mission, failed return combat,
or missing real Daisy rewards. Keep both native hit/death receipt assertions and
the quest/reward assertions unchanged. Retain the seed, native packet receipts
and final Hunt state as verifiable artifacts.
