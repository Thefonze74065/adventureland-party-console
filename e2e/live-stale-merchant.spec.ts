import { test, expect } from './live-fixtures';

const merchant = 'E2EMerchant';

test('lucky slot recovery preserves a changed potion stack using native inventory swaps', async ({live},info) => {
  // Failure modes: potion use changes the displaced quantity and blocks restore;
  // an unrelated replacement is adopted; recovery duplicates or loses stock;
  // a completed historical upgrade is issued again instead of only restored.
  await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[20]={name:'hpot1',q:4};p.items[21]={name:'helmet',level:1};cache_player_items(p);resend(p,'reopen+cid');return p.items.slice(20,22);})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[20]?.q).toBe(4);
  const journal={from:20,to:21,item:{name:'helmet',level:0},displaced:{name:'hpot1',q:5},phase:'running'};
  await info.attach('declared-lucky-recovery-history',{body:JSON.stringify(journal),contentType:'application/json'});
  const recovered=await live.clients[merchant].run(`(async()=>{let journal=${JSON.stringify(journal)};const service=createPartyLuckyUpgrade({item:i=>character.items[i]&&JSON.parse(JSON.stringify(character.items[i]))||null,busy:()=>!!(character.q&&(character.q.upgrade||character.q.compound)),swap:(a,b)=>swap(a,b),read:()=>journal,write:j=>{journal=j;},sleep:ms=>new Promise(r=>setTimeout(r,ms)),now:Date.now,current:()=>true,log:()=>{}});const original=JSON.parse(JSON.stringify(journal));journal.displaced={name:'mpot1',q:5};let rejected;try{await service.recover();}catch(error){rejected=error.message;}const untouched=JSON.parse(JSON.stringify(character.items.slice(20,22)));journal=original;await service.recover();journal={...original,phase:"restoring",result:{name:"helmet",level:1}};await service.recover();return {rejected,untouched,journal,items:character.items.slice(20,22)};})()`);
  expect(recovered.rejected).toContain('displaced item changed');
  expect(recovered.untouched).toEqual([{name:'hpot1',q:4},{name:'helmet',level:1}]);
  expect(recovered.journal).toBeNull();
  expect(recovered.items).toEqual([{name:'helmet',level:1},{name:'hpot1',q:4}]);
  await info.attach('lucky-recovery-native-result',{body:JSON.stringify({recovered,events:await live.clients[merchant].events()}),contentType:'application/json'});
});

test('Hunt blacklist full catalog scrolls and sprites select their own monster', async ({page,live},info) => {
  // Failure modes: absolute sprites cover the modal and intercept other rows;
  // a large native catalog cannot scroll; sprite and text clicks select different
  // monsters; the one-monster console fixture hides those layout failures.
  // Native catalog preparation follows the first successful heartbeat.
  let catalog: Array<{id:string}> = [];
  await expect.poll(async () => {
    catalog = (await live.state(true)).monsterChoices || [];
    return catalog.length;
  }, { timeout: 90_000 }).toBeGreaterThan(30);
  await info.attach('native-blacklist-catalog-ready', {
    body: JSON.stringify({monsterIds: catalog.map(monster => monster.id)}), contentType: 'application/json',
  });
  await page.goto(live.url);
  const warrior=page.locator('article').filter({has:page.getByRole('heading',{name:'E2EWarrior',exact:true})});
  await warrior.getByRole('button',{name:'Farming settings',exact:true}).click();
  await page.getByRole('dialog',{name:'Farming settings · E2EWarrior',exact:true}).getByRole('button',{name:'Add',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Add to Hunt blacklist',exact:true});
  const list=picker.getByRole('region',{name:'Hunt blacklist monsters'});
  const rows=list.getByRole('button',{name:/^Inspect /});
  await expect.poll(() => rows.count()).toBeGreaterThan(30);
  const firstName=(await rows.first().getAttribute('aria-label'))!.replace('Inspect ','');
  await rows.first().click({position:{x:70,y:20}});
  await expect(page.getByRole('heading',{name:firstName,exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await list.hover();
  await page.mouse.wheel(0,100000);
  await expect(rows.last()).toBeInViewport();
  await expect(rows.first()).not.toBeInViewport();
  const lastName=(await rows.last().getAttribute('aria-label'))!.replace('Inspect ','');
  await rows.last().click({position:{x:20,y:20}});
  await expect(page.getByRole('heading',{name:lastName,exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await picker.getByRole('textbox',{name:'Search blacklist monsters'}).fill('goo');
  const goo=picker.getByRole('button',{name:'Inspect Goo',exact:true});
  await goo.click({position:{x:20,y:20}});
  await expect(page.getByRole('heading',{name:'Goo',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await picker.getByRole('button',{name:'Add Goo to blacklist',exact:true}).click();
  await expect.poll(async()=>(await live.state()).farmingProfiles.E2EWarrior.huntBlacklist.goo?.reason).toBe('Manually blacklisted');
  await info.attach('native-blacklist-picker',{body:await page.screenshot(),contentType:'image/png'});
  await info.attach('native-blacklist-selection',{body:JSON.stringify({firstName,lastName,state:await live.state()}),contentType:'application/json'});
  // This page belongs to Playwright's base context, not the native fixture's
  // context. Close its dashboard websocket before that fixture closes its gateway.
  await page.close();
});

test.describe('stale merchant recovery', () => {
  test.setTimeout(300_000);

  for (const localJournal of [false, true]) test(`production recovery ${localJournal ? 'reconciles an admitted prepared journal before bank work' : 'holds orphaned receipts without repeated bank trips'}`, async ({ live }, info) => {
    // Failure modes: an orphan is ignored without a local journal; dispatch or
    // storage starts before recovery; a held receipt blocks its own recovery;
    // restart loses the hold; recovery invents success or replays production.
    const id = 'historical-compound-receipt';
    await live.clients[merchant].run(`localStorage.removeItem('party-production:'+character.name)`);
    if (localJournal) await live.clients[merchant].run(`localStorage.setItem('party-production:'+character.name,JSON.stringify({id:'${id}',phase:'prepared',slots:[20],item:{name:'ringsj',level:0},request:{id:'${id}',kind:'compound',item:{name:'ringsj',level:0}}}))`);
    await live.restoreHistoricalSettings(() => ({
      production: { attempts: { [id]: { name: 'ringsj', level: 1, kind: 'compound', rules: [] } } },
      merchantCurrent: { id: 'held-bank-job', target: merchant, reason: 'manual bank exchange', phase: 'assigned', startedAt: Date.now() },
    }));
    if (localJournal) {
      await expect.poll(() => live.clients[merchant].run(`localStorage.getItem('party-production:'+character.name)`)).toBeNull();
      await expect.poll(async () => (await live.clients[merchant].snapshot()).map, { timeout: 90_000 }).toBe('bank');
    } else {
      await expect.poll(async () => (await live.state()).merchantActivity.some((entry: {message: string}) => entry.message.includes('Production recovery pending'))).toBe(true);
      const before = await live.clients[merchant].snapshot();
      await expect.poll(async () => (await live.state()).merchantQueue.some((job: {id: string}) => job.id === 'held-bank-job')).toBe(true);
      await live.restartCoordinator();
      await expect.poll(async () => (await live.state()).merchantActivity.filter((entry: {message: string}) => entry.message.includes('Production recovery pending')).length).toBeGreaterThan(1);
      const after = await live.clients[merchant].snapshot();
      expect(after.map).toBe(before.map);
      expect(after.items).toEqual(before.items);
      expect((await live.state()).merchantCurrent).toBeNull();
      expect((await live.state()).merchantActivity.some((entry: {message: string}) => entry.message.includes('Merchant dispatched'))).toBe(false);
    }
    await info.attach('production-recovery-observations', { body: JSON.stringify({ client: await live.clients[merchant].snapshot(), state: await live.state(), events: await live.clients[merchant].events() }), contentType: 'application/json' });
  });

  test('automatic missing sale marks expire while manual and locked marks survive restart', async ({ live }, info) => {
    // Failure modes: unchanged-inventory cache prevents GC; manual intent is
    // discarded; locked stock expires; restart resets the original blocked clock.
    const blockedAt = Date.now() - 299_000;
    const inventory = (await live.state()).characters[merchant].items;
    const blockedInventory = JSON.stringify(inventory.map((entry: { slot: number; item: unknown } | null) => entry && [entry.slot, entry.item]));
    const base = { source: 'merchant', slot: 20, item: { name: 'helmet', level: 0 }, quantity: 1, state: 'blocked', blockedAt, blockedInventory };
    await live.restoreHistoricalSettings(() => ({ npcSaleMarks: [
      { ...base, id: 'old-auto', auto: true, error: 'Marked item is not in merchant inventory' },
      { ...base, id: 'manual', auto: false, error: 'Marked item is not in merchant inventory' },
    ] }));
    await expect.poll(async () => (await live.state()).npcSaleMarks.map((mark: { id: string }) => mark.id)).toEqual(['manual']);
    await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[20]={name:'helmet',level:0,l:'l'};cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
    await expect.poll(async () => (await live.clients[merchant].snapshot()).items[20]?.l).toBe('l');
    await live.restoreHistoricalSettings(() => ({ npcSaleMarks: [
      { ...base, id: 'locked-auto', auto: true, error: 'Item is locked' },
      { ...base, id: 'manual', auto: false, error: 'Marked item is not in merchant inventory' },
    ] }));
    await expect.poll(async () => (await live.state()).npcSaleMarks.find((mark: { id: string }) => mark.id === 'locked-auto')?.error).toBe('Item is locked');
    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).npcSaleMarks.length).toBe(2);
    await info.attach('retained-sale-intent', { body: JSON.stringify(await live.state()), contentType: 'application/json' });
  });

  test('stale bank confirmation preserves reused inventory and permits native travel', async ({ live }, info) => {
    // Failure modes: stale journal blocks status/commands; recovery moves an
    // unrelated item; an uncertain transfer is replayed; recovery loops forever.
    await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[20]={name:'helmet',level:0};cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
    await expect.poll(async () => (await live.clients[merchant].snapshot()).items[20]?.name).toBe('helmet');
    await live.clients[merchant].run(`(()=>{const journal={buffers:[{slot:20,identity:JSON.stringify(['leather',0,null,null,null,null,null,null,null]),source:21}],pending:[{inventory:20,item:null}],recoveryStartedAt:Date.now()-31000};localStorage.setItem('party-bank-stack-buffer:'+character.name,JSON.stringify(journal));window.__partyBankStackJournal=journal;return journal;})()`);
    await live.post('/command', { character: merchant, type: 'character-travel', location: { map: 'main', x: 250, y: 0 } });
    await expect.poll(async () => (await live.clients[merchant].snapshot()).x, { timeout: 90_000 }).toBeGreaterThan(200);
    expect((await live.clients[merchant].snapshot()).items[20]).toMatchObject({ name: 'helmet', level: 0 });
    await live.post('/command', { character: merchant, type: 'mark', slot: 20, item: { name: 'helmet', level: 0 } });
    await live.post('/command', { character: merchant, type: 'bank' });
    await expect.poll(async () => (await live.clients[merchant].snapshot()).items[20], { timeout: 90_000 }).toBeNull();
    await expect.poll(() => live.clients[merchant].run('window.__partyBankStackJournal')).toBeNull();
    const stored = await live.admin(`output=(()=>{const p=get_player('${merchant}');return Object.entries(p.user).filter(([key,value])=>/^items[0-9]+$/.test(key)&&Array.isArray(value)).flatMap(([,items])=>items).filter(item=>item&&item.name==='helmet'&&item.level===0);})()`);
    expect(stored).toHaveLength(1);
    await info.attach('stale-bank-native-travel', { body: JSON.stringify({ client: await live.clients[merchant].snapshot(), state: await live.state(), events: await live.clients[merchant].events() }), contentType: 'application/json' });
  });

  test('offline merchant work permits stale-status login and times out without a heartbeat', async ({ live }, info) => {
    // Failure modes: expiry needs a worker heartbeat; retries run forever;
    // stale assigned work blocks the native ownership/login recovery path.
    const context = live.clients[merchant].page.context();
    let allowOneReport = false;
    await context.route('**/party-api/status', async route => {
      if (route.request().postDataJSON()?.name === merchant) {
        if (allowOneReport) { allowOneReport = false; await route.fetch(); }
        return route.abort('connectionfailed');
      }
      return route.fallback();
    });
    await live.restoreHistoricalSettings(() => ({ merchantCurrent: {
      id: 'offline-exhausted', target: merchant, reason: 'manual bank exchange',
      phase: 'assigned', startedAt: Date.now() - 181_000, recoveryAttempts: 3,
    } }));
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'manual bank exchange': true } });
    // Restart restores the old intent into the queue. Admit one native report
    // to assign it, drop its response, then withhold every further worker report.
    allowOneReport = true;
    await expect.poll(async () => (await live.state()).merchantCurrent?.id, { timeout: 20_000 }).toBe('offline-exhausted');
    const assigned = await live.state();
    await expect.poll(() => Date.now() - assigned.merchantCurrent.startedAt).toBeGreaterThan(7000);
    // Exercise the real roster action guard while the job still exists. This
    // checks the busy guard; the already assigned native session stays connected.
    // Reaching the assignment conflict proves stale work did not block admission.
    const response = await fetch(live.url + '/party-api/steam/action', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: live.url },
      body: JSON.stringify({ character: merchant, action: 'login' }) });
    const login = { status: response.status, body: await response.json() };
    expect(login.status).toBe(409);
    expect(login.body.error).toContain('Character is already assigned');
    await expect.poll(async () => (await live.state()).merchantCurrent, { timeout: 200_000 }).toBeNull();
    const timedOut = await live.state();
    expect(timedOut.merchantQueue.some((job: { id: string }) => job.id === 'offline-exhausted')).toBe(false);
    await context.unroute('**/party-api/status');
    await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt, { timeout: 30_000 }).toBeGreaterThan(Date.now() - 5000);
    await info.attach('offline-merchant-timeout-and-login', { body: JSON.stringify({ assigned, login, timedOut, recovered: await live.state() }), contentType: 'application/json' });
  });
});
