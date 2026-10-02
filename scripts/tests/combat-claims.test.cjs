const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../characters/shared.js'), 'utf8');
function setup() {
  const entities = {};
  const context = vm.createContext({
    isPassingEncounter:()=>false,passiveHunting:{rules:{}},root: {}, farmingTravelToken: null, selectFarmCandidates: targets=>targets, inFarmRadius:()=>false,
    activeCombatEvent:()=>false, joinedEvent:null, lastAttackTarget:null, lastAttackAt:0, inFarmArea:()=>true, partyLocation:null, farmApproach:{failed:{}},
    character: { name: 'Us', x: 0, y: 0 }, parent: { entities },
    G: { monsters: { goo: {}, phoenix: { cooperative: true } } },
    get_entity: id => entities[id], currentPartyList: () => ['Us', 'Ally'],
    eventTargetTypes: [], combatTargetId: '1', convoyTraveling: null,
    partyThreats: [], scatterBreakTarget: null, farmingMode: 'default',
    followLeader: false, leader: null, monsterFocus: ['goo'], isPartyThreat: () => false,
    monsterSearchRadius: 500, partyTargets: [], monsterPriority: () => 50,
    monsterPriorities: {}, passiveRareHunts: {}, get_nearest_monster: () => null,
    partyPositions: [{ name: 'Ally' }, { name: 'Stranger' }], sameEventTeamMember: () => true,
  });
  vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source, 'passiveLevelAllowed'), context);
 vm.runInContext(source.slice(source.indexOf('  function dungeonOwned()'), source.indexOf('  function cavePartyNames()')), context);
  vm.runInContext(source.slice(source.indexOf('  function isExternallyClaimedMonster('), source.indexOf('  function sameEventTeamMember(')), context);
  vm.runInContext(source.slice(source.indexOf('  function engagedMonster('), source.indexOf('  async function afterCombat(')), context);
  vm.runInContext(source.slice(source.indexOf('  function isAttackingPartyMember('), source.indexOf('  function getNearestPartyAttacker(')), context);
  vm.runInContext('var select = {' + source.slice(source.indexOf('    getNearestFocusedMonster: function'), source.indexOf('    getPreferredTarget: function')) + '};', context);
  entities['1'] = { id: '1', type: 'monster', mtype: 'goo', visible: true, x: 10, y: 0, hp: 100 };
  return { context, entities };
}
test('a first-hit collision invalidates a locked target using the latest server claim', () => {
  const { context: c, entities } = setup();
  const selected = { ...entities['1'] };
  assert.equal(c.isAllowedTarget(selected), true);
  entities['1'].target = 'Stranger';
  assert.equal(c.isAllowedTarget(selected), false, 'stale selected object must not bypass the claim');
  assert.equal(c.engagedMonster(), null);
  assert.equal(c.combatTargetId, null);
  assert.equal(c.select.getNearestFocusedMonster(), null, 'do not reacquire the contested monster');
});
test('party defense reads the current claim and includes the character itself', () => {
  const { context: c, entities } = setup();
  entities['1'].mtype = 'phoenix';
  entities['1'].target = 'Ally';
  const selected = { ...entities['1'] };
  assert.equal(c.isAttackingPartyMember(selected), true);
  entities['1'].target = 'Stranger';
  assert.equal(c.isAttackingPartyMember(selected), false, 'cached party positions and stale target cannot authorize taunt');
  entities['1'].target = null;
  assert.equal(c.isAttackingPartyMember(selected), false);
  entities['1'].target = 'Us';
  assert.equal(c.isAttackingPartyMember(selected), true, 'self attackers require defense too');
});
test('the warrior Taunt call obeys the live party-claim guard', async () => {
  const { context: c, entities } = setup();
  const casts = [];
  c.character.mp = 100;
  c.G.skills = { taunt: { mp: 10 } };
  c.is_on_cooldown = () => false;
  c.is_in_range = () => true;
  c.use_skill = async (skill, target) => { casts.push([skill, target.id]); };
  c.sharedRoutine = {
    isLeader: () => true,
    getFarmingMode: () => 'default',
    isAttackingPartyMember: c.isAttackingPartyMember,
  };
  const roles = fs.readFileSync(require('node:path').join(__dirname, '../../.build/runtime/roles.js'), 'utf8');
  Object.assign(c, { setTimeout, clearTimeout });
  vm.runInContext(roles, c);
  for (const mtype of ['goo', 'phoenix']) {
    entities['1'].mtype = mtype;
    entities['1'].target = 'Ally';
    const selected = { ...entities['1'] };
    casts.length = 0;
    await c.partyRoles.warrior.beforeAttack(selected);
    assert.deepEqual(casts, [['taunt', '1']]);
    for (const owner of ['Stranger', null, 'Us']) {
      entities['1'].target = owner;
      casts.length = 0;
      await c.partyRoles.warrior.beforeAttack(selected);
      assert.equal(casts.length, 0, `${mtype}: must not taunt current owner ${owner}`);
    }
  }
});
test('party claims and cooperative monsters remain eligible; ordinary outside claims do not', () => {
  const { context: c, entities } = setup();
  for (const owner of [null, 'Us', 'Ally']) {
    entities['1'].target = owner;
    assert.equal(c.isAllowedTarget(entities['1']), true);
  }
  entities['1'].target = 'Stranger';
  entities['1'].mtype = 'phoenix';
  assert.equal(c.isAllowedTarget(entities['1']), false);
  c.eventTargetTypes=['phoenix'];assert.equal(c.isAllowedTarget(entities['1']),true);
  entities['1'].mtype = 'goo';
  c.eventTargetTypes = ['goo'];
  assert.equal(c.isAllowedTarget(entities['1']), true, 'preserve explicit event combat');
});
test('a contested high-priority monster does not hide a valid lower-priority target', () => {
  const { context: c, entities } = setup();
  entities['1'].target = 'Stranger';
  entities['2'] = { ...entities['1'], id: '2', target: null, x: 30 };
  c.monsterPriority = target => target.id === '1' ? 100 : 1;
  assert.equal(c.select.getNearestFocusedMonster().id, '2');
  entities['1'].target = 'Ally';
  assert.equal(c.select.getNearestFocusedMonster().id, '1', 'a legitimate claim change makes it eligible again');
});

test('only fresh active patrol permission allows assisting another player with Phoenix',()=>{
  const {context:c,entities}=setup();const phoenix=entities['1'];phoenix.mtype='phoenix';phoenix.target='Stranger';
  c.rareControlState={allowPhoenixAssist:true};c.rareControlCurrent=()=>true;
  assert.equal(c.isAllowedTarget(phoenix),true);
  c.rareControlCurrent=()=>false;assert.equal(c.isAllowedTarget(phoenix),false);
  c.rareControlCurrent=()=>true;c.rareControlState.allowPhoenixAssist=false;assert.equal(c.isAllowedTarget(phoenix),false);
  c.rareControlState.allowPhoenixAssist=true;phoenix.mtype='goo';assert.equal(c.isAllowedTarget(phoenix),false);
});
