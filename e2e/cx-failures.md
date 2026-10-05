# CX jars and worn cosmetics: failure inventory

Written before the change. Native facts (pinned server): a `cxjar` item's `data`
names one cosmetic (a sprite in the cosmetics table `T`) or an emote skill.
`equip(slot)` on a jar adds `data` to the character's owned cosmetics
(`player.p.acx`, sent to the client as `character.acx`) and consumes the jar;
locked (`l`) or empty jars are refused. `equip_cx(slot, name)` wears an owned
cosmetic in its slot (`character.cx`; body types may go to `skin`), and
`equip_cx(slot)` without a name removes it.

1. **Jar contents misreported.** An empty jar, a jar naming an unknown cosmetic,
   and a locked jar must not show an Open action; a valid jar shows its cosmetic
   or emote and the slot it would be worn in.
2. **Opening the wrong item.** Inventory can shift between the dashboard click and
   the command. The character re-checks that the slot still holds a `cxjar` with
   the same contents and is not locked before opening it.
3. **Open reports success without the server.** Success means the jar left the
   bag and the cosmetic count in `acx` rose, observed on the server.
4. **Wearing something not owned, or in the wrong slot.** Wear is offered only
   for owned cosmetics, in the slot the cosmetics table assigns; emotes are shown
   as unlocked, never wearable. The server's worn state is the evidence.
5. **A cosmetic click disrupts play.** Cosmetic commands must not take over
   navigation (cancel a convoy, stop combat or travel). They run before the
   command takeover path, and the coordinator refuses them while the character
   still has another pending command instead of overwriting it.
6. **Stale display.** After opening, wearing or removing, the dashboard reflects
   the new native state from the next status report, not an optimistic guess.
