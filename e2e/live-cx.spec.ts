import { test, expect } from './live-fixtures';

const W = 'E2EWarrior';

// Failure inventory: e2e/cx-failures.md. Setup places three jars in the bag; every
// outcome after a dashboard click is read back from the server.
test('CX jars show their state, open into the collection, and the cosmetic is worn and removed from the dashboard', async ({ live, page }, info) => {
  test.setTimeout(300_000);
  const seed = await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(W)}),hat=Object.keys(T).filter(k=>T[k]==='hat').sort()[0];
    if(!hat)throw Error('No hat cosmetic in the native table');
    const slots=[];for(let i=0;i<p.isize&&slots.length<3;i++)if(!p.items[i])slots.push(i);
    if(slots.length<3)throw Error('Three free inventory slots required');
    globalThis.__e2eCx={owned:(p.p.acx||{})[hat]||0,worn:Object.assign({},p.cx)};
    p.items[slots[0]]={name:'cxjar',q:1,data:hat};p.items[slots[1]]={name:'cxjar',q:1,data:hat,l:'l'};p.items[slots[2]]={name:'cxjar',q:1};
    cache_player_items(p);resend(p,'reopen+cid');
    return {hat,slot:cxtype_to_slot[T[hat]],slots,owned:globalThis.__e2eCx.owned};
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
