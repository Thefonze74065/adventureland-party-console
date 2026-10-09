import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/game/setup.mjs',
  projects: [
    { name: 'debug', testMatch: ['**/debug-instance.spec.ts', '**/debug-container.spec.ts'] },
    { name: 'console', testMatch: ['**/console.spec.ts', '**/hunt.spec.ts', '**/lucky-slot-lock.spec.ts', '**/lucky-slot-elimination.spec.ts', '**/doll-markup.spec.ts', '**/merchant-bank-visit.spec.ts'] },
    { name: 'live', testMatch: ['**/live-halloween.spec.ts', '**/live-event-runtime-recovery.spec.ts', '**/live-cave.spec.ts', '**/live-game.spec.ts', '**/live-economy.spec.ts', '**/live-bankboi.spec.ts', '**/live-catalog.spec.ts', '**/live-franky.spec.ts', '**/live-franky-party.spec.ts', '**/live-hunt-*.spec.ts', '**/live-solo-ranger.spec.ts', '**/live-merchant-config.spec.ts', '**/live-stale-merchant.spec.ts', '**/live-home-realm.spec.ts', '**/live-home-connect.spec.ts', '**/live-bank-npc-sales.spec.ts', '**/live-merchant-realm-recovery.spec.ts', '**/live-merchant-anniversary-availability.spec.ts', '**/live-combat-handoff.spec.ts', '**/live-equipment.spec.ts', '**/live-franky-encounter-mode.spec.ts', '**/live-franky-absorb.spec.ts', '**/live-designated-tank.spec.ts', '**/live-phoenix-search.spec.ts', '**/live-realm-hop-blacklist.spec.ts', '**/live-cx.spec.ts'],
      use: { trace: { mode: 'on', snapshots: false, screenshots: false, sources: true } } },
  ],
  fullyParallel: false,
  workers: 1,
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
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    launchOptions: { args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] },
  },
});
