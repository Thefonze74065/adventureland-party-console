# Escape recovery respawn: failure inventory

Written before the change. Found in `tools/sim/scenarios/phoenix-farm.json`: a warrior
died while its low-HP escape was in the `recovering` stage, and `escapePulse` (a
100 ms interval) called `respawn()` on every tick while dead: 114 calls in one respawn
window, each answered "Can't respawn yet." The runner's death recovery was also
retrying, once a second.

1. **Call cost.** Respawn attempts from the escape pulse are at most one per second,
   like the runner's death recovery; the live server penalizes call bursts.
2. **Still revives.** The escape pulse keeps its own respawn (the runner refuses while a
   dungeon owns the character), so a dead escaping character is still revived as soon
   as the server allows: within a second of the respawn timer ending.
3. **Attempt state.** The throttle belongs to the escape attempt (`escapeLocal`), so a
   new escape starts without waiting.
