import { test, expect, type LiveGame } from './live-fixtures';

async function freshParticipants(live: LiveGame, names: string[]) {
  await expect.poll(async () => {
    const state = await live.state();
    return names.every(name => state.characters[name]?.seenAt >= Date.now() - 5000);
  }, {timeout:90_000,message:'Every realm participant must report fresh native status after restart'}).toBe(true);
}

// See home-realm-failures.md. Native server/client assertions preserve the
// endpoint contract; no fabricated home-success receipt or realm response.
test('home realm change confirms every active character including merchant', async ({ page, live }, info) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const names = ['E2EWarrior', 'E2EPriest', 'E2EMerchant'];
  try {
    const seeded = await live.admin(`output=(async()=>{let matched=0;for(const name of ${JSON.stringify(names)}) {
      const p=get_player(name); p.p.home='USII'; delete p.p.dt.last_homeset;
      const result=await db.collection('character').updateOne({'info.name':name},{$set:{'info.p.home':'USII'},$unset:{'info.p.dt.last_homeset':''}});
      matched+=result.matchedCount;
    } return matched;})()`);
    expect(seeded).toBe(names.length);
    // The server seed changes native player/DB state, but existing clients retain
    // their previous home until a real login sends a fresh character snapshot.
    await live.reconnectClient('E2EWarrior');
    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).realmControl?.homeRealm, {timeout:30_000}).toBe('SR_USII');
    await freshParticipants(live, names);
    await page.goto(live.url);
    // SSR buttons can appear before the React event handlers hydrate. Repeating
    // this idempotent open action verifies the dialog rather than losing a click.
    await expect(async () => {
      const settings = page.getByRole('dialog', {name:'Interface settings',exact:true});
      if (!await settings.isVisible()) await page.getByRole('button', {name:'Interface settings',exact:true}).click();
      await expect(settings).toBeVisible({timeout:1000});
    }).toPass({timeout:20_000});
    await page.getByLabel('Change realm', {exact:true}).click();
    await page.getByRole('option', {name:/US I \(/}).click();
    await page.getByRole('button', {name:'Change realm',exact:true}).click();
    await page.getByText('Set as home realm', {exact:true}).click();
    const modal = page.getByRole('dialog', {name:'Change home realm?',exact:true});
    await expect(modal).toContainText('This will change for all characters in the account including characters not currently logged in.');
    await expect(modal.getByRole('button', {name:'Cancel',exact:true})).toBeVisible();
    await info.attach('account-home-confirmation', {body:await page.screenshot(),contentType:'image/png'});
    await modal.getByRole('button', {name:'Change home realm',exact:true}).click();
    await expect.poll(async () => (await live.state()).realmControl?.operation?.phase, {timeout:120_000}).toBe('complete');
    const state = await live.state();
    expect(state.realmControl.operation.characters.filter((entry:any)=>entry.homeConfirmed).map((entry:any)=>entry.name).sort()).toEqual([...names].sort());
    const native = await live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,get_player(name).p.home]))`);
    expect(native).toEqual(Object.fromEntries(names.map(name=>[name,'USI'])));
    expect(state.realmControl.homeCharacters.every((entry:any)=>entry.home==='SR_USI')).toBe(true);
    await info.attach('native-account-home-realms', {body:JSON.stringify({native,state:state.realmControl}),contentType:'application/json'});
  } catch (error) {
    const screenshot = await page.screenshot({timeout:10_000}).catch(()=>null);
    if (screenshot) await info.attach('home-realm-dashboard-failure', {body:screenshot,contentType:'image/png'}).catch(()=>{});
    throw error;
  } finally {
    try { await info.attach('home-realm-dashboard-errors', {body:JSON.stringify(pageErrors),contentType:'application/json'}); }
    finally { await page.close(); }
  }
});

test.describe('temporary native headless home change', () => {
  test.use({ liveHeadless:true });
  test('offline merchant logs in to set home and returns offline without changing slots', async ({ page, live }, info) => {
    test.setTimeout(240_000);
    try {
      await live.post('/steam/action', {character:'E2EMerchant',action:'logout'});
      await expect.poll(async () => (await live.state()).activeSlots.some((slot:any) => slot.character === 'E2EMerchant'), {timeout:90_000}).toBe(false);
      await expect.poll(async () => await live.admin("output=!!get_player('E2EMerchant')"), {timeout:30_000}).toBe(false);
      const seeded = await live.admin("output=db.collection('character').updateOne({'info.name':'E2EMerchant'},{$set:{'info.p.home':'USII'},$unset:{'info.p.dt.last_homeset':''}})");
      expect(seeded.matchedCount).toBe(1);
      await live.restartCoordinator();
      await expect.poll(async () => (await live.state()).realmControl?.homeCharacters?.find((entry:any)=>entry.name==='E2EMerchant')?.home).toBe('SR_USII');
      await freshParticipants(live, ['E2EWarrior','E2EPriest']);
      const before = await live.state();
      const result = await live.post('/realm/switch', {realm:'SR_USI',setHome:true});
      expect(result.operation.homeTargets).toContain('E2EMerchant');
      await expect.poll(async () => (await live.state()).realmControl?.operation?.phase, {timeout:150_000}).toBe('complete');
      await expect.poll(async () => await live.admin("output=!!get_player('E2EMerchant')"), {timeout:30_000}).toBe(false);
      const after = await live.state();
      expect(after.realmControl.homeCharacters.every((entry:any)=>entry.home==='SR_USI')).toBe(true);
      expect(after.activeSlots.map((entry:any)=>({index:entry.index,kind:entry.kind,character:entry.character}))).toEqual(before.activeSlots.map((entry:any)=>({index:entry.index,kind:entry.kind,character:entry.character})));
      const storedHome = await live.admin("output=db.collection('character').findOne({'info.name':'E2EMerchant'}).then(c=>c.info.p.home)");
      expect(storedHome).toBe('USI');
      await info.attach('offline-character-native-home-and-slot-restoration', {body:JSON.stringify({before,after,storedHome}),contentType:'application/json'});
    } finally { await page.close(); }
  });
});
