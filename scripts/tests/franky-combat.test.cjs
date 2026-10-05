const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
function load(c, name) {
  const start = source.search(new RegExp('^  (?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, name);
  const tail = source.slice(start), end = tail.indexOf('\n  }') + 4;
  vm.runInContext(tail.slice(0, end), c);
}
function fixture(range = 100) {
  const moves = [], stops = [];
  const c = vm.createContext({
    character: {name:'Hero',map:'level2w',in:'room',x:0,y:0,range,speed:40},
    G:{maps:{level2w:{event:'franky'}}}, parent:{entities:{}},
    passiveHunting:{rules:{}}, passiveLevelAllowed:()=>true, eventSelected:()=>true, joinedEvent:'franky', navigationIntent:{cancelled:false},
    escapeOwns:()=>false, eventExitOwnsMovement:()=>false,
    convoyTraveling:null,townTraveling:false,partyTownActive:false,forceTraveling:false,
    banking:false,stocking:false,upgrading:false,anniversaryBusy:false,anniversaryStaging:false,eventTraveling:false,
    eventTargetTypes:['wrong-sprite'],travellingEventName:null,combatTargetId:null,
    formationState:{},kiteState:{},can_move_to:()=>true,
    move:(x,y)=>{moves.push({x,y});Object.assign(c.character,{moving:true,going_x:x,going_y:y});},
    stop:kind=>{stops.push(kind);c.character.moving=false;},
    is_in_range:t=>Math.hypot(t.x-c.character.x,t.y-c.character.y)<=c.character.range,
    isLiveAbtesting:()=>false,
    // These cases cover the tank routine (what auto mode starts as); off-tank is a separate state machine.
    frankyRoutine:'tank',frankyFleeState:{phase:'none',homeMap:null,since:0},frankyLastKnown:null,
  });
  c.root=c;
  for(const name of ['frankyCombatActive','frankyTargetAllowed','nearestEventTarget','desiredCombatRange',
    'combatDistance','combatApproachPoint','resetCombatMovement','sendCombatMove','frankyTankMovementTick','frankyMovementTick']) load(c,name);
  const add=(id, extra={})=>c.parent.entities[id]={id,type:'monster',mtype:'franky',visible:true,hp:100,dead:false,
    map:'level2w',in:'room',x:200,y:0,...extra};
  return {c,add,moves,stops};
}
test('Franky ignores sprite metadata and closer adds, retaining a living boss with deterministic fallback',()=>{
  const {c,add}=fixture();add('add',{mtype:'wrong-sprite',x:1,target:'Hero'});
  const b=add('b'),a=add('a');assert.equal(c.nearestEventTarget(),a);
  c.combatTargetId='b';assert.equal(c.nearestEventTarget(),b);
  b.dead=true;assert.equal(c.nearestEventTarget(),a);
  a.in='other';assert.equal(c.nearestEventTarget(),null);
  a.in='room';a.hp=0;assert.equal(c.nearestEventTarget(),null);
  a.hp=100;a.visible=false;assert.equal(c.nearestEventTarget(),null);
});
test('attendance persists without event targets, but yields to exit, manual navigation and other owners',()=>{
  const {c}=fixture();c.eventTargetTypes=[];assert.equal(c.frankyCombatActive(),true);
  for(const name of ['convoyTraveling','townTraveling','forceTraveling','anniversaryBusy','eventTraveling','__partySharedWalking']) {
    c[name]=true;assert.equal(c.frankyCombatActive(),false,name);c[name]=false;
  }
  c.navigationIntent.cancelled=true;assert.equal(c.frankyCombatActive(),false);
  c.navigationIntent.cancelled=false;c.eventExitOwnsMovement=()=>true;assert.equal(c.frankyCombatActive(),false);
});
for(const range of [30,100,200]) test(`range ${range}: approach through adds, hold even too close, reapproach and stop on absence`,()=>{
  const {c,add,moves,stops}=fixture(range),boss=add('boss',{x:range+100});
  add('add',{mtype:'bat',x:5,range:100,target:'Hero'});
  c.frankyMovementTick(boss);assert.equal(moves.length,1);assert.ok(moves[0].x>0);
  boss.x=1;c.frankyMovementTick(boss);assert.equal(moves.length,1);assert.deepEqual(stops,['move']);
  assert.equal(c.partyCombatPosition.mode,'franky-holding');
  boss.x=range+100;c.frankyMovementTick(boss);assert.equal(moves.length,2);
  c.frankyMovementTick(null);assert.equal(stops.length,2);assert.equal(c.partyCombatPosition.mode,'franky-waiting');
});
test('terrain blocks approach, while stopping never cancels another movement owner',()=>{
  const {c,add,moves,stops}=fixture(),boss=add('boss');c.can_move_to=()=>false;
  c.frankyMovementTick(boss);assert.equal(moves.length,0);assert.equal(c.partyCombatPosition.mode,'blocked');
  c.kiteState.destination={x:20,y:0};Object.assign(c.character,{moving:true,going_x:999,going_y:0});
  c.frankyMovementTick(null);assert.equal(stops.length,0);
  c.eventExitOwnsMovement=()=>true;assert.equal(c.frankyMovementTick(boss),false);
});
test('authorization rejects adds before defensive and old-target exceptions, and permits Franky during feed gaps',()=>{
  const {c,add}=fixture();Object.assign(c,{returnCombatActive:()=>false,travelCombatActive:()=>false,
    isPassingEncounter:()=>false,combatRecoveryActive:()=>false});load(c,'isAllowedTarget');
  const addTarget=add('add',{mtype:'bat',target:'Hero'}),boss=add('boss');
  c.combatTargetId='add';const diagnostic={};
  assert.equal(c.isAllowedTarget(addTarget,null,diagnostic),false);assert.match(diagnostic.reason,/Franky/);
  c.eventTargetTypes=[];assert.equal(c.isAllowedTarget(boss),true);
});

test('skill runtime restricts offensive and area casts but preserves friendly support',async()=>{
  const {fixture:skillFixture}=require('./helpers/skill-world.cjs');
  const {installSkillRuntime}=require('../../runtime/characters/skills/runtime.ts');
  const {decision}=require('../../runtime/characters/skills/types.ts');
  const r=skillFixture('ranger'),boss=r.add('boss',{mtype:'franky'}),add=r.add('add');
  r.w.context.mode='event';r.w.context.event='franky';
  const keys=['character','parent','G','distance'],saved=Object.fromEntries(keys.map(k=>[k,global[k]]));
  let engine;
  try {
    global.character=r.actor;
    global.G={skills:r.w.skills,items:{bow:{wtype:'bow'},shield:{type:'shield'},knifebelt:{}},conditions:{}};
    const casts=[];global.parent={entities:{boss,add},use_skill:async(id,arg)=>{casts.push([id,arg]);return {};}};
    const shared={bossCombatActive:()=>true,bossTargetAllowed:t=>t.mtype==='franky',combatContext:()=>r.w.context,
      skillTargetAllowed:()=>true}; // Runtime must defend even against a permissive candidate source.
    engine=installSkillRuntime({sharedRoutine:shared,partyCombatState:{}});
    assert.equal(await engine.cast(decision('supershot',[add])),false);
    assert.equal(await engine.cast(decision('3shot',[boss,add])),false);
    assert.equal(await engine.cast(decision('supershot',[boss])),true);
    r.actor.ctype='warrior';r.actor.slots.mainhand={name:'basher'};G.items.basher={wtype:'basher'};
    assert.equal(await engine.cast(decision('stomp',[],'survival')),false);
    r.actor.ctype='paladin';r.actor.hp=1000;
    assert.equal(await engine.cast(decision('selfheal',[],'survival')),true);
    assert.deepEqual(casts.map(c=>c[0]),['supershot','selfheal']);
  } finally {engine?.stop();for(const k of keys)if(saved[k]===undefined)delete global[k];else global[k]=saved[k];}
});
