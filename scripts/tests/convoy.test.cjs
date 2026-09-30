const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const convoyCode = source.slice(source.indexOf('  function prepareConvoyRoute('), source.indexOf('  var kiteState ='));
const cache = path.join(__dirname, '../../.caracal/game_files');
const versions = fs.readdirSync(cache).filter(x => /^\d+$/.test(x)).sort((a, b) => Number(a) - Number(b));
const runner = fs.readFileSync(path.join(cache, versions.at(-1), 'runner_functions.js'), 'utf8');
const nativeCode = runner.slice(runner.indexOf('var smart = {'), runner.indexOf('function proxy('));
const settle = () => new Promise(resolve => setImmediate(resolve));
const command = { id: 2, convoyId: 'test', epoch: 7, phase: 'prepare',
  rally: { map: 'main', x: 0, y: 0 }, location: { map: 'main', x: 120, y: 0 }, slowestSpeed: 57 };

test('explicit cancellation restores cruise before ownership is cleared, only once', () => {
  const r = runtime();
  const old = r.context.convoyTraveling = { id: 'cancelled' };
  r.context.setConvoyCruise(old,57); r.calls.length=0;
  r.context.releaseConvoyCruise(old);
  r.context.releaseConvoyCruise(old);
  r.context.convoyTraveling = null;
  r.context.releaseConvoyCruise(old);
  assert.deepEqual(r.calls.filter(call => call[0] === 'cruise'), [['cruise', 500]]);
});

test('stale cleanup cannot unthrottle the replacement convoy', () => {
  const r = runtime();
  const old = { id: 'old' };
  r.context.convoyTraveling = { id: 'new' };
  r.context.releaseConvoyCruise(old);
  assert.equal(r.calls.some(call => call[0] === 'cruise'), false);
});

test('cancelling assembled convoy restores unrestricted cruise', async () => {
  const r = runtime();
  const promise = r.context.coordinatedMonsterTravel({ ...command, id: 1, phase: 'assemble' });
  await settle();
  await r.cancel(); await promise;
  assert.deepEqual(r.calls.filter(call => call[0] === 'cruise'), [['cruise', 57], ['cruise', 500]]);
});

test('assembly handoff preserves cap even when its cleanup runs before preparation', async () => {
  const r = runtime();
  const promise = r.context.coordinatedMonsterTravel({ ...command, id: 1, phase: 'assemble' });
  await settle();
  r.context.convoyTraveling.cruiseHandoff = true;
  await r.cancel(); await promise;
  assert.deepEqual(r.calls.filter(call => call[0] === 'cruise'), [['cruise', 57]]);
});
const {runtime}=require('./helpers/native-convoy-runtime.cjs');

function schedule(r, at = 4000) {
  r.context.convoySignal = { ...r.context.convoySignal, phase: 'scheduled', departAt: at, validUntil: at+3000 };
  r.tick();
}

test('a stale arrival response after party regroup does not report another movement failure',async()=>{
 const r=runtime();const original=r.context.request;
 r.context.request=async(url,opts)=>{if(url==='/convoy-complete')throw Error('POST /convoy-complete · HTTP 409 · http: stale convoy completion');return original(url,opts);};
 const {promise}=await r.start();await r.ready();schedule(r);r.setNow(3950);
 for(let i=0;i<100;i++){r.tick();await settle();if(r.context.convoyTraveling?.phase==='arrived')break;}
 await settle();assert.equal(r.context.convoyTraveling.phase,'arrived');
 assert.equal(r.calls.some(c=>c[1]==='/convoy-failed'),false);
 await r.cancel();await promise;
});
test('anniversary planning yields immediately to defense and late route ticks cannot restart movement',async()=>{
 const r=runtime();let attacked=false;r.context.departureCombatPending=()=>attacked;
 vm.runInContext(source.slice(source.indexOf('  function interruptConvoyForDefense('),source.indexOf('  function groupedFarming(')),r.context);
 const {promise}=await r.start({...command,purpose:'anniversary-return',navigationExempt:true});
 r.tick();attacked=true;r.tick();await settle();await promise;
 assert.equal(r.context.convoyTraveling,null);assert.equal(r.context.__partyConvoyDefense,'test');
 const count=r.moves().length;for(let i=0;i<4;i++)r.tick();assert.equal(r.moves().length,count);
 assert.equal(r.calls.some(c=>c[1]==='/convoy-complete'),false);
});
test('stationary phase handoff never emits a stop move before synchronized departure', async () => {
  const r = runtime({ nativeMovingFlag: true });
  const assembly = await r.start({ ...command, id: 1, phase: 'assemble' });
  assert.equal(r.context.convoyTraveling.phase, 'assembled');
  r.context.convoyTraveling.cruiseHandoff = true;
  await r.cancel(); await assembly.promise;
  const { promise } = await r.start();
  await r.ready();
  assert.equal(r.context.character.moving, false);
  assert.equal(r.moves().length, 0);
  schedule(r);
  r.setNow(3949); r.tick();
  assert.equal(r.moves().length, 0);
  r.setNow(3950); r.tick();
  assert.ok(r.moves().length > 0);
  await r.cancel(); await promise;
});

test('hunt return planning compares native routes without emitting movement or Town',async()=>{
  const r=runtime({slow:false});r.context.character.x=120;
  r.context.convoySignal.phase='plan-return';
  const {promise}=await r.start({...command,phase:'plan-return',purpose:'monster-hunt',location:{map:'main',x:0,y:0}});
  const before=r.moves().length;
  for(let i=0;i<200 && r.context.convoyTraveling.phase!=='return-route-ready';i++){r.tick();await settle();}
  assert.equal(r.context.convoyTraveling.phase,'return-route-ready');
  assert.equal(r.moves().length,before);assert.equal(r.calls.some(x=>x[0]==='use'),false);
  assert.deepEqual(JSON.parse(JSON.stringify(r.context.convoyTraveling.returnPlan)),[{type:'walk',location:{map:'main',x:0,y:0}}]);
  await r.cancel();await promise;
});
test('return itinerary separates map transitions and Town shortcuts',async()=>{
  const r=runtime();let index=0;
  r.context.prepareConvoyRoute=async(c)=>{c.plannedPlot=index++===0?
    [{map:'main',x:10000,y:0},{map:'main',x:120,y:0}]:
    [{map:'cave',x:100,y:0},{map:'main',x:900,y:0,transport:true},{map:'main',x:0,y:0,town:true},{map:'main',x:120,y:0}];};
  r.context.character.map='cave';
  const legs=await r.context.planHuntReturn({},command,()=>true,()=>{});
  assert.deepEqual(JSON.parse(JSON.stringify(legs)),[
    {type:'walk',location:{map:'main',x:900,y:0}},
    {type:'town',location:{map:'main',x:0,y:0}},
    {type:'walk',location:{map:'main',x:120,y:0}}]);
});
test('failed Town fallback searches only walking routes',async()=>{
  const r=runtime();const flags=[];
  r.context.prepareConvoyRoute=async(c,cmd)=>{flags.push(cmd.allowTown);c.plannedPlot=[{map:'main',x:120,y:0}];};
  const legs=await r.context.planHuntReturn({}, {...command,disableTown:true},()=>true,()=>{});
  assert.deepEqual(flags,[false]);assert.equal(legs.some(l=>l.type==='town'),false);
});
test('Town succeeds near spawn without requiring 90 units of displacement',async()=>{
  const r=runtime();r.context.character.x=10;
  r.context.can_use=()=>true;r.context.is_on_cooldown=()=>false;
  r.context.town=async()=>{r.context.character.x=0;return {success:true};};
  const {promise}=await r.start({...command,phase:'town'});
  assert.equal(r.context.convoyTraveling.phase,'towned');
  await r.cancel();await promise;
});

test('assembly holds ownership and caps speed without awaiting cruise acknowledgement', async () => {
  const r = runtime(); const {promise} = await r.start({...command, phase: 'assemble'});
  assert.equal(r.context.convoyTraveling.phase, 'assembled');
  assert.deepEqual(r.calls.filter(x=>x[0]==='cruise'), [['cruise',57]]);
  assert.equal(r.searches, 0); await r.cancel(); await promise;
});

test('native multi-tick search prepares without movement; same plot walks at offset departure', async () => {
  const r = runtime(); let restores = 0;
  r.context.partyPorcupineEquipment = {depart() { restores++; return new Promise(() => {}); }};
  const {promise} = await r.start(); const stops = r.moves().length;
  r.tick(); assert.equal(r.context.convoyTraveling.routeReady, undefined);
  await r.ready(); assert.equal(r.moves().length, stops);
  const plot = r.context.movement.state.plot, saved = JSON.stringify(plot);
  schedule(r); for(let i=0;i<10;i++) r.tick();
  assert.equal(JSON.stringify(plot), saved); assert.equal(r.searches,1);
  r.setNow(3949); r.tick(); assert.equal(r.moves().length, stops);
  assert.equal(restores, 0);
  r.setNow(3950); r.tick(); assert.equal(r.context.movement.state.plot, plot);
  assert.equal(r.context.convoyTraveling.departedAt,4000);
  for(let i=0;i<80 && r.context.movement.state.moving;i++) { r.tick(); await settle(); }
  await promise;
  assert.equal(r.searches,1); assert.equal(r.context.convoyTraveling,null);
  assert.equal(r.calls.filter(x=>x[1]==='/convoy-complete').length,1);
  assert.equal(r.context.character.x,120);
  assert.equal(restores, 1);
});

test('native route handoff restores cruise and relinquishes movement without false arrival', async () => {
  const r = runtime();
  r.context.farmingTravelTarget = () => ({ id: 'm', mtype: 'goo', x: 100, y: 0 });
  r.context.request = async (url, options) => { r.calls.push(['request', url, options]); return { ok: true }; };
  const { promise } = await r.start(); await r.ready();
  assert.equal(r.calls.some(x => x[1] === '/convoy-engage'), false, 'no combat during preparation');
  schedule(r); r.setNow(3950); r.tick(); r.tick(); await settle(); await promise;
  assert.equal(r.context.convoyTraveling, null);
  assert.equal(r.context.movement.state.moving, false);
  assert.equal(r.context.combatTargetId, 'm');
  assert.equal(r.context.movement.gate.owner, null);
  assert.equal(r.calls.filter(x => x[1] === '/convoy-engage').length, 1);
  assert.equal(r.calls.filter(x => x[1] === '/convoy-complete' || x[1] === '/convoy-failed').length, 0);
  assert.deepEqual(r.calls.filter(x => x[0] === 'cruise').at(-1), ['cruise', 500]);
});

test('a visible monster around a bend cannot interrupt the obstacle-aware route', async () => {
  const r = runtime();
  r.context.farmingTravelTarget = () => ({ id: 'ghost', mtype: 'ghost', x: 100, y: 80 });
  r.context.is_in_range = () => false;
  const { promise } = await r.start(); await r.ready();
  // The route itself is valid, but there is no direct segment from the current
  // side of the bend to the monster's attack position.
  r.context.can_move_to = (_x, y) => y === 0;
  schedule(r); r.setNow(3950);
  for (let i = 0; i < 20 && r.context.movement.state.moving; i++) { r.tick(); await settle(); }
  await promise;
  assert.equal(r.calls.some(x => x[1] === '/convoy-engage'), false);
  assert.equal(r.calls.filter(x => x[1] === '/convoy-complete').length, 1);
  assert.equal(r.context.character.x, 120);
});

for(const [name, mutate] of [
  ['position drift', r=>{r.context.character.x=10;}],
  ['speed drift', r=>{r.context.character.speed=80;}],
  ['route replacement', r=>{r.context.movement.state.plot=[];}],
  ['route invalidation', r=>{r.context.movement.state.found=false;}],
  ['stale runtime signal', r=>{r.context.convoySignal.runtimeId='other';}],
  ['expired coordinator signal', r=>{r.setNow(6000);}],
  ['dead character', r=>{r.context.character.rip=true;}],
  ['late departure', r=>{r.context.convoySignal.departAt=1000;r.context.convoySignal.phase='scheduled';}],
]) test(name+' holds the character without acknowledging arrival', async () => {
  const r=runtime(); const {promise}=await r.start(); await r.ready(); mutate(r); r.tick(); await settle();
  assert.equal(r.context.convoyTraveling.phase,'failed'); assert.equal(r.context.movement.state.moving,false);
  assert.equal(r.calls.filter(x=>x[1]==='/convoy-complete').length,0);
  assert.equal(r.calls.filter(x=>x[1]==='/convoy-failed').length,1);
  await r.cancel(); await promise;
});

test('native route search failure remains held until cancellation', async () => {
  const r=runtime({noPath:true}); const {promise}=await r.start();
  for(let i=0;i<4;i++){r.tick();await settle();}
  assert.equal(r.context.convoyTraveling.phase,'failed');
  assert.equal(r.context.movement.state.moving,false); await r.cancel(); await promise;
});

test('cancelled preparation cannot release a route and wrapper is reused for ordinary navigation', async () => {
  const r=runtime(); const {promise}=await r.start(); await r.ready();
  const wrapper=r.context.smart_move_logic; await r.cancel(); await promise;
  r.tick(); assert.equal(r.context.movement.state.moving,false);
  const ordinary=r.context.smart_move(command.location);
  for(let i=0;i<200 && r.context.movement.state.moving;i++){r.tick(); await settle();}
  await ordinary; assert.equal(r.context.character.x,120); assert.equal(r.context.smart_move_logic,wrapper);
  assert.equal(r.timers.length,1);
});

test('old assembly cleanup cannot reset the preparation owner or its speed', async () => {
  const r=runtime(); const a=await r.start({...command,id:1,phase:'assemble'});
  const old=r.context.convoyTraveling; old.cancelled=true;
  const b=await r.start(); old.release(); await a.promise;
  assert.equal(r.context.convoyTraveling.commandId,2);
  assert.equal(r.calls.some(x=>x[0]==='cruise' && x[1]===500),false);
  await r.cancel(); await b.promise;
});

test('a connected member cannot search forever', async () => {
  const r=runtime(); const {promise}=await r.start(); r.tick();
  r.setNow(61000); r.context.convoySignal.validUntil=65000; r.tick(); await settle();
  assert.match(r.context.convoyTraveling.failure,/timed out/);
  await r.cancel(); await promise;
});

test('a suspended runner cannot depart far behind the convoy', async () => {
  const r=runtime(); const {promise}=await r.start(); await r.ready(); schedule(r);
  r.setNow(5501); r.tick(); await settle();
  assert.match(r.context.convoyTraveling.failure,/Missed convoy departure/);
  await r.cancel(); await promise;
});

test('unsupported scheduler fails before starting a route', async () => {
  const r=runtime(); r.context.smart_move_logic=()=>{};
  const {promise}=await r.start();
  assert.match(r.context.convoyTraveling.failure,/scheduler was replaced/);
  assert.equal(r.searches,0); await r.cancel(); await promise;
});

test('native town waypoints wait for release', async () => {
  const r=runtime({slow:false}); r.context.character.x=100;
  r.context.movement.state.use_town=true;
  const {promise}=await r.start({...command,location:{map:'main',x:0,y:0}});
  await r.ready(); assert.ok(r.context.movement.state.plot.some(p=>p.town));
  assert.equal(r.calls.filter(x=>x[0]==='use').length,0);
  schedule(r); r.setNow(3950);
  for(let i=0;i<80 && r.context.movement.state.moving;i++){r.tick();await settle();}
  await promise; assert.equal(r.calls.filter(x=>x[0]==='use').length,1); assert.equal(r.searches,1);
});

test('hunt departure never adds individual Town shortcuts to prepared routes', async () => {
  const r=runtime({slow:false});r.context.character.x=100;r.context.movement.state.use_town=true;
  const {promise}=await r.start({...command,purpose:'monster-hunt',location:{map:'main',x:0,y:0}});
  await r.ready();assert.equal(r.context.movement.state.plot.some(p=>p.town),false);
  assert.equal(r.context.movement.state.use_town,false,'hunt journey has an explicit walking-only policy');
  schedule(r);r.setNow(3950);
  for(let i=0;i<30 && r.context.movement.state.moving;i++){r.tick();await settle();}
  await promise;assert.equal(r.calls.filter(x=>x[0]==='use').length,0);
});

for(const mode of ['delayed','unavailable','interrupted']) test('Town barrier requires a real teleport: '+mode,async()=>{
  const r=runtime();let now=1000,casts=0;
  r.context.character.x=300;
  r.context.can_use=()=>mode!=='unavailable' && now>=1300;
  r.context.is_on_cooldown=()=>false;r.context.is_transporting=()=>false;
  r.context.setTimeout=fn=>{now+=100;r.setNow(now);fn();};
  r.context.use_skill=async()=>{casts++;if(mode==='delayed')r.context.character.x=0;};
  const {promise}=await r.start({...command,phase:'town'});
  await settle();
  assert.equal(casts,mode==='unavailable'?0:1);
  assert.equal(r.context.convoyTraveling.phase,mode==='delayed'?'towned':'failed');
  await r.cancel();await promise;
});


test('Franky exit resolves at the Mainland boundary without walking the remaining route', async () => {
  const r = runtime({slow:false});
  r.context.character.map = 'cave';
  r.context.navigationIntent.cancelled = true;
  r.context.G.maps.cave.doors = [[0,0,0,0,'main',0,0]];
  const {promise} = await r.start({...command, purpose:'franky-exit', navigationExempt:true, combatHandoffAllowed:false});
  await r.ready();
  schedule(r); r.setNow(3950);
  for(let i=0;i<80 && r.context.movement.state.moving;i++) { r.tick(); await settle(); }
  await promise;
  assert.equal(r.context.character.map,'main');
  assert.equal(r.context.character.x,0);
  assert.equal(r.context.movement.state.moving,false);
  assert.equal(r.context.movement.state.searching,false);
  assert.equal(r.context.partyLocation,null);
  assert.equal(r.calls.filter(x=>x[1]==='/convoy-complete').length,1);
});


test('same convoy phase and epoch changes retain one cruise cap; changed speed sends one update',async()=>{
 const r=runtime();const a=await r.start({...command,id:1,phase:'assemble'});
 const old=r.context.convoyTraveling;old.cruiseHandoff=true;await r.cancel();await a.promise;
 const b=await r.start({...command,epoch:8});
 assert.deepEqual(r.calls.filter(x=>x[0]==='cruise'),[['cruise',57]]);
 const current=r.context.convoyTraveling;r.context.setConvoyCruise(current,60);r.context.setConvoyCruise(current,60);
 r.context.releaseConvoyCruise(old);
 assert.deepEqual(r.calls.filter(x=>x[0]==='cruise'),[['cruise',57],['cruise',60]]);
 await r.cancel();await b.promise;
 assert.deepEqual(r.calls.filter(x=>x[0]==='cruise'),[['cruise',57],['cruise',60],['cruise',500]]);
});
test('legacy terminal hold without a reason reports convoy identity and missing context',async()=>{
 const r=runtime();const {promise}=await r.start({...command,phase:'hold'});
 assert.match(r.context.convoyTraveling.failure,/missing-failure-context.*test.*epoch 7.*main/);
 assert.equal(r.calls.some(x=>String(x[1]).includes('Convoy held; request a fresh convoy')),false);
 await r.cancel();await promise;
});


test('convoy diagnostics exclude movement evidence from preceding commands',()=>{
 const r=runtime();r.context.movement.report=()=>({id:'current',owner:{commandId:8}});
 r.context.movement.last=()=>({id:'old',failureContext:{commandId:7}});
 assert.equal(r.context.convoyMovementEvidence({commandId:9}),null);
 assert.equal(r.context.convoyMovementEvidence({commandId:8}).id,'current');
 assert.equal(r.context.convoyMovementEvidence({commandId:7}).id,'old');
});
