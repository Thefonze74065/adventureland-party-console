import { test, expect } from './live-fixtures';

const W = 'E2EWarrior';

// Failure inventory: e2e/cx-failures.md. Setup places three jars in the bag; every
// outcome after a dashboard click is read back from the server.
test('CX jars show their state, open into the collection, and the cosmetic is worn and removed from the dashboard', async ({ live, page }, info) => {
  test.setTimeout(300_000);
  const seed = await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(W)}),hat=Object.keys(T).filter(k=>T[k]==='hat').sort()[0];
    if(!hat)throw Error('No hat cosmetic in the native table');
    const slots=[];for(let i=0;i<p.isize&&slots.length<4;i++)if(!p.items[i])slots.push(i);
    if(slots.length<4)throw Error('Four free inventory slots required');
    globalThis.__e2eCx={owned:(p.p.acx||{})[hat]||0,worn:Object.assign({},p.cx)};
    p.items[slots[0]]={name:'cxjar',q:1,data:hat};p.items[slots[1]]={name:'cxjar',q:1,data:hat,l:'l'};p.items[slots[2]]={name:'cxjar',q:1};p.items[slots[3]]={name:'cxjar',q:1,data:'ikissyou'};
    cache_player_items(p);resend(p,'reopen+cid');
    return {hat,slot:cxtype_to_slot[T[hat]],slots,owned:globalThis.__e2eCx.owned,emote:G.skills.ikissyou.name};
  })()`);
  const server = () => live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});
    return {jar:p.items[${seed.slots[0]}]||null,owned:(p.p.acx||{})[${JSON.stringify(seed.hat)}]||0,worn:p.cx[${JSON.stringify(seed.slot)}]||null}})()`);
  try {
    await page.goto(live.url);
    const panel = page.getByRole('region', { name: `${W} cosmetics` });
    await expect(async () => {
      const toggle = panel.getByRole('button', { name: /^Cosmetics/ });
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await expect(panel.getByText(`Slot ${seed.slots[2]} · empty`)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
    const row = (slot: number) => panel.getByRole('listitem').filter({ hasText: `Slot ${slot} ·` });
    await expect(row(seed.slots[0])).toContainText('Usable');
    await expect(row(seed.slots[1])).toContainText('Locked');
    await expect(row(seed.slots[2])).toContainText('Empty');
    // Emotes use the game's own display name.
    await expect(row(seed.slots[3])).toContainText(`${seed.emote} · emote`);
    await expect(row(seed.slots[1]).getByRole('button')).toHaveCount(0);
    await expect(row(seed.slots[2]).getByRole('button')).toHaveCount(0);
    await info.attach('cx-jars-dashboard', { body: await page.screenshot(), contentType: 'image/png' });

    await panel.getByRole('button', { name: `Open CX jar in slot ${seed.slots[0]}` }).click();
    await expect.poll(server, { timeout: 30_000, message: 'The jar must leave the bag and the cosmetic join the collection' })
      .toMatchObject({ jar: null, owned: seed.owned + 1 });

    const wear = panel.getByRole('button', { name: `Wear ${seed.hat}` });
    await expect(wear).toBeEnabled({ timeout: 30_000 });
    await wear.click();
    await expect.poll(async () => (await server()).worn, { timeout: 30_000 }).toBe(seed.hat);
    await expect(panel.getByRole('button', { name: `Remove ${seed.hat} from ${seed.slot}` })).toBeVisible({ timeout: 30_000 });
    await info.attach('cx-worn-dashboard', { body: await page.screenshot(), contentType: 'image/png' });

    await panel.getByRole('button', { name: `Remove ${seed.hat} from ${seed.slot}` }).click();
    await expect.poll(async () => (await server()).worn, { timeout: 30_000 }).toBeNull();
    await info.attach('cx-native', { body: JSON.stringify({ seed, after: await server() }, null, 2), contentType: 'application/json' });
  } finally {
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),s=globalThis.__e2eCx;if(!s)return false;
      for(const i of ${JSON.stringify(seed.slots)})if(p.items[i]&&p.items[i].name==='cxjar')p.items[i]=null;
      if(s.owned)p.p.acx[${JSON.stringify(seed.hat)}]=s.owned;else delete p.p.acx[${JSON.stringify(seed.hat)}];
      p.cx=s.worn;cache_player_items(p);resend(p,'reopen+cid+u');return true})()`).catch(() => undefined);
  }
});

test('owned emotes preview and run from the dashboard, and a refusal shows its reason', async ({ live, page }, info) => {
  test.setTimeout(300_000);
  const P = 'E2EPriest';
  await live.post('/formation', { leader: W });
  await live.post('/formation', { character: P, follow: true });
  // Setup places two jars; the emotes are unlocked by opening them natively from the dashboard.
  const seed = await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(W)}),slots=[];for(let i=0;i<p.isize&&slots.length<2;i++)if(!p.items[i])slots.push(i);
    if(slots.length<2)throw Error('Two free inventory slots required');
    globalThis.__e2eEmotes={acx:Object.assign({},p.p.acx),mp:p.mp};
    p.items[slots[0]]={name:'cxjar',q:1,data:'jump'};p.items[slots[1]]={name:'cxjar',q:1,data:'boop'};
    cache_player_items(p);resend(p,'reopen+cid');
    const icon=G.positions[G.skills.jump.skin];
    return {slots,jump:G.skills.jump.name,boop:G.skills.boop.name,jumpSheet:G.imagesets[icon[0]||'pack_20'].file};
  })()`);
  const server = () => live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});
    return {jump:+(p.p.acx||{}).jump||0,boop:+(p.p.acx||{}).boop||0,lastJump:p.last.jump?+new Date(p.last.jump):0,lastBoop:p.last.boop?+new Date(p.last.boop):0,mp:p.mp}})()`);
  try {
    await live.clients[P].page.evaluate(() => { const g = window as any; g.__cxEmotes = []; g.socket.on('emote', (d: unknown) => g.__cxEmotes.push(d)); });
    await page.goto(live.url);
    const panel = page.getByRole('region', { name: `${W} cosmetics` });
    await expect(async () => {
      const toggle = panel.getByRole('button', { name: /^Cosmetics/ });
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await expect(panel.getByRole('button', { name: `Open CX jar in slot ${seed.slots[1]}` })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
    for (const slot of seed.slots) {
      await panel.getByRole('button', { name: `Open CX jar in slot ${slot}` }).click();
      await expect(panel.getByRole('button', { name: `Open CX jar in slot ${slot}` })).toHaveCount(0, { timeout: 30_000 });
    }
    await expect.poll(server, { timeout: 30_000 }).toMatchObject({ jump: 1, boop: 1 });

    // Previews: emote skill icons and appearance layers come from the game sprite sheets.
    await expect(panel.getByRole('img', { name: `${seed.jump} preview` })).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole('img', { name: `${seed.boop} preview` })).toBeVisible();
    await expect(panel.getByRole('img', { name: /preview$/ }).nth(2)).toBeVisible();
    // The disposable browser cannot load adventure.land art, so check what the preview draws:
    // the sprite sheet the server assigns to the Jump skill icon.
    expect(await panel.getByRole('img', { name: `${seed.jump} preview` }).locator('span[aria-hidden]').evaluate(e => (e as HTMLElement).style.backgroundImage))
      .toContain(seed.jumpSheet);
    await info.attach('cx-emotes-dashboard', { body: await page.screenshot(), contentType: 'image/png' });

    const jumpAt = Date.now();
    await panel.getByRole('button', { name: `Use ${seed.jump}` }).click();
    await expect.poll(async () => (await server()).lastJump, { timeout: 30_000, message: 'The server must record the Jump' }).toBeGreaterThan(jumpAt - 1000);
    await expect(panel.getByRole('status')).toContainText(`${seed.jump} · used`, { timeout: 30_000 });

    const target = panel.getByRole('combobox', { name: `Target for ${seed.boop}` });
    await expect(target.locator('option', { hasText: P })).toHaveCount(1, { timeout: 30_000 });
    await target.selectOption(P);
    const boopAt = Date.now();
    await panel.getByRole('button', { name: `Use ${seed.boop}` }).click();
    await expect.poll(async () => (await server()).lastBoop, { timeout: 30_000 }).toBeGreaterThan(boopAt - 1000);
    await expect.poll(() => live.clients[P].page.evaluate(() => (window as any).__cxEmotes),
      { timeout: 15_000, message: 'The priest must receive the Boop aimed at it' })
      .toContainEqual(expect.objectContaining({ name: 'boop', player: W, target: P }));
    await expect(panel.getByRole('status')).toContainText(`${seed.boop} → ${P} · used`, { timeout: 30_000 });

    // Declared condition: the server no longer counts Boop as owned (as after giving it away) while
    // the client still lists it, so the native skill is refused and the reason reaches the dashboard.
    await expect(panel.getByRole('button', { name: `Use ${seed.boop}` })).toBeEnabled({ timeout: 30_000 });
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});delete p.p.acx.boop;return Object.keys(p.p.acx).includes('boop')})()`);
    const before = (await server()).lastBoop;
    await panel.getByRole('button', { name: `Use ${seed.boop}` }).click();
    await expect(panel.getByRole('status')).toContainText(`${seed.boop} → ${P} · refused`, { timeout: 30_000 });
    expect((await server()).lastBoop, 'A refused emote is not recorded').toBe(before);
    await info.attach('cx-emotes-native', { body: JSON.stringify({ seed, after: await server(),
      received: await live.clients[P].page.evaluate(() => (window as any).__cxEmotes) }, null, 2), contentType: 'application/json' });
  } finally {
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),s=globalThis.__e2eEmotes;if(!s)return false;
      for(const i of ${JSON.stringify(seed.slots)})if(p.items[i]&&p.items[i].name==='cxjar')p.items[i]=null;
      p.p.acx=s.acx;p.mp=s.mp;cache_player_items(p);resend(p,'reopen+cid+u');return true})()`).catch(() => undefined);
  }
});
