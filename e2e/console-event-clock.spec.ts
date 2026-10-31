import {test,expect} from './fixtures';
import {fetchFullState} from './state-route';

test.use({timezoneId:'America/New_York'});
// Knock-count failures: leader counts leaking into followers; combining different
// accounts; treating capped doors_left as the full account balance; double-counting
// duplicate doors; showing yesterday's allowance after UTC rollover.
test('Trick or Treat shows character allowance and honest shared account counts',async({page,app},info)=>{
  const original=await app.state();
  const day=new Date().toISOString().slice(0,10);
  const reports=new Map<string,Record<string,unknown>>();
  const publish=async()=>{for(const report of reports.values())await app.deliverStatus({...report,eventFeedAt:Date.now()});};
  const send=async(name:string,doors:number[],doorsLeft:number,owner='same-account',reportDay=day)=>{
    const report={...original.characters[name],owner,eventFeedConnected:true,eventClockStale:false,eventFeedAt:Date.now(),
      eventSchedules:[{id:'trickortreat',name:'Trick or Treat',live:true,clockOffsetMs:0,trickOrTreat:{day:reportDay,doors,doorsLeft,characterLimit:7,accountLimit:14}}]};
    delete report.seenAt;delete report.statusSequence;reports.set(name,report);await publish();
  };
  await send('W',[0,1,2,3,4,5,6],0);
  await send('P',[0,1,1],5);
  await send('M',[0,1,2,3,4,5,6],0,'other-account');
  // The console fixture normally reports an empty event feed every second.
  // Publish this scenario's external observations before each real state read;
  // the coordinator still owns projection, account grouping, and freshness.
  await page.route('**/party-api/state*',async route=>{await publish();await route.continue();});
  await page.goto('/');
  const open=async(name:string)=>{
    const card=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
    await card.getByRole('button',{name:/^Events \(/}).click();
    return page.locator('[data-event="trickortreat"]');
  };
  let row=await open('W');
  await expect(row).toContainText('Character: 0/7');await expect(row).toContainText('Account: up to 5/14');
  await page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})}).getByRole('button',{name:/^Events \(/}).click();
  await expect(row).toHaveCount(0);row=await open('P');
  await expect(row).toContainText('Character: 5/7');await expect(row).toContainText('Account: up to 5/14');
  await row.scrollIntoViewIfNeeded();
  await info.attach('trick-or-treat-knocks-remaining',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  await send('P',[0,1],0);
  await expect(row).toContainText('Character: 0/7');await expect(row).toContainText('Account: 0/14');
  // Restart can briefly publish a partial roster and unmount this popover.
  // Close it deliberately, then verify the recovered character view separately.
  await page.keyboard.press('Escape');await expect(row).toHaveCount(0);
  await page.unrouteAll({behavior:'wait'});
  await app.restartCoordinator();await send('W',[0,1,2,3,4,5,6],0);await send('P',[0,1],0);
  await page.route('**/party-api/state*',async route=>{await publish();await route.continue();});
  await expect.poll(async()=> {await publish();return (await app.state()).eventSchedules.find((e:any)=>e.id==='trickortreat')?.trickOrTreat?.characters?.P?.accountRemainingUpperBound;}).toBe(0);
  await page.reload();
  row=await open('P');
  await expect(row).toContainText('Character: 0/7');await expect(row).toContainText('Account: 0/14');
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  await page.clock.setFixedTime(new Date(tomorrow+'T00:00:01Z'));
  await expect(row).toContainText('Character: —/7');await expect(row).toContainText('Account: —/14');
  await info.attach('trick-or-treat-knocks-awaiting-reset-feed',{body:await page.screenshot(),contentType:'image/png'});
  await page.unrouteAll({behavior:'wait'});
});

// Reset failures: confusing a daily quota with a scheduled spawn; hiding the
// countdown behind LIVE; using realm midnight or local DST instead of UTC;
// freezing the countdown; retaining yesterday's deadline after midnight.
for(const [date,local] of [['2026-10-22','8:00 PM EDT'],['2026-11-05','7:00 PM EST']]){
  test(`Trick or Treat daily reset counts down and rolls over at ${local}`,async({page},info)=>{
    await page.clock.setFixedTime(new Date(`${date}T23:59:30Z`));
    await page.route('**/party-api/state*',async route=>{
      const response=await fetchFullState(route),state=await response.json();
      await route.fulfill({response,json:{...state,eventSchedules:[{id:'trickortreat',name:'Trick or Treat',live:true,clockOffsetMs:1000,realmOffsetHours:-5}]}});
    });
    await page.goto('/');
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})});
    await card.getByRole('button',{name:/^Events \(/}).click();
    const row=page.locator('[data-event="trickortreat"]');
    await expect(row).toContainText('Trick or Treat — LIVE');
    await expect(row).toContainText(`Next daily reset: Thu, ${local} (0h 0m 29s)`);
    await expect(row).toContainText('Once daily at 00:00 UTC');
    await page.clock.setFixedTime(new Date(`${date}T23:59:31Z`));
    await expect(row).toContainText('(0h 0m 28s)');
    await row.scrollIntoViewIfNeeded();
    await info.attach('trick-or-treat-reset-countdown',{body:await page.screenshot(),contentType:'image/png'});
    await page.clock.setFixedTime(new Date(Date.parse(`${date}T00:00:00Z`)+86400000));
    await expect(row).toContainText(`Next daily reset: Fri, ${local} (23h 59m 59s)`);
    await info.attach('trick-or-treat-reset-rollover',{body:await page.screenshot(),contentType:'image/png'});
  });
}

for(const [date,local] of [['2026-10-22T05:00:00Z','1:00 AM EDT'],['2026-11-05T05:00:00Z','12:00 AM EST']]){
  test(`Event clock preserves realm midnight as ${local}`,async({page},info)=>{
    await page.route('**/party-api/state*',async route=>{
      const response=await fetchFullState(route),state=await response.json();
      await route.fulfill({response,json:{...state,eventSchedules:[{id:'horseman',name:'Headless Horseman',next:Date.parse(date),clockOffsetMs:750,realmOffsetHours:-5,confirmed:true}]}});
    });
    await page.goto('/');
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})});
    await card.getByRole('button',{name:/^Events \(/}).click();
    await expect(page.getByText(`Headless Horseman — Thu, ${local}`,{exact:false})).toBeVisible();
    await expect(page.getByText('Realm: 00:00 (UTC−5)',{exact:true})).toBeVisible();
    await page.getByText('Realm: 00:00 (UTC−5)',{exact:true}).scrollIntoViewIfNeeded();
    await info.attach('event-clock-local-and-realm',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  });
}
