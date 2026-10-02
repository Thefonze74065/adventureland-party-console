const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
 const calls=[];const c=vm.createContext({root:{__merchantActiveJob:{jobId:'job'}},runtimeCurrent:()=>true,lastCommand:5,merchantIdleActive:false,merchantIdlePending:null,
 character:{name:'M',ctype:'merchant',map:'main',x:0,y:0,stand:true,slots:{},items:[{name:'pants'}]},merchantMarketLocation:{map:'main',x:0,y:0},merchantHomeRealm:'SR_USII',parent:{server_region:'US',server_identifier:'II'},
 merchantLuckyUpgrade:()=>({recover:async()=>{},tidy:async()=>{}}),
 gatheringMode:null,gatheringGeneration:0,gatheringTimer:null,gatheringSession:null,stop:async()=>{},
 sameItem:(a,b)=>!!a&&!!b&&a.name===b.name,findItem:()=>0,fingerprint:i=>i,consolidateMerchantInventory:async()=>{},game_log(){},
 request:async(path,args)=>{calls.push({path,...args.body});},trade:async(slot,tradeSlot)=>{c.character.slots[tradeSlot]=c.character.items[slot];c.character.items[slot]=null;}});
 require('./helpers/client-dependencies.cjs').merchantGuards(c,{journal:true});
 vm.runInContext(source.slice(source.indexOf('  async function merchantStandInventoryReady('),source.indexOf('  function gatheringDestination(')),c);return {c,calls};
}
test('stand sync passes active ownership, performs listing, and reconciles before completion',async()=>{
 const {c,calls}=fixture();await c.merchantStandSync({id:5,jobId:'job',listings:[{id:'pants',slot:0,item:{name:'pants'},price:10}]});
 assert.equal(c.character.slots.trade1.name,'pants');assert.equal(calls[0].path,'/merchant/checkpoint');assert.equal(calls[0].protectionOnly,true);const status=calls.find(call=>call.path==='/merchant/idle-status');assert.equal(status.commandId,5);assert.equal(status.liveListings[0].id,'pants');assert.equal(calls.at(-1).success,true);
});
test('skipped and deferred stand sync cannot claim success',async()=>{
 for(const deferred of [false,true]){const {c,calls}=fixture();if(deferred)c.merchantIdleActive=true;else c.root.__merchantActiveJob.jobId='other';
 await assert.rejects(c.merchantStandSync({id:5,jobId:'job',listings:[]}),/did not execute/);assert.equal(calls.at(-1).success,false);assert.equal(calls.some(x=>x.success===true),false);}
});
test('blocked stand work waits for relevant changes while unrelated crafting inventory changes do not retrigger it',()=>{
 const {createMerchantQueue}=require('../../runtime/coordinator/merchant/queue.ts');const {standSyncSignature}=require('../../runtime/coordinator/merchant/stand-sync-signature.ts');
 const listings=[{id:'pants',state:'waiting',item:{name:'pants'}}],items=[{item:{name:'pants'}},{item:{name:'fur',q:10}}];const state={queue:[],current:null,blocks:{}};
 const ports={merchant:()=> 'M',hasPendingStandInventory:()=>true,standInventorySignature:()=>standSyncSignature('M',listings,items),stamp:j=>j,nextId:()=> 'j',now:()=>1,persist(){},dispatch(){}};
 const queue=createMerchantQueue(state,ports);assert.equal(queue.localStandSync(),true);state.queue=[];assert.equal(queue.localStandSync(),false);items[1].item.q--;assert.equal(queue.localStandSync(),false);
 listings.push({id:'sold',state:'live',tradeSlot:'trade1',item:{name:'hat'}});assert.equal(queue.localStandSync(),true);
});

test('lucky recovery failure allows arrival and opening, but no stand or inventory mutations',async()=>{
 const {c,calls}=fixture();delete c.root.__merchantActiveJob;c.character.map='bank';c.character.stand=false;
 c.merchantTownReturn=async()=>{c.character.map='main';};
 c.anniversaryWithTimeout=async p=>p;c.smart_move=async()=>{};c.setTimeout=fn=>fn();
 c.open_stand=async()=>{c.character.stand=true;};
 c.luckyUpgradeService={pending:()=>true,recover:async()=>{throw Error('displaced item changed; inventory recovery required');}};
 c.nativeStandSync=async()=>assert.fail('must not mutate trade slots');
 c.consolidateMerchantInventory=async()=>assert.fail('must not pack inventory');
 const result=await c.merchantIdle({id:5,listings:[]});
 assert.equal(result.state,'deferred');assert.equal(c.character.map,'main');assert.equal(c.character.stand,true);
 assert.deepEqual(calls.map(c=>c.phase),['returning','arrived','inventory-recovery']);
 assert.equal(c.character.items[0].name,'pants');
});

test('stand-return commands bypass pre-dispatch recovery; other commands still require it',async()=>{
 const start=source.indexOf('    var returningToStand ='),end=source.indexOf('    if (command.luckyUpgradeSlot',start);
 const guard=source.slice(start,end);
 for(const type of ['merchant-idle','equip']) {
   const reports=[];
   const c=vm.createContext({command:{type},request:async()=>({pending:[]}),merchantLuckyUpgrade:()=>({retireSettled(){}}),character:{ctype:'merchant'},root:{},luckyUpgradeService:{pending:()=>true,recover:async()=>{throw Error('blocked');}},reportMerchantCommand:(_command,state,reason)=>reports.push({state,reason})});
   require('./helpers/client-dependencies.cjs').merchantGuards(c,{journal:true});
   const work=vm.runInContext('(async()=>{'+guard+'})()',c);
   await work;
   assert.deepEqual(reports,type==='merchant-idle'?[]:[{state:'deferred',reason:'blocked'}]);
 }
});

test('optional tidy failure reports recovery without claiming the stand return failed',async()=>{
 const {c,calls}=fixture();delete c.root.__merchantActiveJob;c.luckyUpgradeSlot=7;
 c.merchantLuckyUpgrade=()=>({recover:async()=>{},tidy:async()=>{throw Error('displaced item changed');}});
 const result=await c.merchantIdle({id:5,listings:[]});
 assert.equal(result.state,'complete');
 assert.deepEqual(calls.map(c=>c.phase),['arrived','inventory-recovery','complete']);
 assert.equal(c.root.__merchantInventoryTidy,null);
});

test('background native stand synchronization waits for lucky-slot recovery',async()=>{
 const start=source.indexOf('      if (character.ctype === "merchant" && character.stand && !merchantIdleActive');
 const end=source.indexOf('      statusPhase = "apply status";',start);
 const code='(async()=>{'+source.slice(start,end)+'})()';
 let synced=0;
 const c=vm.createContext({request:async()=>({pending:[]}),merchantLuckyUpgrade:()=>({retireSettled(){}}),character:{ctype:'merchant',stand:true},root:{},merchantIdleActive:false,merchantLuckyUpgrade:()=>({pending:()=>true}),nativeStandSync:async()=>{synced++;}});
 await vm.runInContext(code,c);assert.equal(synced,0);
 c.merchantLuckyUpgrade=()=>({pending:()=>false});await vm.runInContext(code,c);assert.equal(synced,1);
});
