# Walking return cache failure inventory

The first focused Boo Boo rerun passed in 3.9 minutes with 33 verified evidence
files under `.build/pr64-booboo-return-cache-e2e-{results,report}`. It verifies
native doors, kill, Daisy reward and resumed Hunt, but returned through Town
without a communication hold. It therefore does not prove walking-cache reuse;
a separate native recovery case was required to verify that path.

The subsequent deterministic walking-cache case passed in 5.2 minutes with 35
verified evidence files under `.build/pr64-booboo-walking-cache-e2e-{results,report}`.
After an actual Boo Boo kill it declares only the existing checkpoint's walking
policy, then drops both real full and fast status reports. Native movement must
stop in the communication hold, resume under fresh ownership with
`routeSource=remainder` and `reusedRoutes=1`, retain a plot without Town, and
deliver the exact native Daisy reward. The historical checkpoint declaration
does not fabricate a Town failure, native arrival, damage or reward.

Native run37862993344 completed the Boo Boo quest kill, but the return repeatedly
lost preparation during communication holds at accepted report ages3010–3108ms.
The final party remained at Spooky Town311.8,-590, waiting for route version11;
the ledger subsequently resumed version12 before another freshness hold. Freshness
must continue stopping motion. Reusing previously validated walking work must not
reuse movement permission.

Before changing reuse, guard these failures: changed runtime, navigation revision,
convoy, destination, geometry, realm, map or instance; native transport underway;
an unreachable connector; forbidden Town or leave actions anywhere in the saved
plot; stale movement after a hold; and publication without current ownership.
Missing cache metadata must trigger a new search. The complete retained plot must
pass the normal movement installation validation before current-generation
publication. Unfinished search preservation is outside this narrow change.

The existing native Boo Boo failure is the pre-change behavioral regression.
Acceptance remains the real target kill followed by an exact native Daisy reward,
with retained native events, final states and action ledger. No monsters or
freshness thresholds are changed.

Deterministic native validation declares a historical walking-return checkpoint
only after the real quest kill. It preserves the existing cycle and destination;
it does not claim a native Town interruption. After actual owned walking starts,
the fixture drops both fighters' full and fast status POSTs before ingestion,
observes a real communication hold and stopped native motion, then restores
transport. Require fresh owned recovery, a walking-only reused remainder and the
same quest's native Daisy reward. Faults must be bounded, pending transport never
fabricated, and the network interceptor always removed in cleanup. Record both
checkpoint input and original/held/resumed state plus native cache metadata.

Local deterministic validation passed in5.2 minutes with35 verified evidence
files, archived under `.build/pr64-booboo-walking-cache-e2e-results/` and the
matching report directory. Native status faults produced a real held/stopped
party, then the fresh leader reported `reusedRoutes:1`/`routeSource:remainder`.
The reused plot contained no Town action and the real quest rewarded one token
at Daisy. Town eligibility later resumed naturally on another map; the fixture
does not suppress that native policy after the recovery assertion.
