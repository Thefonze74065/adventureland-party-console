# Realm-hop blacklist: failure inventory

Written before the change. A saved party list of realm keys that automatic realm
hopping (boss chase and daily-event chase) must never pick. PVP realms stay
excluded regardless of the list. Manual realm switching is unaffected.

1. **One chase ignores the list.** Boss chase picks bosses and respawn trips
   through `realmExists`; daily chase picks from `realms()`. Both must reject a
   blacklisted realm, including a boss chase respawn trip planned earlier.
2. **A trip stays on a realm that is then blacklisted.** A chase's move is the
   realm switch itself, so there is no in-flight leg to cancel. A trip whose realm
   becomes blacklisted ends on the next check and the party returns home.
3. **The return home is blocked.** The home realm is explicit, not a hop choice;
   a blacklisted home realm still receives the return.
4. **Lost or corrupted list.** The list persists through coordinator restart and
   settings snapshots. Unknown keys, non-strings and duplicates are rejected by
   the route, and a malformed saved value loads as an empty list.
5. **Unreadable control.** The dashboard lists every known realm with its player
   count; PVP rows show as always excluded and cannot be toggled. Toggling a row
   saves immediately and survives a page reload.
6. **Manual switching blocked.** The explicit Change realm action still reaches a
   blacklisted realm.
