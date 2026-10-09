# Real-client failure analysis (before implementation)

- Authentication can select a public realm or reuse a user's account. Only loopback origins and the disposable server's account manifest are accepted; browser requests to other hosts are blocked.
- A loaded page is not a connected character. Require the native socket, character name, and native CODE runner, then require a successful maintained-runtime status report.
- A synthetic heartbeat can pass while movement/combat never executes. Do not create status reports or replace game functions. Record incoming native socket events and actual character snapshots; scenario assertions must observe server state as well.
- Cached CODE can run an older generation. Serve the current build manifest and loader and record its digest in artifacts.
- Independent browser windows compete for the production bridge lease. Launch companions through production Steam login and upstream native character iframes; wait for actual handoff completion.
- Background browser throttling can starve three character clients. Launch Chromium with background timer throttling disabled.
- Stale account state or surviving clients can contaminate the next scenario. Close the owned native group/context, reset the disposable account before each scenario, and use a fresh coordinator journal.
- Runner startup/reload can detach an iframe. Resolve the current native runner for each action and wait for its current successful report.
- Network failures, server errors, and browser errors can otherwise be lost. Persist native socket events, client errors, final character state, coordinator journal, and server observations even on failure.

## Native combat handoff fixture boundaries

The first handoff repeat failed before collection because `/bank-party` with no group is ambiguous when the independent priest is online. Select the real fighter group explicitly (`group: E2EWarrior`), preserving the same cargo recipient. The held-cost case failed before handoff because native CODE `character.cc` is a non-configurable proxy getter. Its pinned runner getter reads `parent.character.cc`; declare the observation fault at that native client data property, keep real socket cost updates through a setter, verify the runner sees 150, and restore its original descriptor/latest observed value in `finally`. Native server accounting, attacks, item sends, partial receipts, retained marks, and retry conservation remain unchanged. Always remove the owned receipt route and restore the fault on failures.
