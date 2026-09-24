const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../characters/shared.js'), 'utf8');
function setup() {
  let casts = 0;
  const c = vm.createContext({
    character: { name: 'Warrior', ctype: 'warrior', map: 'main', in: 'main', x: 0, y: 0, mp: 120, max_mp: 1000, slots: { mainhand: { name: 'basher' } } },
    G: { skills: { stomp: { mp: 120, range: 400 } }, items: { basher: { wtype: 'basher' }, fireblade: { wtype: 'short_sword' } } }, farmingMode: 'default', unfinishedFight:()=>false,
    parent: { entities: { m: { type: 'monster', visible: true, target: 'Ally', x: 20, y: 0 } } },
    partyPositions: [{ name: 'Ally', map: 'main', in: 'main', hp: 59, max_hp: 100, seenAt: Date.now() }],
    currentPartyList: () => ['Warrior', 'Ally'], is_on_cooldown: () => false, can_use: () => true,
    isCurrentlyKiting: () => false, sameEventTeamMember: () => true, get_entity: () => null,
    use_skill: async skill => { assert.equal(skill, 'stomp'); casts++; },
  });
  vm.runInContext(source.slice(source.indexOf('  async function emergencyWarriorStomp('), source.indexOf('  async function kiteIfNeeded(')), c);
  return { c, casts: () => casts };
}
test('low ally HP repeats Stomp with exactly its cost and stops at 60%', async () => {
  const { c, casts } = setup();
  assert.equal(await c.emergencyWarriorStomp(), true);
  assert.equal(await c.emergencyWarriorStomp(), true);
  assert.equal(casts(), 2);
  c.partyPositions[0].hp = 60;
  assert.equal(await c.emergencyWarriorStomp(), false);
});
test('self kiting, ally kiting, and two own attackers each trigger independently', async () => {
  const { c } = setup();
  c.partyPositions[0].hp = 100;
  c.isCurrentlyKiting = () => true;
  assert.equal(await c.emergencyWarriorStomp(), true);
  c.isCurrentlyKiting = () => false;
  c.partyPositions[0].kiting = true;
  assert.equal(await c.emergencyWarriorStomp(), true);
  c.partyPositions[0].kiting = false;
  c.parent.entities.m.target = 'Warrior';
  c.parent.entities.n = { ...c.parent.entities.m };
  assert.equal(await c.emergencyWarriorStomp(), true);
  delete c.parent.entities.n;
  assert.equal(await c.emergencyWarriorStomp(), false);
});
test('cooldown, insufficient MP, unusable skill, scatter, stale/distant party and empty range do not cast', async () => {
  for (const change of [c => c.is_on_cooldown = () => true, c => c.character.mp = 119,
    c => c.can_use = () => false, c => c.farmingMode = 'scatter',
    c => c.partyPositions[0].seenAt = 1, c => c.partyPositions[0].in = 'other',
    c => c.partyPositions[0].rip = true, c => c.partyPositions[0].name = 'Outsider',
    c => c.parent.entities.m.x = 1000]) {
    const { c, casts } = setup(); change(c);
    assert.equal(await c.emergencyWarriorStomp(), false);
    assert.equal(casts(), 0);
  }
});

test('incompatible or missing weapon data skips Stomp even when can_use returns true', async () => {
  for (const change of [
    c => c.character.slots.mainhand = { name: 'fireblade' },
    c => c.character.slots.mainhand = null,
    c => delete c.character.slots,
    c => c.character.slots.mainhand = { name: 'unknown' },
    c => delete c.G.items,
    c => delete c.G.items.basher.wtype,
  ]) {
    const { c, casts } = setup();
    change(c);
    assert.equal(c.can_use('stomp'), true);
    assert.equal(await c.emergencyWarriorStomp(), false);
    assert.equal(casts(), 0);
  }
});

test('Stomp rechecks the equipped weapon after every swap', async () => {
  const { c, casts } = setup();
  c.character.slots.mainhand = { name: 'fireblade' };
  assert.equal(await c.emergencyWarriorStomp(), false);
  assert.equal(casts(), 0);
  c.character.slots.mainhand = { name: 'basher' };
  assert.equal(await c.emergencyWarriorStomp(), true);
  assert.equal(casts(), 1);
  c.character.slots.mainhand = { name: 'fireblade' };
  assert.equal(await c.emergencyWarriorStomp(), false);
  assert.equal(casts(), 1);
});

test('defensive stomp is withheld when it would include a neutral monster',async()=>{
 const {c,casts}=setup();c.unfinishedFight=()=>true;c.leaderLockAllows=()=>false;
 assert.equal(await c.emergencyWarriorStomp(),false);assert.equal(casts(),0);
 c.leaderLockAllows=()=>true;assert.equal(await c.emergencyWarriorStomp(),true);assert.equal(casts(),1);
});
