// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import { chromium, FullConfig } from '@playwright/test';
import dotenv from 'dotenv';
import { AuthHelper } from './auth.helper';

// Ensure .env is loaded before reading credentials
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function globalSetup(config: FullConfig) {
  const credentials = {
    username: process.env.TEST_USERNAME || '',
    password: process.env.TEST_PASSWORD || '',
  };

  // Skip authentication if no credentials are provided
  if (!credentials.username || !credentials.password) {
    console.log('⚠️  No test credentials provided. Tests requiring authentication will be skipped.');
    console.log('   Set TEST_USERNAME and TEST_PASSWORD environment variables to enable authenticated tests.');
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
    console.log('   Tests requiring authentication will be skipped.');
  } finally {
    await browser.close();
  }
}

export default globalSetup;

// Generated with [Claude Code](https://claude.ai/code)
