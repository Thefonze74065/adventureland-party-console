const test=require('node:test'), assert=require('node:assert/strict');
const {SteamGroup}=require('../../runtime/roster/steam-group.ts');
const {orderCharacters}=require('../../dashboard/features/party/character-order.ts');
function fixture(steam=['P'],slots=['M','W','Trader',null]) {
 let now=1000,id=0;const state={native:steam[0]||null,steam,slots,handoff:null};
 const online=new Set([...steam,...slots.filter(Boolean)]),stopped=[],started=[];
 const ports={now:()=>now,id:()=>String(++id),save(){},bridgeReady:()=>true,owned:()=>true,
  validateParticipants:names=>assert.ok(new Set(names).size<=4),
  stopHeadless:async name=>{stopped.push(name);online.delete(name);},confirmOffline:async name=>!online.has(name),
  startHeadless:(name,slot)=>{assert.ok(!online.has(name));online.add(name);started.push([name,slot]);}};
 const service=new SteamGroup(state,ports);
 return {state,online,stopped,started,service,ports,advance:ms=>now+=ms,
  release:async()=>{state.handoff.multi.release.forEach(n=>online.delete(n));await service.released(state.handoff.id);}};
}

test('lost primary release reply completes only after authoritative offline confirmation',async()=>{
 const f=fixture();await f.service.begin('headless','P');
 f.service.expire();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.started,[]);assert.equal(f.state.native,'P');
 f.online.delete('P');f.service.expire();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.handoff.phase,'complete');assert.equal(f.state.native,null);
 assert.deepEqual(f.started,[['P',3]]);assert.deepEqual(f.state.steam,[]);
 f.service.expire();await f.service.released(f.state.handoff.id);
 assert.deepEqual(f.started,[['P',3]]);
});
test('persisted lost-release timeout resumes without a Steam bridge reply',async()=>{
 const f=fixture();await f.service.begin('headless','P');
 f.state.handoff.phase='failed';f.state.handoff.error='Steam operation timed out; assignments remain reserved until recovery';
 f.advance(180000);const restarted=new SteamGroup(f.state,f.ports);
 restarted.expire();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.started,[]);assert.equal(f.state.handoff.phase,'failed');
 f.online.delete('P');restarted.expire();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.handoff.phase,'complete');assert.deepEqual(f.started,[['P',3]]);
});
test('headless release polling does not retry explicit bridge failures',async()=>{
 const f=fixture();await f.service.begin('headless','P');
 f.service.fail(f.state.handoff.id,'stop_runner failed');f.online.delete('P');
 f.service.expire();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.handoff.phase,'failed');assert.deepEqual(f.started,[]);
});
test('interrupted headless release resumes after startup marks ownership uncertain',async()=>{
 const f=fixture();await f.service.begin('headless','P');
 f.state.handoff.phase='failed';f.state.handoff.error='Coordinator restarted during handoff; confirm offline ownership before recovery';
 f.online.delete('P');f.service.expire();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.handoff.phase,'complete');assert.deepEqual(f.started,[['P',3]]);
});
test('restoring Steam companions is not blocked by an untouched headless merchant',async()=>{
 const f=fixture(['P','M','W'],['Trader',null,null,null]);
 const checked=[];
 f.ports.validateParticipants=names=>{checked.push(names);if(names.includes('Trader'))throw Error('merchant inventory busy');};
 await f.service.begin('primary','P');
 assert.deepEqual(checked,[['P','M','W']]);
 assert.deepEqual(f.state.handoff.multi.release,['M','W']);
 assert.deepEqual(f.stopped,[]);
});
test('headless to primary preserves former primary in Steam and waits for all CODE arrivals',async()=>{
 const f=fixture();await f.service.begin('primary','M');assert.deepEqual(f.stopped,['M']);
 await f.service.released(f.state.handoff.id);assert.equal(f.state.native,'P');
 await f.release();assert.deepEqual(f.state.steam,['P','M']);assert.deepEqual(f.started,[]);
 assert.equal(f.state.slots[0],null);f.service.observe('M',['M']);assert.equal(f.state.handoff.phase,'navigate');
 f.service.observe('M',['M','P']);assert.equal(f.state.handoff.phase,'complete');assert.equal(f.state.native,'M');
});
test('background Steam to headless never releases primary or other backgrounds',async()=>{
 const f=fixture(['P','M'],['W','Trader',null,null]);await f.service.begin('headless','M');
 assert.deepEqual(f.state.handoff.multi.release,['M']);await f.release();
 assert.deepEqual(f.started,[['M',2]]);assert.ok(f.online.has('P'));f.service.observe('P',['P']);
 assert.equal(f.state.handoff.phase,'complete');assert.equal(f.state.native,'P');
});
test('primary logout promotes another Steam member without starting headless',async()=>{
 const f=fixture(['P','M'],['W','Trader',null,null]);await f.service.begin('logout','P');
 assert.equal(f.state.handoff.multi.primary,'M');await f.release();assert.deepEqual(f.started,[]);
 f.service.observe('M',['M']);assert.deepEqual(f.state.steam,['M']);assert.equal(f.state.native,'M');
});
test('last Steam member can move headless, followed by logging an offline character into Steam',async()=>{
 const f=fixture(['P'],['W',null,null,null]);await f.service.begin('headless','P');await f.release();
 assert.equal(f.state.native,null);assert.equal(f.state.handoff.phase,'complete');
 await f.service.begin('login','M');await f.release();assert.equal(f.state.handoff.multi.primary,'M');
 f.service.observe('M',['M']);assert.equal(f.state.native,'M');
});
test('offline login adds a Steam background and capacity checks precede mutation',async()=>{
 const f=fixture(['P'],['W',null,null,null]);await f.service.begin('login','M');await f.release();
 assert.deepEqual(f.state.handoff.multi.release,[]);assert.equal(f.state.native,'P');
 f.service.observe('P',['P','M']);await f.service.begin('login','Trader');await f.release();f.service.observe('P',['P','M','Trader']);
 await assert.rejects(f.service.begin('login','Fifth'),/maximum characters logged in/);
 assert.equal(f.state.handoff.multi.subject,'Trader');
});
test('timed-out transfer accepts matching late group arrival without duplicates',async()=>{
 const f=fixture();await f.service.begin('primary','M');await f.release();f.advance(180000);f.service.expire();
 assert.equal(f.state.handoff.phase,'failed');f.service.observe('M',['M','P']);
 assert.equal(f.state.handoff.phase,'complete');assert.deepEqual(f.started,[]);
});
test('concurrent actions are rejected and recovery cannot release an online reservation',async()=>{
 const f=fixture();await f.service.begin('primary','M');
 await assert.rejects(f.service.begin('primary','W'),/pending/);f.advance(180000);f.service.expire();
 f.online.add('M');
 await assert.rejects(f.service.recover(),/still online/);assert.ok(f.state.handoff);
 f.online.delete('M');f.online.delete('P');await f.service.recover();assert.equal(f.state.native,null);
});
test('failure before Steam release preserves the untouched primary during recovery',async()=>{
 const f=fixture();f.ports.stopHeadless=async()=>{};await f.service.begin('primary','M');
 f.advance(180000);f.service.expire();f.online.delete('M');await f.service.recover();
 assert.equal(f.state.native,'P');assert.deepEqual(f.state.steam,['P']);assert.ok(f.online.has('P'));
});
test('slow account offline confirmation stays preparing and advances on a later poll',async()=>{
 const f=fixture();f.ports.stopHeadless=async()=>{};
 await f.service.begin('primary','M');assert.equal(f.state.handoff.phase,'preparing');
 assert.equal(f.state.native,'P');f.online.delete('M');await f.service.prepare();
 assert.equal(f.state.handoff.phase,'release');
});
test('primary frame restoration releases only backgrounds',async()=>{
 const f=fixture(['P','M'],['W',null,null,null]);await f.service.begin('primary','P');
 assert.deepEqual(f.state.handoff.multi.release,['M']);await f.release();assert.equal(f.state.native,'P');
});
test('old singleton ownership migrates without changing assigned sessions',()=>{
 const f=fixture();delete f.state.steam;new SteamGroup(f.state,f.ports);
 assert.deepEqual(f.state.steam,['P']);assert.deepEqual(f.stopped,[]);assert.deepEqual(f.started,[]);
});
test('card order keeps primary first and merchant last with stable middle ordering',()=>{
 const roster=['W','P','M','Trader'].map(name=>({name}));
 assert.deepEqual(orderCharacters(roster,roster,'M','Trader').map(c=>c.name),['M','W','P','Trader']);
 assert.deepEqual(orderCharacters(roster,roster,'Trader','Trader').map(c=>c.name),['Trader','W','P','M']);
 assert.deepEqual(orderCharacters(roster,roster,null,'Trader').map(c=>c.name),['W','P','M','Trader']);
});

test('bulk headless handoff persists its queue and transfers primary last',async()=>{
 const f=fixture(['P','M','W'],['Trader',null,null,null]);
 await f.service.allHeadless();assert.equal(f.state.handoff.multi.subject,'M');
 assert.deepEqual(f.state.handoff.bulkRemaining,['W','P']);
 await f.release();f.service.observe('P',['P','W']);f.service.expire();await new Promise(r=>setImmediate(r));
 assert.equal(f.state.handoff.multi.subject,'W');assert.deepEqual(f.state.handoff.bulkRemaining,['P']);
 await f.release();f.service.observe('P',['P']);f.service.expire();await new Promise(r=>setImmediate(r));
 assert.equal(f.state.handoff.multi.subject,'P');await f.release();
 assert.equal(f.state.handoff.phase,'complete');assert.equal(f.state.native,null);assert.deepEqual(f.state.steam,[]);
 assert.deepEqual(f.started.map(([name])=>name),['M','W','P']);assert.ok(f.online.has('Trader'));
});

test('bulk completion waits for headless CODE and can finish without another Steam poll',async()=>{
 const f=fixture(['P'],['Trader',null,null,null]);let ready=false;
 f.ports.headlessReady=()=>ready;
 await f.service.allHeadless();await f.release();assert.equal(f.state.handoff.phase,'headless-starting');
 ready=true;f.service.expire();assert.equal(f.state.handoff.phase,'complete');
});

test('bulk recovery retains the failed subject and unprocessed queue',async()=>{
 const f=fixture(['P','M'],['Trader',null,null,null]);
 await f.service.allHeadless();f.advance(180001);f.service.expire();assert.equal(f.state.handoff.phase,'failed');
 await f.service.recover();assert.equal(f.state.handoff.multi.subject,'M');assert.deepEqual(f.state.handoff.bulkRemaining,['P']);
 await f.release();f.service.observe('P',['P']);f.service.expire();await new Promise(r=>setImmediate(r));
 assert.equal(f.state.handoff.multi.subject,'P');
});

test('dashboard orders hosting tiers using roster order without moving merchant ahead of headless',()=>{
 const roster = ['Warrior','Trader','Priest','Mage','Ranger'].map(name=>({name}));
 const characters = [...roster].reverse();
 assert.deepEqual(orderCharacters(characters,roster,'Warrior','Trader',['Warrior','Trader','Mage','Ranger'])
  .map(c=>c.name), ['Warrior','Mage','Ranger','Priest','Trader']);
 assert.deepEqual(orderCharacters(characters,roster,'Trader','Trader',['Trader','Mage'])
  .map(c=>c.name), ['Trader','Mage','Warrior','Priest','Ranger']);
 assert.deepEqual(characters.map(c=>c.name), ['Ranger','Mage','Priest','Trader','Warrior']);
});
test('Tracktrix refresh runs in both native and headless sessions',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('characters/shared.js','utf8');
 for(const caracAL of [undefined,true]) {
  const calls=[],ctx={parent:{caracAL,socket:{emit:name=>calls.push(name)}},root:{},trackerWasHeld:true,requestSilentTracker:null,
   setTimeout:()=>1,clearTimeout(){}};vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('  function scheduleTrackerSnapshot('),source.indexOf('  var trackerInventoryListener')),ctx);
  ctx.requestTrackerSnapshot();assert.equal(calls.length,1);
  ctx.scheduleTrackerSnapshot(1);assert.equal(ctx.root.__partyTrackerTimer,1);
 }
});
test('wrong-realm login waits without releasing ownership; Stay is scoped to each login',async()=>{
 const f=fixture(['P'],['M',null,null,null]);
 f.ports.realmContext=()=>({current:'SR_USIV',home:'SR_USII'});
 f.ports.observedRealm=()=> 'SR_USIV';
 const op=await f.service.begin('primary','M');
 assert.equal(op.phase,'awaiting-realm-choice');assert.deepEqual(f.stopped,[]);
 f.advance(240000);f.service.expire();assert.equal(op.phase,'awaiting-realm-choice');
 await f.service.chooseRealm(op.id,'stay');assert.deepEqual(f.stopped,['M']);assert.equal(op.destinationRealm,'SR_USIV');
 await f.release();f.service.observe('M',['P','M']);assert.equal(op.phase,'complete');
 f.online.delete('W');const next=await f.service.begin('login','W');assert.equal(next.phase,'awaiting-realm-choice');
});
test('Switch releases the existing Steam group and rejects wrong-realm arrivals',async()=>{
 const f=fixture(['P','Q'],[null,null,null,null]);f.online.delete('M');
 f.ports.realmContext=()=>({current:'SR_USIV',home:'SR_USII'});
 let realm='SR_USIV';f.ports.observedRealm=()=>realm;
 const op=await f.service.begin('login','M');await f.service.chooseRealm(op.id,'switch');
 assert.equal(op.destinationRealm,'SR_USII');assert.deepEqual(op.multi.release,['P','Q']);
 await f.release();f.service.observe('P',['P','Q','M']);assert.equal(op.phase,'navigate');
 realm='SR_USII';f.service.observe('P',['P','Q','M']);assert.equal(op.phase,'complete');
});
test('realm refresh updates mismatches and continues a persisted waiting operation only once',async()=>{
 const f=fixture(['P'],['M',null,null,null]);let realm=null;
 f.ports.realmContext=()=>({current:realm,home:'SR_USII'});
 const op=await f.service.begin('primary','M');
 f.state.handoff=JSON.parse(JSON.stringify(op));
 realm='SR_USIV';await f.service.refreshRealmChoice();
 assert.equal(f.state.handoff.realmChoice.current,'SR_USIV');assert.deepEqual(f.stopped,[]);
 realm='SR_USII';await Promise.all([f.service.refreshRealmChoice(),f.service.refreshRealmChoice()]);
 assert.equal(f.state.handoff.phase,'release');assert.deepEqual(f.stopped,['M']);
});

test('cancel and changed realm observations cannot perform the stale choice',async()=>{
 const f=fixture(['P'],['M',null,null,null]);let realm='SR_USIV';
 f.ports.realmContext=()=>({current:realm,home:'SR_USII'});
 const op=await f.service.begin('primary','M');realm='SR_USV';
 await f.service.chooseRealm(op.id,'switch');assert.equal(op.phase,'awaiting-realm-choice');assert.deepEqual(f.stopped,[]);
 await f.service.chooseRealm(op.id,'cancel');assert.equal(f.state.handoff,null);assert.equal(f.state.slots[0],'M');
});
