const {installBankStacks}=require('./helpers/bank-stacks.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { createBankSortRoutes, initialBankSort } = require('../../runtime/coordinator/merchant/bank-sort.ts');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
test('bank stack adapter ignores delayed storage echoes after a local journal write',()=>{
 let persisted='null',ports;
 const root={localStorage:{getItem:()=>persisted,setItem:(_key,value)=>{persisted=value;}},partyCreateBankStacks:p=>{ports=p;return {};}};
 const c=vm.createContext({root,character:{name:'M'},accessibleBankSortFloors(){},runtimeCurrent:()=>true,sleep(){},Date});
 vm.runInContext(source.slice(source.indexOf('  var bankStacks ='),source.indexOf('  async function finishBankStacks(')),c);
 c.bankStackService();
 const old={buffers:[{slot:7,identity:'seashell'}]},current={buffers:[{slot:7,identity:'cryptkey'}]};
 ports.write(old);ports.write(null);persisted=JSON.stringify(old);
 assert.equal(ports.read(),null,'an old IPC echo cannot resurrect a completed transfer');
 ports.write(current);persisted=JSON.stringify(old);
 assert.deepEqual(ports.read(),current,'the active buffer cannot be replaced by an older echo');
});
function coordinator() {
 const state={merchantCharacter:'M',...initialBankSort({})}; let runtime='R';
 const routes=createBankSortRoutes(state,{persist(){},runtime:()=>runtime});
 function call(route,body){let code=200,result;routes[route]({body},{status(v){code=v;return this},json(v){result=v}});return {code,...structuredClone(result)}}
 return {state,call,reconcile:routes.reconcile,runtime:v=>runtime=v};
}
test('default, persistence recovery, and switching automatic clears request',()=>{
 const c=coordinator();assert.equal(c.state.bankSortMode,'automatic');
 c.call('configure',{mode:'request',enabled:true}); const p=c.state.bankSortRequest;
 assert.ok(p.id);assert.equal(initialBankSort(c.state).bankSortRequest.id,p.id);
 p.status='sorting'; assert.equal(initialBankSort(c.state).bankSortRequest.status,'retry');
 c.call('configure',{mode:'automatic'});assert.equal(c.state.bankSortRequest,null);
});
test('lease requires next entry, request identity and the current runtime',()=>{
 const c=coordinator();c.call('configure',{mode:'request',enabled:true});
 const id=c.state.bankSortRequest.id, at=c.state.bankSortRequest.requestedAt;
 const body={character:'M',runtime:'R',visit:'V',enteredAt:at-1,action:'claim'};
 c.call('checkpoint',body);assert.equal(c.state.bankSortRequest.status,'queued');
 body.enteredAt=at+1;c.call('checkpoint',body);assert.equal(c.state.bankSortRequest.status,'sorting');
 c.call('checkpoint',{...body,action:'complete',id:'old'});assert.ok(c.state.bankSortRequest);
 c.call('configure',{enabled:false});c.call('configure',{enabled:true});const newer=c.state.bankSortRequest.id;
 c.call('checkpoint',{...body,action:'complete',id});assert.equal(c.state.bankSortRequest.id,newer);
 c.runtime('R2');assert.equal(c.call('checkpoint',{...body,action:'complete',id:newer}).code,409);
});
test('failure retains request and a restarted runtime can retry without accepting old completion',()=>{
 const c=coordinator();c.call('configure',{mode:'request',enabled:true});
 const id=c.state.bankSortRequest.id,body={character:'M',runtime:'R',visit:'V',enteredAt:Date.now()+1,action:'claim'};
 c.call('checkpoint',body);c.call('checkpoint',{...body,id,action:'retry',message:'failed'});
 assert.equal(c.state.bankSortRequest.status,'retry');c.runtime('R2');
 c.call('checkpoint',{...body,runtime:'R2',enteredAt:0,visit:'V2'});
 assert.equal(c.state.bankSortRequest.runtime,'R2');
 c.call('checkpoint',{...body,id,action:'complete'});assert.ok(c.state.bankSortRequest);
 c.call('checkpoint',{...body,runtime:'R2',visit:'V2',id,action:'complete'});assert.equal(c.state.bankSortRequest,null);
});
function client(mode='request') {
 const c=coordinator();c.call('configure',{mode});const calls=[];
 const bank={items0:[{name:'z'},{name:'a'}],items1:Array(42).fill(null),items8:[{name:'z'},{name:'a'}]};
 bank.items1[35]={name:'reserved'};
 const r=vm.createContext({bankStaging:true,bankStagingSlot:(pack,slot)=>pack==="items1"&&slot>=35,character:{name:'M',ctype:'merchant',map:'main',items:Array(42).fill(null),bank,x:0,y:0},root:{},
  parent:{socket:{emit(type,{pack,str,inv}){calls.push('swap');[bank[pack][str],r.character.items[inv]]=[r.character.items[inv],bank[pack][str]]}}},
  convoyRuntimeId:'R',coordinatorClockOffset:0,runtimeCurrent:()=>true,
  bank_packs:{items0:['bank'],items1:['bank'],items8:['bank_b']},
  G:{items:{a:{},z:{},reserved:{},bkey:{type:'bank_key',unlocks:'bank_b'}},maps:{bank:{doors:[[0,0,0,0,'bank_b',0,0,'key']]},bank_b:{doors:[[0,0,0,0,'bank',0,0]]}}},
  movement:{move:async dest=>{const map=typeof dest==='string'?dest:dest.map;calls.push(map);r.character.map=map;return true}},
  request:async(path,{body})=>{calls.push(body.action);const v=c.call('checkpoint',body);if(v.code!==200)throw Error(v.error);return v},
  gatheringStatus(){},setTimeout:f=>f(),sleep:async()=>{},bankStackIdentity:require('../../runtime/bank-stacks.ts').stackIdentity,
  bankStoreFully:async inv=>{for(const pack of r.bankPacksOnCurrentFloor()){for(let slot=0;slot<42;slot++){if(pack==='items1'&&slot>=35)continue;if(!bank[pack][slot]){bank[pack][slot]=r.character.items[inv];r.character.items[inv]=null;return}}}throw Error('full')}
 });
 vm.runInContext(source.slice(source.indexOf('  // A visit spans all bank floors'),source.indexOf('  async function bankRetrieveConfirmed(')>0?source.indexOf('  async function bankRetrieveConfirmed('):source.indexOf('  async function sortCurrentBankFloor(')),r);
 vm.runInContext(source.slice(source.indexOf('  var bankStacks ='),source.indexOf('  async function bankStoreFully(')),r);
 installBankStacks(r);
 return {r,c,calls,bank,async enter(){r.observeBankSortVisit();r.character.map='bank';r.observeBankSortVisit();r.bankSortVisit.enteredAt=Date.now()+1000;}};
}
test('request mode consolidates independently without cosmetic swaps',async()=>{
 const t=client();await t.enter();let passes=0;t.r.consolidateCurrentBankFloor=async()=>{passes++;};
 await t.r.sortCurrentBankFloor([]);await t.r.sortCurrentBankFloor([]);
 assert.equal(passes,2);assert.equal(t.calls.filter(x=>x==='swap').length,0);assert.equal(t.bank.items0[0].name,'z');
});

test('sorting off compacts tomb keys while preserving unrelated slot positions',async()=>{
 const t=client();await t.enter();
 t.bank.items0=[{name:'z'},{name:'tombkey',q:46},{name:'tombkey',q:46},{name:'tombkey',q:5},{name:'a'}];
 const native=require('./helpers/bank-stacks.cjs').bankRuntime(t.bank,t.r.character.items,{tombkey:50});
 for(const key of ['bank_retrieve','bank_store','bank_swap','swap','split'])t.r[key]=native.c[key];
 t.r.G.items.tombkey={s:50};t.r.snapshot=()=>({});
 const request=t.r.request;t.r.request=(path,options)=>path==='/status'?Promise.resolve({}):request(path,options);
 await t.r.sortCurrentBankFloor([]);
 assert.equal(t.bank.items0[0].name,'z');assert.equal(t.bank.items0[4].name,'a');
 assert.deepEqual(t.bank.items0.filter(x=>x?.name==='tombkey').map(x=>x.q),[50,47]);
 assert.equal(t.calls.filter(x=>x==='swap').length,0);assert.equal(t.c.state.bankSortRequest,null);
});

test('stack checkpoint exposes reservations without claiming a cosmetic sort request',()=>{
 const t=coordinator();t.call('configure',{mode:'request',enabled:true});
 t.state.withdrawals={M:[{pack:'items0',slot:2}]};
 t.state.merchantQueue=[{id:'craft',order:{crafts:[{id:'example',quantity:1}],requirements:[{id:'tombkey',level:0,quantity:2}]}}];
 const result=t.call('checkpoint',{character:'M',runtime:'R',action:'stack'});
 assert.deepEqual(result.protection.locations,[{pack:'items0',slot:2}]);
 assert.deepEqual(result.protection.items,[{name:'tombkey',level:0}]);
 assert.equal(t.state.bankSortRequest.status,'queued');
});
test('automatic mode sorts once until a floor changes and preserves reserved slots',async()=>{
 const t=client('automatic');await t.enter();await t.r.sortCurrentBankFloor([]);
 const swaps=t.calls.filter(x=>x==='swap').length;assert.ok(swaps>0);
 await t.r.sortCurrentBankFloor([]);assert.equal(t.calls.filter(x=>x==='swap').length,swaps);
 t.bank.items0[0]={name:'z'};t.bank.items0[1]={name:'a'};await t.r.sortCurrentBankFloor([]);assert.ok(t.calls.filter(x=>x==='swap').length>swaps);
 assert.equal(t.bank.items1[35].name,'reserved');assert.ok(t.r.character.items.every(x=>!x));
});
test('one requested pass covers accessible floors only, returns to origin, then completes',async()=>{
 const t=client();t.c.call('configure',{enabled:true});await t.enter();t.r.character.items[41]={name:'bkey'};
 const id=t.c.state.bankSortRequest.id;const move=t.r.movement.move;
 t.r.movement.move=async dest=>{if(dest==='bank_b')assert.equal(t.c.state.bankSortRequest.id,id,'not complete after first floor');return move(dest)};
 await t.r.bankSortMove('main');assert.equal(t.c.state.bankSortRequest,null);
 assert.equal(t.bank.items8[0].name,'a');assert.equal(t.r.character.map,'main');
 assert.equal(t.calls.filter(x=>x==='complete').length,1);assert.ok(t.calls.includes('bank_b'));
 assert.equal(t.bank.items1[35].name,'reserved');
});
test('request during existing visit waits until following visit; locked floors are skipped',async()=>{
 const t=client();await t.enter();t.r.bankSortVisit.enteredAt=0;t.c.call('configure',{enabled:true});
 await t.r.bankSortMove('main');assert.ok(t.c.state.bankSortRequest);assert.ok(!t.calls.includes('swap'));
 await t.enter();await t.r.bankSortMove('main');assert.equal(t.c.state.bankSortRequest,null);assert.ok(!t.calls.includes('bank_b'));
});
test('cancellation between swaps returns temporary buffer and never clears newer request',async()=>{
 const t=client();t.c.call('configure',{enabled:true});await t.enter();const emit=t.r.parent.socket.emit;
 let cancelled=false;t.r.parent.socket.emit=(...args)=>{emit(...args);if(!cancelled){cancelled=true;t.c.call('configure',{enabled:false});t.c.call('configure',{enabled:true});}};
 await t.r.bankSortMove('main');assert.ok(t.c.state.bankSortRequest);assert.ok(t.r.character.items.every(x=>!x));
 assert.equal(t.calls.filter(x=>x==='swap').length,1);
});
test('floor failure retains request with retry status and no bank item leaves in buffer',async()=>{
 const t=client();t.c.call('configure',{enabled:true});await t.enter();t.r.character.items[41]={name:'bkey'};
 const move=t.r.movement.move;t.r.movement.move=dest=>dest==='bank_b'?Promise.reject(Error('blocked')):move(dest);
 await t.r.bankSortMove('main');assert.equal(t.c.state.bankSortRequest.status,'retry');assert.match(t.c.state.bankSortRequest.message,/blocked/);
 assert.equal(t.r.character.items.filter(Boolean).length,1);
});
test('buffer journal survives a runtime restart and cleans up before leaving with sorting disabled',async()=>{
 const t=client();await t.enter();const storage=new Map();t.r.root.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 t.r.rememberBankSortBuffers([0],[t.bank.items0[0]]);
 t.r.character.items[0]=t.bank.items0[0];t.bank.items0[0]=null;
 delete t.r.root.__partyBankSortJournal;delete t.r.root.__partyBankSortBuffers;
 await t.r.bankSortMove('main');assert.equal(t.r.character.items[0],null);
 assert.deepEqual(JSON.parse(storage.get('party-bank-sort-buffer:M')),[]);
 assert.equal(t.calls.filter(x=>x==='swap').length,0);
});
test('failed buffer recovery prevents departure and retains the journal for retry',async()=>{
 const t=client();await t.enter();t.r.rememberBankSortBuffers([0],[t.bank.items0[0]]);
 t.r.character.items[0]=t.bank.items0[0];t.bank.items0[0]=null;
 t.r.bankStoreFully=async()=>{throw Error('disconnected')};
 await assert.rejects(t.r.bankSortMove('main'),/disconnected/);assert.equal(t.r.character.map,'bank');assert.equal(t.r.bankSortBufferJournal().length,1);
});
test('missing authorization fails closed before consolidation and rearrangement',async()=>{
 const t=client('automatic');await t.enter();t.r.request=async()=>{throw Error('offline')};
 await assert.rejects(t.r.sortCurrentBankFloor([]),/offline/);assert.ok(!t.calls.includes('swap'));
});
test('bank floor movement and repeated helpers retain the visit identity',async()=>{
 const t=client('automatic');await t.enter();const id=t.r.bankSortVisit.id;await t.r.sortCurrentBankFloor([]);
 await t.r.bankSortMove('bank_b');await t.r.sortCurrentBankFloor([]);await t.r.bankSortMove('bank');
 assert.equal(t.r.bankSortVisit.id,id);const swaps=t.calls.filter(x=>x==='swap').length;
 await t.r.sortCurrentBankFloor([]);assert.equal(t.calls.filter(x=>x==='swap').length,swaps);
});
test('full inventory keeps a requested sort pending instead of reporting completion',async()=>{
 const t=client();t.c.call('configure',{enabled:true});await t.enter();t.r.character.items.fill({name:'cargo'});
 await t.r.bankSortMove('main');assert.equal(t.c.state.bankSortRequest.status,'retry');assert.ok(!t.calls.includes('complete'));
});

test('interrupted runtime becomes visibly retryable without waiting for another visit',()=>{
 const c=coordinator();c.call('configure',{mode:'request',enabled:true});const pending=c.state.bankSortRequest;
 c.call('checkpoint',{character:'M',runtime:'R',visit:'V',enteredAt:Date.now()+1,action:'claim'});
 c.runtime(undefined);c.reconcile();assert.equal(pending.status,'retry');assert.match(pending.message,/interrupted/);
});

test('restart recovers a held sort item before ordinary bank work is allowed to start',async()=>{
 const t=client();t.r.character.map='bank';t.r.character.items[0]=t.bank.items0[0];t.bank.items0[0]=null;
 t.r.root.__partyBankSortJournal=[{slot:0,floor:'bank',identities:[t.r.bankStackIdentity(t.r.character.items[0])]}];
 await t.r.recoverBankSortBeforeWork();assert.equal(t.r.character.items[0],null);assert.equal(t.r.bankSortRecovered,true);
});
// Swap confirmation waits on a clock; these tests advance it instead of sleeping.
function fakeClock(t){let clock=Date.now();t.r.Date=class extends Date{static now(){return clock}};t.r.sleep=async ms=>{clock+=ms||0};}
function pendingSwap(t,slot,floor,pack,cell,item,inventory,bank){
 const storage=new Map();t.r.root.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 t.r.saveBankSortBuffers([{slot,floor,identities:[t.r.bankStackIdentity(item)],pending:{pack,slot:cell,inventory,bank}}]);
 delete t.r.root.__partyBankSortJournal;delete t.r.root.__partyBankSortBuffers;
}
test('a persisted store into an empty cell settles after its item was withdrawn again',async()=>{
 const t=client();await t.enter();fakeClock(t);const item={name:'a'};
 pendingSwap(t,0,'bank','items1',5,item,'null',t.r.bankSortItemState(item));
 await t.r.bankSortMove('main');
 assert.equal(t.r.character.map,'main');assert.equal(t.r.bankSortBufferJournal().length,0);
 assert.equal(t.calls.filter(x=>x==='swap').length,0);
});
test('a persisted swap settles from the current bank when the item is somewhere else',async()=>{
 const t=client();await t.enter();fakeClock(t);const z=t.bank.items0[0];
 pendingSwap(t,0,'bank','items0',0,z,t.r.bankSortItemState(z),'null');
 // The player moved the item into another inventory slot instead.
 t.bank.items0[0]=null;t.r.character.items[3]=z;
 await t.r.bankSortMove('main');
 assert.equal(t.r.character.map,'main');assert.equal(t.r.bankSortBufferJournal().length,0);
 assert.equal(t.r.character.items[3],z);assert.equal(t.calls.filter(x=>x==='swap').length,0);
});
test('a persisted swap from another bank floor settles there instead of blocking work',async()=>{
 const t=client();await t.enter();fakeClock(t);const z=t.bank.items8[0];
 pendingSwap(t,0,'bank_b','items8',0,z,t.r.bankSortItemState(z),'null');
 t.r.character.items[0]=z;t.bank.items8[0]=null;
 await t.r.bankSortMove('main');
 assert.equal(t.r.character.map,'main');assert.equal(t.r.bankSortBufferJournal().length,0);
 assert.equal(t.r.character.items[0],null);assert.ok(t.bank.items8.includes(z));
});
test('a swap that never lands ends the pass and the next pass sorts from the current bank',async()=>{
 const t=client('automatic');await t.enter();fakeClock(t);const emit=t.r.parent.socket.emit;let dropped=false;
 t.r.parent.socket.emit=(...args)=>{if(!dropped){dropped=true;return;}emit(...args)};
 await assert.rejects(t.r.sortCurrentBankFloor([]),/not confirmed/);
 assert.equal(t.r.bankSortBufferJournal().length,0);assert.ok(t.r.character.items.every(x=>!x));
 await t.r.sortCurrentBankFloor([]);
 assert.equal(t.bank.items0[0].name,'a');assert.ok(t.r.character.items.every(x=>!x));
 assert.equal(t.r.bankSortBufferJournal().length,0);
});
