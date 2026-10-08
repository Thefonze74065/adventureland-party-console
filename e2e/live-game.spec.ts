import { test, expect } from './live-fixtures';
import type { LiveGame } from './live-fixtures';
import type { TestInfo } from '@playwright/test';
import { seedSmallGoobrawl } from './game/event-scenario';
import { killNativeCharacter } from './hunt-interruption-helpers';

const W = 'E2EWarrior', P = 'E2EPriest', M = 'E2EMerchant';
type Live = LiveGame;
type Location = { map: string; x: number; y: number };
const names = [W, P, M];
const quantity = (items: any[], id: string) => items.reduce((sum, item) => sum + (item?.name === id ? item.q || 1 : 0), 0);

async function observed(live: Live): Promise<Record<string, any>> {
  return live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(name=>{const p=get_player(name);return [name,p?{name:p.name,map:p.map,in:p.in,x:p.x,y:p.y,hp:p.hp,rip:!!p.rip,moving:!!p.moving,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,quest:p.s.monsterhunt||null,party:p.party||null,townAt:p.last.town?+p.last.town:0}:null]}))`);
}
async function evidence(live: Live, info: TestInfo, label: string, detail: unknown = {}) {
  await info.attach(label, { body: JSON.stringify({ detail, server: await observed(live), coordinator: await live.state() }, null, 2), contentType: 'application/json' });
}
async function point(live: Live, name: string, distance = 250, direction = 1): Promise<Location> {
  return live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)});for(let i=0;i<16;i++){const a=i*Math.PI/8;const x=p.x+${distance * direction}*Math.cos(a),y=p.y+${distance * direction}*Math.sin(a);if(can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))return {map:p.map,x,y};}throw Error('No reachable test destination')})()`);
}
async function arrived(live: Live, party: string[], destination: Location, timeout = 120_000) {
  await expect.poll(async () => {
    const players = await observed(live);
    return party.every(name => players[name]?.map === destination.map && Math.hypot(players[name].x-destination.x, players[name].y-destination.y) < 35 && !players[name].moving);
  }, { message: `Real server must observe ${party.join(', ')} arriving`, timeout, intervals: [250, 500, 1000] }).toBe(true);
}
async function party(live: Live) {
  await live.post('/formation', { leader: W });
  await live.post('/formation', { character: P, follow: true });
  await expect.poll(async () => (await live.state()).followers[P]).toBe(true);
}
async function travel(live: Live, character: string, destination: Location) {
  return live.post('/command', { character, type: 'character-travel', location: destination, label: 'E2E observed destination' });
}
async function seedQuest(live: Live, count: number) {
  await live.admin(`output=${JSON.stringify([W, P])}.map(name=>{const p=get_player(name);p.s.monsterhunt={sn:region+' '+server_name,id:'goo',c:${count},ms:1800000};resend(p,'u+cid+reopen');return p.s.monsterhunt})`);
  await expect.poll(async () => (await live.state()).characters[W]?.monsterHunt?.count, { timeout: 20_000 }).toBe(count);
}
async function startHunt(live: Live) {
  await expect.poll(async () => (await live.state(true)).monsterChoices?.some((entry: any) => entry.id === 'goo'),
    { timeout: 120_000, message: 'Native catalog discovery must publish Hunt destinations' }).toBe(true);
  const state = await live.state(true);
  const location = state.monsterChoices.find((entry: any) => entry.id === 'goo')?.locations.find((area: Location) => area.map === 'main');
  expect(location, 'The real client must publish a Goo spawn catalog').toBeTruthy();
  await live.post('/farming-mode', { character: W, mode: 'hunt', backup: { monsterFocus: ['goo'], location } });
  return location as Location;
}
function hunt(state: any) { return state.monsterHunt || state.farmingProfiles?.[W]?.monsterHunt; }

test.describe('real server, native clients, maintained character runtime', () => {
  test.setTimeout(240_000);

  test('a console character order produces real walking and observed arrival', async ({ live, page }, info) => {
    await page.goto(live.url);
    await expect(page.getByRole('heading', { name: M, exact: true })).toBeVisible();
    const before = await observed(live), destination = await point(live, M);
    await travel(live, M, destination);
    await expect.poll(async () => Math.hypot((await observed(live))[M].x-before[M].x, (await observed(live))[M].y-before[M].y), { timeout: 30_000 }).toBeGreaterThan(50);
    await arrived(live, [M], destination);
    const client = await live.clients[M].snapshot();
    expect(Math.hypot(client.x-destination.x, client.y-destination.y)).toBeLessThan(35);
    await evidence(live, info, 'walk-arrival', { before, destination, client });
  });

  test('a two-character convoy reaches the destination through real movement', async ({ live }, info) => {
    await party(live);
    const before = await observed(live), destination = await point(live, W, 350);
    await live.post('/travel', destination);
    await arrived(live, [W, P], destination);
    for (const name of [W, P]) expect(Math.hypot((await observed(live))[name].x-before[name].x, (await observed(live))[name].y-before[name].y)).toBeGreaterThan(100);
    await evidence(live, info, 'convoy-arrival', { before, destination });
  });

  test('a newer manual order wins over an already moving character route', async ({ live }, info) => {
    const before = await observed(live), first = await point(live, W, 400);
    await travel(live, W, first);
    await expect.poll(async () => Math.hypot((await observed(live))[W].x-before[W].x, (await observed(live))[W].y-before[W].y), { timeout: 30_000 }).toBeGreaterThan(35);
    const replacement = await point(live, W, 180, -1);
    await travel(live, W, replacement);
    await arrived(live, [W], replacement);
    await live.restartCoordinator();
    await arrived(live, [W], replacement);
    expect(Math.hypot((await observed(live))[W].x-first.x, (await observed(live))[W].y-first.y)).toBeGreaterThan(60);
    await evidence(live, info, 'superseding-navigation-after-restart', { first, replacement });
  });

  test('coordinator interruption during a convoy recovers the actual destination', async ({ live }, info) => {
    await party(live);
    const before = await observed(live), destination = await point(live, W, 450);
    await live.post('/travel', destination);
    await expect.poll(async () => Math.hypot((await observed(live))[W].x-before[W].x, (await observed(live))[W].y-before[W].y), { timeout: 40_000 }).toBeGreaterThan(40);
    await evidence(live, info, 'before-convoy-restart', { destination });
    await live.restartCoordinator();
    await arrived(live, [W, P], destination);
    await evidence(live, info, 'recovered-convoy-arrival', { destination });
  });

  test('a lost native follower reconnects and finishes the current convoy', async ({ live }, info) => {
    await party(live);
    const before = await observed(live), destination = await point(live, W, 450);
    await live.post('/travel', destination);
    await expect.poll(async () => Math.hypot((await observed(live))[P].x-before[P].x, (await observed(live))[P].y-before[P].y), { timeout: 40_000 }).toBeGreaterThan(30);
    await evidence(live, info, 'before-native-connection-loss', { destination });
    await live.reconnectClient(P);
    await arrived(live, [W, P], destination);
    expect((await live.clients[P].snapshot()).name).toBe(P);
    await evidence(live, info, 'native-reconnect-arrival', { destination });
  });

  test('Town executes a real cast after travel and returns both party members', async ({ live }, info) => {
    await party(live);
    const away = await point(live, W, 350);
    await live.post('/travel', away);
    await arrived(live, [W, P], away);
    const spawn = await live.admin(`output={map:'main',x:G.maps.main.spawns[0][0],y:G.maps.main.spawns[0][1],scatter:G.maps.main.spawns[0][3]||0}`);
    const beforeTown = await observed(live);
    await live.post('/town-party', {});
    await expect.poll(async () => {
      const current = await observed(live);
      // Upstream transport scatters each axis within half the configured spawn width.
      return [W, P].every(name => current[name].townAt > beforeTown[name].townAt &&
        current[name].map === spawn.map && !current[name].moving &&
        Math.abs(current[name].x-spawn.x) <= spawn.scatter/2+1 &&
        Math.abs(current[name].y-spawn.y) <= spawn.scatter/2+1);
    }, { timeout: 90_000, message: 'Both native Town casts must complete inside the actual server spawn bounds' }).toBe(true);
    await expect.poll(async () => (await live.state()).townCycle?.pending?.length || 0).toBe(0);
    await evidence(live, info, 'town-server-arrival', { away, spawn });
  });

  test('a merchant route crosses a real door into the bank and returns home', async ({ live }, info) => {
    const bank = await live.admin(`output={map:'bank',x:G.maps.bank.spawns[0][0],y:G.maps.bank.spawns[0][1]}`);
    await travel(live, M, bank);
    await arrived(live, [M], bank);
    await evidence(live, info, 'bank-door-arrival');
    // Idle merchant policy returns to this stand. Main's Town spawn is only a
    // transient arrival on that route and can be left between observations.
    const home = { map: 'main', x: -63, y: 100 };
    await travel(live, M, home);
    await arrived(live, [M], home);
    await evidence(live, info, 'bank-door-return');
  });

  test('starting Hunt in the dashboard obtains a real first quest from Daisy', async ({ live, page }, info) => {
    await party(live);
    expect((await observed(live))[W].quest).toBeNull();
    await page.goto(live.url);
    const warrior = page.locator('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
    await warrior.getByRole('button', { name: /^Farming settings .+/ }).click();
    await warrior.getByRole('button', { name: 'Hunt', exact: true }).click();
    const preparation = page.getByRole('dialog', { name: 'Getting ready to hunt', exact: true });
    await preparation.getByRole('button', { name: 'No monsters selected 0', exact: true }).click();
    await page.getByRole('checkbox', { name: /\bGoo · goo\b/ }).check();
    await page.keyboard.press('Escape');
    await preparation.locator('button[aria-pressed]').first().click();
    await preparation.getByRole('button', { name: 'Save backup and start Hunt', exact: true }).click();
    await expect(preparation).not.toBeVisible();
    await expect.poll(async () => (await observed(live))[W].quest?.c || 0, { timeout: 120_000 }).toBeGreaterThan(0);
    const result = await observed(live);
    expect(result[W].quest.id).toBeTruthy();
    await evidence(live, info, 'dashboard-hunt-real-quest', { result });
  });

  test('Hunt kills real monsters then returns to Daisy and receives a real token', async ({ live }, info) => {
    await party(live);
    await seedQuest(live, 2);
    const before = await observed(live), tokens = quantity(before[W].items, 'monstertoken');
    const backup = await startHunt(live);
    await expect.poll(async () => quantity((await observed(live))[W].items, 'monstertoken'), { timeout: 180_000, intervals: [1000] }).toBeGreaterThan(tokens);
    expect((await live.clients[W].events()).some((entry: any) => entry.event === 'hit' || entry.event === 'death')).toBe(true);
    await evidence(live, info, 'hunt-kills-and-reward', { before, backup });
  });

  test('a completed Hunt survives restart and claims its reward only once', async ({ live }, info) => {
    await party(live);
    await seedQuest(live, 0);
    const before = await observed(live), tokens = quantity(before[W].items, 'monstertoken');
    await startHunt(live);
    await live.restartCoordinator();
    await expect.poll(async () => quantity((await observed(live))[W].items, 'monstertoken'), { timeout: 120_000 }).toBe(tokens+1);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.restartCoordinator();
    expect(quantity((await observed(live))[W].items, 'monstertoken')).toBe(tokens+1);
    await evidence(live, info, 'exactly-once-hunt-reward', { before });
  });

  test('Hunt off and a new destination prevent the previous mission resuming after restart', async ({ live }, info) => {
    await party(live);
    await seedQuest(live, 20);
    await startHunt(live);
    await expect.poll(async () => !!hunt(await live.state())).toBe(true);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    const destination = await point(live, W, 250, -1);
    await live.post('/travel', destination);
    await live.restartCoordinator();
    await arrived(live, [W, P], destination);
    expect(hunt(await live.state())).toBeFalsy();
    await evidence(live, info, 'hunt-off-manual-ownership', { destination });
  });

  for (const restart of [false, true]) {
    test(`Goobrawl interrupts Hunt and real event evacuation resumes it${restart ? ' across coordinator restart' : ''}`, async ({ live }, info) => {
      test.setTimeout(360_000);
      const encounter = await seedSmallGoobrawl(live);
      await info.attach('goobrawl-initial-encounter', { body: JSON.stringify(encounter), contentType: 'application/json' });
      await party(live);
      await seedQuest(live, 30);
      await startHunt(live);
      await live.post('/formation', { character: W, eventSelections: ['goobrawl'] });
      await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
      await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='goobrawl'); }, { timeout: 90_000 }).toBe(true);
      let survivors: {id:string;type:string;hp:number}[]=[];
      await expect.poll(async()=>{
        survivors=await live.admin(`output=Object.values(instances.goobrawl.monsters).map(m=>({id:m.id,type:m.type,hp:m.hp}))`);
        return survivors.length;
      },{timeout:30_000,intervals:[100,250],message:'Native arena spawning must provide a real combat encounter after entry'}).toBeGreaterThan(0);
      await evidence(live, info, 'inside-live-goobrawl');
      if (restart) await live.restartCoordinator();
      await live.admin(`timers.goobrawl=new Date(0);output=true`);
      // Timer expiry leaves native survivors to kill before the ended-event
      // grace period and real transporter evacuation can begin.
      await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='main'); }, { timeout: 180_000 }).toBe(true);
      const combat = (await Promise.all([W,P].map(name => live.clients[name].events()))).flat();
      expect(combat.some((event: any) => survivors.some((monster: any) => String(monster.id) === String(event.data?.id)) &&
        (event.event === 'death' || event.event === 'hit' && event.data?.kill)), 'Native clients must kill an observed event monster').toBe(true);
      await expect.poll(async () => { const state=hunt(await live.state());return !!state && state.stage!=='paused-event'; }, { timeout: 60_000 }).toBe(true);
      const afterExit = (await observed(live))[W];
      await expect.poll(async () => {
        const current = (await observed(live))[W];
        return current.map === 'main' && ((current.quest?.id === afterExit.quest?.id &&
          current.quest?.c < afterExit.quest?.c) ||
          quantity(current.items, 'monstertoken') > quantity(afterExit.items, 'monstertoken'));
      }, { timeout: 150_000, message: 'Hunt must execute real combat or turn-in after leaving the event' }).toBe(true);
      await evidence(live, info, 'live-event-hunt-handback', { restart, survivors, afterExit });
    });
  }

  for (const joining of [true, false]) {
  test(`Hunt off ${joining ? 'as soon as the leader joins' : 'after the party joins'} a real event preserves evacuation without reviving Hunt`, async ({ live }, info) => {
    const encounter = await seedSmallGoobrawl(live);
    await info.attach('goobrawl-initial-encounter', { body: JSON.stringify(encounter), contentType: 'application/json' });
    await party(live);
    await seedQuest(live, 30);
    await startHunt(live);
    await live.post('/formation', { character: W, eventSelections: ['goobrawl'] });
    await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
    await expect.poll(async () => { const state=await observed(live);return (joining ? [W] : [W,P]).every(name=>state[name].map==='goobrawl'); }, { timeout: 90_000 }).toBe(true);
    const atCancellation = await observed(live);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    // Cancelling Hunt must preserve the already-authorized party event entry.
    await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='goobrawl'); }, { timeout: 90_000 }).toBe(true);
    await live.admin(`timers.goobrawl=new Date(0);output=true`);
    await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='main'); }, { timeout: 120_000 }).toBe(true);
    expect(hunt(await live.state())).toBeFalsy();
    await evidence(live, info, 'event-exit-with-hunt-off', { joining, atCancellation });
  });
  }

  test.describe('fragile loadout death recovery', () => {
  test.use({loadout:'fragile'});
  test('a real character death is observed and the maintained runtime respawns it', async ({ live }, info) => {
    const fault = await killNativeCharacter(live, W);
    await expect.poll(async () => (await observed(live))[W].rip, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => { const p=(await observed(live))[W];return !p.rip&&p.hp>0; }, { timeout: 120_000 }).toBe(true);
    await expect.poll(async () => (await live.clients[W].snapshot()).rip,
      {timeout:15_000,message:'The real revival must propagate from the server to the native client'}).toBeFalsy();
    await evidence(live, info, 'real-death-and-respawn', { fault });
  });
  });

  test('a merchant delivery transfers one real item without creating or losing copies', async ({ live }, info) => {
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { deliveries: true } });
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(M)});p.items[10]={name:'helmet',level:0};cache_player_items(p);resend(p,'u+cid+reopen');return p.items[10]})()`);
    await expect.poll(async () => (await live.state()).characters[M]?.items?.some((entry: any) => entry?.slot===10 && entry.item?.name==='helmet'), { timeout: 20_000 }).toBe(true);
    const before=await observed(live), total=names.reduce((sum,name)=>sum+quantity(before[name].items,'helmet'),0);
    await live.post('/command', { character:M,type:'give',target:W,slot:10,item:{name:'helmet',level:0} });
    await expect.poll(async()=>quantity((await observed(live))[W].items,'helmet'),{timeout:120_000}).toBe(quantity(before[W].items,'helmet')+1);
    const after=await observed(live);
    expect(names.reduce((sum,name)=>sum+quantity(after[name].items,'helmet'),0)).toBe(total);
    const completed = async () => { const state = await live.state(); return !state.merchantCurrent && !state.merchantQueue?.length && !state.merchantDeliveries?.[W]?.length; };
    await expect.poll(completed, { timeout: 30_000, message: 'The actual delivery must complete its durable job' }).toBe(true);
    await live.restartCoordinator();
    await expect.poll(completed, { timeout: 30_000 }).toBe(true);
    const restored=await observed(live);
    expect(names.reduce((sum,name)=>sum+quantity(restored[name].items,'helmet'),0)).toBe(total);
    await evidence(live,info,'conserved-live-delivery',{before,after});
  });
});
