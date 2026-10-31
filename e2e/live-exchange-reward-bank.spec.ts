import { test, expect } from './live-fixtures';

// Failure inventory: e2e/exchange-reward-bank-failures.md (#28). The declared inputs
// are the merchant's seeded inventory: ten gem0 plus a carried stack of every item
// gem0 can yield, so each item reward merges into a stack. The exchange rolls, the
// reward placement and every bank deposit are native.
const merchant = 'E2EMerchant';
const rewards: Record<string, number> = { armorbox: 2, weaponbox: 2, offering: 1, scroll1: 10, cscroll1: 4, scroll3: 1, cscroll3: 1 };
const native = (live: { admin(code: string): Promise<any> }) => live.admin(`output=(async()=>{const p=get_player('${merchant}');
  const u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
  const count=(list,test)=>(list||[]).filter(i=>i&&test(i)).reduce((n,i)=>n+(i.q||1),0);
  const bank=Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v);
  const names=${JSON.stringify(Object.keys(rewards))}.concat(['gem0','beewings']);
  return {carried:Object.fromEntries(names.map(n=>[n,count(p.items,i=>i.name===n&&!i.l)])),
    locked:p.items.filter(i=>i&&i.l).map(i=>({name:i.name,q:i.q,l:i.l})),
    bank:Object.fromEntries(names.map(n=>[n,count(bank,i=>i.name===n)])),gold:p.gold+(Number(u.gold)||0)};})()`);

test('exchange rewards that merge into carried stacks are banked by default', async ({ live }, info) => {
  test.setTimeout(420_000);
  const observations: any[] = [];
  try {
    await expect.poll(async () => (await live.state(true)).merchantCatalog?.exchangeable?.some((entry: { id: string }) => entry.id === 'gem0'),
      { timeout: 120_000 }).toBe(true);
    const seeded = await live.admin(`output=(()=>{const p=get_player('${merchant}');
      const names=${JSON.stringify(Object.keys(rewards))}.concat(['gem0','beewings']);
      for(let slot=20;slot<=29;slot++) if(p.items[slot]) throw Error('Fixture requires empty inventory cells 20-29');
      if(p.items.some(i=>i&&names.includes(i.name))) throw Error('Fixture requires no carried reward items');
      p.items[20]={name:'gem0',q:10};
      ${JSON.stringify(Object.entries(rewards))}.forEach(([name,q],n)=>{p.items[21+n]={name,q};});
      p.items[28]={name:'armorbox',q:1,l:'l'};p.items[29]={name:'beewings',q:3};
      cache_player_items(p);resend(p,'reopen+cid');return p.items.slice(20,30);})()`);
    await info.attach('declared-merchant-inventory', { body: JSON.stringify(seeded), contentType: 'application/json' });
    await expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 29)?.item?.name,
      { timeout: 30_000 }).toBe('beewings');
    const before = await native(live);

    const order = await live.post('/merchant/exchange-order', { exchanges: [{ id: 'gem0', level: 0, quantity: 10 }] });
    await expect.poll(async () => {
      const state = await live.state(), n = await native(live);
      observations.push({ at: Date.now(), n });
      return [state.merchantCurrent, ...(state.merchantQueue || [])].some(job => job?.id === order.jobId) || n.carried.gem0 > 0;
    }, { timeout: 360_000, intervals: [1000, 2000] }).toBe(false);
    const after = await native(live);
    const gainedNames = Object.keys(rewards).filter(name => after.carried[name] + after.bank[name] > before.carried[name] + before.bank[name]);
    await expect.poll(async () => {
      const state = await live.state();
      return gainedNames.every(name => state.autoItemMarks?.[merchant]?.[name + '@+0'] === 'bank');
    }, {timeout: 30_000, message: 'Received default rewards must become visible saved Auto bank rules'}).toBe(true);
    await live.restartCoordinator();
    const restored = await live.state();
    for (const name of gainedNames) expect(restored.autoItemMarks?.[merchant]?.[name + '@+0']).toBe('bank');

    // 1: every item reward left the merchant's inventory; nothing was lost on the way.
    const gained = Object.keys(rewards).reduce((sum, name) => sum + after.carried[name] + after.bank[name] - before.carried[name] - before.bank[name], 0);
    expect(gained, 'ten gem0 exchanges yield at least one item (all-gold odds are about 1 in 400)').toBeGreaterThan(0);
    for (const name of Object.keys(rewards)) {
      expect(after.carried[name], `${name} rewards must not stay carried`).toBeLessThanOrEqual(before.carried[name]);
      expect(after.carried[name] + after.bank[name], `${name} copies must not be lost`).toBeGreaterThanOrEqual(before.carried[name] + before.bank[name]);
    }
    // 3, 4: stock the exchange did not add to stays carried, locked stock included.
    expect(after.carried.beewings).toBe(3);
    expect(after.locked).toContainEqual({ name: 'armorbox', q: 1, l: 'l' });
    expect(after.carried.gem0).toBe(0);
  } finally {
    await info.attach('native-exchange-reward-bank', { body: JSON.stringify({ observations, native: await native(live).catch(String),
      activity: (await live.state()).merchantActivity.slice(-20) }), contentType: 'application/json' });
  }
});
