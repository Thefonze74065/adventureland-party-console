const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('characters/shared.js','utf8');
function runtime(options={}) {
 let now=0,goal=null,smart=false,ticks=0;
 const calls=[],player={name:'F',map:'main',x:1000,y:0,visible:true};
 const r=vm.createContext({Date:{now:()=>now},character:{ctype:'merchant',map:'main',x:0,y:0},lastCommand:1,navigationIntent:{revision:1},runtimeCurrent:()=>true,
  merchantAnniversaryWorkReserved:()=>false,get_player:()=>options.invisible?null:player,can_move_to:()=>!options.wall,reunionRealm:()=> 'USII',
  setTimeout:callback=>{now+=200;ticks++;if(options.tick)options.tick(r,player,ticks);if(goal&&!options.stuck&&!(r.smart&&r.smart.moving&&!r.smart.found)){const dx=goal.x-r.character.x,dy=goal.y-r.character.y,d=Math.hypot(dx,dy)||1;r.character.x+=dx/d*Math.min(60,d);r.character.y+=dy/d*Math.min(60,d);}callback();},
  move:(x,y)=>{calls.push({kind:'move',x,y});goal={x,y};},
  smart_move:(destination,callback,movementOptions)=>{calls.push({kind:'smart',...destination});smart=true;goal=destination;if(options.smartMove)return options.smartMove(r,destination,movementOptions);return new Promise(()=>{});},
  stop:async kind=>{calls.push({kind:'stop',type:kind});if(kind==='smart'&&smart||kind==='move')goal=null;smart=false;},
  request:async()=>({targetStatus:{...player,seenAt:now,server:'USII'}}),anniversaryWithTimeout:async promise=>promise,
  send_item:async(name,slot,q)=>calls.push({kind:'send',name,slot,q}),
 });
 vm.runInContext(source.slice(source.indexOf('  async function pursueMerchantTarget('),source.indexOf('  function freeInventorySlots(')),r);
 vm.runInContext(source.slice(source.indexOf('  async function rendezvous('),source.indexOf('  var merchantLuckScanWorking')),r);
 return {r,player,calls};
}
test('smart route hands off early to refreshed direct movement for a kiting recipient',async()=>{
 const t=runtime({tick:(_,p,n)=>{p.y=n*8;}});await t.r.rendezvous('job','F');
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,1);
 const moves=t.calls.filter(c=>c.kind==='move');assert.ok(moves.length>1);assert.notEqual(moves[0].y,moves.at(-1).y);
 assert.ok(Math.hypot(t.r.character.x-t.player.x,t.r.character.y-t.player.y)<=180);
 assert.ok(t.calls.some(c=>c.kind==='stop'&&c.type==='smart'));
});
test('walls keep the merchant on navigation rather than issuing unsafe direct moves',async()=>{
 const t=runtime({wall:true});await t.r.rendezvous('job','F');assert.equal(t.calls.filter(c=>c.kind==='move').length,0);
});
test('unresolved path has a bounded timeout and cleanup instead of restarting A-star continuously',async()=>{
 const t=runtime({stuck:true,wall:true});await assert.rejects(t.r.rendezvous('job','F'),/timed out/);
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,3);assert.equal(t.calls.at(-1).kind,'stop');
});
test('manual cancellation cannot stop a newer movement command',async()=>{
 const t=runtime({tick:r=>{r.lastCommand++;}});await assert.rejects(t.r.rendezvous('job','F'),/interrupted/);
 assert.equal(t.calls.filter(c=>c.kind==='stop').length,0);
});
test('each delivery reacquires a recipient that moved outside transfer range',async()=>{
 const t=runtime();t.player.x=100;await t.r.merchantSendItem('F',1,2);t.player.x=550;await t.r.merchantSendItem('F',2,3);
 assert.equal(t.calls.filter(c=>c.kind==='send').length,2);assert.ok(t.calls.some(c=>c.kind==='move'));
 assert.ok(Math.hypot(t.r.character.x-t.player.x,t.r.character.y-t.player.y)<=180);
});
test('unavailable recipients and merchant death fail without indefinite waiting',async()=>{
 const t=runtime({invisible:true,stuck:true});await assert.rejects(t.r.waitForPlayer('F',1000),/timed out/);
 t.r.character.rip=true;await assert.rejects(t.r.rendezvous('job','F'),/Merchant died/);
});

test('anniversary staging explicitly pauses and stops only owned pursuit',async()=>{
 const t=runtime({stuck:true,tick:(r,p,n)=>{if(n===5)r.merchantAnniversaryWorkReserved=()=>true;}});
 await assert.rejects(t.r.rendezvous('job','F'),error=>error.message==='merchant_anniversary_reserved'&&error.details.pauseReason==='merchant_anniversary_reserved');
 assert.equal(t.calls.at(-1).kind,'stop');
});
test('direct movement stalls fall back to smart movement with two recovery attempts',async()=>{
 const t=runtime({stuck:true});t.player.x=500;
 await assert.rejects(t.r.rendezvous('job','F'),error=>/no progress/.test(error.message)&&error.details.recoveries===2);
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,2);
});
test('fresh target status overrides a visible entity on an obsolete map',async()=>{
 const t=runtime({stuck:true});t.player.x=100;
 t.r.request=async()=>({targetStatus:{map:'winterland',x:20,y:30,seenAt:t.r.Date.now(),server:'USII'}});
 await assert.rejects(t.r.rendezvous('job','F'),/timed out/);
 assert.equal(t.calls.find(c=>c.kind==='smart').map,'winterland');
 assert.equal(t.calls.filter(c=>c.kind==='move').length,0);
});

test('slow path calculation is allowed to finish before the movement watchdog starts',async()=>{
 const t=runtime({wall:true,tick:(r,p,n)=>{if(n===80)r.smart.found=true;},
  smartMove:r=>{r.smart={moving:true,found:false};return new Promise(()=>{});}});
 await t.r.rendezvous('job','F');
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,1);
 assert.ok(t.r.Date.now()>16000);
});

test('path calculation has a bounded timeout without ten-second search restarts',async()=>{
 const t=runtime({stuck:true,wall:true,smartMove:r=>{r.smart={moving:true,found:false};return new Promise(()=>{});}});
 await assert.rejects(t.r.rendezvous('job','F'),error=>/pathfinding/.test(error.message)&&error.details.phase==='pathfinding');
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,1);
 assert.ok(t.r.Date.now()>=45000&&t.r.Date.now()<46000);
});

test('cross-map travel ignores recipient movement then approaches its latest position on arrival',async()=>{
 const t=runtime({invisible:true,stuck:true,tick:(r,p,n)=>{
  p.x+=40;
  if(n===80){r.character.map=p.map;r.character.x=p.x-400;r.smart.found=true;}
  if(n===81)r.get_player=()=>({...p,x:r.character.x+100});
 },smartMove:r=>{r.smart={moving:true,found:false};return new Promise(()=>{});}});
 t.player.map='spookytown';
 await t.r.rendezvous('job','F');
 const routes=t.calls.filter(c=>c.kind==='smart');
 assert.equal(routes.length,2);
 assert.equal(routes[0].map,'spookytown');assert.equal(routes[0].x,undefined);
 assert.equal(routes[1].x,t.player.x-40);
});

test('failed route retains the underlying error in rendezvous diagnostics',async()=>{
 const t=runtime({wall:true,stuck:true,smartMove:()=>Promise.reject({reason:'failed'})});
 await assert.rejects(t.r.rendezvous('job','F'),error=>error.details.routeError==='failed');
});

test('multi-map rendezvous routes locally to doorways and explicitly crosses without tunnel shortcuts',async()=>{
 const t=runtime({invisible:true});t.player.map='spookytown';t.player.x=100;t.player.y=1400;
 t.r.G={maps:{main:{spawns:[[0,0],[1600,-524]],doors:[[1600,-547,60,40,'halloween',1,1]]},
  halloween:{spawns:[[0,0],[1200,100],[784,-1060]],doors:[[784,-1085,80,40,'spookytown',1,2]]},
  spookytown:{spawns:[[0,0],[32,1404]]}}};
 t.r.transport=async(map,spawn)=>{
  t.calls.push({kind:'transport',map,spawn});t.r.character.map=map;
  [t.r.character.x,t.r.character.y]=t.r.G.maps[map].spawns[spawn];
  if(map==='spookytown')t.r.get_player=()=>t.player;
 };
 await t.r.rendezvous('job','F');
 const routes=t.calls.filter(c=>c.kind==='smart');
 assert.equal(routes.length,2);
 assert.equal(routes[0].map,'main');assert.equal(routes[0].x,1600);
 assert.equal(routes[1].map,'halloween');assert.equal(routes[1].y,-1060);
 assert.deepEqual(t.calls.filter(c=>c.kind==='transport').map(c=>c.map),['halloween','spookytown']);
});

test('same-map rendezvous lets an intermediate tunnel shortcut finish without reversing it',async()=>{
 const t=runtime({invisible:true,stuck:true,wall:true,tick:(r,p,n)=>{
  if(n===5){r.character.map='mtunnel';r.character.x=0;r.character.y=8;}
  if(n===30){r.character.map='main';r.character.x=950;r.character.y=0;r.get_player=()=>p;}
 },smartMove:r=>{r.smart={moving:true,found:true};return new Promise(()=>{});}});
 await t.r.rendezvous('job','F');
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,1,'intermediate maps cannot replace the running route');
 assert.equal(t.calls.findIndex(c=>c.kind==='stop'),1,'only arrival cleanup stops the route');
});

test('recipient map change still replaces a running intermediate-map shortcut',async()=>{
 const t=runtime({invisible:true,stuck:true,wall:true,tick:(r,p,n)=>{
  if(n===5){r.character.map='mtunnel';r.character.x=0;r.character.y=8;p.map='winterland';}
  if(n===30){r.character.map='winterland';r.character.x=950;r.character.y=0;r.get_player=()=>p;}
 },smartMove:r=>{r.smart={moving:true,found:true};return new Promise(()=>{});}});
 await t.r.rendezvous('job','F');
 const routes=t.calls.filter(c=>c.kind==='smart');assert.equal(routes.length,2);assert.equal(routes[1].map,'winterland');
});

test('transporter rendezvous accounts for native walking endpoint tolerance',async()=>{
 const t=runtime({invisible:true,stuck:true,smartMove:(r,destination,options)=>{
  r.character.x=destination.x;r.character.y=destination.y-(options?.arrivalTolerance??20);
  return Promise.resolve();
 }});
 t.r.character.map='winterland';t.player.x=0;
 t.r.G={maps:{winterland:{spawns:[[0,0]],npcs:[{id:'transporter',position:[0,100]}]},main:{spawns:[[0,0]]}},npcs:{transporter:{places:{main:0}}}};
 t.r.movement={transporterApproach:()=>({map:'winterland',x:0,y:40})};
 let transported=false;
 t.r.transport=async()=>{assert.ok(Math.hypot(t.r.character.x,t.r.character.y-100)<75);transported=true;t.r.character.map='main';t.r.character.x=0;t.r.character.y=0;t.r.get_player=()=>t.player;};
 await t.r.rendezvous('job','F');
 assert.equal(transported,true);
});
