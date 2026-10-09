# Cave route preparation regression boundary

Native E2E remains authoritative for generated Cave terrain, shared pacing,
combat, votes and arrival. The retained movement service fixture checks only
deterministic planner admission and bounded waiting before implementation.

Failure modes:

- A follower duplicates the leader's expensive native search rather than waiting
  for the validated route from their shared assembly point.
- Waiting prevents a follower from accepting the leader's route, or importing a
  route leaves a prior native search running.
- Waiting/import bypasses geometry identity or collision validation.
- A generated floor needs more search work than the ordinary 30-second budget;
  its explicit larger budget becomes unbounded or changes ordinary navigation.
- Cancellation leaves waiting followers moving or allows a retired command to
  install another route.
- A newly triggered native vote hides background controls from accessibility;
  a test mistakes the expected modal state for missing Cave controls.

The native Cave journey must still confirm both characters actually reach the
selected destination, conserve the shared route and cruise, resolve real votes,
and stop after cancellation. It retains screenshots and native state artifacts.
Its arrival and cumulative required-room checks allow 300 seconds each, within
a 900-second overall journey. A reproduced random floor completed its final
farewell vote and opened the stairs milliseconds after the earlier 180-second
room-completion deadline; the longer bound preserves the completion assertions.

The cruise journey can exhaust a 45-second motion assertion while the selected
route is still assembling or preparing, then show real shared movement in the
native failure artifacts. Preparation reports for the earlier map waypoint or
assembly command must not satisfy the selected farm-route barrier. Match the
current target ID, run, floor and each participant's actual command and prepared
travel report. Allow 120 seconds for the bounded preparation stage, then retain
the 45-second displacement check against the original departure positions and
the native shared engine and matching cruise checks. Preparation alone never
establishes that either character moved.

A subsequent CI floor reached the cruise checkpoint, stopped correctly, then
resumed its owned serial-3 Bat Roost route. Native bat kills (502, 507 and 501)
and the real ten-second next-wave announcement showed productive combat pauses;
both actors retained prepared serial-3 routes and advanced toward the room.
The old 120-second resumed-room assertion combined new assembly/preparation and
those fights. Match the resumed prepared commands independently of combat
readiness, then allow the existing 300-second room-arrival budget. Keep both
characters within 70 of the selected point, all stop assertions and native
engine/cruise evidence; combat alone never substitutes for actual arrival.

## Assembly displaced after native completion

Native combat can displace a participant after its gather command completed.
The old completion journal prevents executing the same command again, while the
coordinator still requires current positions at the assembly point. This can
strand a newly selected route before departure. Recovery must issue a fresh
owned gather ID only for a completed current gather that drifted beyond the
assembly tolerance. Require fresh, living, combat/loot-ready observations on the
same run and floor; reject stale receipts, different commands and coordinates,
wrong maps/runs, pending combat, and in-flight gathers. Keep the original target
and arrival conditions. Bound repeated regroup attempts explicitly instead of
silently looping; old receipts must not authorize departure or overwrite a
newer command. The native journey still proves both actual boss arrivals.

The deterministic native assembly case uses actual collision-checked walking
and a temporarily slow native cruise to keep a peer's gather in flight. It
observes a real completed gather, displaces that actor with another native walk,
and verifies a new owned gather receipt and real return before both actors
reach the selected waypoint. Original cruise is restored in a finally block.

A visually verified rendered Cave minimap had 148 distinct colors and failed
the old arbitrary 150-color criterion. Screenshot verification now requires
material native orange floor coverage, variation between neighboring floor
pixels, and the bright native actor sprite in the camera-centered region.
Both pixel counts and screenshots are retained; blank or flat terrain cannot
satisfy these checks. The minimap camera follows the actor, with sprite feet
at the center (the sprite lies immediately above that point).

The exact archived 148-color Priest canvas measured 13,325 orange floor pixels,
1,652 transitions from native dark-neutral floor speckles to orange floor, and
10 bright centered actor pixels. All exceed the coverage/texture/actor limits
(200/200/3). The texture neighbor accepts dark neutral or warm pixels, excluding
purple walls/background. Constant purple and constant orange negative-control
images have zero qualifying texture transitions and zero bright actor pixels;
both fail, independently of their floor coverage.

## Shared route connector after combat drift

A validated Cave route can be interrupted by native combat/formation movement.
The current actor can then no longer reach the next retained waypoint directly,
even though the original edge was valid. Both leader and follower must retain
collision checks. A Cave-only opt-in may plan one bounded three-second same-map
walking connector to that next waypoint, then validate the entire bridge and
remaining owned route before resuming. Reject map/instance changes, transitions,
supersession, a second repair, unsafe bridges or moved endpoints. A failed
shared repair must fail the owned journey; it must never independently plan a
new destination route. Preserve barriers, runtime/revision, cruise, remaining
endpoint and generic shared-route behavior. Native stair and full journey
assertions remain the acceptance boundary.

## Native connector validation and transition choice race

The first native connector run completed four distinct walking-segment repairs
(one Priest and three Warrior journeys), including two stairs connectors; no
shared connector repair failed. Both native actors reached floor 1. The test
then timed out clicking a stale previous-floor `Take 2 Amber` reply as the modal
was replaced by the new-floor shop. Test failure modes: the goal can already be
true before a choice click, or become true during that click; repeated pending
choice clicks can target obsolete replies. Check both real floor values first,
submit each choice ID once, retain successful farewell vote evidence, and only
accept a click error when a fresh native observation proves both actors already
reached floor 1. Every other click error must still fail the test. Preserve the
farewell vote requirement, collision checks and actual floor transition.

The next real minimap rendered 24,148 orange floor pixels and 3,013 texture
neighbors, but the Warrior's small centered sprite contained only two bright
highlight pixels and 13 cool armor pixels. The archived 148-color map contained
10 highlights and 22 cool armor pixels. Require the paired centered highlight
(at least one) and cool armor footprint (more than eight), preserving both
terrain requirements. Flat orange floor and purple background have neither;
flat steel armor has no highlight, and flat white has no cool armor footprint.
These paired visual criteria accept both verified native sprites and reject
those blank/flat negative controls. Keep screenshot and numerical artifacts.

After actual floor arrival, a newly activated native shop choice can still hold
an opaque modal over the exit controls. Read that fresh choice, submit its
available free reply through the real UI, wait for native resolution and modal
closure, and dismiss the encounter result before exercising Exit/Stay/Confirm.
Record the new-floor choice ID, submitted option and resulting native state.
Preserve all exit confirmation and final held-phase assertions.

## Resumed selection: combat/assembly precedes native route planning

CI 37766427937 stopped Warrior travel at 1791457346286. Six actual Cave Guard
and Wolf kills continued through 1791457418407 (72 seconds after Stop). Native
assembly movement completed for Warrior at 1791457438838 and Priest at
1791457440223 (94 seconds after Stop). At the 120-second preparation deadline,
the owned move was only 17 seconds into native planning; both actors remained
815 units from the Bat Roost, ready, with completed gather receipts and no move
failure. This was not a completed-route race or a hung planner. Failure mode:
a single preparation wall-clock bound charges defensive combat and reassembly
against the native 90-second planning allowance. Only on resumed selection,
first await fresh ready actors with the current run/floor/target and owned move
commands, bounded by the existing 300-second combat allowance. Then start the
existing 120-second matching route-prepared guard. Keep initial preparation,
actual arrival within 70, native planner limits and overall 900 seconds intact.

## Stop action acknowledgement

CI 37768552032 read coordinator commands immediately after the Stop travel DOM
click and observed the previous move command. The persisted native artifact
then shows Stop succeeded: commands are empty, travel absent, automatic progress
is disabled, and the Priest's owned move was cancelled with `Dungeon command
changed`. A DOM click is not acknowledgement of its asynchronous action. Both
explicit Stop checks must poll the observable coordinator state for no owned
move commands, no travel and disabled automatic progress, within 20 seconds.
Keep unrelated no-move assertions and defensive combat/movement allowed.

## Distinct shared walking edges after repeated native combat displacement

CI 37770004187 repaired Warrior journey 16's connector from (2748,303) to the
retained waypoint (3108,435), then later native combat displaced Warrior back
to (2830,304) before the next destination edge to (3368,440). The one-repair
journey cap rejected this distinct second edge; Priest's separate successful
bridge reached within 32 of the boss. Whole-command retries had exhausted their
three repairs. Failure modes for a narrowly expanded Cave boundary: unbounded
repairs, repeated repair of the same retained endpoint, generic behavior change,
unsafe or cross-instance bridges, transition/superseded ownership, loss of
remaining target and implicit full destination fallback. Allow at most three
Cave-only distinct retained endpoints per journey, each with its own three-second
native bridge and complete remaining-route validation. Refuse a repeated
endpoint or fourth repair; preserve all generic one-repair behavior. Write
isolated regressions before implementation for distinct successive endpoints,
a repeated endpoint, and the three-endpoint cap.

## Isolated assembly displacement must avoid native combat room aggro

In the 4e6 regroup scenario, the declared eastward peer waypoint was only 256
from a native farm center. Real native farm actors aggroed the Priest and combat
returned the Warrior within the original 50-unit assembly radius before all
actors became ready. Thus the intended regroup condition never existed; no
longer timer would create it. Keep native generation and room state untouched.
Choose the real 160-unit peer walk and 85-unit Warrior displacement only when
the actual game collision checker permits them and every sampled path point is
at least 410 from every current-floor native farm/patrol/fight/boss/darkmage
center. Sampling at intervals at most 20 leaves more than 400 clearance between
samples. Record native centers, selected endpoints and measured clearance;
fail explicitly if no safe path exists. Original Cave combat coverage remains
unchanged, and regroup still requires real native movement and owned receipts.

## Local join on the original issued walking edge

CI 37773027894's failed connector targeted a retained endpoint about 1,040
units away. Its three-second native search timed out, causing whole-command
regroup/replanning; the next journey was visibly progressing at failure.
A local repair must project onto the original collision-validated walking edge
that was actually issued, retained across combat pause. Cache only same-map
walking edges, clear on reset/consumption, and require cached `to` to be the
current retained first step. Reject stale edges, transitions, changed instance,
changed owner/runtime and projections more than 150 units from the actor.
Plan the three-second connector to the local projection, then explicitly append
that exact join (collision-validating any coarse planner gap) and retain the
original endpoint and all remaining route steps. Complete validation remains
mandatory. Keep the three-distinct-endpoint cap keyed to the original retained
endpoint; no new destination fallback, farther/future join, or budget increase.
Before code, regressions cover long-edge local repair, exact coarse join,
unsafe coarse join, and stale retained endpoint.

## Confirmed corner consumption before the next walking dispatch

CI 37777846237 was genuinely stalled, not merely slow: current leader travel 9
failed and remained unchanged for roughly 137 seconds after the three whole
route repairs were exhausted. The actor was at (3219.244,2402.466), only 58.2
units behind the consumed corner (3161.044,2402.466), before the next retained
edge to (2981.044,2297.466). The executor had cleared its edge on consumption;
combat paused before the next dispatch, so the safe 58-unit join was unavailable
and the 260-unit direct endpoint exceeded the no-cache repair bound.

Failure modes: caching a corner not actually reached, stale/superseded steps,
invalid changed geometry, crossing map/instance, future door/town transitions,
or losing an existing valid edge before completion. After confirmed walking
consumption, cache the exact consumed vertex to the current next walking step
only when same-map and freshly collision-valid. Retain it across pause, clear
on reset/transition/stale endpoint, and preserve all projection/ownership/150-
unit/three-second/exact-join/full-validation/repair-count bounds. Pre-code
regressions cover pause between consumption and next dispatch, stale replacement,
invalid next edge, and a transition successor.

## Manual Stop/resume fixture avoids an active native farm

CI a931 (37783695714) left serial 3 assembling for 300 seconds: the
healthy Warrior waited at (475,614), while Priest fought successive native farm
waves at (540,834), 229 units away. Neither issued the resumed owned move.
This is the intentional all-ready defensive assembly guard, not a planner
failure. The manual Stop check must use a declared native waypoint segment
outside room aggro, then select the original farm and retain its real arrivals
and combat. Failure modes: unsafe staging, crossing collision geometry or aggro,
insufficient displacement, stale waypoint identity, and dropping farm coverage.
Validate straight segments natively, sample combat-room clearance >=410 and
live enemy clearance >=300, record geometry, use the actual map UI twice,
and preserve displacement/cruise/Stop/owned preparation/both arrival checks.
No generated rooms, enemies, combat outcomes, or runtime policies are modified.

## Initial map waypoint acknowledges selection before owned travel dispatch

CI f469 (37787109757) timed out the initial 15-second command-label poll.
The persisted ledger proves the exact selected waypoint (414.9565,475.1304)
progressed from assembly to travelling with both owned move commands and cruise
79. Final native reports still mixed a completed Warrior assembly receipt and
Priest's previous shop vote. A label poll incorrectly charged native assembly
and report lag to the UI selection acknowledgement. Failure modes: accepting an
unrelated waypoint, missing participant commands, or accepting position without
owned travel. First verify the selected map/coordinates, then bound both owned
move commands by the existing 120-second preparation phase. Retain both actual
native positions within 50 units and archive the real selected waypoint.

## Canvas waypoint rounding preserves a collision-safe margin

CI 7d5 (37789339493) selected (255.826,671.391), about 6.4 native
units from the fixture-validated (260.102,676.164). Native route validation
correctly rejected its final collision edge. Failure modes: validating only an
ideal point, accepting a different pixel-nominated position, or masking a real
collision as a preparation delay. Require native-valid segments to the nine
endpoint offsets in a +/-20-unit grid, preserving room/enemy clearances for
all nine segments. Record this explicit margin and verify the visible rounded
nomination and the actual selected native coordinate; runtime collision
validation and physical travel assertions remain unchanged.

## Safe-segment geometry searches do not block the native server

CI 63ce reached the initial native waypoint artifact. Verified trace before/after
records show the wrong-floor request correctly returned HTTP 409 in 7.05ms
with no error. The next Node native-administration geometry query is not
recorded in the Playwright trace, aborted, and produced no safe-segment artifact.
The expensive sampled clearance search therefore remains the implicated
boundary, not the intentional wrong-floor request. Sampled clearance loops and
native collision queries eliminated unsafe candidates expensively.
Failure modes: excessive geometry CPU blocking native administration, reduced
clearance from optimization, or skipping endpoint collision guards. Use exact
clamped point-to-segment distance instead of sampled clearance; reject unsafe
origins and all nine offset segment clearances before native collision calls.
Keep all nine collision checks, 410-room/300-enemy clearance, and 20-unit margin.

## Native fixture staging releases the previous owned waypoint

CI eb22 (37793495146) staged toward (419.612,425.732), but both native
actors ended at the previous owned UI waypoint (510.435,459.217). The follower's
owned convoy walked 105 units although the initial waypoint differed by only
about five units, proving that the still-owned journey pulled it back during
raw native staging. Failure modes: position-only arrival before completion,
stale completion receipts, and raw movement competing with an owned command.
Await both fresh current-run/current-target owned move completion receipts and
actual arrival, then explicitly Stop through the UI and await owned command/
travel removal before declaring or walking the native staging fixture.

## Finish the resumed safe waypoint before starting native farm assembly

CI 354 (37795392902) stopped resumed waypoint travel when actors were merely
within 70 units. The next farm assembly captured an intermediate leader point
(272.247,517.845), outside the validated endpoint margin around the waypoint
(340.696,496.348). Priest, 72 units from that assembly origin, failed its native
final collision edge. Both actors were ready and no vote was pending.
Failure modes: early physical proximity without owned completion, capturing an
unvalidated intermediate assembly origin, and accidentally dropping the genuine
midroute Stop test. Retain the first Stop after real >80 displacement; finish
the resumed waypoint with both matching current-owned move completion receipts
and actual endpoint distance <5 before the second Stop and original farm UI
selection. Native farm arrival and subsequent combat assertions are unchanged.

## Same-run read-only Cave map survives stale heartbeat observations

CI 074 (37798720220) successfully clicked Add waypoint, fetched map bounds in
501ms, then lost the entire map dialog before canvas lookup. DungeonPanel
conditionally mounts CaveMap only when some member is fresh; a transient
three-second heartbeat gap therefore destroys its open state. Failure modes:
unmounting on freshness gaps, enabling actions from stale observations, leaking
an old run/floor or waypoint into a new run/floor, and accepting actions while
native encounters pause. Before source changes, a declared console read fixture
will switch fresh→stale→fresh and require the same open map/selection to survive,
Set waypoint disabled while stale and restored when fresh. A new run/floor must
close the previous dialog/selection. Native coordinator admission remains
unchanged; only read-only display continuity is retained.

The pre-code console regression failed with the selected dialog removed on a
stale report. After the UI fix, the same fixture passed (8.6s test, 14.5s suite)
and records a stale read-only map screenshot plus transition ledger. The old
run/floor dialog closes and its waypoint is cleared. This reproduces the
mount-loss vulnerability; the original native trace contains no network
freshness payloads, so its exact missing-heartbeat instant is not claimed.

## Native farm arrival includes real combat and loot holds

CI 9251 (37801552787) retains one owned serial-4 route, 1,191.705 units long,
from (404.348,570.609) to the original native farm (1040,584), speed/cruise 79,
one search and zero retries. Non-heal native hit packets cluster into about
187 seconds of combat spans (32.210–104.642, 136.892–158.778,
175.220–267.985 seconds after journey start; these are packet spans, not exact
readiness hold durations). Native death 496 arrived at 1791474324044 and chest
opening at 1791474338028. Both owned journeys still had two walking edges,
no terminal failure, and accepted new movement toward the same retained point:
Warrior at 1791474343476, Priest at 1791474354035. Thus 300 wall-clock seconds
expired during real combat/loot progress. Bound this native farm arrival by the
existing 600-second boss-leg allowance; preserve both physical distances <70,
all ownership and native kill checks, and the overall 1,500-second case bound.
Audit artifact: .build/cave-925-native-timing-audit.json. No runtime change.

## Stairs approach includes native combat and bounded route repairs

CI e7ab (37804474116) passed native farm and boss arrival. Farewell was
injected at 1791475608885 on the real stairs (3824,496). At +242.783s,
both characters were ready and actively walking the prepared serial-14 route,
length 1,530.329 units, speed 79, with only 19.184/17.715 seconds on the
current journeys and one remaining edge. Native no-progress ages were only
354/242ms. Persisted travel recorded two repairs and no terminal failure.
After injection, 109 native hit packets and enemy deaths through +217.884s
prove combat continued during the approach. Exact planning/assembly durations
cannot be partitioned from the untimestamped persisted ledger. The current
choice was resolved; the injected farewell had not yet been reached.
Failure mode: charging native combat/reassembly to a 240-second approach bound
while a fresh owned route is still progressing. Align the stairs approach to
the existing 600-second farm/boss allowance, preserving the actual farewell
reply, both native vote acknowledgements, independent continuation/floor-1
checks, and the overall 1,500-second case bound. No runtime changes.

## UI waypoint submission waits for actual fresh acceptance

CI eae (37807572281) clicked Set after 4.88s of actionability waiting, but
kept the selected map open with Add/Set heartbeat-disabled and no rendered
error or persisted waypoint. Freshness can change between actionability and
submission. Failure modes: treating a suppressed stale click as acceptance,
duplicating an accepted request, retrying arbitrary errors, or bypassing native
admission. Observe the real waypoint POST before clicking. Retry only a
suppressed request with an observed disabled button or an explicit HTTP 409
fresh-runtime rejection. HTTP 200 must close the map with no retry; all other
HTTP/rendered errors fail. Preserve owned target and native arrival checks.

## Retry the actual waypoint freshness rejection with identity proof

CI 00aa (37809678287) recorded HTTP 409 with the exact body `Fresh matching
dungeon run required`. This is the waypoint action's combined admission guard,
not the entry validator's character-specific freshness error. Both native
participants remained alive, unpaused, on run 1c603f267b3799f12061a48e floor 0.
Failure modes: interpreting a changed run/phase/floor as stale, or retrying
other rejection types. Permit only this exact 409 after a fresh read proves
active state matches the submitted run and map/floor, every participant is
alive/unpaused on that run/floor, and at least one observation is stale.
All other errors fail; accepted HTTP 200 requests are never retried.

## Stale-click proof uses one observable DOM snapshot

CI ff20 (37811454143) observed no waypoint POST and a disabled Set button,
then fetched the native view after reports had recovered. Requiring that later
view to remain stale caused a false failure. Both run/floor/alive/unpaused
checks passed. Failure modes: conflating stale and dead/paused/busy controls,
reading button and reason from different renders, and rejecting recovered
freshness after an actual 409. Before source changes, extend the existing
console fixture to require accessible `Waiting for fresh participant reports.`
status while stale and its disappearance after recovery. This status is emitted
only for current-run/floor freshness gaps. The native test captures disabled
Set plus this reason atomically from the DOM, then checks live run/floor/life/
pause identity separately. Exact combined 409 admission is itself evidence
of freshness at request time once the unique active run/floor guards match;
later freshness recovery is recorded, not treated as an error.

## Native duel completion retains survival checks with a bounded combat window

CI 916e (37813545539) failed the 45-second duel poll, not the 1,500-second
case limit (original case lasted 20 minutes). Lockbreaker was already done;
its last death packet preceded duel injection by about 31 seconds, and Priest
reached the exact boss endpoint 0.748 seconds before injection. Unfinished
boss combat or movement does not explain this failure. Rival 618 fell from
100,000 HP to 3,054 while allied actor 617 remained alive at 99,920 HP. Both
participants actively selected the rival and delivered native hits from
+28.699 through +68.494 seconds after injection. The remaining three percent
is ongoing real combat, not a terminal stall. Bound the duel poll at 120
seconds while retaining actual room completion, enemy death, and ally survival.
Attach the latest native HP/actor snapshot and selected party targets even on
failure. Audit: .build/cave-916e-native-duel-audit.json. No runtime changes or
unrelated boss barriers are warranted by this evidence.

The measured original case was already about 20 minutes at this duel. Remaining
bounded stages allow duel 120 + required rooms 300 + stairs approach 600 +
farewell acknowledgement 30 + continuation 300 = 1,350 seconds (22.5 minutes),
before final exit controls and evidence capture. Use a coherent 2,700-second
overall case bound (45 minutes): 20 + 22.5 minutes plus 2.5 minutes for controls
and artifacts. Individual phase limits and all native outcomes remain bounded;
the real game's expiry, clocks, generated rooms, and combat are untouched.

### Native boss planning diagnostics (7b35)

The owned Warrior plan terminated after 90 seconds and the follower after 120,
with both still at (808,344), targeting (3464,440). Existing artifacts cannot
distinguish an unreachable native endpoint from a search starved by readiness
holds. Before changing runtime, sample verified native BFS globals `queue`,
`start`, `best` and `smart`, together with current readiness/freshness and pause
signals. Failure modes: sampling must not advance the search, mutate collision
geometry, replace native outcomes, retain unbounded frontier arrays, or lose
its evidence when the physical-arrival assertion fails. Sample at most once
per five seconds, cap the ledger at 125 snapshots, and capture collision
geometry once during preparation. Record native collision tests at the exact
target and neighboring points; these are observations, not success criteria.

### Heartbeat status must not move the map during pointer selection (b505)

The selected waypoint was (298,465), 96.377 native pixels from the validated
(300.757,561.338). The native canvas click trace records a 966x598 canvas at
(237,168), and a pointer at (366.47,283.25); its input/action dispatch spans
several seconds. The centered dialog conditionally inserts/removes a report
waiting line as heartbeat freshness changes, changing its vertical layout
while the pointer action is underway. Preserve a constant status-row footprint.
Before editing product code, extend the observable console fixture to assert
identical canvas position and height across fresh/stale/fresh transitions.
Failure modes: freshness must still disable submission, the waiting output
must remain exclusive to a genuine report gap, fresh output must disappear,
and reserving space must not relax native waypoint or collision margins.
`pr64-map-status-layout-red.log` reproduced an 18-CSS-pixel canvas shift before the fix; the same observable freshness/selection case passes after reserving the status row (8.6 seconds, 14.5-second suite). Fresh/stale/recovered canvas geometry and existing action/status assertions remain intact.

### Add-waypoint activation acknowledgement (2afa)

The visible failed nomination (415,396) exactly equals the prior accepted
waypoint (414.9565,395.5652). The canvas click therefore did not produce a new
selection: Add waypoint can become freshness-disabled between Playwright's
check and native click. Require the observable placement instruction before
clicking terrain. Retry suppressed activation only with an atomic DOM snapshot
showing Add disabled and the freshness waiting output; validate the same live
run/floor/alive/unpaused identity. Never interpret an old nomination as new,
broaden the validated margin, or retry unrelated disabled/error conditions.

### No-effect Set click recovery (01170)

A Set click returned without observed request or freshness-disabled snapshot;
the final dialog remained enabled with the same valid nomination and no error.
The maintained handler synchronously sets busy before awaiting its mutation,
so an enabled button with no observed POST cannot represent a pending handler.
Keep request/response observers for the complete helper lifetime. A bounded
no-effect retry requires an enabled button, unchanged nomination, no rendered
error, and the same active/alive/unpaused run and floor. Never retry an observed
pending POST, disabled busy control, changed nomination, unrelated HTTP error,
or accepted request; attach every request and pending state even on failure.

### Progress-guarded Cave native preparation (b168)

Captured native BFS advanced to about 98,000 processed nodes before each 90s
cutoff discarded it. Exact pinned 15555 replay with captured collision geometry
found validated routes in three shuffle orders at 169,581–169,790 nodes;
remote throughput predicts about155s. Preserve the Cave90s initial deadline,
but allow up to240s only while the same native search has finite monotonic
frontier progress within15s. Align shared followers to270s. Generic30s and
local connector3s remain unchanged. Before runtime edits, retained isolated
regressions cover progressing completion, stagnant/missing/reset counters,
hard cap despite progress, generic and repair bounds, and follower alignment.
Also guard ownership/map/instance and full native route validation through
existing movement regressions; extension never changes walk permission or
accepts a partial native route. Replay: .build/b168-exact-pinned-bfs-replay.json.

### Idempotent Add activation retry (8638)

The resumed Add acknowledgement timed out without recording placement mode;
final context retains the old (426,783) nomination and later freshness-held
controls. Unlike Set, Add has no external request: its handler only sets local
placement mode true. Permit bounded re-click when placement is absent but Add
is currently enabled and no rendered error exists, after validating the same
active/alive/unpaused run and floor. Disabled controls require the existing
simultaneous freshness reason. Preserve the actual placement instruction and
exact new nomination/native collision checks; do not infer success from clicks.

### Native farm target rejection diagnostics (aae7)

Both farm routes remain prepared at601s with two steps remaining, but both
participants are combat-held. Current committed target498 is31px from the
Warrior (range179); live native enemies still attack while local targets are
null and the Warrior has no recorded attack. Capture bounded read-only farm
samples of the actual native entity, selected dungeon getter, attack gate,
known-death state, native collision, control identity and exact adjusted clock
age. Failure modes: raw metadata may be absent, diagnostics must not mutate
selection/tombstones/clock, disappear on timeout, or retain entire entity worlds.
Cap125 samples at least5s apart, preserve physicalarrival70 and600s boundary.

### Room selection acceptance (aaf4)

The farm button submitted a rejected room-move action: final UI displayed
`Fresh matching dungeon run required`, commands remained empty, and107 native
samples stayed at the previous completed waypoint. Room clicks must observe
actual move POST responses before awaiting physical travel. Failure inventory:
late/pending POST cannot be duplicated; accepted200 must acknowledge exact
run/target/map; only the exact freshness409 may retry while same unique active
run/floor/alive/unpaused; other HTTP errors must fail; suppressed no-effect
clicks may retry only currently enabled/error-free with unchanged live identity.
Keep request listeners throughout the bounded helper, attach attempts including
pending state finally, and retain every native arrival/combat/floor assertion.

### Boss phase budgets (06c362a)

The accepted Lockbreaker selection remained serial5 throughout105 samples over
598 seconds. Thirty-six samples covered native assembly/combat, then the native
planner completed a fully validated19-point route. Both participants progressed
from1048,528 to the2523 corridor; their current journeys still had11 points and
only52/70 seconds of active walking. No terminal failure or BFS stall occurred.
Failure inventory: do not charge assembly/search against the physical-arrival
budget; do not restart phase clocks on repeated reports, substitute another
serial/run/target, or treat route preparation as physical arrival. Wait at most
300 seconds for the accepted generation's owned moves, then270 seconds for its
prepared routes, before the existing600-second both-members physical70 check.
Every predicate retains current run/floor/command ownership; deadlines remain
bounded and the overall2700-second/native-expiry limits are unchanged.

### Native choice stops before room arrival

The subsequent local run reached a real Before You Leave encounter on the farm
route. Its deadline resolved to `fallback` with no votes, and commands became
empty while the intended Amber Nest936,408 remained undone. The farm poll had
not answered or resumed the stopped selection. Preserve this failure archive
`.build/pr64-cave-phases-choice-failure-e2e-results/`. Failure inventory: answer
unresolved native choices through actual UI; only a new choice ID observed after
the accepted selection permits a same-target continuation; do not confuse the
old resolved shop with a new interruption, retry unexplained empty commands,
duplicate replies/reselects, lose run/floor ownership or reset phase deadlines.
Record accepted continuation serials explicitly so genuine choices during boss
assembly/preparation can resume inside the existing bounded polls.

### Resolved native vote commands at the continuation boundary

The local choice-continuation repeat retained 449 intact evidence files (original failed; regroup passed). The actual boss approach answered Two People Claim the Chest, choice `5e5f07e7f98e4045bac7ea13:54`, through the UI. Of 351 continuation snapshots, 350 retained both matching vote commands after native resolution. The fixture's empty-command requirement therefore prevented reselecting Lockbreaker. Coordinator `ensureSettled` deliberately permits these resolved votes. The fixture must accept only the same run and choice's resolved vote commands, reject unrelated pending actions, and retain unchanged absolute phase deadlines. Explicit progress output follows verified assertions rather than inferred native encounter titles.

### Newly paused choice between required-room snapshots

The resolved-vote repeat reached the native farm and Lockbreaker, completed the injected duel's room/death/survival assertions, and rendered native Rogue blades. Guard camp selection was accepted with HTTP 200 and a validated 3537-pixel route. Before the next required-room selection, native Before You Leave choice `b24210c6cde7864acfddddb5:262` paused both participants. The earlier poll snapshot had no unresolved choice; the acceptance helper then failed its unpaused assertion before sending any request. Only the required-room caller may defer on fresh matching alive participants with an actual unresolved same-run native choice. It must return to the outer choice handler without claiming accepted movement; other callers keep their hard unpaused guard. Pending submitted requests must never be abandoned or duplicated.
