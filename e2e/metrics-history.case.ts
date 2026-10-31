import {build} from 'esbuild';
import {test,expect} from './fixtures';

test('metrics persists deduplicated native observations across coordinator restart',async({app,page},info)=>{
  const at=Math.floor(Date.now()/10000)*10000;
  const sample={at:at+100,gold:100,luck:100,ping:30,level:1,xp:0,maxXp:100};
  const frame={at,sequence:1,observedMs:1000,partial:false,damage:[{monster:'goo',skill:'attack',amount:23,hits:1}],credits:[],kills:[{id:'metrics-native-death',at:at+100,monster:'goo',actor:'W'}],loot:[],first:sample,last:sample};
  const batch={character:'W',server:'US I',runtime:'metrics-e2e',frames:[frame]};
  const receipts:Array<{status:number;body:string}>=[];
  const deliver=async()=>{
    const response=await page.request.post(app.url+'/party-api/metrics',{data:batch,headers:{origin:app.url}});
    const body=await response.text();receipts.push({status:response.status(),body});
    expect(response.ok(), 'Metrics ingest HTTP '+response.status()+': '+body).toBeTruthy();
  };
  await deliver();await deliver();
  await app.restartCoordinator();
  await deliver();
  const response=await page.request.get(app.url+'/party-api/metrics?from='+at+'&to='+(at+20000));
  expect(response.ok()).toBeTruthy();const history=await response.json();
  const points=history.points;expect(points.flatMap((p:any)=>p.kills).reduce((n:number,k:any)=>n+k.count,0)).toBe(1);
  expect(points.flatMap((p:any)=>p.values).flatMap((v:any)=>v.damage).reduce((n:number,d:any)=>n+d.amount,0)).toBe(23);
  await info.attach('metrics-restart-deduplication',{body:JSON.stringify({receipts,history}),contentType:'application/json'});
});


test('metrics collector retries persisted browser frames after CODE replacement',async({page},info)=>{
  // Failure inventory: a numeric ring-header loses queued frames on reload;
  // replacement CODE changes receipt identity or resamples old gold; legacy
  // frame content must remain immutable until coordinator acknowledgement.
  const built=await build({entryPoints:['runtime/characters/metrics.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
  const script=built.outputFiles[0].text;
  await page.goto('/');
  const install=async(deliver:boolean)=>{
    await page.addScriptTag({content:script});
    await page.evaluate(deliver=>{
      const host=window as any;host.metricsReceived=[];
      host.installPartyMetrics({now:()=>Date.now(),current:()=>true,connected:()=>true,name:()=> 'BrowserMetricsE2E',own:()=>true,ownedCharacter:()=>true,
        context:()=>({server:'USII',map:'main',instance:'main',party:[]}),sample:()=>({gold:deliver?999:111,luck:1,ping:20,level:1,xp:0,maxXp:100}),
        storage:localStorage,send:async(batch:any)=>{if(!deliver)throw Error('Declared unavailable coordinator');host.metricsReceived.push(batch);return {ok:true};}});
    },deliver);
  };
  await install(false);
  const key='party-metrics-v1:BrowserMetricsE2E';
  await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null')?.queue.length||0,key)).toBeGreaterThan(0);
  const pending=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
  const sequence=pending.queue[0];expect(typeof sequence).toBe('number');
  await page.reload();await install(true);
  await expect.poll(()=>page.evaluate(({runtime,sequence})=>(window as any).metricsReceived.some((b:any)=>b.runtime===runtime&&b.frames.some((f:any)=>f.sequence===sequence&&f.first.gold===111)),{runtime:pending.runtime,sequence})).toBe(true);
  const received=await page.evaluate(()=>(window as any).metricsReceived);
  const matching=received.flatMap((b:any)=>b.frames.filter((f:any)=>f.sequence===sequence));expect(matching).toHaveLength(1);expect(matching[0].last.gold).toBe(111);
  await info.attach('metrics-browser-replacement-retries',{body:JSON.stringify({pending,received}),contentType:'application/json'});
});

test('metrics outbox keeps ring keys only for unconfirmed frames across a reload',async({page},info)=>{
  // Failure inventory: docs/efficiency.md, Persistence, P11. A confirmed frame keeps its
  // ring key; a reload loses or changes an unconfirmed frame; the cleanup removes the slot
  // of a queued frame or a key that is not the collector's.
  const built=await build({entryPoints:['runtime/characters/metrics.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
  const script=built.outputFiles[0].text,key='party-metrics-v1:BrowserOutboxE2E';
  const at=Math.floor(Date.now()/10000)*10000,sample={at,gold:4242,luck:1,ping:20,level:1,xp:0,maxXp:100};
  const queued={at,sequence:41,observedMs:1000,partial:false,damage:[{monster:'goo',skill:'attack',amount:7,hits:1}],credits:[],kills:[],loot:[],first:sample,last:sample,server:'USII'};
  await page.goto('/');
  // The 1.5 collector kept every confirmed frame's ring key until the ring wrapped.
  await page.evaluate(({key,queued})=>{
    for(let sequence=1;sequence<=40;sequence++)localStorage.setItem(key+':frame:'+sequence,JSON.stringify({...queued,sequence}));
    localStorage.setItem(key+':frame:41',JSON.stringify(queued));
    localStorage.setItem(key,JSON.stringify({runtime:'outbox-e2e',sequence:41,queue:[41],lost:false,goldMovement:0}));
    localStorage.setItem('cm_BrowserOutboxE2E_other','["fixture"]');
  },{key,queued});
  // The collector may append a frame between separate browser evaluations.
  // Compare its header and ring from one synchronous storage snapshot.
  const snapshot=()=>page.evaluate(key=>({
    header:JSON.parse(localStorage.getItem(key)||'null'),
    ringKeys:Object.keys(localStorage).filter(name=>name.startsWith(key+':frame:')).sort(),
  }),key);
  const ringKeys=async()=>(await snapshot()).ringKeys;
  const header=async()=>(await snapshot()).header;
  const install=async(deliver:boolean)=>{
    await page.addScriptTag({content:script});
    await page.evaluate(deliver=>{
      const host=window as any;host.metricsReceived=[];
      host.installPartyMetrics({now:()=>Date.now(),current:()=>true,connected:()=>true,name:()=> 'BrowserOutboxE2E',own:()=>true,ownedCharacter:()=>true,
        context:()=>({server:'USII',map:'main',instance:'main',party:[]}),sample:()=>({gold:1,luck:1,ping:20,level:1,xp:0,maxXp:100}),
        storage:localStorage,send:async(batch:any)=>{if(!deliver)throw Error('Declared unavailable coordinator');host.metricsReceived.push(batch);return {ok:true};}});
    },deliver);
  };
  await install(false);
  expect(await ringKeys(),'install removes the confirmed 1.5 ring keys and keeps the queued slot').toEqual([key+':frame:41']);
  await expect.poll(async()=>(await header()).queue.length,{timeout:15_000}).toBeGreaterThanOrEqual(3);
  const pendingSnapshot=await snapshot(),pending=pendingSnapshot.header;
  expect(pendingSnapshot.ringKeys).toEqual(pending.queue.map((sequence:number)=>key+':frame:'+(sequence%1024)).sort());
  await page.reload();await install(true);
  await expect.poll(()=>page.evaluate(sequences=>{
    const sent=(window as any).metricsReceived.flatMap((batch:any)=>batch.frames.map((frame:any)=>frame.sequence));
    return sequences.every((sequence:number)=>sent.includes(sequence));
  },pending.queue),{timeout:15_000}).toBe(true);
  const received=await page.evaluate(()=>(window as any).metricsReceived);
  const frames=received.flatMap((batch:any)=>batch.frames);
  for(const sequence of pending.queue)expect(frames.filter((frame:any)=>frame.sequence===sequence),'frame '+sequence+' sent once').toHaveLength(1);
  const original=frames.find((frame:any)=>frame.sequence===41);
  expect(original.first.gold).toBe(4242);expect(original.damage).toEqual(queued.damage);
  expect(received.every((batch:any)=>batch.runtime==='outbox-e2e')).toBe(true);
  // Every confirmed frame leaves the store; at most the frames still queued keep a key.
  await expect.poll(async()=>{const current=await snapshot(),queue=current.header.queue;return JSON.stringify(current.ringKeys)===JSON.stringify(queue.map((sequence:number)=>key+':frame:'+(sequence%1024)).sort())&&queue.length<=2;},{timeout:15_000}).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('cm_BrowserOutboxE2E_other'))).toBe('["fixture"]');
  await info.attach('metrics-outbox-ring-keys',{body:JSON.stringify({pending,received,ringKeys:await ringKeys()}),contentType:'application/json'});
});
