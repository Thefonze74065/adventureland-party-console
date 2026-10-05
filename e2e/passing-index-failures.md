# Passing-encounter index: failure inventory

Written before the change. `isPassingEncounter` (characters/shared.js) runs for every
visible monster on every combat tick (and from `isAttackingPartyMember`). It scanned
four lists, building a JSON identity per entry each time: the character's own deaths,
the coordinator's death tombstones (up to 512), peers' passing encounters and the
coordinator's passing encounters. A ChronAL profile of goo farming put about a third
of all CPU here. The change indexes each list once (identity -> latest `at`) and reuses
the index until that list changes. Results must be identical.

1. **Window semantics change.** "Some matching entry younger than 60 s" must equal
   "the latest matching entry is younger than 60 s" for every input, including several
   entries for one identity with different ages.
2. **Stale index.** A list replaced by a new array (a coordinator response, a filtered
   death list) or appended in place (a new death) must be re-indexed before the next
   lookup. Missing a fresh death would re-target a dead monster; missing an encounter
   would drop a passing attack.
3. **Identity defaults.** Entries without `server`, `map` or `in` take the character's
   current realm, map and instance. After a map, instance or realm change the index must
   not keep keys built with the old defaults.
4. **Bad timestamps.** Entries with a missing or NaN `at` never match (as before, an
   infinite one still does); they must not hide a valid entry for the same identity.
5. **Isolated harnesses.** Tests evaluate `isPassingEncounter` on its own, so the index
   must live inside it, with no new top-level helper or variable.
6. **No speedup.** Each lookup must cost the same however long the lists are, once a
   list is indexed.

Coordinator (runtime/combat/queue.ts), found by the same profile once the CODE side was
indexed: every reconcile checked each candidate, fight and claim against up to 512 death
tombstones, building a JSON identity per tombstone each time (`dead()` and the claim
filter).

7. **Tombstone lookup changes meaning.** The set of tombstone identities must be built
   from exactly the tombstones the reconcile keeps (deaths not in the future, latest per
   identity, last 512), so `dead()` and the claim filter return what the scans returned.
