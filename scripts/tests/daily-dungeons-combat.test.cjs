const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('characters/shared.js', 'utf8');
function fixture() {
  const actor = {name:'W',ctype:'warrior',map:'cave',in:'run',hp:100,max_hp:100,real_x:0,real_y:0,cave:{run:'run',paused:false}};
  const priest = {...actor,name:'P',ctype:'priest',hp:40};
  const enemies = {a:{id:'a',type:'monster',visible:true,hp:100,map:'cave',in:'run',target:'P'},
    b:{id:'b',type:'monster',visible:true,hp:100,map:'cave',in:'run',target:'W'}};
  const c = vm.createContext({dungeonOpenedChests:{},can_move_to:()=>true,character:actor,root:{},parent:{entities:enemies,chests:{}},
    currentPartyList:()=>['W','P'],get_player:name=>name==='W'?actor:priest,get_entity:id=>enemies[id],
    groupedFresh:()=>true,groupedCombat:{target:{id:'a'}},monsterPriority:()=>50,runtimeCurrent:()=>true,distance:()=>50,
    anniversaryWithTimeout:p=>p,loot:async()=>{}});
  vm.runInContext(source.slice(source.indexOf('  function dungeonOwned()'),source.indexOf('  function dungeonRuntime()')),c);
  return {c,actor,priest,enemies};
}
test('cave focus follows the shared queue and proactively admits visible enemy sides',()=>{
  const {c,actor,enemies}=fixture();
  enemies.neutral={...enemies.a,id:'neutral',target:null,cave:{side:'neutral'}};
  enemies.other={...enemies.a,id:'other',in:'other'};
  enemies.stranger={...enemies.a,id:'stranger',target:'Stranger'};
  enemies.spider={...enemies.a,id:'spider',target:null,cave:{side:'enemy'}};
  enemies.rat={...enemies.a,id:'rat',target:null,cave:{side:'predator'}};
  assert.equal(c.getDungeonTarget().id,'a');
  actor.target='b'; assert.equal(c.getDungeonTarget().id,'a');
  c.groupedCombat.target.id='b';assert.equal(c.getDungeonTarget().id,'b');
  for (const id of ['neutral','other','stranger']) assert.equal(c.dungeonTargetAllowed(enemies[id]),false);
  for (const id of ['spider','rat']) assert.equal(c.dungeonTargetAllowed(enemies[id]),true);
  enemies.b.dead=true;assert.equal(c.getDungeonTarget(),null);
  c.groupedFresh=()=>false;assert.equal(c.getDungeonTarget(),null);
});

test('cave looting opens only this instance, stops during votes and death',async()=>{
  const {c,actor}=fixture(); const opened=[]; c.parent.open_chest=async id=>opened.push(id);
  c.parent.chests={yes:{map:'cave',in:'run',x:10,y:0},wrong:{map:'cave',in:'other',x:10,y:0}};
  await c.lootDungeonChests(); assert.deepEqual(opened,['yes']);
  actor.cave.paused=true;await c.lootDungeonChests();
  actor.cave.paused=false;actor.rip=true;await c.lootDungeonChests();
  assert.deepEqual(opened,['yes']);
});
test('normal priest healing in cave uses live injured allies instead of pre-entry status',async()=>{
  const {c,actor,priest}=fixture(); actor.ctype='priest';actor.mp=100;
  c.partyPositions=[{...priest,map:'main',hp:100}];c.healingBusy=false;
  c.sameEventTeamMember=()=>true;c.isLiveAbtesting=()=>false;
  c.G={skills:{partyheal:{mp:100},heal:{mp:1}}};c.can_heal=()=>true;
  let healed;c.heal=async member=>{healed=member.name;};
  c.setTimeout=setTimeout;c.clearTimeout=clearTimeout;
  vm.runInContext(source.slice(source.indexOf('  async function healPartyBelow('),source.indexOf('  async function energizeLowestMana(')),c);
  assert.equal(await c.healPartyBelow(.9),true);assert.equal(healed,'P');
});

test('solo cave defense includes self and confirmed kills cannot keep the old focus',()=>{
  const {c,enemies}=fixture();c.currentPartyList=()=>[];c.groupedCombat.target.id='b';
  assert.equal(c.getDungeonTarget().id,'b');
  assert.equal(c.cavePartyMembers().length,1);
  c.root.partyRoleRunner={isKnownDead:id=>id==='b'};
  assert.equal(c.getDungeonTarget(),null);
});

test('cave queue survives farming reset and acknowledges before saved leader initialization',()=>{
  const now=Date.now();
  const next={caveScope:'run:0',leader:'W',members:['W','P'],seenAt:now,key:JSON.stringify(['runtime']),resetAt:0,target:null};
  const c=vm.createContext({character:{name:'P',cave:{run:'run',floor:0}},leader:null,
    root:{__partyCombatResetAt:now},groupedCombat:null,convoyRuntimeId:'runtime',coordinatorClockOffset:0,Date});
  vm.runInContext(source.slice(source.indexOf('  function acceptQueue('),source.indexOf('  function queueCandidates(')),c);
  vm.runInContext(source.slice(source.indexOf('  function groupedFresh('),source.indexOf('  function reportFightDeath(')),c);
  c.acceptQueue(next);assert.equal(c.groupedCombat,next);assert.equal(c.groupedFresh(),true);
  c.character.cave.floor=1;assert.equal(c.groupedFresh(),false);
});
test('cave healing roster uses captured participants when native party list is empty',()=>{
  const {c,actor}=fixture();actor.cave.floor=0;
  c.groupedCombat={caveScope:'run:0',members:['W','P']};c.currentPartyList=()=>[];
  assert.equal(c.cavePartyMembers().length,2);
});
