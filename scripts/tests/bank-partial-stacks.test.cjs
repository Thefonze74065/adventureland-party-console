const test=require('node:test'),assert=require('node:assert/strict');
const {bankRuntime}=require('./helpers/bank-stacks.cjs');
const {stackDepositPlan}=require('../../runtime/bank-stacks.ts');
const {createBankStacks}=require('../../runtime/characters/bank-stacks.ts');
const key=q=>({name:'tombkey',q});
test('legacy completed buffer reservations cannot shadow later reuse of the same slots',async()=>{
 const {stackIdentity}=require('../../runtime/bank-stacks.ts');
 const r=bankRuntime({items0:[null,null]},[key(3),key(46),null]);
 r.ports.write({buffers:[
  {slot:0,identity:stackIdentity({name:'seashell'}),origin:{pack:'items0',slot:0,floor:'bank'}},
  {slot:1,identity:stackIdentity({name:'seashell'}),origin:{pack:'items0',slot:1,floor:'bank'}},
  {slot:0,identity:stackIdentity(key(3)),origin:{pack:'items0',slot:0,floor:'bank'}},
  {slot:1,identity:stackIdentity(key(46)),origin:{pack:'items0',slot:1,floor:'bank'}}]});
 await r.service.recover();assert.equal(r.total(),49);assert.deepEqual(r.quantities(),[3,46]);assert.equal(r.ports.read(),null);
});

test('stale buffer identity mismatch is skipped without moving unrelated inventory',async()=>{
 const {stackIdentity}=require('../../runtime/bank-stacks.ts');
 const r=bankRuntime({items0:[null]},[{name:'sword'}]);
 r.ports.write({buffers:[{slot:0,identity:stackIdentity(key(3)),origin:{pack:'items0',slot:0,floor:'bank'}}]});
 await r.service.recover();assert.equal(r.calls.length,0);assert.equal(r.ports.read(),null);
});

test('legacy mixed seashell and crypt-key journal recovers only remaining bank cargo',async()=>{
 const {stackIdentity}=require('../../runtime/bank-stacks.ts');
 const items=Array(12).fill(null);items[7]={name:'cryptkey',q:45};items[9]={name:'anniversarygift',q:1};items[10]={name:'slice_nightberry',q:1};
 const r=bankRuntime({items6:Array(27).fill(null)},items,{cryptkey:50});r.c.character.bank.items6[25]={name:'cryptkey',q:50};
 const origin=slot=>({pack:'items6',slot,floor:'bank'});
 r.ports.write({buffers:[{slot:7,identity:stackIdentity({name:'seashell'}),origin:origin(10)},
  {slot:9,identity:stackIdentity({name:'seashell'}),origin:origin(11)},
  {slot:7,identity:stackIdentity(items[7]),origin:origin(26)},
  {slot:9,identity:stackIdentity(items[7]),origin:origin(25)},
  {slot:10,identity:stackIdentity(items[7]),source:7}]});
 await r.service.recover();assert.equal(items[7],null);assert.equal(items[9].name,'anniversarygift');assert.equal(items[10].name,'slice_nightberry');
 assert.deepEqual(r.calls,[['store',7,'items6',26]]);assert.equal(r.c.character.bank.items6[26].q,45);assert.equal(r.ports.read(),null);
});
for(const cross of [false,true])test('97 tomb keys compact into 50 and 47 '+(cross?'across floors':'in one pack'),async()=>{
 const bank=cross?{items0:[key(46)],items8:[key(46),key(5)]}:{items0:[key(46),key(46),key(5)]};
 const r=bankRuntime(bank);if(cross)r.c.parent.bank_packs={items0:['bank'],items8:['bank_b']};
 assert.ok((await r.service.compact()).moved);assert.deepEqual(r.quantities(),[50,47]);assert.equal(r.total(),97);
 assert.ok(r.c.character.items.every(x=>!x));assert.equal(r.ports.read(),null);assert.equal(r.c.character.map,'bank');
 const count=r.calls.length;await r.service.compact();assert.equal(r.calls.length,count);
});
test('new deposit fills both gaps without touching unrelated inventory',async()=>{
 const r=bankRuntime({items0:[key(46),key(46)]},[key(5),key(12),null,null,null]);
 await r.service.fill(0);assert.deepEqual(r.quantities(),[50,47]);assert.equal(r.c.character.items[1].q,12);assert.equal(r.c.character.items[0],null);assert.equal(r.total(),109);
});
test('bee wings consolidate and legitimate overflow retains full stacks',async()=>{
 const r=bankRuntime({items0:[{name:'beewings',q:9000},{name:'beewings',q:800},{name:'beewings',q:500}]});
 await r.service.compact();assert.deepEqual(r.quantities(),[9999,301]);assert.equal(r.total(),10300);
});
test('protected locations, variants and staging are preserved',async()=>{
 const bank={items0:[key(46),{...key(5),l:'l'},key(5)],items1:Array(42).fill(null)};bank.items1[35]=key(5);
 const r=bankRuntime(bank);r.c.stackProtection={locations:[{pack:'items0',slot:2}],items:[]};
 await r.service.compact();assert.deepEqual(r.quantities(),[46,5,5,5]);assert.equal(r.calls.length,0);
});
test('full inventory defers partial work but permits safe whole-stack bank merges',async()=>{
 const r=bankRuntime({items0:[key(46),key(46),key(5)]},Array(4).fill({name:'sword'}));
 assert.equal((await r.service.compact()).deferred,true);assert.equal(r.calls.length,0);
 r.c.character.bank.items0=[key(20),key(25)];await r.service.compact();assert.deepEqual(r.quantities(),[45]);
});
test('deposit with insufficient split buffers is deferred without creating a bank stack',async()=>{
 const r=bankRuntime({items0:[key(46),key(46)]},[key(5)]);
 await assert.rejects(r.service.fill(0),/buffers/);assert.equal(r.calls.length,0);assert.deepEqual(r.quantities(),[46,46]);
});
test('planner fills all partial capacity before allocating an overflow slot',()=>{
 const r=bankRuntime({items0:[key(46),key(46)]});const plan=stackDepositPlan(key(12),50,r.locations());
 assert.deepEqual(plan.moves.map(m=>m.quantity),[4,4,4]);assert.equal(plan.remaining,0);
});
for(const failAt of [1,2,3,4,5,6])test('restart recovers confirmed mutation '+failAt+' without duplication',async()=>{
 const r=bankRuntime({items0:[key(46)],items8:[key(5)]});r.c.parent.bank_packs={items0:['bank'],items8:['bank_b']};
 let operations=0,crashed=false;
 for(const name of ['retrieve','store','split','swap','bankSwap']){const run=r.ports[name];r.ports[name]=async(...args)=>{
  const result=await run(...args);if(++operations===failAt&&!crashed){crashed=true;throw Error('connection lost after mutation');}return result;};}
 try{await r.service.compact();}catch(error){assert.match(error.message,/connection lost/);}
 const restarted=createBankStacks(r.ports);
 if(r.ports.read())await restarted.recover();await restarted.compact();
 assert.equal(r.total(),51);assert.deepEqual(r.quantities(),[50,1]);assert.ok(r.c.character.items.every(x=>!x));assert.equal(r.ports.read(),null);
});
test('unconfirmed operation stays journaled and is not sent twice',async()=>{
 const r=bankRuntime({items0:[key(46)],items8:[key(5)]});let sent=0;r.ports.retrieve=async()=>{sent++;};
 await assert.rejects(r.service.compact(),/not confirmed/);await assert.rejects(r.service.recover(),/not confirmed/);
 assert.equal(sent,1);assert.ok(r.ports.read().pending);assert.equal(r.total(),51);
});

test('locked floors and protected crafting item types are excluded',async()=>{
 const r=bankRuntime({items0:[key(46)],items8:[key(5)]});r.c.parent.bank_packs={items0:['bank'],items8:['bank_b']};
 r.ports.reachable=()=>['bank'];await r.service.compact();assert.equal(r.calls.length,0);
 r.ports.reachable=()=>['bank','bank_b'];r.c.stackProtection={locations:[],items:[{name:'tombkey',level:0}]};
 await r.service.compact();assert.equal(r.calls.length,0);
});

test('delayed proxy updates settle before the next mutation',async()=>{
 const r=bankRuntime({items0:[key(20),key(25)]});const original=r.ports.bankSwap,clock=r.ports.sleep;let update;
 r.ports.bankSwap=async(...args)=>{update=()=>original(...args);};
 r.ports.sleep=async ms=>{await clock(ms);if(update){const apply=update;update=null;await apply();}};
 await r.service.compact();assert.deepEqual(r.quantities(),[45]);assert.equal(r.total(),45);
});

test('a full bank pane compacts without requiring an empty bank slot',async()=>{
 const pack=[key(46),key(46),key(5),...Array.from({length:39},(_,i)=>({name:'equipment'+i}))];
 const r=bankRuntime({items0:pack});await r.service.compact();
 assert.deepEqual(pack.filter(x=>x?.name==='tombkey').map(x=>x.q),[50,47]);assert.equal(pack.filter(Boolean).length,41);
 assert.ok(r.c.character.items.every(x=>!x));
});

test('concurrent cleanup calls serialize rather than borrowing the same buffers',async()=>{
 const r=bankRuntime({items0:[key(46),key(46),key(5)]});
 await Promise.all([r.service.compact(),r.service.compact(),r.service.recover()]);
 assert.deepEqual(r.quantities(),[50,47]);assert.equal(r.total(),97);assert.equal(r.ports.read(),null);
});

test('replacement runtime leaves the operation journal for the new runner',async()=>{
 const r=bankRuntime({items0:[key(46)],items8:[key(5)]});let current=true;
 r.ports.current=()=>current;const retrieve=r.ports.retrieve;
 r.ports.retrieve=async(...args)=>{await retrieve(...args);current=false;};
 await assert.rejects(r.service.compact(),/runtime replaced/);assert.ok(r.ports.read().pending);assert.equal(r.total(),51);
 current=true;r.ports.retrieve=retrieve;const restarted=createBankStacks(r.ports);
 await restarted.recover();await restarted.compact();assert.deepEqual(r.quantities(),[50,1]);
});

test('a stack changed during floor travel is replanned without depositing stale quantities',async()=>{
 const r=bankRuntime({items8:[key(40)]},[key(5),null,null]);r.c.parent.bank_packs={items8:['bank_b']};
 r.ports.move=async floor=>{r.c.character.map=floor;r.c.character.bank.items8[0].q=45;};
 await assert.rejects(r.service.fill(0),/changed during travel/);
 assert.equal(r.calls.length,0);assert.equal(r.c.character.items[0].q,5);assert.equal(r.ports.read(),null);
});
