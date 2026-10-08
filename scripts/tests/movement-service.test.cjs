const test=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {installPartyMovement}=require('../../runtime/characters/movement.ts');
const {validateRoute}=require('../../runtime/navigation/validation.ts');
const {geometryFingerprint}=require('../../runtime/navigation/contracts.ts');
const {createPlannerService}=require('../../runtime/coordinator/navigation/planner-service.ts');
const {createNative}=require('../../tools/game/pathfinder-benchmark/native.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('a Cave follower waits without searching, then validates and executes the shared route',async()=>{
 const r=fixture(), p=r.service.move({map:'main',x:100,y:0},undefined,{native:true,shared:true,awaitSharedRoute:true});
 await r.ticks(5);assert.equal(r.searches,0);assert.equal(r.service.state.found,false);
 assert.throws(()=>r.service.install([{map:'main',x:100,y:0}],{version:0,fingerprint:'wrong'}),/geometry mismatch/);
 r.service.install([{map:'main',x:100,y:0}],r.service.identity,'cave-convoy');
 await r.ticks(8);await p;assert.equal(r.c.real_x,100);assert.equal(r.searches,0);r.dispose();
});

test('a Cave search uses its declared longer budget while preserving a finite deadline',async()=>{
 const r=fixture();r.host.__partyNativeMovement.start=()=>{r.host.smart.searching=true;};
 const p=r.service.move({map:'main',x:100,y:0},undefined,{native:true,shared:true,nativePlanningTimeoutMs:90000});
 const failed=assert.rejects(p,/90 seconds/);
 await r.ticks(1);r.setNow(32000);await r.ticks(1);assert.equal(r.service.state.moving,true);
 r.setNow(92000);await r.ticks(1);await failed;r.dispose();
});

test('route import refreshes and normalizes the game version, retaining strict fingerprint validation',()=>{
 const r=fixture();r.host.parent.__partyClientVersion='17139';
 assert.throws(()=>r.service.install([],{version:17139,fingerprint:'incorrect'}),/expected.*incorrect.*actual.*17139/);
 assert.equal(r.service.identity.version,17139);
 r.host.parent.__partyClientVersion='17140';
 assert.throws(()=>r.service.install([],{version:17139,fingerprint:r.service.identity.fingerprint}),/game geometry mismatch/);
 assert.equal(r.service.identity.version,17140);r.dispose();
});
test('diagnostics snapshot coordinates and deduplicate independently of mutable movement state',()=>{
 const {movementDiagnostics}=require('../../runtime/characters/movement-diagnostics.ts');
 let now=1000;const logs=[];
 const report=movementDiagnostics({now:()=>now,diagnostic:(data,message)=>logs.push({data,message})},'Test',16846,'geometry');
 const destination={map:'main',x:100,y:0,moving:true,plot:[{map:'main',x:100,y:0}]};
 const issue={reason:'collisions detected',from:{map:'main',x:0,y:0},to:{map:'main',x:50,y:0}};
 report('runtime:1',destination,'Route rejected',issue,'falling back to native smart_move');
 destination.moving=false;destination.plot=[];
 report('runtime:1',destination,'Route rejected',issue,'falling back to native smart_move');
 assert.equal(logs.length,1);assert.deepEqual(logs[0].data.destination,{map:'main',x:100,y:0});
 now+=10001;report('runtime:1',destination,'Route rejected',issue,'falling back to native smart_move');
 assert.equal(logs[1].data.count,3);assert.match(logs[1].message,/Similar messages: 3 \(not route attempts\)/);
 destination.x=200;issue.to.x=80;
 assert.equal(logs[0].data.destination.x,100);assert.equal(logs[0].data.issue.to.x,50);
});
function fixture(options={}) {
 let now=1000, revision=1, runtime='test', searches=0, request;
 const calls=[], logs=[], c={name:'Test',map:'main',in:'main',x:0,y:0,real_x:0,real_y:0,speed:60,base:{h:8,v:7,vn:2},items:[],moving:false};
 const G={version:16846,geometry:{},maps:{main:{spawns:[[0,0]],doors:[],npcs:[]},bank:{spawns:[[0,0]],doors:[],npcs:[]}},npcs:{transporter:{places:{}}}};
 const host={character:c,G,smart:{moving:false,plot:[]},parent:{socket:{emit:(...a)=>calls.push(a)},push_deferred:()=>Promise.resolve()},
  smart_move:()=>{host.smart.moving=true;host.smart.found=false;host.smart.searching=false;return Promise.resolve();},
  stop:async()=>{host.smart.moving=false;},smart_move_logic(){},start_pathfinding:()=>{searches++;host.smart.found=true;host.smart.plot=options.nativePlot||[{map:'main',x:100,y:0}];},continue_pathfinding(){},
  move:async(x,y)=>{calls.push(['move',x,y]);if(!options.stall)Object.assign(c,{x,y,real_x:x,real_y:y});},use:async()=>{calls.push(['town']);Object.assign(c,{x:0,y:0,real_x:0,real_y:0});},
  can_use:()=>true,can_walk:()=>true,is_transporting:()=>false,can_move:p=>!(options.collision&&p.going_x===50),
  is_door_close:()=>true,can_use_door:()=>true,find_npc:()=>null,game_log(){} };
 const ports={now:()=>now,context:()=>({runtime,revision,current:true,paused:false}),
  request:async(_,o)=>{request=o.body;if(options.pending)return new Promise(resolve=>{fixture.resolve=resolve;});if(options.offline)throw Error(options.planError || 'offline');return {...request,plot:options.plot||[{map:'main',x:100,y:0}]};},
  diagnostic:(e,m)=>logs.push({...e,message:m})};
 const service=installPartyMovement(host,ports);
 return {service,host,c,calls,logs,ports,get request(){return request;},get searches(){return searches;},setNow:t=>now=t,supersede:()=>revision++,reload:()=>runtime='new',
  async ticks(count=8){for(let i=0;i<count;i++){host.smart_move_logic();await settle();}},dispose:()=>service.dispose()};
}

test('interrupted walking reissues its owned segment once and finishes',async()=>{
 const opts={stall:true},r=fixture(opts),p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});
 await r.ticks();assert.equal(r.calls.filter(c=>c[0]==='move').length,1);
 opts.stall=false;r.setNow(1300);await r.ticks();await p;
 assert.equal(r.calls.filter(c=>c[0]==='move').length,2);assert.equal(r.c.real_x,100);r.dispose();
});
test('a reissued walk retains its original no-progress deadline and reports the failed segment',async()=>{
 const r=fixture({stall:true}),p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});
 const rejected=assert.rejects(p,/Stalled walking movement/);await r.ticks();
 r.setNow(1400);await r.ticks();r.setNow(4500);await r.ticks();
 assert.equal(r.calls.filter(c=>c[0]==='move').length,2);
 r.setNow(6100);await r.ticks();await rejected;
 assert.equal(r.service.last().progress.noProgressMs,5100);assert.equal(r.service.last().progress.reissued,true);
 assert.equal(r.service.last().progress.destination.x,100);r.dispose();
});
for(const mode of ['collision','locked','superseded'])test('stopped segment retry respects '+mode,async()=>{
 const r=fixture({stall:true}),p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});
 const rejected=assert.rejects(p);await r.ticks();
 if(mode==='collision')r.host.can_move=()=>false;
 if(mode==='locked')r.host.can_walk=()=>false;
 if(mode==='superseded')r.supersede();
 r.setNow(1400);await r.ticks();
 assert.equal(r.calls.filter(c=>c[0]==='move'&&c[1]===100).length,1);
 r.dispose();await rejected;
});

test('combat handoff records an intentional travel pause without reporting a navigation failure',async()=>{
 const r=fixture({pending:true}),journey=r.service.move({map:'main',x:100,y:0});
 const rejected=assert.rejects(journey,/Combat handoff/);r.service.combatHandoff();await rejected;
 assert.equal(r.service.last().reason,'Combat handoff');
 assert.ok(r.logs.some(log=>log.phase==='Travel paused for combat'));
 assert.ok(!r.logs.some(log=>log.phase==='Movement failed'));r.dispose();
});
test('ALClient planning executes validated segments, uses actual speed and permits town',async()=>{
 const r=fixture();const p=r.service.move({map:'main',x:100,y:0});await r.ticks();await p;
 assert.equal(r.request.town,true);assert.equal(r.request.speed,60);assert.equal(r.searches,0);assert.equal(r.c.x,100);r.dispose();
});

test('Town arrival waits past the cast deadline for a follower without recasting or failing',async()=>{
 let follower=false;
 const r=fixture({plot:[{map:'main',x:0,y:0,town:true},{map:'main',x:100,y:0}]});
 const p=r.service.move({map:'main',x:100,y:0},undefined,{barrier:async(_s,_i,completed)=>!completed||follower});
 await r.ticks(3);r.setNow(1400);await r.ticks(6);
 assert.equal(r.service.transition(),'town');
 r.setNow(15000);await r.ticks(5);assert.equal(r.service.state.moving,true);
 follower=true;r.setNow(15500);await r.ticks(12);await p;
 assert.equal(r.calls.filter(c=>c[0]==='town').length,1);
 assert.equal(r.c.real_x,100);r.dispose();
});

test('Hunt Town reports actual casts and settled arrivals before the follower arrival barrier',async()=>{
 const r=fixture({plot:[{map:'main',x:0,y:0,town:true},{map:'main',x:100,y:0}]}),outcomes=[];
 let follower=false;
 const p=r.service.move({map:'main',x:100,y:0},undefined,{townAttempt:s=>outcomes.push(s),barrier:async(_s,_i,done)=>!done||follower});
 await r.ticks(3);r.setNow(1400);await r.ticks(6);
 assert.equal(outcomes[0],'casting');assert.ok(outcomes.includes('complete'));
 assert.equal(outcomes.includes('interrupted'),false);assert.equal(r.service.state.moving,true);
 follower=true;r.setNow(1800);await r.ticks(12);await p;r.dispose();
});

test('Town cooldown waits do not count as interrupted casts and become map-local walking fallback',()=>{
 const r=fixture(),outcomes=[],{createMovementExecutor}=require('../../runtime/characters/movement-executor.ts');
 let now=1000;r.host.can_use=()=>false;
 const e=createMovementExecutor(r.host,{plot:[{map:'main',x:0,y:0,town:true}],use_town:true},
  {game:r.host.G,walk:()=>true,door:()=>true},()=>now);
 const options={townAttempt:s=>outcomes.push(s),barrier:async()=>false};
 e.tick(options);assert.deepEqual(outcomes,[]);now+=5000;
 assert.throws(()=>e.tick(options),/Town unavailable/);assert.deepEqual(outcomes,['unavailable']);
 assert.equal(r.calls.length,0);r.dispose();
});

test('Town cast rejection reports interruption but cooldown rejection does not',async()=>{
 for(const reason of ['interrupted','cooldown']) {
  const r=fixture(),outcomes=[],{createMovementExecutor}=require('../../runtime/characters/movement-executor.ts');
  r.host.use=async()=>{throw {reason};};
  const e=createMovementExecutor(r.host,{plot:[{map:'main',x:0,y:0,town:true}],use_town:true},
   {game:r.host.G,walk:()=>true,door:()=>true},()=>1000);
  const options={townAttempt:s=>outcomes.push(s)};
  e.tick(options);await settle();assert.throws(()=>e.tick(options));
  assert.deepEqual(outcomes,['casting',reason==='cooldown'?'unavailable':'interrupted']);r.dispose();
 }
});
test('planner transport errors do not silently switch to native pathfinding',async()=>{
 const r=fixture({offline:true}),p=r.service.move({map:'main',x:100,y:0}),failed=assert.rejects(p,/offline/);
 await r.ticks();await failed;assert.equal(r.searches,0);r.dispose();
});

for(const reason of ['ALClient found no route','Native-only movement mode enabled','Planner worker exited'])
test('movement HTTP planner rejection starts native fallback: '+reason,async()=>{
 const {installMovementRoutes}=require('../../runtime/coordinator/http/movement.ts');
 let handler, responseStatus, responseBody;
 installMovementRoutes({post:(_path,callback)=>handler=callback},{mode:'alclient',plan:async()=>{throw Error(reason);}},()=>true);
 const r=fixture();
 r.ports.request=async(_path,{body})=>{
  responseStatus=200;
  await handler({body},{status(code){responseStatus=code;return this;},json(value){responseBody=value;}});
  if(responseStatus>=400)throw Object.assign(Error(responseBody.error),{partyRequest:{kind:'http',status:responseStatus}});
  return responseBody;
 };
 const p=r.service.move({map:'main',x:100,y:0});
 const outcome=p.then(()=>null,error=>error);
 await r.ticks(12);
 assert.equal(await outcome,null);
 assert.equal(responseStatus,200);assert.equal(responseBody.mode,'alclient');
 assert.equal(r.searches,1);assert.equal(r.c.real_x,100);
 assert.ok(r.logs.some(log=>log.phase==='Trying native pathfinding' && log.issue.reason===reason));
 assert.equal(r.logs.at(-1).phase,'Native fallback succeeded');r.dispose();
});

for(const request of [{kind:'network',status:0},{kind:'timeout',status:0},{kind:'http',status:503}])
test('movement communication hold remains distinct from route failure: '+request.kind,async()=>{
 const r=fixture(),error=Object.assign(Error('Coordinator unavailable'),{partyRequest:request});
 r.ports.request=async()=>{throw error;};
 const p=r.service.move({map:'main',x:100,y:0});
 const rejected=assert.rejects(p,e=>e===error && e.movementReported===true);
 await r.ticks();await rejected;
 assert.equal(r.searches,0);assert.equal(r.service.last().failureContext.code,'convoy-communication-hold');
 assert.equal(r.logs.at(-1).phase,'Movement paused: coordinator communication unavailable');r.dispose();
});
test('planning-origin drift retries ALClient without native fallback',async()=>{
 const r=fixture({pending:true}),p=r.service.move({map:'main',x:100,y:0});
 await r.ticks(1);const first=r.request;Object.assign(r.c,{x:10,real_x:10});
 fixture.resolve({...first,plot:[{map:'main',x:100,y:0}]});await settle();await r.ticks(1);
 assert.equal(r.request.from.x,10);assert.equal(r.searches,0);
 fixture.resolve({...r.request,plot:[{map:'main',x:100,y:0}]});await r.ticks();await p;r.dispose();
});

test('precision arrival completes coarse ALClient and native endpoints without leaking tolerance',async()=>{
 for(const offline of [false,true]) {
  const plot=[{map:'main',x:85,y:0}],r=fixture({offline,planError:'Path not found',plot,nativePlot:plot});
  const p=r.service.move({map:'main',x:100,y:0},undefined,{arrivalTolerance:1});
  await r.ticks(14);await p;
  assert.equal(r.c.x,100);assert.ok(r.calls.some(c=>c[0]==='move'&&c[1]===100));
  const next=r.service.move({map:'main',x:100,y:0});
  assert.equal(r.service.state.edge,20);await r.ticks(14);await next;r.dispose();
 }
});

test('precision arrival rejects a blocked connector in both planners',async()=>{
 const plot=[{map:'main',x:40,y:0}],r=fixture({collision:true,plot,nativePlot:plot});
 const p=r.service.move({map:'main',x:50,y:0},undefined,{arrivalTolerance:1});
 const failed=assert.rejects(p,/Native route rejected: collisions/);
 await r.ticks(14);await failed;assert.equal(r.calls.length,0);r.dispose();
});

for(const native of [false,true])test('blocked final waypoint within tolerance is trimmed for '+(native?'native':'ALClient'),async()=>{
 const plot=[{map:'main',x:40,y:0},{map:'main',x:50,y:0}];
 const r=fixture({collision:true,plot,nativePlot:plot});
 const p=r.service.move({map:'main',x:50,y:0},undefined,{native});
 await r.ticks(14);await p;
 assert.equal(r.c.x,40);assert.equal(r.calls.some(c=>c[0]==='move'&&c[1]===50),false);
 assert.equal(r.searches,native?1:0);assert.equal(r.logs.some(l=>l.phase==='ALClient route rejected'),false);
 assert.equal(plot.length,2,'planner result is not mutated');r.dispose();
});

for(const options of [{arrivalTolerance:1},{shared:true},{}])test('blocked endpoint cannot bypass precision, shared, or distance requirements '+JSON.stringify(options),async()=>{
 const previous=Object.keys(options).length?40:20;
 const plot=[{map:'main',x:previous,y:0},{map:'main',x:50,y:0}],r=fixture({collision:true,plot,nativePlot:plot});
 const p=r.service.move({map:'main',x:50,y:0},undefined,options),failed=assert.rejects(p,/collisions/);
 await r.ticks(14);await failed;assert.equal(r.calls.length,0);r.dispose();
});

test('endpoint trim never removes a final transition or conceals an earlier collision',async()=>{
 for(const plot of [
  [{map:'main',x:40,y:0},{map:'main',x:50,y:0,town:true}],
  [{map:'main',x:50,y:0},{map:'main',x:40,y:0},{map:'main',x:50,y:0}],
 ]) {
  const r=fixture({collision:true,plot,nativePlot:plot});
  const p=r.service.move({map:'main',x:50,y:0}),failed=assert.rejects(p,/Native route rejected/);
  await r.ticks(14);await failed;assert.equal(r.calls.length,0);r.dispose();
 }
});

test('cancellation prevents dispatching the precision final approach',async()=>{
 const r=fixture({plot:[{map:'main',x:85,y:0}]});
 const p=r.service.move({map:'main',x:100,y:0},undefined,{arrivalTolerance:1}),failed=assert.rejects(p);
 await r.ticks(2);await r.service.stop('smart');await r.ticks(8);await failed;
 assert.equal(r.calls.some(c=>c[0]==='move'&&c[1]===100),false);r.dispose();
});
test('collision produces actionable coordinates and native fallback outcome',async()=>{
 const r=fixture({collision:true,plot:[{map:'main',x:50,y:0},{map:'main',x:100,y:0}]});
 const p=r.service.move({map:'main',x:100,y:0});await r.ticks(12);await p;
 assert.equal(r.searches,2);assert.equal(r.calls.some(c=>c[1]===50),false);
 assert.match(r.logs.find(l=>l.phase==='Trying native pathfinding').message,/collisions detected between main \(0, 0\) and main \(50, 0\).*falling back to native smart_move/);
 assert.equal(r.logs.at(-1).phase,'Native fallback succeeded');r.dispose();
});
test('late plan cannot restart cancelled or superseded navigation',async()=>{
 for(const change of ['stop','supersede','reload']){
  const r=fixture({pending:true}),p=r.service.move({map:'main',x:100,y:0});const failed=assert.rejects(p);
  await r.ticks(1);const request=r.request;if(change==='stop')await r.service.stop('smart');else r[change]();
  fixture.resolve({...request,plot:[{map:'main',x:100,y:0}]});await r.ticks();await failed;
  assert.equal(r.calls.length,0);r.dispose();
 }
});
test('native fallback also rejects collisions and exposes terminal failure',async()=>{
 const r=fixture({offline:true,planError:'Path not found',collision:true,nativePlot:[{map:'main',x:50,y:0},{map:'main',x:100,y:0}]});
 const p=r.service.move({map:'main',x:100,y:0}),failed=assert.rejects(p,e=>/Native route rejected/.test(e.message) && e.movementReported===true);
 await r.ticks();await failed;assert.equal(r.calls.length,0);assert.equal(r.logs.at(-1).phase,'Movement failed');
 assert.match(r.service.last().failureContext.firstIssue.reason,/Path not found/);
 assert.equal(r.service.last().failureContext.code,'route-failed');r.dispose();
});
test('execution stalls have exactly two bounded native recovery attempts',async()=>{
 const r=fixture({stall:true}),p=r.service.move({map:'main',x:100,y:0}),failed=assert.rejects(p,/Stalled/);
 await r.ticks();for(let i=1;i<=3;i++){r.setNow(1000+6000*i);await r.ticks();}
 await failed;assert.equal(r.searches,2);assert.equal(r.service.report(),null);r.dispose();
});
test('shared route execution fails to coordinator without independent follower replanning',async()=>{
 const r=fixture({stall:true}),p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true}),failed=assert.rejects(p,/Stalled/);
 await r.ticks();r.setNow(7000);await r.ticks();await failed;assert.equal(r.searches,0);r.dispose();
});
test('town prohibition rejects a town edge even if planner returns one',async()=>{
 const r=fixture({plot:[{map:'main',x:0,y:0,town:true},{map:'main',x:100,y:0}]});
 const p=r.service.move({map:'main',x:100,y:0},undefined,{town:false});await r.ticks(12);await p;
 assert.equal(r.request.town,false);assert.equal(r.calls.some(c=>c[0]==='town'),false);assert.match(r.logs[0].message,/town warp prohibited/);r.dispose();
});
test('real pinned planner worker uses native collision validation and geometry identity',async()=>{
 const {version,directory}=require('./helpers/installed-game.cjs');const n=createNative(directory,'native-visible');
 const service=createPlannerService(path.resolve('.build/runtime/movement-planner.cjs'));
 try {
  const prepared=service.prepare(n.game,version);await prepared.ready;
  const from={map:'main',x:0,y:0},to={map:'halloween',x:0,y:0};
  const result=await service.plan({id:'probe',from,to,speed:60,town:true,version,fingerprint:prepared.fingerprint});
  assert.ok(result.plot.some(p=>p.town));assert.ok(result.ms<2000);
  const ports={game:n.game,walk:(a,b)=>n.canWalk(a,b),door:(p,d)=>n.context.is_door_close(p.map,d,p.x,p.y)&&n.context.can_use_door(p.map,d,p.x,p.y),hasKey:()=>false};
  assert.equal(validateRoute(ports,from,to,result.plot,true),null);
  await assert.rejects(service.plan({id:'wrong',from,to,speed:60,town:true,version:version+1,fingerprint:prepared.fingerprint}),/compatible/);
  assert.equal(geometryFingerprint(n.game),prepared.fingerprint);
 } finally{service.dispose();}
});
test('geometry identity ignores renderer decoration but detects same-version collision changes',()=>{
 const r=fixture(),before=geometryFingerprint(r.host.G);
 r.host.G.geometry.main={x_lines:[],y_lines:[],data:{tiles:[1,2],placements:[5]}};
 r.host.G.maps.main.npcs=[{id:'npc',position:[1,2],color:'white',sprite:{}}];
 r.host.G.maps.main.data=r.host.G.geometry.main;
 assert.equal(geometryFingerprint(r.host.G),before);
 r.host.G.geometry.main.x_lines.push([50,-10,10]);assert.notEqual(geometryFingerprint(r.host.G),before);r.dispose();
});
test('another instance cannot be mistaken for arrival on the same map',async()=>{
 const r=fixture();await assert.rejects(r.service.move({map:'main',in:'other',x:0,y:0}),/another instance/);assert.equal(r.calls.length,0);r.dispose();
});
test('town stays pending until game acknowledgement, even when starting at the town spawn',async()=>{
 const r=fixture({plot:[{map:'main',x:0,y:0,town:true},{map:'main',x:100,y:0}]});let acknowledge;
 r.host.town=()=>new Promise(resolve=>{acknowledge=resolve;});const p=r.service.move({map:'main',x:100,y:0});
 await r.ticks();assert.equal(r.c.x,0);assert.equal(r.service.state.plot[0].town,true);
 acknowledge({success:true});await r.ticks();await p;assert.equal(r.c.x,100);r.dispose();
});
test('observed scattered town arrival reconnects to the route through a validated walking segment',async()=>{
 const r=fixture({plot:[{map:'main',x:0,y:0,town:true},{map:'main',x:100,y:0}]});
 r.host.town=async()=>{Object.assign(r.c,{x:-30,y:-23,real_x:-30,real_y:-23});return {success:true};};
 const p=r.service.move({map:'main',x:100,y:0});await r.ticks(15);await p;
 assert.ok(r.calls.some(c=>c[0]==='move'&&c[1]===0&&c[2]===0));assert.equal(r.searches,0);assert.equal(r.c.x,100);r.dispose();
});
for(const arrivalFirst of [false,true]) test('leave waits for both acknowledgment and arrival, once only; arrivalFirst='+arrivalFirst,async()=>{
 const r=fixture({plot:[{map:'main',x:0,y:0,method:'leave'}]});
 r.host.G.maps.cyberland={spawns:[[0,0]]};Object.assign(r.c,{map:'cyberland',in:'cyberland'});
 let acknowledge;r.host.parent.push_deferred=key=>{assert.equal(key,'leave');return new Promise(resolve=>acknowledge=resolve);};
 const p=r.service.move({map:'main',x:0,y:0});await r.ticks(4);
 assert.equal(r.calls.filter(c=>c[0]==='leave').length,1);
 if(arrivalFirst)Object.assign(r.c,{map:'main',in:'main',real_x:5,x:5});else acknowledge();
 await r.ticks(3);assert.equal(r.service.state.moving,true);
 if(arrivalFirst)acknowledge();else Object.assign(r.c,{map:'main',in:'main',real_x:5,x:5});
 await r.ticks(8);await p;assert.equal(r.c.real_x,0);assert.equal(r.searches,0);assert.equal(r.service.last().transitions,1);r.dispose();
});
test('leave rejection replans ALClient without native fallback',async()=>{
 const r=fixture({plot:[{map:'main',x:0,y:0,method:'leave'}]});r.host.G.maps.cyberland={spawns:[[0,0]]};Object.assign(r.c,{map:'cyberland',in:'cyberland'});
 r.host.parent.push_deferred=()=>Promise.reject(Error('cant_escape'));
 const p=r.service.move({map:'main',x:0,y:0}),failed=assert.rejects(p,/Leave transition failed/);
 await r.ticks(25);await failed;assert.equal(r.request.avoidLeave,true);assert.equal(r.searches,0);r.dispose();
});
test('leave validator rejects arbitrary exits and conflicting metadata',()=>{
 const r=fixture();r.host.G.maps.cyberland={spawns:[[0,0]]};r.host.G.maps.jail={spawns:[[0,0]]};
 const ports={game:r.host.G,walk:()=>true,door:()=>true,hasKey:()=>false},to={map:'main',x:0,y:0,method:'leave'};
 for(const map of ['cyberland','jail'])assert.equal(validateRoute(ports,{map,x:3,y:3},to,[to],true),null);
 for(const bad of [{...to,town:true},{...to,transport:true,s:0},{...to,map:'bank'},{...to,x:50}])assert.ok(validateRoute(ports,{map:'cyberland',x:0,y:0},bad,[bad],true));
 assert.ok(validateRoute(ports,{map:'main',x:0,y:0},to,[to],true));r.dispose();
});
test('leave timeout requests ALClient recovery and cancellation ignores a late acknowledgment',async()=>{
 const r=fixture({plot:[{map:'main',x:0,y:0,method:'leave'}]});r.host.G.maps.cyberland={spawns:[[0,0]]};Object.assign(r.c,{map:'cyberland',in:'cyberland'});
 let acknowledge;r.host.parent.push_deferred=()=>new Promise(resolve=>acknowledge=resolve);
 const p=r.service.move({map:'main',x:0,y:0}),failed=assert.rejects(p,/Unattributed movement stop/i);await r.ticks(4);
 r.setNow(15000);await r.ticks(3);assert.equal(r.request.avoidLeave,true);assert.equal(r.searches,0);
 await r.service.stop();acknowledge();await r.ticks(2);await failed;assert.equal(r.service.state.moving,false);r.dispose();
});

for(const method of ['town','door','transport','leave'])test('pending loot holds '+method+' before the party transition barrier',async()=>{
 const f=fixture();let collected=false;f.ports.transitionReady=()=>collected;
 let step={map:'main',x:0,y:0,town:true};
 if(method!=='town') {
  step={map:'bank',x:0,y:0,transport:true,s:0};
  if(method==='door')f.host.G.maps.main.doors=[[0,0,20,20,'bank',0,0]];
  if(method==='transport') {f.host.G.maps.main.npcs=[{id:'transporter',position:[0,0]}];f.host.G.npcs.transporter.places.bank=0;}
  if(method==='leave') {step={map:'main',x:0,y:0,method:'leave'};f.c.map='jail';f.c.in='jail';f.host.G.maps.jail={spawns:[[0,0]],doors:[]};}
 }
 let barriers=0;
 // Use the real executor directly to isolate transition dispatch from route search.
 const {createMovementExecutor}=require('../../runtime/characters/movement-executor.ts');
 const state={plot:[step],use_town:true};
 const validation={game:f.host.G,walk:()=>true,door:()=>true,hasKey:()=>true};
 let now=1000;const executor=createMovementExecutor(f.host,state,validation,()=>now,()=>true,()=>collected);
 const options={barrier:async()=>{barriers++;return true;}};
 executor.tick(options);await settle();assert.equal(barriers,0);assert.equal(f.calls.length,0);assert.equal(executor.progress().phase,'pending loot');
 now+=500;executor.tick(options);assert.equal(f.calls.length,0);
 collected=true;executor.tick(options);await settle();executor.tick(options);await settle();
 assert.equal(barriers,1);assert.ok(f.calls.some(c=>c[0]===(method==='town'?'town':method==='leave'?'leave':'transport')));
 await f.service.stop();
});

test('uncollectable transition loot reports a bounded failure and cancellation clears the hold',()=>{
 const f=fixture(),{createMovementExecutor}=require('../../runtime/characters/movement-executor.ts');let now=1000;
 const executor=createMovementExecutor(f.host,{plot:[{map:'main',x:0,y:0,town:true}],use_town:true},
  {game:f.host.G,walk:()=>true,door:()=>true},()=>now,()=>true,()=>false);
 executor.tick({});now+=30000;assert.throws(()=>executor.tick({}),/Pending nearby loot/);
 executor.cancel();assert.equal(executor.progress().phase,'idle');f.dispose();
});

test('combat pause stops issued travel once and resumes the retained route',async()=>{
 const r=fixture({stall:true});const pending=r.service.move({map:'main',x:100,y:0});
 const rejected=assert.rejects(pending);await r.ticks();
 const context=r.ports.context;r.ports.context=()=>({...context(),paused:true});
 await r.ticks();assert.equal(r.calls.filter(c=>c[0]==='move'&&c[1]===0).length,1);
 await r.ticks();assert.equal(r.calls.filter(c=>c[0]==='move'&&c[1]===0).length,1);
 r.ports.context=context;await r.ticks();
 assert.equal(r.calls.filter(c=>c[0]==='move'&&c[1]===100).length,2);
 r.dispose();await rejected;
});

test('a blocked ALClient walking segment uses one validated native connector and keeps the rest of the route',async()=>{
 const r=fixture({plot:[{map:'main',x:50,y:0},{map:'main',x:100,y:0}],nativePlot:[{map:'main',x:0,y:10},{map:'main',x:50,y:10},{map:'main',x:50,y:0}]});
 r.host.can_move=p=>!(p.x===0 && p.y===0 && p.going_x===50 && p.going_y===0);
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});await r.ticks(30);await p;
 assert.equal(r.searches,1);assert.equal(r.c.real_x,100);assert.ok(r.logs.some(l=>l.phase==='Walking segment repaired'));
 assert.equal(r.logs.some(l=>l.phase==='ALClient route rejected'),false);r.dispose();
});
test('repair timeout is three seconds, then the single full native attempt retains its thirty-second bound',async()=>{
 const r=fixture({collision:true,plot:[{map:'main',x:50,y:0},{map:'main',x:100,y:0}]});
 r.host.__partyNativeMovement.start=()=>{r.host.smart.searching=true;};
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});const failed=assert.rejects(p,/30 seconds/);
 await r.ticks(3);r.setNow(4000);await r.ticks(1);r.setNow(4001);await r.ticks(2);
 assert.equal(r.service.state.moving,true);r.setNow(34001);await r.ticks(1);await failed;
 assert.match(r.service.last().failureContext.repairFailure,/3 seconds/);assert.equal(r.service.last().searches,3);r.dispose();
});
test('post-relocation ALClient rejection cannot start another native search or segment repair',async()=>{
 const r=fixture({collision:true,plot:[{map:'main',x:50,y:0},{map:'main',x:100,y:0}]});
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true,owner:{convoyId:'C',epoch:4,commandId:9,recoveryStage:'post-relocation'}});
 const failed=assert.rejects(p,/ALClient retry failed after relocation/);await r.ticks();await failed;
 assert.equal(r.searches,0);assert.equal(r.service.last().failureContext.convoyId,'C');r.dispose();
});
test('owned cancellation retains actor, cause, journey and command context without duplicate reason text',async()=>{
 const r=fixture({pending:true});const p=r.service.move({map:'main',x:100,y:0},undefined,{owner:{convoyId:'C',epoch:2,commandId:7}});
 const failed=assert.rejects(p,/regroup/);await r.ticks(1);
 await r.service.cancel('Coordinator requested regroup',{code:'regroup',character:'Leader'});await failed;
 const last=r.service.last();assert.equal(last.failureContext.commandId,7);assert.equal(last.failureContext.code,'regroup');
 assert.equal(last.failureContext.character,'Leader');assert.equal(last.failureContext.journeyId,last.id);
 const message=r.logs.at(-1).message;assert.equal((message.match(/Coordinator requested regroup/g)||[]).length,1);r.dispose();
});
test('barrier timeout retains request metadata through executor and movement promise',async()=>{
 const r=fixture(),error=Object.assign(new Error('POST /movement-barrier timeout'),{partyRequest:{path:'/movement-barrier',kind:'timeout',status:0}});
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true,barrier:async()=>{throw error;}});
 const rejected=assert.rejects(p,e=>e===error && e.partyRequest.kind==='timeout');
 r.service.install([{map:'main',x:0,y:0,town:true},{map:'main',x:100,y:0}],r.service.identity);
 await r.ticks();await r.ticks();await rejected;assert.equal(r.service.last().failureContext.partyRequest.path,'/movement-barrier');r.dispose();
});

function reachedWalkFixture(plot) {
 const {createMovementExecutor}=require('../../runtime/characters/movement-executor.ts');
 let now=1000,transporting=false;const calls=[];
 const character={map:'main',in:'main',real_x:177,real_y:460,moving:false};
 const host={character,move:(x,y)=>{calls.push([x,y]);character.moving=true;return Promise.resolve();},
  can_walk:()=>true,is_transporting:()=>transporting,can_use:()=>true,
  town:()=>{calls.push('town');return new Promise(()=>{});}};
 const state={plot,use_town:true};
 const executor=createMovementExecutor(host,state,{game:{maps:{main:{spawns:[[177,460]]},bank:{}}},walk:()=>true},()=>now);
 return {executor,host,state,calls,character,setNow:value=>now=value,setTransporting:value=>transporting=value};
}
for(const duplicates of [1,3])test('reached walking points never issue a zero-distance game move: '+duplicates,()=>{
 const r=reachedWalkFixture([...Array.from({length:duplicates},()=>({map:'main',x:177,y:460})),{map:'main',x:222,y:430}]);
 r.executor.tick({});assert.deepEqual(r.calls,[[222,430]]);assert.equal(r.state.plot.length,1);
 Object.assign(r.character,{real_x:222,real_y:430,moving:false});r.setNow(6100);r.executor.tick({});
 assert.equal(r.executor.tick({}),true);
});
test('entire reached route finishes without a move including the one-unit boundary',()=>{
 const r=reachedWalkFixture([{map:'main',x:177,y:460},{map:'main',x:178,y:460}]);
 assert.equal(r.executor.tick({}),true);assert.deepEqual(r.calls,[]);
});
test('outside arrival tolerance still issues a walk',()=>{
 const r=reachedWalkFixture([{map:'main',x:178.01,y:460}]);r.executor.tick({});assert.equal(r.calls.length,1);
});
for(const blocked of ['moving','transporting','unable'])test('reached walk cannot advance while '+blocked,()=>{
 const r=reachedWalkFixture([{map:'main',x:177,y:460}]);
 if(blocked==='moving')r.character.moving=true;
 if(blocked==='transporting')r.setTransporting(true);
 if(blocked==='unable')r.host.can_walk=()=>false;
 assert.equal(r.executor.tick({}),false);assert.equal(r.state.plot.length,1);assert.deepEqual(r.calls,[]);
});
for(const point of [{map:'bank',x:177,y:460},{map:'main',in:'other',x:177,y:460}])test('other map or instance is not consumed: '+JSON.stringify(point),()=>{
 const r=reachedWalkFixture([point]);try{r.executor.tick({});}catch(error){assert.match(error.message,/collisions/);}
 assert.equal(r.state.plot.length,1);
});
test('skipped walk preserves transition barrier index and pending acknowledgement',async()=>{
 const r=reachedWalkFixture([{map:'main',x:177,y:460},{map:'main',x:177,y:460,town:true}]),barriers=[];
 const options={barrier:async(step,index,completed)=>{barriers.push({index,completed});return true;}};
 r.executor.tick(options);await settle();r.executor.tick(options);await settle();r.executor.tick(options);
 assert.deepEqual(r.calls,['town']);assert.deepEqual(barriers,[{index:0,completed:false}]);
 assert.equal(r.state.plot.length,1);assert.equal(r.state.plot[0].town,true);
});

test('Cave shared walking repairs one collision-checked connector after actual position drift',async()=>{
 const r=fixture({nativePlot:[{map:'main',x:0,y:20},{map:'main',x:50,y:20},{map:'main',x:50,y:0}]});
 r.host.can_move=p=>!(p.y===10 && p.going_x===50 && p.going_y===0);
 const p=r.service.move({map:'main',x:100,y:0},undefined,{native:true,shared:true,awaitSharedRoute:true,repairSharedDrift:true});p.catch(()=>{});
 r.service.install([{map:'main',x:50,y:0},{map:'main',x:100,y:0}],r.service.identity,'cave-convoy');
 Object.assign(r.c,{y:10,real_y:10});await r.ticks(30);await p;
 assert.equal(r.searches,1);assert.equal(r.c.real_x,100);assert.equal(r.c.real_y,0);
 assert.ok(r.logs.some(l=>l.phase==='Walking segment repaired'));r.dispose();
});
test('shared Cave connector rejection cannot fall back to a new destination or cross maps',async()=>{
 const r=fixture({nativePlot:[{map:'bank',x:50,y:0}]});
 r.host.can_move=p=>!(p.y===10 && p.going_x===50 && p.going_y===0);
 const p=r.service.move({map:'main',x:100,y:0},undefined,{native:true,shared:true,awaitSharedRoute:true,repairSharedDrift:true});
 const failed=assert.rejects(p,/Shared connector repair failed/);
 r.service.install([{map:'main',x:50,y:0},{map:'main',x:100,y:0}],r.service.identity,'cave-convoy');
 Object.assign(r.c,{y:10,real_y:10});await r.ticks(12);await failed;assert.equal(r.searches,1);assert.equal(r.c.real_x,0);r.dispose();
});
test('ordinary shared journeys still reject drifting unsafe connectors without independent planning',async()=>{
 const r=fixture();r.host.can_move=p=>!(p.y===10 && p.going_x===50 && p.going_y===0);
 const p=r.service.move({map:'main',x:100,y:0},undefined,{native:true,shared:true,awaitSharedRoute:true});const failed=assert.rejects(p,/collisions detected/);
 r.service.install([{map:'main',x:50,y:0},{map:'main',x:100,y:0}],r.service.identity);
 Object.assign(r.c,{y:10,real_y:10});await r.ticks(8);await failed;assert.equal(r.searches,0);r.dispose();
});
test('Cave connector repair stops on instance changes and superseded runtime ownership',async()=>{
 for(const change of [r=>r.c.in='other',r=>r.supersede()]){
  const r=fixture({nativePlot:[{map:'main',x:0,y:20},{map:'main',x:50,y:20},{map:'main',x:50,y:0}]});
  r.host.can_move=p=>!(p.y===10&&p.going_x===50&&p.going_y===0);
  const p=r.service.move({map:'main',x:100,y:0},undefined,{native:true,shared:true,awaitSharedRoute:true,repairSharedDrift:true});const failed=assert.rejects(p);
  r.service.install([{map:'main',x:50,y:0},{map:'main',x:100,y:0}],r.service.identity);
  Object.assign(r.c,{y:10,real_y:10});change(r);await r.ticks(8);await failed;assert.equal(r.searches,0);r.dispose();
 }
});

function successiveCaveRepairFixture(count){
 const options={},r=fixture(options),plot=Array.from({length:count},(_,i)=>({map:'main',x:(i+1)*50,y:0}));
 const promise=r.service.move(plot.at(-1),undefined,{native:true,shared:true,awaitSharedRoute:true,repairSharedDrift:true});promise.catch(()=>{});
 r.service.install(plot,r.service.identity,'cave-convoy');
 r.host.can_move=p=>!(p.x===r.c.real_x&&p.y===0&&p.going_y===0&&p.x!==p.going_x);
 return Object.assign(r,{promise,async advance(){const issue=r.logs.filter(l=>l.phase==='Repairing rejected walking segment').at(-1)?.issue;if(issue)options.nativePlot=[{map:'main',x:r.c.real_x,y:20},{map:'main',x:issue.to.x,y:20},{map:'main',x:issue.to.x,y:0}];await r.ticks(1);}});
}
test('Cave shared drift repairs three successive distinct retained endpoints',async()=>{
 const r=successiveCaveRepairFixture(3);for(let i=0;i<70;i++)await r.advance();await r.promise;
 assert.equal(r.searches,3);assert.equal(r.c.real_x,150);r.dispose();
});
test('Cave shared drift refuses a fourth retained endpoint and destination fallback',async()=>{
 const r=successiveCaveRepairFixture(4),failed=assert.rejects(r.promise,/collisions detected/);for(let i=0;i<80;i++)await r.advance();await failed;
 assert.equal(r.searches,3);assert.equal(r.c.real_x,150);r.dispose();
});
test('Cave shared drift cannot repeatedly repair the same retained endpoint',async()=>{
 const r=successiveCaveRepairFixture(2),failed=assert.rejects(r.promise,/collisions detected/);
 for(let i=0;i<12&&!r.logs.some(l=>l.phase==='Walking segment repaired');i++)await r.advance();
 r.service.state.plot=[{map:'main',x:50,y:0},{map:'main',x:100,y:0}];Object.assign(r.c,{x:0,real_x:0,y:0,real_y:0});
 for(let i=0;i<12;i++)await r.advance();await failed;
 assert.equal(r.logs.filter(l=>l.phase==='Walking segment repaired').length,1);r.dispose();
});

async function pausedLongCaveEdge(nativePlot){
 const options={stall:true,nativePlot},r=fixture(options);
 r.promise=r.service.move({map:'main',x:1000,y:0},undefined,{native:true,shared:true,awaitSharedRoute:true,repairSharedDrift:true,retainOnDirectStop:true});r.promise.catch(()=>{});
 r.service.install([{map:'main',x:1000,y:0}],r.service.identity,'cave-convoy');await r.ticks(2);
 await r.host.stop('move');Object.assign(r.c,{x:100,real_x:100,y:30,real_y:30});options.stall=false;
 r.host.can_move=p=>!(p.y===30&&p.going_x===1000&&p.going_y===0);
 return r;
}
test('Cave paused long walking edge repairs to a nearby original-edge projection',async()=>{
 const r=await pausedLongCaveEdge([{map:'main',x:100,y:20},{map:'main',x:100,y:0}]);await r.ticks(30);await r.promise;
 assert.equal(r.searches,1);assert.equal(r.c.real_x,1000);assert.ok(r.calls.some(c=>c[0]==='move'&&c[1]===100&&c[2]===0));r.dispose();
});
test('Cave local join explicitly executes a safe exact projection after a coarse native endpoint',async()=>{
 const r=await pausedLongCaveEdge([{map:'main',x:100,y:10}]);await r.ticks(30);await r.promise;
 assert.ok(r.calls.some(c=>c[0]==='move'&&c[1]===100&&c[2]===0));assert.equal(r.c.real_x,1000);r.dispose();
});
test('Cave local join rejects an unsafe coarse native gap without destination fallback',async()=>{
 const r=await pausedLongCaveEdge([{map:'main',x:100,y:10}]);r.host.can_move=p=>!(p.y===10&&p.going_y===0)&&!(p.y===30&&p.going_x===1000);
 const failed=assert.rejects(r.promise,/Repair did not validate/);await r.ticks(12);await failed;assert.equal(r.searches,1);assert.equal(r.c.real_x,100);r.dispose();
});
test('Cave local join cannot reuse a stale issued walking edge for a far retained endpoint',async()=>{
 const r=await pausedLongCaveEdge([{map:'main',x:100,y:0}]);r.service.state.plot=[{map:'main',x:500,y:0},{map:'main',x:1000,y:0}];r.host.can_move=p=>!(p.y===30&&p.going_x===500);
 const failed=assert.rejects(r.promise,/collisions detected/);await r.ticks(12);await failed;assert.equal(r.searches,0);r.dispose();
});

async function pausedCaveCorner(invalidate=false){
 const options={nativePlot:[{map:'main',x:42,y:20},{map:'main',x:100,y:20},{map:'main',x:100,y:0}]},r=fixture(options);
 r.promise=r.service.move({map:'main',x:1000,y:0},undefined,{native:true,shared:true,awaitSharedRoute:true,repairSharedDrift:true,retainOnDirectStop:true});r.promise.catch(()=>{});
 r.service.install([{map:'main',x:100,y:0},{map:'main',x:1000,y:0}],r.service.identity,'cave-convoy');
 await r.ticks(1);assert.equal(r.c.real_x,100);
 if(invalidate)r.host.can_move=p=>!(p.x===100&&p.going_x===1000);
 await r.ticks(1);assert.equal(r.service.state.plot[0].x,1000);
 await r.host.stop('move');Object.assign(r.c,{x:42,real_x:42});
 const valid=r.host.can_move;r.host.can_move=p=>valid(p)&&!(p.x===42&&p.y===0&&p.going_x>=500&&p.going_y===0);
 return r;
}
test('Cave paused between confirmed corner consumption and next dispatch retains a local join',async()=>{
 const r=await pausedCaveCorner();await r.ticks(30);await r.promise;
 assert.equal(r.searches,1);assert.equal(r.c.real_x,1000);assert.ok(r.calls.some(c=>c[0]==='move'&&c[1]===100&&c[2]===0));r.dispose();
});
test('Cave consumed corner cannot repair a replaced retained endpoint',async()=>{
 const r=await pausedCaveCorner();r.service.state.plot=[{map:'main',x:500,y:0},{map:'main',x:1000,y:0}];
 const failed=assert.rejects(r.promise,/collisions detected/);await r.ticks(12);await failed;assert.equal(r.searches,0);r.dispose();
});
test('Cave consumed corner cannot cache an invalid next walking edge',async()=>{
 const r=await pausedCaveCorner(true),failed=assert.rejects(r.promise,/collisions detected/);await r.ticks(12);await failed;assert.equal(r.searches,0);r.dispose();
});
test('consumed walking corner does not cache a future native transition',()=>{
 const r=reachedWalkFixture([{map:'main',x:177,y:460},{map:'main',x:177,y:460,town:true}]);r.executor.tick({});
 assert.equal(r.executor.walkingEdge(),undefined);assert.deepEqual(r.calls,['town']);
});
