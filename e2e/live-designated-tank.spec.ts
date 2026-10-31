import { test, expect } from './live-fixtures';
import { warrior as R, location } from './game/hunt-lifecycle';

test.use({ primaryClass: 'ranger' });

// Issue #39 adds a per-party tank designation, independent of class. Since 2026-10-25 the
// tank keeps its own attack range and holds by not kiting its target, so a ranger tank
// stays at long range instead of walking into the pack (tankHoldsTarget in shared.js).
test('designated tank persists through restart, renders in the dashboard, and holds its own range for a ranged class', async ({ page, live }, info) => {
  test.setTimeout(240_000);
  try {
    expect(await live.clients[R].run('character.ctype')).toBe('ranger');
    await live.post('/formation', { leader: R, tank: R });
    await expect.poll(async () => (await live.state()).designatedTank).toBe(R);

    await page.goto(live.url);
    // The Tank picker sits in the dialog each card's Farming settings gear button opens.
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: R, exact: true }) });
    const settings = card.getByRole('button', { name: 'Farming settings', exact: true });
    const tankLabel = page.getByRole('dialog', { name: /^Farming settings/ }).getByRole('group', { name: 'Party roles' })
      .locator('label').filter({ hasText: /^Tank/ });
    await settings.click();
    await expect(tankLabel).toContainText(R);
    await info.attach('tank-dashboard-before-restart', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).designatedTank).toBe(R);
    await page.reload();
    await settings.click();
    await expect(tankLabel).toContainText(R);

    await live.post('/farming-mode', { character: R, mode: 'default' });
    await live.post('/focus', { character: R, monsterFocus: ['goo'] });
    const destination = await location(live);
    await live.post('/travel', destination);

    // Read the mode and the distance in one evaluation: a moving goo changes both.
    let engaged: { isTank: boolean; range: number; mode: string | null; inRange: boolean; distance: number | null } | undefined;
    await expect.poll(async () => {
      engaged = await live.clients[R].run(
        `(() => { const p = globalThis.partyCombatPosition, e = p?.target && get_entity(p.target);
          return {isTank: !!sharedRoutine.isTank?.(), range: character.range, mode: p?.mode || null, inRange: !!(e && is_in_range(e)),
            distance: e ? Math.hypot(character.x - e.x, character.y - e.y) : null}; })()`,
      );
      return engaged!.isTank && engaged!.inRange && !['kiting', 'escaping'].includes(engaged!.mode || '');
    }, { timeout: 120_000, intervals: [500, 1000], message: 'The designated ranger tank must hold its target in range without kiting' }).toBe(true);
    await info.attach('tank-range-hold', { body: JSON.stringify(engaged), contentType: 'application/json' });
  } finally {
    await page.close();
  }
});
