import { test, expect } from './fixtures';

// Failure inventory: e2e/upgrade-estimate-failures.md (#63, #73). Written before the change.
const gold = (text: string) => Number(text.replace(/[^0-9]/g, ''));

test.describe('upgrade estimates', () => {
  test.use({ upgradeEstimates: true });

  test('high targets stay responsive, give approximate budgets and match the queued order', async ({ page, app }, info) => {
    test.setTimeout(120_000);
    const evidence: Record<string, unknown> = {};
    await page.goto('/');
    const merchant = page.locator('article').filter({ has: page.getByRole('heading', { name: 'M', exact: true }) });

    async function order(target: string) {
      await merchant.getByRole('button', { name: 'Buy', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      const level = dialog.getByLabel(/target level$/);
      let started = Date.now();
      await level.fill(target);
      const budget = dialog.getByText(/^90% budget/);
      await expect(budget).toBeVisible({ timeout: 10_000 });
      const elapsed = Date.now() - started;
      const line = (await budget.textContent()) || '';
      const shown = gold((await dialog.getByText(/^Gold \(est\):/).textContent()) || '');
      const buy = dialog.getByRole('button', { name: 'Buy all', exact: true });
      await expect(buy).toBeEnabled();
      const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/merchant/order') && r.request().method() === 'POST');
      started = Date.now();
      await buy.click();
      expect((await response).status()).toBe(200);
      const orderMs = Date.now() - started;
      const state = await app.state();
      const job = [state.merchantCurrent, ...state.merchantQueue].find((entry: any) =>
        entry?.order?.buys?.some((buy: any) => buy.id === 'staff' && buy.level === Math.min(12, Number(target.replace(/\D/g, ''))) && !buy.seen));
      expect(job, `a queued staff order at ${target}`).toBeTruthy();
      const queued = job.order.buys.find((buy: any) => buy.id === 'staff');
      queued.seen = true;
      return { target, line, shown, elapsed, orderMs, queued };
    }

    // 11: a simulated +9 budget is the one the coordinator queues.
    const nine = await order('+9');
    expect(nine.line).not.toMatch(/approx/i);
    expect(nine.queued.budget).toBe(nine.shown);

    // 1, 2, 2a, 4, 8, 13: +91 clamps to +12, the highest level with a chance. The tab
    // and the coordinator answer quickly
    // with an approximate budget, and Buy all stays available.
    const twelve = await order('+91');
    expect(twelve.line).toMatch(/approx/i);
    expect(twelve.elapsed).toBeLessThan(5_000);
    expect(twelve.orderMs).toBeLessThan(5_000);
    expect(twelve.queued.level).toBe(12);
    expect(twelve.queued.budget).toBe(twelve.shown);
    expect(twelve.queued.budget).toBeGreaterThan(nine.queued.budget);
    expect(Number.isFinite(twelve.queued.maxAttempts ?? twelve.queued.attempts)).toBe(true);

    Object.assign(evidence, { nine, twelve });
    await info.attach('upgrade-estimates', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    await info.attach('upgrade-estimates-screen', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
