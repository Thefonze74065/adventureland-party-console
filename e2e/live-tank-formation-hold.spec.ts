import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, location } from './game/hunt-lifecycle';

// Failure inventory: e2e/tank-formation-hold-failures.md (PR #2, #39). Declared inputs:
// one goo with raised HP and zeroed damage that attacks the tank, so the fight lasts the
// whole observation. Formation, tank movement, range and attacks are native.
const M = 'E2EBankBoi';
test.use({ loadout: 'combat-range', extraFighter: 'mage' });

for (const tank of [W, P]) {
  test(`${tank === W ? 'a warrior' : 'a priest'} tank holds its target inside a priest formation`, async ({ live }, info) => {
    test.setTimeout(300_000);
    const samples: any[] = [];
    try {
      await live.post('/formation', { leader: W, tank });
      for (const name of [P, M]) await live.post('/formation', { character: name, follow: true });
      await expect.poll(async () => (await live.state()).designatedTank).toBe(tank);
      await live.post('/farming-mode', { character: W, mode: 'default' });
      await live.post('/focus', { character: W, monsterFocus: ['goo'] });
      const farm = await location(live);
      await live.post('/travel', farm);
      // Spawn only once the party has arrived: at login it already stands together, and a goo
      // spawned there would be left behind town buildings when the party walks to the farm.
      await expect.poll(async () => live.admin(`output=(()=>{const ps=${JSON.stringify([W, P, M])}.map(get_player),f=${JSON.stringify(farm)};
        return ps.every(p=>p.map===f.map&&!p.moving&&Math.hypot(p.x-f.x,p.y-f.y)<300)&&ps.every(p=>Math.hypot(p.x-ps[0].x,p.y-ps[0].y)<250);})()`), { timeout: 120_000 }).toBe(true);
      const goo = await live.admin(`output=(()=>{const t=get_player('${tank}');
        const m=new_monster(t.in,{type:'goo',position:[t.x+120,t.y],radius:0,count:1},{temp:1});
        m.hp=m.max_hp=5000000;m.attack=0;target_player(m,t);return String(m.id);})()`);
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const [t, mage] = await Promise.all([tank, M].map(name => live.clients[name].run(`(() => { const p = globalThis.partyCombatPosition,
          e = parent.entities[${JSON.stringify(goo)}];
          const own = p && p.target && parent.entities[p.target];
          return { mode: p && p.mode, reason: p && p.reason, target: p && p.target != null ? String(p.target) : null,
            distance: e ? Math.hypot(character.x - e.x, character.y - e.y) : null,
            ownDistance: own ? Math.hypot(character.x - own.x, character.y - own.y) : null,
            at: { x: Math.round(character.real_x), y: Math.round(character.real_y) }, ownAt: own ? { x: Math.round(own.x), y: Math.round(own.y) } : null,
            inRange: !!(e && is_in_range(e)), ownInRange: !!(own && is_in_range(own)) }; })()`)));
        samples.push({ at: Date.now(), tank: t, mage });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      // Natural goos share the farm, so measure each fighter against its own selected target.
      const engaged = samples.filter(s => s.tank.target != null);
      expect(engaged.length, 'The party must be fighting').toBeGreaterThan(20);
      // 1, 2: the tank holds for most of the fight: its target in its own range, not kiting.
      const holding = engaged.filter(s => s.tank.ownInRange && !['kiting', 'escaping'].includes(s.tank.mode));
      expect(holding.length, 'The tank must hold for most of the fight').toBeGreaterThan(engaged.length / 2);
      // 3: the mage reaches range of its target.
      expect(engaged.filter(s => s.mage.ownInRange).length, 'The mage must spend most of the fight in range').toBeGreaterThan(engaged.length / 2);
    } finally {
      await info.attach('tank-formation-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    }
  });
}
