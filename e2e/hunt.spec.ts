import { test, expect } from './fixtures';

test('passive level caps save and preferred spawns show their map area', async ({page,app},info) => {
  // Failure modes: legacy caps lack a default; zero/fractions save; positive caps
  // disappear after reload; spawn coordinates have no rendered map preview.
  await page.route('**/party-api/state*', async route => {
    const response=await route.fetch(), state=await response.json();
    const monsterChoices=(state.monsterChoices || []).map((monster:{id:string;locations?:unknown[]})=>monster.id==='goo' ? {...monster,locations:[...(monster.locations || []),{map:'main',mapName:'Mainland',x:350,y:100,boundary:[300,50,400,150]}]} : monster);
    await route.fulfill({response,json:{...state,monsterChoices}});
  });
  await page.goto('/');
  const warrior=page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})});
  await warrior.getByRole('button',{name:'Farming settings',exact:true}).click();
  await page.getByRole('button',{name:'Open passive hunting menu',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Passive hunting',exact:true});
  await dialog.getByRole('textbox',{name:'Filter passive hunting monsters'}).fill('goo');
  const cap=dialog.getByRole('spinbutton',{name:'Goo passive max level',exact:true});
  await expect(cap).toHaveValue('-1');
  await cap.fill('0'); await cap.press('Tab');
  await expect(dialog.getByRole('alert')).toContainText('positive whole number');
  await cap.fill('3'); await cap.press('Tab');
  await expect.poll(async()=> (await app.state()).passiveHunting?.rules.goo?.maxLevel).toBe(3);
  await info.attach('passive-level-cap',{body:await page.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Set preferred hunt spawns',exact:true}).click();
  const spawns=page.getByRole('dialog',{name:'Preferred hunt spawns',exact:true});
  await spawns.locator('summary').first().click();
  await expect(spawns.locator('canvas')).toBeVisible();
  await info.attach('preferred-spawn-map',{body:await page.screenshot(),contentType:'image/png'});
  await info.attach('passive-settings-state',{body:JSON.stringify((await app.state()).passiveHunting),contentType:'application/json'});
});

test('Hunt saves a backup, accepts settings, and exits without losing preferences', async ({ page, app }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const exchanges: unknown[] = [];
  const responseFor = (endpoint: string) => page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith(endpoint) && response.request().method() === 'POST');
  const record = async (pending: ReturnType<typeof responseFor>) => {
    const response = await pending;
    exchanges.push({ endpoint: new URL(response.url()).pathname, request: response.request().postDataJSON(), status: response.status() });
    expect(response.status()).toBe(200);
    return response.request().postDataJSON();
  };
  await page.goto('/');
  const warrior = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
  await expect(warrior).toBeVisible();
  const modes = warrior.getByRole('button', { name: /^Farming settings .+/ });
  await modes.click();
  await warrior.getByRole('button', { name: 'Hunt', exact: true }).click();
  const preparation = page.getByRole('dialog', { name: 'Getting ready to hunt', exact: true });
  await expect(preparation).toBeVisible();
  await preparation.getByRole('button', { name: 'No monsters selected 0', exact: true }).click();
  const goo = page.getByRole('checkbox', { name: /\bGoo · goo\b/ });
  await expect(goo).toBeVisible();
  await goo.check();
  await expect(goo).toBeChecked();
  await page.keyboard.press('Escape');
  // The fixture publishes real Goo spawn records. The production area picker computes these choices.
  const area = preparation.locator('button[aria-pressed]').first();
  await expect(area).toBeVisible();
  await area.click();
  const started = responseFor('/farming-mode');
  await preparation.getByRole('button', { name: 'Save backup and start Hunt', exact: true }).click();
  const startRequest = await record(started);
  expect(startRequest).toMatchObject({ character: 'W', mode: 'hunt', backup: { monsterFocus: ['goo'], location: { map: 'main' } } });
  await expect(preparation).not.toBeVisible();
  await expect(warrior.getByRole('button', { name: 'Hunt', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const hunting = await app.state();
  expect(hunting.farmingProfiles.W.farmingPolicy).toBe('hunt');

  await warrior.getByRole('button', { name: 'Farming settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Farming settings · W', exact: true });
  await expect(settings).toBeVisible();
  const relocate = settings.getByRole('checkbox', { name: 'Relocate to different spawn if competing', exact: true });
  await expect(relocate).toBeChecked();
  const updated = responseFor('/hunt-settings');
  // This controlled checkbox changes only after the real save and query refresh complete.
  await relocate.click();
  expect(await record(updated)).toMatchObject({ character: 'W', relocateIfCompeting: false });
  await expect(relocate).not.toBeChecked();
  await page.keyboard.press('Escape');

  const stopped = responseFor('/farming-mode');
  await warrior.getByRole('button', { name: 'Default', exact: true }).click();
  expect(await record(stopped)).toMatchObject({ character: 'W', mode: 'default' });
  await expect(warrior.getByRole('button', { name: 'Default', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const afterExit = await app.state();
  expect(afterExit.farmingProfiles.W.farmingPolicy).toBe('default');
  expect(afterExit.farmingProfiles.W.huntSettings.relocateIfCompeting).toBe(false);
  expect(afterExit.farmingProfiles.W.monsterFocus).toEqual(['goo']);
  expect(afterExit.farmingProfiles.W.monsterHunt).toBeNull();

  await page.reload();
  await expect(warrior).toBeVisible();
  await modes.click();
  await expect(warrior.getByRole('button', { name: 'Default', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await warrior.getByRole('button', { name: 'Farming settings', exact: true }).click();
  await expect(settings).toBeVisible();
  await expect(relocate).not.toBeChecked();
  expect(errors, 'The browser must not crash during Hunt controls').toEqual([]);
  await testInfo.attach('hunt-preferences-after-reload', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await testInfo.attach('hunt-http-and-state', { body: Buffer.from(JSON.stringify({ exchanges, hunting, afterExit, afterReload: await app.state(), browserErrors: errors }, null, 2)), contentType: 'application/json' });
});
