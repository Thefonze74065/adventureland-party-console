const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRareHunting,regions}=require('../../runtime/coordinator/navigation/rare-hunting.ts');
const {createCoordinatorPartyConvoys}=require('../../runtime/coordinator/navigation/convoy-composition.ts');
const zones=require('../../dashboard/lib/farming-zones.ts');
const {defaultPhoenixOrder,farmingAreas}=require('../../dashboard/lib/farming-areas.ts');
const {waitingRegion}=require('../../runtime/coordinator/navigation/phoenix-patrol.ts');
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
test('a full five-region circuit completes with real positions and endpoint dwell',()=>{
  const r=fixture();let prior=0;const visited=[];
  for(let i=0;i<80 && visited.length<5;i++) {
    r.controller().tick();const control=r.controller().control('W');assert.ok(control);
    r.move(control.destination);r.party.activeConvoy=null;
    r.controller().tick();r.advance(1001);r.controller().tick();
    const next=r.party.rareHuntState.patrol.index;
    if(next!==prior){visited.push(prior);prior=next;}
  }
  assert.deepEqual(visited,[0,1,2,3,4]);assert.equal(prior,0);
});
test('stationary successful-but-wrong convoy completions cannot loop forever',()=>{
  const r=fixture();r.move({map:'main',x:0,y:0});
  for(let i=0;i<80 && !r.party.rareHuntState.patrol?.paused;i++) {
    r.controller().tick();r.party.activeConvoy=null;r.advance(31000);r.controller().tick();
  }
  assert.equal(r.party.rareHuntState.patrol.paused,true);
  assert.equal(r.party.rareHuntState.patrol.incomplete.length,5);
});
test('assisted kill stays in current region, waits from death through delayed loot and restart, then follows successor',()=>{
  const r=fixture(),at=r.kill({map:'cave',x:-180,y:-1164},true);
  assert.equal(r.controller().control('W').allowPhoenixAssist,true);
  r.advance(18000);r.loot();
  assert.equal(r.party.phoenixPatrolCheckpoint.regionId,r.order[1]);
  assert.equal(r.party.phoenixPatrolCheckpoint.readyAt,at+35000);
  r.restart();assert.equal(r.party.rareHuntState.patrol.index,1);
  r.move(r.controller().control('W').destination);r.party.activeConvoy=null;
  r.advance(at+35000-r.time()-1);r.controller().tick();assert.equal(r.party.rareHuntState.patrol.index,1);
  r.advance(1);r.controller().tick();r.advance(1001);r.controller().tick();
  assert.equal(r.party.rareHuntState.patrol.index,2);
});
test('fight dragged outside all regions chooses nearest planned route from post-loot position',async()=>{
  const calls=[];
  const r=fixture({routeDistance:async(from,to)=>{calls.push({from,to});return to.map==='cave'?50:900;}});
  const at=r.kill({map:'main',x:0,y:0},true);r.move({map:'main',x:100,y:100});r.loot();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,5);assert.ok(calls.every(c=>c.from.x===100 && c.from.y===100));
  assert.equal(r.party.phoenixPatrolCheckpoint.regionId,r.order[1]);
  assert.equal(r.party.phoenixPatrolCheckpoint.readyAt,at+35000);
  r.controller().tick();assert.equal(r.controller().control('W').destination.map,'cave');
});
test('nearest region ignores rejected plans and breaks equal route distances by saved order',async()=>{
  const areas=regions(catalog),from={map:'main',x:0,y:0};
  assert.equal(await waitingRegion(areas,from,async()=>{throw Error('blocked');}),null);
  assert.equal((await waitingRegion(areas,from,async()=>10)).id,areas[0].id);
  assert.equal((await waitingRegion(areas,from,async(_from,to)=>{if(to.map===areas[0].map)throw Error('blocked');return 10;})).map,'halloween');
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

test('region transition waits for every convoy acknowledgement instead of cancelling the leader arrival',()=>{
  const r=fixture();r.move({map:'main',x:0,y:0});r.controller().tick();
  const convoy=r.party.activeConvoy;r.move(r.controller().control('W').destination);
  r.controller().tick();r.advance(1001);r.controller().tick();
  assert.equal(r.party.activeConvoy,convoy);assert.equal(r.party.rareHuntState.patrol.index,0);
  r.party.activeConvoy=null;r.controller().tick();r.advance(1001);r.controller().tick();
  assert.equal(r.party.rareHuntState.patrol.index,1);
});

test('protected activity suspends the scan watchdog and stale positions cannot complete coverage',()=>{
  const r=fixture();r.move({map:'main',x:0,y:0});r.controller().tick();
  r.party.statuses.W.joinedEvent='franky';r.advance(60000);r.controller().tick();
  assert.equal(r.party.rareHuntState.patrol.index,0);
  delete r.party.statuses.W.joinedEvent;r.controller().tick();
  assert.equal(r.party.rareHuntState.patrol.retryReason,undefined);
  r.move(r.controller().control('W').destination);r.party.activeConvoy=null;
  Object.values(r.party.statuses).forEach(s=>s.seenAt=r.time()-4000);r.controller().tick();
  assert.equal(r.party.rareHuntState.patrol.index,0);
});

test('a new Phoenix sighting interrupts a respawn wait immediately',()=>{
  const r=fixture();r.kill();r.loot();r.controller().tick();
  r.party.statuses.W.rareSightings=[{id:'next',mtype:'phoenix',x:641,y:1803,hp:160000,visible:true}];
  r.controller().report('W',r.party.statuses.W);r.controller().tick();
  assert.equal(r.controller().control('W').target.id,'next');
});

test('Steam runtime reload retries the same waypoint without consuming geometry fallback attempts',()=>{
  const r=fixture();r.move({map:'main',x:804,y:-107});r.controller().tick();
  const destination=r.controller().control('W').destination;
  for(let i=0;i<3;i++) {
    r.party.activeConvoy={purpose:'phoenix-patrol',phase:'failed',failureCode:'runtime-lost'};
    r.controller().tick();assert.equal(r.controller().control('W'),null);
    const starts=r.starts();r.advance(4999);r.controller().tick();assert.equal(r.starts(),starts);
    r.advance(1);r.controller().tick();assert.deepEqual(r.controller().control('W').destination,destination);
    assert.equal(r.party.rareHuntState.patrol.index,0);assert.deepEqual(r.party.rareHuntState.patrol.incomplete,[]);
  }
});

test('blocked waypoint alternatives stay within the selected spawn region',()=>{
  const r=fixture();r.move({map:'main',x:804,y:-107});r.controller().tick();
  for(let i=0;i<2;i++) {r.party.activeConvoy={purpose:'phoenix-patrol',phase:'failed',failureCode:'route-failed'};r.controller().tick();}
  const point=r.controller().control('W').destination;
  assert.equal(zones.contains(regions(catalog).find(a=>a.id===r.order[0]),point,0,1),true);
});

test('anniversary staging and return hold patrol even after event commands temporarily clear',()=>{
  const r=fixture();r.move({map:'main',x:0,y:0});r.controller().tick();const initial=r.starts();
  r.party.anniversary={eventCycle:{stagedAt:r.time()}};r.party.commands={};
  for(let i=0;i<12;i++){r.advance(10000);r.controller().tick();}
  assert.equal(r.starts(),initial);assert.equal(r.party.activeConvoy,null);
  assert.match(r.party.rareHuntState.message,/protected activity/);
  assert.equal(r.party.rareHuntState.patrol.retryReason,undefined);
  r.party.anniversary.eventCycle.returnCompletedAt=r.time();r.controller().tick();
  assert.equal(r.starts(),initial+1);assert.equal(r.party.rareHuntState.patrol.index,0);
  r.party.eventReturn={cycleId:'event'};r.controller().tick();assert.equal(r.party.activeConvoy,null);
  r.party.eventReturn=null;r.controller().tick();assert.equal(r.starts(),initial+2);
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

test('follower sighting interrupts a travelling patrol before arrival and survives combat selection handoff',()=>{
  const r=fixture();r.move({map:'main',x:0,y:0});
  for(const status of Object.values(r.party.statuses))status.groupedCombat={protocol:4};
  r.party.partyFarmingMode='default';r.party.groupedCombat={target:null,queue:[],fights:[],seenAt:r.time()};
  r.controller().tick();assert.equal(r.party.activeConvoy.phase,'travel');
  const point=r.controller().control('W').destination,starts=r.starts();
  const sight={id:'en-route',mtype:'phoenix',map:'main',in:'main',server:'USII',x:80,y:0,hp:100,visible:true,target:'Stranger'};
  r.party.statuses.M.rareSightings=[sight];r.controller().report('M',r.party.statuses.M);r.controller().tick();
  assert.equal(r.party.activeConvoy,null);assert.equal(r.party.statuses.W.x,0);
  assert.notDeepEqual({x:0,y:0},point);assert.equal(r.controller().control('W').target.id,sight.id);
  r.advance(500);r.controller().tick();assert.equal(r.controller().encounter(),true);
  assert.equal(r.starts(),starts);assert.equal(r.party.rareHuntState.patrol.index,0);
  r.party.groupedCombat.target=sight;r.party.groupedCombat.queue=[sight];r.controller().tick();
  r.party.groupedCombat.fights=[{...sight,state:'engaged'}];r.controller().tick();
  assert.equal(r.party.rareHuntState.encounter.stage,'combat');assert.equal(r.party.activeConvoy,null);
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

test('fast report interrupts convoy and actual client nomination produces a selected Phoenix ring',()=>{
 const {createCombatIngestion}=require('../../runtime/coordinator/status/combat-ingestion.ts');
 const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('characters/shared.js','utf8');
 const r=fixture();r.move({map:'main',x:0,y:0});r.party.partyFarmingMode='default';
 for(const s of Object.values(r.party.statuses))s.groupedCombat={protocol:4,anchorVisible:true,candidates:[]};
 r.controller().tick();assert.ok(r.party.activeConvoy);
 const target={id:'seen-now',mtype:'phoenix',type:'monster',visible:true,hp:100,x:60,y:0,map:'main',in:'main',server:'USII'};
 const ingest=createCombatIngestion(r.party.statuses,{now:r.time,groupedCombat(){},rareReport:(n,s)=>r.controller().report(n,s),rareTick:()=>r.controller().tick(),
  response:()=>({serverNow:r.time(),rareControl:r.controller().control('M'),convoySignal:r.party.activeConvoy,groupedCombat:null})});
 const res={status(){return this;},json(v){this.body=v;return this;}};
 ingest.handle('M',{combatSelection:{runtimeId:'M'},rareObservation:{at:r.time(),runtimeId:'M',map:'main',in:'main',server:'USII',x:0,y:0,sightings:[target]}},res);
 assert.equal(r.party.activeConvoy,null);assert.equal(res.body.rareControl.target.id,target.id);assert.equal(res.body.convoySignal,null);
 const c=vm.createContext({parent:{entities:{p:target}},character:{name:'M',map:'main',in:'main'},leader:'W',root:{},partyConvoyActive:false,
  navigationIntent:{},groupedFarming:()=>true,selectFarmCandidates:t=>t,isPassingEncounter:()=>false,passiveHunting:{rules:{}},passiveRareHunts:{},monsterFocus:['phoenix'],
  groupedEntityReport:e=>({...e,priority:100}),monsterPriority:()=>100,isExternallyClaimedMonster:()=>false,farmApproach:{failed:{}},reunionRealm:()=> 'USII',get_entity:()=>target});
 vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source, 'passiveLevelAllowed'), c);
 vm.runInContext(source.slice(source.indexOf('  function queueCandidates('),source.indexOf('  function queueReport(')),c);
 const candidates=c.queueCandidates();assert.equal(candidates[0].id,target.id);
 const members=Object.values(r.party.statuses).map(s=>({name:s.name,ctype:s.ctype,revision:1,status:{...s,range:200,groupedCombat:{protocol:4,anchorVisible:true,candidates:s.name==='M'?candidates:[]}}}));
 c.groupedCombat=evaluateGroup(null,members,'W',r.time(),0,false);
 assert.equal(c.groupedCombat.target.id,target.id);
 vm.runInContext(source.slice(source.indexOf('  function queueMarkers('),source.indexOf('  function acceptQueue(')),c);
 assert.equal(c.queueMarkers()[0].role,'current');assert.equal(c.queueMarkers()[0].visible,true);
});

test('short scan legs use a convoy and obsolete local failures cannot cancel it',()=>{
 const r=fixture();r.controller().tick();const d=r.controller().control('W').destination;
 r.party.activeConvoy=null;r.move({...d,x:d.x+80});r.controller().tick();
 const convoy=r.party.activeConvoy;assert.ok(convoy);
 r.party.statuses.W.rareNavigation={id:r.controller().control('W').id,failed:true,reason:'Movement cancelled'};
 r.controller().tick();assert.equal(r.party.activeConvoy,convoy);assert.deepEqual(r.party.rareHuntState.patrol.incomplete,[]);
});

test('fresh position heartbeats without fresh observations do not complete scan coverage',()=>{
 const r=fixture();r.move({map:'main',x:0,y:0});r.controller().tick();const d=r.controller().control('W').destination;
 r.move(d);r.party.activeConvoy=null;
 for(const s of Object.values(r.party.statuses))Object.defineProperty(s,'rareObservation',{value:{...s.rareObservation,at:r.time()-4000},configurable:true});
 r.controller().tick();r.advance(1001);r.controller().tick();
 assert.equal(r.party.rareHuntState.patrol.index,0);
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
 const r=fixture();r.move({map:'main',x:0,y:0});
 for(const s of Object.values(r.party.statuses))s.groupedCombat={protocol:4};
 const sight={id:'unchanged',mtype:'phoenix',map:'main',in:'main',server:'USII',x:100,y:0,hp:100,visible:true};
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
