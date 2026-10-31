const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { farmingAreas, validFarmingLocation } = require('../../.build/shared/farming-areas.cjs');
const box = (boundary, map = 'main') => ({ map, boundary, x: (boundary[0]+boundary[2])/2, y: (boundary[1]+boundary[3])/2 });
test('farming location validation preserves raw input rejection and exact coordinate matching',()=>{
  const catalog=[{id:'a',locations:[box([0,0,100,100])]}];
  for(const ids of [null,{},[],[1],['missing']])assert.equal(validFarmingLocation(catalog,ids,{map:'main',x:50,y:50}),null);
  for(const location of [undefined,null,false,0,'main',{}, {map:'main',x:'50',y:50}])
    assert.equal(validFarmingLocation(catalog,['a'],location),null);
  assert.equal(validFarmingLocation(catalog,['a'],Object.create({map:'main',x:50,y:50})).map,'main');
});
test('shared intersections rank ahead of individual areas without merging different maps or touching edges', () => {
  const catalog = [{ id:'a', locations:[box([0,0,100,100])] }, { id:'b', locations:[box([50,50,150,150]), box([0,0,100,100],'cave')] }, {id:'c',locations:[box([100,0,200,40])]}];
  const areas = farmingAreas(catalog,['a','b','c']);
  assert.deepEqual(areas[0].monsterIds,['a','b']); assert.deepEqual(areas[0].boundary,[50,50,100,100]);
  assert.equal(areas.filter(a => a.monsterIds.length > 1).length,1);
  assert.deepEqual(validFarmingLocation(catalog,['a','b'],{map:'main',x:75,y:75}).monsterIds,['a','b']);
  assert.equal(validFarmingLocation(catalog,['a'],{map:'main',x:75,y:75}),null);
});
test('identical regions deduplicate, three-way overlaps lead, and point-only spawns combine only at identical coordinates', () => {
  const catalog = [{id:'a',locations:[box([0,0,100,100]),{map:'main',x:999,y:999}]}, {id:'b',locations:[box([0,0,100,100]),{map:'main',x:999,y:999}]},{id:'c',locations:[box([25,25,75,75])]}];
  const areas = farmingAreas(catalog,['a','b','c']);
  assert.deepEqual(areas[0].monsterIds,['a','b','c']);
  assert.equal(areas.filter(a => a.boundary?.join() === '0,0,100,100').length,1);
  assert.deepEqual(areas.find(a=>a.x===999).monsterIds,['a','b']);
  assert.deepEqual(farmingAreas(catalog,[]),[]);
});
function catalogFromGame() {
  const context = { G: { monsters: Object.fromEntries(['snake','osnake','phoenix','mvampire'].map(id=>[id,{name:id}])), maps: {
    main: { monsters: [{type:'snake',boundary:[-254,1812,90,1990],count:6},
      {type:'phoenix',boundaries:[['main',708,-300,1668,-86],['main',378,1686,904,1920],['main',-1358,-118,-1010,1680],['halloween',-166,453,182,808],['cave',-375,-1287,14,-1041]],count:1}] },
    halloween: { monsters: [{type:'osnake',boundary:[-654,-384,-525,-287],count:2},{type:'osnake',boundary:[-620,-821,-398,-431],count:4},
      {type:'snake',boundary:[-720,-820,-418,-203],count:9},{type:'snake',boundary:[141,-792,552,-702],count:6},{type:'osnake',boundary:[141,-792,552,-702],count:2}] },
    cave: { monsters: [{type:'mvampire',boundaries:[['cave',-367,-1296,-14,-1057],['cave',1068,-123,1420,78]],count:1}] }
  } } };
  const source = fs.readFileSync('characters/shared.js','utf8');
  const fn = source.slice(source.indexOf('  function monsterChoices('),source.indexOf('  function bestiaryCatalog()'));
  context.monsterSpriteDefinition = () => null;
  vm.runInNewContext(fn+';result=monsterChoices()',context);
  return JSON.parse(JSON.stringify(context.result));
}
test('real snake catalog ranks shared areas first and includes every multi-map spawn boundary', () => {
  const catalog = catalogFromGame(), areas = farmingAreas(catalog,['snake','osnake']);
  assert.equal(areas.filter(a=>a.monsterIds.length===2).length,3);
  assert.ok(areas.slice(0,3).every(a=>a.map==='halloween'));
  assert.equal(areas.filter(a=>a.boundary?.join()==='141,-792,552,-702').length,1);
  assert.equal(catalog.find(a=>a.id==='phoenix').locations.length,5);
  assert.equal(catalog.find(a=>a.id==='mvampire').locations.length,2);
  assert.ok(farmingAreas(catalog,['snake']).some(a=>a.map==='main'));
});
test('bestiary validates selection before releasing escape or changing farming state', () => {
  const source=require('./helpers/coordinator-source.cjs').coordinatorSource();
  const start=source.indexOf('express_inst.post("/party-api/navigate-to-monster"');
  const route=source.slice(start,source.indexOf('express_inst.post("/party-api/focus"',start));
  let handler; const party={monsterChoices:[{id:'a',locations:[box([0,0,100,100])]}],leader:'warrior',statuses:{warrior:{seenAt:Date.now()}}};
  const context={express_inst:{post:(url,fn)=>{if(url==='/party-api/navigate-to-monster')handler=fn;}},party,validFarmingLocation,escapeControl:{release:()=>assert.fail('released on invalid input')},Date};
  handler=require('./helpers/coordinator-monster-selection.cjs').monsterRoutes(context).navigate;
  let status;const res={status:n=>{status=n;return res;},json:()=>{}};
  handler({body:{monsterId:'a',location:{map:'cave',x:1,y:1}}},res);
  assert.equal(status,409);assert.equal(party.farmingPolicy,undefined);
});
