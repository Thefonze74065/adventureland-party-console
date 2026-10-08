# Lucky evidence identity failure modes (#55)

Recorded before implementation. Retained journal/statistics isolation verifies
identity transitions without deleting a native account character: deletion would
destroy the seeded fixture. Native upgrade evidence remains the gameplay gate.

- Same-name recreation with a new account character ID must clear evidence,
  verified slots, locked positions and pending resume positions.
- Delayed reports from the deleted character must not restore retired evidence.
- Reconnecting the same ID must preserve cumulative statistics and settings.
- A renamed character with the same ID must retain its own data.
- First migration preserves unbound legacy coordinator data, with the documented
  limitation that recreation before the upgrade cannot be detected retroactively.
- Client storage must use the authoritative ID, never reuse a name-only stream.
