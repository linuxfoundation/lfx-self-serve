// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { defineConfig, devices } from '@playwright/test';

// Load environment variables from .env file
try {
  process.loadEnvFile();
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn('[loadenvfile] failed to load .env:', err);
  }
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
/**
 * The dev-server port, overridable with E2E_PORT.
 *
 * Defaults to 4200 because Auth0's callback is registered for that origin — a run on any other
 * port cannot complete the login, so the default is the only value that works for AUTHENTICATED
 * tests. An override exists for specs that mock every route they need and so never reach Auth0,
 * and for the case where 4200 is already serving another session.
 */
const E2E_PORT = process.env['E2E_PORT'] ?? '4200';
// 127.0.0.1, not localhost. `ng serve` binds IPv4-only, while Chromium resolves localhost to
// ::1 first — so every navigation came back ERR_CONNECTION_REFUSED against a server that was
// up and serving, and the run read as six spec failures rather than a name-resolution problem.
// Overridable for anyone whose setup needs a different host.
const E2E_HOST = process.env['E2E_HOST'] ?? '127.0.0.1';
const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`;

export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Global setup */
  globalSetup: require.resolve('./e2e/helpers/global-setup.ts'),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: E2E_BASE_URL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use saved auth state for all tests
        storageState: 'playwright/.auth/user.json',
      },
    },

    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Use saved auth state for all tests
        storageState: 'playwright/.auth/user.json',
        // Firefox-specific timeout adjustments
        actionTimeout: 15000, // Increased from default 10s
        navigationTimeout: 45000, // Increased from default 30s
      },
    },
    /* Test against mobile viewports. */
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        // Use saved auth state for all tests
        storageState: 'playwright/.auth/user.json',
      },
      // Use single worker for mobile to prevent resource contention
      workers: 1,
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    // `yarn start` is the ROOT script, which goes through turbo and does not accept --port; the
    // app's own script is `ng serve`. Invoked directly so an E2E_PORT override actually works.
    //
    // No --cwd: this config already lives in apps/lfx-one, so Playwright runs the command from
    // there and `--cwd apps/lfx-one` resolved to apps/lfx-one/apps/lfx-one. Locally
    // reuseExistingServer hides it by adopting a server someone already started; CI has it off,
    // so the server never launches and the whole suite fails there.
    command: `yarn ng serve --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
