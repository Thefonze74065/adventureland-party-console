# Visible event bosses behind native terrain

Failure inventory recorded before implementation: visible boss outside attack range across a wall releases event walking; same-map visibility suppresses later route acquisition; a peer seeing the boss is omitted from formation despite blocked local combat; stale or absent reachability evidence incorrectly grants ownership; ranged reachable combat is forced to march unnecessarily. Retain the existing route and retry budgets until native direct attack range or collision-safe local approach is confirmed. Never change terrain or manufacture damage/movement.

Native E2E starts on Halloween (-200,460), declares a stationary native Pumpkin (-534,763), verifies real collision prevents direct combat approach, then requires maintained movement around terrain and an actual native hit. Always retain geometry, positions, native hit events, and final coordinator state, including failure cases.
