const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorRealmActions}=require('../../runtime/coordinator/http/realm-actions.ts');
function fixture(){
 const state={commands:{F:{type:'old'},M:{type:'old'}},steamMembers:['F'],nextCommandId:80,
  statuses:{F:{seenAt:100000,server:'USII',ctype:'priest'},M:{seenAt:100000,server:'USII',ctype:'merchant'}},
  activeRealm:'SR_USII',leader:'F',realmSwitch:null,bankboiTransaction:null};
 const calls=[],block={enabled:true,realm:'SR_USII'};let home='SR_USII';
 const routes=createCoordinatorRealmActions(state,{
  now:()=>100000,sleep:async ms=>{await new Promise(resolve=>setImmediate(resolve));calls.push(['sleep',ms]);state.statuses={F:{seenAt:100000,server:'EUI',ctype:'priest'},M:{seenAt:100000,server:'EUI',ctype:'merchant'}};},
  pauseMerchant:()=>calls.push('pause'),native:()=> 'F',block:name=>{assert.equal(name,'M');return block;},
  stop:async worker=>{assert.equal(worker,block);calls.push(['stop',worker.realm]);},persist:()=>calls.push('persist'),label:realm=>realm,
  dispatch:()=>calls.push('dispatch'),resolve:realm=>realm==='SR_EUI',bankBusy:()=>false,participants:()=>['F','M'],current:()=>state.activeRealm,
  accountCharacters:()=>['F','M'],characterHome:()=>home,start:()=>true,connectionCount:()=>2,home:()=>home,refresh:async()=>{calls.push('refresh');if(Object.values(state.commands).some(command=>command.type==='realm-set-home'))home='SR_EUI';},
 });
 async function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({body},res);return res;}
 async function settled(){for(let i=0;i<30&&state.realmSwitch.phase==='switching';i++)await new Promise(resolve=>setImmediate(resolve));assert.notEqual(state.realmSwitch.phase,'switching');}
 return {state,calls,routes,invoke,settled};
}

test('home-realm changes wait for the HTTP acknowledgement before dispatching the merchant',async()=>{
 const t=fixture();await t.invoke(t.routes.switchRealm,{realm:'SR_EUI',setHome:true});await t.settled();
 assert.equal(t.state.realmSwitch.phase,'setting-home');assert.equal(t.state.commands.F.type,'realm-set-home');assert.equal(t.state.commands.F.id,81);
 assert.equal(t.calls.includes('dispatch'),false);
 assert.equal((await t.invoke(t.routes.homeComplete,{character:'F',operationId:'wrong',success:true})).code,409);
 assert.equal((await t.invoke(t.routes.homeComplete,{character:'F',operationId:t.state.realmSwitch.id,success:true})).code,200);
 assert.equal(t.state.realmSwitch.phase,'setting-home');assert.equal(t.state.commands.F,undefined);
 assert.equal((await t.invoke(t.routes.homeComplete,{character:'M',operationId:t.state.realmSwitch.id,success:true})).code,200);
 for(let i=0;i<30&&t.state.realmSwitch.phase!=='complete';i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(t.state.realmSwitch.phase,'complete');
 assert.equal(t.calls.at(-1),'dispatch');
});
