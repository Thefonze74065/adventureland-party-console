# Testing

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
