import { test as base, expect, unusedPort, child, environment, stop } from './fixtures';
import { launchGameClient, type LiveClient } from './live-game-client';
import { type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateway } from '../tools/hosting/gateway';
import { Access } from '../tools/hosting/access';
import { selectionFields, stateKeys } from '../runtime/coordinator/persistence/snapshots';
import { loadouts, seedLoadout, type NativeLoadout } from './game/loadouts';
import { nativeEventSpawn, nativeMonsterInitialPosition } from './game/event-spawn';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const game = require('./game/bootstrap.cjs');
export type LiveGame = {
  url: string;
  clients: Record<string, LiveClient>;
  state(catalogs?: boolean): Promise<any>;
  post(route: string, body: unknown): Promise<any>;
  admin(code: string): Promise<any>;
  adminRealm(realm:'USI'|'USII', code:string):Promise<any>;
  holdMerchantStatus(hold:boolean):void;
  restartCoordinator(): Promise<void>;
  restoreHistoricalSettings(restore: (settings: any) => any): Promise<void>;
  reconnectClient(name: string): Promise<void>;
};

export const test = base.extend<{ live: LiveGame; loadout: NativeLoadout; primaryClass: 'warrior' | 'ranger'; merchantDefault: string | null; liveHeadless: boolean; staleWorkerRealm: string | null; initialPosition: {map: string; x: number; y: number} | null; initialEventSpawn: string | null; initialMonsterSpawn: string | null }>({
  loadout: ['god', {option:true}],
  primaryClass: ['warrior', {option:true}],
  merchantDefault: ['E2EMerchant', {option:true}],
  initialPosition: [null, {option:true}],
  initialMonsterSpawn: [null, {option:true}],
  initialEventSpawn: [null, {option:true}],
  liveHeadless: [false, {option:true}],
  staleWorkerRealm: [null, {option:true}],
  live: [async ({ browser, dashboard, loadout, primaryClass, merchantDefault, initialPosition, initialEventSpawn, initialMonsterSpawn, liveHeadless, staleWorkerRealm }, use, testInfo) => {
    const directory = path.join(root, '.build/e2e', `live-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const manifest = await game.reset();
    const equipment = await seedLoadout(game.admin, loadout, primaryClass);
    if(initialEventSpawn){const spawn=await nativeEventSpawn(game.admin,initialEventSpawn);initialPosition={...spawn,x:spawn.x+160};
      await testInfo.attach('native-event-catalog-initial-position',{body:JSON.stringify({event:initialEventSpawn,spawn,initialPosition}),contentType:'application/json'});}
    if(initialMonsterSpawn){const spawn=await nativeMonsterInitialPosition(game.admin,initialMonsterSpawn);initialPosition={map:spawn.map,x:spawn.x,y:spawn.y};
      await testInfo.attach('native-monster-collision-safe-initial-position',{body:JSON.stringify(spawn),contentType:'application/json'});}
    if (initialPosition) {
      await game.admin("output=db.collection('character').updateMany({owner:data.owner},{$set:{'info.map':data.map,'info.x':data.x,'info.y':data.y}})", { owner: manifest.auth.split('-')[0], ...initialPosition });
      await testInfo.attach('native-initial-position-seed', { body: JSON.stringify(initialPosition), contentType: 'application/json' });
    }
    await testInfo.attach('native-loadout-seed', {body:JSON.stringify(equipment,null,2),contentType:'application/json'});
    await testInfo.attach('live-seed', { body: JSON.stringify({ ...manifest, auth: '[disposable credential omitted]' }, null, 2), contentType: 'application/json' });
    const port = await unusedPort(), log = path.join(directory, 'coordinator.log');
    let coordinator: ChildProcess | undefined;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 },
      recordVideo: { dir: testInfo.outputPath('native-video'), size: { width: 960, height: 675 } } });
    const nativePages = new Set<Page>();
    context.on('page', page => nativePages.add(page));
    const blocked: string[] = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      blocked.push(url.origin + url.pathname);
      return route.abort('blockedbyclient');
    });
    await context.addCookies([{ name: 'auth', value: manifest.auth, url: manifest.webUrl }]);
    const access = new Access(path.join(directory, 'access.json'));
    await access.load();
    const server = gateway({ access, configured: () => true, dashboardPort: dashboard.port, apiPort: port });
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
          E2E_GAME_WEB_URL: manifest.webUrl, E2E_GAME_AUTH: manifest.auth, E2E_MERCHANT_DEFAULT: JSON.stringify(merchantDefault), E2E_ALLOW_HEADLESS: String(liveHeadless), E2E_STALE_WORKER_REALM: staleWorkerRealm || '' }), log);
      const current = coordinator;
      await new Promise<void>((resolve, reject) => {
        const details = () => existsSync(log) ? readFileSync(log, 'utf8').slice(-16000) : 'No coordinator output';
        const timeout = setTimeout(() => failed(new Error(`Live coordinator startup timed out\n${details()}`)), 90_000);
        const cleanup = () => { clearTimeout(timeout); current.removeListener('message', message); current.removeListener('error', failed); current.removeListener('exit', exited); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const exited = (code: number | null) => failed(new Error(`Live coordinator exited (${code})\n${details()}`));
        const message = (value: any) => { if (value?.type === 'ready') { cleanup(); resolve(); } };
        current.on('message', message); current.once('error', failed); current.once('exit', exited);
      });
    }
    try {
      await start();
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      live = {
        url, clients,
        async state(catalogs = false) {
          // Match the dashboard's existing catalog-free polling API. Catalog checks
          // explicitly request the full projection; never cache or synthesize state.
          const response = await fetch(url + '/party-api/state' + (catalogs ? '' : '?catalog=0'), { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw Error('Live state failed: ' + response.status);
          return response.json();
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
        holdMerchantStatus(hold) {
          const marker=path.join(directory,'hold-merchant-status');
          if(hold) writeFileSync(marker,'Declared missing merchant arrival reports');
          else rmSync(marker,{force:true});
          exchanges.push({at:Date.now(),transportFault:'merchant-status',hold});
        },
        async restartCoordinator() { await stop(coordinator!, true); await start(); },
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
          const allowed = new Set(['characterLocations', 'location', 'farmingPolicy', 'farmingProfiles', 'eventSelectionsByCharacter', 'activeConvoy', 'deferredEventReturns', 'eventReturn', 'monsterHunt', 'merchantDeliveries', 'npcSaleMarks', 'merchantCurrent', 'merchantQueue', 'merchantRealmRequests', 'autoNpcSales', 'autoStandMarks', 'merchantCharacter', 'bankbois', 'bankboiTransaction', 'production', 'nativeStand', 'standBids', 'luckyUpgradeSlots', 'autoItemMarks', 'autoUpgradeMarks', 'autoCompounds', 'gatheringCooldowns']);
          if (Object.keys(historical).some(key => !allowed.has(key))) throw Error('Historical seed may only patch declared recovery, Hunt, navigation and native WTB settings');
          await testInfo.attach('declared-historical-settings-seed', { body: JSON.stringify(historical), contentType: 'application/json' });
          const bankKeys = new Set(['bankbois', 'bankboiTransaction']);
          const bankPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => bankKeys.has(field)));
          const selectionKeys = new Set<string>(selectionFields);
          const selectionsPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => selectionKeys.has(field)));
          const settingsPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => !bankKeys.has(field) && !selectionKeys.has(field)));
          const restored: Record<string, unknown> = { [key]: { ...settings, ...settingsPatch } };
          if (Object.keys(selectionsPatch).length)
            restored[stateKeys.selections] = { ...decoded(stateKeys.selections), ...selectionsPatch };
          if (Object.keys(bankPatch).length) {
            const bankKey = 'party_dashboard_bank_state_v1';
            restored[bankKey] = { ...decoded(bankKey), ...bankPatch };
          }
          for (const [stateKey, value] of Object.entries(restored))
            appendFileSync(journal, JSON.stringify({ [stateKey]: value }) + '\n');
          await start();
        },
        async reconnectClient(name) {
          if (!clients[name]) throw Error('Unknown owned native client: ' + name);
          const previous = Object.values(clients).filter(client => client !== clients[primaryName]);
          if (name === primaryName) {
            await clients[name].page.close();
            await expect.poll(async () => game.admin("output=Object.keys(players).length+Object.keys(dc_players).length"), { timeout: 45_000 }).toBe(0);
            clients[primaryName] = await launchGameClient(context, optionsFor(primaryName));
            // Production bridge restores its missing companions after observing the new primary session.
          } else {
            await clients[primaryName].frame.evaluate(name => (window as any).stop_character_runner(name), name);
            await live!.post('/steam/restore', {});
            await expect.poll(() => previous.every(client => client.frame.isDetached()), { timeout: 30_000 }).toBe(true);
          }
          for (const companion of ['E2EPriest', 'E2EMerchant'])
            clients[companion] = await launchGameClient(context, optionsFor(companion));
          await expect.poll(async () => (await live!.state()).steamSwitch?.phase, { timeout: 90_000 }).toBe('complete');
        },
      };
      await live.post('/formation', { leader: null });
      for (const name of ['E2EWarrior', 'E2EPriest', 'E2EMerchant'])
        await live.post('/formation', { character: name, follow: false, eventSelections: [] });
      const initial = await live.state();
      await testInfo.attach('merchant-before-native-login', {body: JSON.stringify({merchantDefault, merchantCharacter: initial.merchantCharacter}), contentType: 'application/json'});
      expect(initial.merchantCharacter).toBe(merchantDefault);
      await live.post('/merchant/routine-priorities', { priorities: {},
        enabled: Object.fromEntries(Object.keys(initial.merchantAutomations || {}).map(key => [key, false])) });
      // Keep this serial: failures retain the already connected clients for teardown and evidence.
      for (const name of ['E2EWarrior', 'E2EPriest', 'E2EMerchant']) {
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
        if (name !== primaryName)
          await expect.poll(async () => (await live!.state()).steamSwitch?.phase, { timeout: 90_000 }).toBe('complete');
      }
      await testInfo.attach('live-server-initial', { body: JSON.stringify(await live.admin("output=Object.fromEntries(Object.values(players).filter(p=>['E2EWarrior','E2EPriest','E2EMerchant'].includes(p.name)).map(p=>[p.name,{name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,attack:p.attack,frequency:p.frequency,speed:p.speed,armor:p.armor,resistance:p.resistance,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,s:p.s}]))"), null, 2), contentType: 'application/json' });
      // Guard the fixture contract: native recalculation must clamp initial pools.
      // Reading these values never repairs or changes a character's live stats.
      const nativeStats = await live.admin("output=['E2EWarrior','E2EPriest','E2EMerchant'].map(name=>{const p=get_player(name);return {name,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,attack:p.attack,frequency:p.frequency,speed:p.speed,slots:p.slots}})");
      for (const stats of nativeStats) {
        for (const key of ['hp','max_hp','mp','max_mp','attack','frequency','speed'])
          expect(Number.isFinite(stats[key]), `${loadout} ${stats.name} native ${key}`).toBe(true);
        expect(stats.hp).toBeLessThanOrEqual(stats.max_hp);
        expect(stats.mp).toBeLessThanOrEqual(stats.max_mp);
        expect(stats.max_hp).toBeGreaterThan(0);
        expect(stats.speed).toBeGreaterThan(0);
        expect(stats.slots.mainhand.level, `${loadout} ${stats.name} native weapon`).toBe(loadouts[loadout].weaponLevel);
        for (const [slot, equipped] of Object.entries(loadouts[loadout].armor))
          expect(stats.slots[slot], `${loadout} ${stats.name} native ${slot}`).toMatchObject(equipped);
      }
      await testInfo.attach('live-build-manifest', { path: path.join(root, '.build/game/manifest.json'), contentType: 'application/json' });
      await use(live);
    } finally {
      rmSync(path.join(directory,'hold-merchant-status'),{force:true});
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
          await attach('live-server-final', await live.admin("output=Object.fromEntries(Object.values(players).filter(p=>['E2EWarrior','E2EPriest','E2EMerchant'].includes(p.name)).map(p=>[p.name,{name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp,mp:p.mp,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,s:p.s}]))").catch(error => ({ error: String(error) })));
        }
        for (const [name, client] of Object.entries(clients)) {
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
        await attach('live-blocked-external-requests', blocked);
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
          server.closeAllConnections();
          await diagnostic(new Promise<void>(resolve => {
            if (server.listening) server.close(() => resolve());
            else resolve();
          }));
          try { if (coordinator) await stop(coordinator, true); }
          finally {
            for (const file of [log, dashboard.log, path.join(directory, 'state.jsonl')])
              if (existsSync(file)) await diagnostic(testInfo.attach(path.basename(file), { path: file, contentType: 'text/plain' }));
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
