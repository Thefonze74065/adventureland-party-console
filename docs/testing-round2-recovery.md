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

Frozen native Mr. Green staging/restart/death/reentry passed, but its Main evacuation and Spookytown saved-point return exhausted180 seconds while both actors were genuinely walking at(465,1018)/(481,1019), about330 units from saved(796,994.5). Native movement showed zero/153ms without progress and a next waypoint(767,1045), confirming active walking rather than a stall. Give Mr. Green's existing actual saved-point return observation240 seconds; keep checkpoint coordinates, native arrival tolerance and all runtime deadlines unchanged. Other boss return budgets remain unchanged.

Production staging priority regression: adding Green Jr to the eligible event target list made the generic destination search choose its earlier Halloween map entry before the actual Mr. Green boss entry in Spookytown. Verified native G15555: Green Jr boundary[-720,-820,-418,-203], Mr. Green boundary[524,860,748,1129]. Destination lookup must search exact boss entries across all maps first, then retain the existing broader-type fallback. This preserves add combat priority without staging at an add's unrelated spawn. The existing native-catalog staging scenario verifies real boss-area walking before combat.

The Slenderman case's overall observation ceiling is600 seconds so its separately bounded180-second reacquisition,240-second actual kill and saved-return phases can finish after the measured116-second native chase. This changes fixture observation budgets only; no runtime deadline, monster HP, damage, reflection, movement or native outcome is altered.

Timer-only native staging failure inventory: the native Mr. Green boss belongs to Spookytown, but production's expanded event-type search incorrectly picked the earlier Halloween Green Jr entry. CI actors followed that wrong add destination while the fixture expected the actual boss area. Prefer exact boss entries in production; resolve the boss catalog before fixture login, seed the initial checkpoint160 units from its actual centre, and use that same centre for declared boss and arrival assertions. Keep the35-second actual walking check and native death/reentry/return checks. A disconnected native player must be represented as null and keep the existing bounded arrival predicate false, rather than crash an admin read or count disappearance as arrival.

Slenderman CI kill-bound evidence:91 actual positive physical hits (~10k each) were recorded; the boss remained alive at197,770/1,145,066 HP and the last positive hit occurred at the end of the180-second kill poll. Native warp reacquisition had a116-second hit gap; subsequent pursuit continued dealing real damage with no target rejection. Give the separate actual kill phase a finite240-second observation budget and preserve boss HP, reflection, chase, damage and native kill requirements unchanged.

Production retention failure inventory: a valid living boss is retained indefinitely by the role runner unless rare/group nomination changes. The event selector's newly preferred add is never consulted. A new Green/Pumpkin nominee must interrupt live-boss retention when native adds appear, retain a chosen add until it dies, and return to the boss afterward. Dungeon, return-defense, Franky, movement ownership and unrelated farming retention remain authoritative. Before the runner fix, the existing native add scenario was strengthened to require sampled selection of a living boss followed by selection of its genuine threshold add while the boss remains alive, together with real positive party damage at every quarter.

The corrected observer then proved all three genuine quarter waves, but its warrior-only condition rejected actual positive priest damage to first- and second-wave adds. Short-lived native adds do not guarantee both characters land a hit. Coverage now requires real positive party damage at each unchanged native quarter threshold; timestamped native hits and sampled selected targets remain in the artifact. A separate assertion requires actual boss damage after the first add engagement, proving combat resumes rather than merely accepting spawn records.

The first native Mr. Green add run spawned all fifteen native adds, but its observer used `get_monster(entityId)`, which resolves a monster type rather than the instance entity ID. Consequently all quarter-spawn records lacked boss HP and the threshold predicate could never pass. The observer now reads the native instance monster table by ID, preserving the native master binding and actual boss HP ratio.

The client receipt buffer retains only the latest 2,000 events. The threshold poll now accumulates actual positive warrior hit receipts for observed native adds in a local durable ledger, so first-quarter proof survives until the remaining quarters occur. Native five-add-per-quarter spawning, damage, death and loot remain unchanged. A final observer artifact records sampled native boss state, native spawn records, real hit receipts, character coordinates and coordinator state on both success and failure.

### Native CI event exit after CODE turnover

Failure inventory before the fix: a retained event exit command can have an ID below the character's persisted last-command ID after its child walk completes; a replacement CODE runtime then ignores that parent forever. The native Green failure ended with the warrior physically at Main town, idle event recovery, and the coordinator still waiting for its explicit exit acknowledgement. Restoration must not acknowledge arrival implicitly, supersede manual navigation, replace another workflow, or repeatedly restart an active exit. Refresh only a retained command for the same pending event cycle, after a fresh idle report proves it was already consumed, with the saved navigation revision still current and no active convoy owning that character. Existing native staging/restart/death/return scenarios retain their actual arrival and acknowledgement requirements.

### Native moving Halloween boss during death reentry

Failure inventory before the fix: the native Pumpkin priest kept fighting and kiting the living boss roughly 2,400 units north while the revived warrior followed the one-time reentry destination. The final native route was still making progress (`noProgressMs: 3`) but chased a stale point and produced no post-respawn hit within 180 seconds. A moving encounter needs fresh actual boss observations, without treating adds, global schedule coordinates, stale reporters, different instances, new navigation, or a communication hold as permission to redirect. Retarget only the same owned live event walking convoy, no more often than twenty seconds and only after its boss moves at least 250 units. Reprepare that convoy with a new route generation while preserving its retry counters and the client's original 180-second walking deadline.

Native CI return observation phases: Slender's genuine kill was followed by both
clients' saved-point arrival at approximately 178.7 seconds, but the explicit
completion receipt retired recovery just after the former combined 180-second
poll. Keep the actual-arrival bound at 180 seconds and observe acknowledgement
separately for thirty seconds while continuing to require both real positions.
The absent-spawn run completed evacuation and dispatched checkpoint travel after
44.1 seconds, then experienced two native movement-barrier HTTP timeout holds.
Observe the explicit Main exit/dispatch phase for 120 seconds and the actual
checkpoint walk for its existing 120 seconds. Neither change extends the native
spawn-plus-120-second abandonment deadline or any production walking budget;
the test's overall 420-second budget covers these separate bounded phases.

Slender phase-split correction: the first arrival-only poll could see Halloween
0,0 during evacuation through that map, before Main exit and checkpoint dispatch.
The resulting thirty-second acknowledgement window began while the real return
convoy was still walking through Mtunnel (both native actors progressed with
1–34 ms of no-progress time). Arrival must belong to the dispatched checkpoint
phase, or an already fully retired recovery, before the acknowledgement window
starts. Preserve both phase bounds and the actual native coordinate checks.
