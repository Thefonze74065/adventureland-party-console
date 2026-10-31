# Mailbox enhancement failure inventory

Before implementation: independent automation switches must not enable each other; collection must deduplicate current/queued jobs and preserve native pending outcomes; deletion must require an actual native taken=true observation and no active collection job; text-only mail and failed/unclaimed attachments must remain. Refresh and automation must not deadlock or delete concurrently with manual operations. New-mail identity tracking must survive restart, clear only on opening the mailbox, and detect later arrivals. Outbox records must originate from successful send completion, deduplicate repeated receipts, persist, and allow deleting only the local sent record without recalling native mail. Browser controls retain readable dark backgrounds; failures remain visible and do not silently alter preferences.

Existing account API and merchant completion boundaries remain authoritative. Browser fixtures declare saved outbox receipts and native account mail observations; gameplay collection continues through the maintained native merchant job.

Implemented as a maintained TypeScript policy around the existing account inbox. Both automations default off and persist independently. Successful send receipts create durable, deduplicated local outbox records; native mail sent before this version is not backfilled. Incoming message IDs remain unseen until the mailbox opens. Automatic deletion requires a confirmed native collected attachment and no owned active collection job; text-only messages are preserved. Failed automatic collection backs off for thirty seconds. Native inventory capacity, ownership and idempotency checks remain in the existing executor. Browser evidence and the ChronAL native attachment round trip are selected centrally for validation.

## Automatic deletion exceptions

Read-only live diagnostics on October 23, 2026 found autoCollect=false,
autoDelete=true, two collected attachment messages and no matching collection
jobs. The listing timestamp continued advancing while error remained `exception`.
The setting was persisted; a later automatic deletion failure was being exposed
as an inbox freshness error. The first rejected deletion also aborted automation
for every later message. Settings updates persisted before that failure but
returned an error, preventing the UI from acknowledging the saved checkbox.

Regression failure modes recorded before the fix: one rejected deletion starves
the next eligible message; a successful listing is falsely labeled stale; failed
mail disappears; pending, unclaimed or text-only mail is deleted; repeated refresh
calls hammer a failing API; restart loses the enabled preference or recovery.

Automation now catches failures per message/action and retains explicit diagnostics
separate from listing errors. Refresh/settings requests return their current
snapshot after an automatic action rejection. Other eligible messages continue;
each failed action retries after thirty seconds. Removed messages no longer retain
retry bookkeeping. Game-side `exception` responses are not manufactured into
successes: the message stays present and the dashboard reports automatic deletion
failure until a native request succeeds. No unclaimed attachment deletion or
alternate deletion endpoint is attempted.

Run the combined focused console and ChronAL gameplay journeys:

```powershell
npm run typecheck
npm test -- -- --project=console --project=live --workers=1 --grep "Mailbox enhancements|mailbox automation collects native"
npm run test:e2e:verify
```

The browser scenario declares one native API rejection, verifies a later collected
message deletes, checks preference/error rendering and retry backoff, then removes
the declared fault and verifies recovery after restart. Retain
`mailbox-delete-exception-recovery` and the screenshot/video. Native scenarios
cover deletion enabled before collection and enabled afterward, with unchanged
attachment quantities, collection ownership, outbox persistence and restart
assertions. Retain `native-mailbox-send-collect-delete-ledger`. Live diagnostics
exclude message subjects/bodies and are in `.build/mailbox-investigation/live.json`.

### Native game-server blocker found during validation

The console scenarios passed, including independent preferences, safe deletion,
failure isolation, backoff, outbox behavior and restart recovery. Both native
attachment round trips reached real collection but failed their retained deletion
assertions. The disposable upstream server logged:

```text
#TX Transaction error: ReferenceError: in_arr is not defined
    ... delete_mail_api ...
delete_mail { failed: true, reason: 'exception' }
```

The upstream `delete_mail_api` transaction calls `in_arr(A.owner, mail.owner)`
inside its isolated callback; that helper is unavailable there. This is a native
server failure, not a missing auto-delete preference. The live account API exposes
only the same generic `exception`, so its private server stack cannot be verified
from this console. No backend generated files or native outcomes were patched to
make the E2Es pass, and deletion assertions were not weakened. The console now
reports/retries this rejection accurately, but cannot repair the official server.

The complete five-scenario report (three passed, two failed), native receipts and
reproduction files are retained in `.build/mailbox-investigation/native/`.
The stack excerpt is `.build/mailbox-investigation/game-delete-mail-exception.txt`.
Fixing the underlying deletion transaction requires a game-server correction;
the staged console changes improve isolation and diagnostics without bypassing it.
