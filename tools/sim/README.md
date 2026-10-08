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
- The coordinator's route planner (ALClient pathfinding, normally a worker thread) runs
  in-process: `host/coordinator.cjs` loads the same planner bundle with a stand-in
  `worker_threads`, and its messages cross at the current virtual instant. Planning takes
  no virtual time, routes match the live game, and runs stay deterministic. A scenario can
  set `"movement": "native"` to use the game's own pathfinding instead.

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
  deaths, read from the game server. `deaths` lists each death's minute, place and the
  monsters that were targeting the character.
- `timeline.jsonl`: one line per sample: what the coordinator reports for each character
  (map, position, HP, navigation state, event) and where the game server has them.
- `coordinator.log`: the coordinator's log, stamped with virtual time.
- `final-state.json`: the coordinator's full `/state` at the end of the run (combat logs,
  rare-hunt state, queues).

`SIM_PROGRESS_MS` sets how often (real ms) progress is printed to stderr.

`SIM_TRACE=<from>-<to>[,<from>-<to>...]` (virtual minutes) also writes `trace.jsonl`: every request body
CODE sends to the coordinator in that window, and the game server's view of each character
(map, position, movement, channels, conditions) at most every 250 ms. It only reads from
requests the run makes anyway, so a traced replay stays identical to the run it
investigates: replay a scenario with its seed and trace the window where something went
wrong. With `SIM_TRACE_RESPONSES=1` the trace also records the coordinator's reply to each
request in the window (large: full status replies).

## Scenarios

`scenarios/*.json`: `seed`, `threads` (one thread per character), `realm`, `minutes`,
`sampleSeconds`, `characters` (`name`, `type`, `level`, optional `over` merged into the
created character), and `steps` run at `atSeconds`: either a coordinator API call (`method`, `route`, `body`) or
`{ "action": "farm", "leader", "followers", "monster" }`, which does what the dashboard
does: formation, focus, then travel to the monster's farming area.
`{ "action": "hunt", "leader", "followers", "monster" }` starts a rare-monster hunt the
way the dashboard does (for the Phoenix, with its spawn regions in catalog order).

`track` lists monster types whose spawns and deaths the report records (`kills`: each
death's minute and its spawn-to-death time), and `expect` makes a scenario a test:
`{ "minKills": { "<type>": n }, "maxCycleMinutes": n, "maxDeaths": n, "maxErrors": n }`.
A run that misses an expectation lists it in `report.expect` and exits 1.

- `phoenix-farm.json`: three hours of Phoenix farming by a level-80 warrior and priest
  with mid-tier gear; fails on no kill, any death or any coordinator error.

## Pins and maintenance

`setup.mts` pins ChronAL (0.10.0) and the three game repositories it installs to exact
commits. The game commits are the ones that ChronAL release is tested with (its
`upstream.json`). No patches are needed: since 0.9.0 ChronAL itself exports its window
builder, lets `login` start a character's thread from this tool's own worker script, and
supports the current game's socket.io calls (MtlSnkAI/chronal#1, #2). Moving the pin
force-checks-out ChronAL and reinstalls its dependencies. The game moves quickly; when
ChronAL or the game is updated, move the pins together and re-run a scenario before
trusting results.

## Limits

- Speed is bound by the CPU of the CODE and coordinator. For two farming characters,
  single-threaded runs reach about 4x real time and threaded runs about 5-6x; the main
  thread (game server plus coordinator) is then the busiest. Idle characters run at about
  20x (single-threaded) to 35x (threaded).
- No dashboard, Steam runner or realm switching. ChronAL has no other players, and its own
  README notes that timing-exact numbers (deaths, damage taken, potions) can differ from live.
