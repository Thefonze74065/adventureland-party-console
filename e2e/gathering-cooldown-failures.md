# Merchant gathering cooldowns: failure inventory

Written before implementation. Reported live: fishing and mining never produced
anything. The game server resolves a finished channel with a 10% (fishing) or 20%
(mining) roll, and only a success calls `consume_skill(..., true)`, which starts the
48-minute or 124-minute reuse cooldown. A miss costs 120 MP and nothing else. The
merchant set the full reuse cooldown after every attempt, so each miss waited 48 or
124 minutes before the next cast: about one fish per 8 hours and one ore per 10.

1. **Miss treated as success.** After a miss, the next cast must follow as soon as the
   merchant can cast again (MP, position, merchant jobs), not after the reuse cooldown.
2. **Success treated as miss.** After a success, the merchant must not cast again
   until the game's own cooldown (`next_skill[mode]`) has passed.
3. **Cooldown from the wrong source.** The cooldown recorded after a success
   (`gatheringCooldowns[mode]`) comes from the game's `next_skill`, not an assumed
   reuse period; an unreported server cooldown falls back to the reuse period.
4. **Tight loop.** Repeated misses must not spin without a cast in between: each
   retry is a real cast, paced by the channel, settling and MP.
5. **Lost catch.** A success adds the item to the merchant's inventory.
6. **Mode interleaving.** A miss in one mode does not stall the other mode's
   cooldown or block it while that mode is available.
7. **Restart.** A recorded success cooldown survives a coordinator restart; a miss
   leaves no cooldown to restore.

8. **Fixture reset races a genuine status reply.** A response captured before a
   live reset can restore the login cooldown after the server and coordinator
   reset. Seed native availability before login and observe server, client and
   coordinator agreement without clearing live cooldowns. The reproduction holds
   one genuine status response across the old reset: zero of five rolls occur;
   no native skill, receipt or cooldown is fabricated.
