# Adventureland Party Console distribution

The public home is https://github.com/ryan-haines/adventureland-party-console.
Gitea remains the private development repository. Public releases have their own
history, starting at 1.0.0, with one reviewed Conventional Commit per promotion.

Production dashboards use the same Vinext Node server on Windows and Linux,
including Docker and Raspberry Pi. Wrangler is not required at production
startup. Release checks start the dashboard and fetch its HTML and JavaScript
assets; a successful image build alone is not considered a startup check.

## Linking Steam and browsers on your LAN

Open HTTP `/setup` after connecting the account. Two questions select the connection steps:

| Game computer | Same computer as console | Different computer |
| --- | --- | --- |
| Windows Steam | Localhost HTTP | HTTPS |
| Windows Chrome/Edge/Firefox | Localhost HTTP | HTTPS |
| Native Linux Steam (WebKitGTK) | HTTPS | HTTPS |
| Linux Chrome/Chromium/Firefox | Localhost HTTP | HTTPS |

Other browsers can select **Use HTTPS instead**. Fully headless users can skip linking.
The initial account setup remains available over HTTP; that initial submission is not encrypted.

Caddy is bundled and supervised by the same launcher, including inside Docker.
Default ports are HTTP 3010 and HTTPS 3443. In Compose, `AL_PORT` and
`AL_HTTPS_PORT` select published ports; `AL_HTTP_PUBLIC_PORT` and
`AL_HTTPS_PUBLIC_PORT` communicate those mappings to setup. Native launchers use
`AL_PORT` and `AL_HTTPS_PORT` directly. Allow these ports on your private network;
no public domain, router port forwarding, or public certificate service is needed.

Setup prepares HTTPS for the reachable address and provides a one-time trust helper
to run on the **game computer**. Windows installs the public CA for the current user.
Native Linux supports Debian/Ubuntu, Fedora-family, and Arch-family system trust;
existing NSS databases can also be updated when `certutil` is installed. Firefox
and sandboxed clients may require manual certificate import. Flatpak, Snap, Proton,
and other distributions are guided fallbacks, not automatically configured clients.
Restart the game client/browser after installing trust. Setup separately checks
the HTTPS page and the actual game connection; neither a build nor a successful
browser check establishes Steam compatibility.

The installation's unique CA and private keys live in `AL_DATA_DIR/tls` (Docker:
`/data/tls`), outside replaceable releases. Keep the data volume when rebuilding or
updating. Caddy renews server certificates automatically. Never publish or share
this directory; only the downloadable public certificate belongs on game computers.
Use `-Remove` with the Windows helper or `--remove` with the Linux helper to remove
that installation's trust. Visiting setup does not install trust automatically.

Prefer a router DHCP reservation. If the address changes, use setup's advanced
address correction and regenerate the loader; the existing CA remains trusted.
An HTTPS port conflict leaves HTTP setup accessible with an error. For source
installations missing Caddy, run `node tools/hosting/install-caddy.mts` and restart.

Automated validation covers Windows-hosted Caddy, gateway authorization, and
Linux Docker HTTPS smoke checks. Actual Steam/WebKitGTK and individual browser
trust combinations still require device validation; do not infer them from a server test.

## Windows: editable, without global tools

Download the Windows x64 ZIP from GitHub Releases, extract it to a writable folder,
and double-click `Start.cmd`. First startup downloads a checksum-verified private
Node runtime from nodejs.org. There is no Git installation or manual npm step.
Open http://localhost:3010 and connect your game account through setup.

The application source is in `app`, or the directory named by `active.json` after
an update. `Develop.cmd` prepares the development dependencies and watches character
source changes. Stop the console before rebuilding coordinator/dashboard code.
Production dashboard rebuilds must use `AL_DASHBOARD_OUT_DIR=.build/container`.
Source modifications block managed installation until reconciled; downloading a
release never overwrites your edits. Keep custom work in your own branch or copy.

Settings, credentials, game caches, and logs live in `data`, outside application
versions. Keep that folder private. The launch scripts and private runtime stay
outside replaceable versions; a release requiring a new updater protocol requires
a manual installer upgrade. Do not run two installations for the same characters.

## Docker

The source-development helper `./scripts/start-docker.sh` combines
`compose.yaml` with `compose.dev.yaml` for source development. It mounts the
checkout, runs Node dashboard HMR and the verified character watcher, and keeps
dependencies/caracAL/build caches in separate volumes. The helper rebuilds and
recreates the service for coordinator or dependency changes. It preserves the
same `party-data` volume, including HTTPS trust. Development checkouts use manual
source updates, not package installation. Plain `docker compose up -d --build`
selects a locally built production image instead; it still has no managed updater.

Download `compose.yaml` from GitHub Releases and run `docker compose up -d`.
The image supports Linux AMD64 and ARM64. The `party-data` volume survives updates.
The updater companion has Docker socket access and can replace the console
container; it exposes no host port. Only its authenticated, fixed release actions
are available to the application. Users managing containers externally can omit
the companion and AL_UPDATER_URL; the dashboard then provides notifications only.

The managed Compose file rotates stdout/stderr logs for both services with Docker's
`json-file` driver, retaining three files of up to 10 MB each. Managed console
updates preserve that logging configuration. Existing installations must adopt
the updated Compose file and recreate their services to apply these limits.

For an existing source-build Compose installation, keep its project name and
existing volume when adopting the release Compose file. Do not silently accept a
new project name, which would create an empty volume. Back up the old volume first.
Custom source mounts and edited application containers require manual updates.

## Update behavior

A green ! beside Party Console announces a newer compatible stable release. Click
it to reach the bottom of settings. Download and install stages the update;
Restart now pauses work and applies it. Characters that cannot safely acknowledge
within 60 seconds defer installation. The dashboard reconnects after restart.

Automatic updates default off. When enabled they download during a running
session and wait for Restart now; on startup they install before characters start.
Checks run at startup and every six hours. Failed network checks leave the current
version usable. Drafts and prereleases are never offered.

Before switching, the updater snapshots persistent settings and credentials while
services are stopped. Candidate startup holds character launch until the dashboard
health check passes. Failed pre-launch validation restores the previous code and
snapshot. Once characters resume, state is not rolled back: game transactions may
already have happened. Backups are private files under `data/updates/backups`.

## Promoting private development

Commit the selected work on Gitea first. Run:

```sh
node tools/release/promote.mts <commit> "feat: describe the user-visible release"
```

This stages an independent public checkout in `.build/public-release` and prints
its diff. Review it, then commit and push from that checkout. The optional `--push`
does those final steps for an already reviewed promotion. Never mirror-push the
private repository: that would expose private branches/history and overwrite tags.
Future promotions update the same public history and preserve GitHub release tags.

Use `fix:` for patch releases, `feat:` for minor releases, and `feat!:` with a
`BREAKING CHANGE:` explanation for major releases. Ordinary documentation/chore
commits do not publish. GitHub Actions validates, determines the next version,
builds Windows and multi-architecture Docker artifacts, then semantic-release
publishes their checksummed manifest and release notes. No npm package is published.

The workflow uses the repository GITHUB_TOKEN with contents/packages write access.
Make the GHCR package public for anonymous pulls and permit the workflow to push
release tags. A fresh public repository does not include the private Gitea history.
Release workflows require a supported Node version independently of the developer
runtime. Stable source releases contain no sessions, downloaded live game caches,
local state, or secrets; game fixtures retain the notices in THIRD_PARTY_NOTICES.md.
