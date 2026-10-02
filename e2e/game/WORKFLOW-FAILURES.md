# Real game workflow failure modes

Recorded before the live game journey specs. Tests use the real upstream game
server and authenticated game clients running the maintained character code.
Administrative setup may seed state, place entities, or trigger an event. It must
not fake character heartbeats, acknowledge application commands, simulate combat
damage/loot, or move a character to the asserted destination after the action.

## Movement and ownership

- A dashboard/API command is accepted but never reaches the actual character.
- A character reports completion before server-observed arrival.
- A convoy leaves a follower behind or cannot cross a real map door.
- Superseded travel resumes after a newer destination was accepted.
- Coordinator interruption causes stale movement to continue or loses the goal.
- Town/escape completes only in local state while the player remains away.

## Hunt and combat

- Hunt selects a destination but cannot reach a real spawn or attack live mobs.
- Real kills do not decrement the server quest, or completed quests fail to reach
  Daisy, claim a token, and hand back to the current policy.
- A follower's party ownership and commands diverge from the leader.
- Hunt off leaves old targets/commands executing; turning it back on revives an
  obsolete cycle instead of observing current quests.
- Death/respawn or client/coordinator restart loses recovery ownership.
- A travel encounter stops the party permanently after the monster dies/loot clears.

## Event interruption

- Disabling an inherited party event must collect all now-disabled actual
  participants before starting recovery. Sessions are stored per character;
  using only the first caller's session omits companions when later calls see
  an already-active recovery. Preserve each participant's captured waypoint;
  globally advertised events alone, other events and still-enabled members must
  not be added to the evacuation.

- Ending upstream Goobrawl stops spawning but leaves surviving monsters. The
  runtime intentionally finishes that combat before evacuation; a finite test
  encounter must seed manageable monster HP before spawning, never fake kills
  after the event ends. Restore those definitions and clear abandoned arena
  monsters only between scenarios after every client disconnects.

- A live event never preempts Hunt or leaves clients in different instances.
- Ending the event only updates a UI label while characters remain on its map.
- Event evacuation waits for an obsolete farming checkpoint instead of handing
  back to current Hunt policy (the core PR #21 behavior).
- A manual order or Hunt-off during evacuation is overwritten by the old return.
- Hunt-off during authorized event entry must not dispatch a backup convoy into
  the event. A leader can enter before its follower; replacing their event work
  then strands the follower outside and leaves the leader convoy-held beside
  living monsters, preventing the event's combat-clear evacuation guard forever.
- Coordinator restart during event work loses return ownership.
- A member acknowledges verified Main-town arrival, then moves before its
  companion arrives. Requiring both to remain at spawn simultaneously discards
  valid per-member completion and leaves Hunt paused forever. Handoff must retain
  current-cycle town acknowledgements while still checking fresh alive Mainland
  status and unchanged navigation ownership; a Franky map exit alone is not a
  town acknowledgement.
- A validated town acknowledgement remains completed after normal travel crosses
  into another non-event map. An old event recovery must not keep a completed
  Hunt quest paused just because its owner is now farming in Desertland while
  the deselected boss remains globally live. Freshness, life state, event-map
  exclusion and current navigation ownership still guard the handoff.

## Merchant and inventory

- A delivery reports success without a real server inventory transfer, duplicates
  stock, or transfers the wrong slot after movement.
- Buy/upgrade jobs consume the wrong item, repeat after restart, or report a
  success without a server upgrade result.
- Bank deposit/withdraw reports success without durable authoritative contents.
- NPC sales consume marked/locked or newly replaced items.
- An inventory preview enqueues economic work merely by opening the menu.

## Evidence and boundaries

Every scenario must capture the initial seed, action requests, coordinator state,
authoritative server observations, client/socket logs, and screenshots/traces.
Readiness requires real character connections and real status ingestion. Assert
server-side outcomes independently of coordinator labels. Keep unique isolated
fault-injection coverage until these journeys exercise its failure, and remove
duplicated wiring/composition checks independently of the migration schedule.

## Issue 43 and October 1 CI recovery

Before implementation: auto merchant collection must retain every eligible copy when a finite upgrade/compound rule claims only part of the stock, cross the pickup threshold, transfer native items, conserve cargo, and survive coordinator restart. Auto bank must still yield to processing; destructive rule conflicts must suppress both automatic destinations; manual intent must survive.

Retained isolated CI fixtures must supply required production state, passive level predicates, dungeon ownership, native movement/loot inputs, journal helpers, and current dashboard callbacks. Missing dependencies can throw before the asserted race or recovery boundary. Historical bank recovery checks must exercise the bounded cooldown and retirement contract without expecting unrelated reused slots to move. HTTP diagnostics must match the actual transport error metadata. These retained exceptions cover lost replies, storage reconciliation and callback boundaries impractical to enumerate through native gameplay; preserve their existing behavior checks while correcting their setup.

Native CI failure inventory: catalog-free reads cannot serve Franky setup or the blacklist picker; a waypoint changes the origin for subsequent Cave movement checks; natural MP regeneration can race declared low-MP setup; order and exchange recovery can time out or retain an unresolved receipt. Inspect native logs and retain evidence rather than fabricate receipts or weaken conservation assertions.

Cave stop/resume failure inventory: loot(id) can route through the commander frame rather than the follower whose range was checked. Rejected loot leaves readiness false and freezes assembly. Open native cave chests through the current character frame, preserve instance/range/vote checks, and verify follower movement and shared purse receipts in the retained native Cave journey.

Artifact reporting must classify Cave and BankBoi as native scenarios and retain the upstream server log for a Cave-only run; omitting their filenames mislabels repeatable native evidence as simulation.
