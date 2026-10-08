const test=require('node:test'),assert=require('node:assert/strict');
const {createRealmRoutes}=require('../../runtime/coordinator/http/realms.ts');
function fixture(){
 const state={steamMembers:['P'],realmSwitch:null,bankboiTransaction:null,statuses:{P:{server:'USII',seenAt:100000}},commands:{P:{id:1}}};
 let now=100000; const calls=[],ports={now:()=>now,sleep:async ms=>{now+=ms;},accountCharacters:()=>["P"],characterHome:()=> "SR_USII",resolve:realm=>['SR_USII','SR_EUI','SR_PVP'].includes(realm),bankBusy:()=>false,participants:()=>['P'],native:()=> 'P',
  current:()=> 'SR_USII',home:()=> 'SR_USII',persist:()=>calls.push('persist'),run:operation=>calls.push(operation),refresh:async()=>{},label:realm=>realm,dispatch:()=>calls.push('dispatch')};
 const routes=createRealmRoutes(state,ports);
 async function send(route,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await routes[route]({body},res);return res;}
 return {state,ports,calls,send};
}
test('realm changes reject missing participants, stale reports, active BankBoi and PVP before dispatch',async()=>{
 const t=fixture();assert.equal((await t.send('switchRealm',{realm:'unknown'})).code,400);
 assert.equal((await t.send('switchRealm',{realm:'SR_PVP'})).code,409);
 t.state.bankboiTransaction={};assert.equal((await t.send('switchRealm',{realm:'SR_EUI'})).code,409);t.state.bankboiTransaction=null;
 t.state.statuses.P.seenAt=1;assert.deepEqual((await t.send('switchRealm',{realm:'SR_EUI'})).body.characters,['P']);
 assert.equal(t.calls.length,0);
});
test('realm request persists its exact operation before dispatch and refuses a concurrent switch',async()=>{
 const t=fixture(),result=await t.send('switchRealm',{realm:'SR_EUI',setHome:true});
 assert.equal(result.code,202);assert.equal(result.body.operation,t.state.realmSwitch);assert.equal(t.calls[0],'persist');
 assert.deepEqual(t.state.realmSwitch.characters,[{name:'P',realm:'SR_USII',arrived:false}]);
 assert.equal((await t.send('switchRealm',{realm:'SR_USII'})).code,409);
});

test('all-headless realm switching accepts fresh participants without a Steam connection',async()=>{
 for(const setHome of [false,true]) {
  const t=fixture();t.state.steamMembers=[];t.ports.native=()=>null;
  t.state.statuses.M={server:'USII',seenAt:100000};t.ports.participants=()=>['P','M'];
  const result=await t.send('switchRealm',{realm:'SR_EUI',setHome});
  assert.equal(result.code,202);assert.deepEqual(result.body.operation.participants,['P','M']);
  assert.equal(result.body.operation.setHome,setHome);assert.equal(t.calls[0],'persist');
  assert.equal(t.calls[1],t.state.realmSwitch);
 }
});

test('a Steam participant still requires a native connection in mixed rosters',async()=>{
 const t=fixture();t.ports.native=()=>null;
 t.state.statuses.M={server:'USII',seenAt:100000};t.ports.participants=()=>['M','P'];
 const result=await t.send('switchRealm',{realm:'SR_EUI'});
 assert.equal(result.code,409);assert.match(result.body.error,/Steam character must be connected/);
 assert.equal(t.state.realmSwitch,null);assert.deepEqual(t.calls,[]);
 t.ports.native=()=> 'P';assert.equal((await t.send('switchRealm',{realm:'SR_EUI'})).code,202);
});

test('Steam assignments outside the switch participants do not block headless switching',async()=>{
 const t=fixture();t.state.steamMembers=['Other'];t.ports.native=()=>null;
 assert.equal((await t.send('switchRealm',{realm:'SR_EUI'})).code,202);
});

test('headless switching retains freshness, empty-roster, bank and destination guards',async()=>{
 const t=fixture();t.state.steamMembers=[];t.ports.native=()=>null;
 assert.equal((await t.send('switchRealm',{realm:'unknown'})).code,400);
 assert.equal((await t.send('switchRealm',{realm:'SR_PVP'})).code,409);
 t.ports.participants=()=>[];assert.match((await t.send('switchRealm',{realm:'SR_EUI'})).body.error,/no active characters/);
 t.ports.participants=()=>['P'];t.state.statuses.P.seenAt=1;
 assert.deepEqual((await t.send('switchRealm',{realm:'SR_EUI'})).body.characters,['P']);
 delete t.state.statuses.P;assert.deepEqual((await t.send('switchRealm',{realm:'SR_EUI'})).body.characters,['P']);
 t.state.statuses.P={server:'USII',seenAt:100000};t.ports.bankBusy=()=>true;
 assert.match((await t.send('switchRealm',{realm:'SR_EUI'})).body.error,/bankboi transaction/);
 assert.deepEqual(t.calls,[]);assert.equal(t.state.realmSwitch,null);
});
test('home completion validates the command and confirms server state before resuming merchant',async()=>{
 const t=fixture();t.state.realmSwitch={id:'switch',realm:'SR_EUI',phase:'setting-home',homeExecutors:['P'],characters:[{name:'P'}]};
 assert.equal((await t.send('homeComplete',{operationId:'stale',character:'P',success:true})).code,409);assert.ok(t.state.commands.P);
 const body={operationId:'switch',character:'P',success:true};assert.equal((await t.send('homeComplete',body)).code,502);assert.equal(t.state.realmSwitch.phase,'failed');
 assert.equal(t.calls.includes('dispatch'),false);t.state.realmSwitch.phase='setting-home';t.ports.characterHome=()=> 'SR_EUI';
 assert.equal((await t.send('homeComplete',body)).body.homeRealm,'SR_EUI');assert.equal(t.state.realmSwitch.phase,'setting-home');assert.equal(t.state.realmSwitch.characters[0].homeConfirmed,true);assert.equal(t.calls.includes('dispatch'),false);
});

test('realm operations preserve unknown prior realms and ignore the account refresh return value',async()=>{
 const t=fixture();t.ports.current=()=>null;t.ports.home=()=>null;
 const result=await t.send('switchRealm',{realm:'SR_EUI',setHome:true});
 assert.equal(result.code,202);assert.equal(result.body.operation.fromRealm,null);assert.equal(result.body.operation.homeRealm,null);
 t.state.realmSwitch.phase='setting-home';t.state.realmSwitch.homeExecutors=['P'];
 t.ports.refresh=async()=>{t.ports.characterHome=()=> 'SR_EUI';return {characters:[],servers:[]};};
 const completed=await t.send('homeComplete',{operationId:t.state.realmSwitch.id,character:'P',success:true});
 assert.equal(completed.code,200);assert.equal(t.state.realmSwitch.phase,'setting-home');assert.equal(t.state.realmSwitch.characters[0].homeConfirmed,true);assert.equal(t.calls.includes('dispatch'),false);
});
