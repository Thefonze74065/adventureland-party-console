const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const zones=require('../../.build/shared/farming-zones.cjs');
const shared=fs.readFileSync(process.env.AL_SHARED_SOURCE || 'characters/shared.js','utf8');
const coordinator=require('./helpers/coordinator-source.cjs').coordinatorSource();
function movement() {
 let now=10000,calls=0,stops=0,resolve;
 const target={id:'bee',x:0,y:200,map:'main'},character={name:'W',map:'main',x:0,y:0,speed:60};
 const c=vm.createContext({character,parent:{entities:{}},partyLocation:{id:'a',map:'main',x:0,y:200,shapes:[{boundary:[-50,150,50,250]}]},
  runtimeCurrent:()=>true,sharedRoutine:{isOccupied:()=>false},activeCombatEvent:()=>false,joinedEvent:null,anniversaryStaging:false,anniversaryBusy:false,
  groupedFarming:()=>false,requestGroupApproach:()=>false,
  navigationIntent:{revision:1},Date:{now:()=>now},is_in_range:()=>false,combatDistance:()=>200,lastAttackAt:0,
  partyConvoyActive:false,convoyTraveling:null,farmTravelPaused:false,can_walk:()=>true,can_move:()=>true,can_move_to:()=>false,safeCombatPoint:()=>true,formationBody:()=>({}),recoverFormationCorner:()=>false,
  inFarmArea:(target,area)=>zones.contains(area,target,0,400),partyFarmingZones:zones,combatApproachPoint:()=>({x:0,y:190}),smart:{},
  smart_move:p=>{calls++;c.smart.on_done=()=>{};return new Promise(r=>resolve=r);},stop:()=>{stops++;return Promise.resolve();}});c.root=c;
 vm.runInContext(shared.slice(shared.indexOf('  var farmApproach ='),shared.indexOf('  var formationState =')),c);
 return {c,target,calls:()=>calls,stops:()=>stops,now:v=>now=v,resolve:()=>resolve()};
}
test('blocked unengaged target starts only one route and times out with a target cooldown',()=>{
 const r=movement();assert.equal(r.c.recoverFarmApproach(r.target),false);r.now(11600);
 assert.equal(r.c.recoverFarmApproach(r.target),true);r.now(14600);r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),1);
 r.now(44601);r.c.recoverFarmApproach(r.target);assert.equal(r.stops(),1);assert.ok(r.c.farmApproach.failed.bee>44601);
});
test('aggro suppresses path search; a replacement navigation owner is never stopped',()=>{
 const r=movement();r.c.recoverFarmApproach(r.target);r.now(11600);
 r.c.parent.entities.a={type:'monster',visible:true,target:'W'};r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),0);
 delete r.c.parent.entities.a;r.c.recoverFarmApproach(r.target);r.now(14600);r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),1);
 r.c.smart.on_done=()=>{};r.c.recoverFarmApproach(r.target);assert.equal(r.stops(),0);assert.equal(r.c.farmApproach.route,null);
});
test('target loss cancels only owned recovery and allows new acquisition',()=>{
 const r=movement();r.c.recoverFarmApproach(r.target);r.now(11600);r.c.recoverFarmApproach(r.target);r.now(14600);r.c.recoverFarmApproach(r.target);
 r.c.recoverFarmApproach(null);assert.equal(r.stops(),1);assert.equal(r.c.farmApproach.route,null);
});

test('rare handoff stops empty-zone search while the combat group selects its target',()=>{
 const r=movement();r.c.recoverFarmApproach(r.target);r.now(11600);r.c.recoverFarmApproach(r.target);
 r.now(14600);r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),1);
 r.c.rareActive=()=>true;
 for(let i=0;i<20;i++){r.now(15000+i*500);assert.equal(r.c.recoverFarmApproach(null),true);}
 assert.equal(r.stops(),1);assert.equal(r.calls(),1);assert.equal(r.c.farmApproach.route,null);
 r.c.rareActive=()=>false;r.c.recoverFarmApproach(null);r.now(30000);r.c.recoverFarmApproach(null);
 assert.equal(r.calls(),2,'ordinary zone search resumes after rare ownership ends');
});

test('target outside priest spacing does not convoy when already attackable or still approaching',()=>{
 const r=movement();let requests=0;
 r.c.groupedFarming=()=>true;r.c.groupedCombat={anchor:{x:0,y:0},range:100};
 r.c.requestGroupApproach=()=>{requests++;return true;};
 r.c.character.range=210;r.c.is_in_range=()=>true;
 assert.equal(r.c.recoverFarmApproach(r.target),false);assert.equal(requests,0);
 r.c.is_in_range=()=>false;r.c.recoverFarmApproach(r.target);
 r.now(11000);r.c.recoverFarmApproach(r.target);assert.equal(requests,0);
 r.now(12600);r.c.recoverFarmApproach(r.target);r.now(15600);r.c.recoverFarmApproach(r.target);assert.equal(requests,0);assert.equal(r.calls(),1);
});
test('convoy setup waits through transport lock and handles a racing unable rejection',async()=>{
 let now=1000,stops=0;
 const c={parent:{transporting:true},character:{s:{}},convoy:{},ownsConvoy:()=>true,can_walk:()=>now>=1300,
  Date:{now:()=>now},phase(){},setTimeout(fn){now+=100;fn();},stop:async()=>{if(++stops===1)throw {reason:'unable'};}};
 vm.runInNewContext(shared.slice(shared.indexOf('    async function stopForConvoy()'),shared.indexOf('    function navigate(destination)',shared.indexOf('    async function stopForConvoy()'))),c);
 await c.stopForConvoy();assert.equal(stops,2);assert.equal(now,1400);
});
function controlFixture() {
 let now=10000;const starts=[];
 const catalog=[{id:'bee',locations:[{map:'main',x:50,y:50,boundary:[0,0,100,100]},{map:'main',x:350,y:50,boundary:[300,0,400,100]}]}];
 const areas=zones.zones(catalog,['bee']);
 const party={leader:'W',followers:{P:true},statuses:{W:{name:'W',seenAt:now},P:{name:'P',seenAt:now}},monsterChoices:catalog,
   monsterFocus:['bee'],location:areas[0],farmAreaState:{},commands:{},farmingPolicy:'auto'};
 const c={party,farmingAreas:require('../../.build/shared/farming-areas.cjs').farmingAreas,character_manage:{W:{},P:{},Merchant:{}},farmZones:zones,farmAreaControl:require('../farm-area-control.cjs'),
   huntTurnInOwnsTravel:require('../../runtime/hunt/policy.ts').priority,
   huntPolicy:require('../../runtime/hunt/policy.ts'),
   Date:{now:()=>now},farmingNavigation:{members:()=>['W','P'],intent:()=>({cancelled:false,revision:1}),authorize(){}},persistSettings(){},
   cancelActiveConvoy(){party.activeConvoy=null;},advanceHuntMission(h){h.advanced=true;},
   startPartyMonsterConvoy(location){starts.push(location);party.activeConvoy={phase:'assemble'};},
   startHuntConvoy(h,location){starts.push(location);party.activeConvoy={phase:'assemble'};}};
 require('./helpers/travel-observations.cjs').observeTravel(party.statuses);
 for(const [name,s] of Object.entries(party.statuses))Object.assign(s,{map:'main',in:'main',server:'USII',combatSelection:{runtimeId:name},farmCompetition:{at:now,runtimeId:name,revision:1,areaId:areas[0].id,map:'main',in:'main',server:'USII',radius:400,monsters:{},players:['Other']}});
 Object.assign(c,require('./helpers/coordinator-farm-areas.cjs').farmAreaService(c));
 return {c,party,areas,starts,advance(ms=1100){now+=ms;for(const s of Object.values(party.statuses)){s.seenAt=now;if(s.farmCompetition)s.farmCompetition.at=now;}},now:()=>now};
}
test('competition waits for fighting to finish, relocates once, and keeps normal focus',()=>{
 const t=controlFixture();t.party.statuses.W.farmAreaEvidence=[{key:'kill',actor:'Other',mtype:'bee',map:'main',x:50,y:50,at:t.now(),kill:true}];
 t.party.statuses.W.map='main';t.party.statuses.W.groupedCombat.currentAttackers=[{id:'bee',map:'main',target:'W',hp:100}];t.party.statuses.W.target={hp:100};t.party.statuses.W.combat={inRange:true};t.c.farmAreaTick();assert.ok(t.party.farmAreaState.pending);
 t.advance();t.c.farmAreaTick();assert.equal(t.starts.length,0);
 t.party.statuses.W.target=null;t.party.statuses.W.groupedCombat.currentAttackers=[];t.advance();t.c.farmAreaTick();assert.equal(t.starts[0].x,350);assert.deepEqual(t.party.monsterFocus,['bee']);
 t.party.activeConvoy=null;t.advance();t.c.farmAreaTick();assert.equal(t.starts.length,1);
});
test('failed outbound Hunt convoy retains mission recovery ownership without farming retries',()=>{
 const t=controlFixture();t.party.farmingPolicy='hunt';const h=t.party.monsterHunt={target:'bee',stage:'mission-travel',missions:[{target:'bee',destination:t.areas[0]}],currentIndex:0,deathCount:1};
 const convoy=t.party.activeConvoy={phase:'failed',purpose:'monster-hunt',location:t.areas[0],failure:'unable'};
 for(const delay of [1100,2100,30000]){t.advance(delay);t.c.farmAreaTick();assert.equal(t.party.activeConvoy,convoy);}
 assert.equal(t.starts.length,0);assert.equal(t.party.farmAreaState.pending,null);
 assert.deepEqual(t.party.farmAreaState.failures,{});assert.equal(h.missions[0].destination,t.areas[0]);
 assert.equal(h.deathCount,1);assert.equal(t.party.huntBlacklist,undefined);
});

test('repeated convoy ownership failures retry without declaring the zone unreachable',()=>{
 const t=controlFixture();
 for(let i=0;i<3;i++){
  t.party.activeConvoy={phase:'failed',location:t.areas[0],failure:'W: stale route owner'};
  t.advance();t.c.farmAreaTick();assert.notEqual(t.party.farmAreaState.paused,true);
  assert.equal(t.party.farmAreaState.failures[t.areas[0].id],undefined);
  t.advance(10100);t.c.farmAreaTick();assert.equal(t.starts.length,i+1);
 }
 assert.equal(t.party.farmAreaState.lastFailure.transient,true);
});
test('exhausted geometry repair holds farming without retrying or blacklisting its zone',()=>{
 const t=controlFixture(),convoy={phase:'failed',location:t.areas[0],failureCode:'geometry-mismatch',failure:'Geometry recovery failed after one reload'};
 t.party.activeConvoy=convoy;t.advance();t.c.farmAreaTick();
 assert.equal(t.party.activeConvoy,convoy);assert.equal(t.party.farmAreaState.paused,true);
 assert.equal(t.party.farmAreaState.pending,null);assert.equal(t.party.farmAreaState.failures[t.areas[0].id],undefined);
 t.advance(70000);t.c.farmAreaTick();assert.equal(t.starts.length,0);
});
test('obsolete recovery pause is cleared once, preserving future deliberate holds',()=>{
 const t=controlFixture();t.party.farmAreaState={paused:true,failures:{old:2}};t.c.farmAreaTick();
 assert.equal(t.party.farmAreaState.paused,false);assert.equal(t.party.farmAreaState.recoveryVersion,2);
 t.party.farmAreaState.paused=true;t.advance();t.c.farmAreaTick();assert.equal(t.party.farmAreaState.paused,true);
});

test('stale travel failure clears only after the party reaches its active farming zone',()=>{
 const t=controlFixture();t.c.farmAreaTick();
 const state=t.party.farmAreaState;
 state.lastFailure={at:1,reason:'W: stale route owner'};state.message='Travel failed: W: stale route owner';
 for(const s of Object.values(t.party.statuses))Object.assign(s,{map:'main',x:-1000,y:-1000});
 t.advance();t.c.farmAreaTick();assert.ok(state.lastFailure);
 for(const s of Object.values(t.party.statuses))Object.assign(s,{map:'main',x:50,y:50});
 t.advance();t.c.farmAreaTick();assert.equal(state.lastFailure,null);assert.equal(state.message,null);
});

test('farm zone retries cannot reroute a protected turn-in toward monsters',()=>{
 const t=controlFixture();t.party.farmingPolicy='hunt';
 t.party.monsterHunt={stage:'returning',target:'bee',turnIn:{phase:'returning',owner:'W'}};
 const convoy=t.party.activeConvoy={phase:'failed',purpose:'monster-hunt',location:{map:'main',x:126,y:-413},failure:'runtime lost'};
 t.c.farmAreaTick();assert.equal(t.party.activeConvoy,convoy);assert.equal(t.starts.length,0);
});
test('merchant never starts a farming search route',()=>{
 const r=movement();r.c.character.ctype='merchant';r.c.recoverFarmApproach(null);assert.equal(r.calls(),0);
});

test('empty farming areas wait without routing and a respawn is immediately eligible',()=>{
 const r=movement();r.c.partyLocation={map:'main',x:0,y:0};r.c.character.x=200;
 for(const time of [10000,12000,20000,60000]){r.now(time);assert.equal(r.c.recoverFarmApproach(null),false);}
 assert.equal(r.calls(),0);assert.equal(r.c.farmApproach.searchAt,0);
 r.c.is_in_range=()=>true;r.c.character.range=300;
 assert.equal(r.c.recoverFarmApproach(r.target),false);
 assert.equal(r.calls(),0);
 r.c.partyLocation={map:'main',x:0,y:0,shapes:[{boundary:[100,-50,300,50]}]};
 assert.equal(r.c.recoverFarmApproach(null),false);assert.equal(r.calls(),0);
});

test('arriving inside cancels only the owned empty-area search route',()=>{
 for(const replaced of [false,true]){
  const r=movement();r.c.recoverFarmApproach(null);r.now(13000);r.c.recoverFarmApproach(null);
  assert.equal(r.calls(),1);r.c.character.y=200;
  if(replaced)r.c.smart.on_done=()=>{};
  assert.equal(r.c.recoverFarmApproach(null),false);
  assert.equal(r.stops(),replaced?0:1);assert.equal(r.c.farmApproach.route,null);
 }
});
test('idle leader outside the selected zone routes into it instead of waiting for a visible target',()=>{
 const r=movement();r.c.character.ctype='warrior';r.c.recoverFarmApproach(null);assert.equal(r.calls(),0);r.now(13000);r.c.recoverFarmApproach(null);assert.equal(r.calls(),1);
 assert.equal(zones.contains(r.c.partyLocation,r.c.farmApproach.route.destination),true);
});
test('wild boar entry point is inside the zone and valid with game collision geometry',()=>{
 const {installGameGeometry}=require('./helpers/game-geometry.cjs');
 const r=vm.createContext({root:{partyFarmingZones:zones},character:{map:'winterland',x:20,y:30,base:{h:8,v:7,vn:2}},G:{}});
 assert.equal(installGameGeometry(r),true);
 vm.runInContext(shared.slice(shared.indexOf('  function farmingEntryPoint('),shared.indexOf('  function prepareConvoyRoute(')),r);
 const area={map:'winterland',x:20,y:-1109,shapes:[{boundary:[-173,-1488,212,-730]}]};
 const point=r.farmingEntryPoint(area);assert.equal(zones.contains(area,point),true);assert.ok(point.y < -730);
});

test('explicit farming route releases completed Escape before authorizing the convoy',()=>{
 const party={escape:{stage:'complete'},farmAreaState:{paused:true,message:'old failure',pending:{},failures:{old:2}}};
 let destination=null;
 const c={party,escapeControl:{release(){party.escape.stage='released';}},farmingNavigation:{authorize(names,point,shared){assert.equal(party.escape.stage,'released');assert.equal(shared,true);destination=point;}}};
 require('./helpers/coordinator-farming-authorization.cjs').installFarmingAuthorization(c);
 const zone={map:'winterland',x:20,y:-1109};c.authorizeFarmingRoute(['W'],zone,true);
 assert.equal(destination,zone);assert.equal(party.farmAreaState.paused,false);assert.equal(party.farmAreaState.message,null);
});

test('convoy announced before local command blocks independent zone searching',()=>{
 const r=movement();r.c.partyConvoyActive=true;
 assert.equal(r.c.recoverFarmApproach(null),true);assert.equal(r.calls(),0);
});
test('Escape release installs convoy ownership before its first asynchronous stop',async()=>{
 const r=movement();r.c.state={partyConvoyActive:true,escape:null};r.c.partyConvoyActive=false;
 r.c.applyEscape=async()=>{assert.equal(r.c.recoverFarmApproach(null),true);assert.equal(r.calls(),0);};
 const start=shared.indexOf('      // Install the new convoy barrier');
 const end=shared.indexOf('      await applyNavigationIntent',start);
 await vm.runInContext('(async()=>{'+shared.slice(start,end)+'})()',r.c);
});

test('superseded Town guard cannot stop a new convoy or cast Town after an awaited stop',async()=>{
 const calls=[];const c=vm.createContext({character:{ctype:'warrior',map:'winterland',x:0,y:0},partyTownActive:true,townTraveling:false,townOverrideInFlight:false,
  convoyTraveling:null,root:{__partyTownGeneration:1},runtimeCurrent:()=>true,escapeOwns:()=>false,
  stop:async type=>{calls.push(type);c.partyTownActive=false;c.root.__partyTownGeneration++;},use_skill:async name=>calls.push(name)});
 vm.runInContext(shared.slice(shared.indexOf('  async function enforcePartyTownOverride()'),shared.indexOf('  function maintainTownOverrideGuard()')),c);
 await c.enforcePartyTownOverride();assert.deepEqual(calls,['smart']);assert.equal(c.townOverrideInFlight,false);
});


test('clear local approach never calls smart routing or group convoy',()=>{
 const r=movement();let moves=0;
 r.c.can_move_to=()=>true;r.c.move=()=>{moves++;return Promise.resolve();};
 r.c.requestGroupApproach=()=>{throw Error('unexpected convoy');};
 r.c.recoverFarmApproach(r.target);r.now(13100);r.c.recoverFarmApproach(r.target);
 assert.equal(moves,1);assert.equal(r.calls(),0);
});


test('a blocked target moving slightly cannot reset the local detour deadline forever',()=>{
 const r=movement();let y=190;
 r.c.combatApproachPoint=()=>({x:0,y});
 r.c.recoverFarmApproach(r.target);r.now(11600);r.c.recoverFarmApproach(r.target);
 y=192;r.now(13000);r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),0);
 y=193;r.now(14600);r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),1);
});

test('competition cannot relocate while a scattered follower still sees the target type',()=>{
 const t=controlFixture();t.party.statuses.W.farmAreaEvidence=[{key:'kill',actor:'Other',mtype:'bee',map:'main',x:50,y:50,at:t.now(),kill:true}];
 t.party.statuses.P.farmCompetition.monsters.bee=1;t.c.farmAreaTick();assert.equal(t.starts.length,0);assert.equal(t.party.farmAreaState.pending,null);
 delete t.party.statuses.P.farmCompetition.monsters.bee;t.advance();t.c.farmAreaTick();assert.equal(t.starts.length,1);
});
test('a pending conflict is cancelled if monsters reappear before departure',()=>{
 const t=controlFixture();t.party.statuses.W.farmAreaEvidence=[{key:'kill',actor:'Other',mtype:'bee',map:'main',x:50,y:50,at:t.now(),kill:true}];
 t.party.statuses.W.map='main';t.party.statuses.W.groupedCombat.currentAttackers=[{id:'enemy',map:'main',target:'W',hp:100}];
 t.c.farmAreaTick();assert.ok(t.party.farmAreaState.pending);t.party.statuses.P.farmCompetition.monsters.bee=1;t.advance();t.c.farmAreaTick();assert.equal(t.party.farmAreaState.pending,null);assert.equal(t.starts.length,0);
});
