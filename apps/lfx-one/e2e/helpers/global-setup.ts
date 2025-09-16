// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { chromium, FullConfig } from '@playwright/test';
import { AuthHelper, TEST_CREDENTIALS } from './auth.helper';

async function globalSetup(config: FullConfig) {
  // Skip authentication if no credentials are provided
  if (!TEST_CREDENTIALS.username || !TEST_CREDENTIALS.password) {
    console.log('⚠️  No test credentials provided. Tests requiring authentication will be skipped.');
    console.log('   Set TEST_USERNAME and TEST_PASSWORD environment variables to enable authenticated tests.');
    return;
  }

  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Use baseURL from config or default to localhost
    const url = baseURL || 'http://localhost:4200';
    console.log(`🔐 Attempting to authenticate at ${url}`);

    // Clear all cookies to ensure clean state
    await context.clearCookies();

    // Navigate to logout to trigger authentication flow
    await page.goto(`${url}/logout`);

    // Perform authentication
    await AuthHelper.loginWithAuth0(page, TEST_CREDENTIALS);

    // Save authentication state
    await context.storageState({ path: 'playwright/.auth/user.json' });
    console.log('✅ Authentication successful. State saved.');
  } catch (error) {
    console.error('❌ Authentication failed:', error);
    console.log('   Tests requiring authentication will be skipped.');
  } finally {
    await browser.close();
  }
}

export default globalSetup;

// Generated with [Claude Code](https://claude.ai/code)
