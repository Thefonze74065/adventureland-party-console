# Event attendance

Each character's Events dropdown selects individual supported activities. Followers use the leader's whole selection; their saved choices return when they unfollow. Merchants keep independent selections and can attend every supported event. During combat events they attempt attacks with their currently equipped weapon, including Golden Gun; no automatic weapon swap is performed. Merchant work yields at safe production/crafting checkpoints, while other in-flight actions finish before travel. Gathering, new jobs, and stand activity remain paused through event attendance and return. Unsupported game events remain visible with disabled checkboxes.

Unchecking an attended event requests the existing saved-activity return. Cancellation requests retry after coordinator outages. Legacy combat settings migrate to the equivalent supported combat list, with Anniversary initially enabled to preserve prior behavior.

Schedule rows use browser-local date formatting, including a timezone label. Only server-provided next timestamps produce countdowns. Unknown schedules are labelled explicitly. Game-server clock offset is sampled on connection and every five minutes; cached event checks do not create additional game-server requests.

Anniversary departure begins 90 seconds before the next server deadline. Each character gets at most two reserved attempts per round, retained by the coordinator through reloads. The second approach uses the latest featured-player position. Movement is bounded to 60 seconds with a ten-second progress watchdog and independent arrival detection. Visibility, kiss response, and reward confirmation waits are also bounded by event expiry.

The first character to exhaust both attempts skips the remainder of the round for the party. The Anniversary modal's gear edits a persistent, case-insensitive player blacklist. Adding the current featured player skips the current round; removing a name does not reopen a skipped round. An empty list is preserved.

Relevant regression coverage: `event-selections`, `event-policy`, `anniversary-kiss`, `farming-navigation`, `merchant-anniversary-reservation`, and `hunt-event-priority` tests.

Franky attendance attacks only living, visible `franky` monsters in the current map
and instance. It retains the current boss when possible and waits without fallback
targets if the boss disappears. Every participating class approaches until in attack
range, then holds position; no kiting, retreating, formation movement, or warrior Dash
is used. Approaches respect terrain but ignore monster danger zones and healer
coverage. Offensive skills cannot target adds; area effects that cannot exclude them
are suppressed. Healing, potions, buffs, and nearby loot continue. Event exit and
manual navigation retain ownership, and the existing exit-defense policy is unchanged.

Validate with `franky-combat`, `combat-movement`, `class-skills`, `franky-recovery`,
and `franky-exit`; publish character assets with the full supported restart.

Deselecting Franky revokes voluntary boss targeting and installs the protected
exit convoy immediately; departure does not require killing the boss first.
The native evacuation journey verifies boss damage, deselection, both client
exit owners, and actual Mainland arrival while Franky remains alive.

Halloween attendance uses the native seasonal `halloween` row. While the season is
on, the character's event status for `halloween` is whichever boss is live: Mr.
Pumpkin (Halloween map) or Mr. Green (Spooky Forest), preferring one on the
current map, then the one closest to death. The row shows LIVE while a boss is up
and the earliest broadcast respawn otherwise. Attendance walks to the broadcast
position (no join) and ends once no boss is live; respawns (54 / 94 minutes) are
not waited for in place. Slenderman is not attended yet.

Franky and Halloween share one boss-only combat layer (`bossCombatActive` in
`characters/shared.js`): only the boss is targeted, passing attacks, area and
movement skills, kiting, Dash and formation moves are suppressed, and an off-tank
attacks only after another living player has held the boss for 5 seconds. The
Halloween row's gear sets Auto / Off-tank / Tank and the auto death limit, saved
per character under `encounterRoutines.halloween`. On open maps a targeted
off-tank steps outside the boss's own range plus 60 and waits; Franky's door
flee, 40-minute keepalive, exit convoy and priest heal spam remain Franky-only.
Deaths while attending count against the encounter they happened in.
