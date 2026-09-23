const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {beginProduction,finishProduction}=require('../../runtime/coordinator/inventory/production.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
 const state={merchantCharacter:'M',production:{attempts:{}},autoUpgradeMarks:{M:{'cap@+0':{tiers:1,quantity:2}}},autoCompounds:{}};
 const storage=new Map();let lost=false;
 const c=vm.createContext({yieldMerchantForEvent:async()=>{},character:{name:'M',ctype:'merchant',items:[{name:'cap',level:0}]},luckyUpgradeService:null,
  root:{localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}},fingerprint:item=>item&&({...item}),
  request:async(_path,{body})=>{if(body.action==='complete'){finishProduction(state,body.id,body.success);if(lost){lost=false;throw Error('response lost')}}else beginProduction(state,body);},
 });
 vm.runInContext(source.slice(source.indexOf('  function productionJournalKey()'),source.indexOf('  async function observedCompoundConfirmed(')),c);
 return {c,state,storage,loseReply:()=>lost=true};
}
test('lost completion reply retries its durable receipt without executing the game operation again',async()=>{
 const f=fixture();f.loseReply();let calls=0;
 await assert.rejects(f.c.trackedProduction('upgrade',[0],null,async()=>{calls++;f.c.character.items[0].level=1;}),/response lost/);
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,1);assert.equal(f.storage.size,1);
 await f.c.recoverProductionJournal();assert.equal(calls,1);assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,1);assert.equal(f.storage.size,0);
});
test('restart resolves an observed completed operation once before allowing more inventory work',async()=>{
 const f=fixture(),body={id:'restart',item:{name:'cap',level:0},kind:'upgrade'};beginProduction(f.state,body);
 f.storage.set('party-production:M',JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'running',request:body}));f.c.character.items[0].level=1;
 await f.c.recoverProductionJournal();assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,1);await f.c.recoverProductionJournal();assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,1);
});
test('prepared attempt after restart is abandoned without decrementing or issuing an operation',async()=>{
 const f=fixture(),body={id:'prepared',item:{name:'cap',level:0},kind:'upgrade'};
 f.storage.set('party-production:M',JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'prepared',request:body}));await f.c.recoverProductionJournal();
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);assert.equal(f.state.production.attempts.prepared.success,false);assert.equal(f.storage.size,0);
});
test('a still-running game operation blocks recovery; an unrelated replacement item requires review',async()=>{
 const f=fixture(),body={id:'pending',item:{name:'cap',level:0},kind:'upgrade'};beginProduction(f.state,body);
 f.storage.set('party-production:M',JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'running',request:body}));f.c.character.q={upgrade:{}};
 await assert.rejects(f.c.recoverProductionJournal(),/waiting/);delete f.c.character.q;f.c.character.items[0]={name:'sword',level:0};
 await assert.rejects(f.c.recoverProductionJournal(),/needs review/);assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);assert.equal(f.storage.size,1);
});
test('a replacement item needing review only blocks attempts on its own slot',async()=>{
 const f=fixture(),body={id:'pending',item:{name:'cap',level:0},kind:'upgrade'};beginProduction(f.state,body);
 f.storage.set('party-production:M',JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'running',request:body}));f.c.character.items[0]={name:'sword',level:0};
 await f.c.recoverProductionJournal([1]);assert.equal(f.storage.size,1);
 await assert.rejects(f.c.recoverProductionJournal([0]),/needs review/);
});
