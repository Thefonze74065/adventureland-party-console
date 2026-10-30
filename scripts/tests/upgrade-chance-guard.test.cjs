const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const {availableCraftStock}=require('../../runtime/craft-reservations.ts');
const {resolveUpgradeOffering}=require('../../runtime/upgrade-offerings.ts');
const {chanceGuard,chanceHold,scrollGradeFor,validChanceGuards}=require('../../runtime/upgrade-chance-guard.ts');
const {recordChanceHold,upgradeOfferingReady,chanceHoldMs}=require('../../runtime/coordinator/inventory/offering-waits.ts');
const {createChanceGuardCommands}=require('../../runtime/coordinator/inventory/upgrade-chance-guards.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
const guard=(extra={})=>({id:'g',name:'sword',floor:7,ceiling:9,minChance:0.3,...extra});

test('attempts are held below the minimum and allowed at or above it',()=>{
 const rules=[guard()];
 assert.ok(chanceHold(rules,'sword',7,0.2999));
 assert.equal(chanceHold(rules,'sword',7,0.3),null);
 assert.equal(chanceHold(rules,'sword',8,0.9),null);
 assert.ok(chanceHold(rules,'sword',8,Number.NaN),'an unreadable chance is held');
});
test('guards cover only their level range and item',()=>{
 const rules=[guard()];
 assert.equal(chanceGuard(rules,'sword',6),undefined);
 assert.equal(chanceGuard(rules,'sword',7).id,'g');
 assert.equal(chanceGuard(rules,'sword',8).id,'g');
 assert.equal(chanceGuard(rules,'sword',9),undefined);
 assert.equal(chanceGuard(rules,'hat',7),undefined);
 assert.equal(chanceHold(rules,'sword',6,0.01),null);
});
test('validation rejects bad ranges, chances and overlaps',()=>{
 assert.ok(validChanceGuards([guard(),guard({id:'h',floor:9,ceiling:13,minChance:1})]));
 for(const bad of [{minChance:0},{minChance:1.01},{minChance:'0.3'},{floor:9,ceiling:9},{floor:-1},{ceiling:14},{id:''},{name:''}])
  assert.equal(validChanceGuards([guard(bad)]),false);
 assert.equal(validChanceGuards([guard(),guard({id:'h',floor:8,ceiling:10})]),false);
 assert.equal(validChanceGuards([guard(),guard()]),false);
});
test('coordinator command adds, edits, removes and refuses overlaps',()=>{
 const state={merchantCatalog:{allItems:[{id:'sword',upgradeable:true,meta:{maxLevel:13}}]},upgradeChanceGuards:[]};
 let saves=0;const command=createChanceGuardCommands(state,()=>{saves++;});
 const body=(rule,extra={})=>({type:'upgrade-chance-guard',rule,...extra});
 assert.equal(command({type:'other'}),undefined);
 assert.equal(command(body({name:'sword',floor:7,ceiling:9,minChance:0.3})),null);
 const saved=state.upgradeChanceGuards[0];assert.ok(saved.id);assert.equal(saved.minChance,0.3);
 assert.equal(command(body({name:'sword',floor:8,ceiling:10,minChance:0.5})).status,409);
 for(const invalid of [{minChance:0},{minChance:2},{floor:9,ceiling:9},{ceiling:14},{name:'unknown'}])
  assert.equal(command(body({name:'sword',floor:9,ceiling:12,minChance:0.4,...invalid})).status,400);
 assert.equal(command(body({...saved,minChance:0.45})),null);assert.equal(state.upgradeChanceGuards[0].minChance,0.45);
 assert.equal(command(body({id:'missing'})).status,404);
 assert.equal(command(body({id:saved.id},{remove:true})),null);assert.equal(state.upgradeChanceGuards.length,0);
 assert.equal(saves,3);
});

function runtime({guards=[],chance=0.5,previewFails=false,level=7,tiers=2,scroll1=0}={}){
 const calls=[],previews=[],activity=[],holds=[],scrollsUsed=[];
 const character={name:'M',ctype:'merchant',map:'main',level:1,items:[{name:'sword',level},{name:'scroll0',q:10},...(scroll1?[{name:'scroll1',q:scroll1}]:[])],bank:null};
 const r=vm.createContext({character,G:{items:{sword:{upgrade:{}}}},partyAvailableCraftStock:availableCraftStock,partyResolveUpgradeOffering:resolveUpgradeOffering,
  partyChanceGuard:chanceGuard,partyChanceHold:chanceHold,partyScrollGrade:scrollGradeFor,
  maximumItemLevel:()=>13,fingerprint:i=>i&&({...i}),sameItem:(a,b)=>a&&Object.keys(b).every(k=>a[k]===b[k]),
  item_grade:()=>0,find_npc:n=>n,smart_move:async()=>{},merchantOperationStage:async()=>{},
  request:async(path,{body})=>body.action==='hold-chance'?(holds.push(body),{ok:true}):({craftProtection:{requirements:[]},upgradeOfferingRules:[],upgradeChanceGuards:guards,upgradeOfferingStock:{}}),
  upgrade:async(slot,scroll,offering,calculate)=>{
   previews.push({level:character.items[slot].level,calculate});
   if(previewFails)throw Object.assign(new Error('x'),{reason:'distance'});
   return {calculate:true,chance:typeof chance==='function'?chance(character.items[slot].level):chance};
  },
  upgradeConfirmed:async(slot,scroll)=>{scrollsUsed.push(character.items[scroll].name);calls.push(character.items[slot].level);character.items[slot].level++;return {success:true};},
 });
 const names=['findItem','findInventoryItemByName','findUpgradeMarkSlot','anchoredUpgradeSlot','upgradeOfferingCheckpoint','availableOfferingEntries','carriedOffering','carriedOfferingQuantity','upgradeOfferingDemand','requestUpgradeOfferingSupply','retrieveUpgradeOffering','prepareUpgradeOffering','upgradeChanceHeld','loadScrollRules','upgradeScrollGrade','manualImprovementScrollNeeds','merchantImprove'];
 vm.runInContext(names.map(n=>namedFunction(source,n)).join('\n'),r);
 const mark={slot:0,item:{name:'sword',level},tiers,auto:true};
 return {r,character,calls,previews,activity,holds,scrollsUsed,command:{jobId:'job',target:'M',upgrades:[mark]}};
}
test('merchant holds an attempt whose server chance is below the guard',async()=>{
 const f=runtime({guards:[guard()],chance:0.2});await f.r.merchantImprove(f.command,f.activity);
 assert.deepEqual(f.calls,[]);assert.equal(f.character.items[0].level,7);
 assert.equal(f.command._offeringWaits.length,1);
 assert.equal(f.holds.length,1);assert.equal(f.holds[0].level,7);assert.equal(f.holds[0].chance,0.2);assert.equal(f.holds[0].owner,'M');assert.deepEqual(f.previews,[{level:7,calculate:true}]);
 assert.match(f.activity.find(a=>/Holding/.test(a.message)).message,/20\.00% is below the 30\.00% minimum/);
});
test('merchant attempts when the chance equals or exceeds the guard',async()=>{
 for(const chance of [0.3,0.9]){
  const f=runtime({guards:[guard()],chance});await f.r.merchantImprove(f.command,f.activity);
  assert.deepEqual(f.calls,[7,8]);assert.equal(f.character.items[0].level,9);assert.equal(f.command._offeringWaits,undefined);
 }
});
test('the hold is decided per level: +7 goes ahead, +8 is held',async()=>{
 const f=runtime({guards:[guard()],chance:level=>level===7?0.6:0.1});await f.r.merchantImprove(f.command,f.activity);
 assert.deepEqual(f.calls,[7]);assert.equal(f.character.items[0].level,8);assert.equal(f.command._offeringWaits.length,1);
});
test('levels without a guard are never previewed or held',async()=>{
 const f=runtime({guards:[guard({floor:8,ceiling:9})],chance:0.01});await f.r.merchantImprove(f.command,f.activity);
 assert.deepEqual(f.calls,[7]);assert.deepEqual(f.previews.map(p=>p.level),[8]);assert.equal(f.character.items[0].level,8);
});
test('an unreadable preview holds the attempt rather than gambling the item',async()=>{
 const f=runtime({guards:[guard()],previewFails:true});await f.r.merchantImprove(f.command,f.activity);
 assert.deepEqual(f.calls,[]);assert.equal(f.command._offeringWaits.length,1);
 assert.match(f.activity.find(a=>/Holding/.test(a.message)).message,/chance unavailable \(distance\)/);
});
test('no guards leaves behavior unchanged with no previews',async()=>{
 const f=runtime();await f.r.merchantImprove(f.command,f.activity);
 assert.deepEqual(f.calls,[7,8]);assert.deepEqual(f.previews,[]);
});

test('the merchant records each hold so the mark is not retried every cycle',async()=>{
 const f=runtime({guards:[guard()],chance:0.2});await f.r.merchantImprove(f.command,f.activity);
 assert.equal(f.holds.length,1);assert.equal(f.holds[0].action,'hold-chance');assert.deepEqual(f.holds[0].mark.item,{name:'sword',level:7});
});
test('a held mark is not ready until the cool-down passes or the guards change',()=>{
 const state={merchantCharacter:'M',upgrades:{M:[]},upgradeChanceGuards:[guard()],upgradeOfferingRules:[]};
 const mark={slot:0,item:{name:'sword',level:7},tiers:2,auto:true};
 recordChanceHold(state,{owner:'M',mark,level:7,chance:0.2,liveSlot:0},1000);
 const saved=state.upgrades.M[0];assert.equal(saved.heldChance.minChance,0.3);assert.equal(saved.heldChance.chance,0.2);
 assert.equal(upgradeOfferingReady(state,saved,1000+chanceHoldMs-1),false);
 assert.equal(upgradeOfferingReady(state,saved,1000+chanceHoldMs),true);
 state.upgradeChanceGuards=[guard({minChance:0.1})];
 assert.equal(upgradeOfferingReady(state,saved,2000),true,'editing the guards releases the hold');
 recordChanceHold(state,{owner:'M',mark,level:7,chance:0.05,liveSlot:0},3000);
 assert.equal(state.upgrades.M.length,1,'the same mark is updated, not duplicated');
});
test('a manual mark stays queued while held, and a hold without a guard is ignored',()=>{
 const state={merchantCharacter:'M',upgrades:{M:[{slot:0,item:{name:'sword',level:7},tiers:1,requestId:'r1'}]},upgradeChanceGuards:[guard()]};
 recordChanceHold(state,{owner:'M',mark:state.upgrades.M[0],level:7,chance:0.1,liveSlot:2},0);
 assert.equal(state.upgrades.M.length,1);assert.equal(state.upgrades.M[0].slot,2);assert.ok(state.upgrades.M[0].heldChance);
 const other={merchantCharacter:'M',upgrades:{M:[]},upgradeChanceGuards:[]};
 recordChanceHold(other,{owner:'M',mark:{slot:0,item:{name:'sword',level:7},tiers:1,auto:true},level:7,chance:0.1},0);
 assert.deepEqual(other.upgrades.M,[]);
 assert.throws(()=>recordChanceHold(state,{owner:'M',mark:{item:{}},level:7}),/Invalid chance hold/);
});
test('a fresh mark passes the readiness check',()=>{
 assert.equal(upgradeOfferingReady({},{slot:0,item:{name:'sword',level:7}}),true);
});

// Scroll floors (#78): spend a higher-grade scroll than the item needs.
const scrollRule=(extra={})=>({id:'s',name:'sword',floor:7,ceiling:9,scrollGrade:1,...extra});
test('a scroll floor raises the grade only where it applies and never lowers it',()=>{
 const rules=[scrollRule()];
 assert.equal(scrollGradeFor(rules,'sword',7,0),1);assert.equal(scrollGradeFor(rules,'sword',8,0),1);
 assert.equal(scrollGradeFor(rules,'sword',8,2),2,'an item that already needs a higher grade keeps it');
 assert.equal(scrollGradeFor(rules,'sword',6,0),0);assert.equal(scrollGradeFor(rules,'sword',9,0),0);assert.equal(scrollGradeFor(rules,'hat',7,0),0);
 assert.equal(scrollGradeFor([guard()],'sword',7,0),0,'a chance-only rule leaves the scroll alone');
});
test('rules need a chance, a scroll grade, or both, each valid',()=>{
 assert.ok(validChanceGuards([scrollRule()]));assert.ok(validChanceGuards([scrollRule({minChance:0.4})]));
 const noPolicy={id:'x',name:'sword',floor:7,ceiling:9};
 assert.equal(validChanceGuards([noPolicy]),false);
 for(const bad of [0,5,1.5,'1',null])assert.equal(validChanceGuards([scrollRule({scrollGrade:bad})]),false);
 assert.equal(validChanceGuards([scrollRule({minChance:2})]),false);
 assert.equal(chanceHold([scrollRule()],'sword',7,0),null,'a scroll-only rule never holds an attempt');
});
test('coordinator command stores scroll floors, alone or with a chance',()=>{
 const state={merchantCatalog:{allItems:[{id:'sword',upgradeable:true,meta:{maxLevel:13}}]},upgradeChanceGuards:[]};
 const command=createChanceGuardCommands(state,()=>{}),body=(rule,extra={})=>({type:'upgrade-chance-guard',rule,...extra});
 assert.equal(command(body({name:'sword',floor:7,ceiling:9,scrollGrade:1})),null);
 const saved=state.upgradeChanceGuards[0];assert.equal(saved.scrollGrade,1);assert.equal('minChance' in saved,false);
 assert.equal(command(body({...saved,minChance:0.4})),null);assert.deepEqual([state.upgradeChanceGuards[0].scrollGrade,state.upgradeChanceGuards[0].minChance],[1,0.4]);
 assert.equal(command(body({id:saved.id,name:'sword',floor:7,ceiling:9,minChance:0.4})),null);
 assert.equal('scrollGrade' in state.upgradeChanceGuards[0],false,'an edit can drop the scroll floor');
 for(const invalid of [{},{scrollGrade:0},{scrollGrade:5},{scrollGrade:'high'}])
  assert.equal(command(body({name:'sword',floor:10,ceiling:12,...invalid})).status,400);
});
test('merchant spends the floor scroll and attempts normally',async()=>{
 const f=runtime({guards:[scrollRule()],scroll1:5});await f.r.merchantImprove(f.command,f.activity);
 assert.deepEqual(f.calls,[7,8]);assert.deepEqual(f.scrollsUsed,['scroll1','scroll1']);assert.deepEqual(f.previews,[]);
});
test('without a floor the merchant spends the item\'s own scroll',async()=>{
 const f=runtime({scroll1:5});await f.r.merchantImprove(f.command,f.activity);
 assert.deepEqual(f.scrollsUsed,['scroll0','scroll0']);
});
test('a floor and a guard work together: the preview is for the floor scroll',async()=>{
 const f=runtime({guards:[scrollRule({minChance:0.3})],scroll1:5,chance:0.2});await f.r.merchantImprove(f.command,f.activity);
 assert.deepEqual(f.calls,[]);assert.equal(f.command._offeringWaits.length,1);
});
test('the planner counts the floor scroll when stocking',()=>{
 const f=runtime({guards:[scrollRule()],scroll1:5});f.command._scrollRules=[scrollRule()];
 assert.deepEqual({...f.r.manualImprovementScrollNeeds(f.command)},{scroll1:2});
});
