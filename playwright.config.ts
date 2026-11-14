import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4325',
    channel: 'chrome',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run preview -- --port 4325',
    url: 'http://localhost:4325',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
