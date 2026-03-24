import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    viewport: { width: 1440, height: 960 },
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3000',
    cwd: __dirname,
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
