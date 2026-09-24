const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {namedFunction}=require('./helpers/named-function.cjs');
const {createSharedConvoyNavigation}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const {initialCommandState}=require('../../runtime/coordinator/navigation/initial-commands.ts');
const {createConvoyAcknowledgementRoutes}=require('../../runtime/coordinator/http/convoy-acknowledgements.ts');
const {reconcileCurrentHuntParty}=require('../../runtime/coordinator/hunt/current-party.ts');
const legacy=require('../convoy-navigation.cjs');
function fixture(){
 const p={leader:'L',followers:{F:true},combatLogs:{},commands:{},nextCommandId:10,navigationIntents:{L:{revision:2},F:{revision:2}},
  monsterHunt:{convoyId:'c',stage:'returning',participants:['L','F'],missions:[],returnRetries:3},
  activeConvoy:{id:'c',epoch:1,routeProtocol:4,phase:'assemble',purpose:'monster-hunt',leader:'L',participants:['L','F'],completed:[],
   location:{map:'main',x:120,y:0},rally:{map:'main',x:0,y:0},slowestSpeed:57,continuousReturn:1,returnRouting:true,recoveryAttempts:2,walkingFailures:2},
  statuses:Object.fromEntries(['L','F'].map(n=>[n,{map:'main',x:0,y:0,server:'USII',seenAt:1000,hp:100,convoyProtocol:4,huntReturnProtocol:2,
    speed:57,combatSelection:{runtimeId:n},convoyNavigation:{runtimeId:n}}]))};
 let engine=createSharedConvoyNavigation(legacy);engine.step(p,1000);p.activeConvoy.phase='travel';
 function report(now,phase='held') {for(const n of ['L','F']){const s=p.statuses[n],cmd=p.commands[n];s.seenAt=now;
  s.convoyNavigation={id:'c',epoch:p.activeConvoy.epoch,commandId:cmd.id,navigationRevision:cmd.navigationRevision,
   routeVersion:p.activeConvoy.routeVersion,runtimeId:s.combatSelection.runtimeId,phase};}}
 report(1000,'travelling');
 return {p,get e(){return engine;},report,step:now=>engine.step(p,now),stable(from){for(let t=from;t<=from+5000;t+=1000){report(t);engine.step(p,t);}},
  restart(now){Object.assign(p,initialCommandState(JSON.parse(JSON.stringify({activeConvoy:p.activeConvoy,convoyCompletionReceipts:p.convoyCompletionReceipts})),()=>now));engine=createSharedConvoyNavigation(legacy);}};
}
test('hours without reports do not consume movement budgets; fresh acknowledged holds resume after five seconds',()=>{
 const f=fixture(),c=f.p.activeConvoy;f.step(5000);assert.equal(c.phase,'communication-hold');
 f.step(36000000);assert.equal(c.phase,'communication-hold');assert.equal(c.recoveryAttempts,2);assert.equal(f.p.monsterHunt.returnRetries,3);
 f.report(36001000);f.step(36001000);assert.match(c.failure,/stable/);
 f.stable(36001000);assert.equal(c.phase,'shared-prepare');assert.equal(c.communicationHold,undefined);
 assert.equal(c.recoveryAttempts,2);assert.equal(c.walkingFailures,2);assert.equal(f.p.monsterHunt.returnRetries,3);
 assert.equal(f.p.combatLogs.L.filter(l=>l.message==='Convoy communication lost').length,1);
 assert.equal(f.p.combatLogs.L.filter(l=>l.message==='Convoy communication restored').length,1);
});
test('flapping recovery resets stability and rate limits route resumptions',()=>{
 const f=fixture(),c=f.p.activeConvoy;f.step(5000);f.stable(6000);assert.equal(c.communicationResumedAt,11000);
 f.step(15000);f.report(16000);f.step(16000);f.report(19000);f.p.statuses.F.seenAt=0;f.step(19000);
 f.stable(20000);assert.equal(c.phase,'communication-hold');
 for(let t=26000;t<=41000;t+=1000){f.report(t);f.step(t);}assert.equal(c.phase,'shared-prepare');assert.equal(c.communicationResumedAt,41000);
});
test('restart discards readiness and rebinds freshly registered runtimes before resuming',()=>{
 const f=fixture();f.step(5000);f.report(6000);f.step(6000);f.restart(6500);
 f.p.statuses.F.combatSelection.runtimeId='F-new';f.step(6600);assert.equal(f.p.activeConvoy.phase,'communication-hold');
 f.stable(7000);assert.equal(f.p.activeConvoy.phase,'shared-prepare');assert.equal(f.p.activeConvoy.runtimes.F,'F-new');
});
for(const change of ['manual','cancel','revision'])test('communication recovery respects '+change,()=>{
 const f=fixture();f.step(5000);
 if(change==='manual')f.p.commands.F={id:999,type:'character-travel'};
 if(change==='cancel')f.p.navigationIntents.F.cancelled=true;
 if(change==='revision')f.p.navigationIntents.F.revision++;
 f.step(6000);assert.equal(f.p.activeConvoy.failureCode,'owner-lost');assert.equal(f.p.activeConvoy.communicationHold,undefined);
 if(change==='manual')assert.equal(f.p.commands.F.id,999);
});
for(const change of ['moving','realm','dead','unacknowledged'])test('communication hold waits for '+change+' participant',()=>{
 const f=fixture();f.step(5000);
 for(let t=6000;t<=14000;t+=1000){f.report(t);
  if(change==='moving')f.p.statuses.F.moving=true;
  if(change==='realm')f.p.statuses.F.server='EUI';
  if(change==='dead')f.p.statuses.F.rip=true;
  if(change==='unacknowledged')f.p.statuses.F.convoyNavigation.commandId--;
  f.step(t);
 }assert.equal(f.p.activeConvoy.phase,'communication-hold');
});
test('saved arrived completion-network hold migrates once without clearing actual movement counters',()=>{
 const f=fixture(),c=f.p.activeConvoy;
 Object.assign(c,{phase:'failed',failureCode:'route-failed',retryExhausted:true,
  failure:'Regroup retries exhausted: F: POST /convoy-complete · network',
  failureDetails:{failureContext:{phase:'arrived',convoyId:'c',position:{...c.location},destination:{...c.location}}}});
 f.restart(5000);f.step(6000);f.stable(7000);
 const recovered=f.p.activeConvoy;assert.equal(recovered.phase,'shared-prepare');assert.equal(recovered.retryExhausted,false);
 assert.equal(recovered.communicationLegacyRecovered,true);assert.equal(recovered.recoveryAttempts,2);assert.equal(f.p.monsterHunt.returnRetries,3);
 f.e.hold(f.p,'Blocked waypoint');assert.equal(recovered.phase,'failed');assert.equal(recovered.failureCode,'route-failed');
 f.step(14000);assert.equal(recovered.phase,'failed','genuine later failure is not migrated again');
});
test('unrelated legacy route failure is not converted to communication recovery',()=>{
 const f=fixture(),c=f.p.activeConvoy;c.phase='failed';c.failure='Stalled walking movement';c.failureCode='route-failed';c.retryExhausted=true;
 f.step(5000);assert.equal(c.phase,'failed');assert.equal(c.communicationHold,undefined);
});
test('missing heartbeat cannot silently remove a participant from the held Hunt',()=>{
 const f=fixture();f.step(5000);f.p.statuses.L.seenAt=20000;
 assert.equal(reconcileCurrentHuntParty(f.p.monsterHunt,f.p,20000,()=>assert.fail('must retain convoy')),false);
 assert.deepEqual(f.p.monsterHunt.participants,['L','F']);
});

function client(){
 let now=1000,owns=true;const logs=[],timers=[],calls=[];
 const r=vm.createContext({Date:{now:()=>now},Math,Promise,Number,String,Error,coordinatorClockOffset:0,root:{},character:{name:'L'},convoyRuntimeId:'L',
  setTimeout(fn,ms){timers.push({fn,ms});},game_log:m=>logs.push(m),request:async(path,options)=>{calls.push({path,options});return {ok:true};}});
 const source=fs.readFileSync('characters/shared.js','utf8');
 for(const name of ['convoyRetryableRequest','convoyCommunication','convoyRetryDelay','acknowledgeConvoyArrival'])vm.runInContext(namedFunction(source,name),r);
 const convoy={phase:'arrived'},cmd={id:1,convoyId:'c',epoch:2,navigationRevision:3,routeVersion:4};
 return {r,convoy,logs,timers,calls,start:()=>r.acknowledgeConvoyArrival(convoy,cmd,()=>owns),cancel(){owns=false;},async advance(){const t=timers.shift();if(t){now+=t.ms;t.fn();}await new Promise(setImmediate);}};
}
for(const failure of [{kind:'network',status:0},{kind:'timeout',status:0},{kind:'http',status:408},{kind:'http',status:429},{kind:'http',status:503}])
test('arrival survives '+JSON.stringify(failure)+' and retries only the acknowledgement',async()=>{
 const f=client();let requests=0;
 f.r.request=async(path,options)=>{assert.equal(path,'/convoy-complete');assert.equal(options.timeout,5000);requests++;
  if(requests===1)throw Object.assign(Error('connection failed'),{partyRequest:failure});return {ok:true};};
 const pending=f.start();await new Promise(setImmediate);assert.equal(f.convoy.phase,'arrived');assert.ok(f.convoy.communication);
 for(let i=0;i<20&&requests<2;i++)await f.advance();await pending;
 assert.equal(requests,2);assert.equal(f.convoy.phase,'arrived');assert.equal(f.convoy.communication,undefined);
});
test('arrival retry is cancelled without another HTTP request',async()=>{
 const f=client();let requests=0;f.r.request=async()=>{requests++;throw Object.assign(Error('offline'),{partyRequest:{kind:'network'}});};
 const pending=f.start();await new Promise(setImmediate);f.cancel();await f.advance();await pending;assert.equal(requests,1);
});
test('permanent completion errors remain failures',async()=>{
 const f=client();f.r.request=async()=>{throw Object.assign(Error('bad request'),{partyRequest:{kind:'http',status:400}});};
 await assert.rejects(f.start(),/bad request/);assert.equal(f.convoy.communication,undefined);
});
test('permanent error after a transient failure cannot inherit the communication hold',async()=>{
 const f=client();let requests=0;
 f.r.request=async()=>{requests++;throw Object.assign(Error(requests===1?'offline':'bad request'),{partyRequest:requests===1?{kind:'network'}:{kind:'http',status:400}});};
 const pending=assert.rejects(f.start(),/bad request/);await new Promise(setImmediate);
 for(let i=0;i<20&&requests<2;i++)await f.advance();await pending;assert.equal(f.convoy.communication,undefined);
});
test('healthy travel restored after coordinator restart uses communication recovery rather than Hunt retries',()=>{
 const f=fixture();f.restart(5000);f.step(6000);f.stable(7000);
 assert.equal(f.p.activeConvoy.phase,'shared-prepare');assert.equal(f.p.monsterHunt.returnRetries,3);
});
test('restart with partially acknowledged arrival rebinds every participant',()=>{
 const f=fixture();f.p.activeConvoy.completed=['F'];delete f.p.commands.F;f.restart(5000);f.step(6000);
 assert.ok(f.p.commands.F);f.stable(7000);assert.equal(f.p.activeConvoy.phase,'shared-prepare');
 assert.equal(f.p.activeConvoy.failureCode,undefined);assert.equal(f.p.monsterHunt.returnRetries,3);
});
test('completion receipt survives restart and cannot delete replacement commands',()=>{
 const p={activeConvoy:{id:'c',phase:'travel',participants:['L'],completed:[],departAt:0},commands:{L:{id:1}},combatLogs:{}};
 const body={character:'L',convoyId:'c',epoch:2,commandId:1,runtimeId:'L',navigationRevision:3,routeVersion:4};
 let valid=true,persists=0;const routes=createConvoyAcknowledgementRoutes(p,{now:()=>100,owned:()=>true,valid:()=>valid,persist:()=>persists++});
 const res=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
 assert.equal(routes.complete({body},res()).body.ok,true);assert.equal(p.activeConvoy,null);
 Object.assign(p,initialCommandState(JSON.parse(JSON.stringify(p)),()=>200));p.commands.L={id:999,type:'character-travel'};valid=false;
 assert.equal(routes.complete({body},res()).body.ok,true);assert.equal(p.commands.L.id,999);assert.equal(persists,1);
 assert.equal(routes.complete({body:{...body,routeVersion:5}},res()).code,409);
});
