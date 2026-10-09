const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const {beginProduction,finishProduction,abortManualProduction,inspectProduction,pendingProduction,checkpointProduction}=require('../../runtime/coordinator/inventory/production.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
 const storage=new Map(),item={name:'sword',level:8},mark={slot:0,item,tiers:1,offering:'offeringp',requestId:'one'};
 const state={merchantCharacter:'M',upgrades:{M:[mark]},production:{attempts:{}},autoUpgradeMarks:{M:{}},autoCompounds:{}};
 let lost=false;const c=vm.createContext({productionJournalLoaded:false,productionJournal:null,yieldMerchantForEvent:async()=>{},Date,inventoryKey:(i)=>JSON.stringify(i),upgradeProductionSequence:0,character:{name:'M',ctype:'merchant',items:[{...item},{name:'offeringp',q:2}]},fingerprint:i=>i&&({...i}),luckyUpgradeService:null,
 root:{localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
 request:async(path,{body})=>{
  if(body.action==='pending')return {pending:pendingProduction(state.production,true)};
  if(body.action==='checkpoint')return checkpointProduction(state,body);
  if(body.action==='inspect')return inspectProduction(state,body);
  if(body.action==='complete'){finishProduction(state,body.id,body.success);if(lost){lost=false;throw Error('response lost');}}
  else if(body.action==='abort-manual')abortManualProduction(state,body.id);
  else return {attempt:beginProduction(state,body)};
 },
 });
 vm.runInContext(['productionJournalKey','readProductionJournal','writeProductionJournal','rememberCommerceProduction','rememberReviewedCommerce','saveProductionJournal','verifyProductionProtection','finishProductionJournal','recoverProductionJournal','recoverProductionJournalWork','trackedProduction','trackedProductionWork'].map(n=>namedFunction(source,n)).join('\n'),c);
 return {c,state,storage,mark,lose:()=>lost=true};
}
test('surviving failed manual attempt with a lost completion response consumes exactly one offering',async()=>{
 const f=fixture();f.lose();let calls=0;
 const operation=async()=>{calls++;const j=f.c.readProductionJournal();j.issued=true;f.c.writeProductionJournal(j);f.c.character.items[1].q--;return {success:false};};
 await assert.rejects(f.c.trackedProduction('upgrade',[0],undefined,operation,{offering:'offeringp',requestId:'one'}),/response lost/);
 await f.c.recoverProductionJournal();
 await f.c.trackedProduction('upgrade',[0],undefined,operation,{offering:'offeringp',requestId:'one'});
 assert.equal(calls,1);assert.equal(f.c.character.items[1].q,1);assert.equal(f.state.upgrades.M.length,0);
});
test('restart before issuing a game call retains the manual request for a real attempt',async()=>{
 const f=fixture(),body={id:'manual-offering:one',kind:'upgrade',item:f.mark.item,requestId:'one',offering:'offeringp'};
 beginProduction(f.state,body);f.storage.set(f.c.productionJournalKey(),JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'running',request:body}));
 await f.c.recoverProductionJournal();assert.equal(f.state.upgrades.M.length,1);assert.equal(f.state.production.attempts[body.id],undefined);assert.equal(f.storage.size,0);
});
test('restart after issuing a surviving attempt retires it without consuming again',async()=>{
 const f=fixture(),body={id:'manual-offering:one',kind:'upgrade',item:f.mark.item,requestId:'one',offering:'offeringp'};
 beginProduction(f.state,body);f.storage.set(f.c.productionJournalKey(),JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'running',issued:true,request:body}));
 await f.c.recoverProductionJournal();assert.equal(f.state.upgrades.M.length,0);assert.equal(f.state.production.attempts[body.id].completed,true);assert.equal(f.storage.size,0);
});
