import {test, expect} from './fixtures';

test('lucky discovery rules out ordinary slots and recomputes after new evidence', async ({page,app},info) => {
  await page.goto('/');
  const merchant=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  await merchant.getByLabel('Short Sword',{exact:true}).click();
  await page.getByRole('menuitem',{name:'Show lucky slot data',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Lucky slots · M',exact:true});
  const ledger={version:1,streamId:'e2e-elimination',slots:Object.fromEntries(Array.from({length:42},(_,slot)=>[slot,{
    totalRolls:slot===0?99:100,sumRolls:slot===0?60:50,rollsAbove96_3:slot===0?20:3,perfectRolls:0,
  }]))};
  const receipts:unknown[]=[];
  const deliver=async()=>{
    const state=await app.state(),id=state.roster.find((entry:{name:string})=>entry.name==='M').id;
    receipts.push(await app.deliverStatus({...state.characters.M,name:'M',luckySlotCharacterId:id,luckySlotTracking:ledger}));
  };
  await deliver();
  await expect(dialog.getByText('0/42 slots ruled out.',{exact:true})).toBeVisible();
  await expect(dialog.getByText(/Next upgrade will test for lucky upgrade · slot 0/)).toBeVisible();
  ledger.slots[0].totalRolls=100;
  await deliver();
  await expect(dialog.getByText('1/42 slots ruled out.',{exact:true})).toBeVisible();
  const zero=dialog.getByRole('row').filter({has:page.getByRole('button',{name:'Lock lucky slot position · slot 0',exact:true})});
  await expect(zero).toContainText('Ruled out');
  await expect(dialog.getByText(/Next upgrade will test for lucky upgrade · slot 1/)).toBeVisible();
  await info.attach('ordinary-slot-eliminated',{body:await dialog.screenshot(),contentType:'image/png'});
  // Cumulative evidence weakens all competing candidates; elimination is not sticky.
  for(let slot=1;slot<42;slot++)ledger.slots[slot]={totalRolls:10000,sumRolls:6000,rollsAbove96_3:4000,perfectRolls:0};
  await deliver();
  await expect(zero).not.toContainText('Ruled out');
  await expect(dialog.getByText('41/42 slots ruled out.',{exact:true})).toBeVisible();
  await app.restartCoordinator(); await page.reload();
  await merchant.getByLabel('Short Sword',{exact:true}).click();
  await page.getByRole('menuitem',{name:'Show lucky slot data',exact:true}).click();
  await expect(dialog.getByText('41/42 slots ruled out.',{exact:true})).toBeVisible();
  await info.attach('elimination-observation-ledger',{body:JSON.stringify({ledger,receipts,state:await app.state()}),contentType:'application/json'});
  await info.attach('elimination-recomputed-after-restart',{body:await dialog.screenshot(),contentType:'image/png'});
});
