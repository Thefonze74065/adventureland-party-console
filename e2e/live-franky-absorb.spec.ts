import { test, expect } from './live-fixtures';

const W = 'E2EWarrior', P = 'E2EPriest';

// Failure inventory: e2e/boss-absorb-failures.md. Live, an off-tank priest that was
// also the party's designated tank kept casting Absorb Sins at Franky, pulled the
// Mummies attacking the fighters onto itself and died every 30-40 s. At a boss only the
// encounter's tank may absorb.
test('a designated-tank priest set to off-tank never pulls Franky\'s adds off the fighter; set to tank it does', async ({ live }, info) => {
  test.setTimeout(300_000);
  const world = () => live.admin(`output=(()=>{const p=get_player('${P}'),w=get_player('${W}');
    const adds=Object.values(instances.level2w?.monsters||{}).filter(m=>m.e2eAbsorb).map(m=>({id:m.id,target:m.target,hp:m.hp,x:m.x,y:m.y}));
    return {boss:!!get_monster('franky'),adds,priest:{map:p.map,x:p.x,y:p.y,rip:!!p.rip},warrior:{map:w.map,x:w.x,y:w.y,rip:!!w.rip}}})()`);
  const seed = await live.admin(`output=(()=>{
    if(events.franky || get_monster('franky')) throw Error('Franky needs a clean baseline');
    // Harmless and passive (as live-franky-party.spec.ts): no range or aggro, so he
    // targets nobody and off-tanks wait together in the safe corner. No native adds:
    // the test spawns its own.
    const initial={attack:1,spawns:[],range:0,charge:0,speed:0,aggro:0};
    globalThis.__e2eFrankyDefinition=Object.fromEntries(Object.keys(initial).map(key=>[key,G.monsters.franky[key]]));
    Object.assign(G.monsters.franky,initial);
    globalThis.__e2eFrankyBoundary=G.maps.level2w.monsters[0].boundary.slice();
    G.maps.level2w.monsters[0].boundary=[-529,-185,-527,-183];
    events.franky=true;delete timers.franky;
    return {initial,scope:'Absorb Sins ownership at a boss'};
  })()`);
  await info.attach('franky-absorb-seed', { body: JSON.stringify(seed), contentType: 'application/json' });
  await expect.poll(async () => (await world()).boss, { timeout: 30_000, message: 'A passive Franky must spawn' }).toBe(true);

  // As live: the priest is the party's designated tank (what made it absorb) and
  // follows the leader, so it is in the game party (the server only lets Absorb Sins
  // work on party members) and takes the leader's encounter routine and events.
  await live.post('/formation', { leader: W, tank: P });
  await live.post('/formation', { character: P, follow: true });
  await expect.poll(async () => (await live.state()).designatedTank).toBe(P);
  await live.post('/encounter-mode', { character: W, encounter: 'franky', mode: 'offtank' });
  await live.post('/formation', { character: W, eventSelections: ['franky'] });
  await expect.poll(async () => { const w = await world(); return w.warrior.map === 'level2w' && w.priest.map === 'level2w'; },
    { timeout: 90_000, message: 'Both characters must enter the live Franky instance' }).toBe(true);
  // Both settle in the safe corner, within Absorb Sins range of each other.
  await expect.poll(async () => { const w = await world(); return Math.hypot(w.warrior.x - w.priest.x, w.warrior.y - w.priest.y); },
    { timeout: 60_000, message: 'The off-tanks must gather in the safe corner' }).toBeLessThan(150);

  // Franky's adds, harmless, natively spawned beside the warrior and attacking it.
  const adds = await live.admin(`output=(()=>{
    const w=get_player('${W}'),original=G.monsters.nerfedmummy,spawned=[];
    try {
      G.monsters.nerfedmummy={...original,attack:1,hp:100000};
      for(let i=0;i<3;i++){
        const a=i*2*Math.PI/3,x=w.x+40*Math.cos(a),y=w.y+40*Math.sin(a);
        const m=new_monster(w.in,{type:'nerfedmummy',count:1,boundary:[x,y,x+1,y+1]},{temp:1});
        m.e2eAbsorb=true;target_player(m,w);spawned.push({id:m.id,target:m.target});
      }
    } finally {G.monsters.nerfedmummy=original;}
    return spawned;
  })()`);
  await info.attach('franky-absorb-adds', { body: JSON.stringify(adds), contentType: 'application/json' });
  await expect.poll(async () => (await world()).adds.filter((a: any) => a.target === W).length, { timeout: 15_000 }).toBe(3);

  // Off-tank: for 30 s the priest pulls none of the adds onto itself.
  const offtank: any[] = [];
  for (const until = Date.now() + 30_000; Date.now() < until;) {
    const w = await world();
    offtank.push(w);
    expect(w.adds.some((a: any) => a.target === P), 'An off-tank priest must not absorb the adds attacking the fighter').toBe(false);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await info.attach('franky-absorb-offtank', { body: JSON.stringify(offtank), contentType: 'application/json' });

  // Control: with the party's routine set to tank, the same priest absorbs them, so the
  // check above would have seen an absorb.
  await live.post('/encounter-mode', { character: W, encounter: 'franky', mode: 'tank' });
  await expect.poll(async () => (await world()).adds.some((a: any) => a.target === P), { timeout: 60_000,
    message: 'With the tank routine the priest must take the adds with Absorb Sins' }).toBe(true);
  await info.attach('franky-absorb-tank', { body: JSON.stringify(await world()), contentType: 'application/json' });
});
