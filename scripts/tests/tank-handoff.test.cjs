const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/skill-world.cjs');
const {offTankActive,effectiveTank}=require('../../runtime/characters/skills/tank-handoff.ts');
const {blocked}=require('../../runtime/characters/skills/eligibility.ts');
const {decision}=require('../../runtime/characters/skills/types.ts');
const protection=require('../../runtime/characters/skills/protection.ts');

// A priest main tank (Main) and the fixture's actor (Hero) as the off tank.
function party(ctype='warrior'){
 const r=fixture(ctype);const main=r.ally('Main',{ctype:'priest',hp:10000,max_hp:10000,armor:100,resistance:0});
 Object.assign(r.w.context,{leader:'Lead',tank:'Main',offTank:'Hero',mode:'grouped'});
 return {...r,main};
}

test('the off tank stays out while the main tank is healthy',()=>{
 const r=party();r.add('a',{target:'Main'});
 assert.equal(offTankActive(r.w,false),false);
});
test('the off tank takes over when the main tank drops below half HP',()=>{
 const r=party();r.add('a',{target:'Main'});r.main.hp=4000;
 assert.equal(offTankActive(r.w,false),true);
});
test('the off tank takes over when the main tank is endangered by its attackers',()=>{
 // Ryan's endangered: hp - 2 * incoming DPS under 30% of max HP.
 const r=party();for(const id of ['a','b','c','d'])r.add(id,{target:'Main',attack:1000,frequency:1});
 assert.equal(offTankActive(r.w,false),true);
});
test('the off tank takes over from a dead main tank',()=>{
 const r=party();r.main.rip=true;assert.equal(offTankActive(r.w,false),true);
});
test('the takeover holds until the main tank is back above 80% with no attackers',()=>{
 const r=party();const m=r.add('a',{target:'Main'});
 r.main.hp=6000;assert.equal(offTankActive(r.w,true),true,'60% is between the thresholds');
 r.main.hp=9000;assert.equal(offTankActive(r.w,true),true,'an attacker is still on the main tank');
 m.target='Hero';assert.equal(offTankActive(r.w,true),false,'the main tank takes it back');
 r.main.hp=6000;assert.equal(offTankActive(r.w,false),false,'60% does not start a takeover');
});
test('no handoff without an off tank, or with the main tank as its own off tank',()=>{
 const r=party();r.main.hp=1000;r.w.context.offTank=null;assert.equal(offTankActive(r.w,false),false);
 r.w.context.offTank='Main';assert.equal(offTankActive(r.w,false),false);
});
test('during a takeover the off tank owns aggro and the main tank does not',()=>{
 const r=party();const t=r.add('a',{target:'Main'});
 r.w.context=effectiveTank(r.w.context,true,'Hero');
 assert.equal(r.w.context.tank,'Hero');assert.equal(r.w.context.takeover,true);
 assert.equal(blocked(r.w,decision('taunt',[t],'survival')),null,'the off tank taunts the main tank\'s attacker');
 const back=effectiveTank({...r.w.context,tank:'Main',takeover:false},false,'Hero');
 assert.equal(back.tank,'Main');
 assert.equal(effectiveTank({...r.w.context,tank:'Main'},true,'Main').takeover,false,'the main tank is not taking over');
});
test('an off-tank takeover may agitate the main tank\'s idle targetron pack',()=>{
 const r=party();r.w.skills.agitate={name:'agitate',class:['warrior'],type:'skill',mp:0};
 r.w.monster=mtype=>({targetron:{aggro:0.1,rage:0}})[mtype];
 r.add('a',{mtype:'targetron',target:'Main'});r.add('b',{mtype:'targetron',target:null});
 assert.equal(blocked(r.w,decision('agitate',[],'survival')),'leader owns aggro transfers','not the tank yet');
 r.w.context=effectiveTank(r.w.context,true,'Hero');
 assert.equal(blocked(r.w,decision('agitate',[],'survival')),null);
});
test('a priest off tank absorbs the main tank\'s attackers even when the transfer is unsafe',()=>{
 const r=party('priest');r.actor.hp=1000;r.actor.mp=10000;r.main.name='Main';
 for(const id of ['a','b','c'])r.add(id,{target:'Main',attack:3000,frequency:1});
 assert.equal(protection.absorbDecision({...r.w,context:{...r.w.context,tank:'Hero'}}),null,'no takeover: unsafe transfer');
 const d=protection.absorbDecision({...r.w,context:effectiveTank(r.w.context,true,'Hero')});
 assert.equal(d?.skill,'absorb');assert.equal(d.targets[0].name,'Main');
});
