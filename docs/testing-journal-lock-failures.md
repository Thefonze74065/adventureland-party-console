# Journal lock recovery failure modes (#62)

Recorded before implementation. Process lifecycle integration tests use real
writers and abrupt process termination; isolated Linux identity parsing tests are
necessary on Windows, where `/proc` and Linux PID reuse are unavailable.

- A competing live writer must retain its lock and unchanged journal.
- A dead writer's lock must permit recovery without losing saved records.
- A reused live PID with a different Linux process start token is stale.
- A different Linux boot invalidates an old token even if its PID/start repeats.
- A foreign PID namespace on the same boot cannot prove an owner dead.
- Legacy live-PID locks and malformed/partial new locks must fail conservatively.
- Unavailable process identity data cannot justify deleting a live owner's lock.
- Process names containing spaces or parentheses must not shift stat field 22.
- Container recreation changes namespaces: an OS advisory guard must establish
  exclusive ownership before retiring metadata from a previous container.
- The guard inode must survive close; unlinking it could admit concurrent writers.
