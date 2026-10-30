# Changelog

## Unreleased

- Add upgrade chance guards, scroll floors and fail stacking (#152, #78, #65). A guard holds a real upgrade attempt unless the server's own preview chance, which already includes ugrace, server ugrace and ograce, reaches a minimum; held marks stay queued and are retried after ten minutes or when the guards change. A scroll floor spends a higher-grade scroll than the item needs, which the server rewards below +10, and the merchant stocks it. A fail-stack job burns exact, unlocked, plain spare copies at a chosen level, optionally with a Primling, until an attempt limit or a stop chance measured on the kept item. The estimator models item grace, ograce, server grace, offerings and higher-grade scrolls when given grace options. The dashboard adds a Chance guards section and a Fail stack dialog beside Prim stack.

- Find giveaway hosts through the game's merchant directory when they are not in sight, walk to their stand and join, instead of failing at the market; report hosts on another realm, without an open stand, or inside the bank, and skip discovered giveaways inside the bank (#129). Expire queued giveaway jobs at the giveaway's real remaining time rather than two minutes after a marketplace observation, log a warning when one expires unattempted, and release its claim so a still-running giveaway is queued again.

- Remove the arbitrary successor spawn-distance requirement from the queued Goo E2E test, retaining actual combat and fresh party confirmation checks. Allow 240 seconds for event-handoff checkpoint returns so communication safety holds can recover on slower CI runners.

- Stabilize the roaming Goo E2E fixture by starting its declared native movement leg after all clients acknowledge target selection, preserving interception, damage and fresh whole-party confirmation checks.

- Stabilize native merchant regressions around consumed compound ingredients and stand reconciliation. Split Cave interface/navigation coverage from floor completion and displaced-stairs recovery into fresh visits, retaining native combat and floor transitions without extending the game timer.

- Resume travel toward the saved farming spawn when a targetless party has drifted apart. Empty-spawn recovery selects a newly visible eligible monster before reaching the spawn center, retaining independent approach and whole-party attack confirmation.
- Fix the goldenbat Hunt regression's encounter-setup race at the spawn boundary. Preserve the hawk approach fixture's declared first-monster movement settings while its successors roam, and cover automatic spawn return with native movement and damage evidence.

- Fix a lucky-slot E2E timing race by waiting for exact coordinator roll totals after merchant job completion. Document asynchronous fixture timing and evidence requirements in repository guidance.

- Stabilize native terrain and Cave E2E checks: capture Targetron approach positions independently of sparse server updates, and recognize distinct native Cave travel, combat and encounter progress without extending the absolute completion deadline.
- Declare the native layout for Cave shop-inspection coverage; retain randomized and missing-shop coverage in the separate regroup scenarios.

- Prevent priest healing from cancelling an active Town cast during travel or event recovery. Healing resumes after arrival or interruption; waiting for departure or other party members still permits healing.

- Keep declared Mr. Green and Mr. Pumpkin stats active throughout the native event-switch regression, including native stat recalculation, then restore them during cleanup. This prevents unintended boss movement from turning ranged damage checks into intermittent projectile misses.

- Prevent native event-entry and manual-travel recovery tests from accidentally timing out planner requests while inspecting them. Fault injection now observes actual status traffic, preserves exact journey ownership, and records decision latency and transport failures.

- Recover Cave participants displaced after completing a waypoint or stair approach, waiting for combat to clear and issuing bounded independent return paths before continuing the floor transition.
- Honor disabled Town shortcuts during event walking retries. Exhausted event entry now returns the owned party through Main to its saved checkpoints and skips that occurrence, preventing stranded survivors and repeated rejoin attempts.

- Match native manual-travel fault injection to the current assembly journey and command, preventing delayed event requests from causing false recovery-test failures.

- Make native Cave regroup test setup tolerate an optional entry shop with no valid NPC placement, with a reproducible missing-shop layout alongside randomized coverage and unchanged regrouping checks.

- Reconcile BankBoi transfer-row requests at startup and after account changes, clearing stale staging work when the final BankBoi is removed without requiring another bank visit.
- Recover displaced manual upgrade work from unfinished inventory without confusing completed copies for survivors. Report item, levels and candidate slots for genuine ambiguity, and pause retries until relevant inventory or upgrade intent changes.

- Keep approaching a selected combat target's last known position when it temporarily leaves everyone's view. Reacquisition preserves whole-party attack confirmation; confirmed local absence retires the target after the existing bounded search.

- Update retained equipment-comparison and merchant-upgrade test fixtures for loadout totals and manual offering checkpoints, preserving their existing behavior assertions.

- Apply upgrade offering rules to manual as well as automatic upgrades, collecting batch supplies from the bank and BankBoi before resuming. Preserve upgrade identities and intermediate progress through storage handoffs and restarts; wait for remote inputs before admitting upgrade work and retry interrupted storage checkpoints.
- Let a peaceful priest round terrain toward the party's recovery mover, preserving combat and monster-clearance checks.
- Hide irrelevant +0 levels on stand buy orders for items that cannot be upgraded or compounded.

- Let an explicitly authorized Franky evacuation cross a door while a living monster still targets the party, preserving Town, loot and ordinary-travel safety checks.
- Bound the native cold-defense response fault to its intended recovery phase, and observe safe-reload walking coherently so short real movements are not missed by test preflight checks.

- Align native farming-handoff coverage with the explicitly requested catalog farm area and normal weapon ranges, retaining physical arrival and real post-arrival attack checks.

- Declare native gathering skill availability before login in capacity regressions, preventing queued login cooldown updates from racing the test setup while preserving actual inventory-blocking checks.

- Keep native Cave staging responsive during exhaustive terrain searches, preserving player connections and rechecking current safety before the assembly regression.

- Recover interrupted initial party assembly after a route-planning network failure, using fresh stopped acknowledgements before continuing manual travel out of an event. Verify native return response-loss recovery even when a genuine terminal arrival precedes the test fault.

- Stop and revalidate an owned walking segment after an accepted native position correction, preventing stale movement velocity from carrying a return route into blocked terrain. Keep the retained corner-connector fixture aligned with the native socket contract.

- Lead moving combat targets using their native direction and speed plus each fighter's speed and a 10-unit margin inside attack range, reducing short chase steps while preserving terrain safety and fresh whole-party attack confirmation.
- Keep manual travel in control during events by skipping only the current occurrence, preventing event rejoin loops while preserving future attendance.
- Hand completed individual approaches back to normal combat, preventing repeated tiny approach/cancel cycles and false movement-failure messages.
- Prefer directly reachable attack-range positions during individual combat approaches; promptly shrink the approach radius when the planner confirms a disconnected destination, while retaining fresh whole-party readiness checks.
- Keep native E2E scenarios isolated by restoring ambient monsters and retiring temporary combat monsters correctly; verify moving-target input before interception checks, current native checkpoint snapshots, public state readiness after explicit test restarts, and completed Cave results arriving during a control click.

- Make native event-return fault tests observe the live endpoint promptly, avoiding travel-command expiry during test setup without relaxing recovery assertions.

- Let ranged party members approach their target when another long-range monster is attacking a teammate (#121; thanks to Thefonze74065).
- Expand native Cave setup and terminal-return coverage, preserve actual saved checkpoint receipts, and retain bounded movement diagnostics.

- Keep acknowledged final travel completion recoverable after a completion-report transport failure.

- Preserve authorized Halloween staging while characters are still waiting to report joining the announced event, preventing premature returns before its spawn.

- Restore attack range before continuing ordinary combat kiting, preventing prolonged disengagement while preserving terrain and attacker clearance.

- Recover shared return completion when a character has already acknowledged its final native transition, preventing its peers from waiting indefinitely without replaying the transition.

- Retire obsolete event-exit instructions in heartbeats while preserving deferred checkpoints, so characters can enter a new event without waiting on an old return.

- Let eligible live events retire obsolete deferred return commands before admission, preserving saved checkpoints and attendance limits.

- Require an exhausted owned walking route to settle at its destination before reporting arrival, preventing false Cave regroup completion after combat displacement.

- Verify brief manual merchant weapon swaps using ordered native item receipts, retaining gathering restoration and restart checks.

- Verify headless movement after a console reload from the character's actual settled position, avoiding contradictory endpoint assumptions in native deployment tests.

- Keep native Cave regroup tests clear of encounter pauses by resolving the actual entry-shop choice during setup and checking unfinished encounter clearance before walking.

- Give native event-return tests a separate bounded recovery window after their deliberate CODE replacement, with retained reload and arrival timestamps.

- Verify terrain recovery against actual native movement segments and independent approach ownership, preserving strict movement and attack timing checks.

- Identify the exact native Cave farewell encounter in stairs regression tests, so a different encounter with the same title cannot start the continuation deadline early.

- Make native queued-target regression scenarios introduce successors during a confirmed fight, preserving real movement and fresh-confirmation checks without assuming pre-fight target rankings stay fixed.

- Preserve independent combat route ownership in movement diagnostics from the very first step; keep declared native Halloween encounter charge consistent throughout E2E scenarios.

- Start individual combat routes immediately and recheck range as soon as an owned route finishes or fails, avoiding extra polling delays between smaller-radius approach attempts.

- Keep independent combat approach and attack readiness consistent across full heartbeats and fast combat reports.

- Fix fighters holding when a selected target is outside their local view; approach fresh party observations while requiring native visibility before attacking.

- Replace shared next-target movement with independent routes for each fighter: move directly when terrain permits, otherwise use native smart movement and progressively smaller approach radii. Use the game's actual attack range, including ranged attacks through walls.

- Recheck every fighter's range immediately before starting a queued fight, with an event-driven confirmation round and no added waiting period. Reject confirmations that expire before the attack is sent and refresh them immediately. Preserve smart-route progress as monsters move and resume approaching at a smaller radius when a ready target moves out of range.

- Reduce native E2E recording overhead while retaining screenshots, traces and game-event evidence; enable diagnostic video explicitly with E2E_NATIVE_VIDEO=1.

- Improve combat formation recovery with safe follower positions inside the party healing envelope, correct retreat movement, and prompt retries when stopped followers cannot find a safe route.

- Fixed merchant collection getting stuck approaching inaccessible transporter centers, including Desertland; use collision-clear points within the native interaction range.

- Fix headless movement and event-return stalls caused by native pathfinding restoring a CODE-scoped visibility wrapper; preserve the original game visibility function across planning and CODE reloads.

- Add bounded route-planning scheduler diagnostics to distinguish delayed native callbacks from movement-owner pauses during recovery investigations.

- Preserve command-owned native Cave waypoint arrival evidence when subsequent combat movement occurs between E2E samples, without relaxing arrival or ownership checks.

- Reduce native E2E browser request overhead by keeping loopback traffic outside request interception, with an owned denial proxy preserving external network isolation.

- Avoid unnecessary merchant realm restarts during brief heartbeat gaps when its live connection is already on the configured home realm; keep work held until fresh status returns.
- Acknowledge an already completed final native travel transition without restarting a zero-distance route after its shared signal expires, while retaining ownership and pause safeguards.

- After a confirmed failed Town shortcut during Franky evacuation, retry walking within that return cycle instead of repeatedly attempting Town.

- Repair short terrain-blocked walking segments on future maps with native-certified local connectors, avoiding full cross-map replanning during event returns.

- Reconsider Town during owned event and Hunt returns when it becomes safe again, instead of reusing a long walking route selected while Town was unavailable.

- Retry transient Windows sharing failures when releasing a console build lock, while preserving ownership and bounded failure handling.

- Preserve newly admitted Hunt and shared walking journeys when delayed respawn recovery falls back to farming.

- Repair native walking routes whose final goal connection crosses terrain, retaining the exact owned destination and validating every repaired segment against native collision geometry.

- Give native Cave completion tests a bounded allowance for distinct room/choice progress, while retaining quiet-time failure, an absolute cap and all native completion assertions.

- Preserve cross-map event travel when the same boss moves within its destination map, then pursue its latest verified position after arrival instead of repeatedly restarting transit.

- Add an opt-in native Cave rendering diagnostic and retain failed room-assembly geometry for repeatable movement investigations; normal gameplay CI remains unchanged.

- Let combat formation routes proceed immediately when local obstacle recovery has no safe candidate, and release real local attempts after their existing bounded window.

- Keep Escape recovery held until every fighter has a settled movement arrival in Main town, preventing early farming resumes while teammates are still returning.

- Retain bounded native route-search timing diagnostics to distinguish search CPU cost from scheduler delays in movement reports.

- Record actual Halloween boss participation for assisting followers so event recovery returns every fighter to its saved farming checkpoint.
- Make console-build lock cleanup tolerate transient Windows filesystem failures without deleting a successor build lock.
- Wait for genuine native player presence when observing Hunt interruption recovery, without replaying gameplay mutations.

- Keep realm switches active while distinct characters make verified arrival progress, with bounded no-progress and total deadlines; superseded operations cannot clear successor commands.

- Bound verified native pathfinding search slices to keep combat and coordinator heartbeats responsive, preserving native routes, deadlines and freshness checks.
- Skip unnecessary Town and bank trips after item-only merchant service when no bank cargo or positive gold deposit remains.

- Keep followers on the shared saved farming checkpoint when joining a leader during an event, without persisting the temporary rendezvous as a personal return destination.

- Retain rare encounter admission until the exact combat queue is acknowledged, avoiding permanent rejection from pre-handoff status reports.

- Verify explicit native combat fixture wire overrides and catalog projections, and acknowledge Cave entry freshness rejections without duplicating accepted entries.

- Preserve authoritative event-return ownership through CODE replacement, keeping early finishers defensive and coalescing recently stale same-cycle exit peers within the existing request window.
- Record actual native Hunt readiness and preferred-area arrival before combat drift during E2E validation.

- Allow login recovery past stale merchant jobs while retaining fresh inventory fences and bounded party-realm reconnect ownership.

- Reduce combat recovery collision-search overhead while preserving live terrain checks and planner budgets.
- Stabilize native E2E choice acknowledgements, reconnect/catalog readiness and combat sampling; preserve real gameplay and conservation assertions.

- Keep native Cave vote acknowledgements and reconnect-frame checks tied to the exact original choice or frame, avoiding stale duplicate actions during E2E validation.

- Preserve confirmed lucky-slot upgrade results during interrupted restoration; leave manually moved results and changed cargo untouched.
- Recover committed Cave enemies around blocked terrain while retaining scoped target and travel-handoff guards.
- Keep local Cave waypoint placement responsive during heartbeat freshness gaps; actual waypoint submission still requires fresh participant reports.
- Reacquire native test observers after reconnects without replaying mutations, and fetch event deltas to limit observation overhead.

- Keep eligible reserved passing encounters ahead of equal-priority newcomers until admission completes, while preserving higher-priority targeting and attack guards.
- Let stopped, freshly owned party members complete map-transition barriers under bounded network latency, retaining position, identity and walking-lease checks.

- Let respawning event fighters rejoin a roaming boss without recalling allies already actively fighting it at its new position.

- Preserve native Steam companion launch flags and CODE slots across realm navigation so saved merchant work can resume.
- Record combat-recovery latency inside native clients and wait for discovered monster catalogs before configuring native hunt scenarios.

- Keep authoritative entity reconciliation active for retained combat targets even when no role target is currently attackable.
- Make native Cave scenarios wait for boss completion before starting the next encounter, and preserve test evidence during character reconnects.

- Preserve newer fast-channel convoy ownership against delayed full status responses, preventing interrupted event return journeys.
- Preserve selected upgrade offerings through production authorization and reserve merchant ownership during independent realm transitions.
- Refactor coordinator predicates without changing behavior to satisfy strict CI lint checks.

- Recover collision-blocked walking routes through safe forward segments, select reachable formation-recovery positions, and wait for escape movement to settle before resuming.
- Preserve passing-target admission during travel while respecting combat-drain holds.
- Refresh retained regression fixtures for current inventory, deployment and account contracts, and make native readiness and fault-injection checks match actual game boundaries.

- Align native lucky-slot recovery coverage with best-effort restoration: retire ambiguous journals without inventory swaps or repeated upgrade attempts, while retaining provable restoration.

- Verify map screenshot pixels and the real image proxy in separate E2E journeys, using stable game observations and real dashboard state instead of duplicated status fetches.

- Keep the full Cave map dialog accessibly named across encounter updates and allow its native waypoint test the existing bounded UI readiness window.

- Supply compiled character CODE in isolated console fixtures and keep opt-in Docker journeys out of the default CI selection, preserving complete regression evidence.

- Run the prepared-runtime deployment benchmark in CI without requiring a local artifact, preserving complete executable-installation evidence.

- Prepare console artifacts before pausing gameplay and publish prevalidated coordinator runtime files, reducing deployment interruptions while preserving readiness checks and rollback.

Changes queued for the next release. The release workflow determines its version
from the commits merged into `main`.

- Add per-tab Hide stale listings filters to Live WTS, Live WTB, Classifieds and
  Ponty, plus persistent ignored items matched by exact item and level. Manage
  ignored items and merchant blacklist entries in collapsed, bordered sections.
- Simplify Stand and Market WTB displays: remove Auto badges and minimum wording,
  and rename Use stand to Keep on stand.

- Make console deployment a durable transaction: hold new combat pulls after candidate preparation,
  renew the hold through activation, wait for all browser and headless clients,
  and restore activity together after three continuously safe seconds.
- Add Load at Main with fighter checkpoint return and a brief merchant-operation
  boundary; keep only Load now available inside Cave.
- Restore deployment progress after refreshing, preserve dashboard view state,
  and avoid refreshing the page for gameplay-only updates. Prewarm dashboard
  builds and move slow history cleanup outside deployment completion.

- Restore the shared upgrade-offering resolver required by upgrade menus in
  clean installations; verify offering badges with pinned native sprite pixels.

- Fix staged console builds on Linux and macOS by installing isolated dependency
  caches without npm executable symlinks and bypassing older linked caches.

- Add sound-effects and music mute buttons to the in-game Characters bar,
  reflecting native audio settings and preserving music preferences on CODE reload.

- Compare two-handed weapons against the equipped mainhand and offhand by
  default, with an offhand checkbox on the equipped side. Remove offhand stats
  from the proposed loadout and recalculate gained and lost set bonuses.

- Show the deployed artifact hash below the header version without changing
  header sizing or page layout.

- Match bank-item action banner fonts, wrapping, and border styling to player
  inventory banners.

- Disable legacy coordinator-file and TypeScript watchers in managed console
  processes so source changes cannot restart characters outside explicit loading.

- Route combat approaches around multiple terrain corners immediately when the
  direct path is blocked, retaining collision and healing-coverage safeguards.

- Clarify upgrade menus by showing an offering icon only when the final upgrade
  step for that destination has a matching rule; earlier-step rules still apply.

- Replace the logs sidebar's character dropdown with individual toggle pills,
  with every character selected by default.

- Disable filesystem-triggered CODE reloads in managed consoles. Headless and
  browser characters adopt code only from an explicit host activation record.

- Resume gameplay before reporting reload completion, without waiting for build
  history cleanup. Park safe-reload movement without cancelling farm, hunt or
  event journeys, keep held heartbeats healthy, and permit CODE replacement
  during travel and combat while retaining inventory safeguards.
  Add a lower-left refresh badge for completed builds since
  deployment, showing at least one whenever the icon is visible.

- Shorten the Party Console controls to Stand, Market and Bank.

- Keep reload interruption and failure diagnostics in the host journal without
  displaying messages through the Party Console reload control.

- Fix safe console reloads waiting indefinitely after event or hunt combat on
  local installations by sharing the host's maintenance directory with the
  coordinator, including when AL_DATA_DIR is not explicitly configured.
  Remove build and deployment status messages beside the refresh icon.

- Deliver pending reload holds through fast combat updates, block successor
  handoffs and recheck attack eligibility so queued targets stay unengaged.
  Show only the spinning reload icon while deployment is pending. Exclude
  machine-specific font caches from console artifacts to restore dashboard fonts.
  Retry brief Windows file-sharing conflicts when saving deployment journals.

- Fix first console-artifact activation rejecting its managed native dependency
  junction before starting the coordinator.

- Add Load now and Load when safe to the console reload menu. Immediate loading
  warns about combat deaths; safe loading finishes current fights while blocking
  new targets, then deploys after three continuous seconds of fresh combat-free
  acknowledgements, restarting the window if combat resumes. Animate
  the refresh icon throughout the pending reload.

- Recover combat approaches blocked by terrain by choosing a reachable side of
  the target and retaining that detour until it completes. Healthy, unattacked
  melee fighters may briefly separate from healing coverage for that detour.
  Use native hitbox distance for recovery goals, admit mage attack range before
  preferred target spacing, and retire old movement when switching targets.
  Addresses #75, #83 and #85 on `bugfix-1.4`.

- Stage complete console builds in the background and add a refresh control
  beside Party Console to deploy a completed build at a chosen moment. Builds
  and tests no longer replace running source-development code automatically;
  restarts resume the active build, with retained history and rollback on failed
  activation. Addresses #79 on `bugfix-1.4`.

- Resolve coordinator and native CODE lifecycle support from the selected
  immutable console artifact, retaining installed native dependencies and mutable
  storage. Activate only changed components and verify running coordinator,
  dashboard and character bundle acknowledgements before completing deployment.

- Allow merchant item collection after convoy travel has failed, once the party
  acknowledges a safe stop. Preserve the original travel error and exhausted
  retry limits instead of repeatedly timing out each nearby collection job.

- Return event participants independently when a follow-mode change leaves them
  with different saved destinations, without waiting for an unrelated leader route.
  Keep ordinary following paused until the active return cycle finishes.
- Keep timestamp-based event identities stable across clock synchronization and
  CODE reloads. Crab attendance no longer resets its timer on clock updates;
  limits added during attendance include time already spent in that instance.
  Treat fully exhausted selections as disabled and recover open event trips
  even when CODE replacement has lost the local join marker.
  Include members whose later heartbeat exceeds the limit in the same return.

- Release members held by an event return when another selected event is live.
  Retire their matching return commands, preserve the original checkpoint, and
  let followers join their leader's next event. Fresh enabled event reports
  also exclude members from new ended-event returns. Fixes #93 on `bugfix-1.4`.

- Fix Steam merchants hanging when giveaways, Ponty purchases, ALData purchases
  or sales, or stand return require another realm. Navigate the Steam game page
  after the coordinator accepts the switch; retain headless restart behavior.
  Send Steam merchants a native realm-switch command for coordinator home returns.
  Steam party realm switches also accept Roman-numeral destinations IV and V.
  Fixes #86 on `bugfix-1.4`.

- Keep the event dropdown open while editing and saving event settings, so the
  next event's settings gear remains available immediately.

- Give event priority rows outlined cards, a moving drag preview, and live
  reordering like merchant routines. Add per-event death and time limits with
  blank defaults for unlimited attendance. Exceeding a limit skips that event
  instance, resumes the saved farming task or the next eligible event, and
  survives CODE reloads and coordinator restarts. Followers inherit the leader's
  configured limits; Cave remains outside event attendance priorities and limits.

- Remove stale BankBoi storage records when a refreshed account roster confirms
  the character was deleted outside the console. Recorded inventory no longer
  disables the confirmation button; existing characters retain deletion safeguards,
  and failed roster refreshes preserve storage records.

- Show automatic bank, NPC sale, deconstruction, stand, upgrade, compound and
  exchange rules on bank and Bankboi items. Use “Auto NPC” for automatic sale
  intent and “NPC sale” for individually marked items.
- Recover bank NPC-sale withdrawals when rules or merchant settings change.
  “Marked withdrawals always create merchant jobs” admits even small bank
  pickups; with it disabled, Automatic item collection also visits the bank
  once its marked-slot threshold is reached. Rename the delivery setting to
  “Marked deliveries always create merchant jobs” and preserve deduplicated,
  protected stock and native withdrawal/sale receipts.

- Add screenshot capture to expanded map views for debugging. Character and
  Cave maps open an immediate image in a new tab, with the map and camera-center
  coordinates included in the image footer.

- Make lucky-slot swap restoration best-effort: changed inventory layouts no
  longer hold subsequent merchant work. Preserve confirmed upgrade outcomes and
  actual result locations independently of swap-back. Advance unlocked discovery
  one inventory square per recorded roll with a durable cursor; locked positions
  keep collecting rolls without moving.

- Run native gameplay CI across 16 isolated runners: one for each of the three
  Cave scenarios and 13 for the remaining suite. Increase retained unit-test CI
  concurrency from two to four isolated test-file workers.

- Save a separate event attendance priority for each character. Drag supported
  events to reorder them; followers inherit their leader's order and merchants
  retain their own. Higher-priority events can replace lower-priority attendance,
  and the order survives coordinator restarts.

- Show queued merchant item collections as red “blocked” in the logistics list
  when inventory capacity reaches the three-slot reserve (39/42). Include a
  capacity explanation on hover and restore “queued” when space becomes available.
  Show due fishing/mining in logistics as red “BLOCKED” at capacity, hide modes
  that are still cooling down, and defer gathering without casting or resetting
  its cooldown until space returns.

- Show uncertain merchant upgrades as errors with item, tier and inventory-slot
  diagnostics. Log each admitted order retry with its actual scheduled timestamp
  in explicit UTC and retain the numeric deadline for remote consoles.

- Resume an unlinked interrupted commerce upgrade using compatible unfinished
  inventory when available, recording an explicit adoption assumption. Preserve
  paid spending and attempts, protect reserved stock, and keep existing finished
  items outside the order's newly produced quota.
  Its command-fenced adoption view excludes only its own commerce identity
  reservations while retaining craft, delivery and other-order protection.
  Record the adoption audit at its authoritative checkpoint so CODE replacement
  cannot lose the assumption message after paid progress has been accepted.

- Stage Bankboi compound deliveries without starting empty merchant improvement
  visits. Remote inputs become runnable after their genuine native-bank deposit;
  carried triples, native-bank inputs and leftover storage remain available.

- Retain bounded completed production evidence for commerce orders and replay
  its confirmed outcome after a lost completion response or CODE restart.
  Recovery requires the exact paid order sequence and input identity; historical
  receipts without that provenance remain subject to inventory review.

- Defer automatic compounds that require bank or Bankboi inputs while the
  merchant has only its three reserved slots available. Keep carried triples
  and bankable leftovers runnable, and resume external work when genuine
  inventory changes free space instead of repeatedly scheduling empty jobs.
  Already admitted jobs report capacity-blocked withdrawals instead of false
  success, retaining completed withdrawal acknowledgements.

- Transfer the matching deferred return party together when a new combat event
  is admitted, so blocked followers retain their checkpoints and can join.

- Apply event-return ownership on fast heartbeat receipts so an awaiting old
  exit cannot retain a fighter after new event admission; fence delayed replies.

- Route event combat around native terrain with a bounded, owned local detour,
  preserving secondary-attacker clearance so Goobrawl survivors remain reachable.

- Keep owned party travel moving through native explosion splash from monsters
  fighting another player. Genuine party-target attacks, direct hits and unknown
  attackers retain defensive interruption and existing external-claim protection.

- Drain held native commerce checkpoint requests before test teardown and
  handle a completed Cave shop result reopening over waypoint controls.
  Wait for the separate native compound receipt before checking finite-rule
  conservation, retaining its original processing deadline and quota checks.

- Keep every requested character in party escape recovery when class metadata
  arrives late or classes are duplicated. Use independent evacuation when the
  skill sequence cannot cover everyone, and reconcile matching persisted death
  recovery membership after coordinator restart without changing newer navigation.

- Confirm requested homes using fresh native reports for connected characters
  and the refreshed account roster for offline visitors, so completion and home
  projection agree within the existing confirmation budget.

- Reject obsolete event-return walking requests after their cycle authority
  ends, and retire an owned deferred exit even after another peer has already
  transferred to the next event. Preserve newer commands and ordinary Town returns.

- Release an owned failed event-entry route when a fresh participant selects a
  different live event, and keep event rendezvous from waiting on characters
  joining another event. Preserve same-event retry limits and newer commands.

- Retire an already admitted deferred event-return walk when a new combat event
  takes ownership, preserving saved checkpoints and newer navigation owners.

- Keep farming navigation until the leader is actually in native attack range,
  rather than yielding across terrain to a merely visible monster. Both travel
  handoff paths enforce the selected farm boundary, and fresh observations
  retire farming targets that leave it while preserving defense against party
  attackers. This prevents stale encounters from holding relocation indefinitely.

- Fence retired Anniversary item-response callbacks before reading native
  character getters during Steam CODE replacement, preventing detached-frame
  errors while preserving native socket handlers and the active game window.

- Allow an offline secondary merchant to set its account home without requesting
  the designated merchant's production receipts. Its own production journal and
  pending lucky-slot safeguards still apply.

- Fetch native CI database and game base images through a digest-pinned mirror to avoid
  shared runner Docker Hub download limits; local cached-image defaults remain.

- Count automatic compound production only when native inventory gains the next
  tier. Failed rolls continue with remaining ingredients instead of consuming a
  finite production quota or reporting a successful compound.

- Retire combat-return commands when their recovery completes, and clean up
  historical orphan returns within each active farming profile. Live and
  deferred recovery cycles retain their movement ownership. Heartbeats release
  abandoned running exits. A newly authorized event takes over a deferred return
  while preserving its still-authorized farming checkpoint for the next return.

- Separate native Goobrawl survivor combat from Hunt-off evacuation validation,
  and keep initial gold in the focused item-delivery fixture so unrelated bank
  deposits cannot obscure its durable item receipt and conservation checks.

- Respect the native one-merchant connection limit when changing every account
  character's home realm: temporarily pause and restore a managed merchant for
  offline merchant visits, even when total connection capacity remains available.
  Steam-only incumbents produce an explicit capacity error without replacing them.

- Include protected BankBoi stock when selecting upgrade offerings and waking
  required offering rules. Manual and automatic upgrades retrieve fully available
  stored offering stacks through the existing BankBoi handoff before production;
  locked, bound and reserved cargo remains protected.
- Identify dedicated BankBoi storage workers on their first heartbeat so ordinary
  potion restocking cannot replace a storage transfer's bank journey at startup.

- Make native bank-sale validation wait for every actual sale receipt, and
  establish fresh Cave observations before floor validation. Cave assembly
  fixtures search native collision-safe staging beyond cramped entry areas
  while retaining combat-room clearance and real movement assertions.

- Resume paid upgrade batches after inventory sorting moves identical owned
  items: restore disjoint batch slots only when the complete carried group matches
  recorded ownership. Extra identical cargo still requires review; spending,
  attempts, and completed results remain preserved.

- Allow focused native CI regression runs alongside the full gameplay suite, so
  failure diagnosis does not wait for long Cave scenarios to finish.

- Recover pending event exits after a CODE restart consumes their original command:
  refresh the same owned exit and require its explicit native Town acknowledgement
  before routing the party back to the saved checkpoint.
- Refresh Halloween event walking routes when a fresh native party sighting shows
  the same boss has moved, so revived fighters can catch up to a kiting fight.
  Route generations change without resetting ownership, retry budgets, or the
  original walking deadline.

- Event walking keeps its route when a visible boss is separated by native terrain.
  Combat takes over only in attack range or with a collision-safe local approach;
  blocked attendees keep participating in formation instead of remaining idle.

### Added

- Advance admitted merchant realm transitions on party status reports, so native
  arrivals resume their original work and missing arrival reports retain the
  original sixty-second timeout instead of leaving the switching job held.

- Production recovery keeps current attempt journals in memory despite delayed
  storage echoes and rejects another attempt's lucky-slot evidence. Explicit
  operator review can resume a missing commerce item with an audited unknown
  outcome while preserving paid spending, attempts and completed-result counts.
  Reviewed recovery reloads authoritative coordinator progress instead of stale
  client storage, including receipts reviewed before this fix was activated.

- Event staging now prefers the native boss spawn before subordinate monster
  spawns, keeping Mr. Green attendance in Spookytown while prioritizing its adds
  during combat.

- Recover event walking interrupted by an actual CODE runtime replacement and
  coordinator restart when every participant reports fresh living ownership of
  the same event, realm and navigation revision, with at least one replaced
  runtime; unchanged Steam participants can retain their ownership. Preserve existing route retry
  counts and keep exhausted, manual, stale and unchanged-runtime failures held.

- Mr. Green and Mr. Pumpkin combat now reevaluates native add priority while a
  living boss is retained, switching onto its spawned adds and resuming the boss
  afterward while preserving other combat and movement owners.

- Disposable native E2E now runs separate US I and US II game processes with a
  shared account database, enabling actual merchant realm-transition validation
  and cleanup of native connection/bank leases in both realms. Transparent internal
  port forwarding preserves native cross-server account confirmation when both
  realms use Docker-published addresses.

- Keep merchant upgrade estimates responsive with a shared, cancellable
  60-million-roll budget for each cart/order. Discard incomplete simulations,
  apply native grade grace modifiers, and clamp targets to attainable levels
  (currently +12). Unavailable estimates require confirmation and a positive
  per-line gold cap covering item/scroll purchases through restart, without
  fabricated attempt counts or replacement prices. Validate grades against
  independent native-formula budget references and native capped commerce.
  Capped orders fund only their remaining allowance before work, so a +12
  request with a small cap does not require funding the entire scroll chain.

- Halloween respawn reentry can retire a failed route prepared before the
  character's newly observed death, with fresh alive/event/runtime/navigation
  ownership checks. Same-episode route failures and exhausted budgets retain
  their existing holds. Native Town recovery records War Cry's actual speed
  bonus and checks the unbuffed Ice Skates baseline without disabling skills.
- Prioritize Mr. Green's Green Jr. and Mr. Pumpkin's Jr. HP-threshold spawns
  during attendance, then resume boss combat while retaining boss reentry sightings.
- Keep Anniversary staging through old-round slice handoffs and suppress farm
  movement during staging, preventing repeated Town warps before the round.
- Retry dropped, already validated Town/door arrival connectors once per second
  without extending their transition deadline; throttle escape respawn requests
  and give recovering Escape sole ownership of revival.

- Lucky-slot discovery now skips positions with at least 100 observations and
  99.9% ordinary probability, recomputes eligibility as evidence changes, and
  shows per-slot Ruled out status and the ruled-out count (#23). Keep its source
  valid UTF-8 so cold dashboard dependency scans prebundle successfully instead
  of invalidating Base UI imports during first load.
- Bag-only merchant collection and emergency cleanout can transfer during
  combat, with per-send range/call-cost gates, a bounded partial handoff,
  retained unsent marks and stationary combat targets. Equipped upgrade work
  still waits for combat; partial cleanout retries wait ten seconds (#66).
- Automatic NPC-sale rules now retrieve up to ten eligible whole bank stacks per
  pass, respecting locked stock, reservations, conflicting stand rules and the
  automation toggle. The merchant destination dialog includes Visit bank (#28).
- Merchant realm returns retain their requested destination across reconnects
  and coordinator restarts, stop after three failed attempts, and support manual
  job retry without holding unrelated work. Each request keeps its sixty-second
  arrival window and requires a report no older than three seconds (#74).
- Cross-realm party visits retain their own 60-second transition deadline instead
  of being cancelled by the generic worker-expiry sweep (#69).
- An unavailable Anniversary target releases idle merchant work while preserving
  staging, featured-merchant and active-visit ownership (#70).

- Native Cave validation yields to a newly opened native choice during required-room
  selection, then resumes through the choice UI without claiming an accepted move.

- Native Cave validation resumes the selected destination after its matching
  native vote resolves, including retained vote receipts, and reports verified
  journey stages explicitly.
- Native Cave validation measures accepted-generation assembly and route
  preparation separately from physical boss arrival, retaining bounded phase
  deadlines and real arrival checks for both characters.
- The native merchant recovery scenario budgets its final two-item bank/NPC
  batch separately, while retaining the rapid potion recovery and skill checks.
- Reuse validated walking return routes after communication recovery when Town
  is disabled, while rejecting changed realm, instance, runtime, navigation,
  destination or geometry and forbidden shortcuts. Freshness holds still stop
  movement and resumed routes pass full installation validation.
- Add native evidence for walking-route reuse after interrupted heartbeat
  delivery, including the actual stop, fresh resume and Daisy reward.
- Prevent Tiny P from escaping an unprotected ranged attack after it moves beyond
  a deployed field generator; preserve eligible melee attacks.
- Recovering Halloween attendees follow fresh party boss sightings when a living
  boss has moved from its initial server coordinates.
- The native Town recovery fixture establishes peaceful initial Bees before
  actual party travel, so unrelated aggro cannot disrupt its setup rendezvous.
- Announced Halloween attendance keeps its original bounded spawn deadline across
  coordinator restarts and temporary heartbeat gaps instead of returning early.
- The native merchant equipment regression retires inherited gathering sessions
  before declaring fixture cooldowns available, preserving real tool/equip checks.
- Steam CODE reload retires the old runner before replacing its iframe and
  removes older leaked Party Console response callbacks, preventing repeated
  null `character` and server-event-state errors without logging out the game.
- Escape holds show their failure reason and a Resume automation button, so a
  preserved recovery hold can be released without restarting the coordinator.
- Scheduled boss reports use the coordinator clock, so client clock differences
  do not change staging eligibility or renew the fixed missed-spawn deadline.
- Retained event regression fixtures load the current workflow helpers and pinned
  game geometry consistently with CI. Optional boss-sighting and game-data
  fields preserve existing heartbeat and ordinary attack behavior when absent.
- Halloween point returns keep their owned checkpoint route until the same
  100-unit arrival used by shared navigation, avoiding early cancellation.
- Halloween deselection exits living boss combat through a bounded Town attempt
  and owned walking with moving defense, rather than waiting for the boss to die.
- Cave native E2E entry checks now retain accepted room responses in a durable
  ledger and retry guarded requests before verifying actual room arrival.
- Keep ranged characters already fighting a freshly observed event boss out of a
  recovering party member's walking rendezvous, so death recovery can rejoin
  combat without waiting for an unnecessary walking request.
- Added opt-in Slenderman, Mr. Green, and Mr. Pumpkin character events without
  changing existing selections. Green/Pumpkin spawn countdowns support staging
  one minute early and returning to saved work after a two-minute missed spawn.
- Slenderman attendance uses local and fresh party sightings, bounded discovery
  across Halloween, Spookytown, and Cave, and the existing magical reflection
  protections. Unproductive searches release attendance and saved-work recovery.
- Windows full restarts build and publish shared event policies alongside the
  character runtime, so newly selectable events are accepted by the coordinator.
- Physical fighters can attack reflection monsters when the native player
  payload omits damage type, using their equipped weapon and class definitions.
  Magical attacks and offensive skills retain their reflection protection.
- Event exits release characters that already supplied a verified Town receipt
  from the remaining walking rendezvous, preventing recovery from waiting on a
  finished participant while preserving the saved checkpoint and cycle owner.

- Steam handoff stores its generic bootstrap in a free native CODE slot from
  1–100 instead of an unsupported UUID slot. Occupied slots and original CODE
  cache stay intact; unavailable or full slot inventories fail before release.

- An already connected local Steam client refreshes its managed bridge before
  handoff after a hosting restart, without relaunching the game. Connected remote
  clients remain usable without access to a desktop on the console machine.

- Steam handoff errors preserve native API reasons instead of displaying
  `[object Object]`; diagnostics omit unrelated account and session fields.

- Steam primary handoff ignores incomplete browser setup drafts, preserving the
  saved desktop launcher choices. Setup restores those saved choices when this
  browser has none, so an empty setup visit cannot disable same-machine launch.

- Manual merchant weapon equips update the saved weapon preference, and manual
  hand changes replace gathering's saved loadout. Temporary gathering tools
  continue to work; cooldown restoration and restarts preserve the chosen gear.

- The lucky-slot details table provides Lock/Unlock buttons in its rightmost
  column; the leading candidate row turns green above 95% model confidence.
  Merchants can lock the lucky-slot position while continuing
  to record rolls and probabilities. Guarded cleanup preserves displaced cargo;
  unlocking tests the next position before resuming discovery. Locks and the
  next-roll checkpoint survive coordinator restarts. Changes refresh inventory
  and settings immediately; resumed positions remain tests until verified (#23).

- Home-realm confirmation warns that every account character is affected.
  Active characters confirm individually; offline characters log in sequentially
  and return offline. Original assignments are preserved and temporarily paused
  headless workers reconnect. Mixed homes and per-character progress are visible;
  cooldowns and full native-session capacity produce explicit errors. Requests
  refresh native home data before skipping already-matching characters. Successful
  native acknowledgements and fresh character status confirm changes while the
  account database catches up; temporary merchants keep exclusive command
  ownership until their home change and logout finish (#52).
- Pair another browser shows a short access code, such as `K7QM-4XRT`, next to
  the pairing link. Type it into setup on the new browser. A code works once,
  expires after 10 minutes, and five wrong guesses cancel it. Pairing with either
  the code or the link retires the other.

- Debug consoles can open and control their actual game browser through a private
  viewer on the same port, with Debug browser labels instead of Steam.

- Settings can launch a disposable Cave of Many Dreams debug server and separate
  Party Console with a god-equipped party and unlimited visits. Startup shows
  progress; Stop running cancels startup or destroys the instance and saved data.
  Supports Windows/Linux Docker engines and Docker-hosted consoles with engine access.

- Cave travel starts stopped. Choose a room or explicitly start automatic
  exploration to clear required rooms and travel through stairs. Combat, loot,
  revival and forced choices pause travel; encounter votes stop the route until
  another destination is selected. Leaving the final floor remains manual.
- Cave travel assembles participants at the leader, shares the native route and
  slowest party cruise speed, and holds members that get ahead. Interrupted
  routes regroup with bounded retries. Manual stairs remain selected through
  farewell votes; objectives on other floors show a floor-specific error.
- Cave panels show a full-floor map with party and encounter pins and one
  replaceable waypoint. Encounter votes open a dialog automatically; resolved
  encounters remain reviewable, and equipped weapons appear on map characters.

- Add the default-enabled "Marked withdrawals create merchant jobs" setting
  and a separate prioritized bank-trip routine (#28). Pending withdrawal marks
  request a bank visit, including after restart. Disabling the setting retains
  the marks for another bank visit without scheduling a withdrawal-only trip.
- Visible cave hostiles use the normal shared combat queue, skills, formation,
  kiting and three target rings, with one coordinated primary target.

- Cave priests automatically prepare and revive fallen teammates with carried Essences
  of Life, prioritizing living-party healing. Recovery status and safe Nera fallback
  appear in the dungeon panel; persisted attempts prevent duplicate consumption.

- Cave of Many Dreams appears first in Events with manual entry, server eligibility
  countdown, and a saved setting that protects the visit from other events by default.
- Dungeon controls sit below the header and above the party cards, showing
  objectives, stairs, remaining run time, shared currency,
  votes, purchases, and revival choices. Paid choices require confirmation. Town
  and Escape exit the party together; leaving holds ordinary activity until resumed.
- Dungeon ownership pauses ordinary travel, Hunt, and merchant visits.
  Persisted action receipts prevent blind retries after lost entry or spending replies.

### Fixed

- Initial coordinator realm defaults follow the account's unanimous native
  home instead of a stale saved worker realm. Offline merchants cannot create
  new headless home-return requests from retired Steam status; managed ownership
  and fresh headless status are required for admission. Existing returns retain
  their retry deadline while disconnected. Saved explicit party realms and
  admitted realm/job transitions retain their destinations.

- Steam companion reconnect refreshes the native account roster after an
  `already_running` rejection, so stale online entries cannot delay restoring
  a stopped companion until the native AFK refresh. Concurrent refreshes are
  coalesced, ownership flags remain authoritative, and retired bridges stop
  scheduling recovery.

- Preserve progress in large Cave native route searches: extend the 90-second
  initial bound while the same BFS advances, with a 240-second hard limit and
  a 270-second follower wait. Stalled, reset, or unavailable progress keeps the
  original deadline; ordinary travel and local repair bounds are unchanged.
- Cave travel can reconnect up to three distinct retained walking endpoints
  after separate combat displacements. Each connector keeps its three-second
  native limit and complete route validation; repeated endpoints and a fourth
  connector fail, while ordinary movement keeps its single-repair limit.
  Ownership, barriers and destination remain intact, and failed repairs never
  start an independent shared destination route.
  Repairs rejoin a nearby point on the original validated walking segment,
  execute the exact collision-checked join, and preserve the remaining route.
  Stale segments, distant joins and unsafe planner gaps are rejected.
  Reaching a corner retains the validated next segment across a combat pause
  before its dispatch, so nearby backtracking can rejoin that corner safely.

- Cave travel recovers when native combat displaces a participant after its
  assembly command completed. Fresh, ready participants regroup under new owned
  command IDs before the selected route departs, with bounded retries and
  unchanged combat, loot and arrival barriers.

- Native Cave cruise checks wait for the selected owned route to prepare before
  applying the motion deadline, preserving displacement and native cruise checks.
  Resumed routes separate preparation and native wave combat from room arrival.
  Lockbreaker arrival accommodates bounded native replans and the full walking
  distance at the party's cruise speed. The regroup fixture stages both actors
  with real collision-safe walking before checking assembly displacement.
  Stairs coverage observes native farewell acknowledgement separately from the
  owned route continuation and both characters' actual floor transition.
  Manual Stop/resume uses a declared collision-safe native waypoint outside camp
  aggro, then still requires both characters to reach the generated farm.
  Map waypoint coverage distinguishes immediate selection acknowledgement from
  native assembly and owned move dispatch, preserving exact target and run checks.
  Safe waypoint fixtures account for canvas rounding and validate the exact
  accepted destination with native collision checks.
  Fixture clearance searches use exact segment distances and reject unsafe
  candidates before native collision queries, keeping their existing bounds.
  Fixture staging waits for completed waypoint receipts and acknowledged Stop,
  preventing an owned route from overriding the setup's native movement.
  Resumed waypoint coverage requires completed owned moves and exact endpoint
  arrival before starting the farm trip.
  Native farm arrival allows the same bounded combat and loot time as boss
  travel, while still requiring both characters to physically reach the room.
  Stairs approach uses that same bound for native combat and reassembly before
  the farewell, with separate vote acknowledgement and floor-transition checks.
  Duel validation allows bounded native combat to finish and retains health and
  target evidence. The full journey budget accommodates its separate phases
  without changing native expiry, kills, ally survival, or room completion.
  Failure evidence includes bounded native planner progress, readiness holds,
  and destination collision geometry for investigating route preparation.
  Map selection checks acknowledge placement mode before clicking terrain,
  preventing a suppressed Add action from reusing a previous waypoint. Guarded
  local activation retries remain bounded and require an enabled, error-free UI.
  Waypoint E2Es verify the actual UI request and retry observed heartbeat
  suppression or a guarded unsent click, retaining accepted-target checks and
  a submission evidence ledger. Pending requests stay observed across retries.
  Freshness-rejection retries additionally verify the requested run and floor,
  live participants, and the observed report gap before another UI submission.
- Explain disabled Cave waypoint actions with an accessible report-waiting
  status, keeping map selections intact while current-run reports recover.
  Reserve space for that status so heartbeat transitions cannot shift the map
  beneath the pointer during waypoint selection.
- Keep the same-run Cave map and waypoint selection open during heartbeat gaps,
  while disabling waypoint actions until every participant has a fresh, alive,
  matching-floor observation. Changing run or floor clears the old selection.
- Native merchant checks allow bank travel before the injected lucky return fault,
  generated reward-box exchange chains, and the final recovery batch's two
  upgrades and NPC scroll trips, preserving item, reward, and recovery assertions.
  Skill-tier recovery includes the real companion reconnect in its total budget.
- Hunt travel preserves pending loot through temporary communication and
  observation holds, suspends collection until defense resumes, and retries
  native chest-opening errors so the original Hunt can finish and claim rewards.

- Native passing-combat validation seeds encounters at the existing reservation
  lookahead limit, allowing peer admission before the walking party passes them.
  Both outbound and return native kill and Daisy reward checks remain required.

- Native blacklist validation waits for the discovered monster catalog before
  checking scrolling, sprite inspection, and persisted selection, recording
  the native monster IDs as evidence.
- Native Goobrawl validation allows surviving arena monsters to finish fighting
  before evacuation, including the coordinator restart case, while retaining
  native kill and resumed Hunt checks.

- Rare encounters remain owned while waiting in the combat queue behind an
  existing party fight. Tiny P field deployment can finish and combat resumes
  without falsely rejecting the rare when it temporarily loses the queue head.

- Cave followers validate and reuse the leader's route without duplicate native
  pathfinding. Large Cave floors allow a bounded 90-second leader search and
  120-second follower wait; ordinary navigation retains its 30-second limit.
  Native pacing checks resolve newly revealed encounter votes first; room-completion
  checks allow cumulative native travel and combat before the final farewell vote.
- Allow the native merchant skill and recovery E2E enough time for four bank/NPC
  journeys and a real companion reconnect, preserving individual job deadlines.
- Allow the native BooBoo reward check to finish return travel and the stable
  arrival confirmation before requiring the exact Hunt token reward.
- Native headless E2Es load the server's complete client script manifest and
  retry transient asset-read failures with bounded timeouts. Evidence collection
  is bounded, and teardown closes the isolated gateway and coordinator even
  when native video capture fails.
- Recovery fixtures accept current object snapshots and legacy JSON strings,
  and the bundle harness supplies Node's native snapshot-cloning API.
  Console map previews use each scenario's pinned catalog; UI checks wait for
  hydration, dialog animations, and fresh native status after restart. Generated
  Cave routes retain their native vote/floor checks with bounded travel time.
- Restore missing optional native tooling records in the dashboard lockfile so
  clean Linux/Docker installations succeed with all pinned versions unchanged.
- Recover burned commerce-upgrade items only after lucky-layout reconciliation
  proves an empty result and no old/new-level survivor remains. Ambiguous layouts
  still require review. Normalize null item metadata in current inventory and
  legacy journals, and hold competing merchant dispatch throughout production,
  recovery and lucky-slot restoration (#47).
- Allow unrelated character logins while merchant jobs are running, retaining
  the joining character's ownership checks and global BankBoi lock (#48).
- Connect new and restored headless slots to the native home realm rather than
  stale saved realm configuration. Preserve explicit realm-operation destinations
  and running workers' event travel (#50).
- Bind lucky-slot evidence, verified positions, locks and resume checkpoints to
  stable account character IDs. Same-name recreation clears old state; renames
  retain it. Client streams use ID-scoped storage to prevent stale reimport.
  First migration preserves legacy evidence; earlier recreations cannot be
  detected retroactively (#55).
- Normalize legacy null metadata in manual equipment selections and report
  missing gear instead of silently skipping Equip. Loaded Die uses the native
  orb slot; its menu regression checks displaced-orb conservation and restart.
- Cache passing-encounter/death identities per list and context, and build one
  retained-tombstone identity set per combat reconciliation. Preserve timestamp,
  duplicate and death-precedence behavior while removing repeated scans (#57).
- Bound completed production receipts to 2,048 while preserving unfinished
  journals. Coalesce ordinary settings saves over one second, keep production
  checkpoints immediate, flush orderly shutdowns, omit Hunt message-only writes,
  and store object snapshots with legacy JSON-string compatibility (#59).
- Rotate managed console and updater Docker logs to three 10 MB files each.
  Existing services need recreation with the updated Compose file; subsequent
  managed updates preserve the limits (#60).
- Sanitize doll markup before portrait, equipment comparison and map rendering.
  Rebuild approved tags, attributes and native crop styles with a pure-data HTML
  parser; reject handlers, unsafe image schemes and executable CSS (#61).
- Release Linux journal ownership automatically after crashes with an advisory
  flock guard. Retain process identity metadata, protect competing writers across
  containers, and conservatively handle unverifiable legacy locks. Coordinator
  Docker images include util-linux (#62).
- Stream E2E Docker logs directly to their artifact with bounded memory and
  collect only the current run during teardown, so large retained logs cannot
  prevent cleanup or report generation.

- Cave recovery releases a completed dungeon hold before manual Town or farming
  travel. Parties already outside the cave can resume movement instead of
  silently ignoring Town commands or stalling at convoy regroup (#49).

- Keep independent farming combat authorized through a singleton group while
  Follow is off, so solo priests attack at their Hunt spawn and finish turn-in.
- Let BankBoi storage proceed independently of the merchant's production-receipt
  recovery gate; retain native stack filling and protected stock during unload.
- Recover newer merchant receipts after stale completed client journals without
  restoring or replaying the completed attempt's old lucky-slot layout.
- Fix cave combat queue delivery and acknowledgement after farming resets or
  runtime reloads; preserve cave healing participants and stop issued travel
  segments when combat pauses movement.
- Stream and compact oversized coordinator state journals without constructing
  one giant string; preserve existing state and writer locks.
- Coordinate Hunt turn-in and anniversary staging returns: defend against
  aggressors, cancel interrupted party Town casts together, resume after aggro
  clears, and retain bounded route retries.

- Pair manual inventory context actions with their automatic rules and expose
  upgrade, deconstruction, stand and NPC-sale rules from bank menus. Persist
  source-specific bank upgrade withdrawals until receipt reconciliation finds
  the carried item; clearing bank marks also clears their pending intents.

- Automatically retire stale lucky-slot layouts after the coordinator confirms
  there are no pending production receipts and the displaced destination is
  restored. Later source-slot deliveries or moved/finished gear no longer block
  NPC sales, merchant luck and buy orders behind repeated inventory recovery.
  Run recovery from the idle status pulse so the inventory-busy dispatch gate
  cannot prevent the recovery needed to clear itself.

- Preserve incoming party items while lucky-slot preparation waits for receipt
  checkpoints. Refresh the destination and capture the actual displaced contents
  after its native swap. Reconcile stack quantities when interrupted restoration
  resumes, avoiding repeated inventory-recovery holds after deliveries or potion
  use. Genuine mismatches now report expected and actual slot contents.
  Keep the live lucky journal authoritative so delayed caracAL storage echoes
  cannot resurrect a completed swap and strand the next upgrade in receipt review.

- Apply merchant Mass Production immediately before buy-and-upgrade operations
  as well as marked upgrades and compounds. Mass Production and Mass Exchange
  prefer the ++ tier only when its cost leaves at least 20% MP, falling back to
  the unlocked lower tier when affordable and ready. Log buff requests and
  application; bounded waits prevent legacy skill promises from holding work.
- Merchant passive recovery continues during production and uses HP/MP potions
  below 20%, with HP priority, shared cooldowns and an overlap guard. Missing
  potions fall through to free regeneration.

- Remove "Left-click: details · Right-click: actions" from character inventories.
- Keep Cave travel ownership through direct movement stops and suppress mainland
  farm reunion during dungeon activity. Pause for nearby reachable threats or
  active attackers rather than distant visible enemies; recognize hostile duel
  participants when helping one side. Honor chest-open receipts and the native
  pickup radius so cached loot animations do not hold travel indefinitely.
- Preserve shared map geometry for followers and reconnects, and clear obsolete
  Cave travel errors when selecting a new manual destination.

- Preserve buy-with-upgrade orders through production failures, disabled routines,
  and repeated worker stalls until completion or explicit cancellation. Keep
  spending, attempts, owned stock and results across retries. Mirror production
  and lucky-slot recovery journals in coordinator storage so lost client journals
  can be reconstructed without replaying purchases or guessing destroyed items.

- Keep Hunt paused during live combat events before quest preparation or expiry
  can start a protected Daisy return, including when Hunt is enabled or resumed.
  After respawning, retry temporary event travel denials and lost permission
  replies while the event remains selected and live; still cancel on event end,
  deselection, Escape, or replacement navigation.

- Protect personal Tracktrix items from merchant collection and emergency cleanout
  using the native `tracker` ID rather than the display name. Keep trackers and
  supercomputers in the final inventory slot, including during merchant tidying.

- Recover empty native WTB reservations that never received an offer ID, without
  counting them as purchases. Back off failed placements before retrying, and
  adopt matching offers that moved before their first acknowledgement.
- Make WTB price options fill each grid column and place Farm price information
  inside the option’s upper-right corner without changing the price when clicked.

- Fix market “Hide unaffordable” using the account’s bank gold even when the Bank
  panel is closed (#38). Active WTB price buttons reopen the full price/quantity
  editor with current terms and price options. Rename “New WTB order” and “Farm
  price,” explain the farming estimate, and display stand status as plain colored text.
- Reconcile moved or replaced native WTB offers when the stand reopens without
  inferring purchases from replacement. Queue a bank withdrawal for affordable
  orders when the merchant lacks carried gold; report inventory and funding separately.
- Preserve Hunt blacklists across farming mode changes, restarts, and settings
  exports; retain explicit removals during catalog startup. Add a searchable manual
  blacklist picker, contain its sprites, and restore catalog scrolling.
- Route exchange rewards through shared automatic item rules, including future
  stock and nested exchange boxes. Stage bulk catalog rule changes until Done,
  preserve existing stand prices, and keep manual exchange independently available.
- Recover interrupted merchant work and rare-monster loot approaches. Wait for
  production receipts before retrying merchant operations, retire stale NPC sale
  marks, release recovery deadlocks, and recover lucky upgrade swaps after stack
  quantities change. Pass rule command context through merchant validation.
- Discover available setup realms from the game at gateway startup.
- Keep native drawing and convoy readiness working under delayed clients; retain
  Hunt farming ownership after fallback arrival, reassemble interrupted Town rallies,
  and reserve passing attacks before bounded native timer delays.
- Maintain warrior Warcry and priest Dark Blessing independently, after emergency
  defense, aggro rescue, and healing, while retaining survival mana reserves.
  Cast only when off cooldown and the same buff is absent; both buffs can coexist.
- Confirm Hunt blacklist “Clear all” before removing entries, with Cancel preserving the list.
- Add passive-monster level caps and map previews for preferred Hunt spawn areas.

- Map viewers include NPC cosmetic layers (including Dorr's head) and the Cave
  entrance's native stonework, animated flames and starry portal.

- Docker builds regenerate the font cache instead of copying machine-specific paths,
  fixing fallback fonts and changed text layout in debug consoles.

- Cave choices, descriptions and objectives keep their server-provided text when
  a headless client cannot translate localization objects.

- Steam cave requests capture server replies before native UI handlers, fixing
  missing eligibility reports and protecting entry, vote, purchase and exit receipts.
  Eligibility reads recover from timeouts; the settings panel shows request errors.

- Cave entry excludes offline saved followers from the initial roster while retaining
  captured participants if they disconnect during a run.

- Cave combat uses the normal class skills, healing, equipment, formation and kiting routines.
  Live party observations guide healing; cave navigation waits for combat and loot.

- Event estimates now say "Next chance" without the "event not guaranteed" text.
- Refresh upgrade chances is a prioritized merchant job that borrows missing scrolls and offerings from the bank without buying supplies, returns them after calculation with interrupted-transfer recovery, and saves results across reopenings and restarts. Any real merchant upgrade invalidates saved chances; the menu shows queued/running status and missing supplies.

- Steam primary/login actions can launch a local Windows or native Linux client,
  or attach to a running client with automation enabled. The bridge must be ready
  before headless ownership is released; completion still requires native CODE
  reports. Setup choices prevent launching a client on a different PC. A running
  client without automation enabled requires one close and retry. Windows was
  verified live; Linux has protocol tests and still needs live desktop validation.

### Added

- Native Cave validation yields to a newly opened native choice during required-room
  selection, then resumes through the choice UI without claiming an accepted move.

- Merchant setting for upgrade purchase batches (default 1), with bulk starting-tier scrolls, durable item ownership, and completion of every purchased item.

### Fixed

- Fixed interrupted deliver-and-equip recovery (#20): after a failed equip, wait for a fresh merchant inventory, remove marks for missing stock, or retry retained stock with a new delivery identity. Persist reconciliation across restarts and prevent stale inventory or delayed receipts from reviving the retry loop. Added two native E2E journeys covering missing/retained cargo, interrupted inventory reports, restart, real redelivery/equip and no replay. Documented the existing bounded shutdown behavior for SIGINT/SIGTERM.

- Restore coordinator lint compliance by extracting travel-attacker collection, assembly runtime lookup, and merchant eligibility helpers without changing behavior.

- Handle movement-barrier ownership rejections without reporting a new route failure: superseded walks retire quietly, early departures wait, and completed transitions are not repeated. Preserve genuine route errors and communication recovery (#27).

- Preserve ALData marketplace sale commands across realm-switch worker restarts until completion (#26).
- Treat movement planner rejections as native-pathfinding fallback results instead of communication outages. Distinguish fallback, terminal movement failures, and temporary communication holds, and avoid duplicate command-failure logs for already reported movement outcomes (#29).

- Market search now matches item display names in WTS, WTB, and Classifieds while preserving searches by internal item ID, trader, and server (#32).

- Keep a solo ranger (or any single fighter) attacking in Group mode by creating its coordinator combat group and target authorization. Leadership is supported; Scatter remains unchanged.

- Automatically designate the first connected, managed merchant on fresh installs so merchant controls and logistics work without editing configuration. Preserve saved assignments and exclude bankboi workers.
- Show the configured merchant's name in market, Ponty, bank-unlock and donation dialogs, with a generic fallback when no merchant is assigned (#30).

- Keep every right-click menu, submenu, and embedded upgrade preview white with black text, including focus and hover states.

- Correct preview text encoding. Distinguish unavailable and partial chances from successful previews, and wait for bank data before borrowing supplies.
- Release convoy pauses when merchant jobs fail, expire, clear, yield, or change realm. Ignore late handoff completions without overwriting newer commands; preserve the original Hunt/event destination.

- Prevent Town-rally arrival from falsely failing Hunt runtime readiness; defer merchant work while Hunt owns movement instead of repeatedly failing handoffs.

- Buy-with-upgrade follows relocated items and requires a matching server failure
  before logging destruction or buying another base item. Uncertain outcomes retain
  their journals instead of abandoning partially upgraded survivors.

- Updated Hunt and farming UI test fixtures for execution-state clearing and the
  preferred-spawn dialog; nested-dialog checks count only open dialogs.

- Fixed Hunt departures stuck at Daisy when later door approaches crossed scenery.
  Validate reachable interaction points and bounded local detours before accepting
  the shared route, preserving the selected destination and recovery limits.

- Fresh headless reports now override stale Steam connection observations, so a
  successful Steam-to-headless transfer no longer hides the character behind a
  false "Connection lost" card.

- Hunt off/on now resets execution, holds, and failure counts while retaining live quests, blacklists, and saved settings. Removed arbitrary-door route recovery; exhausted routes try another actual monster spawn. Retire saved relocation detours.

- Added Farming Settings > Set preferred hunt spawns: expand monsters with multiple available spawns and save a destination for future Monster Hunts. Automatic selection remains the default; normal farming is unaffected.

- Set alpathfinder route-cost speed to 200 for all planner calls, replacing the inflated no-Town estimate that could discourage useful door and tunnel routes.

- Hunt returns now release a failed travel hold after fresh, matching reports
  verify the whole party stopped at Daisy, allowing quest turn-in to continue.
  Recovery also accepts holds reissued after restart and ignores released Escape
  history, while preserving current navigation ownership and retry budgets.

- Improved dashboard performance by memoizing character cards, inventory/equipment,
  bank and stand panels, monster controls, and upgrade-offering context, with
  stable data and action props to avoid unrelated renders.
- Equipment catalog uses infinite scroll, loading more items automatically as
  you approach the bottom while keeping the initial render bounded.
- Dashboard settings, rules, and marks use a separate 15-second configuration
  poll; actions refresh them immediately while live progress retains fast updates.
- Live logs reuse derived entries and rendered rows when their contents have not
  changed, reducing repeated sorting and rendering during long sessions.
  ([#22](https://github.com/Ryan-Haines/adventureland-party-console/issues/22))
- Added the pinned game-17175 route fixture and refreshed Hunt, convoy, and
  coordinator-storage regression fixtures for repeatable offline validation.

- Long-running coordinators no longer retain complete character heartbeats in
  rare-target rejection receipts. Existing receipts are compacted without losing
  rejection evidence, and unchanged merchant queue checks avoid redundant saves.
- Upgrade and compound jobs preserve unfinished work after movement communication
  failures, retrying with persistent 10/30/60/300-second backoff.
- Added `scripts/watch-console.ps1` to follow redirected local console logs in a
  visible terminal, with `-Errors` for stderr.
  ([#21](https://github.com/Ryan-Haines/adventureland-party-console/pull/21))

- Franky attendance now targets only the Franky monster, approaches into attack
  range, and holds position without kiting, formation movement, or warrior Dash.
  Approaches ignore monster danger zones while respecting terrain. Adds cannot
  become fallback or offensive-skill targets; healing and event recovery continue.
- Buy-with-upgrade orders preserve confirmed purchases, upgrade results, budgets,
  attempt limits, and reserved items through interruptions and restarts. Priority
  work yields between completed item cycles; movement failures retain the order
  with bounded retry delays and visible retry status.

- Hunt route failures now use bounded segment repair, native fallback and origin
  relocation before trying another spawn. Recovery budgets survive replacement
  convoys and restarts, with explicit causes when movement remains held.
- Convoy phase changes no longer send duplicate cruise caps. Movement diagnostics
  identify command takeovers and retain the original planner failure.

- Delivered equipment pauses and resumes convoy travel without replacing its
  ownership; combat during merchant recovery no longer deadlocks the regroup hold.

- Hunt pickup travel recovers a missing completion acknowledgement after verified
  party arrival, preventing an idle party at Daisy from remaining in sync travel.

- Joinable events such as Franky use direct teleportation for entry and respawn
  recovery, without waiting for a convoy. Arrival is verified before clearing
  recovery, and failed event walks no longer leave characters unable to attack.
- Event combat closes into boss range before kiting. Avoiding adds no longer
  pulls characters away from the boss; blocked kiting tries safe approach and
  escape directions instead of leaving characters stuck in corners.
  ([#21](https://github.com/Ryan-Haines/adventureland-party-console/pull/21))

- Hunt event exits resume the current quest instead of an obsolete farming
  checkpoint. Dedicated event-map evacuation survives restarts, delayed clients,
  and Hunt toggles; completed anniversary visits hand back to current Hunt policy.
- Hunt communication holds retain matching runtime and command acknowledgements
  through defensive combat. Recovery reconciles dead and released encounters,
  checks loot, and regroups toward the original destination.
- Rare travel interruptions share convoy ownership. Fairy targeting no longer
  depends on a detached support controller, and unsuccessful pursuits retain
  their progress/retry evidence across restarts instead of reopening on wandering.
- Members separated by a map transition can join a travel encounter under its
  existing owner. Hunt reconciles verified arrival before optional acquisition,
  and reports the encounter or specific catch-up blocker instead of stale status.
  ([#21](https://github.com/Ryan-Haines/adventureland-party-console/pull/21))

- Invisible rogue recipients reveal themselves for merchant servicing, then resume
  their normal invisibility behavior. ([#10](https://github.com/Ryan-Haines/adventureland-party-console/pull/10))

- Enabled passive targets with “keep moving” off now interrupt outbound travel
  for coordinated combat, including neutral Phoenix sightings and targets already
  admitted as passing attacks. Explicit stop rules override Hunt travel exceptions.

- Outbound Hunts share one attack target while moving. Additional aggro pauses the
  party for coordinated defense and kiting, then resumes travel to the original
  Hunt destination after the encounter and loot are resolved.
- Hunt automatically restarts its cycle when a participant exhausts retreat routes,
  preserving blacklists and logging the failed character, location, and reason.
- ALClient routes now accept a reachable final waypoint within the requested arrival
  tolerance when the exact endpoint is blocked, matching native routing behavior.
  ([#16](https://github.com/Ryan-Haines/adventureland-party-console/issues/16))
- Monster Hunt convoys pause safely during communication outages and resume after
  stable party reports without consuming movement retries. Arrival acknowledgements
  retry transient failures, and saved completion receipts tolerate lost responses
  and coordinator restarts.
- Warriors skip emergency Stomp when no compatible basher is equipped, preventing
  repeated wrong-weapon errors while allowing their normal routine to continue.
- Keep-moving combat shares encounter ownership before attacking, preventing
  retaliation from repeatedly stopping convoys and releasing obsolete defensive holds.
- Marked merchant deliveries now schedule their own visits by default. Merchant
  settings can disable delivery-only trips while retaining deliveries for other
  visits and explicit sends. ([#15](https://github.com/Ryan-Haines/adventureland-party-console/issues/15))
- Removed unused dashboard notices; previously silent validation and action failures
  now use contextual error feedback. ([#14](https://github.com/Ryan-Haines/adventureland-party-console/issues/14))

- Entirely headless rosters can switch realms without a connected Steam character,
  including switches that set a new home realm. Steam connectivity is still required
  when a Steam-hosted character participates; existing readiness checks remain in
  place. ([#13](https://github.com/Ryan-Haines/adventureland-party-console/issues/13))
- Re-engaging CODE after a console logout recovers the Steam session instead of
  replaying the previous logout or character navigation.
- Monster Hunt lifecycle follows current party membership.
- Convoys recover from departure and walking stalls without repeating retry loops.
- Shared-route geometry mismatches get one bounded reload attempt while preserving
  Hunt membership; stale farming and anniversary checkpoints can recover.
- Monster Hunt preserves travel to its origin and recovers missed Daisy arrival
  acknowledgements.
- Merchant collection reservations and routine cancellation recover correctly.

### Changed

- Merchants can independently select supported events, fight with their equipped
  weapon, and resume merchant work after returning. Ordinary merchant jobs,
  gathering, and stand work yield while event participation owns the merchant.
  ([#12](https://github.com/Ryan-Haines/adventureland-party-console/pull/12))

- Reduced dashboard status traffic and isolated position updates from character
  cards while preserving live controls and inventory updates. ([#17](https://github.com/Ryan-Haines/adventureland-party-console/issues/17))
- Reworked the lucky slot mechanism.
- Anniversary participation no longer automatically crafts Sixfold Cakes; complete
  slice sets remain available through the normal exchange menu.
