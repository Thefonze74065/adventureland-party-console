import { expect, type TestInfo } from '@playwright/test';
import type { LiveGame } from '../live-fixtures';
import { farmingAreas } from '../../dashboard/lib/farming-areas';

export const warrior = 'E2EWarrior', priest = 'E2EPriest';
export const fighters = [warrior, priest];
export async function world(live: LiveGame) {
  return live.admin(`output=Object.fromEntries(${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip,xp:p.xp,items:p.items,quest:p.s.monsterhunt||null}]}))`);
}
export const tokens = (player: any): number => player.items.reduce((sum: number, item: any) => sum + (item?.name === 'monstertoken' ? item.q || 1 : 0), 0);
export function profile(state: any, name = warrior) { return state.farmingProfiles?.[name] || state; }
export async function location(live: LiveGame, monster = 'goo') {
  await expect.poll(async () => (await live.state(true)).monsterChoices?.some((entry: any) => entry.id === monster), { timeout: 90_000 }).toBe(true);
  // The dashboard/API selects merged farming areas; raw overlapping spawn
  // centers are not necessarily valid backup choices (notably native Bees).
  const locations = farmingAreas((await live.state(true)).monsterChoices, [monster]);
  return locations.find((entry: any) => entry.map === 'main') || locations[0];
}
export async function party(live: LiveGame) {
  await live.post('/formation', { leader: warrior });
  await live.post('/formation', { character: priest, follow: true });
}
/** Seed only initial quest conditions; native timer/kills/claims execute thereafter. */
export async function quests(live: LiveGame, info: TestInfo, entries: Record<string, { id?: string; count: number; ms?: number }>) {
  const seeded = await live.admin(`output=Object.entries(${JSON.stringify(entries)}).map(([name,q])=>{const p=get_player(name);p.s.monsterhunt={sn:region+' '+server_name,id:q.id||'goo',c:q.count,ms:q.ms||1800000};resend(p,'u+cid+reopen');return {name,quest:p.s.monsterhunt}})`);
  await info.attach('hunt-initial-quests', { body: JSON.stringify(seeded), contentType: 'application/json' });
  await expect.poll(async () => {
    const state = await live.state();
    return Object.entries(entries).every(([name, q]) => state.characters[name]?.monsterHunt?.count === q.count);
  }, { timeout: 20_000 }).toBe(true);
}
export async function start(live: LiveGame, name = warrior, monster = 'goo') {
  const destination = await location(live, monster);
  expect(destination).toBeTruthy();
  await live.post('/farming-mode', { character: name, mode: 'hunt', backup: { monsterFocus: [monster], location: destination } });
  return destination;
}
export async function artifact(live: LiveGame, info: TestInfo, label: string, detail: unknown = {}) {
  await info.attach(label, { body: JSON.stringify({ detail, server: await world(live), coordinator: await live.state(),
    nativeEvents: Object.fromEntries(await Promise.all(fighters.map(async name => [name, await live.clients[name].events()]))) }, null, 2), contentType: 'application/json' });
}
export async function rejected(live: LiveGame, route: string, body: unknown) {
  const response = await fetch(live.url + '/party-api' + route, { method: 'POST', headers: { 'content-type': 'application/json', origin: live.url }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
