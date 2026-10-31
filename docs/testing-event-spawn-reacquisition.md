# Empty event sightings and death reentry

Failure inventory recorded before implementation: an empty last-seen location
repeats forever; a native spawn visit bounces back to an obsolete hint; stale
announcements override real entities; a pre-death async owner survives respawn;
a delayed poll steals reentry; a late member waits for survivors to stop;
catch-up cancels their convoy or ignores newer navigation, runtime, event
selection, death, exit or Escape ownership.

The original selector repeatedly preferred advertised coordinates. Completing a
walk did not mark that waypoint searched or advance to the catalog spawn. Shared
walking also could not admit a late revived member while an existing event session
travelled. Finally, a `rip` check alone can miss death/respawn between two polls.

Mr. Green/Pumpkin retain searched-hint identity by event, occurrence, realm,
navigation and selection revision. An empty visited hint advances to the native
catalog spawn. Real local boss entities and fresh matching party sightings keep
priority. Staging and Slenderman's separate search remain unchanged.

Event walks capture the death identity, retiring old continuations across fast
respawn. Pending death reentry keeps ordinary event polling from stealing its
continuation. The coordinator can authorize an independent late catch-up while
the survivors' same-event convoy travels. It verifies exact reported death,
fresh alive status, joined event, runtime, current navigation, membership, realm,
destination map and absence of another command. It preserves the survivor convoy
and participants. Client managed movement remains fenced by navigation, runtime,
selection, death, Escape and exits, and yields to a reachable real boss.

Read-only evidence is in `.build/event-death-investigation/`. QwenTina's recovery
telemetry included `Event travel already in progress`. Later snapshots support
the ownership problem but do not reconstruct every second of the 15:32 incident.

```powershell
npm run typecheck
npm test -- -- --project=live --workers=2 --grep "native Mr Green leaves|native respawned event follower starts"
npm test -- -- --project=live --workers=3 --grep "walk yields to a newly visible boss|Halloween mrgreen stages"
npm run test:e2e:verify
```

The empty-waypoint scenario declares initial boss position/difficulty and stale
server_info coordinates only. The native backend ordinarily updates its own event
coordinates, so this fault must remain scoped at that announcement boundary.
Assert the advertised coordinates stay stale while both real fighters reach and
damage the native boss at its catalog spawn. Entity visibility, movement, damage
and native attack receipts remain real.

The catch-up scenario holds the follower's ordinary pre-death event entry, leaving a live survivor
convoy, and kills the late member through native Rime Shatter. After respawn it
must physically move while the survivor still moves under the same convoy ID;
both must subsequently damage the actual boss. Replacement pre-death walking
tokens retain the same declared hold; native reentry with `reentryDeathAt`
passes through. Faults target only that event entry and the current reentry
permission, never status or unrelated movement.
Retain `native-empty-last-seen-spawn-recovery`,
`native-respawn-moving-event-catchup`, native death/attack and timing evidence,
and workspace cleanup receipts. All gameplay waits use ChronAL. Stage a completed
immutable character/coordinator artifact; activation remains explicit.

Hosted run 40993907627 exposed setup turnover before the death assertion: both
fighters had already reached the boss, with no active survivor convoy. Holding
only the first token allowed replacement entry requests past the setup boundary.
Keep bounded timestamped setup snapshots in `native-respawn-moving-event-catchup`
so a missing moving-survivor precondition is distinguishable from failed native
death/reentry. Retain the original time limits and exact movement, convoy and
damage assertions.

## Recorded recovery evidence

The final two recovery scenarios passed in separate native game pools, with 96
verified evidence files retained under
`.build/event-death-investigation/recovery-passed/`. The stale announcement stayed
at Spooky Town (255, -1425), while both fighters reached and damaged the same
native boss at its catalog spawn (636, 994.5). In the death case, physical catch-up
movement was observed 1,000 ms of ChronAL gameplay time after the revived state
and permission release were observed. The survivor kept the same convoy ID and
sole participant membership; the HTTP grant bound the exact client death record.
Both fighters subsequently damaged that same boss.

Earlier combined runs encountered scheduled/native bosses already present before
later scenarios' setup. Those strict setup failures are retained in
`.build/event-death-investigation/combined-initial/`; scenarios were not changed
to accept duplicate bosses or weaken native hit/ownership assertions. The final
commands give each selected case a fresh isolated game pool. Exact owned IDs,
rather than ad-hoc monster fields dropped during native reconstruction, identify
cleanup targets. Pending reentry also initializes an already-alive runner from
its retained intent, and stale CODE cannot clear a newer runtime's recovery flag.

The final adjacent run passed moving-Mr.-Green acquisition. Moving-Mr.-Pumpkin
and the full Green staging/death-return journey failed their strict initial
encounter guards (`Existing event boss cannot be replaced` / `Expected clean
native encounter`) even in separate pools: native scheduled bosses had appeared.
Those checks did not exercise the changed recovery path and were not relaxed or
reported as passes. Their complete report remains in `.build/e2e-report/` and
`.build/e2e-results/`; the passing recovery report remains independently verifiable
in the archived `recovery-passed` tree. Typecheck and JavaScript syntax checks pass.
