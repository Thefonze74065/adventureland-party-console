# Login admission failure modes (#48)

Recorded before implementation. Retained roster route tests connect the actual
coordinator ownership validator to route admission. This isolates ownership
policy from account credentials and native login timing; game login execution is
outside this policy regression.

- An online merchant doing production must not block an unrelated offline login.
- The added character's own inventory operation must still block admission.
- The global BankBoi transaction must continue blocking all new logins.
- Rejected admission must not reserve a slot or start a worker.
- Existing assignment, handoff and simultaneous-spawn guards must remain intact.
