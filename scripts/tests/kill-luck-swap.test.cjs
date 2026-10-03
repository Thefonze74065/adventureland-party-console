const test=require('node:test'),assert=require('node:assert/strict');
const {createKillLuckSwap}=require('../../runtime/characters/roles/kill-luck-swap.ts');
// Failure modes considered before writing this (no native E2E covers the kill-luck-swap trigger
// at all; docs/testing.md records it as verified by code review instead):
//  - a per-slot-only comparison can never discover a set bonus, since a zero-luck set piece never
//    beats whatever is already equipped in isolation (the bug this file guards against);
//  - committing to a set below its bonus threshold anyway, wasting a slot for nothing;
//  - committing to a set whose unlocked bonus is smaller than the luck it would displace;
//  - double-counting a slot that is simultaneously "already equipped" and a "candidate";
//  - ignoring fixed (mainhand/offhand) set members when counting progress toward a tier.
// Upstream data for reference (design/items.js): the "wanderers" set is wcap/wattire/wbreeches/
// wgloves/wshoes (helmet/chest/pants/gloves/shoes), each with no intrinsic luck, granting +16 luck
// only once all 5 are worn.
function item(name,type,luck,set){return {name,type,luck,set};}
const WANDERERS=['wcap','wattire','wbreeches','wgloves','wshoes'];
const WANDERERS_TYPE={wcap:'helmet',wattire:'chest',wbreeches:'pants',wgloves:'gloves',wshoes:'shoes'};
function fixture({equipped={},carried=[],fixedSetCounts={}}={}){
 const slots={...equipped};
 const calls=[];
 const ports={
  now:()=>1000,
  isTank:()=>true,
  equipped:slot=>slots[slot]||null,
  items:()=>carried,
  itemType:i=>i.type,
  luckValue:i=>i?Number(i.luck)||0:0,
  itemSet:i=>i?i.set:undefined,
  setBonusLuck:(set,count)=>set==='wanderers'&&count>=5?16:0,
  fixedSetCounts:()=>fixedSetCounts,
  fingerprint:i=>i?{name:i.name,type:i.type,luck:i.luck,set:i.set}:null,
  same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  equip:(index,slot)=>{calls.push({index,slot,item:carried[index]});slots[slot]=carried[index];return Promise.resolve();},
  lethalBasicAttack:()=>true,
  holdsAggro:()=>true,
  endangered:()=>false,
  otherSwapBusy:()=>false,
  report:()=>{},
 };
 return {ports,slots,calls,swap:createKillLuckSwap(ports,{})};
}
async function settle(swap,target){ swap.tick(target); while(swap.busy()) await new Promise(r=>setTimeout(r,0)); }

test('a complete zero-luck set is equipped once it clears the bonus threshold, displacing a weaker standalone pick',async()=>{
 const equipped={chest:item('coat','chest',5),helmet:item('cap','helmet',0),pants:item('pants','pants',0),gloves:item('gloves','gloves',0),shoes:item('shoes','shoes',0)};
 const carried=WANDERERS.map(name=>item(name,WANDERERS_TYPE[name],0,'wanderers'));
 const f=fixture({equipped,carried});
 await settle(f.swap,{id:'goo',hp:1});
 for(const name of WANDERERS) assert.equal(f.slots[WANDERERS_TYPE[name]].name,name,name+' should be equipped once the set is complete');
 assert.equal(f.calls.length,5);
});

test('an unreachable set bonus does not displace a better standalone item',async()=>{
 const equipped={chest:item('coat','chest',5),helmet:item('cap','helmet',0),pants:item('pants','pants',0),gloves:item('gloves','gloves',0),shoes:item('shoes','shoes',0)};
 // Only 4 of 5 pieces carried: no achievable tier grants any luck, so nothing should move.
 const carried=WANDERERS.slice(0,4).map(name=>item(name,WANDERERS_TYPE[name],0,'wanderers'));
 const f=fixture({equipped,carried});
 await settle(f.swap,{id:'goo',hp:1});
 assert.equal(f.calls.length,0);
 assert.equal(f.slots.chest.name,'coat');
});

test('a set bonus smaller than the luck it would displace is skipped',async()=>{
 const equipped={chest:item('coat','chest',20),helmet:item('cap','helmet',0),pants:item('pants','pants',0),gloves:item('gloves','gloves',0),shoes:item('shoes','shoes',0)};
 const carried=WANDERERS.map(name=>item(name,WANDERERS_TYPE[name],0,'wanderers'));
 const f=fixture({equipped,carried});
 await settle(f.swap,{id:'goo',hp:1});
 // The set's +16 cannot outweigh giving up a 20-luck chest piece: nothing should swap.
 assert.equal(f.calls.length,0);
 assert.equal(f.slots.chest.name,'coat');
});

test('pieces already locked into mainhand/offhand count toward the achievable tier',async()=>{
 const equipped={chest:item('coat','chest',0),helmet:item('cap','helmet',0),pants:item('pants','pants',0),gloves:item('gloves','gloves',0),shoes:item('shoes','shoes',0)};
 // Only 4 carried, but a 5th is already locked into a slot this module never swaps.
 const carried=WANDERERS.slice(0,4).map(name=>item(name,WANDERERS_TYPE[name],0,'wanderers'));
 const f=fixture({equipped,carried,fixedSetCounts:{wanderers:1}});
 await settle(f.swap,{id:'goo',hp:1});
 for(const name of WANDERERS.slice(0,4)) assert.equal(f.slots[WANDERERS_TYPE[name]].name,name);
 assert.equal(f.calls.length,4);
});

test('an item with no set membership is never treated as set progress',async()=>{
 const equipped={chest:item('coat','chest',0),helmet:item('cap','helmet',0),pants:item('pants','pants',0),gloves:item('gloves','gloves',0),shoes:item('shoes','shoes',0)};
 const carried=WANDERERS.slice(0,4).map(name=>item(name,WANDERERS_TYPE[name],0,'wanderers')).concat([item('wshoes_fake','shoes',0,undefined)]);
 const f=fixture({equipped,carried});
 await settle(f.swap,{id:'goo',hp:1});
 assert.equal(f.calls.length,0,'a 5th, unset-tagged item must not complete the set');
});
