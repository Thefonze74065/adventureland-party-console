# Native two-realm fixture failures

Declared before extending the disposable stack for issues #69 and #74.

- US II is only a fabricated alias and never hosts a native game process.
- Both processes bind the same socket port or publish the same realm ID.
- Published host ports are unreachable from inside the game container, causing
  native cross-realm account confirmation to reject otherwise valid logins.
- Account discovery drops the second server or worker setup routes both realms
  to US I despite the requested realm.
- A phantom offline home request connects the merchant directly to US II and
  lets a transfer-only check pass without any realm transition. Both cross-realm
  collection cases must observe actual switching-phase admission at 100ms polls.
- Reset disconnects only US I, leaving US II characters/account bank leases live.
- An admin read silently queries the wrong process and invents missing cargo.
- A logout is followed by a spawn before the native ownership handoff completes.
- A native primary reconnect opens the current/home realm choice and the scenario
  never answers it, leaving companions offline; explicitly choose the observed
  current realm during the ordinary ownership handoff.
- Holding transition reports prevents unrelated participants from reporting.
- A transport fault survives a failed test or coordinator restart and contaminates
  another scenario; hold markers must live inside the disposable scenario directory.
- The timeout is renewed by stale reports instead of retaining its original admission
  timestamp; verify the native arrival separately and preserve the sixty-second deadline.
- An interrupted transition restored on startup is mistaken for an active phase,
  although restart recovery correctly requeues it.

Keep US I web/socket endpoints unchanged. Use a separate US II native process
with its own socket/admin endpoint and the same disposable account database.
Retain actual server IDs, worker connection assignments, native transfer receipts
and conserved account cargo; no synthetic realm-arrival success is permitted.
