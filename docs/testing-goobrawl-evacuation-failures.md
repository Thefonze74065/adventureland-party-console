# Native Goobrawl evacuation validation

Recorded before correcting the existing E2E wait budget.

The event timer stopping does not remove native arena survivors. The scenario
seeds up to six monsters with five seconds of theoretical party damage each;
real approach, attack and projectile cadence takes longer. In native CI the five
observed monsters died after 20.6, 41.3, 65.9, 95.9 and 123.9 seconds. The existing
120-second evacuation wait expired before the final native death, while both
characters correctly remained in the arena fighting.

Preserve every observed-behavior assertion and the seeded HP. Give native combat
clearance plus the existing ten-second ended-event grace and transporter return
180 seconds. Keep the wait bounded so genuine missing evacuation still fails.
The two affected scenarios use a scoped 360-second overall budget so the
subsequent Hunt resumption checks retain time to execute.
Preserve both restart variants, real monster kill receipts, and subsequent Hunt
combat or turn-in checks. Inspect packet receipts and the final resumed Hunt
artifact when rerunning the existing scenarios.

Failure modes remain detectable: never-ending spawning or combat, no native
kill, stuck event notification, failed transporter exit, lost Hunt state after
restart, and failure to execute Hunt combat after evacuation.
