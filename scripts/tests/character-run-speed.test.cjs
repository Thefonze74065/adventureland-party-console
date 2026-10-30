const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {liveCharacter,displayRunSpeed}=require('../../dashboard/features/party/display-character.ts');
test('open doll reads refreshed stats after equipment changes instead of its opening snapshot',()=>{
 const selected={name:'Merchant',ctype:'merchant',speed:10,standOpen:true,unrestrictedSpeed:74};
 const refreshed={...selected,unrestrictedSpeed:75,dex:110};
 assert.equal(displayRunSpeed(liveCharacter(selected,{Merchant:refreshed})),75);
 assert.equal(liveCharacter(null,{Merchant:refreshed}),null);
 assert.equal(displayRunSpeed({ctype:'merchant',speed:10,standOpen:true}),null);
 assert.equal(displayRunSpeed({ctype:'warrior',speed:60}),60);
});
test('merchant speed includes equipment and exact set bonus; stand cannot hide added DEX',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8');
 const context={character:{ctype:'merchant',level:46,dex:99,str:6,speed:10,stand:true,slots:{shoes:{name:'boots'},helmet:{name:'hat'}},items:[],s:{}},
   parent:{character:{}},G:{classes:{merchant:{speed:55}},items:{boots:{set:'wanderers'},hat:{set:'wanderers'}},sets:{wanderers:{2:{speed:2}}},conditions:{}},
   item_properties:item=>({speed:item.name==='boots'?10:0,set:'wanderers'})};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function unrestrictedRunSpeed('),source.indexOf('  function skillCatalog(')),context);
 const before=context.unrestrictedRunSpeed();assert.ok(Math.abs(before-74.5875)<1e-9);
 context.character.dex+=32;assert.ok(Math.abs(context.unrestrictedRunSpeed()-before-1)<1e-9);
 context.character.stand=false;context.character.speed=75;assert.ok(Math.abs(context.unrestrictedRunSpeed()-before-1)<1e-9);
 context.character.dex=256;const capped=context.unrestrictedRunSpeed();context.character.dex=288;assert.equal(context.unrestrictedRunSpeed(),capped);
});
test('an item the game helper rejects does not break the run-speed estimate',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8');
 const context={character:{ctype:'merchant',level:46,dex:99,str:6,speed:10,slots:{belt:{name:'nightmarketsash',level:0},shoes:{name:'boots'}},items:[],s:{}},
   parent:{character:{}},G:{classes:{merchant:{speed:55}},items:{nightmarketsash:{vit:1},boots:{}},sets:{},conditions:{}},
   calculate_item_properties:item=>{if(item.name==='nightmarketsash')throw new Error('type not supported');return {speed:10};},
   item_properties:item=>{if(item.name==='nightmarketsash')throw new Error('type not supported');return {speed:10};}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function unrestrictedRunSpeed('),source.indexOf('  function skillCatalog(')),context);
 const speed=context.unrestrictedRunSpeed();assert.ok(Number.isFinite(speed)&&speed>65);
 context.G.classes=null;assert.equal(context.safeRunSpeed(),null);
});
