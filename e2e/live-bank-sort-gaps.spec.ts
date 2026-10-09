import { test, expect, type LiveGame } from './live-fixtures';

// Failure inventory: e2e/bank-sort-gaps-failures.md. A real merchant sorts a real
// bank with gaps, then sorts again after one new item type that belongs near the
// front, and the moves are counted from the server's own bank before and after.
const merchant = 'E2EMerchant';
type Cell = { pack: string; slot: number; item: any };

async function nativeBank(live: LiveGame): Promise<Cell[]> {
  return live.admin(`output=(async()=>{const p=get_player('${merchant}'),user=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
    return Object.keys(user).filter(k=>/^items\\d+$/.test(k)&&bank_packs[k]&&bank_packs[k][0]==='bank')
      .sort((a,b)=>a.slice(5)-b.slice(5)).flatMap(pack=>user[pack].slice(0,pack==='items1'?35:42).map((item,slot)=>({pack,slot,item:item?{name:item.name,level:item.level,q:item.q}:null})))})()`);
}
const sequence = (cells: Cell[]) => cells.filter(c => c.item).map(c => `${c.item.name}:${c.item.level ?? ''}:${c.item.q ?? 1}`);
const changed = (a: Cell[], b: Cell[]) => a.filter((cell, i) => JSON.stringify(cell.item) !== JSON.stringify(b[i]?.item)).length;
async function visitBank(live: LiveGame) {
  const before = (await live.state()).bank?.seenAt || 0;
  await live.post('/command', { character: merchant, type: 'bank' });
  await expect.poll(async () => ((await live.state()).bank?.seenAt || 0) > before, { timeout: 120_000 }).toBe(true);
  await expect.poll(async () => {
    const state = await live.state();
    return !state.merchantCurrent && !/^bank/.test(state.characters[merchant]?.map || '');
  }, { timeout: 180_000, message: 'The merchant must finish the visit and leave the bank' }).toBe(true);
}

test('gapped bank sorting keeps sorted order and moves few items for a new type', async ({ live }, info) => {
  test.setTimeout(900_000);
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': false } });

  // Declared fixture: five distinct item types from each of eight categories,
  // written into the merchant's bank in reverse order so a sort has real work.
  const seeded = await live.admin(`output=(async()=>{
    const p=get_player('${merchant}'),user=await db.collection('user').findOne({_id:p.owner});
    const packs=Object.keys(user.info).filter(k=>/^items\\d+$/.test(k)&&bank_packs[k]&&bank_packs[k][0]==='bank').sort((a,b)=>a.slice(5)-b.slice(5));
    const types=['ring','earring','amulet','belt','gloves','shoes','material','pot'];
    const items=types.flatMap(t=>Object.keys(G.items).filter(n=>G.items[n].type===t&&!G.items[n].ignore).sort().slice(0,5)).map(name=>({name,...(G.items[name].upgrade||G.items[name].compound?{level:0}:{q:1})})).reverse();
    const slots=packs.flatMap(pack=>Array.from({length:pack==='items1'?35:42},(_,slot)=>[pack,slot]));
    const patch={};for(const [pack,slot] of slots)patch['info.'+pack+'.'+slot]=null;
    items.forEach((item,i)=>{patch['info.'+slots[i][0]+'.'+slots[i][1]]=item;});
    await db.collection('user').updateOne({_id:p.owner},{$set:patch});
    return {packs,items};
  })()`);
  expect(seeded.packs.length, 'The test account must own at least one bank pack on the first floor').toBeGreaterThan(0);

  // 1. The toggle persists across a coordinator restart.
  await live.post('/merchant/bank-sort', { mode: 'automatic', layout: 'gapped' });
  await live.restartCoordinator();
  expect((await live.state()).bankSortLayout).toBe('gapped');

  // 2. First gapped sort: sorted, one category per row, nothing lost.
  await visitBank(live);
  const first = await nativeBank(live);
  expect(first.filter(c => c.item).length, 'Every seeded item stays in the bank').toBe(seeded.items.length);
  const gaps = first.filter((c, i) => !c.item && first.slice(i + 1).some(next => next.item)).length;
  expect(gaps, 'The gapped layout leaves free slots between categories').toBeGreaterThan(0);

  // 3. One new type that sorts before every seeded category (a helmet).
  const added = await live.admin(`output=(async()=>{
    const p=get_player('${merchant}'),user=await db.collection('user').findOne({_id:p.owner});
    const name=Object.keys(G.items).filter(n=>G.items[n].type==='helmet'&&!G.items[n].ignore).sort()[0];
    const free=${JSON.stringify(seeded.packs)}.flatMap(pack=>Array.from({length:pack==='items1'?35:42},(_,slot)=>[pack,slot])).filter(([pack,slot])=>!user.info[pack][slot]).pop();
    await db.collection('user').updateOne({_id:p.owner},{$set:{['info.'+free[0]+'.'+free[1]]:{name,level:0}}});
    return {name,pack:free[0],slot:free[1]};
  })()`);
  const withNew = await nativeBank(live);
  await visitBank(live);
  const second = await nativeBank(live);
  const moved = changed(withNew, second);
  expect(second.filter(c => c.item).length).toBe(seeded.items.length + 1);
  expect(second.find(c => c.item)?.item.name, 'The new helmet sorts first').toBe(added.name);
  expect(moved, 'A new type moves a few items, not the whole bank').toBeLessThan(seeded.items.length / 2);

  // 4. No change, no moves.
  await visitBank(live);
  const third = await nativeBank(live);
  expect(changed(second, third), 'An unchanged bank is left as it is').toBe(0);

  // 5. Packed again: the same order with no gaps, so the gapped order was sorted.
  await live.post('/merchant/bank-sort', { layout: 'packed' });
  await visitBank(live);
  const packed = await nativeBank(live);
  expect(sequence(packed), 'Gapped and packed layouts hold the same sorted sequence').toEqual(sequence(second));
  expect(packed.slice(0, seeded.items.length + 1).every(c => c.item), 'Packed layout has no gaps').toBe(true);
  // The merchant keeps its own potion stock, so compare whole stacks, not names.
  const banked = new Set(sequence(withNew));
  const carried = (await live.clients[merchant].snapshot()).items.filter((item: any) => item &&
    banked.has(sequence([{ pack: '', slot: 0, item: { name: item.name, level: item.level, q: item.q } }])[0]));
  await info.attach('gapped-bank-sort-evidence', { body: JSON.stringify({ seeded, first, added, withNew, second, moved, third, packed,
    gapsAfterFirst: gaps, carried }, null, 2), contentType: 'application/json' });
  expect(carried, 'No bank item is left in the merchant inventory').toEqual([]);
});
