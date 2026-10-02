const test = require('node:test');
const assert = require('node:assert/strict');
const {createCaveProgress} = require('../../runtime/coordinator/dungeons/progress.ts');
const {createDungeonJournal} = require('../../runtime/characters/dungeon-journal.ts');
function setup() {
  const stairs={id:'stairs',map:'zone_r_0',x:100,y:0,down:true,to:'zone_r_1',locked:true};
  const room={id:'required',map:'zone_r_0',x:30,y:0,required:true,label:'Guard camp'};
  const cave={run:'r',floor:0,paused:false,points:[{id:'main',exit:true,to:'main',x:0,y:0},stairs,room]};
  const d={phase:'active',run:'r',participants:['W','P'],commands:{},progress:{enabled:true,serial:0}};
  const party={dailyDungeons:d,statuses:{}};let fresh=true;const sent=[];
  for(const n of d.participants)party.statuses[n]={map:'zone_r_0',x:0,y:0,dungeon:{alive:true,ready:true,cave:structuredClone(cave)}};
  const issue=(names,action,id,extra)=>{sent.push(action);for(const n of names)d.commands[n]={id:id+':'+n,action,...extra};};
  const progress=createCaveProgress(party,{fresh:()=>fresh,persist(){},issue,startTravel:target=>issue(d.participants,'move','travel:'+ ++d.progress.serial,{target})});
  function done(){for(const n of d.participants){const s=party.statuses[n],c=d.commands[n];s.x=c.target.x;s.y=c.target.y;s.dungeon.action={id:c.id,status:'complete'};}}
  const update=fn=>d.participants.forEach(n=>fn(party.statuses[n].dungeon.cave));
  return {party,d,progress,sent,done,update,stale:()=>fresh=false,tick:()=>progress.tick(d)};
}
test('clears required rooms, approaches unlocked stairs and crosses exactly once',()=>{
 const f=setup();f.tick();assert.equal(f.d.commands.W.target.id,'required');
 f.done();f.tick();assert.deepEqual(f.sent,['move']);
 f.update(c=>{c.points[1].locked=false;c.points[2].done=true;});f.tick();assert.equal(f.d.commands.W.target.id,'stairs');
 f.done();f.tick();assert.equal(f.d.commands.W.action,'stairs');
 f.done();f.tick();assert.deepEqual(f.sent,['move','move','stairs']);
 f.update(c=>{c.floor=1;c.points=[{id:'next',map:'zone_r_1',x:20,y:0,down:true,to:'zone_r_2'}];});
 for(const s of Object.values(f.party.statuses))s.map='zone_r_1';
 f.tick();assert.equal(f.d.commands.W.action,'move');assert.equal(f.d.commands.W.target.id,'next');
});
test('stairs wait for combat, every arrival, and missing participants',()=>{
 const f=setup();f.update(c=>c.points[1].locked=false);f.tick();f.done();
 f.party.statuses.P.dungeon.ready=false;f.tick();assert.equal(f.d.commands.W.action,'move');
 f.party.statuses.P.dungeon.ready=true;f.party.statuses.P.x=0;f.tick();assert.equal(f.d.commands.W.action,'move');
 f.done();f.stale();f.tick();assert.equal(f.d.commands.W.action,'move');
});
test('forced choices and fallen members pause progress; manual pause cancels travel',()=>{
 const f=setup();f.update(c=>c.paused=true);f.tick();assert.equal(f.sent.length,0);
 f.update(c=>c.paused=false);f.progress.set(true);f.party.statuses.P.dungeon.alive=false;f.tick();assert.equal(f.sent.length,0);
 f.party.statuses.P.dungeon.alive=true;f.tick();f.progress.set(false);assert.deepEqual(f.d.commands,{});
 f.tick();assert.equal(f.sent.length,1);
});
test('final floor completion never picks Mainland or stairs up',()=>{
 const f=setup();f.update(c=>c.points=[{id:'main',exit:true,to:'main'}, {id:'up',down:false,to:'zone_r_0'}]);
 f.tick();assert.equal(f.sent.length,0);assert.match(f.d.progress.message,/Exit remains manual/);
});
test('lost stairs reply reconciles from observed next floor without dispatching again',()=>{
 let saved;const j=createDungeonJournal(()=>null,s=>saved=s);
 j.save({id:'s',action:'stairs',run:'r',target:{to:'zone_r_1'}},'uncertain');
 const restored=createDungeonJournal(()=>saved,()=>{});
 restored.reconcile({run:'r',floor:0},'W');assert.equal(restored.blocked(),true);
 restored.reconcile({run:'r',floor:1},'W');assert.equal(restored.blocked(),false);
});
