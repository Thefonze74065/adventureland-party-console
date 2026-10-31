import {test, expect} from './fixtures';
import {build} from 'esbuild';
import {mkdir, writeFile} from 'node:fs/promises';
import {randomUUID, createHash} from 'node:crypto';
import path from 'node:path';
import {LocalSteam, steamBridgeSource} from '../tools/steam/service';
import {SteamPreferenceStore} from '../tools/steam/preferences';
import {ConsoleBuildStore} from '../tools/console-build/store';
import {cleanupWorkspace} from './workspace';

// Failure inventory: checkout/active versions disagree; every desktop refresh
// destroys recovery state; same-page socket loading repeatedly reloads login;
// the released primary is null until CODE arrives, deadlocking CODE startup;
// staged candidates leak into live injection; integrity errors silently fall back.
// Native account saves and runner creation are the declared external boundaries.
test('Steam desktop preserves bridge recovery and finishes a released primary loading on its destination', async ({browser}, info) => {
  const root=process.cwd(), directory=path.join(root,'.build/e2e','scenario-'+randomUUID());
  await mkdir(directory,{recursive:true});
  const page=await browser.newPage();
  let steam:LocalSteam|undefined;
  const packets:Record<string,unknown>[]=[];
  try {
    const bundle=await build({entryPoints:['runtime/steam/entry.ts'],bundle:true,write:false,platform:'browser',format:'iife'});
    const source='window.installations=(window.installations||0)+1;\n'+bundle.outputFiles[0].text;
    const hash=createHash('sha256').update(source).digest('hex');
    const store=new ConsoleBuildStore(directory), stage=path.join(directory,'stage');
    await mkdir(path.join(stage,'app/characters'),{recursive:true});
    await writeFile(path.join(stage,'app/characters/steam-bridge.js'),source);
    const candidate=await store.complete(stage,{schema:1,id:hash,sourceHash:hash,createdAt:new Date().toISOString(),components:{dashboard:hash,characters:hash,coordinator:hash},files:{'characters/steam-bridge.js':hash}});
    await store.setReferences({active:candidate.manifest.id,latest:candidate.manifest.id});
    await mkdir(path.join(directory,'characters'),{recursive:true});
    await writeFile(path.join(directory,'characters/steam-bridge.js'),'throw Error("Checkout bridge must never be injected");');
    const origin='http://127.0.0.1:19399';
    const operation={id:'released-primary',phase:'navigate',releasedAt:1,destinationRealm:'SR_USII',target:'P',multi:{primary:'P',desired:['P'],before:['P'],release:[],arrived:[]}};
    await page.route(origin+'/**',async route=>{
      if(route.request().method()==='POST') {
        const packet=route.request().postDataJSON();packets.push(packet);
        const arrived=Array.isArray(packet.running)&&packet.running.includes('P');
        await route.fulfill({json:{operation:{...operation,phase:arrived?'complete':'navigate'},primary:arrived?'P':null,steam:['P'],realm:'SR_USII',members:[]}});
      } else await route.fulfill({contentType:'text/html',body:'<!doctype html><body><p>Native game loading</p></body>'});
    });
    await page.goto(origin+'/character/P/in/US/II/');
    await page.clock.install();
    await page.evaluate(()=>{
      const host=window as any;
      host.__TAURI_INTERNALS__={};host.documentIdentity='original';
      host.X={characters:[{name:'P',id:'owned-p'}],codes:{}};
      host.storage_get=()=>null;host.storage_set=()=>{};host.api_call=async()=>({success:true});
      host.socket={connected:false,disconnect(){throw Error('An arrival must not disconnect');}};
      host.stop_runner=()=>{};host.starts=0;
      host.start_runner=()=>{
        host.starts++;host.code_active=true;
        const frame=document.createElement('iframe');frame.id='maincode';document.body.append(frame);
        (frame.contentWindow as any).__partyStatusSuccessAt=Date.now();
      };
    });
    const preferences=new SteamPreferenceStore(directory);
    await preferences.save({placement:'same',client:'windows-steam'});
    steam=new LocalSteam(preferences,{
      platform:'win32',targets:async()=>[{url:page.url(),socket:'unused'}],
      executable:async()=>{throw Error('Existing desktop must be reused');},running:async()=>true,
      launch:async()=>{throw Error('No duplicate desktop');},bridgeReady:async()=>true,
      connect:async()=>({evaluate:expression=>page.evaluate(expression),close(){}}),
      server:async()=>origin,source:()=>steamBridgeSource(directory),now:Date.now,sleep:async()=>{},
    });
    await steam.ensure('P');
    await page.clock.runFor(2000);
    expect(await page.evaluate(()=>(window as any).documentIdentity)).toBe('original');
    await page.evaluate(()=>{const host=window as any;host.character={name:'P'};host.socket.connected=true;host.server_region='US';host.server_identifier='II';});
    await page.clock.runFor(3000);
    await steam.ensure('P');
    await page.clock.runFor(3000);
    await steam.ensure('P');
    await page.clock.runFor(3000);
    await expect.poll(()=>packets.some(packet=>Array.isArray(packet.running)&&packet.running.includes('P'))).toBe(true);
    const result=await page.evaluate(()=>({installations:(window as any).installations,starts:(window as any).starts,identity:(window as any).documentIdentity,active:(window as any).code_active}));
    expect(result).toEqual({installations:1,starts:1,identity:'original',active:true});
    // Corrupt active code must fail closed, never select the checkout fallback.
    await writeFile(path.join(candidate.directory,'characters/steam-bridge.js'),'corrupted');
    await expect(steamBridgeSource(directory)).rejects.toThrow('integrity');
    await info.attach('steam-desktop-arrival-ledger',{body:JSON.stringify({result,packets,active:candidate.manifest.id}),contentType:'application/json'});
    await info.attach('steam-desktop-arrival',{body:await page.screenshot(),contentType:'image/png'});
  } finally {
    steam?.stop();await page.close();
    const cleanup=cleanupWorkspace(root,directory);
    await info.attach('steam-workspace-cleanup',{body:JSON.stringify(cleanup),contentType:'application/json'});
  }
});
