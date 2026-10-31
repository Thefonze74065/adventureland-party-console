const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/skill-world.cjs');
const {unlocked,blocked,cost,reserve}=require('../../runtime/characters/skills/eligibility.ts');
const {bestAttack,damageChoices}=require('../../runtime/characters/skills/offense.ts');
const {damage}=require('../../runtime/characters/skills/damage.ts');
const {decision}=require('../../runtime/characters/skills/types.ts');
const {createManaBudget}=require('../../runtime/characters/skills/budget.ts');
const {createSkillEngine}=require('../../runtime/characters/skills/engine.ts');
const protection=require('../../runtime/characters/skills/protection.ts');
const {skillRange}=require('../../runtime/characters/skills/runtime.ts');

// Failure inventory: one-target or out-of-range Cleave; strangers counted as
// party aggro; scatter spends reserved MP; urgent Cleave blocked by budget;
// insufficient actual MP or unauthorized collateral silently ignored.
test('Cleave uses its full footprint and bypasses budget only for grouped aggro or Franky',async()=>{
  for(const mode of ['scatter','grouped','franky']) {
    const r=fixture('warrior');r.actor.slots.mainhand={name:'axe'};
    r.w.skills.cleave={name:'Cleave',type:'skill',class:['warrior'],wtype:['axe'],level:52,mp:720,range:160,hostile:true,pierces_immunity:true};
    r.w.context.mode=mode==='franky'?'event':mode;r.w.context.event=mode==='franky'?'franky':null;
    r.w.range=t=>Math.hypot(t.x,t.y)<160;
    const a=r.add('a',{x:20,y:0,target:'Hero'});
    assert.equal(damageChoices(r.w,a).length,0,'one target');
    const b=r.add('b',{x:30,y:0,target:'Hero'});
    r.actor.mp=720;r.w.skills.hardshell={name:'Hardshell',type:'skill',class:['warrior'],mp:480};
    const engine=createSkillEngine(r.ports);
    assert.equal(await engine.offense(a),mode!=='scatter',mode+' MP reserve');
    r.actor.mp=10000;r.cooldowns.clear();
    if(mode==='grouped') { b.target='Stranger';assert.equal(damageChoices(r.w,a).length,0);b.target='Hero'; }
    b.x=160;assert.equal(damageChoices(r.w,a).length,0,'native range is strict');b.x=30;
    b.authorized=false;assert.equal(damageChoices(r.w,a).length,0,'cannot omit area collateral');b.authorized=true;
    r.actor.mp=719;assert.equal(damageChoices(r.w,a).length,0,'actual cast cost');
    engine.stop();
  }
});

test('every catalog level and class gate is enforced at its boundary',()=>{
 for(const ctype of ['ranger','rogue','paladin','priest']){
  const {w}=fixture(ctype);
  for(const [id,s] of Object.entries(w.skills).filter(([,s])=>s.class?.includes(ctype)&&s.level&&!s.consume)){
   if(id==='quickpunch')continue;
   w.actor.level=s.level-1;assert.equal(unlocked(w,id),false,id+' locked');
   w.actor.level=s.level;assert.equal(unlocked(w,id),true,id+' unlocked');
  }
 }
});
test('equipment, INT, consumables, offhand and shared cooldown are enforced',()=>{
 const r=fixture('rogue');r.actor.int=63;assert.equal(unlocked(r.w,'mentalburst'),false);
 r.actor.int=64;assert.equal(unlocked(r.w,'mentalburst'),true);
 assert.equal(unlocked(r.w,'fanofknives'),true);r.actor.slots.belt=null;assert.equal(unlocked(r.w,'fanofknives'),false);
 assert.equal(unlocked(r.w,'quickpunch'),false);assert.equal(unlocked(r.w,'quickstab'),true);
 r.cooldowns.add('quickpunch');assert.equal(blocked(r.w,decision('quickstab',[r.add('a')])),'cooldown');
 assert.equal(unlocked(r.w,'pcoat'),false);assert.equal(unlocked(r.w,'shadowstrike'),false);
 const p=fixture('paladin');p.actor.slots.offhand=null;assert.equal(unlocked(p.w,'shield_slam'),false);
});
test('ranger chooses basic, 3shot, or 5shot by useful damage, not unlock order',()=>{
 for(const [n,expected] of [[1,null],[2,'3shot'],[3,'3shot'],[4,'3shot'],[5,'5shot']]){
  const r=fixture();const primary=r.add('0');for(let i=1;i<n;i++)r.add(''+i);
  assert.equal(bestAttack(r.w,primary,d=>!blocked(r.w,d))?.skill||null,expected,'targets '+n);
 }
});
test('piercing shot beats basic only when armor makes it worthwhile',()=>{
 const r=fixture();const t=r.add('a',{armor:600});assert.equal(bestAttack(r.w,t,()=>true)?.skill,'piercingshot');
 t.armor=0;assert.equal(bestAttack(r.w,t,()=>true),null);
});
test('multishot excludes unauthorized targets and refuses aggregate dangerous pulls',()=>{
 const r=fixture();const a=r.add('a',{attack:2000});r.add('b',{attack:2000});r.add('stranger',{authorized:false});
 const choice=bestAttack(r.w,a,d=>!blocked(r.w,d));assert.equal(choice,null);
 r.w.context.monsters[0].attack=10;r.w.context.monsters[1].attack=10;
 assert.deepEqual(bestAttack(r.w,a,d=>!blocked(r.w,d)).targets.map(t=>t.id),['a','b']);
});
test('fan of knives honors its equipment and basic crit opportunity cost',()=>{
 const r=fixture('rogue'),a=r.add('a');r.add('b');
 assert.equal(bestAttack(r.w,a,d=>!blocked(r.w,d)).skill,'fanofknives');
 r.actor.crit=100;r.actor.critdamage=100;assert.equal(bestAttack(r.w,a,d=>!blocked(r.w,d)),null);
});
test('damage accounts for shields, armor caps, resistance, overkill and pending hits',()=>{
 const r=fixture('paladin'),a=r.add('a');r.actor.armor=2000;
 assert.equal(damage(r.w,'shield_slam',a),15000);
 r.actor.crit=100;assert.equal(damage(r.w,'shield_slam',a),15000);
 const g=fixture('rogue'),t=g.add('a');t.resistance=600;assert.ok(damage(g.w,'mentalburst',t)<600);
 g.w.incoming=()=>t.hp;assert.equal(damageChoices(g.w,t).length,0);
});
test('MP cost reductions, pending reservations, and survival exceptions',()=>{
 const r=fixture('paladin');r.actor.mp_reduction=50;assert.equal(cost(r.w,'shield_slam'),1000);
 r.actor.mp=reserve(r.w)+900;assert.equal(blocked(r.w,decision('shield_slam',[r.add('a')])),'survival MP reserved');
 r.actor.mp=20;assert.equal(blocked(r.w,decision('selfheal',[],'survival')),null);
 assert.equal(blocked(r.w,decision('selfheal',[],'survival'),20),'insufficient MP');
});
test('priest absorbs healthy and priest allies only as leader and only when safe',()=>{
 const r=fixture('priest');r.w.context.mode='grouped';const ally=r.ally('OtherPriest',{ctype:'priest'});r.add('a',{target:ally.name});
 assert.equal(protection.absorbDecision(r.w).targets[0].name,ally.name);
 r.w.context.leader='OtherPriest';assert.equal(protection.absorbDecision(r.w),null);
 r.w.context.leader='Hero';r.actor.hp=3000;assert.equal(protection.absorbDecision(r.w),null);
 r.actor.hp=10000;r.w.context.observedAt=0;assert.equal(protection.absorbDecision(r.w),null);
});
test('priest retains a heal and declines unquantified incoming damage',()=>{
 const r=fixture('priest');r.ally('Friend');const m=r.add('a',{target:'Friend'});
 r.actor.mp=205;assert.equal(protection.absorbDecision(r.w),null);
 r.actor.mp=10000;m.frequency=undefined;assert.equal(protection.absorbDecision(r.w),null);
});
test('paladin selfheal uses level output and shields have hysteresis',()=>{
 const r=fixture('paladin');r.actor.hp=9500;assert.equal(protection.selfHeal(r.w),null);
 r.actor.hp=9300;assert.equal(protection.selfHeal(r.w).skill,'selfheal');
 r.actor.hp=3500;r.add('a',{target:'Hero'});assert.equal(protection.shield(r.w).skill,'mshield');
 r.actor.s.mshield={};r.actor.hp=5000;assert.equal(protection.shield(r.w),null);
 r.actor.hp=7000;assert.equal(protection.shield(r.w).reason,'release mana shield');
 delete r.actor.s.mshield;r.w.context.monsters[0].damage_type='magical';r.actor.mp=5000;
 assert.equal(protection.shield(r.w).skill,'aether_shield');
});
test('cleanse excludes self, oath rejects duplicate links and unsafe redirection',()=>{
 const r=fixture('paladin');r.actor.s.poisoned={};assert.equal(protection.cleanse(r.w),null);
 const ally=r.ally('Friend',{hp:4000,s:{poisoned:{}}});r.add('a',{target:'Friend'});
 assert.equal(protection.cleanse(r.w).targets[0].name,'Friend');assert.equal(protection.oath(r.w).skill,'guardians_oath');
 ally.s.guardians_oath={f:'Someone'};assert.equal(protection.oath(r.w),null);
 delete ally.s.guardians_oath;r.actor.hp=2500;assert.equal(protection.oath(r.w),null);
});
test('purify preserves beneficial party debuffs unless it conservatively executes',()=>{
 const r=fixture('paladin'),a=r.add('a',{s:{cursed:{}}});
 assert.ok(!damageChoices(r.w,a).some(d=>d.skill==='purify'));
 a.hp=500;assert.ok(damageChoices(r.w,a).some(d=>d.skill==='purify'));
});
test('auras and marks coordinate duplicate classes deterministically',()=>{
 const r=fixture('paladin');r.ally('Second',{ctype:'paladin'});
 assert.equal(protection.aura(r.w).argument,'bulwark');
 r.w.context.leader='Second';assert.equal(protection.aura(r.w).argument,'zeal');
 const g=fixture();g.ally('Alpha',{ctype:'ranger'});assert.ok(!damageChoices(g.w,g.add('a')).some(d=>d.skill==='huntersmark'));
});
test('fixed skill ranges and use_range multipliers are distinct',()=>{
 const r=fixture(),t=r.add('a',{x:250});
 assert.equal(skillRange(r.actor,t,{range:240,fixed_range:true}),false);
 assert.equal(skillRange(r.actor,t,{use_range:true,range_multiplier:3,range_bonus:20}),true);
});
test('budget does not manufacture recovery from casts or expected refunds',()=>{
 const b=createManaBudget();assert.equal(b.observe(0,1000,800,400),400);b.debit(400);
 assert.equal(b.observe(0,1000,800,400),0);
 assert.equal(b.observe(1000,600,400,400),400/30);
 assert.ok(b.observe(2000,1000,800,400)>400/30);
});
test('engine serializes multi-attacks and settles only accepted target IDs',async()=>{
 const r=fixture();r.w.context.mode='event';const a=r.add('a');r.add('b');r.add('c');
 let resolve;r.ports.cast=d=>{r.calls.push(d);return new Promise(r=>resolve=r);};const e=createSkillEngine(r.ports);
 const promise=e.attack(a);assert.equal(e.busy(),true);assert.equal(e.attack(a),null);assert.equal(r.calls.length,1);
 resolve({targets:['a','c']});assert.equal(await promise,true);assert.equal(e.busy(),false);
 assert.deepEqual(r.evidence.slice(3).map(x=>[x.id,x.state]),[['a','engaged'],['b','rejected'],['c','engaged']]);e.stop();
});
test('late callbacks after reset cannot recreate engaged evidence',async()=>{
 const r=fixture();const a=r.add('a');r.add('b');let resolve;
 r.ports.cast=()=>new Promise(r=>resolve=r);const e=createSkillEngine(r.ports),p=e.attack(a);e.reset();resolve({targets:['a','b']});
 assert.equal(await p,false);assert.ok(!r.evidence.some(x=>x.state==='engaged'));e.stop();
});
test('blocked activity and A/B context cannot cast new PvE skills',async()=>{
 const r=fixture('paladin');r.actor.hp=2000;r.w.context.mode='blocked';const e=createSkillEngine(r.ports);
 assert.equal(await e.support(),false);assert.equal(r.calls.length,0);e.stop();
});
test('Taunt and Agitate cannot bypass leader ownership through the generic executor',()=>{
 const r=fixture('warrior'),t=r.add('a');r.w.context.leader='Priest';
 assert.equal(blocked(r.w,decision('taunt',[t],'survival')),'leader owns aggro transfers');
 assert.equal(blocked(r.w,decision('agitate',[],'survival')),'leader owns aggro transfers');
});
test('Purify never counts persistent or unrelated conditions toward an execute',()=>{
 const r=fixture('paladin'),t=r.add('a',{hp:3000,s:{cursed:{},unrelated:{},persistent:{}}});
 r.w.condition=id=>({debuff:id==='cursed',buff:id==='persistent',persistent:id==='persistent'});
 assert.equal(damage(r.w,'purify',t,true),2160);assert.ok(!damageChoices(r.w,t).some(d=>d.skill==='purify'));
});
test('multiple pending cooldown families cannot spend the same MP',async()=>{
 const r=fixture('paladin');r.w.context.mode='event';r.actor.mp=5200;const t=r.add('a');let resolve;
 r.ports.cast=()=>new Promise(r=>resolve=r);const e=createSkillEngine(r.ports);
 const p=e.cast(decision('shield_slam',[t]));
 assert.equal(e.ready(decision('smash',[t])),false);
 resolve({target:'a'});await p;e.stop();
});
test('projectile tracker excludes strangers and expires or settles accepted actions',()=>{
 const r=fixture(),t=r.add('a');const p=require('../../runtime/characters/skills/projectiles.ts').createProjectileTracker(()=>r.w);
 p.action({pid:'x',attacker:'Stranger',target:t.id,damage:100,eta:100});assert.equal(p.incoming(t.id,r.w.now),0);
 p.action({pid:'x',attacker:'Hero',target:t.id,damage:100,eta:100});assert.equal(p.incoming(t.id,r.w.now),90);
 p.hit({pid:'x'});assert.equal(p.incoming(t.id,r.w.now),0);
 p.action({pid:'y',attacker:'Hero',target:t.id,damage:100,eta:100});assert.equal(p.incoming(t.id,r.w.now+101),0);
});
test('attack controller sends a skill once and does not race it with a basic attack',async()=>{
 const {createAttackController}=require('../../runtime/characters/roles/attack-controller.ts');
 const r=fixture();r.w.context.mode='event';const t=r.add('a');r.add('b');
 const keys=['parent','character','sharedRoutine','attack','can_attack','is_in_range','is_on_cooldown','setTimeout','clearTimeout'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]]));let resolve,basics=0,active=true;const state={};
 r.ports.cast=d=>{r.calls.push(d);return new Promise(r=>resolve=r);};const e=createSkillEngine(r.ports);
 let c;
 try {
  global.parent={};global.character=r.actor;global.sharedRoutine={basicAttackReserved:()=>false};
  global.setTimeout=()=>0;global.clearTimeout=()=>{};global.can_attack=()=>true;global.is_in_range=()=>true;
  global.is_on_cooldown=id=>r.cooldowns.has(id);global.attack=async()=>{basics++;};
  c=createAttackController({target:()=>t,selected:()=>t.id,epoch:()=>0,active:()=>active,allowed:()=>true,state:()=>state,
   skillAttack:target=>e.attack(target),skillBusy:()=>e.busy(),report:error=>assert.fail(String(error))});
  c.tick();c.tick();assert.equal(r.calls.length,1);assert.equal(basics,0);
  resolve({targets:['a','b']});for(let i=0;i<12;i++)await Promise.resolve();
 } finally {active=false;c?.stop();e.stop();for(const key of keys)if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}
});
test('composition selects a usable priest deterministically, otherwise permits leader anchoring',()=>{
 const {healingAnchor}=require('../../runtime/combat/composition.ts');
 const members=['ranger','paladin','rogue'].map((ctype,i)=>({name:''+i,ctype,status:{hp:100,range:30,seenAt:10000}}));
 assert.equal(healingAnchor(members,10000),undefined);
 members.push({name:'P1',ctype:'priest',status:{hp:0,range:200,seenAt:10000}},
  {name:'P2',ctype:'priest',status:{hp:100,range:200,seenAt:10000}});
 assert.equal(healingAnchor(members,10000,'P1').name,'P2');
 members[3].status.hp=100;assert.equal(healingAnchor(members,10000,'P2').name,'P2');
 assert.equal(healingAnchor(members,20000),undefined);
});
