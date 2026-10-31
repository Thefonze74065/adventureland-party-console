# October events: failure inventory and validation

Stock-based gathering follow-up failure inventory, before implementation: each
character independently picks a different ingredient; merchant stock is omitted;
locked cargo is counted as spendable; a mid-round loot or settings change moves
the party again; a CODE/coordinator restart loses the selection; old round plans
leak across realms; stale/missing inventories are treated as zero. The twenty
minutes must remain anchored to the native gathering deadline, including travel.
UI risks include ingredient/monster sprite clipping, invented luck-adjusted drop
rates, unreadable option backgrounds, polling after popup closure, and a board
refresh overwriting an unsaved manual mix. Preserve native gathering/transfer,
restart and brew journeys, and verify the inline board updates while open.

Before implementation, the failure modes are: guessed daily slots disagree with the
published seven-day lineup; disabled Graveyard species enter ordinary, event or
area attacks; door requests repeat after reload or UTC rollover, exceed the account
quota, or advance before a native receipt; travel loses the saved farm checkpoint;
Cipher attempts race across characters, reuse a solved board, ignore hidden clues,
consume locked ingredients, repeat an uncertain brew, or exceed the account budget;
manual requests replay after restart; ingredient travel overruns the gathering
window; stale catalogs omit achievements, new items, skills, conditions or drops.

Use the existing event admission, movement and return machinery. Persist native
action journals before mutations and inspect current inventory immediately before
brewing. The designated merchant alone brews. Recipe identity includes both round
ID and crack count. A truncated board without the native fit bitset is insufficient
evidence for automatic brewing. Settings and board controls use the real gateway
and retain screenshots, persistence snapshots and request/result ledgers.

Run `npm run typecheck`, focused October console/gameplay journeys through
`npm test`, and `npm run test:e2e:verify`. Gameplay uses the default ChronAL backend.
Stage and verify a completed immutable console candidate; activation is separate.

## Verified mechanics

The deployed native 18183 client definitions and CODE API describe seven doors:
one knock per character per door per UTC day, with fourteen total knocks shared
by the account. There is no shorter repeat timer. The hardcoded order is
`1, 0, 5, 6, 2, 3, 4`; reproduce all 5,040 collision-checked permutations with
`node tools/game/plan-trick-or-treat.mts 18183`. The report is
`.build/october-research/door-route.json`. Each approach stands forty units below
the door; smaller offsets collide with several Spooky Town buildings.

Cipher mixes contain five ordered slots using four ingredients, with repetition
allowed. A clue counts exact positions only. Five mixes belong to the account
per UTC day on one realm (an ongoing round retains the day it started). Gathering
lasts twenty minutes of the twenty-eight-minute event. The native compact `fit`
field encodes all 1,024 recipes, including clues omitted from the visible board.
The solver respects both that bitset and the visible clues, then minimizes the
largest possible remaining set among consistent, untried mixes. Expected remaining
set size, affordability, abundant ingredient stock, then parcel reward break ties.
An unavoidable shortage selects that ingredient for the remaining drop window.
A solved recipe resets
the realm board, so persisted manual requests bind to both event ID and crack count.

The public test server pin `16881a276e03f449f2953e8a304f6db1084a9883` includes these
events but predates some deployed 18183 definitions (including Hexed and the fit
bitset). Catalog journeys compare every native ID against the actual running
version. Production catalog acceptance separately validates complete definitions,
including monster achievements and every condition, against the installed game.
The board solver refuses an incomplete truncated board if the fit field is absent.

Native sources: `node/logic/halloween_events.js`, `node/logic/witch_cipher.js`,
and `node/logic/event_schedule.js` in the pinned Adventure Land server. The
published `schedule.events` identifies the actual nightly/daily event in each
slot; `schedule.repeats` supplies recurring events. Change-only feeds remain valid
while their client connection and synchronized clock are fresh.

## Repeatable journeys

Clock/pretravel follow-up: run `npm test -- -- --project=console --project=live
--grep "Event clock|Event pretravel|Halloween future staging survives|Halloween staging abandons"
--workers=2`. The clock cases render US realm midnight as 01:00 EDT and 00:00
EST, retaining readable screenshots. Gameplay requires native departure between
60 and 120 seconds before the declared occurrence, actual early arrival, exact
published epochs in coordinator telemetry, persistence across restart, combat
only after LIVE, and checkpoint return on cancellation. Existing Halloween cases
retain delayed authorization and the bounded absent-spawn deadline. Native
collision must admit the fixture origin; Spooky Town (255, −925) is inside a wall,
so the Graveyard journey starts in the open cemetery at (255, −1150).

The US realm uses fixed UTC−5. Calendar epochs must not be shifted by the client
clock correction: a positive subsecond offset otherwise displays 01:00 as 00:59.
Apply correction only to countdowns and local admission deadlines. Horseman,
Graveyard, Mr. Green and Mr. Pumpkin depart two minutes before their known start;
instances that require a native join remain subject to native availability.

Run `npm test -- -- --project=console --project=live --grep "October|Halloween events stay opt-in" --workers=2`.
The cases cover persistent settings, native door receipts and checkpoint return,
minimum-clue waiting, automatic and manual brews, merchant/leader policy ownership,
restart replay protection, all native catalog IDs, published Horseman dates,
Horseman combat, inherited Graveyard exclusions, and ingredient collection/transfer.
Board and manual-entry screenshots retain the actual native ingredient sprites.
Ingredient icon/name buttons open the existing full item inspector and preserve
unsaved event settings when closed. All four types are exercised. The native board
receives another clue while the popup remains open, verifying automatic refresh.
Stock journeys retain native brew receipts proving abundance preference and zero
spent attempts on shortage. Gathering keeps the selected source past five minutes
and across restart/settings changes, then stops at the published cutoff. Missing
stock returns to farming; complete stock from actual native kills starts brewing
only after the cutoff. These cases declare shorter native gathering deadlines at
setup and use ChronAL; runtime transitions and brew results remain unmodified.

For simultaneous work in another chat, assign a different
`E2E_GAME_PROJECT_PREFIX`, `E2E_GAME_POOL_OFFSET`, and Playwright output directory.
The October verification archive is `.build/october-verified/`; verify it with
`node e2e/verify-artifacts.cjs .build/october-verified`. It preserves the checksummed
report, action receipts, native state, cleanup receipts and ChronAL timing evidence
independently of another chat's subsequent report. No live console is restarted.
The final sprite/board verification is retained separately in
`.build/october-final-ui/`, and the two-fighter fourteen-knock tour in
`.build/october-party-doors/`. Pass either directory to the same verifier. Native
dashboard images are routed to the owned local game host in the visual journey;
the fixture's ordinary external-network block remains intact.

## Event priorities from an older client

`priorities` in `runtime/coordinator/http/formation.ts` accepts only a list as
long as `supportedEvents`. The October rows raised that to 14 ids, so a client
that predates them (the PWA, a script, `e2e/live-event-runtime-recovery.spec.ts`
at lines 284 and 380) posts the ten older ids and gets
`400 invalid event priorities`. Failure inventory, before the change: an older
list of every pre-October event is rejected instead of keeping its order and
appending the October events in catalog order; a list that drops a pre-October
event, repeats an id or names an unknown id is accepted. A saved older list
needs no migration, because `eventPriorityOrder` appends missing supported
events on every read.

## Event bosses outside their event

The Headless Horseman (30M HP, attack 1600) roams Spooky Forest after it spawns
(`spawn_special_monster` gives it `roam: true`), and the Gargoyle (6M HP) wakes
in Spooky Town's graveyard. Failure inventory, before the change: a character
farming with the `all` focus, or one whose focus area the Horseman roams into,
pulls either boss as an ordinary target without having joined its event; a boss
that attacks a party member is no longer defended against. The Graveyard species
filter (`eventSettings.graveyard.monsters`) covers only the event itself.

## Event-only monsters in the Bestiary

The Horseman, its Jack-o Walker adds (`G.monsters.horseman.spawns`, at 75% and
25% HP), the Zombie and Ghoul waves and the Gargoyle (`G.events.graveyard`) have
`respawn: -1` and no map spawn. Failure inventory, before the change: the
Bestiary shows "No static spawn recorded" for them; an add or wave monster is
credited to the wrong event; a monster with an ordinary spawn, such as Goo or
Ghost, gains an event label; every catalog entry grows by a field.

## Cipher gathering transfer setup

Hosted run 40993907627 passed native gathering and brewing but exposed an
ambiguous transfer setup: ordinary party loot may award spores directly to the
merchant, so merchant stock alone does not establish fighter delivery. Preserve
the native transfer receipt assertion. Before rerunning, keep the merchant out
of the native loot party and hold only its current Cipher entry during gathering;
release entry at the actual native cutoff. The known recipe consumes gathered
spores, requiring delivery before a successful brew. Native loot, travel,
transfers, brewing, timestamps and the original assertions remain authoritative.
