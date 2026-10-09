# Lucky-slot discovery

Source audit, 2026-09-22:

- [Server initialization](https://github.com/kaansoral/adventureland_mongodb/blob/main/node/server_functions.js) assigns `player.p.item_num` uniformly from inventory slots 0–41 when absent, and retains it in private character state.
- [Server upgrade handler and player serialization](https://github.com/kaansoral/adventureland_mongodb/blob/main/node/server.js) use that private property but do not include it in `player_to_client`, login payload additions, upgrade-chance previews, or upgrade success/failure responses. The `property` socket handler changes typing/AFK; it is not a private-property lookup.
- The linked [Crowns3bc tracker](https://github.com/Crowns3bc/AdventureLand/blob/main/Gui/Lucky%20Slot%20Tracker.js) observes progressively revealed `q_data.p.nums`, not a direct slot lookup. Its four digits are least-significant first.

No supported guaranteed discovery method was found in the inspected source. This
does not establish that every deployed server version has no information leak.
Every observed roll is possible in an ordinary slot, so even a displayed zero
cannot prove a lucky slot with certainty.

## Statistical model

For an ordinary upgrade scroll, the lucky slot applies the following modification
60% of the time, to a uniform roll `R`, with independent uniform `U`:

```
max(U / 10000, 0.975 * R - 0.012)
```

Otherwise the roll is unchanged. The server reveals `floor(roll * 10000)`.
The resulting bucket probabilities are:

| Observation | Ordinary slot | Lucky slot |
| --- | ---: | ---: |
| Displayed zero | 0.01% | 0.7486153846% |
| Displayed roll > 0.963 | 3.69% | 1.476% |
| Everything else | 96.3% | 97.7753846154% |

The high bucket begins at 0.9631 because the displayed roll has four digits.
The zero probability is `0.4 * 0.0001 + 0.6 * (0.0121 / 0.975)`.

Starting with equal prior weight for each of 42 slots, sum the bucket log-likelihood
ratios for each slot, then normalize their exponentials. Until a slot meets the
inference threshold, each already-scheduled upgrade tests the least-sampled slot,
with ties resolved by slot index. Testing starts at slot 0 and rotates through all
42 slots. Once inferred, select that slot and keep collecting evidence; if confidence
falls below the threshold, resume rotation. The gold inventory outline uses the
same selection function. Clicking it opens the full 42-slot statistics view.
Confidence is conditional on the published model, one fixed lucky slot, independent
rolls, and unbiased receipt collection. At least 100 observations in the leading
slot and 99.9% posterior are required for the UI's **statistically inferred** label.
It is never labeled verified or copied into the verified-slot configuration.
The search continues to update, including after inference. No additional items,
scrolls or upgrade jobs are purchased or queued for discovery.

## Persistence and operation

Discovery computes each position's ordinary probability as one minus its lucky
probability in the existing joint posterior. With at least 100 observations and
ordinary probability of 99.9% or higher, a position is ruled out and skipped when
choosing the least-sampled next candidate. Elimination is recalculated on every
decision: evidence weakening another candidate can immediately restore a position.
This per-position threshold is not a 99.9% bound for the entire remaining set.
The statistics dialog shows per-row Ruled out status and an X/42 count. Manual
locks and the one-roll unlock checkpoint retain precedence; observations continue
even when a manually selected position is statistically ruled out.

Each game client keeps a durable stream ID, slot counters and duplicate receipt
under an account-and-character local storage key. Coordinator settings retain
`luckySlotTracking[character][streamId]`. Cumulative stream reports are merged only
when counters advance; repeated heartbeats and stale reports do not add rolls.
Independent browser/headless streams are added, while the reporting client's
stream replaces its older snapshot in the combined view. This survives coordinator
restarts and character moves between clients. Unsent data also survives a CODE
reload if local storage is available.

Only `uscroll` operations contribute. Compounds, stat application, offering-only
operations, malformed packets and partial digit reveals do not contribute. Repeated
complete packets for the same operation are suppressed, including later success
or failure reveals and CODE reload replay. The published model is not applicable
to special test servers that force roll outcomes.

Verified configured slots take precedence. The old hardcoded GoldMajesty slot-7 default is removed during initialization because it was never verified. Candidate swaps use the same guarded
inventory journal, scroll/offering remapping and restoration as verified slots.
Unverified discovery never reserves an idle inventory hole. Genuine pending
operations or unresolved recovery still hold inventory work safely.
