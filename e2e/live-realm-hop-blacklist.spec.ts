import { test, expect } from './live-fixtures';

// Failure inventory: e2e/realm-hop-blacklist-failures.md. Chase choices need live
// ALData sightings, which this server cannot reach; scripts/tests/realm-hop-blacklist
// drives those. This journey covers the real control, validation and persistence.
test('the realm-hop blacklist is edited in the dashboard, validated and kept across restart', async ({ live, page }, info) => {
  test.setTimeout(240_000);
  const label = (key: string) => key.replace(/^SR_/, '').replace(/(US|EU|ASIA)/, '$1 ');
  const openSettings = async () => {
    await page.goto(live.url);
    const settings = page.getByRole('dialog', { name: 'Interface settings' });
    // A click before the console hydrates is lost; retry until the dialog is open.
    await expect(async () => {
      if (!await settings.isVisible()) await page.getByRole('button', { name: 'Interface settings', exact: true }).click();
      await expect(settings).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    return settings;
  };
  try {
    await expect.poll(async () => (await live.state()).realmControl?.realms?.length || 0, { timeout: 60_000 }).toBeGreaterThan(0);
    const realms: { key: string; pvp: boolean }[] = (await live.state()).realmControl.realms;
    const target = realms.find(realm => !realm.pvp)!;
    expect(target, 'The server must offer a non-PVP realm').toBeTruthy();
    let settings = await openSettings();
    const row = settings.getByRole('checkbox', { name: `Never hop to ${label(target.key)}` });
    await expect(row).not.toBeChecked();
    await row.click();
    await expect(row).toBeChecked({ timeout: 15_000 });
    await expect.poll(async () => (await live.state()).realmHopBlacklist).toEqual([target.key]);
    for (const pvp of realms.filter(realm => realm.pvp)) {
      const locked = settings.getByRole('checkbox', { name: `Never hop to ${label(pvp.key)}` });
      await expect(locked).toBeChecked();
      await expect(locked).toBeDisabled();
    }
    await info.attach('realm-hop-blacklist-checked', { body: await page.screenshot(), contentType: 'image/png' });

    await expect(live.post('/realm/hop-blacklist', { realms: ['SR_NOWHERE'] })).rejects.toThrow(/unknown Adventure Land realm/);
    await expect(live.post('/realm/hop-blacklist', { realms: [target.key, target.key] })).rejects.toThrow(/must not repeat/);
    expect((await live.state()).realmHopBlacklist, 'A rejected edit must leave the saved list unchanged').toEqual([target.key]);

    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).realmHopBlacklist, { timeout: 30_000 }).toEqual([target.key]);
    settings = await openSettings();
    const restored = settings.getByRole('checkbox', { name: `Never hop to ${label(target.key)}` });
    await expect(restored).toBeChecked();
    await info.attach('realm-hop-blacklist-after-restart', { body: await page.screenshot(), contentType: 'image/png' });
    // The dashboard may reload once after a coordinator restart and close the dialog.
    await expect(async () => {
      if ((await live.state()).realmHopBlacklist?.length) {
        settings = await openSettings();
        await settings.getByRole('checkbox', { name: `Never hop to ${label(target.key)}` }).click({ timeout: 5_000 });
      }
      expect((await live.state()).realmHopBlacklist).toEqual([]);
    }).toPass({ timeout: 60_000 });
    await info.attach('realm-hop-blacklist-native', { body: JSON.stringify({ realms, target, after: (await live.state()).realmHopBlacklist }, null, 2), contentType: 'application/json' });
  } finally {
    await live.post('/realm/hop-blacklist', { realms: [] }).catch(() => undefined);
  }
});
