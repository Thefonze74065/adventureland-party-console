import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {test,expect} from './fixtures';
import {ConsoleBuildStore} from '../tools/console-build/store';
import {ConsoleBuildController} from '../tools/console-build/controller';
import {safeReload} from '../tools/console-build/safe-reload';
import {consoleMaintenance} from '../runtime/coordinator/lifecycle/console-maintenance';
import type {CandidateManifest} from '../tools/console-build/contracts';
import {readJson} from '../tools/build-store';

test('safe maintenance replaces a stopped slot owner without accepting a missing acknowledgement',async({},info)=>{
  // Failure inventory: an old merchant remains sticky after a slot handoff;
  // merely stale/missing clients are incorrectly retired; a replacement's
  // combat or missing ack is ignored; an assigned stopped client is skipped.
  const root=info.outputPath('slot-handoff'),maintenance=consoleMaintenance(root);
  await mkdir(path.join(root,'updates'),{recursive:true});
  await writeFile(path.join(root,'updates/pause.json'),JSON.stringify({id:'handoff',mode:'draining',expires:Date.now()+60000}));
  const held={seenAt:Date.now(),consoleMaintenance:{id:'handoff',mode:'draining',combat:false,ready:true}};
  const reports:any={Merchant:held};
  const ledger:any[]=[];
  ledger.push(maintenance.status(reports,['Merchant']));
  expect(ledger.at(-1).ready).toBe(true);
  reports.Merchant={...held,seenAt:Date.now()-20000};reports.BankBoi={seenAt:Date.now()};
  ledger.push(maintenance.status(reports,['BankBoi']));
  expect(ledger.at(-1).waiting).toEqual(['Merchant','BankBoi']);
  ledger.push(maintenance.status(reports,['BankBoi'],false,['Merchant']));
  expect(ledger.at(-1).waiting).toEqual(['BankBoi']);
  reports.BankBoi={...held,seenAt:Date.now()};
  ledger.push(maintenance.status(reports,['BankBoi'],false,['Merchant']));
  expect(ledger.at(-1).ready).toBe(true);
  ledger.push(maintenance.status(reports,['Merchant','BankBoi'],false,['Merchant']));
  expect(ledger.at(-1).waiting).toEqual(['Merchant']);
  await info.attach('safe-slot-handoff-ledger',{body:JSON.stringify(ledger),contentType:'application/json'});
});

test('safe reload requires fresh combat-free acknowledgements and preserves interrupted waits',async({},info)=>{
  const root=info.outputPath('safe-host'),store=new ConsoleBuildStore(root),maintenance=consoleMaintenance(root);
  const ledger:any[]=[];
  let combat=true,stale=false,finish:(()=>void)|undefined;
  const driver={...safeReload(root,async()=>{
    const lease=maintenance.current();
    return maintenance.status({Fighter:{seenAt:Date.now()-(stale?10000:0),consoleMaintenance:{id:lease?.id,mode:'draining',combat,ready:!combat}}},['Fighter']);
  }),async activate(candidate:any){ledger.push({action:'activate',target:candidate.manifest.id});await new Promise<void>(resolve=>{finish=resolve;});},
  async restore(){ledger.push({action:'restore'});}};
  const controller=new ConsoleBuildController(store,driver);
  async function stage(label:string){
    const id=createHash('sha256').update(label).digest('hex'),directory=path.join(root,label);
    await mkdir(path.join(directory,'app'),{recursive:true});await writeFile(path.join(directory,'app/artifact.txt'),label);
    const manifest:CandidateManifest={schema:1,id,sourceHash:id,createdAt:new Date().toISOString(),components:{dashboard:id,coordinator:id,characters:id},files:{'artifact.txt':id}};
    await store.complete(directory,manifest);return id;
  }
  const a=await stage('A'),b=await stage('B');await store.setReferences({active:a,latest:b});
  const cleanup=store.cleanup.bind(store);
  let finishCleanup:(()=>void)|undefined;
  store.cleanup=async()=>{await new Promise<void>(resolve=>{finishCleanup=resolve;});await cleanup();};
  try{
    const request=await controller.deploy(b,'safe');
    await expect.poll(()=>maintenance.current()?.id).toBe(request.id);
    expect((await store.journal())?.phase).toBe('waiting-safe');
    await new Promise(resolve=>setTimeout(resolve,1200));expect(ledger).toHaveLength(0);
    combat=false;stale=true;
    await new Promise(resolve=>setTimeout(resolve,1200));expect(ledger).toHaveLength(0);
    stale=false;
    await new Promise(resolve=>setTimeout(resolve,2200));expect(ledger).toHaveLength(0);
    combat=true;
    await new Promise(resolve=>setTimeout(resolve,700));expect(ledger).toHaveLength(0);
    combat=false;
    const clearedAt=Date.now();
    await new Promise(resolve=>setTimeout(resolve,2200));expect(ledger).toHaveLength(0);
    await expect.poll(()=>ledger.length,{timeout:6000}).toBe(1);
    expect(Date.now()-clearedAt).toBeGreaterThanOrEqual(3000);
    ledger[0].combatClearWindowMs=Date.now()-clearedAt;
    expect((await store.references()).active).toBe(a);
    expect((await readJson<{id:string}>(path.join(root,'updates/pause.json')))?.id).toBe(request.id);
    finish?.();await expect.poll(async()=>(await store.journal())?.phase).toBe('complete');
    await expect.poll(()=>readJson(path.join(root,'updates/pause.json'))).toBeUndefined();
    expect((await store.references()).active).toBe(b);
    await expect.poll(()=>!!finishCleanup).toBe(true);
    expect((await store.journal())?.phase).toBe('complete');
    // Cleanup is still blocked, but the real host lease has already released.
    expect(await readJson(path.join(root,'updates/pause.json'))).toBeUndefined();
    finishCleanup?.();store.cleanup=cleanup;
    await new Promise(resolve=>setTimeout(resolve,300));
    combat=true;
    const waiting=await controller.deploy(a,'safe');await expect.poll(()=>maintenance.current()?.id).toBe(waiting.id);
    controller.stopWaiting();await expect.poll(async()=>(await store.journal())?.phase).toBe('failed');
    expect(ledger).toHaveLength(1);expect(ledger[0]).toMatchObject({action:'activate',target:b});expect((await store.references()).active).toBe(b);
    await expect.poll(()=>readJson(path.join(root,'updates/pause.json'))).toBeUndefined();
    await store.setJournal({...waiting,phase:'waiting-safe'});
    await controller.recover();
    expect((await store.journal())?.phase).toBe('failed');expect((await store.references()).active).toBe(b);
    await info.attach('safe-host-journals-and-activation',{body:JSON.stringify({ledger,status:await controller.status()}),contentType:'application/json'});
  }finally{controller.stopWaiting();finish?.();finishCleanup?.();}
});
