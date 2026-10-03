const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=require('./helpers/coordinator-source.cjs').coordinatorSource();
const {createMerchantObservation}=require('../../runtime/coordinator/status/merchant-observation.ts');
function fixture(){const party={merchantCharacter:'M',statuses:{M:{map:'bank',x:0,y:-37,seenAt:Date.now()}},merchantQueue:[{reason:'marked items'}],gatheringModes:['fishing'],gatheringCooldowns:{fishing:Date.now()+60000},commands:{},standListings:[],nextCommandId:1};
const r=vm.createContext({merchantInventoryStacks:require('../merchant-inventory-stacks.cjs'),party,bankboiSwitchBusy:false,bankboiService:{busy:()=>r.bankboiSwitchBusy},bankStackRouting:{servicePlan:()=>null},merchantAnniversaryControl:()=>({}),ensureMerchantHome:()=>true,merchantTransferCapacityBlocked:()=>false,markedCollectionReady:job=>job.reason!=='marked items'});
require('./helpers/coordinator-idle.cjs')(r);return {r,party};}
test('deferred pickups allow stand return when gathering is disabled',()=>{const {r,party}=fixture();party.gatheringModes=[];r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');});
test('ready collection and ready gathering retain priority over stand return',()=>{for(const mode of ['collection','gathering']){const {r,party}=fixture();if(mode==='collection')r.markedCollectionReady=()=>true;else party.gatheringCooldowns.fishing=0;r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);}});
test('open stand away from market still requires a return',()=>{const {r,party}=fixture();party.gatheringModes=[];party.statuses.M.standOpen=true;r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');});
test('already open at market does not issue another return',()=>{const {r,party}=fixture();Object.assign(party.statuses.M,{map:'main',x:-63,y:100,standOpen:true});r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);});
test('stand-open log checks coordinates before claiming arrival',()=>{const logs=[];const observer=createMerchantObservation({listings:[]},{log:(...args)=>logs.push(args),persist(){},publish(){}});const body={standOpen:true,map:'bank',x:0,y:-37},previous={standOpen:false,map:'bank'};observer.observe(body,previous);assert.equal(logs[0][0],'Stand opened away from market');body.map='main';body.x=-63;body.y=100;observer.observe(body,previous);assert.equal(logs[1][0],'At stand');});
const shared=fs.readFileSync('characters/shared.js','utf8');
test('resolved movement at the wrong map cannot count as stand arrival',async()=>{const start=shared.indexOf('      if (!command.inPlace && (character.map !== merchantMarketLocation.map');const end=shared.indexOf('      // Trade-slot mutations',start);const code='(async()=>{'+shared.slice(start,end)+'})()';const r=vm.createContext({request:async()=>{},runtimeCurrent:()=>true,lastCommand:1,idleOwner:1,root:{},command:{},character:{map:'bank',x:0,y:-37},merchantMarketLocation:{map:'main',x:-63,y:100}});await assert.rejects(vm.runInContext(code,r),/before reaching the market/);r.command.inPlace=true;await vm.runInContext(code,r);r.command.inPlace=false;Object.assign(r.character,{map:'main',x:-63,y:100});await vm.runInContext(code,r);});

test('gathering cooldown allows coordinator recovery from a later bank visit',()=>{const {r,party}=fixture();r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');});
test('bank travel waits for the stand to close and refuses a failed close',async()=>{
 let now=0; const calls=[];
 const r=vm.createContext({character:{stand:true},Date:{now:()=>now},close_stand:async()=>calls.push('close'),sleep:async()=>{now+=100;}});
 const start=shared.indexOf('  async function closeMerchantStandForTravel('),end=shared.indexOf('  async function merchantVisitBank(',start);
 vm.runInContext(shared.slice(start,end),r);
 await assert.rejects(r.closeMerchantStandForTravel(),/did not close/);
 r.close_stand=async()=>{r.character.stand=false;};await r.closeMerchantStandForTravel();assert.equal(r.character.stand,false);
});

test('anniversary reservation returns to stand despite paused queue and gathering',()=>{const {r,party}=fixture();r.merchantAnniversaryControl=()=>({reserved:true,preWindow:true});r.markedCollectionReady=()=>true;r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');});
test('active anniversary kiss retains movement ownership',()=>{const {r,party}=fixture();r.merchantAnniversaryControl=()=>({reserved:true,busy:true});r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);});

for (const owner of ['gathering','banking','job','bankboi']) test('active '+owner+' retains ownership during cooldown',()=>{
 const {r,party}=fixture();
 if(owner==='gathering')party.statuses.M.gatheringActive=true;
 if(owner==='banking')party.statuses.M.banking=true;
 if(owner==='job')party.merchantCurrent={id:'job'};
 if(owner==='bankboi')party.bankboiTransaction={};
 r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);
 if(owner==='gathering')party.statuses.M.gatheringActive=false;
 if(owner==='banking')party.statuses.M.banking=false;
 if(owner==='job')party.merchantCurrent=null;
 if(owner==='bankboi')party.bankboiTransaction=null;
 r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');
});

test('bank entry and cake result logs are based on observed changes',()=>{
 const logs=[];const r={body:{map:'bank',x:0,y:-37},previousStatus:{map:'main'}};
 const observer=createMerchantObservation({listings:[]},{log:(...args)=>logs.push(args),persist(){},publish(){}});
 const run=()=>observer.observe(r.body,r.previousStatus);
 run();assert.equal(logs[0][0],'Entered bank');
 r.previousStatus={map:'bank'};run();assert.equal(logs.length,1);
 r.body.map='bank_b';run();assert.equal(logs.length,1);
 r.previousStatus=undefined;run();assert.equal(logs.at(-1)[0],'Merchant online in bank');
 r.previousStatus={map:'main'};r.body.map='bank_u';run();assert.equal(logs.at(-1)[0],'Entered bank');
 r.previousStatus={map:'bank_u'};r.body.anniversaryState={craftResult:{at:123,success:false,error:'missing slice_strawberry'}};
 run();assert.equal(logs.at(-1)[0],'Anniversary cake deferred');assert.equal(logs.at(-1)[2],'missing slice_strawberry');
 const count=logs.length;r.previousStatus=JSON.parse(JSON.stringify(r.body));run();assert.equal(logs.length,count);
});

for(const closed of [false,true])test('cooldown rechecks '+(closed?'closed stand at market':'position despite cached arrival'),async()=>{
 let returns=0;
 const c=vm.createContext({character:{level:30,map:closed?'main':'bank',x:closed?-63:0,y:closed?100:-37,stand:!closed,slots:{}},
 root:{__merchantGatheringGeneration:1},gatheringMode:'fishing',gatheringModes:['fishing'],is_on_cooldown:()=>true,gatheringSession:{atStandForCooldown:true,cooldownUntil:Date.now()+60000},
 gatheringActive:false,merchantIdleActive:false,busy:false,banking:false,anniversaryBusy:false,gatheringRetryAt:0,upgrading:false,departurePending:false,
 merchantAnniversaryWorkReserved:()=>false,freeInventorySlots:()=>10,gatheringDestination:()=>({}),syncGatheringCooldown:()=>0,
 merchantMarketLocation:{map:'main',x:-63,y:100},gatheringStandListings:[],gatheringStatus(){},restoreGatheringEquipment:async()=>true,
 merchantTownReturn:async()=>{},setTimeout:fn=>fn(),merchantIdle:async()=>{returns++;Object.assign(c.character,{map:'main',x:-63,y:100,stand:true});}});
 vm.runInContext(shared.slice(shared.indexOf('  function gatheringAttemptCurrent('),shared.indexOf('  function setGathering(')),c);
 await c.gatheringTick(1);await c.gatheringTick(1);assert.equal(returns,1);assert.equal(c.gatheringSession.atStandForCooldown,true);
});

test('manual equipment commands survive automatic stand dispatch until delivered',()=>{
 const {r,party}=fixture();party.gatheringModes=[];
 for(const type of ['equip','unequip']){
  const command={id:17,type,slot:'amulet',item:{name:'dexamulet',level:2}};
  party.commands.M=command;r.dispatchMerchantIdle();assert.equal(party.commands.M,command);
 }
});
