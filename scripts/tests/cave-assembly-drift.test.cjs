const test=require('node:test'),assert=require('node:assert/strict');
const {createCaveTravel}=require('../../runtime/coordinator/dungeons/travel.ts');
function setup(){
 const origin={id:'assembly',label:'Party assembly',map:'cave0',x:0,y:0};
 const target={id:'boss',label:'Lockbreaker',map:'cave0',x:1000,y:0};
 const d={run:'r',phase:'active',participants:['W','P'],commands:{},travel:{origin,target,stage:'assembling',serial:4}};
 const party={dailyDungeons:d,statuses:{}};let calls=[];
 for(const name of d.participants){d.commands[name]={id:'gather:'+name,action:'gather',run:'r',target:origin};party.statuses[name]={seenAt:100,map:'cave0',x:0,y:0,dungeon:{alive:true,ready:true,cave:{run:'r',floor:0},action:{id:d.commands[name].id,status:'complete'}}};}
 party.statuses.P.x=100;
 const travel=createCaveTravel(party,{fresh:name=>party.statuses[name].seenAt===100,persist(){},issue(names,action,id,extra){calls.push({names,action,id});for(const name of names)d.commands[name]={...extra,action,id:id+':'+name};}});
 return {d,party,travel,calls};
}
test('completed Cave gather displaced by combat receives a new owned gather before departure',()=>{
 const f=setup(),old=f.d.commands.P.id;f.travel.tick();
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].names,['P']);assert.equal(f.calls[0].action,'gather');assert.notEqual(f.d.commands.P.id,old);assert.equal(f.d.travel.stage,'assembling');
 f.travel.tick();assert.equal(f.calls.length,1,'old completion cannot reissue the new in-flight gather');
 f.party.statuses.P.x=0;f.party.statuses.P.dungeon.action={id:f.d.commands.P.id,status:'complete'};f.travel.tick();assert.equal(f.d.travel.stage,'travelling');
});
test('Cave regroup rejects stale, combat-busy, wrong-run and superseded gather evidence',()=>{
 for(const change of [f=>f.party.statuses.P.seenAt=0,f=>f.party.statuses.W.dungeon.ready=false,f=>f.party.statuses.P.dungeon.cave.run='other',f=>f.party.statuses.P.map='other',f=>f.d.commands.P.action='vote',f=>f.party.statuses.P.dungeon.action.id='old']){const f=setup();change(f);f.travel.tick();assert.equal(f.calls.length,0);}
});
test('repeated completed assembly drift is bounded and retains the selected target',()=>{
 const f=setup();f.d.travel.assemblyRepairs=3;f.travel.tick();
 assert.equal(f.calls.length,0);assert.match(f.d.error,/assembly.*displaced/i);assert.equal(f.d.travel.target.id,'boss');
});
