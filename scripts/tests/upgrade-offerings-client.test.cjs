const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const {availableCraftStock}=require('../../runtime/craft-reservations.ts');
const {resolveUpgradeOffering}=require('../../runtime/upgrade-offerings.ts');
const {chanceGuard,chanceHold,scrollGradeFor}=require('../../runtime/upgrade-chance-guard.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
function runtime({rules=[],stock=0,bank=0,manual=false,required=true,survive=false}={}){
 const calls=[],waits=[],visits=[];
 const character={name:'M',ctype:'merchant',map:'main',level:1,items:[{name:'sword',level:7},{name:'scroll0',q:10},stock?{name:'offeringp',q:stock}:null],bank:null};
 const r=vm.createContext({character,G:{items:{sword:{upgrade:{}},offeringp:{name:'Primling'}}},partyAvailableCraftStock:availableCraftStock,partyResolveUpgradeOffering:resolveUpgradeOffering,partyChanceGuard:chanceGuard,partyChanceHold:chanceHold,partyScrollGrade:scrollGradeFor,
  maximumItemLevel:()=>13,fingerprint:i=>i&&({...i}),sameItem:(a,b)=>a&&Object.keys(b).every(k=>a[k]===b[k]),
  item_grade:()=>0,find_npc:n=>n,smart_move:async map=>{character.map=map;},merchantOperationStage:async()=>{},
  freeInventorySlots:()=>10,accessibleBankSortFloors:()=>['bank'],bankPacksOnCurrentFloor:()=>['items0'],
  merchantVisitBank:async()=>{visits.push('bank');character.map='bank';character.bank={items0:bank?[{name:'offeringp',q:bank}]:[]};},
  bankRetrieveConfirmed:async(pack,slot)=>{character.items[2]=character.bank[pack][slot];character.bank[pack][slot]=null;bank=0;},
  request:async(path,{body})=>{
   if(body.action==='wait-offering'){waits.push(body);return {ok:true};}
   return {craftProtection:{requirements:[]},upgradeOfferingRules:rules,upgradeOfferingStock:{offeringp:bank+(character.items[2]?.q||0)}};
  },
  upgradeConfirmed:async(slot,scroll,a,b,automatic,offering)=>{
   calls.push({level:character.items[slot].level,offering:offering?.offering});
   if(offering?.offering){if(--character.items[2].q===0)character.items[2]=null;}
   if(survive)return {success:false};character.items[slot].level++;return {success:true};
  },
 });
 const names=['findItem','findInventoryItemByName','findUpgradeMarkSlot','anchoredUpgradeSlot','upgradeOfferingCheckpoint','availableOfferingEntries','carriedOffering','carriedOfferingQuantity','upgradeOfferingDemand','requestUpgradeOfferingSupply','retrieveUpgradeOffering','prepareUpgradeOffering','upgradeChanceHeld','loadScrollRules','upgradeScrollGrade','manualImprovementScrollNeeds','merchantImprove'];
 vm.runInContext(names.map(n=>namedFunction(source,n)).join('\n'),r);
 const mark={slot:0,item:{name:'sword',level:7},tiers:manual?1:2,...(manual?{offering:'offeringp',requestId:'manual'}:{auto:true})};
 return {r,character,calls,waits,visits,command:{jobId:'job',target:'M',upgrades:[mark]},rules};
}
const required={id:'p',name:'sword',floor:8,ceiling:9,offering:'offeringp',required:true};
test('interrupted automatic pass follows a relocated survivor and stops at the original target',async()=>{
 const f=runtime();const original=f.r.upgradeConfirmed;let attempts=0;
 f.r.upgradeConfirmed=async(...args)=>{if(++attempts===2)throw Error('interrupted');return original(...args);};
 await assert.rejects(f.r.merchantImprove(f.command,[]),/interrupted/);
 assert.equal(f.character.items[0].level,8);assert.ok(f.command.upgrades[0].passId);
 f.character.items[4]=f.character.items[0];f.character.items[0]=null;
 f.r.upgradeConfirmed=original;await f.r.merchantImprove(f.command,[]);
 assert.equal(f.character.items[4].level,9);assert.equal(f.calls.length,2);
});
test('auto +9 stops at +8 without required primling and preserves unfinished work',async()=>{
 const f=runtime({rules:[required]});await f.r.merchantImprove(f.command,[]);
 assert.equal(f.character.items[0].level,8);assert.equal(f.calls.length,1);assert.equal(f.waits.length,1);assert.equal(f.visits.length,0);
 assert.equal(f.waits[0].mark.tiers,2);assert.equal(f.waits[0].mark.item.level,7);assert.equal(f.command._offeringWaits.length,1);
});
test('optional bank stock is retrieved and consumed only at its matching transition',async()=>{
 const f=runtime({rules:[{...required,required:false}],bank:1});await f.r.merchantImprove(f.command,[]);
 assert.deepEqual(f.calls,[{level:7,offering:undefined},{level:8,offering:'offeringp'}]);assert.deepEqual(f.visits,['bank']);assert.equal(f.character.items[2],null);
});
test('optional rule without owned stock upgrades normally without a bank visit',async()=>{
 const f=runtime({rules:[{...required,required:false}]});await f.r.merchantImprove(f.command,[]);
 assert.equal(f.character.items[0].level,9);assert.equal(f.calls[1].offering,undefined);assert.equal(f.visits.length,0);
});
test('manual offering makes exactly one attempt when failure leaves item intact',async()=>{
 const f=runtime({manual:true,stock:3,survive:true});await f.r.merchantImprove(f.command,[]);
 assert.equal(f.calls.length,1);assert.equal(f.character.items[0].level,7);assert.equal(f.character.items[2].q,2);
});
test('required multi-step range pauses after the available stack is consumed',async()=>{
 const f=runtime({rules:[{...required,floor:7}],stock:1});await f.r.merchantImprove(f.command,[]);
 assert.equal(f.calls.length,1);assert.equal(f.waits.length,1);assert.equal(f.character.items[0].level,8);
});
test('manual offering never downgrades to an unboosted upgrade',async()=>{
 const f=runtime({manual:true});await f.r.merchantImprove(f.command,[]);assert.equal(f.calls.length,0);assert.equal(f.waits.length,1);
});
test('uncertain bank retrieval defers instead of making an optional unboosted attempt',async()=>{
 const f=runtime({rules:[{...required,floor:7,required:false}],bank:1});
 f.r.bankRetrieveConfirmed=async()=>{throw Error('Bank withdrawal was not confirmed');};
 await assert.rejects(f.r.merchantImprove(f.command,[]),/not confirmed/);assert.equal(f.calls.length,0);
});
test('one blocked item does not prevent an unrelated upgrade',async()=>{
 const f=runtime({rules:[{...required,floor:7}]});
 f.character.items.push({name:'hat',level:0});f.r.G.items.hat={upgrade:{}};
 f.command.upgrades.push({slot:3,item:{name:'hat',level:0},tiers:1,auto:true});
 await f.r.merchantImprove(f.command,[]);assert.equal(f.waits.length,1);assert.equal(f.character.items[3].level,1);
});
