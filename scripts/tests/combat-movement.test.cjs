const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const roles = fs.readFileSync(process.env.AL_ROLES_SOURCE || '.build/runtime/roles.js', 'utf8');
const shared = fs.readFileSync(process.env.AL_SHARED_SOURCE || 'characters/shared.js', 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function runner(ctype = 'ranger', native = false, configure = () => {}) {
  let now = 1000, attacks = 0, moves = 0, heals = 0, ready = true, occupied = false;
  const intervals = [], timeouts = [];
  const target = { id: 'm', type: 'monster', mtype: 'goo', visible: true, x: 20, y: 0, map: 'main' };
  const character = { name: 'Us', ctype, map: 'main', moving: true, frequency: 2, slots: {mainhand:null,offhand:null}, items: [] };
  const routine = {
    isOccupied: () => occupied, getAbtestingMode: () => null, getFarmingMode: () => 'default',
    hasScatterBreakTarget: () => false, getScatterBreakTarget: () => null,
    getEventTarget: () => null, shouldFollowLeader: () => false, getPreferredTarget: () => target,
    allowsTarget: t => !t.claimed, setCombatTarget() {}, noteAttack() {}, followLeaderIfFar: async () => false,
    regenerateHpOrMp: () => new Promise(() => {}), smartLoot: async () => {},
    kiteIfNeeded: async () => false, approachCombatTarget: () => { moves++; return new Promise(() => {}); },
    basicAttackReserved: () => false, healPartyBelow: async () => { heals++; }, resetCombatMovement() {},
    useRecoveryPotion: async () => false, absorbSinsBelow: async () => false,
  };
  configure(routine);
  const c = vm.createContext({ character, parent: native ? {} : { caracAL: {} }, sharedRoutine: routine, get_entity: () => target,
    G: {items:{},classes:{},skills:{}},
    can_attack: () => ready, is_in_range: () => true, game_log() {},
    attack: () => { attacks++; return new Promise(() => {}); },
    Date: class extends Date { static now() { return now; } },
    setInterval: (fn, ms) => { const entry = { fn, ms }; intervals.push(entry); return entry; },
    clearInterval: entry => { if (entry) entry.off = true; },
    setTimeout: (fn, ms) => { const entry = {fn, ms, at: now + ms}; timeouts.push(entry); return entry; },
    clearTimeout: entry => { if (entry) entry.off = true; },
  });
  vm.runInContext(roles, c); c.partyRoleRunner.start();
  const attackTick = () => {
    const entry = timeouts.find(t => !t.off && String(t.fn).includes('tick()'));
    if (entry) { entry.off = true; entry.fn(); }
  };
  return { c, target, character, routine, intervals, timeouts, attackTick,
    advance: async value => {
      while (true) {
        const next = timeouts.filter(t=>!t.off && t.at<=value).sort((a,b)=>a.at-b.at)[0];
        if (!next) break;
        now=next.at; next.off=true; next.fn(); await flush();
      }
      now=value; await flush();
    }, attacks: () => attacks, moves: () => moves, heals: () => heals,
    now: value => now = value, ready: value => ready = value, occupied: value => occupied = value,
    run: async ms => {
      if (ms === 50) attackTick();
      else { intervals.filter(t => t.ms === ms && !t.off).forEach(t => t.fn()); if (ms === 250) c.partyRoleRunner.wake(); }
      await flush();
    } };
}

test('group commitment is checked at attack time while movement and defensive support remain available',async()=>{
  const r=runner();let committed=false;
  r.routine.groupedAttackAllowed=()=>committed;
  await flush();r.intervals.find(t=>t.ms===250).fn();await flush();
  r.attackTick();assert.equal(r.attacks(),0);
  committed=true;r.attackTick();assert.equal(r.attacks(),1);
  r.c.partyRoleRunner.stop();
});

test('warrior selects and taunts a passive Porcupine without attacking, allowing grouped casters to engage', async () => {
  for (const mode of ['default', 'scatter']) {
    const r = runner('warrior'); let selected = null, taunts = 0, changes = 0;
    Object.assign(r.character, { name: 'Leader', damage_type: 'physical', range: 30, mp: 500 });
    r.target.mtype = 'porcupine';
    Object.assign(r.routine, {
      isLeader: () => true,
      getFarmingMode: () => mode, getScatterTarget: () => r.target,
      getNearestPartyAttacker: () => null, getNearestPartyTarget: () => null,
      emergencyWarriorStomp: async () => false, regenerateHpOrMp: async () => false,
      isAttackingPartyMember: t => t.target === 'Ally',
    });
    Object.assign(r.c, {
      G: { skills: { taunt: { mp: 40 } } }, is_on_cooldown: () => taunts > 0,
      use_skill: async (skill, target) => { assert.equal(skill, 'taunt'); assert.equal(target, r.target); taunts++; },
      publishCombatSelection: target => { selected = target; }, root: {},
      change_target: target => { changes++; r.character.target = target.id; },
    });
    vm.runInContext('sharedRoutine.setCombatTarget = function(target) {' +
      shared.split('    setCombatTarget: function (target) {')[1].split('    noteAttack:')[0].replace(/},\s*$/, '}'), r.c);
    await r.run(250); await r.run(250); await r.run(50);
    assert.equal(selected, r.target); assert.equal(r.character.target, r.target.id);
    assert.equal(changes, 1); assert.equal(taunts, 1); assert.equal(r.attacks(), 0);
    for (const ctype of ['mage', 'priest']) {
      const ally = runner(ctype);
      Object.assign(ally.target, selected); ally.character.damage_type = 'magical'; ally.character.range = 200;
      ally.routine.usesLeaderTarget = () => true;
      ally.routine.getGroupedTarget = () => selected && ally.target;
      await ally.run(250); await ally.run(50);
      assert.equal(ally.attacks(), 1, ctype + ' attacks the selected Porcupine');
      ally.c.partyRoleRunner.stop();
    }
    r.c.partyRoleRunner.stop();
  }
});

test('dangerous monster guard checks current weapon stats immediately before attacking', async () => {
  const r = runner();
  r.target.mtype = 'porcupine'; r.character.damage_type = 'physical'; r.character.range = 30;
  await flush(); await r.run(250); await r.run(50);
  assert.equal(r.attacks(), 0);
  assert.match(r.c.partyCombatState.skippedAttack, /Porcupine/);
  r.character.range = 75; await r.run(50);
  assert.equal(r.attacks(), 1);
});

test('solo hunt can replace an untouched target but retains one with an attack in flight', async () => {
  for (const pending of [false,true]) {
    const r=runner();const near={...r.target,id:'near',x:5};let selected=r.target,resets=0;
    r.c.get_entity=id=>id==='near'?near:r.target;
    r.routine.setCombatTarget=t=>{selected=t;};
    r.routine.resetCombatMovement=()=>resets++;
    r.ready(pending);await r.run(250);
    if(pending){await r.run(50);assert.equal(r.attacks(),1);}
    r.routine.getCloserHuntTarget=current=>current.id===r.target.id?near:null;
    await r.run(250);
    assert.equal(selected.id,pending?r.target.id:'near');assert.equal(resets,pending?0:1);
    r.c.partyRoleRunner.stop();
  }
});

test('shared melee bow swap follows authoritative current target and blocks attacks until equipment settles', async () => {
  const r = runner('rogue'); let finishEquip;
  r.target.mtype = 'porcupine'; r.character.damage_type = 'physical'; r.character.range = 30;
  r.character.slots.mainhand = {name:'dagger'}; r.character.items = [{name:'bow',level:5}];
  r.c.G.items.bow = {wtype:'bow'}; r.c.G.classes.rogue = {mainhand:{bow:{}}};
  r.routine.equipmentTarget = () => null;
  r.c.equip = async (index, slot) => {
    await new Promise(resolve => { finishEquip=resolve; });
    const old=r.character.slots[slot];r.character.slots[slot]=r.character.items[index];r.character.items[index]=old;
    r.character.range=150;
  };
  await flush(); await r.run(100); assert.equal(finishEquip, undefined, 'null authoritative selection cannot fall back to stale local target');
  r.routine.equipmentTarget = () => r.target;
  await r.run(100); await r.run(50); assert.equal(r.attacks(),0);
  r.character.range=150; await r.run(50); assert.equal(r.attacks(),0,'pending equip blocks even a prematurely updated range stat');
  finishEquip(); await flush(); await r.run(50); assert.equal(r.attacks(),1);
  r.c.partyRoleRunner.stop();
});

test('reflection guard keeps priest healing available and permits physical ranged attacks', async () => {
  const r = runner('priest');
  r.target.mtype = 'tiger'; r.character.damage_type = 'magical'; r.character.range = 120;
  await flush(); await r.run(250); await r.run(50);
  assert.equal(r.attacks(), 0);
  assert.match(r.c.partyCombatState.skippedAttack, /reflection/);
  r.routine.basicAttackReserved = () => true;
  await r.run(50); assert.ok(r.heals() > 0); assert.equal(r.attacks(), 0);
  r.routine.basicAttackReserved = () => false;
  r.character.damage_type = 'physical'; await r.run(50);
  assert.equal(r.attacks(), 1);
});

test('moving attacks and movement continue while support and move promises never settle', async () => {
  const r = runner(); await flush(); await r.run(250); await r.run(100); await r.run(50);
  assert.equal(r.attacks(), 1); assert.equal(r.moves(), 1);
  await r.run(100); await r.run(50);
  assert.equal(r.moves(), 2); assert.equal(r.attacks(), 1, 'one outstanding attack');
  r.now(4000); r.ready(false); await r.run(50); assert.equal(r.attacks(), 1);
  r.ready(true); await r.run(50); assert.equal(r.attacks(), 2, 'lost response releases only after cooldown');
  r.c.partyRoleRunner.stop();
});

test('mage and priest combat follow the selected leader regardless of the Steam character', async () => {
  for (const steam of ['warrior', 'mage', 'priest']) {
    const mage = runner('mage', steam === 'mage'), priest = runner('priest', steam === 'priest');
    try {
      for (const r of [mage, priest]) {
        r.routine.usesLeaderTarget = () => true;
        r.routine.getGroupedTarget = () => r.target;
        r.occupied(true); await r.run(250); await r.run(50);
        assert.equal(r.attacks(), 0, 'owned travel still pauses combat');
        r.occupied(false); await r.run(250);
      }
      priest.routine.basicAttackReserved = () => true;
      await mage.run(50); await priest.run(50);
      assert.equal(mage.attacks(), 1);
      assert.equal(priest.heals(), 1);
      assert.equal(priest.attacks(), 0);
      priest.routine.getGroupedTarget = () => null;
      await priest.run(250); await priest.run(50);
      assert.equal(priest.heals(), 2, 'healing needs no offensive target');
      priest.routine.basicAttackReserved = () => false;
      priest.routine.getGroupedTarget = () => priest.target;
      await priest.run(250); await priest.run(50);
      assert.equal(priest.attacks(), 1, 'healthy party releases attack cooldown');
    } finally { mage.c.partyRoleRunner.stop(); priest.c.partyRoleRunner.stop(); }
  }
});

test('latest visibility, claims, map, death, ownership and reload block attacks', async () => {
  for (const change of [r => r.target.visible = false, r => r.target.claimed = true,
    r => r.target.map = 'winterland', r => r.character.rip = true, r => r.occupied(true),
    r => r.c.partyRoleRunner.stop()]) {
    const r = runner(); await flush(); change(r); await r.run(50);
    assert.equal(r.attacks(), 0); r.c.partyRoleRunner.stop();
  }
});

test('attack acknowledgement clears an older error but preserves a newer failure', async () => {
  for (const newer of [false, true]) {
    const r = runner();
    try {
      await flush();
      r.c.partyCombatState.error = 'too_far';
      r.c.partyCombatState.errorAt = 1;
      r.c.attack = async () => {
        if (newer) { r.c.partyCombatState.error = 'new failure'; r.c.partyCombatState.errorAt = 2000; }
      };
      await r.run(50);
      assert.equal(r.c.partyCombatState.error, newer ? 'new failure' : null);
    } finally { r.c.partyRoleRunner.stop(); }
  }
});

test('crab server rejection activates geometry correction, throttles, and expires without renewing on success',async()=>{
 const r=runner();await flush();let sent=0,corrected=51;
 r.target.mtype='crab';
 r.routine.describeAttackRange=target=>({targetId:target.id,map:'main',mtype:'crab',at:1000,range:30,
   actor:{x:0,y:0,width:26,height:36},target:{x:70,y:0,width:60,height:64},expected:{width:12,height:12},nativeDistance:27,correctedDistance:corrected});
 r.c.attack=async()=>{sent++;if(sent===1)throw {reason:'too_far',dist:51};};
 try {
  await r.run(50);assert.equal(sent,1);assert.equal(r.c.partyCombatState.rangeRecovery.active,true);
  r.now(1500);await r.run(50);assert.equal(sent,1,'still outside corrected range');
  corrected=28;r.now(1499);await r.run(50);assert.equal(sent,1,'minimum retry delay');
  r.now(1500);await r.run(50);assert.equal(sent,2);
  assert.equal(r.c.partyCombatState.error,null);assert.equal(r.c.partyCombatState.rangeRecovery.active,true);
  corrected=51;r.now(31000);await r.run(50);assert.equal(sent,3,'native range is probed after expiry');
  assert.equal(r.c.partyCombatState.rangeRecovery.active,false,'fixed server does not reactivate workaround');
 } finally {r.c.partyRoleRunner.stop();}
});

test('superseded crab attack rejection cannot activate correction for a new selection',async()=>{
 const r=runner();await flush();let reject;
 r.routine.describeAttackRange=()=>({targetId:'m',map:'main',mtype:'crab',range:30,
  target:{width:60,height:64},expected:{width:12,height:12},nativeDistance:27,correctedDistance:51});
 r.c.attack=()=>new Promise((_,fail)=>reject=fail);
 try {
  await r.run(50);r.target.visible=false;reject({reason:'too_far'});await flush();
  assert.equal(r.c.partyCombatState.rangeRecovery,undefined);
 } finally {r.c.partyRoleRunner.stop();}
});

test('healing reserves basic attack without stopping movement or waiting for support', async () => {
  const r = runner(); await flush(); r.routine.basicAttackReserved = () => true;
  await r.run(250); await r.run(100); await r.run(50);
  assert.equal(r.heals(), 1); assert.equal(r.attacks(), 0); assert.equal(r.moves(), 1);
  r.routine.basicAttackReserved = () => false; await r.run(50); assert.equal(r.attacks(), 1);
  r.c.partyRoleRunner.stop();
});

test('a moving grouped priest cannot acquire nearer B while leader A is selected or unavailable', async () => {
  const r = runner(); await flush();
  const leaderTarget = { ...r.target, id: 'A' };
  let available = true;
  r.routine.usesLeaderTarget = () => true;
  r.routine.getGroupedTarget = () => available ? leaderTarget : null;
  r.routine.allowsTarget = target => target.id === 'A';
  r.c.get_entity = id => id === 'A' && available ? leaderTarget : r.target;
  await r.run(250); await r.run(50);
  assert.equal(r.attacks(), 1);
  available = false; r.now(5000);
  await r.run(250); await r.run(50);
  assert.equal(r.attacks(), 1, 'nearer B cannot replace the leader target');
  r.c.partyRoleRunner.stop();
});

function geometry(range = 120) {
  const moves = [], target = { id: 'm', type: 'monster', visible: true, x: 0, y: 0, target: 'Us' };
  let now = 1000;
  const c = vm.createContext({ character: { name: 'Us', map: 'main', x: range - 5, y: 0,
    range, speed: 60, hp: 100, max_hp: 100 }, parent: { entities: { m: target } },
    kiteState: { targetId: null }, formationFrame: null, formationPerformance: { collisionChecks: 0 },
    can_move_to: () => true, is_in_range: () => true,
    move: (x, y) => { moves.push({ x, y }); return new Promise(() => {}); },
    Date: class extends Date { static now() { return now; } },
  }); c.root = c;
  vm.runInContext(shared.slice(shared.indexOf('  function desiredCombatRange('), shared.indexOf('  root.sharedRoutine = {')), c);
  return { c, target, moves, now: value => now = value };
}

test('full-health kiting refreshes before arrival for melee and ranged weapons', async () => {
  for (const range of [25, 60, 120, 240]) {
    const { c, target, moves, now } = geometry(range);
    c.character.x = c.desiredCombatRange();
    for (let i = 0; i < 30; i++) {
      now(1000 + i * 100); await c.kiteIfNeeded(target);
      const destination = moves.at(-1);
      const dx = destination.x - c.character.x, dy = destination.y - c.character.y, d = Math.hypot(dx, dy);
      assert.ok(d > 6, `range ${range}: segment lasts beyond next 100ms update`);
      c.character.x += dx / d * 6; c.character.y += dy / d * 6; c.character.moving = true;
    }
    assert.ok(moves.length > 20); assert.equal(c.kiteState.direction, 1);
  }
});

test('approach and retreat respect weapon range and the character side, including moving warriors', async () => {
  const { c, target, moves } = geometry(25); target.target = 'Ally'; c.character.x = 5;
  c.character.moving = true; c.leaderLocation = { map: 'main', x: -200, y: 0 };
  assert.equal(await c.kiteIfNeeded(target), false);
  await c.approachCombatTarget(target); assert.equal(moves.at(-1).x, 23);
  c.character.x = 100; await c.approachCombatTarget(target);
  assert.ok(moves.at(-1).x < 100 && moves.at(-1).x >= 23);
  c.character.range = 200; assert.equal(c.combatApproachPoint(target).x, 190);
});

test('blocked paths never fall back to unvalidated movement, and alternate kite direction works', async () => {
  const { c, target, moves } = geometry(); c.can_move_to = (_x, y) => y < 0;
  await c.kiteIfNeeded(target); assert.equal(c.kiteState.direction, -1);
  c.can_move_to = () => false; const count = moves.length;
  await c.kiteIfNeeded(target); assert.equal(moves.length, count); assert.equal(c.partyCombatPosition.mode, 'blocked');
  target.target = 'Ally'; c.character.x = 10; await c.approachCombatTarget(target);
  assert.equal(moves.length, count);
});

test('blocked kiting around an add yields to a safe approach toward the selected event boss', async () => {
  const { c, target, moves } = geometry(207);
  target.target = 'Ally'; target.x = -400; target.mtype = 'franky';
  c.character.x = 0; c.is_in_range = () => false;
  const add = { id: 'add', type: 'monster', visible: true, x: 0, y: 0, target: 'Us', range: 30 };
  c.parent.entities.add = add;
  // At this corner only westward travel is possible; kite arcs go east.
  c.can_move_to = x => x < 0;
  assert.equal(await c.kiteIfNeeded(target), false);
  assert.equal(c.partyCombatPosition.blockingAttacker, 'add');
  assert.equal(await c.approachCombatTarget(target), true);
  assert.ok(moves.at(-1).x < 0); assert.equal(c.partyCombatPosition.target, target.id);
});

test('blocked kite fallback cannot approach through another attacker or a wall', async () => {
  const { c, target, moves } = geometry(207);
  target.target = 'Ally'; target.x = -400; c.character.x = 0; c.is_in_range = () => false;
  c.parent.entities.add = { id: 'add', type: 'monster', visible: true, x: -25, y: 0, target: 'Us', range: 30 };
  c.can_move_to = (x, y) => x < 0 && Math.abs(y) < 1;
  assert.equal(await c.kiteIfNeeded(target), false);
  assert.equal(await c.approachCombatTarget(target), false);
  assert.equal(moves.length, 0); assert.equal(c.partyCombatPosition.blockingAttacker, 'add');
  assert.match(c.partyCombatPosition.reason, /attacker clearance/);
});

test('event add avoidance closes boss range first and cannot kite away from the boss', async () => {
  const {c,target,moves}=geometry(207);
  c.eventTargetTypes=['franky'];target.mtype='franky';target.target='Ally';
  c.character.x=350;c.is_in_range=()=>Math.hypot(c.character.x-target.x,c.character.y-target.y)<=207;
  c.parent.entities.add={id:'add',type:'monster',visible:true,x:350,y:0,target:'Us'};
  assert.equal(await c.kiteIfNeeded(target),true);
  assert.ok(moves.at(-1).x<350);assert.equal(c.partyCombatPosition.target,target.id);
  c.character.x=190;c.parent.entities.add.x=180;
  assert.equal(await c.kiteIfNeeded(target),true);
  assert.ok(Math.hypot(moves.at(-1).x,moves.at(-1).y)<=c.desiredCombatRange());
});

test('event corner search finds another safe direction while remaining in boss range', async () => {
  const {c,target,moves}=geometry(207);
  c.eventTargetTypes=['franky'];target.mtype='franky';target.target='Ally';
  c.character.x=190;
  c.parent.entities.add={id:'add',type:'monster',visible:true,x:180,y:0,target:'Us'};
  c.can_move_to=(x,y)=>x<190 && y>10;
  assert.equal(await c.kiteIfNeeded(target),true);
  assert.ok(moves.at(-1).y>10);assert.ok(Math.hypot(moves.at(-1).x,moves.at(-1).y)<=c.desiredCombatRange());
  c.can_move_to=()=>false;const count=moves.length;
  assert.equal(await c.kiteIfNeeded(target),false);assert.equal(moves.length,count);
});

test('Dash cannot overshoot the weapon range boundary', async () => {
  const { c, target } = geometry(25); let casts = 0;
  Object.assign(c, { G: { skills: { dash: { mp: 10 } } }, is_on_cooldown: () => false,
    can_use: () => true, use_skill: async () => casts++ });
  Object.assign(c.character, { ctype: 'warrior', mp: 100, max_mp: 100, x: 60 });
  vm.runInContext(shared.slice(shared.indexOf('  async function dashToward('), shared.indexOf('  function isPartyHealthy(')), c);
  assert.equal(await c.dashToward(target), false);
  c.character.x = 80; assert.equal(await c.dashToward(target), true); assert.equal(casts, 1);
});


test('burst sends one immediate and four interval attempts, and compensates once for duplicate successes', async () => {
  const r=runner(), pending=[];
  r.c.parent.next_skill={attack:1100}; r.c.parent.pings=[20,30];
  r.c.attack=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
  let reductions=0;
  r.c.reduce_cooldown=(name,ms)=>{assert.equal(name,'attack');assert.equal(ms,20);reductions++;r.c.parent.next_skill.attack-=ms;};
  await r.advance(1097); assert.equal(pending.length,0);
  await r.advance(1098); assert.equal(pending.length,1);
  await r.advance(1102); assert.equal(pending.length,5);
  await r.advance(1200); assert.equal(pending.length,5);
  r.c.parent.next_skill.attack=1700;
  pending.forEach(p=>p.resolve());await flush();
  assert.equal(reductions,1);assert.equal(r.c.partyCombatState.attackTiming.accepted,1);
  await r.advance(1677);assert.equal(pending.length,5);
  await r.advance(1678);assert.equal(pending.length,6);
  r.c.partyRoleRunner.stop();
});

test('late scheduler sends one attack instead of replaying expired burst slots', async () => {
  const r=runner();r.c.parent.next_skill={attack:1100};
  r.now(1150);r.attackTick();await flush();await r.advance(1200);
  assert.equal(r.attacks(),1);r.c.partyRoleRunner.stop();
});

test('early cooldown rejection preserves later slots, success cancels unsent attempts', async () => {
  const r=runner();let sent=0;
  r.c.parent.next_skill={attack:1100};
  r.c.attack=()=>{sent++;if(sent===1)return Promise.reject({reason:'cooldown'});r.c.parent.next_skill.attack=1600;return Promise.resolve();};
  await r.advance(1105);
  assert.equal(sent,2);assert.equal(r.c.partyCombatState.attackTiming.cooldownRejections,1);
  r.c.partyRoleRunner.stop();await r.advance(2000);assert.equal(sent,2);
});

test('healing reservation cancels remaining burst slots', async () => {
  const r=runner('priest');r.c.parent.next_skill={attack:1100};
  await r.advance(1098);assert.equal(r.attacks(),1);
  r.routine.basicAttackReserved=()=>true;
  await r.advance(1105);assert.equal(r.attacks(),1);r.c.partyRoleRunner.stop();
});

test('selection retains a valid target and immediately changes on confirmed death', async () => {
  const r=runner();let choices=0;
  r.routine.getPreferredTarget=()=>{choices++;return r.target;};
  await flush();await r.run(1000);await r.run(1000);assert.equal(choices,0);
  const old=r.target.id;r.target.id='next';r.c.partyRoleRunner.invalidateTarget(old);await flush();
  assert.equal(choices,1);assert.equal(r.c.partyRoleRunner.isKnownDead(old),true);
  await r.run(50);assert.equal(r.attacks(),1);r.c.partyRoleRunner.stop();
});

test('successor wake uses the existing attack deadline and ignores the previous target promise', async () => {
 for(const deadline of [1000,1600]) {
  const r=runner(),sent=[],pending=[];
  r.c.parent.next_skill={attack:1000};
  r.c.attack=t=>{sent.push({id:t.id,at:r.c.Date.now()});return new Promise(resolve=>pending.push(resolve));};
  await r.advance(1001);assert.equal(sent[0].id,'m');
  const next={...r.target,id:'next'};
  r.c.parent.next_skill.attack=deadline;
  r.c.get_entity=id=>id==='next'?next:r.target;
  r.routine.getPreferredTarget=()=>next;
  r.c.partyRoleRunner.invalidateTarget('m');await flush();
  await r.advance(deadline===1000?1002:1597);
  assert.equal(sent.filter(t=>t.id==='next').length,deadline===1000?1:0);
  if(deadline===1600)await r.advance(1598);
  assert.equal(sent.find(t=>t.id==='next').at,deadline===1000?1002:1598);
  pending[0]();await flush();
  assert.equal(r.c.partyCombatState.attackTiming.accepted,0,'old success cannot settle the new flight');
  r.c.partyRoleRunner.stop();
 }
});

test('a revoked fight authorization cancels the remaining four attack attempts',async()=>{
 const r=runner();r.c.parent.next_skill={attack:1100};let allowed=true;
 r.routine.groupedAttackAllowed=()=>allowed;
 await r.advance(1098);assert.equal(r.attacks(),1);allowed=false;
 await r.advance(1105);assert.equal(r.attacks(),1);r.c.partyRoleRunner.stop();
});


test('nearby loot continues during travel and blocked support without overlapping calls', async () => {
  const r=runner();let lootCalls=0,finish;
  r.routine.smartLoot=()=>{lootCalls++;return new Promise(resolve=>finish=resolve);};
  r.occupied(true);
  await r.run(250);assert.equal(lootCalls,1);
  await r.run(250);assert.equal(lootCalls,1,'only one loot request in flight');
  finish();await flush();await r.run(250);assert.equal(lootCalls,2);
  finish();await flush();r.occupied(false);
  await r.run(250);assert.equal(lootCalls,3,'unresolved regeneration must not block looting');
  finish();await flush();r.character.rip=true;
  await r.run(250);assert.equal(lootCalls,3,'dead characters do not loot');
  r.character.rip=false;r.c.partyRoleRunner.stop();
  await r.run(250);assert.equal(lootCalls,3,'stopping runner stops loot timer');
});

test('eligible passing and active attacks share priority without passing movement', async () => {
  for (const passivePriority of [40,100]) {
    const r=runner('ranger',false,routine=>{routine.queueReport=()=>({groupedCombat:{}});});await flush();
    r.c.partyQueueClient.preparePassing=()=>true; // Admission is covered by passing-admission tests.
    const passing={...r.target,id:'passing',mtype:'bee'};const hit=[];
    r.routine.getPassingTarget=()=>passing;
    r.routine.monsterPriority=target=>target.id==='passing'?passivePriority:50;
    r.routine.beginPassingAttack=()=>{};
    r.c.attack=target=>{hit.push(target.id);return new Promise(()=>{});};
    r.attackTick();await flush();
    assert.equal(hit[0],passivePriority>50?'passing':r.target.id);
    r.c.partyRoleRunner.stop();
  }
});

for (const ctype of ['warrior', 'priest', 'mage']) test('cave uses normal ' + ctype + ' support, attacks and movement without farm travel', async () => {
  const r = runner(ctype); let support = 0, formations = 0, kites = 0;
  Object.assign(r.routine, {
    dungeonOwned: () => true, getDungeonTarget: () => r.target,
    regenerateHpOrMp: async () => {}, useRecoveryPotion: async () => false,
    emergencyWarriorStomp: async () => { support++; return true; },
    healPartyBelow: async () => { support++; return true; },
    energizeLowestMana: async () => { support++; return true; },
    formationMove: () => { formations++; return false; },
    kiteIfNeeded: async () => { kites++; return false; },
    pollRareHunting: () => assert.fail('rare travel during cave'),
    pollFarmingCombatHandoff: () => assert.fail('farm handoff during cave'),
    pollFarmingSpawnRecovery: () => assert.fail('farm recovery during cave'),
    groupedMovement: () => assert.fail('stale farm movement during cave'),
    recoverFarmApproach: () => assert.fail('farm approach during cave'),
    followLeaderIfFar: () => assert.fail('ordinary follow during cave'),
  });
  r.character.cave = {run:'run', paused:false};
  try {
    await r.run(250); await r.run(100); await r.run(50);
    assert.ok(support > 0, ctype + ' class support must run');
    assert.ok(formations > 0 && kites > 0 && r.moves() > 0, 'normal positioning pipeline must run');
    assert.equal(r.attacks(), 1);
    r.occupied(true); const before = [support, formations, kites, r.moves(), r.attacks()];
    await r.run(250); await r.run(100); await r.run(50);
    assert.deepEqual([support, formations, kites, r.moves(), r.attacks()], before, 'forced pause stops combat');
    r.occupied(false); r.routine.getDungeonTarget = () => null;
    r.routine.allowsTarget = () => false;
    await r.run(250); await r.run(100);
    assert.equal(r.moves(), before[3], 'no target must leave room navigation alone');
  } finally { r.c.partyRoleRunner.stop(); }
});

test('priest recovery reserves offensive slots, yields to living healing, and releases attacks afterward',async()=>{
  const r=runner('priest',false,routine=>{routine.regenerateHpOrMp=async()=>{};});let recovering=true,living=false,revives=0;
  r.routine.regenerateHpOrMp=async()=>{};
  r.routine.caveRecoveryReserved=()=>recovering;
  r.routine.caveRecoveryTick=async()=>{if(recovering)revives++;return recovering;};
  r.routine.healPartyBelow=async()=>living;
  r.routine.basicAttackReserved=()=>living;
  try {
    await r.run(250);await r.run(50);assert.equal(revives,1,JSON.stringify(r.c.partyCombatState));assert.equal(r.attacks(),0);
    living=true;await r.run(250);await r.run(50);assert.equal(revives,1,JSON.stringify(r.c.partyCombatState));assert.equal(r.attacks(),0);
    living=false;recovering=false;await r.run(250);await r.run(50);assert.equal(r.attacks(),1);
  } finally { r.c.partyRoleRunner.stop(); }
});

test('priest waits for an outstanding attack before starting grave recovery',async()=>{
  const r=runner('priest',false,routine=>{routine.regenerateHpOrMp=async()=>{};});let recovering=false,attempts=0;
  r.routine.regenerateHpOrMp=async()=>{};r.routine.healPartyBelow=async()=>false;
  r.routine.caveRecoveryReserved=()=>recovering;
  r.routine.caveRecoveryTick=async()=>{if(recovering)attempts++;return recovering;};
  try {
    await r.run(250);await r.run(50);assert.equal(r.attacks(),1);
    recovering=true;await r.run(250);assert.equal(attempts,0);
    r.now(4000);await r.run(50);await r.run(250);assert.equal(attempts,1,JSON.stringify(r.c.partyCombatState));assert.equal(r.attacks(),1);
  } finally { r.c.partyRoleRunner.stop(); }
});

for (const ctype of ['warrior','mage','priest','ranger','rogue','paladin','merchant'])
test(ctype+' Franky attendance suppresses farming/passing targets and ordinary movement, including boss absence',async()=>{
  const r=runner(ctype);await flush();
  const boss={...r.target,id:'boss',mtype:'franky',hp:100};let visible=true,active=true,movement=0,follow=0,stomps=0,dashes=0;
  r.c.get_entity=id=>id==='boss'?(visible?boss:null):r.target;
  Object.assign(r.routine,{
    frankyCombatActive:()=>active,frankyMovementTick:t=>{movement++;assert.equal(t,visible?boss:null);return true;},
    merchantEventCombatActive:()=>true,getEventTarget:()=>visible?boss:null,
    allowsTarget:t=>!active || t.mtype==='franky',getPassingTarget:()=>r.target,
    monsterPriority:t=>t.id==='m'?100:0,getRareTarget:()=>r.target,
    usesLeaderTarget:()=>true,getGroupedTarget:()=>r.target,sharedTargetId:()=>r.target.id,
    getCloserHuntTarget:()=>r.target,getFarmingMode:()=> 'scatter',
    followLeaderIfFar:async()=>{follow++;},pollRareHunting:()=>{throw Error('rare movement during Franky');},
    formationMove:()=>{throw Error('formation during Franky');},
    emergencyWarriorStomp:async()=>{stomps++;return false;},dashToward:async()=>{dashes++;return true;},
    getNearestPartyAttacker:()=>null,regenerateHpOrMp:async()=>false,
    isPartyHealthy:()=>true,isCurrentPartyTarget:()=>true,energizeLowestMana:async()=>false,
  });
  r.character.max_mp=100;r.character.mp=0;
  r.c.attack=t=>{assert.equal(t.id,'boss');return new Promise(()=>{});};
  try {
    await r.run(250);await r.run(100);await r.run(50);
    assert.equal(r.c.partyCombatState.selectedTarget,'boss');assert.equal(movement,1);
    assert.equal(stomps,0);assert.equal(dashes,0);
    visible=false;r.c.partyRoleRunner.wake();await flush();await r.run(100);await r.run(50);
    assert.equal(r.c.partyCombatState.selectedTarget,null);assert.equal(movement,2);assert.equal(follow,0);
    assert.equal(r.moves(),0);
    let exitSelection=null;r.routine.setCombatTarget=t=>{exitSelection=t;};
    r.routine.returnCombatActive=()=>true;r.routine.returnDefenseTarget=()=>r.target;
    active=false;r.c.partyRoleRunner.wake();await flush();
    assert.equal(exitSelection,r.target,'exit defense takes ownership');
  } finally {r.c.partyRoleRunner.stop();}
});
