# Immutable console activation runtime

Startup freezes the newest completed artifact available at launch, imports that
host implementation, recovers interrupted deployment work, then deploys the frozen
selection through the normal controller. Builds completed later remain staged.
Validate `console startup` journeys in `console-build-host.spec.ts`: inspect actual
dashboard content and coordinator identities, completed and failed journals,
preserved account state, no-op startup, deferred builds on the next launch, host
module selection, corrupt-artifact rejection and readiness rollback. Owned fixture
processes stop before retained ledgers are attached and their workspaces removed.

Failure inventory before implementation: installed launchers can accidentally load
checkout bundles instead of the selected artifact; immutable code can accidentally
write configuration into the artifact; starting a process can be mistaken for API
readiness; CODE reload can disconnect native characters; unchanged components can
be restarted unnecessarily; cancellation can start another component; stale API or
character acknowledgements can falsely complete deployment; failed deployment can
restore a different artifact or leave the dashboard on candidate code.

The activation driver receives host-owned service operations and observable
acknowledgements. It never compiles, logs in characters, or mutates credentials.
Compare component hashes and change only the affected components. Require fresh
coordinator identity and expected active-character bundle acknowledgements. The
controller supplies its bounded cancellation signal to every host operation.
Rollback applies the prior immutable candidate and verifies the same observations.

Native validation must retain pre/post character connection identities alongside
CODE generation receipts, coordinator identity, dashboard hash and deployment
journal. Dashboard-only activation must leave coordinator and CODE identities
unchanged. Failure/cancellation must preserve settings and restore the prior
component identities. Successful process spawn alone is insufficient proof.

Native installation must ignore the managed root dependency junction while still
rejecting redirected executable files or directories. Verify installation from a
complete immutable artifact into the installed native runtime, then confirm live
coordinator identity and character CODE hashes.
