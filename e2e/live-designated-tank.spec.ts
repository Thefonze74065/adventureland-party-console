import { test, expect } from './live-fixtures';
import { warrior as R, location } from './game/hunt-lifecycle';

test.use({ primaryClass: 'ranger' });

// Issue #39 adds a per-party tank designation, independent of class. A ranger's own
// weapon range is long, so a designated ranger tank closing to near-melee distance
// against a live target (rather than holding at its own attack range like ordinary
// combat) is the real proof that tankMovementTick's class-agnostic melee-stack clamp
// is wired end to end, not just that a warrior happens to already fight in melee.
test('designated tank persists through restart, renders in the dashboard, and holds melee range for a ranged class', async ({ page, live }, info) => {
  test.setTimeout(240_000);
  try {
    expect(await live.clients[R].run('character.ctype')).toBe('ranger');
    await live.post('/formation', { leader: R, tank: R });
    await expect.poll(async () => (await live.state()).designatedTank).toBe(R);

    await page.goto(live.url);
    const tankLabel = page.locator('label').filter({ hasText: 'Tank' });
    await expect(tankLabel).toContainText(R);
    await info.attach('tank-dashboard-before-restart', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).designatedTank).toBe(R);
    await page.reload();
    await expect(tankLabel).toContainText(R);

    await live.post('/farming-mode', { character: R, mode: 'default' });
    await live.post('/focus', { character: R, monsterFocus: ['goo'] });
    const destination = await location(live);
    await live.post('/travel', destination);

    // "tank-approaching" fires the instant a move command is issued, well before arrival;
    // wait specifically for "tank-holding" so the distance check below reflects having
    // actually closed to melee range, not an in-flight walk toward a still-distant target.
    await expect.poll(async () => {
      const client = await live.clients[R].run(
        '({isTank: sharedRoutine.isTank?.(), mode: globalThis.partyCombatPosition?.mode || null})',
      );
      return client.isTank && client.mode;
    }, { timeout: 120_000, intervals: [500, 1000], message: 'The designated ranger tank must reach tank-holding once in melee range' }).toBe('tank-holding');

    const engaged = await live.clients[R].run(
      `({range: character.range, mode: globalThis.partyCombatPosition?.mode || null,
        distance: globalThis.partyCombatPosition?.target && get_entity(globalThis.partyCombatPosition.target)
          ? Math.hypot(character.x - get_entity(globalThis.partyCombatPosition.target).x, character.y - get_entity(globalThis.partyCombatPosition.target).y)
          : null})`,
    );
    await info.attach('tank-melee-override', { body: JSON.stringify(engaged), contentType: 'application/json' });
    expect(engaged.distance).not.toBeNull();
    // tankMovementTick holds at a near-melee clamp (desiredCombatRange() capped to 30), but
    // combatDistance() is hitbox-adjusted while this raw center-to-center hypot is not, so the
    // bound here is deliberately generous — the point is "near melee," not an exact number.
    // A ranger's own range (869 in this live run) makes the contrast unmistakable either way.
    expect(engaged.distance).toBeLessThanOrEqual(100);
    expect(engaged.distance).toBeLessThan(engaged.range / 2);
  } finally {
    await page.close();
  }
});
