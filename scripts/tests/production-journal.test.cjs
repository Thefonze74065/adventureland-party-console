const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {beginProduction,finishProduction,inspectProduction,resolveUnknownProduction,pendingProduction,checkpointProduction}=require('../../runtime/coordinator/inventory/production.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
 const state={merchantCharacter:'M',production:{attempts:{}},autoUpgradeMarks:{M:{'cap@+0':{tiers:1,quantity:2}}},autoCompounds:{}};
 const storage=new Map();let lost=false;
 const c=vm.createContext({yieldMerchantForEvent:async()=>{},character:{name:'M',ctype:'merchant',items:[{name:'cap',level:0}]},luckyUpgradeService:null,
  root:{localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}},fingerprint:item=>item&&({...item}),
  request:async(_path,{body})=>{if(body.action==='pending')return {pending:pendingProduction(state.production,true)};if(body.action==='checkpoint')return checkpointProduction(state,body);if(body.action==='inspect')return inspectProduction(state,body);if(body.action==='complete'){finishProduction(state,body.id,body.success);if(lost){lost=false;throw Error('response lost')}}else beginProduction(state,body);},
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
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);assert.equal(f.state.production.attempts.prepared,undefined);assert.equal(f.storage.size,0);
});
test('a still-running game operation blocks recovery; an unrelated replacement item requires review',async()=>{
 const f=fixture(),body={id:'pending',item:{name:'cap',level:0},kind:'upgrade'};beginProduction(f.state,body);
 f.storage.set('party-production:M',JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'running',request:body}));f.c.character.q={upgrade:{}};
 await assert.rejects(f.c.recoverProductionJournal(),/waiting/);delete f.c.character.q;f.c.character.items[0]={name:'sword',level:0};
 await assert.rejects(f.c.recoverProductionJournal(),/needs review/);assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);assert.equal(f.storage.size,1);
});

test('mismatched prepared journal recovers only after explicit unknown resolution of the orphan',async()=>{
 const f=fixture(),old={id:'orphan',item:{name:'cap',level:0},kind:'upgrade'};
 beginProduction(f.state,old);
 const body={id:'rejected-compound',item:{name:'strring',level:0},kind:'compound'};
 const journal={id:body.id,item:body.item,slots:[0,1,2],phase:'prepared',request:body};
 f.storage.set('party-production:M',JSON.stringify(journal));
 await assert.rejects(f.c.recoverProductionJournal(),/needs review: orphan/);
 assert.equal(f.storage.size,1);assert.equal(f.state.production.attempts[body.id],undefined);
 resolveUnknownProduction(f.state,{...old,reason:'Mismatched saved journal; outcome unavailable'},123);
 const retired=JSON.stringify(f.state.production.attempts.orphan);
 f.state=JSON.parse(JSON.stringify(f.state)); // Verify persisted resolution and late receipt behavior.
 finishProduction(f.state,'orphan',true);
 resolveUnknownProduction(f.state,{...old,reason:'Repeated review'},456);
 assert.equal(JSON.stringify(f.state.production.attempts.orphan),retired);
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);
 assert.equal(beginProduction(f.state,old).completed,true);
 await f.c.recoverProductionJournal();assert.equal(f.storage.size,0);
 let calls=0;await f.c.trackedProduction('upgrade',[0],null,async()=>{calls++;f.c.character.items[0].level=1;});
 assert.equal(calls,1);
});

test('prepared admitted attempt finishes without replay, while unknown running identity stays blocked',async()=>{
 const f=fixture(),body={id:'admitted',item:{name:'cap',level:0},kind:'upgrade'};
 beginProduction(f.state,body);
 f.storage.set('party-production:M',JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'prepared',request:body}));
 await f.c.recoverProductionJournal();assert.equal(f.state.production.attempts.admitted.success,false);
 const missing={...body,id:'missing'};
 f.storage.set('party-production:M',JSON.stringify({id:missing.id,item:missing.item,slots:[0],phase:'running',request:missing}));
 await assert.rejects(f.c.recoverProductionJournal(),/missing admitted attempt/);assert.equal(f.storage.size,1);
});

test('overlapping production and recovery cannot overwrite the active journal',async()=>{
 const f=fixture();let release,started;
 const ready=new Promise(resolve=>started=resolve);
 const operation=f.c.trackedProduction('upgrade',[0],null,async()=>{started();await new Promise(resolve=>release=resolve);f.c.character.items[0].level=1;});
 await ready;const saved=f.storage.get('party-production:M');
 await assert.rejects(f.c.trackedProduction('upgrade',[0],null,async()=>{throw Error('must not execute')}),/waiting for game operation/);
 await assert.rejects(f.c.recoverProductionJournal(),/waiting for game operation/);
 assert.equal(f.storage.get('party-production:M'),saved);
 release();await operation;assert.equal(f.storage.size,0);
});

test('rejected admission clears only the unstarted journal and leaves the blocking attempt intact',async()=>{
 const f=fixture();beginProduction(f.state,{id:'orphan',item:{name:'cap',level:0},kind:'upgrade'});
 // Simulate the orphan appearing after the read-only preflight, at admission.
 f.c.request=async(_path,{body})=>{if(body.action==='pending')return {pending:[]};if(body.action==='inspect')return inspectProduction(f.state,body);try{return {attempt:beginProduction(f.state,body)}}catch(error){error.partyRequest={status:409};throw error}};
 await assert.rejects(f.c.trackedProduction('upgrade',[0],null,async()=>{throw Error('must not execute')}),/Production recovery pending/);
 assert.equal(f.storage.size,0);assert.equal(f.state.production.attempts.orphan.completed,undefined);
});

test('error after coordinator admission retains the prepared journal until reconciliation',async()=>{
 const f=fixture(),original=f.c.request;
 f.c.request=async(path,{body})=>{
  if(body.action)return original(path,{body});
  beginProduction(f.state,body);const error=Error('storage failed after admission');error.partyRequest={status:409};throw error;
 };
 await assert.rejects(f.c.trackedProduction('upgrade',[0],null,async()=>{throw Error('must not execute')}),/storage failed/);
 assert.equal(f.storage.size,1);assert.equal(Object.values(f.state.production.attempts)[0].completed,undefined);
 f.c.request=original;await f.c.recoverProductionJournal();
 assert.equal(f.storage.size,0);assert.equal(Object.values(f.state.production.attempts)[0].success,false);
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);
});

test('failed admission inspection preserves the journal for a later recovery',async()=>{
 const f=fixture();
 f.c.request=async(_path,{body})=>{if(body.action==='pending')return {pending:[]};const error=Error(body.action==='inspect'?'inspection unavailable':'admission rejected');error.partyRequest={status:409};throw error};
 await assert.rejects(f.c.trackedProduction('upgrade',[0],null,async()=>{}),/admission rejected/);
 assert.equal(f.storage.size,1);
});

test('commerce production failure with empty old slot retains journal and never writes a poof receipt',async()=>{
 const f=fixture();f.c.root.__merchantActiveJob={commerceJournalKey:'commerce',commerceSequence:4};
 f.storage.set('commerce',JSON.stringify({sequence:4,pendingUpgrade:{level:1}}));
 await assert.rejects(f.c.trackedProduction('upgrade',[0],null,async()=>{
  f.c.character.items[5]=f.c.character.items[0];f.c.character.items[0]=null;
  throw Error('item or scroll unavailable');
 }),/uncertain|unavailable/);
 assert.ok(f.storage.has('party-production:M'));
 assert.equal(JSON.parse(f.storage.get('commerce')).pendingUpgrade.outcome,undefined);
});

test('commerce recovery cannot infer destruction from an empty original slot',async()=>{
 const f=fixture(),body={id:'commerce-restart',item:{name:'cap',level:0},kind:'upgrade'};
 beginProduction(f.state,body);
 f.storage.set('party-production:M',JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'running',
  request:body,commerce:{key:'commerce',sequence:4}}));
 f.c.character.items[0]=null;
 await assert.rejects(f.c.recoverProductionJournal(),/needs review/);
 assert.ok(f.storage.has('party-production:M'));
 assert.equal(f.state.production.attempts[body.id].completed,undefined);
});

test('commerce recovery locates one relocated survivor and preserves its receipt',async()=>{
 const f=fixture(),body={id:'relocated',item:{name:'cap',level:0},kind:'upgrade'};
 beginProduction(f.state,body);
 f.storage.set('commerce',JSON.stringify({sequence:4,pendingUpgrade:{level:1}}));
 f.storage.set('party-production:M',JSON.stringify({id:body.id,item:body.item,slots:[0],phase:'running',
  request:body,commerce:{key:'commerce',sequence:4}}));
 f.c.character.items[5]={name:'cap',level:1};f.c.character.items[0]=null;
 await f.c.recoverProductionJournal();
 assert.deepEqual(JSON.parse(f.storage.get('commerce')).pendingUpgrade.outcome,{item:{name:'cap',level:1},destroyed:false});
});
