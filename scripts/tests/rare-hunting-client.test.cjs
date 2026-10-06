const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const source = fs.readFileSync('characters/shared.js','utf8');
function fixture() {
  let time=10000, equips=0, moves=0, stops=0;
  const entity={id:'fairy',mtype:'tinyp',type:'monster',map:'main',x:100,y:0,hp:5600,visible:true};
  const c = require('./helpers/client-dependencies.cjs').passingContext({ character:{name:'M',map:'main',in:'main',x:0,y:0,items:[{name:'fieldgen0'}]},
    parent:{entities:{fairy:entity}},get_entity:id=>c.parent.entities[id], Date:{now:()=>time},
    navigationIntent:{revision:1},rareControlAt:time, rarePath:null,rareNavigation:null,rareDeployment:null,
    passiveRareHunts:{tinyp:true,phoenix:true,goldenbat:true,cutebee:true,hen:true,rooster:true},rareKnown:{},rareKills:[],rareLoot:null,rareLootPending:false, leader:'W',partyTownActive:false,eventTraveling:false,joinedEvent:null,
    escapeOwns:()=>false,isExternallyClaimedMonster:()=>false,convoyTraveling:null,partyConvoyActive:false,
    banking:false,stocking:false,upgrading:false,forceTraveling:false,townTraveling:false,groupedFarming:()=>false,
    rareControlState:{id:'e1',kind:'encounter',revision:1,target:{...entity,in:'main'},destination:entity,deployer:'M'},
    equip:()=>{equips++;return Promise.resolve();},smart:{},
    stop:()=>{stops++;return Promise.resolve();},smart_move:()=>{moves++;c.smart.on_done=()=>{};return new Promise(()=>{});},
  });
  vm.runInContext(source.slice(source.indexOf('  function rareSightings('),source.indexOf('  function mapEntity(')),c);
  vm.runInContext(source.slice(source.indexOf('  function eligibleDepartureChests('),source.indexOf('  async function smartLoot(')),c);
  return {c,entity,advance:ms=>time+=ms,equips:()=>equips,moves:()=>moves,stops:()=>stops};
}
test('active assistance permission survives the first grouped fight handoff but expires with its revision or heartbeat',()=>{
  const {c,advance}=fixture();c.rareControlState={kind:'patrol',allowPhoenixAssist:true,revision:1};
  c.unfinishedFight=()=>true;c.groupedCombat={target:{id:'phoenix'}};
  assert.equal(c.rareActive(),false,'local patrol movement yields to grouped combat');
  assert.equal(c.rareControlCurrent(),true,'assistance stays authorized while encounter control catches up');
  c.navigationIntent.revision=2;assert.equal(c.rareControlCurrent(),false);
  c.navigationIntent.revision=1;advance(3501);assert.equal(c.rareControlCurrent(),false);
});

test('carried generator is consumed at most once and only inside deployment range',()=>{
  const r=fixture();r.entity.x=400;r.c.pollRareHunting();assert.equal(r.equips(),0);assert.equal(r.moves(),1);
  r.entity.x=100;r.c.pollRareHunting();r.c.pollRareHunting();assert.equal(r.equips(),1);
  assert.equal(r.c.rareDeployment.encounterId,'e1');
});
test('inventory changes fail deployment safely, and field confirmation releases only basic attacks',()=>{
  const r=fixture();r.c.character.items=[];r.c.pollRareHunting();assert.equal(r.equips(),0);assert.equal(r.c.rareDeployment.failed,true);
  assert.equal(r.c.rareAttackAllowed(r.entity,'attack'),false);
  r.c.rareControlState.deployer=null;assert.equal(r.c.rareAttackAllowed(r.entity,'attack'),true);
  for(const skill of ['burst','cburst','curse','taunt','stomp']) assert.equal(r.c.rareAttackAllowed(r.entity,skill),false);
  assert.equal(r.c.rareAttackAllowed({mtype:'fieldgen0'},'attack'),false);
});
test('stale instructions, wrong instance and changed navigation cannot attack Fairy',()=>{
  const r=fixture();r.c.rareControlState.deployer=null;r.c.character.in='other';assert.equal(r.c.rareTarget(),null);
  r.c.character.in='main';r.c.navigationIntent.revision=2;assert.equal(r.c.rareTarget(),null);
  r.c.navigationIntent.revision=1;r.advance(3501);assert.equal(r.c.rareTarget(),null);
});
test('new movement owner is not stopped by cancellation of the old rare path',()=>{
  const r=fixture();r.entity.x=400;r.c.pollRareHunting();r.c.smart.on_done=()=>{};
  r.c.rareControlState=null;r.c.pollRareHunting();assert.equal(r.stops(),0);assert.equal(r.c.rarePath,null);
});

test('fast encounter handoff releases only the patrol convoy and ignores older controls',()=>{
 const r=fixture();r.c.root={};let released=0;
 r.c.releaseConvoyCruise=()=>released++;
 const old={purpose:'phoenix-patrol',release(){released++;},detachRoute(){released++;}};
 r.c.convoyTraveling=old;r.c.partyConvoyActive=true;
 const control={id:'phoenix',kind:'encounter',revision:1,target:{...r.entity,in:'main'},destination:r.entity};
 r.c.acceptRareCombatControl({serverNow:200,rareControl:control,convoySignal:null});
 assert.equal(old.cancelled,true);assert.equal(r.c.convoyTraveling,null);assert.equal(r.c.partyConvoyActive,false);
 assert.equal(released,3);assert.equal(r.stops(),1);
 r.c.acceptRareCombatControl({serverNow:199,rareControl:null});assert.equal(r.c.rareControlState.id,'phoenix');
});
test('hidden field generators are reported without dashboard map subscriptions',()=>{
  const r=fixture();r.c.parent.entities.field={id:'field',mtype:'fieldgen0',visible:false,hp:6400,x:50,y:50};
  assert.equal(r.c.rareFields().length,1);assert.equal(r.c.rareSightings()[0].id,'fairy');
});

test('loot failures do not report success and remain retryable',async()=>{
  const r=fixture();r.c.character.x=100;r.c.rareControlState.kind='loot';
  r.c.rareControlState.deployer=null;r.c.smartLoot=async()=>{throw new Error('loot_no_space');};
  r.c.pollRareHunting();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.c.rareLoot.complete,false);assert.equal(r.c.rareLootPending,false);
});

test('grouped rare uses shared combat movement even when unseen; Fairy lock still permits basic attacks',()=>{
 const r=fixture();r.c.groupedFarming=()=>true;r.c.rareControlState.deployer=null;
 r.c.unfinishedFight=()=>true;r.c.groupedCombat={target:{id:'fairy'}};
 assert.equal(r.c.rareAttackAllowed(r.entity,'attack'),true);
 r.entity.visible=false;assert.equal(r.c.pollRareHunting(),false);assert.equal(r.moves(),0);
 r.c.groupedCombat.target.id='boar';assert.equal(r.c.rareActive(),false);
});
test('grouped Fairy deployer recovers locally when out of range and consumes generator nearby',()=>{
 const r=fixture();r.c.groupedFarming=()=>true;r.entity.x=400;
 assert.equal(r.c.pollRareHunting(),false);assert.equal(r.moves(),0);
 r.entity.x=100;r.c.pollRareHunting();assert.equal(r.equips(),1);
});

test('owned committed Fairy permits basic attacks without a separate rare controller',()=>{
 const r=fixture(),c=r.c,t={...r.entity,in:'main',server:'USII'};
 c.rareControlState=null;c.convoyTraveling={phase:'defending',navigationRevision:1};c.groupedFresh=()=>true;c.groupedCombat={target:t};c.reunionRealm=()=> 'USII';
 c.passingKey=e=>JSON.stringify([e.server,e.map,e.in,e.id]);
 const control={defending:true,committed:[t]};c.huntTravelControl=()=>control;
 assert.equal(c.rareTarget(),r.entity);assert.equal(c.rareAttackAllowed(r.entity,'attack'),true);
 assert.equal(c.rareAttackAllowed(r.entity,'burst'),false);
 control.committed=[];assert.equal(c.rareTarget(),null);
 control.committed=[t];c.groupedFresh=()=>false;assert.equal(c.rareTarget(),null);
});

// Failure inventory: e2e/phoenix-search-failures.md (4b). Written before the change.
test('a route that failed during the encounter is retried for its loot stage after five seconds',()=>{
  const r=fixture(),c=r.c;
  c.rareControlState={id:'e1',kind:'loot',revision:1,target:{...r.entity,in:'main'},destination:{map:'main',x:400,y:0}};
  c.rareNavigation={id:'e1',failed:true,at:c.Date.now(),reason:'Unattributed movement stop'};
  c.pollRareHunting();assert.equal(r.moves(),0,'no immediate retry');
  r.advance(5001);c.rareControlAt=c.Date.now();
  c.pollRareHunting();assert.equal(r.moves(),1,'the leader walks to the kill to loot');
});
