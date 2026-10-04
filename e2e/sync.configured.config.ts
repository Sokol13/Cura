import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { syncFixture, syncPort } from './fixtures/sync-fixture.js';

syncFixture();
if (!Number.isInteger(syncPort) || syncPort < 1024 || syncPort > 65534)
  throw new Error('CURA_E2E_PORT must allow two adjacent unprivileged ports.');
const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  testDir: '.',
  testMatch: 'sync.configured.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: '../test-results/sync-configured',
  use: {
    baseURL: `http://127.0.0.1:${syncPort}`,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // Real passwords enter the sign-in form. Never retain browser traces/video.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    ...(process.env.CURA_CHROMIUM_EXECUTABLE
      ? {
          launchOptions: {
            executablePath: process.env.CURA_CHROMIUM_EXECUTABLE,
          },
        }
      : { channel: 'chrome' }),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [syncPort, syncPort + 1].map((port) => ({
    command: `node e2e/fixtures/sync-server.mjs ${port}`,
    cwd: root,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 },
  })),
});
