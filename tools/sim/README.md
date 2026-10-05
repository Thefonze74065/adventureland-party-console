# Party console simulation (ChronAL)

Runs the party console's coordinator and every character's real CODE against the real
game server at faster than real time, for problems that need hours of play to show up:
long travel, slow state growth, and bugs that only appear after many fights. It is a
separate tool, not part of `npm test`: the live E2E suite remains the source of truth
for observable behavior.

## How it works

[ChronAL](https://github.com/MtlSnkAI/chronal) boots the game's own `server.js` and one
headless game client per character on a single virtual clock: `Date`, timers and
`Math.random` are virtual, and nothing sleeps. This tool adds the party console to that
clock:

- `host/coordinator.cjs` loads `.build/runtime/coordinator-application.cjs` into a vm
  context on the virtual clock (the repository's modules run there; Node built-ins and
  `node_modules` load normally). Express is captured at `listen()` instead of opening a
  port.
- `host/caracal.cjs` replaces the caracAL modules the coordinator loads (config, account,
  game files, logging, constants). A simulation never reads the user's `.caracal` install,
  its config or its session.
- Each run compiles CODE from the working tree into a staged generation
  (`tools/game/build.mts` without `--publish`) and gives the run its own copy of that
  manifest and its class artifacts. A run never reads or writes `characters/manifest.json`:
  the coordinator runs classes from that manifest, and publishing to it reloads any live
  characters.
- `host/character.cjs` stands in for the process the coordinator forks per character
  (caracAL's `CharacterThread`): same IPC, but it logs a ChronAL client in and runs the
  CODE through the repository's own runner host (`runtime/lifecycle/runner-host.ts`).
- `host/transport.cjs` carries CODE's `$.ajax` and `fetch` to the coordinator, with
  one-way latency on the virtual clock. The captured Express app is dispatched
  synchronously, so a request takes no virtual time inside the coordinator and long polls
  wait on virtual timers like any other.
- Threaded runs (`"threads": true`, the default for the long scenario) use ChronAL's
  lockstep threads: the game server and the coordinator stay on the main thread, and each
  character (game client and CODE) gets its own thread (`host/client-thread.cjs`). The
  caracAL IPC and CODE's HTTP cross threads as lockstep sockets (`host/threaded.cjs`).
  Single-threaded runs use `host/character-worker.cjs` on the main thread instead.

A run is deterministic for a given build, scenario and seed: rerunning it gives the same
timeline byte for byte. Threaded and single-threaded runs schedule cross-thread messages
differently, so they are each reproducible but differ slightly from each other.

## Use

```sh
npm run build:runtime          # the coordinator and CODE bundles the simulation runs
npm run sim:setup              # once: pinned ChronAL + game under .build/sim/chronal
npm run sim -- tools/sim/scenarios/farm-goo.json
```

Results go to `.build/sim-results/<scenario>-<time>/`:

- `report.json`: virtual minutes, real seconds, speed, coordinator log counts, HTTP
  requests by route and status, and per character the level, XP and gold gained and
  deaths, read from the game server.
- `timeline.jsonl`: one line per sample: what the coordinator reports for each character
  (map, position, HP, navigation state, event) and where the game server has them.
- `coordinator.log`: the coordinator's log, stamped with virtual time.

`SIM_PROGRESS_MS` sets how often (real ms) progress is printed to stderr.

## Scenarios

`scenarios/*.json`: `seed`, `threads` (one thread per character), `realm`, `minutes`,
`sampleSeconds`, `characters` (`name`, `type`, `level`, optional `over` merged into the
created character), and `steps` run at `atSeconds`: either a coordinator API call (`method`, `route`, `body`) or
`{ "action": "farm", "leader", "followers", "monster" }`, which does what the dashboard
does: formation, focus, then travel to the monster's farming area.

## Pins and maintenance

`setup.mts` pins ChronAL and the three game repositories it installs to exact commits, and
applies `patches/chronal.patch`: two fixes to ChronAL's fake socket.io server for the
pinned game (reported as MtlSnkAI/chronal#1), an export of its window builder, and a
`login` option to start a character's thread from this tool's own worker script. The game
moves quickly; when ChronAL or the game is updated, move the pins together and re-run a
scenario before trusting results.

## Limits

- Movement uses native pathfinding (`PARTY_MOVEMENT_MODE=native`): the coordinator's route
  planner runs in a worker thread, which cannot share the virtual clock.
- Speed is bound by the CPU of the CODE and coordinator. For two farming characters,
  single-threaded runs reach about 4x real time and threaded runs about 6x; the main
  thread (game server plus coordinator) is then the busiest. Idle characters run at about
  20x (single-threaded) to 35x (threaded).
- No dashboard, Steam runner or realm switching. ChronAL has no other players, and its own
  README notes that timing-exact numbers (deaths, damage taken, potions) can differ from live.
