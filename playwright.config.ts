import { defineConfig, devices } from '@playwright/test';
// Local browsers use the installed GPU; GPU-less CI retains explicit software rendering.
const browserRendering=process.env.E2E_BROWSER_RENDERING||(process.env.CI?'software':'hardware');
if(!['hardware','software'].includes(browserRendering))throw Error('E2E_BROWSER_RENDERING must be hardware or software');
const renderingArgs=browserRendering==='hardware'?['--enable-gpu']:['--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader'];
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/game/setup.mjs',
  projects: [
    { name: 'debug', testMatch: ['**/debug-instance.spec.ts', '**/debug-container.spec.ts'],
      // Video and named screenshots already record every visible debug journey.
      // A second high-FPS trace screencast adds hundreds of MB and can exhaust
      // Playwright's trace-merge deadline after all lifecycle assertions pass.
      use: { trace: { mode: 'on', snapshots: true, screenshots: false, sources: true } } },
    { name: 'console', testMatch: ['**/native-graphics-diagnostic.spec.ts', '**/console.spec.ts', '**/console-party-roles.spec.ts', '**/console-october-events.spec.ts', '**/console-event-clock.spec.ts', '**/console-build*.spec.ts', '**/console-bank-automarks.spec.ts', '**/console-bankboi-offerings.spec.ts', '**/hunt.spec.ts', '**/lucky-slot-lock.spec.ts', '**/lucky-slot-elimination.spec.ts', '**/doll-markup.spec.ts', '**/merchant-bank-visit.spec.ts', '**/console-persistence.spec.ts', '**/console-field-registry.spec.ts', '**/console-reports.spec.ts', '**/console-coordinator.spec.ts', '**/console-requests.spec.ts'] },
    // On demand only: docs/state-field-registry.md § Speed.
    { name: 'speed', testMatch: ['**/field-registry-speed.spec.ts'] },
    { name: 'live', fullyParallel:true, testMatch: ['**/live-console-*.spec.ts', '**/live-halloween.spec.ts', '**/live-october-events.spec.ts', '**/live-october-additions.spec.ts', '**/live-event-pretravel.spec.ts', '**/live-event-runtime-recovery.spec.ts', '**/live-event-entry-failure.spec.ts', '**/live-event-return-handoff.spec.ts', '**/live-cave.spec.ts', '**/live-planner-corner.spec.ts', '**/live-game.spec.ts', '**/live-monster-safety-reach.spec.ts', '**/live-economy.spec.ts', '**/live-exchange-collection.spec.ts', '**/live-bankboi.spec.ts', '**/live-bank-staging.spec.ts', '**/live-manual-upgrade.spec.ts', '**/live-bankboi-offerings.spec.ts', '**/live-catalog.spec.ts', '**/live-franky.spec.ts', '**/live-franky-party.spec.ts', '**/live-hunt-*.spec.ts', '**/live-solo-ranger.spec.ts', '**/live-merchant-config.spec.ts', '**/live-merchant-transporter-approach.spec.ts', '**/live-stale-merchant.spec.ts', '**/live-home-realm.spec.ts', '**/live-home-connect.spec.ts', '**/live-bank-npc-sales.spec.ts', '**/live-bank-collection.spec.ts', '**/live-merchant-realm-recovery.spec.ts', '**/live-navigation-supersession.spec.ts', '**/live-merchant-anniversary-availability.spec.ts', '**/live-combat-handoff.spec.ts', '**/live-farming-handoff.spec.ts', '**/live-equipment.spec.ts', '**/live-mailbox.spec.ts', '**/live-wtb-unconfirmed-purchase.spec.ts', '**/live-stat-scroll-bank.spec.ts', '**/live-gathering-cooldown.spec.ts', '**/live-exchange-reward-bank.spec.ts', '**/live-npc-sale-keep.spec.ts', '**/live-elixir-restock.spec.ts', '**/live-cave-headless.spec.ts', '**/live-cave-talk.spec.ts', '**/live-event-rendezvous.spec.ts', '**/live-convoy-event-defense.spec.ts', '**/live-franky-encounter-mode.spec.ts', '**/live-franky-absorb.spec.ts', '**/live-designated-tank.spec.ts', '**/live-phoenix-search.spec.ts', '**/live-realm-hop-blacklist.spec.ts', '**/live-cx.spec.ts', '**/live-bank-sort-gaps.spec.ts', '**/live-gear-sets.spec.ts', '**/live-prim-stack.spec.ts', '**/live-cave-insecure-origin.spec.ts', '**/live-tank-formation-hold.spec.ts', '**/live-tank-wall.spec.ts', '**/live-tank-assist.spec.ts', '**/live-tank-offtank.spec.ts', '**/live-giveaway-manual-name.spec.ts', '**/live-gear-set-recovery.spec.ts', '**/live-gear-set-equip.spec.ts', '**/live-giveaway-locate.spec.ts', '**/live-rogue-fan-scatter.spec.ts', '**/live-fan-farm-gear.spec.ts', '**/live-dashboard-bag.spec.ts', '**/live-alninja-report.spec.ts', '**/live-alninja-stand-price.spec.ts', '**/live-manual-upgrade-duplicates.spec.ts', '**/live-rogue-fan-crab.spec.ts', '**/live-bank-sort-journal.spec.ts', '**/live-rogue-fan-crab-rate.spec.ts'],
      testIgnore: process.env.E2E_SKIP_CAVE === '1' ? ['**/live-cave.spec.ts'] : [],
      use: { trace: { mode: 'on', snapshots: false, screenshots: false, sources: true } } },
  ],
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '.build/e2e-results',
  reporter: [
    ['list'],
    ['./e2e/artifact-reporter.cjs'],
    // HTML clears its own folder onEnd; keep the prior evidence manifest outside.
    ['html', { outputFolder: '.build/e2e-report/html', open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    // Keep DOM/network/source evidence plus video and screenshots below. A
    // duplicate high-FPS trace screencast can dominate canvas-heavy journeys.
    trace: { mode: 'on', snapshots: true, screenshots: false, sources: true },
    screenshot: 'on',
    video: 'on',
    launchOptions: { args: [...renderingArgs, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] },
  },
});
