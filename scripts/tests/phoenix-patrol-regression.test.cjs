const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRareHunting,regions}=require('../../runtime/coordinator/navigation/rare-hunting.ts');
const {createCoordinatorPartyConvoys}=require('../../runtime/coordinator/navigation/convoy-composition.ts');
const zones=require('../../dashboard/lib/farming-zones.ts');
const {defaultPhoenixOrder,farmingAreas}=require('../../dashboard/lib/farming-areas.ts');
const {createRareRouteDistance}=require('../../runtime/coordinator/navigation/rare-route-distance.ts');
const boxes=[['main',708,-300,1668,-86],['main',378,1686,904,1920],['main',-1358,-118,-1010,1680],['halloween',-166,453,182,808],['cave',-375,-1287,14,-1041]];
const catalog=[{id:'phoenix',locations:boxes.map(([map,...boundary])=>({map,boundary,x:(boundary[0]+boundary[2])/2,y:(boundary[1]+boundary[3])/2}))}];
function fixture(extra={}) {
  let time=100000, sequence=0;
  const party={leader:'W',followers:{M:true,P:true},monsterFocus:['phoenix'],monsterChoices:catalog,monsterPrioritiesByCharacter:{},
    isPassingEncounter:()=>false,passiveHunting:{rules:{}},passiveRareHunts:{},farmingPolicy:'auto',commands:{},statuses:{},location:{map:'main',x:641,y:1803},nextCommandId:0,navigationEpoch:0};
  for(const name of ['W','M','P'])party.statuses[name]={name,ctype:name==='W'?'warrior':name==='M'?'mage':'priest',server:'USII',map:'main',in:'main',x:430.6,y:1709.4,hp:1000,seenAt:time,rareSightings:[]};
  for(const s of Object.values(party.statuses)) {
    s.combatSelection={runtimeId:s.name};
    Object.defineProperty(s,'rareObservation',{configurable:true,get(){return {at:s.seenAt,runtimeId:s.name,map:s.map,in:s.in,server:s.server,x:s.x,y:s.y,sightings:s.rareSightings};}});
  }
  const hooks={now:()=>time,members:()=>['W','M','P'],intent:()=>({revision:1}),turnIn:()=>false,persist(){},
    cancelConvoy(){party.activeConvoy=null;party.commands={};},
    convoy(location,label,names,purpose){party.activeConvoy={id:'c'+(++sequence),location,label,purpose,phase:'travel'};return true;},...extra};
  let controller=createRareHunting(party,hooks);
  const order=defaultPhoenixOrder(regions(catalog));
  controller.start(order);
  function move(d){for(const s of Object.values(party.statuses))Object.assign(s,d,{in:d.map,seenAt:time});}
  function advance(ms){time+=ms;for(const s of Object.values(party.statuses))s.seenAt=time;}
  function kill(d={map:'main',x:641,y:1803},assist=false) {
    move(d);controller.tick();
    const lead=party.statuses.W;
    lead.rareSightings=[{id:'p1',mtype:'phoenix',x:d.x,y:d.y,hp:100,visible:true,partyEngaged:true,target:assist?'Stranger':'W'}];
    controller.report('W',lead);controller.tick();
    advance(1);lead.rareKills=[{id:'p1',mtype:'phoenix',...d,in:d.map,at:time,partyEngaged:true}];
    controller.report('W',lead);controller.tick();lead.rareSightings=[];
    return time;
  }
  function loot(){advance(1001);party.statuses.W.rareLoot={id:controller.control('W').id,observedAt:time,realm:':USII',map:party.statuses.W.map,in:party.statuses.W.in,complete:true};controller.tick();}
  return {party,hooks,order,move,advance,kill,loot,time:()=>time,controller:()=>controller,starts:()=>sequence,
    restart(){controller=createRareHunting(party,hooks);controller.tick();return controller;}};
}
test('default order matches screenshot, independent of catalog order',()=>{
  assert.deepEqual(defaultPhoenixOrder(farmingAreas(catalog,['phoenix'])),defaultPhoenixOrder(regions(catalog)));
  const ordered=defaultPhoenixOrder(regions(catalog)).map(id=>regions(catalog).find(a=>a.id===id));
  assert.deepEqual(ordered.map(a=>[a.map,Math.round(a.x),Math.round(a.y)]),[['main',641,1803],['cave',-180,-1164],['main',-1184,781],['main',1188,-193],['halloween',8,631]]);
});
test('logged waypoint never becomes the nearby farming entry point in real convoy composition',()=>{
  const r=fixture(),d={map:'main',x:378,y:1886};
  const c=createCoordinatorPartyConvoys(r.party,{now:r.time,activeNames:()=>['W','M','P'],intent:()=>({revision:1}),persist(){},resolveArea:(catalog,ids,location)=>zones.resolve(catalog,ids,location)});
  c.start(d,'Phoenix scan',['W','M','P'],'phoenix-patrol');
  assert.deepEqual(r.party.activeConvoy.location,d);
  assert.equal(r.party.activeConvoy.location.shapes,undefined);
  assert.equal(zones.contains(r.party.activeConvoy.location,r.party.statuses.W,0,100),false);
  c.cancel();r.party.commands={};
  // Ordinary farming intentionally still resolves a spawn area.
  c.start(d,'Farm',['W','M','P'],'manual-monster-override');
  assert.ok(r.party.activeConvoy.location.shapes);
});
test('planner distance excludes incomplete routes and includes transition cost',async()=>{
  const from={map:'main',x:0,y:0},to={map:'cave',x:30,y:40};
  const measure=createRareRouteDistance(async()=>({plot:[{map:'main',x:0,y:100},{map:'cave',x:0,y:0},to]}),()=>({version:1,fingerprint:'g'}));
  assert.equal(await measure(from,to),550);
  const bad=createRareRouteDistance(async()=>({plot:[]}),()=>({version:1,fingerprint:'g'}));
  await assert.rejects(bad(from,to),/Incomplete/);
});
test('stale kill reports cannot extend a wait, and disappearance cannot create one',()=>{
  const r=fixture(),at=r.kill();r.loot();const saved=r.party.phoenixPatrolCheckpoint.readyAt;
  r.advance(2000);r.controller().report('W',r.party.statuses.W);r.controller().tick();
  assert.equal(r.party.phoenixPatrolCheckpoint.readyAt,saved);assert.equal(saved,at+35000);
  const q=fixture();q.controller().tick();q.party.statuses.W.rareSightings=[{id:'gone',mtype:'phoenix',x:400,y:1800,hp:100,visible:true,target:'Stranger'}];
  q.controller().report('W',q.party.statuses.W);q.controller().tick();q.party.statuses.W.rareSightings=[];q.advance(3100);q.controller().tick();
  assert.equal(q.party.phoenixPatrolCheckpoint.readyAt,0);
});
test('new navigation cancels pending asynchronous waiting-region selection',async()=>{
  const releases=[];const r=fixture({routeDistance:()=>new Promise(resolve=>{releases.push(resolve);})});
  r.kill({map:'main',x:0,y:0});r.loot();r.controller().stop('Manual move');releases.forEach(resolve=>resolve(10));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(r.party.phoenixPatrolCheckpoint,null);
});

test('a new Phoenix sighting interrupts a respawn wait immediately',()=>{
  const r=fixture();r.kill();r.loot();r.controller().tick();
  r.party.statuses.W.rareSightings=[{id:'next',mtype:'phoenix',x:641,y:1803,hp:160000,visible:true}];
  r.controller().report('W',r.party.statuses.W);r.controller().tick();
  assert.equal(r.controller().control('W').target.id,'next');
});

test('active grouped patrol retains an outsider Phoenix selection while passive mode rejects it',()=>{
  const r=fixture();const s={id:'p1',mtype:'phoenix',map:'main',in:'main',x:430,y:1710,server:'USII',target:'Stranger',hp:160000,visible:true};
  for(const status of Object.values(r.party.statuses))status.groupedCombat={protocol:4};
  r.party.partyFarmingMode='default';r.party.groupedCombat={target:s,queue:[s],fights:[],claims:[{...s,external:true}],seenAt:r.time()};
  r.party.statuses.W.rareSightings=[s];r.controller().report('W',r.party.statuses.W);r.controller().tick();
  assert.equal(r.controller().control('W').target.id,'p1');assert.equal(r.controller().control('W').allowPhoenixAssist,true);
  r.controller().tick();assert.equal(r.controller().encounter(),true);
  r.controller().stop();r.party.monsterFocus=['goo'];r.controller().setSettings({phoenix:true});
  r.controller().tick();assert.equal(r.controller().encounter(),false);
});

test('stale sightings and protected event ownership do not interrupt patrol for acquisition',()=>{
  for(const protectedEvent of [false,true]) {
    const r=fixture();r.move({map:'main',x:0,y:0});
    for(const status of Object.values(r.party.statuses))status.groupedCombat={protocol:4};
    r.party.partyFarmingMode='default';r.controller().tick();
    r.party.statuses.M.rareSightings=[{id:'p',mtype:'phoenix',x:80,y:0,hp:100,visible:true}];
    r.controller().report('M',r.party.statuses.M);
    if(protectedEvent)r.party.anniversary={eventCycle:{stagedAt:r.time()}};
    else r.advance(4000);
    r.controller().tick();assert.equal(r.controller().encounter(),false);
  }
});

test('real snapshot selects a convoy-visible Phoenix over nearer passive chickens',()=>{
 const {coordinatorGroupedSnapshot}=require('../../runtime/coordinator/navigation/grouped-snapshot.ts');
 const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
 const r=fixture();r.move({map:'main',x:-160,y:-181});
 Object.assign(r.party,{headlessSlots:['W','M','P'],steamMembers:[],merchantCharacter:null,partyFarmingMode:'default',combatLogs:{}});
 const hen={id:'chicken',mtype:'hen',map:'main',in:'main',x:-150,y:-181,priority:100,passiveRare:true};
 for(const s of Object.values(r.party.statuses))s.groupedCombat={protocol:4,anchorVisible:true,candidates:[hen]};
 const ports={now:r.time,tickDisengagement(){},disengagementActive:()=>false,intent:()=>({revision:1}),owned:()=>undefined,
  prepare:x=>x,evaluate:evaluateGroup,finalize:x=>x,blocksPulls:()=>false,patrolAcquisitionAllowed:()=>true};
 assert.equal(coordinatorGroupedSnapshot(r.party,ports).target.id,'chicken');
 r.party.statuses.P.rareSightings=[{id:'221923',mtype:'phoenix',x:-1215,y:338,hp:100,visible:true}];
 // The normal client candidate lists still contain only chickens: convoy nomination is suppressed.
 const selected=coordinatorGroupedSnapshot(r.party,ports);
 assert.equal(selected.target.id,'221923');assert.equal(selected.target.state,'planned');
 r.party.groupedCombat=null;ports.patrolAcquisitionAllowed=()=>false;
 assert.equal(coordinatorGroupedSnapshot(r.party,ports).target.id,'chicken');
 r.party.groupedCombat=null;ports.patrolAcquisitionAllowed=()=>true;
 r.party.statuses.W.groupedCombat.candidates.push({...hen,id:'fairy',mtype:'tinyp',priority:101});
 assert.equal(coordinatorGroupedSnapshot(r.party,ports).target.id,'fairy');
});

test('interrupted active Phoenix handoff retries fresh sightings without a two-minute exclusion',()=>{
 const r=fixture();r.move({map:'main',x:0,y:0});
 for(const s of Object.values(r.party.statuses))s.groupedCombat={protocol:4};
 r.party.groupedCombat={target:null,queue:[],fights:[],seenAt:r.time()};
 r.party.statuses.P.rareSightings=[{id:'live',mtype:'phoenix',x:100,y:0,hp:100,visible:true}];
 r.controller().report('P',r.party.statuses.P);r.controller().tick();assert.equal(r.controller().encounter(),true);
 r.party.statuses.P.joinedEvent='franky';r.controller().tick();assert.equal(r.controller().encounter(),false);
 delete r.party.statuses.P.joinedEvent;r.advance(3001);
 r.controller().report('P',r.party.statuses.P);r.controller().tick();
 assert.equal(r.controller().control('W').target.id,'live');
});

test('combat bridge placeholder HP cannot requalify an unchanged failed rare pursuit',()=>{
 // A patrol Phoenix is deliberately retried; this covers ordinary passive rares.
 const r=fixture();r.move({map:'main',x:0,y:0});r.party.passiveRareHunts.goldenbat=true;
 for(const s of Object.values(r.party.statuses))s.groupedCombat={protocol:4};
 const sight={id:'unchanged',mtype:'goldenbat',map:'main',in:'main',server:'USII',x:100,y:0,hp:100,visible:true};
 r.party.groupedCombat={target:sight,queue:[],fights:[],seenAt:r.time()};
 r.party.statuses.P.rareSightings=[sight];r.controller().report('P',r.party.statuses.P);
 r.controller().tick();assert.equal(r.controller().encounter(),true);
 r.party.groupedCombat.target=null;r.advance(10001);r.controller().tick();
 assert.equal(r.controller().encounter(),false);
 r.advance(3001);r.controller().report('P',r.party.statuses.P);
 r.party.groupedCombat.target=sight;r.controller().tick();
 assert.equal(r.controller().encounter(),false,'placeholder hp=1 is not damage evidence');
});

for(const mode of ['default','scatter'])for(const stage of ['mission-travel','returning'])for(const mtype of ['phoenix','hen','rooster'])test(mode+' Hunt '+stage+' yields combat to '+mtype+' that cancelled its convoy',()=>{
 const {coordinatorGroupedSnapshot}=require('../../runtime/coordinator/navigation/grouped-snapshot.ts');
 const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
 const {travelCombatFor}=require('../../runtime/coordinator/navigation/travel-defense.ts');
 const r=fixture();r.controller().stop();r.move({map:'main',x:0,y:0});
 Object.assign(r.party,{headlessSlots:['W','M','P'],steamMembers:[],merchantCharacter:null,partyFarmingMode:mode,combatLogs:{},
  farmingPolicy:'hunt',monsterHunt:{cycleId:'h',stage,target:'cgoo',participants:['W','M','P']},
  navigationIntents:{W:{revision:1},M:{revision:1},P:{revision:1}},
  activeConvoy:{id:'hunt',phase:'travel',purpose:'monster-hunt',participants:['W','M','P']}});
 r.party.passiveRareHunts[mtype]=true;
 r.party.passiveHunting.rules[mtype]={enabled:true,keepMoving:false,priority:100};
 const target={id:'rare',mtype,map:'main',in:'main',server:'USII',x:50,y:0,hp:100,visible:true,priority:100,passiveRare:true};
 for(const s of Object.values(r.party.statuses)){s.groupedCombat={protocol:4,anchorVisible:true,candidates:[target]};s.rareSightings=[target];}
 const recovery=require('../combat-disengagement.cjs')(r.party,{...r.hooks,now:r.time});
 const ports={now:r.time,tickDisengagement:recovery.tick,disengagementActive:recovery.active,intent:()=>({revision:1}),owned:()=>undefined,prepare:recovery.prepare,evaluate:evaluateGroup,finalize:recovery.finalize,blocksPulls:()=>false};
 assert.ok(travelCombatFor(r.party,'W'));
 r.controller().report('W',r.party.statuses.W);r.controller().tick();
 assert.equal(r.party.activeConvoy,null);assert.equal(r.controller().encounter(),true);
 assert.equal(travelCombatFor(r.party,'W'),null);
 // A full heartbeat after acquisition still reports the learned Hunt monster.
 // It must not erase the grouped queue while responses require grouped combat.
 const {observeScatter}=require('../../runtime/coordinator/status/scatter.ts');
 Object.assign(r.party,{scatterMonsterTypes:['minimush'],scatterEpoch:0,scatterBreakTarget:null,partyFarmingMonsterType:'minimush'});
 for(const s of Object.values(r.party.statuses))s.farmingMonsterType='minimush';
 observeScatter(r.party,['W','M','P'],r.party.statuses,r.party.statuses.W,[],r.time(),r.controller().owns());
 const selected=coordinatorGroupedSnapshot(r.party,ports);assert.equal(selected.target.id,'rare');
 r.controller().tick();r.advance(10001);r.controller().report('W',r.party.statuses.W);r.controller().tick();
 assert.equal(r.controller().encounter(),true,'selected rare must not hit the ten-second handoff timeout');
});
