const test=require('node:test'),assert=require('node:assert/strict');
const {createHuntRetreatRestart}=require('../../runtime/coordinator/hunt/retreat-restart.ts');
const {createCoordinatorHunt}=require('../../runtime/coordinator/hunt/composition.ts');
const {createCoordinatorRecoveryHooks}=require('../../runtime/coordinator/navigation/recovery-hooks.ts');
const createDisengagement=require('../combat-disengagement.cjs');
const {priority}=require('../../runtime/hunt/policy.ts');

function fixture(saved) {
  const names=['W','M','P'],now=100000,backup={map:'winterland',x:10,y:20},calls=[];
  const state=saved||{leader:'W',followers:{M:true,P:true},farmingPolicy:'hunt',monsterFocus:['wolfie'],
    nextCommandId:40,statuses:{},commands:{},combatLogs:{},activeConvoy:null,eventReturn:null,
    monsterHunterLocation:{map:'main',x:126,y:-413},monsterSearchRadiusByCharacter:{},
    huntBlacklist:{mole:{monsterId:'mole',at:1}},huntFailures:{mole:{deaths:3}},huntSettings:{deathThreshold:3},
    escape:{id:'escape-1',stage:'recovering',participants:names},
    combatRecovery:{id:'death-1',phase:'recovering',names,leader:'W',policy:'hunt',focus:'["wolfie"]',revisions:{W:1,M:1,P:1}},
    monsterHunt:{cycleId:'old',stage:'blacklist-retreat',participants:names,owner:'W',target:'mole',
      missions:[{target:'mole',owners:['W'],skipped:true}],currentIndex:0,returnPolicy:'auto',returnLocation:backup}};
  if(!saved)for(const [i,n]of names.entries())state.statuses[n]={seenAt:now,server:'II',ctype:['warrior','mage','priest'][i],hp:100,max_hp:100,
    map:i?'main':'tunnel',in:i?'main':'tunnel',x:i?0:-120,y:i?0:-850,convoyProtocol:4,
    monsterHunt:{id:i?'rat':'mole',count:46,remainingMs:900000},
    escape:{id:'escape-1',recoveryFailed:!i,error:!i?'Exit to Main stalled or exhausted; request Escape again':null}};
  require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
  const intents=Object.fromEntries(names.map(n=>[n,{revision:1,cancelled:false}]));
  const ports={now:()=>now,participants:()=>names,intent:n=>intents[n],persist(){},
    releaseEscape(){state.escape.stage='released';calls.push('release');}};
  const service=createCoordinatorHunt(state,{
    ...ports,fighting:()=>false,rareEncounter:()=>false,cancelHuntConvoy(){state.activeConvoy=null;},cancelConvoy(){state.activeConvoy=null;},
    clear(){state.activeConvoy=null;state.monsterHunt=null;},selectedDestination:()=>({location:backup}),
    monsterDestination:()=>({map:'main',x:200,y:200}),missionDestination:()=>({map:'main',x:200,y:200}),
    start(location,label,members,purpose){calls.push(['travel',purpose]);state.activeConvoy={id:'new-route',phase:'assemble'};return true;},
    navigation:{authorize(){},intent:ports.intent},ownsTravel:priority,recordDeaths:()=>[],contains:()=>true,
    arrivalProtected:()=>false,partyFighting:()=>false,
  });
  const restart=createHuntRetreatRestart(state,{...ports,begin:service.lifecycle.begin});
  const hooks=createCoordinatorRecoveryHooks(state,{...ports,huntParticipants:ports.participants,members:ports.participants,
    cancelConvoy(){},convoy(){},prepareHunt:service.quests.prepare,escape(){},abandonRare(){},resumeHunt(){},restartFailedHunt:restart});
  const controller=createDisengagement(state,{...hooks.disengagement,now:ports.now});
  return {state,intents,calls,restart,controller,service};
}

test('terminal tunnel retreat restarts through death recovery and selects a nonblacklisted Hunt once',()=>{
  const f=fixture(),blacklist=f.state.huntBlacklist,settings=f.state.huntSettings,failures=f.state.huntFailures;
  f.controller.tick();
  assert.equal(f.state.combatRecovery.phase,'cancelled');assert.equal(f.state.combatRecovery.restartedEscapeId,'escape-1');
  assert.equal(f.state.escape.stage,'released');assert.notEqual(f.state.monsterHunt.cycleId,'old');
  assert.equal(f.state.monsterHunt.target,'rat');assert.equal(f.state.monsterHunt.stage,'mission-travel');
  assert.equal(f.state.huntBlacklist,blacklist);assert.equal(f.state.huntSettings,settings);assert.equal(f.state.huntFailures,failures);
  assert.deepEqual(f.state.monsterHunt.returnLocation,{map:'winterland',x:10,y:20});
  assert.deepEqual(f.calls,['release',['travel','monster-hunt']]);
  assert.match(f.state.combatLogs.W[0].message,/restarting hunting routine due to failure: W at tunnel \(-120, -850\)/);
  assert.equal(f.state.combatLogs.W[0].details.oldCycleId,'old');
  assert.equal(f.state.combatLogs.W[0].details.newCycleId,f.state.monsterHunt.cycleId);
  const cycle=f.state.monsterHunt.cycleId;
  for(let i=0;i<3;i++)assert.equal(f.restart(),false);
  const reloaded=fixture(JSON.parse(JSON.stringify(f.state)));assert.equal(reloaded.restart(),false);
  assert.equal(reloaded.state.monsterHunt.cycleId,cycle);assert.equal(reloaded.state.combatLogs.W.length,1);
});

for(const [name,change]of Object.entries({
  stale:f=>f.state.statuses.W.seenAt=1,
  future:f=>f.state.statuses.W.seenAt=101000,
  mismatched:f=>f.state.statuses.W.escape.id='previous-escape',
  ordinaryWait:f=>delete f.state.statuses.W.escape.recoveryFailed,
  deadReporter:f=>f.state.statuses.W.rip=true,
  manualCancel:f=>f.intents.M.cancelled=true,
  newerNavigation:f=>f.intents.M.revision++,
  newerCommand:f=>f.state.commands.M={type:'character-travel'},
  event:f=>f.state.statuses.P.activeEvent='franky',
  eventReturn:f=>f.state.eventReturn={id:'return'},
  convoy:f=>f.state.activeConvoy={id:'newer'},
  policy:f=>f.state.farmingPolicy='auto',
  nonHuntRecovery:f=>f.state.combatRecovery.policy='auto',
  exit:f=>f.state.monsterHunt.exitMode='auto',
  handled:f=>f.state.combatRecovery.restartedEscapeId='escape-1',
}))test('terminal Hunt restart respects '+name,()=>{
  const f=fixture();change(f);assert.equal(f.restart(),false);assert.equal(f.state.monsterHunt.cycleId,'old');assert.deepEqual(f.calls,[]);
});

test('fresh cycle retains pending loot and waits for a dead member without another reset',()=>{
  const f=fixture(),loot={id:'loot',complete:false};f.state.monsterHunt.loot=loot;f.state.statuses.M.rip=true;
  assert.equal(f.restart(),true);assert.equal(f.state.monsterHunt.loot,loot);assert.equal(f.state.monsterHunt.stage,'checking-quests');
  assert.equal(f.state.monsterHunt.target,null);assert.equal(f.restart(),false);assert.deepEqual(f.calls,['release']);
});
