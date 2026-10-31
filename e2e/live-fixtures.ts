import {measureBrowserRendering} from './browser-rendering';
import {waitForBrowserClockStartup} from './chronal-browser-startup';
import {waitForLiveRestartState, type RestartStateProbe} from './live-restart-readiness';
import { test as base, unusedPort, child, environment, stop } from './fixtures';
import {expect,installObservationClock} from './network-clock';
import {cleanupWorkspace} from './workspace';
import { launchGameClient, type LiveClient } from './live-game-client';
import { type ChildProcess } from 'node:child_process';
import {createServer as createHttpServer} from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page,Frame,BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gateway } from '../tools/hosting/gateway';
import { Access } from '../tools/hosting/access';
import { selectionFields, stateKeys } from '../runtime/coordinator/persistence/snapshots';
import { loadouts, seedLoadout, type NativeLoadout } from './game/loadouts';
import { nativeEventSpawn, nativeMonsterInitialPosition } from './game/event-spawn';
import {nativeNetworkIsolation} from './native-network-isolation';
import type {GameManifest} from '../tools/game/manifest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bootstrap = require('./game/bootstrap.cjs');
export type LiveGame = {
  url: string;
  coordinatorBinding:{port:number;occupiedPort:number|null};
  clients: Record<string, LiveClient>;
  state(catalogs?: boolean | 'fast'): Promise<any>;
  savedTownCycle(): {id:string;pending:string[];revisions?:Record<string,number>} | null;
  post(route: string, body: unknown): Promise<any>;
  admin(code: string): Promise<any>;
  adminRealm(realm:'USI'|'USII', code:string):Promise<any>;
  holdMerchantStatus(hold:boolean,options?:{inventoryOnly?:boolean}):void;
  consoleDrainLease(id: string | null, expires?: number, options?:{loadMode?:'now'|'safe'|'main';phase?:string}): void;
  restartCoordinator(): Promise<void>;
  restartCoordinatorIdentity(artifactId:string,hash:string):Promise<void>;
  deploymentPaths:{directory:string;apiUrl:string;codeRoots:string[]};
  restoreHistoricalSettings(restore: (settings: any) => any): Promise<void>;
  reconnectClient(name: string): Promise<void>;
};

export const test = base.extend<{ live: LiveGame; occupyCoordinatorPort:boolean; loadout: NativeLoadout; primaryClass: 'warrior' | 'ranger' | 'mage' | 'rogue'; extraFighter: 'mage' | null; merchantDefault: string | null; liveHeadless: boolean; recordNativeVideo: boolean; movementMode: 'alclient' | 'shadow'; staleWorkerRealm: string | null; initialPosition: {map: string; x: number; y: number} | null; initialPositions: Record<string,{map:string;x:number;y:number}> | null; initialEventSpawn: string | null; initialMonsterSpawn: string | null; initialConsoleHold: boolean; initialGatheringReady: boolean; initialPeacefulAmbientMaps: string[] }>({
  occupyCoordinatorPort:[false,{option:true}],
  loadout: ['god', {option:true}],
  primaryClass: ['warrior', {option:true}],
  extraFighter: [null, {option:true}],
  merchantDefault: ['E2EMerchant', {option:true}],
  initialPosition: [null, {option:true}],
  initialPositions: [null, {option:true}],
  initialMonsterSpawn: [null, {option:true}],
  initialConsoleHold: [false, {option:true}],
  initialGatheringReady: [false, {option:true}],
  initialPeacefulAmbientMaps: [[], {option:true}],
  initialEventSpawn: [null, {option:true}],
  liveHeadless: [false, {option:true}],
  recordNativeVideo: [process.env.E2E_NATIVE_VIDEO==='1', {option:true}],
  movementMode: ['alclient', {option:true}],
  staleWorkerRealm: [null, {option:true}],
  live: [async ({ browser, context:dashboardContext, dashboard, occupyCoordinatorPort, loadout, primaryClass, extraFighter, merchantDefault, initialPosition, initialPositions, initialEventSpawn, initialMonsterSpawn, initialConsoleHold, initialGatheringReady, initialPeacefulAmbientMaps, liveHeadless, recordNativeVideo, movementMode, staleWorkerRealm }, use, testInfo) => {
    const pools=JSON.parse(process.env.E2E_GAME_POOLS||'[]');
    const pool=pools[testInfo.parallelIndex];
    if(!pool)throw Error('Missing isolated game pool for parallel worker '+testInfo.parallelIndex);
    Object.assign(process.env,pool.environment);
    const game=bootstrap.createGame({host:pool.host});
    await testInfo.attach('isolated-game-pool',{body:JSON.stringify({host:pool.host,project:pool.project,parallelIndex:testInfo.parallelIndex}),contentType:'application/json'});
    const observationClock=await installObservationClock();
    const directory = path.join(root, '.build/e2e', `live-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const manifest = await game.reset();
    const names=['E2EWarrior','E2EPriest','E2EMerchant',...(extraFighter?['E2EBankBoi']:[])];
    const equipment = await seedLoadout(game.admin, loadout, primaryClass, extraFighter);
    if(initialGatheringReady){
      const availability=await game.admin(`output=(async()=>{
        if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Gathering availability requires disconnected native clients');
        const query={owner:data.owner,name:'e2emerchant'},before=await db.collection('character').findOne(query);
        if(!before)throw Error('Owned gathering merchant missing');
        const ready=new Date(0),update=await db.collection('character').updateOne(query,{$set:{'info.p.dt.fishing':ready,'info.p.dt.mining':ready}});
        if(update.matchedCount!==1)throw Error('Gathering availability seed did not match exactly one character');
        const after=await db.collection('character').findOne(query);
        return {name:after.info.name,before:before.info.p.dt||{},after:after.info.p.dt};})()`,{owner:manifest.auth.split('-')[0]});
      await testInfo.attach('declared-native-gathering-ready-before-login',{body:JSON.stringify(availability),contentType:'application/json'});
    }
    if(initialEventSpawn){const spawn=await nativeEventSpawn(game.admin,initialEventSpawn);initialPosition={...spawn,x:spawn.x+160};
      await testInfo.attach('native-event-catalog-initial-position',{body:JSON.stringify({event:initialEventSpawn,spawn,initialPosition}),contentType:'application/json'});}
    if(initialMonsterSpawn){const spawn=await nativeMonsterInitialPosition(game.admin,initialMonsterSpawn);initialPosition={map:spawn.map,x:spawn.x,y:spawn.y};
      await testInfo.attach('native-monster-collision-safe-initial-position',{body:JSON.stringify(spawn),contentType:'application/json'});}
    if (initialPosition) {
      await game.admin("output=db.collection('character').updateMany({owner:data.owner},{$set:{'info.map':data.map,'info.x':data.x,'info.y':data.y}})", { owner: manifest.auth.split('-')[0], ...initialPosition });
      await testInfo.attach('native-initial-position-seed', { body: JSON.stringify(initialPosition), contentType: 'application/json' });
    }
    if(initialPositions){
      if(Object.keys(initialPositions).some(name=>!names.includes(name)))throw Error('Initial positions contain an unowned native fixture character');
      const staging=await game.admin(`output=(async()=>{
        if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Initial positions require disconnected native clients');
        const result=[];
        for(const [name,point] of Object.entries(data.positions)){
          if(!G.maps[point.map]||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('Invalid declared native position: '+name);
          const body={type:'character',map:point.map,x:point.x,y:point.y};set_base(body);
          const cell=smap_data[point.map]===-1?0:smap_data[point.map]?.[rphash(point.x,point.y)];
          if(!can_move({...body,going_x:point.x,going_y:point.y})||!(cell<2))throw Error('Native geometry rejects declared position: '+name);
          const updated=await db.collection('character').updateOne({name:name.toLowerCase()},{$set:{'info.map':point.map,'info.in':point.map,'info.x':point.x,'info.y':point.y}});
          if(updated.matchedCount!==1)throw Error('Native staging character missing: '+name);
          result.push({name,...point,base:body.base,cell,selfClear:true});
        }return result;})()`,{positions:initialPositions});
      await testInfo.attach('native-separated-initial-positions',{body:JSON.stringify(staging),contentType:'application/json'});
    }
    await testInfo.attach('native-loadout-seed', {body:JSON.stringify(equipment,null,2),contentType:'application/json'});
    await testInfo.attach('live-seed', { body: JSON.stringify({ ...manifest, auth: '[disposable credential omitted]' }, null, 2), contentType: 'application/json' });
    // The child binds port zero atomically; retain its reported port on restart.
    let port=0;
    const occupiedPort=occupyCoordinatorPort?await unusedPort():null, log = path.join(directory, 'coordinator.log');
    let coordinator: ChildProcess | undefined;
    let identityEnvironment:NodeJS.ProcessEnv={};
    const blocked: string[] = [];
    const network=await nativeNetworkIsolation(blocked);
    const context = await browser.newContext({proxy:network.proxy, viewport: { width: 1280, height: 900 },
      ...(recordNativeVideo ? {recordVideo: { dir: testInfo.outputPath('native-video'), size: { width: 960, height: 675 } }} : {}) }).catch(async error=>{await network.close();throw error;});
    if(observationClock.backend==='chronal-network'){
      async function clockContext(context:BrowserContext){
      const frames=new Map<Frame,string>();
      const retire=async(id:string)=>{const url=new URL('/leave',process.env.E2E_CLOCK_BROKER);url.searchParams.set('token',process.env.E2E_CLOCK_TOKEN||'');url.searchParams.set('id',id);await fetch(url);};
      await context.exposeBinding('__e2eChronalFrame',async({frame},id:string)=>{
        const previous=frames.get(frame);if(previous&&previous!==id)await retire(previous);frames.set(frame,id);
      });
      context.on('page',page=>page.on('framedetached',frame=>{const id=frames.get(frame);frames.delete(frame);if(id)void retire(id).catch(error=>exchanges.push({clockRetirementError:String(error)}));}));
      await context.addInitScript({content:
      `globalThis.__e2eClockConfiguration=${JSON.stringify({rate:observationClock.rate,wall:observationClock.wall,epoch:observationClock.epoch,broker:process.env.E2E_CLOCK_BROKER,token:process.env.E2E_CLOCK_TOKEN,scope:directory})};\n`+readFileSync(path.join(root,'.build/sim/browser-clock.js'),'utf8')});
      await waitForBrowserClockStartup(context);
      }
      await clockContext(dashboardContext);await clockContext(context);
    }
    await testInfo.attach('native-video-recording-policy',{body:JSON.stringify({enabled:recordNativeVideo}),contentType:'application/json'});
    const nativePages = new Set<Page>();
    context.on('page', page => nativePages.add(page));
    await context.addCookies([{ name: 'auth', value: manifest.auth, url: manifest.webUrl }]);
    const access = new Access(path.join(directory, 'access.json'));
    await access.load();
    const occupied=createHttpServer((_request,response)=>response.end('owned E2E port occupant'));
    const server = gateway({ access, configured: () => true, dashboardPort: dashboard.port, get apiPort(){return port;} });
    let live: LiveGame | undefined;
    const clients: Record<string, LiveClient> = {};
    const exchanges: unknown[] = [];
    const primaryName = 'E2EWarrior';
    const optionsFor = (name: string) => ({ webUrl: manifest.webUrl, coordinatorUrl: `http://127.0.0.1:${port}`,
      name, region: manifest.region, server: manifest.server,
      ...(name === primaryName ? {} : { primary: clients[primaryName] }) });
    async function start() {
      coordinator = child(path.join(root, 'e2e/live-coordinator.cjs'), [], root,
        environment({ E2E_COORDINATOR_PORT: String(port), E2E_DATA_DIR: directory,
          E2E_GAME_WEB_URL: manifest.webUrl, E2E_GAME_AUTH: manifest.auth, E2E_NATIVE_ARTIFACT: JSON.parse(process.env.E2E_DASHBOARD_CANDIDATE || 'null')?.directory || '', E2E_MERCHANT_DEFAULT: JSON.stringify(merchantDefault), E2E_ALLOW_HEADLESS: String(liveHeadless), PARTY_MOVEMENT_MODE: movementMode, E2E_STALE_WORKER_REALM: staleWorkerRealm || '',
          E2E_CLOCK_RATE:process.env.E2E_CLOCK_RATE||'1',E2E_CLOCK_WALL_EPOCH:process.env.E2E_CLOCK_WALL_EPOCH||'',E2E_CLOCK_VIRTUAL_EPOCH:process.env.E2E_CLOCK_VIRTUAL_EPOCH||'',
          E2E_CLOCK_BROKER:process.env.E2E_CLOCK_BROKER||'',E2E_CLOCK_TOKEN:process.env.E2E_CLOCK_TOKEN||'',E2E_CLOCK_SCOPE:directory,
          E2E_CLOCK_PRELOAD:'1',NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${JSON.stringify(pathToFileURL(path.join(root,'tools/sim/network-clock-preload.mjs')).href)}`].filter(Boolean).join(' '),...identityEnvironment }), log);
      const current = coordinator;
      await new Promise<void>((resolve, reject) => {
        const details = () => existsSync(log) ? readFileSync(log, 'utf8').slice(-16000) : 'No coordinator output';
        const timeout = setTimeout(() => failed(new Error(`Live coordinator startup timed out\n${details()}`)), 90_000);
        const cleanup = () => { clearTimeout(timeout); current.removeListener('message', message); current.removeListener('error', failed); current.removeListener('exit', exited); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const exited = (code: number | null) => failed(new Error(`Live coordinator exited (${code})\n${details()}`));
        const message = (value: any) => { if (value?.type === 'ready') {
          if(!Number.isInteger(value.port)||value.port<=0||(port!==0&&value.port!==port)){failed(new Error('Coordinator readiness reported an invalid or changed port'));return;}
          port=value.port;
          try{if(observationClock.backend==='chronal-network'){
            expect(value.clock?.backend).toBe('chronal-network');expect(value.clock.rate).toBe(observationClock.rate);expect(value.clock.epoch).toBe(observationClock.epoch);expect(value.clock.errors).toEqual([]);
          }}catch(error){failed(error as Error);return;}
          cleanup(); resolve(); } };
        current.on('message', message); current.once('error', failed); current.once('exit', exited);
      });
    }
    async function publicRestartReady(reason:string):Promise<void> {
      const observations:RestartStateProbe[]=[];
      try{await waitForLiveRestartState(live!.url,row=>{
        observations.push(row);if(observations.length>32)observations.splice(8,1);
      });}
      finally{exchanges.push({at:Date.now(),coordinatorRestartReadiness:reason,observations});}
    }
    let peacefulAmbientSeeded=false;
    try {
      if(initialPeacefulAmbientMaps.length){
        const seed=await game.admin(`output=(()=>{
          if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Peaceful ambient input requires disconnected native clients');
          const maps=data.maps;
          for(const map of maps)if(!instances[map])throw Error('Unknown peaceful ambient map: '+map);
          const saved=globalThis.__e2eInitialPeacefulAmbient={definitions:structuredClone(G.monsters),ambient:[],construct:new_monster};
          const declare=m=>{
            if(!m||!maps.includes(m.map))return m;
            saved.ambient.push({map:m.in,id:m.id,aggro:m.aggro,peaceful:m.peaceful});
            m.aggro=0;m.peaceful=true;
            if(m.target)stop_pursuit(m,{stop:true,cause:'declared peaceful initial population'});
            return m;
          };
          // Keep native respawns and unrelated maps intact; apply the same
          // declared input to later actors in these two journey maps only.
          new_monster=function(){return declare(saved.construct.apply(this,arguments));};
          for(const map of maps)for(const m of Object.values(instances[map].monsters))declare(m);
          return {at:Date.now(),maps,actors:saved.ambient.length,players:Object.keys(players).length};
        })()`,{maps:initialPeacefulAmbientMaps});
        peacefulAmbientSeeded=true;
        await testInfo.attach('peaceful-ambient-before-native-login',{body:JSON.stringify(seed),contentType:'application/json'});
      }
      if(occupiedPort!==null){
        await new Promise<void>((resolve,reject)=>{occupied.once('error',reject);occupied.listen(occupiedPort,'127.0.0.1',resolve);});
        await testInfo.attach('declared-coordinator-port-occupant',{body:JSON.stringify({port:occupiedPort}),contentType:'application/json'});
      }
      await start();
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      live = {
        url, clients, coordinatorBinding:{port,occupiedPort},
        async state(catalogs = false) {
          // Match the dashboard's existing catalog-free polling API. Catalog checks
          // explicitly request the full projection; never cache or synthesize state.
          const response = await fetch(url + '/party-api/state' + (catalogs === 'fast' ? '?section=fast' : catalogs ? '' : '?catalog=0'), { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw Error('Live state failed: ' + response.status + ': ' + (await response.text()).slice(0,512));
          return response.json();
        },
        savedTownCycle() {
          const journal=readFileSync(path.join(directory,'state.jsonl'),'utf8');
          const complete=journal.slice(0,journal.lastIndexOf('\n'));
          const stored=Object.assign({},...complete.split('\n').filter(Boolean).map(line=>JSON.parse(line)));
          const settings=stored[stateKeys.settings];
          const decoded=typeof settings==='string'?JSON.parse(settings):settings;
          return decoded?.townCycle || null;
        },
        async post(route, body) {
          const endpoint = route.startsWith('/party-api/') ? route : '/party-api' + route;
          const response = await fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url },
            body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
          const result = await response.json();
          exchanges.push({ at: Date.now(), route: endpoint, body, status: response.status, result });
          if (!response.ok) throw Error(`${endpoint}: ${response.status} ${JSON.stringify(result)}`);
          return result;
        },
        async admin(code) {
          const result = await game.admin(code);
          exchanges.push({ at: Date.now(), administrative: true, code, result });
          return result;
        },
        async adminRealm(realm,code) {
          const result = await game.admin(code,{},realm);
          exchanges.push({at:Date.now(),administrative:true,realm,code,result});
          return result;
        },
        holdMerchantStatus(hold, options={}) {
          const marker=path.join(directory,options.inventoryOnly?'hold-merchant-inventory':'hold-merchant-status');
          if(hold) writeFileSync(marker,'Declared missing merchant arrival reports');
          else rmSync(marker,{force:true});
          exchanges.push({at:Date.now(),transportFault:'merchant-status',hold});
        },
        consoleDrainLease(id, expires = Date.now()+180000, options={}) {
          const file = path.join(directory,'updates/pause.json');
          mkdirSync(path.dirname(file),{recursive:true});
          if (id) writeFileSync(file,JSON.stringify({id,mode:'draining',expires,...options}));
          else rmSync(file,{force:true});
          exchanges.push({at:Date.now(),hostMaintenanceLease:id,expires});
        },
        async restartCoordinator() { await stop(coordinator!, true); await start(); await publicRestartReady('explicit restart'); },
        deploymentPaths:{directory,apiUrl:`http://127.0.0.1:${port}`,codeRoots:[path.join(directory,'CODE/adventure_land')]},
        async restartCoordinatorIdentity(artifactId,hash){identityEnvironment={AL_CONSOLE_ARTIFACT_ID:artifactId,AL_CONSOLE_COORDINATOR_HASH:hash};await stop(coordinator!,true);await start();await publicRestartReady('identity restart');},
        async restoreHistoricalSettings(restore) {
          await stop(coordinator!, true);
          const journal = path.join(directory, 'state.jsonl');
          const entries = readFileSync(journal, 'utf8').trim().split('\n').map(line => JSON.parse(line));
          const key = 'party_dashboard_settings_state_v1';
          const stored = Object.assign({}, ...entries);
          const decoded = (stateKey: string) => typeof stored[stateKey] === 'string'
            ? JSON.parse(stored[stateKey]) : structuredClone(stored[stateKey] || {});
          const settings = decoded(key);
          const historical = await restore(structuredClone(settings));
          const allowed = new Set(['escape', 'combatRecovery', 'characterLocations', 'location', 'farmingPolicy', 'farmingProfiles', 'eventSelectionsByCharacter', 'activeConvoy', 'deferredEventReturns', 'eventReturn', 'monsterHunt', 'merchantDeliveries', 'npcSaleMarks', 'merchantCurrent', 'merchantQueue', 'merchantRealmRequests', 'autoNpcSales', 'autoStandMarks', 'merchantCharacter', 'bankbois', 'bankboiTransaction', 'production', 'nativeStand', 'standBids', 'luckyUpgradeSlots', 'luckySlotResume', 'luckySlotLocks', 'autoItemMarks', 'autoUpgradeMarks', 'autoCompounds', 'upgrades', 'gatheringCooldowns']);
          if (Object.keys(historical).some(key => !allowed.has(key))) throw Error('Historical seed may only patch declared recovery, Hunt, navigation and native WTB settings');
          await testInfo.attach('declared-historical-settings-seed', { body: JSON.stringify(historical), contentType: 'application/json' });
          const bankKeys = new Set(['bankbois', 'bankboiTransaction']);
          const bankPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => bankKeys.has(field)));
          const selectionKeys = new Set<string>(selectionFields);
          const selectionsPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => selectionKeys.has(field)));
          const settingsPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => !bankKeys.has(field) && !selectionKeys.has(field)));
          const restored: Record<string, unknown> = { [key]: { ...settings, ...settingsPatch } };
          // Settings layout 2 loads production from its own key (docs/efficiency.md, Persistence).
          if (Object.hasOwn(settingsPatch, 'production')) restored[stateKeys.production] = { production: settingsPatch.production };
          if (Object.keys(selectionsPatch).length)
            restored[stateKeys.selections] = { ...decoded(stateKeys.selections), ...selectionsPatch };
          if (Object.keys(bankPatch).length) {
            const bankKey = 'party_dashboard_bank_state_v1';
            restored[bankKey] = { ...decoded(bankKey), ...bankPatch };
          }
          for (const [stateKey, value] of Object.entries(restored))
            appendFileSync(journal, JSON.stringify({ [stateKey]: value }) + '\n');
          await start();
          await publicRestartReady('historical settings restart');
        },
        async reconnectClient(name) {
          if (!clients[name]) throw Error('Unknown owned native client: ' + name);
          const ownership = await live!.state();
          const steamNames = Object.keys(clients).filter(member =>
            ownership.characters[member]?.runtime === 'native');
          if (!steamNames.includes(name)) throw Error('Native browser reconnect requires current Steam ownership: ' + name);
          const companions = steamNames.filter(member=>member!==primaryName);
          const previous = companions.map(member=>clients[member].frame);
          if (name === primaryName) {
            await clients[name].page.close();
            await expect.poll(async () => game.admin(`output=Object.values(players).concat(Object.values(dc_players)).filter(p=>${JSON.stringify(steamNames)}.includes(p.name)).length`), { timeout: 45_000 }).toBe(0);
            clients[primaryName] = await launchGameClient(context, optionsFor(primaryName));
            // Production bridge restores its missing companions after observing the new primary session.
          } else {
            await clients[primaryName].frame.evaluate(name => (window as any).stop_character_runner(name), name);
            await live!.post('/steam/restore', {});
            await expect.poll(() => previous.every(frame => frame.isDetached()), { timeout: 30_000 }).toBe(true);
          }
          for (const companion of companions)
            clients[companion] = await launchGameClient(context, optionsFor(companion));
          await expect.poll(async () => (await live!.state()).steamSwitch?.phase, { timeout: 90_000 }).toBe('complete');
        },
      };
      await live.post('/formation', { leader: null });
      for (const name of names)
        await live.post('/formation', { character: name, follow: false, eventSelections: [] });
      const initial = await live.state();
      await testInfo.attach('merchant-before-native-login', {body: JSON.stringify({merchantDefault, merchantCharacter: initial.merchantCharacter}), contentType: 'application/json'});
      expect(initial.merchantCharacter).toBe(merchantDefault);
      await live.post('/merchant/routine-priorities', { priorities: {},
        enabled: Object.fromEntries(Object.keys(initial.merchantAutomations || {}).map(key => [key, false])) });
      // Keep this serial: failures retain the already connected clients for teardown and evidence.
      let nativeReadyDeadline=0;
      for (const name of names) {
        if (name !== primaryName) {
          await expect.poll(async () => {
            const response = await fetch(`http://127.0.0.1:${port}/party-api/steam/connection`);
            return (await response.json()).ready;
          }, { timeout: 30_000 }).toBe(true);
          const login = await live.post('/steam/action', { character: name, action: 'login' });
          if (login.operation?.phase === 'awaiting-realm-choice')
            await live.post('/steam/realm-choice', { operationId: login.operation.id, choice: 'stay' });
        }
        clients[name] = await launchGameClient(context, optionsFor(name));
        if (name !== primaryName) {
          if(name===names.at(-1))nativeReadyDeadline=Date.now()+90_000;
          await expect.poll(async () => (await live!.state()).steamSwitch?.phase,
            {timeout:name===names.at(-1)?Math.max(1,nativeReadyDeadline-Date.now()):90_000}).toBe('complete');
        }
      }
      await testInfo.attach('live-server-initial', { body: JSON.stringify(await live.admin(`output=Object.fromEntries(Object.values(players).filter(p=>${JSON.stringify(names)}.includes(p.name)).map(p=>[p.name,{name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,attack:p.attack,frequency:p.frequency,speed:p.speed,armor:p.armor,resistance:p.resistance,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,s:p.s}]))`), null, 2), contentType: 'application/json' });
      // Guard the fixture contract: native recalculation must clamp initial pools.
      // Reading these values never repairs or changes a character's live stats.
      const nativeStats = await live.admin(`output=${JSON.stringify(names)}.map(name=>{const p=get_player(name);return {name,type:p.type,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,attack:p.attack,frequency:p.frequency,speed:p.speed,slots:p.slots}})`);
      for (const stats of nativeStats) {
        for (const key of ['hp','max_hp','mp','max_mp','attack','frequency','speed'])
          expect(Number.isFinite(stats[key]), `${loadout} ${stats.name} native ${key}`).toBe(true);
        expect(stats.hp).toBeLessThanOrEqual(stats.max_hp);
        expect(stats.mp).toBeLessThanOrEqual(stats.max_mp);
        expect(stats.max_hp).toBeGreaterThan(0);
        expect(stats.speed).toBeGreaterThan(0);
        const followStaff=loadout==='combat-follow-range'&&(stats.type==='priest'||stats.type==='mage');
        const weaponLevel=followStaff?(stats.type==='priest'?12:15):loadouts[loadout].weaponLevel;
        expect(stats.slots.mainhand.level, `${loadout} ${stats.name} native weapon`).toBe(weaponLevel);
        if(followStaff)expect(stats.slots.mainhand.name, `${loadout} ${stats.name} native staff`).toBe('staff');
        for (const [slot, equipped] of Object.entries(loadouts[loadout].armor))
          expect(stats.slots[slot], `${loadout} ${stats.name} native ${slot}`).toMatchObject(equipped);
      }
      if(extraFighter){
        const extra=await clients.E2EBankBoi.run('({name:character.name,ctype:character.ctype,connected:parent.socket?.connected,hp:character.hp,rip:character.rip})');
        expect(extra.name).toBe('E2EBankBoi');expect(extra.ctype).toBe(extraFighter);
        expect(extra.connected).toBe(true);expect(extra.hp).toBeGreaterThan(0);expect(extra.rip).toBe(false);
        await testInfo.attach('native-fourth-fighter-admission',{body:JSON.stringify(extra),contentType:'application/json'});
      }
      await testInfo.attach('live-build-manifest', { path: path.join(root, '.build/game/manifest.json'), contentType: 'application/json' });
      const compiled=JSON.parse(readFileSync(path.join(root,'.build/game/manifest.json'),'utf8')) as GameManifest;
      const expectedCode=nativeStats.map((stats:{name:string;type:string})=>{
        const entry=Object.entries(compiled.classes).find(([ctype])=>ctype===stats.type)?.[1];
        if(!entry)throw Error('No compiled CODE for native class '+stats.type);
        return {name:stats.name,ctype:stats.type,sha256:entry.sha256};
      });
      const codeObservations:unknown[]=[];
      try{await expect.poll(async()=>{
        const state=await live!.state();
        const observed=expectedCode.map((entry:{name:string})=>({name:entry.name,ctype:state.characters[entry.name]?.ctype,sha256:state.characters[entry.name]?.codeHash}));
        if(codeObservations.length>=32)codeObservations.shift();
        codeObservations.push({at:Date.now(),observed});
        return observed;
      },{timeout:30000,message:'Every native client must acknowledge this fixture’s exact staged CODE before gameplay starts'}).toEqual(expectedCode);}
      finally{await testInfo.attach('native-initial-code-identities',{body:JSON.stringify({generation:compiled.generation,names,expected:expectedCode,observations:codeObservations}),contentType:'application/json'});}
      const nativeVersion=await clients[primaryName].run('parent.G.version');
      expect(Number.isSafeInteger(Number(nativeVersion))&&Number(nativeVersion)>0,'The primary native client must supply its actual game version').toBe(true);
      const catalogReadiness:Array<{at:number;version:unknown;choices:number}>=[];
      try{await expect.poll(async()=>{
        const state=await live!.state(true);
        if(catalogReadiness.length>=64)catalogReadiness.shift();
        catalogReadiness.push({at:Date.now(),version:state.gameVersion,choices:state.monsterChoices?.length||0});
        return String(state.gameVersion)===String(nativeVersion)&&Array.isArray(state.monsterChoices)&&state.monsterChoices.length>0;
      },{timeout:Math.max(1,nativeReadyDeadline-Date.now()),intervals:[1000],
        message:'Native bootstrap must publish the current game version and real monster catalog before starting the scenario'}).toBe(true);}
      finally{await testInfo.attach('native-bootstrap-catalog-readiness',{body:JSON.stringify({nativeVersion,deadline:nativeReadyDeadline,observations:catalogReadiness}),contentType:'application/json'});}
      if(initialConsoleHold)live.consoleDrainLease('native-initial-setup',Date.now()+600000,{loadMode:'now',phase:'holding'});
      const clockReceipts={host:observationClock,realms:await Promise.all(['USI','USII'].map(realm=>game.admin('output=globalThis.__e2eChronalClock?{backend:__e2eChronalClock.backend,rate:__e2eChronalClock.rate,wall:__e2eChronalClock.wall,epoch:__e2eChronalClock.epoch,errors:__e2eChronalClock.errors}:null',{},realm))),
        clients:await Promise.all(Object.values(clients).map(client=>client.frame.evaluate(()=>{
          const w=window as any,c=w.__e2eChronalClock,r=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
          return {game:c&&{backend:c.backend,rate:c.rate,wall:c.wall,epoch:c.epoch,errors:c.errors},code:r?.__e2eChronalClock&&{backend:r.__e2eChronalClock.backend,rate:r.__e2eChronalClock.rate,wall:r.__e2eChronalClock.wall,epoch:r.__e2eChronalClock.epoch,errors:r.__e2eChronalClock.errors}};
        })))};
      await testInfo.attach('gameplay-clock-participants',{body:JSON.stringify(clockReceipts),contentType:'application/json'});
      if(observationClock.backend==='chronal-network')for(const receipt of [...clockReceipts.realms,...clockReceipts.clients.flatMap(c=>[c.game,c.code])]){
        expect(receipt?.backend).toBe('chronal-network');expect(receipt.rate).toBe(observationClock.rate);expect(receipt.wall).toBe(observationClock.wall);expect(receipt.epoch).toBe(observationClock.epoch);expect(receipt.errors).toEqual([]);
      }
      const bodyClockSnapshot=async()=>{
        const url=new URL('/diagnostics',process.env.E2E_CLOCK_BROKER);url.searchParams.set('token',process.env.E2E_CLOCK_TOKEN||'');
        let ownership:any;
        const ownershipReads:Array<{at:number;error?:string}>=[];
        await expect.poll(async()=>{
          try{ownership=await live!.state('fast');ownershipReads.push({at:Date.now()});return !!ownership.characters;}
          catch(error){ownershipReads.push({at:Date.now(),error:String(error)});throw error;}
        },{timeout:15000,message:'Clock diagnostics require a fresh runtime ownership snapshot'}).toBe(true);
        return {host:{now:observationClock.now(),errors:observationClock.errors,observations:observationClock.observations},ownershipReads,broker:await (await fetch(url)).json(),frames:await Promise.all(Object.entries(clients).map(async([name,client])=>{
          const runtime=ownership.characters[name]?.runtime;
          // Managed headless migration/logout legitimately retires the browser frame.
          // Its clock remains represented by the broker's actual participants.
          if(runtime!=='native')return {name,runtime:runtime||'offline',clocks:[],source:'broker-participants'};
          return {name,runtime,clocks:await client.frame.evaluate(()=>{
            const w=window as any,r=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
            return [w.__e2eChronalClock,r?.__e2eChronalClock].map(c=>c&&({timing:c.timing,taskStats:c.taskStats}));
          })};
        }))};
      };
      const bodyClockBefore=observationClock.backend==='chronal-network'&&process.env.E2E_MEASURE_BROWSER_CPU==='1'?await bodyClockSnapshot():undefined;
      const rendering=process.env.E2E_MEASURE_BROWSER_CPU==='1'?await measureBrowserRendering(browser,()=>observationClock.now()):undefined;
      const cpuProfile=process.env.E2E_PROFILE_BROWSER_CPU==='1'?await context.newCDPSession(clients[primaryName].page):undefined;
      if(cpuProfile){await cpuProfile.send('Profiler.enable');await cpuProfile.send('Profiler.start');}
      try {await use(live);} finally {
        if(cpuProfile)try{const {profile}=await cpuProfile.send('Profiler.stop');await testInfo.attach('native-browser-cpu-profile',{body:JSON.stringify(profile),contentType:'application/json'});}finally{await cpuProfile.detach();}
        if(rendering)await testInfo.attach('browser-rendering-cpu',{body:JSON.stringify(await rendering(),null,2),contentType:'application/json'});
        if(bodyClockBefore)await testInfo.attach('gameplay-clock-body-timing',{body:JSON.stringify({before:bodyClockBefore,after:await bodyClockSnapshot()}),contentType:'application/json'});
      }
    } finally {
      rmSync(path.join(directory,'hold-merchant-status'),{force:true});
      rmSync(path.join(directory,'hold-merchant-inventory'),{force:true});
      const attach = async (name: string, body: unknown) => testInfo.attach(name, { body: JSON.stringify(body, null, 2), contentType: 'application/json' });
      const diagnostic = async (work: Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout>;
        try { return await Promise.race([work, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Diagnostic timed out after 10 seconds')), 10_000);
        })]); }
        catch (error) { return { error: String(error) }; }
        finally { clearTimeout(timer!); }
      };
      const screenshots = new Set<Page>();
      const screenshot = async (page: Page, name: string) => {
        if (screenshots.has(page)) return;
        screenshots.add(page);
        try { await testInfo.attach(name, { body: await page.screenshot({ timeout: 10_000 }), contentType: 'image/png' }); }
        catch (error) { await attach(name + '-error', { error: String(error) }); }
      };
      try {
        if (live) {
          await attach('live-final-state', await live.state(true).catch(error => ({ error: String(error) })));
          await attach('live-server-final', await live.admin(`output=Object.fromEntries(Object.values(players).filter(p=>${JSON.stringify(names)}.includes(p.name)).map(p=>[p.name,{name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp,mp:p.mp,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,s:p.s}]))`).catch(error => ({ error: String(error) })));
        }
        for (const [name, client] of Object.entries(clients)) {
          if(observationClock.backend==='chronal-network'&&!client.page.isClosed()){
            const ownership=live&&await live.state();
            if(ownership?.characters[name]?.runtime==='native'){
              let latest:unknown,observations:Array<{at:number;ready:boolean}>=[];
              const clocks=await diagnostic((async()=>{
                await expect.poll(async()=>{
                  latest=await client.frame.evaluate(()=>{
                    const w=window as any,r=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
                    return [w.__e2eChronalClock,r?.__e2eChronalClock].map(c=>c&&({backend:c.backend,now:c.now(),errors:c.errors,epoch:c.epoch,rate:c.rate,state:c.state,timing:c.timing,taskStats:c.taskStats,join:c.join}));
                  });
                  const ready=Array.isArray(latest)&&latest.length===2&&latest.every(c=>c?.backend==='chronal-network'&&c.state?.ticks>0);
                  if(observations.length>=32)observations.shift();observations.push({at:Date.now(),ready});return ready;
                },{timeout:15_000,message:'Current native game and CODE clocks must finish joining after realm/client replacement'}).toBe(true);
                return latest;
              })());
              await attach(name+'-final-clock',clocks);
              await attach(name+'-final-clock-readiness',{observations,latest});
              expect(Array.isArray(clocks),'Browser-owned characters must retain both final clock observations').toBe(true);
              if(Array.isArray(clocks))for(const clock of clocks){expect(clock?.backend).toBe('chronal-network');expect(clock?.errors).toEqual([]);}
            }else await attach(name+'-final-clock',{runtime:ownership?.characters[name]?.runtime||'offline',source:'broker-participants'});
          }
          await attach(name + '-native-disconnects', client.disconnects());
          await attach(name + '-native-events', await diagnostic(client.events()));
          await attach(name + '-character', await diagnostic(client.snapshot()));
          await attach(name + '-errors', client.errors);
          await screenshot(client.page, 'native-game-group');
        }
        for (const [index, page] of context.pages().entries()) {
          if (Object.values(clients).some(client => client.page === page)) continue;
          await screenshot(page, `startup-page-${index}`);
          await attach(`startup-page-${index}-location`, { url: page.url() });
        }
        await attach('live-action-ledger', exchanges);
        const visitorStatus = path.join(directory,'home-visitor-status.jsonl');
        if(existsSync(visitorStatus)) await testInfo.attach('home-visitor-status',{path:visitorStatus,contentType:'application/x-ndjson'});
        await attach('live-blocked-external-requests', blocked);
        if(observationClock.backend==='chronal-network'){
          const url=new URL('/diagnostics',process.env.E2E_CLOCK_BROKER);url.searchParams.set('token',process.env.E2E_CLOCK_TOKEN||'');await attach('gameplay-clock-final',await (await fetch(url)).json());
        }
      } finally {
        try {
          const closed = await diagnostic(context.close());
          if (closed) await attach('native-context-close-diagnostic', closed);
          for (const [index, page] of [...nativePages].entries()) {
            const video = page.video();
            if (!video) continue;
            const result = await diagnostic((async () => {
              await testInfo.attach(`native-game-video-${index}`, { path: await video.path(), contentType: 'video/webm' });
            })());
            if (result) await attach(`native-game-video-${index}-diagnostic`, result);
          }
        } finally {
          await diagnostic(network.close());
          occupied.closeAllConnections();
          if(occupied.listening)await diagnostic(new Promise<void>(resolve=>occupied.close(()=>resolve())));
          server.closeAllConnections();
          await diagnostic(new Promise<void>(resolve => {
            if (server.listening) server.close(() => resolve());
            else resolve();
          }));
          try { if (coordinator) await stop(coordinator, true); }
          finally {
            if(peacefulAmbientSeeded)await game.admin(`output=(()=>{
              const saved=globalThis.__e2eInitialPeacefulAmbient;
              for(const [type,definition] of Object.entries(saved.definitions))G.monsters[type]=definition;
              for(const previous of saved.ambient){const m=instances[previous.map].monsters[previous.id];if(m)for(const key of ['aggro','peaceful']){
                if(previous[key]===undefined)delete m[key];else m[key]=previous[key];
              }}
              new_monster=saved.construct;delete globalThis.__e2eInitialPeacefulAmbient;return true;
            })()`);
            if(observationClock.backend==='chronal-network'){
              const endpoint=new URL('/scope',process.env.E2E_CLOCK_BROKER);endpoint.searchParams.set('scope',directory);endpoint.searchParams.set('token',process.env.E2E_CLOCK_TOKEN||'');await fetch(endpoint);
            }
            let logsCopied=true;
            for (const file of [log, dashboard.log, path.join(directory, 'state.jsonl'),path.join(directory,'native-assets-receipts.jsonl')])
              if (existsSync(file)) {
                const copy=await diagnostic(testInfo.attach(path.basename(file), { path: file, contentType: 'text/plain' }));
                if(copy!==undefined)logsCopied=false;
              }
            await attach('workspace-cleanup',logsCopied?cleanupWorkspace(root,directory):{
              workspace:path.relative(root,directory),removed:false,retained:true,reason:'Log attachment copy failed'});
          }
        }
      }
    }
  }, { timeout: 300_000 }],
  // A baseURL -> live dependency delays Playwright's automatic artifact recorder until
  // after native contexts exist. Keep context options independent so its single
  // recorder captures native setup, game actions, and dashboard pages together.
  // Live specs navigate using live.url explicitly.
  baseURL: async ({}, use) => { await use(undefined); },
});
export { expect };
export {waitForGameplay} from './network-clock';
