# Changelog

## Unreleased

Changes queued for the next release. The release workflow determines its version
from the commits merged into `main`.

### Added

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
