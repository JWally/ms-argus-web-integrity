import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Per-project testDir below — no top-level testDir so projects fully own
  // which directory they scan. e2e/utils is a helper module, not a test
  // directory; nothing scans it.
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:9100',
  },
  webServer: {
    command: 'PORT=9100 node server.js',
    port: 9100,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', testDir: './e2e/clean', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testDir: './e2e/clean', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testDir: './e2e/clean', use: { ...devices['Desktop Safari'] } },
    {
      name: 'adversarial',
      testDir: './e2e/adversarial',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
