# Long-session persistence failure modes (#59)

Recorded before implementation. Retained isolated persistence and journal tests are
needed to exercise thousands of historic receipts and precise write boundaries
without hours of native game operations. Native production recovery remains the
end-to-end activation gate.

- Pruning must preserve every unfinished journal and recent completion retries.
- Legacy completed receipts without timestamps must not keep the ledger growing.
- A coalesced settings save must capture the latest state and flush on shutdown.
- Production checkpoints must cancel delayed writes and save before responding.
- Object snapshots must load alongside legacy strings and cannot alias live state.
- Hunt message-only changes must not hide other durable Hunt changes.
