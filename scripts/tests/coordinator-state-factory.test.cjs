const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createInitialCoordinatorState}=require('../../runtime/coordinator/initial-state.ts');
test('typed state factory preserves the complete legacy initialization and clock evaluation order',()=>{
 const object=fs.readFileSync(require('node:path').join(__dirname,'fixtures/coordinator-legacy-initial-state.js'),'utf8');
 const input={persistedSettings:{threshold:0,monsterFocus:[],merchantCharacter:'M',standListings:[{item:{name:'ring'}}],activeConvoy:{epoch:3},anniversary:{blacklist:[]}},persistedSelections:{},persistedHistory:{},persistedBankState:{},persistedRoster:{},persistedALData:{},initialHeadless:['F',null,null,null],configuredRealm:'SR_USII'};
 const policies=require('../../runtime/coordinator/index.ts');let oldTime=100,newTime=100;
 const context={...structuredClone(input),coordinatorPolicies:policies,Date:{now:()=>oldTime++},loadBankVaultDefinitions:()=>[{pack:'items1'}],DEFAULT_MERCHANT_ROUTINE_PRIORITIES:policies.defaultMerchantRoutinePriorities(),DEFAULT_MERCHANT_AUTOMATIONS:policies.defaultMerchantAutomations()};
 const expected=vm.runInNewContext(object,context),actual=createInitialCoordinatorState(structuredClone(input),{now:()=>newTime++,loadBankVaultDefinitions:()=>[{pack:'items1'}]});
 expected.activeConvoy.failure='Coordinator restarted; waiting to recover interrupted travel';
 expected.activeConvoy.restartRecovery=true;
 expected.activeConvoy.restartRevisions={};
 expected.activeConvoy.routeProtocol=4;
 // Hunt trip persistence was added after the frozen legacy initializer. Verify
 // its defaults explicitly, then retain the complete legacy parity assertion.
 const {upgradeOfferingRules,merchantRules,production,passiveHunting,bankSortMode,bankSortRequest,gameVersion,clientUpdate,bankboiPrefix,anniversaryAutoChat,autoBlacklistMerchants,nativeStand,autoStandBuys,farmingProfiles,huntSettings,huntFailures,huntEventTrips,combatEventHandoff,returnProgress,merchantHomeReturnAt,luckyUpgradeSlots,luckySlotTracking,...legacyActual}=actual;
 assert.deepEqual(upgradeOfferingRules,[]);assert.equal(merchantRules,null);assert.deepEqual(production,{attempts:{}});assert.deepEqual(passiveHunting,{version:1,rules:{},useFieldGenerators:true});
 assert.equal(bankSortMode,"automatic");assert.equal(bankSortRequest,null);
 assert.equal(gameVersion,0);assert.equal(clientUpdate,null);
 assert.equal(bankboiPrefix, "");assert.equal(anniversaryAutoChat,false);
 assert.deepEqual(nativeStand,{sequence:0,offers:{},problems:{}});assert.equal(autoStandBuys,false);assert.equal(autoBlacklistMerchants,true);
 assert.deepEqual(farmingProfiles,{});
 assert.deepEqual(huntSettings,require("../../runtime/coordinator/hunt/settings.ts").defaultHuntSettings);assert.deepEqual(huntFailures,{});
 assert.equal(merchantHomeReturnAt,0);assert.deepEqual(luckyUpgradeSlots,{});assert.deepEqual(luckySlotTracking,{});
 assert.deepEqual(returnProgress,{});
 assert.deepEqual(huntEventTrips,{});assert.equal(combatEventHandoff,null);
 assert.deepEqual(JSON.parse(JSON.stringify(legacyActual)),JSON.parse(JSON.stringify(expected)));assert.equal(newTime,oldTime);assert.deepEqual(Object.keys(legacyActual),Object.keys(expected));
});

test('state initialization retains persisted Hunt trip and combat handoff records',()=>{
 const huntEventTrips={W:[{id:'trip',event:'anniversary',startedAt:10}]},combatEventHandoff={startedAt:10,endedAt:20};
 const state=createInitialCoordinatorState({persistedSettings:{huntEventTrips,combatEventHandoff},persistedSelections:{},persistedHistory:{},persistedBankState:{},persistedRoster:{},persistedALData:{},initialHeadless:[],configuredRealm:'SR_USII'},
  {now:()=>100,loadBankVaultDefinitions:()=>[]});
 assert.equal(state.huntEventTrips,huntEventTrips);assert.equal(state.combatEventHandoff,combatEventHandoff);
});

for(const merchant of ['FonzeMerch','GoldMajesty'])test('new merchant '+merchant+' has no invented lucky slot',()=>{
 const {initialMerchantRuntime}=require('../../runtime/coordinator/merchant/initial-runtime.ts');
 assert.deepEqual(initialMerchantRuntime({},merchant).luckyUpgradeSlots,{});
});
test('persisted character-specific lucky slots retain zero and other verified values',()=>{
 const {initialMerchantRuntime}=require('../../runtime/coordinator/merchant/initial-runtime.ts');
 assert.deepEqual(initialMerchantRuntime({luckyUpgradeSlots:{FonzeMerch:0,Other:41}},'FonzeMerch').luckyUpgradeSlots,{FonzeMerch:0,Other:41});
});
test('retire the old hardcoded slot 7 without mutating saved settings or other slots',()=>{
 const {initialMerchantRuntime}=require('../../runtime/coordinator/merchant/initial-runtime.ts');
 const saved={luckyUpgradeSlots:{GoldMajesty:7,FonzeMerch:0}};
 assert.deepEqual(initialMerchantRuntime(saved,'GoldMajesty').luckyUpgradeSlots,{FonzeMerch:0});
 assert.equal(saved.luckyUpgradeSlots.GoldMajesty,7);
});
