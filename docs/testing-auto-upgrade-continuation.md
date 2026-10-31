# Automatic upgrade interruption recovery

An automatic rule is keyed by starting item and level, for example
`broom@+0` with seven tiers. Each admitted pass must preserve that original
identity and absolute +7 target through every roll. A surviving +2 broom no
longer matches the +0 admission rule; its saved pass is therefore essential.

Read-only live inspection on October 23, 2026 at 10:38 EDT found GoldMajesty's
`broom@+0` rule set to `{tiers:7,quantity:-1}`, two carried +2 brooms, three
carried +7 brooms, and no saved broom passes. Inventory slots changed between
observations, consistent with ongoing inventory movement. This confirms the
stranded intermediate state, but does not identify which historical interruption
first deleted each pass. Compact evidence is saved in
`.build/upgrade-investigation/live-brooms.json`; no live settings were changed.

## Verified failure paths

- `upgrade-marks.ts` tested relocation by replacing `slot`, while `markedEntry`
  preferred the old `liveSlot`. No candidate could match after that live slot
  became empty. Reconciliation then deleted the pass. Both console regression
  cases reproduced empty upgrade lists before the fix.
- Relocation included already completed copies among candidates. A +2 survivor
  alongside an existing +7 copy could appear ambiguous even without stale slots.
  Relocation now considers only unfinished survivors and reserves actual live slots.
- Multiple displaced matching survivors also caused deletion. An admitted pass
  now remains durable when inventory is missing, reserved or ambiguous. Rule
  removal, explicit cancellation and changed target/quota still revoke eligibility.
- Admission of a later roll copied the command's stale live position over the
  saved checkpoint. Admission now records that roll's actual input slot/item.
  Offering waits also synchronize both position fields.
- The client skipped missing inputs, then reported the command's upgrade marks
  resolved. A missing admitted automatic survivor now fails visibly and preserves
  intent under the existing inventory recovery block instead of declaring success.

## Interruptions and intentional waits

The native loop continues toward the original target and retries a failed roll
when the item survives. Confirmed destruction ends the pass. CODE replacement,
disconnects, coordinator restart, travel interruption and BankBoi offering
handoffs must retain that pass. Prepared/running/completed production journals
reconcile individual rolls before new production; unknown outcomes cannot safely
be treated as destruction or replayed.

Insufficient gold, unavailable required offerings, disabled automation, explicit
rule changes, ownership conflicts and genuinely ambiguous inventory can still
pause work. The existing recovery signature wakes an ambiguity block when
relevant inventory or upgrade intent changes. Two indistinguishable survivors
cannot identify one historical pass safely; preserve the pass and diagnostic
rather than silently abandoning it or consuming an unrelated copy.

Previously deleted intent cannot be reconstructed from item level alone. A +0
rule must not silently authorize every preexisting upgraded copy. This patch
prevents further loss; it does not fabricate old native outcomes or mutate live
inventory/settings.

## Repeatable validation

```powershell
npm run typecheck
npm test -- -- --project=console --grep "interrupted automatic upgrade relocation"
npm test -- -- --project=live --grep "interrupted automatic broom"
npm run test:e2e:verify
```

Console scenarios exercise real coordinator HTTP ingestion, reconciliation,
production admission, persistence and restart using declared external game
observations. The native scenario declares historical interrupted intent and
initial inventory only, then uses ChronAL virtual time, native scroll consumption
and upgrades. It requires +7 or destruction, preserves an existing +7 broom,
waits separately for queue removal and telemetry, and checks persistence after
restart. Retain `interrupted-broom-relocation`,
`ambiguous-broom-intent-retained`, and
`native-interrupted-broom-terminal-outcome` attachments. Owned fixture workspaces
are removed after evidence copying.

Stage a completed immutable console candidate. Character and coordinator changes
need an explicitly requested console load; building or testing does not activate it.

## Recorded validation, October 23, 2026

Typecheck passed. Both coordinator regressions failed with empty saved pass lists
before the patch and passed afterward. The final combined console/ChronAL run
passed all three selected scenarios; `npm run test:e2e:verify` verified 67 evidence
files. Native receipts show +3, +4, +5 and +6 successes, followed by destruction
on the +7 attempt. The preexisting +7 broom survived and no pass remained after
restart. All three final scenario workspaces have verified removal receipts.

Adjacent native automatic offering cases (ordinary, restart during handoff,
restart after delivery) and displaced manual recovery also passed. Their original
five-scenario report retains one fixture-setup failure: the first broom scenario
omitted enabling auto-upgrade, which the fixture defaults off. The corrected,
passing scenario explicitly enables it. That earlier report and intact evidence
are retained under `.build/upgrade-investigation/native-initial/`; final evidence
is in `.build/e2e-report/` and `.build/e2e-results/`.

The completed final console candidate is
`f0cec840d1a2af424171b2ca6f2c2045037a083a3efc51cb19f9036990745781`.
Its verified source fingerprint matches the final implementation and test code.
No deployment or live rule/inventory mutation was performed by this investigation.
