# Changelog

## Unreleased

Changes queued for the next release. The release workflow determines its version
from the commits merged into `main`.

### Fixed

- Invisible rogue recipients reveal themselves for merchant servicing, then resume
  their normal invisibility behavior. ([#10](https://github.com/Ryan-Haines/adventureland-party-console/pull/10))

- Enabled passive targets with “keep moving” off now interrupt outbound travel
  for coordinated combat, including neutral Phoenix sightings and targets already
  admitted as passing attacks. Explicit stop rules override Hunt travel exceptions.

- Outbound Hunts share one attack target while moving. Additional aggro pauses the
  party for coordinated defense and kiting, then resumes travel to the original
  Hunt destination after the encounter and loot are resolved.
- Hunt automatically restarts its cycle when a participant exhausts retreat routes,
  preserving blacklists and logging the failed character, location, and reason.
- ALClient routes now accept a reachable final waypoint within the requested arrival
  tolerance when the exact endpoint is blocked, matching native routing behavior.
  ([#16](https://github.com/Ryan-Haines/adventureland-party-console/issues/16))
- Monster Hunt convoys pause safely during communication outages and resume after
  stable party reports without consuming movement retries. Arrival acknowledgements
  retry transient failures, and saved completion receipts tolerate lost responses
  and coordinator restarts.
- Warriors skip emergency Stomp when no compatible basher is equipped, preventing
  repeated wrong-weapon errors while allowing their normal routine to continue.
- Keep-moving combat shares encounter ownership before attacking, preventing
  retaliation from repeatedly stopping convoys and releasing obsolete defensive holds.
- Marked merchant deliveries now schedule their own visits by default. Merchant
  settings can disable delivery-only trips while retaining deliveries for other
  visits and explicit sends. ([#15](https://github.com/Ryan-Haines/adventureland-party-console/issues/15))
- Removed unused dashboard notices; previously silent validation and action failures
  now use contextual error feedback. ([#14](https://github.com/Ryan-Haines/adventureland-party-console/issues/14))

- Entirely headless rosters can switch realms without a connected Steam character,
  including switches that set a new home realm. Steam connectivity is still required
  when a Steam-hosted character participates; existing readiness checks remain in
  place. ([#13](https://github.com/Ryan-Haines/adventureland-party-console/issues/13))
- Re-engaging CODE after a console logout recovers the Steam session instead of
  replaying the previous logout or character navigation.
- Monster Hunt lifecycle follows current party membership.
- Convoys recover from departure and walking stalls without repeating retry loops.
- Shared-route geometry mismatches get one bounded reload attempt while preserving
  Hunt membership; stale farming and anniversary checkpoints can recover.
- Monster Hunt preserves travel to its origin and recovers missed Daisy arrival
  acknowledgements.
- Merchant collection reservations and routine cancellation recover correctly.

### Changed

- Merchants can independently select supported events, fight with their equipped
  weapon, and resume merchant work after returning. Ordinary merchant jobs,
  gathering, and stand work yield while event participation owns the merchant.
  ([#12](https://github.com/Ryan-Haines/adventureland-party-console/pull/12))

- Reduced dashboard status traffic and isolated position updates from character
  cards while preserving live controls and inventory updates. ([#17](https://github.com/Ryan-Haines/adventureland-party-console/issues/17))
- Reworked the lucky slot mechanism.
- Anniversary participation no longer automatically crafts Sixfold Cakes; complete
  slice sets remain available through the normal exchange menu.
