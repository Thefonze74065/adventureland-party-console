const test=require('node:test'),assert=require('node:assert/strict');
const {createFocusRoute}=require('../../runtime/coordinator/http/focus.ts');
const {createFormationRoute}=require('../../runtime/coordinator/http/formation.ts');
function fixture(){
 const state={leader:'L',merchantCharacter:'M',followers:{F:true},monsterFocus:['bat'],monsterFocusByCharacter:{F:['goo']},monsterPrioritiesByCharacter:{},monsterSearchRadiusByCharacter:{},
  scatterMonsterTypes:['bat'],scatterEpoch:1,partyFarmingMode:'scatter',partyFarmingMonsterType:'bat',scatterBreakTarget:{id:1},eventsByCharacter:{},eventSelectionsByCharacter:{}};
 const calls=[],ports={owned:name=>['L','F','M'].includes(name),members:()=>['L','F'],invalidate:(...args)=>calls.push(args),persist:()=>calls.push('persist'),
  managed:name=>['L','F','M'].includes(name),supported:['anniversary','franky'],inherited:name=>name==='F',selected:()=>['anniversary']};
 const routes={focus:createFocusRoute(state,ports),formation:createFormationRoute(state,ports)};
 function send(route,body){const r={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},r);return r;}
 return {state,calls,ports,send};
}

test('clearing merchant focus during another character Hunt invalidates merchant navigation',()=>{
 const t=fixture();t.state.farmingPolicy='hunt';t.state.monsterHunt={participants:['L','F']};
 t.send('focus',{character:'M',monsterFocus:[]});assert.ok(t.calls.some(c=>Array.isArray(c)&&c[1]==='monster focus cleared'));
});
test('leader selection clears follower overrides and resets scatter only when focus changes',()=>{
 const t=fixture();const r=t.send('focus',{character:'L',monsterFocus:['goo','goo'],monsterPriorities:{goo:2.6},monsterSearchRadius:901.2});
 assert.deepEqual(t.state.monsterFocus,['goo']);assert.equal(t.state.monsterFocusByCharacter.F,undefined);assert.equal(t.state.scatterEpoch,2);
 assert.deepEqual(r.body.monsterPriorities,{goo:3});assert.equal(r.body.monsterSearchRadius,901);
 t.send('focus',{character:'L',monsterFocus:['goo']});assert.equal(t.state.scatterEpoch,2);assert.equal(t.state.monsterSearchRadiusByCharacter.L,901);
});
test('focus validation rejects invalid priorities and radius before mutation',()=>{
 const t=fixture();for(const body of [{monsterFocus:['tinyp']},{monsterFocus:['goo'],monsterPriorities:[]},{monsterFocus:['goo'],monsterSearchRadius:0}])assert.equal(t.send('focus',body).code,400);
 assert.deepEqual(t.state.monsterFocus,['bat']);assert.equal(t.calls.length,0);
});
test('clearing independent focus invalidates only its checkpoint while a global clear invalidates party members',()=>{
 const t=fixture();t.send('focus',{character:'F',monsterFocus:[]});assert.deepEqual(t.calls[0],[['F'],'monster focus cleared',false]);
 t.send('focus',{monsterFocus:[]});assert.deepEqual(t.calls[2],[['L','F'],'monster focus cleared',true]);
});
test('formation preserves inherited event restrictions and independent merchant selection',()=>{
 const t=fixture();assert.equal(t.send('formation',{character:'F',eventSelections:['franky']}).code,409);
 assert.equal(t.send('formation',{character:'M',eventSelections:['franky']}).code,200);
 assert.equal(t.send('formation',{character:'M',eventSelections:['anniversary','anniversary']}).code,200);
 assert.deepEqual(t.state.eventSelectionsByCharacter.M,['anniversary']);
 t.send('formation',{character:'L',events:true});assert.deepEqual(t.state.eventSelectionsByCharacter.L,['anniversary','franky']);
});
test('formation sets and clears the off tank beside the tank, rejecting unknown names',()=>{
 const t=fixture();const r=t.send('formation',{tank:'L',offTank:'F'});
 assert.equal(t.state.designatedTank,'L');assert.equal(t.state.offTank,'F');assert.equal(r.body.offTank,'F');
 assert.equal(t.send('formation',{offTank:'Nobody'}).code,400);assert.equal(t.state.offTank,'F');
 t.send('formation',{offTank:null});assert.equal(t.state.offTank,null);assert.equal(t.state.designatedTank,'L');
});
test('formation turns pull mode on and off and rejects a non-boolean',()=>{
 const t=fixture();assert.equal(t.send('formation',{pullMode:true}).body.pullMode,true);assert.equal(t.state.pullMode,true);
 assert.equal(t.send('formation',{pullMode:'yes'}).code,400);assert.equal(t.state.pullMode,true);
 t.send('formation',{pullMode:false});assert.equal(t.state.pullMode,false);
});
