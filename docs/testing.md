# Testing

Long-running behavior (hours of travel and farming, slow state growth) can be run in
the ChronAL simulation: `npm run sim:setup` once, then `npm run sim -- <scenario>`.
It runs the real coordinator and CODE against the real game server at faster than
real time; see `tools/sim/README.md`. It complements the live E2E suite and is not
part of `npm test`.

CX jars use `npm test -- -- --project=live --grep "CX jars"`. Setup places a
usable jar holding the first native hat cosmetic, a locked jar, an empty jar and
an "I Kiss You" emote jar in the warrior's bag; the emote row must show the
server's own skill name. A second journey opens Jump and Boop jars from the
dashboard, requires their previews to use the server's sprite sheet (the test
browser cannot load adventure.land art), records Jump in `player.last`, delivers a
Boop aimed at the priest to the priest's own socket, and shows a server refusal
after Boop's ownership is removed server-side while the client still lists it. The journey requires Usable/Locked/Empty in the dashboard
with Open only on the usable jar, then reads the server after each click: the
jar leaves the bag and the hat's `acx` count rises, Wear sets the hat slot, and
Remove clears it. The original jars, collection and worn cosmetics are restored.

Halloween attendance uses `npm test -- -- --project=live --grep "Halloween"`. The
declared fixture turns the native season on, lets the server's own timer spawn
Mr. Pumpkin, and lowers only his HP and attack. One journey ticks the Halloween
row in the real dashboard and requires both fighters to attend, kill him, and end
attendance. The other picks Off-tank in the real routine dialog and requires the
off-tank's first hit at least 4.5 s after the tank priest takes the boss, a
natively targeted off-tank to leave the boss's range, and a native death in auto
mode to count against Halloween and not Franky. Re-run the live Franky specs too.

The realm-hop blacklist uses `npm test -- -- --project=live --grep "realm-hop
blacklist"` for the real control, route validation, PVP locking and restart.
Chase choices need live ALData, which the disposable server cannot reach, so
`scripts/tests/realm-hop-blacklist.test.cjs` drives both chases with simulated
payloads (retained isolated exception; failure inventory written first).

Phoenix split search uses
`npm test -- -- --project=live --grep "Phoenix patrol splits"`. The declared
fixture replaces the server's Phoenix with one created from the server's own
`randomrespawn` definition, pinned to Spooky Forest, with 12,000 HP, attack 1 and
a guaranteed `gem0` drop. Its death uses the unmodified definition, so the respawn
is native (random region, 160,000 HP). The journey requires the two fighters to
take different regions, the first party hit to land after a gather with nobody
missing, the drop to reach inventory, both fighters to head to different regions
before the respawn deadline, and the native respawn to be found again. The passing
run: first sighting after 74 s (priest in Spooky Forest, warrior on Mainland), a
33 s cross-map converge, first hit 505 ms after the gather, and the respawn spotted
in the priest's pre-positioned region. Retain `phoenix-hold-fire-until-gathered`,
`phoenix-respawn-spread`, `phoenix-native-respawn-found` and
`phoenix-search-timeline`, then run `npm run test:e2e:verify` (36 verified
evidence files). The outsider-already-fighting rule has no live coverage: the
harness has no player outside the party. The existing native Phoenix Hunt
interruption journey still passes. Failure inventory:
`e2e/phoenix-search-failures.md`. Activate with the ordinary full restart.

Designated tank (issue #39) uses
`npm test -- -- --project=live --grep "designated tank persists through restart"`.
The live journey sets a ranger (a ranged class, so the melee override is unmistakable)
as the designated tank via `/formation`, confirms the dashboard panel renders the
selection, confirms `designatedTank` survives a coordinator restart, then sends the
ranger into real combat and confirms it reports `tank-holding` and closes to near-melee
distance against a live target instead of holding at its own long weapon range. It does
not cover the taunt/absorb aggro-gating or the kill-time luck swap live; those were
verified by code review against the skill engine and `porcupine-equipment.ts`'s
established swap/restore pattern. Retain the `tank-dashboard-before-restart` screenshot
and `tank-melee-override` evidence, then run `npm run test:e2e:verify`.

Merchant stand setup uses
`npm test -- -- --project=live --grep "merchant stand location is valid"`.
The native journey checks randomized, geometry-valid first setup, wall rejection,
dashboard coordinate edits, native travel/stand opening with a declared stand
item, and persistence through coordinator restarts. Retain the
`merchant-stand-location-settings` screenshot and `merchant-stand-location-native`
state/event ledger, then run `npm run test:e2e:verify`.

`npm test -- -- --project=live --grep "merchant finishes native upgrades despite delayed"`
replays the previous persisted lucky journal after every native storage clear,
modeling delayed caracAL IPC echoes without replacing any game outcome. The
merchant must finish a native buy-and-upgrade order to +3 with exactly one target
item. Retain `lucky-journal-storage-echo` and verify its E2E evidence.
The journey also moves the completed gear natively, reconnects with an older
running journal, and requires idle recovery to clear inventory-busy telemetry
before another order is submitted. The follow-up +1 order must finish while the
original +3 result remains intact. This expanded run passed with 32 verified
evidence files; the live original order advanced after autonomous recovery.
The focused run passed with 32 verified evidence files. The subsequent native
party-delivery and missing-journal restart journeys both passed with 60 verified
evidence files; 58 retained lucky/production/recovery checks also passed.

Lucky-slot party-delivery recovery uses
`npm test -- -- --project=live --grep "lucky upgrade preserves party deliveries"`.
The priest sends three native seashells into the empty lucky slot while its
preparation checkpoint is held, then merges one more into the displaced stack
while restoration is persisted. One injected failed return swap leaves a real
completed upgrade for reconciliation. Coordinator restart must finish the order
with exactly one +1 helmet, four seashells, a cleared lucky journal, and no replay
after another restart. The first run reproduced the stale-preparation hold.
Retain `lucky-party-delivery-restart` and verify the E2E artifacts. Use the ordinary
full restart to activate the character change; retries preserve the original order.
The fixed repeat passed with 32 verified evidence files. Typechecking, focused
lint and 34 retained lucky-slot checks passed; this is focused coverage.

Merchant mass skills and recovery use
`npm test -- -- --project=live --grep "merchant mass skills use both tiers"`.
Native buy-and-upgrade and exchange orders must request both ++ and lower tiers,
with every ++ request leaving at least 20% MP after its native 200-MP cost.
The low-MP scenario pauses the independent recovery timer and declares native
starting MP; reconnect reinstalls the production timer. A subsequent busy order
receives declared sub-20% HP/MP pools and must consume real HP and MP potions.
Skill calls forward to the unmodified native implementation; no buff conditions,
upgrade/exchange outcomes or potion receipts are fabricated. Retain the
`merchant-mass-skills-and-recovery` inventory/skill ledger and native artifacts,
then run `npm run test:e2e:verify`. Activate through the full supported restart.
The focused native repeat passed with 32 verified evidence files. Typechecking
and 53 retained passive-healing/item-operation/recovery checks also passed.

Context-menu ordering and bank mark persistence use
`npm test -- -- --project=console --grep "player context marks|bank context marks|inventory context menu and upgrade preview"`.
The bank fixture enters through the storage checkpoint read boundary; actual
menu clicks create, persist and clear a source-specific upgrade withdrawal.
Player inventory is a declared read-boundary fixture. Screenshots, HTTP responses
and persisted state are retained. This verifies menu behavior and coordinator
intents, not native upgrade/deconstruction outcomes.

Upgrade batch sizing with existing target-level stock uses
`npm test -- -- --project=live --grep "upgrade purchase batch excludes"`.
The native merchant starts with one +5 coat, sets the purchase batch to ten,
and receives a new order for four +5 coats. Before the first upgrade, inventory
must contain ten newly purchased level-0 coats and the untouched existing +5
coat. The focused repeat passed with 31 verified evidence files via
`npm run test:e2e:verify`; the initial run's artifact capture failed during
teardown. This validates initial purchase sizing, not complete order fulfillment
or continuous replenishment of level-0 stock while a batch is upgrading.

BankBoi production-gate recovery uses
`npm test -- -- --project=live --grep "BankBoi storage bypasses"`.
The declared historical fixture designates a connected merchant as a storage
worker with a waiting transaction and no production owner. Native banking must
combine three nightberries with ten and four gifts with twenty, then preserve
those quantities through coordinator restart. Worker registration/transaction
fixtures declare recovery intent; no transfer receipt or merged result is seeded.
Retain the native trace, inventory, bank, state and event attachments and run
`npm run test:e2e:verify`. Activation requires the ordinary full restart.

Durable buy-with-upgrade recovery uses
`npm test -- -- --project=live --grep "buy with upgrade target survives"` and
`npm run test:e2e:verify`. The native merchant buys/upgrades two helmets, loses one
lucky restoration swap, and retains the original order. The test removes local
local lucky and commerce journals and replays an older running production journal
whose native receipt already completed. It restarts the coordinator and requires
mirrored receipt recovery to produce exactly two +1 helmets without replay after
another restart. The lost restoration occurs on the second item, after the first
receipt completes. Initial lucky slot 30 is a declared configuration fixture, not
a fabricated discovery or game outcome. The focused journey passed with 33
verified evidence files; retained lucky-upgrade/recovery checks also passed (45).
This is not full-suite coverage. Activation requires the ordinary full restart.

The native `live-cave.spec.ts` journey covers cave party assembly/cruise, room
arrival, stopping/resuming, encounter funds, full-floor pins/waypoint selection,
native help-one-side duel completion and manual stairs through a farewell vote.
Encounter selection is bounded to upstream duel/gift/shop definitions, avoiding
the separate six-level-100-wolves challenge. The duel and farewell fixtures use
native `cave_activate`/`cave_begin_vote`; no attack, death, vote receipt, completion,
or transport result is fabricated. Inspect retained JSON, screenshots and traces
and run `npm run test:e2e:verify` after the journey.

Hunt/event respawn recovery uses
`npm test -- -- --project=live --grep "disabling inherited Franky"` and
`npm run test:e2e:verify`. The native fragile party fights Franky, enables Hunt
with declared completed initial quests, and must remain paused without acquiring
Daisy turn-in ownership. Native Rime Shatter kills the warrior; lost event
permission replies must publish retryable recovery, then normal admission must
rejoin the living boss. Deselection still evacuates both participants to Main.
The focused run passed with 34 verified evidence files. A concurrent dashboard
server required a temporary fixture using that existing isolated E2E dashboard;
the game server, coordinator and native clients remained owned by the run.
The initial `npm test` completed typechecking/building but stalled collecting the
full test directory; the successful repeat selected this spec alone. This is
focused validation, not a full-suite pass. Activate with the ordinary full restart.

Issue #28's withdrawal-triggered bank trip uses
`npm test -- -- --grep "marked withdrawals|marked bank deposit"` followed by
`npm run test:e2e:verify`. The console journey checks the default-enabled Merchant
settings checkbox, both saved values across restart, and the routine's disabled
and editable priority states. The native round trip leaves a withdrawal marked
while disabled, restarts, observes repeated heartbeats with stock still banked,
then enables the routine and observes retrieval without another bank command.
Stock and gold are conserved, and another restart does not replay retrieval.
The focused final run passed both journeys with 43 verified evidence files under
`.build/e2e-report/` and `.build/e2e-results/`; this is not a full-suite result.
After a watcher build-lock race, the final repeat used
`npx playwright test --grep "marked withdrawals|marked bank deposit"` against the
already built coordinator/runtime. Coordinator/dashboard-only activation is
sufficient. This does not certify the other automatic NPC-sale routing work in
issue #28.

The full-catalog Hunt blacklist regression uses
`npm test -- -- --project=live --grep "Hunt blacklist full catalog"` and
`npm run test:e2e:verify`. It uses the native game's many-monster catalog and
sprites, clicks both row text and sprite areas, scrolls with the mouse wheel to
the last row, searches Goo and manually adds it. Native catalog screenshots and
selected monster names are retained as repeatable evidence. If the live character
watcher races the pretest character build for its operation lock, run the same
scenario with `npx playwright test --project=live --grep "Hunt blacklist full catalog"`
after the runtime has built. This UI-only repair uses coordinator/dashboard-only
activation and preserves the published character generation.

Manual Hunt blacklisting uses `npm test -- -- --project=console --grep "Hunt blacklist picker"`
and `npm run test:e2e:verify`. The browser opens Farming settings, searches the
full monster catalog, opens Goo's details, adds it without any encounter or
death, observes the disabled repeat-add action and "manually added" label,
and verifies that the saved entry survives coordinator restart. Picker and
section screenshots, state, trace and checksummed evidence are retained under
the standard E2E directories. Coordinator/dashboard-only activation suffices.

Hunt blacklist persistence uses `npm test -- -- --project=console --grep "blacklists survive"`
and `npm run test:e2e:verify`. The console journey imports distinct owned profiles,
skips an unknown owner, starts Hunt through the backup picker, exits Hunt, and
restarts the coordinator. It exports both profiles' blacklist/count/settings
preferences, clears one profile independently, imports the export, and restarts
again. Merchant exclusions also round-trip. Execution checkpoints are excluded
from exported profiles and existing profile state is preserved on import.
The screenshot, export, final state, trace and journal are retained under the
standard E2E report/results directories. Coordinator-only activation suffices.

Production receipt recovery uses `npm test -- -- --project=live --grep "production recovery"`
and `npm run test:e2e:verify`. Two native journeys restore a declared unfinished
compound receipt with queued bank work. Without a local journal, the receipt
holds dispatch across restart without movement or inventory changes. With an
admitted prepared journal, the recovery-only command reconciles it before native
bank travel resumes. Recovery does not infer success or replay production.
The focused run retains native observations and checksummed evidence under
`.build/e2e-results/` and `.build/e2e-report/`; it does not claim a full-suite run.
This fix changes both coordinator and character code: activate it with the
supported ordinary full restart when requested, rather than CoordinatorOnly.
Orphans still require explicit review through the documented production
`resolve-unknown` operation; the fix never automatically clears their receipts.

Issue #40 uses `npm test -- -- --project=console --grep "startup realm"` and
`npm run test:e2e:verify`. The setup browser journeys use the real gateway and
startup JSON parser against a loopback public-page/account-service fixture.
They verify new/PVP realm options, account-specific rejection, connection on US V,
one discovery per startup, fresh discovery after restart, and a visible startup
failure with disabled connection controls. Screenshots and state evidence are
retained in `.build/e2e-results/` with the checksummed `.build/e2e-report/` manifest.
Production discovery reads the public game's `X.servers` JSON without credentials;
account connection still validates against the authenticated server list.

Issues #41/#42 use `npm test -- -- --grep "stale merchant recovery"` followed by
`npm run test:e2e:verify`. The native scenarios restore declared historical sale
intent, verify expiry against unchanged inventory and retention of manual/locked
marks, preserve an unrelated item under stale bank recovery, and deposit it through
the native bank API. The offline-worker scenario admits one real status report,
drops its command response, then withholds further merchant reports for the real
three-minute timeout before resuming native reporting. It checks login admission
while the job still exists and status is stale by reaching the normal assignment
conflict instead of an inventory-busy rejection; it does not claim a full native
group reconnect. Its exhausted retry
counter is declared historical setup. This is focused coverage, not a full-suite
result. Reports, native observations, screenshots and checksummed evidence remain
under `.build/e2e-report/` and `.build/e2e-results/`.

`npm test` runs console and real-game E2E through the dashboard, hosting gateway,
built coordinator, maintained character runtime and a disposable upstream game
server backed by MongoDB. Use `npx playwright test --list` for the current scenario
inventory, including six console journeys and the native-game suites. The inventory is not a passing
result. Playwright starts its console services on ephemeral loopback ports and
creates fresh coordinator data under `.build/e2e/`. The game uses fixed loopback
ports 8083 and 9003 in the disposable Docker project `al-e2e-pr21`; run one native
suite at a time. It does
not attach to the running Party Console or read its credentials.
The harness pins Express 4.18.3 to match the repository's pinned caracAL host;
review that pin alongside future caracAL upgrades.

The current inventory contains **75 scenarios: six console and 69 native-game
journeys**. Earlier validation is split across separate runs below; those 63 historical scenario contracts have passing latest outcomes.
This is aggregate evidence from separate runs and source snapshots, not one
clean 63-case execution at the final snapshot.

The solo-ranger regression runs with `npx playwright test e2e/live-solo-ranger.spec.ts`.
It uses `primaryClass: 'ranger'` to seed the existing primary fixture account as a
native ranger before login and equipment calculation. The account name remains
`E2EWarrior`; actual native class and class-specific equipment are verified.
It selects Group mode with no following fighters, requires a singleton combat
group and committed Goo target, then observes native quest kills continuing at
least ten seconds beyond the first kills. No attacks, authorizations or deaths
are synthesized. The unfixed coordinator failed to provide a group within 25
seconds; allowing one fighter fixes that mismatch. Other suites are not rerun
for this follow-up; the full app build includes typechecking.
The combined-code rerun passed with 33 verified evidence files in
`.build/solo-ranger-integrated-e2e-{report,results}`: eight native Goo kills,
including five more over 10.726 seconds after the first three. The obsolete
isolated assertion that a one-fighter group must disappear was removed; its
surrounding Scatter, merchant-exclusion and disengagement checks remain.

## Run locally

The independent solo-priest regression runs with:

```sh
npm test -- -- --project=live --grep "an unfollowed priest"
npm run test:e2e:verify
```

CI run `36648481964`, shard 5, reached the Goo spawn but never attacked: the
independent controller returned no combat group while the native priest waited
for its group target authorization. Ordinary local runs and an isolated CI run
passed when a native travel encounter completed the quest before spawn arrival.
The regression now uses native setup walking to start inside the spawn, requires
a priest-only combat group, then observes a native kill and exactly one Daisy
reward while the warrior's Hunt remains off. The unfixed code fails the singleton
group check locally. Ten related native Hunt/restart/death/merchant/solo-ranger
journeys passed with the fix; this is focused coverage, not a complete suite run.
The local run used a separate disposable Docker project and loopback ports to
avoid another checkout's active test stack; those temporary settings are captured
in its reproduction artifact and are not part of the fix.

Issue #20 recovery can be repeated with:

```sh
npm test -- -- --grep "failed delivery equip"
npm run test:e2e:verify
```

These two native journeys explicitly restore interrupted `merchantDeliveries`
settings, then observe actual failed equip receipts. One has no matching cargo;
the other seeds one helmet in the merchant inventory. Full merchant inventory
requests are temporarily dropped to verify that stale inventory cannot settle
the mark, including across coordinator restart. After communication resumes,
missing stock must clear and retained stock must be delivered and equipped by
the real clients. Both verify cargo conservation and no failed-equip replay past
the 30-second retry window after another restart. The historical seed is an
explicit recovery fixture, not a fabricated transfer receipt or equip result.
Screenshots, native cargo, receipts, traces, state journals and the checksummed
manifest are retained in `.build/e2e-results/` and `.build/e2e-report/`.
The original two cases failed because the awaiting-equip marks never reconciled;
their local evidence is preserved in `.build/issue20-red-{report,results}/`.
This focused run does not claim a full suite rerun or transaction draining on
SIGINT/SIGTERM; restart invokes the existing shutdown handler through IPC.

Merchant autoconfiguration and issue #30 can be repeated with:

```sh
npm run test:e2e -- --grep "fresh merchant|configured merchant|generic merchant|account preference|context.menu"
node e2e/verify-artifacts.cjs
```

The five selected journeys passed together. The native regression starts with no
merchant assignment, logs in real clients, checks the merchant controls, restarts
the coordinator, and executes a native bank visit. Its original red run retained
a null assignment. Dialog tests cover the configured name and generic fallback,
including donation, Ponty and both bank unlock confirmations without submitting
economic work. Screenshots, traces, state, native observations and source snapshots
are retained under `.build/e2e-results`; the checksummed manifest and HTML report
are under `.build/e2e-report`. This follow-up does not claim a full 67-case rerun.

Use Node 24 (CI pins 24.14.0), Docker with Compose and a running Linux container
engine, then run from this checkout. The first game image build downloads the
pinned upstream repositories and dependencies:

```sh
npm ci
npm --prefix dashboard ci
node tools/caracal/setup.mts
npm --prefix .caracal ci
node scripts/ci/restore-game-fixtures.cjs
npx playwright install chromium
npm test
```

On Linux, use `npx playwright install --with-deps chromium` to install browser
system dependencies. `npm test` builds the shared and coordinator/character
assets before executing the scenarios. These builds do not activate live code.
The browser runs the maintained dashboard through its Vinext development server;
the separate CI build checks production packaging.

For one scenario after preparation:

```sh
npm run test:e2e -- --project=console --grep "account preference"
```

Use `npm run test:e2e:console` for the five focused console scenarios without
Docker, or `npm run test:e2e:live` for native gameplay only. Normal game runs
collect server logs and remove the disposable containers/database at completion.

The console scenarios cover invalid settings/retry, persisted preferences,
coordinator restart, inventory menus and previews. The real-game scenarios are in
`live-game.spec.ts`, `live-economy.spec.ts`, `live-catalog.spec.ts`,
`live-franky*.spec.ts` and `live-hunt-*.spec.ts`: native
movement, party travel, Hunt, event interruption, recovery, economic operations
and catalog acknowledgement. A scenario's presence
is not evidence of success: inspect its result and attached server observations.

## Inspect and repeat the evidence

```sh
npm run test:e2e:report
npm run test:e2e:verify
npx playwright show-trace .build/e2e-results/<scenario>/trace.zip
```

Every run writes `.build/e2e-report/html/` (HTML), `.build/e2e-report/manifest.json` and
`.build/e2e-results/` (traces, videos, screenshots, coordinator/dashboard logs,
HTTP/state evidence and the persisted journal). Evidence is retained for passing
as well as failing tests. Do not add the built-in JSON reporter: embedding every
large game-state attachment can exceed JavaScript's string-size limit. The
evidence reporter runs before HTML and replaces attachment buffers with saved
file paths, so HTML links to the full evidence instead of embedding its JSON.
Each completed test also appends a flushed `.build/e2e-results/outcomes.jsonl`
record. This partial ledger survives a later reporter crash; it does not certify
an unfinished suite. The complete manifest is written before HTML generation,
outside HTML's replaceable subdirectory. The
manifest records the revision, dirty-checkout flag,
Node/Playwright versions, host and upstream dependency lock hashes, each test outcome, and SHA-256
checksums of the evidence. Re-run the recorded revision with the same lockfiles
and command; if the manifest says `dirty: true`, preserve the working changes too.
The `reproduction/` artifact contains the tracked working-tree patch and new test
sources so local uncommitted runs can be reconstructed from the recorded revision.
Source provenance is captured at run start. Keep the checkout unchanged during a
verification run; the artifact does not track edits made while workers are running.
Artifacts contain only disposable local test accounts. CI uploads the reports even
when tests fail and retains them for 14 days.

`test:e2e:verify` checks every recorded evidence hash and requires a completely
passing manifest; it exits nonzero on missing/changed artifacts or failed/skipped
scenarios. A passing integrity check establishes that the recorded evidence is
unchanged, not that a different checkout was tested.

Each scenario owns a fresh coordinator directory and process; persistence
journeys restart that process against the same journal. The runner stops only
its own processes. The dedicated upstream game stack is shared across the serial
native scenarios, with character and bank state restored before each scenario.
It never attaches to an existing developer console or public game realm. Ignored run directories
remain available for diagnosis; old `.build/e2e/` runs can be removed when no
test is running.

## The game boundary

The game stack runs the actual [upstream server](https://github.com/kaansoral/adventureland_mongodb)
and native browser clients. `e2e/game/Dockerfile` pins the game, common engine and
configuration revisions; its Node base image and npm dependency locks are pinned
as well. MongoDB and the backend are isolated in the Compose
project `al-e2e-pr21`, with host ports bound to loopback. Accounts are created
through normal registration APIs. Each scenario restores its starting character
and bank state; maintained CODE then executes actual socket actions.
Characters start at level 80 with test currency and the selected `god` or `fragile` loadout. The local
account is explicitly verified and receives legacy web access and a disposable
entitlement marker so upstream reward checks can run without Steam. These setup
prerequisites are recorded in every `live-seed` artifact.

Administrative calls establish encounters and inspect authoritative outcomes.
They must not acknowledge coordinator commands, fabricate heartbeats or perform
the action being asserted. Real-game evidence includes native socket events,
server snapshots, coordinator journals, browser action traces, native video and
final screenshots. Live traces omit repeated DOM/canvas snapshots; the native
video records gameplay without creating hundreds of megabytes of repeated JPEGs.
These tests cover a locally running game server; public realms, Steam itself and
future upstream versions remain outside that boundary.

The Franky regressions cover two boundaries. `live-franky-party.spec.ts` uses
real event entry, visible-boss damage and native runtime reports to verify that
inherited deselection interrupts combat, installs both exit owners and brings
both fighters to Mainland while Franky remains alive. `live-franky.spec.ts` restores a
sanitized historical recovery captured from the reported stuck Hunt: Town was
already acknowledged, nobody was pending, and the quest owner was in Desertland.
That prior acknowledgement and a completed gscorpion quest are declared initial
fixtures. Fresh client reports, coordinator restart, travel to Daisy and the
inventory reward execute against the real game server while Franky remains alive
and deselected. The manifest and seed attachments identify the historical boundary.

`console.spec.ts` and `hunt.spec.ts` retain the smaller simulated external-game
boundary for focused browser checks. They do not prove combat or movement; the
manifest labels each scenario's boundary explicitly. Browser requests use real
HTTP services, and non-loopback native browser traffic is blocked.

Failure modes were recorded before implementation in `e2e/game/WORKFLOW-FAILURES.md`
and `e2e/game/FAILURE-MODES.md`. See [the stack guide](../e2e/game/README.md) for
manual startup, logs, cleanup and the explicit keep-game debugging option.

## Hunt scenario coverage

These describe scenario contracts; the run manifest records which executions passed.

- **Lifecycle:** native pickup, combat and Daisy rewards; expiry/reacquisition;
  independent and uneven party quests; solo priest scope; off/on and restart;
  alternate spawn preference; invalid settings and blacklist operations;
  one-death and two-death threshold recovery; Boo Boo map-door travel.
- **Events:** Goobrawl entry, evacuation, restart and Hunt cancellation;
  Franky deselection and the reported acknowledged-return regression;
  anniversary kiss rewards followed by deselection, restart or Hunt off;
  disabled anniversary while hunting. Anniversary natural window expiry remains
  a distinct retained boundary.
- **Rare monsters:** Phoenix, Golden Bat, Cute Bee, Hen, Rooster and Tiny P
  interruptions with native damage, death, chest opening and Hunt continuation;
  Tiny P requires real field-generator deployment and item consumption;
  disabled selections and rejected settings. Initial difficulty and guaranteed
  drop tables are explicit setup, not claims about normal encounter balance.
  Cute Bee alone uses per-instance avoidance zero (normally 99.9%); normal
  avoidance probabilities are outside this workflow boundary.
- **Travel combat:** armadillo Hunt with identified Goo attacks and kills outbound
  and returning; stop-required combat and a setting change during the committed
  encounter; actual reward for both seeded quest owners.
- **Merchant work:** collection during Hunt, coordinator restart, queued merchant
  death and active-job death; exact seven-leather conservation, completed work,
  retained Hunt identity and both owners' rewards.
- **Communication and controls:** lost completion request, lost response and native
  follower reconnect; saved follower preferences, merchant rejection and clearing
  ordinary backup focus while the current quest continues. Two partial-Town
  return variants cover recovery with and without coordinator restart. The normal
  case requires over 30 seconds of real outward walking without a false recovery.
  The restart happens after outward walking starts; native Town may become eligible
  again, but requires an explicit coordinator transition and recorded native cast
  completion. Both variants require correct walking-only plans and both rewards. A lost
  preparation response must still install the next genuine defense command,
  fight and loot the encounter, and complete the original quest.

## Diagnostic checkpoints before final validation

These are historical runs, not certification of the corrected source:

- The full 60-scenario diagnostic finished **51 passed, nine failed**. Its old
  HTML reporter exhausted memory before writing the original manifest.
  `.build/hunt-full60-diagnostic-e2e-report/` and
  `.build/hunt-full60-diagnostic-e2e-results/` preserve the available evidence;
  `archive-index.json` is a later hash index of 1,622 files, not the missing
  original run manifest or a passing verification.
- The corrected reporter smoke passed **three console scenarios**, with 91
  evidence files verified. Archives: `.build/file-report-smoke-e2e-report/` and
  `.build/file-report-smoke-e2e-results/`. This checks reporting, not native fixes.
- The old-code Town/cold-defense run finished **one passed, three failed**, with
  175 evidence files intact. Archives: `.build/town-cold-red-e2e-report/` and
  `.build/town-cold-red-e2e-results/`. The Town restart variant failed on an
  incidental attack before injecting its fault; that failure does not prove the
  intended recovery bug.
- The later `.build/town-incident-red-e2e-{report,results}/` run failed its one
  scenario, with 93 evidence files intact. Native Warrior kills, partial Town,
  an outward detour lasting over 30 seconds, and both Daisy rewards succeeded;
  the assertion caught a `town:false` recovery request receiving another Town
  warp. Coordinator history at `1790615528538` also falsely reported “Town
  rendezvous made no progress” with `recoveryAttempts: 1`. The strengthened test
  rejects that false recovery attempt/history as well. See the
  [sanitized native evidence](testing-town-return-red.json).

Subsequent focused runs exposed Tiny P's missing field-generator carrier. The
fixture first needed to project normalized inventory entries through `.item`;
the production carrier selector independently made the same raw-item assumption.
The native red run retained a real generator in Warrior inventory while attacks
were avoided and the Fairy teleported. Production now reads the observed
inventory contract, and existing isolated fixtures use that same shape. See
[sanitized deployment evidence](testing-tinyp-deployment-red.json). Native
deployment, consumption, damage, death and loot assertions remain required.

Current validation is split across preserved runs, not one clean 63-case execution:

| Run archive (under `.build/`) | Outcome | Evidence |
| --- | --- | --- |
| `rare-final-e2e-{report,results}` | Seven passed | 267 files verified |
| `town-final-e2e-{report,results}` | Two passed | 133 files verified |
| `remaining54-diagnostic-e2e-{report,results}` | 52 passed, two failed | 1,475 files intact; failed manifest preserved |
| `reconnect-final-e2e-{report,results}` | One passed | 100 files verified |
| `recovery11-diagnostic-e2e-{report,results}` | Ten passed, one failed | 380 files intact; failed manifest preserved |
| `return-clock-final-e2e-{report,results}` | Three passed | 163 files verified; both Town variants and follower reconnect |

The remaining batch exposed a death-fixture fault (a lethal Goo killed both
stacked fighters, correctly reaching the two-death threshold) and a production
follower reconnect bug: route preparation published its version only after
awaiting rendezvous, causing a separated follower to reject fresh movement
leases. The corrected reconnect journey passed. All six single-character native
death consumers and both completion-loss variants passed in the recovery run.
Its Town case without restart also passed, including 42.807 seconds of outward
walking with zero recovery attempts. The Town restart case exposed an additional
retry: the old preparation clock included time spent in the long rendezvous.
The corrected preparation-clock run passed both Town variants and follower
reconnect. Aggregate verification checked every evidence hash across the six
archives, including preserved failed manifests, and found **63 unique scenarios
with passing latest outcomes**. These runs cover separate source snapshots;
they are not one clean 63-case execution at the final snapshot. Integrity of a
failed historical run does not turn that run into a passing E2E result.

The latest completed retained run passed **3,166 tests**, with strict TAP
verification and coordinator lint passing. Current production build and
typechecking pass. The final retained-suite repeat also passed all 3,166 cases.
After native verification, the timer calculation was extracted unchanged into
a helper to satisfy the complexity limit; the final build and all 149 focused
navigation regressions passed after that refactor.

## Retained isolated exceptions

The parallel audit covered 444 test files. The current
[replacement matrix](testing-replacement-matrix.md) records removals, specific
retained failure modes and gameplay gates for further replacement.

Relative to the PR #21 base, the current edits remove **36 complete unit-test
files and 176 source test declarations**, plus trimmed loop-generated variants.
Declarations and expanded runtime case counts are different measures; this is
the removal inventory. There are 2,696 retained source declarations; loops expand
them into the separately reported executed-test count.

Earlier per-file audits are historical references:

- [Dashboard/UI audit](testing-audit-dashboard.md)
- [Coordinator audit](testing-audit-coordinator.md)
- [Game/runtime/tooling audit](testing-audit-runtime.md)

The Hunt expansion has declaration-level ledgers for [lifecycle and settings](testing-hunt-lifecycle-audit.md),
[anniversary and rare events](testing-hunt-events-audit.md), [merchant, combat and communication interruptions](testing-hunt-interruptions-audit.md),
and [crosscut recovery behavior](testing-hunt-crosscut-audit.md). These distinguish
actual native outcomes from initial fixtures, partial coverage and retained race
conditions. The discovery pass found 87 files containing Hunt-related references;
its 920 declarations include unrelated cases in mixed suites and are not a claim
of 920 separate Hunt scenarios. Every discovered file is represented in a ledger.

These existing exceptions run with `npm run test:unit`, or
`npm run test:unit:ci` for the strict TAP report. Both limit Node to two test workers
(`--test-concurrency=2`) to avoid competing with native game clients and bundlers.
They require the existing caracAL
setup, pinned game fixtures, and Caddy used by the HTTPS checks:

```sh
node tools/caracal/setup.mts
npm --prefix .caracal ci
node tools/hosting/install-caddy.mts
node scripts/ci/restore-game-fixtures.cjs
npm run test:unit:ci
```

Prefer extending an observable E2E journey when fixing a feature. Never write
unit tests after the implementation. If isolation is necessary, first record its
failure modes and why the E2E boundary cannot exercise them. The harness and
browser failure-mode documents under `e2e/` show this sequence for this migration.

## CI and runner budget

Pull requests and pushes to `main` run the three **console E2Es**, evidence
verification, retained isolated regressions with the strict TAP checker, coordinator
lint and the production build. They do not start the native game stack. The
existing **Validate and release** workflow keeps its release triggers and job
dependencies; its validation step uses `npm run test:e2e:console`.

Native gameplay runs only when explicitly requested through the separate
**Native game E2E (manual)** workflow:

1. Open GitHub **Actions → Native game E2E (manual) → Run workflow**.
2. Select the branch to test and start the run.
3. Inspect all six `native-game` shards and download their `native-game-e2e-…-shard-…` artifacts.

For a focused diagnosis, supply a Playwright title regex in the optional `grep`
input. That runs only matching scenarios on one runner. Leave it empty for the
complete six-shard suite. Resolve focused failures before requesting another
full validation; a focused passing result does not certify the full suite.

Each shard installs the game/client dependencies, builds the maintained assets via
`npm run test:e2e:live`, and runs one sixth of the complete `live` Playwright project
on its own Ubuntu runner and native game stack. Test-level sharding distributes
large spec files across runners; `--workers=1` still serializes access to each
runner's disposable game. Each has a 180-minute limit;
fail-fast is disabled so one failure does not cancel the other evidence. Each verifies
the evidence even after a test failure, and always attempts to upload the report,
traces and server log. Failed or incomplete manifests still fail verification.
This workflow has read-only repository permissions and **does not publish a release**.

The normal validation and manual gameplay jobs have separate runners, report
directories and artifact names; both retain evidence for 14 days. Keeping native
gameplay manual avoids spending its build/gameplay runner time on every PR update
or `main` push. It also means normal PR validation does **not** certify native Hunt
behavior: run the manual workflow, or run the native suite locally, for relevant
changes and preserve its verified result. `npm test` still runs both projects
locally; the CI split does not narrow that command.

## Reusable native character loadouts

Native workflow fixtures default to `god`: level 80 characters wearing native +100
weapons/heavy armor and vitality rings, +20 class amulets/belts, and movement gear at bounded levels. This
speeds up combat and reduces incidental deaths. It is powerful equipment, not
invulnerability: the upstream server calculates damage, healing, movement, and death.

Select the nearly unequipped baseline for mortality-sensitive journeys:

```ts
test.describe('death recovery', () => {
  test.use({ loadout: 'fragile' });
  test('recovers from native death', async ({ live }) => {
    // Exercise the actual game/runtime workflow.
  });
});
```

`fragile` keeps level 80 and the original starter weapon, helmet, and shoes at
level zero, with no other defensive equipment. Both profiles are centralized in
`e2e/game/loadouts.ts` and seeded into the disposable database while all clients
are disconnected. Each result includes `native-loadout-seed` with exact equipment
and `live-server-initial` with the native calculated HP/MP, attack, frequency,
speed, armor, and resistance. These scenarios validate workflow behavior rather
than normal player combat difficulty or natural gear progression.

The native Cave regression is in live-cave.spec.ts. Run npm test -- -- --project=live --grep 'Cave entry closes'. It seeds the party beside Dorr, uses native entry and votes, captures both participant maps, verifies both characters reach selected rooms, stops and restarts manual travel, inspects the shop item, and checks exit confirmation through the dashboard. Artifacts include native-cave-entry, native-cave-choice, participant cave-map screenshots, native-cave-manual-travel, and native-cave-exit. Fixture reset destroys only generated runs belonging entirely to its test account, preventing a prior failed run from becoming a resume visit.
