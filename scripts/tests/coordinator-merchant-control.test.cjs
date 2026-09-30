const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantControlRoutes}=require('../../runtime/coordinator/http/merchant-control.ts');
const {createMerchantRequestRoutes}=require('../../runtime/coordinator/http/merchant-requests.ts');
function fixture(){
 const state={merchantCharacter:'M',activeRealm:'SR_USI',merchantQueue:[],merchantCurrent:null,commands:{},merchantAutomations:{},autoExchanges:{a:{},b:{}},gatheringModes:['fishing'],statuses:{M:{}},merchantCatalog:{allItems:[{id:'cap'}]}};
 for(const key of ['marked','merchantMarked','statScrolls','upgrades','compounds','autoCompounds'])state[key]={F:['intent']};
 const calls=[],ports={now:()=>100,nextCommand:()=>1,stamp:j=>({...j,priority:50}),automated:r=>r==='fishing',log:(...args)=>calls.push(args),persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),returnHome:(...args)=>calls.push(['home',...args]),realmExists:r=>r==='SR_USII'};
 const routes={...createMerchantControlRoutes(state,ports),...createMerchantRequestRoutes(state,ports)};
 function send(route,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};routes[route]({body},res);return res;}
 return {state,calls,send};
}
test('cancel clears only the matching work intent and never dispatches',()=>{
 for(const [reason,cleared] of [['marked items',['marked','merchantMarked']],['stat scrolls',['statScrolls','upgrades','compounds']],['auto compound',['autoCompounds']]]){
  const f=fixture();f.state.merchantQueue=[{id:'j',target:'F',reason}];assert.equal(f.send('cancel',{id:'j'}).code,200);
  for(const key of cleared)assert.deepEqual(f.state[key].F,[]);assert.equal(f.calls.includes('dispatch'),false);
 }
 const f=fixture();f.state.merchantQueue=[{id:'j',target:'M',reason:'exchange',autoExchangeKeys:['a']}];f.send('cancel',{id:'j'});
 assert.equal(f.state.autoExchanges.a,undefined);assert.ok(f.state.autoExchanges.b);assert.equal(f.state.merchantAutomations['automatic exchange'],false);assert.equal(f.state.merchantAutomations['manual exchange'],undefined);
 assert.equal(f.send('cancel',{id:'missing'}).code,404);
});

test('cancelling either upgrade routine preserves the other upgrade intent',()=>{
 for(const reason of ['auto upgrade','manual upgrades']) {
  const f=fixture();f.state.upgrades.F=[{id:'manual'},{id:'auto',auto:true}];
  f.state.merchantQueue=[{id:'j',target:'F',reason}];f.send('cancel',{id:'j'});
  assert.deepEqual(f.state.upgrades.F,reason==='auto upgrade'?[{id:'manual'}]:[{id:'auto',auto:true}]);
  if(reason==='auto upgrade') {assert.equal(f.state.merchantAutomations['auto upgrade'],false);assert.deepEqual(f.state.statScrolls.F,['intent']);}
  else assert.deepEqual(f.state.statScrolls.F,[]);
 }
});
test('force stand retains durable work, clears execution fields, and resumes without discarding queue',()=>{
 const f=fixture();f.state.merchantCurrent={id:'j',target:'F',reason:'merchant commerce',phase:'travel',startedAt:1,heartbeatAt:2,progressAt:3,handoff:{},resumeState:{pass:8},queuedAt:25};
 f.state.commands.M={id:4,type:'merchant-service'};f.send('force',{enabled:true});
 const saved=f.state.merchantQueue[0];assert.deepEqual(saved.resumeState,{pass:8});assert.equal(saved.queuedAt,25);assert.equal(saved.phase,undefined);assert.equal(saved.handoff,undefined);
 assert.equal(f.state.merchantCurrent,null);assert.equal(f.state.commands.M,undefined);assert.ok(f.calls.some(c=>Array.isArray(c)&&c[0]==='home'));
 f.state.commands.M={type:'merchant-idle'};f.send('force',{enabled:false});assert.equal(f.state.commands.M,undefined);assert.equal(f.state.merchantQueue.length,1);assert.ok(f.calls.includes('dispatch'));
});
test('clear stops merchant gathering and removes current recipient command',()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',target:'F'};f.state.commands.F={type:'merchant-handoff',jobId:'job'};f.send('clear');
 assert.equal(f.state.commands.F,undefined);assert.deepEqual(f.state.commands.M,{id:1,type:'merchant-gather',mode:null});assert.deepEqual(f.state.gatheringModes,[]);
});
test('donation, search and giveaway validate before queueing and retain their scheduling rules',()=>{
 const f=fixture();assert.equal(f.send('donate',{amount:0}).code,400);assert.equal(f.send('search',{itemId:'bad'}).code,400);assert.equal(f.send('giveaway',{seller:'Seller',realm:'PVP'}).code,400);assert.deepEqual(f.state.merchantQueue,[]);
 assert.equal(f.send('donate',{amount:10}).body.xp,32);assert.equal(f.state.merchantQueue[0].priority,undefined);
 f.send('giveaway',{seller:' Seller ',realm:'us ii'});assert.equal(f.state.merchantQueue[1].realm,'SR_USII');assert.equal(f.state.merchantQueue[1].priority,50);
 f.send('search',{itemId:'cap'});assert.deepEqual(f.state.standSearch,{status:'searching',itemId:'cap',listings:[],error:null});
});
