# Gitea regression CI

`.gitea/workflows/ci.yml` runs when a pull request is opened, reopened, or updated using the
existing `ubuntu-latest` runner and a `node:26.12.1-bookworm` job container.
Enable Actions in this repository's settings and ensure its runner scope includes
this repository. Pushes to a branch with an open pull request trigger its PR run;
there is no separate push run. Branches without an open PR do not run CI.

The job installs PowerShell from Microsoft's Debian repository, locked root and
dashboard dependencies, and the pinned, patched caracAL checkout using the normal
setup tool. It restores checksum-verified game versions 16846 and 17083 from
the repository. It needs network access to Gitea, the container registry, GitHub,
npm, and Microsoft's package repository; game credentials are not needed.

Validation runs `npm run test:ci` (including the normal pretest
typecheck and shared/runtime/game builds), the coordinator lint command from its
README, then `npm run build`. The job has a 30-minute timeout. It neither starts
the game nor publishes assets, deploys services, or creates releases.

Read output in the Gitea Actions job log. The test step also writes
`.build/ci/regression.tap` in the job workspace, then checks for a complete TAP
summary with all tests passing and zero failures, cancellations, skips, or TODOs.
The Bash pipeline uses `pipefail`, so logging cannot turn a failing test command
green. Logs remain visible in Gitea after the temporary job workspace is removed;
the local TAP file is not uploaded as a separate artifact.

For a fresh local checkout, install root/dashboard dependencies, run
`node tools/caracal/setup.mts`, install with `npm --prefix .caracal ci`, then run
`node scripts/ci/restore-game-fixtures.cjs` before testing. PowerShell 7 must be
available as `pwsh` on Linux or in its normal Program Files location on Windows.
Fixture restoration refuses to replace differing files in an existing cache.
See [fixture maintenance](../scripts/tests/fixtures/game/README.md).
