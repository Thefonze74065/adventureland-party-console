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
# Merchant class capacity during offline home visits

Native account-wide home confirmation with an offline second merchant failed
temporary login while the first merchant remained online, despite a free total
connection slot. Native admission allows one merchant at a time. Suspend a
managed active merchant while visiting offline merchants and restore its prior
enabled state/realm afterward. A Steam-only incumbent must cause an explicit
capacity error before attempting the visitor; preserve all Steam sessions.
Existing native account-home coverage includes the second offline merchant and
observes confirmed native homes plus restored active participants.

# Home setting is independent of route planning

The native `set_home` handler checks its cooldown and changes the current realm
preference without requiring a map, coordinate or NPC. Do not walk to Main as a
prerequisite: a planner outage otherwise fails a valid account-wide home change.
Retain native mutation receipts and fresh/account database confirmation. The E2E
rejects planning for the current home operation, requires no such dependency,
and checks exactly one native mutation receipt per active native participant.
