import { test, expect } from './fixtures';
import { fetchFullState } from './state-route';

test('waiting Steam primary exposes retry and connection setup', async ({ page }, info) => {
  // Failure modes: a reserved primary has no heartbeat or controls; retry errors
  // disappear; repeated clicks submit duplicate operations; headless is mislabeled.
  // Only the account read and Steam desktop action boundaries are declared here.
  const requests: unknown[] = [];
  await page.route('**/party-api/state*', async route => {
    const response = await fetchFullState(route);
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, steamSwitch: null,
      activeSlots: [{ index: 0, kind: 'native', character: 'GDroidPT', primary: true }],
      characterConnections: [{ name: 'GDroidPT', primary: true, status: 'waiting', delayed: false }],
    } });
  });
  await page.route('**/party-api/steam/action', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, json: { error: 'Adventure Land is already running without its automation connection. Close it once, then retry.' } });
  });
  await page.goto('/');
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'GDroidPT', exact: true }) });
  await expect(card.getByRole('link', { name: 'Open connection setup' })).toHaveAttribute('href', '/setup');
  await card.getByRole('button', { name: 'Retry Steam connection' }).click();
  await expect(page.getByText(/already running without its automation connection/).first()).toBeVisible();
  await expect(card.getByRole('button', { name: 'Retry Steam connection' })).toBeEnabled();
  expect(requests).toEqual([{ character: 'GDroidPT', action: 'primary' }]);
  await info.attach('steam-pending-recovery', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('steam-retry-requests', { body: Buffer.from(JSON.stringify(requests)), contentType: 'application/json' });
});
