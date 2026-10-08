const test=require('node:test'),assert=require('node:assert/strict');
const {createLuckyUpgrade}=require('../../runtime/characters/lucky-upgrade.ts');
function fixture(options={}) {
 const items=Array(42).fill(null);items[2]={name:'sword',level:3,rid:'exact'};items[4]={name:'scroll0',q:2};items[7]=options.occupant||null;
 let journal=null,now=0,busy=false,current=true;const swaps=[],logs=[],calls=[];
 const ports={item:i=>items[i],busy:()=>busy,read:()=>journal,write:j=>{journal=j&&structuredClone(j);},now:()=>now,current:()=>current,
  sleep:async ms=>{now+=ms;},log:s=>logs.push(s),swap:async(a,b)=>{swaps.push([a,b]);if(options.reject)throw Error('imove rejected');if(!options.stall)[items[a],items[b]]=[items[b],items[a]];}};
 const service=createLuckyUpgrade(ports);
 const action=async(slot,scroll)=>{calls.push([slot,scroll]);if(options.pending){busy=true;throw Error('timed out');}
  if(items[scroll].q>1)items[scroll].q--;else items[scroll]=null;
  if(options.destroy){items[slot]=null;throw Object.assign(Error('destroyed'),{reason:'upgrade_destroyed'});}
  if(!options.survive)items[slot].level++;return {slot};};
 return {items,swaps,logs,calls,service,action,ports,get journal(){return journal;},setBusy:v=>busy=v,setCurrent:v=>current=v};
}
// Historical journal metadata can gain or lose null properties on native drag.
// Preserve actual non-null identity mismatches; normalize both legacy evidence
// and current inventory before comparing, including result and displaced fields.
for(const legacy of [false,true])test('persisted lucky journal tolerates native null metadata '+legacy,async()=>{
 const f=fixture({occupant:{name:'tracker'}});
 f.items[2]={name:'tracker',...(!legacy?{p:null}:{})};
 f.items[7]={name:'sword',level:4,rid:'exact',...(!legacy?{p:null}:{})};
 f.ports.write({from:2,to:7,item:{name:'sword',level:3,rid:'exact',...(legacy?{p:null}:{})},displaced:{name:'tracker',...(legacy?{p:null}:{})},phase:'running'});
 await f.service.recover();
 assert.equal(f.journal,null);assert.equal(f.items[2].level,4);assert.equal(f.items[7].name,'tracker');
});
for(const occupant of [null,{name:'hpot0',q:200},{name:'sword',level:3,rid:'other'}])test('upgrade in slot 7 and restore displaced '+JSON.stringify(occupant),async()=>{
 const f=fixture({occupant});await f.service.run(2,4,7,f.action);
 assert.deepEqual(f.calls,[[7,4]]);assert.equal(f.items[2].level,4);assert.deepEqual(f.items[7],occupant);assert.equal(f.journal,null);
});
test('scroll occupying lucky slot is remapped and its consumed quantity restored',async()=>{
 const f=fixture({occupant:{name:'scroll1',q:1}});await f.service.run(2,7,7,f.action);
 assert.deepEqual(f.calls,[[7,2]]);assert.equal(f.items[7],null);assert.equal(f.items[2].level,4);
});
test('already in lucky slot needs no swap',async()=>{
 const f=fixture();[f.items[2],f.items[7]]=[f.items[7],f.items[2]];await f.service.run(7,4,7,f.action);assert.deepEqual(f.swaps,[]);
});
test('full bag does not prevent a swap',async()=>{
 const f=fixture();for(let i=0;i<42;i++)f.items[i]??={name:'filler'+i};await f.service.run(2,4,7,f.action);assert.equal(f.items[7].name,'filler7');
});
for(const options of [{reject:true},{stall:true}])test('failed preparation sends zero upgrades '+JSON.stringify(options),async()=>{
 const f=fixture(options);await assert.rejects(f.service.run(2,4,7,f.action),/Couldn't use lucky slot/);assert.equal(f.calls.length,0);
});
for(const slot of [null,undefined,-1,42,7.5,'7'])test('unverified slot upgrades normally without swaps or lucky logs: '+slot,async()=>{
 const f=fixture();await f.service.run(2,4,slot,f.action);
 assert.deepEqual(f.calls,[[2,4]]);assert.equal(f.items[2].level,4);
 assert.deepEqual(f.swaps,[]);assert.deepEqual(f.logs,[]);assert.equal(f.journal,null);
});
test('ordinary fallback passes the offering unchanged and guards concurrent inventory work',async()=>{
 const f=fixture();f.items[6]={name:'offeringp'};let finish;
 const running=f.service.run(2,4,null,async(slot,scroll,offering)=>{
  assert.deepEqual([slot,scroll,offering],[2,4,6]);await new Promise(resolve=>finish=resolve);
 },6);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.service.pending(),true);
 await assert.rejects(f.service.run(2,4,null,f.action),/another upgrade/);
 finish();await running;assert.equal(f.service.pending(),false);
});
test('ordinary fallback preserves action failures and does not bypass unresolved inventory recovery',async()=>{
 const f=fixture({destroy:true});await assert.rejects(f.service.run(2,4,null,f.action),/destroyed/);
 assert.equal(f.items[2],null);assert.deepEqual(f.swaps,[]);assert.equal(f.service.pending(),false);
 const blocked=fixture({pending:true});await assert.rejects(blocked.service.run(2,4,7,blocked.action),/pending/);
 await assert.rejects(blocked.service.run(2,4,null,blocked.action),/pending/);assert.equal(blocked.calls.length,1);
});
test('destroyed item restores displaced contents and preserves destruction error',async()=>{
 const f=fixture({destroy:true,occupant:{name:'tracker'}});await assert.rejects(f.service.run(2,4,7,f.action),/destroyed/);
 assert.equal(f.items[2],null);assert.equal(f.items[7].name,'tracker');assert.equal(f.journal,null);
});
test('surviving failure returns the exact unchanged item',async()=>{
 const f=fixture({survive:true});await f.service.run(2,4,7,f.action);assert.equal(f.items[2].level,3);assert.equal(f.items[2].rid,'exact');
});
test('pending operation survives service replacement and is reconciled before new work',async()=>{
 const f=fixture({pending:true,occupant:{name:'tracker'}});await assert.rejects(f.service.run(2,4,7,f.action),/pending/);
 assert.equal(f.journal.phase,'running');assert.equal(f.swaps.length,1);
 const next=createLuckyUpgrade(f.ports);await assert.rejects(next.recover(),/pending/);
 f.setBusy(false);f.items[7].level=4;await next.recover();assert.equal(f.items[2].level,4);assert.equal(f.items[7].name,'tracker');assert.equal(f.journal,null);
});
test('changed displaced item prevents restoration instead of moving unrelated inventory',async()=>{
 const f=fixture({occupant:{name:'tracker'}});await assert.rejects(f.service.run(2,4,7,async()=>{f.items[2]={name:'unexpected'};}),/displaced item changed/);
 assert.equal(f.swaps.length,1);assert.ok(f.journal);
});

test('delivery into the freed lucky slot does not hide a completed return swap',async()=>{
 const f=fixture(),swap=f.ports.swap;
 f.ports.swap=async(a,b)=>{await swap(a,b);if(f.journal?.phase==='restoring')f.items[7]={name:'seashell',q:6,m:'GDroidPT'};};
 await f.service.run(2,4,7,f.action);
 assert.equal(f.items[2].level,4);assert.equal(f.items[7].name,'seashell');assert.equal(f.journal,null);assert.equal(f.swaps.length,2);
});

test('persisted completed return recovers with an incoming item occupying the lucky slot',async()=>{
 const f=fixture();f.items[2]={name:'wcap',level:3};f.items[7]={name:'seashell',q:6,m:'GDroidPT'};
 f.ports.write({from:2,to:7,item:{name:'wcap',level:2},displaced:null,phase:'restoring',result:{name:'wcap',level:3}});
 await f.service.recover();assert.equal(f.journal,null);assert.equal(f.swaps.length,0);assert.equal(f.items[7].name,'seashell');
});

test('delivery into the source cell during upgrade is preserved by the return swap',async()=>{
 const f=fixture();
 await f.service.run(2,4,7,async(slot,scroll)=>{await f.action(slot,scroll);f.items[2]={name:'seashell',q:3,m:'GermanicHP'};});
 assert.equal(f.items[2].level,4);assert.deepEqual(f.items[7],{name:'seashell',q:3,m:'GermanicHP'});assert.equal(f.journal,null);
});

test('persisted running upgrade recovers after delivery filled the original empty cell',async()=>{
 const f=fixture();f.items[2]={name:'seashell',q:3};f.items[7]={name:'wcap',level:4};
 f.ports.write({from:2,to:7,item:{name:'wcap',level:3},displaced:null,phase:'running'});
 await f.service.recover();assert.equal(f.items[2].name,'wcap');assert.equal(f.items[7].name,'seashell');assert.equal(f.journal,null);
});

test('destroyed upgrade still preserves a delivery into its former source cell',async()=>{
 const f=fixture({destroy:true});
 await assert.rejects(f.service.run(2,4,7,async(slot,scroll)=>{
  f.items[2]={name:'seashell',q:3};return f.action(slot,scroll);
 }),/destroyed/);
 assert.equal(f.items[2],null);assert.equal(f.items[7].name,'seashell');assert.equal(f.journal,null);
});

test('unexpected lucky-slot contents cannot authorize adopting an incoming source item',async()=>{
 const f=fixture();f.items[2]={name:'seashell',q:3};f.items[7]={name:'unrelated'};
 f.ports.write({from:2,to:7,item:{name:'wcap',level:3},displaced:null,phase:'running'});
 await assert.rejects(f.service.recover(),/inventory recovery required/);
 assert.equal(f.journal.displaced,null);assert.equal(f.swaps.length,0);
});

test('incoming item cannot prove recovery when the result is missing or displaced inventory is unresolved',async()=>{
 for(const displaced of [null,{name:'tracker'}]) {
  const f=fixture();f.items[2]=displaced?{name:'wcap',level:3}:null;f.items[7]={name:'seashell',q:6};
  f.ports.write({from:2,to:7,item:{name:'wcap',level:2},displaced,phase:'restoring',result:displaced?{name:'wcap',level:3}:null});
  await assert.rejects(f.service.recover(),/inventory recovery required/);assert.ok(f.journal);assert.equal(f.swaps.length,0);
 }
});
test('tidy packs actual inventory in order leaving lucky slot as the sole internal hole',async()=>{
 const f=fixture();f.items.fill(null);for(let i=0;i<20;i++)if(i!==10&&i!==14)f.items[i]={name:'item'+i};
 const before=f.items.filter(Boolean).map(i=>i.name);await f.service.tidy(7);
 assert.equal(f.items[7],null);assert.deepEqual(f.items.filter(Boolean).map(i=>i.name),before);
 const occupied=before.length;for(let i=0;i<=occupied;i++)assert.equal(!!f.items[i],i!==7);
 const swaps=f.swaps.length;await f.service.tidy(7);assert.equal(f.swaps.length,swaps);
});
test('tidy keeps the reserved lucky slot empty at 39 occupied slots',async()=>{
 const f=fixture();f.items.fill(null);for(let i=0;i<39;i++)f.items[i]={name:'item'+i};await f.service.tidy(7);
 assert.equal(f.items[7],null);assert.equal(f.items.filter(Boolean).length,39);assert.equal(f.items[40],null);assert.equal(f.items[41],null);
});
for (const temporary of [false,true]) test('handoff clears server-assigned lucky slot before returning: temporary='+temporary,async()=>{
 const source=require('node:fs').readFileSync('characters/shared.js','utf8');
 const start=source.indexOf('    async function collectFromTarget(useTemporaryReserve)');
 const end=source.indexOf('\n    try {',start);
 const f=fixture();f.items.fill(null);for(let i=0;i<15;i++)if(i!==7)f.items[i]={name:'item'+i};
 let merged=false,capacity;
 const context=require('node:vm').createContext({command:{jobId:'test',target:'fighter'},Date,
  setTimeout:fn=>fn(),waitForPlayer:async()=>{},freeInventorySlots:()=>f.items.filter(i=>!i).length,
  requestMerchantHandoff:async(_url,options)=>{capacity=options.body.capacity;f.items[7]={name:'received'};},
  request:async()=>({handoff:{kept:[{item:{name:'received'}}]}}),mergeHandoff:()=>{merged=true;},
  merchantLuckyUpgrade:()=>f.service,luckyUpgradeSlot:7});
 require('node:vm').runInContext(source.slice(start,end),context);
 await context.collectFromTarget(temporary);
 assert.equal(capacity,28-(temporary?1:3));assert.equal(merged,true);
 assert.equal(f.items[7],null);assert.equal(f.items.filter(Boolean).length,15);
 assert.ok(f.items.some(i=>i?.name==='received'));
});

for (const quantity of [1,3]) test('offering in lucky slot is remapped and its consumed stack restored: '+quantity,async()=>{
 const f=fixture({occupant:{name:'offeringp',q:quantity}});
 await f.service.run(2,4,7,async(slot,scroll,offering)=>{
  assert.equal(offering,2);assert.equal(f.items[offering].name,'offeringp');
  if(f.items[offering].q>1)f.items[offering].q--;else f.items[offering]=null;
  return f.action(slot,scroll);
 },7);
 assert.equal(f.items[2].level,4);assert.deepEqual(f.items[7],quantity===1?null:{name:'offeringp',q:quantity-1});assert.equal(f.journal,null);
});
test('offering consumption restores after restart with a surviving failed item',async()=>{
 const f=fixture();f.items[7]={name:'sword',level:3};f.items[2]={name:'offering',q:1};
 f.ports.write({from:2,to:7,item:{name:'sword',level:3},displaced:{name:'offering',q:2},offeringDisplaced:true,phase:'running'});
 await createLuckyUpgrade(f.ports).recover();assert.equal(f.items[2].name,'sword');assert.deepEqual(f.items[7],{name:'offering',q:1});
});
