# Gapped bank sorting: failure inventory

Written before implementation. The packed sort lays every item on a floor out in
one continuous sorted run, so one new item type near the front shifts nearly all
later items (about 90 swaps for the live merchant's 95 items over 329 slots). The
opt-in gapped layout (`bankSortLayout: "gapped"`) starts each category on a new
row, leaves free slots, keeps items that are already in order, and places new
items into a free slot between their sorted neighbours.

1. **The setting doesn't stick.** The toggle must persist across a coordinator
   restart and be importable from a dashboard export. An unknown value must be
   rejected, and a missing value means `packed`.
2. **Packed users change behavior.** With the toggle off, the sort result and the
   operations used must be exactly today's packed layout.
3. **Unsorted result.** With gaps on, reading the slots in pack order must still
   give non-decreasing `compareBankItems` order. Every category must start on a
   row (7 slots) no other category uses.
4. **Not cheaper.** After a gapped sort, adding one item type that sorts near the
   front must move at most a few items on the next visit, instead of nearly all.
5. **Items lost or stranded.** Every item and quantity present before a sort must
   be in the bank afterwards. Nothing may remain in the merchant's inventory, and
   the existing buffer journal must keep working.
6. **Doesn't fit.** When the categories can't each get their own rows (a full
   bank), fall back to the packed layout instead of failing or looping.
7. **Endless re-sorting.** An already valid gapped layout must cost zero moves,
   so a visit with no changes does nothing.
8. **Switching layouts.** Turning the toggle on re-lays the bank once with gaps.
   Turning it off packs it again once.
9. **Odd packs.** `items1` has 35 usable slots, and packs on other floors are
   sorted per floor. Rows never span two packs.

## Result

Live journey (`live-bank-sort-gaps.spec.ts`): 40 item types over 8 categories,
seeded in reverse order. After the first gapped sort every item was banked with
35 gaps between categories. A helmet, which sorts before every seeded category,
was then added. On the next visit it was first (`items0` slot 0, alone on its
row), and 11 slots changed. A visit with no change moved nothing. Switching back
to packed gave the same sequence with no gaps, and nothing was left in the
merchant's inventory. The setting survived a coordinator restart.

On a copy of the live merchant's bank (98 items, 329 slots), the planner changes
2–8 slots for a new type inside an existing category (packed: 19–48), 15 for a
new category that sorts first (packed: 82), and 228 for 15 new types added one
visit at a time (packed: 1,058). Switching an existing packed bank to gaps
re-lays it once (148).
