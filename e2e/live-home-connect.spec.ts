import { test, expect } from './live-fixtures';

// Failure modes: stale saved/setup realms win over native home; startup repeats
// that stale connection; home selection overwrites an explicit realm transition.
// The native home-realm suite separately covers explicit temporary home visitors.
// A stale worker default must not initialize the party's automatic merchant
// return destination: that creates a stale home request before its first spawn
// and wins over native home selection. Native auth must reach USI without hopsickness.
// After native logout, its old status cannot authorize a headless home return
// while no managed slot/runtime owns that merchant.
test.use({ liveHeadless:true, staleWorkerRealm:'SR_USII' });

test('headless spawn and restart use home realm despite stale worker configuration', async ({ page, live }, info) => {
  test.setTimeout(240_000);
  try {
    await live.post('/steam/action', {character:'E2EMerchant',action:'logout'});
    await expect.poll(async () => (await live.state()).activeSlots.some((slot:any) => slot.character === 'E2EMerchant'), {timeout:90_000}).toBe(false);
    await expect.poll(async () => {
      const operation = (await live.state()).steamSwitch;
      return !operation || operation.phase === 'complete';
    }, {timeout:90_000}).toBe(true);
    await expect.poll(async () => await live.admin("output=!!get_player('E2EMerchant')"), {timeout:30_000}).toBe(false);
    await live.post('/slots/1/spawn', {character:'E2EMerchant'});
    await expect.poll(async () => await live.admin("output=get_player('E2EMerchant')?.p.home || null"), {timeout:90_000}).toBe('USI');
    await expect.poll(async () => (await live.state()).characters.E2EMerchant?.server, {timeout:90_000}).toBe('USI');
    const before = await live.state();
    expect(before.characters.E2EMerchant.s?.hopsickness).toBeFalsy();
    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).characters.E2EMerchant?.server, {timeout:90_000}).toBe('USI');
    const after = await live.state();
    expect(after.characters.E2EMerchant.s?.hopsickness).toBeFalsy();
    await info.attach('native-home-realm-spawn-restart', {body:JSON.stringify({before,after,staleWorkerRealm:'SR_USII'}),contentType:'application/json'});
  } finally { await page.close(); }
});
