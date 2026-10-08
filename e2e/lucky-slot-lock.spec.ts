import { test, expect } from './fixtures';

test('lucky slot lock persists and unlock restores discovery', async ({page, app}, info) => {
  // Failure modes: menu missing, lock not durable, unlock leaves the position pinned.
  await page.goto('/');
  const merchant = page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  const slot = merchant.getByLabel('Short Sword',{exact:true});
  await slot.click();
  await expect(page.getByRole('menuitem', {name:'Show lucky slot data',exact:true})).toBeVisible();
  await expect(page.getByRole('menuitem', {name:'Lock lucky slot position',exact:true})).toHaveCount(0);
  await page.getByRole('menuitem', {name:'Show lucky slot data',exact:true}).click();
  const details = page.getByRole('dialog',{name:'Lucky slots · M',exact:true});
  await details.getByRole('button',{name:'Lock lucky slot position · slot 0',exact:true}).click();
  await expect.poll(async () => (await app.state()).luckySlotLocks?.M).toBe(0);
  await expect(details.getByRole('button',{name:'Lock lucky slot position · slot 1',exact:true})).toBeDisabled();
  await details.getByRole('button',{name:'Close',exact:true}).click();
  await slot.hover();
  await expect(page.getByText('Locked lucky upgrade position · slot 0. Click for options.',{exact:true})).toBeVisible();
  await app.restartCoordinator();
  await page.reload();
  await slot.click();
  await page.getByRole('menuitem', {name:'Show lucky slot data',exact:true}).click();
  await details.getByRole('button',{name:'Unlock lucky slot position · slot 0',exact:true}).click();
  await expect.poll(async () => (await app.state()).luckySlotLocks?.M ?? null).toBeNull();
  await expect(details.getByRole('button',{name:'Lock lucky slot position · slot 1',exact:true})).toBeEnabled();
  await details.getByRole('button',{name:'Close',exact:true}).click();
  const next = merchant.getByLabel('Raw Emerald',{exact:true});
  await next.hover();
  await expect(page.getByText('Next upgrade will test for lucky upgrade · slot 1. Click for options.',{exact:true})).toBeVisible();
  await next.click();
  await expect(page.getByRole('menuitem',{name:'Show lucky slot data',exact:true})).toBeVisible();
  await expect(page.getByRole('menuitem',{name:'Lock lucky slot position',exact:true})).toHaveCount(0);
  await info.attach('lucky-slot-unlocked', {body:await page.screenshot(),contentType:'image/png'});
  await page.getByRole('menuitem',{name:'Show lucky slot data',exact:true}).click();
  const leadingRow = details.getByRole('row').filter({has:page.getByRole('button',{name:'Lock lucky slot position · slot 0',exact:true})});
  const otherRow = details.getByRole('row').filter({has:page.getByRole('button',{name:'Lock lucky slot position · slot 1',exact:true})});
  await expect(leadingRow).toBeVisible();
  await expect(otherRow).toBeVisible();
  const greenBackground = (element: HTMLElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0,0,1,1);
    const [red,green,blue,alpha] = context.getImageData(0,0,1,1).data;
    return alpha > 0 && green > red && green > blue;
  };
  await expect.poll(() => leadingRow.evaluate(greenBackground)).toBe(false);
  // Declared observed roll ledger, not an upgrade receipt or native outcome.
  // Deliver it through the real status boundary while preserving the report.
  const evidence = {version:1,streamId:'e2e-confidence',slots:{'0':{
    totalRolls:100,sumRolls:50,rollsAbove96_3:3,perfectRolls:2,
  }}};
  const state = await app.state();
  const report = state.characters.M;
  const characterId = state.roster.find((entry: {name: string}) => entry.name === 'M').id;
  const receipt = await app.deliverStatus({...report,name:'M',luckySlotCharacterId:characterId,luckySlotTracking:evidence});
  await expect(details.getByText('Leading candidate: slot 0 · 97.37% model confidence · 100 rolls in that slot.',{exact:true})).toBeVisible();
  await expect.poll(() => leadingRow.evaluate(greenBackground)).toBe(true);
  await expect.poll(() => otherRow.evaluate(greenBackground)).toBe(false);
  await info.attach('lucky-slot-confidence-ledger',{body:JSON.stringify({evidence,receipt,state:await app.state()}),contentType:'application/json'});
  await info.attach('lucky-slot-confidence-highlight',{body:await details.screenshot(),contentType:'image/png'});
});
