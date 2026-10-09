import { test, expect } from './fixtures';

test.use({merchantDialogs:true,merchantManaged:true});
test('merchant destination dialog offers a deduplicated Visit bank action', async ({page,app},info) => {
  // Read-boundary fixture owns reported characters; the native bank suite owns
  // actual stock movement. Observe the command and resulting durable queue.
  await page.goto('/');
  await page.getByRole('button', {name:'Send merchant to…',exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'Send merchant to',exact:true});
  await expect(dialog.getByRole('button', {name:'Visit bank',exact:true})).toBeVisible();
  const command = page.waitForRequest(request => request.url().endsWith('/command') && request.postDataJSON()?.type === 'bank');
  await dialog.getByRole('button', {name:'Visit bank',exact:true}).click();
  const request = await command;
  const state = await app.state();
  expect(request.postDataJSON().character).toBe(state.merchantCharacter);
  await expect(page.getByRole('status').filter({hasText:'Bank visit queued'})).toBeVisible();
  const response = await page.request.post('/party-api/command', {headers:{Origin:app.url},data:request.postDataJSON()});
  expect(response.ok()).toBe(true);
  const after = await app.state();
  expect([after.merchantCurrent,...after.merchantQueue].filter((job:any) => job?.target===state.merchantCharacter && job.reason==='manual bank exchange').length).toBeLessThanOrEqual(1);
  await info.attach('visit-bank-command-and-queue', {body:JSON.stringify({command:request.postDataJSON(),after}),contentType:'application/json'});
  await info.attach('visit-bank-status', {body:await page.screenshot(),contentType:'image/png'});
});
