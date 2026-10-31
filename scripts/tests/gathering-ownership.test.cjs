const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../characters/shared.js'), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function fixture() {
 const cast=deferred(), logs=[], switches=[];
 const c=vm.createContext({root:{__merchantGatheringGeneration:1},gatheringMode:'fishing',gatheringModes:['fishing','mining'],
  gatheringSession:{mode:'fishing',tool:'rod'},gatheringActive:false,merchantIdleActive:false,busy:false,banking:false,
  anniversaryBusy:false,merchantAnniversaryWorkReserved:()=>false,merchantForceStand:false,
  gatheringRetryAt:0,upgrading:false,departurePending:false,gatheringCooldowns:{},
  character:{level:30,map:'main',x:0,y:0,slots:{},items:[],moving:false},G:{skills:{fishing:{reuse_cooldown:10000}}},
  freeInventorySlots:()=>10,gatheringDestination:()=>({map:'main',x:0,y:0}),syncGatheringCooldown:mode=>c.gatheringCooldowns[mode]||0,
  is_on_cooldown:()=>false,can_use:()=>true,hasGatheringAccess:()=>true,distance:()=>0,
  ensureGatheringTool:async()=>true,equipGatheringTool:async()=>{},settleBeforeGathering:async()=>{},
  gatheringInventoryTotals:()=>({}),use_skill:()=>cast.promise,reportGatheringResult:async()=>logs.push('result'),
  gatheringStatus:(...args)=>logs.push(args),game_log:()=>{},setGathering:mode=>switches.push(mode),
  reportMerchantCommand:(...args)=>logs.push(args),stop:async()=>cast.reject(new Error('interrupted'))});
 vm.runInContext(source.slice(source.indexOf('  function gatheringAttemptCurrent('),source.indexOf('  function setGathering(')),c);
 vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source,'gatheringOutcome'),c);
 return {c,cast,logs,switches};
}
async function casting(c) { for(let i=0;i<12 && c.root.__merchantGatheringAttempt?.phase!=='casting';i++) await Promise.resolve(); assert.equal(c.root.__merchantGatheringAttempt.phase,'casting'); }

test('both gathering modes approach precisely despite a nearby client access indicator',async()=>{
 for(const mode of ['fishing','mining']) {
  const {c,cast}=fixture(),moves=[];
  c.gatheringMode=mode;c.gatheringSession={mode,tool:mode==='fishing'?'rod':'pickaxe'};
  c.G.skills[mode]={reuse_cooldown:10000};
  const destination=mode==='fishing'?{map:'main',x:-1597,y:552}:{map:'tunnel',x:277,y:-96};
  Object.assign(c.character,mode==='fishing'?{map:'main',x:-1590,y:555}:{map:'tunnel',x:267,y:-96});
  c.gatheringDestination=()=>destination;
  c.distance=()=>0.5; // Native distance measures hitbox edges, not point coordinates.
  c.smart_move=async(p,callback,options)=>{moves.push(options);Object.assign(c.character,p);};
  const work=c.gatheringTick(1);await casting(c);
  assert.equal(moves.length,1);assert.equal(moves[0].arrivalTolerance,1);
  cast.resolve({found:false});await work;
 }
});

test('a short gathering arrival never casts and reports its actual position',async()=>{
 const {c}=fixture();let casts=0;
 Object.assign(c.character,{x:-1590,y:555});
 c.gatheringDestination=()=>({map:'main',x:-1597,y:552});
 c.distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);c.smart_move=async()=>{};
 c.use_skill=async()=>{casts++;};
 const reports=[];c.gatheringStatus=(...args)=>reports.push(args);
 await c.gatheringTick(1);assert.equal(casts,0);
 const failure=reports.find(r=>r[1]==='error');assert.equal(failure[2].position.x,-1590);
 assert.equal(failure[2].access,true);assert.ok(c.gatheringRetryAt>Date.now());
});

test('fishing and mining retain the broom across map travel and approach, equipping only after settling',async()=>{
 for(const mode of ['fishing','mining']) {
  const {c,cast}=fixture(),travel=deferred(),settled=deferred(),steps=[];
  const destination={map:mode==='fishing'?'main':'tunnel',x:280,y:100};
  c.gatheringMode=mode;c.gatheringSession={mode,tool:mode==='fishing'?'rod':'pickaxe'};
  c.G.skills[mode]={reuse_cooldown:10000};c.character.map='bank';c.character.slots.mainhand={name:'broom'};
  c.gatheringDestination=()=>destination;c.hasGatheringAccess=()=>false;c.distance=()=>100;
  c.smart_move=async target=>{
   assert.equal(c.character.slots.mainhand.name,'broom');steps.push(typeof target==='string'?'map':'approach');
   await travel.promise;c.character.map=destination.map;if(typeof target!=='string')Object.assign(c.character,target);
  };
  c.settleBeforeGathering=async()=>{steps.push('settle');assert.equal(c.character.slots.mainhand.name,'broom');await settled.promise;};
  c.equipGatheringTool=async()=>{steps.push('equip');c.character.slots.mainhand={name:c.gatheringSession.tool};};
  c.can_use=()=>{assert.equal(c.character.slots.mainhand.name,c.gatheringSession.tool);return true;};
  const work=c.gatheringTick(1);
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.deepEqual(steps,['map']);assert.equal(c.character.slots.mainhand.name,'broom');
  travel.resolve();for(let i=0;i<8;i++)await Promise.resolve();
  assert.deepEqual(steps,['map','approach','settle']);
  settled.resolve();await casting(c);assert.deepEqual(steps,['map','approach','settle','equip']);
  cast.resolve({found:false});await work;
 }
});

test('interrupted gathering travel never replaces the broom with a tool',async()=>{
 const {c}=fixture(),travel=deferred();let equips=0,casts=0;
 c.character.map='bank';c.character.slots.mainhand={name:'broom'};
 c.smart_move=()=>travel.promise;c.equipGatheringTool=async()=>{equips++;};c.use_skill=async()=>{casts++;};
 const work=c.gatheringTick(1);for(let i=0;i<8;i++)await Promise.resolve();
 c.root.__merchantGatheringAttempt.cancelled='manual travel';travel.resolve();await work;
 assert.equal(equips,0);assert.equal(casts,0);assert.equal(c.character.slots.mainhand.name,'broom');
});
test('active cast survives repeated mode selection and routine work, then switches after completion',async()=>{
 const {c,cast,switches,logs}=fixture(), work=c.gatheringTick(1);await casting(c);
 c.gatheringCooldowns.fishing=Date.now()+10000;c.selectGatheringMode();c.selectGatheringMode();
 assert.deepEqual(switches,[]);
 for(const type of ['merchant-service','merchant-idle','merchant-stand-sync']) assert.equal(await c.gatheringCommandHandoff({type,id:7}),false);
 assert.equal(await c.gatheringCommandHandoff({type:'merchant-gather'}),true);
 cast.resolve({found:false});await work;
 assert.deepEqual(switches,['mining']);assert.equal(logs.filter(x=>x==='result').length,1);
 assert.equal(c.root.__merchantGatheringAttempt,null);
 assert.ok(c.root.__merchantLogisticsHoldUntil>Date.now());
});
test('explicit movement cancels a cast and waits for release without inventing cooldown',async()=>{
 const {c}=fixture(), work=c.gatheringTick(1);await casting(c);
 assert.equal(await c.gatheringCommandHandoff({type:'force-travel'}),true);await work;
 assert.equal(c.gatheringActive,false);assert.equal(c.root.__merchantGatheringAttempt,null);
 assert.equal(c.gatheringCooldowns.fishing,undefined);
});
test('cancellation during equipment or settling prevents the skill from starting',async()=>{
 for(const phase of ['equipGatheringTool','settleBeforeGathering']) {
  const {c}=fixture(), gate=deferred();let casts=0;c[phase]=()=>gate.promise;c.use_skill=async()=>{casts++;};
  const work=c.gatheringTick(1);await Promise.resolve();await Promise.resolve();
  c.root.__merchantGatheringAttempt.cancelled='command travel';gate.resolve();await work;
  assert.equal(casts,0);
 }
});
test('old runtime completion cannot overwrite a newer attempt or retry timer',async()=>{
 const {c,cast}=fixture(), work=c.gatheringTick(1);await casting(c);
 const replacement={id:'new'};c.root.__merchantGatheringGeneration=2;c.root.__merchantGatheringAttempt=replacement;
 c.gatheringRetryAt=123;cast.reject(new Error('interrupted'));await work;
 assert.equal(c.root.__merchantGatheringAttempt,replacement);assert.equal(c.gatheringRetryAt,123);
});
test('movement rejection reconciles server cooldown and releases ownership',async()=>{
 const {c,cast,logs}=fixture(), work=c.gatheringTick(1);await casting(c);
 c.syncGatheringCooldown=()=>Date.now()+20000;cast.reject({reason:'moving'});await work;
 assert.ok(c.gatheringSession.cooldownUntil>Date.now());assert.equal(c.root.__merchantGatheringAttempt,null);
 assert.ok(logs.some(x=>Array.isArray(x)&&x[0].includes('during casting: movement')));
});
test('disabling gathering interrupts only the active attempt',async()=>{
 const {c,switches}=fixture(), work=c.gatheringTick(1);await casting(c);
 c.gatheringModes=[];c.selectGatheringMode();await work;
 assert.deepEqual(switches,[null]);assert.equal(c.root.__merchantGatheringAttempt,null);
});
test('coordinator cast reservation requires a fresh casting observation',()=>{
 const {gatheringCastActive}=require('../../runtime/coordinator/merchant/gathering.ts');
 assert.equal(gatheringCastActive({seenAt:20000,gatheringPhase:'casting'},25000),true);
 assert.equal(gatheringCastActive({seenAt:10000,gatheringPhase:'casting'},25000),false);
 assert.equal(gatheringCastActive({seenAt:20000,gatheringPhase:'travelling'},25000),false);
 assert.equal(gatheringCastActive({seenAt:20000},25000),false);
});

test('gathering rejected during status wakes after the status lock is released',async()=>{
 const {c,cast}=fixture(), callbacks=[];
 c.character.ctype='merchant';c.runtimeCurrent=()=>true;c.setTimeout=fn=>callbacks.push(fn);
 c.busy=true;await c.gatheringTick(1);
 assert.equal(c.root.__merchantGatheringBlockedReason,'status update');
 assert.equal(c.root.__merchantGatheringAttempt,undefined);
 c.busy=false;c.wakeGatheringAfterStatus();assert.equal(callbacks.length,1);
 callbacks.shift()();await casting(c);cast.resolve({found:false});
 await c.root.__merchantGatheringAttempt.done;
 assert.equal(c.root.__merchantGatheringAttempt,null);
});

test('post-status wake respects a newly accepted job and an obsolete runtime',async()=>{
 for(const obsolete of [false,true]) {
  const {c}=fixture(), callbacks=[];c.character.ctype='merchant';
  c.runtimeCurrent=()=>!obsolete;c.setTimeout=fn=>callbacks.push(fn);
  c.wakeGatheringAfterStatus();c.root.__merchantActiveJob={jobId:'new'};
  callbacks.shift()();await Promise.resolve();assert.equal(c.root.__merchantGatheringAttempt,undefined);
 }
});

function handoffFixture() {
 const moves=[], c=vm.createContext({
  root:{},anniversaryBusy:false,character:{ctype:'merchant',stand:false},merchantForceStand:false,
  anniversaryPlan:{handoffTargets:[{name:'bankboi0',ctype:'merchant',seenAt:Date.now(),server:'USII',map:'main',x:168,y:-134}]},
  gatheringActive:false,banking:false,upgrading:false,parent:{server_region:'US',server_identifier:'II'},
  runtimeCurrent:()=>true,smart_move:async p=>moves.push(p),anniversaryWithTimeout:async p=>p,
  stop:async()=>moves.push('stop'),wakeGatheringAfterStatus:()=>moves.push('wake'),
  Date,setTimeout:fn=>fn()
 });
 vm.runInContext(source.slice(source.indexOf('  var anniversaryHandoffRetryAt ='),source.indexOf('  function anniversaryItemReceived(')),c);
 return {c,moves};
}
test('bankboi and stale targets cannot reserve merchant gathering',async()=>{
 for(const mode of ['bankboi','stale']){
  const {c,moves}=handoffFixture();
  if(mode==='stale')Object.assign(c.anniversaryPlan.handoffTargets[0],{ctype:'priest',seenAt:Date.now()-20000});
  await c.runAnniversaryHandoff();assert.deepEqual(moves,[]);assert.equal(c.anniversaryBusy,false);
 }
});
test('slice collection cannot steal active fishing or mining movement',async()=>{
 for(const mode of ['fishing','mining']){
  const {c,moves}=handoffFixture();c.anniversaryPlan.handoffTargets[0].ctype='priest';
  c.root.__merchantGatheringAttempt={mode,phase:'travelling'};
  await c.runAnniversaryHandoff();assert.deepEqual(moves,[]);assert.equal(c.anniversaryBusy,false);
 }
});
test('timed-out collection releases reservation, stops its route and backs off',async()=>{
 const {c,moves}=handoffFixture();c.anniversaryPlan.handoffTargets[0].ctype='priest';
 c.anniversaryWithTimeout=async(p,ms)=>{assert.equal(ms,30000);await p;throw Error('timeout');};
 await c.runAnniversaryHandoff();assert.equal(c.anniversaryBusy,false);
 assert.equal(moves.length,3);assert.deepEqual(moves.slice(1),['stop','wake']);
 await c.runAnniversaryHandoff();assert.equal(moves.length,3);
});

// Failure inventory: finishing a cancelled cast can rotate the gathering mode
// and invalidate the very manual equip waiting for its release. The handoff
// must retain its generation until inventory ownership ends; normal rotation
// must resume afterward and genuinely superseded handoffs must remain fenced.
test('manual inventory ownership survives gathering mode rotation at cast release',async()=>{
 const {c,switches}=fixture(),work=c.gatheringTick(1);await casting(c);
 c.gatheringCooldowns.fishing=Date.now()+10000;
 c.setGathering=mode=>{switches.push(mode);c.gatheringMode=mode;c.root.__merchantGatheringGeneration++;};
 c.root.__partyInventoryCommands=1;
 const accepted=await c.gatheringCommandHandoff({type:'equip',id:42});await work;
 assert.equal(accepted,true);
 assert.equal(c.root.__merchantGatheringGeneration,1);
 assert.deepEqual(switches,[]);
 c.root.__partyInventoryCommands=0;c.selectGatheringMode();
 assert.deepEqual(switches,['mining']);
 assert.equal(c.root.__merchantGatheringGeneration,2);
});
