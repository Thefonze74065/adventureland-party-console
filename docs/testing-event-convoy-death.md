# Event convoy death during admission

Failure inventory, recorded before implementation in the E2E: a cancelled pending
walk remains eligible; death and revival reactivate an old token; admission enrolls
a dead member; setup fails before route realm/runtime identities exist; death before
admission cannot retire that failed convoy; recovery retries its terminal failure
forever; recovery steals newer navigation or renews an exhausted route budget.

The incident's native snapshots recorded Boo Boo deaths with Mr. Green event trips
for both GDroidPT and QwenTina. Their failed event convoy had no prepared route
realm/runtime identities, was created after both deaths, and remained the target of
alive clients' recovery retries. Killer species was never an event-reentry gate.

The regression `native event death during convoy admission returns after respawn`
holds the peer's initial shared-walk requests, then kills the waiting attendee using
native Rime Shatter. It delays only that attendee's native respawn emission until
peer admission has been observed. Native status, combat, movement, persistence and
coordinator telemetry remain real. The old runtime admitted the dead attendee's
cancelled pending token, failed with `Convoy unavailable`, and kept the revived
character in Main throughout the 150-second virtual recovery window. Evidence is
retained in `.build/event-convoy-death-red/`.

Cancellation now removes an unadmitted matching token. Pending admission requires
a living fresh owner and the same observed death identity as its original request.
Convoys retain their realm/runtime owners at admission, before route preparation;
saved parent ownership also records the original request time and death identity.
An exact native death-reentry request can retire a still-owned failed event walk
invalidated since that request, including a death in the same virtual clock tick.
Navigation, runtime, membership, event, realm, command and retry-exhaustion guards
remain required. Neither killer species nor error-message text authorizes recovery.

```powershell
npm run typecheck
npm test -- -- --project=live --workers=1 --grep "native event death during convoy admission"
npm test -- -- --project=live --workers=2 --grep "native respawned event follower starts|native Mr Green leaves"
npm run test:e2e:verify
```

The regression must retain `native-event-admission-death-recovery`, native lethal
hit/death receipts, timestamped admission/recovery samples, native damage by both
fighters to the exact seeded boss, final coordinator recovery completion, ChronAL
timing, and workspace-cleanup receipts. The fixture restores its emission wrapper
and scoped HTTP routes in finally. Reports are retained outside deleted owned
scenario workspaces. Build a completed immutable candidate and verify its source
hash; staging must not alter the active console reference.

## Validation results

The unchanged admission-death journey failed before the fix and passed afterward
in 33.7 seconds of test wall time. The passing ledger shows only E2EPriest admitted
while E2EWarrior was dead, followed by both living fighters physically in Spooky
Town with native hits on the exact seeded Mr. Green and a published
`recovery-complete`. Its 53 hashed evidence files are retained under
`.build/event-convoy-death-green/.build/`; rerun verification with
`node e2e/verify-artifacts.cjs .build/event-convoy-death-green`.

The native event death-limit/restart journey also passed. The moving-survivor and
empty-hint journeys failed before their behavior checks because a native Mr. Green
already existed; their strict clean-encounter guards were preserved. All 145
adjacent-run evidence files are hash-verified and retained under
`.build/event-convoy-death-adjacent/.build/`. Every owned gameplay workspace has
a successful cleanup receipt. The console Halloween opt-in/inheritance/persistence
journey passed, and its report is in `.build/e2e-report/` and `.build/e2e-results/`.
Typecheck and changed-file whitespace checks passed. This focused validation is
not a full-suite certification.

Completed candidate `9119423b76a94ff58ce18c301dd83f05e88ef845e42eb690bbff4568d25740b4`
was verified against current source fingerprint
`abc981824b4d3011cee7efe2ed12b467ce054d90ffd9f0b14cd8e7de164886ed`.
The active reference remains
`4254f048b1b3df2fb19468f8897b1cf5db227d7868fca8cacb3a38534c49a81f`;
no live console activation or restart was requested or performed.
