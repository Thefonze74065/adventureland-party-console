import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';

// The Tank, Off tank and Pull controls live in the dialog that each card's Farming settings
// gear button opens (party-roles-settings.tsx). They stay party-wide: every card's dialog
// shows the saved values, and a change from one card reaches the others and survives a
// coordinator restart. The fixture characters are not managed, so /formation accepts only
// null roles here; the saved record seeds the named tank and off tank.
test.use({ savedRecords: [{ party_dashboard_settings_state_v1: { designatedTank: 'W', offTank: 'P', pullMode: true } }] });

const card = (page: Page, name: string) =>
  page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Farming settings/ });
const roles = (page: Page) => dialog(page).getByRole('group', { name: 'Party roles' });
const roleLabel = (page: Page, label: string) => roles(page).locator('label').filter({ hasText: new RegExp(`^${label}`) });
const pull = (page: Page) => roles(page).getByRole('checkbox', { name: 'Pull' });

async function openSettings(page: Page, name: string) {
  await card(page, name).getByRole('button', { name: 'Farming settings', exact: true }).click();
  await expect(roles(page)).toBeVisible();
}
async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
}
async function expectRoles(page: Page, tank: string, offTank: string, pulled: boolean) {
  await expect(roleLabel(page, 'Tank')).toContainText(tank);
  await expect(roleLabel(page, 'Off tank')).toContainText(offTank);
  if (pulled) await expect(pull(page)).toBeChecked();
  else await expect(pull(page)).not.toBeChecked();
}

/**
 * lines counts the children that start below the first child's bottom edge, plus one.
 * tallest grows when a control's own text wraps.
 */
async function layout(row: Locator) {
  return row.evaluate(element => {
    const boxes = [...element.children].map(child => child.getBoundingClientRect()).filter(box => box.width > 0);
    return { lines: 1 + boxes.filter(box => box.top >= boxes[0].bottom).length, tallest: Math.round(Math.max(...boxes.map(box => box.height))),
      overflow: element.scrollWidth > element.clientWidth + 1, width: element.clientWidth };
  });
}

async function capture(locator: Locator, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await locator.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

const formationPost = (page: Page) => page.waitForResponse(response =>
  new URL(response.url()).pathname.endsWith('/formation') && response.request().method() === 'POST');

test('party roles sit in the Farming settings dialog and stay party-wide across cards and a restart', async ({ page, app }, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/');
  await expect(card(page, 'W')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Party roles' })).toHaveCount(0);

  // The expanded panel holds only the mode buttons and status, without the roles.
  await card(page, 'W').getByRole('button', { name: /^Farming settings .+/ }).click();
  const panel = card(page, 'W').getByRole('button', { name: 'Auto', exact: true }).locator('xpath=ancestor::section[1]');
  await expect(panel.getByRole('button', { name: 'Scatter', exact: true })).toBeVisible();
  await expect(card(page, 'W').getByRole('group', { name: 'Party roles' })).toHaveCount(0);
  await capture(panel, info, 'farming-settings-panel');
  await card(page, 'W').getByRole('button', { name: /^Farming settings .+/ }).click();

  await openSettings(page, 'W');
  await expectRoles(page, 'W', 'P', true);
  const tank = roleLabel(page, 'Tank').getByRole('combobox');
  await expect(tank).toHaveAttribute('title', /holds its target at its own range/);
  await expect(tank).toHaveAccessibleDescription(/holds its target at its own range/);
  await expect(roleLabel(page, 'Off tank').getByRole('combobox')).toHaveAccessibleDescription(/takes the tank's attackers/);
  await expect(pull(page)).toHaveAccessibleDescription(/longest-range member draws one monster/);
  expect(await layout(roles(page))).toMatchObject({ lines: 1, overflow: false });
  await capture(dialog(page), info, 'farming-gear-menu-roles');
  await closeSettings(page);

  // A change from P's dialog is the same party-wide /formation call and shows in W's dialog.
  await openSettings(page, 'P');
  await expectRoles(page, 'W', 'P', true);
  const cleared = formationPost(page);
  await roleLabel(page, 'Tank').getByRole('combobox').click();
  await page.getByRole('option', { name: 'None', exact: true }).click();
  expect((await cleared).request().postDataJSON()).toEqual({ tank: null });
  const unpulled = formationPost(page);
  // The checkbox follows the saved state, so it clears once the coordinator answers.
  await pull(page).click();
  expect((await unpulled).request().postDataJSON()).toEqual({ pullMode: false });
  await expectRoles(page, 'None', 'P', false);
  await closeSettings(page);
  await openSettings(page, 'W');
  await expectRoles(page, 'None', 'P', false);
  await closeSettings(page);

  await app.restartCoordinator();
  await expect.poll(async () => { const state = await app.state(); return [state.designatedTank, state.offTank, state.pullMode]; })
    .toEqual([null, 'P', false]);
  await page.reload();
  await openSettings(page, 'W');
  await expectRoles(page, 'None', 'P', false);
});
