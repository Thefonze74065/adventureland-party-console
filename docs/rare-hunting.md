# Passive rare hunting and Phoenix patrol

Farming settings opens a searchable passive-hunting catalog. Each monster has an
independent enable checkbox, Keep moving to destination option, and priority (0–1000,
higher first). New selections default to keeping movement off and priority 100;
Fairy retains priority 101. Existing selections migrate without changing behavior.
The separate field-generator preference defaults on.

Keep moving uses basic attacks only while in range, including when stationary.
It does not select a movement target, chase, kite, or wait for loot. Actual attacked
identities are reported by realm/map/instance/ID so their retaliation does not
acquire defense or queue ownership; unrelated threats still do. Healing, attack
restrictions and emergency recovery retain precedence. Turning this option off
uses the ordinary encounter behavior below. Explicit farming and Phoenix patrol
remain separate. Rare sightings can interrupt normal
farming, scatter, farming travel, and Monster Hunt. Event work, Daisy reward
claims, Town, and emergency recovery retain ownership. A completed encounter
resumes the saved task only while its navigation revisions remain current.
Only confirmed party engagement followed by that target's death starts looting;
witnessing another player's kill is insufficient. Loot acknowledgement must match
the encounter, realm, map, instance, and location. Collection awaits the existing
loot routine and a fresh server/draw observation. Failures remain pending and retry;
full inventories request merchant cleanout. There is no fixed departure delay or
timeout that silently skips drops. Emergency and event ownership still take precedence.
Passive Phoenix hunting rejects outsider claims. An explicitly active Phoenix
patrol helps other players kill Phoenix through fresh, revision-bound assistance
permission; shared combat handoff does not revoke that permission. Ordinary
monsters retain their claim guards. Franky, Ice Golem, and Crab collaboration
remains available.

Starting Phoenix from the farming-area picker selects Phoenix alone. Select all
five spawn regions in the desired order; selecting a numbered region removes it
and renumbers the rest. The saved order survives restart and only breaks ties
between equally distant regions. Selecting another monster stops the patrol
without disabling passive Phoenix encounters. Starting a patrol launches no party
convoy: each fighter begins searching from where it stands.

Without a valid saved order, the picker preselects Mainland (641, 1803), Cave
(-180, -1164), western Mainland (-1184, 781), eastern Mainland (1188, -193), then
Spooky Forest (8, 631). Valid custom orders are preserved.

Phoenix is not in the server-info boss list and its spawn is not announced, so
the patrol finds it by looking. The fighters search independently; the merchant
does not take part. A free fighter takes the nearest region, by planned route,
that nobody has checked in this coverage cycle and no other fighter is heading
to. It shares an already claimed region only when every unchecked region is
claimed. Route distance is walking distance plus 400 units per map transition.
Assignment is one planning round over every free fighter; a round that settles
after the patrol was stopped, superseded, or reset is ignored. Each searcher
walks its own route (`search` control) and holds fire. When all five regions are
checked without a sighting, a new cycle starts.

Each region is covered by observation points with a conservative rectangular
footprint inside the game's 700-by-500 visibility half-extents. Four regions need
one point; the tall western Mainland region gets overlapping north–south points.
A point counts after a one-second dwell, and only with a fresh observation from
that fighter's current runtime. A failed route or 30 seconds without movement
skips the point. A region whose points were all skipped is marked incomplete for
the cycle; all five incomplete pauses the patrol with a visible reason. A dead,
stale, reloading, or protected fighter releases its region to the others and is
reassigned from its new position when it returns. A fighter that a monster
targets defends itself through ordinary combat and then resumes the same control.
While searching, only party-wide conditions pause every searcher: town, combat
recovery, escape, events, Hunt turn-in, or a leader heartbeat older than 10
seconds. A fighter's own pending command, low HP, or event withholds only that
fighter's control. Assignments survive pauses and absences under 10 seconds;
only the movement watchdog restarts. Each withheld control is logged as
"Phoenix search control withheld" with the fighter and the reason. Encounters
keep the party-wide protection rules.

Any fighter's fresh sighting starts the encounter, on any map. The encounter
first converges: the other fighters walk to the latest Phoenix position, and the
spotter shadows it from about 200 units, outside its attack range. Nobody attacks
it: clients reject the Phoenix as a target while converging, and patrol
observations are not fed into grouped combat. Exception: if the Phoenix already
has a target (another player is fighting it, or it aggroed one of us), fighters
within 300 units engage at once, since Phoenix loot is cooperative. The rest keep
converging. Converging tolerates ten seconds without a sighting while the
spotter re-acquires it.

Once every fighter is within 300 units, normal grouped combat takes over with
Phoenix priority 100.5, the ten-second selection window, and the usual claim,
progress, and five-minute limits, counted from the gather. The convergence
deadline is the later of five minutes and twice the slowest fighter's planned
travel time at its reported speed. After it, the party engages with whoever is
in range, and the encounter message names the missing fighters. After the gather,
the 30-second no-progress rule starts only once grouped combat locks the Phoenix.
A failed patrol attempt only gets the 3-second cooldown, never a retry-evidence
rejection, and an older rejection is cleared on the next sighting. Otherwise a
fighter walking past the Phoenix outside attack range could never re-qualify it.

On a confirmed Phoenix death, coverage restarts and the respawn deadline becomes
death + 35 seconds. Only the leader stays to collect loot; once grouped fights are
finished, the other fighters spread out and wait at their regions' first points.
Observations before the deadline do not count. A death we did not take part in
(another party's kill) also starts the deadline, without loot. The deadline
persists through restart; assignments and coverage are rebuilt rather than trusting
old positions. A realm hop (for example boss chase moving the party to another
server) suspends the patrol instead of ending it: any encounter there is dropped,
the checkpoint keeps the home realm and respawn deadline, and no patrol runs on
the foreign realm. When the leader is back on the patrol's realm, a fresh split
search resumes. New navigation while away (a revision, focus, policy, or leader
change) still ends the patrol. The installed 17083 game definition has respawn=32, and published
server code adds up to 0.9 seconds and samples uniformly from the five boundaries
(20% each).

Every owned runtime reports rare sightings, field generators, and observed kills
through ordinary status telemetry, even with no map viewer open. The coordinator
scopes sightings by realm/map/instance and selects one shared encounter. Passive
unengaged encounters end when no fresh sighting remains (three seconds). Engaged
encounters retain combat/defense ownership; independent pursuit limits include 30 seconds without a new HP
low after combat starts, or five minutes total. Abandoned entity IDs have a three-second retry delay across all rare hunts,
including Fairy, Phoenix, Golden Bat, Cute Bee, Hen, and Rooster. Old attack
reports remain filtered separately for two minutes; fresh attempts are allowed
after the three-second delay. Confirmed deaths retain their dead-ID records.

Fairy is searchable but cannot be selected as an active farming focus. It is
skill-immune: Burst, Controlled Burst, Curse, Taunt, and Stomp are not used in its
encounter. Ordinary attacks, including warrior attacks, can trigger escape.
If a participating fighter carries `fieldgen0`, the nearest carrier approaches
within 200 units and consumes one through `equip(slot)`, which creates the field
at the carrier's position. Offensive attacks wait for confirmation of a field
within 300 units, or a bounded deployment failure. One generator maximum is
consumed per encounter. Existing nearby fields are reused. There are no automatic
purchases or storage withdrawals. Without a confirmed field the agreed fallback
is ordinary attacks and bounded pursuit, with no guarantee of success.

Settings use `POST /party-api/rare-hunting` with partial boolean keys `tinyp`,
`phoenix`, `goldenbat`, and `cutebee`. Phoenix starts extend `POST /party-api/navigate-to-monster` with
`monsterId: "phoenix"` and `phoenixRouteOrder: string[]`; the server validates all
five catalog region IDs.
Dashboard state exposes `passiveRareHunts`, `phoenixRouteOrder`, and `rareHuntState`;
character status responses include a revision-bound `rareControl`. A saved return
checkpoint survives coordinator restart, while encounter locks and scan coverage
are rebuilt rather than trusting old sightings.

Primary implementation: `runtime/coordinator/navigation/rare-hunting.ts` and
`phoenix-patrol.ts`, with client observation/targeting in `characters/shared.js`.
`scripts/rare-hunting.cjs` is a compatibility export of the generated TS bundle.
Run
`npm test` and `npm run build` to validate; use the existing publication/reload
workflow to activate a built generation.

Farming returns are tracked by `scripts/rare-farming-return.cjs` using the durable
`rareHuntReturn` checkpoint. Low health, stale heartbeats, events, and temporary
travel ownership pause the return without deleting it. Failed or lost return
convoys retry at most once every five seconds; offline members retain their
obligation until they reconnect. Completion requires fresh, living members in
the saved farm area (or within 180 units for a point destination). Explicit new
leader navigation supersedes the old return. An active Monster Hunt receives
ownership back at the same cycle, mission index, owners, and pinned destination,
without rebuilding quests. An active Phoenix
patrol resumes its scan rather than returning to ordinary farming. The dashboard
reports waiting, returning, and resumed states instead of leaving a stale
cancellation message after recovery.

Ordinary empty-spawn recovery cannot take movement ownership from an active
Phoenix patrol or rare encounter, including client-reload gaps. Anniversary
staging retains ownership through its full event-and-return cycle; patrol resumes
the saved region only after that cycle releases it.

Shared event returns also preserve initially offline members in
`deferredEventReturns`; a dead character or the wrong explicit instance cannot
count as an arrival. Manual Town and explicit Escape holds remain authoritative.

Final Hunt kills install a departure barrier before Daisy return or mission
travel can start. The mission owner stops nominating neutral monsters immediately,
including the interval between final-hit delivery and quest-count delivery.
An untouched selected target is not an attacker. Actual defense remains available.
Client `huntLoot` reports and coordinator `monsterHunt.loot.progress` acknowledge
collection; command delivery alone cannot complete it. Mission revision, target,
owners, and cycle scope prevent an old acknowledgement completing a new assignment.

Queue cancellation preserves genuine party attackers and rejects delayed abandoned
rare nominations/actions. Clients acknowledge the coordinator's global reset epoch
as well as character reset epochs. Synthetic interruption/return regressions verify
resumed marker eligibility and red/yellow/double-yellow rendering. The historical
missing-ring incident still requires live reproduction before attributing its cause.
