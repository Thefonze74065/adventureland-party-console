# Automatic bank routing failure inventory

Recorded before implementation:

- Enabled Auto NPC stock cannot create a retrieval job when ordinary withdrawals
  and party collection are disabled; its sale must own that prerequisite.
- A merchant's own active bank job prevents discovery of newly reported sale stock.
- Repeated heartbeats must not duplicate bank slot reservations or jobs.
- Disabled sales, locked stock, keep quantities and craft reservations must survive.
- Default exchange reward routing never saves the shared Auto bank preference.
- A restarted coordinator loses that preference, or later rewards stay carried.
- Explicit reward processing/sale rules must not be overwritten by default banking.

Extend native bank-sale and exchange reward journeys for independent retrieval,
durable marks and restart. Retained isolated checks select the exact current-job
and checkpoint boundaries deterministically; they supplement native verification.
