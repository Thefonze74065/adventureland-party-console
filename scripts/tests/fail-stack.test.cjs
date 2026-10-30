const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const {sacrificeSlots,reachedStopChance,validFailStackAttempts,validFailStackChance}=require('../../runtime/fail-stack.ts');
const {createFailStacks}=require('../../runtime/coordinator/merchant/fail-stack.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
const sword=(level=7,extra={})=>({name:'sword',level,...extra});

test('only exact unlocked, unbound, plain copies other than the target are eligible',()=>{
 const items=[sword(7),sword(7),sword(7,{l:'l'}),sword(7,{b:'b'}),sword(7,{p:'shiny'}),sword(8),{name:'hat',level:7},null,sword(7)];
 assert.deepEqual(sacrificeSlots(items,{sacrifice:{name:'sword',level:7}},0),[1,8]);
 assert.deepEqual(sacrificeSlots(items,{sacrifice:{name:'sword',level:8}},0),[5]);
 assert.deepEqual(sacrificeSlots(items,{sacrifice:{name:'sword',level:7}},1),[0,8],'the stacked item is never eligible');
 assert.deepEqual(sacrificeSlots([sword(7,{q:2})],{sacrifice:{name:'sword',level:7}},5),[]);
 assert.deepEqual(sacrificeSlots([{name:'sword'}],{sacrifice:{name:'sword',level:0}},5),[0],'a missing level means +0');
});
test('stop chance and attempt limits',()=>{
 assert.equal(reachedStopChance({},0.99),false);
 assert.equal(reachedStopChance({stopChance:0.4},0.3999),false);assert.equal(reachedStopChance({stopChance:0.4},0.4),true);
 for(const ok of [1,50])assert.equal(validFailStackAttempts(ok),true);
 for(const bad of [0,51,1.5,'3',null])assert.equal(validFailStackAttempts(bad),false);
 for(const ok of [0.01,1])assert.equal(validFailStackChance(ok),true);
 for(const bad of [0,1.1,Number.NaN,'0.5'])assert.equal(validFailStackChance(bad),false);
});

function coordinator({items,offerings=[],queue=[],extra={}}={}){
 const state={merchantCharacter:'M',merchantCatalog:{allItems:[{id:'sword',upgradeable:true,meta:{upgradeable:true,maxLevel:13,definition:{}}},{id:'apple',meta:{upgradeable:false}}]},
  statuses:{M:{items:(items||[sword(7),sword(7),sword(7)]).map((item,slot)=>({slot,item}))}},merchantCurrent:null,merchantQueue:queue,...extra};
 const log={persist:0,dispatch:0};let handler;
 createFailStacks(state,{persist:()=>log.persist++,dispatch:()=>log.dispatch++,stamp:job=>({...job,stamped:true})},()=>1000).install({post:(path,fn)=>{assert.equal(path,'/party-api/fail-stack');handler=fn;}});
 const call=async body=>{let out;await handler({body},{status(code){return {json:value=>{out={status:code,...value};}};},json:value=>{out={status:200,...value};}});return out;};
 return {state,log,call};
}
const request=(extra={})=>({character:'M',slot:0,item:sword(7),sacrifice:{name:'sword',level:7},attempts:5,offering:false,...extra});
test('coordinator queues one fail-stack job with the validated request',async()=>{
 const f=coordinator();const result=await f.call(request({stopChance:0.4,previewOffering:true}));
 assert.equal(result.status,200);assert.equal(f.state.merchantQueue.length,1);
 const job=f.state.merchantQueue[0];assert.equal(job.reason,'fail stack');assert.equal(job.target,'M');assert.equal(job.manual,true);assert.equal(job.stamped,true);
 assert.deepEqual(JSON.parse(JSON.stringify(job.failStack)),{slot:0,item:sword(7),sacrifice:{name:'sword',level:7},attempts:5,stopChance:0.4,offering:false,previewOffering:true});
 assert.equal(f.log.persist,1);assert.equal(f.log.dispatch,1);
 assert.equal((await f.call(request())).status,409,'a second job is refused while one is queued');
});
test('coordinator refuses requests that could burn the wrong item or too much',async()=>{
 const cases=[
  [request({attempts:0}),400,/1 and 50/],[request({attempts:51}),400,/1 and 50/],[request({stopChance:0}),400,/stop chance/],[request({stopChance:2}),400,/stop chance/],
  [request({sacrifice:{name:'sword'}}),400,/copies to burn/],[request({sacrifice:{name:'sword',level:-1}}),400,/copies to burn/],[request({character:'Other'}),400,/merchant inventory/],
  [request({item:sword(6)}),409,/changed/],[request({slot:9}),409,/changed/],
  [request({sacrifice:{name:'sword',level:5}}),409,/No spare copy/],[request({offering:true}),409,/No Primling/],
 ];
 for(const [body,status,message] of cases){const f=coordinator();const result=await f.call(body);assert.equal(result.status,status,JSON.stringify(body));assert.match(result.error,message);assert.equal(f.state.merchantQueue.length,0);}
 const lone=coordinator({items:[sword(7)]});const result=await lone.call(request());
 assert.equal(result.status,409,'the stacked item alone is not a spare');
 const apple=coordinator({items:[{name:'apple',level:0},{name:'apple',level:0}]});
 assert.equal((await apple.call({...request({item:{name:'apple',level:0},sacrifice:{name:'apple',level:0}})})).status,400);
 const locked=coordinator({items:[sword(7),sword(7,{l:'l'})]});assert.equal((await locked.call(request())).status,409,'locked copies do not count');
});
test('coordinator needs a Primling only when the job spends one',async()=>{
 const f=coordinator({items:[sword(7),sword(7),{name:'offeringp',q:3}]});
 assert.equal((await f.call(request({offering:true}))).status,200);
});

function runtime({items,chances=[],scrolls=1,primlings=0,outcomes=[]}={}){
 const calls={upgrades:[],previews:[],supplies:[],completes:[],travel:[]};
 const character={name:'M',ctype:'merchant',q:{},items:items||[sword(7),sword(7),sword(7),{name:'scroll0',q:scrolls},...(primlings?[{name:'offeringp',q:primlings}]:[])]};
 const r=vm.createContext({character,G:{items:{sword:{name:'Sword'}}},upgrading:false,Date,setTimeout:(fn)=>fn(),Promise,
  partyFailStackSlots:sacrificeSlots,partyReachedStopChance:reachedStopChance,
  fingerprint:i=>i&&({...i}),item_grade:()=>0,
  sameItemState:(a,b)=>!!a&&Object.keys(b).every(k=>a[k]===b[k]),
  inventoryQuantity:name=>character.items.filter(i=>i&&i.name===name).reduce((n,i)=>n+(i.q||1),0),
  findInventoryItemByName:name=>character.items.findIndex(i=>i&&i.name===name),
  previewTravel:async place=>{calls.travel.push(place);},
  primStackSupply:async(name,count)=>{calls.supplies.push([name,count]);},
  request:async(path,{body})=>{if(path==='/merchant/complete')calls.completes.push(body);return {};},
  upgrade:async(slot,scroll,offering,calculate)=>{
   if(calculate){calls.previews.push(slot);return {calculate:true,chance:chances.length?chances.shift():0};}
   const outcome=outcomes.length?outcomes.shift():'destroyed';calls.upgrades.push({slot,scroll,offering,outcome});
   const item=character.items[slot];
   if(outcome==='destroyed')character.items[slot]=null;else if(outcome==='upgraded')item.level++;
   const spend=slot=>{if(slot!==undefined&&slot>=0&&character.items[slot]&&--character.items[slot].q<=0)character.items[slot]=null;};
   spend(scroll);spend(offering);
   return {};
  },
 });
 const names=['failStackTarget','failStackChance','failStackOperation','failStackNext','merchantFailStack'];
 vm.runInContext(names.map(n=>namedFunction(source,n)).join('\n'),r);
 return {r,character,calls};
}
const job=(extra={})=>({slot:0,item:sword(7),sacrifice:{name:'sword',level:7},attempts:3,offering:false,previewOffering:false,...extra});
const run=(f,failStack)=>f.r.merchantFailStack({jobId:'j',id:1,failStack});
test('merchant burns spare copies, never the stacked item, and reports each outcome',async()=>{
 const f=runtime({items:[sword(7),sword(7),sword(7),{name:'scroll0',q:5}],outcomes:['destroyed','upgraded']});
 await run(f,job({attempts:5}));
 assert.deepEqual(f.calls.upgrades.map(u=>u.slot),[1,2],'only the spares are attempted');
 assert.deepEqual(f.character.items[0],sword(7),'the stacked item is untouched');
 const done=f.calls.completes[0];assert.equal(done.success,true);
 assert.match(done.activity[0].message,/2 attempts \(1 destroyed, 1 upgraded, 0 survived\); stopped because no spare copies left/);
});
test('merchant stops at the attempt limit',async()=>{
 const f=runtime({items:[sword(7),sword(7),sword(7),sword(7),sword(7),{name:'scroll0',q:9}]});
 await run(f,job({attempts:2}));assert.equal(f.calls.upgrades.length,2);assert.match(f.calls.completes[0].activity[0].message,/all attempts used/);
 assert.ok(f.character.items.filter(i=>i&&i.name==='sword'&&i.level===7).length>=3,'unused spares remain');
});
test('merchant stops as soon as the measured chance reaches the stop chance',async()=>{
 const f=runtime({chances:[0.2,0.3,0.45],items:[sword(7),sword(7),sword(7),sword(7),sword(7),{name:'scroll0',q:9}]});
 await run(f,job({attempts:10,stopChance:0.4}));
 assert.equal(f.calls.upgrades.length,2);assert.equal(f.calls.previews.length,3);assert.match(f.calls.completes[0].activity[0].message,/the chance reached 40\.00%/);
});
test('a chance already at the stop chance burns nothing',async()=>{
 const f=runtime({chances:[0.9]});await run(f,job({stopChance:0.4}));
 assert.equal(f.calls.upgrades.length,0);assert.equal(f.calls.completes[0].success,true);assert.match(f.calls.completes[0].activity[0].message,/0 attempts/);
});
test('Primlings are spent only when asked, and the job stops when they run out',async()=>{
 const none=runtime({items:[sword(7),sword(7),sword(7),{name:'scroll0',q:5},{name:'offeringp',q:5}]});
 await run(none,job());assert.ok(none.calls.upgrades.every(u=>u.offering===undefined));assert.equal(none.character.items[4].q,5);
 const some=runtime({items:[sword(7),sword(7),sword(7),sword(7),{name:'scroll0',q:5},{name:'offeringp',q:1}]});
 await run(some,job({offering:true,attempts:5}));
 assert.equal(some.calls.upgrades.length,1);assert.equal(some.calls.upgrades[0].offering,5);assert.match(some.calls.completes[0].activity[0].message,/out of Primlings/);
});
test('missing scrolls are bought before the attempt, not after',async()=>{
 const f=runtime({items:[sword(7),sword(7)]});
 f.r.primStackSupply=async(name,count)=>{f.calls.supplies.push([name,count]);f.character.items.push({name:'scroll0',q:1});};
 await run(f,job({attempts:1}));assert.deepEqual(f.calls.supplies,[['scroll0',1]]);assert.equal(f.calls.upgrades.length,1);
});
test('losing track of the stacked item stops the job without burning anything',async()=>{
 const f=runtime();f.character.items[0]=sword(8);
 await run(f,job());assert.equal(f.calls.upgrades.length,0);assert.equal(f.calls.completes[0].success,false);assert.match(f.calls.completes[0].error,/changed/);
});
test('a failed attempt that the server rejects fails the job instead of continuing',async()=>{
 const f=runtime();f.r.upgrade=async(slot,scroll,offering,calculate)=>{if(calculate)return {calculate:true,chance:0};throw Object.assign(new Error('rejected'),{reason:'distance'});};
 await run(f,job());assert.equal(f.calls.completes[0].success,false);assert.match(f.calls.completes[0].error,/distance/);
 assert.deepEqual(f.character.items.slice(0,3).map(i=>i&&i.level),[7,7,7]);
});

test('an identical spare is never mistaken for a stacked item that has moved or changed',async()=>{
 const changed=runtime();changed.character.items[0]=sword(8);
 await run(changed,job());assert.equal(changed.calls.upgrades.length,0);assert.equal(changed.calls.completes[0].success,false);
 const moved=runtime();[moved.character.items[0],moved.character.items[3]]=[moved.character.items[3],moved.character.items[0]];
 await run(moved,job());assert.equal(moved.calls.upgrades.length,0);assert.equal(moved.calls.previews.length,0);
});
