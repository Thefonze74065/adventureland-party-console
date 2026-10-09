const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {installPartyMovement}=require('../../../runtime/characters/movement.ts');
const source = fs.readFileSync(path.join(__dirname, '../../../characters/shared.js'), 'utf8');
const convoyCode = source.slice(source.indexOf('  function convoySignalExpired('), source.indexOf('  var kiteState ='));
const cache = path.join(__dirname, '../../../.caracal/game_files');
const versions = fs.readdirSync(cache).filter(x => /^\d+$/.test(x)).sort((a, b) => Number(a) - Number(b));
const runner = fs.readFileSync(path.join(cache, versions.at(-1), 'runner_functions.js'), 'utf8');
const nativeCode = runner.slice(runner.indexOf('var smart = {'), runner.indexOf('function proxy('));
const settle = () => new Promise(resolve => setImmediate(resolve));
const command = { id: 2, convoyId: 'test', epoch: 7, phase: 'prepare',
  rally: { map: 'main', x: 0, y: 0 }, location: { map: 'main', x: 120, y: 0 }, slowestSpeed: 57 };

function runtime(options = {}) {
  let now = 1000;
  const calls = [], timers = [], deferred = [];
  const character = { name: 'F', map: 'main', x: 0, y: 0, speed: 57, moving: false, base: {} };
  Object.defineProperties(character, { real_x: { get: () => character.x }, real_y: { get: () => character.y } });
  const context = vm.createContext({
    code_settings: {}, // Native runner defaults live before the extracted smart-move functions.
    game: { graphics: false },
    setTimeout, clearTimeout, encodeURIComponent, Promise, Math, Number, String, Error, Date: class extends Date { static now() { return now; } },
    character, runtimeGeneration: 1, runtimeCurrent: () => true, convoyRuntimeId: 'runtime-1',
    navigationIntent: { revision: 0, cancelled: false }, convoyTraveling: null, reunionRealm: () => 'USI',
    convoySignal: { id: 'test', epoch: 7, commandId: 2, runtimeId: 'runtime-1', phase: 'prepare', validUntil: 5000 },
    anniversaryWithTimeout: promise => promise, farmingEntryPoint: x => x, partyLocation: null, followingLeader: true, coordinatorClockOffset: 50, eventRecoveryState: {},
    setInterval: fn => { timers.push(fn); },
    console: { log() {} }, game_log: (...args) => calls.push(['log', ...args]),
    cruise: speed => { calls.push(['cruise', speed]); return new Promise(() => {}); },
    request: async (url, options) => {calls.push(['request', url, options]); return {ok:true,ready:true};},
    is_string: x => typeof x === 'string', is_number: x => typeof x === 'number',
    is_in: () => false, abs: Math.abs, shuffle: x => x,
    mssince: () => options.slow === false ? 0 : 41,
    can_move: p => !options.noPath && p.y === 0 && p.going_y === 0 && p.going_x >= 0 && p.going_x <= 150,
    can_move_to: () => true, can_walk: () => true, can_use: () => true, is_transporting: () => false,
    simple_distance: (a,b) => Math.hypot(a.x-b.x, a.y-b.y),
    is_door_close: () => true, can_use_door: () => true,
    move: async (x,y) => { calls.push(['move', x, y]); character.x = x; character.y = y;
      if (options.nativeMovingFlag) character.moving = true; },
    use: action => { calls.push(['use', action]); character.x = 0; character.y = 0; },
    push_deferred: () => new Promise((resolve, reject) => deferred.push({ resolve, reject })),
    resolve_deferreds: (key, value) => { for (const p of deferred.splice(0)) p.resolve(value); },
    reject_deferreds: (key, value) => { for (const p of deferred.splice(0)) p.reject(value); },
    resolving_promise: x => Promise.resolve(x), rejecting_promise: x => Promise.reject(x),
    G: { maps: { main: { spawns: [[0,0]], doors: [], npcs: [] }, cave: { spawns: [[0,0]], doors: [], npcs: [] } },
      events: {}, monsters: {}, npcs: { transporter: { places: {} } } },
    parent: { is_hidden: () => false, phrase: value => value, d_text() {}, push_deferred() {},
      socket: { emit: (event, data) => { calls.push([event, data]); if (event === 'transport') { character.map = data.to; character.x = 0; character.y = 0; } } } },
  });
  context.root = context;
  context.departureCombatPending=()=>false;
  context.eligibleDepartureChests=()=>[];
  vm.runInContext(nativeCode, context);
  let searchStarts = 0;
  const start = context.start_pathfinding;
  context.start_pathfinding = () => { searchStarts++; return start(); };
  let ticks=0;
  context.character.items=[];context.G.version=16846;
  context.movement=installPartyMovement(context,{
    now:()=>now+ticks*80,
    context:()=>({runtime:'fixture',revision:context.navigationIntent.revision,current:true,paused:false}),
    request:async(url,request)=>{if(url==='/movement-plan') {
      if(options.plan)return options.plan(request.body);
      throw Error('Path not found: native fixture');
    }return context.request(url,request);},
    diagnostic:(e,m)=>calls.push(['diagnostic',e,m]),
  });
  vm.runInContext(require('./named-function.cjs').namedFunction(source,'convoyDiagnosticClock'), context);
  vm.runInContext(convoyCode.replace(/\bsmart\./g,'movement.state.'), context);
  return { context, calls, timers, setNow: x => { now = x; }, get searches() { return searchStarts; },
    tick: () => {ticks++;timers[0]();}, moves: () => calls.filter(x => x[0] === 'move'),
    async start(cmd = command) { const promise = context.coordinatedMonsterTravel(cmd); await settle(); return { promise }; },
    async ready() { for (let i=0; i<200 && !context.convoyTraveling.routeReady; i++) { timers[0](); await settle(); }
      assert.equal(context.convoyTraveling.routeReady, true); },
    async cancel() { const c = context.convoyTraveling; if (!c) return; c.cancelled = true; if(c.release) c.release(); await context.stop('smart'); await settle(); },
  };
}
module.exports={runtime,settle,command};
