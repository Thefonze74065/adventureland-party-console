const test=require('node:test'),assert=require('node:assert/strict');
const {createImprovementScheduler}=require('../../runtime/coordinator/merchant/improvement-scheduler.ts');
function fixture(){const state={merchantCharacter:'M',merchantAutomations:{},bankSnapshot:{packs:{}},autoCompounds:{},autoExchanges:{},merchantCatalog:{exchangeable:[]},merchantCurrent:null,merchantQueue:[]},calls=[];
 const service=createImprovementScheduler(Object.assign(state,{production:state.production||{attempts:{}}}),{now:()=>100,nextCommand:()=>1,stamp:job=>({...job,priority:9}),queue:(...args)=>calls.push(args),persist:()=>calls.push('persist'),log:(...args)=>calls.push(args)});
 return {state,calls,service};}
const ring=level=>({item:{name:'ring',level}});
const stored=(slot,level=0)=>({slot,...ring(level)});
test('bankboi ingredients stage one missing triple and repeated observations do not duplicate it',()=>{
 const f=fixture();f.state.autoCompounds.M=[{name:'ring',targetTier:2}];
 f.state.bankbois={B:{name:'B',items:[stored(0),stored(1),stored(2),stored(3)]}};
 assert.equal(f.service.compound('M',{items:[ring(0)]}),true);
 assert.deepEqual(f.state.withdrawals.M.map(x=>[x.pack,x.slot]),[['bankboi:B',0],['bankboi:B',1]]);
 f.service.compound('M',{items:[ring(0)]});assert.equal(f.state.withdrawals.M.length,2);
 // Normal-bank staging is still an outstanding withdrawal, so it cannot trigger another batch.
 f.state.withdrawals.M=f.state.withdrawals.M.map(x=>({...x,pack:'items1'}));
 f.service.compound('M',{items:[ring(0)]});assert.equal(f.state.withdrawals.M.length,2);
});
test('bankboi selection prefers highest complete triple and excludes locked ingredients',()=>{
 const f=fixture();f.state.autoCompounds.M=[{name:'ring',targetTier:3}];
 f.state.bankbois={B:{name:'B',items:[stored(0,0),stored(1,0),stored(2,0),stored(3,2),
  {slot:4,item:{name:'ring',level:2,l:'l'}},stored(5,2)]}};
 f.service.compound('M',{items:[ring(2)]});
 assert.deepEqual(f.state.withdrawals.M.map(x=>x.slot),[3,5]);
});
test('incomplete mixed levels and party character rules do not retrieve bankboi items',()=>{
 const f=fixture();f.state.autoCompounds={M:[{name:'ring',targetTier:7}],F:[{name:'ring',targetTier:7}]};
 f.state.bankbois={B:{name:'B',items:[stored(0,6),stored(1,6)]}};
 assert.equal(f.service.compound('M',{items:[ring(0)]}),true); // Bank the leftover; do not retrieve an incomplete group.
 assert.equal(f.service.compound('F',{items:[ring(6)]}),true);
 assert.deepEqual(f.calls.at(-1),[['F'],'marked items']);
 assert.equal(f.state.withdrawals,undefined);
});
test('completed quota remains saved and active work defers retrieval',()=>{
 const f=fixture();f.state.autoCompounds.M=[{name:'ring',targetTier:2,quantity:0}];
 f.state.bankbois={B:{name:'B',items:[stored(0,2),stored(1),stored(2),stored(3)]}};
 assert.equal(f.service.compound('M',{items:[]}),false);assert.equal(f.state.autoCompounds.M[0].quantity,0);
 assert.equal(f.state.withdrawals,undefined);
 f.state.autoCompounds.M=[{name:'ring',targetTier:2}];f.state.merchantCurrent={reason:'auto compound'};
 assert.equal(f.service.compound('M',{items:[]}),true);assert.equal(f.state.withdrawals,undefined);
 f.state.merchantCurrent=null;f.state.bankboiTransaction={};
 f.service.compound('M',{items:[]});assert.equal(f.state.withdrawals,undefined);
});
test('improvement commands preserve remaining quota regardless of owned stock',()=>{
 const {ownMerchantCommand,partyMerchantCommand}=require('../../runtime/coordinator/merchant/commands.ts');
 const work={autoCompounds:[{name:'ring',targetTier:2,quantity:3}],upgrades:[],purchases:[],
  statScrolls:[],compounds:[],withdrawals:[],marked:[],deliveries:[]};
 const inputs={merchant:'M',work:()=>work,restock:()=>({}),statScrolls:{},
  bankboiItems:[ring(2),ring(3),ring(1),{item:{name:'other',level:3}}]};
 const job={id:'job',target:'M',reason:'auto compound'};
 assert.equal(ownMerchantCommand(1,job,{items:[ring(2)]},inputs).autoCompounds[0].quantity,3);
 assert.deepEqual(partyMerchantCommand(1,{...job,target:'F'},{items:[ring(2)]},inputs).autoCompounds,[]);
});
test('merchant compound uses bank triplets while ordinary characters use their own bags',()=>{
 const f=fixture();f.state.autoCompounds={M:[{name:'ring',targetTier:2}],F:[{name:'ring',targetTier:2}]};f.state.bankSnapshot.packs.items1=[ring(0),ring(0)];
 assert.equal(f.service.compound('M',{items:[ring(0)]}),true);assert.deepEqual(f.calls,[[['M'],'auto compound']]);
 assert.equal(f.service.compound('F',{items:[ring(0)]}),true);
 assert.deepEqual(f.calls.at(-1),[['F'],'marked items']);
});
test('existing finished items do not satisfy a production quota',()=>{
 const f=fixture();f.state.autoCompounds.M=[{name:'ring',targetTier:2,quantity:1},{name:'ring',targetTier:3}];
 assert.equal(f.service.compound('M',{items:[ring(2),ring(0),ring(0),ring(0)]}),true);
 assert.equal(f.state.autoCompounds.M.length,2);assert.equal(f.state.autoCompounds.M[0].quantity,1);assert.deepEqual(f.calls[0],[['M'],'auto compound']);
});
test('exchange combines bank quantities, stamps one job, and respects existing exchange work',()=>{
 const f=fixture();f.state.autoExchanges={'leather@0':{name:'leather'}};f.state.merchantCatalog.exchangeable=[{id:'leather',required:10}];
 f.state.bankSnapshot.packs.items1=[{item:{name:'leather',q:18}}];const status={name:'M',items:[{item:{name:'leather',q:7}}]};
 assert.equal(f.service.exchange(status),true);assert.deepEqual(f.state.merchantQueue[0].exchanges,[{id:'leather',level:0,quantity:2}]);assert.equal(f.state.merchantQueue[0].priority,9);
 assert.equal(f.service.exchange(status),false);f.state.merchantQueue=[];f.state.merchantCurrent={reason:'exchange'};assert.equal(f.service.exchange(status),false);
});
test('disabled improvements and nonmerchant exchange reports do not mutate work',()=>{
 const f=fixture();f.state.merchantAutomations={'auto compound':false,exchange:false};
 assert.equal(f.service.compound('M',{items:[]}),false);assert.equal(f.service.exchange({name:'M',items:[]}),false);
 f.state.merchantAutomations={};assert.equal(f.service.exchange({name:'F',items:[]}),false);assert.equal(f.service.compound('M',null),false);assert.deepEqual(f.calls,[]);
});
test('missing bank panes and empty entries do not hide a valid compound triplet',()=>{
 const f=fixture();
 f.state.autoCompounds.M=[{name:'ring',targetTier:2}];
 f.state.bankSnapshot.packs={items0:undefined,items1:[null,ring(0),ring(0)]};
 assert.equal(f.service.compound('M',{items:[ring(0)]}),true);
 assert.deepEqual(f.calls,[[['M'],'auto compound']]);
 assert.equal(f.state.bankSnapshot.packs.items0,undefined);
});
