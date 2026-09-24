const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const settings=require('../../runtime/coordinator/navigation/passive-settings.ts');
const {reconcileQueue}=require('../../runtime/combat/queue.ts');
const {classifyTravelDefense}=require('../../runtime/coordinator/navigation/travel-defense.ts');
const {collectPassing}=require('../../runtime/combat/passing.ts');
const {namedFunction}=require('./helpers/named-function.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');

test('legacy selections migrate; independent edits preserve selections and keep moving defaults off',()=>{
 let s=settings.migratePassiveSettings(null,{tinyp:true,phoenix:false});
 assert.deepEqual(s.rules.tinyp,{enabled:true,keepMoving:false,priority:101});assert.equal(s.useFieldGenerators,true);
 s=settings.applyPassivePatch(s,{rules:{bee:{enabled:true}}});assert.deepEqual(s.rules.bee,{enabled:true,keepMoving:false,priority:100});
 s=settings.applyPassivePatch(s,{rules:{bee:{keepMoving:true,priority:99}},useFieldGenerators:false});
 assert.equal(s.rules.tinyp.enabled,true);assert.equal(s.rules.bee.enabled,true);assert.equal(s.useFieldGenerators,false);
 assert.equal(settings.committedPassiveRules(s).bee,false);assert.equal(settings.committedPassiveRules(s).tinyp,true);
 assert.deepEqual(settings.migratePassiveSettings(s,{phoenix:true}),s);
 for(const bad of [{rules:{bee:{priority:-1}}},{rules:{bee:{priority:1001}}},{rules:{bee:{priority:1.1}}},{rules:{bee:{enabled:'yes'}}},{rules:{fieldgen0:{enabled:true}}},{rules:{bee:{unknown:true}}}])assert.equal(settings.validPassivePatch(bad),false);
});

function fixture(){
 const bee={id:'bee1',mtype:'bee',type:'monster',visible:true,hp:100,x:20,y:0,map:'main',in:'main'};
 const c=vm.createContext({Date,Math,Object,String,Number,Promise,passingEncounters:{},peerPassingEncounters:[],passiveGeneratorAttempt:null,
  character:{name:'W',ctype:'warrior',map:'main',in:'main',x:0,y:0,items:[]},parent:{entities:{bee}},root:{},groupedCombat:null,
  passiveHunting:{rules:{bee:{enabled:true,keepMoving:true,priority:100}},useFieldGenerators:false},monsterPriorities:{},passiveRareHunts:{},
  fightDeaths:[],currentTravelAttackers:()=>[],navigationIntent:{},coordinatorClockOffset:0,partyTownActive:false,banking:false,stocking:false,upgrading:false,gatheringActive:false,
  forceTraveling:false,townTraveling:false,eventTraveling:false,joinedEvent:false,partyThreats:[],partyPositions:[],
  escapeOwns:()=>false,combatRecoveryActive:()=>false,activeCombatEvent:()=>false,rareActive:()=>false,unfinishedFight:()=>false,
  reunionRealm:()=> 'USII',get_entity:id=>Object.values(c.parent.entities).find(e=>e.id===id),is_in_range:e=>Math.hypot(e.x,e.y)<=100,
  isExternallyClaimedMonster:e=>!!e.claimed,currentPartyList:()=>['W'],sameEventTeamMember:()=>true,equip:()=>{throw Error('unexpected deployment');},rareFields:()=>[]});
 const names=['passiveStopRequired','passiveTravelInterruptible','travelStopCandidates','outboundHuntTravel','huntTravelDefense','huntTravelControl','huntTravelExtraAggro','returnDepartureDefense','committedHuntEncounter','passingKey','passingEncounterReport','isPassingEncounter','passingTravelAllowed','passingTarget','beginPassingAttack','groupedEntityReport','monsterPriority','passiveRareCandidate','isPartyThreat','isAttackingPartyMember','rareAttackAllowed'];
 vm.runInContext(names.map(n=>namedFunction(source,n)).join('\n'),c);
 return {c,bee};
}
test('passing chooses priority only in range, without any movement dependency, including stationary attacks',()=>{
 const {c,bee}=fixture();assert.equal(c.passingTarget().id,bee.id);
 c.parent.entities.phoenix={...bee,id:'phoenix1',mtype:'phoenix',x:30};c.passiveHunting.rules.phoenix={enabled:true,keepMoving:true,priority:101};
 assert.equal(c.passingTarget().id,'phoenix1');c.parent.entities.phoenix.x=200;assert.equal(c.passingTarget().id,bee.id);
 bee.claimed=true;assert.equal(c.passingTarget(),null);bee.claimed=false;bee.x=101;assert.equal(c.passingTarget(),null);
 bee.x=20;c.escapeOwns=()=>true;assert.equal(c.passingTarget(),null);c.escapeOwns=()=>false;c.combatRecoveryActive=()=>true;assert.equal(c.passingTarget(),null);
});
test('retaliation stays movement-neutral for the attacked identity, not other monsters of that type',()=>{
 const {c,bee}=fixture();c.beginPassingAttack(bee);bee.target='W';
 assert.equal(c.isPassingEncounter(bee),true);assert.equal(c.isAttackingPartyMember(bee),false);
 assert.equal(c.isAttackingPartyMember({...bee,id:'unrelated'}),true);
 const report=c.passingEncounterReport();assert.equal(report.length,1);
 c.character.in='another';assert.equal(c.isPassingEncounter({...bee,in:'another'}),false);
 c.character.map='cave';c.character.in='cave';assert.equal(c.passingEncounterReport().length,0);
});

test('verified Hunt farming releases local and peer passing ownership without changing outbound travel',()=>{
 const {c,bee}=fixture();c.beginPassingAttack(bee);
 c.peerPassingEncounters=[...c.passingEncounterReport()];
 c.groupedCombat={passingEncounters:[...c.peerPassingEncounters]};
 assert.equal(c.isPassingEncounter(bee),true);
 c.huntCombatTarget='bee';c.partyConvoyActive=true;
 assert.equal(c.isPassingEncounter(bee),true);
 assert.equal(c.passingEncounterReport().length,1);
 c.partyConvoyActive=false;
 assert.equal(c.isPassingEncounter(bee),false);
 assert.equal(c.passingEncounterReport().length,0);
 assert.equal(c.passingTarget(),null,'Hunt farming must use normal combat even with keep-moving enabled');
 const unrelated={...bee,id:'other',mtype:'goo'};c.beginPassingAttack(unrelated);
 assert.equal(c.isPassingEncounter(unrelated),true);
});

test('farming Hunt queue accepts a target with cached and freshly reported travel passing marks',()=>{
 const {target,status,members}=reports();
 const travelling=reconcileQueue(null,members,'W',1000,'k');
 assert.equal(travelling.target,null);
 const farming=reconcileQueue(travelling,members,'W',1000,'k',0,false,'bee');
 assert.equal(farming.passingEncounters.length,0);
 assert.equal(farming.target.id,target.id);
});

test('passing attacks yield to Town from reservation through settled transition',()=>{
 const {c,bee}=fixture();assert.equal(c.passingTarget(),bee);
 c.character.c={town:{}};assert.equal(c.passingTarget(),null);
 c.character.c={};c.movement={transition:()=> 'town'};assert.equal(c.passingTarget(),null);
 c.movement.transition=()=>null;assert.equal(c.passingTarget(),bee);
});

test('ordinary protocol 4 passing attacks require the current travelling signal',()=>{
 const {c,bee}=fixture();c.convoyRuntimeId='r';c.navigationIntent.revision=3;
 c.convoyTraveling={id:'C',epoch:1,commandId:8,navigationRevision:3,routeProtocol:4,purpose:'anniversary-return',phase:'travelling'};
 c.convoySignal={id:'C',epoch:1,commandId:8,runtimeId:'r',phase:'travel',validUntil:Date.now()+10000};
 assert.equal(c.passingTarget(),bee);
 for(const phase of ['assemble','preparing','scheduled','defending','arrived']) {
  c.convoyTraveling.phase=phase;assert.equal(c.passingTarget(),null,phase);
 }
 c.convoyTraveling.phase='travelling';c.convoySignal.epoch=0;assert.equal(c.passingTarget(),null);
 c.convoySignal.epoch=1;c.convoySignal.validUntil=0;assert.equal(c.passingTarget(),null);
});

test('an unreserved monster attacking first stays a genuine defensive target',()=>{
 const {c,bee}=fixture();bee.target='W';
 assert.equal(c.passingTarget(),null);assert.equal(c.isAttackingPartyMember(bee),true);
});

test('Phoenix patrol permits in-range passing attacks but encounters and recovery still take precedence',()=>{
 const {c,bee}=fixture();
 c.rareControlState={kind:'patrol',revision:1};c.rareControlAt=Date.now();c.navigationIntent.revision=1;
 vm.runInContext(['rareControlCurrent','rareActive'].map(n=>namedFunction(source,n)).join('\n'),c);
 for(const mtype of ['bee','armadillo']) {
  bee.mtype=mtype;c.passiveHunting.rules[mtype]={enabled:true,keepMoving:true,priority:100};
  assert.equal(c.rareActive(),true);assert.equal(c.passingTarget(),bee);
  bee.x=101;assert.equal(c.passingTarget(),null);bee.x=20;
 }
 c.rareControlState.kind='encounter';assert.equal(c.passingTarget(),null);
 c.rareControlState.kind='patrol';c.combatRecoveryActive=()=>true;assert.equal(c.passingTarget(),null);
 c.combatRecoveryActive=()=>false;c.escapeOwns=()=>true;assert.equal(c.passingTarget(),null);
 c.escapeOwns=()=>false;c.unfinishedFight=()=>true;assert.equal(c.passingTarget(),null);
});
test('field-generator preference governs passing Fairy use without moving',()=>{
 const {c,bee}=fixture();bee.mtype='tinyp';c.passiveHunting.rules.tinyp={enabled:true,keepMoving:true,priority:101};c.character.items=[{name:'fieldgen0'}];let equips=0;c.equip=()=>{equips++;};
 c.beginPassingAttack(bee);assert.equal(equips,0);assert.equal(c.rareAttackAllowed(bee,'attack'),true);
 c.passiveHunting.useFieldGenerators=true;c.beginPassingAttack(bee);c.beginPassingAttack(bee);assert.equal(equips,1);
});
function reports(){
 const target={id:'A',mtype:'bee',map:'main',in:'main',server:'USII',x:20,y:0,hp:100,target:'W'};
 const status={seenAt:1000,hp:100,map:'main',in:'main',server:'USII',x:0,y:0,groupedCombat:{currentAttackersAt:1000,currentAttackers:[target],passingEncounters:[{...target,at:1000}],candidates:[target],threats:[target],evidence:[{...target,at:1000,action:'a',state:'engaged'}]}};
 return {target,status,members:[{name:'W',ctype:'warrior',revision:0,status}]};
}
test('queue and travel defense reject passing ownership from nominations, hits and retaliation',()=>{
 const {target,status,members}=reports();const q=reconcileQueue(null,members,'W',1000,'k');assert.equal(q.target,null);assert.equal(q.fights.length,0);assert.equal(q.passingEncounters.length,1);
 const party={statuses:{W:status},groupedCombat:q};assert.equal(classifyTravelDefense(party,['W'],1000).state,'clear');
 status.groupedCombat.currentAttackers.push({...target,id:'B'});status.groupedCombat.threats.push({...target,id:'B'});
 assert.equal(classifyTravelDefense(party,['W'],1000).state,'defending');assert.equal(reconcileQueue(null,members,'W',1000,'k').target.id,'B');
 status.groupedCombat.passingEncounters[0].in='other';assert.equal(collectPassing(members,[],1000).length,0);
 status.groupedCombat.passingEncounters[0].in='main';assert.equal(collectPassing(members,[],100000).length,0);
});

test('actual attack controller sends passing attacks without queue evidence or normal combat side effects',async()=>{
 const {createAttackController}=require('../../runtime/characters/roles/attack-controller.ts');
 const keys=['parent','character','sharedRoutine','attack','can_attack','is_in_range','get_entity','setTimeout','clearTimeout'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]]));
 let passing=true,admitted=false,hits=0;const target={id:'bee1',mtype:'bee'},state={};
 try {
  global.parent={};global.character={range:100,frequency:1};global.setTimeout=()=>0;global.clearTimeout=()=>{};
  global.sharedRoutine={groupedAttackAllowed:()=>false,rareAttackAllowed:()=>true,
   queueEvidence:()=>assert.fail('passing hit acquired queue ownership'),noteAttack:()=>assert.fail('passing hit acquired normal combat ownership')};
  global.attack=async()=>{hits++;};global.can_attack=()=>true;global.is_in_range=()=>true;
  const controller=createAttackController({target:()=>target,selected:()=>target.id,epoch:()=>1,active:()=>true,allowed:()=>true,state:()=>state,
   passing:()=>passing,preparePassing:()=>admitted,report:error=>assert.fail(String(error))});
  controller.tick();await Promise.resolve();assert.equal(hits,0);assert.match(state.skippedAttack,/acknowledgement/);
  admitted=true;controller.tick();await Promise.resolve();await Promise.resolve();assert.equal(hits,1);assert.equal(state.attackTiming.accepted,1);
  global.is_in_range=()=>false;controller.reset();controller.tick();assert.equal(hits,1);controller.stop();
 } finally {for(const key of keys)if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}
});

test('passing retaliation cannot cancel a return convoy; unrelated attackers still defend',async()=>{
 const {c,bee}=fixture();c.beginPassingAttack(bee);bee.target='W';
 let stops=0,evidence=0;c.stop=async()=>{stops++;};c.releaseConvoyCruise=()=>{};c.eventTargetTypes=[];
 c.root.partyQueueClient={evidence(){evidence++;}};
 c.convoyTraveling={id:'return',epoch:1,phase:'travelling',purpose:'monster-hunt',nonPreemptible:true};
 vm.runInContext(['returnDepartureDefense','defendPartyHit','interruptConvoyForDefense'].map(n=>namedFunction(source,n)).join('\n'),c);
 const convoy=c.convoyTraveling;c.defendPartyHit({id:'W',hid:bee.id});
 assert.equal(c.convoyTraveling,convoy);assert.equal(convoy.cancelled,undefined);assert.equal(stops,0);assert.equal(evidence,0);
 c.parent.entities.other={...bee,id:'other'};c.defendPartyHit({id:'W',hid:'other'});
 assert.equal(c.convoyTraveling,convoy);assert.equal(convoy.defensePaused,true);assert.equal(convoy.phase,'defending');assert.equal(stops,1);assert.equal(evidence,1);
});

test('Hunt return passing attacks wait for an owned travelling route and yield to every transition',()=>{
 const {c,bee}=fixture();c.root.partyLootClient={huntPending:()=>true};
 assert.equal(c.passingTarget(),null);
 c.convoyRuntimeId='runtime';c.navigationIntent.revision=3;
 c.convoyTraveling={id:'return',epoch:2,commandId:4,navigationRevision:3,purpose:'monster-hunt',nonPreemptible:true,phase:'travelling'};
 c.convoySignal={id:'return',epoch:2,commandId:4,runtimeId:'runtime',phase:'travel',validUntil:Date.now()+10000};
 assert.equal(c.passingTarget(),bee);
 for(const phase of ['assembling','assembled','preparing-route','route-ready','waiting-for-departure','held','failed','arrived']) {
  c.convoyTraveling.phase=phase;assert.equal(c.passingTarget(),null,phase);
 }
 c.convoyTraveling.phase='travelling';c.movement={transition:()=> 'transport'};assert.equal(c.passingTarget(),null);
 c.movement.transition=()=>null;c.convoySignal.epoch=1;assert.equal(c.passingTarget(),null);
 c.convoySignal.epoch=2;c.navigationIntent.revision=4;assert.equal(c.passingTarget(),null);
 c.navigationIntent.revision=3;c.convoySignal.validUntil=0;assert.equal(c.passingTarget(),null);
 c.convoyTraveling=null;assert.equal(c.passingTarget(),null,'Daisy claims have no travelling route');
});

test('Hunt return attacks nearby aggressors while walking without requiring a passive hunting rule',()=>{
 const {c,bee}=fixture();c.passiveHunting.rules={};bee.target='W';
 c.convoyRuntimeId='runtime';c.navigationIntent.revision=3;
 c.convoyTraveling={id:'return',epoch:2,commandId:4,navigationRevision:3,purpose:'monster-hunt',nonPreemptible:true,continuousReturn:1,returnWalking:true,phase:'travelling'};
 c.convoySignal={id:'return',epoch:2,commandId:4,runtimeId:'runtime',phase:'travel',validUntil:Date.now()+10000};
 c.unfinishedFight=()=>true;c.groupedCombat={target:bee};
 assert.equal(c.passingTarget(),bee);
 bee.x=200;assert.equal(c.passingTarget(),null,'never chases an attacker');bee.x=20;
 bee.target='outsider';assert.equal(c.passingTarget(),null);bee.target='W';
 c.movement={transition:()=> 'town'};assert.equal(c.passingTarget(),null,'never interrupts Town');
 c.movement.transition=()=>null;c.navigationIntent.cancelled=true;assert.equal(c.passingTarget(),null);
});

test('a pending passing attack burst cannot send again after the return starts preparing',async()=>{
 const {createAttackController}=require('../../runtime/characters/roles/attack-controller.ts');
 const keys=['parent','character','sharedRoutine','attack','can_attack','is_in_range','get_entity','setTimeout','clearTimeout'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]]));let passing=true,hits=0;const timers=[],target={id:'armadillo',mtype:'armadillo'},state={};
 try {
  global.parent={};global.character={range:100,frequency:1};global.setTimeout=fn=>{timers.push(fn);return timers.length;};global.clearTimeout=()=>{};
  global.sharedRoutine={groupedAttackAllowed:()=>true,rareAttackAllowed:()=>true};
  global.attack=()=>{hits++;return new Promise(()=>{});};global.can_attack=()=>true;global.is_in_range=()=>true;
  const controller=createAttackController({target:()=>target,selected:()=>target.id,epoch:()=>1,active:()=>true,allowed:()=>true,state:()=>state,passing:()=>passing,report:assert.fail});
  controller.tick();assert.equal(hits,1);passing=false;
  for(const timer of timers.slice())timer();assert.equal(hits,1);controller.stop();
 } finally {for(const key of keys)if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}
});

test('outbound Hunt attacks its in-range target without passive settings and never during route preparation',()=>{
 const {c,bee}=fixture();c.passiveHunting.rules={};c.convoyRuntimeId='runtime';c.navigationIntent.revision=3;
 c.convoyTraveling={id:'hunt',epoch:2,commandId:4,navigationRevision:3,purpose:'monster-hunt',huntTarget:'bee',phase:'travelling'};
 c.root.__partyHuntTravel={id:'hunt',epoch:2,primary:null,defending:false};c.root.__partyHuntTravelAt=Date.now();
 c.convoySignal={id:'hunt',epoch:2,commandId:4,runtimeId:'runtime',phase:'travel',validUntil:Date.now()+10000};
 c.unfinishedFight=()=>true;c.groupedCombat={target:bee};
 assert.equal(c.passingTarget(),bee);
 bee.x=200;assert.equal(c.passingTarget(),null);bee.x=20;
 bee.mtype='goo';assert.equal(c.passingTarget(),null);bee.mtype='bee';
 bee.claimed=true;assert.equal(c.passingTarget(),null);bee.claimed=false;
 for(const phase of ['assembling','route-ready','waiting-for-departure','arrived','failed']){
  c.convoyTraveling.phase=phase;assert.equal(c.passingTarget(),null,phase);
 }
 c.convoyTraveling.phase='travelling';c.movement={transition:()=> 'transport'};assert.equal(c.passingTarget(),null);
 c.movement.transition=()=>null;c.convoySignal.epoch++;assert.equal(c.passingTarget(),null);
});

test('outbound Phoenix stop setting excludes passing attacks and reports eligible neutral sightings',()=>{
 const {c,bee}=fixture();bee.mtype='phoenix';c.root.partyPassiveStopRequired=require('../../runtime/combat/passive-travel.ts').passiveStopRequired;
 c.passiveHunting.rules={phoenix:{enabled:true,keepMoving:false,priority:100}};
 c.convoyRuntimeId='runtime';c.navigationIntent.revision=3;
 c.convoyTraveling={id:'hunt',epoch:2,commandId:4,navigationRevision:3,purpose:'monster-hunt',huntTarget:'phoenix',phase:'travelling'};
 c.convoySignal={id:'hunt',epoch:2,commandId:4,runtimeId:'runtime',phase:'travel',validUntil:Date.now()+10000};
 c.root.__partyHuntTravel={id:'hunt',epoch:2,primary:null};c.root.__partyHuntTravelAt=Date.now();
 assert.equal(c.passingTarget(),null);assert.equal(c.travelStopCandidates()[0].id,bee.id);
 c.beginPassingAttack(bee);assert.equal(c.isPassingEncounter(bee),false);
 bee.target='W';c.currentTravelAttackers=()=>[bee];assert.equal(c.huntTravelExtraAggro(),true);
 bee.target='outsider';assert.equal(c.travelStopCandidates().length,0);
});
