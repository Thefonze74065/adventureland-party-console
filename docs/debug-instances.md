# Debug instances

Open **Settings**, scroll below the development-checkout notice, and choose
**Start debug instance**. The spinner and status explain startup progress. The
first launch builds the game and browser-enabled console images and can take
several minutes. **Open debug console** appears when the party is connected.

The second console has its own dynamically assigned port, private access link,
database, settings and three native game clients: warrior, priest and merchant.
It uses the existing god loadout (+100 weapon/armor, high vitality and mana),
starts near Dorr, and follows with the priest. Merchant automations and unrelated
events start disabled. Upstream's native `Dev && !Prod` Cave admission permits
unlimited entries without consuming daily reservations. Use the normal Cave
controls in the debug console. No production login or saved data is copied.

**Open game client** in the debug console shows the actual running browser in a
separate tab. You can interact with the game there; it does not create a second
login. The characters are labeled **Debug browser**, rather than Steam. Closing
the viewer leaves the game running. Its private display traffic uses the same
authenticated console port; VNC and game/admin ports are not exposed directly.

Map previews include Dorr's cosmetic layers and the native Cave entrance's
atlas pieces, flames and stars. Debug map images come from its local game server.

**Stop running** works during startup or while running. It cancels startup and
removes this instance's containers, database and console volumes, network and
image tags. Shared Docker download/build caches remain reusable; no debug account
or runtime state lives in them. A subsequent start creates a fresh party.
Closing a browser tab does not stop the instance. The parent remembers ownership
across restarts so the same Stop control can clean up an interrupted start.

## Windows and Linux

Install Docker Desktop (Linux containers) or Docker Engine and make the `docker`
command available to the Party Console process. The launching user must have
permission to access the engine. Native installations bind debug consoles to
loopback by default. Set `AL_DEBUG_BIND=0.0.0.0` before launching Party Console
if you access it from another device; the private debug link is still required.

Podman's `docker` CLI emulation also works: its `info` output doesn't carry
Docker's own `OSType` field, so the Linux-container check falls back to
Podman's own `host.os` instead of failing the Go-template lookup. Create
`/etc/containers/nodocker` to quiet Podman's own advisory line if its noise in
error output is unwanted; it's otherwise harmless.

## Party Console in Docker

The image includes the Docker CLI. Opt into engine access with:

```sh
docker compose -f compose.yaml -f compose.debug.yaml up -d --build
```

For a development container also include `-f compose.dev.yaml` before the debug
override. The override mounts `/var/run/docker.sock`; the bootstrap grants its
group to the unprivileged console user. This grants the trusted console access
to the host Docker engine. Rootless/custom installations can instead configure
their Docker endpoint and permissions. No Docker daemon runs inside Party
Console: debug containers are siblings, with streamed build contexts and named
volumes, so host/container source paths need not match.

Docker assigns the debug console a separate host port. When using a remote
console host, allow that port through its firewall. The link uses the same
hostname as the parent console; reverse proxies must allow direct access to
the allocated debug port. Game sockets, MongoDB and the game admin endpoint
are never published on the host. The debug console uses HTTP and a private
fragment link that is exchanged for an HttpOnly, instance-specific cookie.

## Validation

```sh
npm test -- -- --project=debug
npm run test:e2e:verify
```

The lifecycle E2E launches through Settings, observes native god-party startup,
enters/exits the actual Cave twice, reloads Settings, stops the stack, and checks
Docker resource inventories. It also checks duplicate starts, private access,
and startup cancellation. A second E2E launches from an unprivileged Linux
console container using the Docker socket without host source mounts, restarts
that parent, and tears down the recovered sibling instance.
The Settings journey also loads the actual fonts, opens the game viewer, checks
private and cross-origin access, and captures the expanded map near Dorr.
Screenshots, Cave observations and teardown
evidence are retained under `.build/e2e-results/` with a checksummed report in
`.build/e2e-report/`. Failure cases are documented before implementation in
`docs/debug-instance-failure-modes.md`.
