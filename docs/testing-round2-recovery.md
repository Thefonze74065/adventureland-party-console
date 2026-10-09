# Round-two native recovery failures

Failure inventory recorded before implementation:

- Halloween adds never selected, leader/follower splitting targets, add selection
  replacing boss recovery coordinates, unrelated Jr monsters pulled across maps,
  event deselection leaving add hunting enabled, native spawn/loot outcomes faked.
- Anniversary old-round slice handoffs releasing new staging; farm search walking
  away from Main; repeated Town casts; featured minute hold released by delivery.
- Arrival connector silently dropped after warp, resent while transporting or
  moving, obsolete journey sending after cancellation, retries renewing the
  twelve-second transition deadline, new unchecked connector geometry.
- Escape revival called every pulse, timestamp set after a rejected call, retry
  throttle leaking between distinct attempts, role revival competing with escape.

Use real native clients and acknowledged movements. Connector faults drop native
move submissions before client prediction, then forward retries unchanged. Socket
packet loss alone lets the client predict arrival and does not reproduce a stopped
connector. Record actual server positions; never manufacture arrival or replies.
Initial historical stock and schedule projections are declared fixtures. Save
native event/transfer/kill histories, final states and screenshots, and verify the
artifact manifest after each focused run.
# Historical CI fixture findings

Run 37877597182 shard 6 failed three Town journeys before travel because the
priest wore native Ice Skates but had actual speed 59 while the equipment
precondition required <=40. Retained final telemetry shows active native War Cry
with speed bonus 20, so the unbuffed equipment baseline was 39. Record actual
speed, active condition and native definition; subtract that verified active
bonus only for the equipment precondition. Do not disable maintained skills or
raise the baseline bound. Real travel still uses its observed native speed.

Shard 3 failed both Halloween reentry journeys. Green's ranged priest remained
in combat while the returning warrior waited for stopped formation: out-of-range
boss sighting suppression hid the already-fighting participant. Pumpkin's native
death occurred after route preparation, invalidated its old origin, and left the
failed event walking convoy retained indefinitely at the same navigation revision.
Only a fresh alive report proving a newer native death under the same event,
runtime and parent/navigation ownership may retire that obsolete failed convoy.
Ordinary same-episode geometric failures and exhausted retries stay bounded.
# Native Halloween threshold observer corrections

The first native Mr. Green add run spawned all fifteen native adds, but its observer used `get_monster(entityId)`, which resolves a monster type rather than the instance entity ID. Consequently all quarter-spawn records lacked boss HP and the threshold predicate could never pass. The observer now reads the native instance monster table by ID, preserving the native master binding and actual boss HP ratio.

The client receipt buffer retains only the latest 2,000 events. The threshold poll now accumulates actual positive warrior hit receipts for observed native adds in a local durable ledger, so first-quarter proof survives until the remaining quarters occur. Native five-add-per-quarter spawning, damage, death and loot remain unchanged. A final observer artifact records sampled native boss state, native spawn records, real hit receipts, character coordinates and coordinator state on both success and failure.
