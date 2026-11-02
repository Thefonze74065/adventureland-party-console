# Bank sort swap journal: failure inventory

Written 2026-10-18. Live: FonzeMerch stood in the bank and every merchant job (auto upgrade,
compounds, NPC sales, exchanges) failed within a second with `Bank sort swap not confirmed; recovery
pending`, about every 6 s. Its persisted journal (`party-bank-sort-buffer:FonzeMerch`) held one pending
swap: Talking Skull +0 into inventory slot 11, leaving bank `items3` slot 34 empty. The skull was in
slot 11, so the swap had happened, but slot 34 now held a Candy deposited afterwards.
`settleBankSortSwap` (`characters/shared.js`) requires both sides to match exactly, so it could never
confirm. Journey: `e2e/live-bank-sort-journal.spec.ts`.

1. **Permanent block.** A completed swap whose freed bank cell was refilled before confirmation is
   never settled, and every merchant job fails behind it.
2. **Replayed or reversed swap.** Settling must not swap again or take the item that now occupies the
   bank cell.
3. **Lost buffer item.** The item moved into the inventory buffer slot must go back to the bank, as for
   a confirmed swap.
4. **Unrelated item disturbed.** The Candy in the refilled cell stays where it is.
5. **Unconfirmed swap accepted.** If the swap did not happen (the item is still in the bank cell and
   the buffer slot does not hold it), the journal must not count it as confirmed. Unchanged code path,
   not exercised by the journey.

Added 2026-10-22. The error still latched in other states: anything but the two exact expected states kept
the entry pending, and every merchant job threw behind it until the journal was cleared by hand.

6. **Freed cell emptied again.** A store into an empty cell whose item was withdrawn later (both sides
   empty) is never settled.
7. **Item moved elsewhere.** A retrieve whose item ended up in another inventory slot (buffer and cell
   both empty) is never settled. The bank and inventory as they are now must be taken as the truth.
8. **Journal from another floor.** Recovery on a different bank floor throws "floor changed" on every
   job instead of moving to the journaled floor.
9. **Swap that never lands mid-pass.** The pass fails and leaves the entry pending, so the next job
   fails too. It must clear the entry and let the next pass plan from the current bank.

Added 2026-11-02. On 10-31 the fork took upstream's `settleBankSortSwap`, which again keeps any entry it
cannot confirm and throws `Bank sort swap not confirmed; recovery pending`, so items 1, 6, 7 and 9 came
back. Live: FonzeMerch stopped doing any work, with the error every 6 s. Its journal held a store of Poison ×5
from inventory slot 10 into the empty bank cell `items7` 34. The bank snapshot showed that cell empty and no
Poison anywhere in the bank; the Poison was still in slot 10.

10. **Swap that never landed.** Both sides still hold what they held before the swap (the buffer item in
    the inventory slot, the cell unchanged). Nothing moved, so recovery must settle it without a warning
    and return the buffer item to the bank like any other journaled item.
11. **Other states hidden.** A state that is neither the swap's result nor its starting point must still
    settle, with a warning that shows the expected and found states for both sides.
