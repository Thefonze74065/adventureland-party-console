# Upgrade estimate failure modes (#63, #73)

Written before the change. The buy-and-upgrade estimate simulates 3,000 runs, and
each run keeps upgrading until it reaches the target or 2,000,000 attempts. With
grade-0 chances, +9 takes about 37M rolls (0.7 s), +10 about 1.2 billion (27 s in
Node), and +11 to +13 hit the guard in every run.

1. **The Buy dialog freezes the tab at +10 or higher.** `upgradeEstimate` runs on
   render in `merchant-commerce-dialog.tsx` for every cart line with a target.
2. **A mistyped target freezes it too.** Typing a 9 in front of a 1 reads as +91,
   which the input clamps to +13: the worst case.
2a. **+13 is unreachable.** The game's chance table (`design/upgrades.js`) stops at
   +12, so a +13 target can never succeed. The input must cap at the item's highest
   level with a chance, and the coordinator must refuse a target past it.
3. **An inventory item at +10 to +12 freezes the tab without any Buy action.**
   `suggestedItemValue` estimates the item's own level for its merchant tooltip.
   The console fixture doesn't load the merchant catalog into the inventory view,
   so this is covered through the shared estimator rather than a tooltip journey.
4. **The coordinator blocks on a high-target buy order.** `POST
   /party-api/merchant/order` runs `estimateUpgrade` synchronously, so one request
   stalls every character's status and command delivery.
5. **Spending the whole budget before falling back.** A target that cannot finish
   must not first burn a second of simulation; the expected roll count decides
   up front.
6. **A cut-off run biases the simulation.** If the roll budget runs out anyway, the
   run in progress is dropped, not counted with partial attempts.
7. **Too few finished runs give a meaningless 90th percentile.** Below 30 finished
   runs the analytic estimate is used instead.
8. **An approximate budget is shown as if it were simulated.** The cart line must
   say it is approximate; Buy all stays available because the budget is real.
9. **The analytic budget undershoots.** It must not come in below the simulated
   90th percentile where both can be computed (+7 to +10). Measured: 1% to 8% above.
10. **Wrong grace term (#73).** Using the grade (0/1/2) instead of the server's
    igrace (+1/−1/−2) skews every estimate; both estimators must use igrace.
11. **The dashboard and coordinator disagree.** They must produce the same budget
    for the same item, quantity and target, so the order the dashboard shows is
    the one the coordinator queues.
12. **Repeated renders repeat the work.** Results stay cached per item, cost,
    grade, quantity and target.
13. **The worst case is unbounded.** +12 at any quantity must return quickly in the
    browser and in the coordinator.
