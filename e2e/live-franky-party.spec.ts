import { test, expect } from './live-fixtures';
import { killNativeCharacter } from './hunt-interruption-helpers';

const W = 'E2EWarrior', P = 'E2EPriest', members = [W, P];

// Failure inventory: deselection must revoke voluntary boss combat, install
// both exit owners, and leave the map without waiting for the living boss to die.
test.use({ loadout: 'fragile' });

test('disabling inherited Franky interrupts native boss combat and evacuates both participants', async ({ live }, info) => {
  test.setTimeout(480_000);
  const world = () => live.admin(`output={live:!!E.franky?.live,boss:!!get_monster('franky'),bossHp:get_monster('franky')?.hp,
    players:Object.fromEntries(${JSON.stringify(members)}.map(name=>{const p=get_player(name);
      return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))}`);
  await live.post('/formation', { leader: W });
  await live.post('/formation', { character: P, follow: true });
  const seed = await live.admin(`output=(()=>{
    if(events.franky || get_monster('franky')) throw Error('Franky needs a clean baseline');
    const initial={attack:1,spawns:[],range:0,charge:0,speed:0,aggro:0};
    globalThis.__e2eFrankyDefinition=Object.fromEntries(Object.keys(initial).map(key=>[key,G.monsters.franky[key]]));
    Object.assign(G.monsters.franky,initial);
    globalThis.__e2eFrankyBoundary=G.maps.level2w.monsters[0].boundary.slice();
    G.maps.level2w.monsters[0].boundary=[-529,-185,-527,-183];
    events.franky=true;delete timers.franky;
    return {original:globalThis.__e2eFrankyDefinition,initial,
      originalBoundary:globalThis.__e2eFrankyBoundary,initialBoundary:G.maps.level2w.monsters[0].boundary,
      scope:'native visible-boss combat, deselection, exit ownership and actual Mainland evacuation'};
  })()`);
  await info.attach('franky-party-initial-encounter', { body: JSON.stringify(seed), contentType: 'application/json' });
  await expect.poll(async () => (await world()).boss, { timeout: 30_000 }).toBe(true);
  const initialBossHp=(await world()).bossHp;
  await live.post('/formation', { character: W, eventSelections: ['franky'] });
  await expect.poll(async () => {
    const server = await world();
    return server.live && server.boss && members.every(name => server.players[name].map === 'level2w');
  }, { timeout: 120_000, message: 'Both actual game clients must enter the living Franky instance' }).toBe(true);
  await expect.poll(async () => {
    const state = await live.state();
    return members.every(name => state.characters[name]?.map === 'level2w' &&
      state.characters[name]?.joinedEvent === 'franky');
  }, { timeout: 30_000, message: 'Both native participation reports must reach the coordinator' }).toBe(true);
  await expect.poll(async()=>(await world()).bossHp,{timeout:90_000,message:'Real visible Franky combat must damage the living boss before deselection'}).toBeLessThan(initialBossHp);
  await expect.poll(async()=>{
    const state=await live.state();
    return members.some(name=>state.characters[name]?.target?.mtype==='franky'&&state.characters[name]?.activeCombatTarget);
  },{timeout:15_000,message:'At least one native fighter must still own active boss combat'}).toBeTruthy();
  // Initial completed native quests reproduce enabling/resuming Hunt during a
  // living event. Quest preparation must not seize protected Daisy travel.
  await live.admin(`output=${JSON.stringify(members)}.map(name=>{const p=get_player(name);p.s.monsterhunt={sn:region+' '+server_name,id:'goo',c:0,ms:1800000};resend(p,'u+cid+reopen');return p.s.monsterhunt})`);
  await expect.poll(async () => (await live.state()).characters[W]?.monsterHunt?.count).toBe(0);
  await expect.poll(async () => (await live.state(true)).monsterChoices?.some((choice: any) => choice.id === 'goo')).toBe(true);
  const goo = (await live.state(true)).monsterChoices.find((choice: any) => choice.id === 'goo');
  await live.post('/farming-mode', { character: W, mode: 'hunt', backup: { monsterFocus: ['goo'], location: goo.locations.find((location: any) => location.map === 'main') } });
  await expect.poll(async () => (await live.state()).monsterHunt?.stage, { timeout: 15_000 }).toBe('paused-event');
  // One lost permission response after native death must retain the recovery
  // intent. Normal polling also uses this route, so fault only after death.
  let denied = false, holdPermission = true;
  const context = live.clients[W].page.context();
  const permission = '**/hunt-event-permission';
  await context.route(permission, async route => {
    if (holdPermission) { denied = true; await route.abort('failed'); }
    else await route.continue();
  });
  const death = await killNativeCharacter(live, W);
  await expect.poll(async () => (await live.state()).characters[W]?.combat?.runner?.recovery?.lastError,
    { timeout: 90_000, message: 'A lost permission reply must publish retryable event recovery' }).toBe('Waiting for event travel permission');
  holdPermission = false;
  await expect.poll(async () => {
    const server = await world(), state = await live.state();
    return denied && !server.players[W].rip && server.players[W].map === 'level2w' &&
      state.characters[W]?.joinedEvent === 'franky' && state.monsterHunt?.stage === 'paused-event' &&
      !state.monsterHunt?.turnIn;
  }, { timeout: 120_000, message: 'Native respawn must rejoin the living boss without a Daisy return or manual retry' }).toBe(true);
  await context.unroute(permission);
  await info.attach('hunt-event-native-death-reentry', { body: JSON.stringify({ death, denied, server: await world(), coordinator: await live.state() }), contentType: 'application/json' });
  await live.post('/farming-mode', { character: W, mode: 'default' });
  const before = { server: await world(), coordinator: await live.state() };
  expect(before.server.bossHp).toBeGreaterThan(0);
  await info.attach('franky-party-before-disable', { body: JSON.stringify(before), contentType: 'application/json' });
  await live.post('/formation', { character: W, eventSelections: [] });
  await expect.poll(async () => [...((await live.state()).eventReturn?.participants || [])].sort(),
    { timeout: 15_000, message: 'One deselection must admit both real participants into the same recovery' }).toEqual([...members].sort());
  const recovery = (await live.state()).eventReturn;
  expect([...recovery.pending].sort()).toEqual([...members].sort());
  expect(recovery.event).toBe('franky');
  expect(recovery.exitConvoyId).toBeTruthy();
  // These are native runtime reports received through the normal /status route,
  // not coordinator command labels or fixture acknowledgements.
  await expect.poll(async () => {
    const state = await live.state(), convoy = state.activeConvoy;
    if (convoy?.id !== recovery.exitConvoyId || convoy.purpose !== 'franky-exit') return false;
    return members.every(name => {
      const report = state.characters[name]?.convoyNavigation, expected = convoy.expected?.[name];
      return report?.id === convoy.id && report.epoch === convoy.epoch &&
        Number(report.commandId) > 0 && report.navigationRevision === expected?.revision &&
        !!report.runtimeId;
    });
  }, { timeout: 30_000, message: 'Both maintained native clients must report the issued exit convoy ownership' }).toBe(true);
  const admitted = { server: await world(), coordinator: await live.state() };
  expect(admitted.server.live && admitted.server.boss).toBe(true);
  expect(admitted.coordinator.eventSelectionsByCharacter[W]).not.toContain('franky');
  expect(admitted.coordinator.followers[P]).toBe(true);
  await info.attach('franky-party-native-evacuation-admission', {
    body: JSON.stringify({ recovery, admitted }, null, 2), contentType: 'application/json',
  });
  // This fragile party walks through multiple native maps at speed 54. Require
  // departure promptly, then budget the cross-map trip and bounded recovery
  // separately; a single 120-second clock conflated both on loaded runners.
  await expect.poll(async()=>{
    const server=await world();
    return members.every(name=>server.players[name].map!=='level2w'&&!server.players[name].rip);
  },{timeout:90_000,message:'Both native fighters must leave the living Franky instance'}).toBe(true);
  await expect.poll(async()=>{
    const server=await world();
    return members.every(name=>server.players[name].map==='main'&&!server.players[name].rip);
  },{timeout:180_000,message:'Both native fighters must finish the cross-map Mainland evacuation while Franky remains alive'}).toBe(true);
  const evacuated={server:await world(),coordinator:await live.state()};
  expect(evacuated.server.live&&evacuated.server.boss&&evacuated.server.bossHp>0).toBe(true);
  await info.attach('franky-party-native-evacuation-complete',{body:JSON.stringify(evacuated),contentType:'application/json'});
});
