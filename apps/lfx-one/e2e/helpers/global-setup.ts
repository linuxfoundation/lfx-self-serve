// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import { chromium, FullConfig } from '@playwright/test';
import { AuthHelper } from './auth.helper';

// Ensure .env is loaded before reading credentials
try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn('[loadenvfile] failed to load .env:', err);
  }
}

/**
 * Write a storageState file with no cookies or origins.
 *
 * Playwright accepts this and simply starts every context unauthenticated -- which is exactly
 * the state the skip guards then detect and report properly.
 */
async function writeEmptyStorageState(): Promise<void> {
  const dir = 'playwright/.auth';
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'user.json'), JSON.stringify({ cookies: [], origins: [] }), 'utf8');
}

async function globalSetup(config: FullConfig) {
  const credentials = {
    username: process.env.TEST_USERNAME || '',
    password: process.env.TEST_PASSWORD || '',
  };

  // Skip authentication if no credentials are provided
  if (!credentials.username || !credentials.password) {
    console.log('⚠️  No test credentials provided. Tests requiring authentication will be skipped.');
    console.log('   Set TEST_USERNAME and TEST_PASSWORD environment variables to enable authenticated tests.');
    // An EMPTY state file is still written. Every project declares
    // `storageState: 'playwright/.auth/user.json'`, which Playwright reads while constructing
    // the `page` fixture -- so returning without it fails the fixture BEFORE any test body runs,
    // and skipWhenAuthMissing() (which needs `page`) can never fire. On a clean checkout the
    // whole suite ERRORED instead of skipping, naming a missing file rather than the missing
    // credentials that caused it.
    await writeEmptyStorageState();
    return;
  }

  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const url = baseURL || 'http://localhost:4200';
    console.log(`🔐 Attempting to authenticate at ${url}`);

    // Clear all cookies to ensure clean state
    await context.clearCookies();

    // Navigate to logout to trigger authentication flow
    await page.goto(`${url}/logout`);

    // Perform authentication
    await AuthHelper.loginWithAuth0(page, credentials);

    // Save authentication state
    const authDir = 'playwright/.auth';
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    await context.storageState({ path: `${authDir}/user.json` });
    console.log('✅ Authentication successful. State saved.');
  } catch (error) {
    console.error('❌ Authentication failed:', error);
    // NOT "will be skipped": the guards key on the credential ENV VARS being absent, and they
    // are present here -- authentication is what failed. Those specs will therefore run
    // unauthenticated and fail on their own assertions, so the message must not imply the run
    // is clean.
    console.log('   Credentials were supplied but authentication failed, so authenticated specs will RUN and fail.');
    console.log('   Fix the credentials, or unset TEST_USERNAME/TEST_PASSWORD to skip those specs instead.');
    // Same guarantee as the missing-credentials path above. This branch also PROMISES a skip,
    // and without a state file the projects' `storageState` fails while constructing the `page`
    // fixture -- so the suite errors on a missing file instead of skipping, naming the wrong
    // cause. A partially-written file from a failed run is overwritten rather than trusted.
    await writeEmptyStorageState();
  } finally {
    await browser.close();
  }
}

export default globalSetup;

// Generated with [Claude Code](https://claude.ai/code)
