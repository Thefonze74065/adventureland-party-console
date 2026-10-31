const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantExchangeRoutes}=require('../../runtime/coordinator/http/merchant-exchange.ts');
// Failure inventory: e2e/automatic-bank-routing-failures.md.
test('default exchange rewards persist banking without overwriting explicit actions',()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',reason:'exchange',target:'M'};
 f.state.merchantRules={owner:'M',members:['M']};
 f.state.autoItemMarks={M:{}};
 const {automaticCommerceRuleKey}=require('../../runtime/coordinator/inventory/item-identity.ts');
 f.state.autoNpcSales={[automaticCommerceRuleKey({name:'helmet'})]:{item:{name:'helmet'}}};
 const response=f.post('progress',{jobId:'job',remaining:[],rewards:[{name:'leather',q:3},{name:'helmet'}]});
 assert.equal(response.code,200);
 assert.equal(f.state.autoItemMarks.M['leather@+0'],'bank');
 assert.equal(f.state.autoItemMarks.M['helmet@+0'],undefined);
 assert.deepEqual(response.body.rewardActions.map(entry=>entry.action),['bank','npc']);
 assert.deepEqual(f.effects,['persist']);
});
function fixture(){
 const state={merchantCharacter:'M',merchantCatalog:{exchangeable:[{id:'leather',level:0},{id:'token',level:1,reward:'coat'}]},merchantCurrent:null,merchantQueue:[]},effects=[];
 const routes=createMerchantExchangeRoutes(state,{now:()=>100,nextCommand:()=>1,stamp:job=>({...job,priority:50}),log:()=>effects.push('log'),persist:()=>effects.push('persist'),dispatch:()=>effects.push('dispatch'),queueStorage:(job,shortages)=>{effects.push(['supply',job.id,shortages]);return true;}});
 const post=(route,body)=>{const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},res);return res;};
 return {state,effects,post};
}
test('exchange orders preserve level and reward choice and reject unavailable combinations',()=>{
 const f=fixture();assert.equal(f.post('order',{exchanges:[{id:'token',level:0,reward:'coat',quantity:1}]}).code,400);
 assert.equal(f.post('order',{exchanges:[{id:'token',level:1,reward:'coat',quantity:2}]}).code,200);
 assert.deepEqual(f.state.merchantQueue[0].exchanges,[{id:'token',level:1,quantity:2,reward:'coat'}]);assert.equal(f.state.merchantQueue[0].priority,50);
});
test('exchange progress is fenced to the current job and checkpoints remaining work before returning',()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',reason:'exchange',target:'M'};
 assert.equal(f.post('progress',{jobId:'stale',remaining:[],rewards:[]}).code,409);
 assert.equal(f.post('progress',{jobId:'job',remaining:[]}).code,400);assert.deepEqual(f.effects,[]);
 assert.equal(f.post('progress',{jobId:'job',remaining:[],rewards:[{item:'coat'}]}).code,200);assert.equal(f.state.merchantCurrent.exchangeResume,true);
 assert.deepEqual(f.state.merchantCurrent.exchangeRewards,[{item:'coat'}]);assert.deepEqual(f.effects,['persist']);
});
test('exchange shortage requests are delegated without transferring merchant ownership prematurely',()=>{
 const f=fixture(),job=f.state.merchantCurrent={id:'job',reason:'exchange',target:'M'};
 const shortages=[{id:'leather',quantity:40}];assert.deepEqual(f.post('supply',{jobId:'job',shortages}).body,{pending:true});
 assert.equal(f.state.merchantCurrent,job);assert.deepEqual(f.effects,[['supply','job',shortages]]);
});
