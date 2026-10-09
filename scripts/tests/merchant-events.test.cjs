const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const {merchantEventReserved} = require('../../runtime/coordinator/merchant/event-control.ts');
const {createMerchantDispatcher} = require('../../runtime/coordinator/merchant/dispatcher.ts');
const {createMerchantIdle} = require('../../runtime/coordinator/merchant/idle.ts');
const {role} = require('../../runtime/characters/classes/merchant.ts');
const shared = fs.readFileSync('characters/shared.js','utf8');
function functions(source, names) {
 const tree=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true);const found=[];
 function visit(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))found.push(n.getText(tree));ts.forEachChild(n,visit);}
 visit(tree);assert.equal(found.length,names.length);return ts.transpileModule(found.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
function client(event='snowman') {
 const calls=[], c={root:{},character:{name:'M',ctype:'merchant',map:'main',slots:{mainhand:{name:'goldenpower'}}},
  G:{maps:{main:{}},events:{}},navigationIntent:{revision:1,cancelled:false},eventsEnabled:true,
  joinedEvent:null,eventTraveling:false,eventReturnPending:false,banking:false,stocking:false,upgrading:false,
  merchantIdleActive:false,gatheringActive:false,luckyUpgradeService:null,eventPollBusy:false,
  huntTurnInPriority:false,convoyTraveling:null,anniversaryBusy:false,anniversaryStaging:false,
  eventTargetTypes:[],partyEventHint:null,eventMissingSince:0,departurePending:false,bankQueued:false,
  eventSelectionRevision:0,travellingEventName:null,
  activeCombatEvent:()=>event?{name:event,state:{},types:[event],kind:event==='abtesting'?'pvp':'monster'}:null,
  eventSelected:()=>true,escapeOwns:()=>false,runtimeCurrent:()=>true,
  eventTravelAllowed:async()=>true,closeMerchantStandForTravel:async()=>calls.push('close'),
  is_in_range:()=>true,nearestEventTarget:()=>null,eventDestination:()=>({map:'winterland',x:1,y:2}),
  eventRequiresJoin:()=>event!=='snowman',join:async name=>{calls.push(['join',name]);c.character.map='winterland';},
  sharedPartyWalk:async(...args)=>calls.push(['walk',...args]),game_log(){},Date,
  request:async(...args)=>{calls.push(['request',...args]);return {yield:true};}};
 vm.createContext(c);vm.runInContext(functions(shared,['eventCombatReachable','merchantEventWorkReserved','yieldMerchantForEvent','joinCombatEvent','pollEvents','rejoinActiveEventAfterRespawn','eventExitOwnsMovement']),c);
 return {c,calls};
}
test('merchant reservations survive restart, deselection and deferred return, then release',()=>{
 const state={merchantCharacter:'M',statuses:{M:{seenAt:100,merchantEventReserved:true}},eventSelectionsByCharacter:{M:['snowman']}};
 assert.equal(merchantEventReserved(state,100),true);assert.equal(merchantEventReserved(state,20000),false);
 state.eventSessions={M:{participants:['M']}};state.eventSelectionsByCharacter.M=[];
 assert.equal(merchantEventReserved(state,20000),true);state.eventSessions={};state.eventReturn={participants:['M']};
 assert.equal(merchantEventReserved(state,20000),true);state.eventReturn=null;state.deferredEventReturns={M:{cycleId:'r'}};
 assert.equal(merchantEventReserved(state,20000),true);state.deferredEventReturns={};assert.equal(merchantEventReserved(state,20000),false);
});
test('event reservation blocks merchant dispatch and idle before home, storage or realm actions',()=>{
 const unexpected=()=>assert.fail('event ownership must stop scheduling first');
 const ports=new Proxy({eventReserved:()=>true},{get:(p,key)=>p[key]||unexpected});
 createMerchantDispatcher({queue:[],current:null},ports).dispatch();createMerchantIdle(ports).idle();
});
for(const event of ['abtesting','goobrawl','crabxx','franky','icegolem','snowman'])test(`merchant enters ${event} with existing equipment`,async()=>{
 const {c,calls}=client(event),weapon=c.character.slots.mainhand;
 await c.pollEvents();assert.equal(c.joinedEvent,event);assert.equal(c.character.slots.mainhand,weapon);
 assert.equal(calls[0],'close');assert.equal(calls.some(call=>call[0]==='join'),event!=='snowman');
 assert.equal(calls.some(call=>call[0]==='walk'),event==='snowman');
});
test('merchant waits for inventory work and gathering to settle before event movement',async()=>{
 const {c,calls}=client();c.root.__merchantActiveJob={jobId:'work'};await c.pollEvents();assert.deepEqual(calls,[]);
 delete c.root.__merchantActiveJob;c.root.__merchantGatheringAttempt={phase:'casting'};await c.pollEvents();
 assert.equal(c.root.__merchantGatheringAttempt.cancelled,'event attendance');assert.deepEqual(calls,[]);
 delete c.root.__merchantGatheringAttempt;await c.pollEvents();assert.equal(c.joinedEvent,'snowman');
});
test('nearby event target records attendance even without a travel leg',async()=>{
 const {c}=client();c.nearestEventTarget=()=>({id:'boss'});await c.pollEvents();assert.equal(c.joinedEvent,'snowman');
});
test('merchant respawns and rejoins its selected event',async()=>{
 const {c,calls}=client('goobrawl');c.stop=async()=>{};c.root.__partyEventRejoinRequired='goobrawl';
 assert.equal((await c.rejoinActiveEventAfterRespawn()).status,'recovered');
 assert.equal(c.joinedEvent,'goobrawl');assert.ok(calls.some(call=>call[0]==='join'));
});
test('event production boundary yields before starting another operation',async()=>{
 const {c,calls}=client();c.root.__merchantActiveJob={jobId:'work'};
 await assert.rejects(c.yieldMerchantForEvent(),/merchant_yield/);
 assert.equal(calls[0][1],'/merchant/checkpoint');assert.equal(calls[0][2].body.eventOnly,true);
});
test('merchant role and runner use event targets and block ordinary farming and passing attacks',()=>{
 const event={id:'event'}, farm={id:'farm'},saved=global.sharedRoutine;
 try{global.sharedRoutine={getEventTarget:()=>event};assert.equal(role.chooseTarget(),event);
 global.sharedRoutine.getEventTarget=()=>null;assert.equal(role.chooseTarget(),null);}finally{global.sharedRoutine=saved;}
 const c={character:{ctype:'merchant',rip:false},active:true,resolvedRole:()=>({...role,chooseTarget:()=>event}),
 sharedRoutine:{merchantEventCombatActive:()=>false,isOccupied:()=>false,getAbtestingMode:()=>'',getRareTarget:()=>farm}};
 vm.createContext(c);vm.runInContext(functions(fs.readFileSync('runtime/characters/roles/runner.ts','utf8'),['combatAllowed','passingTarget','chooseTarget','priorityEventTarget','fallbackTarget','exclusiveCombat']),c);
 assert.equal(c.combatAllowed(),false);c.sharedRoutine.merchantEventCombatActive=()=>true;assert.equal(c.combatAllowed(),true);
 assert.equal(c.chooseTarget(),event);assert.equal(c.passingTarget(),null);c.sharedRoutine.isOccupied=()=>true;assert.equal(c.combatAllowed(),false);
});
const {createAttackController}=require('../../runtime/characters/roles/attack-controller.ts');
test('merchant event attacks reach the normal controller and rejected attacks remain retryable',async()=>{
 const keys=['parent','character','sharedRoutine','attack','can_attack','is_in_range','is_on_cooldown','setTimeout','clearTimeout'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]]));const target={id:'boss',type:'monster',mtype:'snowman',hp:100};
 let controller,attacks=0;const errors=[],state={};
 try {
  Object.assign(global,{parent:{},character:{ctype:'merchant',damage_type:'physical',slots:{mainhand:{name:'equipped-gun'}}},
   sharedRoutine:{basicAttackReserved:()=>false,noteAttack:()=>{}},can_attack:()=>true,is_in_range:()=>true,is_on_cooldown:()=>false,
   setTimeout:()=>0,clearTimeout:()=>{},attack:async()=>{attacks++;throw {reason:'merchant'};}});
  controller=createAttackController({target:()=>target,selected:()=>target.id,epoch:()=>1,active:()=>true,allowed:()=>true,state:()=>state,report:e=>errors.push(e)});
  controller.tick();for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(attacks,1);assert.equal(errors[0].reason,'merchant');
  controller.reset();global.attack=async()=>{attacks++;};controller.tick();for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(attacks,2);
 } finally {controller?.stop();for(const k of keys)if(saved[k]===undefined)delete global[k];else global[k]=saved[k];}
});
