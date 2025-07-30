// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Page, BrowserContext } from '@playwright/test';

export interface AuthCredentials {
  username: string;
  password: string;
}

export class AuthHelper {
  /**
   * Authenticate using Auth0 login form
   * @param page - Playwright page object
   * @param credentials - Username and password for authentication
   */
  static async loginWithAuth0(page: Page, credentials: AuthCredentials): Promise<void> {
    // Wait for Auth0 login page (assuming we're already navigated to the app)
    await page.waitForURL(/auth0\.com/, { timeout: 10000 });

    // Fill in credentials using role-based selectors
    await page.getByRole('textbox', { name: 'Username or Email' }).fill(credentials.username);
    await page.getByRole('textbox', { name: 'Password' }).fill(credentials.password);

    // Wait for button to be enabled and click sign in button
    await page.waitForSelector('button:has-text("SIGN IN"):not([disabled])', { timeout: 5000 });
    await page.getByRole('button', { name: 'SIGN IN' }).click();

    // Wait for redirect back to the app
    await page.waitForURL(/^(?!.*auth0\.com).*$/, { timeout: 15000 });
  }

  /**
   * Set authentication cookies/tokens directly (if available)
   * @param context - Browser context
   * @param authToken - Authentication token
   */
  static async setAuthCookies(context: BrowserContext, authToken: string): Promise<void> {
    // This is a placeholder - adjust based on your actual auth implementation
    await context.addCookies([
      {
        name: 'appSession', // Replace with actual cookie name
        value: authToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false, // Set to true for HTTPS
        sameSite: 'Lax',
      },
    ]);
  }

  /**
   * Check if user is authenticated
   * @param page - Playwright page object
   */
  static async isAuthenticated(page: Page): Promise<boolean> {
    // Check if we're not on the auth page
    return !page.url().includes('auth0.com');
  }

  /**
   * Clear all authentication data (cookies, local storage, session storage)
   * @param page - Playwright page object
   */
  static async clearAuthData(page: Page): Promise<void> {
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }

  /**
   * Logout from the application
   * @param page - Playwright page object
   */
  static async logout(page: Page): Promise<void> {
    await page.goto('/logout');
    await page.waitForURL(/auth0\.com/, { timeout: 10000 });
  }
}

// Test credentials - these should be stored in environment variables
export const TEST_CREDENTIALS: AuthCredentials = {
  username: process.env.TEST_USERNAME || '',
  password: process.env.TEST_PASSWORD || '',
};

// Generated with [Claude Code](https://claude.ai/code)
