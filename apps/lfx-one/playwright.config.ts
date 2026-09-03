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
// Keep localhost to match the domain used by the suite's persona and lens cookie seeders.
const E2E_HOST = 'localhost';
// E2E_BASE_URL WINS when set. Hardcoding `http://host:port` made the override unreadable and the
// https branch below permanently dead -- `E2E_IS_HTTPS` could never be true, so the
// externally-started-server mode it selects was unreachable code (Copilot). The cookie helper
// already reads this env var first, so ignoring it here also put the persona cookie on a host the
// browser never visited.
const E2E_BASE_URL = process.env['E2E_BASE_URL'] ?? `http://${E2E_HOST}:${E2E_PORT}`;
// The port the dev server is actually LAUNCHED on, derived from the base URL.
// An https base url cannot be served by the `ng serve` this config launches -- it speaks plain
// HTTP -- so instead of deriving a port that can never work, the webServer block is OMITTED for
// https and Playwright runs against a server the operator started themselves.
//
// NOT a throw at import time, which is what an earlier version did: the config body runs before
// Playwright reads `webServer`, so throwing there made the externally-started server the error
// message recommended impossible to actually use (Copilot). The advice and the mechanism now
// agree.
const E2E_IS_HTTPS = (() => {
  try {
    return new URL(E2E_BASE_URL).protocol === 'https:';
  } catch {
    return false;
  }
})();

const E2E_LAUNCH_PORT = (() => {
  try {
    // `URL.port` is EMPTY for a scheme-default port, so `|| E2E_PORT` treated a deliberately
    // portless override (E2E_BASE_URL=http://localhost) exactly like a parse failure -- Playwright
    // would probe 80 while Angular launched on 4200. An absent port is a REAL answer here, so the
    // scheme default is supplied rather than falling back.
    //
    // 80 needs root on most systems; that surfaces as a clear EACCES from `ng serve` rather than
    // a divergence, so it is left to fail on its own terms.
    return new URL(E2E_BASE_URL).port || '80';
  } catch {
    // Only an UNPARSEABLE url falls back, which is the one case where the base url says nothing.
    return E2E_PORT;
  }
})();

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
  // OMITTED for an https base url: `ng serve` cannot serve https, so there is nothing to launch.
  // Playwright then runs against whatever the operator started at that url -- the same outcome
  // `reuseExistingServer` gives, reached without pretending we can start it.
  webServer: E2E_IS_HTTPS
    ? undefined
    : {
        // `yarn start` is the ROOT script, which goes through turbo and does not accept --port; the
        // app's own script is `ng serve`. Invoked directly so an E2E_PORT override actually works.
        //
        // No --cwd: this config already lives in apps/lfx-one, so Playwright runs the command from
        // there and `--cwd apps/lfx-one` resolved to apps/lfx-one/apps/lfx-one. Locally
        // reuseExistingServer hides it by adopting a server someone already started; CI has it off,
        // so the server never launches and the whole suite fails there.
        //
        // docs:build first, for the same class of reason. The app's `start` script is
        // `yarn docs:build && ng serve`, and DocsManifestService STATICALLY imports
        // src/app/modules/docs/generated/docs-manifest, which is gitignored. Calling `ng serve`
        // alone works on a machine that has built before and cannot compile on a clean checkout —
        // so the suite would fail to launch in CI while passing locally.
        command: `yarn docs:build && yarn ng serve --port ${E2E_LAUNCH_PORT}`,
        url: E2E_BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
