const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRareHunting, regions, validateOrder, scanPoints, samples } = require('../rare-hunting.cjs');
const boxes = [['main',708,-300,1668,-86],['main',378,1686,904,1920],
  ['main',-1358,-118,-1010,1680],['halloween',-166,453,182,808],['cave',-375,-1287,14,-1041]];
const catalog = [{ id:'phoenix', locations:boxes.map(([map,...boundary]) => ({ map,boundary,
  x:(boundary[0]+boundary[2])/2,y:(boundary[1]+boundary[3])/2 })) }];
function fixture() {
  let time = 100000, starts = 0, resumed = 0;
  const party = { leader:'W', followers:{M:true,P:true}, monsterFocus:['goo'], monsterFocusByCharacter:{},
    passiveRareHunts:{tinyp:true,phoenix:true}, monsterChoices:catalog, monsterPrioritiesByCharacter:{},
    location:{map:'winterland',x:0,y:0}, farmingPolicy:'auto', commands:{}, statuses:{} };
  const revisions = {W:1,M:1,P:1};
  function refresh() { for(const s of Object.values(party.statuses)) s.seenAt=time; }
  for(const [name,ctype] of [['W','warrior'],['M','mage'],['P','priest']]) party.statuses[name] = {
    name,ctype,server:'USII',map:'main',in:'main',x:0,y:0,hp:1000,seenAt:time,items:[],rareSightings:[],rareFields:[] };
  for(const s of Object.values(party.statuses)) {
    s.combatSelection={runtimeId:s.name};
    Object.defineProperty(s,'rareObservation',{configurable:true,get(){return {at:s.seenAt,runtimeId:s.name,map:s.map,in:s.in,server:s.server,x:s.x,y:s.y,sightings:s.rareSightings};}});
  }
  const controller = createRareHunting(party,{now:()=>time,members:()=>['W','M','P'],
    intent:n=>({revision:revisions[n],cancelled:false}),turnIn:()=>!!party.turnIn,
    persist(){},cancelConvoy(){party.activeConvoy=null;},resumeHunt(){resumed++;},
    convoy(location,label,names,purpose){starts++;party.activeConvoy={id:'convoy-'+starts,location,label,purpose,phase:'travel'};return true;}});
  function sight(type='phoenix',name='W',extra={}) {
    const s=party.statuses[name];s.rareSightings=[{id:type,mtype:type,x:20,y:10,hp:5600,visible:true,...extra}];
    controller.report(name,s);controller.tick();
  }
  return {party,controller,revisions,sight,refresh,starts:()=>starts,resumed:()=>resumed,
    advance(ms){time+=ms;refresh();},time:()=>time};
}
for(const [id,label] of [['goldenbat','Golden Bat'],['cutebee','Cute Bee'],['hen','Hen'],['rooster','Rooster']]) test(id+' passive setting acquires at priority 100 and yields to Fairy',()=>{
  const r=fixture();r.sight(id);assert.equal(r.controller.encounter(),false);
  r.party.statuses.W.target={mtype:'goo'};r.party.monsterPrioritiesByCharacter.W={goo:101};
  r.controller.setSettings({[id]:true});
  r.sight(id);assert.equal(r.controller.encounter(),false);
  r.party.monsterPrioritiesByCharacter.W.goo=100;r.sight(id);
  assert.equal(r.party.rareHuntState.encounter.mtype,id);
  assert.ok(r.party.rareHuntState.encounter.message.includes(label));
  r.sight('tinyp','M');assert.equal(r.party.rareHuntState.encounter.mtype,'tinyp');
});

test('all five catalog regions are required, independent of caller order',()=>{
  const order=regions(catalog).map(a=>a.id);
  assert.equal(validateOrder(catalog,order),true);
  assert.equal(validateOrder(catalog,order.slice(1)),false);
  assert.equal(validateOrder(catalog,[...order.slice(1),order[1]]),false);
  assert.equal(validateOrder(catalog,[...order.slice(1),'invented']),false);
});

for(const mtype of ['hen','rooster']) test(mtype+' sightings from merchant or another map cannot interrupt arctic-bee farming',()=>{
 const r=fixture();r.party.partyFarmingMode='scatter';r.party.farmingPolicy='scatter';r.party.monsterFocus=['arcticbee'];
 const location=r.party.location;r.controller.setSettings({[mtype]:true});
 for(const name of ['W','M','P'])Object.assign(r.party.statuses[name],{map:'winterland',in:'winterland'});
 r.party.statuses.Merchant={name:'Merchant',ctype:'merchant',map:'main',in:'main',server:'USII',seenAt:r.time(),hp:100};
 r.sight(mtype,'Merchant');assert.equal(r.controller.encounter(),false);assert.equal(r.starts(),0);
 Object.assign(r.party.statuses.M,{map:'main',in:'main'});r.sight(mtype,'M');
 assert.equal(r.controller.encounter(),false);assert.equal(r.starts(),0);
 Object.assign(r.party.statuses.M,{map:'winterland',in:'other'});r.sight(mtype,'M');
 assert.equal(r.controller.encounter(),false);assert.equal(r.starts(),0);
 assert.equal(r.party.location,location);assert.equal(r.party.partyFarmingMode,'scatter');
 Object.assign(r.party.statuses.M,{in:'winterland'});r.sight(mtype,'M');
 assert.equal(r.party.rareHuntState.encounter.mtype,mtype,'nearby combat-party sighting still triggers passive hunting');
 assert.equal(r.party.location,location,'temporary encounter preserves the farm');
});
test('four Phoenix regions fit one footprint; tall region gets an overlapping cardinal sweep',()=>{
  const areas=regions(catalog);
  for(const area of areas) {
    const points=scanPoints(area,{map:area.map,x:area.x,y:area.y});
    const tall=area.boundary[3]-area.boundary[1]>800;
    assert.equal(points.length===1,!tall);
    for(const sample of samples(area)) assert.ok(points.some(p=>Math.abs(p.x-sample.x)<=570&&Math.abs(p.y-sample.y)<=370));
    if(tall) assert.ok(points.every(p=>p.x===points[0].x));
  }
});
test('disabled passive settings never interrupt, while follower Fairy sighting preempts Phoenix',()=>{
  const r=fixture();r.party.passiveRareHunts={tinyp:false,phoenix:false};r.sight();assert.equal(r.controller.encounter(),false);
  r.party.passiveRareHunts.phoenix=true;r.sight();assert.equal(r.party.rareHuntState.encounter.mtype,'phoenix');
  r.party.passiveRareHunts.tinyp=true;r.sight('tinyp','M');assert.equal(r.party.rareHuntState.encounter.mtype,'tinyp');
  assert.equal(r.controller.control('P').target.id,'tinyp');
});
test('sightings on another realm and claimed Fairy do not acquire; outsider Phoenix is rejected',()=>{
  const r=fixture();r.party.statuses.M.server='EU';r.sight('tinyp','M');assert.equal(r.controller.encounter(),false);
  r.sight('tinyp','W',{target:'Stranger'});assert.equal(r.controller.encounter(),false);
  r.sight('phoenix','W',{target:'Stranger'});assert.equal(r.controller.encounter(),false);
});
test('higher custom priority, Daisy rewards and event combat prevent rare interruption',()=>{
  const r=fixture();r.party.statuses.W.target={mtype:'goo'};r.party.monsterPrioritiesByCharacter.W={goo:500};
  r.sight();assert.equal(r.controller.encounter(),false);
  r.party.statuses.W.target=null;r.party.turnIn=true;r.sight();assert.equal(r.controller.encounter(),false);
  r.party.turnIn=false;r.party.statuses.W.joinedEvent='franky';r.sight();assert.equal(r.controller.encounter(),false);
});
test('Hunt resumes after confirmed kill; disappearance is not a kill and stale sightings expire',()=>{
  const r=fixture();r.party.monsterHunt={stage:'fighting',target:'goo'};r.party.farmingPolicy='hunt';r.sight();
  r.party.statuses.W.rareKills=[{id:'phoenix',mtype:'phoenix',map:'main',in:'main',at:r.time(),partyEngaged:true}];
  r.controller.report('W',r.party.statuses.W);r.controller.tick();assert.equal(r.resumed(),0);
  r.advance(2000);r.party.statuses.W.rareLoot={id:r.controller.control('W').id,at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:true};
  r.controller.tick();assert.equal(r.resumed(),0);assert.equal(r.party.monsterHunt.convoyId,null);
  assert.equal(r.controller.encounter(),false);
  const q=fixture();q.sight();q.party.statuses.W.rareSightings=[];q.advance(30001);q.controller.tick();
  assert.equal(q.controller.encounter(),false);assert.match(q.party.rareHuntState.message || '',/progress|time|fresh sightings/);
});
test('manual navigation revision cancels a pursuit without a stale return convoy',()=>{
  const r=fixture();r.sight();r.revisions.W++;r.controller.tick();
  assert.equal(r.controller.encounter(),false);assert.equal(r.starts(),0);
});
test('generator carrier is unique and confirmation releases attacks without repeat deployment',()=>{
  const r=fixture();r.party.statuses.M.items=[{name:'fieldgen0'}];r.party.statuses.P.items=[{name:'fieldgen0'}];
  r.sight('tinyp');const c=r.controller.control('W');assert.equal(c.deployer,'M');
  r.party.statuses.M.rareDeployment={encounterId:c.id};r.controller.tick();assert.equal(r.controller.control('W').deployer,'M');
  r.party.statuses.W.rareFields=[{x:20,y:10}];r.controller.tick();assert.equal(r.controller.control('W').deployer,null);
  r.party.statuses.W.rareFields=[];r.controller.tick();assert.equal(r.controller.control('W').deployer,null);
});
test('unconfirmed generator deployment falls back after three seconds',()=>{
  const r=fixture();r.party.statuses.M.items=[{name:'fieldgen0'}];r.sight('tinyp');
  const id=r.controller.control('M').id;r.party.statuses.M.rareDeployment={encounterId:id};r.controller.tick();
  r.advance(3001);r.sight('tinyp');assert.equal(r.controller.control('M').deployer,null);
});
test('active patrol detects Phoenix with passive checkbox off and resets after confirmed kill',()=>{
  const r=fixture();r.party.monsterFocus=['phoenix'];r.party.passiveRareHunts.phoenix=false;
  r.controller.start(regions(catalog).map(a=>a.id));r.controller.tick();r.sight();
  assert.equal(r.controller.encounter(),true);
  r.party.statuses.W.rareKills=[{id:'phoenix',mtype:'phoenix',map:'main',in:'main',at:r.time(),partyEngaged:true}];
  r.controller.report('W',r.party.statuses.W);r.controller.tick();
  r.advance(2000);r.party.statuses.W.rareLoot={id:r.controller.control('W').id,at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:true};
  r.controller.tick();
  assert.equal(r.party.rareHuntState.patrol.index,0);assert.equal(r.party.rareHuntState.patrol.stage,'respawn');
});
test('patrol only advances after real coverage and endpoint dwell',()=>{
  const r=fixture();r.party.monsterFocus=['phoenix'];r.controller.start(regions(catalog).map(a=>a.id));r.controller.tick();
  const d=r.controller.control('W').destination;
  r.advance(1001);r.controller.tick();assert.equal(r.party.rareHuntState.patrol.index,0);
  Object.assign(r.party.statuses.W,d,{in:d.map});r.party.activeConvoy=null;r.controller.tick();r.advance(1001);r.controller.tick();
  assert.equal(r.party.rareHuntState.patrol.index,1);
});
test('failed points have bounded retries and all unreachable regions pause the patrol',()=>{
  const r=fixture();r.party.monsterFocus=['phoenix'];r.controller.start(regions(catalog).map(a=>a.id));
  for(let i=0;i<100&&!r.party.rareHuntState.patrol?.paused;i++) {
    r.controller.tick();const c=r.controller.control('W');
    if(c)r.party.activeConvoy={purpose:'phoenix-patrol',phase:'failed',failureCode:'route-failed'};
    r.controller.tick();
  }
  assert.equal(r.party.rareHuntState.patrol.paused,true);
  assert.equal(r.party.rareHuntState.patrol.incomplete.length,5);
});
test('no-progress and five-minute limits bound a continuously visible passive encounter',()=>{
  const r=fixture();r.sight();r.advance(30001);r.sight();assert.equal(r.controller.encounter(),false);
  const q=fixture();q.sight();
  for(let i=1;i<=16;i++){q.advance(20000);q.sight('phoenix','W',{hp:5600-i*10});}
  assert.equal(q.controller.encounter(),false);
});
test('passive checkbox cancellation leaves an explicitly active Phoenix patrol running',()=>{
  const r=fixture();r.sight();r.controller.setSettings({phoenix:false});assert.equal(r.controller.encounter(),false);
  r.party.monsterFocus=['phoenix'];r.controller.start(regions(catalog).map(a=>a.id));r.controller.tick();
  assert.equal(r.party.rareHuntState.patrol.active,true);
});
test('Fairy interrupts a patrol and resumes the same region rather than resetting the order',()=>{
  const r=fixture();r.party.monsterFocus=['phoenix'];r.controller.start(regions(catalog).map(a=>a.id));r.controller.tick();
  const before=r.controller.control('W').destination;r.sight('tinyp');
  r.party.statuses.W.rareKills=[{id:'tinyp',mtype:'tinyp',map:'main',in:'main',at:r.time(),partyEngaged:true}];
  r.controller.report('W',r.party.statuses.W);r.controller.tick();
  r.advance(2000);r.party.statuses.W.rareLoot={id:r.controller.control('W').id,at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:true};
  r.controller.tick();r.controller.tick();
  assert.deepEqual(r.controller.control('W').destination,before);
});

for (const mtype of ['phoenix','goldenbat','cutebee','hen','rooster','tinyp']) test(mtype+' waits for drops before resuming, without a timeout bypass',()=>{
  const r=fixture();r.controller.setSettings({[mtype]:true});r.sight(mtype);
  r.party.statuses.W.rareKills=[{id:mtype,mtype,map:'main',in:'main',at:r.time(),partyEngaged:true}];
  r.controller.report('W',r.party.statuses.W);r.controller.tick();
  const id=r.controller.control('W').id;
  assert.equal(r.controller.control('W').kind,'loot');assert.equal(r.starts(),0);
  r.party.statuses.W.rareLoot={id,at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:true};
  r.advance(1000);r.controller.tick();assert.equal(r.starts(),0);
  r.advance(2000);r.party.statuses.W.rareLoot={id:'old-encounter',at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:true};
  r.controller.tick();assert.equal(r.starts(),0);
  r.party.statuses.W.rareLoot={id,at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:false};
  r.controller.tick();assert.equal(r.starts(),0);
  r.advance(12000);r.controller.tick();assert.equal(r.starts(),0);
  assert.equal(r.controller.control('W').kind,'loot');
});

for (const mtype of ['phoenix','goldenbat','cutebee','hen','rooster','tinyp']) test(mtype+' resumes promptly after fresh loot confirmation',()=>{
  const r=fixture();r.controller.setSettings({[mtype]:true});r.sight(mtype);
  r.party.statuses.W.rareKills=[{id:mtype,mtype,map:'main',in:'main',at:r.time(),partyEngaged:true}];
  r.controller.report('W',r.party.statuses.W);
  if(mtype!=='tinyp') r.sight('tinyp','M');
  else r.controller.tick();
  assert.equal(r.party.rareHuntState.encounter.mtype,mtype);
  r.advance(2000);r.party.statuses.W.rareLoot={id:r.controller.control('W').id,at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:true};
  r.controller.tick();assert.equal(r.controller.encounter(),false);assert.equal(r.starts(),1);
});

test('passive rare sighting waits for unfinished grouped fights and is reconsidered afterward',()=>{
 const r=fixture();r.party.groupedCombat={fights:[{id:'rat'}]};r.sight('tinyp','M');
 assert.equal(r.controller.encounter(),false);assert.equal(r.starts(),0);
 r.party.groupedCombat.fights=[];r.controller.tick();assert.equal(r.controller.encounter(),true);
 assert.equal(r.party.rareHuntState.encounter.mtype,'tinyp');
});

for (const interruption of ['health','heartbeat']) test(interruption+' interruption retains a return and resumes after recovery',()=>{
 const r=fixture();r.sight();
 if(interruption==='health'){r.party.statuses.P.max_hp=1000;r.party.statuses.P.hp=300;}
 else r.party.statuses.W.seenAt-=5000;
 r.controller.tick();assert.ok(r.party.rareHuntReturn);assert.equal(r.starts(),0);
 r.party.statuses.P.hp=1000;r.advance(31000);r.controller.tick();
 assert.equal(r.starts(),1);assert.equal(r.party.activeConvoy.location.map,'winterland');
 assert.ok(r.party.rareHuntReturn);
});
test('interrupted return convoy is retried and cleared only after all members arrive alive',()=>{
 const r=fixture();r.sight();r.advance(31000);r.controller.tick();assert.equal(r.starts(),1);
 r.party.statuses.P.max_hp=1000;r.party.statuses.P.hp=300;r.controller.tick();
 assert.equal(r.party.activeConvoy,null);assert.ok(r.party.rareHuntReturn);
 r.party.statuses.P.hp=1000;r.advance(6000);r.controller.tick();assert.equal(r.starts(),2);
 for(const s of Object.values(r.party.statuses))Object.assign(s,{map:'winterland',in:'winterland',x:0,y:0});
 r.party.statuses.P.rip=true;r.controller.tick();assert.ok(r.party.rareHuntReturn);
 r.party.statuses.P.rip=false;r.controller.tick();assert.equal(r.party.rareHuntReturn,null);
 assert.match(r.party.rareHuntState.message,/Farming resumed/);
});
test('failed return retries without overriding a newer manual destination',()=>{
 const r=fixture();r.sight();r.advance(31000);r.controller.tick();
 r.party.activeConvoy.phase='failed';r.advance(6000);r.controller.tick();assert.equal(r.starts(),2);
 r.revisions.W++;r.party.location={map:'cave',x:20,y:30};r.controller.tick();
 assert.equal(r.party.rareHuntReturn,null);assert.equal(r.party.location.map,'cave');assert.equal(r.starts(),2);
});

test('Hunt restart waits through protected interruption before handing travel back',()=>{
 const r=fixture();r.party.monsterHunt={stage:'fighting'};r.party.farmingPolicy='hunt';r.sight();
 r.party.statuses.P.max_hp=1000;r.party.statuses.P.hp=300;r.controller.tick();assert.equal(r.resumed(),0);
 r.party.statuses.P.hp=1000;r.advance(31000);r.controller.tick();assert.equal(r.resumed(),0);assert.equal(r.party.monsterHunt.convoyId,null);assert.equal(r.party.rareHuntReturn,null);
});
test('restored Phoenix patrol keeps its route instead of starting a farming return',()=>{
 const r=fixture();r.party.monsterFocus=['phoenix'];r.party.phoenixPatrolActive=true;
 r.party.phoenixRouteOrder=regions(catalog).map(a=>a.id);
 r.party.rareHuntReturn={leader:'W',realm:':USII',focus:'["phoenix"]',policy:'auto',revisions:{W:1,M:1,P:1},returnLocation:{map:'main',x:1,y:2}};
 r.controller.tick();assert.equal(r.party.rareHuntReturn,null);assert.ok(r.party.rareHuntState.patrol.active);
 assert.equal(r.party.activeConvoy?.purpose,'phoenix-patrol');
});

function groupRare(r,id='phoenix',state='planned') {
 for(const s of Object.values(r.party.statuses)) s.groupedCombat={protocol:4};
 const target={id,mtype:id,map:'main',in:'main',server:'USII',x:20,y:10,state};
 r.party.groupedCombat={protocol:4,seenAt:r.time(),target,queue:[target],fights:state==='planned'?[]:[target],deaths:[]};
 return target;
}

test('witnessed Phoenix death never enters loot; claim on approach cancels and cools down',()=>{
 const r=fixture();r.sight();r.party.statuses.W.rareKills=[{id:'phoenix',mtype:'phoenix',map:'main',in:'main',at:r.time()}];
 r.controller.report('W',r.party.statuses.W);r.controller.tick();assert.equal(r.controller.encounter(),false);
 const q=fixture();q.sight();q.advance(1);q.sight('phoenix','W',{target:'Outsider'});
 assert.equal(q.controller.encounter(),false);const starts=q.starts();
 for(let i=0;i<5;i++){q.advance(100);q.sight();}assert.equal(q.controller.encounter(),false);assert.equal(q.starts(),starts);
});
test('grouped rare waits for queue selection and never owns a competing convoy',()=>{
 const r=fixture();groupRare(r,'goo');r.sight();assert.equal(r.controller.encounter(),false);
 groupRare(r);r.controller.tick();assert.equal(r.controller.control('M').target.id,'phoenix');assert.equal(r.starts(),0);
 assert.match(r.party.rareHuntState.encounter.message,/Pursuing/);
 r.party.groupedCombat.fights=[r.party.groupedCombat.target];r.controller.tick();assert.match(r.party.rareHuntState.encounter.message,/Fighting/);
});
test('locked grouped rare survives disabling, stale sightings and timeout; death waits for remaining attackers',()=>{
 const r=fixture();const target=groupRare(r,'phoenix','engaged');r.sight();const id=r.controller.control('W').id;
 r.controller.setSettings({phoenix:false});r.advance(310000);r.party.statuses.W.rareSightings=[];r.controller.tick();
 assert.equal(r.controller.encounter(),true);assert.equal(r.starts(),0);
 const other={...target,id:'boar',mtype:'boar'};r.party.groupedCombat.target=other;r.party.groupedCombat.fights=[other];
 r.party.groupedCombat.deaths=[{...target,at:r.time(),partyEngaged:true}];r.controller.tick();assert.equal(r.starts(),0);assert.equal(r.controller.blocksPulls(),true);
 r.party.groupedCombat.fights=[];r.controller.tick();r.advance(2000);
 r.party.statuses.W.rareLoot={id,at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:true};r.controller.tick();assert.equal(r.controller.encounter(),false);assert.equal(r.starts(),1);
});

test('externally claimed rare cancels without kill or loot and waits for remaining fights before returning',()=>{
 const r=fixture();const t=groupRare(r,'goldenbat','engaged');r.controller.setSettings({goldenbat:true});r.sight('goldenbat');
 const other={...t,id:'boar',mtype:'boar'};
 r.party.groupedCombat.target=other;r.party.groupedCombat.fights=[other];
 r.party.groupedCombat.claims=[{...t,external:true,at:r.time(),releasedAt:r.time()}];r.controller.tick();
 assert.equal(r.controller.encounter(),false);assert.equal(r.controller.blocksPulls(),false);assert.equal(r.starts(),0);
 assert.ok(r.party.rareHuntReturn);r.party.groupedCombat.fights=[];r.controller.tick();assert.equal(r.starts(),1);
});
for(const mtype of ['tinyp','phoenix','goldenbat','cutebee','hen','rooster']) test(mtype+' interrupted pursuit permits a fresh retry after three seconds',()=>{
 const r=fixture();r.party.location={map:'main',x:0,y:0};r.controller.setSettings({[mtype]:true});r.sight(mtype);
 assert.equal(r.controller.encounter(),true);
 r.party.statuses.W.joinedEvent='franky';r.controller.tick();
 assert.equal(r.controller.encounter(),false);
 delete r.party.statuses.W.joinedEvent;r.advance(2999);r.sight(mtype);
 assert.equal(r.controller.encounter(),false);
 r.advance(2);r.sight(mtype);assert.equal(r.controller.encounter(),true);
});


test('catalog monsters support committed encounters and independent passing mode',()=>{
 const r=fixture();r.controller.setSettings({rules:{bee:{enabled:true,priority:102}}});r.sight('bee');
 assert.equal(r.party.rareHuntState.encounter.mtype,'bee');assert.match(r.party.rareHuntState.encounter.message,/bee/);
 const passing=fixture();passing.controller.setSettings({rules:{bee:{enabled:true,keepMoving:true,priority:100}}});passing.sight('bee');
 assert.equal(passing.controller.encounter(),false);assert.equal(passing.starts(),0);
});
test('disabled field generators leave committed Fairy on ordinary attacks',()=>{
 const r=fixture();r.party.statuses.W.items=[{name:'fieldgen0'}];r.controller.setSettings({useFieldGenerators:false});r.sight('tinyp');
 assert.equal(r.controller.control('W').deployer,null);
});

test('committed passive sighting interrupts eligible grouped travel; passing sighting preserves route',()=>{
 for(const keepMoving of [false,true]) {
  const r=fixture();groupRare(r,'goo');r.party.groupedCombat.target=null;r.party.activeConvoy={purpose:'farm-relocation',phase:'travel'};
  r.controller.setSettings({rules:{bee:{enabled:true,keepMoving,priority:100}}});r.sight('bee');
  assert.equal(r.controller.encounter(),!keepMoving);assert.equal(!!r.party.activeConvoy,keepMoving);
  assert.equal(r.starts(),0,'movement ownership hands to the existing combat queue');
 }
});

for(const mtype of ['phoenix','tinyp'])test(mtype+' committed by travel retains its convoy and avoids a competing farming return',()=>{
 const r=fixture();const target=groupRare(r,mtype,'engaged');
 const convoy={id:'travel-stop',purpose:'monster-hunt',phase:'defending',huntTravel:{reason:'passive-setting'}};
 r.party.activeConvoy=convoy;r.sight(mtype);
 assert.equal(r.party.activeConvoy,convoy);assert.equal(r.party.rareHuntReturn,null);assert.equal(r.starts(),0);
 r.party.groupedCombat.fights=[];r.party.groupedCombat.target=null;
 r.party.groupedCombat.deaths=[{...target,at:r.time(),partyEngaged:true}];
 r.controller.tick();assert.equal(r.party.activeConvoy,convoy);assert.equal(r.starts(),0);
});
