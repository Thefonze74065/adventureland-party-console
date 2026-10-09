# Bank sales and merchant realm ownership

Declared before implementation for issues #28, #69, #70 and #74.

- Bank NPC rules never produce withdrawals; a disabled rule still removes stock;
  overlapping stand rules, locked items or craft-reserved stacks are sold.
- A stale snapshot queues duplicate withdrawals; batches above ten fill bags;
  restart forgets pending work; rules changed during travel cause stale sales.
- Explicit Visit bank queues duplicate trips or fails to refresh the snapshot.
- Generic worker expiry cancels a realm transition before its own deadline.
- Reconnect replaces the requested destination with native home; coordinator
  restart forgets the request; stale status clears ownership before arrival.
- Global switches lose priority; ordinary login inherits an old destination.
- Home retries loop forever, block unrelated jobs, or cannot be manually reset.
- A slow native connection is killed after fifteen seconds although its arrival
  window is still open; status older than three seconds falsely confirms arrival.
- Missing reports stop the retry clock; restart resets the pending-return clock
  and forgets the already consumed three-attempt budget.
- Anniversary reserves an unavailable target, or availability changes release an
  active visit or the featured merchant's first-minute hold.

Native evidence must include bank/inventory/gold, real transfer/sale receipts,
worker generations and reported realms, queued job phases and bounded retry logs.
Console evidence must show Visit bank and its resulting request/queue state.

The third-attempt restart scenario restores a declared pending realm request with
three attempts and an elapsed sixty-second deadline, then verifies exhaustion,
preserved bank work, explicit Retry and a real managed bank visit. The transition
timeout scenario restores an interrupted switching phase and holds only actual
merchant status HTTP traffic. Neither scenario invents a successful game receipt.
Legacy NPC/stand conflicts are restored as input because normal editor commands
correctly remove conflicting rules; selection and all sale outcomes remain native.
