Exchange rule previews provide Mark multiple modes for bank, stand, upgrade
(target level), and NPC sale. Gear buttons in the exchange catalog open rules;
item clicks open full details with Add at the bottom. Bulk edits remain local until Done; closing either the rules preview or the
catalog discards them. The fixed-size Done button stays beside the title and
icon mode buttons remain on the right. Bulk bank commands use action: set, so repeated clicks and duplicate reward outcomes cannot unmark
items. Stand painting preserves existing prices or uses the catalog gold value.
Validate the exchange console journey, preserving screenshots and saved rules.
Activate with the supported coordinator/dashboard-only restart.

# Character coordinator

Personal Tracktrix items use the native item ID `tracker`, not `tracktrix`.
Merchant collection and emergency cleanout retain trackers and supercomputers.
Character inventory maintenance pins one to the final inventory slot when no
inventory command is running; merchant lucky-slot tidying preserves that slot.
Explicit Give remains available. Validate the native full-bag Tracktrix cleanout
journey in `e2e/live-economy.spec.ts`, with conserved cargo and restart evidence.
Publish character and coordinator assets through the supported full restart;
CoordinatorOnly does not activate the inventory change.

Exchange reward tiles edit the merchant's existing automatic item rules, including
rules for stock that has not arrived yet. Inventory and reward previews share
`dashboard/features/party/automatic-item-actions.tsx`; selecting an action retires
other automatic actions and pending reservations through
`inventory/automatic-action.ts`. Unmarked exchange rewards default to banking;
sale, upgrade, compound, deconstruction and exchange rules retain rewards for
normal merchant work. `/merchant/exchange-progress` returns current reward routing
after bank travel. Auto exchange rules persist for future complete batches and
allow nested boxes to queue another exchange; locked stacks are excluded.
Manual exchange is always enabled. Automatic exchange has its own checkbox and
priority; legacy Exchange priority/enable settings migrate to the new routines.
Validate the exchange reward console journey and the native exchange actions and
restart journey in `e2e/live-economy.spec.ts`, retaining the report and evidence.
This changes character execution as well as coordinator/dashboard behavior, so
activation requires the supported full restart and fresh character generations.
Building alone does not update the running coordinator or clients.


Map previews now transmit NPC cosmetic layers and include the native dreams_gate
composition. This follow-up changes character telemetry as well as the dashboard;
use the full supported restart to publish character assets. Recreate a debug
instance to pick up its browser viewer, fonts and map-rendering changes; restarting
the parent console preserves an already-running disposable instance.

Disposable Cave debugging is managed by tools/debug from the Settings gateway.
It runs the maintained coordinator and real native clients against an isolated
upstream game/database with a god loadout and native development admission.
See docs/debug-instances.md for Docker access, lifecycle, and E2E validation.
Hosting/dashboard changes use the coordinator-only restart below; production
character assets and credentials are never copied into the debug stack.

Failed delivery equips wait for a full merchant inventory received after the failure. Missing stock retires the mark; retained stock retries delivery under a fresh identity so late receipts cannot consume the new attempt. Combat heartbeats do not refresh inventory age. Pending reconciliation persists across restart without issuing more equip commands. Validate the two failed delivery equip native E2Es and activate with the supported coordinator-only restart below.

SIGINT, SIGTERM and SIGQUIT already share the coordinator shutdown handler. It stops managed characters and closes storage; each worker gets a bounded 500 ms closing notification before forced termination. This is not a transaction drain and does not guarantee completion of an in-flight game transfer. Durable recovery remains required. The Windows E2E restart uses IPC to invoke that same handler; it does not claim POSIX signal delivery or container-wide draining coverage.

A fresh installation designates its first owned, connected merchant when that
character belongs to a headless slot or the native group. Identification precedes
catalog/market/job ingestion, persists once, excludes bankboi workers, and never
replaces an existing assignment. `merchant/config` remains the explicit override.
Validate `live-merchant-config.spec.ts` plus merchant dialog console journeys.
Coordinator/dashboard changes can use the supported coordinator-only restart;
a full restart also publishes the current character assets.

A stop-required rare encountered during Hunt travel retains its convoy loot owner.
The native passive-Goo journey exposed two competing loot barriers: the convoy
finished its leader loot pass and resumed, but rare hunting kept waiting for a
separate receipt at the departed kill location. Rare completion now also accepts
a fresh leader receipt for the exact captured convoy ID and epoch, in the same
realm/map/instance, only when its barrier began after this encounter died.
Standalone rare encounters still require their own matching receipt. Validate
HC-STOP through actual Goo death and both Daisy rewards; see the minimized red
evidence in docs/testing-hunt-stop-loot-red.json. Activate via the supported
coordinator-only restart after building; rebuilding alone does not reload it.

Aborting an anniversary round during staging releases its return immediately,
including before the scheduled start. A cancelled round cannot hold Hunt until
the old start time. Scheduled rounds that have not been aborted retain their
normal start and featured-character holds. The native anniversary deselection
journey reproduced a paused Hunt after real kiss rewards and supplies the E2E
regression. Build and use the supported coordinator-only restart to activate;
building alone does not reload live behavior.

Manual Send to party visits collect authorized bank and merchant marks through the
same handoff selection as automatic item collection. The native Hunt interruption
E2E exposed a reason-name mismatch: party collection jobs collected gold and
reported success while silently stripping their marked item payload. Handoff,
live pickup revalidation and command processing now recognize that collection
reason consistently. Validate native merchant restart/death interruption journeys
and real cargo conservation. Activate with the supported coordinator-only restart;
the build alone does not update a live coordinator.

Merchant idle dispatch preserves pending manual travel and fresh active navigation.
A bounded ten-second admission window covers delivery before the first movement
report; completion or a newer command releases the hold. Real-game E2E caught
stand return replacing a manual order before the native merchant received it.
Validate the real manual-walking and merchant travel journeys. This change needs
the supported coordinator-only restart; a build does not reload a live process.

## Passive attacks while walking

Enabled passive monsters with Keep moving on remain eligible for in-range basic
attacks during walking, including Daisy/anniversary returns, staging, event travel,
and recovery travel. Passing reservations carry their keep-moving intent through
party acknowledgements so retaliation cannot acquire a Hunt primary, defensive
stop, or loot hold. These attacks never chase or change the route. Town casts,
transport transitions, stale authorization and superseding navigation still block
optional attacks; Keep moving off and stationary activity policies are unchanged.
Validate passive-hunting, passing-admission, Hunt travel-defense, continuous-return,
unified-return and shared-convoy tests. Publish character and coordinator assets
through the full restart and verify fresh generations and attacks while walking.

Merchant interruption cleanup releases only matching handoff commands and transitions
the convoy pause to resuming before ownership checks. Failure, worker expiry, clear,
force-stand, priority yield and realm pause retain the original travel destination;
late receipts for ended jobs are acknowledged as stale. Changed navigation revisions
and newer commands still win. Validate merchant-convoy-interruption, merchant
completion/control/progress and realm-pause tests. Preview results distinguish
complete, partial and unavailable; bank borrowing waits for mounted pack data.
Validate upgrade-preview and upgrade-offerings-ui; activate with the full restart.


## Defense delivered before convoy preparation

A heartbeat may receive a defending command before the preceding preparation
command. The character now installs the complete authorized convoy owner first,
using the same local handle as ordinary travel, then stops for combat and
acknowledges defense. Missing, stale or protected ownership cannot create a
handle. Native goldenbat and cutebee Hunts exposed the former acknowledged-but-
missing owner, which blocked the leader and stranded the follower. Validate
actual rare damage, death, loot and resumed Hunt progress. This character change
requires the full supported restart and verified new character generations.

## Walking recovery after a partial Town return

A failed Town cast can leave one Hunt participant beyond terrain that requires
walking away from the Town rally before approaching it. The planner now honors
`town: false`: alpathfinder 0.6 has no Town exclusion option, so the adapter uses
a high finite walking-cost speed and rejects any remaining Town edge. This is a
planning estimate, not a character speed change. Normal authorized Town routes
and the existing Halloween shortcut remain available.

Rendezvous progress includes fresh physical displacement under the matching
convoy, epoch, command, navigation revision and runtime. Necessary obstacle
detours therefore do not consume the thirty-second no-progress budget merely
because straight-line distance increases. The two-minute absolute deadline and
terminal recovery budget remain unchanged. Native Town-recovery E2Es cancel one
actual cast while peers arrive and require reunion plus both Daisy rewards.
The native red-plan excerpt is in `docs/testing-town-return-red.json`.
Use the full supported restart for planner/coordinator deployment; builds do not
activate running processes. Private live diagnostic captures stay uncommitted.

## Town rally and merchant movement ownership

A Town fallback retains its rally until route preparation succeeds. Walking time
cannot consume the protocol-readiness deadline: that timer counts continuous
runtime incompatibility only. Rally movement remains bounded by 30 seconds without
progress and 120 seconds total, including arrivals whose leader is still moving.
Non-preemptible Hunt recipients defer merchant dispatch even when the return is
failed. Handoff races return `deferred: true, reason: "hunt_movement_owned"`; clients
report that failure kind and completion preserves job identity, progress and retry
allowance. Command IDs fence redispatched completions. Validate hunt-return-town,
shared-convoy, continuous-hunt-return, automatic-collection, merchant completion,
queue, interruption and commerce tests. Publish character/coordinator assets with
the full restart. Existing failed Hunt returns still require Retry return once;
verify actual Daisy arrival and subsequent merchant eligibility.

## Daisy departure and door approaches

Door repair samples reachable interaction points near the source spawn before
using a bounded local walking search (8-unit grid, 224-unit extent, at most 2048
expansions). Every segment and the final door access use native validation;
inaccessible doors retain normal fallback. This repairs the Main/Level1/Level2
approaches on Daisy-to-booboo routes without replacing the shared destination or
resetting Hunt recovery budgets. Validate daisy-door-routes, movement-service and
planner-geometry. Publish character assets with the full restart workflow, then
verify fresh character generations and actual convoy departure separately.

## Local Steam launch and attachment

The hosting gateway prepares Windows WebView2 or native Linux WebKitGTK before
forwarding a dashboard Steam login/primary action. The local helper discovers
Steam libraries, attaches to an existing loopback inspector, or launches the game
with a process-scoped inspector on 127.0.0.1:19245. A normally launched client
without inspection enabled requires one manual close and retry; it is never
silently terminated. Linux requires a graphical desktop session and its native
Steam build (not Proton). AL_STEAM_EXECUTABLE can select a nonstandard installation.

Setup placement/client choices are persisted under hosting data and migrated from
existing browser preferences on Steam actions. Different-PC setups cannot trigger
a local launch; an already connected remote bridge continues to work. Unknown
placement requires setup. The helper injects only the maintained Steam bridge into
the authenticated game page and reattaches after navigation. Missing account login,
multiple windows, attachment failures and readiness timeouts leave headless ownership
unchanged. No account passwords are copied or entered by the helper. Linux retains
the existing HTTPS certificate setup requirement.

The connection endpoint distinguishes bridge readiness from a connected character.
The existing coordinator handoff still confirms offline ownership and waits for
native CODE arrival. Validate steam-desktop, roster-routes, hosting, setup, Steam
handoff/group/bridge and query action regressions. Activate gateway, coordinator
and dashboard with the supported coordinator-only restart. Test cold launch,
selection-screen attachment, existing native sessions and fresh arrival on each OS;
protocol fixtures alone do not establish live Linux compatibility.

A failed continuous Daisy return can finish after three seconds of fresh stopped
terminal-hold acknowledgements at its destination. Command, runtime, route, realm,
instance and navigation ownership must still match the current Hunt return.
This completes observed travel without resetting the exhausted retry budget;
normal Hunt policy owns reward claims. Manual navigation and other owners remain
protected. Validate shared-convoy, continuous-hunt-return and Hunt composition;
activate with the coordinator-only restart.

## Dashboard render and polling performance

Dashboard `core` reads retain live Hunt, convoy, anniversary, slot, and client-update
progress. The separate `config` section carries settings, rules and marks, polled
every fifteen seconds and invalidated immediately after dashboard mutations.
Non-dashboard core and full-state responses retain their existing contracts.
Character/panel merges structurally share unchanged data; memoized controls and
stable event callbacks avoid unrelated work. Catalogs initially mount 120 entries,
and log derivation/rendering is reused when its inputs are unchanged.

Validate public-state, dashboard-query/render, inventory, event-selection, and
monster-focus tests. Activate coordinator and dashboard assets using the supported
coordinator-only restart; no character asset publication is required. Browser
profiling over long sessions is still needed to quantify the performance change.

## Long-running coordinator responsiveness

Rare rejection receipts explicitly project sighting and position fields. Startup
normalizes older receipts that accidentally retained complete character heartbeats;
rejection identities and material-change requirements remain intact. Repeated
merchant queue checks persist only when adding/promoting work or releasing a
resource block, while dispatch still checks delayed work on every call.

Upgrade and compound communication failures preserve queued work with durable
10/30/60/300-second movement backoff. Receipt processing precedes retry, and
ordinary inventory errors retain their existing handling. Validate rare retry
evidence, merchant queue/completion, commerce and convoy communication tests;
activate with the supported coordinator-only restart. Verify reduced status-stage
cost and actual merchant/Hunt advancement separately from build success.

For redirected local launch logs, `scripts/watch-console.ps1` follows the newest
`.build/*.stdout.log`; `-Errors` follows stderr. Run it in a visible PowerShell
terminal. Closing the viewer does not stop the coordinator.

## Merchant upgrade purchase batches

Merchant settings persist `buyUpgradeBatchSize` (1–42, default 1), passed to commerce
commands. Each batch buys only its starting-grade scroll requirements in bulk;
subsequent grades are purchased one at a time. Capacity, remaining attempts and
budget can reduce the batch. All purchased items finish even after the requested
quantity succeeds. Durable `batchItems` and pending purchase checkpoints reserve
queued items across yields/restarts; uncertain outcomes cannot consume another
batch item as a replacement. Validate merchant-buy-cycle and merchant configuration
tests. Publish character assets along with coordinator and dashboard using the full
restart workflow below.

## Durable buy-with-upgrade orders

Commerce follows the owned item after checkpoints and between upgrade attempts.
A missing old inventory slot is never destruction evidence: only a matching
server upgrade-failure response can authorize the poof receipt and next purchase.
Production journals persist that explicit destruction flag; legacy empty receipts
and ambiguous or missing survivors require review. Recovery can follow one uniquely
identified survivor without buying a replacement. Existing orphaned items are not
silently adopted into an order. Validate merchant-buy-cycle, production-journal,
item-operations, lucky-upgrade and merchant-upgrade-recovery before the full restart.

Buy-with-upgrade saves confirmed purchases and upgrade results separately from
scheduling boundaries. Normal priority and anniversary preemption happens after
an item poofs or reaches its target, before another cycle. Dispatch IDs fence
late reports; a stable commerce order ID links local progress to coordinator
recovery across retries and restart. Budgets and attempt allowances never reset.
Owned survivors and results remain reserved while queued. Named NPC destinations
use the movement interaction offset. Movement failures preserve the order with
10/30/60/300-second backoff; diagnostics retain the last error and next retry.

Validate merchant-buy-cycle, merchant-crafting, merchant-npc-sales, merchant
queue/recovery, production-journal, anniversary, and movement-service tests.
Publish character and coordinator assets together using the supported full
restart below. Verify fresh generations, stand departure, and a real cycle
boundary yield/resume before claiming live behavior verified.

## Late route responses and independent merchant visits

Shared route download/publication responses cannot reinstall movement or readiness
after a local failure or communication hold. Matching legacy `route-ready` reports
with captured signal-expiry failures enter the existing communication recovery;
completion acknowledgement retries remain arrived. Recovery retains destination,
quest rewards, retry budgets and manual navigation ownership. Hunt turn-in heartbeat
priority applies only to participating fighters, so the merchant can attend kisses
independently while recipient handoffs remain protected.
New merchant interruptions wait for communication recovery. Saved interruptions
that captured its internal hold phase resume through fresh shared preparation,
never by issuing `communication-hold` as a movement command.
Arrival uses the same navigation exemption as route authorization: a Town return
may finish under its own cancelled intent, but a newer revision still rejects it.

Windows sharing conflicts during journal replacement defer compaction for thirty
seconds while preserving the authoritative append journal and accepting subsequent
writes. Other storage errors still propagate. Validate late GET/POST responses,
split-party Daisy recovery, heartbeat scope, subsequent anniversary rounds and
JSONL rotation/restart. Publish characters and coordinator together with the full
restart below, verify fresh generations, Daisy processing and resumed Hunt progress.

## Locked-pair fast handoff

Capable grouped farmers lock the current and next target while optimizing the third.
Pair acknowledgements are independent of display queue revisions. The coordinator
issues a process-local, three-second successor grant only after all participants
acknowledge the pair. Confirmed predecessor death can consume it once locally;
ordinary cooldown, range, healing, claim and activity checks still apply. Revocation
waits for acknowledgements or lease expiry before an incompatible grant. Legacy
clients retain coordinator-confirmed promotion; restart does not restore grants.

Anniversary/event travel, returns, convoy ownership, recovery and departure holds
block grants. Hunt uses the selected quest owner's fresh count, reserving the current
and pending fights and accounting for deaths whose quest decrement has not arrived.
One remaining kill never preauthorizes a successor. Fast reports carry the quest
with the same runtime-scoped sample as combat observations.

Validate successor-handoff, combat queue/channel/handoff/movement, queue markers,
healing, Hunt and anniversary return tests. Use an isolated checkout because the
watcher publishes source changes; activate both components with the full restart.
Inspect bounded combat.handoffs for grant receipt, local promotion, reconciliation,
attack attempt timer lateness and cooldown readiness. Measure clock-local durations.

## Combat target handoff timing

Confirmed death and changed queue acknowledgements flush combat reports immediately.
If a report is already in flight, changes coalesce into one fresh report on completion;
successful long polls rearm immediately. Periodic reports remain the freshness fallback,
and transport failures retain the one-second retry delay. Queue pre-acknowledgements,
coordinator commitment, healing, attack cooldowns and departure barriers still apply.

Character status exposes bounded `combat.handoffs` records for local death, report,
response, selection, commitment, first basic-attack attempt/acceptance and blockers.
Report sequence links receipt/evaluation timing to its response; group `handoffTiming`
retains coordinator selection/commitment times. Compare durations within each clock
domain and runtime, never subtract coordinator timestamps from local timestamps.

Validate combat-handoff, combat-channel, combat-queue, combat-movement, healing,
formation, departure-loot and convoy-timing tests. Activate character and coordinator
assets together with the supported full restart below and verify fresh runtime IDs.

Managed ALClient planning, native fallback, convoy protocol 4, diagnostics and
rollback modes are documented in [movement](../../docs/movement.md).

The installed caracAL entry is a 363-byte CommonJS launcher. All coordinator
implementation lives in TypeScript here. Edit these sources, not
`.caracal/standalones/CharacterCoordinator.js` or the generated bundles.

## Architecture and generated files

`TypeScript domain modules → application.ts → build → .build/runtime/coordinator-application.cjs`

The installed `.caracal/standalones/CharacterCoordinator.js` launcher loads that
application bundle. The source is split for maintenance; esbuild combines it for
Node execution. Edit a domain module for behavior, or `application.ts` to change
how services connect.

Both `coordinator-application.cjs` and `coordinator-policies.cjs` are generated:
**do not edit them**. The application bundle includes startup wiring and imported
services. The policy bundle exports services without starting the application; it
originated as the migration bridge. They duplicate substantial code, and the
current launcher loads the application bundle directly.

Inline source maps include debugging information and original TypeScript. As an
illustrative snapshot, the application bundle was approximately 631 KB JavaScript
plus 1.89 MB source map (2.53 MB total); policies were 598 KB plus 1.77 MB (2.37 MB).
Sizes change as code changes. Roughly three quarters of those files was source-map
data, not additional executable logic.

## Finding the code

- `application.ts`: composition and startup wiring.
- `infrastructure/`: installed caracAL dependencies and platform contracts.
- `initialization.ts`, `state/`, `persistence/`: saved state, defaults and storage.
- `characters/`, `lifecycle/`: workers, IPC, roster and shutdown.
- `navigation/`: convoys and travel; `hunt/`: Monster Hunt.
- `navigation/travel-defense.ts`: current attacker observations, travel combat
  ownership and passive target retirement. `navigation/convoy-defense.ts` shares
  the defense/loot barrier between route engines; its generated
  `.build/runtime/convoy-defense.cjs` is loaded by the legacy compatibility adapter.
- `anniversary/` and `events/`: anniversary, Franky and other event coordination.
- `merchant/`, `inventory/`: jobs, upgrades, collection and BankBoi.
- `http/`, `status/`, `telemetry/`: routes, heartbeat ingestion and dashboard views.

Policies use explicit ports for time and external I/O. Importing `index.ts`
does not start workers, timers or connections. Legacy shared JavaScript services
remain external dependencies with explicit consumer contracts.

## Build and validate

`npm run build:runtime` stages the application and policy bundles under
`.build/runtime/`, with source maps. Windows start-console and Docker build
these artifacts before starting the game. The launcher template lives at
`tools/caracal/CharacterCoordinator.cjs`; the installer copies it into caracAL.

Run `npm run typecheck`, `npm test` (browser E2E), `npm run test:unit`
(retained failure-mode exceptions), and the coordinator lint check:

`node node_modules/oxlint/bin/oxlint --config runtime/.oxlintrc.json runtime/coordinator`

The complexity limit is 10. Prefer E2E through the real gateway and coordinator,
with repeatable artifacts; see [the testing guide](../../docs/testing.md).
Write failure modes before any necessary isolated test. Remaining named-function fixtures derive their source from maintained
TypeScript, never the installed host. Full-host tests cover both source and bundle;
launcher tests execute the bundle with Windows and Linux directory inputs.

## Manual edit, build and restart

The caracAL installer binds both game and CODE window storage to the persistent
IPC stores. JSDOM's default `window.localStorage` is ephemeral: using it loses
production recovery journals on reload while coordinator admissions survive.
Validate `coordinator-installer`, `production-journal`, and `merchant-npc-sales`
when changing this binding. NPC sales use the named vendor destination so managed
movement applies its interaction offset instead of targeting blocked sprite
coordinates. Activate these changes with the full supported restart.

Rare support retains the current interruptible convoy and commits its encounter
before acquisition returns. Fairy basic attacks accept the fresh owned travel
selection even if support control has been released. Unproductive optional
pursuits expire after thirty seconds without approach/combat progress or five
minutes overall; their progress and rejection evidence survive restart. Mere
monster/leader displacement cannot reopen a rejection. Fresh usable attack range
or combat evidence can. Actual current attackers retain defensive priority.

A travel encounter can route a separated member onto the encounter map under the
same convoy, epoch, command, and navigation revision. Catch-up uses the managed
planner and cancels on hold, supersession, target retirement, or observed arrival;
unsupported instance entry and failed routes report explicit blockers. Protected
anniversary return does not acquire optional stops, and finished visits hand back
to current Hunt policy after combat/loot and fresh ownership checks.

Validate `encounter-recovery`, rare hunting/client/retry tests, Hunt travel,
communication, shared convoy, event returns, combat queues, and markers. Publish
character and coordinator assets together using the full restart below.

Turning Hunt off during an authorized event departure preserves that departure
and combat. It clears Hunt without dispatching a competing backup convoy, even
when the leader entered before its follower. Event evacuation later resumes the
current normal farming policy.

Disabling an inherited combat event collects all now-disabled participants from
their individual event sessions before starting evacuation. Each retains its own
captured waypoint; still-enabled members, other events and globally advertised
but unjoined events do not become evacuation participants.

Event recovery retains each validated Main-town acknowledgement while waiting for
companions. A member moving to another ordinary map after its acknowledgement
must not strand Hunt in paused-event, even while a deselected boss remains globally
live. Handoff still requires fresh, alive non-event-map reports and unchanged
navigation ownership; a Franky map-exit receipt alone does not satisfy Town.

Event evacuation hands directly to current Hunt policy after fresh Main town
observations, without requiring the historical farming checkpoint. Normal farming
still resumes its authorized checkpoint. Hunt off/on during evacuation changes the
post-exit policy without dispatching backup movement; completed turn-ins and loot
remain owned. Deferred members retain evacuation but drop obsolete Hunt checkpoints.
Restored failed farm-recovery children are recognized by parent command and revision.

Dedicated-map exit handling covers Goobrawl's transporter and the A/B Testing and
Pirate Ship leave/transport mechanisms. Responses never substitute for observed map
changes. Exit attempt budgets and the Goobrawl Town shortcut survive reload through
return progress; unsupported maps report an explicit blocker. Completion checks
command, runtime, cycle and navigation identity. New Hunt commands clear old exit labels.
Validate Hunt event resume, event return, mode, acknowledgement, return progress,
farming navigation and convoy regressions. Publish characters and coordinator together
using the full restart, then verify fresh runtimes and actual Hunt progression.

Terminal Hunt retreat failures restart the Hunt cycle once per failed Escape ID.
Only a fresh matching `recoveryFailed` report under the captured navigation ownership
can trigger this reset; newer commands, manual cancellation, and events take priority.
The reset releases Escape/death recovery and selects current-party quests while
preserving blacklist history, settings, backup destination, and pending loot.
The leader's combat log records `restarting hunting routine due to failure` with
the character, position, error, and old/new cycle identities. The handled Escape ID
is retained in persisted combat recovery to prevent replay after restart.
Validate `hunt-retreat-restart`, `combat-disengagement`, Hunt composition, and Escape
tests. ALClient/native endpoint trimming also requires `movement-service` and shared
convoy checks: only a blocked final walking point within arrival tolerance is omitted;
precision and shared endpoints remain protected. Publish character and coordinator
assets with the full restart below, then verify fresh runtimes and Hunt progression.

Hunt travel reconciles encounter death and absence before acquisition. Permanent
retirements use server/map/instance/monster identity; absence releases require a
newer living sample. Current attackers outrank committed passive encounters, and
fresh unanimous attacker observations release incidental targets. Historical
interruption targets are diagnostics only. Defense completion waits for loot,
then regroups toward the saved Hunt destination without replacing its mission.

A shared hold owns the client phase even while local in-range attacks continue.
Only a newer owned defense command can release that acknowledgement into combat.
Recovery preserves the five-second stability and thirty-second cooldown barriers,
then reconciles combat and loot before preparing movement. Hold diagnostics name
missing participants and acknowledgements; defense logs record changed blockers.
Validate `convoy-communication`, `hunt-travel-defense`, `travel-defense`,
`shared-convoy`, `passive-hunting`, `combat-queue`, and `queue-markers`. Publish
character and coordinator assets together with the full restart below.

Protocol-4 Hunt travel keeps communication outages separate from movement failure.
Missing heartbeats or an expired matching signal stop the party in a persisted
communication hold without spending movement or Hunt retry budgets. All members
must acknowledge the current hold and provide five seconds of fresh, living,
stopped reports before a new route generation is prepared; repeated resumptions
are spaced at least thirty seconds apart. Restart discards stability observations,
and runtime replacement requires new acknowledgements. Manual navigation wins.

Arrival remains `arrived` while transient completion HTTP failures retry (one
request at a time, five-second timeout, jittered 1/2/5/10-second backoff). The
existing verified-arrival fallback still applies, and persisted latest completion
receipts make response-loss replays harmless. Only captured legacy completion
network failures at their destination enter the one-time migration path; real
movement failure counters remain intact. Existing convoy history records outage
and recovery transitions rather than every retry. Validate `convoy-communication`,
shared convoy, Hunt return, restart, and acknowledgement tests. Publish character
and coordinator assets together with the ordinary full restart below, then verify
fresh runtimes and actual Hunt advancement through Daisy processing.

Convoy failure messages include a snapshot taken before cancellation: phase,
position, destination, route identifiers, signal expiry or mismatched identity
fields, and recent status-response/failure timing. Two context lines accompany
the existing reason and the same snapshot travels in existing failure details.
Timing is held in memory only; no requests, timers, or storage are added.
Validate convoy failure context, shared convoy, and status diagnostics tests;
publish character assets using the supported full restart.

Shared-route geometry mismatches have a separate one-reload repair budget. Heartbeats
carry numeric game versions and geometry fingerprints; import failures include both
expected and actual identities. The coordinator holds every participant, asks only
affected runtimes to reload, and waits up to 60 seconds for fresh compatible reports
before creating new route commands. An older browser game version requires a game-page
reload; CODE alone cannot replace its game data. Repair targets the newest reported
game build, including when the leader is older. Repair identity and deadline survive restart.
Hunt roster reconciliation retains reloading participants through the repair wait
and its terminal geometry hold, rather than treating a heartbeat gap as departure.
A repeated mismatch stays held with a geometry-specific error and does not blacklist
the farming zone. New navigation supersedes repair. Hunt clears an orphaned failed
farming relocation only when its destination and every navigation revision still
match the current mission, then resumes origin travel or a due Daisy return. This
also releases an expired anniversary checkpoint whose dispatched farming return
failed; live event returns and newer commands remain protected.
Validate geometry reload, shared convoy/walk, movement service, and Hunt farm-walk
tests; publish character and coordinator assets together with the full restart.

Anniversary participation never automatically crafts Sixfold Cakes. Complete slice
sets remain available for the normal exchange menu. Publish character and coordinator
assets together when retiring the legacy cake routine; snapshot `craftReady` stays
false for older clients. Validate anniversary snapshots and merchant exchange tests.

Enabled passive targets with `keepMoving: false` take precedence over outbound
Hunt moving attacks, including when the passive type matches the Hunt species.
Fresh eligible sightings can nominate a committed travel encounter before aggro;
passing reservations cannot suppress that encounter. The shared convoy retains its
original destination while normal combat, rare support, and kiting run. Rare support
must not cancel that convoy or create a competing farming return. Turning keep-moving
back on does not abandon an already committed fight. Protected returns and Escape
remain separate. Validate passive admission, Hunt travel defense, and rare support.

Local development starts `tools/game/watch.mts`: source edits can publish and reload
character assets automatically even without an explicit build. Make coordinated
character/coordinator changes in an isolated checkout; stop the supervised local host
before transferring validated sources. Killing the watcher alone is insufficient
because the service host respawns it. Publish both components with the full restart
below, and verify fresh character generations plus the coordinator process.

Outbound Monster Hunt convoys share one coordinator-authorized encounter while
walking. Basic attacks remain in range and cannot switch to another monster merely
because the primary falls out of range. Raw target observations remain visible even
for passing encounters. A second attacker pauses the whole convoy for normal
defensive combat and kiting; the original encounter and additional attackers retain
combat ownership until death or bounded lost-target recovery, followed by the
existing loot barrier. Regrouping resumes travel to the original destination under
a new route epoch. Return and emergency escape policies remain separate.
Sightings cannot adopt an earlier spawn. Preparation and map transitions suppress
passing attacks. Completion records verified origin arrival before free
combat resumes. Premature persisted farming states return to their saved origin.
On entering farming, the Hunt target sheds passing-attack ownership from travel,
including cached peer reports, so it can enter the normal combat queue. Unrelated
passing encounters retain their movement restrictions.
Validate Hunt travel defense, passing admission, travel defense, Hunt route acquisition,
passive hunting, shared convoy endpoint arrival,
and Hunt composition tests. Publish both character and coordinator assets with
the full restart, then verify every member reaches the destination before farming.

Shared convoy departure tolerates matching travel reports within 500 ms of the
scheduled departure. Transient readiness changes stop and reprepare under the
original 60-second readiness deadline without spending a movement retry.
Walking execution may reissue one stopped, collision-checked owned segment;
only observed displacement resets its five-second progress deadline. A repeated
walking stall switches the shared planner to native within the two-regroup limit.
Hunt return retries preserve that fallback and pending Daisy rewards. Stale arrival
responses wait for replacement commands instead of reporting another failure.
If a final Hunt-return completion request never settles, three seconds of verified
arrival reports let the coordinator finish the convoy and proceed to Daisy claims.
Fresh route, runtime, command, and navigation ownership checks still apply.
Validate `shared-convoy`, `movement-service`, `convoy`, and Hunt return tests;
publish character and coordinator assets together through the full restart.

Explicit Send to party requests survive a disabled automatic-collection toggle.
Automatic pickups still obey the toggle. Validate `manual-party-collection`.

Steam logout recovery uses a game-window session ID that survives CODE reloads
but changes on a fresh game page. A connected Engage can retire a pending logout;
headless and primary-transfer operations retain their ownership safeguards. Old
release receipts are replayed as acknowledgements, never as another disconnect.
Validate with `roster-routes.test.cjs` and `steam-bridge.test.cjs`. Publish both the
coordinator and character assets, then test console logout followed by Steam login
and Engage for the same and a different character, including a primary with Steam
companions. Confirm the new primary stays connected and headless slots stay assigned.

Passing attacks first publish an exact encounter reservation over the combat
channel and wait for every active fighter/convoy participant to acknowledge it.
Missing approval skips the optional attack while travel continues. Admission is
scoped to runtime, membership, navigation and convoy ownership. Protocol 4 optional
attacks require an owned travelling signal; transitions still suppress them.
Protocol 4 defensive stops retain their local convoy identity and first interruption
cause until the coordinator acknowledges the stop. If every recorded cause becomes
a passing encounter, fresh observations let the coordinator rebuild the current
owned route without a defensive loot hold. Genuine defensive kills retain loot
handling. See the [keep-moving audit](../../docs/keep-moving-combat-audit.md).
Validate passing-admission, passive-hunting, convoy-defense and shared-convoy tests;
publish character and coordinator assets together using the full restart.
The shared travel watchdog regroups
after three seconds of fresh missing local route reports, preserving the destination
and checking navigation ownership first. Validate with `shared-convoy.test.cjs`,
`convoy-defense.test.cjs`, and `passive-hunting.test.cjs`.

Managed public distributions use the host's authenticated update controller. Its
expiring `AL_DATA_DIR/updates/pause.json` lease suppresses new merchant/bank
dispatch and returns a maintenance-only heartbeat until each fresh character
acknowledges idle inventory/movement state. Missing or busy acknowledgements
defer installation; no unacknowledged runtime is assumed safe. The lease is not
persisted in game settings. Character and coordinator assets must be released
together. See `docs/distribution.md` and `console-updates.test.cjs` for package
startup, state backup, source-edit protection and rollback behavior.

The account Characters panel retains the last reported doll and sprite in
`characterAppearances` within the persisted roster. Full heartbeats update this
cache only when appearance changes; empty reports never erase it. Offline cards
use the cached appearance without restoring live status. Characters never observed
with a usable portrait need one normal connection before an offline doll is available.

WTB quantities are remaining purchases, not desired inventory stock. Native stand
fills and automatic shopping share that remainder. Inline price, quantity, and
priority edits use `editField`, `value`, and `bidRevision` on the bid endpoint;
only quantity edits replace the remainder. Completed or replaced orders reject
stale field edits. Validate with `native-stand.test.cjs`,
`native-stand-client.test.cjs`, and `active-wtb-fields.test.cjs`.

Bank sorting defaults to `bankSortMode: "automatic"`. Merchant settings can select
`"request"`; the bank window then queues/cancels a durable, uniquely identified
sort without dispatching travel. All cosmetic sorting callers in the shared
character runtime use the same authorization checkpoint. A request made during
a visit waits for a later entry; floor transitions retain the visit identity.
After ordinary banking work, departure waits for the requested pass over owned
packs on reachable bank floors (existing keys only). Completion requires the
same request, visit, and currently reporting runtime. Failures retain the intent;
restarts recover it as retry. Automatic passes cache each floor's final contents
for that visit. Normal deposit stacking and required banking transfers are not
controlled by this setting.

Stack consolidation is independent of cosmetic sorting and runs during normal
bank visits across accessible owned floors, using existing keys. Deposits fill
compatible partial stacks before opening new stacks; partial transfers respect
the game's stack limits (for example, tomb keys 46/46/5 become 50/47). Unrelated
items stay in place when sorting is off. Staging slots, queued withdrawals and
craft ingredients are excluded. The existing bank-sort checkpoint accepts the
`stack` action and returns current protected locations and item types without
claiming or completing a cosmetic sort request.

The separate `party-bank-stack-buffer:<character>` journal records temporary
inventory slots and expected operation results before mutation. Unconfirmed
operations are not repeated; unresolved buffers prevent departure. Lack of safe
buffer space defers partial transfers instead of creating unnecessary stacks.
Validate with `bank-partial-stacks.test.cjs`, banking integration tests and the
full regression suite. Publish character and coordinator assets together.

Sorting buffers are journaled before mutation in character local storage and
returned before departure, including after cancellation/reload. Failed recovery
holds the merchant in the bank rather than treating carried bank stock as cargo.
Validate with `bank-sort-request.test.cjs`, bank consolidation/stack routing, and
craft/compound reservation tests. Publish both character and coordinator code
with the ordinary supported restart below; a coordinator-only restart is not
sufficient for this feature. Live character reports expose `bankSortProtocol: 1`.


Merchant heartbeat stock checks complete only the merchant's own restock job.
Party restock assignments await the service completion flow; the merchant's full
potion stacks cannot clear another character's delivery. Validate with
`coordinator-recovery-composition.test.cjs` and `coordinator-merchant-recovery.test.cjs`.
This change needs only the coordinator-only restart.

All active merchant visits reveal their recipient within transfer range, including
restocks, item delivery, pickups and gold collection. Fresh same-realm/map/instance
positions and the current merchant command authorize a short heartbeat visibility
lease; the recipient verifies local proximity before stopping invisibility. The
rogue skill runtime suppresses automatic invisibility while that lease is active.
Validate with `merchant-visibility.test.cjs` and `merchant-rendezvous.test.cjs`.
Publish both coordinator and character assets with the ordinary restart.

Merchant deliveries carry durable IDs. `/party-api/merchant/delivery-receipt` accepts
`deliveryReceipt: true`, merchant `character`, `target`, `deliveryId`, and a phase
of `uncertain` or `confirmed`. The runtime journals before sending and acknowledges
each confirmed send independently of job completion. Uncertain sends remain blocked
rather than being repeated; missing stock blocks only that delivery. Fresh reports
reconcile legacy equip requests already equipped by their recipient. Anniversary
pre-start deferrals release queue ownership without extending the worker watchdog.
Validate with `merchant-delivery-recovery.test.cjs` and merchant recovery/completion
tests; publish character and coordinator assets together using the ordinary restart.

Marked deliveries create their own merchant jobs by default, at priority 90.
Merchant settings can disable these delivery-only trips: waiting delivery jobs
are removed, active trips finish, and marks remain available for other visits or
explicit party/character sends. The Marked deliveries routine remains visible but
disabled until enabled in Merchant settings. Only ready marks schedule visits;
blocked transfers and pending equipment confirmation keep their existing recovery
flow. Empty delivery jobs are discarded before dispatch. Validate delivery-trip
settings/UI, scheduling, queue, dispatch, and delivery-recovery tests. This change
needs a coordinator-only restart and refreshed dashboard assets.

Manual upgrade menus read stored server previews through `/party-api/upgrade-preview`;
only explicit Refresh chances (`refresh: true`) queues the "upgrade preview" merchant
routine (default priority 70). The normal dispatcher serializes it with production.
Missing scrolls/offerings are borrowed from available bank packs and returned before
completion; a local recovery journal reconciles interrupted transfers before any
subsequent merchant job. No supplies are bought or consumed. Calculations use only
`upgrade(item, scroll, offering, true)` and retain the shared promise guard until
settlement. Results persist in settings, bounded to 100 entries, and are hidden once
the merchant reports a real upgrade queue packet with a newer revision. Requests
are tied to the original item; old sessions/commands cannot publish results.
Validate upgrade-preview, upgrade-offerings-ui and merchant queue/dispatch tests.
Publish character, coordinator and dashboard assets with the full restart.

Lucky-slot discovery records only ordinary upgrade-scroll `q_data` rolls, excluding
compound, stat-scroll and offering-only operations. Unknown slots no longer block
upgrades. Normal jobs rotate through the least-sampled slots until a slot meets
the statistical inference threshold, then continue testing that slot.
Inventory swaps use the existing durable upgrade recovery journal. No extra
upgrade jobs are created. Explicitly verified saved slots remain authoritative;
the legacy hardcoded GoldMajesty slot-7 default is retired. Statistical candidates never populate
`luckyUpgradeSlots` or trigger inventory tidying as if verified.

`luckySlotTracking` persists per-character client streams in coordinator settings.
Clients retain their stream and last roll receipt locally, replay cumulative counts
on heartbeats, and receive other clients' history before selecting a slot. Replayed
or older counters cannot double-count or replace newer evidence. The merchant's
Lucky slots dialog shows combined evidence and search confidence. A slot is labeled
inferred at 99.9% model confidence after at least 100 observations there; continued
observations may change that conclusion. See [the source audit](../../docs/lucky-slot-discovery.md).
Validate lucky-slot tracking/UI, lucky-upgrade recovery, heartbeat and persistence
tests. Publish character and coordinator assets together with the full restart.

Fresh inventory reports relocate delivery marks to the item's current slot before
scheduling work. Existing matching slots retain ownership before displaced marks
claim other copies; merged stacks reserve each request's original quantity across
recipients. Relocation preserves delivery IDs, equipment intent, and uncertain-send
blocks. Missing stock and stale-order cleanup never cancel a delivery. Validate
with `merchant-delivery-recovery.test.cjs`, `coordinator-scheduling.test.cjs`, and
`coordinator-sale-routes.test.cjs`. This reconciliation change needs only the
coordinator-only restart.

Automatic inventory rules are shared through `inventory/shared-rules.ts` and
managed on the merchant panel. The versioned migration retains its original
documents in `merchantRules.backup`; merchant rules take precedence and unresolved
fighter conflicts remain inactive until selected. Manual requests retain their
character and equipment-slot ownership. Automatic processing pickups use the
normal collection threshold and nearby exception.
Deconstruction reservations match item identity as well as slot, so stale records
cannot block NPC-sale pickups for replacement items. Automatic missing-item marks
recover when fresh inventory contains an available copy; uncertain attempts and
other blocked operations still require review. Validate player NPC sales,
deconstruction, and automatic collection; activate with a coordinator-only restart.
Manual bank/merchant collection marks override an opposing automatic collection
rule for the marked stack, including after slot relocation. Other stacks still
follow the rule; removing the manual mark restores automatic handling. Validate
with `coordinator-mark-reconciliation.test.cjs`; coordinator-only restart suffices.
Fighter pickups for automatic upgrade, compound and NPC sale rules share one
`party collection` job per character, using the Automatic item collection toggle,
threshold and priority. Queued legacy automatic pickups merge on startup; active
jobs finish unchanged. Collection retains cargo for separate merchant processing
and preserves sale receipts and reserved crafting quantities. Manual jobs retain
their own ownership. Merchant processing reports bank retrieval, processing and
bank storage separately. Validate with `automatic-collection.test.cjs` and
`automatic-collection-client.test.cjs`; publish character assets with this change.

Auto compound includes temporary storage: below-target merchant inventory without
a complete eligible group is banked, without creating or clearing Auto bank rules.
Complete groups use inventory first and withdraw only missing ingredients. Finished
outputs follow their own tier's storage marks. Protection checkpoints refresh active
compound rules and conflicting item tiers before storage or consumption; full-bank
failures use the existing capacity block until contents change. Target-level success
receipts log `merchant completed auto compound` once, including unlimited rules.

Upgrade offerings are separate from automatic target rules. `upgradeOfferingRules`
stores item-wide half-open level ranges: +7 to +9 applies at +7 and +8. The
`upgrade-offering-rule` character command creates, edits, or removes a range;
overlapping ranges are rejected. Required offerings preserve an unfinished mark
with `waitingOffering` until stock or policy changes. Optional offerings retrieve
owned bank stock before falling back. Neither mode buys offerings. Merchant and
bank availability excludes locked stock and existing crafting/delivery reservations.
Manual `upgrade-mark` requests with `offering` authorize one attempt and carry a
durable `requestId`; a surviving failure does not retry. Production receipts and
lucky-slot journals account for the offering and prevent duplicate consumption.
An unissued manual attempt can be abandoned during recovery without losing its
request. Validate with `upgrade-offerings*.test.cjs`,
`upgrade-offering-recovery.test.cjs`, and `lucky-upgrade.test.cjs`. Publish character
and coordinator assets together through the supported restart below.

Automatic upgrade passes persist their original item, target and `passId` before
the first production attempt, including bank withdrawals. Reconciliation pauses
during lucky-slot swaps/recovery and inventory tidying, and follows a uniquely
matching relocated survivor. Intermediate levels remain reserved for processing;
completion clears the pass by ID. Missing scroll/item inputs retry instead of
creating a capacity block. Validate with `merchant-upgrade-recovery.test.cjs`,
`coordinator-mark-reconciliation.test.cjs`, `coordinator-merchant-completion.test.cjs`
and `upgrade-offerings-client.test.cjs`. Publish character and coordinator assets
together through the supported full restart.

Finite upgrade/compound quantities mean remaining successful target-level outputs,
not desired stock. `inventory/production.ts` persists admission and completion
receipts before acknowledging them. Character code journals each operation locally
and retries a lost receipt without repeating production. Failed operations and
existing inventory do not decrement quantities; zero retains a completed rule.
Changed rules do not consume receipts admitted against an older rule value.
An unresolved operation blocks further inventory commands until its outcome can
be recovered. Validate these behaviors with `shared-merchant-rules.test.cjs`,
`production-journal.test.cjs`, and `item-action-menus.test.cjs`.

Production recovery inspects admission by journal identity before taking action.
A prepared journal that was never admitted is discarded without admitting new work;
a different unfinished coordinator attempt remains held for explicit review.
Production and journal recovery serialize locally to prevent overwriting an active
journal. The existing `/party-api/merchant/production` endpoint accepts `action:
"inspect"` with the original character/id/kind/item and returns its attempt plus
pending identities. After reviewing an orphan, an operator can submit those same
identity fields with `action: "resolve-unknown"` and a nonempty `reason`. This
retains a timestamped unknown-outcome receipt, does not consume quotas, and prevents
replay or late completion from changing the resolution. Automatic recovery never
uses this operator action. Merchant retries retain their reported deferral cause.
Stand open/closed observations travel in both the dashboard snapshot and fast
telemetry; absent observations display as unknown. Validate production reconciliation,
production journal, offering recovery, merchant recovery, dashboard live and stand
inspection tests. Publish character/coordinator assets with the ordinary full restart.

Craft orders reserve their remaining exact-level ingredients as soon as they are
queued. Reservations are derived from durable order allocations and crafting
checkpoints, including frozen recipe materials for newly queued orders. Automatic
compounding excludes these quantities when scheduling, staging BankBoi stock,
withdrawing from the bank, and selecting each live triplet. It refreshes protection
through a read-only `protectionOnly` merchant checkpoint before consuming stock.
Allocated source locations are preferred; missing allocations relocate against
current inventory. Completed/cancelled orders release reservations automatically.
Merchant bank errands refresh these reservations before each marked deposit,
including when another job interrupts crafting. Reserved ingredients and partially
reserved stacks stay in inventory, with their bank marks pending. Resumed crafts
normalize absent material levels to zero when locating bank stock; other marked
item lookups retain strict fingerprints. Validate with `merchant-bank-full.test.cjs`
and `merchant-crafting.test.cjs`, including a six-ring order resumed after four crafts.
Legacy orders use their saved requirements and the current recipe catalog; an
unrecoverable recipe produces a diagnostic and blocks automatic compounding.

At startup, Bestiary, Skills, and item catalogs are validated against the installed
game version's `data.js`. Every source ID and serialized definition field must
match; derived client fields are allowed. Invalid reports cannot replace a valid
catalog, and missing catalogs continue to be requested. Validation outcomes are
logged. A game-client update prepares a new validator before activation and clears
the old catalogs so reports must pass against the new version. This checks the
installed game data; it does not independently fetch a second upstream version.

Character and dashboard build history, retention, and rollback commands are
documented in [tools/BUILD-HISTORY.md](../../tools/BUILD-HISTORY.md).
These roll back generated character/dashboard code, not coordinator state or code.

From the repository root, after editing TypeScript:

```powershell
npm run typecheck
npm test
npm run build:runtime
.\scripts\start-console.ps1
```

Building the coordinator bundles alone does **not** reload the running process.
Steam CODE recovery can repair connected runners during failed/navigating group
arrivals only after confirmed release, with matching primary, assigned membership,
and destination realm. It never logs a character in or transfers ownership.
Bridge revisions invalidate class artifacts so existing one-line loaders install
the updated bridge automatically. Validate with `steam-recovery.test.cjs` and
`loader-connection.test.cjs`; publish character assets through the full restart.
Retained combat nominations wait safely when the leader has no heartbeat during
startup (`nomination-retention.test.cjs`).
Hunt turn-in and anniversary staging share the persisted continuous-return convoy.
Return combat selects only current party attackers, including while planning or held.
The ordinary class attack/support loop runs without formation, approach, kiting,
optional encounters, or combat/loot departure holds. Nearby chests remain opportunistic.
Town is synchronized through the route transition barrier. A failed/interrupted cast
supersedes all outstanding member commands immediately and selects walking. Partial
warps establish a forward Town rally; successful members are never sent backward.
Fresh current aggro selects walking. Town becomes eligible again when the party
reports no attackers, even if the enemies survived, or completes a map transition
without aggro. Missing observations do not prove safety. Temporary Town unavailability
while casting is not an interruption. Cooldown changes can release an unavailable
Town hold without repeatedly restarting an unchanged route.
Both owners retain one retry after the initial planning cycle. Native fallback is
bounded at thirty seconds; interrupted Town and combat do not consume route retries.
Exhaustion retains the first and latest failure and continues in-range defense;
owner recreation/restart cannot reset the budget. A genuinely new Town opportunity
can release a route failure. Manual navigation and communication/death recovery win.
Anniversary visits hand back to the existing post-event workflow after Main arrival;
Hunt continues its itinerary to Daisy. This does not change farming after the visit.
Validate unified-return, continuous-hunt-return, hunt-return-town, shared convoy,
movement, class skills, and anniversary tests.
Publish character and coordinator assets together for these checks.
Transition release is latched; duplicate acknowledgements
are idempotent, and temporarily stale observations wait without discarding ownership.
The travel checkpoint retains destination, stage, navigation revisions and observed
positions/progress, never ephemeral barrier readiness. Completion requires fresh
participant positions at Daisy; cancellation is not arrival. Unchanged failed rare
pursuits wait for material new evidence without changing rare/event priorities.
An authorized rare encounter carries participant navigation revisions. While it
owns a participant, the saved Hunt stage does not impose travel-only combat rules;
actual new movement commands still take precedence. Without this handoff, rare
acquisition cancels travel but cannot select a target, producing ten-second retry
loops. Cover both outbound and returning Hunt stages with the real grouped combat
snapshot in `phoenix-patrol-regression.test.cjs` and `travel-defense.test.cjs`.
Those tests must include actual death-recovery preparation, which must not apply
a second stage-based travel filter. Empty-zone searching also yields while a rare
encounter awaits combat selection so it cannot pull the leader away from regrouping.
Heartbeat scatter learning must retain grouped mode while the rare controller owns
the party, matching the mode sent to characters. A learned Hunt monster reported
during a rare encounter must not clear the shared target queue. Cover this through
fighter and merchant heartbeats and resume ordinary scatter after rare ownership
ends (`coordinator-status-composition.test.cjs`, `phoenix-patrol-regression.test.cjs`).
Validate with `continuous-hunt-return.test.cjs`, `hunt-return-regression.test.cjs`,
`movement-barrier.test.cjs`, `planner-geometry.test.cjs` and `shared-convoy.test.cjs`.
These changes include `characters/shared.js`, so they
require the full restart. An already exhausted return uses the existing
`/party-api/monster-hunt/retry-return` action after fresh runtimes connect.

For coordinator/dashboard-only changes, use `scripts/start-console.ps1 -CoordinatorOnly`.
This verifies the installed launcher, builds the coordinator, and restarts services
without installing or publishing character assets or starting their build watcher.
Use the ordinary restart when character changes must also be published.

The start script builds before stopping the previous supervisor, installs the
launcher, publishes character/browser assets, and starts the services. Use that
supported restart path to activate a manual coordinator change. It restarts the
party services, so choose an appropriate moment in gameplay.

For coordinator bundles, `--publish` is unnecessary: they are always written to
`.build/runtime/`. The runtime builder's `--publish` additionally copies browser
outputs into `characters/`. Changing the installed launcher can trigger the
supervisor's file watcher; a supervisor restart also reloads the coordinator.
Neither is equivalent to merely building a bundle.

After a restart, valid ordinary party travel can rebuild automatically after
fresh compatible reports arrive. Hunt and event returns keep their own recovery;
completed event returns release leftover convoys instead of starting another trip.
Manual cancellation and newer navigation are never authorization to retry old travel.

Hunt rosters include only fresh combat members following the current leader on
the same server. Saved Follow preferences do not enroll offline characters.
Existing cycles prune departed members before quest, backup and return handling;
departed quest owners release their selection so the current party can continue.
A stale leader report defers reconciliation rather than emptying the roster.
Validate with `coordinator-hunt-composition.test.cjs`; coordinator-only restart suffices.

Hunts return to Daisy when the selected quest is complete or expired, never merely
because it has less than three minutes remaining. The selected owner may keep
farming through the final second. Hunt's own `farm-recovery` shared walk yields on completion or expiry,
before event-pause handling. Failed farming walks also release on fresh reports,
with matching parent revisions and command ownership. Actual event travel, Escape,
death recovery and manual navigation keep priority. Test `hunt-farm-walk.test.cjs`.
Rare acquisition uses the same turn-in priority during travel and claims, so a new
Tiny P sighting cannot repeatedly cancel the Daisy convoy. Cover the real wiring
with `coordinator-recovery-hooks.test.cjs`.
An unseen engaged queue head may yield to a visible eligible alternative after
eight seconds of fresh party absence observations even when local search cannot
reach its last position. This releases an obligation, not a death: old attack
evidence stays retired and a new living sighting can nominate the monster again.
Sightings, attackers and fresh attack evidence preserve the current fight; stale
reports and activity pauses do not advance the timer. Validate with
`unseen-primary.test.cjs` and `bee-recovery.test.cjs`; coordinator-only restart suffices.

Hunt candidates use each observing party member's local search radius. Followers
can nominate the current Hunt species, including outside the original spawn area.
A completed temporary encounter continues with a fresh eligible nearby candidate
before installing a departure loot barrier or resuming the saved spawn route.
The original destination remains the fallback when no valid candidates remain.
Hunt convoy acquisition also runs during assembly and shared route preparation;
it does not require returning to the route origin first. Normal target revision
acknowledgements still govern attacks. Validate with `hunt-temporary-encounter`,
`hunt-route-acquisition`, `combat-queue`, and `fringe-targeting` tests. Publish
character and coordinator assets together with the full restart workflow.

Anniversary return readiness is retried on every coordinator tick, not only at
the event deadline. Once party visits complete, a matching saved farming or
staging walk yields to the return, including a failed walk. Saved/current
navigation revisions must match; newer manual movement and protected convoys
remain authoritative. The featured-party-member one-minute hold is unchanged.
Validate with `farming-navigation` and `coordinator-anniversary-return-composition`.

Event recovery retires an overlapping `farm-recovery` shared walk or failed event
entry walk when its saved navigation revisions still match, including after
restart. It preserves event-return commands and captured waypoints, and rejects
late farming/event-entry walking requests and event departure permission until
the event return releases ownership. This lets Goobrawl's transporter approach
and Ice Golem's exit from Winterland run before returning to the saved checkpoint.
A combat event ending during a protected Daisy return preserves the Hunt's owned
travel command. Once fresh participants have exited to Mainland, matching event
recovery yields directly to Daisy instead of dispatching a checkpoint convoy.
Legacy returns failed by an `event-return-town` replacement are retired only after
matching navigation revisions and completed Town reports; unrelated failures,
manual cancellation, newer commands, Escape, and death recovery stay protected.
Validate with `hunt-ab-return.test.cjs`; coordinator-only activation suffices.
If deferred participants reach Main after checkpoint travel was dispatched, their
matching saved navigation is included in a rebuilt return plan. A newer manual
navigation revision cannot rejoin the old return.
The return's own farming reunion walk is permitted only when its parent command
ID and navigation revision match the recorded return route; unrelated farming
requests remain blocked while recovery owns movement.

Anniversary-to-combat handoff also retires its owned `anniversary-staging` walk.
Event recovery repairs staging walks left behind by older handoffs, including
failed walks restored after restart. Both paths require matching participants
and saved/current navigation revisions, and preserve protected travel. Late
staging requests cannot reclaim movement during combat handoff or recovery.
Validate the entire return through Hunt leaving `paused-event`; arrival at Main
alone does not complete recovery to the saved destination.

Merchant collection pauses an ordinary or event-return convoy through a persisted
interruption. All members acknowledge a stop before the recipient receives its
handoff; completion or the 60-second deadline regroups the party toward the same
destination. The interruption retains shared-walk parent commands and navigation
revisions, and never authorizes resuming after a newer navigation order. Protected
Hunt turn-in remains exclusive. Both collection and commerce callers understand
the handoff endpoint's `waiting` response; publish the character runtime along
with coordinator changes to this protocol.

Recovery also recognizes orphaned event-return exit walks by their saved parent
cycle. A failed exit already at Main is retired before checkpoint dispatch; those
still outside Main receive fresh exit commands. Validate merchant interruption
during both exit and checkpoint travel, including restart, timeout, and a newer
manual move. Hunt must resume combat after checkpoint arrival.

Normal travel releases passive retained targets and waits for current attackers
and pending loot. Freshness comes from `groupedCombat.currentAttackersAt`, sampled
from a connected game client, rather than the last monster update packet (quiet
maps may not emit one). Missing reports hold travel with an observation message.
See [travel defense validation](../../docs/travel-defense-validation.md).

## Migration evidence

See [APPLICATION-MIGRATION.md](APPLICATION-MIGRATION.md) for current validation
and completion audit. [MIGRATION-HISTORY.md](MIGRATION-HISTORY.md) retains
historical checkpoints; its incomplete-state descriptions are historical.

## Live official client updates

Coordinator startup checks the official client before starting workers. After that,
headless game sockets report `welcome` and `reloaded` through worker IPC. There is
no periodic update poll. A welcome checks the official manifest; reloaded and
bootstrap repair also refresh existing script contents to catch same-version
changes. Concurrent events share one refresh; a reloaded event during a refresh
causes one follow-up check.

Downloads are staged and syntax checked, and live candidates must contain valid
`G.geometry`, `G.maps`, and `G.items` before publication. Failed preparation leaves
running workers and the selected version unchanged. New versions retain the old
cache; pinned versions are excluded from startup cache cleanup.

Activation swaps the default version, map data, and coordinator catalogs before
restarting enabled, unpinned headless workers one at a time. Each replacement must
report the selected client version and its unique process instance within 60 seconds.
A failed verification halts the rollout and publishes `clientUpdate.error`; a later
welcome/reloaded/repair event retries unfinished workers. There is no silent
rollback after activation and no claim that a syntactically valid client is guaranteed
to work with every future server change. Native/Steam sessions remain browser-owned.

The dashboard core publishes `gameVersion` and `clientUpdate`. The header displays
that coordinator-selected version without changing header layout height.


Merchants can independently select all supported events. Combat attendance uses
current equipment and the normal attack controller, without enabling farming.
New merchant jobs, gathering, and stand work pause while event ownership is
active. Production yields before its next admission and crafting uses durable
checkpoints; other in-flight work finishes before travel. Event sessions and
return ownership retain this reservation through coordinator restart. Publish
character and coordinator assets together with the ordinary full restart.
Validate with `merchant-events`, `shared-walk`, event selection/return, and
merchant checkpoint/recovery tests.

## Cave of Many Dreams

`dungeons/service.ts` owns the selected leader and online enabled followers from manual
entry through confirmed exit. Initial selection uses the roster's ten-second
presence window; entry still requires fresh three-second heartbeats. Captured
participants remain owned through disconnects and coordinator restarts. The merchant is excluded and more than three combat
participants are rejected. `runtime/dungeons/contracts.ts` defines the partial
cave wire protocol; `runtime/characters/dungeons.ts` adapts official game APIs.
`runtime/characters/dungeon-journal.ts` persists receipts before dispatch. Review
these compatibility contracts when upgrading typed-adventureland.

Cave socket requests capture correlated interaction replies before native UI handlers
using Socket.IO's prependAny hook, with listener cleanup on response, disconnect,
or timeout. This avoids Steam replies being lost before ordinary event listeners.
Eligibility reads expire after twelve seconds, retry after five, and ignore late
superseded replies. Irreversible actions retain journal reconciliation and are not
retried automatically. The settings panel shows eligibility transport errors.
Validate with `cave-request` and `daily-dungeons`; publish character assets with
the full restart workflow.

Entry is never an automatic event selection. The Events gear exposes eligibility,
manual entry/return, and protection from other events (default on). Turning that
protection off permits an enabled live event to request exit; event travel waits
for fresh outside observations from every participant. Reenabling protection can
cancel only an exit that has not been delivered to any character.

Town and Escape call cave_exit for all captured participants, including fallen
characters. Natural completion and explicit exit hold ordinary activity outside;
Resume ordinary activity or a new manual travel command releases that hold.
A disconnected member keeps ownership. Return missing participants requires a
server-confirmed resumable visit on the same server. Failed preparation can be
retried explicitly; uncertain irreversible requests require observed reconciliation.

Automatic cave progress visits unfinished required rooms, then gathers everyone at
unlocked stairs down and transports them together. It pauses for visible hostile
monsters, loot, forced choices, death, and stale reports. The panel can pause or
continue this route; a manual destination pauses automatic progress. Final-floor
completion never chooses the Mainland exit. Stairs receipts reconcile from an
observed destination floor rather than replaying an uncertain transport.

Cave combat uses the ordinary shared three-target queue and its red/yellow/double
yellow markers. Enemy/predator cave actors are nominated before they attack;
neutral/ally NPCs are excluded. Any fresh participant can contribute a nomination.
The queue is scoped to the run and floor, ignoring pre-entry farming navigation.
Validate `cave-progress`, `cave-combat-queue`, `daily-dungeons-combat`, normal queue
and movement tests. These changes require a full coordinated restart.

Native movement refreshes generated geometry and pauses for party combat, loot,
stale reports, and forced votes. Dungeon combat uses the ordinary class skill,
healing, formation and kiting routines with cave-specific targeting and ownership.
`dungeons/priest-recovery.ts` assigns one priest per death and persists permission
before an Essence can be consumed. `runtime/characters/cave-recovery.ts` prepares
the gravestone and uses the existing priest action slots, preserving living-party
healing and combat MP reserves. Outside combat, it can approach and wait for MP.
The local recovery ledger survives reloads; uncertain or interrupted casts are
never automatically repeated. The panel reports recovery progress. Nera is blocked
while a priest cast is unresolved, and remains the manual fallback otherwise.
Nera's revival choices use the same manual vote path as encounters;
shared-gold and Amber costs require confirmation and are rechecked before dispatch.
The official guide is loaded by POST /api/load_article with the JSON body
{"name":"cave-of-many-dreams","guide":true}; the public guide URL serves the game
shell. API compatibility was checked against game client version 17175.

Run `node --test scripts/tests/daily-dungeons.test.cjs` along with the full checks
above. Before production use, validate entry/partial return, generated stairs,
combat and loot, priest grave healing/Essence consumption/channel completion,
free/paid Nera revival, forced votes, expiry, and whole-party exit on
an unlimited-visit development server. Mock tests do not prove live game behavior.
Use the supported full restart workflow above for activation, then verify fresh
coordinator and character code. A build by itself does not activate this feature.

Cave combat responses override saved solo farming scopes for captured participants.
Clients accept the run/floor queue independently of mainland reset epochs and saved
leader initialization; native cave party lists can be empty, so healing uses the
captured queue roster. A movement pause stops an issued walking segment once and
retains its route, allowing combat movement without repeatedly cancelling kiting.
Validate daily-dungeons-combat and movement-service regressions; deploy coordinator
and character changes together through the full restart workflow.
Hunt pickup and outbound shared convoys recover missing completion acknowledgements
using the same three-second verified-arrival hold as continuous Daisy returns.
Fresh stopped reports must match the route, command, runtime, server and navigation
ownership; legacy per-leg returns retain their transition barriers. Validate
shared-convoy and continuous-hunt-return tests. Coordinator-only restart suffices.

Delivered equipment retains its awaiting-equip receipt instead of overwriting an
active command. Scheduling uses the merchant interruption barrier to stop convoy
participants, equip the recipient, and rebuild the saved destination under a new
route epoch after the equipment receipt. Equipment pauses outlive the merchant
job but retain the bounded deadline and navigation ownership checks. Combat and
loot are reconciled while stopping/resuming so defending reports cannot deadlock
the held acknowledgement barrier. Validate merchant-convoy-interruption,
coordinator-scheduling, delivery-precedence and inventory receipt tests; activate
with the coordinator-only restart workflow.


## Bounded Hunt route recovery

ALClient route rejection can use the existing native connector or full native
fallback. An ALClient execution failure receives one coordinator-owned native
attempt. Native exhaustion excludes that destination for the current Hunt cycle
and selects another catalogued spawn of the same monster. With no alternative,
Hunt reports the exhausted route. Recovery never dispatches a guessed door or Town
relocation. Old persisted relocation attempts are retired before further dispatch.

Explicit Hunt-off clears the Hunt cycle, commands, owned recovery convoy, failure
counts, blacklist and farming/combat recovery holds. It does not finish old turn-in
or loot stages in the background. Hunt-on creates a fresh cycle from current client
quest observations; saved settings and preferred spawns remain. Unrelated merchant
commands and event evacuation ownership are preserved. Validate hunt-mode-reset,
hunt-route-recovery and Hunt action/event tests; use coordinator-only restart.

Cruise speed is applied once per convoy/cap value and retained across phase/epoch
changes. Releasing its current owner restores 500 once; stale cleanup cannot
change a replacement owner's cap. Replacement runtimes reapply their cap without
waiting for the game's unresolved cruise deferred.

Validate `hunt-route-recovery`, `cgoo-planner`, `movement-service`, `convoy`,
`shared-convoy`, Hunt travel/event/communication and merchant interruption tests.
The game-17175 regression fixture exercises the reported blocked arena segment in
both directions, the tower, its ordinary exit, and the level4 route, using fresh
planner workers. Publish character and coordinator code together with the full
restart above; verify generation acknowledgements separately from live travel.

Coordinator JSONL storage is maintained in `persistence/jsonl-store.ts`. Startup replays one record at a time instead of reading the complete append journal as a string. Compaction writes records individually and atomically replaces the journal, with a 128 MiB size trigger in addition to the interval. Existing key/value and tombstone records remain compatible. Writer locks and corrupt-input failures preserve the original journal. Validate `coordinator-jsonl-store.test.cjs`; activate with the coordinator-only restart.


## Convoy report timing and temporary holds

Full and fast status share a runtime-scoped sequence and an atomic travel sample.
Coordinator receipt time establishes attacker freshness; client-adjusted wall clocks
do not reject freshly sampled empty observations. Reordered/duplicate samples cannot
overwrite movement/route state or renew observation freshness. Disconnected samples
cannot authorize departure. Fast replies carry complete route-owned walking leases,
which clients accept at transport receipt using monotonic deadlines. Lease-only renewals
do not change combat long-poll revisions. Commands still arrive through full status.

Observation/communication loss is a temporary shared hold, preserving retry budgets
and cruise ownership. Recovery requires fresh matching stopped reports and the existing
stability/cooldown window, then plans from current stopped positions. It never sends an
assemble command to an old rally or invents a defensive loot obligation. Genuine prior
defense/loot remains owned. Full/fast timing, clock estimates, and bounded coordinator
event-loop delay accompany travel diagnostics.

Validate `convoy-timing`, combat ingestion/channel, convoy communication/defense, shared
convoy, movement, Hunt returns, merchant interruptions and event recovery. Publish both
character and coordinator assets through the supported full restart and verify their
generations independently before claiming live travel is repaired.


## Hunt spawn arrival

Outbound Hunt travel hands off to farming once every participant reports inside
the selected spawn shape (zero margin), rather than within 50 units of its center.
Point-only destinations retain the configured search-radius fallback. The owned
convoy issues shared holds and waits for fresh stopped command/epoch/runtime
acknowledgements before releasing movement ownership. Existing loot completes
under its original owner; attack evidence survives the stop. Persisted farming
states with an outbound convoy use this same handoff.

The ordinary three-target queue then resumes. Nominations never authorize a new
pull: current-target, formation, acknowledgement, and existing-attacker checks
remain unchanged. Validate hunt-area-arrival, Hunt safety/travel-defense, combat
queue, markers, shared convoy, and communication tests. Activate with the supported
full restart and verify spawn-edge arrival and sequential attacks live.

## Shared movement communication failures

All protocol-4 shared convoys, including anniversary staging, hold on coordinator
communication loss without spending route retries. Movement errors retain typed
request metadata through executor and promise boundaries. Barrier HTTP requests
retain their two-second per-request limit and retry the same identity with 250 ms
to 1 s backoff, bounded to ten seconds and the current walking lease/ownership.
Completed transitions retry only their acknowledgement, never the transport itself.
Planner request loss also holds; validated alternate candidates remain usable.

Captured legacy communication-only failures may recover once under matching
convoy/epoch/navigation ownership; mixed route failures are excluded. Restart
restores temporary holds for protocol-4 workflows. Event cycles and kiss receipts
remain owned by anniversary policy, including expiry and Hunt handback. Bounded
status-stage and barrier timings expose handler cost separately from event-loop delay.
Validate barrier-communication, movement-service, return-planner, shared-convoy,
convoy-communication, movement-barrier, anniversary kiss/return, and status-ingestion.
Publish characters and coordinator together with the supported full restart.

## Preferred Hunt spawns

Passive rules accept maxLevel: -1 (including omitted legacy values) allows any
level; positive integers cap new intentional passive engagements. Finite caps
reject unknown levels. Stop-required pursuits and moving attacks both apply the
cap; defensive combat and explicit active selections retain their policies.
Preferred spawns reuse the Find selected monster map preview on the right.
This change includes character telemetry and requires the full supported restart
to activate; building alone does not reload running characters.

Farming settings store per-monster spawn preferences in huntSettings.preferredSpawns.
The popup lists multiple available zones from the same catalog used by Hunt routing.
Preferences apply when selecting future Hunt destinations, including recovery candidates;
missing or excluded zones fall back to the existing nearest same-map ordering.
Manual monster selection opts out. Existing missions keep their assigned destination.
The scoped settings endpoint merges per-monster patches and validates catalog membership;
an empty key restores Automatic. Settings use the existing persistence/export path.
Validate hunt-spawn-preferences and hunt-settings; activate with coordinator-only restart.

## Event entry and follower movement

A follower that reaches a selected live event before its leader stays in that
event map instead of following the leader's older outside position. Same-map
following remains available. After an awaited event join, follower walking
rechecks navigation revision, cancellation, leader identity/map and competing
movement owners. Native Goobrawl exposed the previous early exit through the
transporter. This client change requires publishing character assets with the
supported full restart; a coordinator-only build does not activate it.

Anniversary return reconciliation continues after event deselection removes all
visitors from the enabled roster. The periodic tick reconciles an already
dispatched return through its saved ownership checks, so completed travel can
release the cycle even when Hunt has been turned off. Validate the native
anniversary Hunt-off journey; activate with the coordinator-only restart.

Rare acquisition from scatter farming switches to grouped mode before capturing
its selection-admission state. This lets formation acknowledge the rare during
the existing bounded window instead of treating the first regroup tick as a
released selection. Native Hen and Golden Bat journeys exposed the failure.
Rare retry stores now resolve the selected leader's current farming-profile
dictionary, preserving rejection isolation when leadership changes after startup.
Validate native rare damage/death/chest/Hunt journeys, plus retained retry-evidence
checks. Build and use the supported coordinator restart to activate these changes.
Rare field-generator carrier selection reads normalized heartbeat inventory
entries (`slot` plus `item`), using the observed-status inventory type. The native
Tiny P regression caught the previous raw-item assumption: the real generator
remained unused while the Fairy avoided attacks and teleported. Validate actual
runtime deployment/consumption, native damage/death/chest opening and the same
Hunt's continuation. Build and restart the coordinator to activate this fix.
Membership combat reset boundaries: a joining character carries its authoritative
personal reset epoch into the destination farming controller. Invalidate that
controller's older group before publishing fresh queues; do not weaken native
stale-queue rejection or reset unrelated profiles. The native Phoenix Follow
off/on journey covers convergence and subsequent rare combat/Hunt continuation.

Franky deselection: the maintained character Franky-exit assemble handler must
install protected convoy ownership immediately after clearing voluntary targeting.
Do not wrap it in afterCombat: a surviving boss can otherwise prevent exit forever.
Existing convoy defensive behavior and ordinary travel combat waits remain intact.

A local convoy publishes its issued routeVersion at creation, before awaiting
rendezvous. Otherwise fresh fast movement leases are rejected against version
zero while a separated follower walks, causing repeated communication holds.
The native Hunt follower-reconnect regression observes rendezvous identity and
requires both actual Daisy rewards. Stale epoch, command, revision and runtime
checks remain unchanged. This character-runtime fix requires publishing assets
and the supported full restart; a coordinator-only build does not activate it.
Route preparation gets a separate 60-second clock after the party finishes
assembling. A long valid rendezvous must not consume that deadline before route
installation begins. Assembly still has its 30-second no-progress and 120-second
absolute limits; departure readiness keeps its independent deadline. The native
partial-Town restart case rejects false preparation retries as well as stranded
characters.

A single non-merchant fighter in Group mode receives the same coordinator combat
group and target authorization as larger parties. Empty groups remain excluded.
The native solo-ranger Goo scenario verifies singleton membership, committed Goo
selection and continued kills after initial attacks. Explicit Scatter is unchanged.

## Native draw and departure recovery

The game-host texture guard retains the previous sprite texture when a requested
frame is unavailable. It emits bounded diagnostics and retries the frame on later
draws, so missing cosmetic data cannot unwind native draw and movement scheduling.
The headless installer attaches this before the first game draw; browser CODE
attaches it to the parent game window. A full supported restart is required to
install the headless hook and recreate an already-stopped native draw loop.

Catalog preparation yields between bounded 8 ms batches rather than every item.
Shared departure retains its readiness deadline until all participants report
departure; late preparation acknowledgements do not spend walking retries.
Actual walking failures still use the existing bounded recovery policy.

Validate with the native missing-frame walking scenario, successive Ice Roamer
hunt rewards, and delayed shared departures, plus the retained native selector
and installer regressions. See docs/testing-ice-roamer-failures.md for failure
modes and docs/testing.md for repeatable evidence.


## Native WTB reconciliation and bank funding

Market affordability uses core bank gold when the Bank panel is closed. Active
WTB prices reopen the full price/quantity dialog; Farm price explains its farming
estimate. Native stand reports follow offer identities across moved slots and
reconcile replacement identities without treating replacement as a purchase.
Unexplained disappearance still requires fill/removal evidence. Affordable native
orders queue a deduplicated merchant bank exchange to fund one unit at the highest
allocated bid price; the native game still validates carried funds before placement.
Validate the market affordability console journey and native WTB funding/reopening
journey in live-economy.spec.ts, preserving screenshots and state evidence. These
changes need the supported coordinator/dashboard-only restart; no character asset
publication is required. Building alone does not activate the running coordinator.


Empty WTB reservations without a native offer identity now release after receipt
reconciliation and retry placement. Failed new placements back off for ten seconds;
old persisted blocks without an identity recover on the next open-stand report.
Matching offers can be adopted from a moved slot before their first acknowledgement.
Confirmed offers that disappear still require purchase/removal evidence rather than
silently counting a fill. Validate the declared historical unconfirmed-reservation
native E2E and the market editor layout journey. Coordinator-only restart suffices.
