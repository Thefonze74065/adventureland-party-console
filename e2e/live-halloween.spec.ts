import { test, expect, type LiveGame } from './live-fixtures';
import { killNativeCharacter } from './hunt-interruption-helpers';

const W = 'E2EWarrior', P = 'E2EPriest', members = [W, P];

// Failure inventory: e2e/halloween-failures.md. The declared fixture turns the
// native season on, lets the server's own timer spawn Mr. Pumpkin at his map
// point, and lowers his HP and attack so one party kill fits the journey.
test('the Halloween row attends a live Mr. Pumpkin, kills him and ends attendance', async ({ live, page }, info) => {
  test.setTimeout(420_000);
  const travel: any[] = [];
  let probed = false, startedAt = Date.now();
  const observe = async () => {
    if (!probed && Date.now() - startedAt > 30_000) {
      // Re-submitting the client's own in-flight walk returns the coordinator's view of it.
      probed = true;
      const walk = await live.clients[W].run('globalThis.__partySharedWalking || null').catch(() => null);
      const answer = walk ? await live.post('/shared-travel', walk).catch((error: Error) => ({ error: error.message })) : null;
      travel.push({ at: Date.now(), probe: { walk, answer } });
    }
    const [server, state] = await Promise.all([world(), live.state()]);
    travel.push({ at: Date.now(), players: server.players, boss: server.boss,
      characters: Object.fromEntries(members.map(name => { const c = state.characters[name] || {};
        return [name, { navigation: c.navigationState, joinedEvent: c.joinedEvent, activeEvent: c.activeEvent, target: c.target?.mtype,
          command: state.commands?.[name] && { type: state.commands[name].type, purpose: state.commands[name].purpose } }]; })),
      merchant: state.merchantCurrent && { reason: state.merchantCurrent.reason, target: state.merchantCurrent.target },
      convoy: state.activeConvoy && { purpose: state.activeConvoy.purpose, phase: state.activeConvoy.phase } });
    return server;
  };
  const world = () => live.admin(`output=(()=>{const m=get_monster('mrpumpkin');return {season:!!E.halloween,broadcast:E.mrpumpkin||null,
    boss:m?{id:m.id,map:m.map,hp:m.hp,x:m.x,y:m.y}:null,
    players:Object.fromEntries(${JSON.stringify(members)}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))}})()`);
  try {
    await live.post('/formation', { leader: W });
    await live.post('/formation', { character: P, follow: true });
    const seed = await live.admin(`output=(()=>{
      if(events.halloween||get_monster('mrpumpkin')||get_monster('mrgreen'))throw Error('Halloween needs a clean baseline');
      globalThis.__e2ePumpkinAttack=G.monsters.mrpumpkin.attack;G.monsters.mrpumpkin.attack=1;
      events.halloween=true;timers.mrpumpkin=1;timers.mrgreen=new Date(Date.now()+3600000);
      return {original:{attack:globalThis.__e2ePumpkinAttack},initial:{attack:1},
        scope:'native season status, native spawn timer and broadcast, real dashboard toggle, party kill, attendance end'};
    })()`);
    await info.attach('halloween-initial-encounter', { body: JSON.stringify(seed), contentType: 'application/json' });
    await expect.poll(async () => (await world()).broadcast?.live, { timeout: 60_000, message: 'The server must spawn and broadcast Mr. Pumpkin' }).toBe(true);
    const spawned = await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');m.hp=m.max_hp=400000;
      E.mrpumpkin.hp=m.hp;E.mrpumpkin.max_hp=m.max_hp;broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp}})()`);

    await page.goto(live.url);
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
    await card.getByRole('button', { name: /^Events/ }).click();
    startedAt = Date.now();
    const row = page.locator('div').filter({ hasText: /^Halloween — / }).last();
    await expect(row, 'The Halloween row must report the live boss').toContainText('LIVE', { timeout: 60_000 });
    const toggle = row.getByRole('checkbox');
    await expect(toggle).toBeEnabled();
    // The checkbox is controlled: it turns checked once the coordinator saves the selection.
    await toggle.click();
    await expect(toggle).toBeChecked({ timeout: 15_000 });
    await info.attach('halloween-row-enabled', { body: await page.screenshot(), contentType: 'image/png' });
    await expect.poll(async () => (await live.state()).eventSelectionsByCharacter?.[W]).toContain('halloween');

    await expect.poll(async () => {
      const server = await observe();
      return members.every(name => server.players[name].map === spawned.map);
    }, { timeout: 180_000, message: 'Both fighters must travel to the broadcast boss map' }).toBe(true);
    await expect.poll(async () => {
      const state = await live.state();
      return members.every(name => state.characters[name]?.joinedEvent === 'halloween');
    }, { timeout: 60_000, message: 'Both clients must report Halloween attendance' }).toBe(true);
    await expect.poll(async () => (await world()).boss, { timeout: 180_000, message: 'The party must kill Mr. Pumpkin' }).toBeNull();
    const hits = Object.fromEntries(await Promise.all(members.map(async name => [name,
      (await live.clients[name].events()).filter((event: any) => event.event === 'hit' && event.data?.hid === name && event.data?.id === spawned.id).length])));
    expect(Object.values(hits).reduce((sum: number, count: any) => sum + count, 0), 'The party must have damaged the boss').toBeGreaterThan(0);
    await expect.poll(async () => {
      const state = await live.state();
      return members.every(name => state.characters[name]?.joinedEvent !== 'halloween');
    }, { timeout: 90_000, message: 'Attendance must end once no Halloween boss is live' }).toBe(true);
    await info.attach('halloween-attendance-native', { body: JSON.stringify({ spawned, hits, after: await world(), coordinator: await live.state() }, null, 2), contentType: 'application/json' });
  } finally {
    await info.attach('halloween-travel-timeline', { body: JSON.stringify(travel, null, 2), contentType: 'application/json' });
    await live.admin(`output=(()=>{if(globalThis.__e2ePumpkinAttack!==undefined)G.monsters.mrpumpkin.attack=globalThis.__e2ePumpkinAttack;
      events.halloween=false;delete timers.mrpumpkin;delete timers.mrgreen;
      for(const type of ['mrpumpkin','mrgreen']){const m=get_monster(type);if(m)remove_monster(m);delete E[type];}
      delete E.halloween;broadcast_e();return true})()`).catch(() => undefined);
  }
});

/** Declared fixture: native season and spawn timer; only HP and attack are lowered. */
async function seedPumpkin(live: LiveGame, hp: number, attack: number) {
  await live.admin(`output=(()=>{
    if(events.halloween||get_monster('mrpumpkin')||get_monster('mrgreen'))throw Error('Halloween needs a clean baseline');
    globalThis.__e2ePumpkinAttack=G.monsters.mrpumpkin.attack;G.monsters.mrpumpkin.attack=${attack};
    events.halloween=true;timers.mrpumpkin=1;timers.mrgreen=new Date(Date.now()+3600000);return true})()`);
  await expect.poll(() => live.admin("output=!!E.mrpumpkin?.live"), { timeout: 60_000, message: 'The server must spawn and broadcast Mr. Pumpkin' }).toBe(true);
  return live.admin(`output=(()=>{const m=get_monster('mrpumpkin');m.hp=m.max_hp=${hp};
    E.mrpumpkin.hp=m.hp;E.mrpumpkin.max_hp=m.max_hp;broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp,range:m.range}})()`);
}
async function clearHalloween(live: LiveGame) {
  await live.admin(`output=(()=>{if(globalThis.__e2ePumpkinAttack!==undefined)G.monsters.mrpumpkin.attack=globalThis.__e2ePumpkinAttack;
    events.halloween=false;delete timers.mrpumpkin;delete timers.mrgreen;
    for(const type of ['mrpumpkin','mrgreen']){const m=get_monster(type);if(m)remove_monster(m);delete E[type];}
    delete E.halloween;broadcast_e();return true})()`).catch(() => undefined);
}

test('a Halloween off-tank waits for a holder, steps out of range when targeted, and auto mode counts its own deaths', async ({ live, page }, info) => {
  test.setTimeout(480_000);
  const timeline: any[] = [];
  try {
    await live.post('/formation', { leader: W });
    await live.post('/formation', { character: P, follow: false });
    // The warrior's routine is chosen in the real dialog; the priest tanks.
    await page.goto(live.url);
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
    await card.getByRole('button', { name: /^Events/ }).click();
    await page.getByRole('button', { name: 'Halloween routine settings' }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp('Halloween routine · ' + W) });
    await dialog.getByRole('button', { name: /^Off-tank/ }).click();
    await expect.poll(async () => (await live.state()).farmingProfiles?.[W]?.encounterRoutines?.halloween).toBe('offtank');
    await expect(dialog.getByRole('button', { name: /^Off-tank/ })).toHaveAttribute('aria-pressed', 'true');
    await info.attach('halloween-routine-dialog', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await live.post('/encounter-mode', { character: P, encounter: 'halloween', mode: 'tank' });

    const boss = await seedPumpkin(live, 3_000_000, 1);
    for (const name of members) await live.post('/formation', { character: name, eventSelections: ['halloween'] });
    const sample = async () => {
      const entry = await live.admin(`output=(()=>{const m=get_monster('mrpumpkin'),w=get_player(${JSON.stringify(W)});
        return {at:Date.now(),hp:m?m.hp:0,target:m?m.target||null:null,warrior:{map:w.map,x:w.x,y:w.y},
          distance:m&&w.map===m.map?Math.hypot(w.x-m.x,w.y-m.y):null}})()`);
      entry.position = await live.clients[W].run('globalThis.partyCombatPosition ? {mode: partyCombatPosition.mode, reason: partyCombatPosition.reason, target: partyCombatPosition.target} : null').catch(() => null);
      timeline.push(entry); return entry;
    };
    await expect.poll(async () => (await sample()).target, { timeout: 240_000, intervals: [250], message: 'The tank priest must take the boss' }).toBe(P);
    const heldAt = timeline.find(entry => entry.target === P).at;
    await expect.poll(async () => {
      await sample();
      return (await live.clients[W].events()).some((event: any) => event.event === 'hit' && event.data?.hid === W && event.data?.id === boss.id);
    }, { timeout: 90_000, intervals: [250], message: 'The off-tank must join once the priest holds the boss' }).toBe(true);
    const firstHit = (await live.clients[W].events()).find((event: any) => event.event === 'hit' && event.data?.hid === W && event.data?.id === boss.id);
    expect(firstHit.at - heldAt, 'The off-tank waits for a 5-second hold before attacking').toBeGreaterThanOrEqual(4_500);

    // The boss takes the off-tank through its native targeting; it must leave the boss's range.
    const takeWarrior = () => live.admin(`output=(()=>{target_player(get_monster('mrpumpkin'),get_player(${JSON.stringify(W)}));return true})()`);
    await takeWarrior();
    await expect.poll(async () => {
      const entry = await sample();
      if (entry.target !== W) { await takeWarrior(); return false; }
      return (entry.distance ?? 0) >= boss.range;
    }, { timeout: 45_000, intervals: [250], message: 'A targeted off-tank must step outside the boss range' }).toBe(true);
    const retreat = timeline[timeline.length - 1];

    // Auto mode with a one-death limit: a native death during attendance flips it to off-tank.
    await live.post('/encounter-mode', { character: W, encounter: 'halloween', mode: 'auto', deathLimit: 1 });
    const frankyBefore = (await live.state()).farmingProfiles?.[W]?.encounterAutoDeaths?.franky || 0;
    await expect.poll(async () => (await live.state()).characters[W]?.joinedEvent).toBe('halloween');
    const death = await killNativeCharacter(live, W);
    await expect.poll(async () => (await live.state()).farmingProfiles?.[W]?.encounterAutoDeaths?.halloween,
      { timeout: 60_000, message: 'The death must count against the Halloween auto-tank limit' }).toBe(1);
    expect((await live.state()).farmingProfiles?.[W]?.encounterAutoDeaths?.franky || 0, 'Franky deaths are untouched').toBe(frankyBefore);
    await info.attach('halloween-offtank-native', { body: JSON.stringify({ boss, heldAt, firstHit, retreat, death, timeline,
      profiles: (await live.state()).farmingProfiles }, null, 2), contentType: 'application/json' });
  } finally {
    await info.attach('halloween-offtank-timeline', { body: JSON.stringify(timeline, null, 2), contentType: 'application/json' });
    await clearHalloween(live);
  }
});
