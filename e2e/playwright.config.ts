import { defineConfig, devices } from '@playwright/test';

/**
 * Local, deterministic E2E suite: the injected runtime against the *real* monaco-editor
 * package in a Scrimba-shaped fixture, with real (CDP/WebKit) touch input.
 * Chromium ≈ Android System WebView engine; WebKit ≈ iOS WKWebView engine.
 * Neither replaces device testing — see docs/DEVICE_TEST_CHECKLIST.md.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: './report', open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: { command: 'node e2e/server.mjs', url: 'http://127.0.0.1:4173/', reuseExistingServer: !process.env.CI, cwd: '..' },
  projects: [
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'ios-webkit', use: { ...devices['iPhone 14'] } },
  ],
});
