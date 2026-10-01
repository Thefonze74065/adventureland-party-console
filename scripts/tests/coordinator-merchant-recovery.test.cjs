const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantRecovery}=require('../../runtime/coordinator/merchant/recovery.ts');
function fixture(job){
 const state={current:job,queue:[]},effects=[];let now=100000;
 const ports={now:()=>now,nextCommand:()=>7,clearCommand:name=>effects.push(['clear',name]),restockSatisfied:()=>false,
  stamp:job=>({...job,priority:80}),log:message=>effects.push(message),persist:()=>effects.push('persist'),dispatch:()=>effects.push('dispatch'),recoverSale:()=>effects.push('sale')};
 return {state,effects,ports,time:value=>{now=value;},observe:(...args)=>createMerchantRecovery(state,ports).observe(...args)};
}
test('stranded checkpoints preserve inventory intent and receive a fresh job identity after ten seconds',()=>{
 const job={id:'old',target:'M',reason:'upgrades and compounds',phase:'checkpointed',checkpointAt:90000,startedAt:80000,handoff:{},upgrades:[{slot:1}]};
 const f=fixture(job);f.observe('M',[]);assert.equal(f.state.current,job);
 f.time(100001);f.observe('M',[]);assert.equal(f.state.current,null);
 assert.deepEqual(f.state.queue[0],{id:'merchant-100001-7',target:'M',reason:'upgrades and compounds',resumedFrom:'old',priority:80,upgrades:[{slot:1}]});
});
test('commerce progress can expire independently of a healthy worker heartbeat',()=>{
 const f=fixture({id:'old',target:'M',reason:'merchant commerce',phase:'processing',heartbeatAt:99999,progressAt:1,startedAt:1});
 f.observe('M',[]);assert.equal(f.state.queue.length,1);assert.equal(f.state.queue[0].heartbeatAt,undefined);
});
test('completed restock dispatches before evaluating the next job recovery',()=>{
 const f=fixture({id:'restock',target:'M',reason:'restock'});f.ports.restockSatisfied=()=>true;
 f.ports.dispatch=()=>{f.effects.push('dispatch');f.state.current={id:'next',target:'M',reason:'other',phase:'processing',heartbeatAt:100000};};
 f.observe('M',[]);assert.equal(f.state.current.id,'next');assert.equal(f.state.queue.length,0);
 assert.deepEqual(f.effects,['sale',['clear','M'],'Merchant potion restock completed','persist','dispatch']);
});


test('anniversary deferral releases ownership once without losing purchase progress',()=>{
 const f=fixture({id:'p',commandId:9,target:'M',reason:'Ponty purchases',phase:'assigned',startedAt:70000,completedListingKeys:['bought']});
 const report={jobId:'p',commandId:9,state:'deferred',reason:'anniversary',at:100000};
 f.observe('M',[],report);f.observe('M',[],report);
 assert.equal(f.state.current,null);assert.equal(f.state.queue.length,1);
 assert.equal(f.state.queue[0].commandId,undefined);
 assert.deepEqual(f.state.queue[0].completedListingKeys,['bought']);
});
test('continuous non-anniversary deferrals cannot reset the watchdog',()=>{
 const f=fixture({id:'p',commandId:9,target:'M',reason:'marked items',phase:'assigned',startedAt:90000});
 f.observe('M',[],{jobId:'p',commandId:9,state:'deferred',reason:'escape',at:100000});
 assert.equal(f.state.current.startedAt,90000);
 f.time(111000);f.observe('M',[],{jobId:'p',commandId:9,state:'deferred',reason:'escape',at:111000});
 assert.equal(f.state.current,null);assert.equal(f.state.queue.length,1);
 assert.equal(f.state.queue[0].retryAt,131000);
});

test('stale command acknowledgements cannot retain a replacement job',()=>{
 const f=fixture({id:'new',commandId:10,target:'M',reason:'Ponty purchases',phase:'assigned',startedAt:70000,recoveryAttempts:20});
 f.observe('M',[],{jobId:'new',commandId:9,state:'deferred',reason:'escape',at:100000});
 assert.equal(f.state.current,null);
});

test('production deferral keeps its actual reason through watchdog requeue',()=>{
 const f=fixture({id:'p',commandId:9,target:'M',reason:'merchant luck',phase:'assigned',startedAt:70000});
 f.observe('M',[],{jobId:'p',commandId:9,state:'deferred',reason:'Production recovery needs review: orphan',at:100000});
 assert.equal(f.state.queue[0].lastDeferredReason,'Production recovery needs review: orphan');
 assert.ok(f.effects.some(message=>typeof message==='string' && message.includes('Command deferred (Production recovery needs review: orphan); retry scheduled')));
 assert.ok(!f.effects.some(message=>typeof message==='string' && message.includes('not acknowledged')));
});
