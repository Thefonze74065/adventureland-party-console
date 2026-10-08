const test=require('node:test'),assert=require('node:assert/strict');
const {createDepartureLoot,installLootClient}=require('../../runtime/combat/departure-loot.ts');
const {huntLootPending}=require('../../runtime/coordinator/hunt/loot.ts');
const {createHuntTick}=require('../../runtime/coordinator/hunt/tick.ts');
const {huntLootId}=require('../../runtime/hunt/loot-identity.ts');
test('temporary Hunt loot ignores passing attacks while ordinary departure defense stays unchanged',async()=>{
 const saved=global.setInterval;global.setInterval=()=>0;let api,calls=0,now=100;
 const position={realm:':USII',map:'main',in:'main',x:0,y:0};
 try {
  api=installLootClient({},{departureLootPorts:()=>({name:()=> 'W',quest:()=>({id:'poisio',count:9}),
   now:()=>++now,cancelled:()=>false,position:()=>position,defending:()=>true,huntEncounterDefending:()=>false,
   loot:async()=>{calls++;return true;},chests:()=>[],socket:()=>({once(_event,fn){queueMicrotask(fn);},off(){}}),afterDraw:fn=>fn()})});
  const mission={cycleId:'h',currentIndex:0,stage:'farming',target:'poisio',participants:['W'],encounter:{convoyId:'c'},
   missions:[{target:'poisio',owners:['W']}],loot:{...position,id:'encounter',after:99,complete:false}};
  api.accept({serverNow:100,farmingPolicy:'hunt',monsterHunt:mission});await api.hunt.tick();
  assert.equal(calls,1);assert.equal(api.hunt.report().complete,true);
  delete mission.encounter;mission.loot={...mission.loot,id:'ordinary'};
  api.accept({serverNow:200,farmingPolicy:'hunt',monsterHunt:mission});await api.hunt.tick();assert.equal(calls,1);
 } finally {api?.stop();global.setInterval=saved;}
});
test('historical completed loot releases farming and cannot return through a delayed report',()=>{
 const saved=global.setInterval;global.setInterval=()=>0;let api;
 try {
  const mission={cycleId:'old',currentIndex:0,stage:'farming',target:'bee',participants:['W'],missions:[{target:'bee',owners:['W']}]};
  mission.loot={id:huntLootId(mission),complete:true};
  api=installLootClient({},{departureLootPorts:()=>({name:()=> 'W',quest:()=>({id:'bee',count:0}),cancelled:()=>false,position:()=>({})})});
  api.accept({serverNow:1,farmingPolicy:'hunt',monsterHunt:mission});assert.equal(api.huntPending(),true);
  for(const [index,stage] of ['ended','backup-travel','backup-farming'].entries()) {
   api.accept({serverNow:index+2,farmingPolicy:stage==='ended'?'auto':'hunt',monsterHunt:{...mission,stage}});
   assert.equal(api.huntPending(),false);api.accept({serverNow:1,farmingPolicy:'hunt',monsterHunt:mission});assert.equal(api.huntPending(),false);
  }
  api.accept({serverNow:6,farmingPolicy:'auto',monsterHunt:mission});assert.equal(api.huntPending(),false);
 } finally {api?.stop();global.setInterval=saved;}
});
function client(){
 let now=100,defense=false,cancelled=false,calls=0,fail=false,observe,collect;
 const position={realm:':USII',map:'main',in:'main',x:0,y:0},chests=['drop'];
 const ports={now:()=>++now,position:()=>position,cancelled:()=>cancelled,defending:()=>defense,
  loot:async()=>{calls++;if(fail)throw Error('loot_no_space');await new Promise(r=>collect=r);},
  nextObservation:()=>new Promise(r=>observe=r),chests:()=>chests};
 const api=createDepartureLoot(ports),control={id:'hunt:0',after:99,...position};api.accept(control,100);
 return {api,control,position,chests,calls:()=>calls,collect:async()=>{collect();await Promise.resolve();await Promise.resolve();},
  observe:()=>observe(),defend:v=>defense=v,cancel:()=>cancelled=true,fail:()=>fail=true};
}
test('loot acknowledgement waits for collection and a fresh observation; no fixed departure timer',async()=>{
 const r=client(),pass=r.api.tick();assert.equal(r.api.blocks(),true);assert.equal(r.api.report(),null);
 await r.collect();assert.equal(r.api.report(),null);r.chests.length=0;r.observe();await pass;
 assert.equal(r.api.report().complete,true);assert.equal(r.api.blocks(),false);assert.equal(r.calls(),1);
});
test('failed collection stays pending and retryable, defense and cancellation take priority',async()=>{
 const r=client();r.defend(true);await r.api.tick();assert.equal(r.calls(),0);
 r.defend(false);r.fail();await r.api.tick();assert.equal(r.api.report().complete,false);assert.match(r.api.report().error,/loot_no_space/);
 await r.api.tick();assert.equal(r.calls(),2);r.cancel();await r.api.tick();assert.equal(r.calls(),2);assert.equal(r.api.blocks(),false);
});
test('stale encounter, wrong realm, instance and location cannot regain loot ownership',async()=>{
 for(const change of [{realm:':EUI'},{in:'other'},{x:1000}]){
  const r=client();Object.assign(r.position,change);await r.api.tick();assert.equal(r.calls(),0);assert.equal(r.api.blocks(),false);
 }
 const r=client();r.api.accept(null,200);r.api.accept(r.control,100);r.api.accept(r.control,300);
 await r.api.tick();assert.equal(r.calls(),0);
});
test('an in-flight collection result cannot acknowledge a replaced encounter',async()=>{
 const r=client(),pass=r.api.tick();r.api.accept(null,200);await r.collect();await pass;assert.equal(r.api.report(),null);
});
function coordinator(){
 const mission={target:'snake',owners:['W'],destination:{map:'main',x:0,y:0}};
 const hunt={cycleId:'cycle',stage:'farming',target:'snake',missions:[mission],currentIndex:0,participants:['W'],policyVersion:3,owner:'W',selectionLeader:'W'};
 const state={leader:'W',monsterHunt:hunt,farmingPolicy:'hunt',commands:{},statuses:{W:{seenAt:100,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,monsterHunt:{id:'snake',count:0,remainingMs:900000}}}};
 const ports={now:()=>100,intent:()=>({}),cancelHuntConvoy(){state.activeConvoy=null;}};
 return {hunt,state,ports};
}
test('completed Hunt returns to Daisy without a departure loot hold',()=>{
 const r=coordinator();let returned=0;
 r.hunt.loot={id:'old',complete:false};
 createHuntTick(r.state,{...r.ports,rareEncounter:()=>false,ownsTravel:()=>true,
  recordDeaths:()=>[],fresh:()=>true,persist(){},returnToDaisy(){returned++;}}).tick();
 assert.equal(returned,1);assert.equal(r.hunt.loot,undefined);assert.ok(r.hunt.turnIn);
});

test('explicit Hunt loot barrier requires a matching fresh acknowledgement, not delivery',()=>{
 const r=coordinator();r.state.activeConvoy={id:'race',purpose:'monster-hunt'};
 assert.equal(huntLootPending(r.hunt,r.state,r.ports),true);
 assert.equal(r.state.activeConvoy,null);assert.match(r.hunt.message,/Pending Hunt loot/);
 assert.equal(huntLootPending(r.hunt,r.state,r.ports),true);
 const p={...r.hunt.loot,observedAt:101,complete:true};
 for(const bad of [{id:'old'},{realm:':EUI'},{in:'other'},{observedAt:100}]){
  r.state.statuses.W.huntLoot={...p,...bad};assert.equal(huntLootPending(r.hunt,r.state,r.ports),true);
 }
 r.state.statuses.W.huntLoot=p;assert.equal(huntLootPending(r.hunt,r.state,r.ports),false);
 assert.equal(r.hunt.missions[0].target,'snake');
});
test('pending loot never blocks explicit cancellation or an unfinished mission',()=>{
 const r=coordinator();r.state.statuses.W.monsterHunt.count=1;assert.equal(huntLootPending(r.hunt,r.state,r.ports),false);
 r.state.statuses.W.monsterHunt.count=0;r.ports.intent=()=>({cancelled:true});assert.equal(huntLootPending(r.hunt,r.state,r.ports),false);
});

test('fresh collector outside the old loot location releases an inherited hunt barrier',()=>{
 for(const change of [{x:500},{map:'cave',in:'cave'},{server:'EUI'}]){
  const r=coordinator();let saves=0;r.ports.persist=()=>saves++;
  assert.equal(huntLootPending(r.hunt,r.state,r.ports),true);
  r.hunt.stage='checking-quests';r.hunt.cycleId='new-cycle';
  Object.assign(r.state.statuses.W,change);
  assert.equal(huntLootPending(r.hunt,r.state,r.ports),false);
  assert.equal(r.hunt.loot,undefined);assert.equal(saves,1);
 }
});

test('an inherited barrier remains pending at its location and stale location reports cannot discard it',()=>{
 const r=coordinator();r.ports.persist=()=>assert.fail('valid loot discarded');
 assert.equal(huntLootPending(r.hunt,r.state,r.ports),true);
 r.hunt.stage='checking-quests';r.hunt.cycleId='new-cycle';
 assert.equal(huntLootPending(r.hunt,r.state,r.ports),true);
 r.state.statuses.W.x=500;r.state.statuses.W.seenAt=-10000;
 assert.equal(huntLootPending(r.hunt,r.state,r.ports),true);assert.ok(r.hunt.loot);
});

test('final ghost kill blocks the queued neutral before quest count delivery, only for the mission owner',()=>{
 const saved=global.setInterval;global.setInterval=()=>0;
 let quest={id:'ghost',count:1},name='P';
 const mission={cycleId:'cycle',missionRevision:1,currentIndex:0,target:'ghost',stage:'farming',missions:[{target:'ghost',owners:['P']}]};
 let api;
 try{
  api=installLootClient({},{departureLootPorts:()=>({name:()=>name,quest:()=>quest,cancelled:()=>false,position:()=>({})})});
  api.accept({serverNow:100,monsterHunt:mission});assert.equal(!!api.huntPending(),false);
  api.finalKill('ghost');assert.equal(api.huntPending(),true);
  quest.count=0;assert.equal(api.huntPending(),true);
  name='W';assert.equal(!!api.huntPending(),false,'another member with an incidental completed quest cannot stall the mission');
  name='P';api.accept({serverNow:101,monsterHunt:{...mission,missionRevision:2}});quest.count=5;
  assert.equal(!!api.huntPending(),false,'a new assignment cannot inherit the previous final kill');
 }finally{api?.stop();global.setInterval=saved;}
});

test('client ignores a selected neutral when deciding whether it must defend before loot',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('characters/shared.js','utf8');
 const entity={id:'next',type:'monster',visible:true};
 const c=vm.createContext({root:{},parent:{entities:{next:entity}},character:{map:'main',in:'main'},reunionRealm:()=> 'USII',
  groupedCombat:{target:{...entity,state:'planned'},fights:[]},isAttackingPartyMember:t=>t.target==='W'});
 for(const name of ['departureTargetEngaged','departureCombatPending']) {
  const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  }',start)+4;
  assert.ok(start>=0 && end>start);vm.runInContext(source.slice(start,end),c);
 }
 assert.equal(c.departureCombatPending(),false);entity.target='W';assert.equal(c.departureCombatPending(),true);
});

// Failure inventory: e2e/phoenix-search-failures.md (4a). Written before the change.
test('a withheld search assignment is accepted again when resent; replaced encounters stay retired',()=>{
 const saved=global.setInterval;global.setInterval=()=>0;let api;
 const position={realm:':USII',map:'main',in:'main',x:0,y:0};
 try {
  api=installLootClient({},{departureLootPorts:()=>({name:()=> 'W',quest:()=>null,now:()=>0,cancelled:()=>false,position:()=>position,
   defending:()=>false,huntEncounterDefending:()=>false,loot:async()=>true,chests:()=>[],socket:()=>({once(){},off(){}}),afterDraw:fn=>fn()})});
  const search={id:'patrol-1-23-W-halloween-0',kind:'search',destination:{map:'halloween',x:8,y:631}};
  assert.equal(api.accept({serverNow:100,rareControl:search}),search);
  assert.equal(api.accept({serverNow:200,rareControl:null}),null,'withheld (an anniversary round)');
  assert.equal(api.accept({serverNow:300,rareControl:search}),search,'the same assignment, resent, must be accepted');
  const encounter={id:'rare-7',kind:'encounter',target:{id:'p',map:'main',in:'main',x:0,y:0}};
  assert.equal(api.accept({serverNow:400,rareControl:encounter}),encounter);
  assert.equal(api.accept({serverNow:500,rareControl:null}),null);
  assert.equal(api.accept({serverNow:600,rareControl:encounter}),null,'a replaced encounter cannot return');
 } finally {api?.stop();global.setInterval=saved;}
});

test('temporary convoy communication hold suspends collection without retiring its loot identity',async()=>{
 const saved=global.setInterval;global.setInterval=()=>0;let api,calls=0,now=100;
 const position={realm:':USII',map:'main',in:'main',x:0,y:0};
 const loot={...position,id:'convoy-loot',after:90};
 try {
  api=installLootClient({},{departureLootPorts:()=>({name:()=> 'W',quest:()=>null,
   now:()=>++now,cancelled:()=>false,position:()=>position,defending:()=>false,
   loot:async()=>{calls++;if(calls===1)throw {reason:'openning'};return true;},chests:()=>[],
   socket:()=>({once(_event,fn){queueMicrotask(fn);},off(){}}),afterDraw:fn=>fn()})});
  api.accept({serverNow:100,convoySignal:{phase:'defending',loot}});await api.convoy.tick();
  assert.equal(api.convoy.report().error,'openning');
  api.accept({serverNow:200,convoySignal:{phase:'communication-hold',loot}});await api.convoy.tick();
  assert.equal(calls,1);
  api.accept({serverNow:300,convoySignal:{phase:'defending',loot}});await api.convoy.tick();
  assert.equal(calls,2);assert.equal(api.convoy.report().complete,true);
 } finally {api?.stop();global.setInterval=saved;}
});
