import { defineConfig, devices } from '@playwright/test';

/** Opt-in suite against the real scrimba.com. Not part of CI by default. */
export default defineConfig({
  testDir: './live',
  outputDir: './test-results-live',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'live-android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'live-ios-webkit', use: { ...devices['iPhone 14'] } },
  ],
});
