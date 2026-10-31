const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
const {createSightRecovery}=require('../../runtime/combat/sight-recovery.ts');
function fixture(){const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:1000,hp:100,map:'cave',in:'cave',server:'USII',x:i*20,y:0,range:200,
 combatSelection:{runtimeId:name,id:null,revision:0,map:'cave'},groupedCombat:{protocol:4,anchorVisible:true,ack:null,candidates:[],threats:[],evidence:[],deaths:[]}}}));
 let now=1000,g=null;
 return {members,get g(){return g;},tick(){members.forEach(m=>m.status.seenAt=now);g=evaluateGroup(g,members,'W',now);now+=100;return g;},ack(){members.forEach(m=>{m.status.groupedCombat.ack=g.selection;m.status.groupedCombat.queueAck=g.queueRevision;});}};}
const monster=(id,x=80,priority=50)=>({id,mtype:'boar',map:'cave',in:'cave',x,y:0,priority});
test('hunt queue promotes follower nominations after death and retains three ring targets',()=>{
 const f=fixture();const status=f.members[1].status;
 status.groupedCombat.candidates=['A','B','C','D'].map((id,i)=>monster(id,80+i*10));
 let group=null;
 for(let now=1000;now<=1600;now+=100){
  for(const m of f.members){m.status.seenAt=now;m.status.groupedCombat.ack=group?.selection;m.status.groupedCombat.queueAck=group?.queueRevision;}
  group=evaluateGroup(group,f.members,'W',now,0,false,'boar');
 }
 assert.deepEqual(group.queue.map(t=>t.id),['A','B','C']);assert.equal(group.committed,true);
 status.groupedCombat.deaths=[{...monster('A'),server:'USII',at:1600}];
 group=evaluateGroup(group,f.members,'W',1600,0,false,'boar');
 assert.deepEqual(group.queue.map(t=>t.id),['B','C','D']);assert.equal(group.committed,true);
 const ordinary=evaluateGroup(null,f.members,'W',1600);assert.equal(ordinary.target,null);
});
function huntFixture() {
 const f=fixture();let group=null,now=1000;
 f.members[0].status.groupedCombat.candidates=[monster('A',80),monster('B',120)];
 function tick(ack=false,hunt='boar'){
  for(const m of f.members){m.status.seenAt=now;m.status.groupedCombat.ack=group?.selection;m.status.groupedCombat.queueAck=group?.queueRevision;
   if(ack)m.status.groupedCombat.pursuitAck=group?.pursuit?.revoking;}
  group=evaluateGroup(group,f.members,'W',now,0,false,hunt);now+=100;return group;
 }
 for(let i=0;i<8;i++)tick();
 return {members:f.members,tick,get group(){return group;}};
}
test('hunt switches to the newly closest nomination without a stall and without excluding the old one',()=>{
 const f=huntFixture();f.members[0].status.x=110;
 const first=f.tick();assert.equal(first.target.id,'A');assert.ok(first.pursuit.revoking);assert.equal(first.committed,false);
 assert.equal(f.tick().target.id,'A','wait for revocation acknowledgement');
 const next=f.tick(true);assert.equal(next.target.id,'B');assert.equal(next.pursuitExclusions.length,0);assert.ok(next.queue.some(t=>t.id==='A'));
});
test('hunt keeps ties and wrong-type nominations from causing a closer-target switch',()=>{
 const f=huntFixture();f.members[0].status.x=100;assert.ok(!f.tick().pursuit.revoking);
 f.members[0].status.groupedCombat.candidates.push({...monster('C',100),mtype:'goo'});
 assert.equal(f.tick().target.id,'A');assert.ok(!f.group.pursuit.revoking);
});
test('pending or engaged attacks arriving with hunt revocation acknowledgements retain the original fight',()=>{
 for(const state of ['pending','engaged']){
  const f=huntFixture();f.members[0].status.x=110;f.tick();
  f.members[1].status.groupedCombat.evidence=[{...monster('A'),server:'USII',at:f.group.seenAt,action:'attack',state}];
  const g=f.tick(true);assert.equal(g.target.id,'A');assert.equal(g.target.state,state);assert.equal(g.pursuit,undefined);
 }
});
test('closer hunt candidate disappearing cancels revocation and allows a later replacement',()=>{
 const f=huntFixture();f.members[0].status.x=110;f.tick();
 f.members[0].status.groupedCombat.candidates=[monster('A')];
 assert.ok(!f.tick(true).pursuit.revoking);
 f.members[0].status.groupedCombat.candidates.push(monster('C',115));assert.ok(f.tick().pursuit.revoking);
 assert.equal(f.tick(true).target.id,'C');
});
function engage(f,id='A'){f.members[0].status.groupedCombat.evidence.push({...monster(id),server:'USII',at:1000,action:id,state:'engaged'});f.tick();}

for(const outcome of ['switch','disappeared','pending','engaged'])test('first locked pair completes an existing closer-target revocation: '+outcome,()=>{
 const f=fixture();
 for(const m of f.members)m.status.groupedCombat.handoff={capability:1};
 f.members[0].status.groupedCombat.candidates=[monster('A',200)];
 for(let i=0;i<8;i++){f.tick();f.ack();}
 assert.equal(f.g.pairRevision,null);
 f.members[0].status.groupedCombat.candidates.push(monster('B',50));
 f.tick();assert.ok(f.g.pairRevision);assert.ok(f.g.pursuit.revoking);assert.equal(f.g.committed,false);
 const revocation=f.g.pursuit.revoking;
 f.members[0].status.groupedCombat.pursuitAck=revocation;
 f.tick();assert.equal(f.g.target.id,'A','one acknowledgement cannot release the original target');
 for(const m of f.members)m.status.groupedCombat.pursuitAck=revocation;
 if(outcome==='disappeared')f.members[0].status.groupedCombat.candidates=[monster('A',200)];
 if(['pending','engaged'].includes(outcome))f.members[1].status.groupedCombat.evidence=[{...monster('A',200),server:'USII',at:f.g.seenAt,action:'attack',state:outcome}];
 const next=f.tick();
 assert.equal(next.target.id,outcome==='switch'?'B':'A');
 assert.equal(next.pursuit?.revoking,undefined,'the acknowledged revocation must retire even after a pair appears');
 if(['pending','engaged'].includes(outcome))assert.equal(next.target.state,outcome);
 assert.equal(next.pursuitExclusions.length,0);
});
test('untouched selection is planned and candidates rank by leader distance within priority',()=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A',80),monster('B',30),monster('C',200,60),monster('D',400)];
 const g=f.tick();assert.equal(g.fights.length,0);assert.equal(g.target.state,'planned');assert.deepEqual(g.queue.map(t=>t.id),['C','B','A']);
 const selection=g.selection;f.tick();assert.equal(f.g.selection,selection,'planning timestamp is stable');
});
test('upcoming neutral ranks change while current engagement stays fixed',()=>{
 const f=fixture();engage(f);f.members[0].status.groupedCombat.candidates=[monster('B',50),monster('C',100),monster('D',150)];f.tick();
 assert.deepEqual(f.g.queue.map(t=>t.id),['A','B','C']);f.members[0].status.groupedCombat.candidates[2].x=20;f.tick();
 assert.deepEqual(f.g.queue.map(t=>t.id),['A','D','B']);
});
test('defense discards untouched nomination, but cannot replace an engaged current fight',()=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A')];f.tick();
 f.members[1].status.groupedCombat.threats=[monster('B')];f.tick();assert.equal(f.g.target.id,'B');
 f.members[0].status.groupedCombat.threats=[monster('C',10)];f.tick();assert.equal(f.g.target.id,'B');assert.equal(f.g.queue[1].id,'C');
});
test('pending projectile prevents abandoning nomination; explicit rejection permits defense',()=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A')];f.tick();
 const e={...monster('A'),server:'USII',at:1100,action:'shot',state:'pending'};f.members[0].status.groupedCombat.evidence=[e];f.tick();
 f.members[1].status.groupedCombat.threats=[monster('B')];f.tick();assert.equal(f.g.target.id,'A');
 e.state='rejected';e.at=1300;f.tick();assert.equal(f.g.target.id,'B');
});
test('known aggressors are retained beyond three and always precede neutrals',()=>{
 const f=fixture();engage(f);f.members[1].status.groupedCombat.threats=['B','C','D'].map(id=>monster(id));
 f.members[0].status.groupedCombat.candidates=[monster('E',1,101)];f.tick();assert.deepEqual(f.g.queue.map(t=>t.id),['A','B','C','D']);
});
test('acknowledged successor promotes on death without another acknowledgement cycle',()=>{
 const f=fixture();engage(f);f.members[0].status.groupedCombat.candidates=[monster('B'),monster('C',150)];
 for(let i=0;i<8;i++){f.tick();f.ack();}
 f.members[1].status.groupedCombat.deaths=[{id:'A',map:'cave',in:'cave',server:'USII',at:1800}];f.tick();
 assert.equal(f.g.target.id,'B');assert.equal(f.g.committed,true);f.tick();assert.equal(f.g.target.id,'B','duplicate proof advances once');
 assert.equal(f.g.handoffTiming.selectedAt,f.g.handoffTiming.committedAt);
 const timing=f.g.handoffTiming;f.tick();assert.deepEqual(f.g.handoffTiming,timing,'ordinary reports retain transition times');
});
test('disappearance, focus change, character death and reload cannot release engagement',()=>{
 const f=fixture();engage(f);f.members.forEach(m=>{m.status.lastDeath={at:2000};m.status.combatSelection.runtimeId+='reload';});f.tick();
 assert.equal(f.g.target.id,'A');assert.equal(f.g.target.state,'engaged');
 const restored=evaluateGroup(null,f.members.map(m=>({...m,status:{...m.status,groupedCombat:{...m.status.groupedCombat,state:f.g}}})),'W',2000);
 assert.equal(restored.target.id,'A');
});
test('wrong instance death never releases and stale member blocks fresh neutral authorization',()=>{
 const f=fixture();engage(f);f.members[0].status.groupedCombat.deaths=[{id:'A',map:'cave',in:'other',server:'USII',at:1000}];f.tick();assert.equal(f.g.target.id,'A');
 const n=fixture();n.members[0].status.groupedCombat.candidates=[monster('B')];for(let i=0;i<8;i++){n.tick();n.ack();}
 n.members[2].status.seenAt=-10000;const g=evaluateGroup(null,n.members,'W',1800);assert.equal(g.committed,false);
});
test('visibility recovery backtracks then explores collision-checked local detours with no pathfinder',()=>{
 let now=0;const self={x:0,y:0,range:100,speed:50},moves=[],reasons=[];
 const r=createSightRecovery({now:()=>now,self:()=>self,clear:p=>p.y>=0,move:p=>moves.push(p),report:s=>reasons.push(s)});
 r.tick('A',{x:100,y:0},{x:20,y:0},[{x:50,y:0}]);assert.equal(moves[0].x,20);
 for(let i=0;i<50;i++){now+=200;r.tick('A',{x:100,y:0},null,[]);}
 assert.ok(reasons.some(s=>s.includes('detour')));assert.ok(moves.every(p=>p.y>=0));
});
test('completely blocked visibility search retries and retains identity',()=>{
 let tries=0,now=0;const reasons=[];const r=createSightRecovery({now:()=>now,self:()=>({x:0,y:0,range:100,speed:50}),clear:()=>{tries++;return false;},move:()=>assert.fail('blocked move'),report:s=>reasons.push(s)});
 r.tick('A',{x:100,y:0},null,[]);now=300;r.tick('A',{x:100,y:0},null,[]);assert.ok(tries>=20);assert.ok(reasons.every(s=>s.includes('blocked')));
});
test('breadcrumbs retrace the actual turn rather than a diagonal to the old sighting',()=>{
 let now=0;const self={x:0,y:0,speed:50},moves=[];
 const r=createSightRecovery({now:()=>now,self:()=>self,clear:()=>true,move:p=>moves.push(p),report(){}});
 r.observe('A',self,true);now=100;Object.assign(self,{x:20,y:0});r.observe('A',self,false);
 now=200;Object.assign(self,{x:20,y:20});r.observe('A',self,false);
 r.tick('A',{x:-100,y:0},{x:0,y:0},[]);assert.deepEqual(moves[0],{x:20,y:0});
});
test('coordinator reports only fresh living observers that see the actual target',()=>{
 const f=fixture();engage(f);f.members[1].status.groupedCombat.sightings=[monster('A')];f.members[2].status.groupedCombat.sightings=[monster('B')];
 f.tick();assert.deepEqual(f.g.observers.map(o=>o.name),['P']);
 f.members[1].status.rip=true;f.tick();assert.equal(f.g.observers.length,0);
});
test('recovery prefers observer and preserves detour side until it stalls',()=>{
 let now=0;const self={x:0,y:0,speed:50},moves=[],reasons=[];
 const r=createSightRecovery({now:()=>now,self:()=>self,clear:p=>p.y>1,move:p=>moves.push(p),report:s=>reasons.push(s)});
 r.tick('A',{x:-100,y:0},null,[{x:100,y:0}]);assert.ok(moves[0].x>0&&moves[0].y>0);
 Object.assign(self,moves[0]);now=100;r.tick('A',{x:-100,y:0},null,[{x:100,y:0}]);
 assert.ok(reasons.some(s=>s.includes('teammate who sees target')));
 r.observe('A',self,true);assert.equal(r.tick('B',{x:0,y:100},null,[]),true,'new target resets history');
});

test('follower passive rare replaces untouched nomination, deduplicates, and promotes after defense',()=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A')];f.tick();
 const rare={...monster('Phoenix',400,100),mtype:'phoenix',passiveRare:true};
 f.members[1].status.groupedCombat.candidates=[rare,monster('NotLeaderChoice',1,999)];
 f.members[2].status.groupedCombat.candidates=[rare];f.tick();
 assert.equal(f.g.target.id,'Phoenix');assert.deepEqual(f.g.queue.map(t=>t.id),['Phoenix','A']);
 f.members[2].status.groupedCombat.threats=[monster('Attacker')];f.tick();
 assert.deepEqual(f.g.queue.map(t=>t.id),['Attacker','Phoenix','A']);
 f.members[2].status.groupedCombat.threats=[];
 f.members[0].status.groupedCombat.deaths=[{...monster('Attacker'),server:'USII',at:1300}];f.tick();assert.equal(f.g.target.id,'Phoenix');
});
test('rare cannot replace a pending attack; stale or wrong-instance follower sightings are ignored',()=>{
 const f=fixture();f.members[0].status.groupedCombat.evidence=[{...monster('A'),server:'USII',at:1000,action:'a',state:'pending'}];
 const rare={...monster('R',10,101),mtype:'tinyp',passiveRare:true};f.members[1].status.groupedCombat.candidates=[rare];f.tick();
 assert.deepEqual(f.g.queue.map(t=>t.id),['A','R']);
 f.members[1].status.in='elsewhere';f.tick();assert.deepEqual(f.g.queue.map(t=>t.id),['A']);
 f.members[1].status.in='cave';f.members[1].status.seenAt=-10000;
 assert.deepEqual(evaluateGroup(f.g,f.members,'W',1500).queue.map(t=>t.id),['A']);
});
test('rare loot blocks acknowledged neutral pulls but never an existing aggressor',()=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A')];for(let i=0;i<8;i++){f.tick();f.ack();}
 assert.equal(evaluateGroup(f.g,f.members,'W',1800,0,true).committed,false);
 f.members[1].status.groupedCombat.threats=[monster('B')];
 const g=evaluateGroup(f.g,f.members,'W',1800,0,true);assert.equal(g.target.id,'B');assert.equal(g.committed,true);
});

const claim=(id,external,at,extra={})=>({id,map:'cave',in:'cave',server:'USII',external,at,...extra});
test('external claim releases an engaged current target and promotes the shared successor',()=>{
 const f=fixture();engage(f);f.members[0].status.groupedCombat.candidates=[monster('B'),monster('C')];
 f.members[1].status.groupedCombat.claims=[claim('A',true,1100)];f.tick();
 assert.deepEqual(f.g.queue.map(t=>t.id),['B','C']);assert.equal(f.g.fights.length,0);assert.equal(f.g.evidence.length,0);
 assert.equal(f.g.claims[0].releasedAt,1100);
 f.members[0].status.groupedCombat.evidence.push({...monster('A'),server:'USII',action:'late',at:1200,startedAt:1000,state:'engaged'});f.tick();assert.equal(f.g.target.id,'B');
 const restored=evaluateGroup(null,f.members.map(m=>({...m,status:{...m.status,groupedCombat:{...m.status.groupedCombat,state:f.g}}})),'W',1300);
 assert.equal(restored.target.id,'B');
});
test('claims remove second and third choices despite another member still nominating them',()=>{
 const f=fixture();engage(f);f.members[0].status.groupedCombat.candidates=[monster('B'),monster('C'),monster('D')];
 f.members[1].status.groupedCombat.claims=[claim('B',true,1100),claim('C',true,1100)];f.tick();
 assert.deepEqual(f.g.queue.map(t=>t.id),['A','D']);
});
test('pending target release survives newer hit delivery; newer eligibility permits only a fresh fight',()=>{
 const f=fixture();f.members[0].status.groupedCombat.evidence=[{...monster('A'),server:'USII',at:1000,startedAt:1000,action:'old',state:'pending'}];f.tick();
 f.members[1].status.groupedCombat.claims=[claim('A',true,1100)];f.tick();assert.equal(f.g.target,null);
 f.members[0].status.groupedCombat.evidence[0].at=1200;f.members[0].status.groupedCombat.evidence[0].state='engaged';
 f.members[1].status.groupedCombat.claims=[claim('A',false,1200)];f.members[0].status.groupedCombat.candidates=[monster('A')];f.tick();
 assert.equal(f.g.target.state,'planned');assert.equal(f.g.fights.length,0);
 f.members[0].status.groupedCombat.evidence.push({...monster('A'),server:'USII',at:1300,startedAt:1300,action:'new',state:'engaged'});f.tick();assert.equal(f.g.target.state,'engaged');
});
test('external wins timestamp ties; missing sight, stale and wrong-instance reports never release a fight',()=>{
 const f=fixture();engage(f);
 f.members[1].status.groupedCombat.claims=[claim('A',true,-10000),claim('A',true,1100,{in:'other'})];f.tick();assert.equal(f.g.target.id,'A');
 f.members[1].status.groupedCombat.claims=[claim('A',true,1200)];f.members[2].status.groupedCombat.claims=[claim('A',false,1200)];f.tick();assert.equal(f.g.target,null);
 f.members[1].status.groupedCombat.claims=[];f.members[2].status.groupedCombat.claims=[];f.tick();assert.equal(f.g.target,null);
});
test('event reports cannot release a shared farming fight',()=>{
 for(const event of ['franky','icegolem','crabxx']) {
  const f=fixture();engage(f);f.members[1].status.joinedEvent=event;
  f.members[1].status.groupedCombat.claims=[claim('A',true,1100)];f.tick();assert.equal(f.g.target.id,'A');
 }
});

test('reload merges a newer claim release from another member before restoring old engagement',()=>{
 const f=fixture();engage(f);const old=f.g;
 f.members[1].status.groupedCombat.claims=[claim('A',true,1100)];f.tick();const released=f.g;
 f.members[0].status.groupedCombat.state=old;f.members[1].status.groupedCombat.state=released;f.members[1].status.groupedCombat.claims=[];
 const g=evaluateGroup(null,f.members,'W',1200);assert.equal(g.target,null);assert.equal(g.fights.length,0);
});


function pursuitFixture() {
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A',400),monster('B',500)];
 f.tick();f.ack();
 function tick(ackRevoke=false) {
  for(const m of f.members){const g=m.status.groupedCombat;
   g.approach={target:JSON.stringify(['USII','cave','cave',f.g.target.id]),at:f.g.seenAt+100,active:true,visible:true,intent:'approach',moving:true,displacement:0,deficit:300,coverage:0};
   if(ackRevoke)g.pursuitAck=f.g.pursuit?.revoking;
  }
  f.tick();f.ack();return f.g;
 }
 return {f,tick};
}
test('ordinary ranking follows leader rather than summed distance to distant supporters',()=>{
 const f=fixture();f.members[1].status.x=180;f.members[2].status.x=180;
 f.members[0].status.groupedCombat.candidates=[monster('A',20),monster('B',180)];assert.equal(f.tick().target.id,'A');
});
test('stalled pursuit revokes authorization, awaits all clients, then replaces and cools down target',()=>{
 const {f,tick}=pursuitFixture();for(let i=0;i<65;i++)tick();
 assert.ok(f.g.pursuit.revoking);assert.equal(f.g.target.id,'A');assert.equal(f.g.committed,false);
 f.members[0].status.groupedCombat.pursuitAck=f.g.pursuit.revoking;tick();assert.equal(f.g.target.id,'A');
 tick(true);assert.equal(f.g.target.id,'B');assert.ok(f.g.pursuitExclusions.length);assert.ok(!f.g.queue.some(t=>t.id==='A'));
 tick();assert.equal(f.g.target.id,'B');
});
test('pending first attack arriving with revocation acknowledgement keeps the original fight',()=>{
 const {f,tick}=pursuitFixture();for(let i=0;i<65;i++)tick();
 f.members[0].status.groupedCombat.evidence=[{...monster('A',400),server:'USII',at:f.g.seenAt,action:'late-shot',state:'pending'}];
 tick(true);assert.equal(f.g.target.id,'A');assert.equal(f.g.target.state,'pending');assert.equal(f.g.phase,'attack-pending');assert.equal(f.g.pursuit,undefined);
});
test('missing approach telemetry disables replacement and committed planned target is approaching',()=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A'),monster('B',100)];
 for(let i=0;i<90;i++){f.tick();f.ack();}
 assert.equal(f.g.phase,'approaching');assert.equal(f.g.target.id,'A');assert.ok(!f.g.pursuit.revoking);
});
test('a materially closer ordinary target promptly revokes the old pull even during progress',()=>{
 const {f,tick}=pursuitFixture();
 for(let i=0;i<100;i++){
  f.members[0].status.x+=1;
  for(const m of f.members)m.status.groupedCombat.approach={target:JSON.stringify(['USII','cave','cave','A']),at:f.g.seenAt+100,active:true,visible:true,intent:'approach',moving:true,displacement:1,deficit:300-i,coverage:0};
  f.tick();f.ack();
 }
 f.members[0].status.groupedCombat.candidates.push(monster('C',110));tick();
 assert.equal(f.g.target.id,'A');assert.ok(f.g.pursuit.revoking);
 for(const m of f.members)m.status.groupedCombat.pursuitAck=f.g.pursuit.revoking;
 tick();assert.equal(f.g.target.id,'C');
});

test('no alternative holds the stalled target, and missing telemetry suspends replacement',()=>{
 const {f,tick}=pursuitFixture();f.members[0].status.groupedCombat.candidates=[monster('A',400)];
 for(let i=0;i<65;i++)tick();assert.match(f.g.pursuit.reason,/no eligible alternative/);assert.ok(!f.g.pursuit.revoking);
 f.members[0].status.groupedCombat.candidates.push(monster('B',500));
 for(let i=0;i<70;i++){
  for(const m of f.members)m.status.groupedCombat.approach=undefined;
  f.tick();f.ack();
 }
 assert.equal(f.g.target.id,'A');assert.ok(!f.g.pursuit.revoking);assert.equal(f.g.pursuit.idleMs,0);
});
test('outward detour displacement toward a persistent waypoint counts as approach progress',()=>{
 const {f}=pursuitFixture();
 for(let i=0;i<100;i++){
  f.members[0].status.y=i;
  for(const m of f.members)m.status.groupedCombat.approach={target:JSON.stringify(['USII','cave','cave','A']),at:f.g.seenAt+100,active:true,visible:true,intent:'approach',moving:true,displacement:1,deficit:300+i,coverage:0,waypoint:{key:'corner',remaining:150-i}};
  f.tick();f.ack();
 }
 assert.equal(f.g.target.id,'A');assert.ok(!f.g.pursuit.revoking);
});
test('stale revocation acknowledgement cannot replace target, and reload resets pursuit timer',()=>{
 const {f,tick}=pursuitFixture();for(let i=0;i<65;i++)tick();
 for(const m of f.members)m.status.groupedCombat.pursuitAck=f.g.pursuit.revoking;
 f.members[2].status.seenAt=f.g.seenAt-4000;
 const blocked=evaluateGroup(f.g,f.members,'W',f.g.seenAt+100);assert.equal(blocked.target.id,'A');assert.equal(blocked.committed,false);
 f.members[0].status.combatSelection.runtimeId+='reload';tick();
 assert.equal(f.g.pursuit.idleMs,0);assert.ok(!f.g.pursuit.revoking);
});

test('fully healed neutral old engagement releases to the nearest nomination without resurrecting old attack evidence',()=>{
 const f=fixture();engage(f);const a={...monster('A',400),hp:100,max_hp:100,target:null};
 f.members[0].status.groupedCombat.candidates=[a,monster('B',20)];
 for(const m of f.members)m.status.groupedCombat.sightings=[a];
 for(let i=0;i<60;i++)f.tick();
 assert.equal(f.g.target.id,'B');assert.equal(f.g.target.state,'planned');assert.equal(f.g.fights.length,0);
 assert.ok(f.g.claims.find(c=>c.id==='A').releasedAt);assert.equal(f.g.deaths.length,0);
 f.tick();assert.equal(f.g.target.id,'B');
});
for(const variation of ['damaged','attacking','unknown','pending'])test('old engagement is retained with '+variation+' evidence',()=>{
 const f=fixture();engage(f);const a={...monster('A',400),hp:100,max_hp:100,target:null};
 if(variation==='damaged')a.hp=50;if(variation==='attacking')a.target='W';if(variation==='unknown')delete a.target;
 for(const m of f.members)m.status.groupedCombat.sightings=[a];
 if(variation==='pending')f.members[0].status.groupedCombat.evidence.push({...a,server:'USII',action:'pending',at:1000,state:'pending'});
 f.members[0].status.groupedCombat.candidates=[monster('B',20)];for(let i=0;i<60;i++)f.tick();assert.equal(f.g.target.id,'A');
});
