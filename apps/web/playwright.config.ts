import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const shouldStartWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER !== '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 960 },
    trace: 'on-first-retry',
  },
  webServer: shouldStartWebServer
    ? {
        command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3000',
        cwd: __dirname,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
