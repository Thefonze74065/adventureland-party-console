# Event attendance

Slenderman, Mr. Green, and Mr. Pumpkin are opt-in open-world boss events. Adding
them does not alter existing or legacy character selections. Their rows remain
available when the current server schedule feed omits a seasonal event.

Mr. Green and Mr. Pumpkin use the native announced spawn timestamp. Attendance
stages one minute before spawning, holds the original return checkpoint, and
waits at most two minutes after the announced deadline. A missed or cancelled
spawn returns to the saved activity. Live boss sightings replace the staging
destination; native death recovery can resume a still-active selected fight.

Slenderman has no fixed staging position. His native announcement can omit
coordinates and keep its initial map after subsequent warps. Attendance therefore
prefers a living local entity or a party sighting received within three seconds
on the same realm, then searches Halloween, Spookytown, and Cave using native map
locations and managed movement. Discovery is limited to one minute per map and
three minutes overall. An unsuccessful search returns to saved work and suppresses
that live episode until a new actual sighting or a new live cycle permits another
attempt. Existing attack policies block reflected magical attacks and preserve
healing and defensive recovery; equipped weapons are not automatically replaced.

Windows activation requires the supported full restart, which now also publishes
the shared event policy. A build alone does not activate running characters.

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

