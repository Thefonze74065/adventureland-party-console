const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,settle,command}=require('./helpers/native-convoy-runtime.cjs');
const {createSharedConvoyNavigation}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const {publishSharedRoute,sharedRoute}=require('../../runtime/coordinator/navigation/shared-route-store.ts');
const legacy=require('../convoy-navigation.cjs');
const engine=()=>createSharedConvoyNavigation(legacy);
const copy=x=>JSON.parse(JSON.stringify(x));

function mismatchedParty(){
 const p=party(),e=engine();e.step(p,1000);
 for(const n of p.activeConvoy.participants)p.statuses[n].movementGeometry={version:17139,fingerprint:n==='F'?'old':'current'};
 e.step(p,1100);return {p,e,c:p.activeConvoy};
}
test('old leader browser is repaired toward newer worker game version',()=>{
 const p=party(),e=engine();e.step(p,1000);
 for(const n of p.activeConvoy.participants)p.statuses[n].movementGeometry={version:n==='L'?17139:17175,fingerprint:'same'};
 e.step(p,1100);assert.equal(p.activeConvoy.geometryRepair.expected.version,17175);
 assert.deepEqual(p.activeConvoy.geometryRepair.runtimes,{L:'L'});
});
test('geometry mismatch holds everyone and reloads only affected runtime after hold acknowledgements',()=>{
 const {p,e,c}=mismatchedParty();assert.equal(c.phase,'shared-hold');assert.equal(c.recoveryAttempts,undefined);
 assert.deepEqual(c.geometryRepair.runtimes,{F:'F'});assert.match(c.failure,/expected.*current.*actual.*old/);
 assert.equal(e.signal(p,'F',1100).geometryReload,null);
 for(const n of c.participants)report(p,n,'held',1200);
 assert.equal(e.signal(p,'F',1200).geometryReload.runtimeId,'F');assert.equal(e.signal(p,'L',1200).geometryReload,null);
 p.statuses.F.movementGeometry={...p.statuses.L.movementGeometry};e.step(p,1300);
 assert.equal(c.phase,'shared-hold','matching identity alone does not acknowledge reload');
 p.statuses.F.convoyNavigation.runtimeId='F-reloaded';e.step(p,1400);
 assert.equal(c.phase,'shared-prepare');assert.equal(c.geometryRepair.phase,'complete');assert.equal(c.runtimes.F,'F-reloaded');
 assert.equal(c.routeVersion,2);assert.equal(c.recoveryAttempts,undefined);
 p.statuses.F.movementGeometry.fingerprint='bad-again';e.step(p,1500);
 assert.equal(c.phase,'failed');assert.equal(c.failureCode,'geometry-mismatch');assert.equal(c.retryExhausted,true);
});
test('geometry reload wait retains its deadline through coordinator restoration',()=>{
 const {p,e,c}=matchedRestore();
 e.step(p,2000);assert.equal(c.phase,'shared-hold');assert.equal(c.geometryRepair.startedAt,1100);
 e.step(p,61100);assert.equal(c.phase,'failed');assert.equal(c.failureCode,'geometry-mismatch');assert.equal(c.recoveryAttempts,undefined);
 const saved=require('../../runtime/coordinator/navigation/initial-commands.ts').initialCommandState({activeConvoy:copy(c)},()=>62000);
 assert.equal(saved.activeConvoy.failureCode,'geometry-mismatch');assert.equal(saved.activeConvoy.restartRecovery,false);
});
function matchedRestore(){
 const {p,e,c}=mismatchedParty();
 const restored=require('../../runtime/coordinator/navigation/initial-commands.ts').initialCommandState({activeConvoy:copy(c)},()=>2000);
 Object.assign(p,restored);return {p,e,c:p.activeConvoy};
}
test('geometry repair never replaces a newer character command',()=>{
 const {p,e,c}=mismatchedParty(),command={id:123,type:'character-travel'};p.commands.F=command;
 e.step(p,1200);assert.equal(c.failureCode,'owner-lost');assert.equal(p.commands.F,command);
});
for(const blocker of ['stale','moving','realm','geometry'])test('geometry repair waits for '+blocker+' replacement reports',()=>{
 const {p,e,c}=mismatchedParty();for(const n of c.participants)report(p,n,'held',1200);
 Object.assign(p.statuses.F,{movementGeometry:{...p.statuses.L.movementGeometry}});
 p.statuses.F.convoyNavigation.runtimeId='F-new';
 if(blocker==='stale')p.statuses.F.seenAt=-9000;
 if(blocker==='moving')p.statuses.F.moving=true;
 if(blocker==='realm')p.statuses.F.server='different';
 if(blocker==='geometry')p.statuses.F.movementGeometry.fingerprint='wrong';
 e.step(p,1300);assert.equal(c.phase,'shared-hold');assert.equal(c.geometryRepair.phase,'waiting');
});

function scheduledParty() {
 const p=party(),e=engine();e.step(p,1000);publishSharedRoute(p,publication(p),1000);
 for(const n of ['L','F','P'])report(p,n);
 e.step(p,1000);e.step(p,1600);return {p,e,c:p.activeConvoy};
}
test('clock-skewed matching departure reports do not consume regroup attempts',()=>{
 const {p,e,c}=scheduledParty(),at=c.departAt-100;
 for(const name of c.participants)report(p,name,'route-ready',at);
 Object.assign(p.statuses.F,{moving:true,x:9});
 Object.assign(p.statuses.F.convoyNavigation,{phase:'travelling',departedAt:c.departAt});
 e.step(p,at);assert.equal(c.phase,'scheduled');assert.equal(c.recoveryAttempts,undefined);
 e.step(p,c.departAt);assert.equal(c.phase,'travel');
});
for(const field of ['routeVersion','epoch','commandId','navigationRevision'])test('early departure cannot bypass '+field+' validation',()=>{
 const {p,e,c}=scheduledParty(),at=c.departAt-100;
 for(const name of c.participants)report(p,name,'route-ready',at);
 Object.assign(p.statuses.F,{moving:true,x:9});
 Object.assign(p.statuses.F.convoyNavigation,{phase:'travelling',departedAt:c.departAt});
 p.statuses.F.convoyNavigation[field]++;
 e.step(p,at);assert.equal(c.phase,'shared-hold');assert.match(c.preparationBlocker,/F:/);
 assert.equal(c.recoveryAttempts,undefined);
});
test('transient readiness withdrawal preserves deadline through repeated preparations',()=>{
 const {p,e,c}=scheduledParty();p.statuses.F.speed=100;e.step(p,1800);
 assert.equal(c.phase,'shared-hold');assert.match(c.preparationBlocker,/F: waiting for cruise/);
 assert.equal(c.readinessStartedAt,1000);assert.equal(c.recoveryAttempts,undefined);
 for(const name of c.participants){p.statuses[name].speed=57;report(p,name,'held',1900);}
 e.step(p,1900);assert.equal(c.phase,'shared-prepare');assert.equal(c.readinessStartedAt,1000);
 for(const name of c.participants)report(p,name,'route-ready',61000);
 e.step(p,61000);assert.equal(c.recoveryAttempts,1);assert.equal(c.readinessStartedAt,undefined);
 assert.match(c.failure,/readiness timed out/);
});
test('repeated walking stalls change planner before bounded exhaustion',()=>{
 const p=party(),e=engine();e.step(p,1000);
 e.hold(p,'L: Stalled walking movement (5 seconds without progress)');
 assert.equal(p.activeConvoy.nativeFallback,false);
 for(const name of ['L','F','P'])report(p,name,'held',1100);
 e.step(p,1100);e.hold(p,'L: Stalled walking movement (5 seconds without progress)');
 assert.equal(p.activeConvoy.nativeFallback,true);
 for(const name of ['L','F','P']){assert.equal(p.commands[name].nativeFallback,true);report(p,name,'held',1200);}
 e.step(p,1200);e.hold(p,'L: Stalled walking movement (5 seconds without progress)');
 assert.equal(p.activeConvoy.phase,'failed');assert.equal(p.activeConvoy.recoveryAttempts,2);
});

test('client origin and departure-window failures reprepare without spending walking retries',()=>{
 const {p,e,c}=scheduledParty();c.sharedStartedAt=Date.now();e.hold(p,'P: Route origin changed before departure');
 assert.equal(c.phase,'shared-hold');assert.equal(c.recoveryAttempts,undefined);
 const now=Date.now();for(const name of c.participants)report(p,name,'held',now);
 // Hold uses the injected wall clock in production; keep this synthetic fixture within its deadline.
 c.readinessStartedAt=now;e.step(p,now);assert.equal(c.phase,'shared-prepare');
 e.hold(p,'F: Departure signal arrived too late');assert.equal(c.recoveryAttempts,undefined);
 c.phase='travel';e.hold(p,'Stalled walking movement (5 seconds without progress)');
 assert.equal(c.recoveryAttempts,1);
});

test('expired client readiness is bounded even when the reason contains an origin failure',()=>{
 const {p,e,c}=scheduledParty();c.readinessStartedAt=Date.now()-60001;
 e.hold(p,'P: Route origin changed before departure');
 assert.equal(c.recoveryAttempts,1);assert.match(c.failure,/Departure readiness timed out/);
});
test('Phoenix planning origin is captured only after matching stopped assembly reports',()=>{
 const p=party(),e=engine();p.activeConvoy.purpose='phoenix-patrol';
 e.step(p,1000);assert.equal(p.activeConvoy.phase,'assemble');
 for(const name of ['L','F','P'])report(p,name,'assembled',1000);
 p.statuses.L.moving=true;e.step(p,1100);assert.equal(p.activeConvoy.phase,'assemble');
 p.statuses.L.moving=false;p.statuses.L.x=17;e.step(p,1200);
 assert.equal(p.activeConvoy.phase,'shared-prepare');assert.equal(p.activeConvoy.rally.x,17);
});
test('regrouping preserves ALClient unless the route failure identifies geometry',()=>{
 for(const [reason,native] of [['Leader moved from planning origin',false],['Movement cancelled',false],['Rendezvous made no progress',false],['Shared route rejected: unwalkable segment',true]]) {
  const p=party(),e=engine();e.step(p,1000);e.hold(p,reason,'route-failed');
  assert.equal(p.activeConvoy.nativeFallback,native,reason);
  assert.equal(p.activeConvoy.phase,'shared-hold');
 }
});

test('convoy failure history identifies a merchant command takeover without overwriting it',()=>{
 const p=party(),e=engine();p.combatLogs={};p.monsterHunt={stage:'mission-travel',target:'cgoo'};
 e.step(p,1000);
 assert.equal(p.combatLogs.L.at(-1).message,'Convoy route preparation');
 const merchant={id:99,type:'merchant-order-handoff'};p.commands.F=merchant;
 e.step(p,1100);
 const entry=p.combatLogs.L.at(-1);
 assert.equal(entry.message,'Convoy failed');assert.equal(entry.details.commands.F,'merchant-order-handoff');
 assert.deepEqual(entry.details.destination,{map:'main',in:undefined,x:120,y:0});
 assert.equal(entry.details.huntTarget,'cgoo');assert.equal(p.commands.F,merchant);
 e.step(p,1200);assert.equal(p.combatLogs.L.at(-1),entry,'failed ticks do not duplicate lifecycle entries');
});

test('shared walking leaves passive targets, stops for a follower attack, loots and replans the same destination',()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy,require('../../runtime/coordinator/navigation/convoy-defense.ts').step);
 require('./helpers/travel-observations.cjs').observeTravel(p.statuses);
 const bee={id:'bee',mtype:'bee',target:'F',map:'main',x:0,y:0,hp:100};
 p.groupedCombat={fights:[bee],queue:[bee]};p.statuses.L.groupedCombat.threats=[bee];
 e.step(p,1000);assert.equal(p.activeConvoy.phase,'shared-prepare');
 const destination=p.activeConvoy.location,epoch=p.activeConvoy.epoch;
 assert.equal(publishSharedRoute(p,publication(p),1000),null);
 for(const n of ['L','F','P'])report(p,n);
 e.step(p,1000);e.step(p,1600);assert.equal(p.activeConvoy.phase,'scheduled');
 p.statuses.F.groupedCombat.currentAttackers=[bee];e.step(p,1700);
 assert.equal(p.activeConvoy.phase,'defending');assert.equal(sharedRoute(p.activeConvoy),undefined);
 p.statuses.F.groupedCombat.currentAttackers=[];e.step(p,1800);
 assert.match(p.activeConvoy.defenseReason,/loot/);
 p.statuses.L.convoyLoot={...p.activeConvoy.loot,observedAt:1801,complete:true};e.step(p,1801);e.step(p,1802);
 assert.equal(p.activeConvoy.phase,'shared-prepare');assert.equal(p.activeConvoy.location,destination);
 assert.equal(p.activeConvoy.epoch,epoch+1);assert.ok(p.activeConvoy.routeVersion>1);
});
test('passing bees and reordered retaliation reports never interrupt the Hunt route',()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy,require('../../runtime/coordinator/navigation/convoy-defense.ts').step);
 require('./helpers/travel-observations.cjs').observeTravel(p.statuses);
 Object.assign(p.activeConvoy,{purpose:'monster-hunt',huntTarget:'rat'});
 e.step(p,1000);const c=p.activeConvoy,destination=c.location;
 assert.equal(publishSharedRoute(p,publication(p),1000),null);
 for(const n of c.participants)report(p,n);
 e.step(p,1000);e.step(p,1600);assert.equal(c.phase,'scheduled');
 const bee={id:'passing-bee',mtype:'bee',target:'F',map:'main',in:'main',server:'USII',x:20,y:0,hp:100};
 p.statuses.F.groupedCombat.currentAttackers=[bee];
 p.statuses.L.groupedCombat.passingEncounters=[{...bee,at:1700}];
 e.step(p,1700);assert.equal(c.phase,'scheduled');assert.equal(c.location,destination);
 // A follower may observe a second bee before the attacker's report arrives.
 p.statuses.F.groupedCombat.currentAttackers=[{...bee,id:'delayed-bee'}];
 e.step(p,1800);assert.equal(c.phase,'scheduled');
 p.statuses.L.groupedCombat.passingEncounters.push({...bee,id:'delayed-bee',at:1800});
 e.step(p,1900);assert.equal(c.loot,undefined);assert.equal(c.location,destination);
 assert.equal(c.huntTarget,'rat');assert.equal(c.farmingEngagement,undefined);
 assert.equal(p.groupedCombat?.target?.id,undefined);
});

test('a return rebuilds after runtime replacement with fresh epoch and bounded retries',()=>{
 const p=party(),e=engine();p.activeConvoy.purpose='shared-walk-return';p.activeConvoy.navigationExempt=true;
 e.step(p,1000);const oldEpoch=p.activeConvoy.epoch,oldCommand=p.commands.F.id;
 p.statuses.F.convoyNavigation.runtimeId='replacement';e.step(p,1100);
 assert.equal(p.activeConvoy.failureCode,'runtime-lost');
 let now=p.activeConvoy.failedAt;
 for(let attempt=0;attempt<3;attempt++){
  const delay=[5000,15000,30000][attempt];
  for(const s of Object.values(p.statuses))s.seenAt=now+delay;
  e.step(p,now+delay);assert.equal(p.activeConvoy.phase,'shared-prepare');
  assert.equal(p.activeConvoy.returnRuntimeRetries,attempt+1);
  p.statuses.F.convoyNavigation.runtimeId='replacement-'+attempt;e.step(p,now+delay+1);
  now=p.activeConvoy.failedAt;
 }
 e.step(p,now+30000);assert.equal(p.activeConvoy.retryExhausted,true);
 assert.ok(p.activeConvoy.epoch>oldEpoch);assert.notEqual(p.commands.F.id,oldCommand);
});

test('return runtime recovery cannot overwrite a newer command or navigation revision',()=>{
 for(const kind of ['command','revision']){
  const p=party(),e=engine();p.activeConvoy.purpose='shared-walk-return';p.activeConvoy.navigationExempt=true;e.step(p,1000);
  p.statuses.F.convoyNavigation.runtimeId='new';e.step(p,1100);const time=p.activeConvoy.failedAt+5000;
  for(const s of Object.values(p.statuses))s.seenAt=time;
  if(kind==='command')p.commands.F={id:999,type:'character-travel'};
  else p.navigationIntents={F:{revision:99,cancelled:true}};
  e.step(p,time);assert.equal(p.activeConvoy.phase,'failed');assert.equal(p.activeConvoy.returnRuntimeRetries,undefined);
 }
});
function party(){
 const names=['L','F','P'];return {nextCommandId:10,commands:Object.fromEntries(names.map(n=>[n,{id:1,type:'party-monster-travel',convoyId:'test',epoch:7,navigationRevision:0}])),
 statuses:Object.fromEntries(names.map(n=>[n,{map:'main',x:0,y:0,speed:57,server:'USII',seenAt:1000,convoyProtocol:4,
 convoyNavigation:{runtimeId:n,phase:'assembled'}}])),
 activeConvoy:{id:'test',epoch:7,routeProtocol:4,phase:'assemble',leader:'L',participants:names,completed:[],slowestSpeed:57,
 rally:{map:'main',x:0,y:0},location:{map:'main',x:120,y:0},purpose:null,combatHandoffAllowed:true}};
}
function travellingParty() {
 const p=party(),e=engine();e.step(p,1000);
 for(const name of p.activeConvoy.participants){report(p,name,'travelling',1000);p.statuses[name].combatSelection={runtimeId:name};}
 p.activeConvoy.phase='travel';return {p,e};
}

function arrivedReturn() {
 const {p,e}=travellingParty(),c=p.activeConvoy;
 Object.assign(c,{purpose:'monster-hunt',continuousReturn:1,returnRouting:true,nonPreemptible:true,departAt:900});
 p.monsterHunt={stage:'returning'};p.combatLogs={};
 for(const name of c.participants){Object.assign(p.statuses[name],c.location);report(p,name,'arrived',1000);}
 return {p,e,c};
}

test('Daisy return recovers a missing leader completion after followers have acknowledged',()=>{
 const {p,e,c}=arrivedReturn();
 c.completed=['F','P'];delete p.commands.F;delete p.commands.P;
 p.statuses.F.convoyNavigation=null;p.statuses.P.convoyNavigation=null;
 e.step(p,1000);assert.equal(p.activeConvoy,c);
 report(p,'L','arrived',3999);e.step(p,3999);assert.equal(p.activeConvoy,c);
 report(p,'L','arrived',4000);assert.equal(e.step(p,4000),true);
 assert.equal(p.activeConvoy,null);assert.equal(p.commands.L,undefined);
 assert.deepEqual(c.completed,c.participants);
 assert.match(p.combatLogs.L.at(-1).details.reason,/missing completion/);
 assert.equal(p.monsterHunt.stage,'returning','normal Hunt tick still owns reward claims');
});

for(const mismatch of ['routeVersion','commandId','runtimeId','navigationRevision','position','phase','stale','new command'])
test('return completion recovery rejects '+mismatch,()=>{
 const {p,e,c}=arrivedReturn();e.step(p,1000);
 for(const name of c.participants)report(p,name,'arrived',4000);
 const s=p.statuses.L;
 if(mismatch==='position')s.x=1000;
 else if(mismatch==='phase')s.convoyNavigation.phase='travelling';
 else if(mismatch==='stale')s.seenAt=500;
 else if(mismatch==='new command')p.commands.L={id:999,type:'merchant-pickup'};
 else s.convoyNavigation[mismatch]='wrong';
 e.step(p,4000);assert.equal(p.activeConvoy,c);assert.notEqual(p.commands.L,undefined);
 assert.notEqual(p.combatLogs.L?.at(-1)?.message,'Convoy completed');
});
test('missing local routes regroup the Bee stop without replacing the Stoneworm destination',()=>{
 const {p,e}=travellingParty(),c=p.activeConvoy;
 c.purpose='monster-hunt';c.huntTarget='stoneworm';c.location={map:'spookytown',x:677,y:129};
 const destination=c.location;delete p.statuses.L.convoyNavigation;delete p.statuses.F.convoyNavigation;
 e.step(p,1000);assert.equal(c.phase,'travel');
 for(const s of Object.values(p.statuses))s.seenAt=4000;
 e.step(p,4000);assert.equal(c.phase,'shared-hold');assert.match(c.failure,/route disappeared/);
 for(const name of c.participants)report(p,name,'held',4001);
 e.step(p,4001);assert.equal(c.phase,'shared-prepare');assert.equal(c.location,destination);
 assert.equal(c.huntTarget,'stoneworm');assert.equal(c.recoveryAttempts,1);
});
test('transient missing reports reset and newer navigation cannot be overwritten by the watchdog',()=>{
 const {p,e}=travellingParty();delete p.statuses.F.convoyNavigation;e.step(p,1000);
 report(p,'F','travelling',2000);e.step(p,2000);delete p.statuses.F.convoyNavigation;
 for(const s of Object.values(p.statuses))s.seenAt=4000;
 e.step(p,4000);assert.equal(p.activeConvoy.phase,'travel');
 p.commands.F={id:999,type:'manual'};
 for(const s of Object.values(p.statuses))s.seenAt=7000;
 e.step(p,7000);assert.equal(p.activeConvoy.failureCode,'owner-lost');assert.equal(p.commands.F.id,999);
});
test('missing-route recovery does not count report gaps or override manual cancellation',()=>{
 const {p,e}=travellingParty();delete p.statuses.F.convoyNavigation;e.step(p,1000);
 for(const s of Object.values(p.statuses))s.seenAt=10000;
 e.step(p,10000);assert.equal(p.activeConvoy.phase,'travel','a stale gap restarts the observation window');
 p.navigationIntents={F:{revision:0,cancelled:true}};
 for(const s of Object.values(p.statuses))s.seenAt=13000;
 e.step(p,13000);assert.equal(p.activeConvoy.failureCode,'owner-lost');assert.equal(p.activeConvoy.recoveryAttempts,undefined);
});
test('a reported local defensive stop survives a threat disappearing before coordinator observation',()=>{
 const {p}=travellingParty(),c=p.activeConvoy;
 require('./helpers/travel-observations.cjs').observeTravel(p.statuses);
 c.purpose='party-travel';report(p,'F','defending',1000);
 const e=createSharedConvoyNavigation(legacy,require('../../runtime/coordinator/navigation/convoy-defense.ts').step);
 const destination=c.location;e.step(p,1000);assert.equal(c.phase,'defending');
 e.step(p,1100);assert.ok(c.loot);
 p.statuses.L.convoyLoot={...c.loot,complete:true,observedAt:1101};
 e.step(p,1101);e.step(p,1102);assert.equal(c.phase,'shared-prepare');assert.equal(c.location,destination);
});
function report(p,name,phase='route-ready',at=1000){const c=p.activeConvoy,cmd=p.commands[name],s=p.statuses[name];
 s.seenAt=at;s.convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:cmd.navigationRevision,
 runtimeId:name,routeVersion:c.routeVersion,phase,routeReady:phase==='route-ready'};}
function publication(p){const c=p.activeConvoy,cmd=p.commands.L;return {character:'L',convoyId:c.id,epoch:c.epoch,commandId:cmd.id,
 runtimeId:'L',navigationRevision:cmd.navigationRevision,routeVersion:c.routeVersion,
 route:{geometry:runtime().context.movement.identity,version:c.routeVersion,origin:c.rally,destination:c.location,plot:[{map:'main',x:0,y:0},{map:'main',x:120,y:0}],source:'search'}};}
function client(name,p,options={}){
 const r=runtime(options),c=r.context;r.context.character.name=name;c.convoyRuntimeId=name;
 c.convoySignal={...engine().signal(p,name,1000)};
 c.request=async(url,options)=>{
  if(url==='/convoy-route'){const error=publishSharedRoute(p,copy(options.body),1000);if(error)throw Error(error);return {ok:true,ready:true};}
  if(url.startsWith('/convoy-route?'))return {ok:true,route:copy(sharedRoute(p.activeConvoy))};
  r.calls.push(['request',url,options]);return {ok:true,ready:true};
 };
 return r;
}
test('leader plans while follower is away; installation acknowledgements gate departure',()=>{
 const p=party(),e=engine();p.statuses.F.x=100;
 assert.equal(e.step(p,1000),true);assert.equal(p.activeConvoy.phase,'shared-prepare');
 assert.equal(publishSharedRoute(p,publication(p),1000),null);
 for(const n of ['L','F','P'])report(p,n);
 e.step(p,1000);e.step(p,1600);assert.equal(p.activeConvoy.departAt,null);
 p.statuses.F.x=0;e.step(p,1700);e.step(p,2200);assert.equal(p.activeConvoy.departAt,6200);
});
test('three native runners execute one leader search and two independently copied routes',async()=>{
 const p=party(),e=engine();e.step(p,1000);
 const runners=['L','F','P'].map(n=>client(n,p));
 const restores=[0,0,0];
 runners.forEach((r,i)=>{r.context.partyPorcupineEquipment={depart(){restores[i]++;return new Promise(()=>{});}};});
 const starts=await Promise.all(runners.map((r,i)=>r.start(p.commands[['L','F','P'][i]])));
 for(let i=0;i<200 && !runners.every(r=>r.context.convoyTraveling.routeReady);i++){
  for(let j=0;j<3;j++){const r=runners[j];r.context.convoySignal=e.signal(p,['L','F','P'][j],1000);r.tick();}await settle();
 }
 assert.deepEqual(runners.map(r=>r.searches),[1,0,0]);
 assert.ok(runners.every(r=>r.context.convoyTraveling.routeReady));
 assert.deepEqual(restores,[0,0,0]);
 assert.notEqual(runners[0].context.movement.state.plot,runners[1].context.movement.state.plot);
 for(const n of ['L','F','P'])report(p,n);e.step(p,1000);e.step(p,1600);
 for(let j=0;j<3;j++){const r=runners[j];r.context.convoySignal={...e.signal(p,['L','F','P'][j],1600),validUntil:9000};r.tick();r.setNow(5550);}
 for(let i=0;i<30;i++){for(const r of runners)r.tick();await settle();}
 await Promise.all(starts.map(s=>s.promise));
 assert.deepEqual(runners.map(r=>r.context.character.x),[120,120,120]);
 assert.deepEqual(restores,[1,1,1]);
 assert.deepEqual(runners.map(r=>r.searches),[1,0,0]);
});
test('blocked waypoint requests regroup without starting native follower search',async()=>{
 const p=party(),e=engine();e.step(p,1000);publishSharedRoute(p,publication(p),1000);
 const r=client('F',p),started=await r.start(p.commands.F);r.context.convoySignal=e.signal(p,'F',1000);
 r.tick();await settle();assert.equal(r.context.convoyTraveling.routeReady,true);
 r.context.convoySignal={...r.context.convoySignal,phase:'scheduled',departAt:4000,validUntil:7000};r.tick();
 r.context.can_move_to=()=>false;r.setNow(3950);r.tick();await settle();
 assert.equal(r.searches,0);assert.match(r.context.convoyTraveling.failure,/blocked/);
 await r.cancel();await started.promise;
});
test('recovery invalidates old publication, holds all members and resumes at the stopped leader',()=>{
 const p=party(),e=engine();e.step(p,1000);const old=publication(p);publishSharedRoute(p,old,1000);
 e.hold(p,'missed departure');assert.equal(p.activeConvoy.phase,'shared-hold');
 assert.equal(sharedRoute(p.activeConvoy),undefined);assert.ok(publishSharedRoute(p,old,1100));
 const now=Date.now();for(const n of ['L','F','P'])report(p,n,'held',now);
 p.statuses.L.x=35;e.step(p,now);assert.equal(p.activeConvoy.phase,'shared-prepare');assert.equal(p.activeConvoy.rally.x,35);
 assert.equal(p.activeConvoy.routeVersion,2);assert.equal(p.activeConvoy.departAt,null);
});
test('publication rejects followers, conflicting duplicates, stale runtimes and malformed waypoints',()=>{
 const p=party(),e=engine();e.step(p,1000);const body=publication(p);
 assert.ok(publishSharedRoute(p,{...body,character:'F'},1000));
 assert.ok(publishSharedRoute(p,{...body,runtimeId:'old'},1000));
 assert.ok(publishSharedRoute(p,{...body,route:{...body.route,plot:[{map:'main',x:Infinity,y:0}]}},1000));
 assert.equal(publishSharedRoute(p,body,1000),null);assert.equal(publishSharedRoute(p,body,1100),null);
 assert.ok(publishSharedRoute(p,{...body,route:{...body.route,plot:[]}},1200));
});
test('new manual navigation is not overwritten by regroup recovery',()=>{
 const p=party(),e=engine();e.step(p,1000);p.commands.F={id:99,type:'character-travel'};
 e.step(p,1001);assert.equal(p.activeConvoy.failureCode,'owner-lost');assert.equal(p.commands.F.id,99);
});
test('failure context changes only diagnostics, retaining the original failure and request sequence',async()=>{
 const runs=[];
 for(const enabled of [false,true]){
  const p=party(),e=engine();e.step(p,1000);const r=client('L',p),logs=[];
  r.context.game_log=m=>logs.push(m);
  if(!enabled){r.context.captureConvoyFailureContext=()=>{};r.context.logConvoyFailureContext=()=>{};}
  const started=await r.start(p.commands.L);await r.ready();
  const phase=r.context.convoyTraveling.phase;
  r.context.convoySignal.validUntil=999;r.setNow(5000);r.tick();await settle();await settle();
  const failure=r.calls.find(c=>c[0]==='request'&&c[1]==='/convoy-failed');assert.ok(failure);
  assert.equal(failure[2].body.reason,'Shared route coordinator signal expired');
  assert.equal(failure[2].body.failureCode,'route-failed');
  if(enabled){assert.equal(failure[2].body.details.failureContext.phase,phase);assert.equal(failure[2].body.details.failureContext.signal.state,'expired');assert.equal(logs.filter(m=>/^Convoy (context|signal):/.test(m)).length,2);}
  await r.cancel();await started.promise;
  const body=copy(failure[2].body);delete body.details.failureContext;
  runs.push({body,requests:r.calls.filter(c=>c[0]==='request').map(c=>c[1]),moves:r.moves(),searches:r.searches});
 }
 assert.deepEqual(runs[1],runs[0]);
});
test('Hunt signal expiry stops the native route and reports a communication hold without failing movement',async()=>{
 const p=party(),e=engine();p.activeConvoy.purpose='monster-hunt';e.step(p,1000);
 const r=client('L',p),started=await r.start(p.commands.L);await r.ready();
 r.context.convoySignal.validUntil=999;r.setNow(5000);r.tick();await settle();await settle();
 assert.equal(r.context.convoyTraveling.phase,'communication-hold');
 assert.equal(r.context.convoyTraveling.communication.operation,'/status');
 assert.equal(r.context.convoyTraveling.communication.kind,'expired-signal');
 assert.equal(r.calls.some(c=>c[0]==='request'&&c[1]==='/convoy-failed'),false);
 const moves=r.moves().length;r.setNow(500000);r.tick();await settle();assert.equal(r.moves().length,moves);
 await r.cancel();await started.promise;
});
test('Hunt conflicting signal identity remains a genuine failure',async()=>{
 const p=party(),e=engine();p.activeConvoy.purpose='monster-hunt';e.step(p,1000);
 const r=client('L',p),started=await r.start(p.commands.L);await r.ready();
 r.context.convoySignal.runtimeId='replacement';r.setNow(5000);r.tick();await settle();await settle();
 assert.equal(r.context.convoyTraveling.phase,'failed');assert.equal(r.context.convoyTraveling.communication,undefined);
 assert.ok(r.calls.some(c=>c[0]==='request'&&c[1]==='/convoy-failed'));
 await r.cancel();await started.promise;
});
test('paused leader retains the issued waypoint and regroups using native fallback after a route failure',async()=>{
 const p=party(),e=engine();e.step(p,1000);const r=client('L',p,{nativeMovingFlag:true});
 const first=await r.start(p.commands.L);await r.ready();
 r.context.convoySignal={...r.context.convoySignal,phase:'scheduled',departAt:4000,validUntil:9000};r.tick();r.setNow(3950);
 r.tick();r.context.character.moving=false;
 r.context.move=async(x,y)=>{r.context.character.moving=true;r.context.character.going_x=x;r.context.character.going_y=y;};
 for(let i=0;i<6 && r.context.character.going_x!==120;i++){r.tick();await settle();}r.context.character.x=45;r.context.convoyTraveling.freezeRoute();
 assert.equal(r.context.__partySharedRouteRemainder.plot[0].x,120);
 await r.cancel();await first.promise;r.context.character.moving=false;
 e.hold(p,'Shared route rejected: unwalkable segment');const now=Date.now();for(const n of ['L','F','P'])report(p,n,'held',now);
 p.statuses.L.x=45;e.step(p,now);r.context.convoySignal=e.signal(p,'L',now);
 const second=await r.start(p.commands.L);await r.ready();
 assert.equal(r.searches,2);assert.equal(r.context.convoyTraveling.routeReady,true);
 assert.equal(sharedRoute(p.activeConvoy).source,'search');assert.equal(sharedRoute(p.activeConvoy).plot.at(-1).x,120);
 await r.cancel();await second.promise;
});
test('transport and Town waypoints remain native operations on an imported route',async()=>{
 const p=party(),e=engine();p.activeConvoy.location={map:'cave',x:120,y:0};e.step(p,1000);
 const r=client('F',p);r.context.G.maps.main.doors=[[0,0,0,0,'cave',0,0]];
 const body=publication(p);body.route.plot=[{map:'main',x:0,y:0,town:true},{map:'cave',x:0,y:0,transport:true,s:0},{map:'cave',x:120,y:0}];
 body.route.geometry={version:16846,fingerprint:require('../../runtime/navigation/contracts.ts').geometryFingerprint(r.context.G)};
 assert.equal(publishSharedRoute(p,body,1000),null);
 const start=await r.start(p.commands.F);r.context.convoySignal=e.signal(p,'F',1000);r.tick();await settle();
 assert.equal(r.searches,0);assert.equal(r.calls.some(c=>c[0]==='transport'||c[0]==='use'),false);
 r.context.convoySignal={...r.context.convoySignal,phase:'scheduled',departAt:4000,validUntil:9000};r.tick();r.setNow(3950);
 for(let i=0;i<80;i++){r.tick();await settle();}await start.promise;
 assert.ok(r.calls.some(c=>c[0]==='use'&&c[1]==='town'));assert.ok(r.calls.some(c=>c[0]==='transport'));
 assert.equal(r.context.character.map,'cave');assert.equal(r.context.character.x,120);assert.equal(r.searches,0);
});
test('mixed runtimes cannot begin and retry exhaustion retains a hold',()=>{
 const p=party(),e=engine();p.statuses.F.convoyProtocol=2;assert.equal(e.step(p,1000),false);assert.equal(p.activeConvoy.phase,'assemble');
 p.statuses.F.convoyProtocol=4;e.step(p,1000);p.activeConvoy.recoveryAttempts=3;e.hold(p,'blocked');
 assert.equal(p.activeConvoy.phase,'failed');assert.match(p.activeConvoy.failure,/exhausted/);
});


test('stable heartbeat runtime survives idle convoy reports, but replacement fails',()=>{
 const p=party(),e=engine();
 for(const n of ['L','F','P']) {p.statuses[n].combatSelection={runtimeId:n};delete p.statuses[n].convoyNavigation;}
 e.step(p,1000);assert.equal(p.activeConvoy.phase,'shared-prepare');
 e.step(p,1100);assert.equal(p.activeConvoy.phase,'shared-prepare');assert.equal(p.activeConvoy.departAt,null);
 p.statuses.F.combatSelection.runtimeId='replacement';e.step(p,1200);
 assert.equal(p.activeConvoy.failureCode,'runtime-lost');
});
test('failed event entry releases matching commands, retains history and preserves superseding navigation',()=>{
 const p=party(),e=engine();Object.assign(p.activeConvoy,{purpose:'shared-walk',label:'event walking leg',walkingActivity:'event'});
 e.step(p,1000);p.commands.F={id:500,type:'manual',navigationRevision:1};
 e.hold(p,'lost runtime','runtime-lost');
 assert.equal(p.commands.L.phase,'event-walk-release');assert.equal(p.commands.F.type,'manual');
 assert.equal(p.activeConvoy.failure,'lost runtime');const id=p.commands.L.id;e.step(p,1100);assert.equal(p.commands.L.id,id);
 p.commands.P.phase='hold';e.step(p,1200);assert.equal(p.commands.P.phase,'event-walk-release','persisted hold migrates');
});
test('event release cannot bypass cancellation or an event return hold',()=>{
 const p=party(),e=engine();Object.assign(p.activeConvoy,{phase:'failed',purpose:'shared-walk',label:'event walking leg'});
 p.navigationIntents={L:{revision:0,cancelled:true}};e.step(p,1000);assert.notEqual(p.commands.L.phase,'event-walk-release');
 const r=party();Object.assign(r.activeConvoy,{purpose:'shared-walk-return',navigationExempt:true});
 engine().hold(r,'failed','runtime-lost');assert.equal(r.commands.L.phase,'hold');
});
test('leave failure regroups with ALClient and carries avoidance to every member',()=>{
 const p=party(),e=engine();e.step(p,1000);e.hold(p,'Leave transition failed: cant_escape','route-failed');
 assert.equal(p.activeConvoy.avoidLeave,true);assert.equal(p.activeConvoy.nativeFallback,false);
 for(const name of ['L','F','P'])assert.equal(p.commands[name].avoidLeave,true);
});
test('shared route transport preserves leave metadata and rejects conflicting flags',()=>{
 const p=party(),e=engine();e.step(p,1000);const body=publication(p);
 body.route.plot=[{map:'main',x:0,y:0,method:'leave'},{map:'main',x:120,y:0}];
 assert.equal(publishSharedRoute(p,body,1000),null);assert.equal(sharedRoute(p.activeConvoy).plot[0].method,'leave');
 body.route.plot[0].town=true;assert.ok(publishSharedRoute(p,body,1000));
});

test('return preparation identifies missing acknowledgements and clears the reason after readiness',()=>{
 const p=party(),e=engine();p.activeConvoy.returnRouting=true;p.activeConvoy.continuousReturn=1;
 e.step(p,1000);e.step(p,1001);assert.match(p.activeConvoy.preparationBlocker,/acknowledgement: L \(no local return handle\), F \(no local return handle\), P \(no local return handle\)/);
 for(const name of ['L','F','P'])report(p,name);
 e.step(p,1100);assert.match(p.activeConvoy.preparationBlocker,/L to publish/);
 assert.equal(publishSharedRoute(p,publication(p),1100),null);
 e.step(p,1200);assert.equal(p.activeConvoy.preparationBlocker,undefined);
 e.step(p,1800);assert.equal(p.activeConvoy.phase,'scheduled');
 const {createHuntRecovery}=require('../../runtime/coordinator/hunt/recovery.ts');
 const hunt={stage:'returning'};p.activeConvoy.phase='shared-prepare';p.activeConvoy.preparationBlocker='Waiting for current route acknowledgement: L';
 createHuntRecovery(p,{}).returnMessage(hunt);assert.match(hunt.message,/acknowledgement: L/);
});

test('Hunt arrival requires the installed route endpoint, not just membership in a broad spawn area',()=>{
 const {p,c}=scheduledParty();c.purpose='monster-hunt';c.huntTarget='bee';
 c.location={...c.location,boundary:[-1000,-1000,1000,1000]};
 const destination=sharedRoute(c).destination;
 const {sharedArrivalReady}=require('../../runtime/coordinator/navigation/shared-route-store.ts');
 for(const name of c.participants){report(p,name,'arrived',2000);Object.assign(p.statuses[name],destination);}
 assert.equal(sharedArrivalReady(p,2000),true);
 p.statuses.F.x-=100;assert.equal(sharedArrivalReady(p,2000),false);
 Object.assign(p.statuses.F,destination);p.statuses.F.rip=true;assert.equal(sharedArrivalReady(p,2000),false);
 p.statuses.F.rip=false;p.statuses.F.seenAt=-2000;assert.equal(sharedArrivalReady(p,2000),false);
});
