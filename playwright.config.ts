import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
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
    { name: 'chromium', testIgnore: /adversarial/, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testIgnore: /adversarial/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: /adversarial/, use: { ...devices['Desktop Safari'] } },
    {
      name: 'adversarial',
      testDir: './e2e/adversarial',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
