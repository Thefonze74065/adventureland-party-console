const test=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {installPartyMovement}=require('../../runtime/characters/movement.ts');
const {validateRoute}=require('../../runtime/navigation/validation.ts');
const {geometryFingerprint}=require('../../runtime/navigation/contracts.ts');
const {createPlannerService}=require('../../runtime/coordinator/navigation/planner-service.ts');
const {createNative}=require('../../tools/game/pathfinder-benchmark/native.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

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
 report('runtime:2',destination,'Route rejected',issue);
 assert.equal(logs.length,1);assert.deepEqual(logs[0].data.destination,{map:'main',x:100,y:0});
 now+=10001;report('runtime:3',destination,'Route rejected',issue);
 assert.equal(logs[1].data.count,3);assert.match(logs[1].message,/Repeated 3 times/);
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
 assert.equal(r.searches,1);assert.equal(r.calls.some(c=>c[1]===50),false);
 assert.match(r.logs[0].message,/collisions detected between main \(0, 0\) and main \(50, 0\).*falling back to native smart_move/);
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
 const p=r.service.move({map:'main',x:100,y:0}),failed=assert.rejects(p,/Native route rejected/);
 await r.ticks();await failed;assert.equal(r.calls.length,0);assert.equal(r.logs.at(-1).phase,'Movement failed');r.dispose();
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
 const p=r.service.move({map:'main',x:0,y:0}),failed=assert.rejects(p,/cancelled/i);await r.ticks(4);
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
