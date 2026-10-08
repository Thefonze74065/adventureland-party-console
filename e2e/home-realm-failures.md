# Home realm change failure modes (#52)

- One character's acknowledgement must not complete a multi-character home change.
- A character that stays on its old home must fail native confirmation even if another already matches.
- Duplicate or stale acknowledgements must not complete another character's work.
- Merchants must receive home commands too; the native endpoint supports every class.
- Mixed character homes must not be presented as a single confirmed account home.
- Offline characters require native logins or explicitly pending changes; local realm configuration does not change their game home.
- Native home changes have a 36-hour cooldown; partial success must remain visible.
# Native integration findings

- The upstream `set_home` success receipt updates the connected player immediately, but `servers_and_characters` reads a database snapshot that may lag periodic saves. Completion accepts the success receipt followed by a fresh home observation from the operation's destination realm; stale or cross-realm status cannot confirm it.
- Temporarily connected merchants can attract idle work before the home command arrives. Realm transitions reserve every account home target from merchant dispatch until completion or failure and cleanup.
- Offline coverage continues to verify the saved database home after temporary logout and preserves original roster slots.
