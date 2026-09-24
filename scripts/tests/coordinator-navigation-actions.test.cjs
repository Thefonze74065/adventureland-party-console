const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorNavigationActions}=require('../../runtime/coordinator/http/navigation-actions.ts');
function fixture(){
 const location={map:'main',x:1,y:2},state={leader:'F',merchantCharacter:'M',activeConvoy:null,partyFarmingMode:'default',farmingPolicy:'hunt',
  monsterHunt:{target:'bat'},monsterFocus:['goo'],monsterSearchRadiusByCharacter:{},statuses:{F:{seenAt:100000,map:'main'}},location,
  combatLogs:{},commands:{},nextCommandId:40,eventReturn:null,townCycle:null,anniversary:{eventCycle:null},eventSessions:{},deferredEventReturns:{}};
 const calls=[],group={ready:true,anchor:{map:'main'},blockers:[],key:'key',selection:'bat',members:['F']};
 const service=createCoordinatorNavigationActions(state,{
  now:()=>100000,owned:name=>name==='F',intent:()=>({revision:7}),group:()=>group,persist:()=>calls.push('persist'),
  selectedDestination:()=>location,finishReturn:()=>calls.push('finish'),contains:()=>true,
  huntOwns:hunt=>{assert.equal(hunt,state.monsterHunt);return !!hunt?.busy;},
  engage:(current,body,options)=>{assert.equal(current,state);calls.push(['engage',options]);return true;},
  acceptArrival:(hunt,convoy,body,at)=>{assert.equal(hunt,state.monsterHunt);calls.push(['arrival',convoy.id,at]);return true;},
  waypoint:()=>location,start:(...args)=>{calls.push(['start',...args]);return true;},active:()=>['F'],members:()=>['F'],
  valid:(current,body)=>{assert.equal(current,state);return body.convoyId===state.activeConvoy?.id;},history:()=>calls.push('history'),
  hold:(current,...args)=>{assert.equal(current,state);calls.push(['hold',...args]);},error:message=>calls.push(['error',message]),
 });
 function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 return {state,calls,service,invoke,location};
}

test('navigation engagement uses the replaced Hunt target and passes the current state to convoy adapters',()=>{
 const t=fixture();t.state.monsterHunt={target:'rat'};t.state.activeConvoy={id:'convoy',phase:'travel',participants:['F']};
 assert.equal(t.invoke(t.service.engagement.engage,{character:'F',target:{map:'main'}}).code,200);
 assert.deepEqual(t.calls[0],['engage',{revisions:{F:7},radius:400,focus:['rat']}]);
 assert.deepEqual(t.calls[1],['arrival','convoy',100000]);
 t.state.activeConvoy=null;t.state.monsterHunt={busy:true};
 const body={character:'F',key:'key',selection:'bat',navigationRevision:7,location:t.location};
 assert.equal(t.invoke(t.service.engagement.approach,body).code,409);
 t.state.monsterHunt={busy:false};assert.equal(t.invoke(t.service.engagement.approach,body).code,200);
 assert.equal(t.calls.at(-1)[4],'grouped-approach');
});

test('Franky exit acknowledgements allocate Town once and preserve it against replayed completion',()=>{
 const t=fixture();t.state.activeConvoy={id:'exit',phase:'travel',departAt:1,purpose:'franky-exit',participants:['F']};
 t.state.eventReturn={exitConvoyId:'exit',cycleId:'cycle',event:'franky',checkpoint:t.location,pending:['F']};
 t.state.commands={F:{id:1,type:'convoy-move'}};t.state.nextCommandId=90;
 assert.equal(t.invoke(t.service.acknowledgements.complete,{character:'F',convoyId:'exit'}).code,200);
 assert.deepEqual(t.state.commands.F,{id:90,type:'event-return-town',cycleId:'cycle',event:'franky',checkpoint:t.location});
 assert.equal(t.state.nextCommandId,91);assert.equal(t.state.activeConvoy,null);
 assert.equal(t.invoke(t.service.acknowledgements.complete,{character:'F',convoyId:'exit'}).code,200);
 assert.equal(t.invoke(t.service.acknowledgements.complete,{character:'F',convoyId:'older-exit'}).code,409);
 assert.equal(t.state.commands.F.id,90);
});

test('convoy failure records a hold before persisting diagnostics',()=>{
 const t=fixture();t.state.activeConvoy={id:'convoy',phase:'travel',participants:['F']};
 assert.equal(t.invoke(t.service.acknowledgements.failed,{character:'F',convoyId:'convoy',reason:'lost worker',failureCode:'runtime-lost'}).code,200);
 assert.deepEqual(t.calls,[['hold','F: lost worker','runtime-lost'],'history','persist',['error','[convoy] F: lost worker']]);
 assert.equal(t.state.combatLogs.F[0].message,'!!! CONVOY STOPPED !!! lost worker');
});
