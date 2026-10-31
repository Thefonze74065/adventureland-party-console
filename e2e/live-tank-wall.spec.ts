import { test, expect } from './live-fixtures';
import { W, P } from './hunt-interruption-helpers';

// Failure inventory: e2e/tank-wall-failures.md. Uses the level1 blockage from
// live-hunt-multi-corner.spec.ts: (-11,115) is across native terrain from the start.
// Declared inputs: level1's natural monsters removed and one stationary prat (10M HP,
// no damage) placed there, attacking the tank. Formation, tank movement and range are native.
test.use({ loadout: 'combat-range', initialPosition: { map: 'level1', x: 0, y: 395.76 } });

for (const tank of [W, P]) {
  test(`${tank === W ? 'a warrior' : 'a priest'} tank routes around a wall to hold its target`, async ({ live }, info) => {
    test.setTimeout(240_000);
    const samples: any[] = [];
    let seed: any;
    try {
      await live.post('/merchant/force-stand', { enabled: true });
      expect(await live.clients[tank].run('!can_move_to(-11,115)'), 'The target must be across native terrain').toBe(true);
      await live.admin(`output=(()=>{for(const m of Object.values(instances.level1.monsters))remove_monster(m,{method:'disappear',nospawn:true});
        for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='level1')monster_respawns.splice(i,1);return true;})()`);
      await live.post('/formation', { leader: W, tank });
      await live.post('/formation', { character: P, follow: true });
      // No planned target: the prat reaches the tank only as an attacker (the defensive path),
      // so the independent approach that routes planned targets around terrain does not run.
      await live.post('/focus', { monsterFocus: ['goo'] });
      await live.post('/farming-mode', { character: W, mode: 'default' });
      seed = await live.admin(`output=(()=>{const original=G.monsters.prat;globalThis.__tankWallOriginal=original;G.monsters.prat={...original,stationary:true};
        const m=new_monster('level1',{type:'prat',count:1,position:[-11,115],radius:0},{temp:1});m.speed=0;m.moving=false;m.attack=0;
        m.hp=m.max_hp=10000000;target_player(m,get_player(${JSON.stringify(tank)}));return {id:String(m.id),at:Date.now()};})()`);
      await info.attach('declared-prat', { body: JSON.stringify(seed), contentType: 'application/json' });
      // 1, 2: within a minute the tank is holding the prat: in its own attack range and not kiting.
      await expect.poll(async () => {
        const sample = await live.clients[tank].run(`(() => { const p = globalThis.partyCombatPosition, e = parent.entities[${JSON.stringify(seed.id)}];
          return { at: Date.now(), mode: p && p.mode, reason: p && p.reason, x: character.real_x, y: character.real_y,
            inRange: !!(e && is_in_range(e)), distance: e ? Math.hypot(character.real_x - e.x, character.real_y - e.y) : null }; })()`);
        samples.push(sample);
        return sample.inRange && !['kiting', 'escaping'].includes(sample.mode);
      }, { timeout: 60_000, intervals: [1000], message: 'The tank must route around the wall and hold its target in range' }).toBe(true);
      for (const name of [W, P]) expect(await live.clients[name].run('character.rip')).toBeFalsy();
    } finally {
      await info.attach('tank-wall-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
      await live.admin(`output=(()=>{const m=instances.level1.monsters[${JSON.stringify(seed?.id)}];if(m)remove_monster(m,{silent:true});
        if(globalThis.__tankWallOriginal)G.monsters.prat=globalThis.__tankWallOriginal;return true;})()`).catch(() => {});
    }
  });
}
