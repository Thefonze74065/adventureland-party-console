import { test, expect } from './fixtures';

// Coordinator hot paths through the real coordinator (docs/efficiency.md, Coordinator).

test.describe('interrupted automatic upgrade relocation',()=>{
  // Failure modes: stale liveSlot masks candidate slots; a completed duplicate
  // steals the pass; reconciliation deletes intent; restart loses relocation.
  test.use({merchantConnected:false,savedRecords:[{party_dashboard_settings_state_v1:{merchantCharacter:'M',autoUpgradeMarks:{M:{'broom@+0':{tiers:7,quantity:-1}}},upgrades:{M:[{slot:7,liveSlot:7,item:{name:'broom',level:0},liveItem:{name:'broom',level:2},tiers:7,auto:true,passId:'interrupted-broom'}]}}}]});
  test('relocated +2 broom keeps its original +7 target across coordinator restart',async({app},info)=>{
    const initial=await app.state(),base=initial.characters.W;
    const report={...base,name:'M',ctype:'merchant',runtimeId:'e2e-relocated-M',clientInstance:'e2e-relocated-M',statusSequence:1,slots:{},items:[{slot:10,item:{name:'broom',level:2}},{slot:11,item:{name:'broom',level:7}}]};
    for(const key of ['seenAt','inventorySeenAt']) delete report[key];
    await app.deliverStatus(report);
    await app.deliverStatus({...report,statusSequence:2});
    await expect.poll(async()=>(await app.state()).upgrades.M).toMatchObject([{passId:'interrupted-broom',slot:10,liveSlot:10,item:{name:'broom',level:0},tiers:7}]);
    const relocated=await app.state();
    await app.restartCoordinator();
    await app.deliverStatus({...report,statusSequence:3});
    await app.deliverStatus({...report,statusSequence:4});
    const restarted=await app.state();
    expect(restarted.upgrades.M).toMatchObject([{passId:'interrupted-broom',liveSlot:10,item:{name:'broom',level:0},tiers:7}]);
    const admitted=await fetch(app.url+'/party-api/merchant/production',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify({character:'M',id:'relocated-next-roll',kind:'upgrade',item:{name:'broom',level:2},automatic:{family:'upgrade',key:'broom@+0',mark:{...restarted.upgrades.M[0],slot:10,liveSlot:7}}})});
    expect(admitted.ok).toBe(true);
    expect((await app.state()).upgrades.M[0]).toMatchObject({liveSlot:10,liveItem:{name:'broom',level:2},tiers:7});
    await info.attach('interrupted-broom-relocation',{body:JSON.stringify({report,relocated,restarted}),contentType:'application/json'});
  });
  test('two displaced +2 survivors retain the unresolved +7 intent',async({app},info)=>{
    const base=(await app.state()).characters.W;
    const report={...base,name:'M',ctype:'merchant',runtimeId:'e2e-ambiguous-M',clientInstance:'e2e-ambiguous-M',statusSequence:1,slots:{},items:[10,11].map(slot=>({slot,item:{name:'broom',level:2}}))};
    for(const key of ['seenAt','inventorySeenAt']) delete report[key];
    await app.deliverStatus(report);
    await app.deliverStatus({...report,statusSequence:2});
    const state=await app.state();
    expect(state.upgrades.M).toMatchObject([{passId:'interrupted-broom',item:{name:'broom',level:0},tiers:7}]);
    await info.attach('ambiguous-broom-intent-retained',{body:JSON.stringify({report,state}),contentType:'application/json'});
  });
});

test('stand price history takes the level of the first listing at the lowest price', async ({ page, app }, info) => {
  const merchant = { ...(await app.state()).characters.M };
  for (const field of ['seenAt', 'inventorySeenAt']) delete merchant[field];
  const listing = (name: string, level: number, price: number, slot: number) =>
    ({ key: `e2e-stand-${slot}`, seller: 'Seller' + slot, item: { name, level }, price, quantity: 1, seenAt: Date.now(), slot: 'trade' + slot, map: 'main', x: 0, y: 0 });
  // Two helmets share the lowest price; a zero-priced coat supplies no price.
  await app.deliverStatus({ ...merchant, nearbyStandListings: [listing('helmet', 7, 900, 1), listing('helmet', 3, 500, 2),
    listing('helmet', 5, 500, 3), listing('coat', 2, 0, 4)] });
  const market = async () => (await (await page.request.get(`${app.url}/party-api/state?section=market&dashboard=1`)).json()).standPriceHistory;
  await expect.poll(async () => (await market())?.helmet?.lowest).toBe(500);
  const history = await market();
  await info.attach('stand-price-history', { body: JSON.stringify(history), contentType: 'application/json' });
  expect(history.helmet).toMatchObject({ lowest: 500, lowestLevel: 3, recent: 500, recentLevel: 3 });
  expect(history.coat).toBeUndefined();
});
