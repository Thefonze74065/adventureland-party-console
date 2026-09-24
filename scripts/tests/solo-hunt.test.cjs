const test = require('node:test'), assert = require('node:assert/strict');
const {createInitialCoordinatorState} = require('../../runtime/coordinator/initial-state.ts');
const {createFarmingScopes} = require('../../runtime/coordinator/hunt/scopes.ts');
const {reconcileFarmingMembership} = require('../../runtime/coordinator/hunt/membership.ts');
const {createCoordinatorHunt} = require('../../runtime/coordinator/hunt/composition.ts');
const {createCoordinatorPartyConvoys} = require('../../runtime/coordinator/navigation/convoy-composition.ts');
const {coordinatorHuntParticipants, clearCoordinatorHunt, cancelCoordinatorHuntConvoy} = require('../../runtime/coordinator/hunt/controls.ts');
const {selection, priority} = require('../../runtime/hunt/policy.ts');
const {recordHuntFailure} = require('../../runtime/coordinator/hunt/settings.ts');
const navigation = require('../farming-navigation.cjs');
const NOW = 100000, farm = {map:'cave',x:500,y:100}, daisy = {map:'main',x:0,y:0};
function initial(saved={}) {
 return createInitialCoordinatorState({persistedSettings:{leader:'W',followers:{P:true},monsterFocus:['rat'],location:farm,...saved},persistedSelections:{},persistedHistory:{},persistedBankState:{},persistedRoster:{},persistedALData:{},initialHeadless:['W','P','R'],configuredRealm:'II'}, {now:()=>NOW,loadBankVaultDefinitions:()=>[]});
}
function fixture(saved={}) {
 const root=initial(saved);
 root.statuses={};
 for (const name of ['W','P','R','S']) root.statuses[name]={name,seenAt:NOW,server:'II',ctype:name==='W'?'warrior':'rogue',hp:500,map:'main',x:0,y:0,convoyProtocol:4,monsterHunt:{id:name==='R'?'bee':'rat',count:10,remainingMs:900000}};
 require("./helpers/travel-observations.cjs").observeTravel(root.statuses);
 root.monsterHunterLocation=daisy;
 const scopes=createFarmingScopes(root,()=>NOW);
 return {root,scopes};
}
function service(state) {
 const active=()=>Object.keys(state.statuses);
 const participants=()=>coordinatorHuntParticipants(state,()=>NOW,active);
 let convoys;
 const nav=navigation(state,{now:()=>NOW,names:active,activeNames:active,cancelConvoy:()=>convoys.cancel(),startConvoy:(...args)=>convoys.start(...args),persist(){},log(){}});
 convoys=createCoordinatorPartyConvoys(state,{now:()=>NOW,activeNames:active,intent:nav.intent,resolveArea:(_c,_f,l)=>l,persist(){}});
 const hunt=createCoordinatorHunt(state,{now:()=>NOW,participants,fighting:()=>false,rareEncounter:()=>null,cancelHuntConvoy:()=>cancelCoordinatorHuntConvoy(state),cancelConvoy:convoys.cancel,clear:()=>clearCoordinatorHunt(state),persist(){},selectedDestination:()=>({location:farm}),monsterDestination:()=>farm,missionDestination:()=>farm,start:convoys.start,navigation:nav,ownsTravel:priority,recordDeaths:()=>[],contains:()=>true,arrivalProtected:()=>false,partyFighting:()=>false});
 return {...hunt,convoys,nav};
}
function follow(root,scopes,name,value) {
 const before={leader:root.leader,followers:{...root.followers}};
 root.followers[name]=value;
 reconcileFarmingMembership(root,scopes,before,()=>NOW);
}
test('legacy leader migrates once; personal defaults and blacklists remain independent after restart',()=>{
 const {root,scopes}=fixture({farmingPolicy:'hunt',huntBlacklist:{rat:{monsterId:'rat',at:1,deaths:1}}});
 const solo=scopes.view('R');
 assert.equal(root.farmingPolicy,'hunt'); assert.equal(solo.farmingPolicy,'auto');
 assert.deepEqual(solo.huntBlacklist,{}); assert.equal(scopes.owner('P'),'W');
 solo.farmingPolicy='hunt'; recordHuntFailure(solo,'bee','deaths',1,NOW);
 assert.equal(root.huntBlacklist.bee,undefined); assert.equal(solo.huntBlacklist.rat,undefined);
 const restored=initial({farmingProfiles:JSON.parse(JSON.stringify(root.farmingProfiles))});
 const next=createFarmingScopes(restored,()=>NOW+1);
 assert.equal(next.view('R').farmingPolicy,'hunt'); assert.ok(next.view('R').huntBlacklist.bee); assert.ok(restored.huntBlacklist.rat);
});
test('concurrent Hunts select their own quests and clearing solo travel leaves the group running',()=>{
 const {root,scopes}=fixture(); const solo=scopes.view('R');
 root.farmingPolicy=solo.farmingPolicy='hunt';
 const group=service(root), single=service(solo);
 group.lifecycle.begin('auto',farm); single.lifecycle.begin('auto',farm);
 assert.deepEqual(root.monsterHunt.participants,['W','P']); assert.deepEqual(solo.monsterHunt.participants,['R']);
 assert.equal(root.monsterHunt.target,'rat'); assert.equal(solo.monsterHunt.target,'bee');
 assert.notEqual(root.activeConvoy.id,solo.activeConvoy.id);
 assert.deepEqual(root.activeConvoy.participants,['W','P']); assert.deepEqual(solo.activeConvoy.participants,['R']);
 assert.notEqual(root.commands.W.id,root.commands.R.id);
 const route=root.activeConvoy, command=root.commands.W;
 clearCoordinatorHunt(solo);
 assert.equal(root.activeConvoy,route); assert.equal(root.commands.W,command); assert.equal(root.commands.R,undefined);
});
test('simultaneous pickups use separate cycle IDs and commands; unrelated quests cannot bypass solo blacklist',()=>{
 const {root,scopes}=fixture(); const solo=scopes.view('R');
 root.statuses.W.monsterHunt=null; root.statuses.P.monsterHunt=null; root.statuses.R.monsterHunt=null;
 const group=service(root), single=service(solo);
 group.lifecycle.begin('auto',farm); single.lifecycle.begin('auto',farm);
 for (const [state,controller] of [[root,group],[solo,single]]) { controller.convoys.cancel(); state.monsterHunt.stage='at-daisy'; controller.quests.process(state.monsterHunt); }
 assert.equal(root.commands.W.type,'monster-hunt-interact'); assert.equal(root.commands.R.type,'monster-hunt-interact');
 assert.notEqual(root.commands.W.cycleId,root.commands.R.cycleId);
 root.statuses.R.monsterHunt={id:'bee',count:10,remainingMs:900000}; root.statuses.P.monsterHunt={id:'rat',count:10,remainingMs:900000};
 solo.huntBlacklist.bee={monsterId:'bee',at:NOW,deaths:1};
 assert.equal(selection(solo.monsterHunt,'R',root.statuses,solo.huntBlacklist),null);
 root.statuses.R.monsterHunt.count=0;
 assert.equal(selection(solo.monsterHunt,'R',root.statuses,solo.huntBlacklist).action,'claim');
});
test('Hunt -> Follow -> leader Auto -> Follow off restores personal Hunt without an obsolete route',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 root.farmingPolicy=solo.farmingPolicy='hunt';
 const group=service(root), single=service(solo);
 group.lifecycle.begin('auto',farm); single.lifecycle.begin('auto',farm);
 const groupHunt=root.monsterHunt, groupRoute=root.activeConvoy;
 const quest=root.statuses.R.monsterHunt;
 follow(root,scopes,'R',true);
 assert.equal(solo.farmingPolicy,'hunt'); assert.equal(scopes.effective('R').leader,'W');
 assert.equal(root.monsterHunt,groupHunt); assert.equal(root.activeConvoy,groupRoute);
 assert.equal(root.monsterHunt.target,'rat'); assert.ok(root.monsterHunt.participants.includes('R'));
 assert.equal(solo.activeConvoy,null); assert.equal(solo.monsterHunt,null); assert.equal(root.statuses.R.monsterHunt,quest);
 assert.equal(root.commands.R.type,'return-leader');
 root.farmingPolicy='auto';
 assert.equal(scopes.effective('R').farmingPolicy,'auto'); assert.equal(solo.farmingPolicy,'hunt');
 follow(root,scopes,'R',false); single.tick.tick();
 assert.equal(scopes.effective('R'),solo); assert.equal(solo.farmingPolicy,'hunt');
 assert.deepEqual(solo.monsterHunt.participants,['R']); assert.equal(solo.monsterHunt.target,'bee');
 assert.equal(root.monsterHunt.target,'rat');
});
test('second singleton and leader change never merge profiles or retain a previous group convoy',()=>{
 const {root,scopes}=fixture(); const r=scopes.view('R'), s=scopes.view('S');
 r.farmingPolicy='hunt'; s.farmingPolicy='scatter'; r.huntSettings.deathThreshold=3;
 assert.equal(s.huntSettings.deathThreshold,1);
 root.farmingPolicy='hunt'; service(root).lifecycle.begin('auto',farm);
 const before={leader:root.leader,followers:{...root.followers}};
 root.leader='R'; reconcileFarmingMembership(root,scopes,before,()=>NOW);
 assert.equal(root.farmingPolicy,'hunt'); assert.equal(root.huntSettings.deathThreshold,3);
 assert.equal(scopes.owner('P'),'R'); assert.equal(scopes.owner('W'),'W');
 assert.equal(scopes.view('W').activeConvoy,null); assert.equal(s.farmingPolicy,'scatter');
});
test('scope-owned event recovery does not pause the other Hunt',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 solo.eventReturn={cycleId:'solo-event',participants:['R']};
 solo.eventSessions.R={event:'goobrawl'};
 assert.equal(root.eventReturn,null); assert.equal(root.eventSessions.R,undefined);
 root.eventReturn={cycleId:'group-event',participants:['W','P']};
 assert.equal(solo.eventReturn.cycleId,'solo-event');
});

test('HTTP controls reject inherited edits, address solo settings, and report saved/effective mode',()=>{
 const {createScopedFarmingRoute}=require('../../runtime/coordinator/http/farming-scope.ts');
 const {createHuntSettingsRoute}=require('../../runtime/coordinator/http/hunt-settings.ts');
 const {root,scopes}=fixture();
 const services=new Map();
 const settings=state=>createHuntSettingsRoute(state,{now:()=>NOW,persist(){}});
 const main=settings(root);
 const ports={owned:name=>['W','P','R','M'].includes(name),merchant:()=> 'M',combat:name=>name!=='M',owner:scopes.owner,mainOwner:()=>root.leader,mode:name=>scopes.view(name).farmingPolicy,
  solo:name=>{if(scopes.owner(name)===root.leader)return null;if(!services.has(name))services.set(name,{settings:settings(scopes.view(name))});return services.get(name)}};
 const route=createScopedFarmingRoute(main,s=>s.settings,ports,true);
 const call=body=>{const res={code:200,status(n){this.code=n;return this},json(v){this.body=v;return v}};route({body},res);return res};
 assert.equal(call({character:'P',deathThreshold:4}).body.error,'following leader settings');
 assert.equal(call({character:'M',deathThreshold:4}).code,409);
 assert.equal(call({character:'unknown',deathThreshold:4}).code,400);
 const response=call({character:'R',deathThreshold:4});
 assert.equal(response.code,200); assert.equal(response.body.farmingOwner,'R'); assert.equal(response.body.savedFarmingPolicy,'auto');
 assert.equal(scopes.view('R').huntSettings.deathThreshold,4); assert.equal(root.huntSettings.deathThreshold,1);
 call({deathThreshold:2}); assert.equal(root.huntSettings.deathThreshold,2); assert.equal(scopes.view('R').huntSettings.deathThreshold,4);
});
test('all-blacklisted fallback contains only the singleton',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 solo.farmingPolicy='hunt'; solo.monsterFocus=['rat']; solo.location=farm;
 solo.huntBlacklist.bee={monsterId:'bee',at:NOW,deaths:1};
 const single=service(solo); single.lifecycle.begin('auto',farm);
 assert.deepEqual(solo.monsterHunt.participants,['R']);
 assert.match(solo.monsterHunt.message,/blacklisted|backup/i);
 assert.equal(root.monsterHunt,null);
});
test('restart invalidates both routes separately and never recovers an old runtime command',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 root.farmingPolicy=solo.farmingPolicy='hunt'; service(root).lifecycle.begin('auto',farm); service(solo).lifecycle.begin('auto',farm);
 const restored=initial({farmingProfiles:JSON.parse(JSON.stringify(root.farmingProfiles))});
 const next=createFarmingScopes(restored,()=>NOW+1000), r=next.view('R');
 assert.equal(restored.activeConvoy.phase,'communication-hold'); assert.equal(r.activeConvoy.phase,'communication-hold');
 assert.equal(r.activeConvoy.restartRecovery,true); assert.notEqual(r.activeConvoy.id,restored.activeConvoy.id);
 assert.deepEqual(restored.commands,{}); assert.deepEqual(r.monsterHunt.participants,['R']);
});
test('a late solo interaction acknowledgement cannot modify the group after Follow is enabled',()=>{
 const {createHuntControlRoutes}=require('../../runtime/coordinator/http/hunt-control.ts');
 const {root,scopes}=fixture(), solo=scopes.view('R');
 root.farmingPolicy=solo.farmingPolicy='hunt';
 service(root).lifecycle.begin('auto',farm);
 solo.monsterHunt={cycleId:'old-solo',participants:['R'],stage:'assigning',missions:[],currentIndex:-1,target:null};
 root.commands.R={id:41,type:'monster-hunt-interact',purpose:'monster-hunt',cycleId:'old-solo',action:'assign'};
 const cycle=root.monsterHunt;
 follow(root,scopes,'R',true);
 const routes=createHuntControlRoutes(root,{owned:()=>true,ownsTravel:priority,fresh:()=>true,cancelled:()=>false,cancelConvoy(){},start(){},persist(){}});
 const response={code:200,status(n){this.code=n;return this},json(v){this.body=v}};
 routes.interactionComplete({body:{character:'R',commandId:41,cycleId:'old-solo',success:false}},response);
 assert.equal(response.code,409); assert.equal(root.monsterHunt,cycle); assert.equal(root.monsterHunt.target,'rat');
});
test('a departing selected quest owner cannot leave the group pursuing that character’s quest',()=>{
 const {root,scopes}=fixture(); root.followers.R=true;
 root.monsterHunt={cycleId:'group',owner:'R',selectionLeader:'W',policyVersion:3,participants:['W','P','R'],stage:'returning',turnIn:{owner:'R',phase:'returning'},missions:[{target:'bee',owners:['R']}],currentIndex:0,target:'bee'};
 follow(root,scopes,'R',false);
 assert.deepEqual(root.monsterHunt.participants,['W','P']); assert.equal(root.monsterHunt.turnIn,undefined);
 assert.equal(root.monsterHunt.target,null); assert.equal(root.monsterHunt.stage,'checking-quests');
 assert.equal(selection(root.monsterHunt,'W',root.statuses,{}).owner,'W');
});
